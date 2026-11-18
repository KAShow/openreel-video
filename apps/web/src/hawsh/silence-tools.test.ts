import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolResult } from "@openreel/agent";
import { useProjectStore } from "../stores/project-store";
import { EditingSession } from "../services/agent/editing-session";
import { editingToolDefs, editingToolReadOnly, executeEditingTool } from "../services/agent/editing-tools";
import { TitleEngine } from "@openreel/core/text/title-engine";
import { autoThresholdDb, SILENCE_DEFAULTS, silenceRegions, timeAfterCuts } from "./silence-tools";
import { AudioEngine } from "@openreel/core";

const opts = SILENCE_DEFAULTS; // -40 dB, 0.5 s minimum, 0.1 s padding

/** A phone recording: speech at 0.5 with room noise at `noise` in the pauses (2–3.5 s and 6–8 s of 10 s). */
function noisyAudio(noise: number): AudioBuffer {
  const rate = 8000;
  const data = new Float32Array(rate * 10);
  for (let i = 0; i < data.length; i++) data[i] = (i % 2 ? 1 : -1) * noise;
  const speech = (from: number, to: number) => { for (let i = from * rate; i < to * rate; i++) data[i] = (i % 2 ? 1 : -1) * 0.5; };
  speech(0, 2); speech(3.5, 6); speech(8, 10);
  return { sampleRate: rate, duration: 10, numberOfChannels: 1, length: data.length, getChannelData: () => data } as unknown as AudioBuffer;
}

describe("autoThresholdDb", () => {
  it("finds pauses in a recording whose room noise is louder than the fixed -40 dB", () => {
    const noisy = noisyAudio(0.03); // about -30 dB: never "silent" at -40
    expect(new AudioEngine().detectSilence(noisy, SILENCE_DEFAULTS.thresholdDb)).toEqual([]);
    const threshold = autoThresholdDb(noisy);
    expect(threshold).toBeGreaterThan(-30);
    const found = new AudioEngine().detectSilence(noisy, threshold);
    expect(found.map((r) => [Math.round(r.start), Math.round(r.end)])).toEqual([[2, 4], [6, 8]]);
  });
  it("keeps the default for clean audio and for audio with nothing to tell apart", () => {
    expect(autoThresholdDb(noisyAudio(0))).toBe(SILENCE_DEFAULTS.thresholdDb);
    const flat = { sampleRate: 8000, duration: 10, getChannelData: () => new Float32Array(80000).fill(0.3) } as unknown as AudioBuffer;
    expect(autoThresholdDb(flat)).toBe(SILENCE_DEFAULTS.thresholdDb);
  });
  it("stays well under the speech level", () => {
    expect(autoThresholdDb(noisyAudio(0.2))).toBeLessThanOrEqual(-20);
  });
});

describe("silenceRegions", () => {
  const clip = { startTime: 10, duration: 8, inPoint: 2 }; // source 2..10 on timeline 10..18

  it("maps source silences inside the clip to padded timeline ranges", () => {
    expect(silenceRegions(clip, [{ start: 4, end: 5 }], opts)).toEqual([{ start: 12.1, end: 12.9 }]);
  });
  it("clips to the source window and does not pad at the clip edges", () => {
    expect(silenceRegions(clip, [{ start: 0, end: 3 }, { start: 9, end: 12 }], opts)).toEqual([
      { start: 10, end: 10.9 },
      { start: 17.1, end: 18 },
    ]);
  });
  it("drops pauses shorter than the minimum (after padding) and ones outside the clip", () => {
    expect(silenceRegions(clip, [{ start: 4, end: 4.6 }, { start: 11, end: 13 }], opts)).toEqual([]);
  });
});

describe("timeAfterCuts", () => {
  const cuts = [{ start: 2.1, end: 3.4 }, { start: 6.1, end: 7.9 }];
  it("keeps times before the first cut and pulls later ones left by what was removed", () => {
    expect(timeAfterCuts(1, cuts)).toBe(1);
    expect(timeAfterCuts(4, cuts)).toBe(2.7);
    expect(timeAfterCuts(9, cuts)).toBe(5.9);
  });
  it("lands a time inside a cut on the cut's start", () => {
    expect(timeAfterCuts(3, cuts)).toBe(2.1);
    expect(timeAfterCuts(7, cuts)).toBe(4.8);
  });
});

function ok(result: ToolResult): Record<string, unknown> {
  expect(result.ok, result.error?.message).toBe(true);
  return result.data as Record<string, unknown>;
}

/** 10 s of "speech" at 48 kHz with silence at 2–3.5 s and 6–8 s (amplitude 0 vs 0.5). */
function fakeAudio(): AudioBuffer {
  const rate = 48000;
  const data = new Float32Array(rate * 10).fill(0.5);
  data.fill(0, 2 * rate, 3.5 * rate);
  data.fill(0, 6 * rate, 8 * rate);
  return { sampleRate: rate, duration: 10, numberOfChannels: 1, length: data.length, getChannelData: () => data } as unknown as AudioBuffer;
}

describe("detect_silence / cut_silence tools", () => {
  beforeEach(() => {
    vi.spyOn(window.AudioContext.prototype, "decodeAudioData").mockImplementation(() => Promise.resolve(fakeAudio()));
    useProjectStore.getState().createNewProject("Silence");
    const { project } = useProjectStore.getState();
    useProjectStore.setState({ project: { ...project, mediaLibrary: { items: [{
      id: "talk", name: "talk.mp4", type: "video", blob: Object.assign(new Blob(["fixture"]), { arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
      fileHandle: null, thumbnailUrl: null, waveformData: null,
      metadata: { duration: 10, width: 640, height: 360, frameRate: 24, codec: "avc", sampleRate: 48000, channels: 1, fileSize: 7 },
    }] } } });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  async function setup() {
    const session = new EditingSession(); session.beginTransaction();
    const { trackId } = ok(await executeEditingTool("add_track", { trackType: "video" }, session));
    const { clipId } = ok(await executeEditingTool("add_clip", { trackId, mediaId: "talk", startTime: 0 }, session));
    return { session, trackId: trackId as string, clipId: clipId as string };
  }

  it("are offered to the model, detect is read-only", () => {
    const names = editingToolDefs("openai").map((d) => (d as { function: { name: string } }).function.name);
    expect(names).toEqual(expect.arrayContaining(["detect_silence", "cut_silence"]));
    expect(editingToolReadOnly("detect_silence")).toBe(true);
    expect(editingToolReadOnly("cut_silence")).toBe(false);
  });

  it("detect_silence reports the pauses without changing the timeline", async () => {
    const { session, clipId } = await setup();
    const data = ok(await executeEditingTool("detect_silence", { clipId }, session));
    expect(data.regions).toEqual([{ start: 2.1, end: 3.4 }, { start: 6.1, end: 7.9 }]);
    expect(data.totalSec).toBe(3.1);
    expect(session.getProject().timeline.tracks.flatMap((t) => t.clips)).toHaveLength(1);
  });

  it("cut_silence removes the pauses and closes the gaps", async () => {
    const { session, trackId } = await setup();
    const clipId = session.getProject().timeline.tracks.find((t) => t.id === trackId)!.clips[0].id;
    const data = ok(await executeEditingTool("cut_silence", { clipId }, session));
    expect(data).toMatchObject({ removed: 2, totalSec: 3.1 });
    const clips = session.getProject().timeline.tracks.find((t) => t.id === trackId)!.clips
      .slice().sort((a, b) => a.startTime - b.startTime)
      .map((c) => ({ start: +c.startTime.toFixed(3), dur: +c.duration.toFixed(3), in: +c.inPoint.toFixed(3) }));
    // Kept source: 0–2.1, 3.4–6.1, 7.9–10 → back to back on the timeline (6.9 s in total).
    expect(clips).toEqual([
      { start: 0, dur: 2.1, in: 0 },
      { start: 2.1, dur: 2.7, in: 3.4 },
      { start: 4.8, dur: 2.1, in: 7.9 },
    ]);
  });

  it("cut_silence carries the clip's caption lines with it, and leaves other text alone", async () => {
    const { session, clipId } = await setup();
    const { trackId: textTrack } = ok(await executeEditingTool("add_track", { trackType: "text" }, session));
    session.allowNonPortableDraft();
    const add = async (text: string, startTime: number, duration: number, caption: boolean) => {
      const clip = new TitleEngine().createTextClip({ trackId: textTrack as string, text, startTime, duration, ...(caption ? { metadata: { captionSource: "whisper", captionSourceClipId: clipId } } : {}) });
      expect((await session.applyAction({ type: "text/create", id: crypto.randomUUID(), timestamp: Date.now(), params: { clip } })).success).toBe(true);
    };
    await add("before", 0.5, 1, true);    // before both pauses: stays
    await add("in pause", 2.5, 0.7, true); // wholly inside the first pause (2.1–3.4): dropped
    await add("middle", 4, 1, true);       // after 1.3 s removed
    await add("end", 8.5, 1, true);        // after 3.1 s removed
    await add("title", 4, 1, false);       // not a caption: other tracks are not moved

    const data = ok(await executeEditingTool("cut_silence", { clipId }, session));
    expect(data).toMatchObject({ removed: 2, captionLinesMoved: 3 });
    const texts = (session.getProject().textClips ?? []).map((t) => [t.text, +t.startTime.toFixed(3), +t.duration.toFixed(3)]);
    expect(texts).toEqual([["before", 0.5, 1], ["middle", 2.7, 1], ["end", 5.4, 1], ["title", 4, 1]]);
  });

  it("refuses sped-up clips", async () => {
    const { session, clipId } = await setup();
    ok(await executeEditingTool("set_clip_speed", { clipId, speed: 2 }, session));
    const r = await executeEditingTool("cut_silence", { clipId }, session);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/speed/);
  });
});
