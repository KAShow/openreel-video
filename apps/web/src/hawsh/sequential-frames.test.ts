import { describe, expect, it } from "vitest";
import { SequentialFrames, closeSequentialFrames, sequentialFramesFor, type FrameSink, type SinkFrame } from "./sequential-frames";

/** A fake 30 fps, 10 s video that counts how many frames it decodes. */
function fakeSink() {
  const fps = 30;
  const stats = { decoded: 0, randomAccess: 0, readersOpen: 0 };
  const frame = (i: number): SinkFrame => ({ canvas: { width: i } as unknown as OffscreenCanvas, timestamp: i / fps, duration: 1 / fps });
  const sink: FrameSink = {
    async getCanvas(t) {
      stats.randomAccess++;
      const i = Math.floor(t * fps + 1e-6);
      stats.decoded += (i % 60) + 1; // decode from the keyframe (every 2 s)
      return i >= 0 && i < 300 ? frame(i) : null;
    },
    async *canvases(start = 0) {
      stats.readersOpen++;
      try {
        const keyframe = Math.floor(Math.floor(start * fps + 1e-6) / 60) * 60;
        for (let i = keyframe; i < 300; i++) {
          stats.decoded++;
          if (i >= Math.floor(start * fps + 1e-6)) yield frame(i);
        }
      } finally { stats.readersOpen--; }
    },
  };
  return { sink, stats };
}

const index = (f: SinkFrame | null) => (f ? (f.canvas as unknown as { width: number }).width : -1);

describe("SequentialFrames", () => {
  it("returns the frame on screen at each time", async () => {
    const { sink } = fakeSink();
    const r = new SequentialFrames(sink);
    expect(index(await r.frameAt(0))).toBe(0);
    expect(index(await r.frameAt(0.02))).toBe(0);
    expect(index(await r.frameAt(0.034))).toBe(1);
    expect(index(await r.frameAt(1))).toBe(30);
  });

  it("decodes each frame once over continuous playback, unlike one random access per frame", async () => {
    const { sink, stats } = fakeSink();
    const r = new SequentialFrames(sink);
    for (let i = 0; i < 300; i++) await r.frameAt(i / 30);
    expect(r.restarts).toBe(1);
    expect(stats.decoded).toBeLessThanOrEqual(300);

    const random = fakeSink();
    for (let i = 0; i < 300; i++) await random.sink.getCanvas(i / 30);
    expect(random.stats.decoded).toBeGreaterThan(9000);
  });

  it("skips frames when the preview falls behind or plays faster", async () => {
    const { sink } = fakeSink();
    const r = new SequentialFrames(sink);
    for (let t = 0; t < 4; t += 2 / 30) expect(index(await r.frameAt(t))).toBe(Math.floor(t * 30 + 1e-6));
    expect(r.restarts).toBe(1);
  });

  it("starts a new reader after a seek back or a big jump ahead, and closes the old one", async () => {
    const { sink, stats } = fakeSink();
    const r = new SequentialFrames(sink);
    await r.frameAt(5);
    expect(index(await r.frameAt(1))).toBe(30);
    expect(index(await r.frameAt(8))).toBe(240);
    expect(r.restarts).toBe(3);
    expect(stats.readersOpen).toBe(1);
    await r.close();
    expect(stats.readersOpen).toBe(0);
  });

  it("returns the last frame after the end of the file", async () => {
    const { sink } = fakeSink();
    const r = new SequentialFrames(sink);
    await r.frameAt(9.9);
    expect(index(await r.frameAt(10.5))).toBe(299);
  });

  it("keeps one reader per sink and closes it on request", async () => {
    const { sink, stats } = fakeSink();
    expect(sequentialFramesFor(sink)).toBe(sequentialFramesFor(sink));
    await sequentialFramesFor(sink).frameAt(1);
    closeSequentialFrames(sink);
    await new Promise((r) => setTimeout(r, 0));
    expect(stats.readersOpen).toBe(0);
    expect(sequentialFramesFor(sink).restarts).toBe(0);
  });
});
