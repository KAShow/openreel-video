/**
 * Wraps the phone preview so the picture can be zoomed and moved (Hawsh build): two-finger pinch,
 * the mouse wheel or a trackpad pinch on a computer, one finger or the mouse to drag the selected
 * clip, and a double tap to put it back. The maths is in preview-gesture.ts. Every gesture is one undo
 * step and goes through the same project-store transform as the desktop's resize handles, so the
 * preview and the export agree.
 *
 * The picture it acts on is the selected video, image or text; with nothing selected, pinch and wheel
 * act on the video or image under the playhead, but a one-finger drag needs a selection so a stray
 * touch never moves anything.
 */
import React, { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useEngineStore } from "../../stores/engine-store";
import { selectedTarget } from "./clip-tools";
import {
  DOUBLE_TAP_MS, DOUBLE_TAP_SLOP, dragPosition, distance, IDENTITY, isDrag, midpoint, pinchScale, scalePercent, wheelScale,
  type Point, type VisualTransform,
} from "./preview-gesture";

interface Target { id: string; transform: VisualTransform }

const pick = (t?: { position?: Partial<Point>; scale?: Partial<Point> } | null): VisualTransform => ({
  position: { x: t?.position?.x ?? 0, y: t?.position?.y ?? 0 },
  scale: { x: t?.scale?.x ?? 1, y: t?.scale?.y ?? 1 },
});

/** The picture a gesture would change right now, or null when there is none. */
function resolveTarget(): { target: Target; selected: boolean } | null {
  const { project } = useProjectStore.getState();
  const items = useUIStore.getState().selectedItems;
  const sel = selectedTarget(project, items);
  if (sel?.kind === "text-clip") {
    const transform = useEngineStore.getState().getTitleEngine()?.getTextClip(sel.id)?.transform;
    return transform ? { target: { id: sel.id, transform: pick(transform) }, selected: true } : null;
  }
  if (sel?.kind === "clip") {
    if (sel.trackType !== "video" && sel.trackType !== "image") return null;
    return { target: { id: sel.id, transform: pick(sel.clip.transform) }, selected: true };
  }
  if (items.length > 0) return null; // something else is selected (audio, a shape…)
  const time = useTimelineStore.getState().playheadPosition;
  let under: { id: string; transform: VisualTransform } | null = null;
  for (const track of project.timeline.tracks) {
    if (track.type !== "video" && track.type !== "image") continue;
    for (const c of track.clips) if (time >= c.startTime && time < c.startTime + c.duration) under = { id: c.id, transform: pick(c.transform) };
  }
  return under ? { target: under, selected: false } : null;
}

export const PreviewGestures: React.FC<{ enabled: boolean; className?: string; children: React.ReactNode }> = ({ enabled, className, children }) => {
  const box = useRef<HTMLDivElement>(null);
  const [badge, setBadge] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || !enabled) return;

    const pointers = new Map<number, Point>();
    let target: Target | null = null;      // the picture and its transform as of the last change
    let selected = false;
    let start: { transform: VisualTransform; pinch?: { dist: number; mid: Point }; from?: Point } | null = null;
    let dragging = false;
    let groupOpen = false;
    let dirty = false;   // a change not yet sent to the store
    let active = false;  // between the first change and finish()
    let flushing: ReturnType<typeof requestAnimationFrame> | 0 = 0;
    let lastPush = 0;
    let chain: Promise<unknown> = Promise.resolve();
    let idleTimer = 0;
    let badgeTimer = 0;
    let lastTap = { time: 0, x: 0, y: 0 };

    const displayScale = () => {
      const canvas = el.querySelector("canvas");
      const width = useProjectStore.getState().project.settings.width;
      return canvas && width > 0 ? canvas.getBoundingClientRect().width / width : 1;
    };

    const flash = (scale: number) => {
      setBadge(scalePercent(scale));
      window.clearTimeout(badgeTimer);
      badgeTimer = window.setTimeout(() => setBadge(null), 900);
    };

    const push = () => {
      if (!target) return;
      const { id, transform } = target;
      if (!groupOpen) { useProjectStore.getState().beginHistoryGroup("Move picture"); groupOpen = true; }
      lastPush = performance.now();
      dirty = false;
      chain = chain.then(() => useProjectStore.getState().updateClipTransform(id, { position: transform.position, scale: transform.scale })).catch(() => undefined);
    };
    const schedule = () => {
      if (flushing) return;
      flushing = requestAnimationFrame(() => {
        flushing = 0;
        if (performance.now() - lastPush >= 50) push(); else schedule();
      });
    };
    /** Sends the last state and closes the undo group. */
    const finish = () => {
      if (flushing) { cancelAnimationFrame(flushing); flushing = 0; }
      if (dirty) push(); // a gesture that ends before the next frame still lands where the fingers left it
      if (groupOpen) {
        void chain.finally(() => { useProjectStore.getState().endHistoryGroup(); });
        groupOpen = false;
      }
      active = false;
    };
    const change = (next: VisualTransform) => {
      if (!target) return;
      target = { id: target.id, transform: next };
      active = true;
      dirty = true;
      flash(next.scale.x);
      schedule();
    };

    const begin = () => {
      const found = resolveTarget();
      if (!found) { target = null; start = null; return; }
      if (!target || target.id !== found.target.id) target = found.target;
      selected = found.selected;
      const [a, b] = [...pointers.values()];
      start = {
        transform: { position: { ...target.transform.position }, scale: { ...target.transform.scale } },
        ...(pointers.size >= 2 ? { pinch: { dist: distance(a, b), mid: midpoint(a, b) } } : { from: a }),
      };
    };

    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("button, input, a")) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) finish();
      if (pointers.size <= 2) { dragging = pointers.size >= 2; begin(); }
      if (pointers.size === 1) { window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp); }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId) || !start || !target) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const k = displayScale();
      if (pointers.size >= 2 && start.pinch) {
        const [a, b] = [...pointers.values()];
        const scale = pinchScale(start.transform.scale.x, start.pinch.dist, distance(a, b));
        const ratio = scale / start.transform.scale.x;
        const mid = midpoint(a, b);
        change({
          position: dragPosition(start.transform.position, mid.x - start.pinch.mid.x, mid.y - start.pinch.mid.y, k),
          scale: { x: scale, y: start.transform.scale.y * ratio },
        });
      } else if (pointers.size === 1 && start.from && selected) {
        const now = { x: e.clientX, y: e.clientY };
        if (!dragging && !isDrag(start.from, now)) return;
        dragging = true;
        change({ position: dragPosition(start.transform.position, now.x - start.from.x, now.y - start.from.y, k), scale: start.transform.scale });
      }
    };

    const onUp = (e: PointerEvent) => {
      const point = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size === 1) { dragging = true; begin(); return; } // a finger lifted: carry on dragging with the other
      if (pointers.size > 0) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const wasDrag = dragging;
      dragging = false;
      if (!wasDrag && point && e.type === "pointerup") {
        const now = performance.now();
        const double = now - lastTap.time < DOUBLE_TAP_MS && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < DOUBLE_TAP_SLOP;
        lastTap = double ? { time: 0, x: 0, y: 0 } : { time: now, x: point.x, y: point.y };
        if (double && resolveTarget()) { begin(); change(IDENTITY); }
      }
      finish();
      start = null;
    };

    const onWheel = (e: WheelEvent) => {
      const found = resolveTarget();
      if (!found) return;
      e.preventDefault();
      if (!target || target.id !== found.target.id || !active) target = found.target;
      const scale = wheelScale(target.transform.scale.x, e.deltaY, e.deltaMode);
      const ratio = scale / target.transform.scale.x;
      change({ position: target.transform.position, scale: { x: scale, y: target.transform.scale.y * ratio } });
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(finish, 250);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.clearTimeout(idleTimer);
      window.clearTimeout(badgeTimer);
      finish();
    };
  }, [enabled]);

  return (
    <div ref={box} className={`relative ${className ?? ""}`} style={enabled ? { touchAction: "none" } : undefined}>
      {children}
      {badge && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 font-mono text-xs text-white" dir="ltr" role="status" data-testid="zoom-badge">
          {badge}
        </div>
      )}
    </div>
  );
};
