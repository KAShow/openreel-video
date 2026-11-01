import {
  RegisteredTool,
  applyMotionAction,
  bool,
  clampNumber,
  commitMotionComposition,
  createProductCalloutLayer,
  creationState,
  fail,
  genId,
  getMotionComposition,
  idSegment,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  resolveCreationScene,
  str,
} from "./shared";
import {
  type CreationRenderBinding,
  type CreationScene,
} from "@openreel/core/creation/index";
import {
  createProductCinematicMotionComposition,
} from "../creation-product-motion";
import {
  motionEngine,
} from "@openreel/core/motion/motion-engine";

export const creationCinematicTools: RegisteredTool[] = [
  {
    name: "create_product_cinematic_scene",
    domain: "motion",
    title: "Create product cinematic scene",
    description:
      "Create an editable high-detail product cinematic inside Motion Creator: a semantic multi-object 3D product assembly with materials, exploded-view animation, camera zoom/orbit keyframes, lights, room, and editable callout labels. insertIntoEditor defaults to false so it stays in Motion Creator; set it true ONLY when the user explicitly wants the rendered product cinematic placed on the main video-editor timeline.",
    inputSchema: obj({
      name: str,
      width: num,
      height: num,
      frameRate: num,
      duration: num,
      style: str,
      seed: num,
      includeInternals: bool,
      includeCallouts: bool,
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
      const result = createProductCinematicMotionComposition({
        compositionId: genId(),
        layerId: genId(),
        keyframeId: genId,
        name: optionalString(args.name) ?? "Product Cinematic",
        width: clampNumber(optionalNumber(args.width) ?? project.settings.width, 320, 8192),
        height: clampNumber(optionalNumber(args.height) ?? project.settings.height, 320, 8192),
        frameRate: clampNumber(optionalNumber(args.frameRate) ?? project.settings.frameRate, 12, 120),
        duration: clampNumber(optionalNumber(args.duration) ?? 6, 2.5, 120),
        style: optionalString(args.style),
        seed: optionalNumber(args.seed),
        includeInternals:
          typeof args.includeInternals === "boolean" ? args.includeInternals : undefined,
        includeCallouts:
          typeof args.includeCallouts === "boolean" ? args.includeCallouts : undefined,
      });
      for (const operation of result.creationOperations) {
        const creationApplied = await applyMotionAction(host, "creation/applyOperation", {
          operation,
        });
        if (!creationApplied.ok) return creationApplied;
      }
      const applied = await applyMotionAction(host, "motion/createComposition", {
        composition: result.composition,
      });
      if (!applied.ok) return applied;

      let instanceId: string | undefined;
      let insertedClipId: string | undefined;
      if (args.insertIntoEditor === true) {
        const instance = motionEngine.createInstance(result.composition, {
          startTime: optionalNumber(args.insertStartTime),
          duration: optionalNumber(args.insertDuration),
          trackId: optionalString(args.insertTrackId),
          name: optionalString(args.insertName) ?? result.composition.name,
        });
        const inserted = await applyMotionAction(host, "motion/insertInstance", {
          instance,
        });
        if (!inserted.ok) return inserted;
        instanceId = instance.id;
        insertedClipId = `motion-clip-${instance.id}`;
      }

      return ok(`Created product cinematic "${result.composition.name}"`, {
        compositionId: result.composition.id,
        sceneLayerId: result.layer.id,
        creationAssetId: result.coreCreationAsset.id,
        creationSceneId: result.coreCreationScene.id,
        creationOperationIds: result.creationOperations.map((operation) => operation.id),
        objectIdsByPartId: result.objectIdsByPartId,
        calloutLayerIds: result.calloutLayerIds,
        partCount: Object.keys(result.objectIdsByPartId).length,
        insertedInstanceId: instanceId,
        insertedClipId,
        creationScene: result.creationScene,
        composition: result.composition,
      });
    },
  },
  {
    name: "add_creation_product_callout",
    domain: "motion",
    title: "Add product callout",
    description:
      "Add an editable Motion text callout to a semantic product/creation scene and record it in the scene's motion-scene3d render binding. Use this after create_product_cinematic_scene or create_creation_3d_scene to label product parts, internals, materials, UI panels, or hero details. The returned text layer can be restyled or animated with normal Motion text tools.",
    inputSchema: obj({
      sceneId: str,
      compositionId: str,
      objectId: str,
      partId: str,
      layerId: str,
      label: str,
      text: str,
      name: str,
      x: num,
      y: num,
      offsetX: num,
      offsetY: num,
      screenOffsetX: num,
      screenOffsetY: num,
      revealTime: num,
      fontFamily: str,
      fontSize: num,
      fontWeight: num,
      color: str,
      backgroundColor: str,
      backgroundPadding: num,
      backgroundRadius: num,
      align: str,
      lineHeight: num,
      maxWidth: num,
      shadowColor: str,
      shadowBlur: num,
      shadowOffsetX: num,
      shadowOffsetY: num,
      shadowSpread: num,
    }, ["label"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const compositionId = optionalString(args.compositionId);
      const binding =
        scene.renderBindings.find(
          (candidate) =>
            candidate.kind === "motion-scene3d" &&
            (!compositionId || candidate.compositionId === compositionId),
        ) ?? scene.renderBindings.find((candidate) => candidate.kind === "motion-scene3d");
      if (!binding) {
        return fail(
          "Creation scene has no Motion scene3d render binding; call sync_creation_scene_to_motion first",
          "NOT_FOUND",
        );
      }
      const composition = getMotionComposition(host, binding.compositionId);
      if (!composition) {
        return fail(`Bound Motion composition not found: ${binding.compositionId}`, "NOT_FOUND");
      }
      const targetObjectId = optionalString(args.objectId);
      const targetPartId = optionalString(args.partId);
      const targetObject =
        targetObjectId || targetPartId
          ? scene.objects.find(
              (object) =>
                object.id === targetObjectId ||
                object.partId === targetPartId,
            )
          : undefined;
      if ((targetObjectId || targetPartId) && !targetObject) {
        return fail(
          `Creation object not found for ${targetObjectId ? `objectId ${targetObjectId}` : `partId ${targetPartId}`}`,
          "NOT_FOUND",
        );
      }
      const layerId =
        optionalString(args.layerId) ??
        `layer-callout-${idSegment(targetObject?.partId ?? targetObject?.id ?? args.label, "detail")}-${idSegment(genId(), "id").slice(-8)}`;
      if (composition.layers.some((layer) => layer.id === layerId)) {
        return fail(`Motion layer already exists: ${layerId}`, "INVALID_PARAMS");
      }
      const layer = createProductCalloutLayer(args, composition, scene, layerId);
      const now = Date.now();
      const nextBinding: CreationRenderBinding = {
        ...binding,
        calloutLayerIds: [...new Set([...(binding.calloutLayerIds ?? []), layer.id])],
        modifiedAt: now,
      };
      const nextScene: CreationScene = {
        ...scene,
        renderBindings: scene.renderBindings.map((candidate) =>
          candidate.id === binding.id ? nextBinding : candidate,
        ),
        modifiedAt: now,
      };
      const operation = {
        id: genId(),
        type: "scene/upsert" as const,
        timestamp: now,
        source: "agent" as const,
        label: `Add callout ${layer.text}`,
        scene: nextScene,
      };
      const applied = await applyMotionAction(host, "creation/applyOperation", {
        operation,
      });
      if (!applied.ok) return applied;
      const synced = await commitMotionComposition(host, {
        ...composition,
        layers: [...composition.layers, layer],
        modifiedAt: now,
      });
      if (!synced.ok) return synced;

      return ok(`Added product callout "${layer.text}"`, {
        sceneId: scene.id,
        compositionId: composition.id,
        layerId: layer.id,
        targetObjectId: targetObject?.id,
        targetPartId: targetObject?.partId,
        renderBindingId: binding.id,
        operationId: operation.id,
        calloutLayerIds: nextBinding.calloutLayerIds,
        layer,
      });
    },
  }
];
