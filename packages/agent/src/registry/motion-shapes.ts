import {
  CONTENTS_KEYFRAME_GRAMMAR,
  MOTION_SHAPE_MERGE_MODES,
  MOTION_SHAPE_MODIFIER_TYPES,
  MOTION_SHAPE_OPERATOR_TYPES,
  MOTION_SHAPE_TYPES,
  RegisteredTool,
  asRecord,
  bool,
  commitMotionComposition,
  fail,
  genId,
  getMotionComposition,
  getMotionLayer,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  parseMotionShapeGroupTransform,
  replaceMotionLayer,
  requireShapeLayer,
  resolveShapePathData,
  str,
  synthesizeSourceShapeGroup,
  vec2FromObject,
} from "./shared";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionComposition,
  type MotionShapeGroupItem,
  type MotionShapeGroupTransform,
  type MotionShapeItem,
  type MotionShapeLayer,
  type MotionShapeMergeMode,
  type MotionShapeModifier,
  type MotionShapeModifierType,
  type MotionShapeOperator,
  type MotionVector2,
} from "@openreel/core/motion/types";
import {
  DEFAULT_SHAPE_STYLE,
  type ShapeStyle,
  type ShapeType,
} from "@openreel/core/graphics/types";
import {
  MOTION_SHAPE_MODIFIER_PROPERTY_NAMES,
  type MotionShapeModifierPropertyName,
  addMotionShapeModifier,
  createMotionShapeModifier,
  getMotionShapeModifierPropertyDescriptors,
  removeMotionShapeModifier,
  setMotionShapeModifierPropertyValue,
  updateMotionShapeModifier,
} from "@openreel/core/motion/motion-shape-modifiers";
import {
  addShapeItem,
  createShapeGroupItem,
  createShapePathItem,
  findShapeItem,
  hasExplicitShapeContents,
  materializeShapeContents,
  moveShapeItem,
  removeShapeItem,
  updateShapeItem,
} from "@openreel/core/motion/motion-shape-contents";
import {
  buildMotionShapeStyle,
} from "@openreel/core/motion/motion-ui-builder";

export const motionShapeTools: RegisteredTool[] = [
  {
    name: "add_motion_shape_modifier",
    domain: "motion",
    title: "Add motion shape modifier",
    description:
      "Add a shape modifier (trim-paths|repeater|zig-zag|round-corners|wiggle-paths|offset-paths|pucker-bloat|twist) to a shape layer. One modifier per type. Returns the modifierId.",
    inputSchema: obj({ compositionId: str, layerId: str, modifierType: str }, [
      "compositionId",
      "layerId",
      "modifierType",
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
      if (layer.type !== "shape") {
        return fail("Shape modifiers require a shape layer", "INVALID_PARAMS");
      }
      const modifierType = optionalString(args.modifierType) as
        | MotionShapeModifierType
        | undefined;
      if (!modifierType || !MOTION_SHAPE_MODIFIER_TYPES.has(modifierType)) {
        return fail(`Unknown shape modifier: ${String(args.modifierType)}`, "INVALID_PARAMS");
      }
      const modifier = createMotionShapeModifier(modifierType, genId());
      const nextLayer = addMotionShapeModifier(layer, modifier);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Added ${modifierType} modifier`, {
            compositionId: composition.id,
            layerId: layer.id,
            modifierId: modifier.id,
          })
        : result;
    },
  },
  {
    name: "update_motion_shape_modifier",
    domain: "motion",
    title: "Update motion shape modifier",
    description:
      "Update numeric fields on a shape modifier by modifierId (e.g. trim-paths start/end/offset, repeater copies/offset, round-corners radius). Pass a `fields` object of numeric overrides. Pass enabled (bool) to enable/disable (bypass) the modifier without removing it. At least one of fields or enabled is required.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      modifierId: str,
      fields: { type: "object" },
      enabled: bool,
    }, ["compositionId", "layerId", "modifierId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (layer.type !== "shape") {
        return fail("Shape modifiers require a shape layer", "INVALID_PARAMS");
      }
      const modifierId = optionalString(args.modifierId);
      if (!modifierId) return fail("modifierId is required", "INVALID_PARAMS");
      if (!(layer.modifiers ?? []).some((modifier) => modifier.id === modifierId)) {
        return fail("Shape modifier not found", "NOT_FOUND");
      }
      const fieldsRaw = args.fields;
      const fields =
        fieldsRaw === undefined ? undefined : asRecord(fieldsRaw);
      if (fieldsRaw !== undefined && !fields) {
        return fail("fields must be an object", "INVALID_PARAMS");
      }
      const enabled =
        typeof args.enabled === "boolean" ? args.enabled : undefined;
      if (!fields && enabled === undefined) {
        return fail("Provide fields and/or enabled", "INVALID_PARAMS");
      }
      const numericFields = new Map<string, number>();
      for (const [key, raw] of Object.entries(fields ?? {})) {
        const value = optionalNumber(raw);
        if (value !== undefined) numericFields.set(key, value);
      }
      const isModifierPropertyName = (
        key: string,
      ): key is MotionShapeModifierPropertyName =>
        (MOTION_SHAPE_MODIFIER_PROPERTY_NAMES as readonly string[]).includes(key);
      const nextLayer = updateMotionShapeModifier(layer, modifierId, (modifier) => {
        const supported = new Set(
          getMotionShapeModifierPropertyDescriptors(modifier).map(
            (descriptor) => descriptor.property,
          ),
        );
        let nextModifier = modifier;
        for (const [key, value] of numericFields) {
          if (isModifierPropertyName(key) && supported.has(key)) {
            nextModifier = setMotionShapeModifierPropertyValue(nextModifier, key, value);
          }
        }
        return {
          ...nextModifier,
          ...(enabled !== undefined ? { enabled } : {}),
        };
      });
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Updated shape modifier", { compositionId: composition.id, layerId: layer.id, modifierId })
        : result;
    },
  },
  {
    name: "remove_motion_shape_modifier",
    domain: "motion",
    title: "Remove motion shape modifier",
    description: "Remove a shape modifier from a shape layer by modifierId.",
    inputSchema: obj({ compositionId: str, layerId: str, modifierId: str }, [
      "compositionId",
      "layerId",
      "modifierId",
    ]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (layer.type !== "shape") {
        return fail("Shape modifiers require a shape layer", "INVALID_PARAMS");
      }
      const modifierId = optionalString(args.modifierId);
      if (!modifierId) return fail("modifierId is required", "INVALID_PARAMS");
      const nextLayer = removeMotionShapeModifier(layer, modifierId);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Removed shape modifier", { compositionId: composition.id, layerId: layer.id })
        : result;
    },
  },
  {
    name: "add_motion_shape_group",
    domain: "motion",
    title: "Add motion shape group",
    description:
      `Add an intra-layer shape group to a shape layer's contents tree (the AE "Group (Shift+Cmd+G)" / compound-path container). Pass parentGroupId to nest inside an existing group, else it appends to the layer root. mergeMode is none|union|subtract|intersect|exclude (Merge Paths boolean applied to the group's children). Returns the groupId. ${CONTENTS_KEYFRAME_GRAMMAR}`,
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        parentGroupId: str,
        name: str,
        mergeMode: str,
      },
      ["compositionId", "layerId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const resolved = requireShapeLayer(composition, args.layerId);
      if ("error" in resolved) return resolved.error;
      const { layer } = resolved;
      const parentGroupId = optionalString(args.parentGroupId) ?? null;
      const contents = layer.contents ?? [];
      if (parentGroupId !== null) {
        const parent = findShapeItem(contents, parentGroupId);
        if (!parent) return fail("Parent group not found", "NOT_FOUND");
        if (parent.kind !== "group") {
          return fail("parentGroupId is not a group", "INVALID_PARAMS");
        }
      }
      const mergeModeRaw = optionalString(args.mergeMode);
      let mergeMode: MotionShapeMergeMode | undefined;
      if (mergeModeRaw !== undefined) {
        if (!MOTION_SHAPE_MERGE_MODES.has(mergeModeRaw as MotionShapeMergeMode)) {
          return fail(`Unknown merge mode: ${mergeModeRaw}`, "INVALID_PARAMS");
        }
        mergeMode = mergeModeRaw as MotionShapeMergeMode;
      }
      const baseGroup = createShapeGroupItem(
        optionalString(args.name) ?? "Group",
      );
      const group: MotionShapeGroupItem =
        mergeMode !== undefined ? { ...baseGroup, mergeMode } : baseGroup;
      const targetLayer = hasExplicitShapeContents(layer)
        ? layer
        : materializeShapeContents(layer);
      let nextLayer: MotionShapeLayer;
      try {
        nextLayer = addShapeItem(targetLayer, parentGroupId, group);
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to add shape group",
          "INVALID_PARAMS",
        );
      }
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Added shape group "${group.name}"`, {
            compositionId: composition.id,
            layerId: layer.id,
            groupId: group.id,
          })
        : result;
    },
  },
  {
    name: "add_motion_shape_to_group",
    domain: "motion",
    title: "Add motion shape to group",
    description:
      `Add a path/shape item to a shape layer's contents tree. Pass parentGroupId to place it inside a group, else it appends to the layer root. shapeType is a 2D shape (rectangle|ellipse|path|...). For shapeType 'path' supply pathData (SVG path string) or pathPoints. position {x,y} offsets the item within its parent. Optional style {fill,stroke,...} overrides the inherited group/layer style (omit to inherit). Returns the itemId. ${CONTENTS_KEYFRAME_GRAMMAR}`,
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        parentGroupId: str,
        shapeType: str,
        width: num,
        height: num,
        position: { type: "object" },
        pathData: str,
        pathPoints: { type: "array" },
        pathClosed: bool,
        style: { type: "object" },
        name: str,
      },
      ["compositionId", "layerId", "shapeType"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const resolved = requireShapeLayer(composition, args.layerId);
      if ("error" in resolved) return resolved.error;
      const { layer } = resolved;
      const parentGroupId = optionalString(args.parentGroupId) ?? null;
      const contents = layer.contents ?? [];
      if (parentGroupId !== null) {
        const parent = findShapeItem(contents, parentGroupId);
        if (!parent) return fail("Parent group not found", "NOT_FOUND");
        if (parent.kind !== "group") {
          return fail("parentGroupId is not a group", "INVALID_PARAMS");
        }
      }
      const shapeType = optionalString(args.shapeType) as ShapeType | undefined;
      if (!shapeType || !MOTION_SHAPE_TYPES.has(shapeType)) {
        return fail(`Unknown shapeType: ${String(args.shapeType)}`, "INVALID_PARAMS");
      }
      let pathData: string | undefined;
      let pathClosed: boolean | undefined;
      if (shapeType === "path") {
        const resolvedPath = resolveShapePathData({
          pathData: args.pathData,
          pathPoints: args.pathPoints,
        });
        if ("error" in resolvedPath) {
          return fail(resolvedPath.error, "INVALID_PARAMS");
        }
        pathData = resolvedPath.pathData;
        pathClosed = args.pathClosed === undefined ? true : args.pathClosed === true;
      }
      const position = vec2FromObject(args.position);
      if (args.position !== undefined && !position) {
        return fail("position must be a {x,y} object", "INVALID_PARAMS");
      }
      const styleRecord = asRecord(args.style);
      if (args.style !== undefined && !styleRecord) {
        return fail("style must be an object", "INVALID_PARAMS");
      }
      const style = styleRecord
        ? buildMotionShapeStyle(styleRecord, DEFAULT_SHAPE_STYLE)
        : undefined;
      const item = createShapePathItem({
        name: optionalString(args.name) ?? "Shape",
        shapeType,
        width: optionalNumber(args.width) ?? 100,
        height: optionalNumber(args.height) ?? 100,
        position: position ?? { x: 0, y: 0 },
        pathData,
        pathClosed,
        style,
      });
      const targetLayer = hasExplicitShapeContents(layer)
        ? layer
        : materializeShapeContents(layer);
      let nextLayer: MotionShapeLayer;
      try {
        nextLayer = addShapeItem(targetLayer, parentGroupId, item);
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to add shape item",
          "INVALID_PARAMS",
        );
      }
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Added shape item "${item.name}"`, {
            compositionId: composition.id,
            layerId: layer.id,
            itemId: item.id,
          })
        : result;
    },
  },
  {
    name: "update_motion_shape_item",
    domain: "motion",
    title: "Update motion shape item",
    description:
      `Patch a shape contents item (group or path) by itemId. patch fields: name, visible; groups also accept transform {anchor,position,scale,rotation,opacity} and mergeMode (none|union|subtract|intersect|exclude); path items also accept shapeType (2D only: rectangle|circle|ellipse|triangle|arrow|line|polygon|path|star — mesh-* 3D types are rejected), width, height, position {x,y}, pathData, style. transform/mergeMode on a path item, or width/height/pathData on a group, are rejected (kind-guard). ${CONTENTS_KEYFRAME_GRAMMAR}`,
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        itemId: str,
        patch: { type: "object" },
      },
      ["compositionId", "layerId", "itemId", "patch"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const resolved = requireShapeLayer(composition, args.layerId);
      if ("error" in resolved) return resolved.error;
      const { layer } = resolved;
      const itemId = optionalString(args.itemId);
      if (!itemId) return fail("itemId is required", "INVALID_PARAMS");
      const target = findShapeItem(layer.contents ?? [], itemId);
      if (!target) return fail("Shape item not found", "NOT_FOUND");
      const patchRecord = asRecord(args.patch);
      if (!patchRecord) return fail("patch must be an object", "INVALID_PARAMS");

      const groupOnlyKeys = ["transform", "mergeMode"];
      const pathOnlyKeys = ["width", "height", "pathData", "shapeType"];
      if (target.kind === "path") {
        for (const key of groupOnlyKeys) {
          if (key in patchRecord) {
            return fail(`${key} is only valid on a group item`, "INVALID_PARAMS");
          }
        }
      } else {
        for (const key of pathOnlyKeys) {
          if (key in patchRecord) {
            return fail(`${key} is only valid on a path item`, "INVALID_PARAMS");
          }
        }
      }

      if (target.kind === "group") {
        const groupPatch: {
          name?: string;
          visible?: boolean;
          transform?: MotionShapeGroupTransform;
          mergeMode?: MotionShapeMergeMode;
          style?: ShapeStyle;
        } = {};
        const name = optionalString(patchRecord.name);
        if (name !== undefined) groupPatch.name = name;
        if (typeof patchRecord.visible === "boolean") {
          groupPatch.visible = patchRecord.visible;
        }
        if (patchRecord.transform !== undefined) {
          const transform = parseMotionShapeGroupTransform(patchRecord.transform);
          if ("error" in transform) return fail(transform.error, "INVALID_PARAMS");
          groupPatch.transform = transform;
        }
        if (patchRecord.mergeMode !== undefined) {
          const mergeMode = optionalString(patchRecord.mergeMode);
          if (!mergeMode || !MOTION_SHAPE_MERGE_MODES.has(mergeMode as MotionShapeMergeMode)) {
            return fail(`Unknown merge mode: ${String(patchRecord.mergeMode)}`, "INVALID_PARAMS");
          }
          groupPatch.mergeMode = mergeMode as MotionShapeMergeMode;
        }
        const styleRecord = asRecord(patchRecord.style);
        if (patchRecord.style !== undefined && !styleRecord) {
          return fail("style must be an object", "INVALID_PARAMS");
        }
        if (styleRecord) {
          groupPatch.style = buildMotionShapeStyle(
            styleRecord,
            target.style ?? DEFAULT_SHAPE_STYLE,
          );
        }
        const nextLayer = updateShapeItem(layer, itemId, groupPatch);
        const result = await commitMotionComposition(
          host,
          replaceMotionLayer(composition, layer.id, nextLayer),
        );
        return result.ok
          ? ok("Updated shape group", {
              compositionId: composition.id,
              layerId: layer.id,
              itemId,
            })
          : result;
      }

      const pathPatch: {
        name?: string;
        visible?: boolean;
        shapeType?: ShapeType;
        width?: number;
        height?: number;
        position?: MotionVector2;
        pathData?: string;
        style?: ShapeStyle;
      } = {};
      const name = optionalString(patchRecord.name);
      if (name !== undefined) pathPatch.name = name;
      if (typeof patchRecord.visible === "boolean") {
        pathPatch.visible = patchRecord.visible;
      }
      if (patchRecord.shapeType !== undefined) {
        const shapeType = optionalString(patchRecord.shapeType) as
          | ShapeType
          | undefined;
        if (!shapeType || !MOTION_SHAPE_TYPES.has(shapeType)) {
          return fail(
            `Unknown shapeType: ${String(patchRecord.shapeType)}`,
            "INVALID_PARAMS",
          );
        }
        if (shapeType.startsWith("mesh-")) {
          return fail(
            `shapeType "${shapeType}" is a 3D mesh type and cannot be used on a 2D path item`,
            "INVALID_PARAMS",
          );
        }
        pathPatch.shapeType = shapeType;
      }
      const width = optionalNumber(patchRecord.width);
      if (width !== undefined) pathPatch.width = width;
      const height = optionalNumber(patchRecord.height);
      if (height !== undefined) pathPatch.height = height;
      if (patchRecord.position !== undefined) {
        const position = vec2FromObject(patchRecord.position);
        if (!position) return fail("position must be a {x,y} object", "INVALID_PARAMS");
        pathPatch.position = position;
      }
      const pathData = optionalString(patchRecord.pathData);
      if (pathData !== undefined) pathPatch.pathData = pathData;
      const styleRecord = asRecord(patchRecord.style);
      if (patchRecord.style !== undefined && !styleRecord) {
        return fail("style must be an object", "INVALID_PARAMS");
      }
      if (styleRecord) {
        pathPatch.style = buildMotionShapeStyle(
          styleRecord,
          target.style ?? DEFAULT_SHAPE_STYLE,
        );
      }
      const nextLayer = updateShapeItem(layer, itemId, pathPatch);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Updated shape item", {
            compositionId: composition.id,
            layerId: layer.id,
            itemId,
          })
        : result;
    },
  },
  {
    name: "remove_motion_shape_item",
    domain: "motion",
    title: "Remove motion shape item",
    description:
      `Remove a shape contents item (group or path) by itemId from a shape layer, pruning it from wherever it is nested. ${CONTENTS_KEYFRAME_GRAMMAR}`,
    inputSchema: obj(
      { compositionId: str, layerId: str, itemId: str },
      ["compositionId", "layerId", "itemId"],
    ),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const resolved = requireShapeLayer(composition, args.layerId);
      if ("error" in resolved) return resolved.error;
      const { layer } = resolved;
      const itemId = optionalString(args.itemId);
      if (!itemId) return fail("itemId is required", "INVALID_PARAMS");
      if (!findShapeItem(layer.contents ?? [], itemId)) {
        return fail("Shape item not found", "NOT_FOUND");
      }
      const nextLayer = removeShapeItem(layer, itemId);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Removed shape item", {
            compositionId: composition.id,
            layerId: layer.id,
          })
        : result;
    },
  },
  {
    name: "move_motion_shape_item",
    domain: "motion",
    title: "Move motion shape item",
    description:
      `Reorder a shape contents item within its parent (direction up|down). Reordering changes both z-order and merge/operator fold order (document order matters for subtract/exclude). Boundary moves are no-ops. ${CONTENTS_KEYFRAME_GRAMMAR}`,
    inputSchema: obj(
      { compositionId: str, layerId: str, itemId: str, direction: str },
      ["compositionId", "layerId", "itemId", "direction"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const resolved = requireShapeLayer(composition, args.layerId);
      if ("error" in resolved) return resolved.error;
      const { layer } = resolved;
      const itemId = optionalString(args.itemId);
      if (!itemId) return fail("itemId is required", "INVALID_PARAMS");
      const direction = optionalString(args.direction);
      if (direction !== "up" && direction !== "down") {
        return fail("direction must be 'up' or 'down'", "INVALID_PARAMS");
      }
      if (!findShapeItem(layer.contents ?? [], itemId)) {
        return fail("Shape item not found", "NOT_FOUND");
      }
      const nextLayer = moveShapeItem(layer, itemId, direction);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Moved shape item", {
            compositionId: composition.id,
            layerId: layer.id,
            itemId,
          })
        : result;
    },
  },
  {
    name: "add_motion_shape_group_operator",
    domain: "motion",
    title: "Add motion shape group operator",
    description:
      `Append an operator to a shape group's ordered operator stack (applied left-to-right after the group's merge). operatorType is any of trim-paths|repeater|zig-zag|round-corners|wiggle-paths|offset-paths|pucker-bloat|twist. Duplicates are allowed. Pass params (numeric field overrides, e.g. { amount: 12 } / { angle: 90 }) to seed the operator. Returns the operatorId. ${CONTENTS_KEYFRAME_GRAMMAR}`,
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        groupId: str,
        operatorType: str,
        params: { type: "object" },
      },
      ["compositionId", "layerId", "groupId", "operatorType"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const resolved = requireShapeLayer(composition, args.layerId);
      if ("error" in resolved) return resolved.error;
      const { layer } = resolved;
      const groupId = optionalString(args.groupId);
      if (!groupId) return fail("groupId is required", "INVALID_PARAMS");
      const group = findShapeItem(layer.contents ?? [], groupId);
      if (!group) return fail("Shape group not found", "NOT_FOUND");
      if (group.kind !== "group") {
        return fail("groupId is not a group", "INVALID_PARAMS");
      }
      const operatorType = optionalString(args.operatorType) as
        | MotionShapeModifierType
        | undefined;
      if (!operatorType || !MOTION_SHAPE_OPERATOR_TYPES.has(operatorType)) {
        return fail(`Unknown operator type: ${String(args.operatorType)}`, "INVALID_PARAMS");
      }
      const created = createMotionShapeModifier(operatorType, genId());
      const paramsRecord = asRecord(args.params);
      const supported = new Set(
        getMotionShapeModifierPropertyDescriptors(created).map(
          (descriptor) => descriptor.property,
        ),
      );
      const isModifierPropertyName = (
        key: string,
      ): key is MotionShapeModifierPropertyName =>
        (MOTION_SHAPE_MODIFIER_PROPERTY_NAMES as readonly string[]).includes(key);
      let operator: MotionShapeOperator = created;
      for (const [key, raw] of Object.entries(paramsRecord ?? {})) {
        const value = optionalNumber(raw);
        if (value === undefined) continue;
        if (isModifierPropertyName(key) && supported.has(key)) {
          operator = setMotionShapeModifierPropertyValue(
            operator as MotionShapeModifier,
            key,
            value,
          );
        }
      }
      const nextGroup: MotionShapeGroupItem = {
        ...group,
        operators: [...(group.operators ?? []), operator],
      };
      const nextLayer = updateShapeItem(layer, groupId, {
        operators: nextGroup.operators,
      });
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Added ${operatorType} operator`, {
            compositionId: composition.id,
            layerId: layer.id,
            groupId,
            operatorId: operator.id,
          })
        : result;
    },
  },
  {
    name: "update_motion_shape_group_operator",
    domain: "motion",
    title: "Update motion shape group operator",
    description:
      `Update a group operator's numeric fields (e.g. offset-paths.amount, twist.angle, trim-paths start/end) by operatorId. Pass a fields object of numeric overrides and/or enabled (bool) to bypass without removing. At least one of fields or enabled is required. ${CONTENTS_KEYFRAME_GRAMMAR}`,
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        groupId: str,
        operatorId: str,
        fields: { type: "object" },
        enabled: bool,
      },
      ["compositionId", "layerId", "groupId", "operatorId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const resolved = requireShapeLayer(composition, args.layerId);
      if ("error" in resolved) return resolved.error;
      const { layer } = resolved;
      const groupId = optionalString(args.groupId);
      if (!groupId) return fail("groupId is required", "INVALID_PARAMS");
      const group = findShapeItem(layer.contents ?? [], groupId);
      if (!group) return fail("Shape group not found", "NOT_FOUND");
      if (group.kind !== "group") {
        return fail("groupId is not a group", "INVALID_PARAMS");
      }
      const operatorId = optionalString(args.operatorId);
      if (!operatorId) return fail("operatorId is required", "INVALID_PARAMS");
      const operators = group.operators ?? [];
      if (!operators.some((operator) => operator.id === operatorId)) {
        return fail("Shape operator not found", "NOT_FOUND");
      }
      const fieldsRecord = args.fields === undefined ? undefined : asRecord(args.fields);
      if (args.fields !== undefined && !fieldsRecord) {
        return fail("fields must be an object", "INVALID_PARAMS");
      }
      const enabled = typeof args.enabled === "boolean" ? args.enabled : undefined;
      if (!fieldsRecord && enabled === undefined) {
        return fail("Provide fields and/or enabled", "INVALID_PARAMS");
      }
      const numericFields = new Map<string, number>();
      for (const [key, raw] of Object.entries(fieldsRecord ?? {})) {
        const value = optionalNumber(raw);
        if (value !== undefined) numericFields.set(key, value);
      }
      const isModifierPropertyName = (
        key: string,
      ): key is MotionShapeModifierPropertyName =>
        (MOTION_SHAPE_MODIFIER_PROPERTY_NAMES as readonly string[]).includes(key);
      const nextOperators = operators.map((operator) => {
        if (operator.id !== operatorId) return operator;
        const supported = new Set(
          getMotionShapeModifierPropertyDescriptors(operator).map(
            (descriptor) => descriptor.property,
          ),
        );
        let nextOperator: MotionShapeOperator = operator;
        for (const [key, value] of numericFields) {
          if (isModifierPropertyName(key) && supported.has(key)) {
            nextOperator = setMotionShapeModifierPropertyValue(
              nextOperator as MotionShapeModifier,
              key,
              value,
            );
          }
        }
        return {
          ...nextOperator,
          ...(enabled !== undefined ? { enabled } : {}),
        };
      });
      const nextLayer = updateShapeItem(layer, groupId, {
        operators: nextOperators,
      });
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Updated shape operator", {
            compositionId: composition.id,
            layerId: layer.id,
            groupId,
            operatorId,
          })
        : result;
    },
  },
  {
    name: "remove_motion_shape_group_operator",
    domain: "motion",
    title: "Remove motion shape group operator",
    description:
      `Remove an operator from a shape group's operator stack by operatorId. ${CONTENTS_KEYFRAME_GRAMMAR}`,
    inputSchema: obj(
      { compositionId: str, layerId: str, groupId: str, operatorId: str },
      ["compositionId", "layerId", "groupId", "operatorId"],
    ),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const resolved = requireShapeLayer(composition, args.layerId);
      if ("error" in resolved) return resolved.error;
      const { layer } = resolved;
      const groupId = optionalString(args.groupId);
      if (!groupId) return fail("groupId is required", "INVALID_PARAMS");
      const group = findShapeItem(layer.contents ?? [], groupId);
      if (!group) return fail("Shape group not found", "NOT_FOUND");
      if (group.kind !== "group") {
        return fail("groupId is not a group", "INVALID_PARAMS");
      }
      const operatorId = optionalString(args.operatorId);
      if (!operatorId) return fail("operatorId is required", "INVALID_PARAMS");
      const operators = group.operators ?? [];
      if (!operators.some((operator) => operator.id === operatorId)) {
        return fail("Shape operator not found", "NOT_FOUND");
      }
      const nextOperators = operators.filter(
        (operator) => operator.id !== operatorId,
      );
      const nextLayer = updateShapeItem(layer, groupId, {
        operators: nextOperators,
      });
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Removed shape operator", {
            compositionId: composition.id,
            layerId: layer.id,
            groupId,
          })
        : result;
    },
  },
  {
    name: "merge_motion_shape_layers",
    domain: "motion",
    title: "Merge motion shape layers",
    description:
      `Collapse >=2 shape layers into one grouped shape layer with a Merge Paths mode (the AE compound-icon workflow). mode is none|union|subtract|intersect|exclude, folded in the given layerIds order. Each source layer becomes a wrapper group whose transform (position, rotation, scale, anchor, opacity) mirrors the source layer so world placement is preserved; a source with its own contents tree keeps those items verbatim. The source layers are removed and one new shape layer holding the merged group is created (single undoable batch). Non-shape source layers (text/image/etc.) are rejected. Returns { layerId, groupId }. ${CONTENTS_KEYFRAME_GRAMMAR}`,
    inputSchema: obj(
      {
        compositionId: str,
        layerIds: { type: "array" },
        mode: str,
        name: str,
      },
      ["compositionId", "layerIds", "mode"],
    ),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      if (!Array.isArray(args.layerIds)) {
        return fail("layerIds must be an array", "INVALID_PARAMS");
      }
      const layerIds: string[] = [];
      for (const entry of args.layerIds) {
        const id = optionalString(entry);
        if (id && !layerIds.includes(id)) layerIds.push(id);
      }
      if (layerIds.length < 2) {
        return fail("merge requires at least 2 distinct layerIds", "INVALID_PARAMS");
      }
      const mode = optionalString(args.mode);
      if (!mode || !MOTION_SHAPE_MERGE_MODES.has(mode as MotionShapeMergeMode)) {
        return fail(`Unknown merge mode: ${String(args.mode)}`, "INVALID_PARAMS");
      }
      const sources: MotionShapeLayer[] = [];
      for (const layerId of layerIds) {
        const layer = getMotionLayer(composition, layerId);
        if (!layer) return fail(`Motion layer not found: ${layerId}`, "NOT_FOUND");
        if (layer.type !== "shape") {
          return fail(
            `merge_motion_shape_layers only accepts shape layers (got ${layer.type})`,
            "INVALID_PARAMS",
          );
        }
        sources.push(layer);
      }
      const mergedCenter: MotionVector2 = {
        x: composition.width / 2,
        y: composition.height / 2,
      };
      const items: MotionShapeItem[] = sources.map((source) =>
        synthesizeSourceShapeGroup(source, mergedCenter),
      );
      const baseGroup = createShapeGroupItem(optionalString(args.name) ?? "Merged");
      const group: MotionShapeGroupItem = {
        ...baseGroup,
        mergeMode: mode as MotionShapeMergeMode,
        items,
      };
      const first = sources[0];
      if (!first) return fail("merge requires a source layer", "INVALID_PARAMS");
      const mergedLayer: MotionShapeLayer = {
        id: genId(),
        type: "shape",
        name: optionalString(args.name) ?? "Merged",
        startTime: first.startTime,
        duration: first.duration,
        visible: true,
        locked: false,
        transform: {
          ...DEFAULT_MOTION_TRANSFORM,
          position: { x: composition.width / 2, y: composition.height / 2 },
        },
        keyframes: [],
        shapeType: "path",
        width: first.width,
        height: first.height,
        style: first.style,
        contents: [group],
      };
      const removalSet = new Set(layerIds);
      const nextComposition: MotionComposition = {
        ...composition,
        layers: [
          ...composition.layers.filter((layer) => !removalSet.has(layer.id)),
          mergedLayer,
        ],
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Merged ${sources.length} shape layers (${mode})`, {
            compositionId: composition.id,
            layerId: mergedLayer.id,
            groupId: group.id,
          })
        : result;
    },
  }
];
