import { afterEach, describe, expect, it, vi } from "vitest";
import { canShareVideo, holdExport, releaseHeldExport, shareHeldExport, useHeldExport } from "./heldExport";

const video = () => new Blob(["mp4"], { type: "video/mp4" });

afterEach(() => {
  releaseHeldExport();
  vi.unstubAllGlobals();
});

describe("held export", () => {
  it("shares the video as an mp4 file named after the project", async () => {
    const share = vi.fn(async (_data: { files?: File[] }) => undefined);
    vi.stubGlobal("navigator", { share, canShare: () => true });
    holdExport(video(), "رحلة.mp4");
    expect(await shareHeldExport()).toBe("shared");
    const file = share.mock.calls[0][0].files![0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("رحلة.mp4");
    expect(file.type).toBe("video/mp4");
  });

  it("reports a cancelled share quietly and keeps the file", async () => {
    vi.stubGlobal("navigator", { share: () => Promise.reject(new DOMException("no", "AbortError")), canShare: () => true });
    holdExport(video(), "a.mp4");
    expect(await shareHeldExport()).toBe("cancelled");
    expect(useHeldExport.getState().file).not.toBeNull();
  });

  it("reports other share errors as failed", async () => {
    vi.stubGlobal("navigator", { share: () => Promise.reject(new Error("NotAllowedError")), canShare: () => true });
    holdExport(video(), "a.mp4");
    expect(await shareHeldExport()).toBe("failed");
  });

  it("releases the held file once, and holding a new one releases the old", () => {
    const first = vi.fn();
    const second = vi.fn();
    holdExport(video(), "a.mp4", first);
    holdExport(video(), "b.mp4", second);
    expect(first).toHaveBeenCalledTimes(1);
    releaseHeldExport();
    releaseHeldExport();
    expect(second).toHaveBeenCalledTimes(1);
    expect(useHeldExport.getState()).toMatchObject({ file: null, filename: null });
  });

  it("can share only where the browser shares video files", () => {
    vi.stubGlobal("navigator", {});
    expect(canShareVideo()).toBe(false);
    vi.stubGlobal("navigator", { share: vi.fn(), canShare: (d: { files?: File[] }) => !!d.files?.length });
    expect(canShareVideo()).toBe(true);
  });
});
