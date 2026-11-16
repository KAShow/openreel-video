import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RunTurnInput, RunTurnResult } from "@openreel/agent";

const h = vi.hoisted(() => ({
  runTurn: vi.fn(),
  connection: { provider: "compatible", model: "account-tool-model", baseUrl: "https://hawsh.test/functions/v1/editor-ai", apiKey: "" },
  toOpenAITools: vi.fn((_names: Iterable<string>) => []),
  getTool: vi.fn((_name: string): { domain: string } => ({ domain: "read" })),
  selectToolsForPrompt: vi.fn((_context: string): string[] => []),
  getSecret: vi.fn(async () => "test-key"),
  isSessionUnlocked: vi.fn(() => true),
  makeBYOKClient: vi.fn(() => ({ complete: vi.fn() })),
  // Each complete() stands for one model call the server charged (makeHawshAIClient's onCharged).
  makeHawshClient: vi.fn((_signal?: AbortSignal, onCharged?: () => void) => ({
    complete: vi.fn(async () => { onCharged?.(); return { text: "", toolUses: [], stopReason: "end_turn" as const }; }),
  })),
  undo: vi.fn(async () => ({ success: true })),
  projectState: { hasOpenProject: true, projectId: "project-a" },
  undoStackSize: 0,
  transcribePoints: 0,
  logTurn: vi.fn(),
  settings: {
    defaultLlmProvider: "openai-compatible" as string | null,
    llmBaseUrl: "https://gateway.example/v1",
    llmModel: "account-tool-model",
    configuredServices: ["openai-compatible"] as string[],
    agentAutoConfirm: false,
    agentDryRun: false,
  },
}));

vi.mock("@openreel/agent", () => ({
  runTurn: h.runTurn,
  toAnthropicTools: () => [],
  toOpenAITools: h.toOpenAITools,
  buildSystemPrompt: () => "system",
  getTool: h.getTool,
  selectToolsForPrompt: h.selectToolsForPrompt,
}));

vi.mock("../services/secure-storage", () => ({
  isSessionUnlocked: h.isSessionUnlocked,
  getSecret: h.getSecret,
}));

vi.mock("../services/agent/live-host", () => ({
  LiveEditorHost: class {},
}));

vi.mock("../services/agent/direct-llm-transport", () => ({ makeDirectBYOKClient: h.makeBYOKClient, validateAIEndpoint: (url: string) => url.replace(/\/(chat\/completions|messages)\/?$/, "").replace(/\/+$/, "") }));
vi.mock("../hawsh/ai", () => ({
  HAWSH_AI_ONLY_MESSAGE: "المونتاج الذكي يعمل فقط برصيد عيون المخرج",
  isHawshAI: (url: string) => url.replace(/\/+$/, "") === "https://hawsh.test/functions/v1/editor-ai",
  makeHawshAIClient: h.makeHawshClient,
}));
vi.mock("../services/agent/editing-session", () => ({ EditingSession: class { committed = true; } }));
vi.mock("../services/agent/editing-tools", () => ({ editingToolDefs: () => [{ type: "function", function: { name: "list_clips" } }, { type: "function", function: { name: "trim_clip" } }], editingToolReadOnly: (name: string) => name.startsWith("list_"), editingToolNeedsConfirm: (name: string) => name === "transcribe_clip", executeEditingTool: vi.fn(), EDITING_SYSTEM: "system" }));
vi.mock("../hawsh/assistant-prompt", () => ({ assistantSystem: (project: { id: string }, ui: { playheadSec?: number; selectedIds?: string[] }, phase = "direct") => `system for ${project.id} at ${ui.playheadSec}s, selected: ${ui.selectedIds?.join(",")}${phase === "direct" ? "" : `, ${phase}`}` }));
vi.mock("../hawsh/logger", () => ({ logAssistantTurn: h.logTurn }));
vi.mock("./timeline-store", () => ({ useTimelineStore: { getState: () => ({ playheadPosition: 4 }) } }));
vi.mock("./ui-store", () => ({ useUIStore: { getState: () => ({ selectedItems: [{ type: "clip", id: "clip-1" }] }) } }));
vi.mock("../hawsh/transcribe-tool", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hawsh/transcribe-tool")>()),
  transcribePointsCharged: () => h.transcribePoints,
}));
vi.mock("./ai-connection-store",() => ({ useAIConnectionStore: { getState: () => h.connection } }));

vi.mock("./settings-store", () => ({
  useSettingsStore: {
    getState: () => h.settings,
  },
}));

vi.mock("./project-store", () => ({
  useProjectStore: {
    getState: () => ({
      hasOpenProject: h.projectState.hasOpenProject,
      project: { id: h.projectState.projectId },
      getFullProject: () => ({ id: h.projectState.projectId, name: "p", timeline: { tracks: [] }, mediaLibrary: { items: [] } }),
      undo: h.undo,
      actionExecutor: {
        getHistory: () => ({ getUndoStackSize: () => h.undoStackSize }),
      },
    }),
  },
}));

import { useChatStore } from "./chat-store";
import { useChatHistoryStore } from "./chat-history-store";

type RunTurnImpl = (input: RunTurnInput) => Promise<RunTurnResult>;
type RunTurnImplLoose = (
  input: RunTurnInput,
) => Promise<Omit<RunTurnResult, "usage"> & Partial<Pick<RunTurnResult, "usage">>>;
const impl = (fn: RunTurnImplLoose): RunTurnImpl => async (input) => {
  const result = await fn(input);
  return { usage: { inputTokens: 0, outputTokens: 0 }, ...result };
};

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const store = () => useChatStore.getState();

describe("chat-store", () => {
  beforeEach(() => {
    store().reset();
    // Most tests drive edits directly; chat mode (the default) has its own tests below.
    store().setMode("direct");
    useChatHistoryStore.getState().clearHistory();
    vi.clearAllMocks();
    h.getSecret.mockResolvedValue("test-key");
    h.isSessionUnlocked.mockReturnValue(true);
    h.undo.mockResolvedValue({ success: true });
    h.projectState.hasOpenProject = true;
    h.projectState.projectId = "project-a";
    Object.assign(h.connection, { provider: "compatible", model: "account-tool-model", baseUrl: "https://hawsh.test/functions/v1/editor-ai", apiKey: "" });
    h.connection.provider = "compatible";
    h.connection.model = "account-tool-model";
    h.settings.configuredServices = ["openai-compatible"];
    h.settings.agentAutoConfirm = false;
    h.settings.agentDryRun = false;
    h.undoStackSize = 0;
    h.getTool.mockImplementation((_name: string) => ({ domain: "read" }));
    h.selectToolsForPrompt.mockReturnValue([]);
  });

  it("refuses to run without an open project", async () => {
    h.projectState.hasOpenProject = false;
    await store().send("hello");
    expect(h.runTurn).not.toHaveBeenCalled();
    expect(store().error).toContain("افتح مشروعاً");
    expect(store().status).toBe("idle");
  });

  it("refuses any connection other than Director's Eyes points", async () => {
    Object.assign(h.connection, { provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o", apiKey: "sk-own" });
    await store().send("hello");
    expect(h.runTurn).not.toHaveBeenCalled();
    expect(h.makeHawshClient).not.toHaveBeenCalled();
    expect(store().error).toMatch(/عيون المخرج/);
  });

  it("runs on Director's Eyes points without a key", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({ text: "ok", messages, toolCalls: 0, stoppedReason: "end_turn", committed: true })),
    );
    await store().send("hello");
    expect(h.makeHawshClient).toHaveBeenCalledOnce();
    expect(h.makeBYOKClient).not.toHaveBeenCalled();
    expect(h.runTurn).toHaveBeenCalledOnce();
  });

  describe("points a request consumed", () => {
    const steps = async (llm: RunTurnInput["llm"], n: number): Promise<void> => {
      for (let i = 0; i < n; i++) await llm.complete({ messages: [], tools: [] });
    };

    it("puts the charged steps and points on the assistant message, not in the conversation", async () => {
      h.runTurn.mockImplementation(impl(async ({ llm, messages }) => {
        await steps(llm, 3);
        return { text: "Done", messages: [...messages, { role: "assistant", content: "Done", toolUses: [] }], toolCalls: 2, stoppedReason: "end_turn", committed: true };
      }));
      await store().send("trim the intro");
      expect(store().messages.at(-1)?.cost).toEqual({ steps: 3, points: 0.3 });
      expect(store().messages[0].cost).toBeUndefined();
      expect(JSON.stringify(store().conversation)).not.toContain("points");
      expect(useChatHistoryStore.getState().conversations[0].messages.at(-1)?.cost).toEqual({ steps: 3, points: 0.3 });
    });

    it("shows nothing when no step was charged", async () => {
      h.runTurn.mockImplementation(impl(async ({ messages }) => ({ text: "ok", messages, toolCalls: 0, stoppedReason: "end_turn", committed: true })));
      await store().send("hello");
      expect(store().messages.at(-1)?.cost).toBeUndefined();
    });

    it("counts each turn on its own", async () => {
      h.runTurn
        .mockImplementationOnce(impl(async ({ llm, messages }) => { await steps(llm, 2); return { text: "a", messages, toolCalls: 0, stoppedReason: "end_turn", committed: true }; }))
        .mockImplementationOnce(impl(async ({ llm, messages }) => { await steps(llm, 1); return { text: "b", messages, toolCalls: 0, stoppedReason: "end_turn", committed: true }; }));
      await store().send("one");
      await store().send("two");
      const costs = store().messages.filter((m) => m.role === "assistant").map((m) => m.cost);
      expect(costs).toEqual([{ steps: 2, points: 0.2 }, { steps: 1, points: 0.1 }]);
    });

    it("still shows the cost of a failed or thrown turn", async () => {
      h.runTurn.mockImplementationOnce(impl(async ({ llm, messages }) => {
        await steps(llm, 2);
        return { text: "", messages, toolCalls: 1, stoppedReason: "error", committed: false };
      }));
      await store().send("break it");
      expect(store().messages.at(-1)?.cost).toEqual({ steps: 2, points: 0.2 });

      h.runTurn.mockImplementationOnce(async ({ llm }: RunTurnInput) => {
        await steps(llm, 1);
        throw new Error("provider unavailable");
      });
      await store().send("again");
      expect(store().status).toBe("error");
      expect(store().messages.at(-1)?.cost).toEqual({ steps: 1, points: 0.1 });
    });

    it("still shows the cost of a cancelled turn", async () => {
      h.runTurn.mockImplementation(impl(async ({ llm, confirmGate, messages }) => {
        await steps(llm, 1);
        await confirmGate!({ id: "t1", name: "deleteClip", args: {} });
        return { text: "", messages, toolCalls: 1, stoppedReason: "error", committed: false };
      }));
      const pending = store().send("delete it");
      await flush();
      store().stop();
      await pending;
      expect(store().messages.at(-1)?.text).toContain("أُلغي الطلب");
      expect(store().messages.at(-1)?.cost).toEqual({ steps: 1, points: 0.1 });
    });
  });

  it("ignores empty input", async () => {
    await store().send("   ");
    expect(h.runTurn).not.toHaveBeenCalled();
    expect(store().messages).toHaveLength(0);
  });

  it("runs a turn and records user + assistant messages", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ onEvent, messages }) => {
        onEvent?.({ type: "text_delta", text: "working" });
        onEvent?.({ type: "turn_complete", text: "Done!" });
        return {
          text: "Done!",
          messages: [
            ...messages,
            { role: "assistant", content: "Done!", toolUses: [] },
          ],
          toolCalls: 0,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    await store().send("hello");
    const st = store();
    expect(st.status).toBe("idle");
    expect(st.lastTurnCommitted).toBe(true);
    expect(st.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(st.messages[0].text).toBe("hello");
    expect(st.messages[1].text).toBe("Done!");
    expect(st.conversation.at(-1)).toEqual({
      role: "assistant",
      content: "Done!",
      toolUses: [],
    });
  });

  describe("chat mode: a plan first, edits only after the user confirms", () => {
    const toolNames = (input: RunTurnInput) => (input.tools as Array<{ function?: { name: string }; name?: string }>).map((t) => t.function?.name ?? t.name);

    it("is the default, and a plan request offers only read-only tools and never edits", async () => {
      localStorage.removeItem("hawsh:assistant-mode");
      store().setMode("chat");
      h.runTurn.mockImplementation(impl(async ({ messages, execute }) => {
        const edit = await execute!("trim_clip", { clipId: "c1" }, { getProject: () => ({ name: "p", timeline: { tracks: [] }, mediaLibrary: { items: [] } }) } as never);
        expect(edit).toMatchObject({ ok: false, error: { code: "PLAN_ONLY" } });
        return { text: "سأقص آخر ثانيتين من المقطع الأول.\n1. قص من 8 إلى 10 ثوانٍ\n[[RUN]]", messages: [...messages, { role: "assistant", content: "plan", toolUses: [] }], toolCalls: 1, stoppedReason: "end_turn", committed: true };
      }));
      await store().send("قص آخر ثانيتين");
      const input = h.runTurn.mock.calls[0][0] as RunTurnInput;
      expect(input.system).toContain(", plan");
      expect(toolNames(input)).toEqual(["list_clips"]);
      const reply = store().messages.at(-1)!;
      expect(reply).toMatchObject({ role: "assistant", plan: true, text: "سأقص آخر ثانيتين من المقطع الأول.\n1. قص من 8 إلى 10 ثوانٍ" });
      expect(h.logTurn).toHaveBeenCalledWith(expect.objectContaining({ phase: "plan", request: "قص آخر ثانيتين", plan: true, committed: true }));
    });

    it("carries the plan out with one button, with all tools", async () => {
      store().setMode("chat");
      h.runTurn.mockImplementationOnce(impl(async () => ({ text: "الخطة…\n[[RUN]]", messages: [], toolCalls: 0, stoppedReason: "end_turn", committed: true })));
      await store().send("قص آخر ثانيتين");
      h.runTurn.mockImplementationOnce(impl(async () => ({ text: "قصصت ثانيتين.", messages: [], toolCalls: 1, stoppedReason: "end_turn", committed: true })));
      await store().runPlan();
      const input = h.runTurn.mock.calls[1][0] as RunTurnInput;
      expect(input.system).toContain(", execute");
      expect(input.messages.at(-1)).toEqual({ role: "user", content: "نفّذ الخطة" });
      expect(input.messages.at(-2)).toEqual({ role: "assistant", content: "الخطة…", toolUses: [] });
      expect(store().messages.map((m) => [m.role, m.text, !!m.plan])).toEqual([
        ["user", "قص آخر ثانيتين", false], ["assistant", "الخطة…", false],
        ["user", "نفّذ الخطة", false], ["assistant", "قصصت ثانيتين.", false],
      ]);
    });

    it("does nothing when there is no plan waiting", async () => {
      store().setMode("chat");
      h.runTurn.mockImplementationOnce(impl(async () => ({ text: "أستطيع القص والترجمة…", messages: [], toolCalls: 0, stoppedReason: "end_turn", committed: true })));
      await store().send("وش تقدر تسوي؟");
      expect(store().messages.at(-1)?.plan).toBeUndefined();
      await store().runPlan();
      expect(h.runTurn).toHaveBeenCalledTimes(1);
    });

    it("drops an old plan's button once the user asks something else", async () => {
      store().setMode("chat");
      h.runTurn.mockImplementation(impl(async () => ({ text: "خطة\n[[RUN]]", messages: [], toolCalls: 0, stoppedReason: "end_turn", committed: true })));
      await store().send("قص");
      await store().send("لا، قص ثلاث ثوانٍ");
      expect(store().messages.filter((m) => m.plan)).toHaveLength(1);
      expect(store().messages.at(-1)?.plan).toBe(true);
    });

    it("remembers the chosen mode", () => {
      store().setMode("direct");
      expect(localStorage.getItem("hawsh:assistant-mode")).toBe("direct");
      store().setMode("chat");
      expect(localStorage.getItem("hawsh:assistant-mode")).toBe("chat");
    });
  });

  describe("what the model is given", () => {
    const committed = (text: string) => impl(async ({ messages }) => ({
      text,
      // The loop's own transcript, with tool chatter the next request must not carry.
      messages: [...messages, { role: "assistant", content: "", toolUses: [{ id: "t1", name: "list_clips", input: {} }] }, { role: "tool", results: [{ toolUseId: "t1", content: "{\"clips\":[\"stale-id\"]}", isError: false }] }, { role: "assistant", content: text, toolUses: [] }],
      toolCalls: 1, stoppedReason: "end_turn", committed: true,
    }));

    it("sends the project as it is now, the selection, and the limits that keep a turn alive", async () => {
      h.runTurn.mockImplementation(committed("تم"));
      await store().send("قص البداية");
      const input = h.runTurn.mock.calls[0][0] as RunTurnInput;
      expect(input.system).toBe("system for project-a at 4s, selected: clip-1");
      expect(input.limits).toEqual({ maxSteps: 16 });
      expect(input.atomic).toBe(true);
      // A rejected confirmation skips the step instead of discarding the turn.
      expect(input.continueAfterFailure?.({ id: "c", name: "transcribe_clip", args: {} }, { ok: false, summary: "Rejected by user", error: { code: "REJECTED", message: "User rejected this action" } })).toBe(true);
      expect(input.continueAfterFailure?.({ id: "c", name: "trim_clip", args: {} }, { ok: false, summary: "failed", error: { code: "INVALID_EDIT", message: "changed the draft" } })).toBe(false);
    });

    it("carries the conversation as words only, without old tool calls and results", async () => {
      h.runTurn.mockImplementation(committed("قصصت ثانيتين من البداية."));
      await store().send("قص البداية");
      await store().send("وأضف عنواناً");
      const second = h.runTurn.mock.calls[1][0] as RunTurnInput;
      expect(second.messages).toEqual([
        { role: "user", content: "قص البداية" },
        { role: "assistant", content: "قصصت ثانيتين من البداية.", toolUses: [] },
        { role: "user", content: "وأضف عنواناً" },
      ]);
      expect(JSON.stringify(store().conversation)).not.toContain("stale-id");
    });

    it("remembers the conversation after a turn that failed", async () => {
      h.runTurn.mockImplementationOnce(committed("قصصت ثانيتين من البداية."));
      await store().send("قص البداية");
      h.runTurn.mockImplementationOnce(impl(async () => ({ text: "", messages: [], toolCalls: 1, stoppedReason: "error", committed: false })));
      await store().send("أضف انتقالاً");
      h.runTurn.mockImplementationOnce(committed("تم"));
      await store().send("حاول مرة أخرى");
      const third = h.runTurn.mock.calls[2][0] as RunTurnInput;
      expect(third.messages.map((m) => [m.role, m.role === "tool" ? "" : m.content])).toEqual([
        ["user", "قص البداية"],
        ["assistant", "قصصت ثانيتين من البداية."],
        ["user", "أضف انتقالاً"],
        ["assistant", "تعذّر إكمال الطلب، ولم يُطبَّق أي تعديل."],
        ["user", "حاول مرة أخرى"],
      ]);
    });

    it("remembers the conversation after a request the server refused", async () => {
      h.runTurn.mockImplementationOnce(committed("تم القص."));
      await store().send("قص البداية");
      h.runTurn.mockImplementationOnce(async () => { throw new Error("رصيد النقاط لا يكفي"); });
      await store().send("أضف عنواناً");
      expect(store().conversation.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    });

    it("keeps only the latest messages, starting from a user message", async () => {
      h.runTurn.mockImplementation(committed("تم"));
      for (let i = 0; i < 12; i++) await store().send(`طلب ${i}`);
      const last = h.runTurn.mock.calls.at(-1)![0] as RunTurnInput;
      expect(last.messages).toHaveLength(17); // 16 earlier messages and the new request
      expect(last.messages[0]).toEqual({ role: "user", content: "طلب 3" });
      expect(last.messages.at(-1)).toEqual({ role: "user", content: "طلب 11" });
    });
  });

  it("saves completed conversations and starts a fresh chat", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "Done!",
        messages,
        toolCalls: 0,
        stoppedReason: "end_turn",
        committed: true,
      })),
    );

    await store().send("Create an opening title");
    const saved = useChatHistoryStore.getState().conversations[0];
    expect(saved).toMatchObject({
      projectId: "project-a",
      title: "Create an opening title",
    });

    store().newChat();

    expect(store().messages).toEqual([]);
    expect(store().currentConversationId).toBeNull();
    expect(useChatHistoryStore.getState().conversations[0].id).toBe(saved.id);
  });

  it("opens a saved conversation for viewing and follow-up", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "Done!",
        messages,
        toolCalls: 0,
        stoppedReason: "end_turn",
        committed: true,
      })),
    );
    await store().send("Fix the intro");
    const savedId = useChatHistoryStore.getState().conversations[0].id;
    store().newChat();

    store().openConversation(savedId);

    expect(store().currentConversationId).toBe(savedId);
    expect(store().messages[0].text).toBe("Fix the intro");
    expect(store().conversation[0]).toEqual({
      role: "user",
      content: "Fix the intro",
    });
  });

  it("uses the final result text even when an adapter emits no text event", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "## Finished\n\n- Updated the intro",
        messages,
        toolCalls: 0,
        stoppedReason: "end_turn",
        committed: true,
      })),
    );

    await store().send("update intro");

    expect(store().messages.at(-1)?.text).toBe("## Finished\n\n- Updated the intro");
  });

  it("explains empty model replies and output-limit stops", async () => {
    h.runTurn
      .mockImplementationOnce(
        impl(async ({ messages }) => ({
          text: "",
          messages,
          toolCalls: 0,
          stoppedReason: "end_turn",
          committed: true,
        })),
      )
      .mockImplementationOnce(
        impl(async ({ messages }) => ({
          text: "Partial",
          messages,
          toolCalls: 0,
          stoppedReason: "budget",
          committed: true,
        })),
      );

    await store().send("first");
    expect(store().messages.at(-1)?.notice).toContain("ردّاً فارغاً");

    await store().send("second");
    expect(store().messages.at(-1)?.text).toBe("Partial");
    expect(store().messages.at(-1)?.notice).toContain("حدّ الردّ أو حدّ الرموز");
  });

  it("blocks a compatible provider until endpoint and model are configured", async () => {
    Object.assign(h.connection, { provider: "compatible", model: "account-tool-model", baseUrl: "https://hawsh.test/functions/v1/editor-ai", apiKey: "" });
    h.connection.provider = "compatible";
    h.connection.model = "";

    await store().send("hello");

    expect(h.runTurn).not.toHaveBeenCalled();
    expect(store().error).toContain("معرّف النموذج");
  });

  it("requires the user to choose an API format", async () => {
    h.connection.provider = "";

    await store().send("hello");

    expect(h.runTurn).not.toHaveBeenCalled();
    expect(store().error).toContain("صيغة الواجهة");
  });

  it("clears the conversation when the open project changes", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "ok",
        messages,
        toolCalls: 0,
        stoppedReason: "end_turn",
        committed: true,
      })),
    );
    store().setProjectContext("project-a");
    await store().send("edit project A");
    expect(store().messages.length).toBeGreaterThan(0);

    store().setProjectContext("project-b");

    expect(store().projectId).toBe("project-b");
    expect(store().messages).toHaveLength(0);
    expect(store().conversation).toHaveLength(0);
  });

  it("returns to an actionable error state when a turn throws", async () => {
    h.runTurn.mockRejectedValue(new Error("provider unavailable"));

    await store().send("hello");

    expect(store().status).toBe("error");
    expect(store().error).toBe("provider unavailable");
    expect(store().abortController).toBeNull();
  });

  it("accumulates token usage across turns", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "ok",
        messages,
        toolCalls: 0,
        stoppedReason: "end_turn",
        committed: true,
        usage: { inputTokens: 100, outputTokens: 40 },
      })),
    );

    await store().send("one");
    await store().send("two");

    expect(store().usage).toEqual({ inputTokens: 200, outputTokens: 80 });
  });

  it("reflects tool calls and results on the assistant message", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ onEvent }) => {
        const call = { id: "t1", name: "addTextClip", args: { text: "Hi" } };
        onEvent?.({ type: "tool_call", call });
        onEvent?.({
          type: "tool_result",
          call,
          result: { ok: true, summary: "Added text" },
        });
        onEvent?.({ type: "turn_complete", text: "Added." });
        return {
          text: "Added.",
          messages: [],
          toolCalls: 1,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    await store().send("add text");
    const assistant = store().messages.find((m) => m.role === "assistant");
    expect(assistant?.toolCalls).toHaveLength(1);
    expect(assistant?.toolCalls[0].status).toBe("done");
    expect(assistant?.toolCalls[0].result?.summary).toBe("Added text");
  });

  it("marks rejected tool results distinctly from errors", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ onEvent }) => {
        const call = { id: "t1", name: "deleteClip", args: {} };
        onEvent?.({ type: "tool_call", call });
        onEvent?.({
          type: "tool_result",
          call,
          result: {
            ok: false,
            summary: "Rejected by user",
            error: { code: "REJECTED", message: "User rejected this action" },
          },
        });
        return {
          text: "",
          messages: [],
          toolCalls: 1,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    await store().send("delete");
    const assistant = store().messages.find((m) => m.role === "assistant");
    expect(assistant?.toolCalls[0].status).toBe("rejected");
  });

  it("shows recoverable transition calls as corrected after a successful retry", async () => {
    h.runTurn.mockImplementation(impl(async ({ onEvent }) => {
      const call = { id: "bad", name: "add_transition", args: {} };
      onEvent?.({ type: "tool_call", call });
      onEvent?.({ type: "tool_result", call, result: { ok: false, summary: "Needs correction", error: { code: "BAD_PAIR", message: "Choose adjacent clips", recoverable: true, retryOf: "bad" } } });
      expect(store().messages.at(-1)?.toolCalls[0].status).toBe("retrying");
      onEvent?.({ type: "tool_recovered", callIds: ["bad"], repairedBy: "fixed" });
      return { text: "Transition added.", messages: [], toolCalls: 2, stoppedReason: "end_turn", committed: true };
    }));
    await store().send("add transition");
    expect(store().status).toBe("idle");
    expect(store().error).toBeNull();
    expect(store().messages.at(-1)?.toolCalls[0].status).toBe("corrected");
  });

  it("marks an unresolved correction as failed when the turn rolls back", async () => {
    h.runTurn.mockImplementation(impl(async ({ onEvent }) => {
      const call = { id: "bad", name: "add_transition", args: {} };
      onEvent?.({ type: "tool_call", call });
      onEvent?.({ type: "tool_result", call, result: { ok: false, summary: "Needs correction", error: { code: "BAD_PAIR", message: "Choose adjacent clips", recoverable: true, retryOf: "bad" } } });
      return { text: "", messages: [], toolCalls: 1, stoppedReason: "error", committed: false };
    }));
    await store().send("add transition");
    expect(store().messages.at(-1)?.toolCalls[0].status).toBe("error");
    expect(store().messages.at(-1)?.text).toContain("ولم يُطبَّق أي تعديل");
  });

  it("gates destructive calls through pendingConfirm", async () => {
    let decision: string | undefined;
    h.runTurn.mockImplementation(
      impl(async ({ onEvent, confirmGate }) => {
        const call = { id: "t1", name: "deleteClip", args: {} };
        onEvent?.({ type: "tool_call", call });
        decision = await confirmGate!(call);
        onEvent?.({
          type: "tool_result",
          call,
          result: { ok: true, summary: "Deleted" },
        });
        return {
          text: "ok",
          messages: [],
          toolCalls: 1,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    const pending = store().send("delete clip");
    await flush();
    expect(store().status).toBe("awaiting_confirm");
    expect(store().pendingConfirm?.call.name).toBe("deleteClip");

    store().resolveConfirm("approve");
    await pending;

    expect(decision).toBe("approve");
    expect(store().status).toBe("idle");
    expect(store().pendingConfirm).toBeNull();
  });

  it("routes paid transcription through the confirm card with a points note", async () => {
    let decision: string | undefined;
    let needsConfirm: boolean | undefined;
    h.runTurn.mockImplementation(impl(async ({ confirmGate, requiresConfirmation }) => {
      needsConfirm = requiresConfirmation?.("transcribe_clip");
      decision = await confirmGate!({ id: "t1", name: "transcribe_clip", args: { clipId: "c1" } });
      return { text: "ok", messages: [], toolCalls: 1, stoppedReason: "end_turn", committed: true };
    }));
    const pending = store().send("ضع كابشن للفيديو");
    await flush();
    expect(needsConfirm).toBe(true);
    expect(store().status).toBe("awaiting_confirm");
    expect(store().pendingConfirm?.note).toContain("نقاط عيون المخرج");
    store().resolveConfirm("approve");
    await pending;
    expect(decision).toBe("approve");
  });

  it("tells the user when a discarded turn already spent transcription points", async () => {
    h.transcribePoints = 5; // spent in earlier turns: not this turn's
    h.runTurn.mockImplementation(impl(async ({ onEvent }) => {
      const call = { id: "t1", name: "transcribe_clip", args: { clipId: "c1" } };
      onEvent?.({ type: "tool_call", call });
      h.transcribePoints += 2; // the server charged, then the commit failed
      onEvent?.({ type: "error", error: { code: "LOOP_ERROR", message: "The project changed while the AI was working." } });
      return { text: "", messages: [], toolCalls: 1, stoppedReason: "error", committed: false };
    }));
    await store().send("ضع كابشن للفيديو");
    expect(store().messages.at(-1)?.notice).toContain("خُصم 2 نقطة");
    expect(store().messages.at(-1)?.text).toContain("ولم يُطبَّق أي تعديل");

    // A discarded turn that spent nothing gets no notice.
    h.runTurn.mockImplementation(impl(async () => ({ text: "", messages: [], toolCalls: 0, stoppedReason: "error", committed: false })));
    await store().send("مرة أخرى");
    expect(store().messages.at(-1)?.notice).toBeUndefined();
  });

  it("also tells the user when the turn throws after transcription points were spent", async () => {
    h.transcribePoints = 0;
    h.runTurn.mockImplementation(impl(async () => {
      h.transcribePoints += 3; // the server charged, then the loop threw
      throw new Error("boom");
    }));
    await store().send("ضع كابشن للفيديو");
    expect(store().messages.at(-1)?.notice).toContain("خُصم 3 نقطة");
  });

  it("stop() rejects a pending confirmation", async () => {
    let decision: string | undefined;
    h.runTurn.mockImplementation(
      impl(async ({ confirmGate }) => {
        decision = await confirmGate!({
          id: "t1",
          name: "deleteClip",
          args: {},
        });
        return {
          text: "",
          messages: [],
          toolCalls: 1,
          stoppedReason: "end_turn",
          committed: false,
        };
      }),
    );

    const pending = store().send("delete");
    await flush();
    expect(store().status).toBe("awaiting_confirm");

    store().stop();
    await pending;

    expect(decision).toBe("reject");
    expect(store().pendingConfirm).toBeNull();
  });

  it("undoLastTurn undoes once and clears the committed flag", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "",
        messages,
        toolCalls: 0,
        stoppedReason: "end_turn",
        committed: true,
      })),
    );

    await store().send("do something");
    expect(store().lastTurnCommitted).toBe(true);

    await store().undoLastTurn();
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(store().lastTurnCommitted).toBe(false);

    await store().undoLastTurn();
    expect(h.undo).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error result as error status", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ onEvent, messages }) => {
        onEvent?.({
          type: "error",
          error: { code: "LOOP_ERROR", message: "boom" },
        });
        return {
          text: "",
          messages,
          toolCalls: 0,
          stoppedReason: "error",
          committed: false,
        };
      }),
    );

    await store().send("break it");
    expect(store().status).toBe("error");
    expect(store().error).toBe("boom");
    expect(store().lastTurnCommitted).toBe(false);
  });

  it("auto-approves destructive calls when the policy is on (no confirm UI)", async () => {
    h.settings.agentAutoConfirm = true;
    let decision: string | undefined;
    h.runTurn.mockImplementation(
      impl(async ({ confirmGate }) => {
        decision = await confirmGate!({ id: "t1", name: "deleteClip", args: {} });
        return {
          text: "ok",
          messages: [],
          toolCalls: 1,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    await store().send("delete it");
    expect(decision).toBe("approve_for_turn");
    expect(store().pendingConfirm).toBeNull();
    expect(store().status).toBe("idle");
  });

  it("passes dryRun to runTurn when the dry-run policy is on", async () => {
    h.settings.agentDryRun = true;
    let sawDryRun: boolean | undefined;
    h.runTurn.mockImplementation(
      impl(async ({ dryRun, messages }) => {
        sawDryRun = dryRun;
        return {
          text: "planned",
          messages,
          toolCalls: 0,
          stoppedReason: "end_turn",
          committed: true,
        };
      }),
    );

    await store().send("plan an edit");
    expect(sawDryRun).toBe(true);
  });

  it("treats Stop as a clean stop, not an error", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ confirmGate }) => {
        await confirmGate!({ id: "t1", name: "deleteClip", args: {} });
        return {
          text: "",
          messages: [],
          toolCalls: 1,
          stoppedReason: "error",
          committed: false,
        };
      }),
    );
    const pending = store().send("delete it");
    await flush();
    expect(store().status).toBe("awaiting_confirm");
    const controller = store().abortController;
    store().stop();
    expect(controller?.signal.aborted).toBe(true);
    await pending;
    expect(store().status).toBe("idle");
    expect(store().error).toBeNull();
  });

  it("discards an in-flight completion after reset()", async () => {
    let release: (() => void) | undefined;
    h.runTurn.mockImplementation(
      impl(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                text: "late",
                messages: [{ role: "assistant", content: "late", toolUses: [] }],
                toolCalls: 0,
                stoppedReason: "end_turn",
                committed: true,
              });
          }),
      ),
    );
    const pending = store().send("hi");
    await flush();
    expect(store().messages.length).toBeGreaterThan(0);
    store().reset();
    expect(store().messages).toHaveLength(0);
    release?.();
    await pending;
    // The superseded completion must not write messages/committed back.
    expect(store().messages).toHaveLength(0);
    expect(store().lastTurnCommitted).toBe(false);
  });

  it("undoLastTurn becomes a no-op once a later edit lands on the undo stack", async () => {
    h.undoStackSize = 0;
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "",
        messages,
        toolCalls: 1,
        stoppedReason: "end_turn",
        committed: true,
      })),
    );
    await store().send("do");
    expect(store().lastTurnCommitted).toBe(true);
    // Simulate a manual edit after the turn (undo stack advanced).
    h.undoStackSize = 3;
    await store().undoLastTurn();
    expect(h.undo).not.toHaveBeenCalled();
    expect(store().lastTurnCommitted).toBe(false);
  });

  it("ignores a second send while a turn is running", async () => {
    let release: (() => void) | undefined;
    h.runTurn.mockImplementation(
      impl(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                text: "",
                messages: [],
                toolCalls: 0,
                stoppedReason: "end_turn",
                committed: true,
              });
          }),
      ),
    );
    const first = store().send("first");
    await flush();
    expect(store().status).toBe("running");
    await store().send("second");
    expect(h.runTurn).toHaveBeenCalledTimes(1);
    expect(store().messages.filter((m) => m.role === "user")).toHaveLength(1);
    release?.();
    await first;
  });

  it("reset clears conversation state", async () => {
    h.runTurn.mockImplementation(
      impl(async ({ messages }) => ({
        text: "",
        messages,
        toolCalls: 0,
        stoppedReason: "end_turn",
        committed: true,
      })),
    );
    await store().send("hi");
    expect(store().messages.length).toBeGreaterThan(0);

    store().reset();
    expect(store().messages).toHaveLength(0);
    expect(store().conversation).toHaveLength(0);
    expect(store().lastTurnCommitted).toBe(false);
    expect(store().status).toBe("idle");
  });
});
