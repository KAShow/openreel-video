import { describe, expect, it } from "vitest";
import { nativePlaybackSpeedOk } from "./native-speed";

describe("nativePlaybackSpeedOk", () => {
  it("keeps constant speeds from 0.25x to 4x on the fast path", () => {
    for (const s of [0.25, 0.5, 1, 1.5, 2, 4]) expect(nativePlaybackSpeedOk(s, 0, 0)).toBe(true);
  });
  it("sends speed ramps, freeze frames and extreme speeds to the slow path", () => {
    expect(nativePlaybackSpeedOk(2, 1, 0)).toBe(false);
    expect(nativePlaybackSpeedOk(1, 0, 1)).toBe(false);
    expect(nativePlaybackSpeedOk(8, 0, 0)).toBe(false);
    expect(nativePlaybackSpeedOk(0.1, 0, 0)).toBe(false);
    expect(nativePlaybackSpeedOk(Number.NaN, 0, 0)).toBe(false);
  });
});
