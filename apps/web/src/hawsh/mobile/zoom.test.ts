import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, clampZoom, pinchZoom, rulerStep } from "./zoom";

describe("clampZoom", () => {
  it("stays inside the limits", () => {
    expect(clampZoom(1)).toBe(MIN_ZOOM);
    expect(clampZoom(100000)).toBe(MAX_ZOOM);
    expect(clampZoom(100)).toBe(100);
  });
});

describe("pinchZoom", () => {
  it("follows the distance between the fingers", () => {
    expect(pinchZoom(50, 100, 200)).toBe(100);
    expect(pinchZoom(50, 200, 100)).toBe(25);
  });

  it("stops at the limits", () => {
    expect(pinchZoom(50, 10, 1000)).toBe(MAX_ZOOM);
    expect(pinchZoom(50, 1000, 10)).toBe(MIN_ZOOM);
  });

  it("ignores fingers on the same spot", () => {
    expect(pinchZoom(50, 0, 100)).toBe(50);
  });
});

describe("rulerStep", () => {
  it("keeps labels apart at every zoom", () => {
    for (let zoom = MIN_ZOOM; zoom <= MAX_ZOOM; zoom += 1) {
      expect(rulerStep(zoom) * zoom).toBeGreaterThanOrEqual(64);
    }
  });

  it("uses the closest step that fits", () => {
    expect(rulerStep(MAX_ZOOM)).toBe(1);
    expect(rulerStep(56)).toBe(2);
    expect(rulerStep(MIN_ZOOM)).toBe(10);
  });
});
