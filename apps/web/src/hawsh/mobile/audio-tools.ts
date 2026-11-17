/**
 * Sound on the phone: music or a voice recording on its own track at the playhead (quiet under speech,
 * with short fades), muting the original sound of the video, noise reduction and fades on a clip.
 */
import type { Clip, Project } from "@openreel/core";
import { mainTrack } from "./add-tools";
import { act, FAILED, grouped, store } from "./live";

/** Music under speech; full volume when the project has no video with sound. */
export const MUSIC_UNDER_SPEECH = 0.2;
export const AUDIO_FADE = 0.5;

const NOISE_REDUCTION = { threshold: -40, reduction: 0.7, attack: 5, release: 100, focus: "speech" };

/** Whether the main track has video (which may carry speech the music must not cover). */
export function hasVideoSound(project: Pick<Project, "timeline" | "mediaLibrary">): boolean {
  const track = mainTrack(project);
  if (!track || track.muted) return false;
  const types = new Map(project.mediaLibrary.items.map((m) => [m.id, m.type]));
  return track.clips.some((c) => types.get(c.mediaId) === "video" && (c.volume ?? 1) > 0);
}

const allClips = () => store().project.timeline.tracks.flatMap((t) => t.clips);

/**
 * Puts audio media on new tracks at `time`, each with fades and, under a video with sound, a low
 * volume. One undo step. Returns how many were placed.
 */
export async function placeAudio(mediaIds: readonly string[], time: number): Promise<number> {
  const volume = hasVideoSound(store().project) ? MUSIC_UNDER_SPEECH : 1;
  return grouped("Add audio", async () => {
    let placed = 0;
    for (const id of mediaIds) {
      if (store().project.mediaLibrary.items.find((m) => m.id === id)?.type !== "audio") continue;
      const before = new Set(allClips().map((c) => c.id));
      if (!(await store().addClipToNewTrack(id, Math.max(0, time))).success) continue;
      const clip = allClips().find((c) => !before.has(c.id) && c.mediaId === id);
      if (!clip) continue;
      placed++;
      const fade = Math.min(AUDIO_FADE, clip.duration / 4);
      await act("audio/setFade", { clipId: clip.id, fadeIn: fade, fadeOut: fade });
      if (volume !== 1) await act("audio/setVolume", { clipId: clip.id, volume });
    }
    return placed;
  });
}

/** Imports audio files (music from the phone, or a recording) and places them at `time`. */
export async function importAudio(files: readonly File[], time: number): Promise<{ placed: number; failed: number }> {
  const added: string[] = [];
  let failed = 0;
  for (const file of files) {
    const before = new Set(store().project.mediaLibrary.items.map((m) => m.id));
    const res = await store().importMedia(file);
    const ids = store().project.mediaLibrary.items.filter((m) => !before.has(m.id) && m.type === "audio").map((m) => m.id);
    if (!res.success || !ids.length) { failed++; continue; }
    added.push(...ids);
  }
  const placed = await placeAudio(added, time);
  return { placed, failed: failed + (added.length - placed) };
}

/** Mutes or unmutes the original sound of the video (the main track). */
export async function muteOriginal(muted: boolean): Promise<string | null> {
  const track = mainTrack(store().project);
  if (!track) return "أضف فيديو أولاً.";
  return (await act("track/mute", { trackId: track.id, muted })) ? null : FAILED;
}

export const isOriginalMuted = (project: Pick<Project, "timeline">) => !!mainTrack(project)?.muted;

export const hasNoiseReduction = (clip: Pick<Clip, "audioEffects">) => (clip.audioEffects ?? []).some((e) => e.type === "noiseReduction");

/** Turns noise reduction on or off for a clip. */
export async function setNoiseReduction(clipId: string, on: boolean): Promise<string | null> {
  const clip = allClips().find((c) => c.id === clipId);
  if (!clip) return FAILED;
  const existing = (clip.audioEffects ?? []).filter((e) => e.type === "noiseReduction");
  if (on) {
    if (existing.length) return null;
    const ok = await act("audio/addEffect", { clipId, effect: { id: crypto.randomUUID(), type: "noiseReduction", enabled: true, params: NOISE_REDUCTION } });
    return ok ? null : FAILED;
  }
  return grouped("Noise reduction off", async () => {
    for (const e of existing) if (!(await act("audio/removeEffect", { clipId, effectId: e.id }))) return FAILED;
    return null;
  });
}

/** Sound fade in and out of a clip, in seconds (0 removes it). */
export async function setAudioFade(clipId: string, fadeIn: number, fadeOut: number): Promise<string | null> {
  return (await act("audio/setFade", { clipId, fadeIn: Math.max(0, fadeIn), fadeOut: Math.max(0, fadeOut) })) ? null : FAILED;
}

/** A file name for a recording made now. */
export function recordingName(mime: string): string {
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `تسجيل ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.${ext}`;
}
