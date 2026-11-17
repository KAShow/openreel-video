/**
 * Phone editor shell: top bar, large preview with one play button, the touch timeline (stage 2),
 * and a bottom tool bar whose tools open as bottom sheets. Rendered by EditorInterface instead of
 * its desktop/compact layout on phones (see phone.ts), after the editor is initialised, so all
 * editor services keep running. While a clip is selected the bottom bar becomes its tools (ClipTools,
 * stage 3). Stage 4 adds the text sheet, captions on the clip under the playhead and the "+" library
 * button. Stage 5: "Export" opens the phone export sheet (PhoneExport) instead of the desktop dialog.
 * Learning from CapCut, stage 1: always dark, line icons, and the play / undo row under the preview
 * instead of over the video. The expand button shows the preview on the whole screen: the element goes
 * full screen where the browser allows it, and on iPhone (which does not) it covers the page.
 */
import React, { Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight, Bot, Captions, Ellipsis, Maximize, Music, Pause, Play, Redo2, Scissors, Sparkles, Type, Undo2, X,
  type LucideIcon,
} from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useRouter } from "../../hooks/use-router";
import { SKIP_WELCOME } from "../simple";
import { Preview } from "../../components/editor/Preview";
import { TouchTimeline } from "./TouchTimeline";
import { ClipTools } from "./ClipTools";
import { selectedTarget } from "./clip-tools";
import { TextComposer } from "./AddSheets";
import { PhoneExport } from "./PhoneExport";
import { useWideEditor } from "./phone";
import { useThemeStore } from "../../stores/theme-store";
import { ThemeToggle } from "../AppearanceControls";
import { Sheet, SIDE_PANEL_WIDTH, useSidePanelOpen } from "./ui";
import { AudioSheet, CaptionsSheet, EditSheet, EffectsSheet, MoreSheet, TransitionsSheet } from "./ToolSheets";

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
  const [fullScreen, setFullScreen] = useState(false);
  const previewBox = useRef<HTMLElement>(null);
  const seekTo = useTimelineStore((s) => s.seekTo);
  const pause = useTimelineStore((s) => s.pause);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const wide = useWideEditor();
  const sidePanel = useSidePanelOpen();
  const isDark = useThemeStore((s) => s.isDark);
  // Selecting a clip shows its own tools; the main sheet closes so the two never stack.
  useEffect(() => { if (clipSelected) setSheet(null); }, [clipSelected]);

  const enterFullScreen = () => {
    clearSelection();
    setFullScreen(true);
    previewBox.current?.requestFullscreen?.().catch(() => undefined);
  };
  const leaveFullScreen = () => {
    setFullScreen(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  };
  // The Android back button and Esc leave the browser's full screen without going through our button.
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFullScreen(false); };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return (
    <div className={`hawsh-mobile ${isDark ? "dark" : "hawsh-light"} flex h-full w-full flex-col overflow-hidden bg-[var(--chrome)] text-fg`} data-testid="hawsh-mobile-editor">

      <header className="flex h-12 shrink-0 items-center gap-2 px-3" dir="rtl" data-no-translate="">
        {SKIP_WELCOME ? <span className="h-10 w-10" aria-hidden /> : (
          <button type="button" aria-label="رجوع" onClick={() => navigate("welcome")} className="grid h-10 w-10 place-items-center rounded-full text-lg">→</button>
        )}
        <div className="min-w-0 flex-1 truncate text-center text-sm font-semibold" dir="auto">{projectName}</div>
        <ThemeToggle className="active:bg-[var(--wash)]" />
        <button type="button" onClick={() => setExporting(true)} className="h-9 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground">تصدير</button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col transition-[padding] duration-200" style={{ paddingRight: wide && sidePanel ? SIDE_PANEL_WIDTH : 0 }}>
      <section ref={previewBox} aria-label="المعاينة" data-testid="phone-preview"
        className={fullScreen ? "fixed inset-0 z-[95] bg-black" : `relative min-h-0 shrink-0 bg-[var(--stage)] ${wide ? "basis-[52%]" : "basis-[44%]"}`}>
        <div className={`h-full w-full ${fullScreen ? "pointer-events-none pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]" : ""}`}>
          <Preview hideControls />
        </div>
        {fullScreen && (
          <>
            <button type="button" aria-label="إغلاق الشاشة الكاملة" onClick={leaveFullScreen}
              className="absolute end-3 top-[calc(0.75rem+env(safe-area-inset-top))] grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white">
              <X size={22} />
            </button>
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-black px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 text-white" dir="ltr" data-no-translate="">
              <button type="button" aria-label={playing ? "إيقاف" : "تشغيل"} onClick={togglePlayback} className="grid h-10 w-10 shrink-0 place-items-center rounded-full active:bg-white/10">
                {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
              </button>
              <input type="range" min={0} max={Math.max(duration, 0.01)} step={0.01} value={Math.min(playhead, duration)} aria-label="موضع التشغيل"
                onPointerDown={() => { if (playing) pause(); }} onChange={(e) => seekTo(Number(e.target.value))}
                className="min-w-0 flex-1 accent-primary" />
              <span className="shrink-0 font-mono text-xs tabular-nums">{fmt(playhead)}<span className="text-fg-muted"> / {fmt(duration)}</span></span>
            </div>
          </>
        )}
      </section>
      <div className="flex h-11 shrink-0 items-center justify-between bg-[var(--chrome)] px-4 text-[var(--on-chrome)]" dir="ltr">
        <span className="w-32 font-mono text-xs tabular-nums"><span>{fmt(playhead)}</span><span className="text-fg-muted"> / {fmt(duration)}</span></span>
        <button type="button" aria-label={playing ? "إيقاف" : "تشغيل"} onClick={togglePlayback} className="grid h-10 w-10 place-items-center rounded-full active:bg-[var(--wash)]">
          {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
        </button>
        <div className="flex w-32 items-center justify-end gap-1">
          <UndoRedo />
          <button type="button" aria-label="شاشة كاملة" onClick={enterFullScreen} className="grid h-9 w-9 place-items-center rounded-full active:bg-[var(--wash)]">
            <Maximize size={20} />
          </button>
        </div>
      </div>

      <section className="relative min-h-0 flex-1 overflow-hidden border-t border-[var(--line)] bg-bg" aria-label="الخط الزمني">
        <TouchTimeline onAddText={() => setSheet("text")} />
      </section>
      </div>

      {clipSelected ? <ClipTools /> : (
      <nav className="flex h-16 shrink-0 justify-center bg-[var(--chrome)] pb-[env(safe-area-inset-bottom)]" dir="rtl" data-no-translate="" aria-label="أدوات المونتاج">
        <div className="flex w-full max-w-3xl items-stretch">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" onClick={() => setSheet(sheet === t.id ? null : t.id)}
            aria-pressed={sheet === t.id}
            className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-fg ${sheet === t.id ? "font-bold" : ""}`}>
            <span className={`grid h-7 w-12 place-items-center rounded-full ${sheet === t.id ? "bg-primary text-primary-foreground" : ""}`}>
              <t.icon size={21} strokeWidth={1.7} aria-hidden />
            </span>
            {t.label}
          </button>
        ))}
        </div>
      </nav>
      )}

      {current && current.id === "assistant" && (
        <Sheet bare title={current.label} onClose={() => setSheet(null)} bodyClassName="p-0">
          <Suspense fallback={<div className="p-4 text-center text-xs text-fg-muted">…</div>}>
            <ChatPanel onClose={() => setSheet(null)} />
          </Suspense>
        </Sheet>
      )}
      {current && current.id !== "assistant" && (
        <Sheet title={current.label} onClose={() => setSheet(null)}>
          {sheet === "captions" && <CaptionsSheet />}
          {sheet === "text" && <TextComposer onDone={() => setSheet(null)} />}
          {sheet === "transitions" && <TransitionsSheet />}
          {sheet === "effects" && <EffectsSheet />}
          {sheet === "audio" && <AudioSheet />}
          {sheet === "edit" && <EditSheet onClose={() => setSheet(null)} />}
          {sheet === "more" && <MoreSheet onOpenAssistant={() => setSheet("assistant")} />}
        </Sheet>
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
  const btn = "grid h-9 w-9 place-items-center rounded-full active:bg-[var(--wash)] disabled:opacity-30";
  return (
    <div className="flex justify-end gap-1" data-testid="undo-redo">
      <button type="button" aria-label="تراجع" className={btn} disabled={!canUndo()} onClick={() => void undo()}><Undo2 size={22} strokeWidth={1.6} /></button>
      <button type="button" aria-label="إعادة" className={btn} disabled={!canRedo()} onClick={() => void redo()}><Redo2 size={22} strokeWidth={1.6} /></button>
    </div>
  );
};
