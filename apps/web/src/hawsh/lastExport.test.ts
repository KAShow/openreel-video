import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  status: "ready",
  save: vi.fn(async () => ({ reused: false })),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("./session", () => ({ useHawshStore: { getState: () => ({ status: h.status }) } }));
vi.mock("./api", () => ({ saveExportToLibrary: h.save }));
vi.mock("../stores/notification-store", () => ({ toast: { success: h.success, error: h.error } }));

import { clearLastExport, rememberExport, saveNextExportToLibrary, useLastExport, willSaveNextExport } from "./lastExport";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// jsdom Blobs have no arrayBuffer().
const video = () => Object.assign(new Blob(["frames"], { type: "video/mp4" }), { arrayBuffer: () => Promise.resolve(new ArrayBuffer(6)) });

describe("saving the next export to My references", () => {
  beforeEach(() => { vi.clearAllMocks(); clearLastExport(); h.status = "ready"; });

  it("only saves when the assistant asked for it", async () => {
    rememberExport(video(), "a.mp4");
    await settle(); await settle();
    expect(useLastExport.getState().filename).toBe("a.mp4");
    expect(h.save).not.toHaveBeenCalled();
  });

  it("saves the next finished export once, then goes back to normal", async () => {
    saveNextExportToLibrary();
    expect(willSaveNextExport()).toBe(true);
    rememberExport(video(), "reel.mp4");
    await settle(); await settle();
    expect(h.save).toHaveBeenCalledWith(expect.any(Blob), "reel.mp4");
    expect(h.success).toHaveBeenCalledWith("حُفظ الفيديو في «مراجعي».");
    expect(willSaveNextExport()).toBe(false);
    rememberExport(video(), "second.mp4");
    await settle(); await settle();
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it("says so when the save fails", async () => {
    h.save.mockRejectedValueOnce(new Error("Upload failed."));
    saveNextExportToLibrary();
    rememberExport(video(), "reel.mp4");
    await settle(); await settle();
    expect(h.error).toHaveBeenCalledWith("تعذّر حفظ الفيديو في «مراجعي».", "Upload failed.");
  });
});
