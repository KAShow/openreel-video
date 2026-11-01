import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  Project,
  MediaItem,
  Track,
  Clip,
  AutomationPoint,
  Transition,
  Action,
  ActionResult,
  TextClip,
  ShapeClip,
  SVGClip,
  StickerClip,
  CreateLayerOptions,
  PhotoBlendMode,
  Effect,
  Keyframe,
  Transform,
  AppliedEditingTemplate,
  EditingTemplateApplicationSource,
  EditingTemplatePrimitive,
  ResolvedEditingTemplateApplication,
  ClipColorGrading,
} from "@openreel/core";
import {
  ActionExecutor,
  ActionHistory,
  getBuiltInEditingTemplate,
  getTrackItems,
  resolveEditingTemplate,
} from "@openreel/core";
import { createMarkerSlice } from "./project/marker-slice";
import { createSubtitleSlice } from "./project/subtitle-slice";
import { createTrackSlice } from "./project/track-slice";
import { createMediaSlice } from "./project/media-slice";
import { createMotionSlice } from "./project/motion-slice";
import { createClipboardSlice } from "./project/clipboard-slice";
import { createLifecycleSlice } from "./project/lifecycle-slice";
import { createPersistenceSlice } from "./project/persistence-slice";
import { createEditingTemplateSlice } from "./project/editing-template-slice";
import { createProjectStoreHelpers } from "./project/store-helpers";
import { createTextGraphicsSlice } from "./project/text-graphics-slice";
import { createHistorySlice } from "./project/history-slice";
import { createClipSlice } from "./project/clip-slice";
import { createTimelineItemSlice } from "./project/timeline-item-slice";
import {
  mapClipEffectsToVideoEffects,
  syncClipEffectsBridge,
  syncProjectEffectsBridge,
} from "./project/effects-sync";
import {
  syncProjectTransitionsBridge,
  syncTrackTransitionsBridge,
} from "./project/transitions-sync";
import { v4 as uuidv4 } from "uuid";
import type {
  VideoEffect,
  VideoEffectType,
  ColorGradingSettings,
} from "../bridges/effects-bridge";
import { getEffectsBridge } from "../bridges/effects-bridge";
import { useEngineStore } from "./engine-store";
import {
  createEmptyProject,
  calculateTimelineDuration,
  type AudioDuckingSettings,
  type EditingTemplateApplicationState,
  type ClipHistoryEntry,
  type EditingTemplateHistoryEntry,
  type TimelineClipboardItem,
} from "./project/index";
import { saveMediaBlob } from "../services/media-storage";

/**
 * ProjectState - Complete state interface for project management
 *
 * Provides comprehensive API for:
 * - Project CRUD operations
 * - Media library management
 * - Track and clip manipulation
 * - Text clip and animation handling
 * - Graphics (shapes, SVG, stickers) management
 * - Video and audio effects
 * - Subtitle handling
 * - Photo editing
 * - Undo/redo functionality
 *
 * All async methods return ActionResult with success status and error details.
 */
import type { ProjectState } from "./project/types";
export type { ProjectState } from "./project/types";

function subscribeToProject(listener: () => void): void {
  useProjectStore.subscribe((state) => state.project, listener);
}

/**
 * Create the project store
 */
export const useProjectStore = create<ProjectState>()(
  subscribeWithSelector((set, get) => {
    const actionHistory = new ActionHistory();
    const actionExecutor = new ActionExecutor(actionHistory);

    const updateProjectClip = (
      project: Project,
      clipId: string,
      updater: (clip: Clip) => Clip,
    ): Project | null => {
      let hasUpdatedClip = false;

      const updatedTracks = project.timeline.tracks.map((track) => {
        let trackUpdated = false;

        const updatedClips = track.clips.map((clip) => {
          if (clip.id !== clipId) {
            return clip;
          }

          hasUpdatedClip = true;
          trackUpdated = true;
          return updater(clip);
        });

        return trackUpdated ? { ...track, clips: updatedClips } : track;
      });

      if (!hasUpdatedClip) {
        return null;
      }

      return {
        ...project,
        timeline: { ...project.timeline, tracks: updatedTracks },
        modifiedAt: Date.now(),
      };
    };

    const buildSerializedColorGrading = (clipId: string): ClipColorGrading => {
      const effectsBridge = getEffectsBridge();
      if (!effectsBridge.isInitialized()) {
        return {};
      }

      const colorGrading = effectsBridge.getColorGrading(clipId);

      return {
        ...(colorGrading.colorWheels
          ? { colorWheels: colorGrading.colorWheels }
          : {}),
        ...(colorGrading.curves ? { curves: colorGrading.curves } : {}),
        ...(colorGrading.lut
          ? {
              lut: {
                data: Array.from(colorGrading.lut.data),
                size: colorGrading.lut.size,
                intensity: colorGrading.lut.intensity,
              },
            }
          : {}),
        ...(colorGrading.hsl ? { hsl: colorGrading.hsl } : {}),
        ...(colorGrading.temperature !== undefined
          ? { temperature: colorGrading.temperature }
          : {}),
        ...(colorGrading.tint !== undefined ? { tint: colorGrading.tint } : {}),
      };
    };

    // Restore a full clip snapshot into the owning engine (used by undo/redo
    // of text/shape property edits). Never creates or deletes the clip — it
    // merges the saved fields back onto the existing engine clip.
    const helpers = createProjectStoreHelpers(set, get);
    const { applyClipDataSnapshot, syncOverlayEnginesFromProject } = helpers;

    type OverlayEffectOwner = TextClip | ShapeClip | SVGClip | StickerClip;
    type OverlayEffectLocation = {
      readonly prefix: "text" | "shape" | "svg" | "sticker";
      readonly field: "textClips" | "shapeClips" | "svgClips" | "stickerClips";
      readonly clip: OverlayEffectOwner;
    };

    const findOverlayEffectOwner = (
      project: Project,
      clipId: string,
    ): OverlayEffectLocation | null => {
      const locations = [
        { prefix: "text", field: "textClips", clips: project.textClips ?? [] },
        { prefix: "shape", field: "shapeClips", clips: project.shapeClips ?? [] },
        { prefix: "svg", field: "svgClips", clips: project.svgClips ?? [] },
        {
          prefix: "sticker",
          field: "stickerClips",
          clips: project.stickerClips ?? [],
        },
      ] as const;
      for (const location of locations) {
        const clip = location.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
          return {
            prefix: location.prefix,
            field: location.field,
            clip,
          } as OverlayEffectLocation;
        }
      }
      return null;
    };

    const updateOverlayEffectOwner = (
      clipId: string,
      updater: (effects: Effect[]) => Effect[],
    ): OverlayEffectOwner | null => {
      const location = findOverlayEffectOwner(get().project, clipId);
      if (!location) return null;
      const before = structuredClone(location.clip);
      const updated = {
        ...location.clip,
        effects: updater([...(location.clip.effects ?? [])]),
      } as OverlayEffectOwner;
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (location.prefix === "text") {
        titleEngine?.updateTextClip(clipId, updated as TextClip);
      } else if (location.prefix === "shape") {
        graphicsEngine?.updateShapeClip(clipId, updated as ShapeClip);
      } else if (location.prefix === "svg") {
        graphicsEngine?.updateSVGClip(clipId, updated as SVGClip);
      } else {
        graphicsEngine?.updateStickerClip(clipId, updated as StickerClip);
      }
      helpers.recordOverlayUpdate(
        location.prefix,
        location.field,
        clipId,
        updated,
        before,
      );
      syncClipEffectsBridge(get().project, clipId);
      return updated;
    };

    const buildEditingTemplateTrack = (
      trackType: "text" | "graphics",
    ): Track => ({
      id: `track-${uuidv4()}`,
      type: trackType,
      name: trackType === "text" ? "Recipe Text" : "Recipe Graphics",
      clips: [],
      transitions: [],
      locked: false,
      hidden: false,
      muted: false,
      solo: false,
    });

    const insertEditingTemplateTrack = (
      project: Project,
      snapshot: EditingTemplateHistoryEntry["trackSnapshots"][number],
    ): Project => {
      if (project.timeline.tracks.some((track) => track.id === snapshot.track.id)) {
        return project;
      }

      const tracks = [...project.timeline.tracks];
      const position = Math.max(0, Math.min(snapshot.position, tracks.length));
      tracks.splice(position, 0, snapshot.track);

      return {
        ...project,
        timeline: { ...project.timeline, tracks },
        modifiedAt: Date.now(),
      };
    };

    const removeTrackFromProjectState = (
      project: Project,
      trackId: string,
    ): Project => {
      const nextTracks = project.timeline.tracks.filter((track) => track.id !== trackId);

      if (nextTracks.length === project.timeline.tracks.length) {
        return project;
      }

      return {
        ...project,
        timeline: { ...project.timeline, tracks: nextTracks },
        modifiedAt: Date.now(),
      };
    };

    const trackHasAnyClips = (project: Project, trackId: string): boolean => {
      return getTrackItems(project, trackId).length > 0;
    };

    const buildEditingTemplateKeyframes = (
      prefix: string,
      keyframes: readonly {
        time: number;
        property: string;
        value: unknown;
        easing: Keyframe["easing"];
      }[],
    ): Keyframe[] =>
      keyframes.map((keyframe, index) => ({
        id: `${prefix}-keyframe-${index + 1}`,
        time: keyframe.time,
        property: keyframe.property,
        value: keyframe.value,
        easing: keyframe.easing,
      }));

    const buildEditingTemplateSource = (
      templateId: string,
      applicationId: string,
      ownerClipId: string,
      ownerTrackId: string,
      controlValues: Record<string, unknown> | undefined,
    ): EditingTemplateApplicationSource => ({
      templateId,
      applicationId,
      ownerClipId,
      ownerTrackId,
      controlValues,
    });

    const buildAppliedEditingTemplate = (
      resolvedTemplate: ResolvedEditingTemplateApplication,
      applicationId: string,
      appliedAt: number = Date.now(),
    ): AppliedEditingTemplate => ({
      templateId: resolvedTemplate.template.id,
      applicationId,
      name: resolvedTemplate.template.name,
      category: resolvedTemplate.template.category,
      appliedAt,
      controlValues: resolvedTemplate.controlValues,
    });

    const getEditingTemplateApplicationState = (
      entry: EditingTemplateHistoryEntry,
    ): EditingTemplateApplicationState => ({
      ownerClipId: entry.ownerClipId,
      templateId: entry.templateId,
      applicationId: entry.applicationId,
      appliedTemplate: entry.appliedTemplate,
      addedEffects: entry.addedEffects,
      addedAudioEffects: entry.addedAudioEffects,
      addedKeyframes: entry.addedKeyframes,
      overlays: entry.overlays,
      trackSnapshots: entry.trackSnapshots,
    });

    const getEditingTemplatePreferredTrackIds = (
      applicationState: EditingTemplateApplicationState,
    ): Partial<Record<"text" | "graphics", string>> =>
      applicationState.overlays.reduce<Partial<Record<"text" | "graphics", string>>>(
        (trackIds, placement) => {
          trackIds[placement.overlay.trackType] = placement.trackId;
          return trackIds;
        },
        {},
      );

    const findEditingTemplateHistoryEntry = (
      clipId: string,
      applicationId: string,
    ): EditingTemplateHistoryEntry | undefined => {
      const { templateUndoStack, templateRedoStack } = get();

      return [...templateUndoStack, ...templateRedoStack]
        .reverse()
        .find(
          (entry) =>
            entry.ownerClipId === clipId && entry.applicationId === applicationId,
        );
    };

    const applyEditingTemplateApplicationToProject = (
      project: Project,
      templateId: string,
      clipId: string,
      overrides: Record<string, EditingTemplatePrimitive> = {},
      options: {
        applicationId?: string;
        appliedAt?: number;
        preferredTrackIds?: Partial<Record<"text" | "graphics", string>>;
        preservedTrackSnapshots?: EditingTemplateApplicationState["trackSnapshots"];
      } = {},
    ):
      | {
          project: Project;
          applicationState: EditingTemplateApplicationState;
        }
      | null => {
      const template = getBuiltInEditingTemplate(templateId);
      if (!template) {
        return null;
      }

      const track = project.timeline.tracks.find((candidate) =>
        candidate.clips.some((clip) => clip.id === clipId),
      );
      const ownerClip = track?.clips.find((clip) => clip.id === clipId);

      if (!track || !ownerClip) {
        return null;
      }

      const mediaItem = project.mediaLibrary.items.find(
        (item) => item.id === ownerClip.mediaId,
      );
      const targetType =
        mediaItem?.type === "image"
          ? "image"
          : mediaItem?.type === "video"
            ? "video"
            : null;

      if (!targetType) {
        return null;
      }

      if (
        template.supportedTargets &&
        !template.supportedTargets.includes(targetType)
      ) {
        return null;
      }

      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      const needsTextTrack = template.recipe.overlays.some(
        (overlay) => overlay.trackType === "text",
      );
      const needsGraphicsTrack = template.recipe.overlays.some(
        (overlay) => overlay.trackType === "graphics",
      );

      if (
        (needsTextTrack && !titleEngine) ||
        (needsGraphicsTrack && !graphicsEngine)
      ) {
        return null;
      }

      const assetUrls = project.mediaLibrary.items.reduce<Record<string, string>>(
        (urls, item) => {
          const url = item.originalUrl ?? item.thumbnailUrl ?? undefined;
          if (url) {
            urls[item.id] = url;
          }
          return urls;
        },
        {},
      );

      const resolvedTemplate = resolveEditingTemplate(
        template,
        {
          clip: {
            id: ownerClip.id,
            startTime: ownerClip.startTime,
            duration: ownerClip.duration,
            name: mediaItem?.name,
          },
          assetUrls,
        },
        overrides,
      );

      const applicationId = options.applicationId || `editing-template-${uuidv4()}`;
      const appliedTemplate = buildAppliedEditingTemplate(
        resolvedTemplate,
        applicationId,
        options.appliedAt,
      );
      const templateSource = buildEditingTemplateSource(
        template.id,
        applicationId,
        ownerClip.id,
        ownerClip.trackId,
        appliedTemplate.controlValues,
      );

      const addedEffects = resolvedTemplate.effects.map((effect, index) => ({
        id: `template-effect-${applicationId}-${index + 1}-${effect.id}`,
        type: effect.type,
        params: effect.params,
        enabled: effect.enabled,
        metadata: { templateSource },
      }));
      const addedAudioEffects = resolvedTemplate.audioEffects.map((effect, index) => ({
        id: `template-audio-effect-${applicationId}-${index + 1}-${effect.id}`,
        type: effect.type,
        params: effect.params,
        enabled: effect.enabled,
        metadata: { templateSource },
      }));
      const addedKeyframes = [
        ...resolvedTemplate.effects.flatMap((effect, index) =>
          buildEditingTemplateKeyframes(
            `template-keyframe-${applicationId}-video-${index + 1}`,
            effect.keyframes,
          ),
        ),
        ...resolvedTemplate.audioEffects.flatMap((effect, index) =>
          buildEditingTemplateKeyframes(
            `template-keyframe-${applicationId}-audio-${index + 1}`,
            effect.keyframes,
          ),
        ),
      ];

      let updatedProject = project;
      const trackSnapshots = [
        ...((options.preservedTrackSnapshots || []).filter((snapshot) =>
          updatedProject.timeline.tracks.some((track) => track.id === snapshot.track.id),
        )),
      ];
      const resolvedTrackIds: Partial<Record<"text" | "graphics", string>> = {};

      for (const snapshot of trackSnapshots) {
        if (snapshot.track.type === "text" || snapshot.track.type === "graphics") {
          resolvedTrackIds[snapshot.track.type] = snapshot.track.id;
        }
      }

      const ensureOverlayTrack = (trackType: "text" | "graphics"): string => {
        const existingTrackId = resolvedTrackIds[trackType];
        if (
          existingTrackId &&
          updatedProject.timeline.tracks.some((track) => track.id === existingTrackId)
        ) {
          return existingTrackId;
        }

        const preferredTrackId = options.preferredTrackIds?.[trackType];
        if (
          preferredTrackId &&
          updatedProject.timeline.tracks.some((track) => track.id === preferredTrackId)
        ) {
          resolvedTrackIds[trackType] = preferredTrackId;
          return preferredTrackId;
        }

        const existingTrack = updatedProject.timeline.tracks.find(
          (candidate) => candidate.type === trackType,
        );
        if (existingTrack) {
          resolvedTrackIds[trackType] = existingTrack.id;
          return existingTrack.id;
        }

        const snapshot = {
          track: buildEditingTemplateTrack(trackType),
          position: 0,
        };
        trackSnapshots.push(snapshot);
        updatedProject = insertEditingTemplateTrack(updatedProject, snapshot);
        resolvedTrackIds[trackType] = snapshot.track.id;
        return snapshot.track.id;
      };

      const overlays: EditingTemplateApplicationState["overlays"] =
        resolvedTemplate.overlays.map((overlay, index) => ({
          trackId: ensureOverlayTrack(overlay.trackType),
          overlay: {
            ...overlay,
            id: `template-overlay-${applicationId}-${index + 1}-${overlay.id}`,
          },
        }));

      const nextProject = updateProjectClip(updatedProject, clipId, (clip) => ({
        ...clip,
        effects: [...clip.effects, ...addedEffects],
        audioEffects: [...clip.audioEffects, ...addedAudioEffects],
        keyframes: [...clip.keyframes, ...addedKeyframes],
        metadata: {
          ...(clip.metadata || {}),
          appliedTemplates: [
            ...(clip.metadata?.appliedTemplates || []),
            appliedTemplate,
          ],
        },
      }));

      if (!nextProject) {
        return null;
      }

      updatedProject = nextProject;

      for (const placement of overlays) {
        if (!createEditingTemplateOverlay(placement, templateSource)) {
          removeEditingTemplateApplicationFromProject(
            updatedProject,
            clipId,
            applicationId,
            trackSnapshots.map((snapshot) => snapshot.track.id),
          );
          return null;
        }
      }

      syncClipEffectsBridge(updatedProject, clipId);

      return {
        project: {
          ...updatedProject,
          modifiedAt: Date.now(),
        },
        applicationState: {
          ownerClipId: clipId,
          templateId: template.id,
          applicationId,
          appliedTemplate,
          addedEffects,
          addedAudioEffects,
          addedKeyframes,
          overlays,
          trackSnapshots,
        },
      };
    };

    const canRestoreEditingTemplateOverlays = (
      overlays: EditingTemplateHistoryEntry["overlays"],
    ): boolean => {
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

      for (const placement of overlays) {
        if (placement.overlay.type === "text" && !titleEngine) {
          return false;
        }

        if (placement.overlay.type !== "text" && !graphicsEngine) {
          return false;
        }

        if (placement.overlay.type === "image" && !placement.overlay.content.imageUrl) {
          return false;
        }
      }

      return true;
    };

    const createEditingTemplateOverlay = (
      placement: EditingTemplateHistoryEntry["overlays"][number],
      source: EditingTemplateApplicationSource,
    ): boolean => {
      const metadata = {
        templateSource: source,
        templateManaged: true,
        templateTrackType: placement.overlay.trackType,
      };

      if (placement.overlay.type === "text") {
        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (!titleEngine) {
          return false;
        }

        if (titleEngine.getTextClip(placement.overlay.id)) {
          return true;
        }

        titleEngine.createTextClip({
          id: placement.overlay.id,
          trackId: placement.trackId,
          startTime: placement.overlay.timing.startTime,
          duration: placement.overlay.timing.duration,
          text: placement.overlay.content.text,
          style: placement.overlay.content.style,
          transform: placement.overlay.transform,
          animation: placement.overlay.content.animation
            ? {
                preset: placement.overlay.content.animation.preset,
                params: placement.overlay.content.animation.params || {},
                inDuration: placement.overlay.content.animation.inDuration,
                outDuration: placement.overlay.content.animation.outDuration,
                stagger: placement.overlay.content.animation.stagger,
                unit: placement.overlay.content.animation.unit,
              }
            : undefined,
          metadata,
        });

        return Boolean(
          titleEngine.updateTextClip(placement.overlay.id, {
            keyframes: buildEditingTemplateKeyframes(
              placement.overlay.id,
              placement.overlay.keyframes,
            ),
            blendMode: placement.overlay.blendMode,
            blendOpacity: placement.overlay.blendOpacity,
            emphasisAnimation: placement.overlay.emphasisAnimation,
            metadata,
          }),
        );
      }

      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) {
        return false;
      }

      if (placement.overlay.type === "shape") {
        if (graphicsEngine.getShapeClip(placement.overlay.id)) {
          return true;
        }

        graphicsEngine.createShape(
          {
            id: placement.overlay.id,
            shapeType: placement.overlay.content.shapeType,
            width: placement.overlay.content.width,
            height: placement.overlay.content.height,
            style: placement.overlay.content.style,
            metadata,
          },
          placement.trackId,
          placement.overlay.timing.startTime,
          placement.overlay.timing.duration,
        );

        return Boolean(
          graphicsEngine.updateShapeClip(placement.overlay.id, {
            transform: placement.overlay.transform,
            keyframes: buildEditingTemplateKeyframes(
              placement.overlay.id,
              placement.overlay.keyframes,
            ),
            blendMode: placement.overlay.blendMode,
            blendOpacity: placement.overlay.blendOpacity,
            emphasisAnimation: placement.overlay.emphasisAnimation,
          }),
        );
      }

      if (graphicsEngine.getStickerClip(placement.overlay.id)) {
        return true;
      }

      if (!placement.overlay.content.imageUrl) {
        return false;
      }

      graphicsEngine.addStickerClip({
        id: placement.overlay.id,
        trackId: placement.trackId,
        startTime: placement.overlay.timing.startTime,
        duration: placement.overlay.timing.duration,
        type: "sticker",
        imageUrl: placement.overlay.content.imageUrl,
        name: placement.overlay.content.name,
        transform: placement.overlay.transform,
        keyframes: buildEditingTemplateKeyframes(
          placement.overlay.id,
          placement.overlay.keyframes,
        ),
        blendMode: placement.overlay.blendMode,
        blendOpacity: placement.overlay.blendOpacity,
        emphasisAnimation: placement.overlay.emphasisAnimation,
        metadata,
      });

      return true;
    };

    const hasEditingTemplateArtifacts = (
      project: Project,
      ownerClipId: string,
      applicationId: string,
    ): boolean => {
      const ownerClip = project.timeline.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === ownerClipId);

      if (ownerClip) {
        if ((ownerClip.metadata?.appliedTemplates || []).some(
          (template) => template.applicationId === applicationId,
        )) {
          return true;
        }

        if (ownerClip.effects.some(
          (effect) => effect.metadata?.templateSource?.applicationId === applicationId,
        )) {
          return true;
        }

        if (ownerClip.audioEffects.some(
          (effect) => effect.metadata?.templateSource?.applicationId === applicationId,
        )) {
          return true;
        }

        if (ownerClip.keyframes.some(
          (keyframe) => keyframe.id.startsWith(`template-keyframe-${applicationId}-`),
        )) {
          return true;
        }
      }

      const titleEngine = useEngineStore.getState().getTitleEngine();
      if (titleEngine?.getAllTextClips().some(
        (clip) => clip.metadata?.templateSource?.applicationId === applicationId,
      )) {
        return true;
      }

      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (!graphicsEngine) {
        return false;
      }

      return [
        ...graphicsEngine.getAllShapeClips(),
        ...graphicsEngine.getAllSVGClips(),
        ...graphicsEngine.getAllStickerClips(),
      ].some((clip) => clip.metadata?.templateSource?.applicationId === applicationId);
    };

    const removeEditingTemplateApplicationFromProject = (
      project: Project,
      ownerClipId: string,
      applicationId: string,
      trackIdsToRemoveIfEmpty: string[] = [],
    ): Project => {
      let updatedProject = project;
      const currentOwnerClip = project.timeline.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === ownerClipId);

      if (currentOwnerClip) {
        const nextProject = updateProjectClip(project, ownerClipId, (clip) => {
          const appliedTemplates = (clip.metadata?.appliedTemplates || []).filter(
            (template) => template.applicationId !== applicationId,
          );
          const metadata: Record<string, unknown> = {
            ...(clip.metadata || {}),
          };

          if (appliedTemplates.length > 0) {
            metadata.appliedTemplates = appliedTemplates;
          } else {
            delete metadata.appliedTemplates;
          }

          return {
            ...clip,
            effects: clip.effects.filter(
              (effect) => effect.metadata?.templateSource?.applicationId !== applicationId,
            ),
            audioEffects: clip.audioEffects.filter(
              (effect) => effect.metadata?.templateSource?.applicationId !== applicationId,
            ),
            keyframes: clip.keyframes.filter(
              (keyframe) => !keyframe.id.startsWith(`template-keyframe-${applicationId}-`),
            ),
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          };
        });

        if (nextProject) {
          updatedProject = nextProject;
        }
      }

      const titleEngine = useEngineStore.getState().getTitleEngine();
      for (const textClip of titleEngine?.getAllTextClips() || []) {
        if (textClip.metadata?.templateSource?.applicationId === applicationId) {
          titleEngine?.deleteTextClip(textClip.id);
        }
      }

      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      if (graphicsEngine) {
        for (const shapeClip of graphicsEngine.getAllShapeClips()) {
          if (shapeClip.metadata?.templateSource?.applicationId === applicationId) {
            graphicsEngine.deleteShapeClip(shapeClip.id);
          }
        }

        for (const svgClip of graphicsEngine.getAllSVGClips()) {
          if (svgClip.metadata?.templateSource?.applicationId === applicationId) {
            graphicsEngine.deleteSVGClip(svgClip.id);
          }
        }

        for (const stickerClip of graphicsEngine.getAllStickerClips()) {
          if (stickerClip.metadata?.templateSource?.applicationId === applicationId) {
            graphicsEngine.deleteStickerClip(stickerClip.id);
          }
        }
      }

      for (const trackId of trackIdsToRemoveIfEmpty) {
        if (!trackHasAnyClips(updatedProject, trackId)) {
          updatedProject = removeTrackFromProjectState(updatedProject, trackId);
        }
      }

      syncClipEffectsBridge(updatedProject, ownerClipId);

      return {
        ...updatedProject,
        modifiedAt: Date.now(),
      };
    };

    const removeEditingTemplateApplicationStateFromProject = (
      project: Project,
      applicationState: EditingTemplateApplicationState,
      removeEmptyTracks: boolean = true,
    ): Project =>
      removeEditingTemplateApplicationFromProject(
        project,
        applicationState.ownerClipId,
        applicationState.applicationId,
        removeEmptyTracks
          ? applicationState.trackSnapshots.map((snapshot) => snapshot.track.id)
          : [],
      );

    const restoreEditingTemplateApplicationState = (
      project: Project,
      applicationState: EditingTemplateApplicationState,
    ): Project | null => {
      if (!canRestoreEditingTemplateOverlays(applicationState.overlays)) {
        return null;
      }

      let updatedProject = project;
      for (const snapshot of applicationState.trackSnapshots) {
        updatedProject = insertEditingTemplateTrack(updatedProject, snapshot);
      }

      const ownerClip = updatedProject.timeline.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === applicationState.ownerClipId);
      if (!ownerClip) {
        return null;
      }

      const templateSource = buildEditingTemplateSource(
        applicationState.templateId,
        applicationState.applicationId,
        applicationState.ownerClipId,
        ownerClip.trackId,
        applicationState.appliedTemplate.controlValues,
      );

      const nextProject = updateProjectClip(
        updatedProject,
        applicationState.ownerClipId,
        (clip) => {
        const effectIds = new Set(clip.effects.map((effect) => effect.id));
        const audioEffectIds = new Set(clip.audioEffects.map((effect) => effect.id));
        const keyframeIds = new Set(clip.keyframes.map((keyframe) => keyframe.id));
        const appliedTemplates = clip.metadata?.appliedTemplates || [];
        const hasAppliedTemplate = appliedTemplates.some(
          (template) =>
            template.applicationId === applicationState.applicationId,
        );

        return {
          ...clip,
          effects: [
            ...clip.effects,
            ...applicationState.addedEffects.filter(
              (effect) => !effectIds.has(effect.id),
            ),
          ],
          audioEffects: [
            ...clip.audioEffects,
            ...applicationState.addedAudioEffects.filter(
              (effect) => !audioEffectIds.has(effect.id),
            ),
          ],
          keyframes: [
            ...clip.keyframes,
            ...applicationState.addedKeyframes.filter(
              (keyframe) => !keyframeIds.has(keyframe.id),
            ),
          ],
          metadata: {
            ...(clip.metadata || {}),
            appliedTemplates: hasAppliedTemplate
              ? appliedTemplates
              : [...appliedTemplates, applicationState.appliedTemplate],
          },
        };
      },
      );

      if (!nextProject) {
        return null;
      }

      updatedProject = nextProject;

      for (const placement of applicationState.overlays) {
        if (!createEditingTemplateOverlay(placement, templateSource)) {
          return null;
        }
      }

      syncClipEffectsBridge(updatedProject, applicationState.ownerClipId);

      return {
        ...updatedProject,
        modifiedAt: Date.now(),
      };
    };

    return {
      // Initial state - create empty project (Requirement 1.1)
      project: createEmptyProject(),
      hasOpenProject: false,
      photoProjects: new Map(),
      actionExecutor,
      actionHistory,
      clipUndoStack: [] as ClipHistoryEntry[],
      clipRedoStack: [] as ClipHistoryEntry[],
      templateUndoStack: [] as EditingTemplateHistoryEntry[],
      templateRedoStack: [] as EditingTemplateHistoryEntry[],
      redoJournal: [] as Array<"action" | "clip" | "template">,
      isLoading: false,
      error: null,
      clipboard: [] as TimelineClipboardItem[],
      lastPastedClipIds: [] as string[],
      copiedEffects: [] as Effect[],

      ...createLifecycleSlice(set, get),

      // Media library actions
      ...createMediaSlice(set, get),

      addPlaceholderMedia: (item: MediaItem) => {
        const { project } = get();
        set({
          project: {
            ...project,
            mediaLibrary: {
              ...project.mediaLibrary,
              items: [...project.mediaLibrary.items, item],
            },
            modifiedAt: Date.now(),
          },
        });
      },

      setKieAIItemState: (mediaId: string, isPending: boolean, kieaiError: boolean) => {
        const { project } = get();
        const updatedItems = project.mediaLibrary.items.map((item) =>
          item.id === mediaId ? { ...item, isPending, kieaiError } : item,
        );
        set({
          project: {
            ...project,
            mediaLibrary: { ...project.mediaLibrary, items: updatedItems },
            modifiedAt: Date.now(),
          },
        });
      },

      replacePlaceholderMedia: async (mediaId: string, blob: Blob, name: string) => {
        const { project } = get();

        // For images use createImageBitmap (no mediaBridge dependency).
        // This avoids WASM initialisation races and works immediately in any context.
        let thumbnailUrl: string | null = null;
        let width = 0;
        let height = 0;

        if (blob.size > 0 && blob.type.startsWith("image/")) {
          try {
            const bitmap = await createImageBitmap(blob);
            width = bitmap.width;
            height = bitmap.height;

            const THUMB_SIZE = 320;
            const scale = Math.min(THUMB_SIZE / bitmap.width, THUMB_SIZE / bitmap.height, 1);
            const tw = Math.round(bitmap.width * scale);
            const th = Math.round(bitmap.height * scale);

            const canvas = new OffscreenCanvas(tw, th);
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(bitmap, 0, 0, tw, th);
            bitmap.close();

            const thumbBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
            thumbnailUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(thumbBlob);
            });
          } catch (thumbErr) {
            console.warn("[ProjectStore] KieAI thumbnail generation failed:", thumbErr);
          }
        }

        const file = new File([blob], name, { type: blob.type || "image/png" });

        const updatedItem: MediaItem = {
          id: mediaId,
          name,
          type: "image",
          fileHandle: null,
          blob: file,
          metadata: {
            duration: 0,
            width,
            height,
            frameRate: 0,
            codec: "",
            sampleRate: 0,
            channels: 0,
            fileSize: file.size,
          },
          thumbnailUrl,
          waveformData: null,
          isPlaceholder: false,
          isPending: false,
        };

        const updatedItems = project.mediaLibrary.items.map((item) =>
          item.id === mediaId ? updatedItem : item,
        );

        set({
          project: {
            ...project,
            mediaLibrary: { ...project.mediaLibrary, items: updatedItems },
            modifiedAt: Date.now(),
          },
        });

        try {
          await saveMediaBlob(project.id, mediaId, file, updatedItem.metadata);
        } catch (err) {
          console.error("[ProjectStore] Failed to persist KieAI result blob:", err);
        }
      },

      // Track actions
      ...createTrackSlice(set, get),

      // Clip actions
      ...createClipSlice(set, get),
      ...createTimelineItemSlice(set, get, helpers),

      addClipTransition: async (transition: Transition) => {
        const { project, actionExecutor } = get();
        const clip = project.timeline.tracks
          .flatMap((track) => track.clips)
          .find((candidate) => candidate.id === transition.clipAId);

        if (!clip) {
          return null;
        }

        const action: Action = {
          type: "transition/set",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { transition },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error("Failed to add transition:", result.error?.message);
          return null;
        }

        set({ project: { ...project, modifiedAt: Date.now() } });
        syncTrackTransitionsBridge(get().project, clip.trackId);
        return transition;
      },

      updateClipTransition: async (
        transitionId: string,
        updates: Partial<Pick<Transition, "type" | "duration" | "params">>,
      ) => {
        const { project, actionExecutor } = get();
        const ownerTrack = project.timeline.tracks.find((track) =>
          track.transitions.some((t) => t.id === transitionId),
        );
        if (!ownerTrack) {
          return null;
        }

        const action: Action = {
          type: "transition/update",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            transitionId,
            ...(updates.type !== undefined ? { type: updates.type } : {}),
            ...(updates.duration !== undefined
              ? { duration: updates.duration }
              : {}),
            ...(updates.params !== undefined ? { params: updates.params } : {}),
          },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error("Failed to update transition:", result.error?.message);
          return null;
        }

        set({ project: { ...project, modifiedAt: Date.now() } });
        syncTrackTransitionsBridge(get().project, ownerTrack.id);
        return (
          get()
            .project.timeline.tracks.flatMap((track) => track.transitions)
            .find((t) => t.id === transitionId) ?? null
        );
      },

      removeClipTransition: async (transitionId: string) => {
        const { project, actionExecutor } = get();
        const ownerTrack = project.timeline.tracks.find((track) =>
          track.transitions.some((t) => t.id === transitionId),
        );
        if (!ownerTrack) {
          return false;
        }

        const action: Action = {
          type: "transition/remove",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { transitionId },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error("Failed to remove transition:", result.error?.message);
          return false;
        }

        set({ project: { ...project, modifiedAt: Date.now() } });
        syncTrackTransitionsBridge(get().project, ownerTrack.id);
        return true;
      },

      getClipTransition: (transitionId: string) => {
        const { project } = get();
        for (const track of project.timeline.tracks) {
          const transition = track.transitions.find(
            (candidate) => candidate.id === transitionId,
          );
          if (transition) {
            return transition;
          }
        }
        return undefined;
      },

      getClipTransitionBetweenClips: (clipAId: string, clipBId: string) => {
        const { project } = get();
        for (const track of project.timeline.tracks) {
          const transition = track.transitions.find(
            (candidate) =>
              candidate.clipAId === clipAId && candidate.clipBId === clipBId,
          );
          if (transition) {
            return transition;
          }
        }
        return undefined;
      },

      ...createClipboardSlice(set, get),

      updateClipTransform: async (
        clipId: string,
        transformUpdate: Partial<Transform>,
      ): Promise<ActionResult> => {
        const { project, actionExecutor } = get();

        const mergeTransform = (base: Transform): Transform => ({
          ...base,
          ...transformUpdate,
          position: { ...base.position, ...(transformUpdate.position || {}) },
          scale: { ...base.scale, ...(transformUpdate.scale || {}) },
          anchor: { ...base.anchor, ...(transformUpdate.anchor || {}) },
        });

        // Timeline clips are undoable via the action system (the deep-merge of
        // nested axes happens in the transform/update apply handler).
        const inTimeline = project.timeline.tracks.some((track) =>
          track.clips.some((c) => c.id === clipId),
        );
        if (inTimeline) {
          const action: Action = {
            type: "transform/update",
            id: uuidv4(),
            timestamp: Date.now(),
            params: { clipId, transform: transformUpdate },
          };
          const result = await actionExecutor.execute(action, project);
          if (result.success) {
            set({ project: { ...project } });
          }
          return result;
        }

        // Text clips live in the title engine (not project.timeline); they use
        // the separate clip-history mechanism, so keep the direct engine update.
        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, {
              transform: mergeTransform(textClip.transform),
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        // Shape / SVG clips live in the graphics engine.
        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, {
              transform: mergeTransform(shapeClip.transform),
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, {
              transform: mergeTransform(svgClip.transform),
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        return {
          success: false,
          error: { code: "INVALID_PARAMS", message: `Clip ${clipId} not found` },
        };
      },

      updateClipBlendMode: async (
        clipId: string,
        blendMode,
      ): Promise<ActionResult> => {
        const { project, actionExecutor } = get();

        // Timeline clips are undoable via the action system.
        const inTimeline = project.timeline.tracks.some((track) =>
          track.clips.some((c) => c.id === clipId),
        );
        if (inTimeline) {
          const action: Action = {
            type: "clip/setBlendMode",
            id: uuidv4(),
            timestamp: Date.now(),
            params: { clipId, blendMode },
          };
          const result = await actionExecutor.execute(action, project);
          if (result.success) {
            set({ project: { ...project } });
          }
          return result;
        }

        // Text clips live in the title engine.
        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, { blendMode });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        // Shape / SVG clips live in the graphics engine.
        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, { blendMode });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, { blendMode });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        return {
          success: false,
          error: { code: "INVALID_PARAMS", message: `Clip ${clipId} not found` },
        };
      },

      updateClipBlendOpacity: async (
        clipId: string,
        opacity: number,
      ): Promise<ActionResult> => {
        const { project, actionExecutor } = get();

        if (opacity < 0 || opacity > 100) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS",
              message: "Blend opacity must be between 0 and 100",
            },
          };
        }

        const inTimeline = project.timeline.tracks.some((track) =>
          track.clips.some((c) => c.id === clipId),
        );
        if (inTimeline) {
          const action: Action = {
            type: "clip/setBlendOpacity",
            id: uuidv4(),
            timestamp: Date.now(),
            params: { clipId, opacity },
          };
          const result = await actionExecutor.execute(action, project);
          if (result.success) {
            set({ project: { ...project } });
          }
          return result;
        }

        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, { blendOpacity: opacity });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, { blendOpacity: opacity });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, { blendOpacity: opacity });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        return {
          success: false,
          error: { code: "INVALID_PARAMS", message: `Clip ${clipId} not found` },
        };
      },

      updateClipEmphasisAnimation: async (
        clipId: string,
        emphasisAnimation,
      ): Promise<ActionResult> => {
        const { project, actionExecutor } = get();

        const inTimeline = project.timeline.tracks.some((track) =>
          track.clips.some((c) => c.id === clipId),
        );
        if (inTimeline) {
          const action: Action = {
            type: "clip/setEmphasisAnimation",
            id: uuidv4(),
            timestamp: Date.now(),
            params: { clipId, emphasisAnimation },
          };
          const result = await actionExecutor.execute(action, project);
          if (result.success) {
            set({ project: { ...project } });
          }
          return result;
        }

        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, { emphasisAnimation });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, { emphasisAnimation });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, { emphasisAnimation });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }

          const stickerClip = graphicsEngine.getStickerClip(clipId);
          if (stickerClip) {
            graphicsEngine.updateStickerClip(clipId, { emphasisAnimation });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return { success: true };
          }
        }

        return {
          success: false,
          error: { code: "INVALID_PARAMS", message: `Clip ${clipId} not found` },
        };
      },

      updateClipRotate3D: (
        clipId: string,
        rotate3d: { x: number; y: number; z: number },
      ) => {
        const { project } = get();

        let found = false;
        const newTracks = project.timeline.tracks.map((track) => {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex === -1) return track;

          found = true;
          const clip = track.clips[clipIndex];
          const newClips = [...track.clips];
          newClips[clipIndex] = {
            ...clip,
            transform: { ...clip.transform, rotate3d },
          };

          return { ...track, clips: newClips };
        });

        if (found) {
          set({
            project: {
              ...project,
              timeline: { ...project.timeline, tracks: newTracks },
              modifiedAt: Date.now(),
            },
          });
          return true;
        }

        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, {
              transform: { ...textClip.transform, rotate3d },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, {
              transform: { ...shapeClip.transform, rotate3d },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, {
              transform: { ...svgClip.transform, rotate3d },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        return false;
      },

      updateClipPerspective: (clipId: string, perspective: number) => {
        const { project } = get();

        if (perspective < 0) {
          console.error("Perspective must be non-negative");
          return false;
        }

        let found = false;
        const newTracks = project.timeline.tracks.map((track) => {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex === -1) return track;

          found = true;
          const clip = track.clips[clipIndex];
          const newClips = [...track.clips];
          newClips[clipIndex] = {
            ...clip,
            transform: { ...clip.transform, perspective },
          };

          return { ...track, clips: newClips };
        });

        if (found) {
          set({
            project: {
              ...project,
              timeline: { ...project.timeline, tracks: newTracks },
              modifiedAt: Date.now(),
            },
          });
          return true;
        }

        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, {
              transform: { ...textClip.transform, perspective },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, {
              transform: { ...shapeClip.transform, perspective },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, {
              transform: { ...svgClip.transform, perspective },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        return false;
      },

      updateClipTransformStyle: (
        clipId: string,
        transformStyle: "flat" | "preserve-3d",
      ) => {
        const { project } = get();

        let found = false;
        const newTracks = project.timeline.tracks.map((track) => {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex === -1) return track;

          found = true;
          const clip = track.clips[clipIndex];
          const newClips = [...track.clips];
          newClips[clipIndex] = {
            ...clip,
            transform: { ...clip.transform, transformStyle },
          };

          return { ...track, clips: newClips };
        });

        if (found) {
          set({
            project: {
              ...project,
              timeline: { ...project.timeline, tracks: newTracks },
              modifiedAt: Date.now(),
            },
          });
          return true;
        }

        const titleEngine = useEngineStore.getState().getTitleEngine();
        if (titleEngine) {
          const textClip = titleEngine.getTextClip(clipId);
          if (textClip) {
            titleEngine.updateTextClip(clipId, {
              transform: { ...textClip.transform, transformStyle },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
        if (graphicsEngine) {
          const shapeClip = graphicsEngine.getShapeClip(clipId);
          if (shapeClip) {
            graphicsEngine.updateShapeClip(clipId, {
              transform: { ...shapeClip.transform, transformStyle },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }

          const svgClip = graphicsEngine.getSVGClip(clipId);
          if (svgClip) {
            graphicsEngine.updateSVGClip(clipId, {
              transform: { ...svgClip.transform, transformStyle },
            });
            set({ project: { ...project, modifiedAt: Date.now() } });
            return true;
          }
        }

        return false;
      },

      // Undo/Redo
      ...createHistorySlice(set, get, {
        applyClipDataSnapshot,
        syncOverlayEnginesFromProject,
        syncProjectEffectsBridge,
        syncProjectTransitionsBridge,
        getEditingTemplateApplicationState,
        removeEditingTemplateApplicationStateFromProject,
        restoreEditingTemplateApplicationState,
      }),

      // Execute arbitrary action
      executeAction: async (action: Action) => {
        const { project, actionExecutor, hasOpenProject } = get();
        if (!hasOpenProject) {
          return {
            success: false,
            error: {
              code: "INVALID_PARAMS",
              message: "No project is open",
            },
          };
        }
        const targetProject = action.type === "project/applyEditSnapshot" ? get().getFullProject() : project;
        const previousProject = action.type === "project/applyEditSnapshot" ? { ...targetProject } : undefined;
        const result = await actionExecutor.execute(action, targetProject);
        if (result.success) {
          if (action.type === "project/applyEditSnapshot") {
            syncOverlayEnginesFromProject(targetProject);
            syncProjectEffectsBridge(targetProject, previousProject);
            syncProjectTransitionsBridge(targetProject, previousProject);
          }
          set({ project: { ...targetProject } });
        }
        return result;
      },

      // Computed values
      getTimelineDuration: () => {
        const { project } = get();
        return calculateTimelineDuration(project);
      },

      // Auto-save methods
      ...createPersistenceSlice(set, get, subscribeToProject),

      ...createEditingTemplateSlice(set, get, {
        applyEditingTemplateApplicationToProject,
        findEditingTemplateHistoryEntry,
        getEditingTemplateApplicationState,
        getEditingTemplatePreferredTrackIds,
        removeEditingTemplateApplicationStateFromProject,
        restoreEditingTemplateApplicationState,
        hasEditingTemplateArtifacts,
        removeEditingTemplateApplicationFromProject,
      }),

      ...createMotionSlice(set, get),

      // Text clip actions

      /**
       * Create a new text clip with default styling
       * Create text clips using TitleEngine with default styling
       */
      ...createTextGraphicsSlice(set, get, helpers),

      // Subtitle actions - subtitles are now created as text clips on a "Captions" track

      /**
       * Add a subtitle as a text clip on a Captions track
       */
      ...createSubtitleSlice(set, get),

      // Marker actions

      ...createMarkerSlice(set, get),


      // Photo editing actions

      /**
       * Create a new photo project
       * Create PhotoProject with base layer using PhotoEngine
       */
      createPhotoProject: (width?: number, height?: number, name?: string) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const photoProject = photoEngine.createProject(width, height, name);
        const { photoProjects } = get();
        photoProjects.set(photoProject.id, photoProject);

        // Create new Map instance to trigger Zustand reactivity (Maps don't trigger on set operations)
        // This ensures subscribers are notified of photo project changes
        set({ photoProjects: new Map(photoProjects) });
        return photoProject;
      },

      /**
       * Import a photo and create a base layer
       * Create PhotoProject with base layer
       */
      importPhotoForEditing: (image: ImageBitmap, name?: string) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        // Create a new project with image dimensions
        const photoProject = photoEngine.createProject(
          image.width,
          image.height,
          name || "Photo Edit",
        );

        // Import the photo as base layer in the project
        const updatedProject = photoEngine.importPhoto(
          photoProject,
          image,
          name,
        );

        const { photoProjects } = get();
        photoProjects.set(updatedProject.id, updatedProject);

        // Create new Map to notify Zustand subscribers (mutation on existing Map won't trigger)
        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Add a new layer to a photo project
       * Insert layer above current layer in stack
       */
      addPhotoLayer: (projectId: string, options?: CreateLayerOptions) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        // PhotoEngine.addLayer returns updated project with new layer
        const updatedProject = photoEngine.addLayer(photoProject, options);
        photoProjects.set(projectId, updatedProject); // Update Map with new project state

        // Create new Map to notify Zustand and all subscribers of the change
        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Remove a layer from a photo project
       */
      removePhotoLayer: (projectId: string, layerId: string) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        const updatedProject = photoEngine.removeLayer(photoProject, layerId);
        photoProjects.set(projectId, updatedProject);

        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Reorder layers in a photo project
       * Reorder layers and update composite order
       */
      reorderPhotoLayers: (
        projectId: string,
        fromIndex: number,
        toIndex: number,
      ) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        const result = photoEngine.reorderLayers(
          photoProject,
          fromIndex,
          toIndex,
        );
        if (!result.success) {
          console.error(`Failed to reorder layers: ${result.error}`);
          return null;
        }

        const updatedProject = {
          ...photoProject,
          layers: result.layers,
        };
        photoProjects.set(projectId, updatedProject);

        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Toggle layer visibility
       * Toggle layer visibility
       */
      setPhotoLayerVisibility: (
        projectId: string,
        layerId: string,
        visible?: boolean,
      ) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        const updatedProject = photoEngine.setLayerVisibility(
          photoProject,
          layerId,
          visible,
        );
        photoProjects.set(projectId, updatedProject);

        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Set layer opacity
       * Adjust layer opacity
       */
      setPhotoLayerOpacity: (
        projectId: string,
        layerId: string,
        opacity: number,
      ) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        const updatedProject = photoEngine.setLayerOpacity(
          photoProject,
          layerId,
          opacity,
        );
        photoProjects.set(projectId, updatedProject);

        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Set layer blend mode
       * Adjust layer blend mode
       */
      setPhotoLayerBlendMode: (
        projectId: string,
        layerId: string,
        blendMode: PhotoBlendMode,
      ) => {
        const photoEngine = useEngineStore.getState().getPhotoEngine();
        if (!photoEngine) {
          console.error("PhotoEngine not initialized");
          return null;
        }

        const { photoProjects } = get();
        const photoProject = photoProjects.get(projectId);
        if (!photoProject) {
          console.error(`Photo project ${projectId} not found`);
          return null;
        }

        const updatedProject = photoEngine.setLayerBlendMode(
          photoProject,
          layerId,
          blendMode,
        );
        photoProjects.set(projectId, updatedProject);

        set({ photoProjects: new Map(photoProjects) });
        return updatedProject;
      },

      /**
       * Get a photo project by ID
       */
      getPhotoProject: (projectId: string) => {
        const { photoProjects } = get();
        return photoProjects.get(projectId) || null;
      },

      // Video effects actions

      /**
       * Add a video effect to a clip
       * Apply video effect within 200ms
       */
      addVideoEffect: async (
        clipId: string,
        effectType: VideoEffectType,
        params?: Record<string, unknown>,
      ) => {
        const { project, actionExecutor } = get();
        const effectId = `effect-${uuidv4()}`;
        if (findOverlayEffectOwner(project, clipId)) {
          updateOverlayEffectOwner(clipId, (effects) => [
            ...effects,
            {
              id: effectId,
              type: effectType,
              enabled: true,
              params: params ?? {},
            },
          ]);
          return get().getVideoEffect(clipId, effectId) ?? null;
        }
        const action: Action = {
          type: "effect/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectType, params, effectId },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error("Failed to add video effect:", result.error?.message);
          return null;
        }

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return get().getVideoEffect(clipId, effectId) ?? null;
      },

      duplicateVideoEffect: async (clipId: string, sourceEffectId: string) => {
        const { project, actionExecutor, getVideoEffects } = get();
        const effects = getVideoEffects(clipId);
        const sourceIndex = effects.findIndex(
          (effect) => effect.id === sourceEffectId,
        );
        if (sourceIndex < 0) return null;
        const source = effects[sourceIndex]!;
        const effectId = `effect-${uuidv4()}`;
        const copy: VideoEffect = {
          ...source,
          id: effectId,
          params: structuredClone(source.params),
        };

        if (findOverlayEffectOwner(project, clipId)) {
          updateOverlayEffectOwner(clipId, (currentEffects) => {
            const next = [...currentEffects];
            next.splice(sourceIndex + 1, 0, copy);
            return next;
          });
          return get().getVideoEffect(clipId, effectId) ?? null;
        }

        const action: Action = {
          type: "effect/add",
          id: uuidv4(),
          timestamp: Date.now(),
          params: {
            clipId,
            effectType: source.type,
            params: structuredClone(source.params),
            effectId,
            index: sourceIndex + 1,
            enabled: source.enabled,
          },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) return null;

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return get().getVideoEffect(clipId, effectId) ?? null;
      },

      replaceVideoEffects: async (
        clipId: string,
        effects: VideoEffect[],
      ) => {
        const { project, actionExecutor } = get();
        const nextEffects = structuredClone(effects);
        if (findOverlayEffectOwner(project, clipId)) {
          return Boolean(
            updateOverlayEffectOwner(clipId, () => nextEffects),
          );
        }

        const action: Action = {
          type: "effect/setStack",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effects: nextEffects },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) return false;

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return true;
      },

      /**
       * Update a video effect's parameters
       * Apply changes within 200ms
       */
      updateVideoEffect: async (
        clipId: string,
        effectId: string,
        params: Record<string, unknown>,
      ) => {
        const { project, actionExecutor } = get();
        if (findOverlayEffectOwner(project, clipId)) {
          const updated = updateOverlayEffectOwner(clipId, (effects) =>
            effects.map((effect) =>
              effect.id === effectId
                ? { ...effect, params: { ...effect.params, ...params } }
                : effect,
            ),
          );
          return updated ? get().getVideoEffect(clipId, effectId) ?? null : null;
        }
        const action: Action = {
          type: "effect/update",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId, params },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to update video effect:",
            result.error?.message,
          );
          return null;
        }

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return get().getVideoEffect(clipId, effectId) ?? null;
      },

      /**
       * Remove a video effect from a clip
       * Restore clip to previous state when effect removed
       */
      removeVideoEffect: async (clipId: string, effectId: string) => {
        const { project, actionExecutor } = get();
        if (findOverlayEffectOwner(project, clipId)) {
          return Boolean(
            updateOverlayEffectOwner(clipId, (effects) =>
              effects.filter((effect) => effect.id !== effectId),
            ),
          );
        }
        const action: Action = {
          type: "effect/remove",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to remove video effect:",
            result.error?.message,
          );
          return false;
        }

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return true;
      },

      /**
       * Reorder video effects in the processing chain
       * Update effect order in clip's effect list
       */
      reorderVideoEffects: (clipId: string, effectIds: string[]) => {
        const { project, getClip } = get();
        const overlayLocation = findOverlayEffectOwner(project, clipId);
        const clip = getClip(clipId) ?? overlayLocation?.clip;
        if (!clip) {
          console.error("Failed to reorder video effects: clip not found");
          return false;
        }

        const currentEffects = clip.effects ?? [];
        const effectMap = new Map(currentEffects.map((effect) => [effect.id, effect]));
        const reorderedIds = new Set(effectIds);
        if (
          effectIds.length !== currentEffects.length ||
          reorderedIds.size !== currentEffects.length ||
          effectIds.some((effectId) => !effectMap.has(effectId))
        ) {
          console.error("Failed to reorder video effects: invalid effect order");
          return false;
        }

        const priorOrder = currentEffects.map((effect) => effect.id);

        if (overlayLocation) {
          return Boolean(
            updateOverlayEffectOwner(clipId, () =>
              effectIds.map((effectId) => effectMap.get(effectId)!),
            ),
          );
        }

        const updatedProject = updateProjectClip(project, clipId, (currentClip) => ({
          ...currentClip,
          effects: effectIds.map((effectId) => effectMap.get(effectId)!),
        }));

        if (!updatedProject) {
          console.error("Failed to reorder video effects: clip not found");
          return false;
        }

        syncClipEffectsBridge(updatedProject, clipId);
        set({ project: updatedProject, clipRedoStack: [], templateRedoStack: [] });
        const actionId = uuidv4();
        get().actionExecutor.getHistory().push(
          {
            type: "effect/setOrder",
            id: actionId,
            timestamp: Date.now(),
            params: { clipId, effectIds },
          },
          {
            type: "effect/setOrder",
            id: `inverse-${actionId}`,
            timestamp: Date.now(),
            params: { clipId, effectIds: priorOrder },
          },
        );
        return true;
      },

      /**
       * Toggle a video effect's enabled state
       * Toggle effect enabled state
       */
      toggleVideoEffect: async (
        clipId: string,
        effectId: string,
        enabled: boolean,
      ) => {
        const { project, actionExecutor } = get();
        if (findOverlayEffectOwner(project, clipId)) {
          const updated = updateOverlayEffectOwner(clipId, (effects) =>
            effects.map((effect) =>
              effect.id === effectId ? { ...effect, enabled } : effect,
            ),
          );
          return updated ? get().getVideoEffect(clipId, effectId) ?? null : null;
        }
        const action: Action = {
          type: "effect/toggle",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId, enabled },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to toggle video effect:",
            result.error?.message,
          );
          return null;
        }

        set({ project: { ...project } });
        syncClipEffectsBridge(get().project, clipId);
        return get().getVideoEffect(clipId, effectId) ?? null;
      },

      /**
       * Get all video effects for a clip
       */
      getVideoEffects: (clipId: string) => {
        const { project } = get();
        const clip = project.timeline.tracks
          .flatMap((track) => track.clips)
          .find((candidate) => candidate.id === clipId) ??
          findOverlayEffectOwner(project, clipId)?.clip;
        const timelineEffects = clip
          ? mapClipEffectsToVideoEffects(clip.effects ?? [])
          : [];

        const effectsBridge = getEffectsBridge();
        if (!effectsBridge.isInitialized()) {
          return timelineEffects;
        }

        const bridgeEffects = effectsBridge.getEffects(clipId);
        if (bridgeEffects.length === 0 && timelineEffects.length > 0) {
          syncClipEffectsBridge(project, clipId);
          return effectsBridge.getEffects(clipId);
        }

        return bridgeEffects.length > 0 ? bridgeEffects : timelineEffects;
      },

      /**
       * Get a specific video effect by ID
       */
      getVideoEffect: (clipId: string, effectId: string) => {
        return get()
          .getVideoEffects(clipId)
          .find((effect) => effect.id === effectId);
      },

      // Color grading actions

      /**
       * Update color grading settings for a clip
       * Apply color grading adjustments
       */
      updateColorGrading: async (
        clipId: string,
        settings: Partial<ColorGradingSettings>,
      ): Promise<boolean> => {
        const { project, actionExecutor } = get();
        const effectsBridge = getEffectsBridge();
        if (!effectsBridge.isInitialized()) {
          console.error("EffectsBridge not initialized");
          return false;
        }

        // Apply each setting type to the live bridge for immediate rendering.
        if (settings.colorWheels) {
          const result = effectsBridge.applyColorWheels(
            clipId,
            settings.colorWheels,
          );
          if (!result.success) {
            console.error("Failed to apply color wheels:", result.error);
            return false;
          }
        }

        if (settings.curves) {
          const result = effectsBridge.applyCurves(clipId, settings.curves);
          if (!result.success) {
            console.error("Failed to apply curves:", result.error);
            return false;
          }
        }

        if (settings.lut) {
          const result = effectsBridge.applyLUT(clipId, settings.lut);
          if (!result.success) {
            console.error("Failed to apply LUT:", result.error);
            return false;
          }
        }

        if (settings.hsl) {
          const result = effectsBridge.applyHSL(clipId, settings.hsl);
          if (!result.success) {
            console.error("Failed to apply HSL:", result.error);
            return false;
          }
        }

        if (
          settings.temperature !== undefined ||
          settings.tint !== undefined
        ) {
          const result = effectsBridge.applyWhiteBalance(clipId, {
            temperature: settings.temperature,
            tint: settings.tint,
          });
          if (!result.success) {
            console.error("Failed to apply white balance:", result.error);
            return false;
          }
        }

        // Persist the merged result onto the clip so it is undoable + saved.
        const action: Action = {
          type: "clip/setColorGrading",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, colorGrading: buildSerializedColorGrading(clipId) },
        };
        const actionResult = await actionExecutor.execute(action, project);
        if (!actionResult.success) {
          console.error(
            "Failed to persist color grading:",
            actionResult.error?.message,
          );
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      /**
       * Get color grading settings for a clip
       */
      getColorGrading: (clipId: string) => {
        const effectsBridge = getEffectsBridge();
        if (!effectsBridge.isInitialized()) {
          return {};
        }
        return effectsBridge.getColorGrading(clipId);
      },

      /**
       * Reset color grading to defaults for a clip
       */
      resetColorGrading: async (clipId: string): Promise<boolean> => {
        const { project, actionExecutor } = get();
        const effectsBridge = getEffectsBridge();
        if (!effectsBridge.isInitialized()) {
          console.error("EffectsBridge not initialized");
          return false;
        }

        const result = effectsBridge.resetColorGrading(clipId);
        if (!result.success) {
          console.error("Failed to reset color grading:", result.error);
          return false;
        }

        const action: Action = {
          type: "clip/setColorGrading",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, colorGrading: undefined },
        };
        const actionResult = await actionExecutor.execute(action, project);
        if (!actionResult.success) {
          console.error(
            "Failed to persist color grading reset:",
            actionResult.error?.message,
          );
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      // Audio effects actions

      /**
       * Add an audio effect to a clip
       * Apply audio effects
       */
      addAudioEffect: async (clipId: string, effect: Effect) => {
        const { project, actionExecutor } = get();
        const action: Action = {
          type: "audio/addEffect",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effect },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error("Failed to add audio effect:", result.error?.message);
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      /**
       * Update an audio effect on a clip
       * Update audio effect parameters
       */
      updateAudioEffect: async (
        clipId: string,
        effectId: string,
        params: Record<string, unknown>,
      ) => {
        const { project, actionExecutor } = get();
        const action: Action = {
          type: "audio/updateEffect",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId, params },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to update audio effect:",
            result.error?.message,
          );
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      /**
       * Remove an audio effect from a clip
       */
      removeAudioEffect: async (clipId: string, effectId: string) => {
        const { project, actionExecutor } = get();
        const action: Action = {
          type: "audio/removeEffect",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to remove audio effect:",
            result.error?.message,
          );
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      /**
       * Toggle an audio effect's enabled state
       */
      toggleAudioEffect: async (
        clipId: string,
        effectId: string,
        enabled: boolean,
      ) => {
        const { project, actionExecutor } = get();
        const action: Action = {
          type: "audio/toggleEffect",
          id: uuidv4(),
          timestamp: Date.now(),
          params: { clipId, effectId, enabled },
        };
        const result = await actionExecutor.execute(action, project);
        if (!result.success) {
          console.error(
            "Failed to toggle audio effect:",
            result.error?.message,
          );
          return false;
        }
        set({ project: { ...project, modifiedAt: Date.now() } });
        return true;
      },

      setAudioEffectPreviewBypass: (
        clipId: string,
        effectId: string,
        bypassed: boolean,
      ) => {
        const { project } = get();

        for (const track of project.timeline.tracks) {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex !== -1) {
            const clip = track.clips[clipIndex];
            const audioEffects = clip.audioEffects || [];
            const effectIndex = audioEffects.findIndex(
              (effect) => effect.id === effectId,
            );

            if (effectIndex === -1) {
              return false;
            }

            const effect = audioEffects[effectIndex];
            const nextMetadata = { ...(effect.metadata ?? {}) } as Record<
              string,
              unknown
            >;

            if (bypassed) {
              nextMetadata.previewBypass = true;
            } else {
              delete nextMetadata.previewBypass;
            }

            const updatedEffect = {
              ...effect,
              metadata:
                Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
            };

            const updatedAudioEffects = [...audioEffects];
            updatedAudioEffects[effectIndex] = updatedEffect;

            const updatedClip = {
              ...clip,
              audioEffects: updatedAudioEffects,
            };
            const updatedClips = [...track.clips];
            updatedClips[clipIndex] = updatedClip;
            const updatedTrack = { ...track, clips: updatedClips };
            const updatedTracks = project.timeline.tracks.map((candidate) =>
              candidate.id === track.id ? updatedTrack : candidate,
            );
            const updatedProject = {
              ...project,
              timeline: { ...project.timeline, tracks: updatedTracks },
              modifiedAt: Date.now(),
            };
            set({ project: updatedProject });
            return true;
          }
        }

        return false;
      },

      /**
       * Get all audio effects for a clip
       */
      getAudioEffects: (clipId: string) => {
        const { project } = get();

        for (const track of project.timeline.tracks) {
          const clip = track.clips.find((c) => c.id === clipId);
          if (clip) {
            return clip.audioEffects || [];
          }
        }
        return [];
      },

      setClipAudioDucking: (
        clipId: string,
        settings: AudioDuckingSettings,
        points: AutomationPoint[],
      ) => {
        const { project } = get();
        const updatedProject = updateProjectClip(project, clipId, (clip) => ({
          ...clip,
          automation: {
            ...(clip.automation ?? {}),
            volume: points.map((point) => ({ ...point })),
          },
          metadata: {
            ...(clip.metadata ?? {}),
            audioDucking: { ...settings },
          },
        }));

        if (!updatedProject) {
          return false;
        }

        set({ project: updatedProject });
        return true;
      },

      clearClipAudioDucking: (clipId: string) => {
        const { project } = get();
        const updatedProject = updateProjectClip(project, clipId, (clip) => {
          const nextMetadata = { ...(clip.metadata ?? {}) } as Record<
            string,
            unknown
          >;
          delete nextMetadata.audioDucking;

          const nextAutomation = { ...(clip.automation ?? {}) };
          delete nextAutomation.volume;

          return {
            ...clip,
            automation:
              Object.keys(nextAutomation).length > 0 ? nextAutomation : undefined,
            metadata:
              Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
          };
        });

        if (!updatedProject) {
          return false;
        }

        set({ project: updatedProject });
        return true;
      },

      /**
       * Update keyframes for a clip
       * Keyframe animation support
       */
      updateClipKeyframes: (clipId: string, keyframes: Keyframe[]) => {
        const { project } = get();

        for (const track of project.timeline.tracks) {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId);
          if (clipIndex !== -1) {
            const clip = track.clips[clipIndex];
            const priorKeyframes = clip.keyframes;
            const updatedClip = { ...clip, keyframes };
            const updatedClips = [...track.clips];
            updatedClips[clipIndex] = updatedClip;
            const updatedTrack = { ...track, clips: updatedClips };
            const updatedTracks = project.timeline.tracks.map((t) =>
              t.id === track.id ? updatedTrack : t,
            );
            const updatedProject = {
              ...project,
              timeline: { ...project.timeline, tracks: updatedTracks },
              modifiedAt: Date.now(),
            };
            set({
              project: updatedProject,
              clipRedoStack: [],
              templateRedoStack: [],
            });
            const actionId = uuidv4();
            get().actionExecutor.getHistory().push(
              {
                type: "keyframe/setAll",
                id: actionId,
                timestamp: Date.now(),
                params: { clipId, keyframes },
              },
              {
                type: "keyframe/setAll",
                id: `inverse-${actionId}`,
                timestamp: Date.now(),
                params: { clipId, keyframes: priorKeyframes },
              },
            );
            return true;
          }
        }
        return false;
      },
    };
  }),
);
