import {
  CREATION_MATERIAL_PRESETS,
  RegisteredTool,
  applyCreationMaterialPreset,
  applyCreationProceduralTexture,
  applyCreationSurfaceDetail,
  applyCreationXrayMaterial,
  applyMotionAction,
  asRecord,
  assetNeedsBakedMesh,
  bakeAssetToMotionObjectMesh,
  bindingForObject,
  bool,
  buildSceneObject3D,
  clampNumber,
  commitMotionComposition,
  compactCreationParameters,
  creationBooleanOperation,
  creationDisplacementKind,
  creationMaterialPresetIds,
  creationState,
  creationSurfaceDetailKind,
  creationTexturePattern,
  defaultSurfaceDetailColor,
  fail,
  findCreationSceneObjectByReference,
  genId,
  getMotionComposition,
  hashStringToSeed,
  idSegment,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  parseCreationMaterialPresetId,
  parseStringArray,
  resolveCreationExplodedViewObjects,
  resolveCreationScene,
  sdfBodyApproximatesPrimitive,
  str,
  updateAssetMaterialPresetMetadata,
  updateAssetProceduralTextureMetadata,
  updateAssetSurfaceDetailMetadata,
  updateAssetXrayMaterialMetadata,
  updateCreationAssetArray,
  updateCreationAssetBevel,
  updateCreationAssetBoolean,
  updateCreationAssetDisplacement,
  updateCreationAssetGeometry,
  updateMotionObjectForBevel,
  updateMotionObjectForDisplacement,
  updateMotionSceneObjectGeometry,
  updateScene3DLayerObjectMaterial,
} from "./shared";
import {
  type CreationAssetRecipe,
  type CreationCacheRef,
  type CreationMaterial,
  type CreationRenderBinding,
  type CreationScene,
  type CreationSceneObject,
  type MaterialGraph,
  bakeCreationAsset,
  bakeCreationSceneMesh,
  bakeProceduralTexture,
  bakeProceduralTexturePng,
  encodeBase64,
  encodePng,
  evaluateCreationSceneAtTime,
  evaluateMaterialGraph,
  meshToGlbBase64,
  meshToGltf,
  rayTraceMeshToImage,
  rayTraceMeshToPng,
  renderMeshAuto,
  renderMeshToImage,
  renderMeshToPng,
} from "@openreel/core/creation/index";
import {
  type MotionAsset,
  type MotionComposition,
  type MotionObjectMeshData,
  type MotionScene3DLayer,
  type MotionSceneObject3D,
} from "@openreel/core/motion/types";

export const creationMaterialTools: RegisteredTool[] = [
  {
    name: "apply_creation_material_preset",
    domain: "motion",
    title: "Apply creation material preset",
    description:
      "Apply a production-friendly semantic material preset to a creation scene object and sync the bound scene3d render material. Presets include brushed-titanium, polished-aluminum, ceramic-glass, oled-screen, silicon-chip, copper-trace, matte-plastic, rubber-gasket, lunar-dust, and flag-fabric. Stores preset/procedural texture metadata on the creation material and dirties generated material/render caches for future native material baking.",
    inputSchema: obj({
      sceneId: str,
      objectId: str,
      materialId: str,
      presetId: str,
      preset: str,
      name: str,
      color: str,
      baseColor: str,
      metallic: num,
      metalness: num,
      roughness: num,
      opacity: num,
      transmission: num,
      clearcoat: num,
      emissive: str,
      emissiveIntensity: num,
      texture: str,
      detail: num,
      textureDetail: num,
      wear: num,
      dust: num,
      scratches: num,
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
      const presetId = parseCreationMaterialPresetId(args.presetId ?? args.preset);
      if (!presetId) {
        return fail(
          `presetId must be one of: ${creationMaterialPresetIds().join(", ")}`,
          "INVALID_PARAMS",
        );
      }
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

      const now = Date.now();
      const nextMaterial = applyCreationMaterialPreset(material, presetId, args);
      const nextAsset = updateAssetMaterialPresetMetadata(asset, nextMaterial, presetId, now);
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
          modifiedAt: now,
        };
        syncedRenderObjectId = bound.renderObjectId;
      }

      const assetOperation = {
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Apply ${CREATION_MATERIAL_PRESETS[presetId].name} to ${asset.name}`,
        asset: nextAsset,
      };
      const objectOperation = {
        id: genId(),
        type: "scene-object/update-material" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Assign ${nextMaterial.name} to ${object.name}`,
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
          ? `Applied ${presetId} material preset and synced ${syncedRenderObjectId}`
          : `Applied ${presetId} material preset`,
        {
          sceneId: scene.id,
          objectId,
          assetId: asset.id,
          materialId,
          presetId,
          material: nextMaterial,
          operationIds: [assetOperation.id, objectOperation.id],
          syncedRenderObjectId,
          syncedCompositionId: nextComposition?.id,
        },
      );
    },
  },
  {
    name: "apply_creation_xray_material",
    domain: "motion",
    title: "Apply creation X-ray material",
    description:
      "Make selected semantic creation objects render as editable X-ray/ghosted materials so product internals, cutaways, and exploded assemblies are visible. Select with objectIds, partIds, or tags; omit selection to target visible selectable objects. The tool updates creation material recipes, stores xray material metadata, dirties generated caches, and syncs bound scene3d material opacity immediately.",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      materialId: str,
      name: str,
      style: str,
      tint: str,
      color: str,
      baseColor: str,
      opacity: num,
      transmission: num,
      edgeGlow: num,
      roughness: num,
      clearcoat: num,
      metallic: num,
      metalness: num,
      emissive: str,
      emissiveIntensity: num,
      revealInternals: bool,
      showBackfaces: bool,
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
      if (objects.length === 0) {
        return fail("No creation objects selected for X-ray material", "INVALID_PARAMS");
      }

      const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
      const materialUpdatesByAssetId = new Map<string, Map<string, CreationMaterial>>();
      const objectMaterialIds = new Map<string, string>();
      const materialsByObjectId = new Map<string, CreationMaterial>();
      const explicitMaterialId = optionalString(args.materialId);
      for (const object of objects) {
        const asset = assetsById.get(object.assetId);
        if (!asset) return fail(`Creation asset not found: ${object.assetId}`, "NOT_FOUND");
        const materialId = explicitMaterialId ?? object.materialId;
        if (!materialId) {
          return fail(
            `materialId is required for creation object without a material: ${object.id}`,
            "INVALID_PARAMS",
          );
        }
        const material = asset.materials.find((candidate) => candidate.id === materialId);
        if (!material) return fail(`Creation material not found: ${materialId}`, "NOT_FOUND");
        const updatedMaterial = applyCreationXrayMaterial(material, args);
        const group = materialUpdatesByAssetId.get(asset.id) ?? new Map<string, CreationMaterial>();
        group.set(materialId, updatedMaterial);
        materialUpdatesByAssetId.set(asset.id, group);
        objectMaterialIds.set(object.id, materialId);
        materialsByObjectId.set(object.id, updatedMaterial);
      }

      const now = Date.now();
      const assetOperations = [...materialUpdatesByAssetId].map(([assetId, materialsById]) => {
        const asset = assetsById.get(assetId);
        if (!asset) throw new Error(`Creation asset not found: ${assetId}`);
        return {
          id: genId(),
          type: "asset/upsert" as const,
          timestamp: now,
          source: "agent" as const,
          label: `Apply X-ray material to ${asset.name}`,
          asset: updateAssetXrayMaterialMetadata(asset, materialsById, args, now),
        };
      });

      const renderGroups = new Map<
        string,
        {
          readonly binding: CreationRenderBinding;
          readonly objects: CreationSceneObject[];
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
            objects: [],
            renderObjectIdsByObjectId: new Map<string, string>(),
          };
        group.objects.push(object);
        group.renderObjectIdsByObjectId.set(object.id, bound.renderObjectId);
        renderGroups.set(key, group);
      }

      const nextCompositions = new Map<string, MotionComposition>();
      const syncedRenderObjectIds: string[] = [];
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
        if (!layer) return fail(`Bound scene3d layer not found: ${group.binding.layerId}`, "NOT_FOUND");
        let nextLayer: MotionScene3DLayer = layer;
        for (const object of group.objects) {
          const material = materialsByObjectId.get(object.id);
          const renderObjectId = group.renderObjectIdsByObjectId.get(object.id);
          if (!material || !renderObjectId) continue;
          const updatedLayer = updateScene3DLayerObjectMaterial(
            nextLayer,
            renderObjectId,
            material,
          );
          if (typeof updatedLayer === "string") return fail(updatedLayer, "NOT_FOUND");
          nextLayer = updatedLayer;
          syncedRenderObjectIds.push(renderObjectId);
        }
        nextCompositions.set(group.binding.compositionId, {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        });
      }

      const operationIds: string[] = [];
      for (const operation of assetOperations) {
        const applied = await applyMotionAction(host, "creation/applyOperation", {
          operation,
        });
        if (!applied.ok) return applied;
        operationIds.push(operation.id);
      }
      for (const composition of nextCompositions.values()) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      return ok(
        syncedRenderObjectIds.length > 0
          ? `Applied X-ray material to ${objects.length} creation objects and synced ${syncedRenderObjectIds.length} render objects`
          : `Applied X-ray material to ${objects.length} creation objects`,
        {
          sceneId: scene.id,
          objectIds: objects.map((object) => object.id),
          partIds: objects.map((object) => object.partId).filter(Boolean),
          assetIds: [...materialUpdatesByAssetId.keys()],
          materialIdsByObjectId: Object.fromEntries(objectMaterialIds),
          operationIds,
          syncedRenderObjectIds,
          syncedCompositionIds: [...nextCompositions.keys()],
          xray: {
            opacity: optionalNumber(args.opacity) ?? 0.32,
            transmission: optionalNumber(args.transmission) ?? 0.72,
            tint:
              optionalString(args.tint) ??
              optionalString(args.color) ??
              optionalString(args.baseColor) ??
              "#67e8f9",
            edgeGlow: optionalNumber(args.edgeGlow) ?? 0.18,
          },
        },
      );
    },
  },
  {
    name: "apply_creation_surface_detail",
    domain: "motion",
    title: "Apply creation surface detail",
    description:
      "Add editable procedural surface detail such as scratches, dust, fingerprints, smudges, edge wear, or grime to selected creation scene objects. Stores material/texture recipe metadata, dirties generated caches for future native texture baking, and syncs a realtime roughness/metalness preview to the bound scene3d render objects.",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      materialId: str,
      kind: str,
      detailKind: str,
      type: str,
      intensity: num,
      density: num,
      scale: num,
      size: num,
      seed: str,
      pattern: str,
      direction: str,
      color: str,
      detailColor: str,
      roughness: num,
      roughnessBoost: num,
      metallic: num,
      metalness: num,
      scratchLength: num,
      edgeRadius: num,
      fingerprintSize: num,
      bakeTarget: str,
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
      if (objects.length === 0) {
        return fail("No creation objects selected for surface detail", "INVALID_PARAMS");
      }

      const detailKind = creationSurfaceDetailKind(args.kind ?? args.detailKind ?? args.type);
      const detailPattern =
        optionalString(args.pattern) ??
        (detailKind === "scratches" || detailKind === "edge-wear" ? "brushed" : "fbm");
      const detailScale = Math.max(1, optionalNumber(args.scale) ?? optionalNumber(args.size) ?? 8);
      const detailSeed =
        optionalNumber(args.seed) ?? hashStringToSeed(optionalString(args.seed) ?? detailKind);
      const detailIntensity = clampNumber(optionalNumber(args.intensity) ?? 0.35, 0, 1);
      const grayHex = (v: number): string => {
        const c = Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
        return `#${c}${c}${c}`;
      };
      const detailRoughnessBaked = bakeProceduralTexturePng({
        pattern: detailPattern,
        colorA: grayHex(150 + (1 - detailIntensity) * 60),
        colorB: grayHex(255),
        scale: detailScale,
        seed: detailSeed,
        size: 256,
      });
      const detailSceneKey = idSegment(scene.id, "scene");
      const detailKey = idSegment(
        `${detailKind}-${detailScale}-${detailSeed}-${detailPattern}-${Math.round(detailIntensity * 100)}`,
        "rough",
      );
      const roughnessMapAssetId = `rough-${detailSceneKey}-${detailKey}`;
      const roughnessImageAsset: MotionAsset = {
        id: roughnessMapAssetId,
        type: "image",
        name: `${detailKind} roughness`,
        url: detailRoughnessBaked.dataUri,
        width: detailRoughnessBaked.size,
        height: detailRoughnessBaked.size,
      };

      const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
      const explicitMaterialId = optionalString(args.materialId);
      const materialUpdatesByAssetId = new Map<string, Map<string, CreationMaterial>>();
      const objectMaterialIds = new Map<string, string>();
      const materialsByObjectId = new Map<string, CreationMaterial>();
      for (const object of objects) {
        const asset = assetsById.get(object.assetId);
        if (!asset) return fail(`Creation asset not found: ${object.assetId}`, "NOT_FOUND");
        const materialId = explicitMaterialId ?? object.materialId;
        if (!materialId) {
          return fail(
            `materialId is required for creation object without a material: ${object.id}`,
            "INVALID_PARAMS",
          );
        }
        const material = asset.materials.find((candidate) => candidate.id === materialId);
        if (!material) return fail(`Creation material not found: ${materialId}`, "NOT_FOUND");
        const updatedMaterial = applyCreationSurfaceDetail(material, args, roughnessMapAssetId);
        const group = materialUpdatesByAssetId.get(asset.id) ?? new Map<string, CreationMaterial>();
        group.set(materialId, updatedMaterial);
        materialUpdatesByAssetId.set(asset.id, group);
        objectMaterialIds.set(object.id, materialId);
        materialsByObjectId.set(object.id, updatedMaterial);
      }

      const now = Date.now();
      const assetOperations = [...materialUpdatesByAssetId].map(([assetId, materialsById]) => {
        const asset = assetsById.get(assetId);
        if (!asset) throw new Error(`Creation asset not found: ${assetId}`);
        return {
          id: genId(),
          type: "asset/upsert" as const,
          timestamp: now,
          source: "agent" as const,
          label: `Apply surface detail to ${asset.name}`,
          asset: updateAssetSurfaceDetailMetadata(asset, materialsById, args, now),
        };
      });

      const renderGroups = new Map<
        string,
        {
          readonly binding: CreationRenderBinding;
          readonly objects: CreationSceneObject[];
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
            objects: [],
            renderObjectIdsByObjectId: new Map<string, string>(),
          };
        group.objects.push(object);
        group.renderObjectIdsByObjectId.set(object.id, bound.renderObjectId);
        renderGroups.set(key, group);
      }

      const nextCompositions = new Map<string, MotionComposition>();
      const syncedRenderObjectIds: string[] = [];
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
        if (!layer) return fail(`Bound scene3d layer not found: ${group.binding.layerId}`, "NOT_FOUND");
        let nextLayer: MotionScene3DLayer = layer;
        for (const object of group.objects) {
          const material = materialsByObjectId.get(object.id);
          const renderObjectId = group.renderObjectIdsByObjectId.get(object.id);
          if (!material || !renderObjectId) continue;
          const updatedLayer = updateScene3DLayerObjectMaterial(
            nextLayer,
            renderObjectId,
            material,
          );
          if (typeof updatedLayer === "string") return fail(updatedLayer, "NOT_FOUND");
          nextLayer = updatedLayer;
          syncedRenderObjectIds.push(renderObjectId);
        }
        nextCompositions.set(group.binding.compositionId, {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        });
      }

      const operationIds: string[] = [];
      for (const operation of assetOperations) {
        const applied = await applyMotionAction(host, "creation/applyOperation", {
          operation,
        });
        if (!applied.ok) return applied;
        operationIds.push(operation.id);
      }
      for (const composition of nextCompositions.values()) {
        const withAsset = {
          ...composition,
          assets: composition.assets.some(
            (candidate) => candidate.id === roughnessMapAssetId,
          )
            ? composition.assets.map((candidate) =>
                candidate.id === roughnessMapAssetId ? roughnessImageAsset : candidate,
              )
            : [...composition.assets, roughnessImageAsset],
        };
        const synced = await commitMotionComposition(host, withAsset);
        if (!synced.ok) return synced;
      }

      return ok(
        syncedRenderObjectIds.length > 0
          ? `Applied surface detail to ${objects.length} creation objects and synced ${syncedRenderObjectIds.length} render objects`
          : `Applied surface detail to ${objects.length} creation objects`,
        {
          sceneId: scene.id,
          objectIds: objects.map((object) => object.id),
          partIds: objects.map((object) => object.partId).filter(Boolean),
          assetIds: [...materialUpdatesByAssetId.keys()],
          materialIdsByObjectId: Object.fromEntries(objectMaterialIds),
          operationIds,
          syncedRenderObjectIds,
          syncedCompositionIds: [...nextCompositions.keys()],
          roughnessMapAssetId,
          surfaceDetail: {
            kind: creationSurfaceDetailKind(args.kind ?? args.detailKind ?? args.type),
            intensity: clampNumber(optionalNumber(args.intensity) ?? 0.35, 0, 1),
            density: clampNumber(optionalNumber(args.density) ?? 0.5, 0, 1),
            scale: Math.max(0.001, optionalNumber(args.scale) ?? optionalNumber(args.size) ?? 0.35),
            color:
              optionalString(args.detailColor) ??
              optionalString(args.color) ??
              defaultSurfaceDetailColor(
                creationSurfaceDetailKind(args.kind ?? args.detailKind ?? args.type),
              ),
          },
        },
      );
    },
  },
  {
    name: "apply_creation_material_graph",
    domain: "motion",
    title: "Apply creation material graph",
    description:
      "Evaluate a node-based material graph (color/scalar/mix/multiply/output nodes) and apply the resolved PBR descriptor (base color, metallic, roughness, emissive) to selected creation scene objects' materials, syncing the bound scene3d render objects. Use this to drive a procedural material network onto product/scene surfaces.",
    inputSchema: obj(
      {
        sceneId: str,
        objectIds: { type: "array" },
        objects: { type: "array" },
        partIds: { type: "array" },
        parts: { type: "array" },
        tags: { type: "array" },
        includeTags: { type: "array" },
        excludeTags: { type: "array" },
        materialId: str,
        graph: { type: "object" },
        nodeName: str,
      },
      ["graph"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const graph = args.graph as MaterialGraph | undefined;
      if (!graph || !Array.isArray(graph.nodes) || typeof graph.output !== "string") {
        return fail("graph must have a nodes array and an output node id", "INVALID_PARAMS");
      }
      const outputNode = graph.nodes.find((node) => node.id === graph.output);
      if (!outputNode || outputNode.type !== "output") {
        return fail(
          "graph.output must reference a node of type 'output'",
          "INVALID_PARAMS",
        );
      }
      const evaluated = evaluateMaterialGraph(graph);
      const outputParams = (outputNode.params ?? {}) as Record<string, unknown>;
      const outputWired = (outputNode.inputs ?? []).length > 0;
      const drives = {
        baseColor: outputWired || outputParams.baseColor !== undefined,
        metallic: outputParams.metallic !== undefined,
        roughness: outputParams.roughness !== undefined,
        emissive: outputParams.emissive !== undefined,
        emissiveIntensity: outputParams.emissiveIntensity !== undefined,
      };

      const objectsOrError = resolveCreationExplodedViewObjects(scene, args);
      if (typeof objectsOrError === "string") return fail(objectsOrError, "INVALID_PARAMS");
      const objects = objectsOrError;
      if (objects.length === 0) {
        return fail("No creation objects selected for material graph", "INVALID_PARAMS");
      }

      const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
      const explicitMaterialId = optionalString(args.materialId);
      const materialUpdatesByAssetId = new Map<string, Map<string, CreationMaterial>>();
      const objectMaterialIds = new Map<string, string>();
      const materialsByObjectId = new Map<string, CreationMaterial>();
      for (const object of objects) {
        const asset = assetsById.get(object.assetId);
        if (!asset) return fail(`Creation asset not found: ${object.assetId}`, "NOT_FOUND");
        const materialId = explicitMaterialId ?? object.materialId;
        if (!materialId) {
          return fail(
            `materialId is required for creation object without a material: ${object.id}`,
            "INVALID_PARAMS",
          );
        }
        const material = asset.materials.find((candidate) => candidate.id === materialId);
        if (!material) return fail(`Creation material not found: ${materialId}`, "NOT_FOUND");
        const updatedMaterial: CreationMaterial = {
          ...material,
          baseColor: drives.baseColor ? evaluated.baseColor : material.baseColor,
          metallic: drives.metallic ? evaluated.metallic : material.metallic,
          roughness: drives.roughness ? evaluated.roughness : material.roughness,
          emissive: drives.emissive ? evaluated.emissive : material.emissive,
          emissiveIntensity: drives.emissiveIntensity
            ? evaluated.emissiveIntensity
            : material.emissiveIntensity,
          parameters: compactCreationParameters({
            ...material.parameters,
            source: "agent-material-graph",
            materialGraph: {
              source: "agent-material-graph",
              output: graph.output,
              nodeCount: graph.nodes.length,
            },
          }),
        };
        const group =
          materialUpdatesByAssetId.get(asset.id) ?? new Map<string, CreationMaterial>();
        group.set(materialId, updatedMaterial);
        materialUpdatesByAssetId.set(asset.id, group);
        objectMaterialIds.set(object.id, materialId);
        materialsByObjectId.set(object.id, updatedMaterial);
      }

      const now = Date.now();
      const assetOperations = [...materialUpdatesByAssetId].map(([assetId, materialsById]) => {
        const asset = assetsById.get(assetId);
        if (!asset) throw new Error(`Creation asset not found: ${assetId}`);
        return {
          id: genId(),
          type: "asset/upsert" as const,
          timestamp: now,
          source: "agent" as const,
          label: `Apply material graph to ${asset.name}`,
          asset: {
            ...asset,
            materials: asset.materials.map((candidate) => materialsById.get(candidate.id) ?? candidate),
            modifiedAt: now,
          },
        };
      });

      const renderGroups = new Map<
        string,
        {
          readonly binding: CreationRenderBinding;
          readonly objects: CreationSceneObject[];
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
            objects: [],
            renderObjectIdsByObjectId: new Map<string, string>(),
          };
        group.objects.push(object);
        group.renderObjectIdsByObjectId.set(object.id, bound.renderObjectId);
        renderGroups.set(key, group);
      }

      const nextCompositions = new Map<string, MotionComposition>();
      const syncedRenderObjectIds: string[] = [];
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
        if (!layer) return fail(`Bound scene3d layer not found: ${group.binding.layerId}`, "NOT_FOUND");
        let nextLayer: MotionScene3DLayer = layer;
        for (const object of group.objects) {
          const material = materialsByObjectId.get(object.id);
          const renderObjectId = group.renderObjectIdsByObjectId.get(object.id);
          if (!material || !renderObjectId) continue;
          const updatedLayer = updateScene3DLayerObjectMaterial(nextLayer, renderObjectId, material);
          if (typeof updatedLayer === "string") return fail(updatedLayer, "NOT_FOUND");
          nextLayer = updatedLayer;
          syncedRenderObjectIds.push(renderObjectId);
        }
        nextCompositions.set(group.binding.compositionId, {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        });
      }

      const operationIds: string[] = [];
      for (const operation of assetOperations) {
        const applied = await applyMotionAction(host, "creation/applyOperation", { operation });
        if (!applied.ok) return applied;
        operationIds.push(operation.id);
      }
      for (const composition of nextCompositions.values()) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      return ok(
        syncedRenderObjectIds.length > 0
          ? `Applied material graph to ${objects.length} creation objects and synced ${syncedRenderObjectIds.length} render objects`
          : `Applied material graph to ${objects.length} creation objects`,
        {
          sceneId: scene.id,
          objectIds: objects.map((object) => object.id),
          partIds: objects.map((object) => object.partId).filter(Boolean),
          assetIds: [...materialUpdatesByAssetId.keys()],
          materialIdsByObjectId: Object.fromEntries(objectMaterialIds),
          operationIds,
          syncedRenderObjectIds,
          syncedCompositionIds: [...nextCompositions.keys()],
          evaluated,
        },
      );
    },
  },
  {
    name: "add_creation_procedural_texture",
    domain: "motion",
    title: "Add creation procedural texture",
    description:
      "Apply an editable procedural base texture/pattern (noise, voronoi, fbm, marble, circuit, fabric-weave, lunar-dust, hex-grid, gradient, brushed) to selected creation objects' materials. Stores texture recipe metadata and a texture cache reference, dirties generated caches for future native baking, and syncs a realtime base-color/roughness/metalness preview to the bound scene3d render objects. Use this for circuit-board chips, fabric suits, lunar terrain, brushed metal, and stylized patterns.",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      materialId: str,
      pattern: str,
      kind: str,
      type: str,
      color: str,
      baseColor: str,
      secondaryColor: str,
      accentColor: str,
      scale: num,
      size: num,
      contrast: num,
      seed: str,
      rotation: num,
      roughness: num,
      metallic: num,
      metalness: num,
      emissive: str,
      emissiveIntensity: num,
      bakeTarget: str,
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
      if (objects.length === 0) {
        return fail("No creation objects selected for procedural texture", "INVALID_PARAMS");
      }

      const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
      const explicitMaterialId = optionalString(args.materialId);
      const materialUpdatesByAssetId = new Map<string, Map<string, CreationMaterial>>();
      const objectMaterialIds = new Map<string, string>();
      const materialsByObjectId = new Map<string, CreationMaterial>();
      for (const object of objects) {
        const asset = assetsById.get(object.assetId);
        if (!asset) return fail(`Creation asset not found: ${object.assetId}`, "NOT_FOUND");
        const materialId = explicitMaterialId ?? object.materialId;
        if (!materialId) {
          return fail(
            `materialId is required for creation object without a material: ${object.id}`,
            "INVALID_PARAMS",
          );
        }
        const material = asset.materials.find((candidate) => candidate.id === materialId);
        if (!material) return fail(`Creation material not found: ${materialId}`, "NOT_FOUND");
        const updatedMaterial = applyCreationProceduralTexture(material, args);
        const group = materialUpdatesByAssetId.get(asset.id) ?? new Map<string, CreationMaterial>();
        group.set(materialId, updatedMaterial);
        materialUpdatesByAssetId.set(asset.id, group);
        objectMaterialIds.set(object.id, materialId);
        materialsByObjectId.set(object.id, updatedMaterial);
      }

      const now = Date.now();
      const assetOperations = [...materialUpdatesByAssetId].map(([assetId, materialsById]) => {
        const asset = assetsById.get(assetId);
        if (!asset) throw new Error(`Creation asset not found: ${assetId}`);
        return {
          id: genId(),
          type: "asset/upsert" as const,
          timestamp: now,
          source: "agent" as const,
          label: `Apply procedural texture to ${asset.name}`,
          asset: updateAssetProceduralTextureMetadata(asset, materialsById, args, now),
        };
      });

      const renderGroups = new Map<
        string,
        {
          readonly binding: CreationRenderBinding;
          readonly objects: CreationSceneObject[];
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
            objects: [],
            renderObjectIdsByObjectId: new Map<string, string>(),
          };
        group.objects.push(object);
        group.renderObjectIdsByObjectId.set(object.id, bound.renderObjectId);
        renderGroups.set(key, group);
      }

      const nextCompositions = new Map<string, MotionComposition>();
      const syncedRenderObjectIds: string[] = [];
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
        if (!layer) return fail(`Bound scene3d layer not found: ${group.binding.layerId}`, "NOT_FOUND");
        let nextLayer: MotionScene3DLayer = layer;
        for (const object of group.objects) {
          const material = materialsByObjectId.get(object.id);
          const renderObjectId = group.renderObjectIdsByObjectId.get(object.id);
          if (!material || !renderObjectId) continue;
          const updatedLayer = updateScene3DLayerObjectMaterial(nextLayer, renderObjectId, material);
          if (typeof updatedLayer === "string") return fail(updatedLayer, "NOT_FOUND");
          nextLayer = updatedLayer;
          syncedRenderObjectIds.push(renderObjectId);
        }
        nextCompositions.set(group.binding.compositionId, {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        });
      }

      const operationIds: string[] = [];
      for (const operation of assetOperations) {
        const applied = await applyMotionAction(host, "creation/applyOperation", {
          operation,
        });
        if (!applied.ok) return applied;
        operationIds.push(operation.id);
      }
      for (const composition of nextCompositions.values()) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      const pattern = creationTexturePattern(args.pattern ?? args.kind ?? args.type);
      return ok(
        syncedRenderObjectIds.length > 0
          ? `Applied ${pattern} procedural texture to ${objects.length} creation objects and synced ${syncedRenderObjectIds.length} render objects`
          : `Applied ${pattern} procedural texture to ${objects.length} creation objects`,
        {
          sceneId: scene.id,
          pattern,
          objectIds: objects.map((object) => object.id),
          partIds: objects.map((object) => object.partId).filter(Boolean),
          assetIds: [...materialUpdatesByAssetId.keys()],
          materialIdsByObjectId: Object.fromEntries(objectMaterialIds),
          operationIds,
          syncedRenderObjectIds,
          syncedCompositionIds: [...nextCompositions.keys()],
        },
      );
    },
  },
  {
    name: "export_creation_scene_gltf",
    domain: "read",
    title: "Export creation scene glTF",
    description:
      "Bake an entire persisted creation scene into one merged CPU-generated triangle mesh and return scene poly stats, per-object stats, and (by default) a glTF 2.0 export with embedded geometry. This composes the procedural primitive recipes with each object's transform. Use it to export a finished creation scene as a real 3D asset or to inspect total scene geometry. model/text3d objects are exported as placeholder boxes until native generators exist.",
    inputSchema: obj({
      sceneId: str,
      quality: str,
      format: str,
      includeHidden: bool,
      includeGltf: bool,
    }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      if (scene.objects.length === 0) {
        return fail("Creation scene has no objects to export", "INVALID_PARAMS");
      }

      const quality = optionalString(args.quality) === "final" ? "final" : "preview";
      const format = optionalString(args.format) === "glb" ? "glb" : "gltf";
      const baked = bakeCreationSceneMesh(scene, state.assets, {
        quality,
        includeHidden: args.includeHidden === true,
      });
      if (baked.objects.length === 0) {
        return fail("No bakeable objects found in creation scene", "INVALID_PARAMS");
      }
      const includeExport = args.includeGltf !== false;
      const exportOptions = {
        name: scene.name,
        baseColor: scene.environment.backgroundColor,
      };
      const gltf =
        includeExport && format === "gltf" ? meshToGltf(baked.mesh, exportOptions) : undefined;
      const glbBase64 =
        includeExport && format === "glb" ? meshToGlbBase64(baked.mesh, exportOptions) : undefined;

      return ok(
        `Exported creation scene "${scene.name}" (${format}): ${baked.stats.vertexCount} verts, ${baked.stats.triangleCount} tris across ${baked.objects.length} objects`,
        {
          sceneId: scene.id,
          quality,
          format,
          vertexCount: baked.stats.vertexCount,
          triangleCount: baked.stats.triangleCount,
          bounds: baked.stats.bounds,
          objectCount: baked.objects.length,
          objects: baked.objects,
          missingAssetObjectIds: baked.missingAssetObjectIds,
          gltf,
          glbBase64,
        },
      );
    },
  },
  {
    name: "render_creation_scene_image",
    domain: "read",
    title: "Render creation scene image",
    description:
      "Render a persisted creation scene to a real image with the built-in deterministic CPU renderer: bakes the scene mesh, projects it through the scene camera, and returns coverage stats plus (by default) a PNG data URI. mode='raster' (default) z-buffers and Lambert-shades; mode='raytrace' casts primary rays with optional hard shadows for a final-quality preview. This is the CPU render/preview fallback (§7.12) — independent of the WebGPU/scene3d renderer — useful for headless previews and visual-regression checks.",
    inputSchema: obj({
      sceneId: str,
      width: num,
      height: num,
      quality: str,
      mode: str,
      shadows: bool,
      baseColor: str,
      background: str,
      timeSeconds: num,
      includeHidden: bool,
      includePng: bool,
    }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      if (scene.objects.length === 0) {
        return fail("Creation scene has no objects to render", "INVALID_PARAMS");
      }

      const timeSeconds = clampNumber(
        optionalNumber(args.timeSeconds) ?? 0,
        0,
        Math.max(0, scene.duration),
      );
      const evaluatedScene = evaluateCreationSceneAtTime(scene, timeSeconds);
      const quality = optionalString(args.quality) === "final" ? "final" : "preview";
      const baked = bakeCreationSceneMesh(evaluatedScene, state.assets, {
        quality,
        includeHidden: args.includeHidden === true,
      });
      if (baked.objects.length === 0) {
        return fail("No bakeable objects found in creation scene", "INVALID_PARAMS");
      }

      const width = clampNumber(optionalNumber(args.width) ?? 320, 16, 2048);
      const height = clampNumber(optionalNumber(args.height) ?? 240, 16, 2048);
      const activeCamera =
        evaluatedScene.cameras.find(
          (candidate) => candidate.id === evaluatedScene.activeCameraId,
        ) ?? evaluatedScene.cameras[0];
      const camera = {
        position: activeCamera?.position ?? { x: 3, y: 2.4, z: 4.5 },
        target: activeCamera?.target ?? { x: 0, y: 0, z: 0 },
        fov: activeCamera?.fov ?? 40,
      };
      const firstMaterial = state.assets
        .find((asset) => asset.id === evaluatedScene.objects[0]?.assetId)
        ?.materials[0];
      const baseColor =
        optionalString(args.baseColor) ?? firstMaterial?.baseColor ?? "#94a3b8";
      const background =
        optionalString(args.background) ??
        evaluatedScene.environment.backgroundColor ??
        "#0f172a";

      const requestedMode = optionalString(args.mode);
      const mode =
        requestedMode === "raytrace"
          ? "raytrace"
          : requestedMode === "auto"
            ? "auto"
            : "raster";
      const includePng = args.includePng !== false;
      const baseOptions = { width, height, camera, baseColor, background };

      let renderWidth = width;
      let renderHeight = height;
      let coveredPixels = 0;
      let shadowedPixels: number | undefined;
      let backend: "webgpu" | "cpu" | undefined;
      let dataUri: string | undefined;

      if (mode === "auto") {
        const image = await renderMeshAuto(baked.mesh, baseOptions);
        renderWidth = image.width;
        renderHeight = image.height;
        coveredPixels = image.coveredPixels;
        backend = image.backend;
        dataUri = includePng
          ? `data:image/png;base64,${encodeBase64(encodePng(image.rgba, image.width, image.height))}`
          : undefined;
      } else if (mode === "raytrace") {
        const options = { ...baseOptions, shadows: args.shadows !== false };
        const rendered = includePng
          ? rayTraceMeshToPng(baked.mesh, options)
          : rayTraceMeshToImage(baked.mesh, options);
        renderWidth = rendered.width;
        renderHeight = rendered.height;
        coveredPixels = rendered.coveredPixels;
        shadowedPixels = "shadowedPixels" in rendered ? rendered.shadowedPixels : undefined;
        dataUri = "dataUri" in rendered ? rendered.dataUri : undefined;
        backend = "cpu";
      } else {
        const rendered = includePng
          ? renderMeshToPng(baked.mesh, baseOptions)
          : renderMeshToImage(baked.mesh, baseOptions);
        renderWidth = rendered.width;
        renderHeight = rendered.height;
        coveredPixels = rendered.coveredPixels;
        dataUri = "dataUri" in rendered ? rendered.dataUri : undefined;
        backend = "cpu";
      }

      return ok(
        `Rendered creation scene "${scene.name}" at ${timeSeconds.toFixed(2)}s (${mode}/${backend}, ${renderWidth}x${renderHeight}, ${coveredPixels} covered px)`,
        {
          sceneId: scene.id,
          mode,
          backend,
          width: renderWidth,
          height: renderHeight,
          timeSeconds,
          coveredPixels,
          shadowedPixels,
          objectCount: baked.objects.length,
          vertexCount: baked.stats.vertexCount,
          triangleCount: baked.stats.triangleCount,
          camera,
          dataUri,
        },
      );
    },
  },
  {
    name: "bake_creation_asset",
    domain: "motion",
    title: "Bake creation asset mesh",
    description:
      "Bake a persisted creation asset's procedural recipe into a real CPU-generated triangle mesh, update its mesh cache to ready with bounds and vertex/triangle stats, and optionally return a glTF 2.0 export. Resolve the asset directly with assetId, or by an objectId/partId within a scene. Use quality 'preview' (default) or 'final'. model/text3d kinds remain placeholder caches until native generators exist.",
    inputSchema: obj({
      assetId: str,
      sceneId: str,
      objectId: str,
      partId: str,
      quality: str,
      format: str,
      weld: bool,
      smoothNormals: bool,
      subdivisions: num,
      boxUvs: bool,
      includeGltf: bool,
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");

      let asset: CreationAssetRecipe | undefined;
      const explicitAssetId = optionalString(args.assetId);
      if (explicitAssetId) {
        asset = state.assets.find((candidate) => candidate.id === explicitAssetId);
        if (!asset) return fail(`Creation asset not found: ${explicitAssetId}`, "NOT_FOUND");
      } else {
        const scene = resolveCreationScene(state, args.sceneId);
        if (!scene) {
          return fail("Provide assetId, or sceneId with objectId/partId", "INVALID_PARAMS");
        }
        const ref = optionalString(args.objectId) ?? optionalString(args.partId);
        if (!ref) {
          return fail("Provide assetId, or objectId/partId within the scene", "INVALID_PARAMS");
        }
        const object = findCreationSceneObjectByReference(scene, ref);
        if (!object) return fail(`Creation object not found: ${ref}`, "NOT_FOUND");
        asset = state.assets.find((candidate) => candidate.id === object.assetId);
        if (!asset) return fail(`Creation asset not found: ${object.assetId}`, "NOT_FOUND");
      }

      const quality = optionalString(args.quality) === "final" ? "final" : "preview";
      const now = Date.now();
      const baked = bakeCreationAsset(asset, {
        quality,
        now,
        weld: args.weld === true,
        smoothNormals: args.smoothNormals === true,
        subdivisions: optionalNumber(args.subdivisions),
        boxUvs: args.boxUvs === true,
      });
      const operation = {
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Bake ${quality} mesh for ${asset.name}`,
        asset: baked.asset,
      };
      const applied = await applyMotionAction(host, "creation/applyOperation", { operation });
      if (!applied.ok) return applied;

      let renderSyncCount = 0;
      const bakedMeshData: MotionObjectMeshData | null = baked.placeholder
        ? null
        : {
            positions: Array.from(baked.mesh.positions),
            normals: Array.from(baked.mesh.normals),
            uvs: Array.from(baked.mesh.uvs),
            indices: Array.from(baked.mesh.indices),
          };
      if (bakedMeshData) {
        for (const scene of state.scenes) {
          for (const binding of scene.renderBindings.filter(
            (candidate) => candidate.kind === "motion-scene3d",
          )) {
            const composition = getMotionComposition(host, binding.compositionId);
            if (!composition) continue;
            const layer = composition.layers.find(
              (candidate): candidate is MotionScene3DLayer =>
                candidate.id === binding.layerId && candidate.type === "scene3d",
            );
            if (!layer) continue;
            const sceneObjectByRenderId = new Map(
              binding.objectBindings.map((objectBinding) => [
                objectBinding.renderObjectId,
                objectBinding.sceneObjectId,
              ]),
            );
            let changed = false;
            const nextLayer: MotionScene3DLayer = {
              ...layer,
              objects: (layer.objects ?? []).map((renderObject) => {
                const sceneObjectId = sceneObjectByRenderId.get(renderObject.id);
                if (!sceneObjectId) return renderObject;
                const sceneObject = scene.objects.find(
                  (candidate) => candidate.id === sceneObjectId,
                );
                if (!sceneObject || sceneObject.assetId !== asset.id) return renderObject;
                changed = true;
                return {
                  ...renderObject,
                  object: { ...renderObject.object, mesh: bakedMeshData },
                };
              }),
            };
            if (!changed) continue;
            const synced = await commitMotionComposition(host, {
              ...composition,
              layers: composition.layers.map((candidate) =>
                candidate.id === nextLayer.id ? nextLayer : candidate,
              ),
              modifiedAt: now,
            });
            if (!synced.ok) return synced;
            renderSyncCount += 1;
          }
        }
      }

      const baseColor = baked.asset.materials[0]?.baseColor;
      const format = optionalString(args.format) === "glb" ? "glb" : "gltf";
      const wantExport = args.includeGltf === true;
      const exportOptions = { name: baked.asset.name, baseColor };
      const gltf =
        wantExport && format === "gltf" ? meshToGltf(baked.mesh, exportOptions) : undefined;
      const glbBase64 =
        wantExport && format === "glb" ? meshToGlbBase64(baked.mesh, exportOptions) : undefined;

      return ok(
        baked.placeholder
          ? `Baked placeholder for ${asset.id} (${baked.kind} has no CPU mesh generator yet)`
          : `Baked ${quality} mesh for ${asset.id}: ${baked.stats.vertexCount} verts, ${baked.stats.triangleCount} tris`,
        {
          assetId: asset.id,
          kind: baked.kind,
          quality,
          format,
          placeholder: baked.placeholder,
          vertexCount: baked.stats.vertexCount,
          triangleCount: baked.stats.triangleCount,
          bounds: baked.stats.bounds,
          cacheStatus: baked.placeholder ? "dirty" : "ready",
          renderSyncCount,
          operationId: operation.id,
          gltf,
          glbBase64,
        },
      );
    },
  },
  {
    name: "bake_creation_texture",
    domain: "motion",
    title: "Bake creation texture",
    description:
      "Bake a procedural texture for a creation object's material into a real CPU-generated image: compute its average color, mark a ready texture cache, optionally drive the realtime base color from the bake, and optionally return a PNG data URI. Resolves the material from an objectId/partId in a scene (or assetId + materialId). Pattern/colors default to the material's procedural-texture recipe when present. This is the CPU texture-bake reference (§7.11) behind a future native baker.",
    inputSchema: obj({
      sceneId: str,
      objectId: str,
      partId: str,
      assetId: str,
      materialId: str,
      pattern: str,
      colorA: str,
      colorB: str,
      secondaryColor: str,
      size: num,
      scale: num,
      seed: num,
      applyAverageColor: bool,
      includePng: bool,
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");

      let asset: CreationAssetRecipe | undefined;
      let object: CreationSceneObject | undefined;
      let scene: CreationScene | undefined;
      const explicitAssetId = optionalString(args.assetId);
      if (explicitAssetId) {
        asset = state.assets.find((candidate) => candidate.id === explicitAssetId);
        if (!asset) return fail(`Creation asset not found: ${explicitAssetId}`, "NOT_FOUND");
      } else {
        scene = resolveCreationScene(state, args.sceneId);
        if (!scene) {
          return fail("Provide assetId, or sceneId with objectId/partId", "INVALID_PARAMS");
        }
        const ref = optionalString(args.objectId) ?? optionalString(args.partId);
        if (!ref) {
          return fail("Provide assetId/materialId, or objectId/partId in the scene", "INVALID_PARAMS");
        }
        object = findCreationSceneObjectByReference(scene, ref);
        if (!object) return fail(`Creation object not found: ${ref}`, "NOT_FOUND");
        asset = state.assets.find((candidate) => candidate.id === object!.assetId);
        if (!asset) return fail(`Creation asset not found: ${object.assetId}`, "NOT_FOUND");
      }

      const materialId = optionalString(args.materialId) ?? object?.materialId ?? asset.materials[0]?.id;
      if (!materialId) return fail("No material to bake; provide materialId", "INVALID_PARAMS");
      const material = asset.materials.find((candidate) => candidate.id === materialId);
      if (!material) return fail(`Creation material not found: ${materialId}`, "NOT_FOUND");

      const recipe = asRecord(material.parameters?.proceduralTexture);
      const pattern =
        optionalString(args.pattern) ?? optionalString(recipe?.pattern) ?? "noise";
      const colorA =
        optionalString(args.colorA) ?? optionalString(recipe?.baseColor) ?? material.baseColor;
      const colorB =
        optionalString(args.colorB) ??
        optionalString(args.secondaryColor) ??
        optionalString(recipe?.secondaryColor) ??
        "#1e293b";
      const size = optionalNumber(args.size) ?? optionalNumber(recipe?.size) ?? 64;
      const scale = optionalNumber(args.scale) ?? optionalNumber(recipe?.scale) ?? 4;
      const seed = optionalNumber(args.seed) ?? 1;
      const applyAverageColor = args.applyAverageColor !== false;

      const textureOptions = { pattern, size, scale, seed, colorA, colorB };
      const png =
        args.includePng === true ? bakeProceduralTexturePng(textureOptions) : undefined;
      const baked = png ?? bakeProceduralTexture(textureOptions);
      const averageColor = baked.averageColor;
      const textureCacheId = `texture-${idSegment(materialId, "material")}-${pattern}`;

      const now = Date.now();
      const updatedMaterial: CreationMaterial = {
        ...material,
        baseColor: applyAverageColor ? averageColor : material.baseColor,
        textureCacheId,
        parameters: compactCreationParameters({
          ...material.parameters,
          proceduralTexture: compactCreationParameters({
            ...(recipe ?? {}),
            source: "agent-procedural-texture",
            pattern,
            baseColor: colorA,
            secondaryColor: colorB,
            scale,
            size: baked.size,
            seed,
            baked: true,
            averageColor,
            textureCacheId,
          }),
        }),
      };
      const textureCache: CreationCacheRef = {
        id: `cache-${idSegment(asset.id, "asset")}-texture-${idSegment(materialId, "material")}`,
        kind: "texture-atlas",
        status: "ready",
        generatedAt: now,
        generatorVersion: "agent-procedural-texture-bake-v1",
      };
      const updatedAsset: CreationAssetRecipe = {
        ...asset,
        materials: asset.materials.map((candidate) =>
          candidate.id === materialId ? updatedMaterial : candidate,
        ),
        caches: asset.caches.some((candidate) => candidate.id === textureCache.id)
          ? asset.caches.map((candidate) =>
              candidate.id === textureCache.id ? textureCache : candidate,
            )
          : [...asset.caches, textureCache],
        parameters: compactCreationParameters({
          ...asset.parameters,
          bakedTexture: compactCreationParameters({
            materialId,
            pattern,
            averageColor,
            size: baked.size,
          }),
        }),
        modifiedAt: now,
      };

      const operation = {
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Bake ${pattern} texture for ${material.name}`,
        asset: updatedAsset,
      };
      const applied = await applyMotionAction(host, "creation/applyOperation", { operation });
      if (!applied.ok) return applied;

      let syncedRenderObjectId: string | undefined;
      if (scene && object) {
        const bound = bindingForObject(scene, object.id);
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
            updatedMaterial,
          );
          if (typeof nextLayer === "string") return fail(nextLayer, "NOT_FOUND");
          const synced = await commitMotionComposition(host, {
            ...composition,
            layers: composition.layers.map((candidate) =>
              candidate.id === nextLayer.id ? nextLayer : candidate,
            ),
            modifiedAt: now,
          });
          if (!synced.ok) return synced;
          syncedRenderObjectId = bound.renderObjectId;
        }
      }

      return ok(`Baked ${pattern} texture for material ${materialId} (avg ${averageColor})`, {
        assetId: asset.id,
        materialId,
        pattern,
        averageColor,
        textureCacheId,
        size: baked.size,
        appliedAverageColor: applyAverageColor,
        operationId: operation.id,
        syncedRenderObjectId,
        dataUri: png?.dataUri,
      });
    },
  },
  {
    name: "set_creation_object_geometry",
    domain: "motion",
    title: "Set creation object geometry",
    description:
      "Update what a semantic creation scene object is, then sync the bound Motion Creator scene3d render object when a render binding exists. Use this for replacing placeholders, changing primitive/model/text3d content, adjusting size/depth/aspect/cornerRadius/extrude/lidAngle, or swapping a GLB modelUrl while keeping creation state editable.",
    inputSchema: obj({
      sceneId: str,
      objectId: str,
      name: str,
      assetName: str,
      assetKind: str,
      kind: str,
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
      opacity: num,
      visible: bool,
      selectable: bool,
      tags: { type: "array" },
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
      const bound = bindingForObject(scene, objectId);

      let nextComposition: MotionComposition | undefined;
      let nextRenderObject: MotionSceneObject3D | undefined;
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
        const currentRenderObject = (layer.objects ?? []).find(
          (candidate) => candidate.id === bound.renderObjectId,
        );
        if (!currentRenderObject) {
          return fail(`Render object not found: ${bound.renderObjectId}`, "NOT_FOUND");
        }
        const updatedRenderObject = updateMotionSceneObjectGeometry(
          currentRenderObject,
          args,
        );
        if (typeof updatedRenderObject === "string") {
          return fail(updatedRenderObject, "INVALID_PARAMS");
        }
        nextRenderObject = updatedRenderObject;
        const nextLayer: MotionScene3DLayer = {
          ...layer,
          objects: (layer.objects ?? []).map((candidate) =>
            candidate.id === updatedRenderObject.id ? updatedRenderObject : candidate,
          ),
        };
        nextComposition = {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        };
        syncedRenderObjectId = bound.renderObjectId;
      } else {
        const kind = optionalString(args.kind);
        if (!kind) {
          return fail(
            "kind is required when the creation object has no render binding",
            "INVALID_PARAMS",
          );
        }
        const built = buildSceneObject3D(
          {
            ...args,
            name: optionalString(args.name) ?? object.name,
            x: object.transform.position.x,
            y: object.transform.position.y,
            z: object.transform.position.z,
            rotationX: object.transform.rotation.x,
            rotationY: object.transform.rotation.y,
            rotationZ: object.transform.rotation.z,
            scaleX: object.transform.scale.x,
            scaleY: object.transform.scale.y,
            scaleZ: object.transform.scale.z,
          },
          `obj-${idSegment(object.id, "object")}`,
        );
        if ("error" in built) return fail(built.error, "INVALID_PARAMS");
        nextRenderObject = built.object;
      }

      const nextAsset = updateCreationAssetGeometry(asset, args, nextRenderObject, now);
      if (
        nextComposition &&
        nextRenderObject &&
        !nextRenderObject.object.mesh &&
        assetNeedsBakedMesh(nextAsset)
      ) {
        const rebakedMesh = bakeAssetToMotionObjectMesh(nextAsset);
        if (rebakedMesh) {
          const remeshed: MotionSceneObject3D = {
            ...nextRenderObject,
            object: { ...nextRenderObject.object, mesh: rebakedMesh },
          };
          nextRenderObject = remeshed;
          nextComposition = {
            ...nextComposition,
            layers: nextComposition.layers.map((candidate) =>
              candidate.type === "scene3d" && candidate.id === bound?.binding.layerId
                ? {
                    ...candidate,
                    objects: (candidate.objects ?? []).map((entry) =>
                      entry.id === remeshed.id ? remeshed : entry,
                    ),
                  }
                : candidate,
            ),
          };
        }
      }
      const nextTags = parseStringArray(args.tags);
      const nextObject: CreationSceneObject = {
        ...object,
        name: optionalString(args.name) ?? object.name,
        visible: typeof args.visible === "boolean" ? args.visible : object.visible,
        selectable:
          typeof args.selectable === "boolean" ? args.selectable : object.selectable,
        tags: nextTags ?? object.tags,
      };
      const nextScene: CreationScene = {
        ...scene,
        objects: scene.objects.map((candidate) =>
          candidate.id === nextObject.id ? nextObject : candidate,
        ),
        modifiedAt: now,
      };
      const assetOperation = {
        id: genId(),
        type: "asset/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Update geometry for ${nextObject.name}`,
        asset: nextAsset,
      };
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Update object ${nextObject.name}`,
        sceneId: scene.id,
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
        syncedRenderObjectId
          ? `Updated creation object ${objectId} geometry and synced ${syncedRenderObjectId}`
          : `Updated creation object ${objectId} geometry`,
        {
          sceneId: scene.id,
          objectId,
          assetId: nextAsset.id,
          operationIds: [assetOperation.id, sceneOperation.id],
          syncedRenderObjectId,
          syncedCompositionId: nextComposition?.id,
          object: nextObject,
          asset: nextAsset,
          renderObject: nextRenderObject,
        },
      );
    },
  },
  {
    name: "remove_creation_scene_object",
    domain: "motion",
    title: "Remove creation scene object",
    description:
      "Remove a semantic creation scene object and sync any bound Motion Creator scene3d render object. Cleans scene object references, optional child descendants, animation tracks, render binding entries, bound render objects, and bound object keyframes. Set removeAsset=true only when you want to delete the object's unused asset recipe too.",
    inputSchema: obj({
      sceneId: str,
      objectId: str,
      removeChildren: bool,
      removeAsset: bool,
    }, ["objectId"]),
    readOnly: false,
    destructive: true,
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

      const removeIds = new Set<string>([objectId]);
      if (args.removeChildren === true) {
        let changed = true;
        while (changed) {
          changed = false;
          for (const candidate of scene.objects) {
            if (candidate.parentId && removeIds.has(candidate.parentId) && !removeIds.has(candidate.id)) {
              removeIds.add(candidate.id);
              changed = true;
            }
          }
        }
      }

      const removedRenderIdsByBinding = new Map<string, Set<string>>();
      const removedRenderIds = new Set<string>();
      const nextRenderBindings = scene.renderBindings.map((binding) => {
        const idsForBinding = new Set<string>();
        const objectBindings = binding.objectBindings.filter((objectBinding) => {
          if (!removeIds.has(objectBinding.sceneObjectId)) return true;
          idsForBinding.add(objectBinding.renderObjectId);
          removedRenderIds.add(objectBinding.renderObjectId);
          return false;
        });
        if (idsForBinding.size > 0) removedRenderIdsByBinding.set(binding.id, idsForBinding);
        return {
          ...binding,
          objectBindings,
          modifiedAt: idsForBinding.size > 0 ? Date.now() : binding.modifiedAt,
        };
      });
      const now = Date.now();
      const nextScene: CreationScene = {
        ...scene,
        objects: scene.objects
          .filter((candidate) => !removeIds.has(candidate.id))
          .map((candidate) =>
            candidate.parentId && removeIds.has(candidate.parentId)
              ? { ...candidate, parentId: undefined }
              : candidate,
          ),
        animations: scene.animations
          .map((clip) => ({
            ...clip,
            tracks: clip.tracks.filter((track) => !removeIds.has(track.targetId)),
          }))
          .filter((clip) => clip.tracks.length > 0),
        renderBindings: nextRenderBindings,
        modifiedAt: now,
      };

      if (args.removeAsset === true) {
        const assetStillUsed = state.scenes.some((candidateScene) =>
          candidateScene.objects.some((candidateObject) => {
            if (candidateObject.assetId !== object.assetId) return false;
            return candidateScene.id !== scene.id || !removeIds.has(candidateObject.id);
          }),
        );
        if (assetStillUsed) {
          return fail(
            `Asset ${object.assetId} is still used by another scene object`,
            "INVALID_PARAMS",
          );
        }
      }

      const nextCompositions = new Map<string, MotionComposition>();
      for (const binding of scene.renderBindings) {
        const renderIds = removedRenderIdsByBinding.get(binding.id);
        if (!renderIds || renderIds.size === 0) continue;
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
        const nextLayer: MotionScene3DLayer = {
          ...layer,
          objects: (layer.objects ?? []).filter((renderObject) => !renderIds.has(renderObject.id)),
          keyframes: layer.keyframes.filter((keyframe) => {
            for (const renderObjectId of renderIds) {
              if (keyframe.property.startsWith(`scene.object.${renderObjectId}.`)) {
                return false;
              }
            }
            return true;
          }),
        };
        nextCompositions.set(binding.compositionId, {
          ...composition,
          layers: composition.layers.map((candidate) =>
            candidate.id === nextLayer.id ? nextLayer : candidate,
          ),
          modifiedAt: now,
        });
      }

      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Remove ${object.name}`,
        scene: nextScene,
      };
      const sceneApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: sceneOperation,
      });
      if (!sceneApplied.ok) return sceneApplied;

      const operationIds = [sceneOperation.id];
      let removedAssetId: string | undefined;
      if (args.removeAsset === true) {
        const assetOperation = {
          id: genId(),
          type: "asset/remove" as const,
          timestamp: now,
          source: "agent" as const,
          label: `Remove ${object.assetId}`,
          assetId: object.assetId,
        };
        const assetApplied = await applyMotionAction(host, "creation/applyOperation", {
          operation: assetOperation,
        });
        if (!assetApplied.ok) return assetApplied;
        operationIds.push(assetOperation.id);
        removedAssetId = object.assetId;
      }

      for (const composition of nextCompositions.values()) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      return ok(
        nextCompositions.size > 0
          ? `Removed creation object ${objectId} and synced render bindings`
          : `Removed creation object ${objectId}`,
        {
          sceneId: scene.id,
          objectId,
          removedObjectIds: [...removeIds],
          removedRenderObjectIds: [...removedRenderIds],
          removedAssetId,
          operationIds,
          syncedCompositionIds: [...nextCompositions.keys()],
        },
      );
    },
  },
  {
    name: "apply_creation_bevel",
    domain: "motion",
    title: "Apply creation bevel",
    description:
      "Apply an editable bevel/chamfer recipe node to selected semantic creation objects and sync a rounded preview into bound scene3d render objects. Use this for product body chamfers, lens rims, device corners, panels, buttons, packaging edges, and other high-quality hard-surface details that must remain adjustable rather than baked into a mesh.",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      key: str,
      name: str,
      nodeName: str,
      radius: num,
      amount: num,
      width: num,
      segments: num,
      profile: str,
      weight: num,
      affectedEdges: str,
      edges: str,
      clampOverlap: bool,
      hardenNormals: bool,
      previewRoundedBox: bool,
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

      const selectedOrError = resolveCreationExplodedViewObjects(scene, args);
      if (typeof selectedOrError === "string") {
        return fail(selectedOrError, "INVALID_PARAMS");
      }
      const selected = selectedOrError;
      if (selected.length === 0) {
        return fail("No creation objects selected for bevel", "INVALID_PARAMS");
      }

      const radius = clampNumber(
        optionalNumber(args.radius) ??
          optionalNumber(args.amount) ??
          optionalNumber(args.width) ??
          0.06,
        0,
        10,
      );
      const segments = Math.max(
        1,
        Math.min(64, Math.floor(optionalNumber(args.segments) ?? 5)),
      );
      const selectedAssetIds = new Set(selected.map((object) => object.assetId));
      const affectedObjects = scene.objects.filter((object) =>
        selectedAssetIds.has(object.assetId),
      );
      const affectedObjectsByAssetId = new Map<string, CreationSceneObject[]>();
      for (const object of affectedObjects) {
        const group = affectedObjectsByAssetId.get(object.assetId) ?? [];
        group.push(object);
        affectedObjectsByAssetId.set(object.assetId, group);
      }

      const now = Date.now();
      const nextAssets = new Map<string, CreationAssetRecipe>();
      for (const [assetId, objects] of affectedObjectsByAssetId) {
        const asset = state.assets.find((candidate) => candidate.id === assetId);
        if (!asset) return fail(`Creation asset not found: ${assetId}`, "NOT_FOUND");
        nextAssets.set(
          assetId,
          updateCreationAssetBevel(asset, objects, args, { radius, segments, now }),
        );
      }

      const syncedRenderObjectIds: string[] = [];
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
            return updateMotionObjectForBevel(renderObject, radius, args);
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
        label: `Apply bevel to ${asset.name}`,
        asset,
      }));
      for (const operation of assetOperations) {
        const assetApplied = await applyMotionAction(host, "creation/applyOperation", {
          operation,
        });
        if (!assetApplied.ok) return assetApplied;
      }
      for (const composition of nextCompositions) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      return ok(
        syncedRenderObjectIds.length > 0
          ? `Applied bevel to ${affectedObjects.length} objects and synced ${syncedRenderObjectIds.length} render objects`
          : `Applied bevel to ${affectedObjects.length} objects`,
        {
          sceneId: scene.id,
          selectedObjectIds: selected.map((object) => object.id),
          objectIds: affectedObjects.map((object) => object.id),
          partIds: affectedObjects.map((object) => object.partId).filter(Boolean),
          assetIds: [...nextAssets.keys()],
          radius,
          segments,
          operationIds: assetOperations.map((operation) => operation.id),
          syncedRenderObjectIds,
          syncedCompositionIds: nextCompositions.map((composition) => composition.id),
          bevel: nextAssets.values().next().value?.parameters.bevel,
        },
      );
    },
  },
  {
    name: "apply_creation_displacement",
    domain: "motion",
    title: "Apply creation displacement",
    description:
      "Apply editable procedural displacement metadata to selected semantic creation objects and sync a terrain/relief preview into bound scene3d objects. Use this for moon terrain, craters, ridges, product grooves, fabric wrinkles, panel embossing, and rough environment surfaces while keeping the deformation as a recipe node for future native mesh baking.",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      key: str,
      name: str,
      nodeName: str,
      kind: str,
      type: str,
      mode: str,
      amplitude: num,
      height: num,
      amount: num,
      previewDepth: num,
      previewAsSlab: bool,
      previewRoughness: num,
      depth: num,
      roughness: num,
      frequency: num,
      octaves: num,
      lacunarity: num,
      gain: num,
      seed: str,
      scale: num,
      size: num,
      direction: str,
      normal: { type: "object" },
      normalX: num,
      normalY: num,
      normalZ: num,
      craterCount: num,
      craterRadius: num,
      ridgeSharpness: num,
      waveLength: num,
      erosion: num,
      terraces: num,
      smoothing: num,
      bakeTarget: str,
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

      const selectedOrError = resolveCreationExplodedViewObjects(scene, args);
      if (typeof selectedOrError === "string") {
        return fail(selectedOrError, "INVALID_PARAMS");
      }
      const selected = selectedOrError;
      if (selected.length === 0) {
        return fail("No creation objects selected for displacement", "INVALID_PARAMS");
      }

      const kind = creationDisplacementKind(args.kind ?? args.type ?? args.mode);
      const amplitude = Math.max(
        0,
        optionalNumber(args.amplitude) ??
          optionalNumber(args.height) ??
          optionalNumber(args.amount) ??
          0.12,
      );
      const previewDepth = Math.max(
        0.001,
        optionalNumber(args.previewDepth) ??
          optionalNumber(args.depth) ??
          amplitude,
      );
      const selectedAssetIds = new Set(selected.map((object) => object.assetId));
      const affectedObjects = scene.objects.filter((object) =>
        selectedAssetIds.has(object.assetId),
      );
      const affectedObjectsByAssetId = new Map<string, CreationSceneObject[]>();
      for (const object of affectedObjects) {
        const group = affectedObjectsByAssetId.get(object.assetId) ?? [];
        group.push(object);
        affectedObjectsByAssetId.set(object.assetId, group);
      }

      const now = Date.now();
      const nextAssets = new Map<string, CreationAssetRecipe>();
      for (const [assetId, objects] of affectedObjectsByAssetId) {
        const asset = state.assets.find((candidate) => candidate.id === assetId);
        if (!asset) return fail(`Creation asset not found: ${assetId}`, "NOT_FOUND");
        nextAssets.set(
          assetId,
          updateCreationAssetDisplacement(asset, objects, args, {
            kind,
            amplitude,
            previewDepth,
            now,
          }),
        );
      }

      const syncedRenderObjectIds: string[] = [];
      const bakedRenderObjectIds: string[] = [];
      const bakedMeshByAssetId = new Map<string, MotionObjectMeshData | null>();
      const bakedMeshForAsset = (
        assetId: string,
        asset: CreationAssetRecipe,
      ): MotionObjectMeshData | null => {
        if (!bakedMeshByAssetId.has(assetId)) {
          bakedMeshByAssetId.set(assetId, bakeAssetToMotionObjectMesh(asset));
        }
        return bakedMeshByAssetId.get(assetId) ?? null;
      };
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
            const approximated = updateMotionObjectForDisplacement(renderObject, args, {
              amplitude,
              previewDepth,
            });
            const updatedAsset = nextAssets.get(sceneObject.assetId);
            if (!updatedAsset) return approximated;
            const mesh = bakedMeshForAsset(sceneObject.assetId, updatedAsset);
            if (!mesh) return approximated;
            bakedRenderObjectIds.push(renderObject.id);
            return { ...approximated, object: { ...approximated.object, mesh } };
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
        label: `Apply displacement to ${asset.name}`,
        asset,
      }));
      for (const operation of assetOperations) {
        const assetApplied = await applyMotionAction(host, "creation/applyOperation", {
          operation,
        });
        if (!assetApplied.ok) return assetApplied;
      }
      for (const composition of nextCompositions) {
        const synced = await commitMotionComposition(host, composition);
        if (!synced.ok) return synced;
      }

      return ok(
        syncedRenderObjectIds.length > 0
          ? `Applied ${kind} displacement and synced ${syncedRenderObjectIds.length} render objects`
          : `Applied ${kind} displacement`,
        {
          sceneId: scene.id,
          selectedObjectIds: selected.map((object) => object.id),
          objectIds: affectedObjects.map((object) => object.id),
          partIds: affectedObjects.map((object) => object.partId).filter(Boolean),
          assetIds: [...nextAssets.keys()],
          kind,
          amplitude,
          previewDepth,
          operationIds: assetOperations.map((operation) => operation.id),
          syncedRenderObjectIds,
          bakedRenderObjectIds,
          renderSyncCount: bakedRenderObjectIds.length,
          syncedCompositionIds: nextCompositions.map((composition) => composition.id),
          displacement: nextAssets.values().next().value?.parameters.displacement,
        },
      );
    },
  },
  {
    name: "apply_creation_boolean",
    domain: "motion",
    title: "Apply creation boolean (CSG)",
    description:
      "Carve, fuse, intersect, or smooth-blend a semantic creation object's geometry with a procedural tool shape (sphere/box) using robust signed-distance-field CSG, then bake the real result into the bound scene3d viewport. Use this for device ports, speaker holes, button cutouts, lens cavities, camera cutouts, hollow shells, fused organic blobs, and metaball joins while keeping the operation editable as recipe nodes. Operations: subtract (carve), union (fuse), intersect, smooth-union (blend).",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      key: str,
      name: str,
      nodeName: str,
      operation: str,
      op: str,
      mode: str,
      smoothing: num,
      toolShape: str,
      shape: str,
      toolRadius: num,
      radius: num,
      toolSize: num,
      size: num,
      toolHalf: { type: "object" },
      half: { type: "object" },
      toolOffset: { type: "object" },
      offset: { type: "object" },
      toolX: num,
      toolY: num,
      toolZ: num,
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
      const selectedOrError = resolveCreationExplodedViewObjects(scene, args);
      if (typeof selectedOrError === "string") {
        return fail(selectedOrError, "INVALID_PARAMS");
      }
      const selected = selectedOrError;
      if (selected.length === 0) {
        return fail("No creation objects selected for boolean", "INVALID_PARAMS");
      }

      const operation = creationBooleanOperation(args.operation ?? args.op ?? args.mode);
      const smoothing = Math.max(0.001, optionalNumber(args.smoothing) ?? 0.25);
      const selectedAssetIds = new Set(selected.map((object) => object.assetId));
      const affectedObjects = scene.objects.filter((object) =>
        selectedAssetIds.has(object.assetId),
      );
      const now = Date.now();
      const nextAssets = new Map<string, CreationAssetRecipe>();
      const approximatedAssetIds = new Set<string>();
      for (const assetId of selectedAssetIds) {
        const asset = state.assets.find((candidate) => candidate.id === assetId);
        if (!asset) return fail(`Creation asset not found: ${assetId}`, "NOT_FOUND");
        if (sdfBodyApproximatesPrimitive(asset)) approximatedAssetIds.add(assetId);
        nextAssets.set(
          assetId,
          updateCreationAssetBoolean(asset, args, { operation, smoothing, now }),
        );
      }
      const approximatedBodyObjectIds = affectedObjects
        .filter((object) => approximatedAssetIds.has(object.assetId))
        .map((object) => object.id);

      const syncedRenderObjectIds: string[] = [];
      const bakedRenderObjectIds: string[] = [];
      const bakedMeshByAssetId = new Map<string, MotionObjectMeshData | null>();
      const bakedMeshForAsset = (
        assetId: string,
        asset: CreationAssetRecipe,
      ): MotionObjectMeshData | null => {
        if (!bakedMeshByAssetId.has(assetId)) {
          bakedMeshByAssetId.set(assetId, bakeAssetToMotionObjectMesh(asset));
        }
        return bakedMeshByAssetId.get(assetId) ?? null;
      };
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
            const updatedAsset = nextAssets.get(sceneObject.assetId)!;
            const mesh = bakedMeshForAsset(sceneObject.assetId, updatedAsset);
            if (!mesh) return renderObject;
            bakedRenderObjectIds.push(renderObject.id);
            return { ...renderObject, object: { ...renderObject.object, mesh } };
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
        label: `Apply ${operation} boolean to ${asset.name}`,
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

      const approximationNote =
        approximatedBodyObjectIds.length > 0
          ? ` (${approximatedBodyObjectIds.length} non-box/sphere bodies approximated as a box SDF)`
          : "";
      return ok(
        bakedRenderObjectIds.length > 0
          ? `Applied ${operation} boolean and baked ${bakedRenderObjectIds.length} render objects${approximationNote}`
          : `Applied ${operation} boolean${approximationNote}`,
        {
          sceneId: scene.id,
          selectedObjectIds: selected.map((object) => object.id),
          objectIds: affectedObjects.map((object) => object.id),
          partIds: affectedObjects.map((object) => object.partId).filter(Boolean),
          assetIds: [...nextAssets.keys()],
          operation,
          smoothing,
          operationIds: assetOperations.map((entry) => entry.id),
          syncedRenderObjectIds,
          bakedRenderObjectIds,
          renderSyncCount: bakedRenderObjectIds.length,
          approximatedBodyObjectIds,
          syncedCompositionIds: nextCompositions.map((composition) => composition.id),
        },
      );
    },
  },
  {
    name: "apply_creation_array",
    domain: "motion",
    title: "Apply creation array",
    description:
      "Repeat a semantic creation object's geometry into an editable row/grid of evenly-offset copies merged into one mesh, baked into the bound scene3d viewport. Use this for fences, railings, teeth, fins, columns, slats, keyboard keys, window grids, stair steps, and repeated hard-surface detail. Default offset is one mesh-width along X; set offsetX/offsetY/offsetZ for custom spacing. Select with objectIds, partIds, or tags.",
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
      offsetX: num,
      offsetY: num,
      offsetZ: num,
      spacingX: num,
      spacingY: num,
      spacingZ: num,
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
        return fail("No creation objects selected for array", "INVALID_PARAMS");
      }

      const now = Date.now();
      const count = Math.round(clampNumber(optionalNumber(args.count) ?? 3, 1, 64));
      const selectedAssetIds = new Set(selected.map((object) => object.assetId));
      const affectedObjects = scene.objects.filter((object) =>
        selectedAssetIds.has(object.assetId),
      );
      const nextAssets = new Map<string, CreationAssetRecipe>();
      for (const assetId of selectedAssetIds) {
        const asset = state.assets.find((candidate) => candidate.id === assetId);
        if (!asset) return fail(`Creation asset not found: ${assetId}`, "NOT_FOUND");
        nextAssets.set(assetId, updateCreationAssetArray(asset, args, now));
      }

      const syncedRenderObjectIds: string[] = [];
      const bakedRenderObjectIds: string[] = [];
      const bakedMeshByAssetId = new Map<string, MotionObjectMeshData | null>();
      const bakedMeshForAsset = (
        assetId: string,
        asset: CreationAssetRecipe,
      ): MotionObjectMeshData | null => {
        if (!bakedMeshByAssetId.has(assetId)) {
          bakedMeshByAssetId.set(assetId, bakeAssetToMotionObjectMesh(asset));
        }
        return bakedMeshByAssetId.get(assetId) ?? null;
      };
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
            const updatedAsset = nextAssets.get(sceneObject.assetId)!;
            const mesh = bakedMeshForAsset(sceneObject.assetId, updatedAsset);
            if (!mesh) return renderObject;
            bakedRenderObjectIds.push(renderObject.id);
            return { ...renderObject, object: { ...renderObject.object, meshFrames: undefined, mesh } };
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
        label: `Apply array to ${asset.name}`,
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
          ? `Applied array (x${count}) and baked ${bakedRenderObjectIds.length} render objects`
          : `Applied array (x${count})`,
        {
          sceneId: scene.id,
          selectedObjectIds: selected.map((object) => object.id),
          objectIds: affectedObjects.map((object) => object.id),
          partIds: affectedObjects.map((object) => object.partId).filter(Boolean),
          assetIds: [...nextAssets.keys()],
          count,
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
    name: "apply_creation_texture_map",
    domain: "motion",
    title: "Apply creation texture map",
    description:
      "Bake a procedural texture (noise, voronoi, fbm, marble, circuit, fabric-weave, lunar-dust, hex-grid, gradient, brushed, checker) into a real image and apply it as the surface MAP of selected creation objects, so the actual pattern shows in the bound scene3d viewport instead of a flat averaged color. Use this for circuit-board chips, brushed metal, marble, fabric suits, lunar terrain, hex panels, and patterned surfaces. Select with objectIds, partIds, or tags; control with pattern, colorA, colorB, scale, seed, textureSize.",
    inputSchema: obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      excludeTags: { type: "array" },
      pattern: str,
      colorA: str,
      colorB: str,
      color: str,
      scale: num,
      seed: num,
      textureSize: num,
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
        return fail("No creation objects selected for texture map", "INVALID_PARAMS");
      }

      const pattern = optionalString(args.pattern) ?? "fbm";
      const colorA = optionalString(args.colorA) ?? optionalString(args.color) ?? "#9aa0a6";
      const colorB = optionalString(args.colorB) ?? "#3b3f46";
      const scale = optionalNumber(args.scale) ?? 4;
      const seed =
        optionalNumber(args.seed) ?? hashStringToSeed(optionalString(args.seed) ?? pattern);
      const textureSize = Math.round(clampNumber(optionalNumber(args.textureSize) ?? 256, 64, 512));
      const baked = bakeProceduralTexturePng({ pattern, colorA, colorB, scale, seed, size: textureSize });

      const sceneKey = idSegment(scene.id, "scene");
      const textureKey = idSegment(`${pattern}-${scale}-${seed}`, "tex");
      const textureAssetId = `tex-${sceneKey}-${textureKey}`;
      const imageAsset: MotionAsset = {
        id: textureAssetId,
        type: "image",
        name: optionalString(args.name) ?? `${pattern} texture`,
        url: baked.dataUri,
        width: baked.size,
        height: baked.size,
      };

      const now = Date.now();
      const selectedAssetIds = new Set(selected.map((object) => object.assetId));
      const affectedObjects = scene.objects.filter((object) =>
        selectedAssetIds.has(object.assetId),
      );
      const textureParameters = compactCreationParameters({
        source: "agent-texture-map",
        mapAssetId: textureAssetId,
        texturePattern: pattern,
        scale,
        seed,
      });
      const nextAssets = new Map<string, CreationAssetRecipe>();
      for (const assetId of selectedAssetIds) {
        const asset = state.assets.find((candidate) => candidate.id === assetId);
        if (!asset) return fail(`Creation asset not found: ${assetId}`, "NOT_FOUND");
        const materialIds = new Set(
          affectedObjects
            .filter((object) => object.assetId === assetId)
            .map((object) =>
              asset.materials.some((material) => material.id === object.materialId)
                ? object.materialId
                : asset.materials[0]?.id,
            )
            .filter((id): id is string => Boolean(id)),
        );
        const nextMaterials = asset.materials.map((material) =>
          materialIds.has(material.id)
            ? {
                ...material,
                baseColor: baked.averageColor,
                textureCacheId: textureAssetId,
                parameters: textureParameters,
              }
            : material,
        );
        nextAssets.set(assetId, { ...asset, materials: nextMaterials, modifiedAt: now });
      }

      const syncedRenderObjectIds: string[] = [];
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
            if (!sceneObject) return renderObject;
            syncedRenderObjectIds.push(renderObject.id);
            return {
              ...renderObject,
              material: {
                ...(renderObject.material ?? { kind: "physical" }),
                color: baked.averageColor,
                mapAssetId: textureAssetId,
              },
            };
          }),
        };
        const assets = composition.assets.some((candidate) => candidate.id === textureAssetId)
          ? composition.assets.map((candidate) =>
              candidate.id === textureAssetId ? imageAsset : candidate,
            )
          : [...composition.assets, imageAsset];
        nextCompositions.push({
          ...composition,
          assets,
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
        label: `Apply ${pattern} texture map to ${asset.name}`,
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
        syncedRenderObjectIds.length > 0
          ? `Applied ${pattern} texture map to ${syncedRenderObjectIds.length} render objects`
          : `Applied ${pattern} texture map`,
        {
          sceneId: scene.id,
          selectedObjectIds: selected.map((object) => object.id),
          objectIds: affectedObjects.map((object) => object.id),
          partIds: affectedObjects.map((object) => object.partId).filter(Boolean),
          assetIds: [...nextAssets.keys()],
          pattern,
          textureAssetId,
          textureSize,
          averageColor: baked.averageColor,
          operationIds: assetOperations.map((entry) => entry.id),
          syncedRenderObjectIds,
          syncedCompositionIds: nextCompositions.map((composition) => composition.id),
        },
      );
    },
  }
];
