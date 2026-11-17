import { describe, expect, it } from "vitest";
import { effectStrength } from "./effect-units";

describe("effectStrength", () => {
  it("reads portable values as they are", () => {
    expect(effectStrength("vignette", 0.4)).toBe(0.4);
    expect(effectStrength("grain", 0.12)).toBe(0.12);
    expect(effectStrength("brightness", -0.5)).toBe(-0.5);
    expect(effectStrength("sharpen", 2)).toBe(2);
  });

  it("reads percentages saved by the old desktop panel", () => {
    expect(effectStrength("vignette", 40)).toBe(0.4);
    expect(effectStrength("grain", 25)).toBe(0.25);
    expect(effectStrength("brightness", -30)).toBeCloseTo(-0.3);
    expect(effectStrength("sharpen", 150)).toBe(1.5);
  });

  it("clamps and falls back", () => {
    expect(effectStrength("vignette", 500)).toBe(1);
    expect(effectStrength("brightness", -300)).toBe(-1);
    expect(effectStrength("grain", undefined)).toBe(0);
    expect(effectStrength("grain", Number.NaN, 0.3)).toBe(0.3);
    expect(effectStrength("vignette", -0.2)).toBe(0);
  });
});
