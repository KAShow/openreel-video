/**
 * Shared helpers for the phone tool sheets (transitions, effects, audio, edit, more): edits go through
 * the same project-store actions as the desktop editor and the assistant, so undo, autosave and export
 * see ordinary edits, and a tool that makes several edits records them as one undo step.
 */
import type { Clip, Project } from "@openreel/core";
import type { EditingHost } from "@openreel/agent";
import { useProjectStore } from "../../stores/project-store";
import { syncClipEffectsBridge } from "../../stores/project/effects-sync";
import { mainTrack } from "./add-tools";

export const store = () => useProjectStore.getState();

/**
 * Runs one action on the live project; true when it was applied. The preview draws video effects from
 * the effects bridge, which executeAction does not update (the store's own effect methods do), so an
 * effect change is copied there too.
 */
export async function act(type: string, params: Record<string, unknown>): Promise<boolean> {
  const res = await store().executeAction({ type, id: crypto.randomUUID(), timestamp: Date.now(), params } as Parameters<ReturnType<typeof store>["executeAction"]>[0]);
  if (res.success && type.startsWith("effect/") && typeof params.clipId === "string") syncClipEffectsBridge(store().project, params.clipId);
  return res.success;
}

/** Several edits as one undo step. */
export async function grouped<T>(label: string, run: () => Promise<T>): Promise<T> {
  store().beginHistoryGroup(label);
  try { return await run(); } finally { store().endHistoryGroup(); }
}

/** The live project as an EditingHost, for helpers shared with the assistant. */
export function liveHost(): EditingHost {
  return {
    getProject: () => store().project,
    applyAction: (action: Parameters<EditingHost["applyAction"]>[0]) => store().executeAction(action),
  } as unknown as EditingHost;
}

export interface ClipRef { clip: Clip; trackType: string; index: number }

type Tracks = Pick<Project, "timeline">;

/** Clips of the main track in timeline order. */
export function mainClips(project: Tracks): Clip[] {
  return [...(mainTrack(project)?.clips ?? [])].sort((a, b) => a.startTime - b.startTime);
}

/**
 * The clip a phone sheet works on: the selected video/audio/image clip, else the main-track clip under
 * the playhead (the last one when the playhead is past the end). `index` is its 1-based place on the
 * main track (0 when it is on another track), for "اللقطة 2".
 */
export function sheetTarget(project: Tracks, selected: readonly { type: string; id: string }[], time: number): ClipRef | null {
  const main = mainClips(project);
  const pick = selected.length === 1 && selected[0].type === "clip" ? selected[0].id : null;
  for (const track of project.timeline.tracks) {
    const clip = pick ? track.clips.find((c) => c.id === pick) : undefined;
    if (clip) return { clip, trackType: track.type, index: main.findIndex((c) => c.id === clip.id) + 1 };
  }
  const under = main.find((c) => time >= c.startTime && time < c.startTime + c.duration) ?? main.at(-1);
  if (!under) return null;
  const track = project.timeline.tracks.find((t) => t.id === under.trackId);
  return { clip: under, trackType: track?.type ?? "video", index: main.indexOf(under) + 1 };
}

export const FAILED = "تعذّر التنفيذ، حاول مرة ثانية.";
