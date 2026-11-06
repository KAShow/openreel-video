/**
 * Phone touch timeline (stage 2), CapCut-style: the playhead is fixed in the middle and the clips
 * scroll under it with a finger — scrolling scrubs, playing scrolls. Tap a clip to select it, tap
 * empty space to clear. Reads the same stores as the desktop timeline; edits come in stage 3.
 * A selected clip gets white handles on both edges: drag one inward to trim that side (one trim on
 * release, through the same trimAt as the trim sheet).
 * Press and hold a clip, then drag, to move it earlier or later (reorder.ts): the clips on its row make
 * room as it goes, a dashed slot shows where it would land, a plain swipe still scrolls, and an edge of
 * the screen scrolls the timeline along.
 * Learning from CapCut, stage 2: video clips show a strip of frames, the white "+" sits at the end of
 * the main track, empty "+ add text" / "+ add audio" lanes invite the next step, the ruler reads 00:00,
 * and a clip that is not at 1× shows its speed.
 * Two fingers or the − / + buttons zoom the timeline around the playhead (zoom.ts).
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { frameAt, timelineRows, type RowClip, type RowKind } from "./rows";
import { edgeCutTime, selectedTarget, trimAt } from "./clip-tools";
import { AddMediaButton } from "./AddSheets";
import { importFiles, mainTrack } from "./add-tools";
import { moveOnTrack, reorderPlan, type Slot } from "../reorder";
import { toast } from "../../stores/notification-store";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, ZOOM_STEP, clampZoom, pinchZoom, rulerStep } from "./zoom";

type Side = "start" | "end";
interface Drag { id: string; side: Side; x0: number; dx: number }
/** Trim handles: a slim white bar on the clip edge, inside a wider invisible touch area. */
const HANDLE = 26;
const HANDLE_BAR = 10;

interface Moving { id: string; rowKey: string; selection: RowClip["selection"]; origin: number; free: boolean; x0: number; scroll0: number; dx: number }
const LONG_PRESS_MS = 180;
/** A finger that travels this far before the long press fires is a scroll. */
const PRESS_SLOP = 8;
const EDGE_ZONE = 48;
const EDGE_SPEED = 6;
const rowKey = (r: { trackId: string; kind: RowKind }) => `${r.trackId}-${r.kind}`;

const ROW_HEIGHT: Record<RowKind, number> = { video: 56, text: 30, audio: 26 };
const ADD_SIZE = 44;

const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

/** Frames along a video clip, one square tile per tile width, each from the source time under it. */
const Filmstrip: React.FC<{ clip: RowClip; shownStart: number; width: number; zoom: number }> = ({ clip, shownStart, width, zoom }) => {
  const tile = ROW_HEIGHT.video;
  const tiles = Math.max(1, Math.ceil(width / tile));
  return (
    <span className="pointer-events-none absolute inset-0 flex overflow-hidden" aria-hidden>
      {Array.from({ length: tiles }, (_, i) => {
        const source = clip.inPoint + ((shownStart - clip.start) + (i * tile + tile / 2) / zoom) * clip.speed;
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
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pinch = useRef<{ zoom: number; distance: number } | null>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setHalf(el.clientWidth / 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Playhead (playing, seeks from elsewhere, zoom) → scroll position. Before paint, so a zoom never
  // shows the wrong spot under the playhead.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = playhead * zoom;
    if (Math.abs(el.scrollLeft - x) < 1) return;
    programmatic.current = x;
    el.scrollLeft = x;
  }, [playhead, half, zoom]);

  // Finger scroll → playhead.
  const onScroll = () => {
    const el = scroller.current;
    if (!el || pinch.current) return;
    if (programmatic.current >= 0 && Math.abs(el.scrollLeft - programmatic.current) < 2) return;
    programmatic.current = -1;
    if (playing) pause();
    seekTo(Math.min(duration, Math.max(0, el.scrollLeft / zoom)));
  };

  // Long press, then drag: move the clip earlier or later.
  const pressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressAt = useRef({ x: 0, y: 0 });
  const movingRef = useRef<Moving | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const fingerX = useRef(0);
  const swallowClick = useRef(false);
  const mainId = mainTrack(project)?.id;

  const clearPress = () => {
    if (pressRef.current) clearTimeout(pressRef.current);
    pressRef.current = null;
  };
  const syncMove = () => {
    const m = movingRef.current;
    const el = scroller.current;
    if (!m || !el) return;
    movingRef.current = { ...m, dx: fingerX.current - m.x0 + el.scrollLeft - m.scroll0 };
    setMoving(movingRef.current);
  };
  const pressClip = (e: React.PointerEvent<HTMLElement>, c: RowClip, row: { trackId: string; kind: RowKind }) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const { pointerId, clientX, clientY } = e;
    pressAt.current = { x: clientX, y: clientY };
    fingerX.current = clientX;
    clearPress();
    pressRef.current = setTimeout(() => {
      pressRef.current = null;
      if (playing) pause();
      try { el.setPointerCapture(pointerId); } catch { /* the finger already lifted */ }
      select({ type: c.selection, id: c.id, trackId: row.trackId });
      swallowClick.current = true;
      navigator.vibrate?.(15);
      movingRef.current = {
        id: c.id, rowKey: rowKey(row), selection: c.selection, origin: c.start,
        free: !(row.kind === "video" && row.trackId === mainId),
        x0: fingerX.current, scroll0: scroller.current?.scrollLeft ?? 0, dx: 0,
      };
      setMoving(movingRef.current);
    }, LONG_PRESS_MS);
  };
  const moveFinger = (e: React.PointerEvent) => {
    fingerX.current = e.clientX;
    if (pressRef.current && Math.hypot(e.clientX - pressAt.current.x, e.clientY - pressAt.current.y) > PRESS_SLOP) clearPress();
    syncMove();
  };
  const dropStart = (m: Moving) => Math.max(0, m.origin + m.dx / zoom);
  const slotsOf = (key: string): Slot[] => (rows.find((r) => rowKey(r) === key)?.clips ?? []).map((c) => ({ id: c.id, start: c.start, duration: c.duration }));
  const liftFinger = () => {
    clearPress();
    const m = movingRef.current;
    movingRef.current = null;
    setMoving(null);
    if (!m) return;
    const drop = dropStart(m);
    if (m.selection === "text-clip") {
      if (Math.abs(drop - m.origin) > 0.001) useProjectStore.getState().updateOverlayClipTiming(m.id, { startTime: drop });
      return;
    }
    void moveOnTrack(slotsOf(m.rowKey), m.id, drop, m.free).then((ok) => { if (!ok) toast.error("تعذّر نقل اللقطة"); });
  };
  const cancelFinger = () => {
    clearPress();
    movingRef.current = null;
    setMoving(null);
  };
  const isMoving = moving !== null;

  // Once a clip is lifted the finger drags it, not the timeline. Two fingers elsewhere zoom it.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const start = (ev: TouchEvent) => {
      if (ev.touches.length !== 2 || movingRef.current || dragRef.current) return;
      clearPress();
      pinch.current = { zoom: zoomRef.current, distance: distance(ev.touches) };
    };
    const move = (ev: TouchEvent) => {
      if (movingRef.current) { ev.preventDefault(); return; }
      if (!pinch.current || ev.touches.length < 2) return;
      if (ev.cancelable) ev.preventDefault();
      setZoom(pinchZoom(pinch.current.zoom, pinch.current.distance, distance(ev.touches)));
    };
    const end = (ev: TouchEvent) => { if (ev.touches.length < 2) pinch.current = null; };
    // Safari zooms the whole page on a pinch unless told not to.
    const stopPageZoom = (ev: Event) => ev.preventDefault();
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("gesturestart", stopPageZoom);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("gesturestart", stopPageZoom);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A finger held at a screen edge scrolls the timeline, so a clip can travel past what is visible.
  useEffect(() => {
    if (!isMoving) return;
    let frame = requestAnimationFrame(function tick() {
      const el = scroller.current;
      if (el) {
        const box = el.getBoundingClientRect();
        const step = fingerX.current < box.left + EDGE_ZONE ? -EDGE_SPEED : fingerX.current > box.right - EDGE_ZONE ? EDGE_SPEED : 0;
        if (step) { el.scrollLeft += step; syncMove(); }
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMoving]);

  const plan = useMemo(() => {
    if (!moving || moving.selection === "text-clip") return new Map<string, number>();
    return new Map(reorderPlan(slotsOf(moving.rowKey), moving.id, dropStart(moving), moving.free).map((x) => [x.id, x.start]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, rows]);

  // Edge-handle trim. The ref keeps pointer handlers in step between renders.
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const cutFor = (c: RowClip, d: Drag) => edgeCutTime(c.start, c.duration, d.side, d.dx / zoom);
  const shown = (c: RowClip) => {
    if (moving?.id === c.id) return { start: dropStart(moving), duration: c.duration };
    const planned = moving ? plan.get(c.id) : undefined;
    if (planned !== undefined) return { start: planned, duration: c.duration };
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

  const width = duration * zoom + half * 2;
  const isSelected = (id: string) => selected.some((s) => s.id === id);
  const labelStep = rulerStep(zoom);
  const ticks = Array.from({ length: Math.floor((duration * 2) / labelStep) + 1 }, (_, i) => (i * labelStep) / 2);

  // The white "+" follows the end of the main track (where new clips land), clear of a trim handle.
  const mainRow = rows.find((r) => r.kind === "video" && r.trackId === mainId) ?? rows.find((r) => r.kind === "video");
  const mainEnd = mainRow ? Math.max(...mainRow.clips.map((c) => { const s = shown(c); return s.start + s.duration; })) : 0;
  const addStyle = (rowHeight: number): React.CSSProperties => ({
    left: half + mainEnd * zoom + (mainRow ? HANDLE + 4 : 4), top: (rowHeight - ADD_SIZE) / 2, width: ADD_SIZE, height: ADD_SIZE,
  });
  const laneWidth = Math.max(duration * zoom, 150);
  const audioInput = useRef<HTMLInputElement>(null);

  return (
    <div className="relative h-full w-full select-none bg-bg" dir="ltr" data-testid="touch-timeline" data-no-translate="">
      <div ref={scroller} onScroll={onScroll} onClick={() => clearSelection()}
        className="h-full w-full overflow-x-auto overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ touchAction: "pan-x pan-y" }}>
        <div className="relative" style={{ width, minHeight: "100%" }}>
          <div className="relative h-6 text-[10px] text-fg-muted" aria-hidden>
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 flex h-full -translate-x-1/2 items-center" style={{ left: half + t * zoom }}>
                {t % labelStep === 0 ? <span className="tabular-nums">{mmss(t)}</span> : <span className="h-1 w-1 rounded-full bg-fg-muted" />}
              </div>
            ))}
          </div>
          <div className="space-y-1.5 py-2">
            {rows.map((row) => (
              <div key={`${row.trackId}-${row.kind}`} className="relative" style={{ height: ROW_HEIGHT[row.kind] }}>
                {row.clips.map((c) => {
                  const s = shown(c);
                  const left = half + s.start * zoom;
                  const w = Math.max(8, s.duration * zoom - 2);
                  return (
                    <React.Fragment key={c.id}>
                      <button type="button" title={c.label} data-testid="timeline-clip"
                        onPointerDown={(e) => pressClip(e, c, row)} onPointerMove={moveFinger}
                        onPointerUp={liftFinger} onPointerCancel={cancelFinger} onContextMenu={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (swallowClick.current) { swallowClick.current = false; return; }
                          select({ type: c.selection, id: c.id, trackId: row.trackId });
                        }}
                        className={`absolute top-0 h-full overflow-hidden rounded-md border-2 text-start [-webkit-touch-callout:none] ${isSelected(c.id) ? "border-white" : "border-transparent"} ${
                          row.kind === "video" ? "bg-bg-3" : row.kind === "text" ? "bg-amber-500/80" : "bg-teal-500/70"} ${
                          moving?.id === c.id ? "z-20 -translate-y-1.5 opacity-60 shadow-xl ring-2 ring-white" : moving ? "transition-[left] duration-150" : ""}`}
                        style={{ left, width: w }}>
                        {row.kind === "video" && <Filmstrip clip={c} shownStart={s.start} width={w} zoom={zoom} />}
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
                      {!moving && isSelected(c.id) && selected.length === 1 && (["start", "end"] as const).map((side) => (
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
                {moving?.rowKey === rowKey(row) && plan.has(moving.id) && (() => {
                  const dragged = row.clips.find((c) => c.id === moving.id);
                  const slot = plan.get(moving.id);
                  if (!dragged || slot === undefined) return null;
                  return (
                    <span data-testid="drop-slot" aria-hidden
                      className="pointer-events-none absolute top-0 z-30 h-full rounded-md border-2 border-dashed border-primary bg-primary/30 transition-[left] duration-150"
                      style={{ left: half + slot * zoom, width: Math.max(8, dragged.duration * zoom - 2) }} />
                  );
                })()}
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
      {!moving && (
        <div className="absolute bottom-2 right-2 z-30 flex overflow-hidden rounded-full bg-black/70 text-white" data-testid="timeline-zoom">
          <button type="button" aria-label="تصغير الخط الزمني" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(clampZoom(zoom / ZOOM_STEP))}
            className="grid h-9 w-9 place-items-center active:bg-white/10 disabled:opacity-30"><Minus size={16} aria-hidden /></button>
          <button type="button" aria-label="تكبير الخط الزمني" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(clampZoom(zoom * ZOOM_STEP))}
            className="grid h-9 w-9 place-items-center active:bg-white/10 disabled:opacity-30"><Plus size={16} aria-hidden /></button>
        </div>
      )}
    </div>
  );
};
