import { beforeEach, describe, expect, it, vi } from "vitest";

const logEvent = vi.fn();
vi.mock("./logger", () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

import { finishPreviewPlayback, markPreviewFrame, resetPerfMeter, setPlaybackContext } from "./perf";

describe("preview playback meter", () => {
  beforeEach(() => { resetPerfMeter(); logEvent.mockClear(); });

  it("measures frames per second and the longest gap", () => {
    for (let i = 0; i <= 120; i++) markPreviewFrame("native", i * 33.3); // 4 s at ~30 fps
    markPreviewFrame("native", 120 * 33.3 + 200); // one 200 ms hitch
    const stats = finishPreviewPlayback()!;
    expect(stats.path).toBe("native");
    expect(stats.fps).toBeGreaterThan(28);
    expect(stats.longestGapMs).toBeCloseTo(200, 0);
  });

  it("logs one summary for playbacks of 3 seconds or more, with the preview's context", () => {
    setPlaybackContext(() => ({ preview: "720x1280" }));
    for (let i = 0; i <= 100; i++) markPreviewFrame("multi", i * 40);
    finishPreviewPlayback();
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][0]).toBe("usage");
    expect(logEvent.mock.calls[0][1]).toMatchObject({ event: "playback", path: "multi", fps: 25, preview: "720x1280" });
    expect(finishPreviewPlayback()).toBeNull();
  });

  it("does not log short taps on play", () => {
    for (let i = 0; i <= 30; i++) markPreviewFrame("native", i * 33);
    finishPreviewPlayback();
    expect(logEvent).not.toHaveBeenCalled();
  });
});
