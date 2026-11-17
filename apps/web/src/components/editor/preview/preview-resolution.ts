export const PREVIEW_MAX_DIMENSION = 1920;

export function computePreviewResolution(
  width: number,
  height: number,
  maxDimension: number = PREVIEW_MAX_DIMENSION,
): { width: number; height: number; scale: number } {
  if (width <= 0 || height <= 0) {
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      scale: 1,
    };
  }

  const longest = Math.max(width, height);
  const scale = longest > maxDimension ? maxDimension / longest : 1;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

export type PreviewQuality = "auto" | "full" | "half" | "quarter";

export const PREVIEW_QUALITY_OPTIONS: {
  value: PreviewQuality;
  label: string;
}[] = [
  { value: "auto", label: "Auto" },
  { value: "full", label: "Full" },
  { value: "half", label: "½" },
  { value: "quarter", label: "¼" },
];

export function previewQualityScale(
  quality: PreviewQuality,
  width: number,
  height: number,
): number {
  switch (quality) {
    case "full":
      return 1;
    case "half":
      return 0.5;
    case "quarter":
      return 0.25;
    case "auto":
    default:
      return Math.max(width, height) > 2560 ? 0.5 : 1;
  }
}

/** Resolution steps for "auto": fixed, so a few pixels of resizing never re-creates the canvas. */
export const AUTO_PREVIEW_STEPS = [540, 720, 1080, 1920] as const;

/**
 * Longest side the preview canvas is drawn at (Hawsh build). "auto" follows the size the preview is
 * actually shown at (css pixels × screen density, at most 2×): a 1080×1920 project in a 360 px tall
 * phone preview is drawn at 405×720 instead of 1080×1920, about 7× fewer pixels per frame. Full screen
 * goes back up. Export does not use this; it renders at the project size.
 */
export function previewMaxDimension(
  quality: PreviewQuality,
  width: number,
  height: number,
  displayLongest: number,
  devicePixelRatio: number,
): number {
  const cap = PREVIEW_MAX_DIMENSION * previewQualityScale(quality, width, height);
  if (quality !== "auto" || !(displayLongest > 0)) return cap;
  const needed = displayLongest * Math.min(2, Math.max(1, devicePixelRatio || 1));
  const step = AUTO_PREVIEW_STEPS.find((s) => s >= needed) ?? PREVIEW_MAX_DIMENSION;
  return Math.min(step, cap);
}
