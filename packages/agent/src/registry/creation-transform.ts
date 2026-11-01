import {
  RegisteredTool,
  applyMotionAction,
  bindingForObject,
  commitMotionComposition,
  creationState,
  fail,
  genId,
  getMotionComposition,
  num,
  obj,
  ok,
  optionalString,
  resolveCreationScene,
  str,
  transformFromArgs,
  updateAssetMaterial,
  updateCreationMaterialFromArgs,
  updateScene3DLayerObjectMaterial,
  updateScene3DLayerObjectTransform,
} from "./shared";
import {
  type CreationSceneObject,
} from "@openreel/core/creation/index";
import {
  type MotionComposition,
  type MotionScene3DLayer,
} from "@openreel/core/motion/types";

export const creationTransformTools: RegisteredTool[] = [
  {
    name: "set_creation_object_transform",
    domain: "motion",
    title: "Set creation object transform",
    description:
      "Update a semantic creation scene object's 3D transform and sync the bound Motion Creator scene3d render object when a render binding exists. Position/rotation/scale accept objects {x,y,z}; shorthand x/y/z, rotationX/Y/Z, scaleX/Y/Z are also supported. Existing bound scene-object keyframes are shifted so the rendered animation follows the edit.",
    inputSchema: obj({
      sceneId: str,
      objectId: str,
      position: { type: "object" },
      rotation: { type: "object" },
      scale: { type: "object" },
      x: num,
      y: num,
      z: num,
      rotationX: num,
      rotationY: num,
      rotationZ: num,
      scaleX: num,
      scaleY: num,
      scaleZ: num,
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
      const nextTransform = transformFromArgs(args, object.transform);
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
        const nextLayer = updateScene3DLayerObjectTransform(
          layer,
          bound.renderObjectId,
          object.transform,
          nextTransform,
        );
        if (typeof nextLayer === "string") return fail(nextLayer, "NOT_FOUND");
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
        type: "scene-object/update-transform" as const,
        timestamp: Date.now(),
        source: "agent" as const,
        label: `Set transform for ${object.name}`,
        sceneId: scene.id,
        objectId,
        transform: nextTransform,
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
          ? `Updated creation object ${objectId} and synced ${syncedRenderObjectId}`
          : `Updated creation object ${objectId}`,
        {
          sceneId: scene.id,
          objectId,
          transform: nextTransform,
          operationId: operation.id,
          syncedRenderObjectId,
          syncedCompositionId: nextComposition?.id,
        },
      );
    },
  },
  {
    name: "set_creation_object_material",
    domain: "motion",
    title: "Set creation object material",
    description:
      "Assign and/or edit the material for a semantic creation scene object, then sync the bound Motion Creator scene3d render object when a render binding exists. Use this for agent-native product part restyling: chips, glass, shells, lenses, boards, batteries, and other semantic parts.",
    inputSchema: obj({
      sceneId: str,
      objectId: str,
      materialId: str,
      name: str,
      model: str,
      materialModel: str,
      baseColor: str,
      color: str,
      metallic: num,
      metalness: num,
      roughness: num,
      opacity: num,
      transmission: num,
      clearcoat: num,
      emissive: str,
      emissiveIntensity: num,
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
      const materialId = optionalString(args.materialId) ?? object.materialId;
      if (!materialId) {
        return fail("materialId is required when the object has no material", "INVALID_PARAMS");
      }
      const material = asset.materials.find((candidate) => candidate.id === materialId);
      if (!material) return fail(`Creation material not found: ${materialId}`, "NOT_FOUND");
      const nextMaterial = updateCreationMaterialFromArgs(material, args);
      const nextAsset = updateAssetMaterial(asset, nextMaterial);
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
        const nextLayer = updateScene3DLayerObjectMaterial(
          layer,
          bound.renderObjectId,
          nextMaterial,
        );
        if (typeof nextLayer === "string") return fail(nextLayer, "NOT_FOUND");
        nextComposition = {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: Date.now(),
        };
        syncedRenderObjectId = bound.renderObjectId;
      }

      const now = Date.now();
      const assetOperation = {
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Update material ${nextMaterial.name}`,
        asset: nextAsset,
      };
      const objectOperation = {
        id: genId(),
        type: "scene-object/update-material" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Assign material ${nextMaterial.name} to ${object.name}`,
        sceneId: scene.id,
        objectId,
        materialId,
      };
      const assetApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: assetOperation,
      });
      if (!assetApplied.ok) return assetApplied;
      const objectApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: objectOperation,
      });
      if (!objectApplied.ok) return objectApplied;

      if (nextComposition) {
        const synced = await commitMotionComposition(host, nextComposition);
        if (!synced.ok) return synced;
      }

      return ok(
        syncedRenderObjectId
          ? `Updated material ${materialId} and synced ${syncedRenderObjectId}`
          : `Updated material ${materialId}`,
        {
          sceneId: scene.id,
          objectId,
          assetId: asset.id,
          materialId,
          material: nextMaterial,
          operationIds: [assetOperation.id, objectOperation.id],
          syncedRenderObjectId,
          syncedCompositionId: nextComposition?.id,
        },
      );
    },
  }
];
