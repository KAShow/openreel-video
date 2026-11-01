import {
  MOTION_ANIMATION_PRESET_IDS,
  MOTION_SHAPE_TYPES,
  RegisteredTool,
  animateMotionLayerProperty,
  applyMotionAction,
  asRecord,
  bool,
  clampNumber,
  commitMotionComposition,
  creationState,
  fail,
  genId,
  getMotionComposition,
  getMotionLayer,
  isValidEasing,
  num,
  obj,
  ok,
  optionalNumber,
  optionalString,
  readTool,
  renderMotionFrameResult,
  replaceMotionLayer,
  resolveCreationScene,
  resolveShapePathData,
  serializeMotionComposition,
  str,
  vec2FromObject,
} from "./shared";
import {
  DEFAULT_MOTION_TRANSFORM,
  type MotionAsset,
  type MotionComposition,
  type MotionImageLayer,
  type MotionLayer,
  type MotionObject3D,
  type MotionParticleEmitter,
  type MotionShapeLayer,
  type MotionTextLayer,
} from "@openreel/core/motion/types";
import {
  DEFAULT_SHAPE_STYLE,
} from "@openreel/core/graphics/types";
import {
  type EasingType,
} from "@openreel/core/types/timeline";
import {
  MOTION_ANIMATABLE_PROPERTIES,
  type MotionAnimatableProperty,
  getMotionLayerContentsPropertyDescriptors,
  getMotionLayerEffectPropertyDescriptors,
  getMotionLayerMaskPropertyDescriptors,
  getMotionLayerPropertyKeyframes,
  getMotionLayerPropertyValueAtTime,
  getMotionLayerPuppetPropertyDescriptors,
  getMotionLayerShaderFillPropertyDescriptors,
  getMotionLayerShapeModifierPropertyDescriptors,
  isMotionAnimatableProperty,
  moveMotionLayerKeyframe,
  removeMotionLayerKeyframe,
  removeMotionLayerPropertyKeyframes,
  setMotionKeyframeRoving,
  upsertMotionLayerKeyframe,
} from "@openreel/core/motion/motion-keyframes";
import {
  type MediaItem,
} from "@openreel/core/types/project";
import {
  type MotionAnimationPresetId,
  canApplyMotionAnimationPreset,
  getMotionAnimationPreset,
} from "@openreel/core/motion/motion-animation-presets";
import {
  addMotionLayerVariableBinding,
} from "@openreel/core/motion/motion-variable-bindings";
import {
  applyMotionAnimationPresetToBeats,
  detectMotionBeatMarkersFromPeaks,
  generateMotionBeatMarkersAtBpm,
  setMotionBeatMarkers,
} from "@openreel/core/motion/motion-markers";
import {
  createMotionAdjustmentLayer,
} from "@openreel/core/motion/motion-adjustment-layers";
import {
  createMotionImageLayerFromAsset,
} from "@openreel/core/motion/motion-assets";
import {
  createMotionNullLayer,
} from "@openreel/core/motion/motion-null-layers";
import {
  createMotionParticleLayer,
} from "@openreel/core/motion/motion-particles";
import {
  createMotionScene3DLayer,
} from "@openreel/core/motion/motion-scene3d";
import {
  createMotionVariable,
} from "@openreel/core/motion/motion-variables";
import {
  getMotionPreset,
} from "@openreel/core/motion/motion-presets";
import {
  motionEngine,
} from "@openreel/core/motion/motion-engine";

export const motionLayerTools: RegisteredTool[] = [
  {
    name: "add_motion_layer",
    domain: "motion",
    title: "Add motion layer",
    description:
      "Add a layer to a Motion Creator composition. layerType is one of text|shape|image|group|null|composition|adjustment|particle|scene3d. For image pass assetId (a composition asset id) or mediaId (a media library image). For composition pass refCompositionId (the nested comp to embed). scene3d creates a blank real-3D scene (one rounded-box hero object, studio lighting, default camera) — use set_motion_scene_object / add_motion_3d_object to populate it. For a bezier PEN shape set shapeType:'path' and supply pathData (an SVG path string, e.g. 'M 0 0 C 10 -20 40 -20 50 0') or pathPoints (an array of >=2 {x,y,inX?,inY?,outX?,outY?} vertices in layer-local pixels; in/out are absolute bezier handle coordinates) plus pathClosed (default true). Simple fields: name, text, color, width, height, shapeType.",
    inputSchema: obj({
      compositionId: str,
      layerType: str,
      type: str,
      layer: { type: "object" },
      name: str,
      text: str,
      color: str,
      width: num,
      height: num,
      shapeType: str,
      pathData: str,
      pathPoints: { type: "array" },
      pathClosed: bool,
      assetId: str,
      mediaId: str,
      refCompositionId: str,
      emitter: { type: "object" },
    }, ["compositionId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");

      const layerInput = asRecord(args.layer);
      const layerType = String(
        layerInput?.type ?? args.layerType ?? args.type ?? "text",
      );
      const layerName = String(layerInput?.name ?? args.name ?? "Motion Layer");
      const startTime = optionalNumber(layerInput?.startTime) ?? 0;
      const duration =
        optionalNumber(layerInput?.duration) ?? composition.duration;
      const base = {
        id: genId(),
        name: layerName,
        startTime,
        duration,
        visible: layerInput?.visible !== false,
        locked: layerInput?.locked === true,
        transform: {
          ...DEFAULT_MOTION_TRANSFORM,
          position: { x: composition.width / 2, y: composition.height / 2 },
          ...(asRecord(layerInput?.transform) ?? {}),
        },
        keyframes: Array.isArray(layerInput?.keyframes) ? layerInput.keyframes : [],
      };

      let layer: MotionLayer;
      let nextComposition: MotionComposition = composition;

      switch (layerType) {
        case "text":
          layer = {
            ...base,
            type: "text",
            text: String(layerInput?.text ?? args.text ?? "New text"),
            style: {
              fontFamily: "Inter",
              fontSize: optionalNumber(layerInput?.fontSize) ?? 96,
              fontWeight: 800,
              color: String(layerInput?.color ?? args.color ?? "#ffffff"),
              align: "center",
              lineHeight: 1.05,
              ...(asRecord(layerInput?.style) ?? {}),
            },
          } as MotionTextLayer;
          break;
        case "shape": {
          const shapeType = (layerInput?.shapeType ??
            args.shapeType ??
            "rectangle") as MotionShapeLayer["shapeType"];
          if (!MOTION_SHAPE_TYPES.has(shapeType)) {
            return fail(`Unknown shapeType: ${String(shapeType)}`, "INVALID_PARAMS");
          }
          let pathData: string | undefined;
          let pathClosed: boolean | undefined;
          if (shapeType === "path") {
            const resolved = resolveShapePathData({
              pathData: layerInput?.pathData ?? args.pathData,
              pathPoints: layerInput?.pathPoints ?? args.pathPoints,
            });
            if ("error" in resolved) {
              return fail(resolved.error, "INVALID_PARAMS");
            }
            pathData = resolved.pathData;
            const closedRaw = layerInput?.pathClosed ?? args.pathClosed;
            pathClosed = closedRaw === undefined ? true : closedRaw === true;
          }
          layer = {
            ...base,
            type: "shape",
            shapeType,
            width:
              optionalNumber(layerInput?.width) ??
              optionalNumber(args.width) ??
              520,
            height:
              optionalNumber(layerInput?.height) ??
              optionalNumber(args.height) ??
              220,
            ...(pathData !== undefined ? { pathData } : {}),
            ...(pathClosed !== undefined ? { pathClosed } : {}),
            style: {
              ...DEFAULT_SHAPE_STYLE,
              fill: {
                type: "solid",
                color: String(layerInput?.color ?? args.color ?? "#14b8a6"),
                opacity: 1,
              },
            },
          } as MotionShapeLayer;
          break;
        }
        case "adjustment":
          layer = {
            ...createMotionAdjustmentLayer({
              id: base.id,
              name: layerName,
              startTime,
              duration,
              compositionWidth: composition.width,
              compositionHeight: composition.height,
            }),
            keyframes: base.keyframes,
          };
          break;
        case "null":
          layer = {
            ...createMotionNullLayer(composition, {
              id: base.id,
              name: layerName,
              startTime,
              duration,
              position: base.transform.position,
            }),
            keyframes: base.keyframes,
          };
          break;
        case "particle":
          layer = {
            ...createMotionParticleLayer(composition, {
              id: base.id,
              name: layerName,
              duration,
              position: base.transform.position,
              emitter: asRecord(args.emitter) as
                | Partial<MotionParticleEmitter>
                | undefined,
            }),
            startTime,
            keyframes: base.keyframes,
          };
          break;
        case "group":
          layer = {
            ...base,
            type: "group",
            children: Array.isArray(layerInput?.children)
              ? (layerInput.children as string[])
              : [],
          };
          break;
        case "image": {
          const assetId = optionalString(args.assetId) ?? optionalString(layerInput?.assetId);
          const mediaId = optionalString(args.mediaId) ?? optionalString(layerInput?.mediaId);
          let asset: MotionAsset | undefined = assetId
            ? composition.assets.find((candidate) => candidate.id === assetId)
            : undefined;
          if (!asset && mediaId) {
            const media = host
              .getProject()
              .mediaLibrary.items.find(
                (item: MediaItem) => item.id === mediaId,
              );
            if (!media) return fail(`Media not found: ${mediaId}`, "NOT_FOUND");
            if (media.type !== "image") {
              return fail("Only image media can back an image layer", "INVALID_PARAMS");
            }
            asset = {
              id: genId(),
              type: "image",
              name: media.name,
              mediaId: media.id,
              width: media.metadata.width,
              height: media.metadata.height,
            };
            nextComposition = {
              ...composition,
              assets: [...composition.assets, asset],
            };
          }
          if (!asset) {
            return fail(
              "image layer requires an existing assetId or an image mediaId",
              "INVALID_PARAMS",
            );
          }
          const imageLayer = createMotionImageLayerFromAsset(asset, {
            id: base.id,
            name: layerName,
            startTime,
            duration,
            compositionWidth: composition.width,
            compositionHeight: composition.height,
          });
          layer = { ...imageLayer, keyframes: base.keyframes } as MotionImageLayer;
          break;
        }
        case "composition": {
          const refCompositionId =
            optionalString(args.refCompositionId) ?? optionalString(layerInput?.compositionId);
          if (!refCompositionId) {
            return fail(
              "composition layer requires refCompositionId",
              "INVALID_PARAMS",
            );
          }
          const ref = getMotionComposition(host, refCompositionId);
          if (!ref) return fail(`Nested composition not found: ${refCompositionId}`, "NOT_FOUND");
          if (ref.id === composition.id) {
            return fail("A composition cannot embed itself", "INVALID_PARAMS");
          }
          layer = {
            ...base,
            type: "composition",
            compositionId: ref.id,
            width: ref.width,
            height: ref.height,
            timeOffset: optionalNumber(layerInput?.timeOffset) ?? 0,
            playbackRate: optionalNumber(layerInput?.playbackRate) ?? 1,
            fit: "contain",
          };
          break;
        }
        case "scene3d": {
          const heroObject: MotionObject3D = {
            kind: "rounded-box",
            size: 0.5,
            depth: 1,
            cornerRadius: 0.12,
          };
          layer = {
            ...createMotionScene3DLayer({
              id: base.id,
              name: layerName,
              startTime,
              duration,
              compositionWidth: composition.width,
              compositionHeight: composition.height,
              x: base.transform.position.x,
              y: base.transform.position.y,
              object: heroObject,
              objects: [
                {
                  id: genId(),
                  name: "Object 1",
                  object: heroObject,
                  material: {
                    kind: "physical",
                    color: "#10b981",
                    metalness: 0.1,
                    roughness: 0.4,
                  },
                  transform3d: {
                    position: { x: 0, y: 0, z: 0 },
                    rotation: { x: 0, y: 0, z: 0 },
                    scale: { x: 1, y: 1, z: 1 },
                  },
                },
              ],
              camera: {
                position: { x: 0, y: 0.5, z: 4 },
                target: { x: 0, y: 0, z: 0 },
                fov: 35,
              },
              lighting: { environment: "studio", groundShadow: true },
            }),
            keyframes: base.keyframes,
          };
          break;
        }
        default:
          return fail(
            `Unsupported motion layer type: ${layerType}`,
            "INVALID_PARAMS",
          );
      }

      const committed: MotionComposition = {
        ...nextComposition,
        layers: [...nextComposition.layers, layer],
        modifiedAt: Date.now(),
      };
      const result = await applyMotionAction(host, "motion/upsertComposition", {
        composition: committed,
      });
      return result.ok
        ? ok(`Added ${layer.type} layer "${layer.name}"`, {
            compositionId: composition.id,
            layerId: layer.id,
          })
        : result;
    },
  },
  {
    name: "apply_motion_template",
    domain: "motion",
    title: "Apply motion template",
    description:
      "Create a new Motion Creator composition from a built-in motion template/preset.",
    inputSchema: obj({ templateId: str, name: str }, ["templateId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const preset = getMotionPreset(String(args.templateId));
      if (!preset) return fail("Motion template not found", "NOT_FOUND");
      const composition = {
        ...preset.create(),
        name: typeof args.name === "string" ? args.name : preset.name,
        modifiedAt: Date.now(),
      };
      const result = await applyMotionAction(host, "motion/createComposition", {
        composition,
      });
      return result.ok
        ? ok(`Created "${composition.name}" from ${preset.name}`, {
            compositionId: composition.id,
            composition,
          })
        : result;
    },
  },
  {
    name: "generate_ad_scene",
    domain: "motion",
    title: "Generate ad scene",
    description:
      "Create a practical SaaS/product ad motion scene from headline/subheadline/brand color fields.",
    inputSchema: obj({
      headline: str,
      subheadline: str,
      ctaText: str,
      brandColor: str,
      duration: num,
      intensity: num,
    }),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const project = host.getProject();
      const headline = optionalString(args.headline) ?? "Launch faster";
      const subheadline =
        optionalString(args.subheadline) ?? "Show your product in motion";
      const ctaText = optionalString(args.ctaText) ?? "Get started";
      const brandColor = optionalString(args.brandColor) ?? "#14b8a6";
      const duration = clampNumber(optionalNumber(args.duration) ?? 10, 2, 60);
      const intensity = clampNumber(optionalNumber(args.intensity) ?? 0.75, 0, 1);
      const composition = motionEngine.createStarterComposition({
        name: "Generated Ad Scene",
        width: project.settings.width,
        height: project.settings.height,
        frameRate: project.settings.frameRate,
        duration,
        backgroundColor: "#111827",
      });

      const headlineVariable = createMotionVariable("text", {
        id: genId(),
        name: "Headline",
        value: headline,
      });
      const subheadlineVariable = createMotionVariable("text", {
        id: genId(),
        name: "Subheadline",
        value: subheadline,
      });
      const ctaVariable = createMotionVariable("text", {
        id: genId(),
        name: "CTA",
        value: ctaText,
      });
      const brandVariable = createMotionVariable("color", {
        id: genId(),
        name: "Brand color",
        value: brandColor,
      });
      const intensityVariable = createMotionVariable("number", {
        id: genId(),
        name: "Animation intensity",
        value: intensity,
      });

      const fadeOutStart = Math.max(0, duration - 0.75);
      const enterDistance = 54 + intensity * 72;
      const headlineY = composition.height * 0.42;
      const subheadlineY = composition.height * 0.57;
      const ctaY = composition.height * 0.72;

      const layers = composition.layers.map((layer): MotionLayer => {
        if (layer.type === "text") {
          const headlineLayer = addMotionLayerVariableBinding(
            {
              ...layer,
              name: "Headline",
              text: headline,
              transform: {
                ...layer.transform,
                position: { x: composition.width / 2, y: headlineY },
              },
              style: {
                ...layer.style,
                fontSize: Math.min(128, Math.max(72, composition.width * 0.06)),
                fontWeight: 850,
                lineHeight: 0.98,
              },
            },
            headlineVariable,
            "text.content",
            genId(),
          );
          return animateMotionLayerProperty(
            animateMotionLayerProperty(headlineLayer, "transform.opacity", [
              { time: 0, value: 0, easing: "ease-out" },
              { time: 0.55, value: 1, easing: "ease-out" },
              { time: fadeOutStart, value: 1, easing: "ease-in" },
              { time: duration, value: 0, easing: "ease-in" },
            ]),
            "transform.position.y",
            [
              { time: 0, value: headlineY + enterDistance, easing: "ease-out" },
              { time: 0.7, value: headlineY, easing: "ease-out" },
            ],
          );
        }
        if (layer.type === "shape") {
          const accentLayer = addMotionLayerVariableBinding(
            {
              ...layer,
              name: "Brand accent",
              width: Math.min(720, composition.width * 0.42),
              height: 18 + intensity * 10,
              transform: {
                ...layer.transform,
                position: { x: composition.width / 2, y: composition.height * 0.51 },
              },
              style: {
                ...layer.style,
                fill: { type: "solid" as const, color: brandColor, opacity: 1 },
                stroke: { color: brandColor, width: 0, opacity: 0 },
                cornerRadius: 999,
              },
            },
            brandVariable,
            "shape.fill.color",
            genId(),
          );
          return animateMotionLayerProperty(accentLayer, "transform.scale.x", [
            { time: 0.15, value: 0, easing: "ease-out" },
            { time: 0.85, value: 1, easing: "ease-out" },
          ]);
        }
        return layer;
      });

      const subheadlineLayer = animateMotionLayerProperty(
        animateMotionLayerProperty(
          addMotionLayerVariableBinding(
            {
              id: genId(),
              type: "text",
              name: "Subheadline",
              startTime: 0.35,
              duration: duration - 0.35,
              visible: true,
              locked: false,
              transform: {
                ...DEFAULT_MOTION_TRANSFORM,
                position: {
                  x: composition.width / 2,
                  y: subheadlineY,
                },
                opacity: 0.92,
              },
              keyframes: [],
              text: subheadline,
              style: {
                fontFamily: "Inter",
                fontSize: Math.min(54, Math.max(34, composition.width * 0.024)),
                fontWeight: 500,
                color: "#d1d5db",
                align: "center",
                lineHeight: 1.15,
              },
            },
            subheadlineVariable,
            "text.content",
            genId(),
          ),
          "transform.opacity",
          [
            { time: 0, value: 0, easing: "ease-out" },
            { time: 0.45, value: 0.92, easing: "ease-out" },
            { time: fadeOutStart - 0.35, value: 0.92, easing: "ease-in" },
            { time: duration - 0.35, value: 0, easing: "ease-in" },
          ],
        ),
        "transform.position.y",
        [
          { time: 0, value: subheadlineY + enterDistance * 0.45, easing: "ease-out" },
          { time: 0.55, value: subheadlineY, easing: "ease-out" },
        ],
      );

      const ctaShapeLayer = animateMotionLayerProperty(
        addMotionLayerVariableBinding(
          {
            id: genId(),
            type: "shape",
            name: "CTA button",
            startTime: 1.05,
            duration: duration - 1.05,
            visible: true,
            locked: false,
            transform: {
              ...DEFAULT_MOTION_TRANSFORM,
              position: { x: composition.width / 2, y: ctaY },
            },
            keyframes: [],
            shapeType: "rectangle",
            width: 300,
            height: 72,
            style: {
              ...DEFAULT_SHAPE_STYLE,
              fill: { type: "solid" as const, color: brandColor, opacity: 1 },
              stroke: { color: brandColor, width: 0, opacity: 0 },
              cornerRadius: 36,
            },
          },
          brandVariable,
          "shape.fill.color",
          genId(),
        ),
        "transform.scale.x",
        [
          { time: 0, value: 0.84, easing: "ease-out" },
          { time: 0.35, value: 1 + intensity * 0.05, easing: "ease-out" },
          { time: 0.58, value: 1, easing: "ease-out" },
        ],
      );

      const ctaTextLayer = animateMotionLayerProperty(
        animateMotionLayerProperty(
          addMotionLayerVariableBinding(
            {
              id: genId(),
              type: "text",
              name: "CTA text",
              startTime: 1.12,
              duration: duration - 1.12,
              visible: true,
              locked: false,
              transform: {
                ...DEFAULT_MOTION_TRANSFORM,
                position: { x: composition.width / 2, y: ctaY },
              },
              keyframes: [],
              text: ctaText,
              style: {
                fontFamily: "Inter",
                fontSize: 30,
                fontWeight: 800,
                color: "#071014",
                align: "center",
                lineHeight: 1,
              },
            },
            ctaVariable,
            "text.content",
            genId(),
          ),
          "transform.opacity",
          [
            { time: 0, value: 0, easing: "ease-out" },
            { time: 0.25, value: 1, easing: "ease-out" },
          ],
        ),
        "transform.scale.x",
        [
          { time: 0, value: 0.92, easing: "ease-out" },
          { time: 0.35, value: 1, easing: "ease-out" },
        ],
      );

      const nextComposition = {
        ...composition,
        variables: [
          headlineVariable,
          subheadlineVariable,
          ctaVariable,
          brandVariable,
          intensityVariable,
        ],
        layers: [...layers, subheadlineLayer, ctaShapeLayer, ctaTextLayer],
        modifiedAt: Date.now(),
      };
      const result = await applyMotionAction(host, "motion/createComposition", {
        composition: nextComposition,
      });
      return result.ok
        ? ok("Generated ad motion scene", {
            compositionId: nextComposition.id,
            variableIds: nextComposition.variables.map((variable) => variable.id),
            composition: nextComposition,
          })
        : result;
    },
  },
  {
    name: "animate_layer",
    domain: "motion",
    title: "Animate motion layer",
    description:
      "Author keyframes on a layer property (e.g. transform.opacity, transform.position.x, transform.scale.x, transform.rotation). Either pass from/to/startTime/endTime for a simple two-keyframe tween, or pass a `keyframes` array of { time, value, easing? } (>=2, strictly increasing times). Easing must be one of the known easing names (see get_capabilities motion.easings).",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      property: str,
      from: {},
      to: {},
      startTime: num,
      endTime: num,
      easing: str,
      keyframes: { type: "array" },
    }, ["compositionId", "layerId", "property"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      if (typeof args.layerId !== "string") {
        return fail("layerId is required", "INVALID_PARAMS");
      }
      const property =
        typeof args.property === "string" ? args.property : "transform.opacity";
      if (!isMotionAnimatableProperty(property)) {
        return fail(`Unsupported motion property: ${property}`, "INVALID_PARAMS");
      }
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");

      const keyframes: Array<{ time: number; value: number; easing: EasingType }> = [];

      if (Array.isArray(args.keyframes)) {
        if (args.keyframes.length < 2) {
          return fail("keyframes must contain at least 2 entries", "INVALID_PARAMS");
        }
        let previousTime = Number.NEGATIVE_INFINITY;
        for (const raw of args.keyframes) {
          const entry = asRecord(raw);
          const time = optionalNumber(entry?.time);
          const value = optionalNumber(entry?.value);
          if (time === undefined || value === undefined) {
            return fail("each keyframe needs finite time and value", "INVALID_PARAMS");
          }
          if (time <= previousTime) {
            return fail("keyframe times must be strictly increasing", "INVALID_PARAMS");
          }
          const easing = entry?.easing;
          if (easing !== undefined && !isValidEasing(easing)) {
            return fail(`Unknown easing: ${String(easing)}`, "INVALID_PARAMS");
          }
          previousTime = time;
          keyframes.push({ time, value, easing: isValidEasing(easing) ? easing : "ease" });
        }
      } else {
        if (
          typeof args.from !== "number" ||
          typeof args.to !== "number" ||
          !Number.isFinite(args.from) ||
          !Number.isFinite(args.to)
        ) {
          return fail("from and to must be finite numbers", "INVALID_PARAMS");
        }
        const startTime = optionalNumber(args.startTime) ?? 0;
        const endTime =
          optionalNumber(args.endTime) ?? Math.min(composition.duration, 0.6);
        if (endTime <= startTime) {
          return fail("endTime must be greater than startTime", "INVALID_PARAMS");
        }
        const easing = args.easing;
        if (easing !== undefined && !isValidEasing(easing)) {
          return fail(`Unknown easing: ${String(easing)}`, "INVALID_PARAMS");
        }
        const resolvedEasing: EasingType = isValidEasing(easing) ? easing : "ease-out";
        keyframes.push(
          { time: startTime, value: args.from, easing: resolvedEasing },
          { time: endTime, value: args.to, easing: resolvedEasing },
        );
      }

      const nextLayer = animateMotionLayerProperty(layer, property, keyframes);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Animated ${property} (${keyframes.length} keyframes)`, {
            compositionId: composition.id,
            layerId: layer.id,
          })
        : result;
    },
  },
  readTool(
    "list_motion_animatable_properties",
    "List animatable properties",
    "List the animatable properties of a motion layer (Transform always; Shape/Particle/Precomp by type; plus this layer's masks, effects, shape modifiers, and puppet pins), each with its current value at a time and every existing keyframe (id, time, value, easing, whether it has graph-editor bezier handles). Use this to discover keyframe ids before move/remove/re-ease, and to drive a graph-editor workflow.",
    obj({ compositionId: str, layerId: str, atTime: num }, ["compositionId", "layerId"]),
    (args, host) => {
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return { error: "Motion composition not found" };
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return { error: "Motion layer not found" };
      const atTime = optionalNumber(args.atTime) ?? 0;
      const staticDescriptors = MOTION_ANIMATABLE_PROPERTIES.filter((descriptor) => {
        if (descriptor.group === "Transform") return true;
        if (descriptor.group === "Shape") return layer.type === "shape";
        if (descriptor.group === "Particles") return layer.type === "particle";
        if (descriptor.group === "Precomp") return layer.type === "composition";
        return false;
      });
      const descriptors = [
        ...staticDescriptors,
        ...getMotionLayerMaskPropertyDescriptors(layer),
        ...getMotionLayerEffectPropertyDescriptors(layer),
        ...getMotionLayerShapeModifierPropertyDescriptors(layer),
        ...getMotionLayerContentsPropertyDescriptors(layer),
        ...getMotionLayerPuppetPropertyDescriptors(layer),
        ...getMotionLayerShaderFillPropertyDescriptors(layer),
      ];
      const properties = descriptors.map((descriptor) => {
        const property = descriptor.property as MotionAnimatableProperty;
        return {
          property: descriptor.property,
          label: descriptor.label,
          group: descriptor.group,
          unit: descriptor.unit,
          currentValue: getMotionLayerPropertyValueAtTime(layer, property, atTime),
          keyframes: getMotionLayerPropertyKeyframes(layer, descriptor.property).map((keyframe) => ({
            id: keyframe.id,
            time: keyframe.time,
            value: keyframe.value,
            easing: keyframe.easing,
            bezier: Boolean(keyframe.bezierHandles),
          })),
        };
      });
      return {
        compositionId: composition.id,
        layerId: layer.id,
        layerType: layer.type,
        atTime,
        propertyCount: properties.length,
        properties,
      };
    },
  ),
  {
    name: "add_motion_keyframe",
    domain: "motion",
    title: "Add/update motion keyframe",
    description:
      "Add or update a single keyframe at a time on a motion layer property (the AE 'stopwatch + set value at playhead' action). property is any animatable id: transform.* (e.g. transform.scale.x, transform.position.y, transform.opacity), shape.* (e.g. shape.cornerRadius), effect.<effectId>.<param>, mask.<maskId>.<prop> (prop = x|y|width|height|rotation|feather|expansion|opacity — mask bounds/feather keyframes), modifier.<modifierId>.<prop> (shape modifier fields, including repeater transform.position.x/y, transform.scale.x/y, transform.rotation, transform.opacity), and puppet.<pinId>.<prop>. Call list_motion_animatable_properties to enumerate the exact ids (including mask and modifier ids) for a layer. value defaults to the property's current value if omitted. easing is any known easing name. For a graph-editor curve, pass easing='bezier' with bezierIn {x,y} and bezierOut {x,y} normalized control points: bezierIn is P1 and bezierOut is P2 of the OUTGOING segment (this keyframe → the next one), normalized to that segment — x is the time fraction 0..1 across the segment and y is the value fraction of the segment's value delta. y may exceed [0,1] (e.g. y>1 overshoots past the target before settling, y<0 anticipates below the start). Re-calling at the same time updates that keyframe in place. roving (boolean) marks a middle keyframe as roving: its time is then AUTO-DERIVED (dropped from your input) so the property moves at constant speed between the surrounding non-roving anchor keyframes. A property's first and last keyframes can NEVER rove — requesting roving on an endpoint is a no-op. Toggling roving off restores an editable time.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      property: str,
      time: num,
      value: num,
      easing: str,
      bezierIn: { type: "object" },
      bezierOut: { type: "object" },
      roving: bool,
    }, ["compositionId", "layerId", "property", "time"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const property = optionalString(args.property);
      if (!property || !isMotionAnimatableProperty(property)) {
        return fail(`Unsupported motion property: ${String(args.property)}`, "INVALID_PARAMS");
      }
      const time = optionalNumber(args.time);
      if (time === undefined) return fail("time is required", "INVALID_PARAMS");

      const bezierIn = vec2FromObject(args.bezierIn);
      const bezierOut = vec2FromObject(args.bezierOut);
      const bezierHandles =
        bezierIn && bezierOut ? { in: bezierIn, out: bezierOut } : undefined;
      const easingInput = optionalString(args.easing);
      const easing = bezierHandles
        ? ("bezier" as const)
        : isValidEasing(easingInput)
          ? easingInput
          : undefined;

      const priorKeyframeIds = new Set(
        getMotionLayerPropertyKeyframes(layer, property).map(
          (keyframe) => keyframe.id,
        ),
      );
      const upserted = upsertMotionLayerKeyframe(layer, property, time, {
        value: optionalNumber(args.value),
        easing,
        bezierHandles,
      });
      const rovingRequested =
        typeof args.roving === "boolean" ? args.roving : undefined;
      const upsertedKeyframes = getMotionLayerPropertyKeyframes(
        upserted,
        property,
      );
      const upsertedKeyframe =
        upsertedKeyframes.find(
          (keyframe) => !priorKeyframeIds.has(keyframe.id),
        ) ??
        upsertedKeyframes.reduce<(typeof upsertedKeyframes)[number] | undefined>(
          (closest, keyframe) =>
            closest === undefined ||
            Math.abs(keyframe.time - time) < Math.abs(closest.time - time)
              ? keyframe
              : closest,
          undefined,
        );
      const nextLayer =
        rovingRequested !== undefined && upsertedKeyframe
          ? setMotionKeyframeRoving(
              upserted,
              property,
              upsertedKeyframe.id,
              rovingRequested,
            )
          : upserted;
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      if (!result.ok) return result;
      const keyframes = getMotionLayerPropertyKeyframes(nextLayer, property);
      const committedKeyframe = upsertedKeyframe
        ? keyframes.find((keyframe) => keyframe.id === upsertedKeyframe.id)
        : undefined;
      return ok(`Set keyframe on ${property} @ ${time.toFixed(3)}s`, {
        compositionId: composition.id,
        layerId: layer.id,
        property,
        time: committedKeyframe?.time ?? time,
        easing: easing ?? "ease",
        bezier: Boolean(bezierHandles),
        roving: committedKeyframe?.roving === true,
        keyframeCount: keyframes.length,
        keyframeIds: keyframes.map((keyframe) => keyframe.id),
      });
    },
  },
  {
    name: "move_motion_keyframe",
    domain: "motion",
    title: "Move motion keyframe",
    description:
      "Retime a single existing keyframe (by keyframeId) to a new time on a motion layer — like dragging a key in the AE timeline. Get keyframeIds from list_motion_animatable_properties. If another keyframe of the same property already sits at the new time, they merge.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      keyframeId: str,
      time: num,
    }, ["compositionId", "layerId", "keyframeId", "time"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const keyframeId = optionalString(args.keyframeId);
      const time = optionalNumber(args.time);
      if (!keyframeId || time === undefined) {
        return fail("keyframeId and time are required", "INVALID_PARAMS");
      }
      if (!layer.keyframes.some((keyframe) => keyframe.id === keyframeId)) {
        return fail(`Keyframe not found: ${keyframeId}`, "NOT_FOUND");
      }
      const nextLayer = moveMotionLayerKeyframe(layer, keyframeId, time);
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Moved keyframe ${keyframeId} to ${time.toFixed(3)}s`, {
            compositionId: composition.id,
            layerId: layer.id,
            keyframeId,
            time,
          })
        : result;
    },
  },
  {
    name: "remove_motion_keyframe",
    domain: "motion",
    title: "Remove motion keyframe",
    description:
      "Delete a single keyframe (by keyframeId) from a motion layer, or pass property to clear ALL keyframes on that property (turn the property back into a static value). Get keyframeIds from list_motion_animatable_properties.",
    inputSchema: obj({
      compositionId: str,
      layerId: str,
      keyframeId: str,
      property: str,
    }, ["compositionId", "layerId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const keyframeId = optionalString(args.keyframeId);
      const property = optionalString(args.property);
      if (!keyframeId && !property) {
        return fail("Provide keyframeId or property", "INVALID_PARAMS");
      }
      const before = layer.keyframes.length;
      const nextLayer = keyframeId
        ? removeMotionLayerKeyframe(layer, keyframeId)
        : removeMotionLayerPropertyKeyframes(layer, property as string);
      const removed = before - nextLayer.keyframes.length;
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(
            keyframeId
              ? `Removed keyframe ${keyframeId}`
              : `Cleared ${removed} keyframe(s) on ${property}`,
            {
              compositionId: composition.id,
              layerId: layer.id,
              removed,
            },
          )
        : result;
    },
  },
  {
    name: "sync_motion_to_audio",
    domain: "motion",
    title: "Sync motion to audio",
    description:
      "Sync a motion composition to audio. If a `mediaId` (or audioClipId referencing audio with waveform data) is given, real beat markers are detected from the waveform; otherwise a beat grid is generated from `bpm`. Optional `sensitivity` (0-1, higher detects more beats) and `startTime` (seconds offset for the grid/detection). Also adds an intensity variable. Returns `markerTimes` (the beat times in seconds) so you can drive follow-up keyframing.",
    inputSchema: obj({
      compositionId: str,
      audioClipId: str,
      mediaId: str,
      intensity: num,
      bpm: num,
      beatsPerBar: num,
      sensitivity: num,
      startTime: num,
    }, ["compositionId"]),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const intensity = clampNumber(optionalNumber(args.intensity) ?? 0.6, 0, 1);
      const bpm = clampNumber(optionalNumber(args.bpm) ?? 120, 1, 999);
      const beatsPerBar = Math.max(1, Math.round(optionalNumber(args.beatsPerBar) ?? 4));
      const sensitivity = clampNumber(optionalNumber(args.sensitivity) ?? 0.65, 0, 1);
      const startTime = Math.max(0, optionalNumber(args.startTime) ?? 0);
      const audioSyncVariable = createMotionVariable("number", {
        id: "audio-intensity",
        name: "Audio intensity",
        value: intensity,
      });

      const requestedMediaId =
        optionalString(args.mediaId) ??
        (composition.audioClips ?? []).find(
          (clip) => clip.id === optionalString(args.audioClipId),
        )?.mediaId;
      const mediaItems = host.getProject().mediaLibrary.items;
      const waveformMedia = mediaItems.find(
        (item) =>
          item.waveformData &&
          item.waveformData.length > 0 &&
          item.metadata.duration > 0 &&
          (requestedMediaId ? item.id === requestedMediaId : item.type !== "image"),
      );

      const detectedBeats = waveformMedia?.waveformData
        ? detectMotionBeatMarkersFromPeaks(waveformMedia.waveformData, {
            duration: waveformMedia.metadata.duration,
            compositionDuration: composition.duration,
            beatsPerBar,
            sensitivity,
            startTime,
          })
        : [];
      const usedWaveform = detectedBeats.length > 0;
      const beatMarkers = usedWaveform
        ? detectedBeats
        : generateMotionBeatMarkersAtBpm({
            bpm,
            duration: composition.duration,
            beatsPerBar,
            startTime,
          });
      const withBeats = setMotionBeatMarkers(composition, beatMarkers, {
        bpm,
        confidence: usedWaveform ? 0.85 : 0.5,
        sourceClipId: optionalString(args.audioClipId) ?? waveformMedia?.id,
        analyzedAt: Date.now(),
      });
      const nextComposition = {
        ...withBeats,
        variables: [
          ...withBeats.variables.filter((variable) => variable.id !== "audio-intensity"),
          audioSyncVariable,
        ],
        markers: [
          ...withBeats.markers,
          {
            id: genId(),
            time: 0,
            label: typeof args.audioClipId === "string"
              ? `Audio sync: ${args.audioClipId}`
              : "Audio sync",
            color: "#14b8a6",
          },
        ],
        modifiedAt: Date.now(),
      };
      const result = await applyMotionAction(host, "motion/upsertComposition", {
        composition: nextComposition,
      });
      return result.ok
        ? ok(
            usedWaveform
              ? "Synced motion composition to detected audio beats"
              : "Prepared motion composition with a generated beat grid",
            {
              compositionId: composition.id,
              intensity,
              bpm,
              beatMarkers: beatMarkers.length,
              markerTimes: beatMarkers.map((marker) => marker.time),
              source: usedWaveform ? "waveform" : "bpm",
            },
          )
        : result;
    },
  },
  {
    name: "set_motion_beat_markers",
    domain: "motion",
    title: "Set motion beat markers",
    description:
      "Set the composition's beat markers explicitly from an array of `times` (seconds). Replaces any existing beat markers. Optional `strengths` (parallel array, 0-1; defaults to 1) and `bpm` (recorded on the beat analysis). Use apply_motion_preset_to_beats to animate a layer on these beats. Returns the marker times.",
    inputSchema: obj(
      { compositionId: str, times: { type: "array" }, strengths: { type: "array" }, bpm: num },
      ["compositionId", "times"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      if (!Array.isArray(args.times)) {
        return fail("times must be an array of numbers", "INVALID_PARAMS");
      }
      const strengthsRaw = Array.isArray(args.strengths) ? args.strengths : [];
      const beatMarkers = [] as {
        time: number;
        strength: number;
        index: number;
        isDownbeat: boolean;
      }[];
      for (let index = 0; index < args.times.length; index += 1) {
        const time = optionalNumber(args.times[index]);
        if (time === undefined) {
          return fail("times must contain only finite numbers", "INVALID_PARAMS");
        }
        beatMarkers.push({
          time: Math.max(0, time),
          strength: clampNumber(optionalNumber(strengthsRaw[index]) ?? 1, 0, 1),
          index,
          isDownbeat: index % 4 === 0,
        });
      }
      const bpm = optionalNumber(args.bpm);
      const nextComposition = setMotionBeatMarkers(
        composition,
        beatMarkers,
        bpm !== undefined
          ? { bpm: clampNumber(bpm, 1, 999), confidence: 1, analyzedAt: Date.now() }
          : undefined,
      );
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok(`Set ${beatMarkers.length} beat markers`, {
            compositionId: composition.id,
            markerTimes: (nextComposition.beatMarkers ?? []).map((marker) => marker.time),
          })
        : result;
    },
  },
  {
    name: "remove_motion_beat_marker",
    domain: "motion",
    title: "Remove motion beat marker",
    description:
      "Remove a single beat marker from the composition by its `index` (0-based position in the beat marker list). Remaining markers are re-indexed. Returns the updated marker times.",
    inputSchema: obj({ compositionId: str, index: num }, ["compositionId", "index"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const index = optionalNumber(args.index);
      const beatMarkers = composition.beatMarkers ?? [];
      if (index === undefined || !Number.isInteger(index) || index < 0 || index >= beatMarkers.length) {
        return fail("index must be a valid beat marker index", "INVALID_PARAMS");
      }
      const remaining = beatMarkers.filter((_, position) => position !== index);
      const nextComposition = setMotionBeatMarkers(
        composition,
        remaining,
        composition.beatAnalysis,
      );
      const result = await commitMotionComposition(host, nextComposition);
      return result.ok
        ? ok("Removed beat marker", {
            compositionId: composition.id,
            markerTimes: (nextComposition.beatMarkers ?? []).map((marker) => marker.time),
          })
        : result;
    },
  },
  {
    name: "apply_motion_preset_to_beats",
    domain: "motion",
    title: "Apply motion preset to beats",
    description:
      "Apply an animation preset to a layer at every detected beat (run sync_motion_to_audio or set_motion_beat_markers first). presetId is one of the get_capabilities motion.animationPresets (e.g. pulse, scale-pop, fade-in). Optional: duration (per-beat, capped to the gap to the next beat), onlyDownbeats (bool), distance, intensity, startTime, endTime, maxBeats. Fails if the composition has no beat markers.",
    inputSchema: obj(
      {
        compositionId: str,
        layerId: str,
        presetId: str,
        duration: num,
        onlyDownbeats: bool,
        distance: num,
        intensity: num,
        startTime: num,
        endTime: num,
        maxBeats: num,
      },
      ["compositionId", "layerId", "presetId"],
    ),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const layer = getMotionLayer(composition, args.layerId);
      if (!layer) return fail("Motion layer not found", "NOT_FOUND");
      const presetId = optionalString(args.presetId) as MotionAnimationPresetId | undefined;
      if (!presetId || !MOTION_ANIMATION_PRESET_IDS.has(presetId)) {
        return fail(`Unknown presetId: ${String(args.presetId)}`, "INVALID_PARAMS");
      }
      const preset = getMotionAnimationPreset(presetId);
      if (!preset) return fail("Animation preset not found", "INVALID_PARAMS");
      if (!canApplyMotionAnimationPreset(layer, preset)) {
        return fail(`Layer does not support the ${presetId} preset`, "INVALID_PARAMS");
      }
      const beatMarkers = composition.beatMarkers ?? [];
      if (beatMarkers.length === 0) {
        return fail(
          "Composition has no beat markers — run sync_motion_to_audio or set_motion_beat_markers first",
          "INVALID_PARAMS",
        );
      }
      const onlyDownbeats =
        typeof args.onlyDownbeats === "boolean" ? args.onlyDownbeats : undefined;
      const nextLayer = applyMotionAnimationPresetToBeats(layer, presetId, beatMarkers, {
        duration: optionalNumber(args.duration),
        distance: optionalNumber(args.distance),
        intensity: optionalNumber(args.intensity),
        startTime: optionalNumber(args.startTime),
        endTime: optionalNumber(args.endTime),
        maxBeats: optionalNumber(args.maxBeats),
        ...(onlyDownbeats !== undefined ? { onlyDownbeats } : {}),
      });
      const result = await commitMotionComposition(
        host,
        replaceMotionLayer(composition, layer.id, nextLayer),
      );
      return result.ok
        ? ok(`Applied ${presetId} on beats`, {
            compositionId: composition.id,
            layerId: layer.id,
            beats: beatMarkers.length,
          })
        : result;
    },
  },
  {
    name: "insert_motion_into_editor",
    domain: "motion",
    title: "Insert motion into editor",
    description:
      "Place a motion composition into the normal video-editor timeline as a reusable rendered scene.",
    inputSchema: obj({
      compositionId: str,
      startTime: num,
      duration: num,
      trackId: str,
      name: str,
    }, ["compositionId"]),
    readOnly: false,
    destructive: false,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      const instance = motionEngine.createInstance(composition, {
        startTime: optionalNumber(args.startTime),
        duration: optionalNumber(args.duration),
        trackId: typeof args.trackId === "string" ? args.trackId : undefined,
        name: typeof args.name === "string" ? args.name : undefined,
      });
      const result = await applyMotionAction(host, "motion/insertInstance", {
        instance,
      });
      return result.ok
        ? ok(`Inserted motion scene "${composition.name}"`, {
            instanceId: instance.id,
            compositionId: composition.id,
          })
        : result;
    },
  },
  readTool(
    "get_motion_composition",
    "Get motion composition",
    "Full detail for one Motion Creator composition: every layer with its id, type, transform, keyframes, and type-specific fields, plus variables, markers, beat markers, camera, and lights. Use this to recover auto-generated layer ids before animating or editing.",
    obj({ compositionId: str }, ["compositionId"]),
    (args, host) => {
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) {
        return { error: "Motion composition not found", compositionId: args.compositionId };
      }
      return serializeMotionComposition(composition);
    },
  ),
  {
    name: "render_motion_frame",
    domain: "motion",
    title: "Render motion frame",
    description:
      "Render a Motion Creator composition to a still image at a given time so YOU can SEE the current result and self-correct (layout, z-order, color, text wrap). Inputs: compositionId (required), timeSeconds (default 0), scale (1-2 supersample), quality ('draft' = 1x fast, 'final' = 2x supersampled). An explicit scale overrides quality. Returns the image attached to the result. Expensive — requires confirmation.",
    inputSchema: obj({
      compositionId: str,
      timeSeconds: num,
      scale: num,
      quality: str,
    }, ["compositionId"]),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const composition = getMotionComposition(host, args.compositionId);
      if (!composition) return fail("Motion composition not found", "NOT_FOUND");
      return renderMotionFrameResult(host, composition, args);
    },
  },
  {
    name: "render_creation_preview",
    domain: "motion",
    title: "Render creation preview",
    description:
      "Render a still preview image for a semantic OpenReel creation scene by resolving its bound Motion Creator scene3d composition/layer. Use this after create_creation_3d_scene, sync_creation_scene_to_motion, or product cinematic creation to visually inspect agent-native creation work. If the binding/composition/layer is missing, call sync_creation_scene_to_motion first.",
    inputSchema: obj({
      sceneId: str,
      compositionId: str,
      timeSeconds: num,
      scale: num,
    }),
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const state = creationState(host);
      if (!state) return fail("No creation state is available", "NOT_FOUND");
      const scene = resolveCreationScene(state, args.sceneId);
      if (!scene) return fail("Creation scene not found", "NOT_FOUND");
      const compositionId = optionalString(args.compositionId);
      const scene3DBindings = scene.renderBindings.filter(
        (candidate) => candidate.kind === "motion-scene3d",
      );
      const binding = compositionId
        ? scene3DBindings.find((candidate) => candidate.compositionId === compositionId)
        : scene3DBindings[0];
      if (!binding) {
        return fail(
          "Creation scene has no Motion scene3d render binding; call sync_creation_scene_to_motion first",
          "NOT_FOUND",
        );
      }
      const composition = getMotionComposition(host, binding.compositionId);
      if (!composition) {
        return fail(
          `Bound Motion composition not found: ${binding.compositionId}; call sync_creation_scene_to_motion first`,
          "NOT_FOUND",
        );
      }
      const layer = composition.layers.find((candidate) => candidate.id === binding.layerId);
      if (!layer || layer.type !== "scene3d") {
        return fail(
          `Bound scene3d layer not found: ${binding.layerId}; call sync_creation_scene_to_motion first`,
          "NOT_FOUND",
        );
      }
      return renderMotionFrameResult(host, composition, args, {
        summary: `Rendered creation scene "${scene.name}" via "${composition.name}"`,
        data: {
          sceneId: scene.id,
          layerId: binding.layerId,
          renderBindingId: binding.id,
          objectCount: scene.objects.length,
        },
      });
    },
  }
];
