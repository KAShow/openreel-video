import { describe, expect, it } from "vitest";
import { costLabel, DEFAULT_STEP_PRICE, getStepPrice, setStepPrice, stepsLabel, turnCost } from "./ai-cost";

describe("turnCost", () => {
  it("multiplies charged steps by the price without float noise", () => {
    expect(turnCost(3, 0.1)).toEqual({ steps: 3, points: 0.3 });
    expect(turnCost(7, 0.15)).toEqual({ steps: 7, points: 1.05 });
    expect(turnCost(1, 0)).toEqual({ steps: 1, points: 0 });
  });

  it("uses the loaded price, or the default before it loads", () => {
    expect(getStepPrice()).toBe(DEFAULT_STEP_PRICE);
    expect(turnCost(2)).toEqual({ steps: 2, points: 0.2 });
    setStepPrice(-1);
    setStepPrice(Number.NaN);
    expect(getStepPrice()).toBe(DEFAULT_STEP_PRICE);
    setStepPrice(0.25);
    expect(turnCost(2)).toEqual({ steps: 2, points: 0.5 });
    setStepPrice(DEFAULT_STEP_PRICE);
  });
});

describe("stepsLabel", () => {
  it("counts steps in correct Arabic", () => {
    expect(stepsLabel(1)).toBe("خطوة واحدة");
    expect(stepsLabel(2)).toBe("خطوتان");
    expect(stepsLabel(3)).toBe("3 خطوات");
    expect(stepsLabel(10)).toBe("10 خطوات");
    expect(stepsLabel(11)).toBe("11 خطوة");
    expect(stepsLabel(12)).toBe("12 خطوة");
    expect(stepsLabel(100)).toBe("100 خطوة");
    expect(stepsLabel(103)).toBe("103 خطوات");
  });
});

describe("costLabel", () => {
  it("reads as one Arabic line that starts with an Arabic word", () => {
    expect(costLabel({ steps: 3, points: 0.30000000000000004 })).toBe("استهلك هذا الطلب 0.3 نقطة (3 خطوات)");
    expect(costLabel({ steps: 1, points: 0.1 })).toBe("استهلك هذا الطلب 0.1 نقطة (خطوة واحدة)");
    expect(costLabel({ steps: 2, points: 0.2 })).toMatch(/^[؀-ۿ]/);
  });
});
