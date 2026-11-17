/**
 * Video frames for continuous playback on the frame-by-frame preview path (used for effects, speed
 * changes, layers and transitions). Hawsh build.
 *
 * mediabunny's `CanvasSink.getCanvas(t)` is random access: every call goes back to the keyframe before
 * `t` and decodes forward from there. Calling it once per preview frame meant decoding 15–60 frames
 * (a typical phone video's keyframe gap) to show one, so playback with any effect dropped to a few
 * frames a second. `canvases(start)` decodes in order, each frame once, a few frames ahead.
 *
 * This keeps one such reader per clip and moves it forward with the playhead, skipping frames when the
 * preview falls behind (or a speed-up asks for every second frame). Going back in time or jumping far
 * ahead (a seek, reverse playback) starts a new reader at the new spot. Only one or two canvases from
 * the sink's pool are held at a time, so a pool of 3 stays safe.
 */

export interface SinkFrame {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  timestamp: number;
  duration: number;
}

export interface FrameSink {
  getCanvas(timestamp: number): Promise<SinkFrame | null>;
  canvases(startTimestamp?: number, endTimestamp?: number): AsyncGenerator<SinkFrame, void, unknown>;
}

/** Seconds ahead beyond which reading forward costs more than starting again at the new spot. */
export const MAX_FORWARD_GAP = 1.5;
const EPSILON = 1e-4;

export class SequentialFrames {
  private reader: AsyncGenerator<SinkFrame, void, unknown> | null = null;
  private current: SinkFrame | null = null;
  private next: SinkFrame | null = null;
  private ended = false;
  private lastTime = -Infinity;
  /** How many readers were started (tests and the playback meter). */
  restarts = 0;

  constructor(private readonly sink: FrameSink) {}

  /** The frame on screen at `time` (seconds in the source file): the last frame starting at or before it. */
  async frameAt(time: number): Promise<SinkFrame | null> {
    if (!this.reader || time < this.lastTime - EPSILON || time > this.lastTime + MAX_FORWARD_GAP) {
      await this.restart(time);
    }
    this.lastTime = time;
    while (!this.ended) {
      if (!this.next) {
        const step = await this.reader!.next();
        if (step.done) { this.ended = true; break; }
        this.next = step.value;
      }
      if (this.next.timestamp > time + EPSILON) break;
      this.current = this.next;
      this.next = null;
    }
    // Before the first frame the reader yields (a start between two frames), ask the sink directly once.
    return this.current ?? (await this.sink.getCanvas(time));
  }

  private async restart(time: number): Promise<void> {
    await this.close();
    this.reader = this.sink.canvases(Math.max(0, time));
    this.current = null;
    this.next = null;
    this.ended = false;
    this.restarts++;
  }

  /** Stops the reader (frees its decoder). Safe to call more than once. */
  async close(): Promise<void> {
    const reader = this.reader;
    this.reader = null;
    this.current = null;
    this.next = null;
    if (reader) await reader.return(undefined).catch(() => undefined);
  }
}

const readers = new WeakMap<object, SequentialFrames>();

/** The playback reader for a sink (one per clip's sink), created on first use. */
export function sequentialFramesFor(sink: FrameSink): SequentialFrames {
  let r = readers.get(sink);
  if (!r) { r = new SequentialFrames(sink); readers.set(sink, r); }
  return r;
}

/** Stops a sink's reader before its file is closed. */
export function closeSequentialFrames(sink: unknown): void {
  if (!sink || typeof sink !== "object") return;
  const r = readers.get(sink);
  if (!r) return;
  readers.delete(sink);
  void r.close();
}
