import { describe, expect, it } from "vitest";
import type { EditingHost, ToolCall, ToolResult } from "@openreel/agent";
import { forgivingExecutor, MAX_FORGIVEN_FAILURES } from "./assistant-recovery";

const call: ToolCall = { id: "1", name: "trim_clip", args: {} };
const failed = (extra: Record<string, unknown> = {}): ToolResult => ({ ok: false, summary: "Edit rejected", error: { code: "INVALID_EDIT", message: "Clip ID was not found", ...extra } });

/** A draft whose timeline the "tool" can change. */
function draft() {
  const project = { name: "p", timeline: { tracks: [] as string[] }, mediaLibrary: { items: [] } };
  return { project, host: { getProject: () => project } as unknown as EditingHost };
}

describe("forgivingExecutor", () => {
  it("lets the turn continue after a failed call that changed nothing, and tells the model what to do", async () => {
    const { host } = draft();
    const forgiving = forgivingExecutor(async () => failed(), () => false);
    const result = await forgiving.execute("trim_clip", {}, host);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/^Clip ID was not found\. Nothing was changed by this call\./);
    expect(forgiving.continueAfterFailure(call, result)).toBe(true);
  });

  it("ends the turn when a failed call left the draft changed", async () => {
    const { project, host } = draft();
    const forgiving = forgivingExecutor(async () => { project.timeline.tracks.push("half-done"); return failed(); }, () => false);
    const result = await forgiving.execute("cut_silence", {}, host);
    expect(result.error?.message).toBe("Clip ID was not found");
    expect(forgiving.continueAfterFailure(call, result)).toBe(false);
  });

  it("always forgives a failed read-only call", async () => {
    const { host } = draft();
    const forgiving = forgivingExecutor(async () => failed(), () => true);
    expect(forgiving.continueAfterFailure(call, await forgiving.execute("get_clip", {}, host))).toBe(true);
  });

  it("stops forgiving once the model keeps failing", async () => {
    const { host } = draft();
    const forgiving = forgivingExecutor(async () => failed(), () => false);
    for (let i = 0; i < MAX_FORGIVEN_FAILURES; i++) {
      expect(forgiving.continueAfterFailure(call, await forgiving.execute("trim_clip", {}, host))).toBe(true);
    }
    expect(forgiving.continueAfterFailure(call, await forgiving.execute("trim_clip", {}, host))).toBe(false);
  });

  it("leaves the loop's own correction path (retryOf) alone", async () => {
    const { host } = draft();
    const forgiving = forgivingExecutor(async () => failed({ recoverable: true }), () => false);
    const result = await forgiving.execute("add_transition", {}, host);
    expect(result.error?.message).toBe("Clip ID was not found");
    expect(forgiving.continueAfterFailure(call, result)).toBe(false);
  });

  it("continues after the user rejects a step on the confirmation card", () => {
    const forgiving = forgivingExecutor(async () => failed(), () => false);
    const rejected: ToolResult = { ok: false, summary: "Rejected by user", error: { code: "REJECTED", message: "User rejected this action" } };
    expect(forgiving.continueAfterFailure(call, rejected)).toBe(true);
  });

  it("adds the note to results, and a forgiven failure stays forgiven", async () => {
    const { host } = draft();
    let note: string | undefined = undefined;
    let next: ToolResult = { ok: true, summary: "Trimmed" };
    const forgiving = forgivingExecutor(async () => next, () => false, () => note);
    expect((await forgiving.execute("trim_clip", {}, host)).summary).toBe("Trimmed");
    note = "Step budget: 1 left.";
    expect((await forgiving.execute("trim_clip", {}, host)).summary).toBe("Trimmed Step budget: 1 left.");
    next = failed();
    const result = await forgiving.execute("trim_clip", {}, host);
    expect(result.summary).toBe("Edit rejected Step budget: 1 left.");
    expect(forgiving.continueAfterFailure(call, result)).toBe(true);
  });
});
