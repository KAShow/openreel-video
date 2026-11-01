import {
  CREATION_ASSET_KINDS,
  CREATION_CHARACTER_PART_ROLES,
  CREATION_CHARACTER_POSES,
  CREATION_CHARACTER_STYLES,
  CREATION_ENVIRONMENT_KINDS,
  CREATION_LIGHT_KINDS,
  CREATION_MATERIAL_MODELS,
  CREATION_PARTICLE_KINDS,
  CREATION_PRODUCT_PART_ROLES,
  CREATION_TEXTURE_PATTERNS,
  RegisteredTool,
  bool,
  creationMaterialPresetIds,
  creationReadHeader,
  creationState,
  emptyCreationReadState,
  fail,
  getMotionComposition,
  getMotionLayer,
  inspectCreationProductParts,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  readTool,
  resolveCreationScene,
  resolveModelInspectionSource,
  str,
  validateCreationRenderTargets,
  vec3FromArgs,
} from "./shared";
import {
  type ClothPin,
  type MaterialGraph,
  clothToMesh,
  computeMeshStats,
  createClothGrid,
  evaluateMaterialGraph,
  simulateCloth,
  solveTwoBoneIk,
  validateCreationState,
} from "@openreel/core/creation/index";
import {
  MOTION_OBJECT_3D_KINDS,
} from "@openreel/core/motion/motion-scene3d";

export const creationReadTools: RegisteredTool[] = [
  readTool(
    "get_creation_capabilities",
    "Creation capabilities",
    "Agent-native creation vocabulary, supported editable 3D object/material/environment kinds, and the preferred create/sync/preview/edit workflow.",
    obj({}),
    (_a, h) => {
      const state = creationState(h);
      return {
        ...creationReadHeader(state),
        objectKinds: [...MOTION_OBJECT_3D_KINDS],
        assetKinds: [...CREATION_ASSET_KINDS],
        materialModels: [...CREATION_MATERIAL_MODELS],
        materialPresets: creationMaterialPresetIds(),
        texturePatterns: [...CREATION_TEXTURE_PATTERNS],
        productPartRoles: [...CREATION_PRODUCT_PART_ROLES],
        characterStyles: [...CREATION_CHARACTER_STYLES],
        characterPartRoles: [...CREATION_CHARACTER_PART_ROLES],
        characterPoses: [...CREATION_CHARACTER_POSES],
        particleKinds: [...CREATION_PARTICLE_KINDS],
        environmentKinds: [...CREATION_ENVIRONMENT_KINDS],
        lightKinds: [...CREATION_LIGHT_KINDS],
        geometryFields: [
          "kind",
          "size",
          "depth",
          "aspect",
          "cornerRadius",
          "modelUrl",
          "animationClipName",
          "animationClipIndex",
          "animationTimeOffset",
          "animationPlaybackRate",
          "animationLoop",
          "text",
          "extrude",
          "panelTexts",
          "lidAngle",
        ],
        transformFields: [
          "position",
          "rotation",
          "scale",
          "x/y/z",
          "rotationX/Y/Z",
          "scaleX/Y/Z",
        ],
        animationChannels: [
          "position",
          "rotation",
          "scale",
          "opacity",
          "camera.position",
          "camera.target",
          "camera.fov",
          "camera.focusDistance",
        ],
        coreWorkflow: [
          "create_creation_3d_scene",
          "render_creation_preview",
          "inspect_creation_product_parts",
          "inspect_3d_model",
          "rig_humanoid_model",
          "set_creation_scene_environment",
          "add_creation_scene_object",
          "add_creation_product_part",
          "add_creation_screen_stack",
          "add_creation_camera_module",
          "add_creation_product_internals",
          "scatter_creation_objects",
          "duplicate_creation_object",
          "apply_creation_bevel",
          "apply_creation_displacement",
          "set_creation_object_transform",
          "set_creation_object_material",
          "apply_creation_material_preset",
          "apply_creation_xray_material",
          "apply_creation_surface_detail",
          "add_creation_procedural_texture",
          "bake_creation_texture",
          "bake_creation_asset",
          "set_creation_object_geometry",
          "set_model_animation",
          "animate_creation_object",
          "animate_creation_exploded_view",
          "simulate_creation_rigid_drop",
          "apply_creation_cloth_wave",
          "add_creation_cutaway_plane",
          "add_creation_decal",
          "add_creation_ui_panel",
          "add_creation_light_sweep",
          "add_creation_product_callout",
          "add_creation_character",
          "pose_creation_character",
          "add_creation_particle_system",
          "set_creation_camera",
          "animate_creation_camera",
          "recover_motion_scene3d_to_creation",
          "sync_creation_scene_to_motion",
          "insert_motion_into_editor",
        ],
        recoveryWorkflow: [
          "list_creation_scenes",
          "get_creation_scene",
          "inspect_creation_product_parts",
          "critique_creation_scene",
          "get_creation_history",
          "validate_creation_state",
          "bake_creation_asset",
          "export_creation_scene_gltf",
          "render_creation_scene_image",
          "recover_motion_scene3d_to_creation",
          "sync_creation_scene_to_motion",
          "render_creation_preview",
        ],
        notes: [
          "Creation scenes are the editable source of truth; Motion scene3d layers are render bindings.",
          "Use recover_motion_scene3d_to_creation for older motion-only scene3d layers that render but do not appear in the Creation workspace.",
          "Use sync_creation_scene_to_motion when a semantic scene exists but the bound Motion composition/layer is missing or stale.",
          "Use render_creation_preview after significant scene edits so agents can visually inspect the result.",
          "For exact branded products or internals, require user-provided references; otherwise create plausible editable details.",
        ],
      };
    },
  ),
  readTool(
    "get_creation_history",
    "Creation history",
    "List recent persisted creation operations (asset/scene/camera/scene-object/animation upserts and removals) with their source, label, and target ids — for agent review panels, audit, and undo planning. Optional sceneId filter and limit (default 50).",
    obj({ sceneId: str, limit: num }),
    (args, host) => {
      const state = creationState(host);
      if (!state) return { ...emptyCreationReadState(), operations: [], returned: 0 };
      const sceneId = optionalString(args.sceneId);
      const limit = Math.max(1, Math.min(200, Math.floor(optionalNumber(args.limit) ?? 50)));
      const operations = state.operationHistory
        .filter((operation) => {
          if (!sceneId) return true;
          if ("sceneId" in operation) return operation.sceneId === sceneId;
          return true;
        })
        .slice(-limit)
        .map((operation) => ({
          id: operation.id,
          type: operation.type,
          timestamp: operation.timestamp,
          source: operation.source,
          label: operation.label,
          sceneId: "sceneId" in operation ? operation.sceneId : undefined,
          assetId:
            "asset" in operation
              ? operation.asset.id
              : "assetId" in operation
                ? operation.assetId
                : undefined,
          objectId:
            "object" in operation
              ? operation.object.id
              : "objectId" in operation
                ? operation.objectId
                : undefined,
          clipId: "clip" in operation ? operation.clip.id : undefined,
        }));
      return { ...creationReadHeader(state), operations, returned: operations.length };
    },
  ),
  readTool(
    "critique_creation_scene",
    "Critique creation scene",
    "Analyze a persisted creation scene and return warnings plus suggested next tools: empty scenes, objects missing assets/materials, missing/stale/partial render bindings, no camera/lights, unbaked (dirty) mesh caches, and orphaned animation tracks. Use this in agent review loops before rendering or exporting.",
    obj({ sceneId: str }),
    (args, host) => {
      const state = creationState(host);
      if (!state) return { ...emptyCreationReadState(), issues: [], ok: false };
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) {
        return { ...creationReadHeader(state), error: "Creation scene not found", issues: [], ok: false };
      }
      const issues: Array<{
        severity: "error" | "warning" | "info";
        code: string;
        message: string;
        suggestion: string;
      }> = [];
      const push = (
        severity: "error" | "warning" | "info",
        code: string,
        message: string,
        suggestion: string,
      ): void => {
        issues.push({ severity, code, message, suggestion });
      };
      const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));

      if (scene.objects.length === 0) {
        push(
          "error",
          "EMPTY_SCENE",
          "Scene has no objects",
          "add_creation_scene_object / add_creation_product_part / add_creation_character",
        );
      }
      for (const object of scene.objects) {
        if (!assetsById.has(object.assetId)) {
          push(
            "error",
            "MISSING_ASSET",
            `Object ${object.id} references missing asset ${object.assetId}`,
            "sync_creation_scene_to_motion",
          );
        }
        if (!object.materialId) {
          push(
            "warning",
            "NO_MATERIAL",
            `Object ${object.id} has no material`,
            "set_creation_object_material / apply_creation_material_preset",
          );
        }
      }
      const binding = scene.renderBindings.find((candidate) => candidate.kind === "motion-scene3d");
      if (!binding) {
        push(
          "warning",
          "NO_RENDER_BINDING",
          "Scene has no motion-scene3d render binding",
          "sync_creation_scene_to_motion",
        );
      } else {
        const composition = getMotionComposition(host, binding.compositionId);
        const layer = composition ? getMotionLayer(composition, binding.layerId) : undefined;
        if (!composition) {
          push(
            "error",
            "MISSING_RENDER_COMPOSITION",
            `Bound Motion composition is missing: ${binding.compositionId}`,
            "sync_creation_scene_to_motion",
          );
        } else if (!layer || layer.type !== "scene3d") {
          push(
            "error",
            "MISSING_RENDER_LAYER",
            `Bound Motion scene3d layer is missing: ${binding.layerId}`,
            "sync_creation_scene_to_motion",
          );
        } else if (binding.objectBindings.length < scene.objects.length) {
          push(
            "warning",
            "PARTIAL_RENDER_BINDING",
            `Only ${binding.objectBindings.length}/${scene.objects.length} objects are bound to a render object`,
            "sync_creation_scene_to_motion",
          );
        }
      }
      if (scene.cameras.length === 0) {
        push("warning", "NO_CAMERA", "Scene has no camera", "set_creation_camera");
      }
      if (scene.lights.length === 0) {
        push(
          "info",
          "NO_LIGHTS",
          "Scene has no explicit lights (using renderer defaults)",
          "set_creation_scene_environment",
        );
      }

      let dirtyMeshAssets = 0;
      for (const assetId of new Set(scene.objects.map((object) => object.assetId))) {
        const asset = assetsById.get(assetId);
        if (!asset) continue;
        if (
          asset.caches.some(
            (cache) =>
              (cache.kind === "preview-mesh" || cache.kind === "final-mesh") &&
              cache.status === "dirty",
          )
        ) {
          dirtyMeshAssets += 1;
        }
      }
      if (dirtyMeshAssets > 0) {
        push(
          "info",
          "UNBAKED_MESHES",
          `${dirtyMeshAssets} asset(s) have unbaked/dirty mesh caches`,
          "bake_creation_asset",
        );
      }

      const objectIds = new Set(scene.objects.map((object) => object.id));
      const cameraIds = new Set(scene.cameras.map((camera) => camera.id));
      let orphanTracks = 0;
      for (const clip of scene.animations) {
        for (const track of clip.tracks) {
          const isCameraTrack = track.channel.startsWith("camera.");
          const exists = isCameraTrack
            ? cameraIds.has(track.targetId)
            : objectIds.has(track.targetId);
          if (!exists) orphanTracks += 1;
        }
      }
      if (orphanTracks > 0) {
        push(
          "warning",
          "ORPHAN_ANIMATION",
          `${orphanTracks} animation track(s) reference missing targets`,
          "animate_creation_object / remove_creation_scene_object cleanup",
        );
      }

      const errorCount = issues.filter((issue) => issue.severity === "error").length;
      const warningCount = issues.filter((issue) => issue.severity === "warning").length;
      return {
        ...creationReadHeader(state),
        sceneId: scene.id,
        ok: errorCount === 0,
        errorCount,
        warningCount,
        infoCount: issues.length - errorCount - warningCount,
        issues,
      };
    },
  ),
  readTool(
    "solve_creation_ik",
    "Solve two-bone IK",
    "Compute two-bone (upper + lower limb) inverse kinematics with the CPU rig solver: given a root/shoulder position, a target/hand position, and bone lengths, returns the elbow joint position and whether the target is reachable. Use this to plan character arm/leg poses to grip props or reach points before authoring keyframes.",
    obj(
      {
        root: { type: "object" },
        target: { type: "object" },
        upperLength: num,
        lowerLength: num,
        poleHint: { type: "object" },
      },
      ["target"],
    ),
    (args) => {
      const root = vec3FromArgs(args.root, { x: 0, y: 0, z: 0 }, ["rootX", "rootY", "rootZ"], args);
      const target = vec3FromArgs(
        args.target,
        { x: 0, y: 0, z: 0 },
        ["targetX", "targetY", "targetZ"],
        args,
      );
      const poleHint = args.poleHint
        ? vec3FromArgs(args.poleHint, { x: 0, y: 0, z: 1 }, ["poleHintX", "poleHintY", "poleHintZ"], args)
        : undefined;
      const result = solveTwoBoneIk({
        root,
        target,
        upperLength: optionalNumber(args.upperLength) ?? 1,
        lowerLength: optionalNumber(args.lowerLength) ?? 1,
        poleHint,
      });
      return {
        elbow: result.elbow,
        reachable: result.reachable,
        distance: result.distance,
      };
    },
  ),
  readTool(
    "evaluate_creation_material_graph",
    "Evaluate material graph",
    "Evaluate a node-based material graph (color/scalar/mix/multiply/output nodes) with the CPU material engine to a final PBR descriptor (baseColor, metallic, roughness, emissive). Use this to resolve procedural material networks to concrete renderable values.",
    obj({ graph: { type: "object" } }, ["graph"]),
    (args) => {
      const graph = args.graph as MaterialGraph | undefined;
      if (!graph || !Array.isArray(graph.nodes) || typeof graph.output !== "string") {
        return { error: "graph must have a nodes array and an output node id" };
      }
      return evaluateMaterialGraph(graph);
    },
  ),
  readTool(
    "simulate_creation_cloth",
    "Simulate cloth",
    "Run the CPU mass-spring cloth solver for a flag/sheet and return the simulated mesh statistics (vertex/triangle counts, bounds). Choose a pin edge (top/bottom/left/right/top-corners), plane (xy flag / xz hanging), gravity, wind, and steps. Use this to preview cloth motion before binding it into a scene.",
    obj({
      width: num,
      height: num,
      columns: num,
      rows: num,
      pin: str,
      plane: str,
      steps: num,
      gravity: num,
      windX: num,
      windY: num,
      windZ: num,
      iterations: num,
    }),
    (args) => {
      const pinRaw = optionalString(args.pin);
      const validPins = ["none", "top", "bottom", "left", "right", "top-corners", "left-edge"];
      const pin = (validPins.includes(pinRaw ?? "") ? pinRaw : "top") as ClothPin;
      const grid = createClothGrid({
        width: optionalNumber(args.width) ?? 2,
        height: optionalNumber(args.height) ?? 2,
        columns: Math.max(2, Math.floor(optionalNumber(args.columns) ?? 8)),
        rows: Math.max(2, Math.floor(optionalNumber(args.rows) ?? 8)),
        pin,
        plane: optionalString(args.plane) === "xz" ? "xz" : "xy",
      });
      const simulated = simulateCloth(grid, {
        steps: Math.max(1, Math.min(2000, Math.floor(optionalNumber(args.steps) ?? 60))),
        gravity: optionalNumber(args.gravity) ?? 9.8,
        iterations: Math.max(1, Math.floor(optionalNumber(args.iterations) ?? 6)),
        wind: {
          x: optionalNumber(args.windX) ?? 0,
          y: optionalNumber(args.windY) ?? 0,
          z: optionalNumber(args.windZ) ?? 0,
        },
      });
      const stats = computeMeshStats(clothToMesh(simulated));
      return {
        columns: simulated.columns,
        rows: simulated.rows,
        pin,
        vertexCount: stats.vertexCount,
        triangleCount: stats.triangleCount,
        bounds: stats.bounds,
      };
    },
  ),
  {
    name: "probe_rigging_backend",
    domain: "read",
    title: "Probe rigging backend",
    description:
      "Check whether the desktop Blender rigging backend is available before attempting character rigging, animation retargeting, or GLB cleanup jobs.",
    inputSchema: obj({}),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (_args, host) => {
      if (typeof host.probeRiggingBackend !== "function") {
        return ok("Rigging backend unavailable", {
          available: false,
          provider: "blender",
          error: "Rigging backend probing is only available in the desktop host",
        });
      }
      const probe = await host.probeRiggingBackend();
      return ok(
        probe.available
          ? `Blender rigging backend available${probe.version ? ` (${probe.version})` : ""}`
          : "Blender rigging backend unavailable",
        probe,
      );
    },
  },
  {
    name: "inspect_3d_model",
    domain: "read",
    title: "Inspect GLB/glTF model",
    description:
      "Load and inspect a GLB/glTF model before rigging, retargeting, animation binding, cleanup, or scene placement. Returns mesh/material/texture counts, bounds, animation clips, armature/bone summary, warnings, and suggested next MCP tools. Provide modelUrl directly, or resolve an existing model with compositionId+layerId(+objectId), sceneId+creationObjectId, or assetId.",
    inputSchema: obj({
      modelUrl: str,
      url: str,
      name: str,
      compositionId: str,
      layerId: str,
      objectId: str,
      renderObjectId: str,
      sceneId: str,
      creationObjectId: str,
      assetId: str,
    }),
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      const resolved = resolveModelInspectionSource(args, host);
      if (typeof resolved === "string") return fail(resolved, "INVALID_PARAMS");
      if (typeof host.inspectModel !== "function") {
        return ok("Model inspection unavailable in this host", {
          available: false,
          ...resolved,
          warnings: [
            {
              code: "HOST_UNAVAILABLE",
              severity: "warning",
              message:
                "GLB/glTF inspection requires the live desktop/web host because it uses the renderer model loader.",
            },
          ],
          suggestedNextTools: ["probe_rigging_backend"],
        });
      }
      try {
        const report = await host.inspectModel({
          modelUrl: resolved.modelUrl,
          name: resolved.name,
          source: resolved.source,
        });
        return ok(
          `Inspected ${report.name ?? resolved.name ?? "3D model"}: ${report.meshCount} mesh(es), ${report.animationCount} animation clip(s), ${report.armature.boneCount} bone(s)`,
          {
            available: true,
            ...resolved,
            ...report,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(`Model inspection failed: ${message}`, "MODEL_INSPECTION_FAILED");
      }
    },
  },
  {
    name: "rig_humanoid_model",
    domain: "motion",
    title: "Rig humanoid GLB model",
    description:
      "Run the desktop Blender rigging backend to create or repair a humanoid armature for a GLB/glTF model and export a rigged GLB. Use inspect_3d_model first to confirm meshes/armature/animations. Provide modelUrl directly, or resolve an existing model with compositionId+layerId(+objectId), sceneId+creationObjectId, or assetId. outputPath is optional; when omitted the desktop backend writes a temporary GLB and returns outputUrl/outputPath. overwriteExisting=true replaces an existing armature; false preserves one when present.",
    inputSchema: obj({
      modelUrl: str,
      url: str,
      name: str,
      outputPath: str,
      heightMeters: num,
      overwriteExisting: bool,
      compositionId: str,
      layerId: str,
      objectId: str,
      renderObjectId: str,
      sceneId: str,
      creationObjectId: str,
      assetId: str,
    }),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      const resolved = resolveModelInspectionSource(args, host);
      if (typeof resolved === "string") return fail(resolved, "INVALID_PARAMS");
      if (typeof host.rigHumanoidModel !== "function") {
        return ok("Humanoid rigging unavailable in this host", {
          ok: false,
          provider: "blender",
          inputUrl: resolved.modelUrl,
          createdArmature: false,
          preservedExistingArmature: false,
          skinnedMeshCount: 0,
          meshCount: 0,
          boneCount: 0,
          warnings: [
            {
              code: "HOST_UNAVAILABLE",
              severity: "error",
              message:
                "Humanoid rigging requires the desktop host with the Blender backend.",
            },
          ],
          suggestedNextTools: ["probe_rigging_backend"],
          ...resolved,
        });
      }
      const result = await host.rigHumanoidModel({
        modelUrl: resolved.modelUrl,
        name: optionalString(args.name) ?? resolved.name,
        outputPath: optionalString(args.outputPath),
        heightMeters: optionalNumber(args.heightMeters),
        overwriteExisting:
          typeof args.overwriteExisting === "boolean" ? args.overwriteExisting : undefined,
      });
      return ok(
        result.ok
          ? `Rigged humanoid model: ${result.boneCount} bone(s), ${result.skinnedMeshCount} skinned mesh(es)`
          : `Humanoid rigging failed${result.error ? `: ${result.error}` : ""}`,
        {
          ...resolved,
          ...result,
          suggestedNextTools: result.ok
            ? ["inspect_3d_model", "set_model_animation", "retarget_animation_clip", "export_rigged_model"]
            : ["probe_rigging_backend", "inspect_3d_model"],
        },
      );
    },
  },
  readTool(
    "list_motion_compositions",
    "List motion compositions",
    "Compact list of Motion Creator scenes, layers, variables, and editor instances.",
    obj({}),
    (_a, h) => {
      const project = h.getProject();
      return {
        compositions: (project.motionCompositions ?? []).map((composition) => ({
          id: composition.id,
          name: composition.name,
          width: composition.width,
          height: composition.height,
          duration: composition.duration,
          frameRate: composition.frameRate,
          layerCount: composition.layers.length,
          variableCount: composition.variables.length,
          markers: composition.markers.length,
          beatMarkers: composition.beatMarkers?.length ?? 0,
        })),
        instances: (project.motionInstances ?? []).map((instance) => ({
          id: instance.id,
          compositionId: instance.compositionId,
          name: instance.name,
          startTime: instance.startTime,
          duration: instance.duration,
          trackId: instance.trackId,
        })),
      };
    },
  ),
  readTool(
    "list_creation_assets",
    "List creation assets",
    "Compact list of persisted OpenReel creation assets/recipes generated or edited by agents.",
    obj({}),
    (_a, h) => {
      const state = creationState(h);
      return {
        ...creationReadHeader(state),
        assets: (state?.assets ?? []).map((asset) => ({
          id: asset.id,
          name: asset.name,
          kind: asset.kind,
          seed: asset.seed,
          nodeCount: asset.nodes.length,
          materialCount: asset.materials.length,
          dependencyCount: asset.dependencies.length,
          cacheCount: asset.caches.length,
          dirtyCacheCount: asset.caches.filter((cache) => cache.status === "dirty").length,
          readyCacheCount: asset.caches.filter((cache) => cache.status === "ready").length,
          modifiedAt: asset.modifiedAt,
        })),
      };
    },
  ),
  readTool(
    "list_creation_scenes",
    "List creation scenes",
    "Compact list of persisted semantic 3D creation scenes, including object/camera/light/animation counts.",
    obj({}),
    (_a, h) => {
      const state = creationState(h);
      return {
        ...creationReadHeader(state),
        scenes: (state?.scenes ?? []).map((scene) => ({
          id: scene.id,
          name: scene.name,
          active: scene.id === state?.activeSceneId,
          duration: scene.duration,
          frameRate: scene.frameRate,
          objectCount: scene.objects.length,
          cameraCount: scene.cameras.length,
          lightCount: scene.lights.length,
          animationCount: scene.animations.length,
          environment: scene.environment.kind,
          modifiedAt: scene.modifiedAt,
        })),
      };
    },
  ),
  readTool(
    "get_creation_asset",
    "Get creation asset",
    "Full persisted creation asset recipe by assetId, including recipe nodes, materials, dependencies, and cache refs.",
    obj({ assetId: str }, ["assetId"]),
    (args, h) => {
      const state = creationState(h);
      const assetId = typeof args.assetId === "string" ? args.assetId : "";
      return {
        ...creationReadHeader(state),
        asset: (state?.assets ?? []).find((asset) => asset.id === assetId),
      };
    },
  ),
  readTool(
    "get_creation_scene",
    "Get creation scene",
    "Full persisted semantic creation scene by sceneId. Omitting sceneId returns the active scene when one exists.",
    obj({ sceneId: str }),
    (args, h) => {
      const state = creationState(h);
      const sceneId =
        typeof args.sceneId === "string" && args.sceneId.trim()
          ? args.sceneId.trim()
          : state?.activeSceneId;
      return {
        ...creationReadHeader(state),
        scene: (state?.scenes ?? []).find((scene) => scene.id === sceneId),
      };
    },
  ),
  readTool(
    "inspect_creation_product_parts",
    "Inspect creation product parts",
    "Compact edit map for semantic product/creation scene parts: object ids, part ids, asset/material ids, render bindings, recipe features, cache status, and animation clips. Use this before editing product internals, exploded views, X-ray shells, materials, callouts, or part motion.",
    obj({
      sceneId: str,
      objectIds: { type: "array" },
      objects: { type: "array" },
      partIds: { type: "array" },
      parts: { type: "array" },
      tags: { type: "array" },
      includeTags: { type: "array" },
      includeAllObjects: bool,
    }),
    (args, h) => inspectCreationProductParts(creationState(h), args),
  ),
  readTool(
    "validate_creation_state",
    "Validate creation state",
    "Validate persisted creation assets/scenes for broken references, invalid active scene/camera ids, and animation target issues.",
    obj({}),
    (_a, h) => {
      const state = creationState(h);
      const issues = state
        ? [
            ...validateCreationState(state),
            ...validateCreationRenderTargets(h, state),
          ]
        : [];
      return {
        ...creationReadHeader(state),
        issues,
      };
    },
  )
];
