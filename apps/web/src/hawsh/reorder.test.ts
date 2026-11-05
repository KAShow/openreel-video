import { describe, expect, it } from "vitest";
import { brokenTransitions, overlapsOthers, reorderPlan, type Move, type Slot } from "./reorder";

const abc: Slot[] = [
  { id: "a", start: 0, duration: 5 },
  { id: "b", start: 5, duration: 5 },
  { id: "c", start: 10, duration: 5 },
];
/** The final order and starts after applying a plan. */
const result = (clips: Slot[], moves: Move[]) =>
  clips.map((c) => ({ ...c, start: moves.find((m) => m.id === c.id)?.start ?? c.start }))
    .sort((x, y) => x.start - y.start).map((c) => `${c.id}${c.start}`).join(" ");

describe("reorderPlan", () => {
  it("moves the last clip to the front and shifts the rest later", () => {
    expect(result(abc, reorderPlan(abc, "c", 0, true))).toBe("c0 a5 b10");
  });

  it("moves the first clip to the end and closes up", () => {
    expect(result(abc, reorderPlan(abc, "a", 11, false))).toBe("b0 c5 a10");
  });

  it("swaps neighbours once the leading edge crosses the neighbour's center", () => {
    expect(result(abc, reorderPlan(abc, "a", 3, true))).toBe("b0 a5 c10");
    expect(result(abc, reorderPlan(abc, "c", 7, true))).toBe("a0 c5 b10");
  });

  it("does not swap before the center is crossed", () => {
    expect(result(abc, reorderPlan(abc, "a", 2, true))).toBe("a0 b5 c10");
    expect(result(abc, reorderPlan(abc, "c", 9, true))).toBe("a0 b5 c10");
  });

  it("swaps a long clip with a short one without dragging its whole length", () => {
    const clips = [{ id: "long", start: 0, duration: 30 }, { id: "short", start: 30, duration: 2 }];
    expect(result(clips, reorderPlan(clips, "long", 2, false))).toBe("short0 long2");
    expect(result(clips, reorderPlan(clips, "short", 14, false))).toBe("short0 long2");
  });

  it("keeps the spaces between places and leaves clips outside the range alone", () => {
    const clips = [
      { id: "a", start: 0, duration: 2 },
      { id: "b", start: 3, duration: 2 },
      { id: "c", start: 7, duration: 2 },
      { id: "d", start: 20, duration: 2 },
    ];
    const moves = reorderPlan(clips, "c", 0, true);
    expect(result(clips, moves)).toBe("c0 a3 b7 d20");
    expect(moves.some((m) => m.id === "d")).toBe(false);
  });

  it("uses clip lengths when the clips differ, without overlaps", () => {
    const clips = [{ id: "a", start: 0, duration: 2 }, { id: "b", start: 2, duration: 6 }, { id: "c", start: 8, duration: 1 }];
    expect(result(clips, reorderPlan(clips, "a", 7, false))).toBe("b0 c6 a7");
    expect(result(clips, reorderPlan(clips, "c", 0, false))).toBe("c0 a1 b3");
  });

  it("with free placement leaves a drop on empty time where it was dropped", () => {
    expect(reorderPlan(abc, "c", 40, true)).toEqual([{ id: "c", start: 40 }]);
    const gap = [{ id: "a", start: 0, duration: 2 }, { id: "b", start: 10, duration: 2 }];
    expect(reorderPlan(gap, "b", 4, true)).toEqual([{ id: "b", start: 4 }]);
  });

  it("with free placement settles an order-keeping drop in the nearest free time", () => {
    const gap = [{ id: "a", start: 0, duration: 2 }, { id: "b", start: 5, duration: 2 }, { id: "c", start: 12, duration: 2 }];
    expect(reorderPlan(gap, "b", 1.5, true)).toEqual([{ id: "b", start: 2 }]);
    expect(reorderPlan(gap, "b", 10.5, true)).toEqual([{ id: "b", start: 10 }]);
  });

  it("without free placement a drop past the end joins the track instead of leaving a hole", () => {
    expect(result(abc, reorderPlan(abc, "a", 100, false))).toBe("b0 c5 a10");
  });

  it("without free placement an unchanged order stays put", () => {
    expect(reorderPlan(abc, "b", 5.5, false)).toEqual([{ id: "b", start: 5 }]);
  });

  it("never goes below zero and ignores an unknown clip", () => {
    expect(result(abc, reorderPlan(abc, "b", -30, true))).toBe("b0 a5 c10");
    expect(reorderPlan(abc, "nope", 3, true)).toEqual([]);
  });

  it("always leaves the track without overlaps", () => {
    const clips = [{ id: "a", start: 0, duration: 3 }, { id: "b", start: 3, duration: 1 }, { id: "c", start: 6, duration: 4 }, { id: "d", start: 12, duration: 2 }];
    for (const c of clips) {
      for (let drop = 0; drop < 16; drop += 0.5) {
        const next = clips.map((x) => ({ ...x, start: reorderPlan(clips, c.id, drop, true).find((m) => m.id === x.id)?.start ?? x.start }));
        for (const x of next) expect(overlapsOthers(next, x.id, x.start)).toBe(false);
      }
    }
  });
});

describe("brokenTransitions", () => {
  const clip = (id: string, startTime: number) => ({ id, startTime, duration: 5 });
  const track = {
    clips: [clip("b", 0), clip("c", 5), clip("a", 10)],
    transitions: [
      { id: "ab", clipAId: "a", clipBId: "b" },
      { id: "bc", clipAId: "b", clipBId: "c" },
      { id: "edge", clipAId: "a", clipBId: null },
      { id: "far", clipAId: "c", clipBId: "gone" },
    ],
  };

  it("finds transitions between clips that are no longer neighbours, and keeps the rest", () => {
    expect(brokenTransitions([track], ["a"])).toEqual(["ab"]);
    expect(brokenTransitions([track], ["b"])).toEqual(["ab"]);
  });

  it("flags a transition whose other clip left the track", () => {
    expect(brokenTransitions([track], ["c"])).toEqual(["far"]);
  });

  it("ignores transitions the move did not touch", () => {
    expect(brokenTransitions([track], ["nope"])).toEqual([]);
    expect(brokenTransitions([{ clips: [clip("x", 0)] }], ["x"])).toEqual([]);
  });
});
