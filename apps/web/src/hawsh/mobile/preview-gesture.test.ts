import { describe, expect, it } from "vitest";
import {
  clampScale, dragPosition, isDrag, pinchScale, scalePercent, SCALE_MAX, SCALE_MIN, wheelScale,
} from "./preview-gesture";

describe("pinchScale", () => {
  it("follows the distance between the fingers", () => {
    expect(pinchScale(1, 100, 200)).toBeCloseTo(2);
    expect(pinchScale(1.5, 100, 50)).toBeCloseTo(0.75);
  });
  it("stays within limits", () => {
    expect(pinchScale(1, 100, 100000)).toBe(SCALE_MAX);
    expect(pinchScale(1, 100, 1)).toBe(SCALE_MIN);
  });
  it("ignores a pinch that started with the fingers on top of each other", () => {
    expect(pinchScale(1.2, 2, 300)).toBe(1.2);
  });
});

describe("wheelScale", () => {
  it("zooms in when the wheel goes up and out when it goes down", () => {
    expect(wheelScale(1, -100)).toBeGreaterThan(1);
    expect(wheelScale(1, 100)).toBeLessThan(1);
  });
  it("is gentle for trackpad deltas and treats lines as 16 px", () => {
    expect(wheelScale(1, -2)).toBeCloseTo(1.003, 3);
    expect(wheelScale(1, -3, 1)).toBeCloseTo(wheelScale(1, -48), 6);
  });
  it("never leaves the limits", () => {
    expect(wheelScale(SCALE_MAX, -10000)).toBe(SCALE_MAX);
    expect(wheelScale(SCALE_MIN, 10000)).toBe(SCALE_MIN);
  });
});

describe("dragPosition", () => {
  it("moves in project pixels, not screen pixels", () => {
    expect(dragPosition({ x: 10, y: -20 }, 30, -15, 0.3)).toEqual({ x: 110, y: -70 });
  });
  it("survives a zero display scale", () => {
    expect(dragPosition({ x: 0, y: 0 }, 5, 5, 0)).toEqual({ x: 5, y: 5 });
  });
});

describe("small helpers", () => {
  it("tells a tap from a drag", () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(true);
  });
  it("clamps and prints percentages", () => {
    expect(clampScale(99)).toBe(SCALE_MAX);
    expect(scalePercent(1.236)).toBe("124%");
  });
});
