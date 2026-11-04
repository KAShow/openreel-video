/**
 * Phone clip tools bar (stage 3): replaces the main tool bar while a clip is selected, CapCut-style.
 * Quick tools act at once (split, duplicate, delete); the rest open a small bottom sheet (text
 * edit, trim, speed, volume, silence cut). The work itself is in clip-tools.ts.
 */
import React, { useEffect, useState } from "react";
import {
  AudioWaveform, Copy, Gauge, Pencil, Scissors, SquareSplitHorizontal, Trash2, Volume2, X, type LucideIcon,
} from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import type { Region } from "../silence-tools";
import {
  canCutAt, cutSilences, FAILED, duplicate, findSilences, NOT_UNDER_PLAYHEAD, remove, selectedTarget, setSpeed, setVolume,
  silenceTotal, splitAt, SPEEDS, trimAt, type Target,
} from "./clip-tools";
import type { Clip } from "@openreel/core";
import {
  durationAtSpeed, formatSeconds, formatSpeed, roundSpeed, SPEED_MIN, SPEED_SLIDER_MAX, SPEED_STEP,
} from "../../components/editor/inspector/speed-utils";
import { editText } from "./add-tools";
import { TextEditor } from "./AddSheets";

type Sheet = "edit" | "trim" | "speed" | "volume" | "silence";
interface Tool { id: string; label: string; icon: LucideIcon; sheet?: Sheet; run?: (t: Target, time: number) => Promise<string | null> }

const TOOLS: Tool[] = [
  { id: "edit", label: "تعديل", icon: Pencil, sheet: "edit" },
  { id: "split", label: "تقسيم", icon: SquareSplitHorizontal, run: splitAt },
  { id: "trim", label: "قص", icon: Scissors, sheet: "trim" },
  { id: "speed", label: "سرعة", icon: Gauge, sheet: "speed" },
  { id: "volume", label: "صوت", icon: Volume2, sheet: "volume" },
  { id: "silence", label: "قص السكتات", icon: AudioWaveform, sheet: "silence" },
  { id: "duplicate", label: "تكرار", icon: Copy, run: duplicate },
  { id: "delete", label: "حذف", icon: Trash2, run: remove },
];

/** Which tools fit the target: text has no media; still images have no speed or sound. */
export function toolsFor(t: Target): string[] {
  if (t.kind === "text-clip") return ["edit", "split", "trim", "delete"];
  if (t.trackType === "image") return ["split", "trim", "duplicate", "delete"];
  return TOOLS.map((x) => x.id).filter((id) => id !== "edit");
}

const btn = "rounded-xl border border-border bg-bg-1 px-3 py-3 text-sm font-semibold active:bg-bg-2 disabled:opacity-40";

export const ClipTools: React.FC = () => {
  const project = useProjectStore((s) => s.project);
  const selected = useUIStore((s) => s.selectedItems);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const target = selectedTarget(project, selected);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const hasTarget = target !== null;
  useEffect(() => { if (!hasTarget) setSheet(null); }, [hasTarget]);
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 3000);
    return () => window.clearTimeout(id);
  }, [message]);

  if (!target) return null;
  const allowed = toolsFor(target);

  const run = async (fn: () => Promise<string | null>, after?: () => void) => {
    setBusy(true);
    try {
      const error = await fn();
      if (error) setMessage(error);
      else after?.();
    } finally { setBusy(false); }
  };

  const onTool = (tool: Tool) => {
    if (tool.sheet) { setSheet(tool.sheet); return; }
    if (tool.run) void run(() => tool.run!(target, playhead), tool.id === "delete" ? () => clearSelection() : undefined);
  };

  return (
    <>
      {message && (
        <div className="pointer-events-none fixed inset-x-4 bottom-24 z-[95] rounded-xl bg-black/85 px-4 py-2 text-center text-sm text-white" dir="rtl" data-no-translate="" role="status">
          {message}
        </div>
      )}
      <nav className="flex h-16 shrink-0 items-stretch overflow-x-auto bg-black pb-[env(safe-area-inset-bottom)] [scrollbar-width:none]"
        dir="rtl" data-no-translate="" aria-label="أدوات اللقطة" data-testid="clip-tools">
        <button type="button" aria-label="إلغاء التحديد" onClick={() => clearSelection()} className="flex w-11 shrink-0 items-center justify-center border-e border-white/10"><X size={22} strokeWidth={1.6} /></button>
        {TOOLS.filter((t) => allowed.includes(t.id)).map((t) => (
          <button key={t.id} type="button" disabled={busy} onClick={() => onTool(t)}
            className={`flex min-w-[52px] flex-1 flex-col items-center justify-center gap-1 px-0.5 text-center text-[11px] leading-tight disabled:opacity-40 ${t.id === "delete" ? "text-red-400" : "text-fg"}`}>
            <t.icon size={22} strokeWidth={1.6} aria-hidden />
            {t.label}
          </button>
        ))}
      </nav>

      {sheet && (
        <div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/40" onClick={() => setSheet(null)}>
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} dir="rtl" data-no-translate=""
            className="rounded-t-2xl border-t border-border bg-bg p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold">{TOOLS.find((t) => t.sheet === sheet)?.label}</span>
              <button type="button" aria-label="إغلاق" onClick={() => setSheet(null)} className="grid h-8 w-8 place-items-center rounded-full"><X size={20} /></button>
            </div>
            {sheet === "edit" && target.kind === "text-clip" && (
              <TextEditor key={target.id} initial={target.text} onSave={(text) => { if (editText(target.id, text)) setSheet(null); else setMessage(FAILED); }} />
            )}
            {sheet === "trim" && (
              <div className="space-y-2">
                <p className="text-xs text-fg-muted">{canCutAt(target, playhead) ? "يقص عند المؤشر الأبيض." : NOT_UNDER_PLAYHEAD}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={btn} disabled={busy || !canCutAt(target, playhead)}
                    onClick={() => void run(() => trimAt(target, playhead, "start"), () => setSheet(null))}>احذف ما قبل المؤشر</button>
                  <button type="button" className={btn} disabled={busy || !canCutAt(target, playhead)}
                    onClick={() => void run(() => trimAt(target, playhead, "end"), () => setSheet(null))}>احذف ما بعد المؤشر</button>
                </div>
              </div>
            )}
            {sheet === "speed" && target.kind === "clip" && (
              <SpeedControl key={target.id} clip={target.clip} busy={busy} onApply={(s) => void run(() => setSpeed(target.clip, s))} />
            )}
            {sheet === "volume" && target.kind === "clip" && <VolumeControl key={target.id} clipId={target.id} volume={target.clip.volume ?? 1} />}
            {sheet === "silence" && target.kind === "clip" && <SilenceControl key={target.id} clipId={target.id} onDone={() => setSheet(null)} />}
          </div>
        </div>
      )}
    </>
  );
};

/**
 * Speed 0.1–5× in 0.01 steps; committed when the finger lifts so a drag is one undo step. The − / +
 * buttons nudge by 0.01 for exact values, and the presets stay for the common jumps.
 */
export const SpeedControl: React.FC<{ clip: Clip; busy: boolean; onApply: (speed: number) => void }> = ({ clip, busy, onApply }) => {
  const speed = roundSpeed(clip.speed ?? 1);
  const [value, setValue] = useState(speed);
  useEffect(() => setValue(speed), [speed]);
  const commit = (v: number) => {
    const next = roundSpeed(Math.min(SPEED_SLIDER_MAX, Math.max(SPEED_MIN, v)));
    setValue(next);
    if (Math.abs(next - speed) > 0.001) onApply(next);
  };
  const source = clip.outPoint - clip.inPoint;
  return (
    <div className="space-y-3" dir="ltr">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="أبطأ 0.01" disabled={busy || value <= SPEED_MIN} className={`${btn} w-12 shrink-0`}
          onClick={() => commit(value - SPEED_STEP)}>−</button>
        <input type="range" min={SPEED_MIN} max={SPEED_SLIDER_MAX} step={SPEED_STEP} value={Math.min(value, SPEED_SLIDER_MAX)}
          aria-label="السرعة" className="flex-1 accent-primary" disabled={busy}
          onChange={(e) => setValue(Number(e.target.value))}
          onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))} />
        <button type="button" aria-label="أسرع 0.01" disabled={busy || value >= SPEED_SLIDER_MAX} className={`${btn} w-12 shrink-0`}
          onClick={() => commit(value + SPEED_STEP)}>+</button>
      </div>
      <p className="text-center font-mono text-lg font-bold tabular-nums" aria-live="polite">{formatSpeed(value)}</p>
      {source > 0 && value !== 1 && (
        <p className="text-center text-xs text-fg-muted" dir="rtl">
          مدة اللقطة: {formatSeconds(source)} ← {formatSeconds(durationAtSpeed(clip.inPoint, clip.outPoint, value))}
        </p>
      )}
      <div className="grid grid-cols-5 gap-2">
        {SPEEDS.map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => commit(s)}
            className={`${btn} px-0 ${Math.abs(value - s) < 0.001 ? "border-primary text-primary" : ""}`}>{s}×</button>
        ))}
      </div>
    </div>
  );
};

/** Volume 0–200%; committed when the finger lifts so a drag is one undo step. */
const VolumeControl: React.FC<{ clipId: string; volume: number }> = ({ clipId, volume }) => {
  const [value, setValue] = useState(Math.round(volume * 100));
  useEffect(() => setValue(Math.round(volume * 100)), [volume]);
  const commit = (v: number) => { if (Math.abs(v / 100 - volume) > 0.001) void setVolume(clipId, v / 100); };
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3" dir="ltr">
        <input type="range" min={0} max={200} step={1} value={value} aria-label="مستوى الصوت" className="flex-1 accent-primary"
          onChange={(e) => setValue(Number(e.target.value))}
          onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))} />
        <span className="w-12 text-end font-mono text-sm tabular-nums">{value}%</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={btn} onClick={() => { setValue(0); commit(0); }}>كتم</button>
        <button type="button" className={btn} onClick={() => { setValue(100); commit(100); }}>100%</button>
      </div>
    </div>
  );
};

/** Finds the pauses first and says how much will go, then cuts on confirmation. */
const SilenceControl: React.FC<{ clipId: string; onDone: () => void }> = ({ clipId, onDone }) => {
  const [state, setState] = useState<{ phase: "finding" } | { phase: "found"; regions: Region[] } | { phase: "error"; text: string } | { phase: "cutting" }>({ phase: "finding" });
  useEffect(() => {
    let live = true;
    void findSilences(clipId).then((res) => {
      if (!live) return;
      setState("error" in res ? { phase: "error", text: res.error } : { phase: "found", regions: res.regions });
    });
    return () => { live = false; };
  }, [clipId]);

  if (state.phase === "finding") return <p className="py-4 text-center text-sm text-fg-muted">أدوّر على السكتات…</p>;
  if (state.phase === "cutting") return <p className="py-4 text-center text-sm text-fg-muted">أقص السكتات…</p>;
  if (state.phase === "error") return <p className="py-4 text-center text-sm text-red-400">{state.text}</p>;
  if (!state.regions.length) return <p className="py-4 text-center text-sm text-fg-muted">ما لقيت سكتات في هذه اللقطة.</p>;
  const { regions } = state;
  return (
    <div className="space-y-3">
      <p className="text-sm">لقيت {regions.length} سكتة، مجموعها {silenceTotal(regions)} ثانية.</p>
      <button type="button" className={`${btn} w-full border-primary bg-primary text-primary-foreground`}
        onClick={() => { setState({ phase: "cutting" }); void cutSilences(clipId, regions).then((err) => (err ? setState({ phase: "error", text: err }) : onDone())); }}>
        قصها
      </button>
    </div>
  );
};
