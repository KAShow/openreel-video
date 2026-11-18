import { afterEach, describe, expect, it } from "vitest";
import { createMotionExpression, evaluateMotionPropertyValueAtTime, getMotionExpressionError } from "./motion-expressions";
import "./motion-keyframes";

const PWNED_KEYS = ["__openreelPwnedA", "__openreelPwnedB"] as const;

afterEach(() => {
  for (const key of PWNED_KEYS) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

const evaluatePayload = (code: string, fallback = 77): number =>
  evaluateMotionPropertyValueAtTime({
    keyframes: [],
    expressions: [
      {
        ...createMotionExpression("expression", "transform.opacity", "sec-payload"),
        code,
      },
    ],
    property: "transform.opacity",
    localTime: 0,
    fallback,
    duration: 5,
  });

describe("motion expression security (imported/pasted code must not execute)", () => {
  it("blocks a constructor-based escape that executes a string", () => {
    const result = evaluatePayload(
      'value.constructor.constructor("globalThis.__openreelPwnedA = 1")() + value',
    );
    expect((globalThis as Record<string, unknown>).__openreelPwnedA).toBeUndefined();
    expect(result).toBe(77);
    expect(getMotionExpressionError("sec-payload")).toBeTruthy();
  });

  it("blocks global assignment in statement-form code", () => {
    const result = evaluatePayload("globalThis.__openreelPwnedB = 1; value");
    expect((globalThis as Record<string, unknown>).__openreelPwnedB).toBeUndefined();
    expect(result).toBe(77);
    expect(getMotionExpressionError("sec-payload")).toBeTruthy();
  });

  it("rejects loops with a compile error and falls back", () => {
    const result = evaluatePayload("let s = 0; for (let i = 0; i < 100000; i += 1) { s += i; } s");
    expect(result).toBe(77);
    expect(getMotionExpressionError("sec-payload")).toContain("compile");
  });

  it("treats browser globals as undefined identifiers and records the name", () => {
    const result = evaluatePayload("localStorage.getItem('hawsh-editor-auth') ? 1 : 2");
    expect(result).toBe(77);
    expect(getMotionExpressionError("sec-payload")).toContain("localStorage");
  });

  it("blocks new expressions and function creation", () => {
    expect(evaluatePayload("new Date().getTime()")).toBe(77);
    expect(evaluatePayload("(() => value)()")).toBe(77);
    expect(evaluatePayload("(function () { return value; })()")).toBe(77);
  });

  it("still evaluates legitimate expressions after the sandbox swap", () => {
    expect(evaluatePayload("value + time * 10")).toBe(77);
    const moved = evaluateMotionPropertyValueAtTime({
      keyframes: [],
      expressions: [
        {
          ...createMotionExpression("expression", "transform.opacity", "sec-legit"),
          code: "value + time * 10",
        },
      ],
      property: "transform.opacity",
      localTime: 0.5,
      fallback: 100,
      duration: 5,
    });
    expect(moved).toBeCloseTo(105, 5);
    expect(getMotionExpressionError("sec-legit")).toBeNull();
  });
});
