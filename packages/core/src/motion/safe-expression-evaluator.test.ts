import { describe, expect, it } from "vitest";
import { compileSafeExpression } from "./safe-expression-evaluator";

const compileAndRun = (code: string, scope: Record<string, unknown> = {}): unknown =>
  compileSafeExpression(code)(scope);

describe("safe expression evaluator — language surface", () => {
  it("evaluates arithmetic with operator precedence", () => {
    expect(compileAndRun("1 + 2 * 3")).toBe(7);
    expect(compileAndRun("(1 + 2) * 3")).toBe(9);
    expect(compileAndRun("10 % 3")).toBe(1);
    expect(compileAndRun("2 ** 10")).toBe(1024);
  });

  it("resolves identifiers from the provided scope only", () => {
    expect(compileAndRun("value + time", { value: 10, time: 2 })).toBe(12);
  });

  it("reads members and calls methods on scope objects like Math", () => {
    const mathScope = { Math };
    expect(compileAndRun("Math.PI", mathScope)).toBeCloseTo(Math.PI, 10);
    expect(compileAndRun("Math.max(1, 5, 3)", mathScope)).toBe(5);
    expect(compileAndRun("Math.floor(2.7) + Math.abs(-4)", mathScope)).toBe(6);
  });

  it("reads string length via member access", () => {
    expect(compileAndRun("name.length", { name: "Hero" })).toBe(4);
  });

  it("calls scope functions with mixed argument types", () => {
    expect(compileAndRun("wiggle(2, 20)", { wiggle: (f: number, a: number) => f + a })).toBe(22);
    expect(
      compileAndRun('pick("a", 1)', { pick: (s: string, n: number) => `${s}${n}` }),
    ).toBe("a1");
  });

  it("supports comparisons and logical operators", () => {
    expect(compileAndRun("value > 5 && time < 3", { value: 10, time: 2 })).toBe(true);
    expect(compileAndRun("value < 5 || time > 3", { value: 10, time: 2 })).toBe(false);
    expect(compileAndRun("!(value === 10)", { value: 10 })).toBe(false);
    expect(compileAndRun("value !== 10", { value: 10 })).toBe(false);
  });

  it("supports ternary conditionals", () => {
    expect(compileAndRun("time > 1 ? 10 : 20", { time: 2 })).toBe(10);
    expect(compileAndRun("time > 1 ? 10 : 20", { time: 0.5 })).toBe(20);
  });

  it("applies unary minus and typeof", () => {
    expect(compileAndRun("-value + 3", { value: 10 })).toBe(-7);
    expect(compileAndRun("typeof value", { value: 1 })).toBe("number");
  });

  it("supports computed member access with string keys", () => {
    expect(compileAndRun('Math["max"](1, 2)', { Math })).toBe(2);
  });

  it("preserves IEEE division semantics for divide-by-zero", () => {
    expect(compileAndRun("value / 0", { value: 5 })).toBe(Infinity);
    expect(compileAndRun("0 / 0")).toBeNaN();
  });

  it("returns the value of a single expression statement", () => {
    expect(compileAndRun("value + 1", { value: 41 })).toBe(42);
  });

  it("runs statement bodies with const declarations and an explicit return", () => {
    expect(compileAndRun("const a = value * 2;\nreturn a + 1;", { value: 10 })).toBe(21);
  });

  it("reassigns locals declared with let", () => {
    expect(compileAndRun("let a = 1; a = a + 2; return a;", {})).toBe(3);
  });

  it("supports if/else statements", () => {
    expect(compileAndRun("if (value > 5) { return 1; } else { return 2; }", { value: 10 })).toBe(1);
    expect(compileAndRun("if (value > 5) { return 1; } else { return 2; }", { value: 3 })).toBe(2);
  });

  it("throws an error naming an unknown identifier at runtime", () => {
    expect(() => compileAndRun("undefinedFn()", {})).toThrow(/undefinedFn/);
  });

  it("throws a syntax error at compile time for malformed code", () => {
    expect(() => compileSafeExpression("value +")).toThrow();
    expect(() => compileSafeExpression("return a +")).toThrow();
    expect(() => compileSafeExpression("const = 3")).toThrow();
  });
});

describe("safe expression evaluator — security", () => {
  it("does not resolve global identifiers such as fetch or localStorage", () => {
    for (const globalName of [
      "fetch",
      "localStorage",
      "globalThis",
      "window",
      "document",
      "Function",
      "eval",
      "WebSocket",
      "XMLHttpRequest",
      "navigator",
      "require",
    ]) {
      expect(() => compileAndRun(`${globalName}`), globalName).toThrow(/not defined/);
    }
  });

  it("blocks member access to constructor", () => {
    expect(() => compileAndRun("Math.constructor", { Math })).toThrow(/constructor/);
    expect(() => compileAndRun("thisLayer.constructor", { thisLayer: { index: 1 } })).toThrow(
      /constructor/,
    );
  });

  it("blocks member access to __proto__ and prototype", () => {
    expect(() => compileAndRun("Math.__proto__", { Math })).toThrow(/__proto__/);
    expect(() => compileAndRun("Math.prototype", { Math })).toThrow(/prototype/);
    expect(() => compileAndRun('Math["__proto__"]', { Math })).toThrow(/__proto__/);
  });

  it("blocks member access on function values", () => {
    expect(() => compileAndRun("wiggle.call", { wiggle: () => 1 })).toThrow();
    expect(() => compileAndRun("wiggle.bind(this)", { wiggle: () => 1 })).toThrow();
  });

  it("blocks string members other than length", () => {
    expect(() => compileAndRun("name.constructor", { name: "Hero" })).toThrow(/constructor/);
    expect(() => compileAndRun("name.charAt(0)", { name: "Hero" })).toThrow(/charAt/);
  });

  it("rejects object and array literals", () => {
    expect(() => compileAndRun("({}).x")).toThrow();
    expect(() => compileAndRun("[1, 2][0]")).toThrow();
  });

  it("rejects arrow functions and function expressions", () => {
    expect(() => compileAndRun("(() => 1)()")).toThrow();
    expect(() => compileAndRun("(function () { return 1; })()")).toThrow();
  });

  it("rejects new expressions", () => {
    expect(() => compileAndRun("new Date()")).toThrow();
  });

  it("rejects loops", () => {
    expect(() => compileAndRun("while (true) { }")).toThrow();
    expect(() => compileAndRun("for (;;) { }")).toThrow();
    expect(() => compileAndRun("do { } while (true)")).toThrow();
  });

  it("rejects assignment to undeclared identifiers", () => {
    expect(() => compileAndRun("a = 1", {})).toThrow(/a/);
  });

  it("rejects delete and in operators", () => {
    expect(() => compileSafeExpression("delete value")).toThrow();
    expect(() => compileSafeExpression('"a" in Math')).toThrow();
  });

  it("rejects code beyond the length cap", () => {
    expect(() => compileSafeExpression(`${"1 + ".repeat(10000)}1`)).toThrow();
  });

  it("rejects deeply nested expressions beyond the parser depth limit", () => {
    const depth = 400;
    expect(() =>
      compileSafeExpression(`${"(".repeat(depth)}1${")".repeat(depth)}`),
    ).toThrow();
  });

  it("trips the runtime step limit on runaway evaluation", () => {
    const code = "fn()";
    const compiled = compileSafeExpression(code);
    const scope: Record<string, unknown> = {};
    scope.fn = () => compiled(scope);
    expect(() => compiled(scope)).toThrow(/limit/i);
  });
});
