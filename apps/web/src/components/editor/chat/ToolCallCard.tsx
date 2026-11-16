import type { JSX } from "react";
import { useState } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ChevronRight, Loader2, Check, X, Ban, Wrench } from "@/icons/lucide-compat";
import type { ToolCallView } from "../../../stores/chat-store";
import { toolLabel } from "./tool-labels";
import { msg } from "../../../hawsh/i18n/messages";
import { SIMPLE_EDITOR } from "../../../hawsh/simple";

const STATUS_META: Record<
  ToolCallView["status"],
  { icon: JSX.Element; tint: string; label: string }
> = {
  running: {
    icon: <Loader2 size={12} className="animate-spin" />,
    tint: "text-fg-2",
    label: msg("chat.tool.status.running"),
  },
  done: {
    icon: <Check size={12} />,
    tint: "text-status-success",
    label: msg("chat.tool.status.done"),
  },
  retrying: {
    icon: <Wrench size={12} />,
    tint: "text-status-warning",
    label: msg("chat.tool.status.retrying"),
  },
  corrected: {
    icon: <Check size={12} />,
    tint: "text-fg-muted",
    label: msg("chat.tool.status.corrected"),
  },
  error: {
    icon: <X size={12} />,
    tint: "text-status-error",
    label: msg("chat.tool.status.error"),
  },
  rejected: {
    icon: <Ban size={12} />,
    tint: "text-fg-muted",
    label: msg("chat.tool.status.rejected"),
  },
};

function previewArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      const raw =
        typeof v === "string" ? v : JSON.stringify(v);
      const value = raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
      return `${k}: ${value}`;
    })
    .join(", ");
}

/** One Arabic sentence for the outcome; the tool's own (English) summary stays in the technical block. */
function outcomeText(status: ToolCallView["status"], label: string): string {
  switch (status) {
    case "done":
      return msg("chat.tool.outcome.done", { label });
    case "corrected":
      return msg("chat.tool.outcome.corrected", { label });
    case "retrying":
      return msg("chat.tool.outcome.retrying", { label });
    case "rejected":
      return msg("chat.tool.outcome.rejected", { label });
    case "running":
      return msg("chat.tool.outcome.running", { label });
    default:
      return msg("chat.tool.outcome.error", { label });
  }
}

export function ToolCallCard({ call }: { call: ToolCallView }): JSX.Element {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[call.status];
  const label = toolLabel(call.name) ?? call.name;
  const hasDetail =
    Object.keys(call.args ?? {}).length > 0 || call.result !== undefined;

  return (
    <div className="rounded-md border border-border bg-bg-1/60 text-[11px]">
      <Button
        label={msg("chat.tool.aria", { label, status: meta.label })}
        variant="ghost"
        isDisabled={!hasDetail}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-start disabled:cursor-default"
      >
        {hasDetail ? (
          <ChevronRight
            size={12}
            className={`shrink-0 text-fg-muted transition-transform ${open ? "rotate-90" : "rtl:rotate-180"}`}
          />
        ) : (
          <Wrench size={12} className="shrink-0 text-fg-muted" />
        )}
        <span className="text-fg">{label}</span>
        <span className={`ms-auto flex items-center gap-1 ${meta.tint}`}>
          {meta.icon}
          <span className="text-[10px]">{meta.label}</span>
        </span>
      </Button>

      {open && hasDetail && (
        <div className="space-y-1.5 border-t border-border px-2 py-1.5">
          <div className="font-mono text-[10px] text-fg-muted" dir="ltr">{call.name}</div>
          {Object.keys(call.args ?? {}).length > 0 && (
            <div>
              <div className="mb-0.5 text-[9px] tracking-wide text-fg-muted">
                {msg("chat.tool.args")}
              </div>
              <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-bg-2 p-1.5 text-start font-mono text-[10px] text-fg-2">
                {JSON.stringify(call.args, null, 2)}
              </pre>
            </div>
          )}
          {call.result && (
            <div>
              <div className="mb-0.5 text-[9px] tracking-wide text-fg-muted">
                {msg("chat.tool.result")}
              </div>
              <div
                className={
                  call.result.ok || call.status === "corrected" ? "text-fg-2" : call.status === "retrying" ? "text-status-warning" : "text-status-error"
                }
              >
                {outcomeText(call.status, label)}
              </div>
              <div dir="ltr" className="mt-1 text-start text-[10px] text-fg-muted">
                {call.result.summary}
                {call.result.error && !call.result.ok
                  ? ` — ${call.result.error.message}`
                  : ""}
              </div>
              {call.result.data !== undefined && <pre dir="ltr" className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg-2 p-1.5 text-start text-[10px]">{JSON.stringify(call.result.data, null, 2)}</pre>}
            </div>
          )}
        </div>
      )}

      {/* Hawsh simple editor: raw arguments stay inside the expanded details only. */}
      {!SIMPLE_EDITOR && !open && Object.keys(call.args ?? {}).length > 0 && (
        <div dir="ltr" className="truncate px-2 pb-1.5 text-start font-mono text-[10px] text-fg-muted">
          {previewArgs(call.args)}
        </div>
      )}
    </div>
  );
}
