/**
 * Phone touch timeline (stage 2), CapCut-style: the playhead is fixed in the middle and the clips
 * scroll under it with a finger — scrolling scrubs, playing scrolls. Tap a clip to select it, tap
 * empty space to clear. Reads the same stores as the desktop timeline; edits come in stage 3.
 * A selected clip gets white handles on both edges: drag one inward to trim that side (one trim on
 * release, through the same trimAt as the trim sheet).
 * Learning from CapCut, stage 2: video clips show a strip of frames, the white "+" sits at the end of
 * the main track, empty "+ add text" / "+ add audio" lanes invite the next step, the ruler reads 00:00,
 * and a clip that is not at 1× shows its speed.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { frameAt, timelineRows, type RowClip, type RowKind } from "./rows";
import { edgeCutTime, selectedTarget, trimAt } from "./clip-tools";
import { AddMediaButton } from "./AddSheets";
import { importFiles, mainTrack } from "./add-tools";

type Side = "start" | "end";
interface Drag { id: string; side: Side; x0: number; dx: number }
/** Trim handles: a slim white bar on the clip edge, inside a wider invisible touch area. */
const HANDLE = 26;
const HANDLE_BAR = 10;

export const PIXELS_PER_SECOND = 56;
const ROW_HEIGHT: Record<RowKind, number> = { video: 56, text: 30, audio: 26 };
const ADD_SIZE = 44;

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

/** Frames along a video clip, one square tile per tile width, each from the source time under it. */
const Filmstrip: React.FC<{ clip: RowClip; shownStart: number; width: number }> = ({ clip, shownStart, width }) => {
  const tile = ROW_HEIGHT.video;
  const tiles = Math.max(1, Math.ceil(width / tile));
  return (
    <span className="pointer-events-none absolute inset-0 flex overflow-hidden" aria-hidden>
      {Array.from({ length: tiles }, (_, i) => {
        const source = clip.inPoint + ((shownStart - clip.start) + (i * tile + tile / 2) / PIXELS_PER_SECOND) * clip.speed;
        const url = frameAt(clip.frames, source) ?? clip.thumb;
        return url
          ? <img key={i} src={url} alt="" draggable={false} className="h-full shrink-0 object-cover" style={{ width: tile }} />
          : <span key={i} className="h-full shrink-0 bg-bg-3" style={{ width: tile }} />;
      })}
    </span>
  );
};

/** Full-length lane inviting a first text or audio clip; its label sticks under the playhead. */
const AddLane: React.FC<{ label: string; half: number; width: number; height: number; onClick: () => void }> = ({ label, half, width, height, onClick }) => (
  <div className="relative" style={{ height }}>
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="absolute top-0 h-full rounded-md bg-white/[0.06] text-start text-xs text-fg-2 active:bg-white/10"
      style={{ left: half, width }}>
      <span className="sticky inline-flex h-full items-center gap-1 px-2" style={{ left: half }} dir="rtl">
        <Plus size={14} aria-hidden />{label}
      </span>
    </button>
  </div>
);

export const TouchTimeline: React.FC<{ onAddText: () => void }> = ({ onAddText }) => {
  const project = useProjectStore((s) => s.project);
  const duration = project.timeline?.duration ?? 0;
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const playing = useTimelineStore((s) => s.playbackState === "playing");
  const seekTo = useTimelineStore((s) => s.seekTo);
  const pause = useTimelineStore((s) => s.pause);
  const selected = useUIStore((s) => s.selectedItems);
  const select = useUIStore((s) => s.select);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const rows = useMemo(() => timelineRows(project), [project]);

  const scroller = useRef<HTMLDivElement>(null);
  const programmatic = useRef(-1);
  const [half, setHalf] = useState(180);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setHalf(el.clientWidth / 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Playhead (playing, seeks from elsewhere) → scroll position.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = playhead * PIXELS_PER_SECOND;
    if (Math.abs(el.scrollLeft - x) < 1) return;
    programmatic.current = x;
    el.scrollLeft = x;
  }, [playhead, half]);

  // Finger scroll → playhead.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    if (programmatic.current >= 0 && Math.abs(el.scrollLeft - programmatic.current) < 2) return;
    programmatic.current = -1;
    if (playing) pause();
    seekTo(Math.min(duration, Math.max(0, el.scrollLeft / PIXELS_PER_SECOND)));
  };

  // Edge-handle trim. The ref keeps pointer handlers in step between renders.
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const cutFor = (c: RowClip, d: Drag) => edgeCutTime(c.start, c.duration, d.side, d.dx / PIXELS_PER_SECOND);
  const shown = (c: RowClip) => {
    const cut = drag?.id === c.id ? cutFor(c, drag) : null;
    if (cut === null || !drag) return { start: c.start, duration: c.duration };
    return drag.side === "start" ? { start: cut, duration: c.start + c.duration - cut } : { start: c.start, duration: cut - c.start };
  };
  const startDrag = (e: React.PointerEvent<HTMLElement>, id: string, side: Side) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (playing) pause();
    dragRef.current = { id, side, x0: e.clientX, dx: 0 };
    setDrag(dragRef.current);
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = { ...dragRef.current, dx: e.clientX - dragRef.current.x0 };
    setDrag(dragRef.current);
  };
  const endDrag = (c: RowClip) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    const cut = d ? cutFor(c, d) : null;
    if (!d || cut === null) return;
    const target = selectedTarget(useProjectStore.getState().project, [{ type: c.selection, id: c.id }]);
    if (target) void trimAt(target, cut, d.side);
  };

  const width = duration * PIXELS_PER_SECOND + half * 2;
  const isSelected = (id: string) => selected.some((s) => s.id === id);
  const ticks = Array.from({ length: Math.floor(duration) + 1 }, (_, i) => i);

  // The white "+" follows the end of the main track (where new clips land), clear of a trim handle.
  const mainId = mainTrack(project)?.id;
  const mainRow = rows.find((r) => r.kind === "video" && r.trackId === mainId) ?? rows.find((r) => r.kind === "video");
  const mainEnd = mainRow ? Math.max(...mainRow.clips.map((c) => { const s = shown(c); return s.start + s.duration; })) : 0;
  const addStyle = (rowHeight: number): React.CSSProperties => ({
    left: half + mainEnd * PIXELS_PER_SECOND + (mainRow ? HANDLE + 4 : 4), top: (rowHeight - ADD_SIZE) / 2, width: ADD_SIZE, height: ADD_SIZE,
  });
  const laneWidth = Math.max(duration * PIXELS_PER_SECOND, 150);
  const audioInput = useRef<HTMLInputElement>(null);

  return (
    <div className="relative h-full w-full select-none bg-bg" dir="ltr" data-testid="touch-timeline" data-no-translate="">
      <div ref={scroller} onScroll={onScroll} onClick={() => clearSelection()}
        className="h-full w-full overflow-x-auto overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: "pan-x pan-y" }}>
        <div className="relative" style={{ width, minHeight: "100%" }}>
          <div className="relative h-6 text-[10px] text-fg-muted" aria-hidden>
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 flex h-full -translate-x-1/2 items-center" style={{ left: half + t * PIXELS_PER_SECOND }}>
                {t % 2 === 0 ? <span className="tabular-nums">{mmss(t)}</span> : <span className="h-1 w-1 rounded-full bg-fg-muted" />}
              </div>
            ))}
          </div>
          <div className="space-y-1.5 py-2">
            {rows.map((row) => (
              <div key={`${row.trackId}-${row.kind}`} className="relative" style={{ height: ROW_HEIGHT[row.kind] }}>
                {row.clips.map((c) => {
                  const s = shown(c);
                  const left = half + s.start * PIXELS_PER_SECOND;
                  const w = Math.max(8, s.duration * PIXELS_PER_SECOND - 2);
                  return (
                    <React.Fragment key={c.id}>
                      <button type="button" title={c.label}
                        onClick={(e) => { e.stopPropagation(); select({ type: c.selection, id: c.id, trackId: row.trackId }); }}
                        className={`absolute top-0 h-full overflow-hidden rounded-md border-2 text-start ${isSelected(c.id) ? "border-white" : "border-transparent"} ${
                          row.kind === "video" ? "bg-bg-3" : row.kind === "text" ? "bg-amber-500/80" : "bg-teal-500/70"}`}
                        style={{ left, width: w }}>
                        {row.kind === "video" && <Filmstrip clip={c} shownStart={s.start} width={w} />}
                        {row.kind === "video" && Math.abs(c.speed - 1) > 0.001 && (
                          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold tabular-nums text-white">{c.speed}×</span>
                        )}
                        {row.kind !== "video" && (
                          <span className="block truncate px-1.5 text-[11px] font-medium leading-[26px] text-black" dir="auto">{c.label}</span>
                        )}
                        {drag?.id === c.id && (
                          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/75 px-1.5 text-[11px] font-bold tabular-nums text-white" dir="rtl">
                            {s.duration.toFixed(1)}ث
                          </span>
                        )}
                      </button>
                      {isSelected(c.id) && selected.length === 1 && (["start", "end"] as const).map((side) => (
                        <button key={side} type="button" aria-label={side === "start" ? "اسحب لقص البداية" : "اسحب لقص النهاية"}
                          data-testid={`trim-handle-${side}`}
                          onPointerDown={(e) => startDrag(e, c.id, side)} onPointerMove={moveDrag}
                          onPointerUp={() => endDrag(c)} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
                          onClick={(e) => e.stopPropagation()}
                          className={`absolute top-0 z-10 flex h-full items-stretch ${side === "start" ? "justify-end" : "justify-start"}`}
                          style={{ left: side === "start" ? left - HANDLE + 2 : left + w - 2, width: HANDLE, touchAction: "none" }}>
                          <span className={`flex items-center justify-center bg-white ${side === "start" ? "rounded-l-md" : "rounded-r-md"}`} style={{ width: HANDLE_BAR }} aria-hidden>
                            <span className="h-3 w-px bg-black/60" />
                          </span>
                        </button>
                      ))}
                    </React.Fragment>
                  );
                })}
                {row === mainRow && <AddMediaButton style={addStyle(ROW_HEIGHT.video)} />}
              </div>
            ))}
            {!mainRow && (
              <div className="relative" style={{ height: ROW_HEIGHT.video }}><AddMediaButton style={addStyle(ROW_HEIGHT.video)} /></div>
            )}
            {rows.length > 0 && !rows.some((r) => r.kind === "text") && (
              <AddLane label="أضف نص" half={half} width={laneWidth} height={ROW_HEIGHT.text} onClick={onAddText} />
            )}
            {rows.length > 0 && !rows.some((r) => r.kind === "audio") && (
              <AddLane label="أضف صوت" half={half} width={laneWidth} height={ROW_HEIGHT.text} onClick={() => audioInput.current?.click()} />
            )}
            {rows.length === 0 && (
              <p className="sticky left-0 px-4 py-4 text-center text-xs text-fg-muted" dir="rtl" data-no-translate="" style={{ width: half * 2 }}>
                اضغط + وأضف لقطات من جهازك أو من مكتبة عيون المخرج.
              </p>
            )}
          </div>
        </div>
      </div>
      <input ref={audioInput} type="file" accept="audio/*" multiple hidden data-testid="add-audio-file"
        onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void importFiles(files); }} />
      {/* Fixed playhead in the middle. */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" aria-hidden />
    </div>
  );
};
