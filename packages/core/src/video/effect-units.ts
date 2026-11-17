/**
 * Effect strengths on one scale: the portable one (editing/portable-project.ts), which the assistant,
 * adjustment layers, built-in templates and the phone editor write: brightness -1..1, sharpen 0..5,
 * vignette 0..1, grain 0..1.
 *
 * The CPU effects engine used to divide these by 100 (OpenReel's desktop effects panel stored
 * percentages), so every effect written on the portable scale was close to invisible in preview and
 * export: a vignette of 0.4 darkened the edge by 1 level out of 255, and brightness, grain and sharpen
 * changed nothing. Projects saved from that panel keep working: a value above the portable maximum is
 * read as a percentage.
 */

export type ScaledEffect = "brightness" | "sharpen" | "vignette" | "grain";

const PORTABLE_MAX: Record<ScaledEffect, number> = { brightness: 1, sharpen: 5, vignette: 1, grain: 1 };

export function effectStrength(type: ScaledEffect, raw: unknown, fallback = 0): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  const max = PORTABLE_MAX[type];
  const portable = Math.abs(value) > max ? value / 100 : value;
  const min = type === "brightness" ? -max : 0;
  return Math.min(max, Math.max(min, portable));
}
