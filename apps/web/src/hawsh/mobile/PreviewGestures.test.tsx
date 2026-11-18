import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const clip = { id: "c1", trackId: "v", mediaId: "m", startTime: 0, duration: 10, inPoint: 0, outPoint: 10, transform: undefined as unknown };
const state = {
  project: { settings: { width: 1000, height: 1000 }, timeline: { tracks: [{ id: "v", type: "video", clips: [clip] }] }, textClips: [] as unknown[] },
  beginHistoryGroup: vi.fn(() => calls.push("begin")),
  endHistoryGroup: vi.fn(() => calls.push("end")),
  updateClipTransform: vi.fn(async (id: string, t: { position: { x: number; y: number }; scale: { x: number; y: number } }) => {
    clip.transform = { position: t.position, scale: t.scale, rotation: 0, opacity: 1 };
    calls.push(`transform ${id} ${t.scale.x.toFixed(2)} ${t.position.x.toFixed(0)},${t.position.y.toFixed(0)}`);
    return { success: true };
  }),
};
const ui = { selectedItems: [] as { type: string; id: string }[] };
vi.mock("../../stores/project-store", () => ({ useProjectStore: { getState: () => state } }));
vi.mock("../../stores/ui-store", () => ({ useUIStore: { getState: () => ui } }));
vi.mock("../../stores/timeline-store", () => ({ useTimelineStore: { getState: () => ({ playheadPosition: 1 }) } }));
vi.mock("../../stores/engine-store", () => ({ useEngineStore: { getState: () => ({ getTitleEngine: () => undefined }) } }));

const { PreviewGestures } = await import("./PreviewGestures");

const tick = (ms = 80) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

function pointer(el: Element, type: string, id: number, x: number, y: number, target: EventTarget = el) {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, "pointerId", { value: id });
  act(() => { target.dispatchEvent(e); });
}

function setup() {
  const view = render(<PreviewGestures enabled><canvas /></PreviewGestures>);
  const box = view.container.firstElementChild as HTMLElement;
  const canvas = box.querySelector("canvas")!;
  // The picture is drawn at half the project's size on screen.
  canvas.getBoundingClientRect = () => ({ width: 500, height: 500, left: 0, top: 0, right: 500, bottom: 500, x: 0, y: 0, toJSON: () => ({}) });
  return { box, canvas };
}

beforeEach(() => {
  calls.length = 0;
  clip.transform = undefined;
  ui.selectedItems = [{ type: "clip", id: "c1" }];
  state.project.timeline.tracks[0].type = "video";
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("PreviewGestures", () => {
  it("zooms the clip under the playhead with the wheel, as one undo step", async () => {
    ui.selectedItems = [];
    const { box } = setup();
    act(() => { box.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true })); });
    act(() => { box.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true })); });
    await tick(400);
    const scales = calls.filter((c) => c.startsWith("transform")).map((c) => Number(c.split(" ")[2]));
    expect(scales.length).toBeGreaterThan(0);
    expect(scales.at(-1)!).toBeGreaterThan(1.3);
    expect(calls.filter((c) => c === "begin")).toHaveLength(1);
    expect(calls.at(-1)).toBe("end");
  });

  it("scales with a two-finger pinch and keeps both axes in step", async () => {
    const { box } = setup();
    pointer(box, "pointerdown", 1, 100, 100);
    pointer(box, "pointerdown", 2, 200, 100);
    pointer(window as unknown as Element, "pointermove", 2, 300, 100);
    pointer(window as unknown as Element, "pointerup", 2, 300, 100);
    pointer(window as unknown as Element, "pointerup", 1, 100, 100);
    await tick();
    expect(state.updateClipTransform).toHaveBeenCalled();
    const [, update] = state.updateClipTransform.mock.calls.at(-1)!;
    expect(update.scale.x).toBeCloseTo(2, 1);
    expect(update.scale.y).toBeCloseTo(2, 1);
    expect(calls.at(-1)).toBe("end");
  });

  it("drags the selected clip in project pixels (the picture is shown at half size)", async () => {
    const { box } = setup();
    pointer(box, "pointerdown", 1, 100, 100);
    pointer(window as unknown as Element, "pointermove", 1, 130, 90);
    pointer(window as unknown as Element, "pointerup", 1, 130, 90);
    await tick();
    const [, update] = state.updateClipTransform.mock.calls.at(-1)!;
    expect(update.position.x).toBeCloseTo(60, 0);
    expect(update.position.y).toBeCloseTo(-20, 0);
  });

  it("does not move a clip that is not selected, and a tap changes nothing", async () => {
    ui.selectedItems = [];
    const { box } = setup();
    pointer(box, "pointerdown", 1, 100, 100);
    pointer(window as unknown as Element, "pointermove", 1, 160, 100);
    pointer(window as unknown as Element, "pointerup", 1, 160, 100);
    await tick();
    expect(state.updateClipTransform).not.toHaveBeenCalled();
  });

  it("puts the clip back with a double tap", async () => {
    clip.transform = { position: { x: 40, y: 10 }, scale: { x: 2, y: 2 }, rotation: 0, opacity: 1 };
    const { box } = setup();
    for (let i = 0; i < 2; i++) {
      pointer(box, "pointerdown", 1, 100, 100);
      pointer(window as unknown as Element, "pointerup", 1, 100, 100);
    }
    await tick();
    const [, update] = state.updateClipTransform.mock.calls.at(-1)!;
    expect(update.scale).toEqual({ x: 1, y: 1 });
    expect(update.position).toEqual({ x: 0, y: 0 });
  });

  it("leaves audio selections and an empty preview alone", async () => {
    state.project.timeline.tracks[0].type = "audio";
    const { box } = setup();
    const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => { box.dispatchEvent(wheel); });
    await tick();
    expect(wheel.defaultPrevented).toBe(false);
    expect(state.updateClipTransform).not.toHaveBeenCalled();
  });

  it("does nothing while disabled (full screen)", async () => {
    const view = render(<PreviewGestures enabled={false}><canvas /></PreviewGestures>);
    const box = view.container.firstElementChild as HTMLElement;
    const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => { box.dispatchEvent(wheel); });
    await tick();
    expect(state.updateClipTransform).not.toHaveBeenCalled();
  });
});
