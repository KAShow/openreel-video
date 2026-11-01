import {
  CREATION_CHARACTER_STYLE_PRESETS,
  CREATION_MATERIAL_MODELS,
  CREATION_PARTICLE_PRESETS,
  RegisteredTool,
  addVec3,
  applyMotionAction,
  bindingForObject,
  bool,
  buildCreationCharacterPoseTracks,
  buildSceneObject3D,
  clampNumber,
  commitMotionComposition,
  createSeededRandom,
  creationAnimationEasing,
  creationAssetFromSceneObject,
  creationCharacterPose,
  creationCharacterSide,
  creationCharacterStyle,
  creationMaterialFromSceneObject,
  creationParticleKind,
  creationParticlePoint,
  creationState,
  fail,
  genId,
  getMotionComposition,
  idSegment,
  maxCreationKeyframeTime,
  mergeCreationObjectAnimationClipForTargets,
  mergeSceneKeyframes,
  motionKeyframesForCreationObjectTracks,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  parseCreationCharacterParts,
  parseStringArray,
  randomSigned,
  requiredTransform3D,
  resolveCreationExplodedViewObjects,
  resolveCreationParentId,
  resolveCreationScene,
  scaleVec3,
  str,
  uniqueCreationEntityId,
  uniqueIdSegment,
  updateCreationAssetCharacterPart,
  updateCreationAssetCharacterPose,
  updateCreationAssetParticleSystem,
  updateScene3DLayerObjectAnimations,
  vec3FromArgs,
} from "./shared";
import {
  type CreationAnimationClip,
  type CreationAnimationKeyframe,
  type CreationAnimationTrack,
  type CreationAssetRecipe,
  type CreationMaterialModel,
  type CreationRenderBinding,
  type CreationScene,
  type CreationSceneObject,
} from "@openreel/core/creation/index";
import {
  type Keyframe,
} from "@openreel/core/types/timeline";
import {
  type MotionComposition,
  type MotionScene3DLayer,
  type MotionSceneObject3D,
} from "@openreel/core/motion/types";

export const creationCharacterTools: RegisteredTool[] = [
  {
    name: "add_creation_character",
    domain: "motion",
    title: "Add creation character",
    description:
      "Build an editable recipe-driven humanoid character (pelvis, torso, neck, head, two arms with forearms and hands, two legs with feet, plus optional helmet, visor, and backpack) in a creation scene and sync every part into the bound scene3d layer. Each part is a separate semantic object carrying skeleton/bone metadata so agents and professionals can pose, animate, restyle, label, explode, or refine it later. Style presets: stylized, realistic, low-poly, robot, astronaut, mascot. Use pose_creation_character afterward for wave/idle/point/cheer gestures.",
    inputSchema: obj({
      sceneId: str,
      key: str,
      characterId: str,
      objectId: str,
      renderObjectId: str,
      assetId: str,
      materialId: str,
      parentId: str,
      parentKey: str,
      name: str,
      partId: str,
      partIdPrefix: str,
      partPrefix: str,
      style: str,
      height: num,
      limbThickness: num,
      suitColor: str,
      bodyColor: str,
      color: str,
      skinColor: str,
      accentColor: str,
      gloveColor: str,
      bootColor: str,
      helmetColor: str,
      visorColor: str,
      visorEmissive: str,
      materialModel: str,
      roughness: num,
      metalness: num,
      includeArms: bool,
      includeLegs: bool,
      includeHelmet: bool,
      includeVisor: bool,
      includeBackpack: bool,
      position: { type: "object" },
      x: num,
      y: num,
      z: num,
      rotationY: num,
      facing: num,
      exactness: str,
      nodeName: str,
      tags: { type: "array" },
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

      const style = creationCharacterStyle(args.style);
      const preset = CREATION_CHARACTER_STYLE_PRESETS[style];
      const height = clampNumber(optionalNumber(args.height) ?? preset.height, 0.2, 12);

      const sceneKey = idSegment(scene.id, "scene");
      const key = idSegment(
        args.key ?? args.characterId ?? args.name ?? style,
        `character-${scene.objects.length + 1}`,
      );
      const characterId = optionalString(args.characterId) ?? `character-${sceneKey}-${key}`;
      const objectPrefix = optionalString(args.objectId) ?? `object-${sceneKey}-${key}`;
      const renderPrefix = optionalString(args.renderObjectId) ?? `obj-${sceneKey}-${key}`;
      const assetPrefix = optionalString(args.assetId) ?? `asset-${sceneKey}-${key}`;
      const materialPrefix = optionalString(args.materialId) ?? `mat-${sceneKey}-${key}`;
      const partPrefix = idSegment(args.partIdPrefix ?? args.partPrefix ?? args.partId ?? key, key);

      const parent = resolveCreationParentId(scene, args.parentId, args.parentKey);
      if (!parent.ok) return fail(parent.error, "INVALID_PARAMS");
      const parentId = parent.parentId;

      const components = parseCreationCharacterParts(args, { height, style, preset });
      if (components.length === 0) {
        return fail("Character requires at least one part", "INVALID_PARAMS");
      }

      const position = vec3FromArgs(args.position, { x: 0, y: 0, z: 0 }, ["x", "y", "z"], args);
      const yawDegrees = optionalNumber(args.rotationY) ?? optionalNumber(args.facing) ?? 0;
      const yaw = (yawDegrees * Math.PI) / 180;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);

      const existingObjectIds = new Set(scene.objects.map((object) => object.id));
      const existingAssetIds = new Set(state.assets.map((asset) => asset.id));
      const existingRenderIds = new Set(
        scene.renderBindings.flatMap((binding) =>
          binding.objectBindings.map((objectBinding) => objectBinding.renderObjectId),
        ),
      );
      const componentObjectIds: string[] = [];
      const componentAssetIds: string[] = [];
      const componentRenderObjectIds: string[] = [];
      const componentMaterialIds: string[] = [];
      const usedComponentKeys = new Set<string>();
      for (const component of components) {
        const componentKey = uniqueIdSegment(component.key, component.key, usedComponentKeys);
        if (componentKey !== component.key) {
          return fail(`Duplicate character part key: ${component.key}`, "INVALID_PARAMS");
        }
        const objectId = `${objectPrefix}-${component.key}`;
        const assetId = `${assetPrefix}-${component.key}`;
        const renderObjectId = `${renderPrefix}-${component.key}`;
        const materialId = `${materialPrefix}-${component.key}`;
        if (existingObjectIds.has(objectId)) {
          return fail(`Creation object already exists: ${objectId}`, "INVALID_PARAMS");
        }
        if (existingAssetIds.has(assetId)) {
          return fail(`Creation asset already exists: ${assetId}`, "INVALID_PARAMS");
        }
        if (existingRenderIds.has(renderObjectId)) {
          return fail(`Render object already exists: ${renderObjectId}`, "INVALID_PARAMS");
        }
        existingObjectIds.add(objectId);
        existingAssetIds.add(assetId);
        existingRenderIds.add(renderObjectId);
        componentObjectIds.push(objectId);
        componentAssetIds.push(assetId);
        componentRenderObjectIds.push(renderObjectId);
        componentMaterialIds.push(materialId);
      }

      const now = Date.now();
      const renderObjects: MotionSceneObject3D[] = [];
      const sceneObjects: CreationSceneObject[] = [];
      const assets: CreationAssetRecipe[] = [];
      const objectIdsByPartKey: Record<string, string> = {};
      const renderObjectIdsByPartKey: Record<string, string> = {};
      const assetIdsByPartKey: Record<string, string> = {};
      const materialIdsByPartKey: Record<string, string> = {};
      const partIdsByPartKey: Record<string, string> = {};
      const bonesByPartKey: Record<string, string> = {};

      for (let index = 0; index < components.length; index += 1) {
        const component = components[index];
        const worldPosition = {
          x: position.x + (component.localX * cos + component.localZ * sin),
          y: position.y + component.localY,
          z: position.z + (-component.localX * sin + component.localZ * cos),
        };
        const componentPartId = `${partPrefix}-${component.key}`;
        const rawObject: Record<string, unknown> = {
          kind: component.kind,
          name: component.name,
          assetId: componentAssetIds[index],
          assetName: component.name,
          assetKind: "character",
          materialId: componentMaterialIds[index],
          materialName: `${component.name} material`,
          materialModel: component.materialModel,
          materialKind: component.materialKind,
          x: worldPosition.x,
          y: worldPosition.y,
          z: worldPosition.z,
          rotationX: 0,
          rotationY: yawDegrees,
          rotationZ: 0,
          scaleX: component.scale.x,
          scaleY: component.scale.y,
          scaleZ: component.scale.z,
          depth: component.scale.z,
          cornerRadius: component.cornerRadius,
          color: component.color,
          baseColor: component.color,
          opacity: component.opacity,
          metalness: component.metalness,
          metallic: component.metalness,
          roughness: component.roughness,
          emissive: component.emissive,
          emissiveIntensity: component.emissiveIntensity,
        };
        const built = buildSceneObject3D(rawObject, componentRenderObjectIds[index]);
        if ("error" in built) return fail(built.error, "INVALID_PARAMS");
        const material = creationMaterialFromSceneObject(
          `${sceneKey}-${key}-${component.key}`,
          rawObject,
          built.object,
        );
        const baseAsset = creationAssetFromSceneObject(
          `${sceneKey}-${key}-${component.key}`,
          rawObject,
          built.object,
          material,
          now,
        );
        const sceneObject: CreationSceneObject = {
          id: componentObjectIds[index],
          name: built.object.name ?? component.name,
          assetId: baseAsset.id,
          materialId: material.id,
          partId: componentPartId,
          parentId,
          transform: requiredTransform3D(built.object),
          visible: args.visible !== false,
          selectable: args.selectable !== false,
          tags: [
            ...new Set([
              "agent-created",
              "character",
              characterId,
              style,
              component.role,
              component.bone,
              built.object.object.kind,
              ...component.tags,
              ...(parseStringArray(args.tags) ?? []),
            ]),
          ],
        };
        const asset = updateCreationAssetCharacterPart(baseAsset, sceneObject, args, {
          characterId,
          style,
          component,
          componentIndex: index,
          componentCount: components.length,
          componentObjectIds,
          componentAssetIds,
          componentRenderObjectIds,
          height,
          now,
        });
        renderObjects.push(built.object);
        sceneObjects.push(sceneObject);
        assets.push(asset);
        objectIdsByPartKey[component.key] = sceneObject.id;
        renderObjectIdsByPartKey[component.key] = componentRenderObjectIds[index];
        assetIdsByPartKey[component.key] = asset.id;
        materialIdsByPartKey[component.key] = material.id;
        partIdsByPartKey[component.key] = componentPartId;
        bonesByPartKey[component.key] = component.bone;
      }

      let nextComposition: MotionComposition | undefined;
      let nextRenderBinding: CreationRenderBinding | undefined;
      const binding = scene.renderBindings.find(
        (candidate) => candidate.kind === "motion-scene3d",
      );
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
        const nextLayer: MotionScene3DLayer = {
          ...layer,
          objects: [...(layer.objects ?? []), ...renderObjects],
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
            ...sceneObjects.map((object, index) => ({
              sceneObjectId: object.id,
              renderObjectId: componentRenderObjectIds[index],
            })),
          ],
          modifiedAt: now,
        };
      }

      const nextScene: CreationScene = {
        ...scene,
        objects: [...scene.objects, ...sceneObjects],
        renderBindings: nextRenderBinding
          ? scene.renderBindings.map((candidate) =>
              candidate.id === nextRenderBinding.id ? nextRenderBinding : candidate,
            )
          : scene.renderBindings,
        modifiedAt: now,
      };
      const assetOperations = assets.map((asset) => ({
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Create character part ${asset.name}`,
        asset,
      }));
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add ${style} character to ${scene.name}`,
        scene: nextScene,
      };
      for (const operation of assetOperations) {
        const assetApplied = await applyMotionAction(host, "creation/applyOperation", {
          operation,
        });
        if (!assetApplied.ok) return assetApplied;
      }
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
          ? `Added ${style} character ${characterId} and synced ${renderObjects.length} parts`
          : `Added ${style} character ${characterId}`,
        {
          sceneId: scene.id,
          characterId,
          style,
          height,
          partCount: components.length,
          objectIds: componentObjectIds,
          renderObjectIds: componentRenderObjectIds,
          assetIds: componentAssetIds,
          materialIds: componentMaterialIds,
          objectIdsByPartKey,
          renderObjectIdsByPartKey,
          assetIdsByPartKey,
          materialIdsByPartKey,
          partIdsByPartKey,
          bonesByPartKey,
          parentId,
          rotationY: yawDegrees,
          operationIds: [
            ...assetOperations.map((operation) => operation.id),
            sceneOperation.id,
          ],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          character: assets[0]?.parameters.character,
        },
      );
    },
  },
  {
    name: "pose_creation_character",
    domain: "motion",
    title: "Pose creation character",
    description:
      "Apply an editable pose/gesture animation (wave, idle, point, cheer, t-pose, a-pose) to a creation character's arm/torso/head parts and sync the bound scene3d rotation keyframes. Select the character with characterId (returned by add_creation_character), or with objectIds/partIds/tags. `side` (left/right) chooses the waving/pointing arm. The animation is stored as an editable clip and survives scene-to-motion recovery.",
    inputSchema: obj({
      sceneId: str,
      characterId: str,
      objectIds: { type: "array" },
      partIds: { type: "array" },
      tags: { type: "array" },
      pose: str,
      side: str,
      clipId: str,
      name: str,
      startTime: num,
      duration: num,
      cycles: num,
      amplitude: num,
      amplitudeDegrees: num,
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

      const characterId = optionalString(args.characterId);
      let parts: CreationSceneObject[];
      if (characterId) {
        parts = scene.objects.filter((object) => object.tags.includes(characterId));
        if (parts.length === 0) {
          return fail(`No character parts found for: ${characterId}`, "NOT_FOUND");
        }
      } else if (parseStringArray(args.objectIds ?? args.partIds ?? args.tags)) {
        const resolved = resolveCreationExplodedViewObjects(scene, args);
        if (typeof resolved === "string") return fail(resolved, "INVALID_PARAMS");
        parts = [...resolved];
      } else {
        parts = scene.objects.filter((object) => object.tags.includes("character"));
        if (parts.length === 0) {
          return fail(
            "No character found; provide characterId, objectIds, partIds, or tags",
            "INVALID_PARAMS",
          );
        }
      }

      const pose = creationCharacterPose(args.pose);
      const side = creationCharacterSide(args.side);
      const defaultDuration =
        pose === "idle" ? 3 : pose === "wave" ? 2.4 : pose === "cheer" ? 2 : pose === "point" ? 0.8 : 0.6;
      const defaultCycles = pose === "wave" ? 3 : pose === "cheer" ? 2 : pose === "idle" ? 2 : 1;
      const defaultAmplitude = pose === "wave" ? 22 : pose === "cheer" ? 12 : pose === "idle" ? 4 : 0;
      const startTime = Math.max(0, optionalNumber(args.startTime) ?? 0);
      const duration = Math.max(0.1, optionalNumber(args.duration) ?? defaultDuration);
      const cycles = Math.max(0.25, optionalNumber(args.cycles) ?? defaultCycles);
      const amplitude =
        optionalNumber(args.amplitudeDegrees) ?? optionalNumber(args.amplitude) ?? defaultAmplitude;
      const easing = creationAnimationEasing(args.easing);
      const clipId = optionalString(args.clipId) ?? `anim-${characterId ?? scene.id}-${pose}`;

      const built = buildCreationCharacterPoseTracks(parts, clipId, {
        pose,
        side,
        startTime,
        duration,
        cycles,
        amplitude,
        easing,
      });
      if (built.tracks.length === 0) {
        return fail(
          `Pose "${pose}" produced no animation; the character is missing the required arm/torso/head parts`,
          "INVALID_PARAMS",
        );
      }

      const animatedObjects = parts.filter((object) =>
        built.animatedObjectIds.includes(object.id),
      );
      const existingClip = scene.animations.find((clip) => clip.id === clipId);
      const clipDuration = Math.max(
        startTime + duration,
        maxCreationKeyframeTime(built.tracks),
        existingClip?.duration ?? 0,
        scene.duration ?? 0,
      );
      const targetIds = new Set(built.animatedObjectIds);
      const clip = mergeCreationObjectAnimationClipForTargets(
        existingClip,
        targetIds,
        built.tracks,
        new Set(["rotation"]),
        {
          clipId,
          name: optionalString(args.name) ?? `${pose} pose`,
          duration: clipDuration,
        },
      );

      const now = Date.now();
      const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
      const animatedAssetIds = [...new Set(animatedObjects.map((object) => object.assetId))];
      const assetOperations = animatedAssetIds
        .map((assetId) => assetsById.get(assetId))
        .filter((asset): asset is CreationAssetRecipe => Boolean(asset))
        .map((asset) => ({
          id: genId(),
          type: "asset/upsert" as const,
          timestamp: now,
          source: "agent" as const,
          label: `Add ${pose} pose metadata to ${asset.name}`,
          asset: updateCreationAssetCharacterPose(asset, args, { pose, side, clipId, now }),
        }));
      const animationOperation = {
        id: genId(),
        type: "animation/upsert-clip" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Pose character ${characterId ?? scene.id} (${pose})`,
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
      for (const object of animatedObjects) {
        const bound = bindingForObject(scene, object.id);
        if (!bound) continue;
        const groupKey = `${bound.binding.compositionId}:${bound.binding.layerId}`;
        const group =
          renderGroups.get(groupKey) ?? {
            binding: bound.binding,
            renderObjectIdsByObjectId: new Map<string, string>(),
          };
        group.renderObjectIdsByObjectId.set(object.id, bound.renderObjectId);
        renderGroups.set(groupKey, group);
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
          ? `Posed character (${pose}) across ${animatedObjects.length} parts and synced ${syncedRenderObjectIds.length} render objects`
          : `Posed character (${pose}) across ${animatedObjects.length} parts`,
        {
          sceneId: scene.id,
          characterId,
          pose,
          side,
          clipId,
          objectIds: animatedObjects.map((object) => object.id),
          partIds: animatedObjects.map((object) => object.partId).filter(Boolean),
          assetIds: animatedAssetIds,
          trackIds: built.tracks.map((track) => track.id),
          channels: ["rotation"],
          duration: clipDuration,
          operationIds,
          syncedRenderObjectIds,
          syncedCompositionIds: [...nextCompositions.keys()],
          renderKeyframeCount,
        },
      );
    },
  },
  {
    name: "add_creation_particle_system",
    domain: "motion",
    title: "Add creation particle system",
    description:
      "Add an editable procedural particle system (stars, dust, sparks, embers, snow, confetti, bokeh) to a creation scene and sync every particle into the bound scene3d layer. Particles are deterministic seeded instances inside a box or sphere region, optionally with editable drift and twinkle animation. Stored with particle-system recipe metadata and an editable animation clip so the look survives scene-to-motion recovery.",
    inputSchema: obj({
      sceneId: str,
      key: str,
      particleSystemId: str,
      objectId: str,
      renderObjectId: str,
      assetId: str,
      materialId: str,
      parentId: str,
      parentKey: str,
      name: str,
      partId: str,
      kind: str,
      type: str,
      count: num,
      seed: str,
      region: str,
      shape: str,
      width: num,
      height: num,
      depth: num,
      radius: num,
      position: { type: "object" },
      x: num,
      y: num,
      z: num,
      size: num,
      sizeJitter: num,
      color: str,
      baseColor: str,
      emissive: str,
      emissiveIntensity: num,
      opacity: num,
      materialModel: str,
      animate: bool,
      drift: { type: "object" },
      driftX: num,
      driftY: num,
      driftZ: num,
      driftStrength: num,
      driftJitter: num,
      twinkle: bool,
      startTime: num,
      duration: num,
      cycles: num,
      easing: str,
      nodeName: str,
      tags: { type: "array" },
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

      const kind = creationParticleKind(args.kind ?? args.type);
      const preset = CREATION_PARTICLE_PRESETS[kind];
      const count = Math.round(clampNumber(optionalNumber(args.count) ?? 60, 1, 200));
      const sceneKey = idSegment(scene.id, "scene");
      const key = idSegment(
        args.key ?? args.particleSystemId ?? args.name ?? kind,
        `particles-${scene.objects.length + 1}`,
      );
      const particleSystemId =
        optionalString(args.particleSystemId) ?? `particles-${sceneKey}-${key}`;
      const objectPrefix = optionalString(args.objectId) ?? `object-${sceneKey}-${key}`;
      const renderPrefix = optionalString(args.renderObjectId) ?? `obj-${sceneKey}-${key}`;
      const assetId = optionalString(args.assetId) ?? `asset-${sceneKey}-${key}`;
      const materialId = optionalString(args.materialId) ?? `mat-${sceneKey}-${key}`;
      const partPrefix = idSegment(args.partId ?? key, key);
      if (state.assets.some((asset) => asset.id === assetId)) {
        return fail(`Creation asset already exists: ${assetId}`, "INVALID_PARAMS");
      }

      const parent = resolveCreationParentId(scene, args.parentId, args.parentKey);
      if (!parent.ok) return fail(parent.error, "INVALID_PARAMS");
      const parentId = parent.parentId;

      const shape = optionalString(args.shape ?? args.region) === "sphere" ? "sphere" : "box";
      const center = vec3FromArgs(args.position, { x: 0, y: 1.5, z: 0 }, ["x", "y", "z"], args);
      const width = Math.max(0.01, optionalNumber(args.width) ?? 5);
      const height = Math.max(0.01, optionalNumber(args.height) ?? 3);
      const depth = Math.max(0.01, optionalNumber(args.depth) ?? 5);
      const radius = Math.max(0.01, optionalNumber(args.radius) ?? 3);
      const baseSize = Math.max(0.001, optionalNumber(args.size) ?? preset.size);
      const sizeJitter = Math.max(0, optionalNumber(args.sizeJitter) ?? preset.sizeJitter);
      const color = optionalString(args.color ?? args.baseColor) ?? preset.color;
      const opacity = clampNumber(optionalNumber(args.opacity) ?? preset.opacity, 0.02, 1);
      const requestedModel = optionalString(args.materialModel);
      const materialModel: CreationMaterialModel =
        requestedModel && CREATION_MATERIAL_MODELS.has(requestedModel)
          ? (requestedModel as CreationMaterialModel)
          : preset.materialModel;
      const emissive = optionalString(args.emissive) ?? preset.emissive;
      const emissiveIntensity = optionalNumber(args.emissiveIntensity) ?? preset.emissiveIntensity;

      const seed = optionalString(args.seed) ?? `${scene.id}-${particleSystemId}`;
      const random = createSeededRandom(seed);

      const animate = args.animate !== false;
      const twinkle = args.twinkle === true || (args.twinkle !== false && preset.twinkle);
      const driftStrength = optionalNumber(args.driftStrength) ?? 1;
      const baseDrift = vec3FromArgs(
        args.drift,
        preset.drift,
        ["driftX", "driftY", "driftZ"],
        args,
      );
      const driftJitter = Math.max(0, optionalNumber(args.driftJitter) ?? 0.4);
      const hasDrift =
        Math.abs(baseDrift.x) > 1e-6 ||
        Math.abs(baseDrift.y) > 1e-6 ||
        Math.abs(baseDrift.z) > 1e-6;
      const startTime = Math.max(0, optionalNumber(args.startTime) ?? 0);
      const duration = Math.max(0.1, optionalNumber(args.duration) ?? scene.duration ?? 4);
      const endTime = startTime + duration;
      const cycles = Math.max(0.25, optionalNumber(args.cycles) ?? 3);
      const easing = creationAnimationEasing(args.easing);

      const now = Date.now();
      const baseRaw: Record<string, unknown> = {
        kind: preset.shape,
        name: `${kind} particle`,
        assetId,
        assetName: `${kind} particles`,
        assetKind: "prop",
        materialId,
        materialName: `${kind} particle material`,
        materialModel,
        materialKind: preset.materialKind,
        scaleX: baseSize,
        scaleY: baseSize,
        scaleZ: baseSize,
        color,
        baseColor: color,
        opacity,
        emissive,
        emissiveIntensity,
      };
      const baseBuilt = buildSceneObject3D({ ...baseRaw, x: center.x, y: center.y, z: center.z }, `${renderPrefix}-base`);
      if ("error" in baseBuilt) return fail(baseBuilt.error, "INVALID_PARAMS");
      const material = creationMaterialFromSceneObject(`${sceneKey}-${key}`, baseRaw, baseBuilt.object);
      const baseAsset = creationAssetFromSceneObject(`${sceneKey}-${key}`, baseRaw, baseBuilt.object, material, now);

      const usedObjectIds = new Set(scene.objects.map((object) => object.id));
      const usedRenderIds = new Set(
        scene.renderBindings.flatMap((binding) =>
          binding.objectBindings.map((objectBinding) => objectBinding.renderObjectId),
        ),
      );
      const renderObjects: MotionSceneObject3D[] = [];
      const sceneObjects: CreationSceneObject[] = [];
      const renderObjectIdByObjectId = new Map<string, string>();
      const tracks: CreationAnimationTrack[] = [];

      for (let index = 0; index < count; index += 1) {
        const objectId = uniqueCreationEntityId(objectPrefix, String(index + 1), usedObjectIds);
        const renderObjectId = uniqueCreationEntityId(renderPrefix, String(index + 1), usedRenderIds);
        const point = creationParticlePoint(random, center, { shape, width, height, depth, radius });
        const particleSize = baseSize * (1 + randomSigned(random, sizeJitter));
        const raw: Record<string, unknown> = {
          ...baseRaw,
          x: point.x,
          y: point.y,
          z: point.z,
          rotationY: random() * 360,
          scaleX: particleSize,
          scaleY: particleSize,
          scaleZ: particleSize,
        };
        const built = buildSceneObject3D(raw, renderObjectId);
        if ("error" in built) return fail(built.error, "INVALID_PARAMS");
        const sceneObject: CreationSceneObject = {
          id: objectId,
          name: `${kind} particle ${index + 1}`,
          assetId: baseAsset.id,
          materialId: material.id,
          partId: `${partPrefix}-${index + 1}`,
          parentId,
          transform: requiredTransform3D(built.object),
          visible: args.visible !== false,
          selectable: args.selectable !== false,
          tags: [
            ...new Set([
              "agent-created",
              "particle",
              "particle-instance",
              kind,
              ...preset.tags,
              ...(parseStringArray(args.tags) ?? []),
            ]),
          ],
        };
        renderObjects.push(built.object);
        sceneObjects.push(sceneObject);
        renderObjectIdByObjectId.set(objectId, renderObjectId);

        if (animate && hasDrift) {
          const jitter = {
            x: baseDrift.x + randomSigned(random, driftJitter),
            y: baseDrift.y + randomSigned(random, driftJitter),
            z: baseDrift.z + randomSigned(random, driftJitter),
          };
          const endPoint = addVec3(point, scaleVec3(jitter, driftStrength * duration));
          tracks.push({
            id: `anim-${objectId}-particle-position`,
            targetId: objectId,
            channel: "position",
            keyframes: [
              { time: startTime, value: point, easing },
              { time: endTime, value: endPoint, easing },
            ],
          });
        }
        if (animate && twinkle) {
          const phase = random() * Math.PI * 2;
          const samples = Math.round(clampNumber(cycles * 6 + 1, 3, 36));
          const frames: CreationAnimationKeyframe<number>[] = [];
          for (let s = 0; s < samples; s += 1) {
            const t = samples === 1 ? 0 : s / (samples - 1);
            const flicker = 0.5 + 0.5 * Math.sin(t * cycles * Math.PI * 2 + phase);
            frames.push({
              time: startTime + duration * t,
              value: clampNumber(opacity * (0.25 + 0.75 * flicker), 0, 1),
              easing,
            });
          }
          tracks.push({
            id: `anim-${objectId}-particle-opacity`,
            targetId: objectId,
            channel: "opacity",
            keyframes: frames,
          });
        }
      }

      const clipId = `anim-${particleSystemId}`;
      const clip: CreationAnimationClip | undefined =
        tracks.length > 0
          ? {
              id: clipId,
              name: optionalString(args.name) ?? `${kind} particles`,
              duration: Math.max(scene.duration ?? 0, endTime),
              tracks,
            }
          : undefined;
      const asset = updateCreationAssetParticleSystem(baseAsset, args, {
        particleSystemId,
        kind,
        count,
        seed,
        shape,
        clipId: clip?.id,
        now,
      });

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
        const keyframes: Keyframe[] = [];
        for (const sceneObject of sceneObjects) {
          const renderObjectId = renderObjectIdByObjectId.get(sceneObject.id);
          if (!renderObjectId) continue;
          const objectTracks = tracks.filter((track) => track.targetId === sceneObject.id);
          if (objectTracks.length === 0) continue;
          keyframes.push(
            ...motionKeyframesForCreationObjectTracks(renderObjectId, objectTracks, genId),
          );
        }
        const nextLayer: MotionScene3DLayer = {
          ...layer,
          objects: [...(layer.objects ?? []), ...renderObjects],
          keyframes: mergeSceneKeyframes(layer.keyframes, keyframes),
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
            ...sceneObjects.map((object) => ({
              sceneObjectId: object.id,
              renderObjectId: renderObjectIdByObjectId.get(object.id) as string,
            })),
          ],
          modifiedAt: now,
        };
      }

      const nextScene: CreationScene = {
        ...scene,
        objects: [...scene.objects, ...sceneObjects],
        animations: clip
          ? [...scene.animations.filter((candidate) => candidate.id !== clip.id), clip]
          : scene.animations,
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
        label: `Create ${kind} particle system ${asset.name}`,
        asset,
      };
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add ${kind} particle system to ${scene.name}`,
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
          ? `Added ${count} ${kind} particles and synced ${renderObjects.length} render objects`
          : `Added ${count} ${kind} particles`,
        {
          sceneId: scene.id,
          particleSystemId,
          kind,
          count,
          shape,
          seed,
          animated: Boolean(clip),
          clipId: clip?.id,
          assetId: asset.id,
          materialId: material.id,
          objectIds: sceneObjects.map((object) => object.id),
          renderObjectIds: sceneObjects.map(
            (object) => renderObjectIdByObjectId.get(object.id) as string,
          ),
          trackIds: tracks.map((track) => track.id),
          parentId,
          operationIds: [assetOperation.id, sceneOperation.id],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          particleSystem: asset.parameters.particleSystem,
        },
      );
    },
  }
];
