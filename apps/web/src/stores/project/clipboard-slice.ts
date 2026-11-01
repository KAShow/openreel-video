import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action, ActionResult, Project } from "@openreel/core";
import {
  resolveTimelinePlacement,
  withUniversalTracksCapability,
} from "@openreel/core";
import { cloneProjectForEdit } from "./clone-project-for-edit";
import type { ProjectState, TimelineClipboardItem } from "./types";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type ClipboardSlice = Pick<
  ProjectState,
  | "copyClips"
  | "pasteClips"
  | "duplicateClip"
  | "copyEffects"
  | "pasteEffects"
>;

export function createClipboardSlice(set: Set, get: Get): ClipboardSlice {
  return {
    copyClips: (clipIds: string[]) => {
      const state = get();
      const items = clipIds
        .map((clipId): TimelineClipboardItem | null => {
          const mediaClip = state.getClip(clipId);
          if (mediaClip) {
            return { kind: "media", clip: structuredClone(mediaClip) };
          }
          const textClip = state.getTextClip(clipId);
          if (textClip) {
            return { kind: "text", clip: structuredClone(textClip) };
          }
          const shapeClip = state.getShapeClip(clipId);
          if (shapeClip) {
            return { kind: "shape", clip: structuredClone(shapeClip) };
          }
          const svgClip = state.getSVGClip(clipId);
          if (svgClip) {
            return { kind: "svg", clip: structuredClone(svgClip) };
          }
          const stickerClip = state.getStickerClip(clipId);
          if (stickerClip) {
            return { kind: "sticker", clip: structuredClone(stickerClip) };
          }
          return null;
        })
        .filter((item): item is TimelineClipboardItem => item !== null);
      set({ clipboard: items, lastPastedClipIds: [] });
    },

    pasteClips: async (trackId: string, startTime: number) => {
      const { clipboard, actionExecutor } = get();
      const results: ActionResult[] = [];
      const pastedIds: string[] = [];

      if (clipboard.length === 0) {
        return [
          {
            success: false,
            error: {
              code: "INVALID_PARAMS" as const,
              message: "Clipboard is empty",
            },
          },
        ];
      }

      const minStartTime = Math.min(
        ...clipboard.map((item) => item.clip.startTime),
      );
      actionExecutor.getHistory().beginGroup("Paste timeline clips");
      try {
        for (const item of clipboard) {
          const currentProject = get().project;
          const newStartTime = Math.max(
            0,
            startTime + item.clip.startTime - minStartTime,
          );
          const sourceTrack = currentProject.timeline.tracks.find(
            (track) => track.id === item.clip.trackId,
          );
          const destinationTrack =
            currentProject.timeline.tracks.find(
              (track) => track.id === trackId && !track.locked,
            ) ??
            (sourceTrack && !sourceTrack.locked ? sourceTrack : undefined) ??
            currentProject.timeline.tracks.find((track) => !track.locked);

          if (!destinationTrack) {
            results.push({
              success: false,
              error: {
                code: "TRACK_NOT_FOUND",
                message: `No compatible unlocked track for ${item.kind} clip`,
              },
            });
            continue;
          }

          const newTrackId = uuidv4();
          const placement = resolveTimelinePlacement(currentProject, {
            targetTrackId: destinationTrack.id,
            startTime: newStartTime,
            duration: item.clip.duration,
            policy: "stack-above",
            newTrackId,
          });
          if (!placement.ok) {
            results.push({
              success: false,
              error: {
                code:
                  placement.reason === "track-locked"
                    ? "TRACK_LOCKED"
                    : placement.reason === "track-not-found"
                      ? "TRACK_NOT_FOUND"
                      : "OVERLAP_DETECTED",
                message: `Could not place ${item.kind} clip`,
              },
            });
            continue;
          }
          if (placement.createdTrack) {
            const trackResult = await actionExecutor.execute(
              {
                type: "track/add",
                id: uuidv4(),
                timestamp: Date.now(),
                params: {
                  trackType: "video",
                  trackId: placement.createdTrack.id,
                  position: placement.createdTrack.position,
                  mode: "standard",
                },
              },
              currentProject,
            );
            if (!trackResult.success) {
              results.push(trackResult);
              continue;
            }
          }

          if (item.kind !== "media") {
            const pasted = get().pasteOverlayClip(
              item.kind,
              item.clip,
              placement.startTime,
              placement.trackId,
            );
            if (pasted) {
              results.push({ success: true });
              pastedIds.push(pasted.id);
            } else {
              results.push({
                success: false,
                error: {
                  code: "INVALID_PARAMS",
                  message: `Failed to paste ${item.kind} clip`,
                },
              });
            }
            continue;
          }

          const placedTrack = currentProject.timeline.tracks.find(
            (track) => track.id === placement.trackId,
          );
          const beforeIds = new Set(placedTrack?.clips.map((clip) => clip.id));
          const action: Action = {
            type: "clip/add",
            id: uuidv4(),
            timestamp: Date.now(),
            params: {
              clipId: uuidv4(),
              trackId: placement.trackId,
              mediaId: item.clip.mediaId,
              startTime: placement.startTime,
              sourceClip: item.clip,
            },
          };
          const result = await actionExecutor.execute(action, currentProject);
          results.push(result);
          if (result.success) {
            const pasted = placedTrack?.clips.find(
              (clip) => !beforeIds.has(clip.id),
            );
            if (pasted) pastedIds.push(pasted.id);
          }
        }
      } finally {
        actionExecutor.getHistory().endGroup();
      }

      set({
        project: withUniversalTracksCapability({
          ...get().project,
          modifiedAt: Date.now(),
        }),
        lastPastedClipIds: pastedIds,
      });
      return results;
    },

    duplicateClip: async (clipId: string) => {
      const { getClip, project, actionExecutor } = get();
      const clip = getClip(clipId);
      if (!clip) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAMS" as const,
            message: "Clip not found",
          },
        };
      }

      const track = project.timeline.tracks.find((t) =>
        t.clips.some((c) => c.id === clipId),
      );
      if (!track) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAMS" as const,
            message: "Track not found",
          },
        };
      }

      // Place the duplicate immediately after the original on the same
      // track. If there's a clip already starting at that time, scan
      // forward until we find the next gap large enough for the
      // duplicate's full duration.
      const sortedClips = [...track.clips].sort(
        (a, b) => a.startTime - b.startTime,
      );
      let candidate = clip.startTime + clip.duration;
      const epsilon = 0.0001;
      for (const other of sortedClips) {
        if (other.id === clip.id) continue;
        if (other.startTime + other.duration <= candidate + epsilon) continue;
        if (other.startTime >= candidate + clip.duration - epsilon) break;
        candidate = other.startTime + other.duration;
      }

      const projectCopy = cloneProjectForEdit(project);
      const action: Action = {
        type: "clip/add",
        id: uuidv4(),
        timestamp: Date.now(),
        params: {
          trackId: track.id,
          mediaId: clip.mediaId,
          startTime: candidate,
          duration: clip.duration,
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          volume: clip.volume,
          effects: structuredClone(clip.effects),
          audioEffects: clip.audioEffects
            ? structuredClone(clip.audioEffects)
            : undefined,
          keyframes: clip.keyframes ? structuredClone(clip.keyframes) : undefined,
          transform: clip.transform ? structuredClone(clip.transform) : undefined,
          ...(clip.fade ? { fade: clip.fade } : {}),
          ...(clip.speed !== undefined ? { speed: clip.speed } : {}),
          ...(clip.reversed !== undefined ? { reversed: clip.reversed } : {}),
          ...(clip.audioTrackIndex !== undefined
            ? { audioTrackIndex: clip.audioTrackIndex }
            : {}),
        },
      };

      const result = await actionExecutor.execute(action, projectCopy);
      if (result.success) {
        const finalProject: Project = {
          ...projectCopy,
          modifiedAt: Date.now(),
        };
        set({ project: finalProject });
      }
      return result;
    },

    copyEffects: (clipId: string) => {
      const { getClip } = get();
      const clip = getClip(clipId);
      if (clip) {
        const copiedEffects = JSON.parse(JSON.stringify(clip.effects));
        set({ copiedEffects });
      }
    },

    pasteEffects: async (clipId: string) => {
      const { copiedEffects, project, actionExecutor } = get();
      if (copiedEffects.length === 0) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAMS" as const,
            message: "No effects in clipboard",
          },
        };
      }

      const results: ActionResult[] = [];
      for (const effect of copiedEffects) {
        const action: Action = {
          type: "effect/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            clipId,
            effectType: effect.type,
            params: effect.params,
          },
        };
        const result = await actionExecutor.execute(action, project);
        results.push(result);
      }

      set({ project: { ...project } });
      return (
        results[0] || {
          success: false,
          error: { code: "UNKNOWN" as const, message: "No results" },
        }
      );
    },
  };
}
