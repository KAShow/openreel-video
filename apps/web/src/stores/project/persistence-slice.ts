import type { StoreApi } from "zustand";
import type { Project } from "@openreel/core";
import {
  ActionExecutor,
  ActionHistory,
  normalizeGeneratedShaders,
  registerProjectGeneratedShaders,
} from "@openreel/core";
import { autoSaveManager, initializeAutoSave } from "../../services/auto-save";
import { loadProjectMedia } from "../../services/media-storage";
import { projectManager } from "../../services/project-manager";
import {
  createMissingMediaItem,
  restoreMediaItem,
} from "../../utils/media-recovery";
import { useEngineStore } from "../engine-store";
import { useSettingsStore } from "../settings-store";
import { useNotificationStore } from "../notification-store";
import type { ProjectState } from "./types";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type PersistenceSlice = Pick<
  ProjectState,
  | "initializeAutoSave"
  | "checkForRecovery"
  | "recoverFromAutoSave"
  | "forceSave"
  | "getFullProject"
>;

// Guards against re-running auto-save setup (which subscribes to the store and
// starts the interval) more than once across editor mount/unmount cycles, which
// would otherwise leak a store subscription and fire markDirty repeatedly.
let autoSaveInitialized = false;
let autoSaveInitializationPromise: Promise<void> | null = null;
let autoSaveNotificationsInitialized = false;

export function createPersistenceSlice(
  set: Set,
  get: Get,
  subscribeToProject: (listener: () => void) => void,
): PersistenceSlice {
  return {
    initializeAutoSave: async () => {
      if (autoSaveInitialized) return;
      if (autoSaveInitializationPromise) return autoSaveInitializationPromise;
      const initialize = async () => {
        if (!autoSaveNotificationsInitialized) {
          autoSaveNotificationsInitialized = true;
          let failureNotificationId: string | null = null;
          autoSaveManager.on("error", () => {
            if (failureNotificationId) return;
            failureNotificationId = useNotificationStore.getState().addNotification({
              type: "warning",
              title: "Automatic saving is unavailable",
              message: "Your edits are still in this tab. Save a project copy and keep the original media files before closing it.",
              duration: 0,
            });
          });
          autoSaveManager.on("saved", () => {
            if (failureNotificationId) {
              useNotificationStore.getState().removeNotification(failureNotificationId);
              failureNotificationId = null;
            }
          });
        }
        await initializeAutoSave();
        if (!autoSaveManager.isInitialized()) return;
        const applyAutoSaveSettings = () => {
          const { autoSave, autoSaveInterval } = useSettingsStore.getState();
          autoSaveManager.updateConfig({
            enabled: autoSave,
            interval: autoSaveInterval * 60_000,
          });
        };
        applyAutoSaveSettings();
        useSettingsStore.subscribe((state, previous) => {
          if (
            state.autoSave !== previous.autoSave ||
            state.autoSaveInterval !== previous.autoSaveInterval
          ) {
            applyAutoSaveSettings();
          }
        });
        autoSaveManager.start(() => {
          const { project } = get();
          const titleEngine = useEngineStore.getState().getTitleEngine();
          const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

          return {
            ...project,
            textClips: titleEngine?.getAllTextClips() || [],
            shapeClips: graphicsEngine?.getAllShapeClips() || [],
            svgClips: graphicsEngine?.getAllSVGClips() || [],
            stickerClips: graphicsEngine?.getAllStickerClips() || [],
          };
        });

        // Subscribe to project state changes to mark as dirty for auto-save
        // Uses Zustand's subscribeWithSelector middleware to detect changes to project object only
        // Trigger auto-save when any project field changes (timeline, media, settings, etc.)
        subscribeToProject(() => {
          autoSaveManager.markDirty(get().getFullProject());
        });
        autoSaveInitialized = true;
      };
      autoSaveInitializationPromise = initialize().finally(() => {
        autoSaveInitializationPromise = null;
      });
      return autoSaveInitializationPromise;
    },

    checkForRecovery: async () => {
      const { project } = get();
      return autoSaveManager.checkForRecovery(project.id);
    },

    recoverFromAutoSave: async (saveId: string) => {
      const recoveredProject = await autoSaveManager.recover(saveId);
      if (recoveredProject) {
        const storedMedia = await loadProjectMedia(recoveredProject.id);
        const blobMap = new Map(storedMedia.map((m) => [m.id, m.blob]));

        const restoredItems = await Promise.all(
          recoveredProject.mediaLibrary.items.map(async (item) => {
            try {
              return await restoreMediaItem(item, blobMap.get(item.id));
            } catch (error) {
              console.warn(
                `[ProjectStore] Failed to restore media ${item.name}; marking it missing:`,
                error,
              );
              return createMissingMediaItem(item);
            }
          }),
        );

        const projectWithMedia: Project = {
          ...recoveredProject,
          generatedShaders: normalizeGeneratedShaders(
            recoveredProject.generatedShaders,
          ),
          mediaLibrary: {
            ...recoveredProject.mediaLibrary,
            items: restoredItems,
          },
        };

        const titleEngine = useEngineStore.getState().getTitleEngine();
        const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

        if (titleEngine && recoveredProject.textClips) {
          titleEngine.loadTextClips(recoveredProject.textClips);
        }
        if (graphicsEngine) {
          if (recoveredProject.shapeClips) {
            graphicsEngine.loadShapeClips(recoveredProject.shapeClips);
          }
          if (recoveredProject.svgClips) {
            graphicsEngine.loadSVGClips(recoveredProject.svgClips);
          }
          if (recoveredProject.stickerClips) {
            graphicsEngine.loadStickerClips(recoveredProject.stickerClips);
          }
        }

        const newHistory = new ActionHistory();
        const newExecutor = new ActionExecutor(newHistory);

        registerProjectGeneratedShaders(projectWithMedia);

        set({
          project: projectWithMedia,
          hasOpenProject: true,
          actionHistory: newHistory,
          actionExecutor: newExecutor,
          clipUndoStack: [],
          clipRedoStack: [],
          templateUndoStack: [],
          templateRedoStack: [],
          error: null,
        });

        await projectManager.addToRecent(projectWithMedia);
        return true;
      }
      return false;
    },

    forceSave: async () => {
      const { project } = get();
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

      const fullProject: Project = {
        ...project,
        textClips: titleEngine?.getAllTextClips() || [],
        shapeClips: graphicsEngine?.getAllShapeClips() || [],
        svgClips: graphicsEngine?.getAllSVGClips() || [],
        stickerClips: graphicsEngine?.getAllStickerClips() || [],
      };
      await autoSaveManager.forceSave(fullProject);
    },

    getFullProject: (): Project => {
      const { project } = get();
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

      return {
        ...project,
        textClips: titleEngine?.getAllTextClips() || [],
        shapeClips: graphicsEngine?.getAllShapeClips() || [],
        svgClips: graphicsEngine?.getAllSVGClips() || [],
        stickerClips: graphicsEngine?.getAllStickerClips() || [],
      };
    },
  };
}
