import {
  RegisteredTool,
  applyMotionAction,
  asRecord,
  bool,
  buildCreationDraftFromMotionSceneLayer,
  buildMotionScene3DFromCreation,
  buildSceneObject3D,
  clampNumber,
  commitMotionComposition,
  creationAssetFromSceneObject,
  creationCameraFromSceneCamera,
  creationMaterialFromSceneObject,
  creationState,
  fail,
  findCreationBindingForMotionSceneLayer,
  genId,
  getMotionComposition,
  idSegment,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  parseCreationEnvironmentKind,
  parseCreationLights,
  parseSceneCamera,
  parseSceneRoom,
  parseStringArray,
  persistMotionSceneCreationDraft,
  requiredTransform3D,
  resolveCreationParentId,
  resolveCreationScene,
  str,
  uniqueIdSegment,
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
import {
  createMotionScene3DLayer,
} from "@openreel/core/motion/motion-scene3d";
import {
  motionEngine,
} from "@openreel/core/motion/motion-engine";

export const creationSceneTools: RegisteredTool[] = [
  {
    name: "create_creation_3d_scene",
    domain: "motion",
    title: "Create agent-native 3D creation scene",
    description:
      "Create a semantic OpenReel creation scene and a renderable Motion Creator scene3d composition in one call. Use this for arbitrary agent-built 3D worlds, product stages, environment layouts, UI-in-3D mockups, props, labels, and cinematic setups that must remain editable. `objects` uses the same fields as add_motion_3d_scene plus optional key, objectId, assetId, assetKind, materialId, materialModel, tags, and parentKey. insertIntoEditor defaults to false so the scene stays in Motion Creator; set it true ONLY when the user explicitly wants the rendered scene placed on the main video-editor timeline. Returns semantic object ids and render object ids for follow-up set_creation_object_transform, set_creation_object_material, animate_creation_object, and set_creation_camera calls.",
    inputSchema: obj({
      sceneId: str,
      compositionId: str,
      layerId: str,
      name: str,
      width: num,
      height: num,
      frameRate: num,
      duration: num,
      backgroundColor: str,
      objects: { type: "array" },
      camera: { type: "object" },
      lights: { type: "array" },
      room: { type: "object" },
      lighting: { type: "object" },
      environment: str,
      creationEnvironment: str,
      groundShadow: bool,
      insertIntoEditor: bool,
      insertStartTime: num,
      insertDuration: num,
      insertTrackId: str,
      insertName: str,
    }, ["objects"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const rawObjects = Array.isArray(args.objects) ? args.objects : [];
      if (rawObjects.length === 0) {
        return fail("Provide at least one object in `objects`", "INVALID_PARAMS");
      }

      const now = Date.now();
      const width = clampNumber(optionalNumber(args.width) ?? project.settings.width, 320, 8192);
      const height = clampNumber(optionalNumber(args.height) ?? project.settings.height, 320, 8192);
      const frameRate = clampNumber(optionalNumber(args.frameRate) ?? project.settings.frameRate, 12, 120);
      const duration = clampNumber(optionalNumber(args.duration) ?? 6, 0.5, 120);
      const name = optionalString(args.name) ?? "Agent 3D Creation Scene";
      const generatedSceneSuffix = idSegment(genId(), "generated").slice(-8);
      const sceneId =
        optionalString(args.sceneId) ??
        `scene-${idSegment(name, "agent-3d")}-${generatedSceneSuffix}`;
      const sceneKey = idSegment(sceneId, "scene");
      const compositionId = optionalString(args.compositionId) ?? genId();
      const layerId = optionalString(args.layerId) ?? genId();
      const usedObjectKeys = new Set<string>();
      const entries: Array<{
        readonly key: string;
        readonly parentKey?: string;
        readonly motionObject: MotionSceneObject3D;
        readonly asset: CreationAssetRecipe;
        readonly sceneObject: CreationSceneObject;
        readonly renderObjectId: string;
      }> = [];

      for (let index = 0; index < rawObjects.length; index += 1) {
        const record = asRecord(rawObjects[index]);
        if (!record) return fail("each object must be an object", "INVALID_PARAMS");
        const key = uniqueIdSegment(
          record.key ?? record.objectId ?? record.name,
          `object-${index + 1}`,
          usedObjectKeys,
        );
        const renderObjectId = optionalString(record.renderObjectId) ?? `obj-${sceneKey}-${key}`;
        const built = buildSceneObject3D(record, renderObjectId);
        if ("error" in built) return fail(built.error, "INVALID_PARAMS");
        const material = creationMaterialFromSceneObject(
          `${sceneKey}-${key}`,
          record,
          built.object,
        );
        const asset = creationAssetFromSceneObject(
          `${sceneKey}-${key}`,
          record,
          built.object,
          material,
          now,
        );
        const sceneObject: CreationSceneObject = {
          id: optionalString(record.objectId) ?? `object-${sceneKey}-${key}`,
          name: built.object.name ?? key,
          assetId: asset.id,
          materialId: material.id,
          partId: optionalString(record.partId) ?? key,
          parentId: optionalString(record.parentId),
          transform: requiredTransform3D(built.object),
          visible: record.visible !== false,
          selectable: record.selectable !== false,
          tags: [
            ...new Set([
              "agent-created",
              built.object.object.kind,
              ...(parseStringArray(record.tags) ?? []),
            ]),
          ],
        };
        entries.push({
          key,
          parentKey: optionalString(record.parentKey),
          motionObject: built.object,
          asset,
          sceneObject,
          renderObjectId,
        });
      }

      const duplicateAssetIds = new Set<string>();
      const seenAssetIds = new Set<string>();
      const duplicateObjectIds = new Set<string>();
      const seenObjectIds = new Set<string>();
      const duplicateRenderIds = new Set<string>();
      const seenRenderIds = new Set<string>();
      for (const entry of entries) {
        if (seenAssetIds.has(entry.asset.id)) duplicateAssetIds.add(entry.asset.id);
        seenAssetIds.add(entry.asset.id);
        if (seenObjectIds.has(entry.sceneObject.id)) duplicateObjectIds.add(entry.sceneObject.id);
        seenObjectIds.add(entry.sceneObject.id);
        if (seenRenderIds.has(entry.renderObjectId)) duplicateRenderIds.add(entry.renderObjectId);
        seenRenderIds.add(entry.renderObjectId);
      }
      if (duplicateAssetIds.size > 0 || duplicateObjectIds.size > 0 || duplicateRenderIds.size > 0) {
        return fail(
          `Duplicate ids are not allowed (assets: ${[...duplicateAssetIds].join(", ") || "none"}; objects: ${[...duplicateObjectIds].join(", ") || "none"}; render objects: ${[...duplicateRenderIds].join(", ") || "none"})`,
          "INVALID_PARAMS",
        );
      }

      const objectIdByKey = new Map(entries.map((entry) => [entry.key, entry.sceneObject.id]));
      const sceneObjects: CreationSceneObject[] = [];
      for (const entry of entries) {
        const parentId = entry.parentKey
          ? objectIdByKey.get(entry.parentKey)
          : entry.sceneObject.parentId;
        if (entry.parentKey && !parentId) {
          return fail(`parentKey not found: ${entry.parentKey}`, "INVALID_PARAMS");
        }
        sceneObjects.push({ ...entry.sceneObject, parentId });
      }

      const cameraRecord = asRecord(args.camera);
      const camera = parseSceneCamera(cameraRecord);
      const creationCamera = creationCameraFromSceneCamera(camera, cameraRecord);
      const room = parseSceneRoom(asRecord(args.room));
      const lightingRecord = asRecord(args.lighting);
      const environment = optionalString(args.environment);
      const lighting = {
        ambient: optionalNumber(lightingRecord?.ambient),
        keyIntensity: optionalNumber(lightingRecord?.keyIntensity),
        keyColor: optionalString(lightingRecord?.keyColor),
        rimIntensity: optionalNumber(lightingRecord?.rimIntensity),
        environment:
          environment === "dark" || environment === "none"
            ? (environment as "dark" | "none")
            : ("studio" as const),
        groundShadow: args.groundShadow === true,
      };
      const layer = createMotionScene3DLayer({
        id: layerId,
        name,
        duration,
        compositionWidth: width,
        compositionHeight: height,
        object: { kind: "box" },
        objects: entries.map((entry) => entry.motionObject),
        camera,
        room,
        lighting,
        fov: camera?.fov,
        width,
        height,
      });

      const scene: CreationScene = {
        id: sceneId,
        name,
        duration,
        frameRate,
        objects: sceneObjects,
        cameras: [creationCamera],
        activeCameraId: creationCamera.id,
        lights: parseCreationLights(args.lights),
        animations: [],
        environment: {
          kind: parseCreationEnvironmentKind(args.creationEnvironment ?? args.environment),
          backgroundColor: optionalString(args.backgroundColor) ?? "#0f172a",
          groundEnabled: args.groundShadow === true,
          groundColor: room?.floorColor,
        },
        renderBindings: [
          {
            id: `binding-${sceneId}-${compositionId}`,
            kind: "motion-scene3d",
            compositionId,
            layerId,
            objectBindings: entries.map((entry) => ({
              sceneObjectId: entry.sceneObject.id,
              renderObjectId: entry.renderObjectId,
            })),
            createdAt: now,
            modifiedAt: now,
          },
        ],
        createdAt: now,
        modifiedAt: now,
      };

      const composition: MotionComposition = {
        id: compositionId,
        name,
        width,
        height,
        frameRate,
        duration,
        backgroundColor: optionalString(args.backgroundColor) ?? "#0f172a",
        layers: [layer],
        assets: [],
        variables: [],
        markers: [],
        guides: [],
        createdAt: now,
        modifiedAt: now,
      };

      const operationIds: string[] = [];
      for (const asset of entries.map((entry) => entry.asset)) {
        const operation = {
          id: genId(),
          type: "asset/upsert" as const,
          timestamp: now,
          source: "agent" as const,
          label: `Create ${asset.name}`,
          asset,
        };
        operationIds.push(operation.id);
        const applied = await applyMotionAction(host, "creation/applyOperation", {
          operation,
        });
        if (!applied.ok) return applied;
      }
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Create ${scene.name}`,
        scene,
      };
      operationIds.push(sceneOperation.id);
      const sceneApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: sceneOperation,
      });
      if (!sceneApplied.ok) return sceneApplied;
      const activeOperation = {
        id: genId(),
        type: "scene/set-active" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Activate ${scene.name}`,
        sceneId: scene.id,
      };
      operationIds.push(activeOperation.id);
      const activeApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: activeOperation,
      });
      if (!activeApplied.ok) return activeApplied;

      const motionApplied = await applyMotionAction(host, "motion/createComposition", {
        composition,
      });
      if (!motionApplied.ok) return motionApplied;

      let instanceId: string | undefined;
      let insertedClipId: string | undefined;
      if (args.insertIntoEditor === true) {
        const instance = motionEngine.createInstance(composition, {
          startTime: optionalNumber(args.insertStartTime),
          duration: optionalNumber(args.insertDuration),
          trackId: optionalString(args.insertTrackId),
          name: optionalString(args.insertName) ?? name,
        });
        const inserted = await applyMotionAction(host, "motion/insertInstance", {
          instance,
        });
        if (!inserted.ok) return inserted;
        instanceId = instance.id;
        insertedClipId = `motion-clip-${instance.id}`;
      }

      return ok(`Created agent-native 3D creation scene "${name}"`, {
        sceneId,
        compositionId,
        layerId,
        assetIds: entries.map((entry) => entry.asset.id),
        operationIds,
        objectIdsByKey: Object.fromEntries(
          entries.map((entry) => [entry.key, entry.sceneObject.id]),
        ),
        renderObjectIdsByKey: Object.fromEntries(
          entries.map((entry) => [entry.key, entry.renderObjectId]),
        ),
        objectCount: entries.length,
        insertedInstanceId: instanceId,
        insertedClipId,
        scene,
        composition,
      });
    },
  },
  {
    name: "recover_motion_scene3d_to_creation",
    domain: "motion",
    title: "Recover Motion scene3d as creation scene",
    description:
      "Convert an existing multi-object Motion Creator scene3d layer into editable semantic creation assets/objects and a motion-scene3d render binding. Use this for older MCP-created scenes that render in Motion Creator but show no Creation workspace objects. It preserves the existing render object ids and creates creation state in-place; call sync_creation_scene_to_motion afterward only if the render layer later needs rebuilding.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      sceneId: str,
      name: str,
      creationEnvironment: str,
      backgroundColor: str,
      setActive: bool,
    }, ["compositionId", "layerId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layerId = optionalString(args.layerId);
      const layer = composition.layers.find(
        (candidate): candidate is MotionScene3DLayer =>
          candidate.id === layerId && candidate.type === "scene3d",
      );
      if (!layer) return fail("layerId must reference a scene3d layer", "INVALID_PARAMS");
      if (!layer.objects || layer.objects.length === 0) {
        return fail(
          "Only multi-object scene3d layers can be recovered into editable creation scenes",
          "INVALID_PARAMS",
        );
      }
      const existing = findCreationBindingForMotionSceneLayer(
        creationState(host),
        composition.id,
        layer.id,
      );
      if (existing) {
        return ok("Motion scene3d layer is already backed by creation state", {
          sceneId: existing.scene.id,
          compositionId: composition.id,
          layerId: layer.id,
          renderBindingId: existing.binding.id,
          objectCount: existing.scene.objects.length,
          alreadyRecovered: true,
        });
      }

      const now = Date.now();
      const draft = buildCreationDraftFromMotionSceneLayer({
        composition,
        layer,
        args,
        sceneId: optionalString(args.sceneId),
        now,
      });
      const applied = await persistMotionSceneCreationDraft(host, draft, {
        now,
        setActive: args.setActive !== false,
        labelPrefix: "Recover",
      });
      if (!applied.ok) return applied;
      return ok(`Recovered "${draft.scene.name}" as editable creation scene`, {
        sceneId: draft.scene.id,
        compositionId: composition.id,
        layerId: layer.id,
        renderBindingId: draft.binding.id,
        assetIds: draft.assets.map((asset) => asset.id),
        objectIdsByKey: draft.objectIdsByKey,
        renderObjectIdsByKey: draft.renderObjectIdsByKey,
        objectCount: draft.scene.objects.length,
        alreadyRecovered: false,
      });
    },
  },
  {
    name: "sync_creation_scene_to_motion",
    domain: "motion",
    title: "Sync creation scene to Motion",
    description:
      "Create, repair, or refresh the Motion Creator scene3d composition/layer for a persisted semantic OpenReel creation scene. Use this when a creation scene exists but is not rendering, after project import/load recovery, after stale binding issues, or when agents need to regenerate the native scene3d layer from editable creation assets/objects/cameras/lights. Reuses an existing motion-scene3d render binding unless forceNew=true, and can insert the synced composition into the editor timeline.",
    inputSchema: obj({
      sceneId: str,
      compositionId: str,
      layerId: str,
      name: str,
      width: num,
      height: num,
      frameRate: num,
      duration: num,
      backgroundColor: str,
      forceNew: bool,
      insertIntoEditor: bool,
      insertStartTime: num,
      insertDuration: num,
      insertTrackId: str,
      insertName: str,
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      if (scene.objects.length === 0) {
        return fail("Creation scene has no objects to render", "INVALID_PARAMS");
      }

      const forceNew = args.forceNew === true;
      const explicitCompositionId = optionalString(args.compositionId);
      const explicitLayerId = optionalString(args.layerId);
      const existingBindings = scene.renderBindings.filter(
        (candidate) => candidate.kind === "motion-scene3d",
      );
      const binding = forceNew
        ? undefined
        : existingBindings.find(
            (candidate) =>
              (explicitCompositionId && candidate.compositionId === explicitCompositionId) ||
              (explicitLayerId && candidate.layerId === explicitLayerId),
          ) ?? (!explicitCompositionId && !explicitLayerId ? existingBindings[0] : undefined);

      const now = Date.now();
      const compositionId = explicitCompositionId ?? binding?.compositionId ?? genId();
      const layerId = explicitLayerId ?? binding?.layerId ?? genId();
      const existingComposition = getMotionComposition(host, compositionId);
      const existingLayerById = existingComposition?.layers.find(
        (candidate) => candidate.id === layerId,
      );
      if (existingLayerById && existingLayerById.type !== "scene3d") {
        return fail(
          `Motion layer ${layerId} already exists but is not a scene3d layer`,
          "INVALID_PARAMS",
        );
      }
      const existingLayer =
        existingLayerById?.type === "scene3d" ? existingLayerById : undefined;

      const width = clampNumber(
        optionalNumber(args.width) ?? existingComposition?.width ?? project.settings.width,
        320,
        8192,
      );
      const height = clampNumber(
        optionalNumber(args.height) ?? existingComposition?.height ?? project.settings.height,
        320,
        8192,
      );
      const frameRate = clampNumber(
        optionalNumber(args.frameRate) ?? existingComposition?.frameRate ?? scene.frameRate,
        12,
        120,
      );
      const duration = clampNumber(
        optionalNumber(args.duration) ?? existingComposition?.duration ?? scene.duration,
        0.5,
        120,
      );
      const name = optionalString(args.name) ?? existingComposition?.name ?? scene.name;
      const backgroundColor =
        optionalString(args.backgroundColor) ??
        scene.environment.backgroundColor ??
        existingComposition?.backgroundColor ??
        "#0f172a";

      const rebuilt = buildMotionScene3DFromCreation(scene, state.assets, {
        compositionWidth: width,
        compositionHeight: height,
        layerId,
        layerName: name,
        duration,
        binding,
        existingLayer,
      });
      const nextBinding: CreationRenderBinding = binding
        ? {
            ...binding,
            compositionId,
            layerId,
            objectBindings: rebuilt.objectBindings,
            modifiedAt: now,
          }
        : {
            id: `binding-${scene.id}-${compositionId}`,
            kind: "motion-scene3d",
            compositionId,
            layerId,
            objectBindings: rebuilt.objectBindings,
            createdAt: now,
            modifiedAt: now,
          };
      const nextScene: CreationScene = {
        ...scene,
        renderBindings: binding
          ? scene.renderBindings.map((candidate) =>
              candidate.id === binding.id ? nextBinding : candidate,
            )
          : [...scene.renderBindings, nextBinding],
        modifiedAt: now,
      };
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Sync ${scene.name} to Motion`,
        scene: nextScene,
      };
      const sceneApplied = await applyMotionAction(host, "creation/applyOperation", {
        operation: sceneOperation,
      });
      if (!sceneApplied.ok) return sceneApplied;

      const nextComposition: MotionComposition = existingComposition
        ? {
            ...existingComposition,
            name,
            width,
            height,
            frameRate,
            duration,
            backgroundColor,
            layers: existingLayerById
              ? existingComposition.layers.map((candidate) =>
                  candidate.id === layerId ? rebuilt.layer : candidate,
                )
              : [...existingComposition.layers, rebuilt.layer],
            modifiedAt: now,
          }
        : {
            id: compositionId,
            name,
            width,
            height,
            frameRate,
            duration,
            backgroundColor,
            layers: [rebuilt.layer],
            assets: [],
            variables: [],
            markers: [],
            guides: [],
            createdAt: now,
            modifiedAt: now,
          };
      const motionApplied = await commitMotionComposition(host, nextComposition);
      if (!motionApplied.ok) return motionApplied;

      let instanceId: string | undefined;
      let insertedClipId: string | undefined;
      if (args.insertIntoEditor === true) {
        const instance = motionEngine.createInstance(nextComposition, {
          startTime: optionalNumber(args.insertStartTime),
          duration: optionalNumber(args.insertDuration),
          trackId: optionalString(args.insertTrackId),
          name: optionalString(args.insertName) ?? name,
        });
        const inserted = await applyMotionAction(host, "motion/insertInstance", {
          instance,
        });
        if (!inserted.ok) return inserted;
        instanceId = instance.id;
        insertedClipId = `motion-clip-${instance.id}`;
      }

      return ok(`Synced creation scene "${scene.name}" to Motion scene3d`, {
        sceneId: scene.id,
        compositionId,
        layerId,
        renderBindingId: nextBinding.id,
        createdRenderBinding: !binding,
        createdComposition: !existingComposition,
        repairedLayer: !existingLayer,
        objectIdsBySceneObjectId: Object.fromEntries(
          scene.objects.map((object) => [object.id, object.id]),
        ),
        renderObjectIdsBySceneObjectId: rebuilt.renderObjectIdsBySceneObjectId,
        missingAssetObjectIds: rebuilt.missingAssetObjectIds,
        operationIds: [sceneOperation.id],
        insertedInstanceId: instanceId,
        insertedClipId,
        scene: nextScene,
        composition: nextComposition,
      });
    },
  },
  {
    name: "add_creation_scene_object",
    domain: "motion",
    title: "Add object to creation scene",
    description:
      "Append one editable semantic object to an existing OpenReel creation scene and sync the bound Motion Creator scene3d layer when a render binding exists. Uses the same object fields as create_creation_3d_scene/add_motion_3d_scene plus optional key, objectId, renderObjectId, assetId, assetKind, materialId, materialModel, tags, parentId, and parentKey. Returns the creation object id and render object id for set_creation_object_transform, set_creation_object_material, and animate_creation_object.",
    inputSchema: obj({
      sceneId: str,
      key: str,
      objectId: str,
      renderObjectId: str,
      parentId: str,
      parentKey: str,
      partId: str,
      kind: str,
      name: str,
      assetId: str,
      assetName: str,
      assetKind: str,
      materialId: str,
      materialName: str,
      materialModel: str,
      tags: { type: "array" },
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
      baseColor: str,
      metalness: num,
      metallic: num,
      roughness: num,
      materialKind: str,
      emissive: str,
      emissiveIntensity: num,
      mapAssetId: str,
      opacity: num,
      visible: bool,
      selectable: bool,
    }, ["kind"]),
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
      const key = idSegment(args.key ?? args.objectId ?? args.name, `object-${scene.objects.length + 1}`);
      const objectId = optionalString(args.objectId) ?? `object-${sceneKey}-${key}`;
      if (scene.objects.some((object) => object.id === objectId)) {
        return fail(`Creation object already exists: ${objectId}`, "INVALID_PARAMS");
      }
      const assetId = optionalString(args.assetId) ?? `asset-${sceneKey}-${key}`;
      if (state.assets.some((asset) => asset.id === assetId)) {
        return fail(`Creation asset already exists: ${assetId}`, "INVALID_PARAMS");
      }
      const parent = resolveCreationParentId(scene, args.parentId, args.parentKey);
      if (!parent.ok) return fail(parent.error, "INVALID_PARAMS");

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
      const built = buildSceneObject3D(args, renderObjectId);
      if ("error" in built) return fail(built.error, "INVALID_PARAMS");

      const now = Date.now();
      const material = creationMaterialFromSceneObject(
        `${sceneKey}-${key}`,
        args,
        built.object,
      );
      const asset = creationAssetFromSceneObject(
        `${sceneKey}-${key}`,
        { ...args, assetId },
        built.object,
        material,
        now,
      );
      const object: CreationSceneObject = {
        id: objectId,
        name: built.object.name ?? key,
        assetId: asset.id,
        materialId: material.id,
        partId: optionalString(args.partId) ?? key,
        parentId: parent.parentId,
        transform: requiredTransform3D(built.object),
        visible: args.visible !== false,
        selectable: args.selectable !== false,
        tags: [
          ...new Set([
            "agent-created",
            built.object.object.kind,
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
        label: `Create ${asset.name}`,
        asset,
      };
      const sceneOperation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add ${object.name} to ${scene.name}`,
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
          ? `Added creation object ${object.id} and synced ${renderObjectId}`
          : `Added creation object ${object.id}`,
        {
          sceneId: scene.id,
          objectId: object.id,
          renderObjectId,
          assetId: asset.id,
          materialId: material.id,
          operationIds: [assetOperation.id, sceneOperation.id],
          syncedCompositionId: nextComposition?.id,
          syncedLayerId: binding?.layerId,
          object,
          asset,
        },
      );
    },
  }
];
