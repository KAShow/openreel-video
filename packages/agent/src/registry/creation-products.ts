import {
  CREATION_PRODUCT_PART_DEFAULTS,
  CREATION_PRODUCT_PART_ROLES,
  CreationProductPartDefaults,
  RegisteredTool,
  addVec3,
  applyMotionAction,
  averageCreationObjectPosition,
  bool,
  buildCreationLightSweepTracks,
  buildSceneObject3D,
  clampNumber,
  commitMotionComposition,
  creationAssetFromSceneObject,
  creationCameraModuleComponentRotation,
  creationDecalTargets,
  creationMaterialFromSceneObject,
  creationProductPartRole,
  creationState,
  creationUiPanelBasis,
  cutawayNormalFromArgs,
  cutawayRotationForNormal,
  fail,
  genId,
  getMotionComposition,
  idSegment,
  lightSweepDirection,
  mergeSceneKeyframes,
  motionKeyframesForCreationObjectTracks,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  parseCreationCameraModuleComponents,
  parseCreationProductInternalsComponents,
  parseCreationScreenStackLayers,
  parseStringArray,
  requiredTransform3D,
  resolveCreationParentId,
  resolveCreationScene,
  scaleVec3,
  str,
  uiPanelWorldPosition,
  uniqueIdSegment,
  updateCreationAssetCameraModuleComponent,
  updateCreationAssetLightSweep,
  updateCreationAssetProductInternalsComponent,
  updateCreationAssetProductPart,
  updateCreationAssetScreenStackLayer,
  vec3FromArgs,
} from "./shared";
import {
  type CreationAnimationClip,
  type CreationAssetRecipe,
  type CreationRenderBinding,
  type CreationScene,
  type CreationSceneObject,
} from "@openreel/core/creation/index";
import {
  type MotionComposition,
  type MotionScene3DLayer,
  type MotionSceneObject3D,
} from "@openreel/core/motion/types";

export const creationProductTools: RegisteredTool[] = [
  {
    name: "add_creation_product_part",
    domain: "motion",
    title: "Add creation product part",
    description:
      "Add one editable semantic product part to an existing creation scene and sync it into the bound scene3d layer. Use this for product internals and details like shells, screens, lenses, camera modules, boards, batteries, chips, thermal layers, screws, connectors, gaskets, and decorative parts. The asset recipe gets a product-part node with role metadata so agents and professionals can inspect, animate, restyle, explode, label, or refine it later.",
    inputSchema: obj({
      sceneId: str,
      role: str,
      partRole: str,
      key: str,
      objectId: str,
      renderObjectId: str,
      parentId: str,
      parentKey: str,
      targetObjectId: str,
      targetPartId: str,
      targetPart: str,
      partId: str,
      name: str,
      assetId: str,
      assetName: str,
      materialId: str,
      materialName: str,
      materialModel: str,
      kind: str,
      x: num,
      y: num,
      z: num,
      position: { type: "object" },
      rotation: { type: "object" },
      rotationX: num,
      rotationY: num,
      rotationZ: num,
      scale: { type: "object" },
      scaleX: num,
      scaleY: num,
      scaleZ: num,
      size: num,
      depth: num,
      aspect: num,
      cornerRadius: num,
      color: str,
      baseColor: str,
      metalness: num,
      metallic: num,
      roughness: num,
      opacity: num,
      emissive: str,
      emissiveIntensity: num,
      materialKind: str,
      mapAssetId: str,
      anchor: { type: "object" },
      calloutAnchor: { type: "object" },
      anchorX: num,
      anchorY: num,
      anchorZ: num,
      semanticLayer: str,
      layer: str,
      exactness: str,
      references: { type: "array" },
      referenceIds: { type: "array" },
      notes: str,
      nodeName: str,
      tags: { type: "array" },
      visible: bool,
      selectable: bool,
    }, ["role"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");

      const role = creationProductPartRole(args.role ?? args.partRole);
      if (!role) {
        return fail(
          `role must be one of: ${CREATION_PRODUCT_PART_ROLES.join(", ")}`,
          "INVALID_PARAMS",
        );
      }
      const defaults: CreationProductPartDefaults = CREATION_PRODUCT_PART_DEFAULTS[role];
      const sceneKey = idSegment(scene.id, "scene");
      const key = idSegment(
        args.key ?? args.objectId ?? args.partId ?? args.name ?? role,
        `${role}-${scene.objects.length + 1}`,
      );
      const objectId = optionalString(args.objectId) ?? `object-${sceneKey}-${key}`;
      if (scene.objects.some((object) => object.id === objectId)) {
        return fail(`Creation object already exists: ${objectId}`, "INVALID_PARAMS");
      }
      const assetId = optionalString(args.assetId) ?? `asset-${sceneKey}-${key}`;
      if (state.assets.some((asset) => asset.id === assetId)) {
        return fail(`Creation asset already exists: ${assetId}`, "INVALID_PARAMS");
      }
      const parent = resolveCreationParentId(
        scene,
        args.parentId ?? args.targetObjectId,
        args.parentKey ?? args.targetPartId ?? args.targetPart,
      );
      if (!parent.ok) return fail(parent.error, "INVALID_PARAMS");
      const parentObject = parent.parentId
        ? scene.objects.find((object) => object.id === parent.parentId)
        : undefined;
      const fallbackPosition = parentObject
        ? addVec3(parentObject.transform.position, defaults.position)
        : defaults.position;
      const position = vec3FromArgs(
        args.position,
        fallbackPosition,
        ["x", "y", "z"],
        args,
      );
      const rotation = vec3FromArgs(
        args.rotation,
        { x: 0, y: 0, z: 0 },
        ["rotationX", "rotationY", "rotationZ"],
        args,
      );
      const scale = vec3FromArgs(
        args.scale,
        defaults.scale,
        ["scaleX", "scaleY", "scaleZ"],
        args,
      );

      const binding =
        scene.renderBindings.find((candidate) => candidate.kind === "motion-scene3d");
      const existingRenderIds = new Set(
        scene.renderBindings.flatMap((candidate) =>
          candidate.objectBindings.map((objectBinding) => objectBinding.renderObjectId),
        ),
      );
      const renderObjectId = optionalString(args.renderObjectId) ?? `obj-${sceneKey}-${key}`;
      if (existingRenderIds.has(renderObjectId)) {
        return fail(`Render object already exists: ${renderObjectId}`, "INVALID_PARAMS");
      }

      const rawObject: Record<string, unknown> = {
        ...args,
        kind: optionalString(args.kind) ?? defaults.kind,
        name: optionalString(args.name) ?? defaults.name,
        assetId,
        assetName: optionalString(args.assetName) ?? optionalString(args.name) ?? defaults.name,
        assetKind: "product",
        materialId: optionalString(args.materialId) ?? `mat-${sceneKey}-${key}`,
        materialName:
          optionalString(args.materialName) ??
          `${optionalString(args.name) ?? defaults.name} material`,
        materialModel: optionalString(args.materialModel) ?? defaults.materialModel,
        x: position.x,
        y: position.y,
        z: position.z,
        rotationX: rotation.x,
        rotationY: rotation.y,
        rotationZ: rotation.z,
        scaleX: scale.x,
        scaleY: scale.y,
        scaleZ: scale.z,
        cornerRadius: optionalNumber(args.cornerRadius) ?? defaults.cornerRadius,
        color:
          optionalString(args.color) ??
          optionalString(args.baseColor) ??
          defaults.color,
        baseColor:
          optionalString(args.baseColor) ??
          optionalString(args.color) ??
          defaults.color,
        metalness:
          optionalNumber(args.metalness) ??
          optionalNumber(args.metallic) ??
          defaults.metalness,
        roughness: optionalNumber(args.roughness) ?? defaults.roughness,
        opacity: optionalNumber(args.opacity) ?? defaults.opacity,
        emissive: optionalString(args.emissive) ?? defaults.emissive,
        emissiveIntensity:
          optionalNumber(args.emissiveIntensity) ?? defaults.emissiveIntensity,
      };
      const built = buildSceneObject3D(rawObject, renderObjectId);
      if ("error" in built) return fail(built.error, "INVALID_PARAMS");

      const now = Date.now();
      const material = creationMaterialFromSceneObject(
        `${sceneKey}-${key}`,
        rawObject,
        built.object,
      );
      const baseAsset = creationAssetFromSceneObject(
        `${sceneKey}-${key}`,
        rawObject,
        built.object,
        material,
        now,
      );
      const object: CreationSceneObject = {
        id: objectId,
        name: built.object.name ?? defaults.name,
        assetId: baseAsset.id,
        materialId: material.id,
        partId: optionalString(args.partId) ?? key,
        parentId: parent.parentId,
        transform: requiredTransform3D(built.object),
        visible: args.visible !== false,
        selectable: args.selectable !== false,
        tags: [
          ...new Set([
            "agent-created",
            "product-part",
            role,
            built.object.object.kind,
            ...defaults.tags,
            ...(parseStringArray(args.tags) ?? []),
          ]),
        ],
      };
      const asset = updateCreationAssetProductPart(baseAsset, object, args, {
        role,
        now,
      });

      let nextComposition: MotionComposition | undefined;
      let nextRenderBinding: CreationRenderBinding | undefined;
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
          objects: [...(layer.objects ?? []), built.object],
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
            { sceneObjectId: object.id, renderObjectId },
          ],
          modifiedAt: now,
        };
      }

      const nextScene: CreationScene = {
        ...scene,
        objects: [...scene.objects, object],
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
        label: `Create ${role} product part ${object.name}`,
        asset,
      };
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add ${role} product part to ${scene.name}`,
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
          ? `Added ${role} product part ${object.id} and synced ${renderObjectId}`
          : `Added ${role} product part ${object.id}`,
        {
          sceneId: scene.id,
          role,
          objectId: object.id,
          partId: object.partId,
          parentId: object.parentId,
          renderObjectId,
          assetId: asset.id,
          materialId: material.id,
          productPart: asset.parameters.productPart,
          operationIds: [assetOperation.id, sceneOperation.id],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          object,
          asset,
        },
      );
    },
  },
  {
    name: "add_creation_screen_stack",
    domain: "motion",
    title: "Add creation screen stack",
    description:
      "Add an editable layered product display stack to an existing creation scene and sync every layer into the bound scene3d layer. Use this for product intros that need separate cover glass, OLED/display, digitizer, backplate, or custom display layers that can be exploded, labeled, restyled, animated, and recovered from semantic state.",
    inputSchema: obj({
      sceneId: str,
      key: str,
      stackId: str,
      objectId: str,
      renderObjectId: str,
      assetId: str,
      materialId: str,
      parentId: str,
      parentKey: str,
      targetObjectId: str,
      targetPartId: str,
      targetPart: str,
      targetObjectIds: { type: "array" },
      objectIds: { type: "array" },
      targetPartIds: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      name: str,
      partId: str,
      partIdPrefix: str,
      partPrefix: str,
      width: num,
      height: num,
      thickness: num,
      spacing: num,
      offset: num,
      normal: { type: "object" },
      normalX: num,
      normalY: num,
      normalZ: num,
      axis: str,
      flip: bool,
      position: { type: "object" },
      x: num,
      y: num,
      z: num,
      rotation: { type: "object" },
      rotationX: num,
      rotationY: num,
      rotationZ: num,
      cornerRadius: num,
      mapAssetId: str,
      exactness: str,
      bakeTarget: str,
      nodeName: str,
      includeGlass: bool,
      includeOled: bool,
      includeDigitizer: bool,
      includeBacklight: bool,
      includeBackplate: bool,
      includeFrame: bool,
      layers: { type: "array" },
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

      const layerSpecs = parseCreationScreenStackLayers(args);
      if (layerSpecs.length === 0) {
        return fail("Screen stack requires at least one layer", "INVALID_PARAMS");
      }

      const sceneKey = idSegment(scene.id, "scene");
      const key = idSegment(
        args.key ?? args.stackId ?? args.partId ?? args.name,
        `screen-stack-${scene.objects.length + 1}`,
      );
      const stackId = optionalString(args.stackId) ?? `screen-stack-${sceneKey}-${key}`;
      const objectPrefix = optionalString(args.objectId) ?? `object-${sceneKey}-${key}`;
      const renderPrefix = optionalString(args.renderObjectId) ?? `obj-${sceneKey}-${key}`;
      const assetPrefix = optionalString(args.assetId) ?? `asset-${sceneKey}-${key}`;
      const materialPrefix = optionalString(args.materialId) ?? `mat-${sceneKey}-${key}`;
      const partPrefix = idSegment(
        args.partIdPrefix ?? args.partPrefix ?? args.partId ?? key,
        key,
      );

      const existingObjectIds = new Set(scene.objects.map((object) => object.id));
      const existingAssetIds = new Set(state.assets.map((asset) => asset.id));
      const existingRenderIds = new Set(
        scene.renderBindings.flatMap((binding) =>
          binding.objectBindings.map((objectBinding) => objectBinding.renderObjectId),
        ),
      );
      const targetObjects = creationDecalTargets(scene, args);
      const parent = resolveCreationParentId(
        scene,
        args.parentId ?? args.targetObjectId,
        args.parentKey ?? args.targetPartId ?? args.targetPart,
      );
      if (!parent.ok) return fail(parent.error, "INVALID_PARAMS");
      const parentId =
        parent.parentId ?? (targetObjects.length === 1 ? targetObjects[0]?.id : undefined);
      const normal = cutawayNormalFromArgs(args);
      const offset = optionalNumber(args.offset) ?? (targetObjects.length > 0 ? 0.03 : 0);
      const targetCenter =
        targetObjects.length > 0
          ? averageCreationObjectPosition(targetObjects)
          : { x: 0, y: 0, z: 0 };
      const targetScale = targetObjects[0]?.transform.scale;
      const fallbackWidth = targetScale
        ? Math.max(0.12, Math.max(targetScale.x, targetScale.z) * 0.82)
        : 0.92;
      const fallbackHeight = targetScale
        ? Math.max(0.12, Math.max(targetScale.y, targetScale.z) * 0.78)
        : 0.52;
      const width = Math.max(0.05, optionalNumber(args.width) ?? fallbackWidth);
      const height = Math.max(0.05, optionalNumber(args.height) ?? fallbackHeight);
      const spacing = Math.max(
        0.001,
        optionalNumber(args.spacing) ??
          optionalNumber(args.thickness) ??
          Math.max(0.018, Math.max(...layerSpecs.map((layer) => layer.thickness)) * 1.4),
      );
      const position = vec3FromArgs(
        args.position,
        addVec3(targetCenter, scaleVec3(normal, offset)),
        ["x", "y", "z"],
        args,
      );
      const rotation = vec3FromArgs(
        args.rotation,
        cutawayRotationForNormal(normal),
        ["rotationX", "rotationY", "rotationZ"],
        args,
      );

      const layerObjectIds: string[] = [];
      const layerAssetIds: string[] = [];
      const layerRenderObjectIds: string[] = [];
      const layerMaterialIds: string[] = [];
      const usedLayerKeys = new Set<string>();
      for (const layer of layerSpecs) {
        const layerKey = uniqueIdSegment(layer.key, layer.key, usedLayerKeys);
        if (layerKey !== layer.key) {
          return fail(`Duplicate screen stack layer key: ${layer.key}`, "INVALID_PARAMS");
        }
        const objectId = `${objectPrefix}-${layer.key}`;
        const assetId = `${assetPrefix}-${layer.key}`;
        const renderObjectId = `${renderPrefix}-${layer.key}`;
        const materialId = `${materialPrefix}-${layer.key}`;
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
        layerObjectIds.push(objectId);
        layerAssetIds.push(assetId);
        layerRenderObjectIds.push(renderObjectId);
        layerMaterialIds.push(materialId);
      }

      const now = Date.now();
      const basis = creationUiPanelBasis(normal);
      const renderObjects: MotionSceneObject3D[] = [];
      const sceneObjects: CreationSceneObject[] = [];
      const assets: CreationAssetRecipe[] = [];
      const objectIdsByLayerKey: Record<string, string> = {};
      const renderObjectIdsByLayerKey: Record<string, string> = {};
      const assetIdsByLayerKey: Record<string, string> = {};
      const materialIdsByLayerKey: Record<string, string> = {};
      const partIdsByLayerKey: Record<string, string> = {};

      for (let index = 0; index < layerSpecs.length; index += 1) {
        const layerSpec = layerSpecs[index];
        const layerKey = layerSpec.key;
        const localZ = layerSpec.localZ ?? -index * spacing;
        const layerPosition = uiPanelWorldPosition(
          position,
          basis,
          normal,
          0,
          0,
          localZ,
        );
        const layerPartId = `${partPrefix}-${layerKey}`;
        const rawObject: Record<string, unknown> = {
          kind: layerSpec.kind,
          name: layerSpec.name,
          assetId: layerAssetIds[index],
          assetName: layerSpec.name,
          assetKind: "product",
          materialId: layerMaterialIds[index],
          materialName: `${layerSpec.name} material`,
          materialModel: layerSpec.materialModel,
          materialKind: layerSpec.materialKind ?? "physical",
          x: layerPosition.x,
          y: layerPosition.y,
          z: layerPosition.z,
          rotationX: rotation.x,
          rotationY: rotation.y,
          rotationZ: rotation.z,
          scaleX: width * layerSpec.widthMultiplier,
          scaleY: height * layerSpec.heightMultiplier,
          scaleZ: layerSpec.kind === "plane" ? 1 : layerSpec.thickness,
          depth: layerSpec.thickness,
          cornerRadius: layerSpec.cornerRadius,
          color: layerSpec.color,
          baseColor: layerSpec.color,
          opacity: layerSpec.opacity,
          metalness: layerSpec.metalness,
          metallic: layerSpec.metalness,
          roughness: layerSpec.roughness,
          emissive: layerSpec.emissive,
          emissiveIntensity: layerSpec.emissiveIntensity,
          mapAssetId: layerSpec.mapAssetId,
        };
        const built = buildSceneObject3D(rawObject, layerRenderObjectIds[index]);
        if ("error" in built) return fail(built.error, "INVALID_PARAMS");
        const material = creationMaterialFromSceneObject(
          `${sceneKey}-${key}-${layerKey}`,
          rawObject,
          built.object,
        );
        const baseAsset = creationAssetFromSceneObject(
          `${sceneKey}-${key}-${layerKey}`,
          rawObject,
          built.object,
          material,
          now,
        );
        const sceneObject: CreationSceneObject = {
          id: layerObjectIds[index],
          name: built.object.name ?? layerSpec.name,
          assetId: baseAsset.id,
          materialId: material.id,
          partId: layerPartId,
          parentId,
          transform: requiredTransform3D(built.object),
          visible: args.visible !== false,
          selectable: args.selectable !== false,
          tags: [
            ...new Set([
              "agent-created",
              "product-part",
              "screen",
              "screen-stack",
              layerKey,
              layerSpec.semanticLayer,
              built.object.object.kind,
              ...layerSpec.tags,
              ...(parseStringArray(args.tags) ?? []),
            ]),
          ],
        };
        const productAsset = updateCreationAssetProductPart(
          baseAsset,
          sceneObject,
          {
            ...args,
            semanticLayer: layerSpec.semanticLayer,
            layer: layerSpec.semanticLayer,
            anchor: sceneObject.transform.position,
            nodeName: `${layerSpec.name} product part`,
          },
          { role: "screen", now },
        );
        const asset = updateCreationAssetScreenStackLayer(
          productAsset,
          sceneObject,
          args,
          {
            stackId,
            layer: layerSpec,
            layerIndex: index,
            layerCount: layerSpecs.length,
            layerObjectIds,
            layerAssetIds,
            layerRenderObjectIds,
            targetObjects,
            normal,
            width,
            height,
            spacing,
            localZ,
            now,
          },
        );
        renderObjects.push(built.object);
        sceneObjects.push(sceneObject);
        assets.push(asset);
        objectIdsByLayerKey[layerKey] = sceneObject.id;
        renderObjectIdsByLayerKey[layerKey] = layerRenderObjectIds[index];
        assetIdsByLayerKey[layerKey] = asset.id;
        materialIdsByLayerKey[layerKey] = material.id;
        partIdsByLayerKey[layerKey] = layerPartId;
      }

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
              renderObjectId: layerRenderObjectIds[index],
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
        label: `Create screen stack layer ${asset.name}`,
        asset,
      }));
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add screen stack to ${scene.name}`,
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
          ? `Added screen stack ${stackId} and synced ${renderObjects.length} layers`
          : `Added screen stack ${stackId}`,
        {
          sceneId: scene.id,
          stackId,
          objectIds: layerObjectIds,
          renderObjectIds: layerRenderObjectIds,
          assetIds: layerAssetIds,
          materialIds: layerMaterialIds,
          objectIdsByLayerKey,
          renderObjectIdsByLayerKey,
          assetIdsByLayerKey,
          materialIdsByLayerKey,
          partIdsByLayerKey,
          targetObjectIds: targetObjects.map((target) => target.id),
          targetPartIds: targetObjects.map((target) => target.partId).filter(Boolean),
          parentId,
          normal,
          offset,
          width,
          height,
          spacing,
          operationIds: [
            ...assetOperations.map((operation) => operation.id),
            sceneOperation.id,
          ],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          screenStack: assets[0]?.parameters.screenStack,
        },
      );
    },
  },
  {
    name: "add_creation_camera_module",
    domain: "motion",
    title: "Add creation camera module",
    description:
      "Add an editable semantic camera module assembly to an existing creation scene and sync every component into the bound scene3d layer. Use this for product intros that need a camera island, lens rings, lens glass, sensors, flash, and optional depth sensor as separate parts that can be exploded, labeled, restyled, animated, and recovered from semantic state.",
    inputSchema: obj({
      sceneId: str,
      key: str,
      moduleId: str,
      objectId: str,
      renderObjectId: str,
      assetId: str,
      materialId: str,
      parentId: str,
      parentKey: str,
      targetObjectId: str,
      targetPartId: str,
      targetPart: str,
      targetObjectIds: { type: "array" },
      objectIds: { type: "array" },
      targetPartIds: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      name: str,
      partId: str,
      partIdPrefix: str,
      partPrefix: str,
      width: num,
      height: num,
      depth: num,
      lensCount: num,
      lensDiameter: num,
      ringDiameter: num,
      lensDepth: num,
      offset: num,
      normal: { type: "object" },
      normalX: num,
      normalY: num,
      normalZ: num,
      axis: str,
      flip: bool,
      position: { type: "object" },
      x: num,
      y: num,
      z: num,
      rotation: { type: "object" },
      rotationX: num,
      rotationY: num,
      rotationZ: num,
      cornerRadius: num,
      color: str,
      baseColor: str,
      metalness: num,
      metallic: num,
      roughness: num,
      ringColor: str,
      ringMetalness: num,
      ringRoughness: num,
      lensColor: str,
      lensOpacity: num,
      lensRoughness: num,
      lensMetalness: num,
      lensEmissive: str,
      lensEmissiveIntensity: num,
      sensorColor: str,
      sensorRoughness: num,
      sensorEmissive: str,
      sensorEmissiveIntensity: num,
      flashColor: str,
      flashEmissive: str,
      flashEmissiveIntensity: num,
      depthSensorColor: str,
      depthSensorEmissive: str,
      depthSensorEmissiveIntensity: num,
      includeSensors: bool,
      includeFlash: bool,
      includeDepthSensor: bool,
      includeLidar: bool,
      exactness: str,
      bakeTarget: str,
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

      const sceneKey = idSegment(scene.id, "scene");
      const key = idSegment(
        args.key ?? args.moduleId ?? args.partId ?? args.name,
        `camera-module-${scene.objects.length + 1}`,
      );
      const moduleId = optionalString(args.moduleId) ?? `camera-module-${sceneKey}-${key}`;
      const objectPrefix = optionalString(args.objectId) ?? `object-${sceneKey}-${key}`;
      const renderPrefix = optionalString(args.renderObjectId) ?? `obj-${sceneKey}-${key}`;
      const assetPrefix = optionalString(args.assetId) ?? `asset-${sceneKey}-${key}`;
      const materialPrefix = optionalString(args.materialId) ?? `mat-${sceneKey}-${key}`;
      const partPrefix = idSegment(
        args.partIdPrefix ?? args.partPrefix ?? args.partId ?? key,
        key,
      );

      const targetObjects = creationDecalTargets(scene, args);
      const parent = resolveCreationParentId(
        scene,
        args.parentId ?? args.targetObjectId,
        args.parentKey ?? args.targetPartId ?? args.targetPart,
      );
      if (!parent.ok) return fail(parent.error, "INVALID_PARAMS");
      const parentId =
        parent.parentId ?? (targetObjects.length === 1 ? targetObjects[0]?.id : undefined);
      const normal = cutawayNormalFromArgs(args);
      const offset = optionalNumber(args.offset) ?? (targetObjects.length > 0 ? 0.09 : 0);
      const targetCenter =
        targetObjects.length > 0
          ? averageCreationObjectPosition(targetObjects)
          : { x: 0, y: 0, z: 0 };
      const targetScale = targetObjects[0]?.transform.scale;
      const width = Math.max(
        0.08,
        optionalNumber(args.width) ??
          (targetScale ? Math.max(targetScale.x, targetScale.z) * 0.36 : 0.44),
      );
      const height = Math.max(
        0.08,
        optionalNumber(args.height) ??
          (targetScale ? Math.max(targetScale.y, targetScale.z) * 0.32 : 0.34),
      );
      const depth = Math.max(0.01, optionalNumber(args.depth) ?? 0.07);
      const lensCount = Math.max(
        1,
        Math.min(4, Math.floor(optionalNumber(args.lensCount) ?? 3)),
      );
      const components = parseCreationCameraModuleComponents(args, {
        width,
        height,
        depth,
        lensCount,
      });
      if (components.length === 0) {
        return fail("Camera module requires at least one component", "INVALID_PARAMS");
      }

      const position = vec3FromArgs(
        args.position,
        addVec3(targetCenter, scaleVec3(normal, offset)),
        ["x", "y", "z"],
        args,
      );
      const baseRotation = vec3FromArgs(
        args.rotation,
        cutawayRotationForNormal(normal),
        ["rotationX", "rotationY", "rotationZ"],
        args,
      );
      const basis = creationUiPanelBasis(normal);
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
          return fail(`Duplicate camera module component key: ${component.key}`, "INVALID_PARAMS");
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
      const objectIdsByComponentKey: Record<string, string> = {};
      const renderObjectIdsByComponentKey: Record<string, string> = {};
      const assetIdsByComponentKey: Record<string, string> = {};
      const materialIdsByComponentKey: Record<string, string> = {};
      const partIdsByComponentKey: Record<string, string> = {};

      for (let index = 0; index < components.length; index += 1) {
        const component = components[index];
        const componentPosition = uiPanelWorldPosition(
          position,
          basis,
          normal,
          component.localX,
          component.localY,
          component.localZ,
        );
        const rotation = creationCameraModuleComponentRotation(
          normal,
          baseRotation,
          component.kind,
        );
        const componentPartId = `${partPrefix}-${component.key}`;
        const rawObject: Record<string, unknown> = {
          kind: component.kind,
          name: component.name,
          assetId: componentAssetIds[index],
          assetName: component.name,
          assetKind: "product",
          materialId: componentMaterialIds[index],
          materialName: `${component.name} material`,
          materialModel: component.materialModel,
          materialKind: component.materialKind ?? "physical",
          x: componentPosition.x,
          y: componentPosition.y,
          z: componentPosition.z,
          rotationX: rotation.x,
          rotationY: rotation.y,
          rotationZ: rotation.z,
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
              "product-part",
              "camera-module",
              component.key,
              component.semanticLayer,
              built.object.object.kind,
              ...component.tags,
              ...(parseStringArray(args.tags) ?? []),
            ]),
          ],
        };
        const productAsset = updateCreationAssetProductPart(
          baseAsset,
          sceneObject,
          {
            ...args,
            semanticLayer: component.semanticLayer,
            layer: component.semanticLayer,
            anchor: sceneObject.transform.position,
            nodeName: `${component.name} product part`,
          },
          { role: component.role, now },
        );
        const asset = updateCreationAssetCameraModuleComponent(
          productAsset,
          sceneObject,
          args,
          {
            moduleId,
            component,
            componentIndex: index,
            componentCount: components.length,
            componentObjectIds,
            componentAssetIds,
            componentRenderObjectIds,
            targetObjects,
            normal,
            width,
            height,
            depth,
            lensCount,
            now,
          },
        );
        renderObjects.push(built.object);
        sceneObjects.push(sceneObject);
        assets.push(asset);
        objectIdsByComponentKey[component.key] = sceneObject.id;
        renderObjectIdsByComponentKey[component.key] = componentRenderObjectIds[index];
        assetIdsByComponentKey[component.key] = asset.id;
        materialIdsByComponentKey[component.key] = material.id;
        partIdsByComponentKey[component.key] = componentPartId;
      }

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
        label: `Create camera module component ${asset.name}`,
        asset,
      }));
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add camera module to ${scene.name}`,
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
          ? `Added camera module ${moduleId} and synced ${renderObjects.length} components`
          : `Added camera module ${moduleId}`,
        {
          sceneId: scene.id,
          moduleId,
          objectIds: componentObjectIds,
          renderObjectIds: componentRenderObjectIds,
          assetIds: componentAssetIds,
          materialIds: componentMaterialIds,
          objectIdsByComponentKey,
          renderObjectIdsByComponentKey,
          assetIdsByComponentKey,
          materialIdsByComponentKey,
          partIdsByComponentKey,
          targetObjectIds: targetObjects.map((target) => target.id),
          targetPartIds: targetObjects.map((target) => target.partId).filter(Boolean),
          parentId,
          normal,
          offset,
          width,
          height,
          depth,
          lensCount,
          operationIds: [
            ...assetOperations.map((operation) => operation.id),
            sceneOperation.id,
          ],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          cameraModule: assets[0]?.parameters.cameraModule,
        },
      );
    },
  },
  {
    name: "add_creation_product_internals",
    domain: "motion",
    title: "Add creation product internals",
    description:
      "Add an editable semantic internal product layout to an existing creation scene and sync every component into the bound scene3d layer. Use this for product reveals that need a logic board, battery, chips, connectors, screws, and thermal layer as separate parts that can be exploded, labeled, restyled, animated, and recovered from semantic state.",
    inputSchema: obj({
      sceneId: str,
      key: str,
      layoutId: str,
      objectId: str,
      renderObjectId: str,
      assetId: str,
      materialId: str,
      parentId: str,
      parentKey: str,
      targetObjectId: str,
      targetPartId: str,
      targetPart: str,
      targetObjectIds: { type: "array" },
      objectIds: { type: "array" },
      targetPartIds: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      name: str,
      partId: str,
      partIdPrefix: str,
      partPrefix: str,
      width: num,
      height: num,
      depth: num,
      offset: num,
      normal: { type: "object" },
      normalX: num,
      normalY: num,
      normalZ: num,
      axis: str,
      flip: bool,
      position: { type: "object" },
      x: num,
      y: num,
      z: num,
      rotation: { type: "object" },
      rotationX: num,
      rotationY: num,
      rotationZ: num,
      includeThermal: bool,
      includeBoard: bool,
      includeBattery: bool,
      includeChips: bool,
      includeConnectors: bool,
      includeScrews: bool,
      chipCount: num,
      connectorCount: num,
      screwCount: num,
      boardWidth: num,
      boardHeight: num,
      boardThickness: num,
      boardX: num,
      boardY: num,
      batteryWidth: num,
      batteryHeight: num,
      batteryThickness: num,
      batteryX: num,
      batteryY: num,
      chipWidth: num,
      chipHeight: num,
      chipThickness: num,
      connectorWidth: num,
      connectorHeight: num,
      connectorThickness: num,
      screwDiameter: num,
      screwDepth: num,
      boardColor: str,
      batteryColor: str,
      chipColor: str,
      chipEmissive: str,
      chipEmissiveIntensity: num,
      connectorColor: str,
      screwColor: str,
      thermalColor: str,
      exactness: str,
      bakeTarget: str,
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

      const sceneKey = idSegment(scene.id, "scene");
      const key = idSegment(
        args.key ?? args.layoutId ?? args.partId ?? args.name,
        `product-internals-${scene.objects.length + 1}`,
      );
      const layoutId = optionalString(args.layoutId) ?? `product-internals-${sceneKey}-${key}`;
      const objectPrefix = optionalString(args.objectId) ?? `object-${sceneKey}-${key}`;
      const renderPrefix = optionalString(args.renderObjectId) ?? `obj-${sceneKey}-${key}`;
      const assetPrefix = optionalString(args.assetId) ?? `asset-${sceneKey}-${key}`;
      const materialPrefix = optionalString(args.materialId) ?? `mat-${sceneKey}-${key}`;
      const partPrefix = idSegment(
        args.partIdPrefix ?? args.partPrefix ?? args.partId ?? key,
        key,
      );

      const targetObjects = creationDecalTargets(scene, args);
      const parent = resolveCreationParentId(
        scene,
        args.parentId ?? args.targetObjectId,
        args.parentKey ?? args.targetPartId ?? args.targetPart,
      );
      if (!parent.ok) return fail(parent.error, "INVALID_PARAMS");
      const parentId =
        parent.parentId ?? (targetObjects.length === 1 ? targetObjects[0]?.id : undefined);
      const normal = cutawayNormalFromArgs(args);
      const offset = optionalNumber(args.offset) ?? (targetObjects.length > 0 ? 0.08 : 0);
      const targetCenter =
        targetObjects.length > 0
          ? averageCreationObjectPosition(targetObjects)
          : { x: 0, y: 0, z: 0 };
      const targetScale = targetObjects[0]?.transform.scale;
      const width = Math.max(
        0.08,
        optionalNumber(args.width) ??
          (targetScale ? Math.max(targetScale.x, targetScale.z) * 0.82 : 0.9),
      );
      const height = Math.max(
        0.08,
        optionalNumber(args.height) ??
          (targetScale ? Math.max(targetScale.y, targetScale.z) * 0.78 : 0.55),
      );
      const depth = Math.max(0.01, optionalNumber(args.depth) ?? 0.08);
      const components = parseCreationProductInternalsComponents(args, {
        width,
        height,
        depth,
      });
      if (components.length === 0) {
        return fail("Product internals requires at least one component", "INVALID_PARAMS");
      }

      const position = vec3FromArgs(
        args.position,
        addVec3(targetCenter, scaleVec3(normal, offset)),
        ["x", "y", "z"],
        args,
      );
      const baseRotation = vec3FromArgs(
        args.rotation,
        cutawayRotationForNormal(normal),
        ["rotationX", "rotationY", "rotationZ"],
        args,
      );
      const basis = creationUiPanelBasis(normal);
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
          return fail(`Duplicate product internals component key: ${component.key}`, "INVALID_PARAMS");
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
      const objectIdsByComponentKey: Record<string, string> = {};
      const renderObjectIdsByComponentKey: Record<string, string> = {};
      const assetIdsByComponentKey: Record<string, string> = {};
      const materialIdsByComponentKey: Record<string, string> = {};
      const partIdsByComponentKey: Record<string, string> = {};

      for (let index = 0; index < components.length; index += 1) {
        const component = components[index];
        const componentPosition = uiPanelWorldPosition(
          position,
          basis,
          normal,
          component.localX,
          component.localY,
          component.localZ,
        );
        const rotation = creationCameraModuleComponentRotation(
          normal,
          baseRotation,
          component.kind,
        );
        const componentPartId = `${partPrefix}-${component.key}`;
        const rawObject: Record<string, unknown> = {
          kind: component.kind,
          name: component.name,
          assetId: componentAssetIds[index],
          assetName: component.name,
          assetKind: "product",
          materialId: componentMaterialIds[index],
          materialName: `${component.name} material`,
          materialModel: component.materialModel,
          materialKind: component.materialKind ?? "physical",
          x: componentPosition.x,
          y: componentPosition.y,
          z: componentPosition.z,
          rotationX: rotation.x,
          rotationY: rotation.y,
          rotationZ: rotation.z,
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
              "product-part",
              "product-internals",
              component.key,
              component.semanticLayer,
              built.object.object.kind,
              ...component.tags,
              ...(parseStringArray(args.tags) ?? []),
            ]),
          ],
        };
        const productAsset = updateCreationAssetProductPart(
          baseAsset,
          sceneObject,
          {
            ...args,
            semanticLayer: component.semanticLayer,
            layer: component.semanticLayer,
            anchor: sceneObject.transform.position,
            nodeName: `${component.name} product part`,
          },
          { role: component.role, now },
        );
        const asset = updateCreationAssetProductInternalsComponent(
          productAsset,
          sceneObject,
          args,
          {
            layoutId,
            component,
            componentIndex: index,
            componentCount: components.length,
            componentObjectIds,
            componentAssetIds,
            componentRenderObjectIds,
            targetObjects,
            normal,
            width,
            height,
            depth,
            now,
          },
        );
        renderObjects.push(built.object);
        sceneObjects.push(sceneObject);
        assets.push(asset);
        objectIdsByComponentKey[component.key] = sceneObject.id;
        renderObjectIdsByComponentKey[component.key] = componentRenderObjectIds[index];
        assetIdsByComponentKey[component.key] = asset.id;
        materialIdsByComponentKey[component.key] = material.id;
        partIdsByComponentKey[component.key] = componentPartId;
      }

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
        label: `Create product internals component ${asset.name}`,
        asset,
      }));
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add product internals to ${scene.name}`,
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
          ? `Added product internals ${layoutId} and synced ${renderObjects.length} components`
          : `Added product internals ${layoutId}`,
        {
          sceneId: scene.id,
          layoutId,
          objectIds: componentObjectIds,
          renderObjectIds: componentRenderObjectIds,
          assetIds: componentAssetIds,
          materialIds: componentMaterialIds,
          objectIdsByComponentKey,
          renderObjectIdsByComponentKey,
          assetIdsByComponentKey,
          materialIdsByComponentKey,
          partIdsByComponentKey,
          targetObjectIds: targetObjects.map((target) => target.id),
          targetPartIds: targetObjects.map((target) => target.partId).filter(Boolean),
          parentId,
          normal,
          offset,
          width,
          height,
          depth,
          operationIds: [
            ...assetOperations.map((operation) => operation.id),
            sceneOperation.id,
          ],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          productInternals: assets[0]?.parameters.productInternals,
        },
      );
    },
  },
  {
    name: "add_creation_light_sweep",
    domain: "motion",
    title: "Add creation light sweep",
    description:
      "Add an editable animated highlight/light sweep to an existing creation scene and sync it into the bound scene3d layer. Use this for premium product intros, metal/glass glints, reveal passes, and final hero polish. The current preview is an emissive plane with semantic light-sweep recipe metadata and persisted position/opacity tracks.",
    inputSchema: obj({
      sceneId: str,
      key: str,
      objectId: str,
      renderObjectId: str,
      assetId: str,
      materialId: str,
      parentId: str,
      parentKey: str,
      targetObjectId: str,
      targetPartId: str,
      targetPart: str,
      targetObjectIds: { type: "array" },
      objectIds: { type: "array" },
      targetPartIds: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      name: str,
      partId: str,
      clipId: str,
      clipName: str,
      width: num,
      sweepWidth: num,
      height: num,
      sweepHeight: num,
      travel: num,
      travelDistance: num,
      offset: num,
      opacity: num,
      maxOpacity: num,
      color: str,
      tint: str,
      emissive: str,
      emissiveIntensity: num,
      roughness: num,
      direction: str,
      sweepDirection: str,
      normal: { type: "object" },
      normalX: num,
      normalY: num,
      normalZ: num,
      axis: str,
      flip: bool,
      position: { type: "object" },
      x: num,
      y: num,
      z: num,
      rotation: { type: "object" },
      rotationX: num,
      rotationY: num,
      rotationZ: num,
      startTime: num,
      duration: num,
      fadeDuration: num,
      easing: str,
      blend: str,
      bakeTarget: str,
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

      const sceneKey = idSegment(scene.id, "scene");
      const key = idSegment(
        args.key ?? args.objectId ?? args.partId ?? args.name,
        `light-sweep-${scene.objects.length + 1}`,
      );
      const objectId = optionalString(args.objectId) ?? `object-${sceneKey}-${key}`;
      if (scene.objects.some((object) => object.id === objectId)) {
        return fail(`Creation object already exists: ${objectId}`, "INVALID_PARAMS");
      }
      const assetId = optionalString(args.assetId) ?? `asset-${sceneKey}-${key}`;
      if (state.assets.some((asset) => asset.id === assetId)) {
        return fail(`Creation asset already exists: ${assetId}`, "INVALID_PARAMS");
      }
      const binding =
        scene.renderBindings.find((candidate) => candidate.kind === "motion-scene3d");
      const existingRenderIds = new Set(
        scene.renderBindings.flatMap((candidate) =>
          candidate.objectBindings.map((objectBinding) => objectBinding.renderObjectId),
        ),
      );
      const renderObjectId = optionalString(args.renderObjectId) ?? `obj-${sceneKey}-${key}`;
      if (existingRenderIds.has(renderObjectId)) {
        return fail(`Render object already exists: ${renderObjectId}`, "INVALID_PARAMS");
      }

      const parent = resolveCreationParentId(
        scene,
        args.parentId ?? args.targetObjectId,
        args.parentKey ?? args.targetPartId ?? args.targetPart,
      );
      if (!parent.ok) return fail(parent.error, "INVALID_PARAMS");
      const targetObjects = creationDecalTargets(scene, args);
      const parentId =
        parent.parentId ?? (targetObjects.length === 1 ? targetObjects[0]?.id : undefined);
      const normal = cutawayNormalFromArgs(args);
      const basis = creationUiPanelBasis(normal);
      const targetCenter =
        targetObjects.length > 0
          ? averageCreationObjectPosition(targetObjects)
          : { x: 0, y: 0, z: 0 };
      const targetScale = targetObjects[0]?.transform.scale;
      const fallbackHeight = targetScale
        ? Math.max(0.1, Math.max(targetScale.y, targetScale.z) * 1.18)
        : 0.8;
      const fallbackTravel = targetScale
        ? Math.max(0.2, Math.max(targetScale.x, targetScale.z) * 1.35)
        : 1.2;
      const sweepWidth = Math.max(
        0.005,
        optionalNumber(args.sweepWidth) ?? optionalNumber(args.width) ?? 0.12,
      );
      const sweepHeight = Math.max(
        0.01,
        optionalNumber(args.sweepHeight) ?? optionalNumber(args.height) ?? fallbackHeight,
      );
      const travelDistance = Math.max(
        0.01,
        optionalNumber(args.travelDistance) ?? optionalNumber(args.travel) ?? fallbackTravel,
      );
      const offset = optionalNumber(args.offset) ?? (targetObjects.length > 0 ? 0.08 : 0);
      const centerPosition = vec3FromArgs(
        args.position,
        addVec3(targetCenter, scaleVec3(normal, offset)),
        ["x", "y", "z"],
        args,
      );
      const direction = lightSweepDirection(args, basis);
      const startPosition = addVec3(centerPosition, scaleVec3(direction, -travelDistance / 2));
      const endPosition = addVec3(centerPosition, scaleVec3(direction, travelDistance / 2));
      const rotation = vec3FromArgs(
        args.rotation,
        cutawayRotationForNormal(normal),
        ["rotationX", "rotationY", "rotationZ"],
        args,
      );
      const maxOpacity = clampNumber(
        optionalNumber(args.maxOpacity) ?? optionalNumber(args.opacity) ?? 0.48,
        0.02,
        1,
      );
      const color =
        optionalString(args.color) ??
        optionalString(args.tint) ??
        optionalString(args.emissive) ??
        "#ffffff";
      const rawObject: Record<string, unknown> = {
        kind: "plane",
        name: optionalString(args.name) ?? "Light sweep",
        assetId,
        assetName: optionalString(args.name) ?? "Light sweep",
        assetKind: "prop",
        materialId: optionalString(args.materialId) ?? `mat-${sceneKey}-${key}`,
        materialName: optionalString(args.name)
          ? `${optionalString(args.name)} material`
          : "Light sweep material",
        materialModel: "emissive",
        materialKind: "basic",
        x: startPosition.x,
        y: startPosition.y,
        z: startPosition.z,
        rotationX: rotation.x,
        rotationY: rotation.y,
        rotationZ: rotation.z,
        scaleX: sweepWidth,
        scaleY: sweepHeight,
        scaleZ: 1,
        color,
        baseColor: color,
        opacity: 0,
        roughness: optionalNumber(args.roughness) ?? 0.06,
        emissive: optionalString(args.emissive) ?? color,
        emissiveIntensity: optionalNumber(args.emissiveIntensity) ?? 1.4,
      };
      const built = buildSceneObject3D(rawObject, renderObjectId);
      if ("error" in built) return fail(built.error, "INVALID_PARAMS");

      const now = Date.now();
      const material = creationMaterialFromSceneObject(
        `${sceneKey}-${key}`,
        rawObject,
        built.object,
      );
      const baseAsset = creationAssetFromSceneObject(
        `${sceneKey}-${key}`,
        rawObject,
        built.object,
        material,
        now,
      );
      const object: CreationSceneObject = {
        id: objectId,
        name: built.object.name ?? "Light sweep",
        assetId: baseAsset.id,
        materialId: material.id,
        partId: optionalString(args.partId) ?? key,
        parentId,
        transform: requiredTransform3D(built.object),
        visible: args.visible !== false,
        selectable: args.selectable !== false,
        tags: [
          ...new Set([
            "agent-created",
            "light-sweep",
            "highlight-sweep",
            "cinematic-polish",
            "plane",
            ...(parseStringArray(args.tags) ?? []),
          ]),
        ],
      };
      const clipId = optionalString(args.clipId) ?? `anim-${object.id}-light-sweep`;
      const builtTracks = buildCreationLightSweepTracks(args, object, clipId, {
        startPosition,
        endPosition,
        maxOpacity,
      });
      const clip: CreationAnimationClip = {
        id: clipId,
        name: optionalString(args.clipName) ?? optionalString(args.name) ?? "Light sweep",
        duration: Math.max(
          scene.duration,
          optionalNumber(args.duration) ?? 0,
          builtTracks.endTime,
        ),
        tracks: builtTracks.tracks,
      };
      const asset = updateCreationAssetLightSweep(baseAsset, args, {
        clipId,
        targetObjects,
        normal,
        startPosition,
        endPosition,
        width: sweepWidth,
        height: sweepHeight,
        travelDistance,
        maxOpacity,
        startTime: builtTracks.startTime,
        endTime: builtTracks.endTime,
        fadeDuration: builtTracks.fadeDuration,
        now,
      });

      let nextComposition: MotionComposition | undefined;
      let nextRenderBinding: CreationRenderBinding | undefined;
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
        const keyframes = motionKeyframesForCreationObjectTracks(
          renderObjectId,
          builtTracks.tracks,
          genId,
        );
        const nextLayer: MotionScene3DLayer = {
          ...layer,
          objects: [...(layer.objects ?? []), built.object],
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
            { sceneObjectId: object.id, renderObjectId },
          ],
          modifiedAt: now,
        };
      }

      const nextScene: CreationScene = {
        ...scene,
        objects: [...scene.objects, object],
        animations: [
          ...scene.animations.filter((candidate) => candidate.id !== clip.id),
          clip,
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
        label: `Create light sweep ${object.name}`,
        asset,
      };
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add light sweep to ${scene.name}`,
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
          ? `Added light sweep ${object.id} and synced ${renderObjectId}`
          : `Added light sweep ${object.id}`,
        {
          sceneId: scene.id,
          objectId: object.id,
          partId: object.partId,
          renderObjectId,
          assetId: asset.id,
          materialId: material.id,
          clipId: clip.id,
          trackIds: clip.tracks.map((track) => track.id),
          targetObjectIds: targetObjects.map((target) => target.id),
          targetPartIds: targetObjects.map((target) => target.partId).filter(Boolean),
          parentId,
          normal,
          startPosition,
          endPosition,
          width: sweepWidth,
          height: sweepHeight,
          travelDistance,
          maxOpacity,
          operationIds: [assetOperation.id, sceneOperation.id],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          lightSweep: asset.parameters.lightSweep,
        },
      );
    },
  }
];
