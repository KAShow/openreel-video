import {
  RegisteredTool,
  applyMotionAction,
  bindingForObject,
  bool,
  buildCreationCameraAnimationTracks,
  buildCreationClothWaveTracks,
  buildCreationExplodedViewTracks,
  buildCreationObjectAnimationTracks,
  cameraFromArgs,
  commitMotionComposition,
  creationState,
  fail,
  genId,
  getMotionComposition,
  maxCreationKeyframeTime,
  mergeCreationCameraAnimationClip,
  mergeCreationObjectAnimationClip,
  mergeCreationObjectAnimationClipForTargets,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  parseCreationEnvironmentKind,
  parseCreationLightEntries,
  resolveCreationExplodedViewObjects,
  resolveCreationScene,
  str,
  syncLightingFromCreation,
  updateCreationAssetClothWave,
  updateCreationAssetExplodedView,
  updateScene3DLayerCamera,
  updateScene3DLayerCameraAnimation,
  updateScene3DLayerObjectAnimation,
  updateScene3DLayerObjectAnimations,
} from "./shared";
import {
  type CreationRenderBinding,
  type CreationScene,
  type CreationSceneObject,
} from "@openreel/core/creation/index";
import {
  type MotionComposition,
  type MotionScene3DLayer,
} from "@openreel/core/motion/types";

export const creationAnimationTools: RegisteredTool[] = [
  {
    name: "set_creation_scene_environment",
    domain: "motion",
    title: "Set creation scene environment",
    description:
      "Update a semantic creation scene's environment, light rig, room/floor colors, and realtime scene3d lighting. Use this for cinematic moods, moon/space stages, product studios, dark stages, ground shadows, and background color changes while keeping creation state and bound render layers in sync.",
    inputSchema: obj({
      sceneId: str,
      creationEnvironment: str,
      environmentKind: str,
      backgroundColor: str,
      groundEnabled: bool,
      groundShadow: bool,
      groundColor: str,
      lights: { type: "array" },
      ambient: num,
      keyIntensity: num,
      keyColor: str,
      rimIntensity: num,
      renderEnvironment: str,
      room: { type: "object" },
      roomSize: num,
      wallColor: str,
      floorColor: str,
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const now = Date.now();
      const explicitKind =
        optionalString(args.creationEnvironment) ??
        optionalString(args.environmentKind);
      const nextEnvironment: CreationScene["environment"] = {
        ...scene.environment,
        kind: explicitKind
          ? parseCreationEnvironmentKind(explicitKind)
          : scene.environment.kind,
        backgroundColor:
          optionalString(args.backgroundColor) ?? scene.environment.backgroundColor,
        groundEnabled:
          typeof args.groundEnabled === "boolean"
            ? args.groundEnabled
            : typeof args.groundShadow === "boolean"
              ? args.groundShadow
              : scene.environment.groundEnabled,
        groundColor:
          optionalString(args.groundColor) ??
          optionalString(args.floorColor) ??
          scene.environment.groundColor,
      };
      const nextLights = parseCreationLightEntries(args.lights) ?? scene.lights;
      const nextScene: CreationScene = {
        ...scene,
        lights: nextLights,
        environment: nextEnvironment,
        modifiedAt: now,
      };

      const nextCompositions = new Map<string, MotionComposition>();
      for (const binding of scene.renderBindings) {
        if (binding.kind !== "motion-scene3d") continue;
        const composition =
          nextCompositions.get(binding.compositionId) ??
          getMotionComposition(host, binding.compositionId);
        if (!composition) {
          return fail(`Bound Motion composition not found: ${binding.compositionId}`, "NOT_FOUND");
        }
        const layer = composition.layers.find(
          (candidate): candidate is MotionScene3DLayer =>
            candidate.id === binding.layerId && candidate.type === "scene3d",
        );
        if (!layer) return fail(`Bound scene3d layer not found: ${binding.layerId}`, "NOT_FOUND");
        const nextLayer = syncLightingFromCreation(layer, nextScene, args);
        nextCompositions.set(binding.compositionId, {
          ...composition,
          backgroundColor:
            nextEnvironment.backgroundColor ?? composition.backgroundColor,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        });
      }

      const operation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Set environment for ${scene.name}`,
        scene: nextScene,
      };
      const applied = await applyMotionAction(host, "creation/applyOperation", {
        operation,
      });
      if (!applied.ok) return applied;
      for (const composition of nextCompositions.values()) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      return ok(
        nextCompositions.size > 0
          ? `Updated creation scene ${scene.id} environment and synced render lighting`
          : `Updated creation scene ${scene.id} environment`,
        {
          sceneId: scene.id,
          environment: nextEnvironment,
          lightCount: nextLights.length,
          operationId: operation.id,
          syncedCompositionIds: [...nextCompositions.keys()],
        },
      );
    },
  },
  {
    name: "set_creation_camera",
    domain: "motion",
    title: "Set creation camera",
    description:
      "Update a semantic creation scene camera and sync the bound Motion Creator scene3d camera. Omitting cameraId edits the active camera. Position/target accept objects {x,y,z}; shorthand posX/posY/posZ and targetX/targetY/targetZ are supported. Existing bound camera keyframes are shifted so camera moves keep their relative orbit/zoom.",
    inputSchema: obj({
      sceneId: str,
      cameraId: str,
      name: str,
      position: { type: "object" },
      target: { type: "object" },
      posX: num,
      posY: num,
      posZ: num,
      targetX: num,
      targetY: num,
      targetZ: num,
      fov: num,
      focusDistance: num,
      depthOfField: bool,
      active: bool,
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const cameraId = optionalString(args.cameraId) ?? scene.activeCameraId;
      if (!cameraId) return fail("cameraId is required when the scene has no active camera", "INVALID_PARAMS");
      const camera = scene.cameras.find((candidate) => candidate.id === cameraId);
      if (!camera) return fail(`Creation camera not found: ${cameraId}`, "NOT_FOUND");
      const nextCamera = cameraFromArgs(args, camera);
      const active =
        typeof args.active === "boolean" ? args.active : scene.activeCameraId === camera.id;

      let nextComposition: MotionComposition | undefined;
      const binding = scene.renderBindings.find((candidate) => candidate.kind === "motion-scene3d");
      if (binding) {
        const composition = getMotionComposition(host, binding.compositionId);
        if (!composition) {
          return fail(`Bound Motion composition not found: ${binding.compositionId}`, "NOT_FOUND");
        }
        const layer = composition.layers.find(
          (candidate): candidate is MotionScene3DLayer =>
            candidate.id === binding.layerId && candidate.type === "scene3d",
        );
        if (!layer) return fail(`Bound scene3d layer not found: ${binding.layerId}`, "NOT_FOUND");
        const nextLayer = updateScene3DLayerCamera(layer, camera, nextCamera);
        nextComposition = {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: Date.now(),
        };
      }

      const operation = {
        id: genId(),
        type: "camera/upsert" as const,
        timestamp: Date.now(),
        source: "agent" as const,
        label: `Set camera ${nextCamera.name}`,
        sceneId: scene.id,
        camera: nextCamera,
        active,
      };
      const applied = await applyMotionAction(host, "creation/applyOperation", {
        operation,
      });
      if (!applied.ok) return applied;
      if (nextComposition) {
        const synced = await commitMotionComposition(host, nextComposition);
        if (!synced.ok) return synced;
      }

      return ok(
        nextComposition
          ? `Updated camera ${nextCamera.id} and synced Motion camera`
          : `Updated camera ${nextCamera.id}`,
        {
          sceneId: scene.id,
          cameraId: nextCamera.id,
          camera: nextCamera,
          operationId: operation.id,
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
        },
      );
    },
  },
  {
    name: "animate_creation_camera",
    domain: "motion",
    title: "Animate creation camera",
    description:
      "Create or replace semantic animation tracks for a creation scene camera and sync the bound Motion Creator scene3d camera keyframes. Use mode='orbit' for camera revolves around a target with optional radius push-in and FOV change, mode='dolly' for start/end position moves, mode='zoom' for FOV/focus moves, or pass explicit position/target/fov/focusDistance keyframe arrays. Position/target entries are {time,x,y,z,easing}; fov/focusDistance entries are {time,value,easing}.",
    inputSchema: obj({
      sceneId: str,
      cameraId: str,
      clipId: str,
      name: str,
      duration: num,
      mode: str,
      orbit: bool,
      startTime: num,
      endTime: num,
      easing: str,
      samples: num,
      sampleCount: num,
      orbitTarget: { type: "object" },
      targetX: num,
      targetY: num,
      targetZ: num,
      endTarget: { type: "object" },
      endTargetX: num,
      endTargetY: num,
      endTargetZ: num,
      startAngle: num,
      startAngleDeg: num,
      endAngle: num,
      endAngleDeg: num,
      orbitDegrees: num,
      radius: num,
      radiusStart: num,
      startRadius: num,
      radiusEnd: num,
      endRadius: num,
      height: num,
      heightStart: num,
      startHeight: num,
      heightEnd: num,
      endHeight: num,
      startPosition: { type: "object" },
      startPosX: num,
      startPosY: num,
      startPosZ: num,
      endPosition: { type: "object" },
      endPosX: num,
      endPosY: num,
      endPosZ: num,
      fovStart: num,
      startFov: num,
      fovEnd: num,
      endFov: num,
      fovTo: num,
      focusDistanceStart: num,
      startFocusDistance: num,
      focusDistanceEnd: num,
      endFocusDistance: num,
      focusDistanceTo: num,
      position: { type: "array" },
      target: { type: "array" },
      fov: { type: "array" },
      focusDistance: { type: "array" },
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const cameraId = optionalString(args.cameraId) ?? scene.activeCameraId;
      if (!cameraId) {
        return fail("cameraId is required when the scene has no active camera", "INVALID_PARAMS");
      }
      const camera = scene.cameras.find((candidate) => candidate.id === cameraId);
      if (!camera) return fail(`Creation camera not found: ${cameraId}`, "NOT_FOUND");

      const clipId = optionalString(args.clipId) ?? `anim-${cameraId}-agent-camera`;
      const built = buildCreationCameraAnimationTracks(args, camera, scene, clipId);
      if (built.tracks.length === 0) {
        return fail(
          "Provide mode='orbit'/'dolly'/'zoom' or explicit position, target, fov, and/or focusDistance keyframes",
          "INVALID_PARAMS",
        );
      }
      const existingClip = scene.animations.find((clip) => clip.id === clipId);
      const duration = Math.max(
        0,
        optionalNumber(args.duration) ??
          existingClip?.duration ??
          scene.duration ??
          maxCreationKeyframeTime(built.tracks),
        maxCreationKeyframeTime(built.tracks),
      );
      const clip = mergeCreationCameraAnimationClip(
        existingClip,
        camera,
        built.tracks,
        built.channels,
        {
          clipId,
          name: optionalString(args.name),
          duration,
        },
      );

      let nextComposition: MotionComposition | undefined;
      let renderKeyframeCount = 0;
      const binding = scene.renderBindings.find((candidate) => candidate.kind === "motion-scene3d");
      if (binding) {
        const composition = getMotionComposition(host, binding.compositionId);
        if (!composition) {
          return fail(`Bound Motion composition not found: ${binding.compositionId}`, "NOT_FOUND");
        }
        const layer = composition.layers.find(
          (candidate): candidate is MotionScene3DLayer =>
            candidate.id === binding.layerId && candidate.type === "scene3d",
        );
        if (!layer) return fail(`Bound scene3d layer not found: ${binding.layerId}`, "NOT_FOUND");
        const updated = updateScene3DLayerCameraAnimation(layer, camera, built.tracks);
        renderKeyframeCount = updated.renderKeyframeCount;
        nextComposition = {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === updated.layer.id ? updated.layer : candidate,
          ),
          modifiedAt: Date.now(),
        };
      }

      const operation = {
        id: genId(),
        type: "animation/upsert-clip" as const,
        timestamp: Date.now(),
        source: "agent" as const,
        label: `Animate ${camera.name}`,
        sceneId: scene.id,
        clip,
      };
      const applied = await applyMotionAction(host, "creation/applyOperation", {
        operation,
      });
      if (!applied.ok) return applied;
      if (nextComposition) {
        const synced = await commitMotionComposition(host, nextComposition);
        if (!synced.ok) return synced;
      }

      return ok(
        nextComposition
          ? `Animated creation camera ${cameraId} and synced Motion camera keyframes`
          : `Animated creation camera ${cameraId}`,
        {
          sceneId: scene.id,
          cameraId,
          clipId,
          trackIds: built.tracks.map((track) => track.id),
          channels: [...built.channels],
          operationId: operation.id,
          renderKeyframeCount,
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
        },
      );
    },
  },
  {
    name: "animate_creation_object",
    domain: "motion",
    title: "Animate creation object",
    description:
      "Create or replace semantic animation tracks for a creation scene object and sync the bound Motion Creator scene3d render object when a render binding exists. Use this instead of animate_scene_object for agent-native product parts so the editable creation scene and rendered keyframes stay together. `position`, `rotation`, and `scale` are arrays of {time,x,y,z,easing}; `opacity` is {time,value,easing}. Re-calling replaces only the channels provided.",
    inputSchema: obj({
      sceneId: str,
      objectId: str,
      clipId: str,
      name: str,
      duration: num,
      position: { type: "array" },
      rotation: { type: "array" },
      scale: { type: "array" },
      opacity: { type: "array" },
    }, ["objectId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const objectId = optionalString(args.objectId);
      if (!objectId) return fail("objectId is required", "INVALID_PARAMS");
      const object = scene.objects.find(
        (candidate): candidate is CreationSceneObject => candidate.id === objectId,
      );
      if (!object) return fail(`Creation object not found: ${objectId}`, "NOT_FOUND");

      const clipId = optionalString(args.clipId) ?? `anim-${objectId}-agent-motion`;
      const built = buildCreationObjectAnimationTracks(args, object, clipId);
      if (built.tracks.length === 0) {
        return fail(
          "Provide position, rotation, scale, and/or opacity keyframes",
          "INVALID_PARAMS",
        );
      }
      const existingClip = scene.animations.find((clip) => clip.id === clipId);
      const duration = Math.max(
        0,
        optionalNumber(args.duration) ??
          existingClip?.duration ??
          scene.duration ??
          maxCreationKeyframeTime(built.tracks),
        maxCreationKeyframeTime(built.tracks),
      );
      const clip = mergeCreationObjectAnimationClip(
        existingClip,
        object,
        built.tracks,
        built.channels,
        {
          clipId,
          name: optionalString(args.name),
          duration,
        },
      );
      const bound = bindingForObject(scene, objectId);

      let nextComposition: MotionComposition | undefined;
      let syncedRenderObjectId: string | undefined;
      if (bound) {
        const composition = getMotionComposition(host, bound.binding.compositionId);
        if (!composition) {
          return fail(
            `Bound Motion composition not found: ${bound.binding.compositionId}`,
            "NOT_FOUND",
          );
        }
        const layer = composition.layers.find(
          (candidate): candidate is MotionScene3DLayer =>
            candidate.id === bound.binding.layerId && candidate.type === "scene3d",
        );
        if (!layer) {
          return fail(`Bound scene3d layer not found: ${bound.binding.layerId}`, "NOT_FOUND");
        }
        const nextLayer = updateScene3DLayerObjectAnimation(
          layer,
          bound.renderObjectId,
          built.tracks,
        );
        if (typeof nextLayer === "string") return fail(nextLayer, "INVALID_PARAMS");
        nextComposition = {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: Date.now(),
        };
        syncedRenderObjectId = bound.renderObjectId;
      }

      const operation = {
        id: genId(),
        type: "animation/upsert-clip" as const,
        timestamp: Date.now(),
        source: "agent" as const,
        label: `Animate ${object.name}`,
        sceneId: scene.id,
        clip,
      };
      const applied = await applyMotionAction(host, "creation/applyOperation", {
        operation,
      });
      if (!applied.ok) return applied;
      if (nextComposition) {
        const synced = await commitMotionComposition(host, nextComposition);
        if (!synced.ok) return synced;
      }

      return ok(
        syncedRenderObjectId
          ? `Animated creation object ${objectId} and synced ${syncedRenderObjectId}`
          : `Animated creation object ${objectId}`,
        {
          sceneId: scene.id,
          objectId,
          clipId,
          trackIds: built.tracks.map((track) => track.id),
          channels: [...built.channels],
          operationId: operation.id,
          syncedRenderObjectId,
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: bound?.binding.layerId,
        },
      );
    },
  },
  {
    name: "animate_creation_exploded_view",
    domain: "motion",
    title: "Animate creation exploded view",
    description:
      "Create or replace a semantic multi-object exploded-view animation for agent-native product parts or arbitrary creation objects, store per-object exploded-view recipe metadata on the affected assets, dirty generated caches, and sync bound Motion Creator scene3d position keyframes. Select with objectIds, partIds, or tags; omit selection to animate all visible selectable scene objects.",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      clipId: str,
      name: str,
      axis: str,
      mode: str,
      distance: num,
      amount: num,
      spacing: num,
      startTime: num,
      endTime: num,
      duration: num,
      explodeDuration: num,
      clipDuration: num,
      totalDuration: num,
      stagger: num,
      holdTime: num,
      returnDuration: num,
      returnToAssembled: bool,
      reassemble: bool,
      return: bool,
      origin: { type: "object" },
      originX: num,
      originY: num,
      originZ: num,
      easing: str,
      returnEasing: str,
      nodeName: str,
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");

      const objectsOrError = resolveCreationExplodedViewObjects(scene, args);
      if (typeof objectsOrError === "string") {
        return fail(objectsOrError, "INVALID_PARAMS");
      }
      const objects = objectsOrError;
      const clipId =
        optionalString(args.clipId) ?? `anim-${scene.id}-exploded-view`;
      const built = buildCreationExplodedViewTracks(args, objects, clipId);
      if (built.tracks.length === 0) {
        return fail("No creation objects selected for exploded-view animation", "INVALID_PARAMS");
      }

      const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
      const objectsByAssetId = new Map<string, CreationSceneObject[]>();
      for (const object of objects) {
        const asset = assetsById.get(object.assetId);
        if (!asset) return fail(`Creation asset not found: ${object.assetId}`, "NOT_FOUND");
        const group = objectsByAssetId.get(object.assetId) ?? [];
        group.push(object);
        objectsByAssetId.set(object.assetId, group);
      }

      const existingClip = scene.animations.find((clip) => clip.id === clipId);
      const duration = Math.max(
        built.duration,
        optionalNumber(args.clipDuration) ??
          optionalNumber(args.totalDuration) ??
          existingClip?.duration ??
          scene.duration ??
          0,
      );
      const targetIds = new Set(objects.map((object) => object.id));
      const clip = mergeCreationObjectAnimationClipForTargets(
        existingClip,
        targetIds,
        built.tracks,
        new Set(["position"]),
        {
          clipId,
          name: optionalString(args.name) ?? "Agent exploded view",
          duration,
        },
      );
      const now = Date.now();
      const motionsByObjectId = new Map(
        built.motions.map((motion) => [motion.object.id, motion]),
      );
      const assetOperations = [...objectsByAssetId].map(([assetId, assetObjects]) => {
        const asset = assetsById.get(assetId);
        if (!asset) throw new Error(`Creation asset not found: ${assetId}`);
        return {
          id: genId(),
          type: "asset/upsert" as const,
          timestamp: now,
          source: "agent" as const,
          label: `Add exploded-view metadata to ${asset.name}`,
          asset: updateCreationAssetExplodedView(asset, assetObjects, motionsByObjectId, {
            args,
            clipId,
            axis: built.axis,
            origin: built.origin,
            distance: built.distance,
            spacing: built.spacing,
            returnToAssembled: built.returnToAssembled,
            now,
          }),
        };
      });
      const animationOperation = {
        id: genId(),
        type: "animation/upsert-clip" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Animate exploded view for ${objects.length} creation objects`,
        sceneId: scene.id,
        clip,
      };

      const renderGroups = new Map<
        string,
        {
          readonly binding: CreationRenderBinding;
          readonly renderObjectIdsByObjectId: Map<string, string>;
        }
      >();
      for (const object of objects) {
        const bound = bindingForObject(scene, object.id);
        if (!bound) continue;
        const key = `${bound.binding.compositionId}:${bound.binding.layerId}`;
        const group =
          renderGroups.get(key) ?? {
            binding: bound.binding,
            renderObjectIdsByObjectId: new Map<string, string>(),
          };
        group.renderObjectIdsByObjectId.set(object.id, bound.renderObjectId);
        renderGroups.set(key, group);
      }

      const nextCompositions = new Map<string, MotionComposition>();
      const syncedRenderObjectIds: string[] = [];
      let renderKeyframeCount = 0;
      for (const group of renderGroups.values()) {
        const composition =
          nextCompositions.get(group.binding.compositionId) ??
          getMotionComposition(host, group.binding.compositionId);
        if (!composition) {
          return fail(
            `Bound Motion composition not found: ${group.binding.compositionId}`,
            "NOT_FOUND",
          );
        }
        const layer = composition.layers.find(
          (candidate): candidate is MotionScene3DLayer =>
            candidate.id === group.binding.layerId && candidate.type === "scene3d",
        );
        if (!layer) {
          return fail(`Bound scene3d layer not found: ${group.binding.layerId}`, "NOT_FOUND");
        }
        const groupTracks = built.tracks.filter((track) =>
          group.renderObjectIdsByObjectId.has(track.targetId),
        );
        const updatedLayer = updateScene3DLayerObjectAnimations(
          layer,
          group.renderObjectIdsByObjectId,
          groupTracks,
        );
        if (typeof updatedLayer === "string") return fail(updatedLayer, "INVALID_PARAMS");
        nextCompositions.set(group.binding.compositionId, {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === updatedLayer.layer.id ? updatedLayer.layer : candidate,
          ),
          modifiedAt: now,
        });
        renderKeyframeCount += updatedLayer.renderKeyframeCount;
        syncedRenderObjectIds.push(...group.renderObjectIdsByObjectId.values());
      }

      const operationIds: string[] = [];
      for (const operation of assetOperations) {
        const applied = await applyMotionAction(host, "creation/applyOperation", {
          operation,
        });
        if (!applied.ok) return applied;
        operationIds.push(operation.id);
      }
      const animationApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: animationOperation,
      });
      if (!animationApplied.ok) return animationApplied;
      operationIds.push(animationOperation.id);
      for (const composition of nextCompositions.values()) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      return ok(
        syncedRenderObjectIds.length > 0
          ? `Animated exploded view for ${objects.length} creation objects and synced ${syncedRenderObjectIds.length} render objects`
          : `Animated exploded view for ${objects.length} creation objects`,
        {
          sceneId: scene.id,
          clipId,
          objectIds: objects.map((object) => object.id),
          partIds: objects.map((object) => object.partId).filter(Boolean),
          assetIds: [...objectsByAssetId.keys()],
          trackIds: built.tracks.map((track) => track.id),
          operationIds,
          axis: built.axis,
          distance: built.distance,
          spacing: built.spacing,
          origin: built.origin,
          returnToAssembled: built.returnToAssembled,
          explodedPositionsByObjectId: Object.fromEntries(
            built.motions.map((motion) => [motion.object.id, motion.explodedPosition]),
          ),
          syncedRenderObjectIds,
          syncedCompositionIds: [...nextCompositions.keys()],
          renderKeyframeCount,
        },
      );
    },
  },
  {
    name: "apply_creation_cloth_wave",
    domain: "motion",
    title: "Apply cloth wave",
    description:
      "Add a first-pass procedural cloth/flag wave to a semantic creation object. This stores clothWave recipe metadata on the object's asset, adds a cloth recipe node, dirties generated caches, persists an editable animation clip, and syncs approximate scene3d rotation keyframes when a render binding exists. Use this for flags, fabric panels, ribbons, capes, and other simple cloth motion until a full cloth solver is available.",
    inputSchema: obj({
      sceneId: str,
      objectId: str,
      clipId: str,
      name: str,
      duration: num,
      startTime: num,
      cycles: num,
      frequency: num,
      samples: num,
      sampleCount: num,
      amplitude: num,
      amplitudeDegrees: num,
      axis: str,
      phase: num,
      easing: str,
      pinnedEdge: str,
      windStrength: num,
      nodeName: str,
    }, ["objectId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const objectId = optionalString(args.objectId);
      if (!objectId) return fail("objectId is required", "INVALID_PARAMS");
      const object = scene.objects.find(
        (candidate): candidate is CreationSceneObject => candidate.id === objectId,
      );
      if (!object) return fail(`Creation object not found: ${objectId}`, "NOT_FOUND");
      const asset = state.assets.find((candidate) => candidate.id === object.assetId);
      if (!asset) return fail(`Creation asset not found: ${object.assetId}`, "NOT_FOUND");

      const now = Date.now();
      const clipId = optionalString(args.clipId) ?? `anim-${objectId}-cloth-wave`;
      const built = buildCreationClothWaveTracks(args, object, clipId);
      const existingClip = scene.animations.find((clip) => clip.id === clipId);
      const duration = Math.max(
        0,
        optionalNumber(args.duration) ??
          existingClip?.duration ??
          scene.duration ??
          maxCreationKeyframeTime(built.tracks),
        maxCreationKeyframeTime(built.tracks),
      );
      const clip = mergeCreationObjectAnimationClip(
        existingClip,
        object,
        built.tracks,
        built.channels,
        {
          clipId,
          name: optionalString(args.name) ?? `Cloth wave ${object.name}`,
          duration,
        },
      );
      const nextAsset = updateCreationAssetClothWave(asset, args, clipId, now);
      const bound = bindingForObject(scene, object.id);

      let nextComposition: MotionComposition | undefined;
      let syncedRenderObjectId: string | undefined;
      if (bound) {
        const composition = getMotionComposition(host, bound.binding.compositionId);
        if (!composition) {
          return fail(
            `Bound Motion composition not found: ${bound.binding.compositionId}`,
            "NOT_FOUND",
          );
        }
        const layer = composition.layers.find(
          (candidate): candidate is MotionScene3DLayer =>
            candidate.id === bound.binding.layerId && candidate.type === "scene3d",
        );
        if (!layer) return fail(`Bound scene3d layer not found: ${bound.binding.layerId}`, "NOT_FOUND");
        const nextLayer = updateScene3DLayerObjectAnimation(
          layer,
          bound.renderObjectId,
          built.tracks,
        );
        if (typeof nextLayer === "string") return fail(nextLayer, "INVALID_PARAMS");
        nextComposition = {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        };
        syncedRenderObjectId = bound.renderObjectId;
      }

      const assetOperation = {
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add cloth wave metadata to ${asset.name}`,
        asset: nextAsset,
      };
      const animationOperation = {
        id: genId(),
        type: "animation/upsert-clip" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Apply cloth wave to ${object.name}`,
        sceneId: scene.id,
        clip,
      };
      const assetApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: assetOperation,
      });
      if (!assetApplied.ok) return assetApplied;
      const animationApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: animationOperation,
      });
      if (!animationApplied.ok) return animationApplied;
      if (nextComposition) {
        const synced = await commitMotionComposition(host, nextComposition);
        if (!synced.ok) return synced;
      }

      return ok(
        syncedRenderObjectId
          ? `Applied cloth wave to ${object.id} and synced ${syncedRenderObjectId}`
          : `Applied cloth wave to ${object.id}`,
        {
          sceneId: scene.id,
          objectId: object.id,
          assetId: asset.id,
          clipId,
          trackIds: built.tracks.map((track) => track.id),
          sampleCount: built.sampleCount,
          operationIds: [assetOperation.id, animationOperation.id],
          syncedRenderObjectId,
          syncedCompositionId: nextComposition?.id,
          clothWave: nextAsset.parameters.clothWave,
        },
      );
    },
  }
];
