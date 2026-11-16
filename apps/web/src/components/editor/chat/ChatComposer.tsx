import type { JSX } from "react";
import { useCallback, type KeyboardEvent } from "react";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { Send, Square } from "@/icons/lucide-compat";
import { useChatStore } from "../../../stores/chat-store";
import { AIPriceNote } from "../../../hawsh/AIPriceNote";
import { msg } from "../../../hawsh/i18n/messages";

export function ChatComposer(): JSX.Element {
  const status = useChatStore((s) => s.status);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const text = useChatStore((s) => s.draft);
  const setText = useChatStore((s) => s.setDraft);
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const busy = status === "running" || status === "awaiting_confirm";

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    void send(value);
  }, [text, busy, send, setText]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="border-t border-border p-2">
      {/* Hawsh Khalifa build: chat first (a plan to confirm) or edit straight away (src/hawsh/assistant-mode.ts). */}
      <div role="radiogroup" aria-label={msg("chat.mode.chat")} className="mb-1.5 flex items-center gap-1 text-[11px]">
        {(["chat", "direct"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={busy}
            title={msg(value === "chat" ? "chat.mode.chatHint" : "chat.mode.directHint")}
            onClick={() => setMode(value)}
            className={`rounded-md px-2 py-0.5 transition-colors disabled:opacity-50 ${mode === value ? "bg-accent-soft font-medium text-accent" : "text-fg-muted hover:bg-hover hover:text-fg"}`}
          >
            {msg(value === "chat" ? "chat.mode.chat" : "chat.mode.direct")}
          </button>
        ))}
        <span className="ms-1 truncate text-[10px] text-fg-muted">{msg(mode === "chat" ? "chat.mode.chatHint" : "chat.mode.directHint")}</span>
      </div>
      <div className="relative rounded-lg border border-border bg-bg-2 transition-colors focus-within:border-accent">
        <ToolcraftTextAreaControl
          label="AI edit request"
          isLabelHidden
          value={text}
          onChange={setText}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Ask the AI to edit your video…"
          inputClassName="block w-full resize-none bg-transparent px-3 py-2 pe-11 text-[13px] text-fg outline-none placeholder:text-fg-muted"
        />
        <div className="absolute bottom-1.5 end-1.5">
          {busy ? (
            <IconButton
              label="Stop"
              icon={<Square size={12} className="fill-current" aria-hidden />}
              size="sm"
              variant="destructive"
              onClick={stop}
              className="grid h-7 w-7 place-items-center rounded-md bg-status-error/15 text-status-error transition-colors hover:bg-status-error/25"
            />
          ) : (
            <IconButton
              label="Send"
              icon={<Send size={12} aria-hidden className="rtl:-scale-x-100" />}
              size="sm"
              variant="primary"
              onClick={submit}
              isDisabled={!text.trim()}
              className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-40"
            />
          )}
        </div>
      </div>
      <div className="mt-1 px-1 text-[10px] text-fg-muted">
        {msg("chat.composer.hint")}
      </div>
      <AIPriceNote />
    </div>
  );
}
