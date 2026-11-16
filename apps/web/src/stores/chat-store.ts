import { create } from "zustand";
import {
  runTurn,
} from "@openreel/agent";
import type {
  AgentEvent,
  ConfirmDecision,
  ToolCall,
  ToolResult,
  LoopMessage,
} from "@openreel/agent";
import { runExclusive } from "../services/agent/host-singleton";
import { validateAIEndpoint } from "../services/agent/direct-llm-transport";
import { HAWSH_AI_ONLY_MESSAGE, isHawshAI, makeHawshAIClient } from "../hawsh/ai";
import { turnCost, type ChatTurnCost } from "../hawsh/ai-cost";
import { msg } from "../hawsh/i18n/messages";
import { EditingSession } from "../services/agent/editing-session";
import { editingToolDefs, editingToolNeedsConfirm, editingToolReadOnly, executeEditingTool } from "../services/agent/editing-tools";
import { assistantSystem } from "../hawsh/assistant-prompt";
import { forgivingExecutor } from "../hawsh/assistant-recovery";
import { transcribeChargeNotice, transcribeConfirmNote, transcribePointsCharged } from "../hawsh/transcribe-tool";
import { useAIConnectionStore } from "./ai-connection-store";
import {
  conversationTitle,
  useChatHistoryStore,
} from "./chat-history-store";
import { useSettingsStore } from "./settings-store";
import { useProjectStore } from "./project-store";
import { useTimelineStore } from "./timeline-store";
import { useUIStore } from "./ui-store";

export type ChatStatus = "idle" | "running" | "awaiting_confirm" | "error";

export type ToolCallStatus = "running" | "done" | "error" | "rejected" | "retrying" | "corrected";

export interface ToolCallView {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly status: ToolCallStatus;
  readonly result?: ToolResult;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly toolCalls: ToolCallView[];
  readonly notice?: string;
  /** Director's Eyes points this request consumed (assistant messages; UI only, never sent to the model). */
  readonly cost?: ChatTurnCost;
}

interface PendingConfirm {
  readonly call: ToolCall;
  readonly resolve: (decision: ConfirmDecision) => void;
  /** Extra line for the card, e.g. the points a transcription will cost (Hawsh Khalifa build). */
  readonly note?: string;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

interface ChatState {
  messages: ChatMessage[];
  status: ChatStatus;
  conversation: LoopMessage[];
  pendingConfirm: PendingConfirm | null;
  error: string | null;
  abortController: AbortController | null;
  lastTurnCommitted: boolean;
  lastTurnUndoSize: number | null;
  lastTurnActionId: string | null;
  usage: TokenUsage;
  projectId: string | null;
  currentConversationId: string | null;
  conversationStartedAt: number | null;

  send: (text: string) => Promise<void>;
  resolveConfirm: (decision: ConfirmDecision) => void;
  stop: () => void;
  undoLastTurn: () => Promise<void>;
  clearError: () => void;
  setProjectContext: (projectId: string | null) => void;
  newChat: () => void;
  openConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
  reset: () => void;
}

const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
    ?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Monotonic turn id: a completion whose seq is stale (reset/superseded) must not
// write back into the store.
let activeSeq = 0;

function undoStackSize(): number | null {
  try {
    return useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
  } catch {
    return null;
  }
}

/** Model steps per request. The last one must be the reply: a turn that runs out is discarded whole. */
const MAX_STEPS = 16;
/** Earlier messages the model is shown (text only), and the most characters kept of each. */
const HISTORY_MESSAGES = 16;
const HISTORY_CHARS = 1500;

/**
 * What the model sees of the conversation: the words only, most recent first to go. Tool calls and
 * their results are left out on purpose. Every request carries a fresh view of the project
 * (assistantSystem), so old results would only repeat stale IDs, and preview frames would pile up
 * until the server refuses the request. A failed turn keeps its place, so the model knows it failed.
 */
function conversationFromMessages(messages: ChatMessage[]): LoopMessage[] {
  const cut = (text: string): string => (text.length > HISTORY_CHARS ? `${text.slice(0, HISTORY_CHARS)}…` : text);
  const history = messages.flatMap((message): LoopMessage[] => {
    const text = [message.text, message.role === "assistant" ? message.notice : undefined].filter((part) => part?.trim()).join("\n");
    if (!text) return [];
    return message.role === "user"
      ? [{ role: "user", content: cut(text) }]
      : [{ role: "assistant", content: cut(text), toolUses: [] }];
  }).slice(-HISTORY_MESSAGES);
  // A conversation opens with the user.
  while (history.length && history[0].role !== "user") history.shift();
  return history;
}

function saveConversationSnapshot(state: ChatState): void {
  if (
    !state.currentConversationId ||
    !state.projectId ||
    !state.messages.some((message) => message.role === "user")
  ) {
    return;
  }
  const now = Date.now();
  useChatHistoryStore.getState().saveConversation({
    id: state.currentConversationId,
    projectId: state.projectId,
    title: conversationTitle(state.messages),
    createdAt: state.conversationStartedAt ?? now,
    updatedAt: now,
    messages: state.messages,
    usage: state.usage,
    error: state.error ?? undefined,
  });
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  status: "idle",
  conversation: [],
  pendingConfirm: null,
  error: null,
  abortController: null,
  lastTurnCommitted: false,
  lastTurnUndoSize: null, lastTurnActionId: null,
  usage: { inputTokens: 0, outputTokens: 0 },
  projectId: null,
  currentConversationId: null,
  conversationStartedAt: null,

  send: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const current = get();
    if (current.status === "running" || current.status === "awaiting_confirm") {
      return;
    }
    if (!useProjectStore.getState().hasOpenProject) {
      set({ error: msg("chat.error.noProject") });
      return;
    }

    const projectState = useProjectStore.getState();
    const currentProjectId = projectState.project?.id ?? null;
    if (current.projectId && currentProjectId && current.projectId !== currentProjectId) {
      get().setProjectContext(currentProjectId);
    }

    const { provider, model, baseUrl: inputBaseUrl, apiKey } = useAIConnectionStore.getState();
    if (!["openai", "anthropic", "compatible"].includes(provider)) { set({ error: msg("chat.error.apiFormat") }); return; }
    if (!model.trim()) { set({ error: msg("chat.error.modelId") }); return; }
    let baseUrl: string;
    try { baseUrl = validateAIEndpoint(inputBaseUrl); } catch { set({ error: msg("chat.error.endpoint") }); return; }
    if (provider !== "compatible" && !apiKey) {
      set({
        error: msg("chat.error.apiKey"),
      });
      return;
    }

    const active = get();
    const conversationId = active.currentConversationId ?? genId();
    const conversationStartedAt = active.conversationStartedAt ?? Date.now();
    const userMessage: ChatMessage = {
      id: genId(),
      role: "user",
      text: trimmed,
      toolCalls: [],
    };
    const assistantMessage: ChatMessage = {
      id: genId(),
      role: "assistant",
      text: "",
      toolCalls: [],
    };
    const assistantId = assistantMessage.id;
    const controller = new AbortController();
    const seq = ++activeSeq;

    set((state) => ({
      messages: [...state.messages, userMessage, assistantMessage],
      conversation: [...conversationFromMessages(state.messages), { role: "user", content: trimmed }],
      status: "running",
      error: null,
      abortController: controller,
      pendingConfirm: null,
      projectId: currentProjectId,
      currentConversationId: conversationId,
      conversationStartedAt,
    }));

    const updateAssistant = (fn: (m: ChatMessage) => ChatMessage): void => {
      if (activeSeq !== seq) return;
      set((state) => ({
        messages: state.messages.map((m) => (m.id === assistantId ? fn(m) : m)),
      }));
    };

    const onEvent = (event: AgentEvent): void => {
      switch (event.type) {
        case "text_delta":
        case "turn_complete":
          updateAssistant((m) => ({ ...m, text: event.text || m.text }));
          break;
        case "tool_call":
          updateAssistant((m) => ({
            ...m,
            toolCalls: [
              ...m.toolCalls,
              {
                id: event.call.id,
                name: event.call.name,
                args: event.call.args,
                status: "running",
              },
            ],
          }));
          break;
        case "tool_result":
          updateAssistant((m) => ({
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              tc.id === event.call.id
                ? {
                    ...tc,
                    result: event.result,
                    status: event.result.ok
                      ? "done"
                      : event.result.error?.code === "REJECTED"
                        ? "rejected"
                        : event.result.error?.recoverable && event.result.error.retryOf
                          ? "retrying"
                          : "error",
                  }
                : tc,
            ),
          }));
          break;
        case "tool_recovered":
          updateAssistant((m) => ({ ...m, toolCalls: m.toolCalls.map((tc) => event.callIds.includes(tc.id) ? { ...tc, status: "corrected" } : tc) }));
          break;
        case "error":
          if (activeSeq === seq) set({ error: event.error.message });
          break;
        case "awaiting_confirmation":
          break;
      }
    };

    const host = new EditingSession(controller.signal);
    let llm;
    // Hawsh Khalifa build: AI editing runs only on Director's Eyes points (src/hawsh/ai.ts).
    if (!isHawshAI(baseUrl)) {
      set({ status: "error", error: HAWSH_AI_ONLY_MESSAGE, abortController: null });
      return;
    }
    // Model calls the server charged in this turn (successful replies only; see makeHawshAIClient).
    let chargedSteps = 0;
    const spent = (): ChatTurnCost | undefined => (chargedSteps > 0 ? turnCost(chargedSteps) : undefined);
    try { llm = makeHawshAIClient(controller.signal, () => { chargedSteps++; }); } catch (error) {
      set({ status: "error", error: error instanceof Error ? error.message : msg("chat.error.connection"), abortController: null });
      return;
    }
    const tools = editingToolDefs(provider === "anthropic" ? "anthropic" : "openai");
    const autoConfirm = useSettingsStore.getState().agentAutoConfirm;
    const dryRun = useSettingsStore.getState().agentDryRun;
    const pointsBefore = transcribePointsCharged();
    // Small mistakes go back to the model instead of discarding the turn (src/hawsh/assistant-recovery.ts).
    const forgiving = forgivingExecutor(executeEditingTool, editingToolReadOnly, () => {
      const left = MAX_STEPS - chargedSteps;
      return left <= 2 ? `Step budget: ${left} left. The last step must be your reply to the user with no tool calls, or every edit is discarded.` : undefined;
    });

    let result;
    try { result = await runExclusive(() =>
      runTurn({
        host,
        llm,
        tools,
        system: assistantSystem(useProjectStore.getState().getFullProject(), {
          playheadSec: useTimelineStore.getState().playheadPosition,
          selectedIds: useUIStore.getState().selectedItems.map((item) => item.id),
        }),
        messages: get().conversation,
        execute: forgiving.execute,
        readOnly: editingToolReadOnly,
        requiresConfirmation: editingToolNeedsConfirm,
        continueAfterFailure: forgiving.continueAfterFailure,
        limits: { maxSteps: MAX_STEPS },
        atomic: true,
        signal: controller.signal,
        dryRun,
        confirmGate: autoConfirm
          ? () => "approve_for_turn"
          : async (call) => {
              const note = await transcribeConfirmNote(call, host);
              return new Promise<ConfirmDecision>((resolve) => {
                if (controller.signal.aborted) { resolve("reject"); return; }
                set({ status: "awaiting_confirm", pendingConfirm: { call, resolve, note } });
              });
            },
        onEvent,
        turnLabel: msg("chat.turn.undoLabel"),
      }),
    );
    } catch (error) {
      if (activeSeq !== seq) return;
      // A failed turn still costs the steps the server charged before it failed.
      const cost = spent();
      // Transcription points spent before the failure are lost with the discarded draft: say so.
      const chargedNotice = transcribeChargeNotice(transcribePointsCharged() - pointsBefore);
      if (cost || chargedNotice) updateAssistant((m) => ({ ...m, ...(cost ? { cost } : {}), ...(chargedNotice ? { notice: chargedNotice } : {}) }));
      set((state) => ({ status: controller.signal.aborted ? "idle" : "error", error: controller.signal.aborted ? null : error instanceof Error ? error.message : msg("chat.error.turnFailed"), abortController: null, pendingConfirm: null, conversation: conversationFromMessages(state.messages) }));
      saveConversationSnapshot(get()); return;
    }

    // A reset() (or a newer turn) during the run supersedes this completion.
    if (activeSeq !== seq) return;
    const wasAborted = controller.signal.aborted;
    const stopNotice =
      result.stoppedReason === "max_steps"
        ? msg("chat.stop.maxSteps")
        : result.stoppedReason === "max_tool_calls"
          ? msg("chat.stop.maxToolCalls")
          : result.stoppedReason === "budget"
            ? msg("chat.stop.budget")
            : undefined;
    set((state) => {
      const messages = state.messages.map((message) => {
        if (message.id !== assistantId) return message;
        const finalText = wasAborted ? msg("chat.turn.cancelled") : !result.committed ? msg("chat.turn.failedNoEdits") : result.text || message.text;
        const emptyNotice =
          !finalText && result.stoppedReason === "end_turn"
            ? message.toolCalls.length > 0
              ? msg("chat.turn.noSummary")
              : msg("chat.turn.empty")
            : undefined;
        // Points spent on a transcription are not refunded when the turn is discarded: say so.
        const chargedNotice = result.committed ? undefined : transcribeChargeNotice(transcribePointsCharged() - pointsBefore);
        return {
          ...message,
          text: finalText,
          notice: chargedNotice ?? stopNotice ?? emptyNotice,
          cost: spent(),
          toolCalls: message.toolCalls.map((tc) => !result.committed && tc.status === "retrying" ? { ...tc, status: "error" as const } : tc),
        };
      });
      return {
        messages,
        conversation: conversationFromMessages(messages),
        status: wasAborted
          ? "idle"
          : result.stoppedReason === "error"
            ? "error"
            : "idle",
        lastTurnCommitted: result.committed && host.committed,
        lastTurnUndoSize: result.committed && host.committed ? undoStackSize() : null,
        lastTurnActionId: result.committed && host.committed ? useProjectStore.getState().actionExecutor.getHistory().peekUndo?.()?.action.id ?? null : null,
        abortController: null,
        pendingConfirm: null,
        usage: {
          inputTokens: state.usage.inputTokens + result.usage.inputTokens,
          outputTokens: state.usage.outputTokens + result.usage.outputTokens,
        },
        error: wasAborted
          ? null
          : result.stoppedReason === "error"
            ? (state.error ?? msg("chat.error.turnFailed"))
            : state.error,
      };
    });
    saveConversationSnapshot(get());
  },

  resolveConfirm: (decision: ConfirmDecision) => {
    const pending = get().pendingConfirm;
    if (!pending) return;
    set({ pendingConfirm: null, status: "running" });
    pending.resolve(decision);
  },

  stop: () => {
    const { abortController, pendingConfirm } = get();
    pendingConfirm?.resolve("reject");
    abortController?.abort();
    set({ pendingConfirm: null });
  },

  undoLastTurn: async () => {
    if (!get().lastTurnCommitted) return;
    // If the project's undo stack moved since the turn committed, a later edit
    // is on top — undoing it would hit the wrong action, so just drop the
    // affordance rather than clobber the user's edit.
    const checkpoint = get().lastTurnUndoSize;
    const actionId = get().lastTurnActionId;
    if (checkpoint !== null && undoStackSize() !== checkpoint || actionId !== null && useProjectStore.getState().actionExecutor.getHistory().peekUndo?.()?.action.id !== actionId) {
      set({ lastTurnCommitted: false, lastTurnUndoSize: null });
      return;
    }
    await useProjectStore.getState().undo();
    set({ lastTurnCommitted: false, lastTurnUndoSize: null });
  },

  clearError: () => set({ error: null }),

  setProjectContext: (projectId: string | null) => {
    const state = get();
    if (state.projectId === projectId) return;
    if (state.projectId !== null && (state.messages.length > 0 || state.conversation.length > 0)) {
      saveConversationSnapshot(state);
    }
    state.pendingConfirm?.resolve("reject");
    state.abortController?.abort();
    activeSeq++;
    set({
      messages: [],
      conversation: [],
      status: "idle",
      pendingConfirm: null,
      error: null,
      abortController: null,
      lastTurnCommitted: false,
      lastTurnUndoSize: null, lastTurnActionId: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      projectId,
      currentConversationId: null,
      conversationStartedAt: null,
    });
  },

  newChat: () => {
    const state = get();
    if (state.status === "running" || state.status === "awaiting_confirm") return;
    saveConversationSnapshot(state);
    activeSeq++;
    set({
      messages: [],
      conversation: [],
      status: "idle",
      pendingConfirm: null,
      error: null,
      abortController: null,
      lastTurnCommitted: false,
      lastTurnUndoSize: null, lastTurnActionId: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      currentConversationId: null,
      conversationStartedAt: null,
    });
  },

  openConversation: (conversationId: string) => {
    const state = get();
    if (state.status === "running" || state.status === "awaiting_confirm") return;
    const saved = useChatHistoryStore
      .getState()
      .conversations.find((item) => item.id === conversationId);
    if (!saved || (state.projectId && saved.projectId !== state.projectId)) return;
    if (state.currentConversationId !== conversationId) {
      saveConversationSnapshot(state);
    }
    activeSeq++;
    set({
      messages: saved.messages,
      conversation: conversationFromMessages(saved.messages),
      status: "idle",
      pendingConfirm: null,
      error: saved.error ?? null,
      abortController: null,
      lastTurnCommitted: false,
      lastTurnUndoSize: null, lastTurnActionId: null,
      usage: saved.usage,
      projectId: saved.projectId,
      currentConversationId: saved.id,
      conversationStartedAt: saved.createdAt,
    });
  },

  deleteConversation: (conversationId: string) => {
    useChatHistoryStore.getState().deleteConversation(conversationId);
    if (get().currentConversationId !== conversationId) return;
    activeSeq++;
    set({
      messages: [],
      conversation: [],
      status: "idle",
      pendingConfirm: null,
      error: null,
      abortController: null,
      lastTurnCommitted: false,
      lastTurnUndoSize: null, lastTurnActionId: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      currentConversationId: null,
      conversationStartedAt: null,
    });
  },

  reset: () => {
    get().pendingConfirm?.resolve("reject");
    get().abortController?.abort();
    // Supersede any in-flight turn so its completion can't write back.
    activeSeq++;
    set({
      messages: [],
      conversation: [],
      status: "idle",
      pendingConfirm: null,
      error: null,
      abortController: null,
      lastTurnCommitted: false,
      lastTurnUndoSize: null, lastTurnActionId: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      projectId: null,
      currentConversationId: null,
      conversationStartedAt: null,
    });
  },
}));
