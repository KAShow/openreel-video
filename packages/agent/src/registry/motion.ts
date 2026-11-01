import {
  RegisteredTool,
  applyMotionAction,
  fail,
  genId,
  getMotionComposition,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  regenerateMotionLayerNestedIds,
  str,
} from "./shared";
import {
  type MotionComposition,
} from "@openreel/core/motion/types";
import {
  duplicateMotionLayers,
} from "@openreel/core/motion/motion-layer-commands";
import {
  motionEngine,
} from "@openreel/core/motion/motion-engine";

export const motionTools: RegisteredTool[] = [
  {
    name: "create_motion_composition",
    domain: "motion",
    title: "Create motion composition",
    description:
      "Create a standalone Motion Creator composition with starter layers. Useful for intros, lower thirds, ads, app demos, and reusable scene graphics.",
    inputSchema: obj({
      name: str,
      width: num,
      height: num,
      frameRate: num,
      duration: num,
      backgroundColor: str,
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const composition = motionEngine.createStarterComposition({
        name: typeof args.name === "string" ? args.name : undefined,
        width: optionalNumber(args.width) ?? project.settings.width,
        height: optionalNumber(args.height) ?? project.settings.height,
        frameRate: optionalNumber(args.frameRate) ?? project.settings.frameRate,
        duration: optionalNumber(args.duration),
        backgroundColor:
          typeof args.backgroundColor === "string"
            ? args.backgroundColor
            : undefined,
      });
      const result = await applyMotionAction(host, "motion/createComposition", {
        composition,
      });
      return result.ok
        ? ok(`Created motion composition "${composition.name}"`, {
            compositionId: composition.id,
            composition,
          })
        : result;
    },
  },
  {
    name: "delete_motion_composition",
    domain: "motion",
    title: "Delete motion composition",
    description:
      "Delete a Motion Creator composition by compositionId. Destructive — removes the composition and any editor instances of it. Use to clean up throwaway or superseded comps.",
    inputSchema: obj({ compositionId: str }, ["compositionId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const result = await applyMotionAction(host, "motion/removeComposition", {
        compositionId: composition.id,
      });
      return result.ok
        ? ok(`Deleted motion composition "${composition.name}"`, {
            compositionId: composition.id,
          })
        : result;
    },
  },
  {
    name: "duplicate_motion_composition",
    domain: "motion",
    title: "Duplicate motion composition",
    description:
      "Deep-clone a Motion Creator composition into a new standalone composition with fresh ids for every layer, keyframe, mask, effect, text animator, expression, marker, light, and variable (no shared references); keyframe and expression property references to remapped mask/effect ids are rewritten to match. Optional name (defaults to '<name> Copy'). Returns the new compositionId.",
    inputSchema: obj({ compositionId: str, name: str }, ["compositionId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const now = Date.now();
      const topLevelIds = composition.layers
        .filter((layer) => !layer.parentId)
        .map((layer) => layer.id);
      const { composition: withDuplicates, duplicatedLayerIds } = duplicateMotionLayers(
        composition,
        topLevelIds,
        {
          idFactory: () => genId(),
          keyframeIdFactory: () => genId(),
          offset: { x: 0, y: 0 },
        },
      );
      const clonedIdSet = new Set(duplicatedLayerIds);
      const collectDescendantIds = (layerId: string) => {
        const layer = withDuplicates.layers.find((entry) => entry.id === layerId);
        if (layer && layer.type === "group") {
          for (const childId of layer.children) {
            if (!clonedIdSet.has(childId)) {
              clonedIdSet.add(childId);
              collectDescendantIds(childId);
            }
          }
        }
      };
      for (const layerId of duplicatedLayerIds) collectDescendantIds(layerId);
      const clonedLayers = withDuplicates.layers
        .filter((layer) => clonedIdSet.has(layer.id))
        .map((layer) => regenerateMotionLayerNestedIds(layer, () => genId()));
      const newCompositionId = genId();
      const duplicated: MotionComposition = {
        ...composition,
        id: newCompositionId,
        name: optionalString(args.name) ?? `${composition.name} Copy`,
        layers: clonedLayers,
        markers: composition.markers.map((marker) => ({ ...marker, id: genId() })),
        lights: composition.lights?.map((light) => ({ ...light, id: genId() })),
        variables: composition.variables.map((variable) => ({
          ...variable,
          id: genId(),
        })),
        createdAt: now,
        modifiedAt: now,
      };
      const result = await applyMotionAction(host, "motion/createComposition", {
        composition: duplicated,
      });
      return result.ok
        ? ok(`Duplicated motion composition "${duplicated.name}"`, {
            compositionId: newCompositionId,
            sourceCompositionId: composition.id,
            layerCount: clonedLayers.length,
          })
        : result;
    },
  }
];
