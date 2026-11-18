/**
 * Zoom and move of the picture on the phone preview (Hawsh build). The phone editor hides the
 * desktop's resize handles, so nothing could scale or move a video, an image or a text: this adds the
 * gestures people expect from CapCut. Pinch with two fingers, the mouse wheel (or a trackpad pinch) on
 * a computer, one finger or the mouse to drag, and a double tap to reset. The maths is here; the
 * pointer wiring is in PreviewGestures.tsx.
 */

export const SCALE_MIN = 0.1;
export const SCALE_MAX = 5;

export interface Point { x: number; y: number }
export interface VisualTransform { position: Point; scale: Point }

export const clampScale = (s: number): number => Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Scale after the fingers moved from `startDistance` apart to `now` apart. */
export function pinchScale(startScale: number, startDistance: number, now: number): number {
  // Fingers almost touching give a ratio that explodes; keep the scale until they are apart.
  if (startDistance < 8) return startScale;
  return clampScale(startScale * (now / startDistance));
}

/**
 * Scale after one wheel step. A trackpad pinch arrives as small wheel deltas (with ctrl held), a mouse
 * wheel as steps of about 100; both give a smooth ~10 % per notch. `deltaMode` 1 means lines.
 */
export function wheelScale(scale: number, deltaY: number, deltaMode = 0): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaY;
  return clampScale(scale * Math.exp(-pixels * 0.0015));
}

/** Project position after the pointer moved by (dx, dy) screen pixels; `displayScale` = screen px per project px. */
export function dragPosition(start: Point, dx: number, dy: number, displayScale: number): Point {
  const k = displayScale > 0 ? displayScale : 1;
  return { x: start.x + dx / k, y: start.y + dy / k };
}

/** Whether a pointer has moved far enough from where it went down to be a drag and not a tap. */
export const DRAG_SLOP = 6;
export const isDrag = (from: Point, to: Point): boolean => distance(from, to) > DRAG_SLOP;

/** Two taps this close in time and place are a double tap. */
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_SLOP = 24;

export const IDENTITY: VisualTransform = { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 } };

/** The percentage shown while zooming (100 % = the clip as placed). */
export const scalePercent = (scale: number): string => `${Math.round(scale * 100)}%`;
