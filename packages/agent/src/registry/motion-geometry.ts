import {
  MOTION_ANIMATION_PRESET_IDS,
  MOTION_SHAPE_TYPES,
  RegisteredTool,
  SCENE_CAMERA_POSITION_DEFAULT,
  SCENE_CAMERA_TARGET_DEFAULT,
  SCENE_OBJECT_POSITION_DEFAULT,
  SCENE_OBJECT_ROTATION_DEFAULT,
  SCENE_OBJECT_SCALE_DEFAULT,
  applyCreationOperations,
  applyMotionAction,
  asRecord,
  bool,
  buildCreationDraftEntryFromMotionObject,
  buildCreationDraftFromMotionSceneLayer,
  buildSceneObject3D,
  clampNumber,
  commitMotionComposition,
  creationState,
  ensureCreationBindingForMotionSceneLayer,
  fail,
  findCreationBindingForMotionSceneLayer,
  genId,
  getMotionComposition,
  getMotionLayer,
  idSegment,
  isValidEasing,
  mergeSceneKeyframes,
  mergeSceneVector3,
  motionModelAnimationFromArgs,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  parseSceneCamera,
  parseSceneRoom,
  parseShapePathPoints,
  parseStringArray,
  persistMotionSceneCreationDraft,
  replaceMotionLayer,
  resolveCreationParentId,
  resolveShapePathData,
  sceneScalarKeyframes,
  sceneVec3Keyframes,
  str,
  syncLegacyMotionSceneCameraAnimationToCreation,
  syncLegacyMotionSceneObjectAnimationToCreation,
  uniqueIdSegment,
  updateCreationAssetGeometry,
} from "./shared";
import {
  type CreationRenderBinding,
  type CreationScene,
  type CreationSceneObject,
} from "@openreel/core/creation/index";
import {
  MOTION_OBJECT_3D_KINDS,
  createMotionScene3DLayer,
} from "@openreel/core/motion/motion-scene3d";
import {
  type MotionAnimationPresetId,
  applyMotionAnimationPreset,
  canApplyMotionAnimationPreset,
  getMotionAnimationPreset,
} from "@openreel/core/motion/motion-animation-presets";
import {
  type MotionComposition,
  type MotionLayer,
  type MotionMaterial3D,
  type MotionObject3D,
  type MotionObject3DKind,
  type MotionScene3DCamera,
  type MotionScene3DLayer,
  type MotionSceneObject3D,
  type MotionSceneObject3DTransform,
  type MotionShapeLayer,
} from "@openreel/core/motion/types";
import {
  type MotionShapePathPoint,
  buildMotionPathData,
  getEditableMotionShapePathPoints,
  insertMotionShapePathPoint,
  removeMotionShapePathPoint,
  setMotionShapePathPoint,
  setMotionShapePathPointHandle,
  setMotionShapePathPoints,
  upsertMotionShapePathKeyframe,
} from "@openreel/core/motion/motion-shape-path";
import {
  type ShapeType,
} from "@openreel/core/graphics/types";
import {
  buildMotionShapePolyline,
} from "@openreel/core/motion/motion-shape-modifiers";
import {
  copyMotionPropertyKeyframes,
  duplicateMotionLayerPropertyKeyframes,
  getMotionLayerPropertyKeyframes,
  isMotionAnimatableProperty,
  pasteMotionLayerPropertyKeyframes,
  reverseMotionLayerPropertyKeyframes,
  scaleMotionLayerPropertyKeyframeTimes,
} from "@openreel/core/motion/motion-keyframes";

export const motionGeometryTools: RegisteredTool[] = [
  {
    name: "add_motion_3d_object",
    domain: "motion",
    title: "Add a real 3D object",
    description:
      "Add a TRUE 3D object (WebGL/Three.js under the hood) to a composition — it renders with real depth and rotates so every side is visible (unlike the 2.5D layers). `object` is one of box | rounded-box | sphere | cylinder | cone | torus | icosahedron | plane | phone (a full iPhone-style device with screen + camera plateau) | model (load ANY .glb/.gltf via modelUrl — auto-centered and scaled to fit) | text3d (extruded 3D text via `text`, with `extrude` depth). Declarative — you describe it, the engine does the WebGL. Optional: name, x, y (pixel center), width, height (render bounds), size/depth/aspect/cornerRadius (geometry), color, metalness (0..1), roughness (0..1), materialKind (physical|basic), emissive, mapAssetId (an image asset id to texture onto the phone screen, e.g. a wallpaper from import_image_layer), rotationX/Y/Z (initial degrees), fov, cameraDistance, environment (studio|dark|none — studio gives realistic reflections on metal/glass), groundShadow (true drops a soft contact shadow under the object), startTime, duration. Animate the spin with animate_layer property 'transform.rotation.y' (or .x/.z) — e.g. 0→360 over 4s shows the whole device turning in 3D. ZOOM/DOLLY: keyframe 'transform.position.z' — +1 pushes the camera 2x closer (zoom in), +2 = 4x, negative pulls back. Combine a position.z 0→1.5 ramp with a rotation.y tilt for a cinematic push-in.",
    inputSchema: obj(
      {
        compositionId: str,
        object: str,
        name: str,
        x: num,
        y: num,
        width: num,
        height: num,
        size: num,
        depth: num,
        aspect: num,
        cornerRadius: num,
        modelUrl: str,
        animationClipName: str,
        animationClipIndex: num,
        animationTimeOffset: num,
        animationPlaybackRate: num,
        animationLoop: bool,
        text: str,
        extrude: num,
        panelTexts: { type: "array" },
        color: str,
        metalness: num,
        roughness: num,
        materialKind: str,
        emissive: str,
        mapAssetId: str,
        rotationX: num,
        rotationY: num,
        rotationZ: num,
        fov: num,
        cameraDistance: num,
        environment: str,
        groundShadow: bool,
        startTime: num,
        duration: num,
      },
      ["compositionId", "object"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const kind = optionalString(args.object);
      if (!kind || !MOTION_OBJECT_3D_KINDS.includes(kind as never)) {
        return fail(
          `object must be one of: ${MOTION_OBJECT_3D_KINDS.join(", ")}`,
          "INVALID_PARAMS",
        );
      }
      if (kind === "model" && !optionalString(args.modelUrl)) {
        return fail("object 'model' requires a modelUrl (.glb/.gltf)", "INVALID_PARAMS");
      }
      if (kind === "text3d" && !optionalString(args.text)) {
        return fail("object 'text3d' requires a text string", "INVALID_PARAMS");
      }
      if (kind === "room" || kind === "open-box") {
        return fail(
          `object '${kind}' only makes sense inside a multi-object scene — use add_motion_3d_scene instead`,
          "INVALID_PARAMS",
        );
      }
      const materialKind =
        optionalString(args.materialKind) === "basic" ? "basic" : "physical";
      const environment = optionalString(args.environment);
      const lighting =
        environment || args.groundShadow === true
          ? {
              environment:
                environment === "dark" || environment === "none"
                  ? (environment as "dark" | "none")
                  : ("studio" as const),
              groundShadow: args.groundShadow === true,
            }
          : undefined;
      const layer = createMotionScene3DLayer({
        id: genId(),
        name: optionalString(args.name),
        startTime: optionalNumber(args.startTime),
        duration: optionalNumber(args.duration) ?? composition.duration,
        compositionWidth: composition.width,
        compositionHeight: composition.height,
        object: {
          kind: kind as never,
          size: optionalNumber(args.size),
          depth: optionalNumber(args.depth),
          aspect: optionalNumber(args.aspect),
          cornerRadius: optionalNumber(args.cornerRadius),
          modelUrl: optionalString(args.modelUrl),
          animation:
            kind === "model"
              ? motionModelAnimationFromArgs(args as Record<string, unknown>)
              : undefined,
          text: optionalString(args.text),
          extrude: optionalNumber(args.extrude),
          panelTexts: parseStringArray(args.panelTexts),
        },
        material: {
          kind: materialKind,
          color: optionalString(args.color),
          metalness: optionalNumber(args.metalness),
          roughness: optionalNumber(args.roughness),
          mapAssetId: optionalString(args.mapAssetId),
          emissive: optionalString(args.emissive),
        },
        lighting,
        x: optionalNumber(args.x),
        y: optionalNumber(args.y),
        width: optionalNumber(args.width),
        height: optionalNumber(args.height),
        rotationX: optionalNumber(args.rotationX),
        rotationY: optionalNumber(args.rotationY),
        rotationZ: optionalNumber(args.rotationZ),
        fov: optionalNumber(args.fov),
        cameraDistance: optionalNumber(args.cameraDistance),
      });
      const committed: MotionComposition = {
        ...composition,
        layers: [...composition.layers, layer],
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, committed);
      return result.ok
        ? ok(`Added 3D ${kind}`, {
            compositionId: composition.id,
            layerId: layer.id,
          })
        : result;
    },
  },
  {
    name: "morph_motion_shape",
    domain: "motion",
    title: "Morph a shape into another shape",
    description:
      "Animate a shape MORPHING into a different shape (After Effects-style path morph): the outline smoothly transforms, point-by-point, from one form to another. Give the source shape (layerId) and a target — toLayerId (morph into another shape layer's outline), toShapeType (rectangle|circle|ellipse|triangle|polygon|star|arrow|line, built at toWidth×toHeight, defaulting to the source size), or toPath (an explicit SVG path string centered at the origin — supply any custom outline, e.g. a logo or icon). Morph runs fromTime (default 0) → toTime with optional easing. Works between completely different shapes (arc-length resampling). Pair with a 'lift' — animate transform.position.z and transform.scale — to pop a button off a UI surface and then morph it into an icon.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        toLayerId: str,
        toShapeType: str,
        toPath: str,
        toWidth: num,
        toHeight: num,
        fromTime: num,
        toTime: num,
        easing: str,
      },
      ["compositionId", "layerId", "toTime"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerId = optionalString(args.layerId);
      const source = composition.layers.find((entry) => entry.id === layerId);
      if (!source || source.type !== "shape") {
        return fail("layerId must reference a shape layer", "INVALID_PARAMS");
      }
      const fromTime = Math.max(0, optionalNumber(args.fromTime) ?? 0);
      const toTime = optionalNumber(args.toTime);
      if (toTime === undefined || toTime <= fromTime) {
        return fail("toTime must be greater than fromTime", "INVALID_PARAMS");
      }
      const easing = optionalString(args.easing);
      const resolvedEasing =
        easing && isValidEasing(easing) ? easing : undefined;

      const sourcePath = buildMotionPathData(
        buildMotionShapePolyline(source, 64, fromTime),
      );
      if (!sourcePath) {
        return fail("Could not derive a path from the source shape", "INVALID_PARAMS");
      }

      let targetPath: string | undefined;
      const toLayerId = optionalString(args.toLayerId);
      const toShapeType = optionalString(args.toShapeType);
      const toPath = optionalString(args.toPath);
      if (toPath) {
        targetPath = toPath;
      } else if (toLayerId) {
        const targetLayer = composition.layers.find(
          (entry) => entry.id === toLayerId,
        );
        if (!targetLayer || targetLayer.type !== "shape") {
          return fail("toLayerId must reference a shape layer", "INVALID_PARAMS");
        }
        targetPath = buildMotionPathData(
          buildMotionShapePolyline(targetLayer, 64, toTime),
        );
      } else if (toShapeType) {
        if (!MOTION_SHAPE_TYPES.has(toShapeType as ShapeType)) {
          return fail(`toShapeType is invalid: ${toShapeType}`, "INVALID_PARAMS");
        }
        const synthetic: MotionShapeLayer = {
          ...source,
          shapeType: toShapeType as ShapeType,
          pathData: undefined,
          width: optionalNumber(args.toWidth) ?? source.width,
          height: optionalNumber(args.toHeight) ?? source.height,
          keyframes: [],
        };
        targetPath = buildMotionPathData(buildMotionShapePolyline(synthetic, 64, 0));
      } else {
        return fail("Provide one of toLayerId, toShapeType, or toPath", "INVALID_PARAMS");
      }
      if (!targetPath) {
        return fail("Could not derive a target path", "INVALID_PARAMS");
      }

      let morphLayer: MotionShapeLayer = {
        ...source,
        shapeType: "path",
        pathData: sourcePath,
        pathClosed: source.pathClosed ?? true,
        keyframes: source.keyframes.filter(
          (keyframe) => keyframe.property !== "shape.pathData",
        ),
      };
      morphLayer = upsertMotionShapePathKeyframe(morphLayer, fromTime, {
        pathData: sourcePath,
        easing: resolvedEasing,
      });
      morphLayer = upsertMotionShapePathKeyframe(morphLayer, toTime, {
        pathData: targetPath,
        easing: resolvedEasing,
      });

      const committed: MotionComposition = {
        ...composition,
        layers: composition.layers.map((entry) =>
          entry.id === source.id ? morphLayer : entry,
        ),
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, committed);
      return result.ok
        ? ok(
            `Morphing shape ${source.id} from ${fromTime}s to ${toTime}s`,
            { compositionId: composition.id, layerId: source.id },
          )
        : result;
    },
  },
  {
    name: "set_motion_shape_path",
    domain: "motion",
    title: "Set bezier shape path",
    description:
      "Replace the whole outline of a bezier PEN shape layer (shapeType 'path'). points is an array of >=2 finite {x,y,inX?,inY?,outX?,outY?} vertices in layer-local pixel coordinates, where inX/inY and outX/outY are ABSOLUTE bezier control-handle coordinates (in = handle from the previous point, out = handle toward the next point); omit handles for straight corners. closed (default keeps the layer's current pathClosed) marks the path as a closed loop. The layer must have shapeType:'path' — create one via add_motion_layer with shapeType:'path'.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        points: { type: "array" },
        closed: bool,
      },
      ["compositionId", "layerId", "points"],
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
      if (layer.type !== "shape" || layer.shapeType !== "path") {
        return fail("layerId must reference a shapeType:'path' layer", "INVALID_PARAMS");
      }
      const points = parseShapePathPoints(args.points);
      if (!points) {
        return fail(
          "points must be an array of >=2 finite {x,y,inX?,inY?,outX?,outY?} vertices",
          "INVALID_PARAMS",
        );
      }
      const closedRaw = args.closed;
      const nextClosed =
        closedRaw === undefined ? layer.pathClosed : closedRaw === true;
      const withPath = setMotionShapePathPoints(layer, points);
      const nextLayer: MotionShapeLayer = { ...withPath, pathClosed: nextClosed };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Set path on shape "${layer.name}" (${points.length} points)`, {
            compositionId: composition.id,
            layerId: layer.id,
            pointCount: points.length,
            pathClosed: nextClosed ?? false,
          })
        : result;
    },
  },
  {
    name: "edit_motion_shape_path_point",
    domain: "motion",
    title: "Edit bezier shape path point",
    description:
      "Edit a single vertex (by index, 0-based) of a bezier PEN shape layer (shapeType 'path'). Pass x/y to move the anchor (its handles move with it), and/or inX/inY (incoming handle) / outX/outY (outgoing handle) as ABSOLUTE layer-local pixel coordinates. Supply at least one of x/y/inX/inY/outX/outY. Use insert_motion_shape_path_point / remove_motion_shape_path_point to change the point count.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        index: num,
        x: num,
        y: num,
        inX: num,
        inY: num,
        outX: num,
        outY: num,
      },
      ["compositionId", "layerId", "index"],
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
      if (layer.type !== "shape" || layer.shapeType !== "path") {
        return fail("layerId must reference a shapeType:'path' layer", "INVALID_PARAMS");
      }
      const index = optionalNumber(args.index);
      if (index === undefined || index < 0 || !Number.isInteger(index)) {
        return fail("index must be a non-negative integer", "INVALID_PARAMS");
      }
      const points = getEditableMotionShapePathPoints(layer);
      if (index >= points.length) {
        return fail(
          `index ${index} out of range (path has ${points.length} points)`,
          "INVALID_PARAMS",
        );
      }
      const x = optionalNumber(args.x);
      const y = optionalNumber(args.y);
      const inX = optionalNumber(args.inX);
      const inY = optionalNumber(args.inY);
      const outX = optionalNumber(args.outX);
      const outY = optionalNumber(args.outY);
      const wantsInHandle = inX !== undefined && inY !== undefined;
      const wantsOutHandle = outX !== undefined && outY !== undefined;
      const wantsMove = x !== undefined || y !== undefined;
      if (!wantsMove && !wantsInHandle && !wantsOutHandle) {
        return fail(
          "supply at least one of x/y (anchor) or inX+inY / outX+outY (handles)",
          "INVALID_PARAMS",
        );
      }
      const existing = points[index];
      let nextLayer: MotionShapeLayer = layer;
      if (wantsMove) {
        nextLayer = setMotionShapePathPoint(nextLayer, index, {
          x: x ?? existing.x,
          y: y ?? existing.y,
        });
      }
      if (wantsInHandle) {
        nextLayer = setMotionShapePathPointHandle(nextLayer, index, "in", {
          x: inX,
          y: inY,
        });
      }
      if (wantsOutHandle) {
        nextLayer = setMotionShapePathPointHandle(nextLayer, index, "out", {
          x: outX,
          y: outY,
        });
      }
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Edited path point ${index} on shape "${layer.name}"`, {
            compositionId: composition.id,
            layerId: layer.id,
            index,
          })
        : result;
    },
  },
  {
    name: "insert_motion_shape_path_point",
    domain: "motion",
    title: "Insert bezier shape path point",
    description:
      "Insert a vertex into a bezier PEN shape layer (shapeType 'path') AFTER the given index (0-based). Pass an explicit point {x,y,inX?,inY?,outX?,outY?} (layer-local pixels, absolute handles) or omit it to insert a midpoint on the segment following afterIndex. Increases the point count by one.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        afterIndex: num,
        point: { type: "object" },
      },
      ["compositionId", "layerId", "afterIndex"],
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
      if (layer.type !== "shape" || layer.shapeType !== "path") {
        return fail("layerId must reference a shapeType:'path' layer", "INVALID_PARAMS");
      }
      const afterIndex = optionalNumber(args.afterIndex);
      if (afterIndex === undefined || afterIndex < 0 || !Number.isInteger(afterIndex)) {
        return fail("afterIndex must be a non-negative integer", "INVALID_PARAMS");
      }
      const points = getEditableMotionShapePathPoints(layer);
      if (afterIndex >= points.length) {
        return fail(
          `afterIndex ${afterIndex} out of range (path has ${points.length} points)`,
          "INVALID_PARAMS",
        );
      }
      let inserted: MotionShapePathPoint | undefined;
      if (args.point !== undefined) {
        const supplied = parseShapePathPoints([args.point, args.point]);
        if (!supplied) {
          return fail(
            "point must be a finite {x,y,inX?,inY?,outX?,outY?} vertex",
            "INVALID_PARAMS",
          );
        }
        inserted = supplied[0];
      }
      const nextLayer = insertMotionShapePathPoint(layer, afterIndex, inserted);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Inserted path point after ${afterIndex} on shape "${layer.name}"`, {
            compositionId: composition.id,
            layerId: layer.id,
            afterIndex,
            pointCount: getEditableMotionShapePathPoints(nextLayer).length,
          })
        : result;
    },
  },
  {
    name: "remove_motion_shape_path_point",
    domain: "motion",
    title: "Remove bezier shape path point",
    description:
      "Remove the vertex at index (0-based) from a bezier PEN shape layer (shapeType 'path'). Refuses (INVALID_PARAMS) when the path is already at its minimum (2 points for an open path, 3 for a closed one).",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        index: num,
      },
      ["compositionId", "layerId", "index"],
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
      if (layer.type !== "shape" || layer.shapeType !== "path") {
        return fail("layerId must reference a shapeType:'path' layer", "INVALID_PARAMS");
      }
      const index = optionalNumber(args.index);
      if (index === undefined || index < 0 || !Number.isInteger(index)) {
        return fail("index must be a non-negative integer", "INVALID_PARAMS");
      }
      const points = getEditableMotionShapePathPoints(layer);
      if (index >= points.length) {
        return fail(
          `index ${index} out of range (path has ${points.length} points)`,
          "INVALID_PARAMS",
        );
      }
      const minimum = layer.pathClosed ? 3 : 2;
      if (points.length <= minimum) {
        return fail(
          `cannot remove: path already at the minimum of ${minimum} points`,
          "INVALID_PARAMS",
        );
      }
      const nextLayer = removeMotionShapePathPoint(layer, index);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Removed path point ${index} from shape "${layer.name}"`, {
            compositionId: composition.id,
            layerId: layer.id,
            index,
            pointCount: getEditableMotionShapePathPoints(nextLayer).length,
          })
        : result;
    },
  },
  {
    name: "add_motion_shape_path_keyframe",
    domain: "motion",
    title: "Add bezier shape path keyframe",
    description:
      "Add or replace a shape.pathData keyframe at a time on a bezier PEN shape layer (shapeType 'path') so its outline animates/morphs over time. Supply pathData (an SVG path string) or points (an array of >=2 {x,y,inX?,inY?,outX?,outY?} vertices, layer-local pixels, absolute handles); omit both to snapshot the layer's CURRENT path. easing is any known easing name. Re-calling at the same time replaces that keyframe.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        time: num,
        pathData: str,
        points: { type: "array" },
        easing: str,
      },
      ["compositionId", "layerId", "time"],
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
      if (layer.type !== "shape" || layer.shapeType !== "path") {
        return fail("layerId must reference a shapeType:'path' layer", "INVALID_PARAMS");
      }
      const time = optionalNumber(args.time);
      if (time === undefined || time < 0) {
        return fail("time must be a finite non-negative number", "INVALID_PARAMS");
      }
      const easingInput = optionalString(args.easing);
      const easing = isValidEasing(easingInput) ? easingInput : undefined;

      let pathData: string | undefined;
      if (args.pathData !== undefined || args.points !== undefined) {
        const resolved = resolveShapePathData({
          pathData: args.pathData,
          pathPoints: args.points,
        });
        if ("error" in resolved) {
          return fail(resolved.error, "INVALID_PARAMS");
        }
        pathData = resolved.pathData;
      } else if (!layer.pathData?.trim()) {
        return fail(
          "layer has no current path; supply pathData or points",
          "INVALID_PARAMS",
        );
      }

      const nextLayer = upsertMotionShapePathKeyframe(layer, time, {
        pathData,
        easing,
        idFactory: genId,
      });
      const keyframes = nextLayer.keyframes.filter(
        (keyframe) => keyframe.property === "shape.pathData",
      );
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Set path keyframe on shape "${layer.name}" @ ${time.toFixed(3)}s`, {
            compositionId: composition.id,
            layerId: layer.id,
            time,
            keyframeCount: keyframes.length,
          })
        : result;
    },
  },
  {
    name: "transform_motion_keyframes",
    domain: "motion",
    title: "Transform a property's keyframes",
    description:
      "Batch-transform ALL keyframes of one property on a motion layer (the AE graph-editor keyframe ops). op is: 'reverse' (mirror values across the property's own time span), 'scale' (stretch/compress times about the first keyframe by factor scale>0 — 2 doubles the spacing), or 'duplicate' (copy every keyframe shifted by offset seconds, merging onto existing). scale is required for 'scale'; offset (may be negative) is required for 'duplicate'. property is any animatable id (transform.*, shape style properties like shape.width, shape.fill.opacity, effect.<id>.<param>, mask.<id>.<prop>, modifier.<id>.<prop>, ...) — note shape path data is not an animatable id here; animate a PEN path with add_motion_shape_path_keyframe. Use copy_motion_keyframes / paste_motion_keyframes to move keys between different properties. Any roving keyframes on the property keep constant-speed spacing: their times are re-derived from the surrounding anchors after the op, so reverse/scale/duplicate reposition them automatically.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        property: str,
        op: str,
        scale: num,
        offset: num,
      },
      ["compositionId", "layerId", "property", "op"],
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
      const property = optionalString(args.property);
      if (!property || !isMotionAnimatableProperty(property)) {
        return fail(`Unsupported motion property: ${String(args.property)}`, "INVALID_PARAMS");
      }
      const op = optionalString(args.op);
      if (op !== "reverse" && op !== "scale" && op !== "duplicate") {
        return fail("op must be one of reverse|scale|duplicate", "INVALID_PARAMS");
      }

      let nextLayer: MotionLayer;
      if (op === "reverse") {
        nextLayer = reverseMotionLayerPropertyKeyframes(layer, property);
      } else if (op === "scale") {
        const scale = optionalNumber(args.scale);
        if (scale === undefined || scale <= 0) {
          return fail("scale must be a finite number > 0", "INVALID_PARAMS");
        }
        nextLayer = scaleMotionLayerPropertyKeyframeTimes(layer, property, scale);
      } else {
        const offset = optionalNumber(args.offset);
        if (offset === undefined) {
          return fail("offset (seconds) is required for op:'duplicate'", "INVALID_PARAMS");
        }
        nextLayer = duplicateMotionLayerPropertyKeyframes(layer, property, offset, {
          idFactory: genId,
        });
      }

      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      if (!result.ok) return result;
      const keyframes = getMotionLayerPropertyKeyframes(nextLayer, property);
      return ok(`Applied ${op} to ${property} keyframes`, {
        compositionId: composition.id,
        layerId: layer.id,
        property,
        op,
        keyframeCount: keyframes.length,
      });
    },
  },
  {
    name: "copy_motion_keyframes",
    domain: "motion",
    title: "Copy a property's keyframes",
    description:
      "Read a motion layer property's keyframes into a portable clipboard payload (relative time offsets, values, and easings) for inspection or for feeding paste_motion_keyframes. Returns data.clipboard plus entryCount, span (seconds), and sourceProperty. NOT_FOUND if the property has no keyframes. The roving flag is not carried in the clipboard — pasted keyframes start non-roving, and on the destination property any existing roving keyframes re-derive their constant-speed times after the merge.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        property: str,
      },
      ["compositionId", "layerId", "property"],
    ),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const property = optionalString(args.property);
      if (!property || !isMotionAnimatableProperty(property)) {
        return fail(`Unsupported motion property: ${String(args.property)}`, "INVALID_PARAMS");
      }
      const clipboard = copyMotionPropertyKeyframes(layer.keyframes, property);
      if (!clipboard) {
        return fail(`No keyframes on ${property} to copy`, "NOT_FOUND");
      }
      return ok(`Copied ${clipboard.entries.length} keyframe(s) from ${property}`, {
        compositionId: composition.id,
        layerId: layer.id,
        sourceProperty: clipboard.sourceProperty,
        entryCount: clipboard.entries.length,
        span: clipboard.span,
        clipboard,
      });
    },
  },
  {
    name: "paste_motion_keyframes",
    domain: "motion",
    title: "Paste keyframes onto a property",
    description:
      "Copy every keyframe from fromProperty and paste them onto toProperty of the SAME layer, preserving relative spacing and easing, shifted so the run starts at (fromProperty's first keyframe time + timeOffset seconds, default 0). Existing keyframes on toProperty are kept (pasted keys merge, replacing any at identical times). Both properties must be valid animatable ids. Pasted keyframes are never roving; any roving keyframes already on toProperty re-derive their constant-speed times after the merge. Use transform_motion_keyframes to reverse/scale/duplicate keys in place on a single property.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        fromProperty: str,
        toProperty: str,
        timeOffset: num,
      },
      ["compositionId", "layerId", "fromProperty", "toProperty"],
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
      const fromProperty = optionalString(args.fromProperty);
      const toProperty = optionalString(args.toProperty);
      if (!fromProperty || !isMotionAnimatableProperty(fromProperty)) {
        return fail(
          `Unsupported source property: ${String(args.fromProperty)}`,
          "INVALID_PARAMS",
        );
      }
      if (!toProperty || !isMotionAnimatableProperty(toProperty)) {
        return fail(
          `Unsupported target property: ${String(args.toProperty)}`,
          "INVALID_PARAMS",
        );
      }
      const clipboard = copyMotionPropertyKeyframes(layer.keyframes, fromProperty);
      if (!clipboard) {
        return fail(`No keyframes on ${fromProperty} to copy`, "NOT_FOUND");
      }
      const timeOffset = optionalNumber(args.timeOffset) ?? 0;
      const startTime = clipboard.sourceStartTime + timeOffset;
      const nextLayer = pasteMotionLayerPropertyKeyframes(
        layer,
        toProperty,
        clipboard,
        startTime,
        { idFactory: genId },
      );
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      if (!result.ok) return result;
      const keyframes = getMotionLayerPropertyKeyframes(nextLayer, toProperty);
      return ok(
        `Pasted ${clipboard.entries.length} keyframe(s) from ${fromProperty} to ${toProperty}`,
        {
          compositionId: composition.id,
          layerId: layer.id,
          fromProperty,
          toProperty,
          timeOffset,
          keyframeCount: keyframes.length,
        },
      );
    },
  },
  {
    name: "add_motion_3d_scene",
    domain: "motion",
    title: "Create a 3D scene (multi-object + cinematic camera)",
    description:
      "Create ONE scene3d layer that is a FULL 3D WORLD — many objects sharing a camera, lights, and an optional room — instead of a single object. Declarative: you place objects in 3D and the engine does all the WebGL. This legacy-compatible tool now also creates semantic creation assets/objects plus a motion-scene3d render binding, so the scene remains editable in Motion Creator's Creation workspace. `objects` is an array; each entry: { kind (box|rounded-box|sphere|cylinder|cone|torus|icosahedron|plane|phone|model|text3d|soccer-ball|open-box|room), name, x,y,z (world position), rotationX/Y/Z (deg), scaleX/Y/Z, size, depth, aspect, cornerRadius, modelUrl (for model), text+extrude (for text3d), panelTexts (labels for soccer-ball), lidAngle (open-box, deg), color, metalness, roughness, materialKind, emissive, mapAssetId, opacity, key, objectId, partId, tags }. `camera`: { posX,posY,posZ, targetX,targetY,targetZ, fov, near, far }. `room`: { enabled, size, wallColor, floorColor } (camera flies in from the open +Z front). Optional environment (studio|dark|none), groundShadow. Then keyframe motion with animate_scene_camera + animate_scene_object. Returns layerId + render object ids plus semantic scene/object ids.",
    inputSchema: obj(
      {
        compositionId: str,
        sceneId: str,
        name: str,
        width: num,
        height: num,
        startTime: num,
        duration: num,
        objects: { type: "array" },
        camera: { type: "object" },
        lights: { type: "array" },
        room: { type: "object" },
        environment: str,
        creationEnvironment: str,
        backgroundColor: str,
        groundShadow: bool,
      },
      ["compositionId", "objects"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const rawObjects = Array.isArray(args.objects) ? args.objects : [];
      if (rawObjects.length === 0) {
        return fail("Provide at least one object in `objects`", "INVALID_PARAMS");
      }
      const objects: MotionSceneObject3D[] = [];
      const rawObjectRecords: Record<string, unknown>[] = [];
      for (const raw of rawObjects) {
        const record = asRecord(raw);
        if (!record) return fail("each object must be an object", "INVALID_PARAMS");
        const renderObjectId =
          optionalString(record.renderObjectId) ??
          optionalString(record.id) ??
          genId();
        const built = buildSceneObject3D(record, renderObjectId);
        if ("error" in built) return fail(built.error, "INVALID_PARAMS");
        objects.push(built.object);
        rawObjectRecords.push(record);
      }
      const camera = parseSceneCamera(asRecord(args.camera));
      const room = parseSceneRoom(asRecord(args.room));
      const environment = optionalString(args.environment);
      const lighting =
        environment || args.groundShadow === true
          ? {
              environment:
                environment === "dark" || environment === "none"
                  ? (environment as "dark" | "none")
                  : ("studio" as const),
              groundShadow: args.groundShadow === true,
            }
          : undefined;
      const layer = createMotionScene3DLayer({
        id: genId(),
        name: optionalString(args.name) ?? "3D Scene",
        startTime: optionalNumber(args.startTime),
        duration: optionalNumber(args.duration) ?? composition.duration,
        compositionWidth: composition.width,
        compositionHeight: composition.height,
        object: { kind: "box" },
        objects,
        camera,
        room,
        lighting,
        fov: camera?.fov,
        width: optionalNumber(args.width),
        height: optionalNumber(args.height),
      });
      const now = Date.now();
      const committed: MotionComposition = {
        ...composition,
        layers: [...composition.layers, layer],
        backgroundColor:
          optionalString(args.backgroundColor) ?? composition.backgroundColor,
        modifiedAt: now,
      };
      const result = await commitMotionComposition(host, committed);
      if (!result.ok) return result;

      const draft = buildCreationDraftFromMotionSceneLayer({
        composition: committed,
        layer,
        rawObjects: rawObjectRecords,
        args,
        now,
      });
      const creationApplied = await persistMotionSceneCreationDraft(host, draft, {
        now,
        labelPrefix: "Create legacy-compatible",
      });
      if (!creationApplied.ok) return creationApplied;

      return ok(`Created editable 3D scene with ${objects.length} object(s)`, {
        compositionId: composition.id,
        layerId: layer.id,
        objectIds: objects.map((entry) => entry.id),
        sceneId: draft.scene.id,
        renderBindingId: draft.binding.id,
        assetIds: draft.assets.map((asset) => asset.id),
        objectIdsByKey: draft.objectIdsByKey,
        renderObjectIdsByKey: draft.renderObjectIdsByKey,
      });
    },
  },
  {
    name: "add_scene_object",
    domain: "motion",
    title: "Add an object to a 3D scene",
    description:
      "Append one object to an existing scene3d layer (created by add_motion_3d_scene). Same fields as one entry of add_motion_3d_scene's `objects`. When the layer has a semantic creation binding, or can be recovered into one, this also appends an editable creation asset/object and render binding so Motion Creator can inspect and revise it later. Returns the render objectId plus semantic creation ids.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        kind: str,
        name: str,
        x: num,
        y: num,
        z: num,
        rotationX: num,
        rotationY: num,
        rotationZ: num,
        scaleX: num,
        scaleY: num,
        scaleZ: num,
        size: num,
        depth: num,
        aspect: num,
        cornerRadius: num,
        modelUrl: str,
        animationClipName: str,
        animationClipIndex: num,
        animationTimeOffset: num,
        animationPlaybackRate: num,
        animationLoop: bool,
        text: str,
        extrude: num,
        panelTexts: { type: "array" },
        lidAngle: num,
        color: str,
        metalness: num,
        roughness: num,
        materialKind: str,
        emissive: str,
        mapAssetId: str,
        opacity: num,
      },
      ["compositionId", "layerId", "kind"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerId = optionalString(args.layerId);
      const layer = composition.layers.find((entry) => entry.id === layerId);
      if (!layer || layer.type !== "scene3d") {
        return fail("layerId must reference a scene3d layer", "INVALID_PARAMS");
      }
      if (!(layer.objects && layer.objects.length > 0)) {
        return fail(
          "layerId is a legacy single-object 3D layer (add_motion_3d_object). add_scene_object only appends to a multi-object scene — create one with add_motion_3d_scene.",
          "INVALID_PARAMS",
        );
      }
      const id = genId();
      const built = buildSceneObject3D(args as Record<string, unknown>, id);
      if ("error" in built) return fail(built.error, "INVALID_PARAMS");
      const nextLayer = {
        ...layer,
        objects: [...(layer.objects ?? []), built.object],
      };
      const committed: MotionComposition = {
        ...composition,
        layers: composition.layers.map((entry) =>
          entry.id === layer.id ? nextLayer : entry,
        ),
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, committed);
      if (!result.ok) return result;

      const ensured = await ensureCreationBindingForMotionSceneLayer(
        host,
        committed,
        nextLayer,
        args,
      );
      if (!ensured.ok) return ensured.result;

      let creationObjectId: string | undefined;
      let assetId: string | undefined;
      let materialId: string | undefined;
      if (
        !ensured.binding.objectBindings.some(
          (candidate) => candidate.renderObjectId === id,
        )
      ) {
        const now = Date.now();
        const existingKeys = new Set(
          ensured.scene.objects
            .map((object) => object.partId ?? object.name ?? object.id)
            .map((value) => idSegment(value, "object")),
        );
        const key = uniqueIdSegment(
          args.key ?? args.objectId ?? args.partId ?? built.object.name ?? id,
          `object-${ensured.scene.objects.length + 1}`,
          existingKeys,
        );
        const entry = buildCreationDraftEntryFromMotionObject({
          sceneKey: idSegment(ensured.scene.id, "scene"),
          objectKey: key,
          raw: args,
          motionObject: built.object,
          renderObjectId: id,
          now,
        });
        const parent = resolveCreationParentId(
          ensured.scene,
          args.parentId,
          args.parentKey,
        );
        if (!parent.ok) return fail(parent.error, "INVALID_PARAMS");
        const sceneObject: CreationSceneObject = {
          ...entry.sceneObject,
          parentId: parent.parentId ?? entry.sceneObject.parentId,
        };
        const nextBinding: CreationRenderBinding = {
          ...ensured.binding,
          objectBindings: [
            ...ensured.binding.objectBindings,
            {
              sceneObjectId: sceneObject.id,
              renderObjectId: id,
            },
          ],
          modifiedAt: now,
        };
        const nextScene: CreationScene = {
          ...ensured.scene,
          objects: [...ensured.scene.objects, sceneObject],
          renderBindings: ensured.scene.renderBindings.map((candidate) =>
            candidate.id === nextBinding.id ? nextBinding : candidate,
          ),
          modifiedAt: now,
        };
        const applied = await applyCreationOperations(host, [
          {
            id: genId(),
            type: "asset/upsert",
            timestamp: now,
            source: "agent",
            label: `Append ${entry.asset.name}`,
            asset: entry.asset,
          },
          {
            id: genId(),
            type: "scene/upsert",
            timestamp: now,
            source: "agent",
            label: `Append ${sceneObject.name}`,
            scene: nextScene,
          },
        ]);
        if (!applied.ok) return applied;
        creationObjectId = sceneObject.id;
        assetId = entry.asset.id;
        materialId = sceneObject.materialId;
      } else {
        const objectBinding = ensured.binding.objectBindings.find(
          (candidate) => candidate.renderObjectId === id,
        );
        creationObjectId = objectBinding?.sceneObjectId;
        const sceneObject = ensured.scene.objects.find(
          (candidate) => candidate.id === creationObjectId,
        );
        assetId = sceneObject?.assetId;
        materialId = sceneObject?.materialId;
      }

      return ok(`Added ${optionalString(args.kind)} to editable scene`, {
        compositionId: composition.id,
        layerId: layer.id,
        objectId: id,
        sceneId: ensured.scene.id,
        creationObjectId,
        assetId,
        materialId,
        renderBindingId: ensured.binding.id,
      });
    },
  },
  {
    name: "set_motion_scene_object",
    domain: "motion",
    title: "Edit an object in a 3D scene",
    description:
      "Statically edit one object inside a multi-object scene3d layer (created by add_motion_3d_scene). Merge only the fields you pass onto the object matched by objectId. transform: { position?{x,y,z}, rotation?{x,y,z} (deg), scale?{x,y,z} }. material: { color?, metalness?, roughness?, emissive?, emissiveIntensity?, opacity?, transmission? (0..1 glass), ior? (index of refraction), clearcoat? (0..1), clearcoatRoughness? (0..1), materialKind? (physical|basic), mapAssetId?, normalMapAssetId?, roughnessMapAssetId?, metalnessMapAssetId? } (metalness/roughness/opacity/transmission/clearcoat/clearcoatRoughness clamp to 0..1). geometry: { kind?(box|rounded-box|sphere|cylinder|cone|torus|icosahedron|plane|phone|model|text3d|soccer-ball|open-box|room), size?, depth?, cornerRadius?, aspect?, modelUrl? (for kind=model), text? (for kind=text3d), extrude? (text3d extrusion fraction), panelTexts? (string[] for soccer-ball) }. lidAngle? (deg, for kind=open-box) is set at the object level. For animated changes use animate_scene_object instead.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        objectId: str,
        transform: { type: "object" },
        material: { type: "object" },
        geometry: { type: "object" },
        lidAngle: num,
      },
      ["compositionId", "layerId", "objectId"],
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
      if (!(layer.objects && layer.objects.length > 0)) {
        return fail(
          "layerId is a legacy single-object 3D layer; set_motion_scene_object only edits a multi-object scene created with add_motion_3d_scene.",
          "INVALID_PARAMS",
        );
      }
      const objectId = optionalString(args.objectId);
      const target = layer.objects.find((entry) => entry.id === objectId);
      if (!target) return fail("Scene object not found", "NOT_FOUND");

      const geometryRaw = asRecord(args.geometry);
      let nextGeometry: MotionObject3D = target.object;
      if (geometryRaw) {
        const kind = optionalString(geometryRaw.kind);
        if (
          kind !== undefined &&
          !(MOTION_OBJECT_3D_KINDS as readonly string[]).includes(kind)
        ) {
          return fail(
            `geometry.kind must be one of: ${MOTION_OBJECT_3D_KINDS.join(", ")}`,
            "INVALID_PARAMS",
          );
        }
        const size = optionalNumber(geometryRaw.size);
        const depth = optionalNumber(geometryRaw.depth);
        const cornerRadius = optionalNumber(geometryRaw.cornerRadius);
        const aspect = optionalNumber(geometryRaw.aspect);
        const modelUrl = optionalString(geometryRaw.modelUrl);
        const text = typeof geometryRaw.text === "string" ? geometryRaw.text : undefined;
        const extrude = optionalNumber(geometryRaw.extrude);
        const panelTexts = Array.isArray(geometryRaw.panelTexts)
          ? geometryRaw.panelTexts.filter(
              (entry): entry is string => typeof entry === "string",
            )
          : undefined;
        nextGeometry = {
          ...target.object,
          ...(kind !== undefined ? { kind: kind as MotionObject3DKind } : {}),
          ...(size !== undefined ? { size } : {}),
          ...(depth !== undefined ? { depth } : {}),
          ...(cornerRadius !== undefined ? { cornerRadius } : {}),
          ...(aspect !== undefined ? { aspect } : {}),
          ...(modelUrl !== undefined ? { modelUrl } : {}),
          ...(text !== undefined ? { text } : {}),
          ...(extrude !== undefined ? { extrude } : {}),
          ...(panelTexts !== undefined ? { panelTexts } : {}),
        };
      }

      const materialRaw = asRecord(args.material);
      let nextMaterial: MotionMaterial3D | undefined = target.material;
      if (materialRaw) {
        const color = optionalString(materialRaw.color);
        const emissive = optionalString(materialRaw.emissive);
        const mapAssetId = optionalString(materialRaw.mapAssetId);
        const normalMapAssetId = optionalString(materialRaw.normalMapAssetId);
        const roughnessMapAssetId = optionalString(materialRaw.roughnessMapAssetId);
        const metalnessMapAssetId = optionalString(materialRaw.metalnessMapAssetId);
        const metalness = optionalNumber(materialRaw.metalness);
        const roughness = optionalNumber(materialRaw.roughness);
        const opacity = optionalNumber(materialRaw.opacity);
        const emissiveIntensity = optionalNumber(materialRaw.emissiveIntensity);
        const transmission = optionalNumber(materialRaw.transmission);
        const ior = optionalNumber(materialRaw.ior);
        const clearcoat = optionalNumber(materialRaw.clearcoat);
        const clearcoatRoughness = optionalNumber(materialRaw.clearcoatRoughness);
        const materialKindRaw = optionalString(materialRaw.materialKind);
        if (
          materialKindRaw !== undefined &&
          materialKindRaw !== "physical" &&
          materialKindRaw !== "basic"
        ) {
          return fail(
            "material.materialKind must be 'physical' or 'basic'",
            "INVALID_PARAMS",
          );
        }
        nextMaterial = {
          ...target.material,
          ...(color !== undefined ? { color } : {}),
          ...(emissive !== undefined ? { emissive } : {}),
          ...(mapAssetId !== undefined ? { mapAssetId } : {}),
          ...(normalMapAssetId !== undefined ? { normalMapAssetId } : {}),
          ...(roughnessMapAssetId !== undefined ? { roughnessMapAssetId } : {}),
          ...(metalnessMapAssetId !== undefined ? { metalnessMapAssetId } : {}),
          ...(metalness !== undefined
            ? { metalness: clampNumber(metalness, 0, 1) }
            : {}),
          ...(roughness !== undefined
            ? { roughness: clampNumber(roughness, 0, 1) }
            : {}),
          ...(opacity !== undefined ? { opacity: clampNumber(opacity, 0, 1) } : {}),
          ...(emissiveIntensity !== undefined
            ? { emissiveIntensity: Math.max(0, emissiveIntensity) }
            : {}),
          ...(transmission !== undefined
            ? { transmission: clampNumber(transmission, 0, 1) }
            : {}),
          ...(ior !== undefined ? { ior: Math.max(1, ior) } : {}),
          ...(clearcoat !== undefined
            ? { clearcoat: clampNumber(clearcoat, 0, 1) }
            : {}),
          ...(clearcoatRoughness !== undefined
            ? { clearcoatRoughness: clampNumber(clearcoatRoughness, 0, 1) }
            : {}),
          ...(materialKindRaw !== undefined ? { kind: materialKindRaw } : {}),
        };
      }

      const transformRaw = asRecord(args.transform);
      let nextTransform: MotionSceneObject3DTransform | undefined =
        target.transform3d;
      if (transformRaw) {
        const position = mergeSceneVector3(
          transformRaw.position,
          target.transform3d?.position,
          SCENE_OBJECT_POSITION_DEFAULT,
        );
        const rotation = mergeSceneVector3(
          transformRaw.rotation,
          target.transform3d?.rotation,
          SCENE_OBJECT_ROTATION_DEFAULT,
        );
        const scale = mergeSceneVector3(
          transformRaw.scale,
          target.transform3d?.scale,
          SCENE_OBJECT_SCALE_DEFAULT,
        );
        nextTransform = {
          ...target.transform3d,
          ...(position !== undefined ? { position } : {}),
          ...(rotation !== undefined ? { rotation } : {}),
          ...(scale !== undefined ? { scale } : {}),
        };
      }

      const lidAngle = optionalNumber(args.lidAngle);
      const nextObject: MotionSceneObject3D = {
        ...target,
        object: nextGeometry,
        material: nextMaterial,
        transform3d: nextTransform,
        ...(lidAngle !== undefined ? { lidAngle } : {}),
      };
      const nextLayer: MotionScene3DLayer = {
        ...layer,
        objects: layer.objects.map((entry) =>
          entry.id === target.id ? nextObject : entry,
        ),
      };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Updated scene object", {
            compositionId: composition.id,
            layerId: layer.id,
            objectId: target.id,
          })
        : result;
    },
  },
  {
    name: "remove_motion_scene_object",
    domain: "motion",
    title: "Remove an object from a 3D scene",
    description:
      "Remove one object from a multi-object scene3d layer by objectId. Refuses to remove the last remaining object — delete the scene3d layer instead when you want an empty scene.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        objectId: str,
      },
      ["compositionId", "layerId", "objectId"],
    ),
    readOnly: false,
    destructive: true,
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
      if (!(layer.objects && layer.objects.length > 0)) {
        return fail(
          "layerId is a legacy single-object 3D layer; remove_motion_scene_object only edits a multi-object scene created with add_motion_3d_scene.",
          "INVALID_PARAMS",
        );
      }
      const objectId = optionalString(args.objectId);
      const target = layer.objects.find((entry) => entry.id === objectId);
      if (!target) return fail("Scene object not found", "NOT_FOUND");
      if (layer.objects.length <= 1) {
        return fail(
          "Cannot remove the last object; remove the scene3d layer instead",
          "INVALID_PARAMS",
        );
      }
      const nextLayer: MotionScene3DLayer = {
        ...layer,
        objects: layer.objects.filter((entry) => entry.id !== target.id),
      };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Removed scene object", {
            compositionId: composition.id,
            layerId: layer.id,
            objectId: target.id,
          })
        : result;
    },
  },
  {
    name: "set_motion_scene_camera",
    domain: "motion",
    title: "Set the static 3D scene camera",
    description:
      "Set the static (non-animated) cinematic camera on a scene3d layer. position?{x,y,z}, target?{x,y,z}, fov? (degrees), near? (near clip plane distance), far? (far clip plane distance). Only the fields you pass change. Complements animate_scene_camera, which keyframes the camera over time.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        position: { type: "object" },
        target: { type: "object" },
        fov: num,
        near: num,
        far: num,
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
      const position = mergeSceneVector3(
        args.position,
        layer.camera?.position,
        SCENE_CAMERA_POSITION_DEFAULT,
      );
      const target = mergeSceneVector3(
        args.target,
        layer.camera?.target,
        SCENE_CAMERA_TARGET_DEFAULT,
      );
      const fov = optionalNumber(args.fov);
      const near = optionalNumber(args.near);
      const far = optionalNumber(args.far);
      if (
        position === undefined &&
        target === undefined &&
        fov === undefined &&
        near === undefined &&
        far === undefined
      ) {
        return fail("Provide at least one of position, target, fov, near, or far", "INVALID_PARAMS");
      }
      const nextCamera: MotionScene3DCamera = {
        ...layer.camera,
        ...(position !== undefined ? { position } : {}),
        ...(target !== undefined ? { target } : {}),
        ...(fov !== undefined ? { fov } : {}),
        ...(near !== undefined ? { near } : {}),
        ...(far !== undefined ? { far } : {}),
      };
      const nextLayer: MotionScene3DLayer = { ...layer, camera: nextCamera };
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok("Set scene camera", {
            compositionId: composition.id,
            layerId: layer.id,
            camera: nextCamera,
          })
        : result;
    },
  },
  {
    name: "animate_scene_camera",
    domain: "motion",
    title: "Animate the 3D scene camera",
    description:
      "Keyframe the cinematic camera of a scene3d layer — the 'camera at this angle at this time, move this way, orbit this point' control. `position` and `target` are arrays of { time, x, y, z, easing }; `fov` is an array of { time, value, easing }. Times in seconds. Re-calling replaces the camera keyframes. When the layer is bound to an editable creation scene, this also mirrors the camera animation into creation animation state for recovery and later editing. Example fly-in then orbit: position [{time:0,x:0,y:4,z:24},{time:1.4,x:0,y:2,z:9},{time:2.4,x:7,y:2,z:7},{time:6,x:-7,y:2,z:7}], target locked on the subject.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        clipId: str,
        name: str,
        duration: num,
        position: { type: "array" },
        target: { type: "array" },
        fov: { type: "array" },
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
      const layerId = optionalString(args.layerId);
      const layer = composition.layers.find((entry) => entry.id === layerId);
      if (!layer || layer.type !== "scene3d") {
        return fail("layerId must reference a scene3d layer", "INVALID_PARAMS");
      }
      const added = [
        ...sceneVec3Keyframes("scene.camera.position", args.position, genId),
        ...sceneVec3Keyframes("scene.camera.target", args.target, genId),
        ...sceneScalarKeyframes("scene.camera.fov", args.fov, genId),
      ];
      if (added.length === 0) {
        return fail("Provide position, target, and/or fov keyframes", "INVALID_PARAMS");
      }
      const nextLayer = {
        ...layer,
        camera: layer.camera ?? {},
        keyframes: mergeSceneKeyframes(layer.keyframes, added),
      };
      const committed: MotionComposition = {
        ...composition,
        layers: composition.layers.map((entry) =>
          entry.id === layer.id ? nextLayer : entry,
        ),
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, committed);
      if (!result.ok) return result;
      const mirrored = await syncLegacyMotionSceneCameraAnimationToCreation({
        host,
        composition: committed,
        layer: nextLayer,
        args,
      });
      return mirrored.ok
        ? ok(`Animated editable scene camera (${added.length} keyframes)`, {
            compositionId: composition.id,
            layerId: layer.id,
            creation: mirrored.data,
          })
        : mirrored;
    },
  },
  {
    name: "set_model_animation",
    domain: "motion",
    title: "Set GLB model animation playback",
    description:
      "Bind a GLB/glTF animation clip to a model inside a scene3d layer so Motion Creator renders the rigged model over time instead of as a static pose. Use clipName or clipIndex to choose a clip; omit both to use the first clip. timeOffset shifts the clip start, playbackRate changes speed, and animationLoop=false clamps on the final frame. For multi-object scenes pass objectId; for a legacy single-model scene3d layer omit objectId.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        objectId: str,
        clipName: str,
        clipIndex: num,
        animationClipName: str,
        animationClipIndex: num,
        timeOffset: num,
        animationTimeOffset: num,
        playbackRate: num,
        animationPlaybackRate: num,
        loop: bool,
        animationLoop: bool,
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
      const layerId = optionalString(args.layerId);
      const layer = composition.layers.find((entry) => entry.id === layerId);
      if (!layer || layer.type !== "scene3d") {
        return fail("layerId must reference a scene3d layer", "INVALID_PARAMS");
      }

      const animation = motionModelAnimationFromArgs(args) ?? { loop: true };
      const objectId = optionalString(args.objectId);
      let targetRenderObjectId: string | undefined;
      let nextRenderObject: MotionSceneObject3D | undefined;
      let nextLayer: MotionScene3DLayer;

      if (layer.objects && layer.objects.length > 0) {
        const resolvedObjectId =
          objectId ?? (layer.objects.length === 1 ? layer.objects[0]?.id : undefined);
        if (!resolvedObjectId) {
          return fail(
            "objectId is required when the scene3d layer has multiple objects",
            "INVALID_PARAMS",
          );
        }
        const target = layer.objects.find((object) => object.id === resolvedObjectId);
        if (!target) return fail(`Scene object not found: ${resolvedObjectId}`, "NOT_FOUND");
        if (target.object.kind !== "model") {
          return fail("objectId must reference a model object", "INVALID_PARAMS");
        }
        nextRenderObject = {
          ...target,
          object: { ...target.object, animation },
        };
        targetRenderObjectId = target.id;
        nextLayer = {
          ...layer,
          objects: layer.objects.map((object) =>
            object.id === target.id ? nextRenderObject! : object,
          ),
        };
      } else {
        if (layer.object.kind !== "model") {
          return fail("layer must be a model scene3d layer", "INVALID_PARAMS");
        }
        nextLayer = {
          ...layer,
          object: { ...layer.object, animation },
        };
      }

      const committed: MotionComposition = {
        ...composition,
        layers: composition.layers.map((entry) =>
          entry.id === layer.id ? nextLayer : entry,
        ),
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, committed);
      if (!result.ok) return result;

      let syncedCreationObjectId: string | undefined;
      let syncedAssetId: string | undefined;
      const state = creationState(host);
      if (state && targetRenderObjectId && nextRenderObject) {
        const found = findCreationBindingForMotionSceneLayer(
          state,
          composition.id,
          layer.id,
        );
        const objectBinding = found?.binding.objectBindings.find(
          (candidate) => candidate.renderObjectId === targetRenderObjectId,
        );
        const sceneObject = found?.scene.objects.find(
          (candidate) => candidate.id === objectBinding?.sceneObjectId,
        );
        const asset = state.assets.find((candidate) => candidate.id === sceneObject?.assetId);
        if (found && sceneObject && asset) {
          const now = Date.now();
          const nextAsset = updateCreationAssetGeometry(
            asset,
            args,
            nextRenderObject,
            now,
          );
          const applied = await applyMotionAction(host, "creation/applyOperation", {
            operation: {
              id: genId(),
              type: "asset/upsert",
              timestamp: now,
              source: "agent",
              label: `Set model animation for ${sceneObject.name}`,
              asset: nextAsset,
            },
          });
          if (!applied.ok) return applied;
          syncedCreationObjectId = sceneObject.id;
          syncedAssetId = asset.id;
        }
      }

      return ok("Set model animation playback", {
        compositionId: composition.id,
        layerId: layer.id,
        objectId: targetRenderObjectId,
        animation,
        syncedCreationObjectId,
        syncedAssetId,
      });
    },
  },
  {
    name: "animate_scene_object",
    domain: "motion",
    title: "Animate an object in a 3D scene",
    description:
      "Keyframe one object inside a scene3d layer in TRUE 3D over time — shake, spin, lift, open. `position`, `rotation` (degrees), `scale` are arrays of { time, x, y, z, easing }; `opacity` and `lidAngle` (open-box) are arrays of { time, value, easing }. Times in seconds. Re-calling replaces that object's keyframes for the channels you pass. When the layer is bound to an editable creation scene, this also mirrors position/rotation/scale/opacity tracks into creation animation state for recovery and later editing. Example lift: position [{time:1.4,x:0,y:0,z:0},{time:2.4,x:0,y:5,z:0}] + rotation spin [{time:1.4,x:0,y:0,z:0},{time:6,x:0,y:720,z:0}].",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        objectId: str,
        clipId: str,
        name: str,
        duration: num,
        position: { type: "array" },
        rotation: { type: "array" },
        scale: { type: "array" },
        opacity: { type: "array" },
        lidAngle: { type: "array" },
      },
      ["compositionId", "layerId", "objectId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerId = optionalString(args.layerId);
      const layer = composition.layers.find((entry) => entry.id === layerId);
      if (!layer || layer.type !== "scene3d") {
        return fail("layerId must reference a scene3d layer", "INVALID_PARAMS");
      }
      const objectId = optionalString(args.objectId);
      const target = (layer.objects ?? []).find((entry) => entry.id === objectId);
      if (!target || !objectId) {
        return fail("objectId not found in layer.objects", "INVALID_PARAMS");
      }
      const prefix = `scene.object.${objectId}`;
      const added = [
        ...sceneVec3Keyframes(`${prefix}.position`, args.position, genId),
        ...sceneVec3Keyframes(`${prefix}.rotation`, args.rotation, genId),
        ...sceneVec3Keyframes(`${prefix}.scale`, args.scale, genId),
        ...sceneScalarKeyframes(`${prefix}.opacity`, args.opacity, genId),
        ...sceneScalarKeyframes(`${prefix}.lid.angle`, args.lidAngle, genId),
      ];
      if (added.length === 0) {
        return fail(
          "Provide position, rotation, scale, opacity, and/or lidAngle keyframes",
          "INVALID_PARAMS",
        );
      }
      const nextLayer = {
        ...layer,
        keyframes: mergeSceneKeyframes(layer.keyframes, added),
      };
      const committed: MotionComposition = {
        ...composition,
        layers: composition.layers.map((entry) =>
          entry.id === layer.id ? nextLayer : entry,
        ),
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, committed);
      if (!result.ok) return result;
      const mirrored = await syncLegacyMotionSceneObjectAnimationToCreation({
        host,
        composition: committed,
        layer: nextLayer,
        renderObjectId: objectId,
        args,
      });
      return mirrored.ok
        ? ok(`Animated editable object ${objectId} (${added.length} keyframes)`, {
            compositionId: composition.id,
            layerId: layer.id,
            objectId,
            creation: mirrored.data,
          })
        : mirrored;
    },
  },
  {
    name: "animate_motion_layers",
    domain: "motion",
    title: "Animate motion layers (batch)",
    description:
      "Apply an animation preset to MANY layers at once with a per-layer stagger — e.g. 'stagger all the cards in with a slide-up'. presetId is one of fade-in, fade-out, slide-up-in, slide-left-in, scale-pop, rotate-in, pulse, float-loop, stroke-draw-on, stroke-pop, gradient-sweep, corner-bloom (see get_capabilities motion.animationPresets). Optional: startTime, duration, stagger (seconds added per layer in layerIds order), distance, intensity. Layers that don't support a shape-only preset are skipped.",
    inputSchema: obj({
      compositionId: str,
      layerIds: { type: "array" },
      presetId: str,
      startTime: num,
      duration: num,
      stagger: num,
      distance: num,
      intensity: num,
    }, ["compositionId", "layerIds", "presetId"]),
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
      const presetId = optionalString(args.presetId) as
        | MotionAnimationPresetId
        | undefined;
      if (!presetId || !MOTION_ANIMATION_PRESET_IDS.has(presetId)) {
        return fail(
          `Unknown presetId: ${String(args.presetId)}`,
          "INVALID_PARAMS",
        );
      }
      const preset = getMotionAnimationPreset(presetId);
      if (!preset) return fail("Animation preset not found", "INVALID_PARAMS");
      const baseStart = Math.max(0, optionalNumber(args.startTime) ?? 0);
      const stagger = Math.max(0, optionalNumber(args.stagger) ?? 0);
      const duration = optionalNumber(args.duration);
      const distance = optionalNumber(args.distance);
      const intensity = optionalNumber(args.intensity);

      const applied: string[] = [];
      const skipped: string[] = [];
      const nextLayers = composition.layers.map((layer) => {
        if (!layerIds.includes(layer.id)) return layer;
        const index = layerIds.indexOf(layer.id);
        if (!canApplyMotionAnimationPreset(layer, preset)) {
          skipped.push(layer.id);
          return layer;
        }
        applied.push(layer.id);
        return applyMotionAnimationPreset(layer, presetId, {
          startTime: baseStart + stagger * index,
          duration,
          distance,
          intensity,
          idFactory: () => genId(),
        });
      });
      if (applied.length === 0) {
        return fail(
          `No layers support the ${presetId} preset`,
          "INVALID_PARAMS",
        );
      }
      const committed: MotionComposition = {
        ...composition,
        layers: nextLayers,
        modifiedAt: Date.now(),
      };
      const result = await commitMotionComposition(host, committed);
      return result.ok
        ? ok(`Animated ${applied.length} layers with ${presetId}`, {
            compositionId: composition.id,
            appliedLayerIds: applied,
            skippedLayerIds: skipped,
          })
        : result;
    },
  }
];
