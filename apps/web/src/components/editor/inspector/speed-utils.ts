/** Matches the clamp in the `clip/setSpeed` action handler (packages/core). */
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 20;

/** Slider covers the everyday range; the number field reaches SPEED_MAX. */
export const SPEED_SLIDER_MAX = 5;
export const SPEED_STEP = 0.01;

export type SpeedParseResult =
  | { ok: true; value: number; clamped: boolean }
  | { ok: false };

export const roundSpeed = (speed: number): number =>
  Number((Math.round(speed / SPEED_STEP) * SPEED_STEP).toFixed(2));

export const clampSpeed = (speed: number): number =>
  Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));

/** Parses user input such as "1.5", "1,5", "2x" or "٢٫٥×" into a clamped speed. */
export const parseSpeedInput = (raw: string): SpeedParseResult => {
  const normalized = raw
    .trim()
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[٫,]/gu, ".");
  const match = normalized.match(/\d+(?:\.\d+)?|\.\d+/u);
  if (!match) return { ok: false };
  const parsed = Number.parseFloat(match[0]);
  if (!Number.isFinite(parsed)) return { ok: false };
  return {
    ok: true,
    value: roundSpeed(clampSpeed(parsed)),
    clamped: parsed < SPEED_MIN || parsed > SPEED_MAX,
  };
};

export const formatSpeed = (speed: number): string =>
  `${Number(speed.toFixed(2))}×`;

/** Timeline duration after a speed change: source span divided by speed. */
export const durationAtSpeed = (
  inPoint: number,
  outPoint: number,
  speed: number,
): number => (outPoint - inPoint) / speed;

export const formatSeconds = (seconds: number): string =>
  `${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)}s`;
