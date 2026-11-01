import {
  RegisteredTool,
  addVec3,
  applyMotionAction,
  averageCreationObjectPosition,
  bool,
  buildSceneObject3D,
  clampNumber,
  commitMotionComposition,
  creationAssetFromSceneObject,
  creationCutawayTargets,
  creationDecalTargets,
  creationMaterialFromSceneObject,
  creationState,
  creationUiPanelBasis,
  cutawayNormalFromArgs,
  cutawayRotationForNormal,
  fail,
  genId,
  getMotionComposition,
  idSegment,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  parseCreationUiPanelRows,
  parseStringArray,
  requiredTransform3D,
  resolveCreationScene,
  scaleVec3,
  str,
  uiPanelWorldPosition,
  updateCreationAssetCutawayPlane,
  updateCreationAssetDecal,
  updateCreationAssetUiPanel,
  updateCreationAssetUiPanelText,
  vec3FromArgs,
} from "./shared";
import {
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

export const creationGeometryTools: RegisteredTool[] = [
  {
    name: "add_creation_cutaway_plane",
    domain: "motion",
    title: "Add creation cutaway plane",
    description:
      "Add an editable semantic cutaway plane to a creation/product scene and sync it as a translucent scene3d plane marker. The asset recipe stores normal/offset/target part metadata for future native clipping/boolean rendering while current previews show the cut plane visually.",
    inputSchema: obj({
      sceneId: str,
      key: str,
      objectId: str,
      renderObjectId: str,
      assetId: str,
      materialId: str,
      partId: str,
      name: str,
      targetObjectIds: { type: "array" },
      objectIds: { type: "array" },
      targetPartIds: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      axis: str,
      planeAxis: str,
      normal: { type: "object" },
      normalX: num,
      normalY: num,
      normalZ: num,
      flip: bool,
      invert: bool,
      offset: num,
      position: { type: "object" },
      x: num,
      y: num,
      z: num,
      rotation: { type: "object" },
      rotationX: num,
      rotationY: num,
      rotationZ: num,
      size: num,
      scaleX: num,
      scaleY: num,
      scaleZ: num,
      tint: str,
      color: str,
      baseColor: str,
      opacity: num,
      emissive: str,
      emissiveIntensity: num,
      roughness: num,
      materialModel: str,
      materialKind: str,
      mode: str,
      previewOnly: bool,
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

      const targetObjects = creationCutawayTargets(scene, args);
      if (targetObjects.length === 0) {
        return fail("No target creation objects found for cutaway plane", "INVALID_PARAMS");
      }

      const sceneKey = idSegment(scene.id, "scene");
      const key = idSegment(
        args.key ?? args.objectId ?? args.name,
        `cutaway-${scene.objects.length + 1}`,
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

      const normal = cutawayNormalFromArgs(args);
      const offset = optionalNumber(args.offset) ?? 0;
      const position = vec3FromArgs(
        args.position,
        scaleVec3(normal, offset),
        ["x", "y", "z"],
        args,
      );
      const rotation = vec3FromArgs(
        args.rotation,
        cutawayRotationForNormal(normal),
        ["rotationX", "rotationY", "rotationZ"],
        args,
      );
      const size = Math.max(0.05, optionalNumber(args.size) ?? 1.6);
      const tint =
        optionalString(args.tint) ??
        optionalString(args.color) ??
        optionalString(args.baseColor) ??
        "#38bdf8";
      const rawObject: Record<string, unknown> = {
        kind: "plane",
        name: optionalString(args.name) ?? "Cutaway plane",
        assetId,
        assetName: optionalString(args.name) ?? "Cutaway plane",
        assetKind: "prop",
        materialId: optionalString(args.materialId) ?? `mat-${sceneKey}-${key}`,
        materialName: optionalString(args.name)
          ? `${optionalString(args.name)} material`
          : "Cutaway plane material",
        materialModel: optionalString(args.materialModel) ?? "glass",
        materialKind: optionalString(args.materialKind) ?? "basic",
        x: position.x,
        y: position.y,
        z: position.z,
        rotationX: rotation.x,
        rotationY: rotation.y,
        rotationZ: rotation.z,
        scaleX: optionalNumber(args.scaleX) ?? size,
        scaleY: optionalNumber(args.scaleY) ?? size,
        scaleZ: optionalNumber(args.scaleZ) ?? 1,
        color: tint,
        baseColor: tint,
        roughness: optionalNumber(args.roughness) ?? 0.18,
        emissive: optionalString(args.emissive) ?? tint,
        emissiveIntensity: optionalNumber(args.emissiveIntensity) ?? 0.28,
        opacity: clampNumber(optionalNumber(args.opacity) ?? 0.28, 0.02, 1),
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
      const asset = updateCreationAssetCutawayPlane(baseAsset, args, {
        normal,
        offset,
        targetObjects,
        now,
      });
      const object: CreationSceneObject = {
        id: objectId,
        name: built.object.name ?? key,
        assetId: asset.id,
        materialId: material.id,
        partId: optionalString(args.partId) ?? key,
        transform: requiredTransform3D(built.object),
        visible: args.visible !== false,
        selectable: args.selectable !== false,
        tags: [
          ...new Set([
            "agent-created",
            "cutaway",
            "cutaway-plane",
            "plane",
            ...(parseStringArray(args.tags) ?? []),
          ]),
        ],
      };

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
        label: `Create cutaway plane ${object.name}`,
        asset,
      };
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add cutaway plane to ${scene.name}`,
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
          ? `Added cutaway plane ${object.id} and synced ${renderObjectId}`
          : `Added cutaway plane ${object.id}`,
        {
          sceneId: scene.id,
          objectId: object.id,
          partId: object.partId,
          renderObjectId,
          assetId: asset.id,
          materialId: material.id,
          targetObjectIds: targetObjects.map((target) => target.id),
          targetPartIds: targetObjects.map((target) => target.partId).filter(Boolean),
          normal,
          offset,
          operationIds: [assetOperation.id, sceneOperation.id],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          cutawayPlane: asset.parameters.cutawayPlane,
        },
      );
    },
  },
  {
    name: "add_creation_decal",
    domain: "motion",
    title: "Add creation decal",
    description:
      "Add an editable semantic decal/logo/marking to a creation scene surface and sync it as a scene3d plane or text3d object. Stores decal projection metadata on the asset recipe for future native texture baking while current previews show the decal as an editable render object.",
    inputSchema: obj({
      sceneId: str,
      key: str,
      objectId: str,
      renderObjectId: str,
      assetId: str,
      materialId: str,
      partId: str,
      name: str,
      targetObjectId: str,
      targetPartId: str,
      targetPart: str,
      targetObjectIds: { type: "array" },
      objectIds: { type: "array" },
      targetPartIds: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      kind: str,
      text: str,
      label: str,
      mapAssetId: str,
      projection: str,
      wrap: str,
      bakeTarget: str,
      normal: { type: "object" },
      normalX: num,
      normalY: num,
      normalZ: num,
      axis: str,
      flip: bool,
      offset: num,
      position: { type: "object" },
      x: num,
      y: num,
      z: num,
      rotation: { type: "object" },
      rotationX: num,
      rotationY: num,
      rotationZ: num,
      size: num,
      width: num,
      height: num,
      scaleX: num,
      scaleY: num,
      scaleZ: num,
      extrude: num,
      tint: str,
      color: str,
      baseColor: str,
      opacity: num,
      emissive: str,
      emissiveIntensity: num,
      roughness: num,
      materialModel: str,
      materialKind: str,
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

      const targetObjects = creationDecalTargets(scene, args);
      if (targetObjects.length === 0) {
        return fail(
          "Provide targetObjectId, targetPartId, targetObjectIds, targetPartIds, or tags for the decal surface",
          "INVALID_PARAMS",
        );
      }

      const sceneKey = idSegment(scene.id, "scene");
      const key = idSegment(
        args.key ?? args.objectId ?? args.name ?? args.text ?? args.label,
        `decal-${scene.objects.length + 1}`,
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

      const text = optionalString(args.text) ?? optionalString(args.label);
      const explicitKind = optionalString(args.kind);
      const kind =
        explicitKind === "plane" || explicitKind === "text3d"
          ? explicitKind
          : text
            ? "text3d"
            : "plane";
      if (kind === "text3d" && !text) {
        return fail("text or label is required for text3d decals", "INVALID_PARAMS");
      }
      const mapAssetId = optionalString(args.mapAssetId);
      const normal = cutawayNormalFromArgs(args);
      const offset = optionalNumber(args.offset) ?? 0.035;
      const targetCenter = averageCreationObjectPosition(targetObjects);
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
      const width = Math.max(0.01, optionalNumber(args.width) ?? optionalNumber(args.scaleX) ?? 0.45);
      const height = Math.max(0.01, optionalNumber(args.height) ?? optionalNumber(args.scaleY) ?? 0.16);
      const tint =
        optionalString(args.tint) ??
        optionalString(args.color) ??
        optionalString(args.baseColor) ??
        "#f8fafc";
      const rawObject: Record<string, unknown> = {
        kind,
        name: optionalString(args.name) ?? text ?? "Surface decal",
        assetId,
        assetName: optionalString(args.name) ?? text ?? "Surface decal",
        assetKind: "ui",
        materialId: optionalString(args.materialId) ?? `mat-${sceneKey}-${key}`,
        materialName: optionalString(args.name)
          ? `${optionalString(args.name)} material`
          : "Decal material",
        materialModel: optionalString(args.materialModel) ?? "emissive",
        materialKind: optionalString(args.materialKind) ?? "basic",
        x: position.x,
        y: position.y,
        z: position.z,
        rotationX: rotation.x,
        rotationY: rotation.y,
        rotationZ: rotation.z,
        scaleX: width,
        scaleY: height,
        scaleZ: optionalNumber(args.scaleZ) ?? 1,
        size: optionalNumber(args.size) ?? (kind === "text3d" ? 0.22 : undefined),
        text,
        extrude: kind === "text3d" ? optionalNumber(args.extrude) ?? 0.015 : undefined,
        mapAssetId,
        color: tint,
        baseColor: tint,
        roughness: optionalNumber(args.roughness) ?? 0.22,
        emissive: optionalString(args.emissive) ?? tint,
        emissiveIntensity: optionalNumber(args.emissiveIntensity) ?? 0.65,
        opacity: clampNumber(optionalNumber(args.opacity) ?? 1, 0.02, 1),
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
      const asset = updateCreationAssetDecal(baseAsset, args, {
        targetObjects,
        normal,
        offset,
        now,
      });
      const object: CreationSceneObject = {
        id: objectId,
        name: built.object.name ?? key,
        assetId: asset.id,
        materialId: material.id,
        partId: optionalString(args.partId) ?? key,
        transform: requiredTransform3D(built.object),
        parentId: targetObjects.length === 1 ? targetObjects[0]?.id : undefined,
        visible: args.visible !== false,
        selectable: args.selectable !== false,
        tags: [
          ...new Set([
            "agent-created",
            "decal",
            "surface-decal",
            kind,
            ...(parseStringArray(args.tags) ?? []),
          ]),
        ],
      };

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
        label: `Create decal ${object.name}`,
        asset,
      };
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add decal to ${scene.name}`,
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
          ? `Added decal ${object.id} and synced ${renderObjectId}`
          : `Added decal ${object.id}`,
        {
          sceneId: scene.id,
          objectId: object.id,
          partId: object.partId,
          renderObjectId,
          assetId: asset.id,
          materialId: material.id,
          targetObjectIds: targetObjects.map((target) => target.id),
          targetPartIds: targetObjects.map((target) => target.partId).filter(Boolean),
          normal,
          offset,
          operationIds: [assetOperation.id, sceneOperation.id],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          decal: asset.parameters.decal,
        },
      );
    },
  },
  {
    name: "add_creation_ui_panel",
    domain: "motion",
    title: "Add creation UI panel",
    description:
      "Add an editable 3D UI/screen/holographic panel to a creation scene and sync it as a scene3d plane with editable text3d child rows. Use it for device screens, spatial dashboards, product HUDs, and agent-authored interfaces that must remain semantic rather than baked video.",
    inputSchema: obj({
      sceneId: str,
      key: str,
      objectId: str,
      renderObjectId: str,
      assetId: str,
      materialId: str,
      partId: str,
      name: str,
      targetObjectId: str,
      targetPartId: str,
      targetPart: str,
      targetObjectIds: { type: "array" },
      objectIds: { type: "array" },
      targetPartIds: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      rows: { type: "array" },
      items: { type: "array" },
      texts: { type: "array" },
      panelTexts: { type: "array" },
      title: str,
      subtitle: str,
      text: str,
      label: str,
      style: str,
      layout: str,
      interaction: str,
      mapAssetId: str,
      normal: { type: "object" },
      normalX: num,
      normalY: num,
      normalZ: num,
      axis: str,
      flip: bool,
      offset: num,
      position: { type: "object" },
      x: num,
      y: num,
      z: num,
      rotation: { type: "object" },
      rotationX: num,
      rotationY: num,
      rotationZ: num,
      width: num,
      height: num,
      scaleX: num,
      scaleY: num,
      scaleZ: num,
      cornerRadius: num,
      tint: str,
      color: str,
      backgroundColor: str,
      textColor: str,
      titleColor: str,
      subtitleColor: str,
      mutedTextColor: str,
      opacity: num,
      textOpacity: num,
      emissive: str,
      emissiveIntensity: num,
      titleEmissiveIntensity: num,
      textEmissiveIntensity: num,
      roughness: num,
      materialModel: str,
      materialKind: str,
      fontSize: num,
      lineGap: num,
      extrude: num,
      nodeName: str,
      bakeTarget: str,
      editable: bool,
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
        args.key ?? args.objectId ?? args.name ?? args.title ?? args.label,
        `ui-panel-${scene.objects.length + 1}`,
      );
      const existingObjectIds = new Set(scene.objects.map((object) => object.id));
      const existingAssetIds = new Set(state.assets.map((asset) => asset.id));
      const objectId = optionalString(args.objectId) ?? `object-${sceneKey}-${key}`;
      if (existingObjectIds.has(objectId)) {
        return fail(`Creation object already exists: ${objectId}`, "INVALID_PARAMS");
      }
      const assetId = optionalString(args.assetId) ?? `asset-${sceneKey}-${key}`;
      if (existingAssetIds.has(assetId)) {
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
      existingObjectIds.add(objectId);
      existingAssetIds.add(assetId);
      existingRenderIds.add(renderObjectId);

      const targetObjects = creationDecalTargets(scene, args);
      const normal = cutawayNormalFromArgs(args);
      const offset = optionalNumber(args.offset) ?? (targetObjects.length > 0 ? 0.055 : 0);
      const targetCenter =
        targetObjects.length > 0
          ? averageCreationObjectPosition(targetObjects)
          : { x: 0, y: 0, z: 0 };
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
      const width = Math.max(0.05, optionalNumber(args.width) ?? optionalNumber(args.scaleX) ?? 1);
      const height = Math.max(0.05, optionalNumber(args.height) ?? optionalNumber(args.scaleY) ?? 0.58);
      const style = optionalString(args.style) ?? "screen";
      const backgroundColor =
        optionalString(args.backgroundColor) ??
        optionalString(args.tint) ??
        optionalString(args.color) ??
        (style === "hologram" ? "#082f49" : "#020617");
      const textColor = optionalString(args.textColor) ?? "#e0f2fe";
      const fontSize = Math.max(0.025, optionalNumber(args.fontSize) ?? Math.min(0.14, height * 0.18));
      const lineGap = Math.max(0.005, optionalNumber(args.lineGap) ?? fontSize * 0.42);
      const rows = parseCreationUiPanelRows(args, {
        width,
        height,
        fontSize,
        lineGap,
        textColor,
      });
      const rowObjectIds: string[] = [];
      const rowAssetIds: string[] = [];
      const rowRenderObjectIds: string[] = [];
      for (const row of rows) {
        const rowKey = `${key}-${row.key}`;
        const rowObjectId = `object-${sceneKey}-${rowKey}`;
        const rowAssetId = `asset-${sceneKey}-${rowKey}`;
        const rowRenderObjectId = `obj-${sceneKey}-${rowKey}`;
        if (existingObjectIds.has(rowObjectId)) {
          return fail(`Creation object already exists: ${rowObjectId}`, "INVALID_PARAMS");
        }
        if (existingAssetIds.has(rowAssetId)) {
          return fail(`Creation asset already exists: ${rowAssetId}`, "INVALID_PARAMS");
        }
        if (existingRenderIds.has(rowRenderObjectId)) {
          return fail(`Render object already exists: ${rowRenderObjectId}`, "INVALID_PARAMS");
        }
        existingObjectIds.add(rowObjectId);
        existingAssetIds.add(rowAssetId);
        existingRenderIds.add(rowRenderObjectId);
        rowObjectIds.push(rowObjectId);
        rowAssetIds.push(rowAssetId);
        rowRenderObjectIds.push(rowRenderObjectId);
      }

      const rawPanelObject: Record<string, unknown> = {
        kind: "plane",
        name: optionalString(args.name) ?? optionalString(args.title) ?? "3D UI panel",
        assetId,
        assetName: optionalString(args.name) ?? optionalString(args.title) ?? "3D UI panel",
        assetKind: "ui",
        materialId: optionalString(args.materialId) ?? `mat-${sceneKey}-${key}`,
        materialName: optionalString(args.name)
          ? `${optionalString(args.name)} material`
          : "UI panel material",
        materialModel: optionalString(args.materialModel) ?? "screen",
        materialKind: optionalString(args.materialKind) ?? "basic",
        x: position.x,
        y: position.y,
        z: position.z,
        rotationX: rotation.x,
        rotationY: rotation.y,
        rotationZ: rotation.z,
        scaleX: width,
        scaleY: height,
        scaleZ: optionalNumber(args.scaleZ) ?? 1,
        cornerRadius: optionalNumber(args.cornerRadius),
        mapAssetId: optionalString(args.mapAssetId),
        color: backgroundColor,
        baseColor: backgroundColor,
        roughness: optionalNumber(args.roughness) ?? (style === "hologram" ? 0.08 : 0.18),
        emissive:
          optionalString(args.emissive) ??
          (style === "hologram" ? "#38bdf8" : backgroundColor),
        emissiveIntensity:
          optionalNumber(args.emissiveIntensity) ?? (style === "hologram" ? 1.1 : 0.55),
        opacity: clampNumber(
          optionalNumber(args.opacity) ?? (style === "hologram" ? 0.58 : 0.86),
          0.02,
          1,
        ),
      };
      const builtPanel = buildSceneObject3D(rawPanelObject, renderObjectId);
      if ("error" in builtPanel) return fail(builtPanel.error, "INVALID_PARAMS");

      const now = Date.now();
      const panelMaterial = creationMaterialFromSceneObject(
        `${sceneKey}-${key}`,
        rawPanelObject,
        builtPanel.object,
      );
      const panelBaseAsset = creationAssetFromSceneObject(
        `${sceneKey}-${key}`,
        rawPanelObject,
        builtPanel.object,
        panelMaterial,
        now,
      );
      const panelAsset = updateCreationAssetUiPanel(panelBaseAsset, args, {
        targetObjects,
        normal,
        offset,
        width,
        height,
        rowObjectIds,
        rowAssetIds,
        now,
      });
      const panelObject: CreationSceneObject = {
        id: objectId,
        name: builtPanel.object.name ?? key,
        assetId: panelAsset.id,
        materialId: panelMaterial.id,
        partId: optionalString(args.partId) ?? key,
        parentId: targetObjects.length === 1 ? targetObjects[0]?.id : undefined,
        transform: requiredTransform3D(builtPanel.object),
        visible: args.visible !== false,
        selectable: args.selectable !== false,
        tags: [
          ...new Set([
            "agent-created",
            "ui",
            "ui-panel",
            "screen-panel",
            style,
            ...(parseStringArray(args.tags) ?? []),
          ]),
        ],
      };

      const basis = creationUiPanelBasis(normal);
      const renderObjects: MotionSceneObject3D[] = [builtPanel.object];
      const sceneObjects: CreationSceneObject[] = [panelObject];
      const assets: CreationAssetRecipe[] = [panelAsset];
      rows.forEach((row, index) => {
        const rowPosition = uiPanelWorldPosition(
          position,
          basis,
          normal,
          row.localX,
          row.localY,
          row.z,
        );
        const rowKey = `${key}-${row.key}`;
        const rowRawObject: Record<string, unknown> = {
          kind: "text3d",
          name: row.text,
          assetId: rowAssetIds[index],
          assetName: row.text,
          assetKind: "ui",
          materialId: `mat-${sceneKey}-${rowKey}`,
          materialName: `${row.text} material`,
          materialModel: "emissive",
          materialKind: "basic",
          x: rowPosition.x,
          y: rowPosition.y,
          z: rowPosition.z,
          rotationX: rotation.x,
          rotationY: rotation.y,
          rotationZ: rotation.z,
          scaleX: 1,
          scaleY: 1,
          scaleZ: 1,
          text: row.text,
          size: row.size,
          extrude: optionalNumber(args.extrude) ?? 0.01,
          color: row.color ?? textColor,
          baseColor: row.color ?? textColor,
          roughness: 0.12,
          emissive: row.color ?? textColor,
          emissiveIntensity:
            row.emissiveIntensity ?? optionalNumber(args.textEmissiveIntensity) ?? 0.9,
          opacity: clampNumber(optionalNumber(args.textOpacity) ?? 1, 0.02, 1),
        };
        const builtRow = buildSceneObject3D(rowRawObject, rowRenderObjectIds[index]);
        if ("error" in builtRow) return;
        const rowMaterial = creationMaterialFromSceneObject(
          `${sceneKey}-${rowKey}`,
          rowRawObject,
          builtRow.object,
        );
        const rowBaseAsset = creationAssetFromSceneObject(
          `${sceneKey}-${rowKey}`,
          rowRawObject,
          builtRow.object,
          rowMaterial,
          now,
        );
        const rowAsset = updateCreationAssetUiPanelText(rowBaseAsset, {
          panelObjectId: panelObject.id,
          panelAssetId: panelAsset.id,
          row,
          now,
        });
        renderObjects.push(builtRow.object);
        assets.push(rowAsset);
        sceneObjects.push({
          id: rowObjectIds[index],
          name: row.text,
          assetId: rowAsset.id,
          materialId: rowMaterial.id,
          partId: `${panelObject.partId}-row-${index + 1}`,
          parentId: panelObject.id,
          transform: requiredTransform3D(builtRow.object),
          visible: args.visible !== false,
          selectable: args.selectable !== false,
          tags: [
            "agent-created",
            "ui",
            "ui-panel-text",
            "text3d",
            row.key,
          ],
        });
      });
      if (renderObjects.length !== sceneObjects.length) {
        return fail("Failed to build one or more UI panel rows", "INVALID_PARAMS");
      }

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
              renderObjectId: index === 0 ? renderObjectId : rowRenderObjectIds[index - 1],
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
        label: asset.id === panelAsset.id ? `Create UI panel ${panelObject.name}` : `Create UI panel text ${asset.name}`,
        asset,
      }));
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add UI panel to ${scene.name}`,
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
          ? `Added UI panel ${panelObject.id} and synced ${renderObjects.length} objects`
          : `Added UI panel ${panelObject.id}`,
        {
          sceneId: scene.id,
          objectId: panelObject.id,
          partId: panelObject.partId,
          renderObjectId,
          assetId: panelAsset.id,
          materialId: panelMaterial.id,
          rowObjectIds,
          rowRenderObjectIds,
          rowAssetIds,
          targetObjectIds: targetObjects.map((target) => target.id),
          targetPartIds: targetObjects.map((target) => target.partId).filter(Boolean),
          normal,
          offset,
          width,
          height,
          operationIds: [...assetOperations.map((operation) => operation.id), sceneOperation.id],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          uiPanel: panelAsset.parameters.uiPanel,
        },
      );
    },
  }
];
