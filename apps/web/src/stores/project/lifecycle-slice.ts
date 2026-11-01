import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import type { Action, Project, ProjectSettings } from "@openreel/core";
import {
  ActionExecutor,
  ActionHistory,
  normalizeGeneratedShaders,
  normalizeProjectMotionFields,
  registerProjectGeneratedShaders,
} from "@openreel/core";
import { useTimelineStore } from "../timeline-store";
import { useUIStore } from "../ui-store";
import { useEngineStore } from "../engine-store";
import {
  loadDirectoryHandle,
  loadFileHandle,
} from "../../services/media-storage";
import { syncProjectEffectsBridge } from "./effects-sync";
import { syncProjectTransitionsBridge } from "./transitions-sync";
import { calculateTimelineDuration, createEmptyProject } from "./index";
import type { ProjectState } from "./types";

type Get = StoreApi<ProjectState>["getState"];
type Set = StoreApi<ProjectState>["setState"];

export type LifecycleSlice = Pick<
  ProjectState,
  | "createNewProject"
  | "loadProject"
  | "renameProject"
  | "updateSettings"
  | "setCanvasBackground"
>;

export function createLifecycleSlice(set: Set, get: Get): LifecycleSlice {
  return {
    createNewProject: (
      name?: string,
      settings?: Partial<ProjectSettings>,
    ) => {
      const newHistory = new ActionHistory();
      const newExecutor = new ActionExecutor(newHistory);
      const previousProject = get().project;
      const nextProject = createEmptyProject(name, settings);

      useTimelineStore.getState().stop();
      useTimelineStore.getState().seekToStart();
      useTimelineStore.getState().clearLoopRange();
      useTimelineStore.getState().setScrollX(0);
      useTimelineStore.getState().setScrollY(0);
      useUIStore.getState().clearSelection();

      syncProjectEffectsBridge(nextProject, previousProject);
      syncProjectTransitionsBridge(nextProject, previousProject);

      registerProjectGeneratedShaders(nextProject);

      useEngineStore.getState().getTitleEngine()?.loadTextClips([]);
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();
      graphicsEngine?.loadShapeClips([]);
      graphicsEngine?.loadSVGClips([]);
      graphicsEngine?.loadStickerClips([]);

      set({
        project: nextProject,
        hasOpenProject: true,
        actionHistory: newHistory,
        actionExecutor: newExecutor,
        clipUndoStack: [],
        clipRedoStack: [],
        templateUndoStack: [],
        templateRedoStack: [],
        clipboard: [],
        lastPastedClipIds: [],
        error: null,
      });
    },

    loadProject: (incomingProject: Project) => {
      const motionNormalized = normalizeProjectMotionFields(incomingProject);
      const project: Project = {
        ...motionNormalized,
        generatedShaders: normalizeGeneratedShaders(
          motionNormalized.generatedShaders,
        ),
      };
      const previousProject = get().project;
      const titleEngine = useEngineStore.getState().getTitleEngine();
      const graphicsEngine = useEngineStore.getState().getGraphicsEngine();

      titleEngine?.loadTextClips(project.textClips ?? []);
      if (graphicsEngine) {
        graphicsEngine.loadShapeClips(project.shapeClips ?? []);
        graphicsEngine.loadSVGClips(project.svgClips ?? []);
        graphicsEngine.loadStickerClips(project.stickerClips ?? []);
      }

      const newHistory = new ActionHistory();
      const newExecutor = new ActionExecutor(newHistory);

      // Fix legacy projects where timeline.duration was never persisted
      const computedDuration = calculateTimelineDuration(project);
      const fixedProject = computedDuration !== project.timeline.duration
        ? { ...project, timeline: { ...project.timeline, duration: computedDuration } }
        : project;

      syncProjectEffectsBridge(fixedProject, previousProject);
      syncProjectTransitionsBridge(fixedProject, previousProject);

      registerProjectGeneratedShaders(fixedProject);

      set({
        project: fixedProject,
        hasOpenProject: true,
        actionHistory: newHistory,
        actionExecutor: newExecutor,
        clipUndoStack: [],
        clipRedoStack: [],
        templateUndoStack: [],
        templateRedoStack: [],
        clipboard: [],
        lastPastedClipIds: [],
        error: null,
      });

      // Auto-restore placeholder assets from saved FileSystemFileHandles (same machine)
      const placeholders = fixedProject.mediaLibrary.items.filter(
        (item) => item.isPlaceholder && item.sourceFile,
      );
      if (placeholders.length > 0 && "FileSystemFileHandle" in window) {
        (async () => {
          let restored = 0;
          const stillMissing: typeof placeholders = [];

          // Tier 1: try individual file handles (follow file across folder moves)
          for (const item of placeholders) {
            if (!item.sourceFile) continue;
            try {
              const handle = await loadFileHandle(item.sourceFile.name, item.sourceFile.size);
              if (!handle) { stillMissing.push(item); continue; }
              const file = await handle.getFile();
              await get().replaceMediaAsset(item.id, file, item.sourceFile.folder);
              restored++;
            } catch {
              stillMissing.push(item); // stale handle
            }
          }

          // Tier 2: scan the stored relink folder for files not found via handle
          if (stillMissing.length > 0) {
            try {
              const dirInfo = await loadDirectoryHandle(fixedProject.id);
              if (dirInfo) {
                const fileMap = new Map<string, { file: File; folder: string }>();
                const entries = (dirInfo.handle as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries();
                for await (const [, fh] of entries) {
                  if ((fh as FileSystemHandle).kind === "file") {
                    const f = await (fh as FileSystemFileHandle).getFile();
                    fileMap.set(`${f.name.toLowerCase()}:${f.size}`, { file: f, folder: dirInfo.folderName });
                  }
                }
                for (const item of stillMissing) {
                  if (!item.sourceFile) continue;
                  const entry = fileMap.get(`${item.sourceFile.name.toLowerCase()}:${item.sourceFile.size}`);
                  if (entry) {
                    try {
                      await get().replaceMediaAsset(item.id, entry.file, entry.folder);
                      restored++;
                    } catch { /* skip */ }
                  }
                }
              }
            } catch { /* dir handle stale or unavailable */ }
          }

          if (restored > 0) {
            console.warn(`[ProjectStore] Auto-restored ${restored} asset(s) from file handles`);
          }
        })();
      }
    },

    // Rename project
    renameProject: async (name: string) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "project/rename",
        id: uuidv4(),
        timestamp: Date.now(),
        params: { name },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    // Update project settings
    updateSettings: async (settings: Partial<ProjectSettings>) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "project/updateSettings",
        id: uuidv4(),
        timestamp: Date.now(),
        params: settings,
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },

    setCanvasBackground: async (mode, color) => {
      const { project, actionExecutor } = get();
      const action: Action = {
        type: "project/setCanvasBackground",
        id: uuidv4(),
        timestamp: Date.now(),
        params: {
          backgroundFillMode: mode,
          layoutBackgroundColor: color,
        },
      };
      const result = await actionExecutor.execute(action, project);
      if (result.success) {
        set({ project: { ...project } });
      }
      return result;
    },
  };
}
