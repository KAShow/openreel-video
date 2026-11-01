import {
  MOTION_ALIGNMENTS,
  MOTION_SHAPE_TYPES,
  MOTION_UI_COMPONENT_TYPE_SET,
  RegisteredTool,
  applyExtendedShapeStyle,
  asRecord,
  bool,
  buildMotionUiContext,
  clampNumber,
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
  parseMotionFit,
  parseMotionUiLayerSpecs,
  parseScalarKeyframes,
  parseStringArray,
  replaceMotionLayer,
  str,
} from "./shared";
import {
  type Keyframe,
} from "@openreel/core/types/timeline";
import {
  MOTION_COMPOSITION_TIME_PROPERTY,
  addMotionComponentInstance,
  clearMotionCompositionTimeRemap,
  enableMotionCompositionTimeRemap,
  getMotionCompositionById,
  isMotionCompositionLayer,
  precomposeMotionLayers,
} from "@openreel/core/motion/motion-precomps";
import {
  MOTION_UI_LAYOUT_MODES,
  type MotionUiComponentProps,
  type MotionUiComponentType,
  type MotionUiShapeStyleSpec,
  arrangeMotionLayersInGrid,
  arrangeMotionLayersInStack,
  buildMotionShapeStyle,
  buildMotionUiComponent,
  buildMotionUiLayers,
  setMotionGroupAutoLayout,
} from "@openreel/core/motion/motion-ui-builder";
import {
  type MediaItem,
} from "@openreel/core/types/project";
import {
  type MotionAsset,
  type MotionComposition,
  type MotionCompositionLayer,
  type MotionImageLayer,
  type MotionInstanceOverride,
  type MotionInstanceOverrides,
  type MotionShapeLayer,
} from "@openreel/core/motion/types";
import {
  type MotionLayerAlignment,
  type MotionLayerDistributionAxis,
  alignMotionLayers,
  distributeMotionLayers,
} from "@openreel/core/motion/motion-layout";
import {
  type ShapeType,
} from "@openreel/core/graphics/types";
import {
  createCursorClick,
} from "@openreel/core/motion/motion-cursor";
import {
  createMotionImageAssetFromMediaItem,
  createMotionImageLayerFromAsset,
} from "@openreel/core/motion/motion-assets";
import {
  disintegrateMotionLayer,
} from "@openreel/core/motion/motion-disintegrate";
import {
  groupMotionLayers,
  ungroupMotionLayers,
} from "@openreel/core/motion/motion-hierarchy";
import {
  morphMotionLayers,
} from "@openreel/core/motion/motion-morph";

export const motionLayoutTools: RegisteredTool[] = [
  {
    name: "add_motion_layers",
    domain: "motion",
    title: "Add motion layers (batch)",
    description:
      "Create MANY layers in ONE call to reconstruct a full UI efficiently. Pass `layers`: an array of specs, each { key?, type (text|shape|image|group|null|adjustment), name?, x?, y? (pixel center), width?, height?, rotation?, opacity?, startTime?, duration?, parentKey? (reference another spec's key), parentId?, shapeType?, style? (fill/stroke/shadow/cornerRadius — see set_motion_shape_style), text?, textStyle? (fontFamily/fontSize/fontWeight/color/align/lineHeight/letterSpacing), assetId? (image), fit? }. Returns data.layerIds keyed by each spec's `key` plus data.createdLayerIds in order. Use this then arrange_motion_layers + animate_motion_layers.",
    inputSchema: obj({ compositionId: str, layers: { type: "array" } }, [
      "compositionId",
      "layers",
    ]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const parsed = parseMotionUiLayerSpecs(args.layers);
      if (!Array.isArray(parsed)) return fail(parsed.error, "INVALID_PARAMS");
      for (const spec of parsed) {
        if (spec.type === "image" && spec.assetId) {
          const known = composition.assets.some((asset) => asset.id === spec.assetId);
          if (!known) {
            return fail(
              `image layer assetId not found in composition: ${spec.assetId}`,
              "INVALID_PARAMS",
            );
          }
        }
      }
      let built;
      try {
        built = buildMotionUiLayers(parsed, buildMotionUiContext(composition));
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to build layers",
          "INVALID_PARAMS",
        );
      }
      const committed: MotionComposition = {
        ...composition,
        layers: [...composition.layers, ...built.layers],
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, committed);
      return result.ok
        ? ok(`Added ${built.layers.length} motion layers`, {
            compositionId: composition.id,
            layerIds: built.keyToId,
            createdLayerIds: built.layers.map((layer) => layer.id),
          })
        : result;
    },
  },
  {
    name: "set_motion_shape_style",
    domain: "motion",
    title: "Set motion shape style",
    description:
      "Set the full visual style of a shape layer so any card/button/panel look is reproducible. Optional: shapeType (rectangle|circle|ellipse|line|polygon|star|triangle|arrow|...), width, height, fill { type: solid|gradient|none, color, opacity, gradient: { type: linear|radial|conic, angle, center {x,y}, stops: [{offset 0..1, color, opacity?}] } }, stroke { color, width, opacity, dashArray, dashOffset, lineCap, lineJoin, gradient }, shadow { color, blur, offsetX, offsetY, spread?, inset? }, shadows [array of shadow], cornerRadius, cornerRadii { topLeft, topRight, bottomRight, bottomLeft }, points (star), innerRadius (star 0..1).",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      shapeType: str,
      width: num,
      height: num,
      fill: { type: "object" },
      stroke: { type: "object" },
      shadow: { type: "object" },
      shadows: { type: "array" },
      cornerRadius: num,
      cornerRadii: { type: "object" },
      points: num,
      innerRadius: num,
    }, ["compositionId", "layerId"]),
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
        return fail("set_motion_shape_style requires a shape layer", "INVALID_PARAMS");
      }
      const shapeType = optionalString(args.shapeType) as ShapeType | undefined;
      if (shapeType && !MOTION_SHAPE_TYPES.has(shapeType)) {
        return fail(`Unknown shapeType: ${String(args.shapeType)}`, "INVALID_PARAMS");
      }
      const styleSpec: MotionUiShapeStyleSpec = {
        fill: asRecord(args.fill) as MotionUiShapeStyleSpec["fill"],
        stroke: asRecord(args.stroke) as MotionUiShapeStyleSpec["stroke"],
        shadow: asRecord(args.shadow) as MotionUiShapeStyleSpec["shadow"],
        cornerRadius: optionalNumber(args.cornerRadius),
        points: optionalNumber(args.points),
        innerRadius: optionalNumber(args.innerRadius),
      };
      const baseStyle = buildMotionShapeStyle(styleSpec, layer.style);
      const nextStyle = applyExtendedShapeStyle(baseStyle, args);
      if (typeof nextStyle === "string") {
        return fail(nextStyle, "INVALID_PARAMS");
      }
      const nextLayer: MotionShapeLayer = {
        ...layer,
        shapeType: shapeType ?? layer.shapeType,
        width: optionalNumber(args.width) ?? layer.width,
        height: optionalNumber(args.height) ?? layer.height,
        style: nextStyle,
      };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Set motion shape style", {
            compositionId: composition.id,
            layerId: layer.id,
          })
        : result;
    },
  },
  {
    name: "add_motion_ui_component",
    domain: "motion",
    title: "Add motion UI component",
    description:
      "Add a high-level UI component built from native shape/text layers and grouped together. componentType is one of button|card|input|nav-bar|avatar|badge|icon-button. props (all optional): label, title, body, placeholder, items (nav links), x, y (pixel center), width, height, cornerRadius, backgroundColor, textColor, accentColor, fontSize, shadow (boolean), assetIdForAvatar, startTime, duration. Returns data.groupId and data.childIds — everything stays editable as normal layers.",
    inputSchema: obj({
      compositionId: str,
      componentType: str,
      props: { type: "object" },
    }, ["compositionId", "componentType"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const componentType = optionalString(args.componentType) as
        | MotionUiComponentType
        | undefined;
      if (!componentType || !MOTION_UI_COMPONENT_TYPE_SET.has(componentType)) {
        return fail(
          `Unknown componentType: ${String(args.componentType)} (one of ${[...MOTION_UI_COMPONENT_TYPE_SET].join("|")})`,
          "INVALID_PARAMS",
        );
      }
      const props = (asRecord(args.props) ?? {}) as MotionUiComponentProps;
      if (componentType === "avatar" && props.assetIdForAvatar) {
        const known = composition.assets.some(
          (asset) => asset.id === props.assetIdForAvatar,
        );
        if (!known) {
          return fail(
            `avatar assetIdForAvatar not found in composition: ${props.assetIdForAvatar}`,
            "INVALID_PARAMS",
          );
        }
      }
      let built;
      try {
        built = buildMotionUiComponent(componentType, props, buildMotionUiContext(composition));
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to build component",
          "INVALID_PARAMS",
        );
      }
      const committed: MotionComposition = {
        ...composition,
        layers: [...composition.layers, ...built.layers],
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, committed);
      return result.ok
        ? ok(`Added ${componentType} component`, {
            compositionId: composition.id,
            groupId: built.groupId,
            childIds: built.childIds,
          })
        : result;
    },
  },
  {
    name: "arrange_motion_layers",
    domain: "motion",
    title: "Arrange motion layers",
    description:
      "Lay out layers precisely. mode is stack-vertical, stack-horizontal, or grid. Pass layerIds in the desired order. For stacks: gap, align (start|center|end), originX/originY (the top-left pixel anchor of the run). For grid: columns, gap, rowGap, originX/originY. Positions are computed from each layer's visual size.",
    inputSchema: obj({
      compositionId: str,
      layerIds: { type: "array" },
      mode: str,
      gap: num,
      rowGap: num,
      columns: num,
      align: str,
      originX: num,
      originY: num,
    }, ["compositionId", "layerIds", "mode"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerIds = parseStringArray(args.layerIds);
      if (!layerIds || layerIds.length === 0) {
        return fail("layerIds must be a non-empty string array", "INVALID_PARAMS");
      }
      for (const layerId of layerIds) {
        if (!getMotionLayer(composition, layerId)) {
          return fail(`Motion layer not found: ${layerId}`, "NOT_FOUND");
        }
      }
      const mode = optionalString(args.mode);
      if (!mode || !MOTION_UI_LAYOUT_MODES.includes(mode)) {
        return fail(
          `mode must be one of ${MOTION_UI_LAYOUT_MODES.join("|")}`,
          "INVALID_PARAMS",
        );
      }
      const align = optionalString(args.align);
      let nextComposition: MotionComposition;
      if (mode === "grid") {
        nextComposition = arrangeMotionLayersInGrid(composition, layerIds, {
          columns: Math.max(1, Math.round(optionalNumber(args.columns) ?? 2)),
          gap: optionalNumber(args.gap),
          rowGap: optionalNumber(args.rowGap),
          originX: optionalNumber(args.originX),
          originY: optionalNumber(args.originY),
        });
      } else {
        nextComposition = arrangeMotionLayersInStack(composition, layerIds, {
          direction: mode === "stack-horizontal" ? "horizontal" : "vertical",
          gap: optionalNumber(args.gap),
          align:
            align === "start" || align === "center" || align === "end"
              ? align
              : undefined,
          originX: optionalNumber(args.originX),
          originY: optionalNumber(args.originY),
        });
      }
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Arranged ${layerIds.length} layers (${mode})`, {
            compositionId: composition.id,
            layerIds,
          })
        : result;
    },
  },
  {
    name: "align_motion_layers",
    domain: "motion",
    title: "Align motion layers",
    description:
      "Align layers by edge or center. alignment is left|center-x|right|top|center-y|bottom. relativeTo is selection (default) or composition.",
    inputSchema: obj({
      compositionId: str,
      layerIds: { type: "array" },
      alignment: str,
      relativeTo: str,
    }, ["compositionId", "layerIds", "alignment"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerIds = parseStringArray(args.layerIds);
      if (!layerIds || layerIds.length === 0) {
        return fail("layerIds must be a non-empty string array", "INVALID_PARAMS");
      }
      const alignment = optionalString(args.alignment) as
        | MotionLayerAlignment
        | undefined;
      if (!alignment || !MOTION_ALIGNMENTS.has(alignment)) {
        return fail(`Unknown alignment: ${String(args.alignment)}`, "INVALID_PARAMS");
      }
      const relativeTo =
        args.relativeTo === "composition" ? "composition" : "selection";
      const nextComposition = alignMotionLayers(composition, layerIds, alignment, {
        relativeTo,
      });
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Aligned layers (${alignment})`, {
            compositionId: composition.id,
            layerIds,
          })
        : result;
    },
  },
  {
    name: "distribute_motion_layers",
    domain: "motion",
    title: "Distribute motion layers",
    description:
      "Evenly distribute 3+ layers along an axis (horizontal|vertical) so spacing between centers is equal.",
    inputSchema: obj({
      compositionId: str,
      layerIds: { type: "array" },
      axis: str,
    }, ["compositionId", "layerIds", "axis"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerIds = parseStringArray(args.layerIds);
      if (!layerIds || layerIds.length < 3) {
        return fail("distribute requires at least 3 layerIds", "INVALID_PARAMS");
      }
      const axis = optionalString(args.axis) as
        | MotionLayerDistributionAxis
        | undefined;
      if (axis !== "horizontal" && axis !== "vertical") {
        return fail("axis must be horizontal or vertical", "INVALID_PARAMS");
      }
      const nextComposition = distributeMotionLayers(composition, layerIds, axis);
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Distributed layers (${axis})`, {
            compositionId: composition.id,
            layerIds,
          })
        : result;
    },
  },
  {
    name: "group_motion_layers",
    domain: "motion",
    title: "Group motion layers",
    description:
      "Wrap layers into a new group layer (Figma-style), reparenting them while preserving their stage positions. Only the top-most selected layers are reparented; descendants of a selected parent ride along so internal nesting is kept. Returns the new groupId. Pair with set_motion_group_auto_layout to make the group reflow its children, or animate/transform the group as one unit.",
    inputSchema: obj(
      { compositionId: str, layerIds: { type: "array" }, name: str },
      ["compositionId", "layerIds"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerIds = parseStringArray(args.layerIds);
      if (!layerIds || layerIds.length === 0) {
        return fail("layerIds must be a non-empty string array", "INVALID_PARAMS");
      }
      for (const layerId of layerIds) {
        if (!getMotionLayer(composition, layerId)) {
          return fail(`Motion layer not found: ${layerId}`, "NOT_FOUND");
        }
      }
      const result = groupMotionLayers(composition, layerIds, {
        id: genId(),
        name: optionalString(args.name),
      });
      if (!result) return fail("Unable to group the given layers", "INVALID_PARAMS");
      const commit = await commitMotionComposition(host, result.composition);
      return commit.ok
        ? ok(`Grouped ${layerIds.length} layers`, {
            compositionId: composition.id,
            groupId: result.groupLayerId,
          })
        : commit;
    },
  },
  {
    name: "ungroup_motion_layers",
    domain: "motion",
    title: "Ungroup motion layers",
    description:
      "Dissolve one or more group layers, re-parenting their children to the group's parent (or the composition root) while preserving stage positions. The group layers themselves are removed.",
    inputSchema: obj(
      { compositionId: str, groupLayerIds: { type: "array" } },
      ["compositionId", "groupLayerIds"],
    ),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const groupLayerIds = parseStringArray(args.groupLayerIds);
      if (!groupLayerIds || groupLayerIds.length === 0) {
        return fail("groupLayerIds must be a non-empty string array", "INVALID_PARAMS");
      }
      const groups = groupLayerIds.filter(
        (id) => getMotionLayer(composition, id)?.type === "group",
      );
      if (groups.length === 0) {
        return fail("No group layers found among groupLayerIds", "NOT_FOUND");
      }
      const nextComposition = ungroupMotionLayers(composition, groupLayerIds);
      const commit = await commitMotionComposition(host, nextComposition);
      return commit.ok
        ? ok(`Ungrouped ${groups.length} group(s)`, {
            compositionId: composition.id,
          })
        : commit;
    },
  },
  {
    name: "set_motion_group_auto_layout",
    domain: "motion",
    title: "Set group auto-layout",
    description:
      "Turn a group into a Figma-style auto-layout frame: its children pack into a centered row (horizontal) or column (vertical) with a fixed gap, and re-pack automatically whenever a child's size changes. Pass direction (horizontal|vertical), gap (px, default 24), align (start|center|end, default center). Pass clear:true to remove auto-layout and free the children. Locked or position-keyframed children opt out of the flow and keep their own placement.",
    inputSchema: obj(
      {
        compositionId: str,
        groupId: str,
        direction: str,
        gap: num,
        align: str,
        clear: bool,
      },
      ["compositionId", "groupId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const groupId = optionalString(args.groupId);
      const group = groupId ? getMotionLayer(composition, groupId) : undefined;
      if (!group || group.type !== "group") {
        return fail("groupId must reference a group layer", "NOT_FOUND");
      }
      if (args.clear === true) {
        const cleared = setMotionGroupAutoLayout(composition, group.id, null);
        const commit = await commitMotionComposition(host, cleared);
        return commit.ok
          ? ok("Cleared group auto-layout", {
              compositionId: composition.id,
              groupId: group.id,
            })
          : commit;
      }
      const direction = optionalString(args.direction);
      if (direction !== "horizontal" && direction !== "vertical") {
        return fail(
          "direction must be horizontal or vertical (or pass clear:true)",
          "INVALID_PARAMS",
        );
      }
      const alignRaw = optionalString(args.align);
      const align =
        alignRaw === "start" || alignRaw === "center" || alignRaw === "end"
          ? alignRaw
          : "center";
      const gap = Math.max(0, optionalNumber(args.gap) ?? 24);
      const next = setMotionGroupAutoLayout(composition, group.id, {
        direction,
        gap,
        align,
      });
      const commit = await commitMotionComposition(host, next);
      return commit.ok
        ? ok(`Auto-layout: ${direction} gap ${gap}`, {
            compositionId: composition.id,
            groupId: group.id,
          })
        : commit;
    },
  },
  {
    name: "precompose_motion_layers",
    domain: "motion",
    title: "Precompose into a component",
    description:
      "Pull the given layers into a new nested composition (a reusable 'component' / precomp) and replace them in place with a single composition layer that references it. Edit the component once and every instance updates. Use add_motion_component_instance to stamp more instances and set_motion_instance_overrides to vary text/color per instance. Returns the new componentId (nested composition id) and the precomp layerId.",
    inputSchema: obj(
      { compositionId: str, layerIds: { type: "array" }, name: str },
      ["compositionId", "layerIds"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerIds = parseStringArray(args.layerIds);
      if (!layerIds || layerIds.length === 0) {
        return fail("layerIds must be a non-empty string array", "INVALID_PARAMS");
      }
      for (const layerId of layerIds) {
        if (!getMotionLayer(composition, layerId)) {
          return fail(`Motion layer not found: ${layerId}`, "NOT_FOUND");
        }
      }
      const result = precomposeMotionLayers(composition, layerIds, {
        compositionId: genId(),
        layerId: genId(),
        name: optionalString(args.name),
        now: Date.now(),
      });
      if (!result) return fail("Unable to precompose the given layers", "INVALID_PARAMS");
      const nestedCommit = await commitMotionComposition(host, result.nestedComposition);
      if (!nestedCommit.ok) return nestedCommit;
      const hostCommit = await commitMotionComposition(host, result.hostComposition);
      return hostCommit.ok
        ? ok(`Precomposed ${result.movedLayerIds.length} layers into a component`, {
            compositionId: composition.id,
            componentId: result.nestedComposition.id,
            precompLayerId: result.precompLayerId,
          })
        : hostCommit;
    },
  },
  {
    name: "add_motion_component_instance",
    domain: "motion",
    title: "Add component instance",
    description:
      "Stamp another instance of a component: duplicate an existing precomp (composition) layer so it references the same master component. Editing the master updates every instance. The copy lands offset by offsetX/offsetY (default 48,48) and, if the source is inside a group, stays a sibling in that group. Returns the new instance layerId.",
    inputSchema: obj(
      { compositionId: str, instanceLayerId: str, offsetX: num, offsetY: num },
      ["compositionId", "instanceLayerId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const instanceLayerId = optionalString(args.instanceLayerId);
      if (!instanceLayerId) return fail("instanceLayerId is required", "INVALID_PARAMS");
      const offsetX = optionalNumber(args.offsetX);
      const offsetY = optionalNumber(args.offsetY);
      const offset =
        offsetX !== undefined || offsetY !== undefined
          ? { x: offsetX ?? 0, y: offsetY ?? 0 }
          : undefined;
      const result = addMotionComponentInstance(composition, instanceLayerId, {
        id: genId(),
        offset,
      });
      if (!result) {
        return fail(
          "instanceLayerId must reference a component (composition) layer",
          "NOT_FOUND",
        );
      }
      const commit = await commitMotionComposition(host, result.composition);
      return commit.ok
        ? ok("Added component instance", {
            compositionId: composition.id,
            instanceLayerId: result.instanceLayerId,
          })
        : commit;
    },
  },
  {
    name: "set_motion_time_remap",
    domain: "motion",
    title: "Set precomp time remap",
    description:
      "Time-remap a precomp (composition) layer — retime, freeze, reverse, or hand-key its source time. compositionLayerId must reference a layer with type 'composition'. Exactly one mode: `enable:true` lays down a linear identity remap (start of source -> end of source) so you can then adjust it; `reverse:true` plays the source backwards; `freeze:true` holds a single source frame (optional `freezeTime` seconds, default 0); `disable:true` clears the remap; or pass explicit `keyframes` as an array of { time, value, easing? } where time is the layer-local time and value is the source time (both seconds). Only one of enable/reverse/freeze/disable/keyframes may be provided.",
    inputSchema: obj(
      {
        compositionId: str,
        compositionLayerId: str,
        enable: bool,
        disable: bool,
        reverse: bool,
        freeze: bool,
        freezeTime: num,
        keyframes: { type: "array" },
      },
      ["compositionId", "compositionLayerId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.compositionLayerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (!isMotionCompositionLayer(layer)) {
        return fail("compositionLayerId must reference a composition (precomp) layer", "INVALID_PARAMS");
      }
      const enable = args.enable === true;
      const disable = args.disable === true;
      const reverse = args.reverse === true;
      const freeze = args.freeze === true;
      const keyframes = parseScalarKeyframes(args.keyframes);
      if (args.keyframes !== undefined && keyframes === undefined) {
        return fail("keyframes must be an array of { time, value, easing? }", "INVALID_PARAMS");
      }
      const modeCount =
        Number(enable) +
        Number(disable) +
        Number(reverse) +
        Number(freeze) +
        Number((keyframes?.length ?? 0) > 0);
      if (modeCount === 0) {
        return fail(
          "Provide exactly one of enable, disable, reverse, freeze, or keyframes",
          "INVALID_PARAMS",
        );
      }
      if (modeCount > 1) {
        return fail(
          "Only one of enable, disable, reverse, freeze, or keyframes may be set",
          "INVALID_PARAMS",
        );
      }
      const sourceDuration =
        getMotionCompositionById(
          host.getProject().motionCompositions ?? [],
          layer.compositionId,
        )?.duration ?? layer.duration;
      const layerDuration = Math.max(0.001, layer.duration);
      let nextLayer: MotionCompositionLayer = layer;
      if (disable) {
        nextLayer = clearMotionCompositionTimeRemap(layer);
      } else if (enable) {
        nextLayer = enableMotionCompositionTimeRemap(layer, {
          sourceDuration,
          idFactory: () => genId(),
        });
      } else if (reverse) {
        const cleared = clearMotionCompositionTimeRemap(layer);
        const remapKeys: Keyframe[] = [
          {
            id: genId(),
            property: MOTION_COMPOSITION_TIME_PROPERTY,
            time: 0,
            value: Math.max(0, sourceDuration),
            easing: "linear",
          },
          {
            id: genId(),
            property: MOTION_COMPOSITION_TIME_PROPERTY,
            time: layerDuration,
            value: 0,
            easing: "linear",
          },
        ];
        nextLayer = {
          ...cleared,
          keyframes: [...cleared.keyframes, ...remapKeys],
        };
      } else if (freeze) {
        const frozen = clampNumber(optionalNumber(args.freezeTime) ?? 0, 0, sourceDuration);
        const cleared = clearMotionCompositionTimeRemap(layer);
        const remapKeys: Keyframe[] = [
          {
            id: genId(),
            property: MOTION_COMPOSITION_TIME_PROPERTY,
            time: 0,
            value: frozen,
            easing: "hold",
          },
          {
            id: genId(),
            property: MOTION_COMPOSITION_TIME_PROPERTY,
            time: layerDuration,
            value: frozen,
            easing: "hold",
          },
        ];
        nextLayer = {
          ...cleared,
          keyframes: [...cleared.keyframes, ...remapKeys],
        };
      } else if (keyframes) {
        const cleared = clearMotionCompositionTimeRemap(layer);
        const remapKeys: Keyframe[] = keyframes.map((keyframe) => ({
          id: genId(),
          property: MOTION_COMPOSITION_TIME_PROPERTY,
          time: keyframe.time,
          value: clampNumber(keyframe.value, 0, Math.max(0, sourceDuration)),
          easing: keyframe.easing ?? "linear",
        }));
        nextLayer = {
          ...cleared,
          keyframes: [...cleared.keyframes, ...remapKeys],
        };
      }
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(
            disable ? "Cleared time remap" : "Set precomp time remap",
            {
              compositionId: composition.id,
              compositionLayerId: layer.id,
              remapped: nextLayer.keyframes.some(
                (keyframe) => keyframe.property === MOTION_COMPOSITION_TIME_PROPERTY,
              ),
            },
          )
        : result;
    },
  },
  {
    name: "set_motion_instance_overrides",
    domain: "motion",
    title: "Set component instance overrides",
    description:
      "Override text and/or color on individual child layers of a component INSTANCE, without touching the master component or its other instances. Pass overrides as an array of { childLayerId, text?, color? } where childLayerId is a layer id inside the master component. text applies to text children; color applies to text or shape children (a color override flattens a gradient fill to solid). An entry with neither text nor color clears that child's override. Pass clear:true to remove all overrides on this instance.",
    inputSchema: obj(
      {
        compositionId: str,
        instanceLayerId: str,
        overrides: { type: "array" },
        clear: bool,
      },
      ["compositionId", "instanceLayerId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const instanceLayerId = optionalString(args.instanceLayerId);
      const layer = instanceLayerId
        ? getMotionLayer(composition, instanceLayerId)
        : undefined;
      if (!layer || layer.type !== "composition") {
        return fail(
          "instanceLayerId must reference a component (composition) layer",
          "NOT_FOUND",
        );
      }
      let nextOverrides: MotionInstanceOverrides | undefined;
      if (args.clear === true) {
        nextOverrides = undefined;
      } else {
        const entries = Array.isArray(args.overrides) ? args.overrides : [];
        if (entries.length === 0) {
          return fail(
            "overrides must be a non-empty array (or pass clear:true)",
            "INVALID_PARAMS",
          );
        }
        const map: Record<string, MotionInstanceOverride> = {
          ...(layer.overrides ?? {}),
        };
        for (const entry of entries) {
          const record = asRecord(entry);
          const childLayerId = optionalString(record?.childLayerId);
          if (!childLayerId) {
            return fail("each override needs a childLayerId", "INVALID_PARAMS");
          }
          const text =
            typeof record?.text === "string" ? record.text : undefined;
          const color = optionalString(record?.color);
          if (text === undefined && color === undefined) {
            delete map[childLayerId];
          } else {
            map[childLayerId] = {
              ...map[childLayerId],
              ...(text !== undefined ? { text } : {}),
              ...(color !== undefined ? { color } : {}),
            };
          }
        }
        nextOverrides = Object.keys(map).length > 0 ? map : undefined;
      }
      const nextLayer: MotionCompositionLayer = {
        ...layer,
        overrides: nextOverrides,
      };
      const nextComposition = replaceMotionLayer(composition, layer.id, nextLayer);
      const commit = await commitMotionComposition(host, nextComposition);
      return commit.ok
        ? ok("Updated component instance overrides", {
            compositionId: composition.id,
            instanceLayerId: layer.id,
          })
        : commit;
    },
  },
  {
    name: "disintegrate_motion_layer",
    domain: "motion",
    title: "Disintegrate motion layer",
    description:
      "After-Effects-style disintegration: fade the target layer out while spawning a matching particle burst from its position (colored from its fill/text color), so it appears to crumble into dust. time (composition-absolute seconds, default = layer start) is when it disintegrates; duration (default 0.7s) is the fade length. The original layer is trimmed to end at the disintegration point. Pair with add_motion_cursor_click for a click-then-disintegrate beat. Returns the particle burst layerId.",
    inputSchema: obj(
      { compositionId: str, layerId: str, time: num, duration: num },
      ["compositionId", "layerId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerId = optionalString(args.layerId);
      if (!layerId || !getMotionLayer(composition, layerId)) {
        return fail("layerId must reference an existing layer", "NOT_FOUND");
      }
      const result = disintegrateMotionLayer(composition, layerId, {
        time: optionalNumber(args.time),
        duration: optionalNumber(args.duration),
      });
      if (!result) return fail("Unable to disintegrate the given layer", "INVALID_PARAMS");
      const commit = await commitMotionComposition(host, result.composition);
      return commit.ok
        ? ok("Disintegrated layer", {
            compositionId: composition.id,
            particleLayerId: result.particleLayerId,
          })
        : commit;
    },
  },
  {
    name: "morph_motion_layers",
    domain: "motion",
    title: "Morph between two layers",
    description:
      "Morph one whole layer/view INTO another (After-Effects crossfade + transform tween): layer A fades out while layer B fades in starting from A's position/scale/rotation and settling into its own — so B appears where A was and animates into place. Use this to transition between two designed views/screens. Both layers must overlap the morph window (time..time+duration) or it no-ops and returns an error. For morphing a single SHAPE's outline into a different shape, use morph_motion_shape instead. fromLayerId, toLayerId; time (default 0), duration (default 0.6s).",
    inputSchema: obj(
      { compositionId: str, fromLayerId: str, toLayerId: str, time: num, duration: num },
      ["compositionId", "fromLayerId", "toLayerId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const fromLayerId = optionalString(args.fromLayerId);
      const toLayerId = optionalString(args.toLayerId);
      if (!fromLayerId || !getMotionLayer(composition, fromLayerId)) {
        return fail("fromLayerId must reference an existing layer", "NOT_FOUND");
      }
      if (!toLayerId || !getMotionLayer(composition, toLayerId)) {
        return fail("toLayerId must reference an existing layer", "NOT_FOUND");
      }
      const nextComposition = morphMotionLayers(composition, fromLayerId, toLayerId, {
        time: optionalNumber(args.time),
        duration: optionalNumber(args.duration),
      });
      if (!nextComposition) {
        return fail(
          "Cannot morph: layers are identical or do not both overlap the morph window",
          "INVALID_PARAMS",
        );
      }
      const commit = await commitMotionComposition(host, nextComposition);
      return commit.ok
        ? ok("Morphed layers", {
            compositionId: composition.id,
            fromLayerId,
            toLayerId,
          })
        : commit;
    },
  },
  {
    name: "add_motion_cursor_click",
    domain: "motion",
    title: "Add animated cursor click",
    description:
      "Drop an animated mouse cursor that travels to a target layer, click-presses on arrival, and makes the target react (a Click Press pulse) — the classic UI-demo 'a hand clicks the button' beat. The cursor is an image layer backed by a baked SVG pointer. targetLayerId; time (composition-absolute start, default 0), travel (seconds to reach the target, default 0.8), fromX/fromY (optional start point; defaults to up-and-left of the target). Returns the cursor layerId. Follow with disintegrate_motion_layer on the same target for click-then-disintegrate.",
    inputSchema: obj(
      { compositionId: str, targetLayerId: str, time: num, travel: num, fromX: num, fromY: num },
      ["compositionId", "targetLayerId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const targetLayerId = optionalString(args.targetLayerId);
      if (!targetLayerId || !getMotionLayer(composition, targetLayerId)) {
        return fail("targetLayerId must reference an existing layer", "NOT_FOUND");
      }
      const fromX = optionalNumber(args.fromX);
      const fromY = optionalNumber(args.fromY);
      const from =
        fromX !== undefined && fromY !== undefined ? { x: fromX, y: fromY } : undefined;
      const result = createCursorClick(composition, targetLayerId, {
        time: optionalNumber(args.time),
        travel: optionalNumber(args.travel),
        from,
      });
      if (!result) return fail("Unable to add cursor click for the target", "INVALID_PARAMS");
      const commit = await commitMotionComposition(host, result.composition);
      return commit.ok
        ? ok("Added animated cursor click", {
            compositionId: composition.id,
            cursorLayerId: result.cursorLayerId,
          })
        : commit;
    },
  },
  {
    name: "import_image_layer",
    domain: "motion",
    title: "Import image layer",
    description:
      "Add a real image (logo/screenshot/icon) into a composition from a public URL or a data: URI. Downloads it into the media library, registers a composition image asset, and creates an image layer. Optional: name, x, y (pixel center), width, height, fit (contain|cover|fill), cornerRadius (rounded-rect clip — a cheap way to put a photo inside a rounded screen without a track matte), startTime (seconds, default 0), duration (seconds, default the composition duration), rotation (degrees), opacity (0-1). Returns data.layerId and data.assetId.",
    inputSchema: obj({
      compositionId: str,
      url: str,
      name: str,
      x: num,
      y: num,
      width: num,
      height: num,
      fit: str,
      cornerRadius: num,
      startTime: num,
      duration: num,
      rotation: num,
      opacity: num,
    }, ["compositionId", "url"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const url = optionalString(args.url);
      if (!url) return fail("url is required", "INVALID_PARAMS");
      if (typeof host.importMediaFromUrl !== "function") {
        return fail("import_image_layer is not available in this host", "UNSUPPORTED");
      }
      const ref = await host.importMediaFromUrl(url, {
        name: optionalString(args.name),
      });
      if (ref.type !== "image") {
        return fail(
          `URL resolved to ${ref.type}, not an image`,
          "INVALID_PARAMS",
        );
      }
      const media = host
        .getProject()
        .mediaLibrary.items.find((item: MediaItem) => item.id === ref.mediaId);
      if (!media) {
        return fail("Imported media could not be resolved", "ERROR");
      }
      let asset: MotionAsset;
      try {
        asset = createMotionImageAssetFromMediaItem(media, genId());
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "Failed to create image asset",
          "INVALID_PARAMS",
        );
      }
      const rotation = optionalNumber(args.rotation);
      const opacity = optionalNumber(args.opacity);
      const startTime = Math.max(0, optionalNumber(args.startTime) ?? 0);
      const duration = Math.max(
        0.1,
        optionalNumber(args.duration) ?? composition.duration,
      );
      const imageLayer = createMotionImageLayerFromAsset(asset, {
        id: genId(),
        name: optionalString(args.name) ?? asset.name,
        startTime,
        duration,
        compositionWidth: composition.width,
        compositionHeight: composition.height,
        transform: {
          position: {
            x: optionalNumber(args.x) ?? composition.width / 2,
            y: optionalNumber(args.y) ?? composition.height / 2,
          },
          ...(rotation !== undefined ? { rotation } : {}),
          ...(opacity !== undefined ? { opacity: clampNumber(opacity, 0, 1) } : {}),
        },
      });
      const cornerRadius = optionalNumber(args.cornerRadius);
      const layer: MotionImageLayer = {
        ...imageLayer,
        width: optionalNumber(args.width) ?? imageLayer.width,
        height: optionalNumber(args.height) ?? imageLayer.height,
        fit: parseMotionFit(args.fit) ?? imageLayer.fit,
        ...(cornerRadius !== undefined && cornerRadius > 0
          ? { cornerRadius }
          : {}),
      };
      const committed: MotionComposition = {
        ...composition,
        assets: [...composition.assets, asset],
        layers: [...composition.layers, layer],
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, committed);
      return result.ok
        ? ok(`Imported image layer "${layer.name}"`, {
            compositionId: composition.id,
            layerId: layer.id,
            assetId: asset.id,
            mediaId: media.id,
          })
        : result;
    },
  }
];
