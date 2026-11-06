import { afterEach, describe, expect, it, vi } from "vitest";
import { captureNativeVideoFrame, seekVideoToFrame } from "./video-frame";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("captureNativeVideoFrame", () => {
  it("captures the native video source without canvas-sized background padding", async () => {
    const video = {} as HTMLVideoElement;
    const nativeFrame = { width: 720, height: 1280 } as ImageBitmap;
    const createBitmap = vi.fn().mockResolvedValue(nativeFrame);
    vi.stubGlobal("createImageBitmap", createBitmap);

    await expect(captureNativeVideoFrame(video)).resolves.toBe(nativeFrame);
    expect(createBitmap).toHaveBeenCalledOnce();
    expect(createBitmap).toHaveBeenCalledWith(video);
  });
});

describe("seekVideoToFrame", () => {
  /** A paused video element: the test decides when the seek lands and when the frame is presented. */
  const fakeVideo = (withFrameCallback = true) => {
    const target = new EventTarget();
    const frames: (() => void)[] = [];
    const video = {
      currentTime: 0,
      seeking: false,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      ...(withFrameCallback ? {
        requestVideoFrameCallback: vi.fn((callback: () => void) => frames.push(callback)),
        cancelVideoFrameCallback: vi.fn(),
      } : {}),
    };
    return {
      video: video as unknown as HTMLVideoElement,
      land: () => target.dispatchEvent(new Event("seeked")),
      present: () => frames.splice(0).forEach((callback) => callback()),
      setSeeking: (value: boolean) => { video.seeking = value; },
    };
  };
  const settled = async (promise: Promise<void>) => {
    let done = false;
    void promise.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    return done;
  };

  it("does not wait for a frame the browser presented before the seek landed", async () => {
    vi.useFakeTimers();
    const { video, land, present } = fakeVideo();
    const seek = seekVideoToFrame(video, 7, 100);
    expect(video.currentTime).toBe(7);
    present();
    land();
    expect(await settled(seek)).toBe(true);
  });

  it("finishes when the frame arrives after the seek landed", async () => {
    vi.useFakeTimers();
    const { video, land, present } = fakeVideo();
    const seek = seekVideoToFrame(video, 7, 100);
    land();
    expect(await settled(seek)).toBe(false);
    present();
    expect(await settled(seek)).toBe(true);
  });

  it("gives up on the frame callback shortly after the seek landed", async () => {
    vi.useFakeTimers();
    const { video, land } = fakeVideo();
    const seek = seekVideoToFrame(video, 7, 100);
    land();
    await vi.advanceTimersByTimeAsync(99);
    expect(await settled(seek)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(seek)).toBe(true);
  });

  it("works without the frame callback", async () => {
    vi.useFakeTimers();
    const { video, land } = fakeVideo(false);
    const seek = seekVideoToFrame(video, 7, 100);
    land();
    expect(await settled(seek)).toBe(true);
  });

  it("ignores a landing while a newer seek is still running", async () => {
    vi.useFakeTimers();
    const { video, land, present, setSeeking } = fakeVideo();
    const seek = seekVideoToFrame(video, 7, 100);
    present();
    setSeeking(true);
    land();
    expect(await settled(seek)).toBe(false);
    setSeeking(false);
    land();
    expect(await settled(seek)).toBe(true);
  });

  it("finishes as soon as the seek lands when no frame wait is needed", async () => {
    vi.useFakeTimers();
    const { video, land } = fakeVideo();
    const seek = seekVideoToFrame(video, 7, 0);
    land();
    expect(await settled(seek)).toBe(true);
    expect(video.requestVideoFrameCallback).not.toHaveBeenCalled();
  });

  it("waits long enough for a slow decoder, then stops waiting", async () => {
    vi.useFakeTimers();
    const { video } = fakeVideo();
    const seek = seekVideoToFrame(video, 7);
    await vi.advanceTimersByTimeAsync(9999);
    expect(await settled(seek)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(seek)).toBe(true);
  });
});
