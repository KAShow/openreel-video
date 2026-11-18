import { describe, expect, it, vi } from "vitest";
import type { MediaItem } from "@openreel/core";

const bridge = {
  isInitialized: () => true,
  generateThumbnailsForMedia: vi.fn(async () => [{ timestamp: 0, dataUrl: "blob:first" }, { timestamp: 1, dataUrl: "blob:second" }]),
};
vi.mock("../../bridges/media-bridge", () => ({ getMediaBridge: () => bridge, initializeMediaBridge: vi.fn() }));
vi.mock("../../services/auto-save", () => ({ autoSaveManager: {}, initializeAutoSave: vi.fn() }));
vi.mock("../../services/project-manager", () => ({ projectManager: {} }));

const { rebuildFilmstrips } = await import("./persistence-slice");

const blob = new Blob(["x"]);
const video = (over: Partial<MediaItem> = {}) => ({ id: "v", type: "video", blob, thumbnailUrl: null, filmstripThumbnails: undefined, ...over }) as unknown as MediaItem;

function store(items: MediaItem[], id = "p") {
  let state = { project: { id, mediaLibrary: { items } } } as never as { project: { id: string; mediaLibrary: { items: MediaItem[] } } };
  return { get: () => state, set: (patch: object) => { state = { ...state, ...patch } as typeof state; }, read: () => state.project.mediaLibrary.items };
}

describe("rebuildFilmstrips", () => {
  it("gives a reopened video its first frame and the rest of the strip back", async () => {
    const s = store([video()]);
    await rebuildFilmstrips(s.read(), "p", s.get as never, s.set as never);
    const [item] = s.read();
    expect(item.thumbnailUrl).toBe("blob:first");
    expect(item.filmstripThumbnails).toEqual([{ timestamp: 0, url: "blob:first" }, { timestamp: 1, url: "blob:second" }]);
  });

  it("leaves strips that exist, files that are gone and other projects alone", async () => {
    bridge.generateThumbnailsForMedia.mockClear();
    const kept = video({ filmstripThumbnails: [{ timestamp: 0, url: "blob:old" }] });
    const missing = video({ id: "m", blob: null as never });
    const s = store([kept, missing]);
    await rebuildFilmstrips(s.read(), "p", s.get as never, s.set as never);
    expect(bridge.generateThumbnailsForMedia).not.toHaveBeenCalled();

    const other = store([video()], "another");
    await rebuildFilmstrips(other.read(), "p", other.get as never, other.set as never);
    expect(other.read()[0].filmstripThumbnails).toBeUndefined();
  });
});
