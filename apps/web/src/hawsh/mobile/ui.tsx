/**
 * Small shared pieces of the editor sheets: the sheet itself (a bottom sheet on phones, a side panel
 * beside the preview on computers), chips, a section with a title, and a commit-on-release slider.
 */
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { useWideEditor } from "./phone";

/** Width of the side panel on computers; the editor makes room for it while one is open. */
export const SIDE_PANEL_WIDTH = 400;

let openPanels = 0;
const panelListeners = new Set<() => void>();
const emitPanels = () => panelListeners.forEach((l) => l());

/** Whether a side panel is open (computers only), so the preview and timeline can make room. */
export function useSidePanelOpen(): boolean {
  return useSyncExternalStore(
    (cb) => { panelListeners.add(cb); return () => { panelListeners.delete(cb); }; },
    () => openPanels > 0,
    () => false,
  );
}

/**
 * A tool sheet. Phones: slides up from the bottom over a dim backdrop (tap outside to close).
 * Computers: a panel on the right between the top bar and the tool bar, with the preview and
 * timeline still visible and usable beside it.
 */
export const Sheet: React.FC<{
  title: string; onClose: () => void; children: React.ReactNode; bodyClassName?: string; testId?: string;
  /** No title bar: the content has its own (the assistant chat), so there is one close button, not two. */
  bare?: boolean;
}> = ({ title, onClose, children, bodyClassName = "", testId, bare = false }) => {
  const wide = useWideEditor();
  useEffect(() => {
    if (!wide) return;
    openPanels++; emitPanels();
    return () => { openPanels--; emitPanels(); };
  }, [wide]);

  const header = bare ? null : (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
      <span className="text-sm font-bold text-fg">{title}</span>
      <button type="button" aria-label="إغلاق" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-fg active:bg-white/10"><X size={20} /></button>
    </div>
  );
  const body = bare
    ? <div className={`flex min-h-0 flex-1 flex-col ${wide ? "" : "h-[70vh]"}`}>{children}</div>
    : <div className={`min-h-0 flex-1 overflow-y-auto p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] ${bodyClassName}`}>{children}</div>;

  if (wide) {
    return (
      <aside role="dialog" aria-label={title} dir="rtl" data-no-translate={bare ? undefined : ""} data-testid={testId}
        className="fixed bottom-16 right-0 top-12 z-[80] flex flex-col border-s border-border bg-bg shadow-2xl" style={{ width: SIDE_PANEL_WIDTH }}>
        {header}{body}
      </aside>
    );
  }
  return (
    <div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} dir="rtl" data-no-translate={bare ? undefined : ""} data-testid={testId} onClick={(e) => e.stopPropagation()}
        className="flex max-h-[75%] min-h-[40%] flex-col rounded-t-2xl border-t border-border bg-bg shadow-xl">
        {header}{body}
      </div>
    </div>
  );
};

export const chip = "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold active:scale-95 disabled:opacity-40";
export const chipOn = "border-primary bg-primary/15 text-primary";
export const chipOff = "border-border bg-bg-1 text-fg";
export const bigButton = "flex w-full items-center gap-3 rounded-xl border border-border bg-bg-1 p-3 text-start text-sm active:bg-bg-2 disabled:opacity-40";
export const primaryButton = "w-full rounded-xl border border-primary bg-primary px-3 py-3 text-sm font-bold text-primary-foreground active:opacity-90 disabled:opacity-40";

export const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <section className="space-y-1.5">
    <h4 className="text-[11px] font-bold text-fg-muted">{label}</h4>
    {children}
  </section>
);

/** A slider that applies when the finger lifts, so a drag is one undo step. */
export const Slider: React.FC<{
  label: string; value: number; min: number; max: number; step: number;
  show: (v: number) => string; onCommit: (v: number) => void; disabled?: boolean;
}> = ({ label, value, min, max, step, show, onCommit, disabled }) => {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = (x: number) => { if (Math.abs(x - value) >= step / 2) onCommit(x); };
  return (
    <div className="flex items-center gap-3" dir="ltr">
      <input type="range" aria-label={label} min={min} max={max} step={step} value={v} disabled={disabled} className="min-w-0 flex-1 accent-primary"
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))} />
      <span className="w-14 shrink-0 text-center font-mono text-xs tabular-nums" dir="rtl">{show(v)}</span>
    </div>
  );
};

/** A short message that disappears after a few seconds. */
export function useNote(): [string | null, (text: string | null) => void] {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 3500);
    return () => window.clearTimeout(id);
  }, [note]);
  return [note, setNote];
}

export const Note: React.FC<{ text: string | null }> = ({ text }) =>
  text ? <p className="rounded-lg bg-white/10 px-3 py-2 text-center text-xs" role="status">{text}</p> : null;
