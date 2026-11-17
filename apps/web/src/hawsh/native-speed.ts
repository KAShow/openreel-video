/**
 * Whether a clip's speed can play on the browser's own video element (the fast preview path) instead of
 * frame-by-frame decoding. Hawsh build: OpenReel sent every clip with a speed other than 1× down the
 * slow path. A constant speed is just the element's playbackRate; ramps and freeze frames still need
 * the slow path, and so does reverse (checked by the caller).
 */
export const NATIVE_SPEED_MIN = 0.25;
export const NATIVE_SPEED_MAX = 4;

export function nativePlaybackSpeedOk(speed: number, speedKeyframes: number, freezeFrames: number): boolean {
  if (speedKeyframes > 0 || freezeFrames > 0) return false;
  return Number.isFinite(speed) && speed >= NATIVE_SPEED_MIN && speed <= NATIVE_SPEED_MAX;
}
