import { describe, expect, it } from "vitest";
import {
  SPEED_MAX,
  SPEED_MIN,
  durationAtSpeed,
  formatSeconds,
  formatSpeed,
  parseSpeedInput,
  roundSpeed,
} from "./speed-utils";

describe("speed-utils", () => {
  it("rounds to the 0.01 step without float noise", () => {
    expect(roundSpeed(1.005 + 0.2)).toBe(1.2);
    expect(roundSpeed(0.1 + 0.2)).toBe(0.3);
    expect(roundSpeed(1.234)).toBe(1.23);
  });

  it("parses plain, comma, suffixed and Arabic-digit input", () => {
    expect(parseSpeedInput("1.5")).toEqual({ ok: true, value: 1.5, clamped: false });
    expect(parseSpeedInput("1,25")).toEqual({ ok: true, value: 1.25, clamped: false });
    expect(parseSpeedInput(" 2x ")).toEqual({ ok: true, value: 2, clamped: false });
    expect(parseSpeedInput("٢٫٥×")).toEqual({ ok: true, value: 2.5, clamped: false });
  });

  it("clamps to the engine range and reports it", () => {
    expect(parseSpeedInput("100")).toEqual({ ok: true, value: SPEED_MAX, clamped: true });
    expect(parseSpeedInput("0.01")).toEqual({ ok: true, value: SPEED_MIN, clamped: true });
  });

  it("rejects input without a number", () => {
    expect(parseSpeedInput("")).toEqual({ ok: false });
    expect(parseSpeedInput("abc")).toEqual({ ok: false });
  });

  it("derives timeline duration from the source span", () => {
    expect(durationAtSpeed(2, 12, 2)).toBe(5);
    expect(durationAtSpeed(0, 10, 0.5)).toBe(20);
  });

  it("formats speed and seconds", () => {
    expect(formatSpeed(1.5)).toBe("1.5×");
    expect(formatSpeed(1)).toBe("1×");
    expect(formatSeconds(5)).toBe("5.00s");
    expect(formatSeconds(20)).toBe("20.0s");
  });
});
