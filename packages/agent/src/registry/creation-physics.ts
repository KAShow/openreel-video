import {
  RegisteredTool,
  addVec3,
  applyMotionAction,
  bool,
  buildClothMeshFrames,
  buildCreationDropTracks,
  buildCreationRigidSolverTracks,
  buildCreationScatterInstances,
  buildHumanoidMeshFrames,
  buildParticleMeshFrames,
  buildSkinnedLimbMeshFrames,
  clampNumber,
  commitCreationRigidBake,
  commitMotionComposition,
  compactCreationParameters,
  creationState,
  dirtyCreationAssetCaches,
  fail,
  findCreationSceneObjectByReference,
  genId,
  getMotionComposition,
  idSegment,
  motionSceneObjectFromCreation,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  parseStringArray,
  resolveCreationExplodedViewObjects,
  resolveCreationParentId,
  resolveCreationScatterSource,
  resolveCreationScene,
  str,
  updateCreationAssetClothBake,
  updateCreationAssetHumanoid,
  updateCreationAssetParticleBake,
  updateCreationAssetRigidDrop,
  updateCreationAssetScatterGroup,
  updateCreationAssetSkinnedLimb,
  vec3FromArgs,
} from "./shared";
import {
  type CreationAssetRecipe,
  type CreationMaterial,
  type CreationRenderBinding,
  type CreationScene,
  type CreationSceneObject,
  type Transform3D,
} from "@openreel/core/creation/index";
import {
  type MotionComposition,
  type MotionScene3DLayer,
  type MotionSceneObject3D,
} from "@openreel/core/motion/types";

export const creationPhysicsTools: RegisteredTool[] = [
  {
    name: "duplicate_creation_object",
    domain: "motion",
    title: "Duplicate creation object",
    description:
      "Duplicate one semantic creation object into an independent editable variant (its own asset and material) and sync it into the bound scene3d layer. Use this for product color/material variants, A-B comparison shots, character crowd variants, or prop copies that must be styled independently. Apply color/metalness/roughness/opacity/emissive overrides and an offset/position. The variant survives scene-to-motion recovery.",
    inputSchema: obj({
      sceneId: str,
      sourceObjectId: str,
      sourcePartId: str,
      sourcePart: str,
      objectId: str,
      partId: str,
      key: str,
      newObjectId: str,
      newAssetId: str,
      newMaterialId: str,
      newRenderObjectId: str,
      newPartId: str,
      name: str,
      parentId: str,
      parentKey: str,
      position: { type: "object" },
      x: num,
      y: num,
      z: num,
      offset: { type: "object" },
      offsetX: num,
      offsetY: num,
      offsetZ: num,
      color: str,
      baseColor: str,
      metalness: num,
      metallic: num,
      roughness: num,
      opacity: num,
      emissive: str,
      emissiveIntensity: num,
      tags: { type: "array" },
      visible: bool,
      selectable: bool,
    }, ["sceneId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");

      const sourceRef =
        optionalString(args.sourceObjectId) ??
        optionalString(args.sourcePartId) ??
        optionalString(args.sourcePart) ??
        optionalString(args.objectId) ??
        optionalString(args.partId);
      if (!sourceRef) {
        return fail("Provide sourceObjectId or sourcePartId", "INVALID_PARAMS");
      }
      const source = findCreationSceneObjectByReference(scene, sourceRef);
      if (!source) return fail(`Creation source object not found: ${sourceRef}`, "NOT_FOUND");
      const sourceAsset = state.assets.find((asset) => asset.id === source.assetId);
      if (!sourceAsset) return fail(`Creation source asset not found: ${source.assetId}`, "NOT_FOUND");

      const sceneKey = idSegment(scene.id, "scene");
      const key = idSegment(
        args.key ?? args.newObjectId ?? args.name ?? `${idSegment(source.partId ?? source.id, "object")}-variant`,
        `${idSegment(source.partId ?? source.id, "object")}-variant`,
      );
      const newObjectId = optionalString(args.newObjectId) ?? `object-${sceneKey}-${key}`;
      const newAssetId = optionalString(args.newAssetId) ?? `asset-${sceneKey}-${key}`;
      const newMaterialId = optionalString(args.newMaterialId) ?? `mat-${sceneKey}-${key}`;
      const newRenderObjectId = optionalString(args.newRenderObjectId) ?? `obj-${sceneKey}-${key}`;
      const newPartId = optionalString(args.newPartId) ?? key;
      if (scene.objects.some((object) => object.id === newObjectId)) {
        return fail(`Creation object already exists: ${newObjectId}`, "INVALID_PARAMS");
      }
      if (state.assets.some((asset) => asset.id === newAssetId)) {
        return fail(`Creation asset already exists: ${newAssetId}`, "INVALID_PARAMS");
      }
      const existingRenderIds = new Set(
        scene.renderBindings.flatMap((binding) =>
          binding.objectBindings.map((objectBinding) => objectBinding.renderObjectId),
        ),
      );
      if (existingRenderIds.has(newRenderObjectId)) {
        return fail(`Render object already exists: ${newRenderObjectId}`, "INVALID_PARAMS");
      }

      const parent = resolveCreationParentId(scene, args.parentId, args.parentKey);
      if (!parent.ok) return fail(parent.error, "INVALID_PARAMS");
      const parentId = parent.parentId ?? source.parentId;

      const offset = vec3FromArgs(args.offset, { x: 0, y: 0, z: 0 }, ["offsetX", "offsetY", "offsetZ"], args);
      const position = vec3FromArgs(
        args.position,
        addVec3(source.transform.position, offset),
        ["x", "y", "z"],
        args,
      );
      const newTransform: Transform3D = {
        position,
        rotation: { ...source.transform.rotation },
        scale: { ...source.transform.scale },
      };

      const now = Date.now();
      const sourceMaterial =
        sourceAsset.materials.find((material) => material.id === source.materialId) ??
        sourceAsset.materials[0];
      const newMaterial: CreationMaterial = sourceMaterial
        ? {
            ...sourceMaterial,
            id: newMaterialId,
            name: optionalString(args.name) ? `${args.name} material` : sourceMaterial.name,
            baseColor:
              optionalString(args.color) ?? optionalString(args.baseColor) ?? sourceMaterial.baseColor,
            metallic:
              optionalNumber(args.metalness) ?? optionalNumber(args.metallic) ?? sourceMaterial.metallic,
            roughness: optionalNumber(args.roughness) ?? sourceMaterial.roughness,
            opacity: optionalNumber(args.opacity) ?? sourceMaterial.opacity,
            emissive: optionalString(args.emissive) ?? sourceMaterial.emissive,
            emissiveIntensity:
              optionalNumber(args.emissiveIntensity) ?? sourceMaterial.emissiveIntensity,
          }
        : {
            id: newMaterialId,
            name: "Variant material",
            model: "pbr",
            baseColor:
              optionalString(args.color) ?? optionalString(args.baseColor) ?? "#cbd5e1",
          };
      const cloneAsset: CreationAssetRecipe = {
        ...sourceAsset,
        id: newAssetId,
        name: optionalString(args.name) ?? `${sourceAsset.name} variant`,
        materials: [
          ...sourceAsset.materials.filter((material) => material.id !== newMaterialId),
          newMaterial,
        ],
        parameters: compactCreationParameters({
          ...sourceAsset.parameters,
          variantOf: sourceAsset.id,
          variantSourceObjectId: source.id,
        }),
        caches: dirtyCreationAssetCaches(
          sourceAsset,
          `cache-${idSegment(newAssetId, "asset")}-variant-preview`,
          "agent-variant-v1",
        ),
        createdAt: now,
        modifiedAt: now,
      };
      const cloneObject: CreationSceneObject = {
        id: newObjectId,
        name: optionalString(args.name) ?? `${source.name} variant`,
        assetId: newAssetId,
        materialId: newMaterialId,
        partId: newPartId,
        parentId,
        transform: newTransform,
        visible: args.visible !== false,
        selectable: args.selectable !== false,
        tags: [
          ...new Set([
            "agent-created",
            "variant",
            ...source.tags.filter((tag) => tag !== "agent-created"),
            ...(parseStringArray(args.tags) ?? []),
          ]),
        ],
      };

      let nextComposition: MotionComposition | undefined;
      let nextRenderBinding: CreationRenderBinding | undefined;
      const binding = scene.renderBindings.find(
        (candidate) => candidate.kind === "motion-scene3d",
      );
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
        const renderObject = motionSceneObjectFromCreation(cloneObject, cloneAsset, newRenderObjectId);
        const nextLayer: MotionScene3DLayer = {
          ...layer,
          objects: [...(layer.objects ?? []), renderObject],
        };
        nextComposition = {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        };
        nextRenderBinding = {
          ...binding,
          objectBindings: [
            ...binding.objectBindings,
            { sceneObjectId: cloneObject.id, renderObjectId: newRenderObjectId },
          ],
          modifiedAt: now,
        };
      }

      const nextScene: CreationScene = {
        ...scene,
        objects: [...scene.objects, cloneObject],
        renderBindings: nextRenderBinding
          ? scene.renderBindings.map((candidate) =>
              candidate.id === nextRenderBinding.id ? nextRenderBinding : candidate,
            )
          : scene.renderBindings,
        modifiedAt: now,
      };
      const assetOperation = {
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Duplicate ${source.name} as variant ${cloneObject.name}`,
        asset: cloneAsset,
      };
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add variant ${cloneObject.name} to ${scene.name}`,
        scene: nextScene,
      };
      const assetApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: assetOperation,
      });
      if (!assetApplied.ok) return assetApplied;
      const sceneApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: sceneOperation,
      });
      if (!sceneApplied.ok) return sceneApplied;
      if (nextComposition) {
        const synced = await commitMotionComposition(host, nextComposition);
        if (!synced.ok) return synced;
      }

      return ok(
        nextComposition
          ? `Duplicated ${source.id} as ${cloneObject.id} and synced ${newRenderObjectId}`
          : `Duplicated ${source.id} as ${cloneObject.id}`,
        {
          sceneId: scene.id,
          sourceObjectId: source.id,
          sourcePartId: source.partId,
          objectId: cloneObject.id,
          partId: cloneObject.partId,
          renderObjectId: newRenderObjectId,
          assetId: cloneAsset.id,
          materialId: newMaterial.id,
          parentId,
          position,
          operationIds: [assetOperation.id, sceneOperation.id],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          object: cloneObject,
        },
      );
    },
  },
  {
    name: "simulate_creation_rigid_drop",
    domain: "motion",
    title: "Simulate creation rigid drop",
    description:
      "Bake a deterministic rigid-body drop-and-settle simulation onto creation objects: each object falls under gravity from a drop height and bounces to rest, baked to editable position keyframes and synced into the bound scene3d layer. Select with objectIds, partIds, or tags; omit selection to drop all visible selectable objects. Use this for product parts dropping into place, assembly reveals, packaging drops, and terrain-contact settles. Stores rigid-drop recipe metadata and survives scene-to-motion recovery.",
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
      dropHeight: num,
      height: num,
      groundY: num,
      gravity: num,
      bounces: num,
      restitution: num,
      bounce: num,
      stagger: num,
      startTime: num,
      holdTime: num,
      duration: num,
      easing: str,
      nodeName: str,
    }, ["sceneId"]),
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
      if (typeof objectsOrError === "string") return fail(objectsOrError, "INVALID_PARAMS");
      const objects = objectsOrError;
      const clipId = optionalString(args.clipId) ?? `anim-${scene.id}-rigid-drop`;
      const built = buildCreationDropTracks(args, objects, clipId);
      if (built.tracks.length === 0) {
        return fail("No creation objects selected for rigid drop", "INVALID_PARAMS");
      }

      const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
      const now = Date.now();
      return commitCreationRigidBake(host, {
        scene,
        assetsById,
        objects,
        built,
        clipId,
        clipName: optionalString(args.name) ?? "Rigid-body drop",
        now,
        durationOverride: optionalNumber(args.duration),
        assetLabel: "Add rigid-drop metadata to",
        assetUpdater: (asset, assetObjects, motionsByObjectId) =>
          updateCreationAssetRigidDrop(asset, assetObjects, motionsByObjectId, {
            args,
            clipId,
            gravity: built.gravity,
            bounces: built.bounces,
            restitution: built.restitution,
            dropHeight: built.dropHeight,
            groundY: built.groundY,
            now,
          }),
        animationLabel: `Bake rigid drop for ${objects.length} creation objects`,
        successVerb: "Baked rigid drop",
        extraData: {
          dropHeight: built.dropHeight,
          gravity: built.gravity,
          bounces: built.bounces,
          restitution: built.restitution,
        },
      });
    },
  },
  {
    name: "simulate_creation_rigid_bodies",
    domain: "motion",
    title: "Simulate creation rigid bodies",
    description:
      "Bake a deterministic rigid-body physics simulation onto creation objects: each object drops from an optional height under gravity and collides with the ground AND with the other selected objects (friction, restitution, settling, sleeping), baked to editable position keyframes and synced into the bound scene3d layer. Select with objectIds, partIds, or tags. Use this for parts tumbling into a pile, debris settling, collision reveals, packaging fills, and physical stacking. Unlike simulate_creation_rigid_drop (which returns parts to their authored positions), this settles them on a shared ground plane with real inter-body collisions.",
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
      dropHeight: num,
      height: num,
      groundY: num,
      gravity: num,
      restitution: num,
      bounce: num,
      friction: num,
      fps: num,
      simDuration: num,
      duration: num,
      startTime: num,
      collide: bool,
      collideEachOther: bool,
      radius: num,
      bodyRadius: num,
      easing: str,
      nodeName: str,
    }, ["sceneId"]),
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
      if (typeof objectsOrError === "string") return fail(objectsOrError, "INVALID_PARAMS");
      const objects = objectsOrError;
      const clipId = optionalString(args.clipId) ?? `anim-${scene.id}-rigid-bodies`;
      const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
      const built = buildCreationRigidSolverTracks(args, objects, clipId, assetsById);
      if (built.tracks.length === 0) {
        return fail("No creation objects selected for rigid-body simulation", "INVALID_PARAMS");
      }

      const now = Date.now();
      const collide = args.collide !== false && args.collideEachOther !== false;
      const friction = clampNumber(optionalNumber(args.friction) ?? 0.2, 0, 1);
      return commitCreationRigidBake(host, {
        scene,
        assetsById,
        objects,
        built,
        clipId,
        clipName: optionalString(args.name) ?? "Rigid-body simulation",
        now,
        durationOverride: optionalNumber(args.duration),
        assetLabel: "Add rigid-body metadata to",
        assetUpdater: (asset, assetObjects, motionsByObjectId) =>
          updateCreationAssetRigidDrop(asset, assetObjects, motionsByObjectId, {
            args,
            clipId,
            gravity: built.gravity,
            bounces: built.bounces,
            restitution: built.restitution,
            dropHeight: built.dropHeight,
            groundY: built.groundY,
            solver: "rigid-body-solver",
            now,
          }),
        animationLabel: `Bake rigid-body simulation for ${objects.length} creation objects`,
        successVerb: "Baked rigid-body simulation",
        extraData: {
          dropHeight: built.dropHeight,
          gravity: built.gravity,
          restitution: built.restitution,
          friction,
          collideEachOther: collide,
          groundY: built.groundY,
        },
      });
    },
  },
  {
    name: "bake_creation_cloth",
    domain: "motion",
    title: "Bake creation cloth simulation",
    description:
      "Bake a deterministic mass-spring (Verlet) cloth simulation onto a selected creation surface (a plane/panel) — pinned edges, gravity, damping, and wind — into a per-frame deforming mesh that plays in the bound scene3d viewport without keyframes (sampled by time). Use this for flags, capes, banners, fabric drapes, curtains, sails, and hanging cloth. Pin options: top, top-corners, left, right, bottom, none. Plane: xy (hanging) or xz (flat/flag). Select with objectIds, partIds, or tags.",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      columns: num,
      rows: num,
      plane: str,
      pin: str,
      gravity: num,
      damping: num,
      wind: { type: "object" },
      windX: num,
      windY: num,
      windZ: num,
      fps: num,
      simDuration: num,
      duration: num,
      nodeName: str,
      name: str,
    }, ["sceneId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const selectedOrError = resolveCreationExplodedViewObjects(scene, args);
      if (typeof selectedOrError === "string") return fail(selectedOrError, "INVALID_PARAMS");
      const selected = selectedOrError;
      if (selected.length === 0) {
        return fail("No creation objects selected for cloth bake", "INVALID_PARAMS");
      }

      const now = Date.now();
      const selectedAssetIds = new Set(selected.map((object) => object.assetId));
      const affectedObjects = scene.objects.filter((object) =>
        selectedAssetIds.has(object.assetId),
      );
      const nextAssets = new Map<string, CreationAssetRecipe>();
      for (const assetId of selectedAssetIds) {
        const asset = state.assets.find((candidate) => candidate.id === assetId);
        if (!asset) return fail(`Creation asset not found: ${assetId}`, "NOT_FOUND");
        nextAssets.set(assetId, updateCreationAssetClothBake(asset, args, now));
      }

      const syncedRenderObjectIds: string[] = [];
      const bakedRenderObjectIds: string[] = [];
      let frameCount = 0;
      const nextCompositions: MotionComposition[] = [];
      for (const binding of scene.renderBindings.filter(
        (candidate) => candidate.kind === "motion-scene3d",
      )) {
        const composition = getMotionComposition(host, binding.compositionId);
        if (!composition) {
          return fail(
            `Bound Motion composition not found: ${binding.compositionId}`,
            "NOT_FOUND",
          );
        }
        const layer = composition.layers.find(
          (candidate): candidate is MotionScene3DLayer =>
            candidate.id === binding.layerId && candidate.type === "scene3d",
        );
        if (!layer) return fail(`Bound scene3d layer not found: ${binding.layerId}`, "NOT_FOUND");
        const objectIdByRenderId = new Map(
          binding.objectBindings.map((objectBinding) => [
            objectBinding.renderObjectId,
            objectBinding.sceneObjectId,
          ]),
        );
        const nextLayer: MotionScene3DLayer = {
          ...layer,
          objects: (layer.objects ?? []).map((renderObject) => {
            const sceneObjectId = objectIdByRenderId.get(renderObject.id);
            if (!sceneObjectId) return renderObject;
            const sceneObject = affectedObjects.find((object) => object.id === sceneObjectId);
            if (!sceneObject || !nextAssets.has(sceneObject.assetId)) return renderObject;
            syncedRenderObjectIds.push(renderObject.id);
            const worldWidth = (renderObject.object.size ?? 1) * 1.6;
            const worldHeight = worldWidth * (renderObject.object.aspect ?? 1);
            const meshFrames = buildClothMeshFrames(args, worldWidth, worldHeight);
            if (meshFrames.frames.length === 0 || meshFrames.indices.length < 3) {
              return renderObject;
            }
            bakedRenderObjectIds.push(renderObject.id);
            frameCount = meshFrames.frames.length;
            return {
              ...renderObject,
              object: { ...renderObject.object, mesh: undefined, meshFrames },
            };
          }),
        };
        nextCompositions.push({
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        });
      }

      const assetOperations = [...nextAssets.values()].map((asset) => ({
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Bake cloth for ${asset.name}`,
        asset,
      }));
      for (const operationEntry of assetOperations) {
        const applied = await applyMotionAction(host, "creation/applyOperation", {
          operation: operationEntry,
        });
        if (!applied.ok) return applied;
      }
      for (const composition of nextCompositions) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      return ok(
        bakedRenderObjectIds.length > 0
          ? `Baked cloth simulation (${frameCount} frames) for ${bakedRenderObjectIds.length} render objects`
          : "Baked cloth simulation",
        {
          sceneId: scene.id,
          selectedObjectIds: selected.map((object) => object.id),
          objectIds: affectedObjects.map((object) => object.id),
          partIds: affectedObjects.map((object) => object.partId).filter(Boolean),
          assetIds: [...nextAssets.keys()],
          frameCount,
          operationIds: assetOperations.map((entry) => entry.id),
          syncedRenderObjectIds,
          bakedRenderObjectIds,
          renderSyncCount: bakedRenderObjectIds.length,
          syncedCompositionIds: nextCompositions.map((composition) => composition.id),
        },
      );
    },
  },
  {
    name: "bake_creation_skinned_limb",
    domain: "motion",
    title: "Bake creation skinned limb",
    description:
      "Turn a selected creation object into a smoothly-deforming skinned limb (a bone chain + linear-blend skinning) animated with a traveling-wave curl, baked into a per-frame deforming mesh that plays in the bound scene3d viewport. Unlike rigid primitive parts that pivot about their own origin, the limb bends SMOOTHLY at every joint. Use this for tentacles, tails, cables, hoses, snakes, vines, antennae, robot-arm segments, and waving appendages. Select with objectIds, partIds, or tags; control with segments, radius, amplitudeDegrees, frequency, speed, axis (x|z), fps, simDuration.",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      segments: num,
      radialSegments: num,
      radius: num,
      amplitudeDegrees: num,
      amplitude: num,
      frequency: num,
      speed: num,
      axis: str,
      fps: num,
      simDuration: num,
      duration: num,
      nodeName: str,
      name: str,
    }, ["sceneId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const selectedOrError = resolveCreationExplodedViewObjects(scene, args);
      if (typeof selectedOrError === "string") return fail(selectedOrError, "INVALID_PARAMS");
      const selected = selectedOrError;
      if (selected.length === 0) {
        return fail("No creation objects selected for skinned limb", "INVALID_PARAMS");
      }

      const now = Date.now();
      const selectedAssetIds = new Set(selected.map((object) => object.assetId));
      const affectedObjects = scene.objects.filter((object) =>
        selectedAssetIds.has(object.assetId),
      );
      const nextAssets = new Map<string, CreationAssetRecipe>();
      for (const assetId of selectedAssetIds) {
        const asset = state.assets.find((candidate) => candidate.id === assetId);
        if (!asset) return fail(`Creation asset not found: ${assetId}`, "NOT_FOUND");
        nextAssets.set(assetId, updateCreationAssetSkinnedLimb(asset, args, now));
      }

      const syncedRenderObjectIds: string[] = [];
      const bakedRenderObjectIds: string[] = [];
      let frameCount = 0;
      const nextCompositions: MotionComposition[] = [];
      for (const binding of scene.renderBindings.filter(
        (candidate) => candidate.kind === "motion-scene3d",
      )) {
        const composition = getMotionComposition(host, binding.compositionId);
        if (!composition) {
          return fail(
            `Bound Motion composition not found: ${binding.compositionId}`,
            "NOT_FOUND",
          );
        }
        const layer = composition.layers.find(
          (candidate): candidate is MotionScene3DLayer =>
            candidate.id === binding.layerId && candidate.type === "scene3d",
        );
        if (!layer) return fail(`Bound scene3d layer not found: ${binding.layerId}`, "NOT_FOUND");
        const objectIdByRenderId = new Map(
          binding.objectBindings.map((objectBinding) => [
            objectBinding.renderObjectId,
            objectBinding.sceneObjectId,
          ]),
        );
        const nextLayer: MotionScene3DLayer = {
          ...layer,
          objects: (layer.objects ?? []).map((renderObject) => {
            const sceneObjectId = objectIdByRenderId.get(renderObject.id);
            if (!sceneObjectId) return renderObject;
            const sceneObject = affectedObjects.find((object) => object.id === sceneObjectId);
            if (!sceneObject || !nextAssets.has(sceneObject.assetId)) return renderObject;
            syncedRenderObjectIds.push(renderObject.id);
            const worldLength = (renderObject.object.size ?? 1) * 1.6;
            const meshFrames = buildSkinnedLimbMeshFrames(args, worldLength);
            if (meshFrames.frames.length === 0 || meshFrames.indices.length < 3) {
              return renderObject;
            }
            bakedRenderObjectIds.push(renderObject.id);
            frameCount = meshFrames.frames.length;
            return {
              ...renderObject,
              object: { ...renderObject.object, mesh: undefined, meshFrames },
            };
          }),
        };
        nextCompositions.push({
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        });
      }

      const assetOperations = [...nextAssets.values()].map((asset) => ({
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Bake skinned limb for ${asset.name}`,
        asset,
      }));
      for (const operationEntry of assetOperations) {
        const applied = await applyMotionAction(host, "creation/applyOperation", {
          operation: operationEntry,
        });
        if (!applied.ok) return applied;
      }
      for (const composition of nextCompositions) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      return ok(
        bakedRenderObjectIds.length > 0
          ? `Baked skinned limb (${frameCount} frames) for ${bakedRenderObjectIds.length} render objects`
          : "Baked skinned limb",
        {
          sceneId: scene.id,
          selectedObjectIds: selected.map((object) => object.id),
          objectIds: affectedObjects.map((object) => object.id),
          partIds: affectedObjects.map((object) => object.partId).filter(Boolean),
          assetIds: [...nextAssets.keys()],
          frameCount,
          operationIds: assetOperations.map((entry) => entry.id),
          syncedRenderObjectIds,
          bakedRenderObjectIds,
          renderSyncCount: bakedRenderObjectIds.length,
          syncedCompositionIds: nextCompositions.map((composition) => composition.id),
        },
      );
    },
  },
  {
    name: "bake_creation_humanoid",
    domain: "motion",
    title: "Bake creation humanoid character",
    description:
      "Turn a selected creation object into a SKINNED humanoid character (pelvis/spine/chest/neck/head, two arms, two legs as one bone-rigged mesh) animated with a chosen motion — animation: wave (default), walk, idle, or point — baked into a per-frame deforming mesh that plays in the bound scene3d viewport. Unlike separate rigid primitive body parts, the character deforms SMOOTHLY at every joint (shoulders, elbows, hips, knees) via linear-blend skinning. Use this for agent-native characters, mascots, avatars, and figures. Select with objectIds, partIds, or tags; control with animation, speed, idleSway, fps, simDuration, radialSegments. The object's size sets the character height.",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      animation: str,
      radialSegments: num,
      speed: num,
      idleSway: num,
      fps: num,
      simDuration: num,
      duration: num,
      nodeName: str,
      name: str,
    }, ["sceneId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const selectedOrError = resolveCreationExplodedViewObjects(scene, args);
      if (typeof selectedOrError === "string") return fail(selectedOrError, "INVALID_PARAMS");
      const selected = selectedOrError;
      if (selected.length === 0) {
        return fail("No creation objects selected for humanoid", "INVALID_PARAMS");
      }

      const now = Date.now();
      const selectedAssetIds = new Set(selected.map((object) => object.assetId));
      const affectedObjects = scene.objects.filter((object) =>
        selectedAssetIds.has(object.assetId),
      );
      const nextAssets = new Map<string, CreationAssetRecipe>();
      for (const assetId of selectedAssetIds) {
        const asset = state.assets.find((candidate) => candidate.id === assetId);
        if (!asset) return fail(`Creation asset not found: ${assetId}`, "NOT_FOUND");
        nextAssets.set(assetId, updateCreationAssetHumanoid(asset, args, now));
      }

      const syncedRenderObjectIds: string[] = [];
      const bakedRenderObjectIds: string[] = [];
      let frameCount = 0;
      const nextCompositions: MotionComposition[] = [];
      for (const binding of scene.renderBindings.filter(
        (candidate) => candidate.kind === "motion-scene3d",
      )) {
        const composition = getMotionComposition(host, binding.compositionId);
        if (!composition) {
          return fail(
            `Bound Motion composition not found: ${binding.compositionId}`,
            "NOT_FOUND",
          );
        }
        const layer = composition.layers.find(
          (candidate): candidate is MotionScene3DLayer =>
            candidate.id === binding.layerId && candidate.type === "scene3d",
        );
        if (!layer) return fail(`Bound scene3d layer not found: ${binding.layerId}`, "NOT_FOUND");
        const objectIdByRenderId = new Map(
          binding.objectBindings.map((objectBinding) => [
            objectBinding.renderObjectId,
            objectBinding.sceneObjectId,
          ]),
        );
        const nextLayer: MotionScene3DLayer = {
          ...layer,
          objects: (layer.objects ?? []).map((renderObject) => {
            const sceneObjectId = objectIdByRenderId.get(renderObject.id);
            if (!sceneObjectId) return renderObject;
            const sceneObject = affectedObjects.find((object) => object.id === sceneObjectId);
            if (!sceneObject || !nextAssets.has(sceneObject.assetId)) return renderObject;
            syncedRenderObjectIds.push(renderObject.id);
            const worldHeight = (renderObject.object.size ?? 1) * 1.6;
            const meshFrames = buildHumanoidMeshFrames(args, worldHeight);
            if (meshFrames.frames.length === 0 || meshFrames.indices.length < 3) {
              return renderObject;
            }
            bakedRenderObjectIds.push(renderObject.id);
            frameCount = meshFrames.frames.length;
            return {
              ...renderObject,
              object: { ...renderObject.object, mesh: undefined, meshFrames },
            };
          }),
        };
        nextCompositions.push({
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        });
      }

      const assetOperations = [...nextAssets.values()].map((asset) => ({
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Bake humanoid for ${asset.name}`,
        asset,
      }));
      for (const operationEntry of assetOperations) {
        const applied = await applyMotionAction(host, "creation/applyOperation", {
          operation: operationEntry,
        });
        if (!applied.ok) return applied;
      }
      for (const composition of nextCompositions) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      return ok(
        bakedRenderObjectIds.length > 0
          ? `Baked skinned humanoid (${frameCount} frames) for ${bakedRenderObjectIds.length} render objects`
          : "Baked skinned humanoid",
        {
          sceneId: scene.id,
          selectedObjectIds: selected.map((object) => object.id),
          objectIds: affectedObjects.map((object) => object.id),
          partIds: affectedObjects.map((object) => object.partId).filter(Boolean),
          assetIds: [...nextAssets.keys()],
          frameCount,
          operationIds: assetOperations.map((entry) => entry.id),
          syncedRenderObjectIds,
          bakedRenderObjectIds,
          renderSyncCount: bakedRenderObjectIds.length,
          syncedCompositionIds: nextCompositions.map((composition) => composition.id),
        },
      );
    },
  },
  {
    name: "bake_creation_particles",
    domain: "motion",
    title: "Bake creation particle system",
    description:
      "Turn a selected creation object into a deterministic particle burst (stars, sparks, embers, confetti, dust, snow, debris) simulated under gravity, drag, and wind, baked into a per-frame deforming point-cloud mesh that plays in the bound scene3d viewport. Each particle is a small octahedron; dead particles fade out. Unlike approximate drift keyframes, the motion is the real Euler particle solver. Select with objectIds, partIds, or tags; control with count, speed, spread, gravity, drag, lifetime, wind, particleSize, seed, fps, simDuration.",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      count: num,
      speed: num,
      spread: num,
      gravity: num,
      drag: num,
      lifetime: num,
      wind: { type: "object" },
      windX: num,
      windY: num,
      windZ: num,
      particleSize: num,
      seed: str,
      fps: num,
      simDuration: num,
      duration: num,
      nodeName: str,
      name: str,
    }, ["sceneId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const selectedOrError = resolveCreationExplodedViewObjects(scene, args);
      if (typeof selectedOrError === "string") return fail(selectedOrError, "INVALID_PARAMS");
      const selected = selectedOrError;
      if (selected.length === 0) {
        return fail("No creation objects selected for particle system", "INVALID_PARAMS");
      }

      const now = Date.now();
      const selectedAssetIds = new Set(selected.map((object) => object.assetId));
      const affectedObjects = scene.objects.filter((object) =>
        selectedAssetIds.has(object.assetId),
      );
      const nextAssets = new Map<string, CreationAssetRecipe>();
      for (const assetId of selectedAssetIds) {
        const asset = state.assets.find((candidate) => candidate.id === assetId);
        if (!asset) return fail(`Creation asset not found: ${assetId}`, "NOT_FOUND");
        nextAssets.set(assetId, updateCreationAssetParticleBake(asset, args, now));
      }

      const syncedRenderObjectIds: string[] = [];
      const bakedRenderObjectIds: string[] = [];
      let frameCount = 0;
      const nextCompositions: MotionComposition[] = [];
      for (const binding of scene.renderBindings.filter(
        (candidate) => candidate.kind === "motion-scene3d",
      )) {
        const composition = getMotionComposition(host, binding.compositionId);
        if (!composition) {
          return fail(
            `Bound Motion composition not found: ${binding.compositionId}`,
            "NOT_FOUND",
          );
        }
        const layer = composition.layers.find(
          (candidate): candidate is MotionScene3DLayer =>
            candidate.id === binding.layerId && candidate.type === "scene3d",
        );
        if (!layer) return fail(`Bound scene3d layer not found: ${binding.layerId}`, "NOT_FOUND");
        const objectIdByRenderId = new Map(
          binding.objectBindings.map((objectBinding) => [
            objectBinding.renderObjectId,
            objectBinding.sceneObjectId,
          ]),
        );
        const nextLayer: MotionScene3DLayer = {
          ...layer,
          objects: (layer.objects ?? []).map((renderObject) => {
            const sceneObjectId = objectIdByRenderId.get(renderObject.id);
            if (!sceneObjectId) return renderObject;
            const sceneObject = affectedObjects.find((object) => object.id === sceneObjectId);
            if (!sceneObject || !nextAssets.has(sceneObject.assetId)) return renderObject;
            syncedRenderObjectIds.push(renderObject.id);
            const worldSize = (renderObject.object.size ?? 1) * 1.6;
            const meshFrames = buildParticleMeshFrames(args, worldSize);
            if (meshFrames.frames.length === 0 || meshFrames.indices.length < 3) {
              return renderObject;
            }
            bakedRenderObjectIds.push(renderObject.id);
            frameCount = meshFrames.frames.length;
            return {
              ...renderObject,
              object: { ...renderObject.object, mesh: undefined, meshFrames },
            };
          }),
        };
        nextCompositions.push({
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        });
      }

      const assetOperations = [...nextAssets.values()].map((asset) => ({
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Bake particles for ${asset.name}`,
        asset,
      }));
      for (const operationEntry of assetOperations) {
        const applied = await applyMotionAction(host, "creation/applyOperation", {
          operation: operationEntry,
        });
        if (!applied.ok) return applied;
      }
      for (const composition of nextCompositions) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      return ok(
        bakedRenderObjectIds.length > 0
          ? `Baked particle system (${frameCount} frames) for ${bakedRenderObjectIds.length} render objects`
          : "Baked particle system",
        {
          sceneId: scene.id,
          selectedObjectIds: selected.map((object) => object.id),
          objectIds: affectedObjects.map((object) => object.id),
          partIds: affectedObjects.map((object) => object.partId).filter(Boolean),
          assetIds: [...nextAssets.keys()],
          frameCount,
          operationIds: assetOperations.map((entry) => entry.id),
          syncedRenderObjectIds,
          bakedRenderObjectIds,
          renderSyncCount: bakedRenderObjectIds.length,
          syncedCompositionIds: nextCompositions.map((composition) => composition.id),
        },
      );
    },
  },
  {
    name: "scatter_creation_objects",
    domain: "motion",
    title: "Scatter creation objects",
    description:
      "Duplicate one semantic creation object into many editable scene instances using deterministic grid, line, ring, or seeded-random patterns, then sync the new instances into the bound scene3d layer. Use for moon rocks, screws, windows, debris, product fasteners, environment dressing, repeated interface elements, and other dense scene detail without hand-adding every object.",
    inputSchema: obj({
      sceneId: str,
      sourceObjectId: str,
      sourcePartId: str,
      sourcePart: str,
      sourceObject: str,
      objectId: str,
      partId: str,
      key: str,
      groupId: str,
      name: str,
      namePrefix: str,
      partIdPrefix: str,
      partPrefix: str,
      parentId: str,
      parentKey: str,
      count: num,
      startIndex: num,
      pattern: str,
      mode: str,
      plane: str,
      axis: str,
      columns: num,
      spacing: num,
      spacingX: num,
      spacingY: num,
      spacingZ: num,
      radius: num,
      arcDegrees: num,
      arc: num,
      startAngle: num,
      width: num,
      height: num,
      depth: num,
      areaWidth: num,
      areaDepth: num,
      areaHeight: num,
      seed: str,
      position: { type: "object" },
      x: num,
      y: num,
      z: num,
      jitter: num,
      jitterX: num,
      jitterY: num,
      jitterZ: num,
      scale: num,
      scaleJitter: num,
      rotateStep: num,
      rotationJitter: num,
      rotationJitterX: num,
      rotationJitterY: num,
      rotationJitterZ: num,
      tags: { type: "array" },
      nodeName: str,
      visible: bool,
      selectable: bool,
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

      const source = resolveCreationScatterSource(scene, args);
      if (typeof source === "string") return fail(source, "INVALID_PARAMS");
      const sourceAsset = state.assets.find((asset) => asset.id === source.assetId);
      if (!sourceAsset) {
        return fail(`Creation asset not found for source object: ${source.assetId}`, "NOT_FOUND");
      }
      const scatter = buildCreationScatterInstances(scene, source, args);
      if (typeof scatter === "string") return fail(scatter, "INVALID_PARAMS");
      const now = Date.now();
      const nextAsset = updateCreationAssetScatterGroup(sourceAsset, source, args, {
        groupId: scatter.groupId,
        pattern: scatter.pattern,
        seed: scatter.seed,
        instances: scatter.instances,
        now,
      });

      let nextComposition: MotionComposition | undefined;
      let nextRenderBinding: CreationRenderBinding | undefined;
      const binding =
        scene.renderBindings.find((candidate) => candidate.kind === "motion-scene3d");
      if (binding) {
        const composition = getMotionComposition(host, binding.compositionId);
        if (!composition) {
          return fail(
            `Bound Motion composition not found: ${binding.compositionId}`,
            "NOT_FOUND",
          );
        }
        const layer = composition.layers.find(
          (candidate): candidate is MotionScene3DLayer =>
            candidate.id === binding.layerId && candidate.type === "scene3d",
        );
        if (!layer) return fail(`Bound scene3d layer not found: ${binding.layerId}`, "NOT_FOUND");
        const sourceRenderObjectId = binding.objectBindings.find(
          (objectBinding) => objectBinding.sceneObjectId === source.id,
        )?.renderObjectId;
        const sourceRenderObject = sourceRenderObjectId
          ? layer.objects?.find((object) => object.id === sourceRenderObjectId)
          : undefined;
        const templateRenderObject = sourceRenderObject ??
          motionSceneObjectFromCreation(source, sourceAsset, `obj-template-${source.id}`);
        const instanceRenderObjects: MotionSceneObject3D[] = scatter.instances.map(
          (instance) => ({
            ...templateRenderObject,
            id: instance.renderObjectId,
            name: instance.object.name,
            transform3d: instance.transform,
          }),
        );
        const nextLayer: MotionScene3DLayer = {
          ...layer,
          objects: [...(layer.objects ?? []), ...instanceRenderObjects],
        };
        nextComposition = {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        };
        nextRenderBinding = {
          ...binding,
          objectBindings: [
            ...binding.objectBindings,
            ...scatter.instances.map((instance) => ({
              sceneObjectId: instance.object.id,
              renderObjectId: instance.renderObjectId,
            })),
          ],
          modifiedAt: now,
        };
      }

      const nextScene: CreationScene = {
        ...scene,
        objects: [
          ...scene.objects,
          ...scatter.instances.map((instance) => instance.object),
        ],
        renderBindings: nextRenderBinding
          ? scene.renderBindings.map((candidate) =>
              candidate.id === nextRenderBinding.id ? nextRenderBinding : candidate,
            )
          : scene.renderBindings,
        modifiedAt: now,
      };
      const assetOperation = {
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Scatter ${source.name}`,
        asset: nextAsset,
      };
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Scatter ${scatter.instances.length} objects in ${scene.name}`,
        scene: nextScene,
      };
      const assetApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: assetOperation,
      });
      if (!assetApplied.ok) return assetApplied;
      const sceneApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: sceneOperation,
      });
      if (!sceneApplied.ok) return sceneApplied;
      if (nextComposition) {
        const synced = await commitMotionComposition(host, nextComposition);
        if (!synced.ok) return synced;
      }

      return ok(
        nextComposition
          ? `Scattered ${scatter.instances.length} instances and synced scene3d`
          : `Scattered ${scatter.instances.length} instances`,
        {
          sceneId: scene.id,
          sourceObjectId: source.id,
          sourcePartId: source.partId,
          sourceAssetId: sourceAsset.id,
          groupId: scatter.groupId,
          pattern: scatter.pattern,
          seed: scatter.seed,
          count: scatter.instances.length,
          objectIds: scatter.instances.map((instance) => instance.object.id),
          partIds: scatter.instances.map((instance) => instance.object.partId),
          renderObjectIds: scatter.instances.map((instance) => instance.renderObjectId),
          operationIds: [assetOperation.id, sceneOperation.id],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          scatterGroup: nextAsset.parameters.scatterGroup,
        },
      );
    },
  }
];
