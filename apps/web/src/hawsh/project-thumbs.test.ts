import { describe, expect, it, vi } from "vitest";

vi.mock("../services/auto-save", () => ({ autoSaveManager: {} }));
vi.mock("../services/media-storage", () => ({ loadMediaBlob: vi.fn() }));

const { firstVisualClip } = await import("./project-thumbs");

const clip = (mediaId: string, startTime: number, inPoint = 0) => ({ id: `${mediaId}-${startTime}`, mediaId, startTime, inPoint });
const project = (tracks: unknown[]) => ({
  mediaLibrary: { items: [
    { id: "vid", type: "video", thumbnailUrl: "data:image/jpeg;x" },
    { id: "img", type: "image", thumbnailUrl: null },
    { id: "song", type: "audio", thumbnailUrl: null },
  ] },
  timeline: { tracks },
}) as never;

describe("firstVisualClip", () => {
  it("picks the earliest video or image clip across tracks, from its in point", () => {
    expect(firstVisualClip(project([
      { hidden: false, clips: [clip("vid", 5, 2)] },
      { hidden: false, clips: [clip("vid", 1, 3), clip("img", 9)] },
    ]))).toEqual({ mediaId: "vid", type: "video", time: 3, thumbnailUrl: "data:image/jpeg;x" });
  });

  it("skips audio, hidden tracks and clips whose media is missing", () => {
    expect(firstVisualClip(project([
      { hidden: false, clips: [clip("song", 0), clip("nope", 0)] },
      { hidden: true, clips: [clip("vid", 0)] },
      { hidden: false, clips: [clip("img", 4)] },
    ]))).toMatchObject({ mediaId: "img", type: "image" });
  });

  it("returns null when the project has nothing to show", () => {
    expect(firstVisualClip(project([{ hidden: false, clips: [clip("song", 0)] }]))).toBeNull();
    expect(firstVisualClip(project([]))).toBeNull();
  });
});
