import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  insert: vi.fn(async (_rows: unknown[]) => ({ error: null as null | { message: string } })),
  signedIn: true,
}));
vi.mock("./session", () => ({
  hawshClient: () => (h.signedIn ? { from: (table: string) => ({ insert: (rows: unknown[]) => { expect(table).toBe("editor_logs"); return h.insert(rows); } }) } : null),
  useHawshStore: { subscribe: vi.fn() },
}));

import { clip, flushLogs, logAssistantTurn, logError, logEvent, pendingLogs } from "./logger";

const sent = () => h.insert.mock.calls.flatMap(([rows]) => rows as Array<{ kind: string; data: Record<string, unknown>; session_id: string }>);

describe("logger", () => {
  beforeEach(async () => {
    h.signedIn = true;
    await flushLogs();
    h.insert.mockClear();
  });

  it("sends queued rows in one batch with the session id", async () => {
    logEvent("usage", { event: "project_created" });
    logAssistantTurn({ phase: "plan", request: "قص", reply: "خطة", toolCalls: [{ name: "list_clips", status: "done" }], steps: 1, points: 0.1, stoppedReason: "end_turn", committed: true, durationMs: 900 });
    await flushLogs();
    expect(h.insert).toHaveBeenCalledTimes(1);
    const rows = sent();
    expect(rows.map((r) => r.kind)).toEqual(["usage", "assistant"]);
    expect(rows[1].data).toMatchObject({ phase: "plan", request: "قص", steps: 1, points: 0.1 });
    expect(rows[0].session_id).toBe(rows[1].session_id);
    expect(pendingLogs()).toHaveLength(0);
  });

  it("keeps rows while signed out and sends them after sign-in", async () => {
    h.signedIn = false;
    logEvent("usage", { event: "project_opened" });
    await flushLogs();
    expect(h.insert).not.toHaveBeenCalled();
    h.signedIn = true;
    await flushLogs();
    expect(sent().map((r) => r.data.event)).toEqual(["project_opened"]);
  });

  it("drops a batch the server refuses instead of retrying forever", async () => {
    h.insert.mockResolvedValueOnce({ error: { message: "relation does not exist" } });
    logEvent("usage", { event: "x" });
    await flushLogs();
    expect(pendingLogs()).toHaveLength(0);
  });

  it("records the same error only a few times, and skips noise", async () => {
    for (let i = 0; i < 5; i++) logError("window", new Error("boom"));
    logError("window", new Error("ResizeObserver loop limit exceeded"));
    logError("promise", new DOMException("stopped", "AbortError"));
    await flushLogs();
    const errors = sent().filter((r) => r.kind === "error");
    expect(errors).toHaveLength(3);
    expect(errors[0].data).toMatchObject({ source: "window", name: "Error", message: "boom" });
  });

  it("shortens long text so a row stays small", () => {
    const long = "x".repeat(5000);
    expect((clip({ a: long, b: [long] }) as { a: string; b: string[] }).a).toHaveLength(2001);
    expect((clip({ b: [long] }) as { b: string[] }).b[0].endsWith("…")).toBe(true);
  });
});
