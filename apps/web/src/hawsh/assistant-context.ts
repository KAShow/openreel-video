/**
 * What the AI assistant knows before it acts (Hawsh Khalifa build): a compact text view of the project,
 * placed at the end of the system prompt on every request. Without it the model started blind and spent
 * two to four paid steps (list_media, list_tracks, list_clips…) just looking; with it a simple edit is
 * one step. Names and overlay text come from the user's files, so they are quoted and cut short: the
 * prompt treats them as data, never as instructions.
 */
import type { Project } from "@openreel/core";

export interface AssistantUiState {
  readonly playheadSec?: number;
  /** IDs the user has selected in the timeline (clips or text items). */
  readonly selectedIds?: readonly string[];
}

const MAX_MEDIA = 30;
const MAX_CLIPS = 60;
const MAX_TEXT = 16;
const NAME_CHARS = 60;

const sec = (n: number): string => `${Math.round(n * 100) / 100}s`;
const quote = (value: unknown): string => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return JSON.stringify(text.length > NAME_CHARS ? `${text.slice(0, NAME_CHARS)}…` : text);
};

interface LooseClip {
  id: string; mediaId?: string; startTime: number; duration: number; inPoint?: number; outPoint?: number;
  speed?: number; reversed?: boolean; volume?: number; fade?: { fadeIn?: number; fadeOut?: number };
  effects?: Array<{ type?: string; enabled?: boolean }>; audioEffects?: unknown[];
}
interface LooseTrack {
  id: string; name: string; type: string; role?: string; locked?: boolean; hidden?: boolean; muted?: boolean;
  clips: LooseClip[]; transitions?: unknown[];
}
interface LooseText { id: string; trackId: string; text: string; startTime: number; duration: number; metadata?: Record<string, unknown> }

function clipLine(clip: LooseClip, mediaName: (id?: string) => string, selected: ReadonlySet<string>): string {
  const parts = [`clipId=${clip.id} ${mediaName(clip.mediaId)} ${sec(clip.startTime)}–${sec(clip.startTime + clip.duration)}`];
  if (clip.inPoint !== undefined && clip.outPoint !== undefined) parts.push(`source ${sec(clip.inPoint)}–${sec(clip.outPoint)}`);
  if ((clip.speed ?? 1) !== 1) parts.push(`speed ${clip.speed}x`);
  if (clip.reversed) parts.push("reversed");
  if (clip.volume !== undefined && clip.volume !== 1) parts.push(`volume ${clip.volume}`);
  if (clip.fade?.fadeIn) parts.push(`fade in ${sec(clip.fade.fadeIn)}`);
  if (clip.fade?.fadeOut) parts.push(`fade out ${sec(clip.fade.fadeOut)}`);
  const effects = (clip.effects ?? []).map((e) => e.type).filter(Boolean);
  if (effects.length) parts.push(`effects: ${effects.join(", ")}`);
  if (clip.audioEffects?.length) parts.push(`${clip.audioEffects.length} audio effects`);
  if (selected.has(clip.id)) parts.push("SELECTED BY THE USER");
  return `   - ${parts.join(", ")}`;
}

/** The project as the assistant should see it at the start of a request. */
export function projectSnapshot(project: Project, ui: AssistantUiState = {}): string {
  const media = project.mediaLibrary.items;
  const tracks = project.timeline.tracks as unknown as LooseTrack[];
  const texts = (project.textClips ?? []) as unknown as LooseText[];
  const selected = new Set(ui.selectedIds ?? []);
  const nameOf = new Map(media.map((m) => [m.id, m.name]));
  const mediaName = (id?: string): string => (id && nameOf.has(id) ? quote(nameOf.get(id)) : "(no media)");
  const used = new Set(tracks.flatMap((t) => t.clips.map((c) => c.mediaId)));
  const { width, height, frameRate } = project.settings;
  const shape = height > width ? "vertical" : width > height ? "horizontal" : "square";

  const lines: string[] = [
    "PROJECT STATE at the start of this request (the committed timeline). It replaces a first round of list_media, list_tracks, list_clips and list_text_clips: call those only for what is cut short here, or to re-read after your own edits.",
    `Project ${quote(project.name)}: ${width}x${height} (${shape}), ${frameRate} fps, timeline ${sec(project.timeline.duration ?? 0)}${ui.playheadSec !== undefined ? `, playhead at ${sec(ui.playheadSec)}` : ""}.`,
  ];

  lines.push(media.length ? `Media library (${media.length}):` : "Media library: empty. The user must add files from the Media panel; you cannot import files.");
  for (const m of media.slice(0, MAX_MEDIA)) {
    const meta = m.metadata;
    const size = meta?.width && meta?.height ? ` ${meta.width}x${meta.height}` : "";
    const length = meta?.duration ? ` ${sec(meta.duration)}` : "";
    lines.push(` - mediaId=${m.id} ${quote(m.name)} ${m.type}${length}${size}${used.has(m.id) ? "" : ", NOT on the timeline yet"}`);
  }
  if (media.length > MAX_MEDIA) lines.push(` - … ${media.length - MAX_MEDIA} more (list_media)`);

  const clipTotal = tracks.reduce((n, t) => n + t.clips.length, 0);
  lines.push(tracks.length ? `Tracks, top layer first (${tracks.length}), ${clipTotal} clips in all:` : "Tracks: none yet.");
  let shown = 0;
  tracks.forEach((track, index) => {
    const flags = [track.role && track.role !== "general" ? track.role : "", track.locked ? "LOCKED" : "", track.hidden ? "hidden" : "", track.muted ? "muted" : ""].filter(Boolean);
    const textCount = texts.filter((t) => t.trackId === track.id).length;
    const holds = [track.clips.length ? `${track.clips.length} clips` : "", textCount ? `${textCount} text items` : ""].filter(Boolean).join(", ") || "empty";
    lines.push(` ${index + 1}. trackId=${track.id} ${quote(track.name)} ${track.type}${flags.length ? ` [${flags.join(", ")}]` : ""}: ${holds}${track.transitions?.length ? `, ${track.transitions.length} transitions` : ""}`);
    for (const clip of [...track.clips].sort((a, b) => a.startTime - b.startTime)) {
      if (shown >= MAX_CLIPS) break;
      lines.push(clipLine(clip, mediaName, selected));
      shown++;
    }
  });
  if (clipTotal > shown) lines.push(` … ${clipTotal - shown} more clips (list_clips with offset/limit)`);

  if (texts.length) {
    const captions = texts.filter((t) => t.metadata?.captionSource).length;
    lines.push(`Text on screen (${texts.length}${captions ? `, ${captions} of them automatic caption lines` : ""}):`);
    const ordered = [...texts].sort((a, b) => a.startTime - b.startTime);
    // Titles first: caption lines are many and alike, so they are the ones to cut short.
    const pick = [...ordered.filter((t) => !t.metadata?.captionSource), ...ordered.filter((t) => t.metadata?.captionSource)].slice(0, MAX_TEXT);
    for (const t of pick) {
      lines.push(` - clipId=${t.id} ${quote(t.text)} ${sec(t.startTime)}–${sec(t.startTime + t.duration)}${t.metadata?.captionSource ? ", caption" : ""}${selected.has(t.id) ? ", SELECTED BY THE USER" : ""}`);
    }
    if (texts.length > pick.length) lines.push(` - … ${texts.length - pick.length} more (list_text_clips)`);
  } else {
    lines.push("Text on screen: none.");
  }
  return lines.join("\n");
}
