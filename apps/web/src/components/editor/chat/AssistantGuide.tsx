import type { JSX } from "react";
import { X } from "@/icons/lucide-compat";
import { useChatStore } from "../../../stores/chat-store";
import { ASSISTANT_GUIDE_SECTIONS } from "../../../hawsh/assistant-guide";
import { msg } from "../../../hawsh/i18n/messages";

/** What the assistant understands, with examples that go into the composer when tapped. */
export function AssistantGuide({ onClose }: { onClose: () => void }): JSX.Element {
  const setDraft = useChatStore((s) => s.setDraft);

  return (
    <section dir="rtl" aria-label={msg("chat.guide.title")} className="min-h-0 flex-1 overflow-y-auto p-3 text-start">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-fg">{msg("chat.guide.title")}</h2>
        <button
          type="button"
          aria-label={msg("chat.guide.close")}
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-fg-2">{msg("chat.guide.intro")}</p>
      <div className="space-y-3">
        {ASSISTANT_GUIDE_SECTIONS.map((section) => (
          <div key={section.title}>
            <h3 className="mb-1.5 text-[11px] font-semibold text-accent">{section.title}</h3>
            <div className="flex flex-wrap gap-1.5">
              {section.examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => { setDraft(example); onClose(); }}
                  className="rounded-full border border-border bg-bg-2/60 px-2.5 py-1 text-[11px] text-fg-2 transition-colors hover:border-accent/50 hover:bg-hover hover:text-fg"
                >
                  {example}
                </button>
              ))}
            </div>
            {section.note && <p className="mt-1.5 text-[10px] leading-relaxed text-fg-muted">{section.note}</p>}
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2 rounded-md border border-border bg-bg-2/50 p-2.5 text-[11px] leading-relaxed text-fg-2">
        <p>{msg("chat.guide.tips")}</p>
        <p className="text-fg-muted">{msg("chat.guide.cannot")}</p>
      </div>
    </section>
  );
}
