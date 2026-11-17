/** Small shared pieces of the phone sheets: chips, a section with a title, and a commit-on-release slider. */
import React, { useEffect, useState } from "react";

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
