import type { Effect, Project } from "@openreel/core";
import {
  getEffectsBridge,
  type VideoEffect,
  type VideoEffectType,
} from "../../bridges/effects-bridge";

function getProjectClipIds(project: Project): string[] {
  return [
    ...project.timeline.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.id),
    ),
    ...(project.textClips ?? []).map((clip) => clip.id),
    ...(project.shapeClips ?? []).map((clip) => clip.id),
    ...(project.svgClips ?? []).map((clip) => clip.id),
    ...(project.stickerClips ?? []).map((clip) => clip.id),
  ];
}

export const mapClipEffectsToVideoEffects = (
  effects: Effect[],
): VideoEffect[] =>
  effects.map((effect, order) => ({
    id: effect.id,
    type: effect.type as VideoEffectType,
    enabled: effect.enabled,
    params: effect.params,
    order,
  }));

export function syncClipEffectsBridge(project: Project, clipId: string): void {
  const effectsBridge = getEffectsBridge();
  if (!effectsBridge.isInitialized()) return;

  const timelineClip = project.timeline.tracks
    .flatMap((track) => track.clips)
    .find((candidate) => candidate.id === clipId);
  const overlayClip = [
    ...(project.textClips ?? []),
    ...(project.shapeClips ?? []),
    ...(project.svgClips ?? []),
    ...(project.stickerClips ?? []),
  ].find((candidate) => candidate.id === clipId);
  const clip = timelineClip ?? overlayClip;

  if (!clip) {
    effectsBridge.clearEffects(clipId);
    return;
  }

  const effects = mapClipEffectsToVideoEffects(clip.effects ?? []);
  effectsBridge.deserializeEffects(clipId, {
    effects: effects.map((effect) => ({
      id: effect.id,
      type: effect.type,
      enabled: effect.enabled,
      params: effect.params,
      order: effect.order,
    })),
    // The clip is the source of truth for color grading; pushing it into
    // the bridge here makes undo/redo and project load restore the graded look.
    colorGrading: timelineClip?.colorGrading ?? {},
  });
}

export function syncProjectEffectsBridge(
  nextProject: Project,
  previousProject?: Project,
): void {
  const effectsBridge = getEffectsBridge();
  if (!effectsBridge.isInitialized()) return;

  const nextClipIds = new Set(getProjectClipIds(nextProject));
  for (const clipId of previousProject
    ? getProjectClipIds(previousProject)
    : []) {
    if (!nextClipIds.has(clipId)) effectsBridge.clearEffects(clipId);
  }

  for (const clipId of nextClipIds) {
    syncClipEffectsBridge(nextProject, clipId);
  }
}
