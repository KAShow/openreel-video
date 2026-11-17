import { describe, expect, it } from "vitest";
import { computePreviewResolution, previewMaxDimension } from "./preview-resolution";

describe("previewMaxDimension (auto follows the size the preview is shown at)", () => {
  it("a phone preview (~360 css px tall on a 3x screen) draws at 720, not 1920", () => {
    expect(previewMaxDimension("auto", 1080, 1920, 360, 3)).toBe(720);
    expect(computePreviewResolution(1080, 1920, previewMaxDimension("auto", 1080, 1920, 360, 3))).toEqual({ width: 405, height: 720, scale: 0.375 });
  });

  it("full screen on the same phone goes up to 1920", () => {
    expect(previewMaxDimension("auto", 1080, 1920, 812, 3)).toBe(1920);
  });

  it("uses fixed steps so small size changes do not change the resolution", () => {
    expect(previewMaxDimension("auto", 1080, 1920, 300, 2)).toBe(720);
    expect(previewMaxDimension("auto", 1080, 1920, 340, 2)).toBe(720);
    expect(previewMaxDimension("auto", 1080, 1920, 260, 2)).toBe(540);
    expect(previewMaxDimension("auto", 1080, 1920, 500, 2)).toBe(1080);
  });

  it("counts at most 2x screen density", () => {
    expect(previewMaxDimension("auto", 1080, 1920, 360, 2)).toBe(previewMaxDimension("auto", 1080, 1920, 360, 3));
  });

  it("keeps the old rule before the preview has been measured, and for 4K sources", () => {
    expect(previewMaxDimension("auto", 1080, 1920, 0, 2)).toBe(1920);
    expect(previewMaxDimension("auto", 3840, 2160, 2000, 2)).toBe(960);
  });

  it("explicit levels are unchanged", () => {
    expect(previewMaxDimension("full", 1080, 1920, 300, 2)).toBe(1920);
    expect(previewMaxDimension("half", 1080, 1920, 300, 2)).toBe(960);
  });
});
