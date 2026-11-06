/** Phone timeline zoom, in pixels per second of video. */
export const DEFAULT_ZOOM = 56;
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 400;
/** One press of the zoom buttons. */
export const ZOOM_STEP = 1.5;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Zoom after a pinch: fingers twice as far apart show the timeline twice as wide. */
export const pinchZoom = (startZoom: number, startDistance: number, distance: number): number =>
  startDistance > 0 ? clampZoom((startZoom * distance) / startDistance) : startZoom;

const LABEL_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const MIN_LABEL_GAP = 64;

/** Seconds between the ruler's time labels, the fewest that keep them from touching. A dot sits halfway between two. */
export const rulerStep = (zoom: number): number =>
  LABEL_STEPS.find((step) => step * zoom >= MIN_LABEL_GAP) ?? LABEL_STEPS[LABEL_STEPS.length - 1];
