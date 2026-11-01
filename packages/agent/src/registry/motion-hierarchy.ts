import {
  RegisteredTool,
  bool,
  commitMotionComposition,
  fail,
  getMotionComposition,
  getMotionLayer,
  obj,
  ok,
  optionalString,
  str,
} from "./shared";
import {
  canParentMotionLayer,
  setMotionLayerParent,
} from "@openreel/core/motion/motion-hierarchy";
import {
  setMotionLayersLocked,
  setMotionLayersVisible,
} from "@openreel/core/motion/motion-layer-commands";

export const motionHierarchyTools: RegisteredTool[] = [
  {
    name: "set_motion_layer_parent",
    domain: "motion",
    title: "Set motion layer parent",
    description:
      "Parent one layer to another so it inherits the parent's transform. Pass parentId=null (or omit) to unparent. Cyclic parenting is rejected.",
    inputSchema: obj({ compositionId: str, layerId: str, parentId: str }, [
      "compositionId",
      "layerId",
    ]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const parentId = optionalString(args.parentId) ?? null;
      if (parentId !== null && !getMotionLayer(composition, parentId)) {
        return fail("Parent layer not found", "NOT_FOUND");
      }
      if (!canParentMotionLayer(composition, layer.id, parentId)) {
        return fail("Parenting would create a cycle", "INVALID_PARAMS");
      }
      const nextComposition = setMotionLayerParent(composition, layer.id, parentId);
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(parentId ? "Parented motion layer" : "Unparented motion layer", {
            compositionId: composition.id,
            layerId: layer.id,
            parentId,
          })
        : result;
    },
  },
  {
    name: "set_motion_layer_visibility",
    domain: "motion",
    title: "Set motion layer visibility",
    description: "Show or hide a motion layer.",
    inputSchema: obj({ compositionId: str, layerId: str, visible: bool }, [
      "compositionId",
      "layerId",
      "visible",
    ]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (typeof args.visible !== "boolean") {
        return fail("visible must be a boolean", "INVALID_PARAMS");
      }
      const nextComposition = setMotionLayersVisible(composition, [layer.id], args.visible);
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`${args.visible ? "Showed" : "Hid"} motion layer`, {
            compositionId: composition.id,
            layerId: layer.id,
          })
        : result;
    },
  },
  {
    name: "set_motion_layer_lock",
    domain: "motion",
    title: "Set motion layer lock",
    description: "Lock or unlock a motion layer.",
    inputSchema: obj({ compositionId: str, layerId: str, locked: bool }, [
      "compositionId",
      "layerId",
      "locked",
    ]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (typeof args.locked !== "boolean") {
        return fail("locked must be a boolean", "INVALID_PARAMS");
      }
      const nextComposition = setMotionLayersLocked(composition, [layer.id], args.locked);
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`${args.locked ? "Locked" : "Unlocked"} motion layer`, {
            compositionId: composition.id,
            layerId: layer.id,
          })
        : result;
    },
  }
];
