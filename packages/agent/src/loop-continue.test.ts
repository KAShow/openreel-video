import { describe, it, expect } from "vitest";
import { runTurn, type RunTurnInput } from "./loop";
import { HeadlessHost } from "./headless-host";
import { MockLLMClient } from "./llm";
import type { LLMResponse, LoopMessage } from "./llm";
import { makeEmptyProject } from "./test-fixtures";
import type { ToolResult } from "./types";

const use = (id: string, name: string): LLMResponse => ({ text: "", stopReason: "tool_use", toolUses: [{ id, name, input: {} }] });
const done: LLMResponse = { text: "Done", stopReason: "end_turn", toolUses: [] };
const failure: ToolResult = { ok: false, summary: "Edit rejected", error: { code: "INVALID_EDIT", message: "Clip ID was not found" } };

function run(script: LLMResponse[], extra: Partial<RunTurnInput>) {
  return runTurn({
    host: new HeadlessHost(makeEmptyProject()),
    llm: new MockLLMClient(script),
    tools: [],
    messages: [{ role: "user", content: "trim it" }],
    atomic: true,
    execute: async (name) => (name === "bad" ? failure : { ok: true, summary: `${name} ok` }),
    ...extra,
  });
}

const toolResults = (messages: LoopMessage[]) => messages.flatMap((m) => (m.role === "tool" ? m.results : []));

describe("runTurn continueAfterFailure", () => {
  it("discards an atomic turn on a failed call by default", async () => {
    const result = await run([use("t1", "bad"), done], {});
    expect(result).toMatchObject({ committed: false, stoppedReason: "error" });
  });

  it("shows the failure to the model and commits the turn when the caller allows it", async () => {
    const result = await run([use("t1", "bad"), use("t2", "good"), done], { continueAfterFailure: () => true });
    expect(result).toMatchObject({ committed: true, stoppedReason: "end_turn", text: "Done", toolCalls: 2 });
    expect(toolResults(result.messages).map((r) => [r.toolUseId, r.isError])).toEqual([["t1", true], ["t2", false]]);
  });

  it("asks per call: a refusal still discards the turn", async () => {
    const seen: string[] = [];
    const result = await run([use("t1", "bad"), done], {
      continueAfterFailure: (call, r) => { seen.push(`${call.name}:${r.error?.code}`); return false; },
    });
    expect(seen).toEqual(["bad:INVALID_EDIT"]);
    expect(result.committed).toBe(false);
  });

  it("keeps the turn when the user rejects a step and the caller allows it", async () => {
    const options = { requiresConfirmation: () => true, confirmGate: () => "reject" as const };
    expect((await run([use("t1", "good"), done], options)).committed).toBe(false);
    const result = await run([use("t1", "good"), done], { ...options, continueAfterFailure: (_call, r) => r.error?.code === "REJECTED" });
    expect(result).toMatchObject({ committed: true, text: "Done" });
    expect(toolResults(result.messages)[0]).toMatchObject({ toolUseId: "t1", isError: true });
  });
});
