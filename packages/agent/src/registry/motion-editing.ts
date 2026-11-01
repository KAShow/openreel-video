import {
  RegisteredTool,
  bool,
  clampNumber,
  collectLayerIds,
  commitMotionComposition,
  fail,
  genId,
  getMotionComposition,
  getMotionLayer,
  motionTimingOptions,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  replaceMotionLayer,
  str,
} from "./shared";
import {
  type MotionComposition,
  type MotionFontFace,
  type MotionLayer,
  type MotionRotation3D,
} from "@openreel/core/motion/types";
import {
  addMotionCompositionGuide,
  createMotionGuide,
  moveMotionCompositionGuide,
  removeMotionCompositionGuide,
} from "@openreel/core/motion/motion-guides";
import {
  createMotionNullControllerForLayers,
} from "@openreel/core/motion/motion-hierarchy";
import {
  duplicateMotionLayers,
} from "@openreel/core/motion/motion-layer-commands";
import {
  moveMotionLayerInTime,
  rippleDeleteMotionLayer,
  rippleMotionLayers,
  splitMotionLayerAtTime,
  trimMotionLayerInPoint,
  trimMotionLayerOutPoint,
  updateMotionCompositionLayerTiming,
} from "@openreel/core/motion/motion-layer-timing";

export const motionEditingTools: RegisteredTool[] = [
  {
    name: "set_motion_layer_transform",
    domain: "motion",
    title: "Set motion layer transform",
    description:
      "Set a layer's static transform without keyframes. Optional: x, y (pixel center), z (depth for 3D-enabled layers), scale (uniform), scaleX, scaleY, rotation (degrees, Z axis), rotationX, rotationY, rotationZ (3D Euler degrees), perspective (camera distance in px for the preserve-3d container), opacity (0-1), anchorX, anchorY (pixels). Only the fields you pass change.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      x: num,
      y: num,
      z: num,
      scale: num,
      scaleX: num,
      scaleY: num,
      rotation: num,
      rotationX: num,
      rotationY: num,
      rotationZ: num,
      perspective: num,
      opacity: num,
      anchorX: num,
      anchorY: num,
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
      const transform = layer.transform;
      const x = optionalNumber(args.x);
      const y = optionalNumber(args.y);
      const z = optionalNumber(args.z);
      const scale = optionalNumber(args.scale);
      const scaleX = optionalNumber(args.scaleX) ?? scale;
      const scaleY = optionalNumber(args.scaleY) ?? scale;
      const rotation = optionalNumber(args.rotation);
      const rotationX = optionalNumber(args.rotationX);
      const rotationY = optionalNumber(args.rotationY);
      const rotationZ = optionalNumber(args.rotationZ);
      const perspective = optionalNumber(args.perspective);
      const opacity = optionalNumber(args.opacity);
      const anchorX = optionalNumber(args.anchorX);
      const anchorY = optionalNumber(args.anchorY);
      const hasRotation3d =
        rotationX !== undefined || rotationY !== undefined || rotationZ !== undefined;
      const baseRotation3d = transform.rotation3d ?? { x: 0, y: 0, z: 0 };
      const nextRotation3d: MotionRotation3D = {
        x: rotationX ?? baseRotation3d.x,
        y: rotationY ?? baseRotation3d.y,
        z: rotationZ ?? baseRotation3d.z ?? 0,
      };
      const nextLayer: MotionLayer = {
        ...layer,
        transform: {
          ...transform,
          position: {
            ...transform.position,
            x: x ?? transform.position.x,
            y: y ?? transform.position.y,
            ...(z !== undefined ? { z } : {}),
          },
          scale: {
            x: scaleX ?? transform.scale.x,
            y: scaleY ?? transform.scale.y,
          },
          rotation: rotation ?? transform.rotation,
          ...(hasRotation3d ? { rotation3d: nextRotation3d } : {}),
          ...(perspective !== undefined ? { perspective } : {}),
          opacity:
            opacity !== undefined ? clampNumber(opacity, 0, 1) : transform.opacity,
          anchor: {
            x: anchorX ?? transform.anchor.x,
            y: anchorY ?? transform.anchor.y,
          },
        },
      };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Set motion layer transform", {
            compositionId: composition.id,
            layerId: layer.id,
          })
        : result;
    },
  },
  {
    name: "set_motion_layer_name",
    domain: "motion",
    title: "Rename motion layer",
    description:
      "Rename any layer in a composition. name is the new label shown in the timeline/layer list (must be non-empty).",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      name: str,
    }, ["compositionId", "layerId", "name"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const name = optionalString(args.name)?.trim();
      if (!name) return fail("name must be a non-empty string", "INVALID_PARAMS");
      const nextLayer: MotionLayer = { ...layer, name };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Renamed layer to "${name}"`, {
            compositionId: composition.id,
            layerId: layer.id,
            name,
          })
        : result;
    },
  },
  {
    name: "duplicate_motion_layer",
    domain: "motion",
    title: "Duplicate motion layer",
    description:
      "Duplicate one or more layers (with their keyframes, effects, masks, and expressions). Pass either layerId (single) or layerIds (array). Groups duplicate their descendants too. Copies are offset 32px and named \"<name> Copy\". Returns duplicatedLayerIds (the new top-level copies, in request order).",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      layerIds: { type: "array", items: str },
    }, ["compositionId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerIds = collectLayerIds(args.layerId, args.layerIds);
      if (layerIds.length === 0) {
        return fail("Provide layerId or a non-empty layerIds array", "INVALID_PARAMS");
      }
      const missing = layerIds.find((id) => !getMotionLayer(composition, id));
      if (missing) return fail(`Motion layer not found: ${missing}`, "NOT_FOUND");
      const { composition: nextComposition, duplicatedLayerIds } =
        duplicateMotionLayers(composition, layerIds, {
          idFactory: () => genId(),
          keyframeIdFactory: () => genId(),
        });
      if (duplicatedLayerIds.length === 0) {
        return fail("No layers were duplicated", "INVALID_PARAMS");
      }
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Duplicated ${duplicatedLayerIds.length} layer(s)`, {
            compositionId: composition.id,
            duplicatedLayerIds,
          })
        : result;
    },
  },
  {
    name: "set_motion_layer_solo",
    domain: "motion",
    title: "Solo motion layer",
    description:
      "Toggle a layer's solo flag. solo=true isolates soloed layers in preview/render (all non-soloed, non-guide layers are hidden). solo=false clears it.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      solo: bool,
    }, ["compositionId", "layerId", "solo"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (typeof args.solo !== "boolean") {
        return fail("solo must be a boolean", "INVALID_PARAMS");
      }
      const nextLayer: MotionLayer = { ...layer, solo: args.solo };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(args.solo ? "Soloed layer" : "Cleared layer solo", {
            compositionId: composition.id,
            layerId: layer.id,
            solo: args.solo,
          })
        : result;
    },
  },
  {
    name: "set_motion_layer_guide",
    domain: "motion",
    title: "Toggle motion layer as guide",
    description:
      "Toggle a layer's guideLayer flag. guideLayer=true marks it a non-rendering reference layer (visible in the editor, excluded from export). guideLayer=false makes it render normally.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      guideLayer: bool,
    }, ["compositionId", "layerId", "guideLayer"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (typeof args.guideLayer !== "boolean") {
        return fail("guideLayer must be a boolean", "INVALID_PARAMS");
      }
      const nextLayer: MotionLayer = { ...layer, guideLayer: args.guideLayer };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(args.guideLayer ? "Marked layer as guide" : "Cleared guide layer", {
            compositionId: composition.id,
            layerId: layer.id,
            guideLayer: args.guideLayer,
          })
        : result;
    },
  },
  {
    name: "set_motion_layer_3d",
    domain: "motion",
    title: "Toggle motion layer preserve-3d",
    description:
      "Toggle a 2D layer's 3D container mode. preserve3d=true sets transform.transformStyle='preserve-3d' so the layer and its children compose in a shared 3D space (needed for nested 3D rotations/perspective). preserve3d=false resets to 'flat'.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      preserve3d: bool,
    }, ["compositionId", "layerId", "preserve3d"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (typeof args.preserve3d !== "boolean") {
        return fail("preserve3d must be a boolean", "INVALID_PARAMS");
      }
      const transformStyle = args.preserve3d ? "preserve-3d" : "flat";
      const nextLayer: MotionLayer = {
        ...layer,
        transform: { ...layer.transform, transformStyle },
      };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Set layer transformStyle to ${transformStyle}`, {
            compositionId: composition.id,
            layerId: layer.id,
            transformStyle,
          })
        : result;
    },
  },
  {
    name: "set_motion_layer_timing",
    domain: "motion",
    title: "Set motion layer timing",
    description:
      "Move a layer on the timeline by setting its startTime and/or duration (seconds). Values snap to the composition frame rate and are clamped to be non-negative; duration and the resulting out point are clamped to the composition duration. Pass at least one of startTime, duration; only the fields you pass change.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      startTime: num,
      duration: num,
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
      const startTime = optionalNumber(args.startTime);
      const duration = optionalNumber(args.duration);
      if (startTime === undefined && duration === undefined) {
        return fail("Provide startTime and/or duration", "INVALID_PARAMS");
      }
      const timing = motionTimingOptions(composition);
      const nextComposition = updateMotionCompositionLayerTiming(
        composition,
        layer.id,
        (current) => {
          const withDuration =
            duration !== undefined
              ? trimMotionLayerOutPoint(
                  current,
                  current.startTime + Math.max(0, duration),
                  timing,
                )
              : current;
          return startTime !== undefined
            ? moveMotionLayerInTime(withDuration, startTime, timing)
            : withDuration;
        },
      );
      const nextLayer = getMotionLayer(nextComposition, layer.id);
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Set motion layer timing", {
            compositionId: composition.id,
            layerId: layer.id,
            startTime: nextLayer?.startTime,
            duration: nextLayer?.duration,
          })
        : result;
    },
  },
  {
    name: "trim_motion_layer",
    domain: "motion",
    title: "Trim motion layer edge",
    description:
      "Trim a layer's in or out point to a composition-time (seconds). edge='in' moves startTime to time (holding the out point fixed); edge='out' moves the end to time (holding startTime fixed). Values snap to the frame rate; a minimum duration is enforced.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      edge: str,
      time: num,
    }, ["compositionId", "layerId", "edge", "time"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const edge = optionalString(args.edge);
      if (edge !== "in" && edge !== "out") {
        return fail("edge must be 'in' or 'out'", "INVALID_PARAMS");
      }
      const time = optionalNumber(args.time);
      if (time === undefined) return fail("time is required", "INVALID_PARAMS");
      const timing = motionTimingOptions(composition);
      const nextComposition = updateMotionCompositionLayerTiming(
        composition,
        layer.id,
        (current) =>
          edge === "in"
            ? trimMotionLayerInPoint(current, time, timing)
            : trimMotionLayerOutPoint(current, time, timing),
      );
      const nextLayer = getMotionLayer(nextComposition, layer.id);
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Trimmed layer ${edge} point`, {
            compositionId: composition.id,
            layerId: layer.id,
            startTime: nextLayer?.startTime,
            duration: nextLayer?.duration,
          })
        : result;
    },
  },
  {
    name: "split_motion_layer",
    domain: "motion",
    title: "Split motion layer",
    description:
      "Split a layer into two at a composition-time (seconds). The original keeps the first half; a new layer covers the second half (with its keyframes shifted). time must fall strictly inside the layer's span. Returns layerIds: [firstHalfId, secondHalfId].",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      time: num,
    }, ["compositionId", "layerId", "time"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const time = optionalNumber(args.time);
      if (time === undefined) return fail("time is required", "INVALID_PARAMS");
      const nextComposition = splitMotionLayerAtTime(composition, layer.id, time, {
        ...motionTimingOptions(composition),
        idFactory: () => genId(),
        keyframeIdFactory: () => genId(),
        nameSuffix: " (2)",
      });
      if (!nextComposition) {
        return fail(
          "time must fall strictly inside the layer's span",
          "INVALID_PARAMS",
        );
      }
      const firstIndex = nextComposition.layers.findIndex((l) => l.id === layer.id);
      const secondLayer = nextComposition.layers[firstIndex + 1];
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Split motion layer", {
            compositionId: composition.id,
            layerIds: [layer.id, secondLayer?.id].filter(
              (id): id is string => Boolean(id),
            ),
          })
        : result;
    },
  },
  {
    name: "slip_motion_layer",
    domain: "motion",
    title: "Slip motion layer",
    description:
      "Slip a layer's source content by delta seconds while holding its timeline startTime and duration fixed (shifts the layer's timeOffset by delta scaled by playbackRate). Only layers with a source time offset (precomp/composition and video layers) can slip; others are rejected.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      delta: num,
    }, ["compositionId", "layerId", "delta"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const delta = optionalNumber(args.delta);
      if (delta === undefined) return fail("delta is required", "INVALID_PARAMS");
      if (layer.type !== "composition" && layer.type !== "video") {
        return fail(
          "slip only applies to composition (precomp) or video layers",
          "INVALID_PARAMS",
        );
      }
      const currentOffset =
        typeof (layer as { timeOffset?: number }).timeOffset === "number"
          ? (layer as { timeOffset?: number }).timeOffset ?? 0
          : 0;
      const playbackRate = (layer as { playbackRate?: number }).playbackRate ?? 1;
      const nextOffset = Number((currentOffset + delta * playbackRate).toFixed(4));
      const nextLayer = {
        ...layer,
        timeOffset: nextOffset,
      } as MotionLayer;
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Slipped motion layer", {
            compositionId: composition.id,
            layerId: layer.id,
            timeOffset: nextOffset,
          })
        : result;
    },
  },
  {
    name: "ripple_delete_motion_layer",
    domain: "motion",
    title: "Ripple delete motion layer",
    description:
      "Delete a layer and pull every later layer earlier by the deleted layer's duration, closing the gap it left (AE ripple delete). Locked layers are held in place unless includeLocked=true.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      includeLocked: bool,
    }, ["compositionId", "layerId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const includeLocked =
        typeof args.includeLocked === "boolean" ? args.includeLocked : undefined;
      const nextComposition = rippleDeleteMotionLayer(composition, layer.id, {
        ...motionTimingOptions(composition),
        includeLocked,
      });
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Ripple-deleted layer "${layer.name}"`, {
            compositionId: composition.id,
            removedLayerId: layer.id,
          })
        : result;
    },
  },
  {
    name: "ripple_motion_layers",
    domain: "motion",
    title: "Ripple motion layers",
    description:
      "Shift every layer whose startTime is at or after fromTime (seconds) later or earlier by delta seconds, opening or closing time as a block (AE ripple insert/remove). Positive delta pushes layers later; negative pulls them earlier. Locked layers are held in place unless includeLocked=true; excludeLayerIds pins specific layers regardless. delta must be non-zero.",
    inputSchema: obj(
      {
        compositionId: str,
        fromTime: num,
        delta: num,
        excludeLayerIds: { type: "array", items: str },
        includeLocked: bool,
      },
      ["compositionId", "fromTime", "delta"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const fromTime = optionalNumber(args.fromTime);
      if (fromTime === undefined) return fail("fromTime is required", "INVALID_PARAMS");
      const delta = optionalNumber(args.delta);
      if (delta === undefined) return fail("delta is required", "INVALID_PARAMS");
      if (delta === 0) return fail("delta must be non-zero", "INVALID_PARAMS");
      const excludeLayerIds = Array.isArray(args.excludeLayerIds)
        ? args.excludeLayerIds.filter((id): id is string => typeof id === "string")
        : undefined;
      const includeLocked =
        typeof args.includeLocked === "boolean" ? args.includeLocked : undefined;
      const nextComposition = rippleMotionLayers(composition, {
        ...motionTimingOptions(composition),
        fromTime,
        deltaSeconds: delta,
        excludeLayerIds,
        includeLocked,
      });
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Rippled motion layers", {
            compositionId: composition.id,
            fromTime,
            delta,
          })
        : result;
    },
  },
  {
    name: "create_motion_null_controller",
    domain: "motion",
    title: "Create null controller for layers",
    description:
      "Create a null layer positioned at the average of the given layers and parent all of them to it, so transforming the null drives them together (AE null-object rig). layerIds is required (non-null layers only). Optional: name, guideColor (#hex). Returns controllerLayerId.",
    inputSchema: obj({
      compositionId: str,
      layerIds: { type: "array", items: str },
      name: str,
      guideColor: str,
    }, ["compositionId", "layerIds"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerIds = collectLayerIds(undefined, args.layerIds);
      if (layerIds.length === 0) {
        return fail("layerIds must be a non-empty array", "INVALID_PARAMS");
      }
      const result = createMotionNullControllerForLayers(composition, layerIds, {
        name: optionalString(args.name),
        guideColor: optionalString(args.guideColor),
      });
      if (!result) {
        return fail(
          "No non-null layers found to control",
          "INVALID_PARAMS",
        );
      }
      const committed = await commitMotionComposition(host, result.composition);
      return committed.ok
        ? ok("Created null controller", {
            compositionId: composition.id,
            controllerLayerId: result.controllerLayerId,
          })
        : committed;
    },
  },
  {
    name: "add_motion_guide",
    domain: "motion",
    title: "Add composition guide",
    description:
      "Add a ruler guide to the composition canvas. orientation is 'vertical' (a vertical line at x=position) or 'horizontal' (a horizontal line at y=position); position is in pixels. Optional: color (#hex), locked. Returns guideId.",
    inputSchema: obj({
      compositionId: str,
      orientation: str,
      position: num,
      color: str,
      locked: bool,
    }, ["compositionId", "orientation", "position"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const orientation = optionalString(args.orientation);
      if (orientation !== "vertical" && orientation !== "horizontal") {
        return fail(
          "orientation must be 'vertical' or 'horizontal'",
          "INVALID_PARAMS",
        );
      }
      const position = optionalNumber(args.position);
      if (position === undefined) return fail("position is required", "INVALID_PARAMS");
      const guide = createMotionGuide(orientation, position, {
        color: optionalString(args.color),
        locked: typeof args.locked === "boolean" ? args.locked : undefined,
      });
      const result = await commitMotionComposition(
        host,
        addMotionCompositionGuide(composition, guide),
      );
      return result.ok
        ? ok("Added composition guide", {
            compositionId: composition.id,
            guideId: guide.id,
            orientation,
            position: guide.position,
          })
        : result;
    },
  },
  {
    name: "move_motion_guide",
    domain: "motion",
    title: "Move composition guide",
    description:
      "Move an existing composition guide to a new position (pixels along its axis). Clamped to the composition bounds. Locked guides do not move unless includeLocked=true.",
    inputSchema: obj({
      compositionId: str,
      guideId: str,
      position: num,
      includeLocked: bool,
    }, ["compositionId", "guideId", "position"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const guideId = optionalString(args.guideId);
      if (!guideId) return fail("guideId is required", "INVALID_PARAMS");
      if (!(composition.guides ?? []).some((guide) => guide.id === guideId)) {
        return fail("Composition guide not found", "NOT_FOUND");
      }
      const position = optionalNumber(args.position);
      if (position === undefined) return fail("position is required", "INVALID_PARAMS");
      const nextComposition = moveMotionCompositionGuide(
        composition,
        guideId,
        position,
        {
          includeLocked:
            typeof args.includeLocked === "boolean" ? args.includeLocked : undefined,
        },
      );
      const moved = (nextComposition.guides ?? []).find(
        (guide) => guide.id === guideId,
      );
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Moved composition guide", {
            compositionId: composition.id,
            guideId,
            position: moved?.position,
          })
        : result;
    },
  },
  {
    name: "remove_motion_guide",
    domain: "motion",
    title: "Remove composition guide",
    description:
      "Remove a ruler guide from the composition canvas by guideId.",
    inputSchema: obj({
      compositionId: str,
      guideId: str,
    }, ["compositionId", "guideId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const guideId = optionalString(args.guideId);
      if (!guideId) return fail("guideId is required", "INVALID_PARAMS");
      if (!(composition.guides ?? []).some((guide) => guide.id === guideId)) {
        return fail("Composition guide not found", "NOT_FOUND");
      }
      const result = await commitMotionComposition(
        host,
        removeMotionCompositionGuide(composition, guideId),
      );
      return result.ok
        ? ok("Removed composition guide", {
            compositionId: composition.id,
            guideId,
          })
        : result;
    },
  },
  {
    name: "set_motion_scene3d_lighting",
    domain: "motion",
    title: "Set 3D scene lighting & environment",
    description:
      "Set lighting + image-based environment on a scene3d layer (EEVEE-class Three.js renderer). Optional: environment (studio|warm|cool|sunset|city|dark|none), environmentUrl (equirect .hdr/.exr/.jpg/.png world map for reflections + lighting), environmentBackground (show the env as the backdrop), groundShadow, ambient, keyIntensity, rimIntensity (0-10), keyColor (#hex). Only the fields you pass change.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        environment: str,
        environmentUrl: str,
        environmentBackground: bool,
        groundShadow: bool,
        ambient: num,
        keyIntensity: num,
        rimIntensity: num,
        keyColor: str,
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
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      if (layer.type !== "scene3d") {
        return fail("Layer is not a scene3d layer", "INVALID_PARAMS");
      }
      const VALID_ENVIRONMENTS: ReadonlySet<string> = new Set([
        "studio",
        "warm",
        "cool",
        "sunset",
        "city",
        "dark",
        "none",
      ]);
      const environment = optionalString(args.environment);
      if (environment !== undefined && !VALID_ENVIRONMENTS.has(environment)) {
        return fail(
          `Unknown environment "${environment}" (expected studio|warm|cool|sunset|city|dark|none)`,
          "INVALID_PARAMS",
        );
      }
      const environmentUrl = optionalString(args.environmentUrl);
      const keyColor = optionalString(args.keyColor);
      const ambient = optionalNumber(args.ambient);
      const keyIntensity = optionalNumber(args.keyIntensity);
      const rimIntensity = optionalNumber(args.rimIntensity);
      const environmentBackground =
        typeof args.environmentBackground === "boolean"
          ? args.environmentBackground
          : undefined;
      const groundShadow =
        typeof args.groundShadow === "boolean" ? args.groundShadow : undefined;

      const nextLighting: NonNullable<typeof layer.lighting> = {
        ...layer.lighting,
        ...(environment !== undefined
          ? { environment: environment as NonNullable<typeof layer.lighting>["environment"] }
          : {}),
        ...(environmentUrl !== undefined ? { environmentUrl } : {}),
        ...(environmentBackground !== undefined ? { environmentBackground } : {}),
        ...(groundShadow !== undefined ? { groundShadow } : {}),
        ...(ambient !== undefined ? { ambient: clampNumber(ambient, 0, 3) } : {}),
        ...(keyIntensity !== undefined
          ? { keyIntensity: clampNumber(keyIntensity, 0, 10) }
          : {}),
        ...(rimIntensity !== undefined
          ? { rimIntensity: clampNumber(rimIntensity, 0, 10) }
          : {}),
        ...(keyColor !== undefined ? { keyColor } : {}),
      };
      const nextLayer: MotionLayer = { ...layer, lighting: nextLighting };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Set 3D scene lighting", {
            compositionId: composition.id,
            layerId: layer.id,
            lighting: nextLighting,
          })
        : result;
    },
  },
  {
    name: "reorder_motion_layer",
    domain: "motion",
    title: "Reorder motion layer",
    description:
      "Change a layer's stacking order in the composition. mode is front | back | forward | backward | to-index (with index). Later layers in composition.layers render on top.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      mode: str,
      index: num,
    }, ["compositionId", "layerId", "mode"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerId = optionalString(args.layerId);
      if (!layerId) return fail("layerId is required", "INVALID_PARAMS");
      const currentIndex = composition.layers.findIndex(
        (layer) => layer.id === layerId,
      );
      if (currentIndex < 0) return fail("Motion layer not found", "NOT_FOUND");
      const mode = optionalString(args.mode);
      if (
        mode !== "front" &&
        mode !== "back" &&
        mode !== "forward" &&
        mode !== "backward" &&
        mode !== "to-index"
      ) {
        return fail(
          "mode must be front, back, forward, backward, or to-index",
          "INVALID_PARAMS",
        );
      }
      const lastIndex = composition.layers.length - 1;
      let targetIndex: number;
      switch (mode) {
        case "front":
          targetIndex = lastIndex;
          break;
        case "back":
          targetIndex = 0;
          break;
        case "forward":
          targetIndex = Math.min(lastIndex, currentIndex + 1);
          break;
        case "backward":
          targetIndex = Math.max(0, currentIndex - 1);
          break;
        default: {
          const index = optionalNumber(args.index);
          if (index === undefined) {
            return fail("to-index requires a numeric index", "INVALID_PARAMS");
          }
          targetIndex = clampNumber(Math.round(index), 0, lastIndex);
          break;
        }
      }
      const nextLayers = [...composition.layers];
      const [moved] = nextLayers.splice(currentIndex, 1);
      nextLayers.splice(targetIndex, 0, moved);
      const result = await commitMotionComposition(host, {
        ...composition,
        layers: nextLayers,
      });
      return result.ok
        ? ok(`Reordered layer (${mode})`, {
            compositionId: composition.id,
            layerId,
            index: targetIndex,
          })
        : result;
    },
  },
  {
    name: "remove_motion_layer",
    domain: "motion",
    title: "Remove motion layer",
    description:
      "Delete one or more layers from a composition. Pass `layerId` and/or `layerIds` (array). Child layers parented to a removed layer are removed too, and dangling track-matte references are cleared. Use to clean up starter layers or iterate on a build.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        layerIds: { type: "array", items: { type: "string" } },
      },
      ["compositionId"],
    ),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const requested = new Set<string>();
      const single = optionalString(args.layerId);
      if (single) requested.add(single);
      if (Array.isArray(args.layerIds)) {
        for (const entry of args.layerIds) {
          if (typeof entry === "string" && entry.length > 0) requested.add(entry);
        }
      }
      if (requested.size === 0) {
        return fail("layerId or layerIds is required", "INVALID_PARAMS");
      }
      const known = new Set(composition.layers.map((layer) => layer.id));
      const missing = [...requested].filter((id) => !known.has(id));
      if (missing.length > 0) {
        return fail(`Motion layer not found: ${missing.join(", ")}`, "NOT_FOUND");
      }
      const removeIds = new Set<string>(requested);
      let changed = true;
      while (changed) {
        changed = false;
        for (const layer of composition.layers) {
          if (
            !removeIds.has(layer.id) &&
            layer.parentId &&
            removeIds.has(layer.parentId)
          ) {
            removeIds.add(layer.id);
            changed = true;
          }
        }
      }
      const nextLayers = composition.layers
        .filter((layer) => !removeIds.has(layer.id))
        .map((layer) =>
          layer.trackMatte && removeIds.has(layer.trackMatte.sourceLayerId)
            ? { ...layer, trackMatte: undefined }
            : layer,
        );
      const result = await commitMotionComposition(host, {
        ...composition,
        layers: nextLayers,
      });
      return result.ok
        ? ok(`Removed ${removeIds.size} layer${removeIds.size > 1 ? "s" : ""}`, {
            compositionId: composition.id,
            removedLayerIds: [...removeIds],
          })
        : result;
    },
  },
  {
    name: "update_motion_composition",
    domain: "motion",
    title: "Update motion composition",
    description:
      "Update a composition's top-level settings. Optional: name, width, height, frameRate, duration, backgroundColor. Only the fields you pass change.",
    inputSchema: obj({
      compositionId: str,
      name: str,
      width: num,
      height: num,
      frameRate: num,
      duration: num,
      backgroundColor: str,
    }, ["compositionId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const name = optionalString(args.name);
      const width = optionalNumber(args.width);
      const height = optionalNumber(args.height);
      const frameRate = optionalNumber(args.frameRate);
      const duration = optionalNumber(args.duration);
      const backgroundColor = optionalString(args.backgroundColor);
      const nextComposition: MotionComposition = {
        ...composition,
        name: name ?? composition.name,
        width: width !== undefined ? Math.max(1, Math.round(width)) : composition.width,
        height:
          height !== undefined ? Math.max(1, Math.round(height)) : composition.height,
        frameRate:
          frameRate !== undefined ? Math.max(1, frameRate) : composition.frameRate,
        duration:
          duration !== undefined ? Math.max(0, duration) : composition.duration,
        backgroundColor: backgroundColor ?? composition.backgroundColor,
      };
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Updated motion composition", {
            compositionId: composition.id,
          })
        : result;
    },
  },
  {
    name: "import_motion_font",
    domain: "motion",
    title: "Import motion font",
    description:
      "Register a custom font on a composition so text layers can use it. Inputs: family (required), source (required URL or data: URI for a woff2/woff/ttf/otf), weight?, style? (normal|italic). Appends to composition.fonts.",
    inputSchema: obj({
      compositionId: str,
      family: str,
      source: str,
      weight: {},
      style: str,
    }, ["compositionId", "family", "source"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const family = optionalString(args.family);
      if (!family) return fail("family is required", "INVALID_PARAMS");
      const source = optionalString(args.source);
      if (!source) return fail("source is required", "INVALID_PARAMS");
      const styleValue = optionalString(args.style);
      if (styleValue !== undefined && styleValue !== "normal" && styleValue !== "italic") {
        return fail("style must be normal or italic", "INVALID_PARAMS");
      }
      const weight =
        typeof args.weight === "number" && Number.isFinite(args.weight)
          ? args.weight
          : optionalString(args.weight);
      const font: MotionFontFace = {
        family,
        source,
        ...(weight !== undefined ? { weight } : {}),
        ...(styleValue !== undefined ? { style: styleValue } : {}),
      };
      const existing = composition.fonts ?? [];
      const nextFonts = [
        ...existing.filter(
          (candidate) =>
            !(candidate.family === family && (candidate.style ?? "normal") === (styleValue ?? "normal")),
        ),
        font,
      ];
      const result = await commitMotionComposition(host, {
        ...composition,
        fonts: nextFonts,
      });
      return result.ok
        ? ok(`Imported font "${family}"`, {
            compositionId: composition.id,
            family,
          })
        : result;
    },
  }
];
