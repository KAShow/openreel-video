import { beforeEach, describe, expect, it, vi } from "vitest";

const placed: Array<[string, string | undefined, number]> = [];
const state = {
  project: { timeline: { tracks: [] as unknown[] } },
  placeMediaClip: vi.fn(async (id: string, trackId: string | undefined, start: number) => {
    placed.push([id, trackId, start]);
    // The clip lands on the target track (or a new "t-new" track) so the next append goes after it.
    const tracks = state.project.timeline.tracks as Array<{ id: string; type: string; clips: unknown[] }>;
    let track = tracks.find((t) => t.id === trackId);
    if (!track) { track = { id: "t-new", type: "video", clips: [] }; tracks.push(track); }
    track.clips.push({ id: `c-${id}`, startTime: start, duration: 4 });
    return { success: true };
  }),
  addClip: vi.fn(async (trackId: string, id: string, start: number) => state.placeMediaClip(id, trackId, start)),
  createTextClip: vi.fn((trackId: string, start: number, text: string) => ({ id: "txt", trackId, startTime: start, text })),
  updateTextContent: vi.fn((id: string, text: string) => ({ id, text })),
};
vi.mock("../../stores/project-store", () => ({ useProjectStore: { getState: () => state } }));
vi.mock("../../stores/project/insert-timeline-overlay", () => ({
  insertTimelineOverlay: async (_t: number, _d: number, create: (trackId: string) => unknown) => create("overlay-track"),
}));

const { addText, appendToTimeline, captionClipId, editText, mainTrack, PHONE_TEXT_STYLE } = await import("./add-tools");

const clip = (id: string, mediaId: string, startTime: number, duration: number) => ({ id, mediaId, startTime, duration });

beforeEach(() => { placed.length = 0; });

describe("text", () => {
  it("adds trimmed text at the playhead with Arabic-safe spacing, and ignores empty text", async () => {
    expect(await addText("  مرحبا  ", 2)).toMatchObject({ id: "txt", trackId: "overlay-track" });
    expect(state.createTextClip).toHaveBeenCalledWith("overlay-track", 2, "مرحبا", 3, PHONE_TEXT_STYLE);
    expect(PHONE_TEXT_STYLE.letterSpacing).toBe(0);
    expect(await addText("   ", 2)).toBeNull();
    expect(editText("txt", " جديد ")).toBe(true);
    expect(state.updateTextContent).toHaveBeenCalledWith("txt", "جديد");
    expect(editText("txt", "")).toBe(false);
  });
});

describe("library to timeline", () => {
  it("appends items one after another at the end of the busiest video track", async () => {
    state.project = { timeline: { tracks: [
      { id: "a", type: "audio", clips: [clip("x", "s", 0, 30)] },
      { id: "v1", type: "video", clips: [clip("c1", "m", 0, 5)] },
      { id: "v2", type: "video", clips: [clip("c2", "m", 0, 2), clip("c3", "m", 2, 3), clip("c4", "m", 6, 1)] },
    ] } };
    expect(await appendToTimeline(["m1", "m2"])).toBe(2);
    expect(placed).toEqual([["m1", "v2", 7], ["m2", "v2", 11]]);
    expect(state.addClip).toHaveBeenCalledTimes(2);
  });

  it("starts a new track at 0 on an empty timeline", async () => {
    state.project = { timeline: { tracks: [{ id: "v", type: "video", clips: [] }] } };
    expect(mainTrack(state.project as never)).toBeNull();
    await appendToTimeline(["m1", "m2"]);
    expect(placed).toEqual([["m1", undefined, 0], ["m2", "t-new", 4]]);
  });
});

describe("captionClipId", () => {
  const project = {
    mediaLibrary: { items: [{ id: "vid", type: "video" }, { id: "img", type: "image" }] },
    timeline: { tracks: [{ id: "v", type: "video", hidden: false, clips: [clip("i1", "img", 0, 2), clip("v1", "vid", 2, 3), clip("v2", "vid", 5, 3)] }] },
  } as never;
  it("picks the video under the playhead, else the first video", () => {
    expect(captionClipId(project, 6)).toBe("v2");
    expect(captionClipId(project, 1)).toBe("v1");
    expect(captionClipId({ mediaLibrary: { items: [] }, timeline: { tracks: [] } } as never, 0)).toBeUndefined();
  });
});
