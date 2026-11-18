/**
 * AI Editor tools for silent pauses (Hawsh Khalifa build): detect_silence (read-only) and cut_silence.
 * Detection is the editor's own (AudioEngine.detectSilence on the clip's source audio, the same engine as
 * the inspector's "Auto Cut Silence"). Cutting runs on the AI's draft through clip/split + clip/rippleDelete,
 * so the whole result commits — and undoes — as one AI edit. Like ripple delete in the UI, later clips on
 * the same track move left; other tracks are not moved. The one exception is automatic caption lines
 * (transcribe-tool.ts) of clips on that track: they follow their speech, so captions can be made first,
 * while the clip is one piece and costs one transcription, and the silence cut afterwards.
 */
import { getAudioEngine, type Project } from "@openreel/core";
import type { EditingHost, ToolResult } from "@openreel/agent";

/** `auto` reads the clip's own background noise to set the threshold (the phone editor); a number is fixed. */
export interface SilenceOptions { thresholdDb: number; minSilenceSec: number; paddingSec: number; auto?: boolean }
export const SILENCE_DEFAULTS: SilenceOptions = { thresholdDb: -40, minSilenceSec: 0.5, paddingSec: 0.1 };
/** What the phone editor uses: a fixed -40 dB finds nothing in a phone recording, whose room noise is louder. */
export const SILENCE_AUTO: SilenceOptions = { ...SILENCE_DEFAULTS, auto: true };

/**
 * The silence threshold (peak dB of a 100 ms window, the engine's own measure) for a recording with
 * background noise. A fixed -40 dB never matched a phone video: room noise peaks around -35 to -25 dB,
 * so no window ever counted as silent and the tool said "no silences found" every time. The quietest
 * tenth of the windows is the noise floor; the threshold sits 6 dB above it, never stricter than the
 * default and always well under the speech level. Audio without that contrast (music, a constant
 * tone) keeps the default.
 */
export function autoThresholdDb(buffer: AudioBuffer, fallback = SILENCE_DEFAULTS.thresholdDb): number {
  const data = buffer.getChannelData(0);
  const window = Math.max(1, Math.floor(buffer.sampleRate * 0.1));
  const levels: number[] = [];
  for (let i = 0; i < data.length; i += window) {
    const end = Math.min(i + window, data.length);
    let peak = 0;
    for (let j = i; j < end; j++) { const a = Math.abs(data[j]); if (a > peak) peak = a; }
    levels.push(20 * Math.log10(Math.max(peak, 1e-6)));
  }
  if (levels.length < 10) return fallback;
  levels.sort((a, b) => a - b);
  const floor = levels[Math.floor(levels.length * 0.1)];
  const speech = levels[Math.floor(levels.length * 0.9)];
  if (speech - floor < 12) return fallback;
  return Math.min(Math.max(fallback, floor + 6), speech - 10, -20);
}
/** split_clip needs a cut strictly inside a clip; never leave slivers shorter than this. */
const EDGE = 0.05;

interface ClipTiming { startTime: number; duration: number; inPoint: number }
export interface Region { start: number; end: number }

/**
 * Silent source ranges → timeline ranges to remove inside one clip: clipped to the clip's source window,
 * shrunk by the padding (keeps a breath around speech), dropped when shorter than the minimum, and
 * snapped to the clip edges when they would leave a sliver. Sorted by start.
 */
export function silenceRegions(clip: ClipTiming, source: readonly Region[], opts: SilenceOptions): Region[] {
  const srcEnd = clip.inPoint + clip.duration;
  const clipEnd = clip.startTime + clip.duration;
  const out: Region[] = [];
  for (const r of source) {
    const s = Math.max(r.start, clip.inPoint);
    const e = Math.min(r.end, srcEnd);
    if (e <= s) continue;
    let start = clip.startTime + (s - clip.inPoint) + (s > clip.inPoint ? opts.paddingSec : 0);
    let end = clip.startTime + (e - clip.inPoint) - (e < srcEnd ? opts.paddingSec : 0);
    if (start - clip.startTime < EDGE) start = clip.startTime;
    if (clipEnd - end < EDGE) end = clipEnd;
    if (end - start < opts.minSilenceSec) continue;
    out.push({ start: round(start), end: round(end) });
  }
  return out.sort((a, b) => a.start - b.start);
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function silenceOptions(args: Record<string, unknown>): SilenceOptions {
  const pick = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    thresholdDb: pick(args.thresholdDb, SILENCE_DEFAULTS.thresholdDb),
    minSilenceSec: pick(args.minSilenceSec, SILENCE_DEFAULTS.minSilenceSec),
    paddingSec: pick(args.paddingSec, SILENCE_DEFAULTS.paddingSec),
  };
}

function findClip(project: Project, clipId: string) {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

async function decode(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try { return await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { void ctx.close(); }
}

/** Timeline ranges of silence in a clip, or a reason it can't be analysed. */
export async function analyseSilence(project: Project, clipId: string, opts: SilenceOptions): Promise<{ regions: Region[]; clipEnd: number } | { error: string }> {
  const found = findClip(project, clipId);
  if (!found) return { error: "Clip ID was not found; use list_clips" };
  const { clip, track } = found;
  if (track.type !== "video" && track.type !== "audio") return { error: "Only video or audio clips have sound to analyse" };
  if ((clip.speed ?? 1) !== 1 || clip.reversed) return { error: "Cut silences before changing the clip's speed or reversing it" };
  const media = project.mediaLibrary.items.find((m) => m.id === clip.mediaId);
  if (!media?.blob) return { error: "The clip's media file is not available in this browser" };
  let buffer: AudioBuffer;
  try { buffer = await decode(media.blob); } catch { return { error: "This clip has no decodable audio" }; }
  const source = getAudioEngine().detectSilence(buffer, opts.auto ? autoThresholdDb(buffer, opts.thresholdDb) : opts.thresholdDb);
  return { regions: silenceRegions(clip, source, opts), clipEnd: clip.startTime + clip.duration };
}

const total = (regions: Region[]) => round(regions.reduce((s, r) => s + (r.end - r.start), 0));

export async function detectSilenceTool(args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> {
  const opts = silenceOptions(args);
  const res = await analyseSilence(host.getProject(), String(args.clipId), opts);
  if ("error" in res) return { ok: false, summary: "Silence detection failed", error: { code: "INVALID_EDIT", message: res.error } };
  return {
    ok: true,
    summary: `${res.regions.length} silent pauses, ${total(res.regions)}s in total`,
    data: { clipId: args.clipId, regions: res.regions, count: res.regions.length, totalSec: total(res.regions), settings: opts },
  };
}

/** Removes timeline `regions` (sorted, inside `clipId`) with split + ripple delete. Returns an error or null. */
export async function applySilenceCuts(host: EditingHost, clipId: string, regions: readonly Region[]): Promise<string | null> {
  const act = (type: string, params: Record<string, unknown>) =>
    host.applyAction({ type, id: crypto.randomUUID(), timestamp: Date.now(), params });

  // Latest pause first: the left part of every split keeps the original ID, so each earlier pause
  // still lies inside `clipId`, and ripple deletes never shift a range we have yet to cut.
  for (const r of [...regions].reverse()) {
    const current = findClip(host.getProject(), clipId);
    if (!current) return "The clip disappeared while cutting";
    const { clip, track } = current;
    const end = clip.startTime + clip.duration;
    if (r.end < end - EDGE) {
      const split = await act("clip/split", { clipId, time: r.end });
      if (!split.success) return split.error?.message ?? "Split failed";
    }
    let silentId = clipId;
    if (r.start > clip.startTime + EDGE) {
      const split = await act("clip/split", { clipId, time: r.start });
      if (!split.success) return split.error?.message ?? "Split failed";
      const piece = host.getProject().timeline.tracks.find((t) => t.id === track.id)?.clips
        .find((c) => c.id !== clipId && Math.abs(c.startTime - r.start) < 0.001 && c.mediaId === clip.mediaId);
      if (!piece) return "Could not find the silent piece after splitting";
      silentId = piece.id;
    }
    const del = await act("clip/rippleDelete", { clipId: silentId });
    if (!del.success) return del.error?.message ?? "Delete failed";
    if (silentId === clipId) break; // the first pause started at the clip start: nothing earlier is left
  }
  return null;
}

/** Where a timeline time lands once `regions` (sorted, not overlapping) are removed. */
export function timeAfterCuts(t: number, regions: readonly Region[]): number {
  let removed = 0;
  for (const r of regions) removed += Math.min(Math.max(t - r.start, 0), r.end - r.start);
  return round(t - removed);
}

interface CaptionText { id: string; startTime: number; duration: number; metadata?: { captionSourceClipId?: unknown } }

/** Caption lines whose speech is on `trackId`. Read before cutting: a cut can delete the clip they name. */
function captionsOfTrack(project: Project, trackId: string): string[] {
  const onTrack = new Set(project.timeline.tracks.find((t) => t.id === trackId)?.clips.map((c) => c.id));
  return ((project.textClips ?? []) as unknown as CaptionText[])
    .filter((t) => typeof t.metadata?.captionSourceClipId === "string" && onTrack.has(t.metadata.captionSourceClipId))
    .map((t) => t.id);
}

/** Moves those caption lines to follow the cut; a line that sat wholly inside a removed pause is dropped. */
async function moveCaptions(host: EditingHost, ids: readonly string[], regions: readonly Region[]): Promise<{ moved: number } | { error: string }> {
  let moved = 0;
  for (const id of ids) {
    const text = ((host.getProject().textClips ?? []) as unknown as CaptionText[]).find((t) => t.id === id);
    if (!text) continue;
    const start = timeAfterCuts(text.startTime, regions);
    const end = timeAfterCuts(text.startTime + text.duration, regions);
    if (start === text.startTime && round(end - start) === round(text.duration)) continue;
    const gone = end - start < EDGE;
    const result = await host.applyAction(gone
      ? { type: "text/remove", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: id } }
      : { type: "text/update", id: crypto.randomUUID(), timestamp: Date.now(), params: { clipId: id, updates: { startTime: start, duration: round(end - start) } } });
    if (!result.success) return { error: result.error?.message ?? "Could not move a caption line" };
    moved++;
  }
  return { moved };
}

export async function cutSilenceTool(args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> {
  const opts = silenceOptions(args);
  const clipId = String(args.clipId);
  const res = await analyseSilence(host.getProject(), clipId, opts);
  if ("error" in res) return { ok: false, summary: "Silence cut failed", error: { code: "INVALID_EDIT", message: res.error } };
  if (!res.regions.length) return { ok: true, summary: "No silent pauses found with these settings", data: { removed: 0, totalSec: 0 } };

  const trackId = findClip(host.getProject(), clipId)?.track.id;
  const captionIds = trackId ? captionsOfTrack(host.getProject(), trackId) : [];
  const error = await applySilenceCuts(host, clipId, res.regions);
  if (error) return { ok: false, summary: "Silence cut failed", error: { code: "INVALID_EDIT", message: error } };
  const captions = await moveCaptions(host, captionIds, res.regions);
  if ("error" in captions) return { ok: false, summary: "Silence cut failed", error: { code: "INVALID_EDIT", message: captions.error } };
  return {
    ok: true,
    summary: `Removed ${res.regions.length} silent pauses (${total(res.regions)}s)${captions.moved ? `; ${captions.moved} caption lines moved with the cut` : ""}`,
    data: { removed: res.regions.length, totalSec: total(res.regions), captionLinesMoved: captions.moved, settings: opts },
  };
}
