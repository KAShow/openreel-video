import type { StoreApi } from "zustand";
import type { EditingTemplatePrimitive, Project } from "@openreel/core";
import {
  getBuiltInEditingTemplate,
  getBuiltInEditingTemplates,
} from "@openreel/core";
import type {
  EditingTemplateApplicationState,
  EditingTemplateHistoryEntry,
  ProjectState,
} from "./types";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

type AppliedTemplateResult = {
  project: Project;
  applicationState: EditingTemplateApplicationState;
};

export interface EditingTemplateSliceDependencies {
  applyEditingTemplateApplicationToProject: (
    project: Project,
    templateId: string,
    clipId: string,
    overrides?: Record<string, EditingTemplatePrimitive>,
    options?: {
      applicationId?: string;
      appliedAt?: number;
      preferredTrackIds?: Partial<Record<"text" | "graphics", string>>;
      preservedTrackSnapshots?: EditingTemplateApplicationState["trackSnapshots"];
    },
  ) => AppliedTemplateResult | null;
  findEditingTemplateHistoryEntry: (
    clipId: string,
    applicationId: string,
  ) => EditingTemplateHistoryEntry | undefined;
  getEditingTemplateApplicationState: (
    entry: EditingTemplateHistoryEntry,
  ) => EditingTemplateApplicationState;
  getEditingTemplatePreferredTrackIds: (
    applicationState: EditingTemplateApplicationState,
  ) => Partial<Record<"text" | "graphics", string>>;
  removeEditingTemplateApplicationStateFromProject: (
    project: Project,
    applicationState: EditingTemplateApplicationState,
    removeEmptyTracks?: boolean,
  ) => Project;
  restoreEditingTemplateApplicationState: (
    project: Project,
    applicationState: EditingTemplateApplicationState,
  ) => Project | null;
  hasEditingTemplateArtifacts: (
    project: Project,
    ownerClipId: string,
    applicationId: string,
  ) => boolean;
  removeEditingTemplateApplicationFromProject: (
    project: Project,
    ownerClipId: string,
    applicationId: string,
    trackIdsToRemoveIfEmpty?: string[],
  ) => Project;
}

export type EditingTemplateSlice = Pick<
  ProjectState,
  | "getEditingTemplates"
  | "getEditingTemplate"
  | "applyEditingTemplate"
  | "updateEditingTemplateApplication"
  | "removeEditingTemplateApplication"
>;

export function createEditingTemplateSlice(
  set: Set,
  get: Get,
  dependencies: EditingTemplateSliceDependencies,
): EditingTemplateSlice {
  const {
    applyEditingTemplateApplicationToProject,
    findEditingTemplateHistoryEntry,
    getEditingTemplateApplicationState,
    getEditingTemplatePreferredTrackIds,
    removeEditingTemplateApplicationStateFromProject,
    restoreEditingTemplateApplicationState,
    hasEditingTemplateArtifacts,
    removeEditingTemplateApplicationFromProject,
  } = dependencies;

  return {
    getEditingTemplates: () => [...getBuiltInEditingTemplates()],

    getEditingTemplate: (templateId: string) =>
      getBuiltInEditingTemplate(templateId),

    applyEditingTemplate: (
      templateId: string,
      clipId: string,
      overrides: Record<string, EditingTemplatePrimitive> = {},
    ) => {
      const { project, templateUndoStack } = get();
      const applied = applyEditingTemplateApplicationToProject(
        project,
        templateId,
        clipId,
        overrides,
      );

      if (!applied) {
        return null;
      }

      const historyEntry: EditingTemplateHistoryEntry = {
        type: "editing-template",
        mode: "apply",
        timestamp: Date.now(),
        description: `Apply ${applied.applicationState.appliedTemplate.name}`,
        ...applied.applicationState,
      };

      set({
        project: applied.project,
        templateUndoStack: [...templateUndoStack, historyEntry],
        templateRedoStack: [],
      });

      return applied.applicationState.applicationId;
    },

    updateEditingTemplateApplication: (
      clipId: string,
      applicationId: string,
      overrides: Record<string, EditingTemplatePrimitive> = {},
    ) => {
      const { project, templateUndoStack } = get();
      const matchingEntry = findEditingTemplateHistoryEntry(clipId, applicationId);
      if (!matchingEntry) {
        return false;
      }

      const previousState = getEditingTemplateApplicationState(matchingEntry);
      const projectWithoutCurrent = removeEditingTemplateApplicationStateFromProject(
        project,
        previousState,
        false,
      );
      const updated = applyEditingTemplateApplicationToProject(
        projectWithoutCurrent,
        previousState.templateId,
        clipId,
        overrides,
        {
          applicationId,
          appliedAt: previousState.appliedTemplate.appliedAt,
          preferredTrackIds: getEditingTemplatePreferredTrackIds(previousState),
          preservedTrackSnapshots: previousState.trackSnapshots,
        },
      );

      if (!updated) {
        const restoredProject = restoreEditingTemplateApplicationState(
          projectWithoutCurrent,
          previousState,
        );

        if (restoredProject) {
          set({ project: restoredProject });
        }

        return false;
      }

      const historyEntry: EditingTemplateHistoryEntry = {
        type: "editing-template",
        mode: "update",
        timestamp: Date.now(),
        description: `Update ${updated.applicationState.appliedTemplate.name}`,
        previousState,
        ...updated.applicationState,
      };

      set({
        project: updated.project,
        templateUndoStack: [...templateUndoStack, historyEntry],
        templateRedoStack: [],
      });

      return true;
    },

    removeEditingTemplateApplication: (
      clipId: string,
      applicationId: string,
    ) => {
      const {
        project,
        templateUndoStack,
        templateRedoStack,
      } = get();

      if (!hasEditingTemplateArtifacts(project, clipId, applicationId)) {
        return false;
      }

      const matchingEntry = findEditingTemplateHistoryEntry(clipId, applicationId);

      const updatedProject = removeEditingTemplateApplicationFromProject(
        project,
        clipId,
        applicationId,
        matchingEntry?.trackSnapshots.map((snapshot) => snapshot.track.id) || [],
      );

      set({
        project: updatedProject,
        templateUndoStack: templateUndoStack.filter(
          (entry) =>
            !(entry.ownerClipId === clipId && entry.applicationId === applicationId),
        ),
        templateRedoStack: templateRedoStack.filter(
          (entry) =>
            !(entry.ownerClipId === clipId && entry.applicationId === applicationId),
        ),
      });

      return true;
    },
  };
}
