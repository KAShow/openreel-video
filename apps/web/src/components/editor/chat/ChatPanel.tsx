import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Bot, X, Undo2, Plus, History, Sparkles, Settings } from "@/icons/lucide-compat";
import { useChatStore } from "../../../stores/chat-store";
import { useProjectStore } from "../../../stores/project-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { ChatMessage } from "./ChatMessage";
import { ChatComposer } from "./ChatComposer";
import { InlineConfirmCard } from "./InlineConfirmCard";
import { ChatErrorCard } from "./ChatErrorCard";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import { EditSharingPanel } from "./EditSharingPanel";
import { useAIConnectionStore } from "../../../stores/ai-connection-store";
import { msg } from "../../../hawsh/i18n/messages";
import { SIMPLE_EDITOR } from "../../../hawsh/simple";
import { chatStart, nextSteps } from "./suggestions";

function EmptyState({
  hasOpenProject,
}: {
  hasOpenProject: boolean;
}): JSX.Element {
  const send = useChatStore((s) => s.send);
  const connection = useAIConnectionStore();
  const openSettings = useSettingsStore((s) => s.openSettings);
  const project = useProjectStore((s) => s.project);
  const ready = !!connection.baseUrl.trim() && !!connection.model.trim() && (!!connection.apiKey || connection.provider === "compatible");
  const start = hasOpenProject ? chatStart(project) : null;

  return (
    <div className="flex h-full flex-col items-center justify-center px-2 text-center">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
        <Sparkles size={18} />
      </div>
      <div className="text-[13px] font-medium text-fg">Edit by chatting</div>
      <Text type="supporting" color="secondary" className="mt-1 max-w-[14rem] text-[11px] leading-relaxed text-fg-muted">
        {!hasOpenProject
          ? "Open or create a project, then describe edits in plain language."
          : start?.kind === "needsMedia"
            ? msg("chat.empty.needsMedia")
            : "Describe an edit in plain language and the AI will perform it on your timeline."}
      </Text>
      {hasOpenProject && !ready && (
        <Button label="Connect a model" variant="secondary" size="sm" onClick={() => openSettings("ai-editor")} className="mt-4" />
      )}
      {ready && start?.kind === "suggest" && (
        <div className="mt-4 w-full space-y-1.5">
          {start.keys.map((s) => (
            <Button
              key={s}
              label={msg(s)}
              variant="ghost"
              size="sm"
              onClick={() => void send(msg(s))}
              className="w-full rounded-md border border-border bg-bg-1/60 px-2.5 py-1.5 text-start text-[11px] text-fg-2 transition-colors hover:border-accent/50 hover:bg-hover hover:text-fg"
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One-tap requests under the assistant's last reply: what the project still lacks. */
function NextSteps(): JSX.Element | null {
  const send = useChatStore((s) => s.send);
  const messages = useChatStore((s) => s.messages);
  const project = useProjectStore((s) => s.project);
  const keys = nextSteps(project, messages);
  if (keys.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-fg-muted">{msg("chat.next.label")}</div>
      <div className="flex flex-wrap gap-1.5">
        {keys.map((key) => (
          <Button
            key={key}
            label={msg(key)}
            variant="ghost"
            size="sm"
            onClick={() => void send(msg(key))}
            className="rounded-full border border-border bg-bg-1/60 px-2.5 py-1 text-start text-[11px] text-fg-2 transition-colors hover:border-accent/50 hover:bg-hover hover:text-fg"
          />
        ))}
      </div>
    </div>
  );
}

export function ChatPanel({
  onClose,
}: {
  onClose?: () => void;
}): JSX.Element {
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const pendingConfirm = useChatStore((s) => s.pendingConfirm);
  const lastTurnCommitted = useChatStore((s) => s.lastTurnCommitted);
  const usage = useChatStore((s) => s.usage);
  const undoLastTurn = useChatStore((s) => s.undoLastTurn);
  const newChat = useChatStore((s) => s.newChat);
  const clearError = useChatStore((s) => s.clearError);
  const setProjectContext = useChatStore((s) => s.setProjectContext);
  const hasOpenProject = useProjectStore((s) => s.hasOpenProject);
  const projectId = useProjectStore((s) => (s.hasOpenProject ? s.project.id : null));
  const openSettings = useSettingsStore((s) => s.openSettings);

  const totalTokens = usage.inputTokens + usage.outputTokens;
  const tokenLabel =
    totalTokens >= 1000
      ? `${(totalTokens / 1000).toFixed(1)}k`
      : `${totalTokens}`;

  const busy = status === "running" || status === "awaiting_confirm";
  const scrollRef = useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pendingConfirm, error]);

  useEffect(() => {
    setProjectContext(projectId);
  }, [projectId, setProjectContext]);

  return (
    <div dir="rtl" className="relative flex h-full flex-col bg-bg-1">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Bot size={15} className="shrink-0 text-accent" />
        <span className="shrink-0 text-[13px] font-medium text-fg">
          AI Editor
        </span>
        {totalTokens > 0 && (
          <span
            title={msg("chat.panel.tokensTitle", { input: usage.inputTokens, output: usage.outputTokens })}
            className="shrink-0 rounded bg-bg-2 px-1.5 py-0.5 text-[10px] tabular-nums text-fg-muted"
          >
            {msg("chat.panel.tokens", { count: tokenLabel })}
          </span>
        )}
        <div className="ms-auto flex items-center gap-1">
          <IconButton
            label="AI settings"
            icon={<Settings size={14} aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => openSettings("ai-editor")}
            className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg"
          />
          {lastTurnCommitted && (
            <IconButton
              label="Undo last AI turn"
              icon={<Undo2 size={14} aria-hidden />}
              size="sm"
              variant="ghost"
              onClick={() => void undoLastTurn()}
              className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg"
            />
          )}
          <IconButton
            label="Conversation history"
            icon={<History size={14} aria-hidden />}
            size="sm"
            variant={historyOpen ? "secondary" : "ghost"}
            onClick={() => setHistoryOpen((open) => !open)}
            isDisabled={busy}
            aria-pressed={historyOpen}
            className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
          />
          <Button
            label="New chat"
            size="sm"
            variant="secondary"
            onClick={() => {
              newChat();
              setHistoryOpen(false);
            }}
            isDisabled={busy || messages.length === 0}
            className="h-7 shrink-0 px-2 text-[10px]"
          >
            <Plus size={12} aria-hidden />
          </Button>
          {onClose && (
            <IconButton
              label="Close"
              icon={<X size={14} aria-hidden />}
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg"
            />
          )}
        </div>
      </header>
      {/* Hawsh simple editor: edit JSON and presets are a developer tool that took up to 40% of the panel. */}
      {!SIMPLE_EDITOR && (
        <div className="max-h-[40%] shrink-0 overflow-y-auto">
          <EditSharingPanel disabled={busy} />
        </div>
      )}

      {historyOpen && (
        <ChatHistoryPanel
          projectId={projectId}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      <div
        ref={scrollRef}
        role="log"
        aria-label={msg("chat.panel.log")}
        aria-live="polite"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3"
      >
        {messages.length === 0 ? (
          <EmptyState hasOpenProject={hasOpenProject} />
        ) : (
          messages.map((m, index) => (
            <ChatMessage
              key={m.id}
              message={m}
              pending={busy && index === messages.length - 1 && m.role === "assistant"}
            />
          ))
        )}

        {pendingConfirm && <InlineConfirmCard call={pendingConfirm.call} />}

        {!busy && !error && messages.at(-1)?.role === "assistant" && <NextSteps />}

        {error && (
          <ChatErrorCard
            error={error}
            onDismiss={clearError}
            onOpenSettings={openSettings}
            onNewChat={() => {
              newChat();
              setHistoryOpen(false);
            }}
          />
        )}
      </div>

      <ChatComposer />
    </div>
  );
}

export default ChatPanel;
