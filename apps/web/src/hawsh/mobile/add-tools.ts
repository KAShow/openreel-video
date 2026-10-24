/**
 * Adding things on the phone editor (stage 4): text at the playhead, Director's Eyes library items at
 * the end of the main track, and the clip that auto captions should transcribe. Same store actions as
 * the desktop editor.
 */
import type { Project, TextStyle } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { insertTimelineOverlay } from "../../stores/project/insert-timeline-overlay";

/** No negative letter spacing (the desktop title default): it breaks Arabic letter joining. */
export const PHONE_TEXT_STYLE: Partial<TextStyle> = { fontSize: 80, fontWeight: 800, letterSpacing: 0 };
export const TEXT_SECONDS = 3;

const store = () => useProjectStore.getState();

/** Adds a text clip at `time`; returns it (for selection) or null. */
export async function addText(text: string, time: number) {
  const value = text.trim();
  if (!value) return null;
  return insertTimelineOverlay(time, TEXT_SECONDS, (trackId) =>
    store().createTextClip(trackId, time, value, TEXT_SECONDS, PHONE_TEXT_STYLE));
}

export function editText(clipId: string, text: string): boolean {
  const value = text.trim();
  return !!value && store().updateTextContent(clipId, value) !== null;
}

type Tracks = Pick<Project, "timeline">;
const MEDIA_TRACK = new Set(["video", "image"]);

/** The main track: the video/image track with the most clips (the first one on a tie), or null. */
export function mainTrack(project: Tracks) {
  let best: Project["timeline"]["tracks"][number] | null = null;
  for (const t of project.timeline.tracks) {
    if (!MEDIA_TRACK.has(t.type) || t.locked || !t.clips.length) continue;
    if (!best || t.clips.length > best.clips.length) best = t;
  }
  return best;
}

export const trackEnd = (track: { clips: readonly { startTime: number; duration: number }[] }) =>
  track.clips.reduce((end, c) => Math.max(end, c.startTime + c.duration), 0);

/**
 * Puts library media one after another at the end of the main track, or on a new track when there is
 * none. Added straight onto the main track: placeMediaClip would stack it on another track whenever a
 * text clip shares the main track at that time.
 */
export async function appendToTimeline(mediaIds: readonly string[]): Promise<number> {
  let placed = 0;
  for (const id of mediaIds) {
    const track = mainTrack(store().project);
    const res = track ? await store().addClip(track.id, id, trackEnd(track)) : await store().placeMediaClip(id, undefined, 0);
    if (res.success) placed++;
  }
  return placed;
}

/**
 * The clip auto captions transcribe on the phone (no clip is selected while the main bar shows):
 * the video/audio clip under the playhead, else the first one on the timeline.
 */
export function captionClipId(project: Pick<Project, "timeline" | "mediaLibrary">, time: number): string | undefined {
  const types = new Map(project.mediaLibrary.items.map((m) => [m.id, m.type]));
  const clips = project.timeline.tracks
    .filter((t) => !t.hidden)
    .flatMap((t) => t.clips)
    .filter((c) => types.get(c.mediaId) === "video" || types.get(c.mediaId) === "audio")
    .sort((a, b) => a.startTime - b.startTime);
  return (clips.find((c) => time >= c.startTime && time < c.startTime + c.duration) ?? clips[0])?.id;
}
