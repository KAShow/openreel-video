import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action, MotionComposition, Project } from "@openreel/core";
import {
  getMotionPreset,
  motionEngine,
  reflowMotionAutoLayoutGroups,
} from "@openreel/core";
import { planCreationObjectEdit } from "../../motion/creation-object-editing";
import { planCreationCameraEdit } from "../../motion/creation-camera-editing";
import { planRecoverMotionScene3DLayer } from "../../motion/creation-recovery";
import { calculateTimelineDuration } from "./index";
import { cloneProjectForEdit } from "./clone-project-for-edit";
import type { ProjectState } from "./types";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type MotionSlice = Pick<
  ProjectState,
  | "createMotionComposition"
  | "upsertMotionComposition"
  | "updateMotionCompositionPreview"
  | "commitMotionCompositionGesture"
  | "updateCreationObject"
  | "updateCreationCamera"
  | "recoverMotionScene3DLayer"
  | "insertMotionInstance"
  | "removeMotionInstance"
  | "getMotionComposition"
  | "getMotionInstance"
>;

function motionCompositionsEqual(
  a: MotionComposition,
  b: MotionComposition,
): boolean {
  const strip = ({ modifiedAt: _modifiedAt, ...rest }: MotionComposition) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

export function createMotionSlice(set: Set, get: Get): MotionSlice {
  return {
    createMotionComposition: async (name?: string, presetId?: string) => {
      const { project, actionExecutor } = get();
      const preset = presetId ? getMotionPreset(presetId) : undefined;
      const composition = preset
        ? { ...preset.create(), name: name ?? preset.name }
        : motionEngine.createStarterComposition({
            name,
            width: project.settings.width,
            height: project.settings.height,
            frameRate: project.settings.frameRate,
          });

      const projectCopy = cloneProjectForEdit(project);
      const action: Action = {
        type: "motion/createComposition",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { composition },
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (!result.success) {
        console.error("Failed to create motion composition:", result.error?.message);
        return null;
      }

      set({ project: { ...projectCopy, modifiedAt: Date.now() } });
      return composition;
    },

    upsertMotionComposition: async (composition: MotionComposition) => {
      const { project, actionExecutor } = get();
      const projectCopy = cloneProjectForEdit(project);
      const reflowed = reflowMotionAutoLayoutGroups(composition);
      const action: Action = {
        type: "motion/upsertComposition",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { composition: { ...reflowed, modifiedAt: Date.now() } },
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (result.success) {
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
      }
      return result;
    },

    updateMotionCompositionPreview: (composition: MotionComposition) => {
      if (typeof composition.id !== "string" || composition.id.length === 0) {
        return;
      }
      const { project } = get();
      const reflowed = reflowMotionAutoLayoutGroups(composition);
      const previewComposition = { ...reflowed, modifiedAt: Date.now() };
      const existing = project.motionCompositions ?? [];
      const nextCompositions = existing.some(
        (candidate) => candidate.id === previewComposition.id,
      )
        ? existing.map((candidate) =>
            candidate.id === previewComposition.id
              ? previewComposition
              : candidate,
          )
        : [...existing, previewComposition];
      set({
        project: {
          ...project,
          motionCompositions: nextCompositions,
          modifiedAt: Date.now(),
        },
      });
    },

    commitMotionCompositionGesture: async (
      before: MotionComposition,
      after: MotionComposition,
    ) => {
      if (typeof after.id !== "string" || after.id.length === 0) {
        return null;
      }
      if (before.id !== after.id) {
        return null;
      }
      const reflowedBefore = reflowMotionAutoLayoutGroups(before);
      const reflowedAfter = reflowMotionAutoLayoutGroups(after);
      if (motionCompositionsEqual(reflowedBefore, reflowedAfter)) {
        return null;
      }
      const { project, actionExecutor } = get();
      const cloned = cloneProjectForEdit(project);
      const existing = cloned.motionCompositions ?? [];
      const projectBefore: Project = {
        ...cloned,
        motionCompositions: existing.some(
          (candidate) => candidate.id === reflowedBefore.id,
        )
          ? existing.map((candidate) =>
              candidate.id === reflowedBefore.id ? reflowedBefore : candidate,
            )
          : [...existing, reflowedBefore],
      };
      const action: Action = {
        type: "motion/upsertComposition",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { composition: { ...reflowedAfter, modifiedAt: Date.now() } },
      };
      const result = await actionExecutor.execute(action, projectBefore);
      if (result.success) {
        set({ project: { ...projectBefore, modifiedAt: Date.now() } });
      }
      return result;
    },

    updateCreationObject: async (sceneId, objectId, patch) => {
      const { project, actionExecutor } = get();
      const now = Date.now();
      const plan = planCreationObjectEdit(project, sceneId, objectId, patch, now);
      if ("error" in plan) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAMS",
            message: plan.error,
          },
        };
      }

      const projectCopy = cloneProjectForEdit(project);
      for (const operation of plan.operations) {
        const action: Action = {
          type: "creation/applyOperation",
          id: uuidv4(),
          timestamp: now,
          params: { operation },
        };
        const result = await actionExecutor.execute(action, projectCopy);
        if (!result.success) return result;
      }

      if (plan.composition) {
        const action: Action = {
          type: "motion/upsertComposition",
          id: uuidv4(),
          timestamp: now,
          params: { composition: plan.composition },
        };
        const result = await actionExecutor.execute(action, projectCopy);
        if (!result.success) return result;
      }

      set({ project: { ...projectCopy, modifiedAt: now } });
      return { success: true, actionId: `creation-object-edit-${now}` };
    },

    updateCreationCamera: async (sceneId, cameraId, patch) => {
      const { project, actionExecutor } = get();
      const now = Date.now();
      const plan = planCreationCameraEdit(project, sceneId, cameraId, patch, now);
      if ("error" in plan) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAMS",
            message: plan.error,
          },
        };
      }

      const projectCopy = cloneProjectForEdit(project);
      for (const operation of plan.operations) {
        const action: Action = {
          type: "creation/applyOperation",
          id: uuidv4(),
          timestamp: now,
          params: { operation },
        };
        const result = await actionExecutor.execute(action, projectCopy);
        if (!result.success) return result;
      }

      if (plan.composition) {
        const action: Action = {
          type: "motion/upsertComposition",
          id: uuidv4(),
          timestamp: now,
          params: { composition: plan.composition },
        };
        const result = await actionExecutor.execute(action, projectCopy);
        if (!result.success) return result;
      }

      set({ project: { ...projectCopy, modifiedAt: now } });
      return { success: true, actionId: `creation-camera-edit-${now}` };
    },

    recoverMotionScene3DLayer: async (compositionId, layerId) => {
      const { project, actionExecutor } = get();
      const now = Date.now();
      const plan = planRecoverMotionScene3DLayer(
        project,
        compositionId,
        layerId,
        now,
      );
      if ("error" in plan) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAMS",
            message: plan.error,
          },
        };
      }

      const projectCopy = cloneProjectForEdit(project);
      for (const operation of plan.operations) {
        const action: Action = {
          type: "creation/applyOperation",
          id: uuidv4(),
          timestamp: now,
          params: { operation },
        };
        const result = await actionExecutor.execute(action, projectCopy);
        if (!result.success) return result;
      }

      set({ project: { ...projectCopy, modifiedAt: now } });
      return { success: true, actionId: `creation-recover-scene3d-${now}` };
    },

    insertMotionInstance: async (compositionId, placement = {}) => {
      const { project, actionExecutor } = get();
      const composition = (project.motionCompositions ?? []).find(
        (candidate) => candidate.id === compositionId,
      );
      if (!composition) {
        return null;
      }

      const startTime =
        placement.startTime ?? calculateTimelineDuration(project);
      const instance = motionEngine.createInstance(composition, {
        trackId: placement.trackId,
        startTime,
        duration: placement.duration,
        name: placement.name,
      });

      const projectCopy = cloneProjectForEdit(project);
      const action: Action = {
        type: "motion/insertInstance",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { instance },
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (!result.success) {
        console.error("Failed to insert motion instance:", result.error?.message);
        return null;
      }

      const inserted = (projectCopy.motionInstances ?? []).find(
        (candidate) => candidate.id === instance.id,
      );
      set({ project: { ...projectCopy, modifiedAt: Date.now() } });
      return inserted ?? instance;
    },

    removeMotionInstance: async (instanceId: string) => {
      const { project, actionExecutor } = get();
      const projectCopy = cloneProjectForEdit(project);
      const action: Action = {
        type: "motion/removeInstance",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { instanceId },
      };
      const result = await actionExecutor.execute(action, projectCopy);
      if (result.success) {
        set({ project: { ...projectCopy, modifiedAt: Date.now() } });
      }
      return result;
    },

    getMotionComposition: (compositionId: string) =>
      (get().project.motionCompositions ?? []).find(
        (composition) => composition.id === compositionId,
      ),

    getMotionInstance: (instanceId: string) =>
      (get().project.motionInstances ?? []).find(
        (instance) => instance.id === instanceId,
      ),
  };
}
