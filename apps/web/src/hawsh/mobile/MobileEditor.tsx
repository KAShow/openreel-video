/**
 * Phone editor shell: top bar, large preview with one play button, the touch timeline (stage 2),
 * and a bottom tool bar whose tools open as bottom sheets. Rendered by EditorInterface instead of
 * its desktop/compact layout on phones (see phone.ts), after the editor is initialised, so all
 * editor services keep running. While a clip is selected the bottom bar becomes its tools (ClipTools,
 * stage 3). Stage 4 adds the text sheet, captions on the clip under the playhead and the "+" library
 * button. Stage 5: "Export" opens the phone export sheet (PhoneExport) instead of the desktop dialog.
 * Learning from CapCut, stage 1: always dark, line icons, and the play / undo row under the preview
 * instead of over the video.
 */
import React, { Suspense, useState } from "react";
import {
  ArrowLeftRight, Bot, Captions, Ellipsis, Music, Pause, Play, Redo2, Scissors, Sparkles, Type, Undo2, X,
  type LucideIcon,
} from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useRouter } from "../../hooks/use-router";
import { SKIP_WELCOME } from "../simple";
import { Preview } from "../../components/editor/Preview";
import { ServerCaptionPanel } from "../ServerCaptionPanel";
import { TouchTimeline } from "./TouchTimeline";
import { ClipTools } from "./ClipTools";
import { selectedTarget } from "./clip-tools";
import { AddMediaButton, TextComposer } from "./AddSheets";
import { captionClipId } from "./add-tools";
import { PhoneExport } from "./PhoneExport";

const ChatPanel = React.lazy(() => import("../../components/editor/chat/ChatPanel").then((m) => ({ default: m.ChatPanel })));

type SheetId = "edit" | "audio" | "text" | "captions" | "effects" | "transitions" | "assistant" | "more";

const TOOLS: { id: SheetId; label: string; icon: LucideIcon }[] = [
  { id: "edit", label: "تعديل", icon: Scissors },
  { id: "audio", label: "صوت", icon: Music },
  { id: "text", label: "نص", icon: Type },
  { id: "captions", label: "ترجمة", icon: Captions },
  { id: "effects", label: "مؤثرات", icon: Sparkles },
  { id: "transitions", label: "انتقالات", icon: ArrowLeftRight },
  { id: "assistant", label: "مساعد", icon: Bot },
  { id: "more", label: "المزيد", icon: Ellipsis },
];

const fmt = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const MobileEditor: React.FC = () => {
  const { navigate } = useRouter();
  const projectName = useProjectStore((s) => s.project.name);
  const duration = useProjectStore((s) => s.project.timeline?.duration ?? 0);
  const playing = useTimelineStore((s) => s.playbackState === "playing");
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const togglePlayback = useTimelineStore((s) => s.togglePlayback);
  const project = useProjectStore((s) => s.project);
  const selectedItems = useUIStore((s) => s.selectedItems);
  const clipSelected = selectedTarget(project, selectedItems) !== null;
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [exporting, setExporting] = useState(false);
  const current = TOOLS.find((t) => t.id === sheet);

  return (
    <div className="hawsh-mobile dark flex h-full w-full flex-col overflow-hidden bg-black text-fg" data-testid="hawsh-mobile-editor">

      <header className="flex h-12 shrink-0 items-center gap-2 px-3" dir="rtl" data-no-translate="">
        {SKIP_WELCOME ? <span className="h-10 w-10" aria-hidden /> : (
          <button type="button" aria-label="رجوع" onClick={() => navigate("welcome")} className="grid h-10 w-10 place-items-center rounded-full text-lg">→</button>
        )}
        <div className="min-w-0 flex-1 truncate text-center text-sm font-semibold" dir="auto">{projectName}</div>
        <button type="button" onClick={() => setExporting(true)} className="h-9 rounded-full bg-primary px-4 text-sm font-bold text-white">تصدير</button>
      </header>

      <section className="relative min-h-0 shrink-0 basis-[44%] bg-black" aria-label="المعاينة">
        <Preview hideControls />
      </section>
      <div className="flex h-11 shrink-0 items-center justify-between bg-black px-4 text-white" dir="ltr">
        <span className="w-24 font-mono text-xs tabular-nums"><span>{fmt(playhead)}</span><span className="text-fg-muted"> / {fmt(duration)}</span></span>
        <button type="button" aria-label={playing ? "إيقاف" : "تشغيل"} onClick={togglePlayback} className="grid h-10 w-10 place-items-center rounded-full active:bg-white/10">
          {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
        </button>
        <UndoRedo />
      </div>

      <section className="relative min-h-0 flex-1 overflow-hidden border-t border-white/10 bg-bg" aria-label="الخط الزمني">
        <TouchTimeline />
        <AddMediaButton />
      </section>

      {clipSelected ? <ClipTools /> : (
      <nav className="flex h-16 shrink-0 items-stretch bg-black pb-[env(safe-area-inset-bottom)]" dir="rtl" data-no-translate="" aria-label="أدوات المونتاج">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" onClick={() => setSheet(t.id)}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] ${sheet === t.id ? "text-primary" : "text-fg"}`}>
            <t.icon size={22} strokeWidth={1.6} aria-hidden />
            {t.label}
          </button>
        ))}
      </nav>
      )}

      {current && (
        <div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/40" onClick={() => setSheet(null)}>
          <div role="dialog" aria-modal="true" aria-label={current.label} onClick={(e) => e.stopPropagation()}
            className="flex max-h-[70%] min-h-[40%] flex-col rounded-t-2xl border-t border-border bg-bg shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3" dir="rtl" data-no-translate="">
              <span className="text-sm font-bold">{current.label}</span>
              <button type="button" aria-label="إغلاق" onClick={() => setSheet(null)} className="grid h-8 w-8 place-items-center rounded-full"><X size={20} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {sheet === "captions" && (
                <ServerCaptionPanel clipId={captionClipId(project, playhead)} buttonLabel="فرّغ المقطع اللي تحت المؤشر" emptyHint="أضف فيديو فيه كلام أولاً." />
              )}
              {sheet === "text" && <TextComposer onDone={() => setSheet(null)} />}
              {sheet === "assistant" && (
                <div className="h-[55vh]">
                  <Suspense fallback={<div className="p-4 text-center text-xs text-fg-muted">…</div>}>
                    <ChatPanel onClose={() => setSheet(null)} />
                  </Suspense>
                </div>
              )}
              {sheet !== "captions" && sheet !== "assistant" && sheet !== "text" && (
                <p className="py-8 text-center text-sm text-fg-muted" dir="rtl" data-no-translate="">هذه الأداة تُضاف في المرحلة القادمة.</p>
              )}
            </div>
          </div>
        </div>
      )}
      {exporting && <PhoneExport onClose={() => setExporting(false)} />}
    </div>
  );
};

/** Undo / redo for the phone (the desktop has keyboard shortcuts and the toolbar). */
const UndoRedo: React.FC = () => {
  // Re-render on every project change so the enabled state follows the history.
  useProjectStore((s) => s.project);
  const { undo, redo, canUndo, canRedo } = useProjectStore.getState();
  const btn = "grid h-9 w-9 place-items-center rounded-full active:bg-white/10 disabled:opacity-30";
  return (
    <div className="flex w-24 justify-end gap-1" data-testid="undo-redo">
      <button type="button" aria-label="تراجع" className={btn} disabled={!canUndo()} onClick={() => void undo()}><Undo2 size={22} strokeWidth={1.6} /></button>
      <button type="button" aria-label="إعادة" className={btn} disabled={!canRedo()} onClick={() => void redo()}><Redo2 size={22} strokeWidth={1.6} /></button>
    </div>
  );
};
