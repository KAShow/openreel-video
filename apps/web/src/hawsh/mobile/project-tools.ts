/**
 * Whole-project tools of the phone "Edit" and "More" sheets: the video format, reversing a clip, and
 * cutting the silences of every clip on the main track at once.
 */
import { getSpeedEngine, type Project } from "@openreel/core";
import type { Region } from "../silence-tools";
import { cutSilences, findSilences, silenceTotal } from "./clip-tools";
import { act, FAILED, grouped, mainClips, store } from "./live";

export const FORMATS = [
  { id: "9:16", label: "طولي", hint: "ريلز، تيك توك، شورتس", width: 1080, height: 1920 },
  { id: "16:9", label: "عرضي", hint: "يوتيوب", width: 1920, height: 1080 },
  { id: "1:1", label: "مربع", hint: "منشور", width: 1080, height: 1080 },
  { id: "4:5", label: "عمودي قصير", hint: "منشور إنستغرام", width: 1080, height: 1350 },
] as const;

/** The format matching the project's ratio, or null for a custom size. */
export function currentFormat(settings: Pick<Project["settings"], "width" | "height">) {
  const r = settings.width / settings.height;
  return FORMATS.find((f) => Math.abs(f.width / f.height - r) < 0.01) ?? null;
}

/** Changes the format and makes every picture fill the new frame, as one undo step. */
export async function setFormat(id: string): Promise<string | null> {
  const f = FORMATS.find((x) => x.id === id);
  if (!f) return FAILED;
  const media = new Map(store().project.mediaLibrary.items.map((m) => [m.id, m.type]));
  return grouped("Video format", async () => {
    if (!(await act("project/updateSettings", { width: f.width, height: f.height }))) return FAILED;
    for (const track of store().project.timeline.tracks) {
      for (const clip of track.clips) {
        const type = media.get(clip.mediaId);
        if (type !== "video" && type !== "image") continue;
        if (!(await act("transform/update", { clipId: clip.id, transform: { fitMode: "cover" } }))) return FAILED;
      }
    }
    return null;
  });
}

/** Plays a clip backwards (or forwards again), like the desktop speed section. */
export async function setReversed(clipId: string, reversed: boolean): Promise<string | null> {
  const clip = store().project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clip) return FAILED;
  getSpeedEngine().setReverse(clip.id, reversed, clip.duration);
  return (await act("clip/setReverse", { clipId, reversed })) ? null : FAILED;
}

export interface SilencePlan { clips: { clipId: string; regions: Region[] }[]; seconds: number; skipped: number }

/** Finds the pauses in every video/audio clip of the main track (nothing is cut yet). */
export async function planSilenceEverywhere(): Promise<SilencePlan> {
  const media = new Map(store().project.mediaLibrary.items.map((m) => [m.id, m.type]));
  const plan: SilencePlan = { clips: [], seconds: 0, skipped: 0 };
  for (const clip of mainClips(store().project)) {
    const type = media.get(clip.mediaId);
    if (type !== "video" && type !== "audio") continue;
    const res = await findSilences(clip.id);
    if ("error" in res) { plan.skipped++; continue; }
    if (res.regions.length) {
      plan.clips.push({ clipId: clip.id, regions: res.regions });
      plan.seconds += silenceTotal(res.regions);
    }
  }
  plan.seconds = Math.round(plan.seconds * 10) / 10;
  return plan;
}

/**
 * Cuts the planned pauses, last clip first so the earlier clips' timeline ranges stay where they
 * were found. One undo step.
 */
export async function cutSilenceEverywhere(plan: SilencePlan): Promise<string | null> {
  const order = mainClips(store().project).map((c) => c.id);
  const clips = [...plan.clips].sort((a, b) => order.indexOf(b.clipId) - order.indexOf(a.clipId));
  return grouped("Cut silence on all clips", async () => {
    for (const c of clips) {
      const err = await cutSilences(c.clipId, c.regions);
      if (err) return err;
    }
    return null;
  });
}
