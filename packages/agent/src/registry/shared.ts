import {
  type Action,
} from "@openreel/core/types/actions";
import {
  type BlendMode,
} from "@openreel/core/video/types";
import {
  type BuildMotionUiLayerContext,
  MOTION_UI_COMPONENT_TYPES,
  type MotionUiComponentType,
  type MotionUiLayerSpec,
  type MotionUiLayerType,
  type MotionUiShapeStyleSpec,
  type MotionUiTextStyleSpec,
  reflowMotionAutoLayoutGroups,
} from "@openreel/core/motion/motion-ui-builder";
import {
  type ClothPin,
  type CreationAnimationClip,
  type CreationAnimationKeyframe,
  type CreationAnimationTrack,
  type CreationAssetKind,
  type CreationAssetRecipe,
  type CreationCamera,
  type CreationLight,
  type CreationMaterial,
  type CreationMaterialModel,
  type CreationOperation,
  type CreationParameters,
  type CreationProjectState,
  type CreationRenderBinding,
  type CreationRenderObjectBinding,
  type CreationScene,
  type CreationSceneObject,
  type CreationValidationIssue,
  type HumanoidAnimation,
  type RigidBody,
  type Transform3D,
  bakeRecipeMesh,
  bakeRigidBodyTracks,
  buildSkinnedHumanoid,
  buildSkinnedLimb,
  clothToMesh,
  createClothGrid,
  humanoidAnimationPose,
  limbWavePose,
  makeRigidBody,
  skinMesh,
  spawnParticles,
  stepCloth,
  stepParticles,
  summarizeCreationState,
} from "@openreel/core/creation/index";
import {
  type CornerRadii,
  type GradientStop,
  type GradientStyle,
  SHAPE_TYPES,
  type ShadowStyle,
  type ShapeStyle,
  type ShapeType,
} from "@openreel/core/graphics/types";
import {
  DEFAULT_MOTION_TRANSFORM,
  MOTION_SHAPE_MODIFIER_TYPES as MOTION_SHAPE_MODIFIER_TYPE_LIST,
  type MotionComposition,
  type MotionEffect,
  type MotionEffectType,
  type MotionExpression,
  type MotionExpressionType,
  type MotionLayer,
  type MotionLightType,
  type MotionMask,
  type MotionMaterial3D,
  type MotionObject3D,
  type MotionObject3DKind,
  type MotionObjectMeshData,
  type MotionObjectMeshFrames,
  type MotionScene3DCamera,
  type MotionScene3DLayer,
  type MotionScene3DLighting,
  type MotionScene3DRoom,
  type MotionSceneObject3D,
  type MotionSceneVector3,
  type MotionShapeGroupItem,
  type MotionShapeGroupTransform,
  type MotionShapeItem,
  type MotionShapeLayer,
  type MotionShapeMergeMode,
  type MotionShapeModifierType,
  type MotionTextAnimator,
  type MotionTextLayer,
  type MotionTrackMatteType,
  type MotionVariable,
  type MotionVector2,
} from "@openreel/core/motion/types";
import {
  EASING_TYPES,
  type EasingType,
  type Keyframe,
} from "@openreel/core/types/timeline";
import {
  type EditingHost,
  type ExportMotionSceneFormat,
  type JobKind,
  type MotionRenderQueueAddFormat,
} from "../host";
import {
  type JSONSchema,
  type ToolDomain,
  type ToolResult,
} from "../types";
import {
  MOTION_ANIMATION_PRESETS,
  type MotionAnimationPresetId,
} from "@openreel/core/motion/motion-animation-presets";
import {
  MOTION_BLEND_MODE_OPTIONS,
} from "@openreel/core/motion/motion-blend-modes";
import {
  MOTION_OBJECT_3D_KINDS,
  createMotionScene3DLayer,
} from "@openreel/core/motion/motion-scene3d";
import {
  type MotionEffectNumericParameter,
} from "@openreel/core/motion/motion-effects";
import {
  type MotionLayerAlignment,
} from "@openreel/core/motion/motion-layout";
import {
  type MotionShaderCategory,
  type MotionShaderDef,
  type MotionShaderParamDef,
  type MotionShaderParamType,
} from "@openreel/core/motion/shaders/index";
import {
  type MotionShapePathPoint,
  buildMotionPathData,
  parseMotionPathSegments,
} from "@openreel/core/motion/motion-shape-path";
import {
  createShapeGroupItem,
  createShapePathItem,
  getMotionShapeContents,
  hasExplicitShapeContents,
} from "@openreel/core/motion/motion-shape-contents";
import {
  isMotionAnimatableProperty,
  upsertMotionLayerKeyframe,
} from "@openreel/core/motion/motion-keyframes";
import type { RegisteredTool } from "./types";
import { obj, str } from "./schema";
import { fail, ok } from "./results";
export type { ToolHandler, RegisteredTool, NamedToolSchema } from "./types";
export { str, num, bool, obj, timelineKeyframePropertySchema, easingSchema, timelineKeyframeInputSchema, clipTransformSchema } from "./schema";
export { ok, fail } from "./results";

export const genId = (): string =>
  (
    globalThis as unknown as { crypto?: { randomUUID?: () => string } }
  ).crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function vec2FromObject(
  value: unknown,
): { readonly x: number; readonly y: number } | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const x = optionalNumber(record.x);
  const y = optionalNumber(record.y);
  if (x === undefined || y === undefined) return undefined;
  return { x, y };
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function hashStringToSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100000;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const resolveShaderParams = (
  def: MotionShaderDef,
  raw: Record<string, unknown> | undefined,
): Record<string, number | string> => {
  const params: Record<string, number | string> = {};
  for (const p of def.params) {
    if (p.type === "color") {
      const suppliedColor = raw ? optionalString(raw[p.name]) : undefined;
      params[p.name] = suppliedColor ?? p.default;
      continue;
    }
    const supplied = raw ? optionalNumber(raw[p.name]) : undefined;
    const fallback = typeof p.default === "number" && Number.isFinite(p.default) ? p.default : 0;
    params[p.name] = supplied === undefined ? fallback : clampNumber(supplied, p.min, p.max);
  }
  return params;
};

export const AI_SHADER_CATEGORIES: readonly MotionShaderCategory[] = ["fill", "effect", "text"];

export function isMotionShaderCategory(value: unknown): value is MotionShaderCategory {
  return (
    typeof value === "string" &&
    (AI_SHADER_CATEGORIES as readonly string[]).includes(value)
  );
}

export function kebabCase(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "shader";
}

export function shortGlslHash(glsl: string): string {
  let hash = 2166136261;
  for (let index = 0; index < glsl.length; index += 1) {
    hash ^= glsl.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeAiShaderParams(
  value: unknown,
): { readonly ok: true; readonly params: readonly MotionShaderParamDef[] } | { readonly ok: false; readonly error: string } {
  if (value === undefined || value === null) return { ok: true, params: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: "params must be an array" };
  }
  const params: MotionShaderParamDef[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) return { ok: false, error: "each param must be an object" };
    const rawName = optionalString(record.name);
    const name = rawName ? rawName.replace(/^u_/, "") : undefined;
    const label = optionalString(record.label);
    if (!name) return { ok: false, error: "each param requires a name" };
    if (!label) return { ok: false, error: `param "${name}" requires a label` };
    const min = optionalNumber(record.min);
    const max = optionalNumber(record.max);
    const defaultValue = optionalNumber(record.default);
    if (min === undefined || max === undefined || defaultValue === undefined) {
      return { ok: false, error: `param "${name}" requires numeric min, max, and default` };
    }
    if (max < min) {
      return { ok: false, error: `param "${name}" has max < min` };
    }
    const step = optionalNumber(record.step) ?? 0.01;
    const rawType = optionalString(record.type);
    const type: MotionShaderParamType = rawType === "color" ? "color" : "number";
    const rawControl = optionalString(record.control);
    const control: MotionShaderParamDef["control"] | undefined =
      rawControl === "slider" || rawControl === "number" ? rawControl : undefined;
    params.push({
      name,
      label,
      type,
      min,
      max,
      default: clampNumber(defaultValue, min, max),
      step,
      ...(control ? { control } : {}),
    });
  }
  return { ok: true, params };
}

export function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) result.push(entry.trim());
  }
  return result.length > 0 ? result : undefined;
}

export function parseMaskPolygonPoints(
  value: unknown,
): readonly { readonly x: number; readonly y: number }[] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const points: { readonly x: number; readonly y: number }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return undefined;
    const candidate = entry as { x?: unknown; y?: unknown };
    if (
      typeof candidate.x !== "number" ||
      typeof candidate.y !== "number" ||
      !Number.isFinite(candidate.x) ||
      !Number.isFinite(candidate.y)
    ) {
      return undefined;
    }
    points.push({ x: candidate.x, y: candidate.y });
  }
  return points;
}

export function parseMaskPathPoints(
  value: unknown,
): readonly MotionShapePathPoint[] | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const points: MotionShapePathPoint[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return undefined;
    const candidate = entry as {
      x?: unknown;
      y?: unknown;
      inX?: unknown;
      inY?: unknown;
      outX?: unknown;
      outY?: unknown;
    };
    if (
      typeof candidate.x !== "number" ||
      typeof candidate.y !== "number" ||
      !Number.isFinite(candidate.x) ||
      !Number.isFinite(candidate.y)
    ) {
      return undefined;
    }
    for (const handle of [candidate.inX, candidate.inY, candidate.outX, candidate.outY]) {
      if (handle !== undefined && handle !== null) {
        if (typeof handle !== "number" || !Number.isFinite(handle)) return undefined;
      }
    }
    const point: MotionShapePathPoint = {
      x: candidate.x,
      y: candidate.y,
      ...(typeof candidate.inX === "number" && Number.isFinite(candidate.inX)
        ? { inX: candidate.inX }
        : {}),
      ...(typeof candidate.inY === "number" && Number.isFinite(candidate.inY)
        ? { inY: candidate.inY }
        : {}),
      ...(typeof candidate.outX === "number" && Number.isFinite(candidate.outX)
        ? { outX: candidate.outX }
        : {}),
      ...(typeof candidate.outY === "number" && Number.isFinite(candidate.outY)
        ? { outY: candidate.outY }
        : {}),
    };
    points.push(point);
  }
  return points;
}

export function parseShapePathPoints(
  value: unknown,
): readonly MotionShapePathPoint[] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const points: MotionShapePathPoint[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return undefined;
    const candidate = entry as {
      x?: unknown;
      y?: unknown;
      inX?: unknown;
      inY?: unknown;
      outX?: unknown;
      outY?: unknown;
    };
    if (
      typeof candidate.x !== "number" ||
      typeof candidate.y !== "number" ||
      !Number.isFinite(candidate.x) ||
      !Number.isFinite(candidate.y)
    ) {
      return undefined;
    }
    for (const handle of [candidate.inX, candidate.inY, candidate.outX, candidate.outY]) {
      if (handle !== undefined && handle !== null) {
        if (typeof handle !== "number" || !Number.isFinite(handle)) return undefined;
      }
    }
    points.push({
      x: candidate.x,
      y: candidate.y,
      ...(typeof candidate.inX === "number" && Number.isFinite(candidate.inX)
        ? { inX: candidate.inX }
        : {}),
      ...(typeof candidate.inY === "number" && Number.isFinite(candidate.inY)
        ? { inY: candidate.inY }
        : {}),
      ...(typeof candidate.outX === "number" && Number.isFinite(candidate.outX)
        ? { outX: candidate.outX }
        : {}),
      ...(typeof candidate.outY === "number" && Number.isFinite(candidate.outY)
        ? { outY: candidate.outY }
        : {}),
    });
  }
  return points;
}

export function resolveShapePathData(
  args: Record<string, unknown>,
): { readonly pathData: string } | { readonly error: string } {
  const pathData = optionalString(args.pathData);
  if (pathData) {
    const parsed = parseMotionPathSegments(pathData);
    if (parsed.length < 2) {
      return { error: "pathData must describe at least 2 points" };
    }
    return { pathData };
  }
  if (args.pathPoints !== undefined) {
    const supplied = parseShapePathPoints(args.pathPoints);
    if (!supplied) {
      return {
        error:
          "pathPoints must be an array of >=2 finite {x,y,inX?,inY?,outX?,outY?} vertices",
      };
    }
    return { pathData: buildMotionPathData(supplied) };
  }
  return { error: "provide pathData or pathPoints for a path shape" };
}

export const CONTENTS_KEYFRAME_GRAMMAR =
  "Keyframe any group transform, item path, or operator param via add_motion_keyframe with property ids contents.{itemId}.transform.{positionX|positionY|scaleX|scaleY|rotation|opacity}, contents.{itemId}.pathData, and contents.{itemId}.operator.{operatorId}.{param} (offset-paths.amount, pucker-bloat.amount, twist.angle).";

export function requireShapeLayer(
  composition: MotionComposition,
  layerId: unknown,
): { readonly layer: MotionShapeLayer } | { readonly error: ToolResult } {
  const layer = getMotionLayer(composition, layerId);
  if (!layer) return { error: fail("Motion layer not found", "NOT_FOUND") };
  if (layer.type !== "shape") {
    return {
      error: fail("Shape contents require a shape layer", "INVALID_PARAMS"),
    };
  }
  return { layer };
}

export function parseMotionShapeGroupTransform(
  value: unknown,
): MotionShapeGroupTransform | { readonly error: string } {
  const record = asRecord(value);
  if (!record) return { error: "transform must be an object" };
  const anchor = vec2FromObject(record.anchor);
  const position = vec2FromObject(record.position);
  const scale = vec2FromObject(record.scale);
  const rotation = optionalNumber(record.rotation);
  const opacity = optionalNumber(record.opacity);
  if (!anchor || !position || !scale || rotation === undefined || opacity === undefined) {
    return {
      error:
        "transform requires anchor {x,y}, position {x,y}, scale {x,y}, rotation (number), opacity (number)",
    };
  }
  return {
    anchor,
    position,
    scale,
    rotation,
    opacity: clampNumber(opacity, 0, 1),
  };
}

export function synthesizeSourceShapeGroup(
  layer: MotionShapeLayer,
  center: MotionVector2,
): MotionShapeGroupItem {
  const wrapperTransform: MotionShapeGroupTransform = {
    anchor: {
      x: layer.transform.anchor.x,
      y: layer.transform.anchor.y,
    },
    position: {
      x: layer.transform.position.x - center.x,
      y: layer.transform.position.y - center.y,
    },
    scale: {
      x: layer.transform.scale.x,
      y: layer.transform.scale.y,
    },
    rotation: layer.transform.rotation,
    opacity: layer.transform.opacity ?? 1,
  };
  const base = createShapeGroupItem(layer.name);
  const items = hasExplicitShapeContents(layer)
    ? [...getMotionShapeContents(layer)]
    : buildLegacySourceItems(layer);
  return {
    ...base,
    transform: wrapperTransform,
    style: layer.style,
    items,
  };
}

export function buildLegacySourceItems(
  layer: MotionShapeLayer,
): readonly MotionShapeItem[] {
  const [root] = getMotionShapeContents(layer);
  if (!root || root.kind !== "path") {
    throw new Error("Failed to synthesize source shape geometry");
  }
  return [
    {
      ...root,
      id: createShapePathItem({ name: layer.name }).id,
      name: layer.name,
      position: { x: 0, y: 0 },
    },
  ];
}

export function parseGradientStops(value: unknown): GradientStop[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const stops: GradientStop[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const offset = optionalNumber(record?.offset);
    const color = optionalString(record?.color);
    if (offset === undefined || !color) return undefined;
    const opacity = optionalNumber(record?.opacity);
    stops.push({
      offset: clampNumber(offset, 0, 1),
      color,
      ...(opacity !== undefined ? { opacity: clampNumber(opacity, 0, 1) } : {}),
    });
  }
  return stops;
}

export function parseGradientStyle(value: unknown): GradientStyle | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const type = optionalString(record.type);
  if (type !== "linear" && type !== "radial" && type !== "conic") return undefined;
  const stops = parseGradientStops(record.stops);
  if (!stops) return undefined;
  const angle = optionalNumber(record.angle);
  const center = asRecord(record.center);
  const centerX = optionalNumber(center?.x);
  const centerY = optionalNumber(center?.y);
  return {
    type,
    ...(angle !== undefined ? { angle } : {}),
    ...(centerX !== undefined && centerY !== undefined
      ? { center: { x: centerX, y: centerY } }
      : {}),
    stops,
  };
}

export function sceneEasing(value: unknown): EasingType {
  const easing = optionalString(value);
  return easing && isValidEasing(easing) ? easing : "ease";
}

export function motionModelAnimationFromArgs(
  raw: Record<string, unknown>,
): MotionObject3D["animation"] | undefined {
  const nested = asRecord(raw.animation);
  const clipName = optionalString(
    raw.animationClipName ??
      raw.clipName ??
      raw.animationName ??
      nested?.clipName ??
      raw.animation,
  );
  const clipIndex = optionalNumber(
    raw.animationClipIndex ?? raw.clipIndex ?? nested?.clipIndex,
  );
  const timeOffset = optionalNumber(
    raw.animationTimeOffset ?? raw.timeOffset ?? nested?.timeOffset,
  );
  const playbackRate = optionalNumber(
    raw.animationPlaybackRate ?? raw.playbackRate ?? nested?.playbackRate,
  );
  const loop =
    typeof raw.animationLoop === "boolean"
      ? raw.animationLoop
      : typeof nested?.loop === "boolean"
        ? nested.loop
      : typeof raw.loop === "boolean"
        ? raw.loop
        : undefined;
  if (
    clipName === undefined &&
    clipIndex === undefined &&
    timeOffset === undefined &&
    playbackRate === undefined &&
    loop === undefined
  ) {
    return undefined;
  }
  return {
    ...(clipName !== undefined ? { clipName } : {}),
    ...(clipIndex !== undefined ? { clipIndex: Math.max(0, Math.floor(clipIndex)) } : {}),
    ...(timeOffset !== undefined ? { timeOffset: Math.max(0, timeOffset) } : {}),
    ...(playbackRate !== undefined ? { playbackRate } : {}),
    ...(loop !== undefined ? { loop } : {}),
  };
}

export function buildSceneObject3D(
  raw: Record<string, unknown>,
  id: string,
): { object: MotionSceneObject3D } | { error: string } {
  const kind = optionalString(raw.kind);
  if (!kind || !MOTION_OBJECT_3D_KINDS.includes(kind as never)) {
    return {
      error: `object kind must be one of: ${MOTION_OBJECT_3D_KINDS.join(", ")}`,
    };
  }
  if (kind === "model" && !optionalString(raw.modelUrl)) {
    return { error: "object 'model' requires modelUrl" };
  }
  if (kind === "text3d" && !optionalString(raw.text)) {
    return { error: "object 'text3d' requires text" };
  }
  const materialKind =
    optionalString(raw.materialKind) === "basic" ? "basic" : "physical";
  const transform = transformFromArgs(raw, {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  return {
    object: {
      id,
      name: optionalString(raw.name),
      object: {
        kind: kind as MotionObject3DKind,
        size: optionalNumber(raw.size),
        depth: optionalNumber(raw.depth),
        aspect: optionalNumber(raw.aspect),
        cornerRadius: optionalNumber(raw.cornerRadius),
        modelUrl: optionalString(raw.modelUrl),
        text: optionalString(raw.text),
        extrude: optionalNumber(raw.extrude),
        panelTexts: parseStringArray(raw.panelTexts),
        animation: kind === "model" ? motionModelAnimationFromArgs(raw) : undefined,
      },
      material: {
        kind: materialKind,
        color: optionalString(raw.color),
        metalness: optionalNumber(raw.metalness),
        roughness: optionalNumber(raw.roughness),
        emissive: optionalString(raw.emissive),
        emissiveIntensity: optionalNumber(raw.emissiveIntensity),
        mapAssetId: optionalString(raw.mapAssetId),
      },
      transform3d: transform,
      lidAngle: optionalNumber(raw.lidAngle),
      opacity: optionalNumber(raw.opacity),
    },
  };
}

export function parseSceneCamera(
  raw: Record<string, unknown> | undefined,
): MotionScene3DCamera | undefined {
  if (!raw) return undefined;
  const num = (key: string): number | undefined => optionalNumber(raw[key]);
  const hasPos =
    asRecord(raw.position) !== null ||
    num("posX") !== undefined ||
    num("posY") !== undefined ||
    num("posZ") !== undefined;
  const hasTarget =
    asRecord(raw.target) !== null ||
    num("targetX") !== undefined ||
    num("targetY") !== undefined ||
    num("targetZ") !== undefined;
  return {
    position: hasPos
      ? vec3FromArgs(raw.position, { x: 0, y: 3, z: 14 }, ["posX", "posY", "posZ"], raw)
      : undefined,
    target: hasTarget
      ? vec3FromArgs(raw.target, { x: 0, y: 0, z: 0 }, ["targetX", "targetY", "targetZ"], raw)
      : undefined,
    fov: num("fov"),
    near: num("near"),
    far: num("far"),
  };
}

export function parseSceneRoom(
  raw: Record<string, unknown> | undefined,
): MotionScene3DRoom | undefined {
  if (!raw) return undefined;
  return {
    enabled: raw.enabled !== false,
    size: optionalNumber(raw.size),
    wallColor: optionalString(raw.wallColor),
    floorColor: optionalString(raw.floorColor),
  };
}

export const SCENE_OBJECT_POSITION_DEFAULT: MotionSceneVector3 = { x: 0, y: 0, z: 0 };

export const SCENE_OBJECT_ROTATION_DEFAULT: MotionSceneVector3 = { x: 0, y: 0, z: 0 };

export const SCENE_OBJECT_SCALE_DEFAULT: MotionSceneVector3 = { x: 1, y: 1, z: 1 };

export const SCENE_CAMERA_POSITION_DEFAULT: MotionSceneVector3 = { x: 0, y: 3, z: 14 };

export const SCENE_CAMERA_TARGET_DEFAULT: MotionSceneVector3 = { x: 0, y: 0, z: 0 };

export function mergeSceneVector3(
  raw: unknown,
  base: MotionSceneVector3 | undefined,
  fallback: MotionSceneVector3,
): MotionSceneVector3 | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const current = base ?? fallback;
  const x = optionalNumber(record.x);
  const y = optionalNumber(record.y);
  const z = optionalNumber(record.z);
  return {
    x: x !== undefined ? x : current.x,
    y: y !== undefined ? y : current.y,
    z: z !== undefined ? z : current.z,
  };
}

export function sceneVec3Keyframes(
  prefix: string,
  entries: unknown,
  idFactory: () => string,
): Keyframe[] {
  if (!Array.isArray(entries)) return [];
  const out: Keyframe[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    const time = optionalNumber(record.time);
    if (time === undefined) continue;
    const easing = sceneEasing(record.easing);
    for (const axis of ["x", "y", "z"] as const) {
      const value = optionalNumber(record[axis]);
      if (value === undefined) continue;
      out.push({
        id: idFactory(),
        time: Math.max(0, time),
        property: `${prefix}.${axis}`,
        value,
        easing,
      });
    }
  }
  return out;
}

export function sceneScalarKeyframes(
  property: string,
  entries: unknown,
  idFactory: () => string,
): Keyframe[] {
  if (!Array.isArray(entries)) return [];
  const out: Keyframe[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    const time = optionalNumber(record.time);
    const value = optionalNumber(record.value);
    if (time === undefined || value === undefined) continue;
    out.push({
      id: idFactory(),
      time: Math.max(0, time),
      property,
      value,
      easing: sceneEasing(record.easing),
    });
  }
  return out;
}

export function mergeSceneKeyframes(
  existing: readonly Keyframe[],
  added: readonly Keyframe[],
): Keyframe[] {
  if (added.length === 0) return [...existing];
  const replaced = new Set(added.map((keyframe) => keyframe.property));
  return [
    ...existing.filter((keyframe) => !replaced.has(keyframe.property)),
    ...added,
  ];
}

export function parseShadowStyle(value: unknown): ShadowStyle | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const color = optionalString(record.color);
  if (!color) return undefined;
  const blur = optionalNumber(record.blur) ?? 0;
  const offsetX = optionalNumber(record.offsetX) ?? 0;
  const offsetY = optionalNumber(record.offsetY) ?? 0;
  const spread = optionalNumber(record.spread);
  const inset = typeof record.inset === "boolean" ? record.inset : undefined;
  return {
    color,
    blur,
    offsetX,
    offsetY,
    ...(spread !== undefined ? { spread } : {}),
    ...(inset !== undefined ? { inset } : {}),
  };
}

export type MotionTextStroke = NonNullable<MotionTextLayer["style"]["stroke"]>;

export function parseMotionTextStroke(
  value: unknown,
): MotionTextStroke | "clear" | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const width = optionalNumber(record.width);
  if (width === undefined || width < 0) return undefined;
  if (width === 0) return "clear";
  const color = optionalString(record.color);
  if (!color) return undefined;
  const over = typeof record.over === "boolean" ? record.over : undefined;
  return {
    color,
    width,
    ...(over !== undefined ? { over } : {}),
  };
}

export const MOTION_TEXT_ANIMATOR_BASED_ON: ReadonlySet<string> = new Set([
  "characters",
  "words",
]);

export const MOTION_TEXT_ANIMATOR_DIRECTIONS: ReadonlySet<string> = new Set([
  "forward",
  "reverse",
  "center",
]);

export const MOTION_TEXT_ANIMATOR_EASINGS: ReadonlySet<string> = new Set([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
]);

export function parseMotionVector2Override(
  value: unknown,
  base: MotionTextAnimator["properties"]["position"],
): MotionTextAnimator["properties"]["position"] {
  const record = asRecord(value);
  if (!record) return base;
  const x = optionalNumber(record.x);
  const y = optionalNumber(record.y);
  return {
    x: x !== undefined ? x : base.x,
    y: y !== undefined ? y : base.y,
  };
}

export function applyMotionTextAnimatorOverrides(
  animator: MotionTextAnimator,
  args: Record<string, unknown>,
): MotionTextAnimator | { readonly error: string } {
  let next = animator;

  const name = optionalString(args.name);
  if (name !== undefined) {
    next = { ...next, name };
  }

  const selectorRecord = asRecord(args.selector);
  if (args.selector !== undefined) {
    if (!selectorRecord) return { error: "selector must be an object" };
    const basedOnRaw = optionalString(selectorRecord.basedOn);
    if (basedOnRaw !== undefined && !MOTION_TEXT_ANIMATOR_BASED_ON.has(basedOnRaw)) {
      return { error: "selector.basedOn must be characters or words" };
    }
    const start = optionalNumber(selectorRecord.start);
    const end = optionalNumber(selectorRecord.end);
    const offset = optionalNumber(selectorRecord.offset);
    next = {
      ...next,
      selector: {
        basedOn:
          (basedOnRaw as MotionTextAnimator["selector"]["basedOn"] | undefined) ??
          next.selector.basedOn,
        start: start !== undefined ? start : next.selector.start,
        end: end !== undefined ? end : next.selector.end,
        offset: offset !== undefined ? offset : next.selector.offset,
      },
    };
  }

  const timingRecord = asRecord(args.timing);
  if (args.timing !== undefined) {
    if (!timingRecord) return { error: "timing must be an object" };
    const directionRaw = optionalString(timingRecord.direction);
    if (
      directionRaw !== undefined &&
      !MOTION_TEXT_ANIMATOR_DIRECTIONS.has(directionRaw)
    ) {
      return { error: "timing.direction must be forward, reverse, or center" };
    }
    const easingRaw = optionalString(timingRecord.easing);
    if (easingRaw !== undefined && !MOTION_TEXT_ANIMATOR_EASINGS.has(easingRaw)) {
      return { error: "timing.easing must be linear, ease, ease-in, or ease-out" };
    }
    const startTime = optionalNumber(timingRecord.startTime);
    const duration = optionalNumber(timingRecord.duration);
    const stagger = optionalNumber(timingRecord.stagger);
    next = {
      ...next,
      timing: {
        startTime: startTime !== undefined ? startTime : next.timing.startTime,
        duration: duration !== undefined ? duration : next.timing.duration,
        stagger: stagger !== undefined ? stagger : next.timing.stagger,
        direction:
          (directionRaw as MotionTextAnimator["timing"]["direction"] | undefined) ??
          next.timing.direction,
        easing:
          (easingRaw as MotionTextAnimator["timing"]["easing"] | undefined) ??
          next.timing.easing,
      },
    };
  }

  const propertiesRecord = asRecord(args.properties);
  if (args.properties !== undefined) {
    if (!propertiesRecord) return { error: "properties must be an object" };
    const rotation = optionalNumber(propertiesRecord.rotation);
    const opacity = optionalNumber(propertiesRecord.opacity);
    next = {
      ...next,
      properties: {
        position: parseMotionVector2Override(
          propertiesRecord.position,
          next.properties.position,
        ),
        scale: parseMotionVector2Override(propertiesRecord.scale, next.properties.scale),
        rotation: rotation !== undefined ? rotation : next.properties.rotation,
        opacity: opacity !== undefined ? opacity : next.properties.opacity,
      },
    };
  }

  return next;
}

export function parseShadowStyles(value: unknown): ShadowStyle[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const shadows: ShadowStyle[] = [];
  for (const entry of value) {
    const shadow = parseShadowStyle(entry);
    if (!shadow) return undefined;
    shadows.push(shadow);
  }
  return shadows;
}

export function parseCornerRadii(value: unknown): CornerRadii | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const topLeft = optionalNumber(record.topLeft);
  const topRight = optionalNumber(record.topRight);
  const bottomRight = optionalNumber(record.bottomRight);
  const bottomLeft = optionalNumber(record.bottomLeft);
  if (
    topLeft === undefined ||
    topRight === undefined ||
    bottomRight === undefined ||
    bottomLeft === undefined
  ) {
    return undefined;
  }
  return {
    topLeft: Math.max(0, topLeft),
    topRight: Math.max(0, topRight),
    bottomRight: Math.max(0, bottomRight),
    bottomLeft: Math.max(0, bottomLeft),
  };
}

export function applyExtendedShapeStyle(
  base: ShapeStyle,
  args: Record<string, unknown>,
): ShapeStyle | string {
  let style: ShapeStyle = base;

  const fillRecord = asRecord(args.fill);
  const fillGradientRaw = fillRecord?.gradient;
  if (fillGradientRaw !== undefined) {
    const gradient = parseGradientStyle(fillGradientRaw);
    if (!gradient) return "fill.gradient is invalid";
    style = {
      ...style,
      fill: { ...style.fill, type: "gradient", gradient },
    };
  }

  const strokeRecord = asRecord(args.stroke);
  const strokeGradientRaw = strokeRecord?.gradient;
  if (strokeGradientRaw !== undefined) {
    const gradient = parseGradientStyle(strokeGradientRaw);
    if (!gradient) return "stroke.gradient is invalid";
    style = { ...style, stroke: { ...style.stroke, gradient } };
  }

  if (args.shadow !== undefined) {
    const shadow = parseShadowStyle(args.shadow);
    if (!shadow) return "shadow is invalid";
    style = { ...style, shadow };
  }

  if (args.shadows !== undefined) {
    const shadows = parseShadowStyles(args.shadows);
    if (!shadows) return "shadows must be a non-empty array of valid shadows";
    style = { ...style, shadows };
  }

  if (args.cornerRadii !== undefined) {
    const cornerRadii = parseCornerRadii(args.cornerRadii);
    if (!cornerRadii) {
      return "cornerRadii requires topLeft, topRight, bottomRight, bottomLeft";
    }
    style = { ...style, cornerRadii };
  }

  return style;
}

export function getMotionComposition(
  host: EditingHost,
  compositionId: unknown,
): MotionComposition | undefined {
  if (typeof compositionId !== "string") return undefined;
  return (host.getProject().motionCompositions ?? []).find(
    (composition) => composition.id === compositionId,
  );
}

export const VALID_EASINGS: ReadonlySet<string> = new Set(EASING_TYPES);

export function isValidEasing(value: unknown): value is EasingType {
  return typeof value === "string" && VALID_EASINGS.has(value);
}

export function animateMotionLayerProperty<T extends MotionLayer>(
  layer: T,
  property: string,
  keyframes: Array<{
    readonly time: number;
    readonly value: number;
    readonly easing?: string;
  }>,
): T {
  if (!isMotionAnimatableProperty(property)) {
    throw new Error(`Unsupported motion property: ${property}`);
  }
  return keyframes.reduce<T>(
    (currentLayer, keyframe) =>
      upsertMotionLayerKeyframe(currentLayer, property, keyframe.time, {
        value: keyframe.value,
        easing: isValidEasing(keyframe.easing) ? keyframe.easing : "ease",
      }),
    layer,
  );
}

export interface ParsedScalarKeyframe {
  readonly time: number;
  readonly value: number;
  readonly easing?: EasingType;
}

export function parseScalarKeyframes(value: unknown): ParsedScalarKeyframe[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const parsed: ParsedScalarKeyframe[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) return undefined;
    const time = optionalNumber(record.time);
    const numericValue = optionalNumber(record.value);
    if (time === undefined || numericValue === undefined) return undefined;
    parsed.push({
      time: Math.max(0, time),
      value: numericValue,
      easing: isValidEasing(record.easing) ? record.easing : undefined,
    });
  }
  return parsed;
}

export interface ParsedVectorKeyframe {
  readonly time: number;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly easing?: EasingType;
}

export function parseVectorKeyframes(value: unknown): ParsedVectorKeyframe[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const parsed: ParsedVectorKeyframe[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) return undefined;
    const time = optionalNumber(record.time);
    if (time === undefined) return undefined;
    parsed.push({
      time: Math.max(0, time),
      x: optionalNumber(record.x),
      y: optionalNumber(record.y),
      z: optionalNumber(record.z),
      easing: isValidEasing(record.easing) ? record.easing : undefined,
    });
  }
  return parsed;
}

export function getMotionLayer(
  composition: MotionComposition,
  layerId: unknown,
): MotionLayer | undefined {
  if (typeof layerId !== "string") return undefined;
  return composition.layers.find((layer) => layer.id === layerId);
}

export function replaceMotionLayer(
  composition: MotionComposition,
  layerId: string,
  next: MotionLayer,
): MotionComposition {
  return {
    ...composition,
    layers: composition.layers.map((layer) =>
      layer.id === layerId ? next : layer,
    ),
    modifiedAt: Date.now(),
  };
}

export function collectLayerIds(single: unknown, many: unknown): string[] {
  const ids: string[] = [];
  const singleId = optionalString(single);
  if (singleId) ids.push(singleId);
  if (Array.isArray(many)) {
    for (const entry of many) {
      const id = optionalString(entry);
      if (id) ids.push(id);
    }
  }
  return Array.from(new Set(ids));
}

export function motionTimingOptions(composition: MotionComposition): {
  readonly compositionDuration: number;
  readonly frameRate: number;
} {
  return {
    compositionDuration: composition.duration,
    frameRate: composition.frameRate,
  };
}

export function rewriteMotionPropertyReference(
  property: string,
  maskIdMap: ReadonlyMap<string, string>,
  effectIdMap: ReadonlyMap<string, string>,
): string {
  const maskMatch = /^mask\.([^.]+)\.(.+)$/.exec(property);
  if (maskMatch) {
    const nextMaskId = maskIdMap.get(maskMatch[1]);
    if (nextMaskId) return `mask.${nextMaskId}.${maskMatch[2]}`;
    return property;
  }
  const effectMatch = /^effect\.([^.]+)\.(.+)$/.exec(property);
  if (effectMatch) {
    const nextEffectId = effectIdMap.get(effectMatch[1]);
    if (nextEffectId) return `effect.${nextEffectId}.${effectMatch[2]}`;
    return property;
  }
  return property;
}

export function regenerateMotionLayerNestedIds(
  layer: MotionLayer,
  newId: () => string,
): MotionLayer {
  const maskIdMap = new Map<string, string>();
  const effectIdMap = new Map<string, string>();

  const nextMasks: MotionMask[] | undefined = layer.masks?.map((mask) => {
    const nextMaskId = newId();
    maskIdMap.set(mask.id, nextMaskId);
    return { ...mask, id: nextMaskId };
  });
  const nextEffects: MotionEffect[] | undefined = layer.effects?.map((effect) => {
    const nextEffectId = newId();
    effectIdMap.set(effect.id, nextEffectId);
    return { ...effect, id: nextEffectId } as MotionEffect;
  });

  const nextKeyframes = layer.keyframes.map((keyframe) => {
    const nextProperty = rewriteMotionPropertyReference(
      keyframe.property,
      maskIdMap,
      effectIdMap,
    );
    return nextProperty === keyframe.property
      ? keyframe
      : { ...keyframe, property: nextProperty };
  });

  const nextExpressions: MotionExpression[] | undefined = layer.expressions?.map(
    (expression) => ({
      ...expression,
      id: newId(),
      property: rewriteMotionPropertyReference(
        expression.property,
        maskIdMap,
        effectIdMap,
      ),
    }),
  );

  const withCommonNestedIds = {
    ...layer,
    keyframes: nextKeyframes,
    ...(nextMasks !== undefined ? { masks: nextMasks } : {}),
    ...(nextEffects !== undefined ? { effects: nextEffects } : {}),
    ...(nextExpressions !== undefined ? { expressions: nextExpressions } : {}),
  } as MotionLayer;

  if (withCommonNestedIds.type === "text" && withCommonNestedIds.textAnimators) {
    return {
      ...withCommonNestedIds,
      textAnimators: withCommonNestedIds.textAnimators.map((animator) => ({
        ...animator,
        id: newId(),
      })),
    } as MotionTextLayer;
  }
  return withCommonNestedIds;
}

export async function commitMotionComposition(
  host: EditingHost,
  composition: MotionComposition,
): Promise<ToolResult> {
  const reflowed = reflowMotionAutoLayoutGroups(composition);
  return applyMotionAction(host, "motion/upsertComposition", {
    composition: { ...reflowed, modifiedAt: Date.now() },
  });
}

export async function renderMotionFrameResult(
  host: EditingHost,
  composition: MotionComposition,
  args: Record<string, unknown>,
  options: {
    readonly summary?: string;
    readonly data?: Record<string, unknown>;
  } = {},
): Promise<ToolResult> {
  const timeSeconds = clampNumber(
    optionalNumber(args.timeSeconds) ?? 0,
    0,
    Math.max(0, composition.duration),
  );
  const quality = optionalString(args.quality);
  const qualityScale =
    quality === "final" ? 2 : quality === "draft" ? 1 : undefined;
  const scale = clampNumber(
    optionalNumber(args.scale) ?? qualityScale ?? 1,
    1,
    2,
  );
  const job = await host.runJob("exportFrame", {
    compositionId: composition.id,
    timeSeconds,
    scale,
  });
  if (!job.ok) {
    return fail(job.error ?? "Failed to render motion frame", "JOB_FAILED");
  }
  const data = asRecord(job.data);
  const dataUrl = optionalString(data?.dataUrl);
  if (!dataUrl) {
    return fail("Frame render returned no image", "JOB_FAILED");
  }
  const width = optionalNumber(data?.width) ?? composition.width;
  const height = optionalNumber(data?.height) ?? composition.height;
  return {
    ok: true,
    summary:
      options.summary ??
      `Rendered "${composition.name}" at ${timeSeconds.toFixed(2)}s (${width}x${height})`,
    data: {
      compositionId: composition.id,
      width,
      height,
      timeSeconds,
      ...options.data,
    },
    image: { dataUrl, mimeType: "image/png" },
  };
}

export const MOTION_EXPORT_SCENE_FORMATS: readonly ExportMotionSceneFormat[] = [
  "mp4",
  "webm-alpha",
  "mov-prores4444",
];

export function isExportMotionSceneFormat(
  value: string,
): value is ExportMotionSceneFormat {
  return (MOTION_EXPORT_SCENE_FORMATS as readonly string[]).includes(value);
}

export const MOTION_RENDER_QUEUE_FORMATS: readonly MotionRenderQueueAddFormat[] = [
  "mp4",
  "webm-alpha",
  "mov-prores4444",
  "png-sequence",
];

export function isMotionRenderQueueFormat(
  value: string,
): value is MotionRenderQueueAddFormat {
  return (MOTION_RENDER_QUEUE_FORMATS as readonly string[]).includes(value);
}

export const MOTION_RENDER_QUEUE_SCALES: readonly number[] = [1, 0.5, 0.25];

export const MOTION_RENDER_QUEUE_UNSUPPORTED =
  "Motion render queue is not supported by this host (only the live/desktop web editor can queue motion renders).";

export function motionRenderQueueFormatRequiresNative(
  format: MotionRenderQueueAddFormat,
): boolean {
  return format === "webm-alpha" || format === "mov-prores4444";
}

export const MOTION_EXPRESSION_TYPES: ReadonlySet<MotionExpressionType> = new Set([
  "sine",
  "wiggle",
  "drift",
  "spring",
  "loop",
  "ping-pong",
  "random",
  "posterize",
  "expression",
]);

export const MOTION_EFFECT_TYPES: ReadonlySet<MotionEffectType> = new Set([
  "blur",
  "drop-shadow",
  "glow",
  "color-adjust",
  "invert",
  "grayscale",
  "sepia",
  "levels",
  "sharpen",
  "posterize",
  "directional-blur",
  "noise",
  "radial-blur",
  "displace",
  "backdrop-blur",
]);

export const MOTION_EXPRESSION_CONTROL_EFFECT_TYPE_BY_ALIAS: ReadonlyMap<string, MotionEffectType> =
  new Map([
    ["slider", "slider-control"],
    ["checkbox", "checkbox-control"],
    ["angle", "angle-control"],
  ]);

export const MOTION_EFFECT_PARAMETERS: ReadonlySet<MotionEffectNumericParameter> = new Set([
  "radius",
  "opacity",
  "blur",
  "offsetX",
  "offsetY",
  "intensity",
  "brightness",
  "contrast",
  "saturation",
  "hue",
  "amount",
  "inputBlack",
  "inputWhite",
  "gamma",
  "outputBlack",
  "outputWhite",
  "levels",
  "angle",
  "distance",
  "seed",
  "centerX",
  "centerY",
  "scale",
  "value",
]);

export const MOTION_TRACK_MATTE_TYPES: ReadonlySet<MotionTrackMatteType> = new Set([
  "alpha",
  "alpha-inverted",
  "luma",
  "luma-inverted",
]);

export const MOTION_SHAPE_MODIFIER_TYPES: ReadonlySet<MotionShapeModifierType> = new Set(
  MOTION_SHAPE_MODIFIER_TYPE_LIST,
);

export const MOTION_SHAPE_OPERATOR_TYPES: ReadonlySet<MotionShapeModifierType> = new Set([
  "trim-paths",
  "repeater",
  "zig-zag",
  "round-corners",
  "wiggle-paths",
  "offset-paths",
  "pucker-bloat",
  "twist",
]);

export const MOTION_SHAPE_MERGE_MODES: ReadonlySet<MotionShapeMergeMode> = new Set([
  "none",
  "union",
  "subtract",
  "intersect",
  "exclude",
]);

export const MOTION_LIGHT_TYPES: ReadonlySet<MotionLightType> = new Set([
  "ambient",
  "point",
  "directional",
]);

export const MOTION_VARIABLE_TYPES: ReadonlySet<MotionVariable["type"]> = new Set([
  "text",
  "number",
  "color",
  "boolean",
  "media",
]);

export const MOTION_BLEND_MODE_IDS: ReadonlySet<BlendMode> = new Set(
  MOTION_BLEND_MODE_OPTIONS.map((option) => option.id),
);

export const MOTION_SHAPE_TYPES: ReadonlySet<ShapeType> = new Set(SHAPE_TYPES);

export const MOTION_UI_LAYER_TYPES: ReadonlySet<MotionUiLayerType> = new Set([
  "text",
  "shape",
  "image",
  "group",
  "null",
  "adjustment",
]);

export const MOTION_UI_COMPONENT_TYPE_SET: ReadonlySet<MotionUiComponentType> = new Set(
  MOTION_UI_COMPONENT_TYPES,
);

export const MOTION_ANIMATION_PRESET_IDS: ReadonlySet<MotionAnimationPresetId> = new Set(
  MOTION_ANIMATION_PRESETS.map((preset) => preset.id),
);

export const MOTION_ALIGNMENTS: ReadonlySet<MotionLayerAlignment> = new Set([
  "left",
  "center-x",
  "right",
  "top",
  "center-y",
  "bottom",
]);

export function buildMotionUiContext(
  composition: MotionComposition,
): BuildMotionUiLayerContext {
  return {
    compositionWidth: composition.width,
    compositionHeight: composition.height,
    compositionDuration: composition.duration,
    idFactory: genId,
  };
}

export function parseMotionUiLayerSpecs(
  value: unknown,
): MotionUiLayerSpec[] | { readonly error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "layers must be a non-empty array" };
  }
  const specs: MotionUiLayerSpec[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const raw = asRecord(value[index]);
    if (!raw) return { error: `layers[${index}] must be an object` };
    const type = optionalString(raw.type) as MotionUiLayerType | undefined;
    if (!type || !MOTION_UI_LAYER_TYPES.has(type)) {
      return { error: `layers[${index}].type must be one of ${[...MOTION_UI_LAYER_TYPES].join("|")}` };
    }
    const shapeType = optionalString(raw.shapeType) as ShapeType | undefined;
    if (shapeType && !MOTION_SHAPE_TYPES.has(shapeType)) {
      return { error: `layers[${index}].shapeType is invalid: ${shapeType}` };
    }
    if (type === "image" && !optionalString(raw.assetId)) {
      return { error: `layers[${index}] is an image but has no assetId` };
    }
    specs.push({
      key: optionalString(raw.key),
      type,
      name: optionalString(raw.name),
      x: optionalNumber(raw.x),
      y: optionalNumber(raw.y),
      width: optionalNumber(raw.width),
      height: optionalNumber(raw.height),
      startTime: optionalNumber(raw.startTime),
      duration: optionalNumber(raw.duration),
      visible: typeof raw.visible === "boolean" ? raw.visible : undefined,
      locked: typeof raw.locked === "boolean" ? raw.locked : undefined,
      rotation: optionalNumber(raw.rotation),
      opacity: optionalNumber(raw.opacity),
      parentKey: optionalString(raw.parentKey),
      parentId: optionalString(raw.parentId),
      shapeType,
      style: asRecord(raw.style) as MotionUiShapeStyleSpec | undefined,
      text: optionalString(raw.text),
      textStyle: asRecord(raw.textStyle) as MotionUiTextStyleSpec | undefined,
      assetId: optionalString(raw.assetId),
      fit: parseMotionFit(raw.fit),
    });
  }
  return specs;
}

export function parseMotionFit(
  value: unknown,
): "contain" | "cover" | "fill" | undefined {
  return value === "contain" || value === "cover" || value === "fill"
    ? value
    : undefined;
}

export function serializeMotionLayerDetail(layer: MotionLayer): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    id: layer.id,
    type: layer.type,
    name: layer.name,
    startTime: layer.startTime,
    duration: layer.duration,
    visible: layer.visible,
    locked: layer.locked,
    transform: layer.transform,
    keyframes: layer.keyframes.map((keyframe) => ({
      id: keyframe.id,
      property: keyframe.property,
      time: keyframe.time,
      value: keyframe.value,
      easing: keyframe.easing,
    })),
    parentId: layer.parentId,
    blendMode: layer.blendMode,
    expressions: layer.expressions,
    effects: layer.effects,
    masks: layer.masks,
    trackMatte: layer.trackMatte,
    variableBindings: layer.variableBindings,
  };
  switch (layer.type) {
    case "text":
      detail.text = layer.text;
      detail.style = layer.style;
      detail.textAnimators = layer.textAnimators;
      break;
    case "shape":
      detail.shapeType = layer.shapeType;
      detail.width = layer.width;
      detail.height = layer.height;
      detail.style = layer.style;
      detail.modifiers = layer.modifiers;
      detail.puppetPins = layer.puppetPins;
      break;
    case "image":
      detail.assetId = layer.assetId;
      detail.fit = layer.fit;
      break;
    case "composition":
      detail.refCompositionId = layer.compositionId;
      detail.timeOffset = layer.timeOffset;
      detail.playbackRate = layer.playbackRate;
      break;
    case "group":
      detail.children = layer.children;
      break;
    case "particle":
      detail.emitter = layer.emitter;
      break;
    case "scene3d":
      detail.object = layer.object;
      detail.material = layer.material;
      detail.lighting = layer.lighting;
      detail.fov = layer.fov;
      detail.cameraDistance = layer.cameraDistance;
      detail.width = layer.width;
      detail.height = layer.height;
      detail.objects = layer.objects;
      detail.camera = layer.camera;
      detail.room = layer.room;
      break;
    default:
      break;
  }
  return detail;
}

export function serializeMotionComposition(
  composition: MotionComposition,
): Record<string, unknown> {
  return {
    id: composition.id,
    name: composition.name,
    width: composition.width,
    height: composition.height,
    frameRate: composition.frameRate,
    duration: composition.duration,
    backgroundColor: composition.backgroundColor,
    layers: composition.layers.map(serializeMotionLayerDetail),
    variables: composition.variables.map((variable) => ({
      id: variable.id,
      name: variable.name,
      type: variable.type,
      value: variable.value,
    })),
    assets: composition.assets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      name: asset.name,
      mediaId: asset.mediaId,
    })),
    markers: composition.markers,
    beatMarkers: composition.beatMarkers ?? [],
    camera: composition.camera,
    lights: composition.lights ?? [],
  };
}

export async function applyMotionAction(
  host: EditingHost,
  type: string,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const action: Action = {
    type,
    id: genId(),
    timestamp: Date.now(),
    params,
  };
  const result = await host.applyAction(action);
  return result.success
    ? ok(`${type} applied`, { actionId: action.id })
    : fail(result.error?.message ?? `${type} failed`, result.error?.code);
}

export interface ActionToolSpec {
  name: string;
  domain: ToolDomain;
  actionType: string;
  title: string;
  description: string;
  inputSchema: JSONSchema;
  destructive?: boolean;
  expensive?: boolean;
  /** Transform tool args → action params (default: identity). */
  mapParams?: (args: Record<string, unknown>) => Record<string, unknown>;
}

export function actionTool(spec: ActionToolSpec): RegisteredTool {
  return {
    name: spec.name,
    domain: spec.domain,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.inputSchema,
    readOnly: false,
    destructive: spec.destructive ?? false,
    expensive: spec.expensive ?? false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const params = spec.mapParams ? spec.mapParams(args) : args;
      const action: Action = {
        type: spec.actionType,
        id: genId(),
        timestamp: Date.now(),
        params,
      };
      const result = await host.applyAction(action);
      if (result.success) return ok(`${spec.name} applied`, { actionId: action.id });
      return fail(
        result.error?.message ?? `${spec.name} failed`,
        result.error?.code ?? "ACTION_FAILED",
      );
    },
  };
}

export function readTool(
  name: string,
  title: string,
  description: string,
  inputSchema: JSONSchema,
  run: (args: Record<string, unknown>, host: EditingHost) => unknown,
): RegisteredTool {
  return {
    name,
    domain: "read",
    title,
    description,
    inputSchema,
    readOnly: true,
    destructive: false,
    expensive: false,
    handler: (args, host) => {
      const data = run(args, host);
      return ok(`${name} ok`, data);
    },
  };
}

export function emptyCreationReadState(): {
  readonly summary: string;
  readonly version?: string;
  readonly activeSceneId?: string;
  readonly assetCount: number;
  readonly sceneCount: number;
  readonly operationCount: number;
} {
  return {
    summary: "No creation state",
    assetCount: 0,
    sceneCount: 0,
    operationCount: 0,
  };
}

export function creationReadHeader(state: CreationProjectState | undefined) {
  if (!state) return emptyCreationReadState();
  return {
    summary: summarizeCreationState(state),
    version: state.version,
    activeSceneId: state.activeSceneId,
    assetCount: state.assets.length,
    sceneCount: state.scenes.length,
    operationCount: state.operationHistory.length,
  };
}

export function creationState(host: EditingHost): CreationProjectState | undefined {
  return host.getProject().creation;
}

export function validateCreationRenderTargets(
  host: EditingHost,
  state: CreationProjectState,
): readonly CreationValidationIssue[] {
  const issues: CreationValidationIssue[] = [];
  const compositionsById = new Map(
    (host.getProject().motionCompositions ?? []).map((composition) => [
      composition.id,
      composition,
    ]),
  );

  for (const [sceneIndex, scene] of state.scenes.entries()) {
    const path = `scenes[${sceneIndex}]`;
    for (const binding of scene.renderBindings) {
      const composition = compositionsById.get(binding.compositionId);
      if (!composition) {
        issues.push({
          code: "MISSING_RENDER_COMPOSITION",
          message: `Render binding ${binding.id} references missing Motion composition ${binding.compositionId}`,
          severity: "error",
          path: `${path}.renderBindings.${binding.id}.compositionId`,
        });
        continue;
      }
      const layer = composition.layers.find(
        (candidate) => candidate.id === binding.layerId,
      );
      if (!layer || layer.type !== "scene3d") {
        issues.push({
          code: "MISSING_RENDER_LAYER",
          message: `Render binding ${binding.id} references missing Motion scene3d layer ${binding.layerId}`,
          severity: "error",
          path: `${path}.renderBindings.${binding.id}.layerId`,
        });
        continue;
      }

      const renderObjectIds = new Set(
        (layer.objects ?? []).map((object) => object.id),
      );
      for (const objectBinding of binding.objectBindings) {
        if (!renderObjectIds.has(objectBinding.renderObjectId)) {
          issues.push({
            code: "MISSING_RENDER_OBJECT",
            message: `Render binding ${binding.id} references missing scene3d object ${objectBinding.renderObjectId}`,
            severity: "error",
            path: `${path}.renderBindings.${binding.id}.objectBindings.${objectBinding.sceneObjectId}`,
          });
        }
      }
    }
  }

  return issues;
}

export function resolveCreationScene(
  state: CreationProjectState | undefined,
  sceneId: unknown,
): CreationProjectState["scenes"][number] | undefined {
  const id = optionalString(sceneId) ?? state?.activeSceneId;
  if (!id) return undefined;
  return state?.scenes.find((scene) => scene.id === id);
}

export function vec3FromArgs(
  value: unknown,
  fallback: Transform3D["position"],
  aliases: readonly [string, string, string],
  args: Record<string, unknown>,
): Transform3D["position"] {
  const record = asRecord(value);
  return {
    x: optionalNumber(record?.x) ?? optionalNumber(args[aliases[0]]) ?? fallback.x,
    y: optionalNumber(record?.y) ?? optionalNumber(args[aliases[1]]) ?? fallback.y,
    z: optionalNumber(record?.z) ?? optionalNumber(args[aliases[2]]) ?? fallback.z,
  };
}

export function transformFromArgs(
  args: Record<string, unknown>,
  fallback: Transform3D,
): Transform3D {
  return {
    position: vec3FromArgs(args.position, fallback.position, ["x", "y", "z"], args),
    rotation: vec3FromArgs(
      args.rotation,
      fallback.rotation,
      ["rotationX", "rotationY", "rotationZ"],
      args,
    ),
    scale: vec3FromArgs(args.scale, fallback.scale, ["scaleX", "scaleY", "scaleZ"], args),
  };
}

export function bindingForObject(
  scene: CreationProjectState["scenes"][number],
  objectId: string,
): { binding: CreationRenderBinding; renderObjectId: string } | undefined {
  for (const binding of scene.renderBindings) {
    const objectBinding = binding.objectBindings.find(
      (candidate) => candidate.sceneObjectId === objectId,
    );
    if (objectBinding) return { binding, renderObjectId: objectBinding.renderObjectId };
  }
  return undefined;
}

export function shiftKeyframeValue(
  keyframe: Keyframe,
  renderObjectId: string,
  previous: Transform3D,
  next: Transform3D,
): Keyframe {
  const prefix = `scene.object.${renderObjectId}.`;
  if (!keyframe.property.startsWith(prefix) || typeof keyframe.value !== "number") {
    return keyframe;
  }
  const property = keyframe.property.slice(prefix.length);
  const deltas: Record<string, number> = {
    "position.x": next.position.x - previous.position.x,
    "position.y": next.position.y - previous.position.y,
    "position.z": next.position.z - previous.position.z,
    "rotation.x": next.rotation.x - previous.rotation.x,
    "rotation.y": next.rotation.y - previous.rotation.y,
    "rotation.z": next.rotation.z - previous.rotation.z,
  };
  if (property in deltas) {
    return { ...keyframe, value: keyframe.value + deltas[property] };
  }
  const scaleAxis = property === "scale.x" ? "x" : property === "scale.y" ? "y" : property === "scale.z" ? "z" : null;
  if (scaleAxis) {
    const from = previous.scale[scaleAxis];
    const to = next.scale[scaleAxis];
    return { ...keyframe, value: Math.abs(from) < 1e-9 ? to : keyframe.value * (to / from) };
  }
  return keyframe;
}

export function updateScene3DLayerObjectTransform(
  layer: MotionScene3DLayer,
  renderObjectId: string,
  previous: Transform3D,
  next: Transform3D,
): MotionScene3DLayer | string {
  const objects = layer.objects ?? [];
  if (!objects.some((object) => object.id === renderObjectId)) {
    return `Render object not found: ${renderObjectId}`;
  }
  return {
    ...layer,
    objects: objects.map((object) =>
      object.id === renderObjectId
        ? {
            ...object,
            transform3d: {
              position: next.position,
              rotation: next.rotation,
              scale: next.scale,
            },
          }
        : object,
    ),
    keyframes: layer.keyframes.map((keyframe) =>
      shiftKeyframeValue(keyframe, renderObjectId, previous, next),
    ),
  };
}

export function motionMaterialForCreation(material: CreationMaterial): MotionMaterial3D {
  const isGlass = material.model === "glass";
  const transmission =
    material.transmission ??
    optionalNumber(material.parameters?.transmission) ??
    (isGlass ? 0.9 : undefined);
  return {
    kind:
      material.model === "screen" || material.model === "emissive"
        ? "basic"
        : "physical",
    color: material.baseColor,
    metalness: material.metallic,
    roughness: material.roughness,
    opacity: material.opacity,
    emissive: material.emissive,
    emissiveIntensity: material.emissiveIntensity,
    mapAssetId: optionalString(material.parameters?.mapAssetId),
    normalMapAssetId: optionalString(material.parameters?.normalMapAssetId),
    roughnessMapAssetId: optionalString(material.parameters?.roughnessMapAssetId),
    metalnessMapAssetId: optionalString(material.parameters?.metalnessMapAssetId),
    transmission,
    ior: optionalNumber(material.parameters?.ior) ?? (isGlass ? 1.5 : undefined),
    clearcoat: material.clearcoat ?? optionalNumber(material.parameters?.clearcoat),
    clearcoatRoughness: optionalNumber(material.parameters?.clearcoatRoughness),
  };
}

export function updateCreationMaterialFromArgs(
  material: CreationMaterial,
  args: Record<string, unknown>,
): CreationMaterial {
  const model = optionalString(args.model) ?? optionalString(args.materialModel);
  return {
    ...material,
    name: optionalString(args.name) ?? material.name,
    model:
      model === "pbr" ||
      model === "screen" ||
      model === "glass" ||
      model === "metal" ||
      model === "plastic" ||
      model === "fabric" ||
      model === "emissive" ||
      model === "procedural"
        ? model
        : material.model,
    baseColor: optionalString(args.baseColor) ?? optionalString(args.color) ?? material.baseColor,
    metallic: optionalNumber(args.metallic) ?? optionalNumber(args.metalness) ?? material.metallic,
    roughness: optionalNumber(args.roughness) ?? material.roughness,
    opacity: optionalNumber(args.opacity) ?? material.opacity,
    transmission: optionalNumber(args.transmission) ?? material.transmission,
    clearcoat: optionalNumber(args.clearcoat) ?? material.clearcoat,
    emissive: optionalString(args.emissive) ?? material.emissive,
    emissiveIntensity: optionalNumber(args.emissiveIntensity) ?? material.emissiveIntensity,
  };
}

export function updateAssetMaterial(
  asset: CreationAssetRecipe,
  material: CreationMaterial,
): CreationAssetRecipe {
  return {
    ...asset,
    materials: asset.materials.map((candidate) =>
      candidate.id === material.id ? material : candidate,
    ),
    modifiedAt: Date.now(),
  };
}

export function parseCreationMaterialPresetId(value: unknown): CreationMaterialPresetId | undefined {
  const preset = optionalString(value);
  return preset && preset in CREATION_MATERIAL_PRESETS
    ? (preset as CreationMaterialPresetId)
    : undefined;
}

export function creationMaterialPresetIds(): CreationMaterialPresetId[] {
  return Object.keys(CREATION_MATERIAL_PRESETS) as CreationMaterialPresetId[];
}

export function applyCreationMaterialPreset(
  material: CreationMaterial,
  presetId: CreationMaterialPresetId,
  args: Record<string, unknown>,
): CreationMaterial {
  const preset: CreationMaterialPreset = CREATION_MATERIAL_PRESETS[presetId];
  const detail = optionalNumber(args.detail) ?? optionalNumber(args.textureDetail);
  const wear = optionalNumber(args.wear);
  const dust = optionalNumber(args.dust);
  const scratches = optionalNumber(args.scratches);
  return {
    ...material,
    name: optionalString(args.name) ?? preset.name,
    model: preset.model,
    baseColor: optionalString(args.baseColor) ?? optionalString(args.color) ?? preset.baseColor,
    metallic: optionalNumber(args.metallic) ?? optionalNumber(args.metalness) ?? preset.metallic,
    roughness: optionalNumber(args.roughness) ?? preset.roughness,
    opacity: optionalNumber(args.opacity) ?? preset.opacity,
    transmission: optionalNumber(args.transmission) ?? preset.transmission,
    clearcoat: optionalNumber(args.clearcoat) ?? preset.clearcoat,
    emissive: optionalString(args.emissive) ?? preset.emissive,
    emissiveIntensity: optionalNumber(args.emissiveIntensity) ?? preset.emissiveIntensity,
    parameters: compactCreationParameters({
      ...material.parameters,
      presetId,
      presetName: preset.name,
      proceduralTexture: optionalString(args.texture) ?? preset.texture,
      detail,
      wear,
      dust,
      scratches,
      source: "agent-material-preset",
    }),
  };
}

export function updateAssetMaterialPresetMetadata(
  asset: CreationAssetRecipe,
  material: CreationMaterial,
  presetId: CreationMaterialPresetId,
  now: number,
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const materialNodeId = `node-${assetKey}-${idSegment(material.id, "material")}-preset`;
  const preset: CreationMaterialPreset = CREATION_MATERIAL_PRESETS[presetId];
  const presetParameters = compactCreationParameters({
    materialId: material.id,
    presetId,
    presetName: preset.name,
    proceduralTexture: material.parameters?.proceduralTexture,
    baseColor: material.baseColor,
    model: material.model,
  });
  const materialNode = {
    id: materialNodeId,
    type: "material" as const,
    name: `${material.name} preset`,
    inputs: [],
    parameters: presetParameters,
  };
  return {
    ...updateAssetMaterial(asset, material),
    parameters: {
      ...asset.parameters,
      materialPresetId: presetId,
      materialPresetName: preset.name,
      materialPresetTexture: material.parameters?.proceduralTexture ?? preset.texture,
    },
    nodes: asset.nodes.some((node) => node.id === materialNodeId)
      ? asset.nodes.map((node) => (node.id === materialNodeId ? materialNode : node))
      : [...asset.nodes, materialNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-material-preview`,
      "agent-material-preset-v1",
    ),
    modifiedAt: now,
  };
}

export function applyCreationXrayMaterial(
  material: CreationMaterial,
  args: Record<string, unknown>,
): CreationMaterial {
  const opacity = clampNumber(optionalNumber(args.opacity) ?? 0.32, 0.02, 1);
  const transmission = clampNumber(optionalNumber(args.transmission) ?? 0.72, 0, 1);
  const edgeGlow = clampNumber(optionalNumber(args.edgeGlow) ?? 0.18, 0, 1);
  const tint =
    optionalString(args.tint) ??
    optionalString(args.color) ??
    optionalString(args.baseColor) ??
    "#67e8f9";
  return {
    ...material,
    name: optionalString(args.name) ?? `X-ray ${material.name}`,
    model: "glass",
    baseColor: tint,
    metallic: optionalNumber(args.metallic) ?? optionalNumber(args.metalness) ?? 0,
    roughness: optionalNumber(args.roughness) ?? 0.08,
    opacity,
    transmission,
    clearcoat: optionalNumber(args.clearcoat) ?? 0.7,
    emissive: optionalString(args.emissive) ?? tint,
    emissiveIntensity: optionalNumber(args.emissiveIntensity) ?? edgeGlow,
    parameters: compactCreationParameters({
      ...material.parameters,
      xrayMaterial: {
        source: "agent-xray-material",
        style: optionalString(args.style) ?? "transparent-shell",
        tint,
        opacity,
        transmission,
        edgeGlow,
        revealInternals: args.revealInternals !== false,
        showBackfaces: args.showBackfaces === true,
      },
      source: "agent-xray-material",
    }),
  };
}

export function updateAssetXrayMaterialMetadata(
  asset: CreationAssetRecipe,
  materialsById: ReadonlyMap<string, CreationMaterial>,
  args: Record<string, unknown>,
  now: number,
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-xray-material`;
  const materialIds = [...materialsById.keys()];
  const xrayParameters = compactCreationParameters({
    source: "agent-xray-material",
    materialIds,
    style: optionalString(args.style) ?? "transparent-shell",
    tint:
      optionalString(args.tint) ??
      optionalString(args.color) ??
      optionalString(args.baseColor),
    opacity: optionalNumber(args.opacity) ?? 0.32,
    transmission: optionalNumber(args.transmission) ?? 0.72,
    edgeGlow: optionalNumber(args.edgeGlow) ?? 0.18,
    revealInternals: args.revealInternals !== false,
    showBackfaces: args.showBackfaces === true,
  });
  const materialNode = {
    id: nodeId,
    type: "material" as const,
    name: optionalString(args.nodeName) ?? "X-ray material",
    inputs: [],
    parameters: xrayParameters,
  };
  const previousByMaterial = asRecord(asset.parameters.xrayMaterialsById) ?? {};
  const nextByMaterial: Record<string, unknown> = { ...previousByMaterial };
  for (const materialId of materialIds) {
    const material = materialsById.get(materialId);
    if (!material) continue;
    nextByMaterial[materialId] = compactCreationParameters({
      source: "agent-xray-material",
      materialId,
      opacity: material.opacity,
      transmission: material.transmission,
      baseColor: material.baseColor,
      emissive: material.emissive,
      emissiveIntensity: material.emissiveIntensity,
    });
  }
  return {
    ...asset,
    materials: asset.materials.map((candidate) =>
      materialsById.get(candidate.id) ?? candidate,
    ),
    parameters: compactCreationParameters({
      ...asset.parameters,
      xrayMaterial: xrayParameters,
      xrayMaterialsById: nextByMaterial,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? materialNode : node))
      : [...asset.nodes, materialNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-xray-material-preview`,
      "agent-xray-material-v1",
    ),
    modifiedAt: now,
  };
}

export function creationSurfaceDetailKind(value: unknown): string {
  const kind = optionalString(value);
  if (
    kind === "scratches" ||
    kind === "dust" ||
    kind === "fingerprints" ||
    kind === "smudges" ||
    kind === "edge-wear" ||
    kind === "grime"
  ) {
    return kind;
  }
  return "scratches";
}

export function defaultSurfaceDetailColor(kind: string): string {
  if (kind === "dust") return "#c8c3b8";
  if (kind === "fingerprints" || kind === "smudges") return "#dbeafe";
  if (kind === "edge-wear") return "#f8fafc";
  if (kind === "grime") return "#334155";
  return "#e5e7eb";
}

export function applyCreationSurfaceDetail(
  material: CreationMaterial,
  args: Record<string, unknown>,
  roughnessMapAssetId?: string,
): CreationMaterial {
  const kind = creationSurfaceDetailKind(args.kind ?? args.detailKind ?? args.type);
  const intensity = clampNumber(optionalNumber(args.intensity) ?? 0.35, 0, 1);
  const density = clampNumber(optionalNumber(args.density) ?? 0.5, 0, 1);
  const scale = Math.max(0.001, optionalNumber(args.scale) ?? optionalNumber(args.size) ?? 0.35);
  const color =
    optionalString(args.detailColor) ??
    optionalString(args.color) ??
    defaultSurfaceDetailColor(kind);
  const roughnessBoost =
    optionalNumber(args.roughnessBoost) ??
    (kind === "fingerprints" || kind === "smudges" ? 0.18 : 0.3);
  const roughness = clampNumber(
    optionalNumber(args.roughness) ??
      (material.roughness ?? 0.45) + intensity * roughnessBoost,
    0,
    1,
  );
  const metallic =
    optionalNumber(args.metallic) ??
    optionalNumber(args.metalness) ??
    (kind === "edge-wear" && material.model === "metal"
      ? clampNumber((material.metallic ?? 0.7) + intensity * 0.12, 0, 1)
      : material.metallic);
  return {
    ...material,
    roughness,
    metallic,
    parameters: compactCreationParameters({
      ...material.parameters,
      surfaceDetail: {
        source: "agent-surface-detail",
        kind,
        intensity,
        density,
        scale,
        color,
        seed: optionalString(args.seed),
        pattern: optionalString(args.pattern) ?? kind,
        direction: optionalString(args.direction),
        scratchLength: optionalNumber(args.scratchLength),
        edgeRadius: optionalNumber(args.edgeRadius),
        fingerprintSize: optionalNumber(args.fingerprintSize),
        roughnessBoost,
        bakeTarget: optionalString(args.bakeTarget) ?? "material-texture",
      },
      source: "agent-surface-detail",
      ...(roughnessMapAssetId ? { roughnessMapAssetId } : {}),
    }),
    ...(roughnessMapAssetId ? { textureCacheId: roughnessMapAssetId } : {}),
  };
}

export function updateAssetSurfaceDetailMetadata(
  asset: CreationAssetRecipe,
  materialsById: ReadonlyMap<string, CreationMaterial>,
  args: Record<string, unknown>,
  now: number,
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-surface-detail`;
  const materialIds = [...materialsById.keys()];
  const kind = creationSurfaceDetailKind(args.kind ?? args.detailKind ?? args.type);
  const surfaceParameters = compactCreationParameters({
    source: "agent-surface-detail",
    materialIds,
    kind,
    intensity: clampNumber(optionalNumber(args.intensity) ?? 0.35, 0, 1),
    density: clampNumber(optionalNumber(args.density) ?? 0.5, 0, 1),
    scale: Math.max(0.001, optionalNumber(args.scale) ?? optionalNumber(args.size) ?? 0.35),
    color:
      optionalString(args.detailColor) ??
      optionalString(args.color) ??
      defaultSurfaceDetailColor(kind),
    seed: optionalString(args.seed),
    pattern: optionalString(args.pattern) ?? kind,
    bakeTarget: optionalString(args.bakeTarget) ?? "material-texture",
  });
  const node = {
    id: nodeId,
    type: "material" as const,
    name: optionalString(args.nodeName) ?? "Procedural surface detail",
    inputs: [],
    parameters: surfaceParameters,
  };
  const previousByMaterial = asRecord(asset.parameters.surfaceDetailsByMaterialId) ?? {};
  const nextByMaterial: Record<string, unknown> = { ...previousByMaterial };
  for (const materialId of materialIds) {
    const material = materialsById.get(materialId);
    if (!material) continue;
    nextByMaterial[materialId] = compactCreationParameters({
      source: "agent-surface-detail",
      materialId,
      kind,
      roughness: material.roughness,
      metallic: material.metallic,
      surfaceDetail: material.parameters?.surfaceDetail,
    });
  }
  return {
    ...asset,
    materials: asset.materials.map((candidate) =>
      materialsById.get(candidate.id) ?? candidate,
    ),
    parameters: compactCreationParameters({
      ...asset.parameters,
      surfaceDetail: surfaceParameters,
      surfaceDetailsByMaterialId: nextByMaterial,
    }),
    nodes: asset.nodes.some((candidate) => candidate.id === nodeId)
      ? asset.nodes.map((candidate) => (candidate.id === nodeId ? node : candidate))
      : [...asset.nodes, node],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-surface-detail-preview`,
      "agent-surface-detail-v1",
    ),
    modifiedAt: now,
  };
}

export const CREATION_TEXTURE_PATTERNS = [
  "noise",
  "voronoi",
  "fbm",
  "marble",
  "circuit",
  "fabric-weave",
  "lunar-dust",
  "hex-grid",
  "gradient",
  "brushed",
] as const;

export type CreationTexturePattern = (typeof CREATION_TEXTURE_PATTERNS)[number];

export interface CreationTexturePatternDefaults {
  readonly baseColor: string;
  readonly secondaryColor: string;
  readonly roughness: number;
  readonly metallic: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
}

export const CREATION_TEXTURE_PATTERN_DEFAULTS: Record<
  CreationTexturePattern,
  CreationTexturePatternDefaults
> = {
  noise: { baseColor: "#9ca3af", secondaryColor: "#4b5563", roughness: 0.7, metallic: 0.05 },
  voronoi: { baseColor: "#a3a3a3", secondaryColor: "#525252", roughness: 0.62, metallic: 0.08 },
  fbm: { baseColor: "#8b8b8b", secondaryColor: "#3f3f46", roughness: 0.72, metallic: 0.04 },
  marble: { baseColor: "#f1f5f9", secondaryColor: "#475569", roughness: 0.28, metallic: 0.04 },
  circuit: {
    baseColor: "#064e3b",
    secondaryColor: "#22c55e",
    roughness: 0.42,
    metallic: 0.2,
    emissive: "#22c55e",
    emissiveIntensity: 0.22,
  },
  "fabric-weave": { baseColor: "#3f3f46", secondaryColor: "#18181b", roughness: 0.92, metallic: 0.0 },
  "lunar-dust": { baseColor: "#9ca3af", secondaryColor: "#6b7280", roughness: 0.96, metallic: 0.02 },
  "hex-grid": { baseColor: "#1e293b", secondaryColor: "#38bdf8", roughness: 0.5, metallic: 0.3 },
  gradient: { baseColor: "#6366f1", secondaryColor: "#ec4899", roughness: 0.5, metallic: 0.1 },
  brushed: { baseColor: "#cbd5e1", secondaryColor: "#94a3b8", roughness: 0.34, metallic: 0.82 },
};

export function creationTexturePattern(value: unknown): CreationTexturePattern {
  const pattern = optionalString(value);
  return pattern && CREATION_TEXTURE_PATTERNS.includes(pattern as CreationTexturePattern)
    ? (pattern as CreationTexturePattern)
    : "noise";
}

export function applyCreationProceduralTexture(
  material: CreationMaterial,
  args: Record<string, unknown>,
): CreationMaterial {
  const pattern = creationTexturePattern(args.pattern ?? args.kind ?? args.type);
  const defaults = CREATION_TEXTURE_PATTERN_DEFAULTS[pattern];
  const baseColor =
    optionalString(args.color) ?? optionalString(args.baseColor) ?? defaults.baseColor;
  const secondaryColor =
    optionalString(args.secondaryColor) ?? optionalString(args.accentColor) ?? defaults.secondaryColor;
  const scale = Math.max(0.001, optionalNumber(args.scale) ?? optionalNumber(args.size) ?? 1);
  const contrast = clampNumber(optionalNumber(args.contrast) ?? 0.5, 0, 1);
  const roughness = clampNumber(optionalNumber(args.roughness) ?? defaults.roughness, 0, 1);
  const metallic = clampNumber(
    optionalNumber(args.metallic) ?? optionalNumber(args.metalness) ?? defaults.metallic,
    0,
    1,
  );
  const emissive = optionalString(args.emissive) ?? defaults.emissive;
  const emissiveIntensity =
    optionalNumber(args.emissiveIntensity) ?? defaults.emissiveIntensity ?? material.emissiveIntensity;
  const textureCacheId = `texture-${idSegment(material.id, "material")}-${pattern}`;
  return {
    ...material,
    baseColor,
    roughness,
    metallic,
    emissive: emissive ?? material.emissive,
    emissiveIntensity: emissive ? emissiveIntensity : material.emissiveIntensity,
    textureCacheId,
    parameters: compactCreationParameters({
      ...material.parameters,
      proceduralTexture: {
        source: "agent-procedural-texture",
        pattern,
        baseColor,
        secondaryColor,
        scale,
        contrast,
        seed: optionalString(args.seed),
        rotation: optionalNumber(args.rotation),
        textureCacheId,
        bakeTarget: optionalString(args.bakeTarget) ?? "material-basecolor",
      },
      source: "agent-procedural-texture",
    }),
  };
}

export function updateAssetProceduralTextureMetadata(
  asset: CreationAssetRecipe,
  materialsById: ReadonlyMap<string, CreationMaterial>,
  args: Record<string, unknown>,
  now: number,
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-procedural-texture`;
  const materialIds = [...materialsById.keys()];
  const pattern = creationTexturePattern(args.pattern ?? args.kind ?? args.type);
  const textureParameters = compactCreationParameters({
    source: "agent-procedural-texture",
    materialIds,
    pattern,
    scale: Math.max(0.001, optionalNumber(args.scale) ?? optionalNumber(args.size) ?? 1),
    contrast: clampNumber(optionalNumber(args.contrast) ?? 0.5, 0, 1),
    seed: optionalString(args.seed),
    bakeTarget: optionalString(args.bakeTarget) ?? "material-basecolor",
  });
  const node = {
    id: nodeId,
    type: "material" as const,
    name: optionalString(args.nodeName) ?? `${pattern} procedural texture`,
    inputs: [],
    parameters: textureParameters,
  };
  const previousByMaterial = asRecord(asset.parameters.proceduralTexturesByMaterialId) ?? {};
  const nextByMaterial: Record<string, unknown> = { ...previousByMaterial };
  for (const materialId of materialIds) {
    const material = materialsById.get(materialId);
    if (!material) continue;
    nextByMaterial[materialId] = compactCreationParameters({
      source: "agent-procedural-texture",
      materialId,
      pattern,
      baseColor: material.baseColor,
      proceduralTexture: material.parameters?.proceduralTexture,
    });
  }
  return {
    ...asset,
    materials: asset.materials.map((candidate) => materialsById.get(candidate.id) ?? candidate),
    parameters: compactCreationParameters({
      ...asset.parameters,
      proceduralTexture: textureParameters,
      proceduralTexturesByMaterialId: nextByMaterial,
    }),
    nodes: asset.nodes.some((candidate) => candidate.id === nodeId)
      ? asset.nodes.map((candidate) => (candidate.id === nodeId ? node : candidate))
      : [...asset.nodes, node],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-procedural-texture-preview`,
      "agent-procedural-texture-v1",
    ),
    modifiedAt: now,
  };
}

export function updateScene3DLayerObjectMaterial(
  layer: MotionScene3DLayer,
  renderObjectId: string,
  material: CreationMaterial,
): MotionScene3DLayer | string {
  const objects = layer.objects ?? [];
  if (!objects.some((object) => object.id === renderObjectId)) {
    return `Render object not found: ${renderObjectId}`;
  }
  return {
    ...layer,
    objects: objects.map((object) =>
      object.id === renderObjectId
        ? {
            ...object,
            material: motionMaterialForCreation(material),
            opacity: material.opacity,
          }
        : object,
    ),
  };
}

export function updateMotionSceneObjectGeometry(
  current: MotionSceneObject3D,
  args: Record<string, unknown>,
): MotionSceneObject3D | string {
  const kind = optionalString(args.kind) ?? current.object.kind;
  if (!MOTION_OBJECT_3D_KINDS.includes(kind as never)) {
    return `object kind must be one of: ${MOTION_OBJECT_3D_KINDS.join(", ")}`;
  }
  const modelUrl =
    kind === "model"
      ? optionalString(args.modelUrl) ?? current.object.modelUrl
      : undefined;
  if (kind === "model" && !modelUrl) {
    return "object 'model' requires modelUrl";
  }
  const text =
    kind === "text3d"
      ? optionalString(args.text) ?? current.object.text
      : undefined;
  if (kind === "text3d" && !text) {
    return "object 'text3d' requires text";
  }
  const panelTexts =
    kind === "soccer-ball"
      ? parseStringArray(args.panelTexts) ?? current.object.panelTexts
      : undefined;
  const animation =
    kind === "model"
      ? motionModelAnimationFromArgs(args) ?? current.object.animation
      : undefined;
  const geometryFieldKeys = [
    "kind",
    "size",
    "depth",
    "aspect",
    "cornerRadius",
    "extrude",
    "modelUrl",
    "text",
    "panelTexts",
  ];
  const geometryChanged = geometryFieldKeys.some((field) => args[field] !== undefined);
  const mesh = geometryChanged ? undefined : current.object.mesh;
  const meshFrames = geometryChanged ? undefined : current.object.meshFrames;
  return {
    ...current,
    name: optionalString(args.name) ?? current.name,
    object: {
      kind: kind as MotionObject3DKind,
      mesh,
      meshFrames,
      size: optionalNumber(args.size) ?? current.object.size,
      depth: optionalNumber(args.depth) ?? current.object.depth,
      aspect: optionalNumber(args.aspect) ?? current.object.aspect,
      cornerRadius: optionalNumber(args.cornerRadius) ?? current.object.cornerRadius,
      modelUrl,
      text,
      extrude:
        kind === "text3d"
          ? optionalNumber(args.extrude) ?? current.object.extrude
          : undefined,
      panelTexts,
      animation,
    },
    lidAngle: optionalNumber(args.lidAngle) ?? current.lidAngle,
    opacity: optionalNumber(args.opacity) ?? current.opacity,
  };
}

export function geometryParametersForMotionObject(
  object: MotionSceneObject3D,
): CreationParameters {
  return compactCreationParameters({
    source: "agent-native-3d-scene",
    motionObjectKind: object.object.kind,
    size: object.object.size,
    depth: object.object.depth,
    aspect: object.object.aspect,
    cornerRadius: object.object.cornerRadius,
    modelUrl: object.object.modelUrl,
    animation: object.object.animation,
    text: object.object.text,
    extrude: object.object.extrude,
    panelTexts: object.object.panelTexts,
    lidAngle: object.lidAngle,
    opacity: object.opacity,
  });
}

export function dirtyCreationAssetCaches(
  asset: CreationAssetRecipe,
  fallbackId: string,
  generatorVersion: string,
): CreationAssetRecipe["caches"] {
  return asset.caches.length > 0
    ? asset.caches.map((cache) => ({
        ...cache,
        status:
          cache.kind === "preview-mesh" ||
          cache.kind === "final-mesh" ||
          cache.kind === "collision-mesh" ||
          cache.kind === "thumbnail" ||
          cache.kind === "render-preview" ||
          cache.kind === "animation"
            ? ("dirty" as const)
            : cache.status,
      }))
    : [
        {
          id: fallbackId,
          kind: "preview-mesh" as const,
          status: "dirty" as const,
          generatorVersion,
        },
      ];
}

export function updateCreationAssetGeometry(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  object: MotionSceneObject3D,
  now: number,
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const geometryNodeIndex = asset.nodes.findIndex(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part",
  );
  const modelUrl = object.object.kind === "model" ? object.object.modelUrl : undefined;
  const geometryParameters = compactCreationParameters({
    kind: object.object.kind,
    size: object.object.size,
    depth: object.object.depth,
    aspect: object.object.aspect,
    cornerRadius: object.object.cornerRadius,
    modelUrl,
    animation: object.object.animation,
    text: object.object.text,
    extrude: object.object.extrude,
    panelTexts: object.object.panelTexts,
    lidAngle: object.lidAngle,
    opacity: object.opacity,
  });
  const geometryNode =
    geometryNodeIndex >= 0
      ? {
          ...asset.nodes[geometryNodeIndex],
          type: modelUrl ? ("cache" as const) : ("primitive" as const),
          name: object.name ?? asset.nodes[geometryNodeIndex]?.name ?? asset.name,
          parameters: {
            ...asset.nodes[geometryNodeIndex]?.parameters,
            ...geometryParameters,
          },
        }
      : {
          id: `node-${assetKey}-geometry`,
          type: modelUrl ? ("cache" as const) : ("primitive" as const),
          name: object.name ?? asset.name,
          inputs: [],
          parameters: geometryParameters,
        };
  const nodes =
    geometryNodeIndex >= 0
      ? asset.nodes.map((node, index) =>
          index === geometryNodeIndex ? geometryNode : node,
        )
      : [geometryNode, ...asset.nodes];
  const modelDependencyId = `dep-${assetKey}-model`;
  const dependencies = modelUrl
    ? [
        ...asset.dependencies.filter((dependency) => dependency.id !== modelDependencyId),
        {
          id: modelDependencyId,
          kind: "mesh" as const,
          uri: modelUrl,
          required: true,
        },
      ]
    : asset.dependencies.filter((dependency) => dependency.id !== modelDependencyId);
  return {
    ...asset,
    name: optionalString(args.assetName) ?? object.name ?? asset.name,
    kind: parseCreationAssetKind(args, object.object.kind),
    parameters: {
      ...asset.parameters,
      ...geometryParametersForMotionObject(object),
    },
    nodes,
    dependencies,
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-preview`,
      "agent-native-3d-scene-v1",
    ),
    modifiedAt: now,
  };
}

export function bakeAssetToMotionObjectMesh(
  asset: CreationAssetRecipe,
): MotionObjectMeshData | null {
  try {
    const baked = bakeRecipeMesh(asset, { quality: "preview" });
    if (baked.placeholder) return null;
    const mesh = baked.mesh;
    if (mesh.positions.length < 9 || mesh.indices.length < 3) return null;
    return {
      positions: Array.from(mesh.positions),
      normals: Array.from(mesh.normals),
      uvs: Array.from(mesh.uvs),
      indices: Array.from(mesh.indices),
    };
  } catch {
    return null;
  }
}

export const BAKED_MESH_NODE_TYPES: ReadonlySet<string> = new Set([
  "deform",
  "subdivision",
  "sdf",
  "array",
]);

export function assetNeedsBakedMesh(asset: CreationAssetRecipe | undefined): boolean {
  if (!asset) return false;
  return asset.nodes.some((node) => BAKED_MESH_NODE_TYPES.has(node.type));
}

export function updateMotionObjectForBevel(
  object: MotionSceneObject3D,
  radius: number,
  args: Record<string, unknown>,
): MotionSceneObject3D {
  const previewKind =
    args.previewRoundedBox === false || object.object.kind !== "box"
      ? object.object.kind
      : "rounded-box";
  const swapsToProxy = previewKind !== object.object.kind;
  return {
    ...object,
    object: {
      ...object.object,
      kind: previewKind,
      cornerRadius: radius,
      mesh: swapsToProxy ? undefined : object.object.mesh,
    },
  };
}

export function updateCreationAssetBevel(
  asset: CreationAssetRecipe,
  objects: readonly CreationSceneObject[],
  args: Record<string, unknown>,
  options: {
    readonly radius: number;
    readonly segments: number;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const bevelKey = idSegment(args.key ?? args.name ?? "bevel", "bevel");
  const nodeId = `node-${assetKey}-${bevelKey}`;
  const geometryNodeIndex = asset.nodes.findIndex(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part" ||
      node.type === "curve",
  );
  const sourceNode = geometryNodeIndex >= 0 ? asset.nodes[geometryNodeIndex] : undefined;
  const bevelParameters = compactCreationParameters({
    source: "agent-bevel",
    radius: options.radius,
    segments: options.segments,
    profile: optionalString(args.profile) ?? "round",
    weight: optionalNumber(args.weight) ?? optionalNumber(args.amount),
    clampOverlap: args.clampOverlap !== false,
    hardenNormals: args.hardenNormals !== false,
    affectedEdges: optionalString(args.affectedEdges) ?? optionalString(args.edges) ?? "all",
    objectIds: objects.map((object) => object.id),
    partIds: objects.map((object) => object.partId).filter(Boolean),
    previewRoundedBox: args.previewRoundedBox !== false,
  });
  const shouldPreviewRoundedBox =
    args.previewRoundedBox !== false &&
    (optionalString(asset.parameters.motionObjectKind) === "box" ||
      optionalString(sourceNode?.parameters.kind) === "box");
  const bevelNode = {
    id: nodeId,
    type: "bevel" as const,
    name: optionalString(args.nodeName) ?? optionalString(args.name) ?? "Editable bevel",
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: bevelParameters,
  };
  const geometryNode =
    sourceNode && sourceNode.type === "primitive"
      ? {
          ...sourceNode,
          parameters: compactCreationParameters({
            ...sourceNode.parameters,
            kind: shouldPreviewRoundedBox ? "rounded-box" : sourceNode.parameters.kind,
            cornerRadius: options.radius,
          }),
        }
      : sourceNode;
  const nodes = asset.nodes.some((node) => node.id === nodeId)
    ? asset.nodes.map((node) => (node.id === nodeId ? bevelNode : node))
    : [...asset.nodes, bevelNode];
  const nextNodes =
    geometryNode && geometryNodeIndex >= 0
      ? nodes.map((node, index) => (index === geometryNodeIndex ? geometryNode : node))
      : nodes;
  const previousByObject = asRecord(asset.parameters.bevelsByObjectId) ?? {};
  const nextByObject: Record<string, unknown> = { ...previousByObject };
  for (const object of objects) {
    nextByObject[object.id] = bevelParameters;
  }
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      motionObjectKind: shouldPreviewRoundedBox
        ? "rounded-box"
        : asset.parameters.motionObjectKind,
      cornerRadius: options.radius,
      bevel: bevelParameters,
      bevelsByObjectId: nextByObject,
    }),
    nodes: nextNodes,
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-${bevelKey}-preview`,
      "agent-bevel-v1",
    ),
    modifiedAt: options.now,
  };
}

export function creationDisplacementKind(value: unknown): string {
  const kind = optionalString(value);
  if (
    kind === "terrain" ||
    kind === "craters" ||
    kind === "ridges" ||
    kind === "waves" ||
    kind === "cloth-wrinkle" ||
    kind === "noise"
  ) {
    return kind;
  }
  return "noise";
}

export function updateMotionObjectForDisplacement(
  object: MotionSceneObject3D,
  args: Record<string, unknown>,
  options: { readonly amplitude: number; readonly previewDepth: number },
): MotionSceneObject3D {
  const previewAsSlab = args.previewAsSlab !== false;
  const kind =
    previewAsSlab && object.object.kind === "plane" ? "box" : object.object.kind;
  return {
    ...object,
    object: {
      ...object.object,
      kind,
      depth:
        optionalNumber(args.previewDepth) ??
        optionalNumber(args.depth) ??
        object.object.depth ??
        options.previewDepth,
    },
    material: object.material
      ? {
          ...object.material,
          roughness:
            optionalNumber(args.previewRoughness) ??
            optionalNumber(args.roughness) ??
            Math.max(object.material.roughness ?? 0, 0.78),
        }
      : object.material,
  };
}

export function updateCreationAssetDisplacement(
  asset: CreationAssetRecipe,
  objects: readonly CreationSceneObject[],
  args: Record<string, unknown>,
  options: {
    readonly kind: string;
    readonly amplitude: number;
    readonly previewDepth: number;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const displacementKey = idSegment(args.key ?? args.name ?? options.kind, "displacement");
  const nodeId = `node-${assetKey}-${displacementKey}`;
  const geometryNodeIndex = asset.nodes.findIndex(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part" ||
      node.type === "curve" ||
      node.type === "deform",
  );
  const sourceNode =
    geometryNodeIndex >= 0 ? asset.nodes[geometryNodeIndex] : undefined;
  const sourceKind =
    optionalString(asset.parameters.motionObjectKind) ??
    optionalString(sourceNode?.parameters.kind);
  const previewAsSlab = args.previewAsSlab !== false && sourceKind === "plane";
  const displacementParameters = compactCreationParameters({
    source: "agent-displacement",
    kind: options.kind,
    amplitude: options.amplitude,
    previewDepth: options.previewDepth,
    previewAsSlab,
    frequency: optionalNumber(args.frequency) ?? 1,
    octaves: optionalNumber(args.octaves) ?? 4,
    lacunarity: optionalNumber(args.lacunarity) ?? 2,
    gain: optionalNumber(args.gain) ?? 0.5,
    seed: optionalString(args.seed),
    scale: optionalNumber(args.scale) ?? optionalNumber(args.size) ?? 1,
    direction: optionalString(args.direction) ?? "normal",
    normal: vec3FromArgs(
      args.normal,
      { x: 0, y: 0, z: 1 },
      ["normalX", "normalY", "normalZ"],
      args,
    ),
    craterCount: optionalNumber(args.craterCount),
    craterRadius: optionalNumber(args.craterRadius),
    ridgeSharpness: optionalNumber(args.ridgeSharpness),
    waveLength: optionalNumber(args.waveLength),
    erosion: optionalNumber(args.erosion),
    terraces: optionalNumber(args.terraces),
    smoothing: optionalNumber(args.smoothing),
    bakeTarget: optionalString(args.bakeTarget) ?? "geometry-cache",
    objectIds: objects.map((object) => object.id),
    partIds: objects.map((object) => object.partId).filter(Boolean),
  });
  const displacementNode = {
    id: nodeId,
    type: "deform" as const,
    name:
      optionalString(args.nodeName) ??
      optionalString(args.name) ??
      "Procedural displacement",
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: displacementParameters,
  };
  const geometryNode =
    sourceNode && sourceNode.type === "primitive"
      ? {
          ...sourceNode,
          parameters: compactCreationParameters({
            ...sourceNode.parameters,
            kind: previewAsSlab ? "box" : sourceNode.parameters.kind,
            depth:
              optionalNumber(args.previewDepth) ??
              optionalNumber(args.depth) ??
              sourceNode.parameters.depth ??
              options.previewDepth,
            displacement: displacementParameters,
          }),
        }
      : sourceNode;
  const nodes = asset.nodes.some((node) => node.id === nodeId)
    ? asset.nodes.map((node) => (node.id === nodeId ? displacementNode : node))
    : [...asset.nodes, displacementNode];
  const nextNodes =
    geometryNode && geometryNodeIndex >= 0
      ? nodes.map((node, index) => (index === geometryNodeIndex ? geometryNode : node))
      : nodes;
  const previousByObject = asRecord(asset.parameters.displacementsByObjectId) ?? {};
  const nextByObject: Record<string, unknown> = { ...previousByObject };
  for (const object of objects) {
    nextByObject[object.id] = displacementParameters;
  }
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      motionObjectKind: previewAsSlab ? "box" : asset.parameters.motionObjectKind,
      depth:
        optionalNumber(args.previewDepth) ??
        optionalNumber(args.depth) ??
        asset.parameters.depth ??
        options.previewDepth,
      displacement: displacementParameters,
      displacementsByObjectId: nextByObject,
    }),
    nodes: nextNodes,
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-${displacementKey}-preview`,
      "agent-displacement-v1",
    ),
    modifiedAt: options.now,
  };
}

export const CREATION_BOOLEAN_OPERATIONS: ReadonlySet<string> = new Set([
  "union",
  "subtract",
  "difference",
  "intersect",
  "intersection",
  "smooth-union",
  "smoothunion",
  "blend",
]);

export function creationBooleanOperation(value: unknown): string {
  const raw = optionalString(value)?.toLowerCase().replace(/\s+/g, "-");
  if (raw && CREATION_BOOLEAN_OPERATIONS.has(raw)) return raw;
  return "subtract";
}

export function currentSdfRootId(
  nodes: CreationAssetRecipe["nodes"],
  excludeIds: ReadonlySet<string>,
): string | null {
  const sdfNodes = nodes.filter(
    (node) => (node.type === "sdf" || node.type === "boolean") && !excludeIds.has(node.id),
  );
  if (sdfNodes.length === 0) return null;
  const referenced = new Set<string>();
  for (const node of sdfNodes) {
    for (const inputId of node.inputs) referenced.add(inputId);
  }
  const roots = sdfNodes.filter((node) => !referenced.has(node.id));
  return (
    roots.find((node) => node.type === "boolean") ??
    roots[0] ??
    sdfNodes[sdfNodes.length - 1]!
  ).id;
}

export function bodySdfNodeFromGeometry(asset: CreationAssetRecipe, assetKey: string) {
  const params = creationGeometryParameters(asset);
  const kind =
    creationParameterString(params, "motionObjectKind") ??
    creationParameterString(params, "kind") ??
    "box";
  const size = creationParameterNumber(params, "size") ?? 1;
  const aspect = creationParameterNumber(params, "aspect") ?? 1;
  const depth = creationParameterNumber(params, "depth") ?? size;
  const isSphere = kind === "sphere" || kind === "icosahedron" || kind === "soccer-ball";
  const parameters: CreationParameters = isSphere
    ? { shape: "sphere", radius: Math.max(0.01, size / 2) }
    : {
        shape: "box",
        half: {
          x: Math.max(0.01, size / 2),
          y: Math.max(0.01, (size * aspect) / 2),
          z: Math.max(0.01, depth / 2),
        },
      };
  return {
    id: `node-${assetKey}-sdfbody`,
    type: "sdf" as const,
    name: "SDF body",
    inputs: [] as string[],
    parameters,
  };
}

export const SDF_BODY_FAITHFUL_KINDS: ReadonlySet<string> = new Set([
  "box",
  "cube",
  "sphere",
  "icosahedron",
  "soccer-ball",
]);

export function sdfBodyApproximatesPrimitive(asset: CreationAssetRecipe): boolean {
  if (asset.nodes.some((node) => node.type === "sdf")) return false;
  const params = creationGeometryParameters(asset);
  const kind =
    creationParameterString(params, "motionObjectKind") ??
    creationParameterString(params, "kind") ??
    "box";
  return !SDF_BODY_FAITHFUL_KINDS.has(kind);
}

export function sdfToolNodeParameters(args: Record<string, unknown>): CreationParameters {
  const shape = (optionalString(args.toolShape) ?? optionalString(args.shape) ?? "sphere").toLowerCase();
  const offset = vec3FromArgs(
    args.toolOffset ?? args.offset,
    { x: 0, y: 0, z: 0 },
    ["toolX", "toolY", "toolZ"],
    args,
  );
  if (shape === "box" || shape === "cube") {
    const uniform = optionalNumber(args.toolSize) ?? optionalNumber(args.size);
    const half =
      uniform !== undefined
        ? { x: uniform / 2, y: uniform / 2, z: uniform / 2 }
        : vec3FromArgs(
            args.toolHalf ?? args.half,
            { x: 0.5, y: 0.5, z: 0.5 },
            ["toolHalfX", "toolHalfY", "toolHalfZ"],
            args,
          );
    return { shape: "box", half, offset };
  }
  const radius = optionalNumber(args.toolRadius) ?? optionalNumber(args.radius) ?? 0.5;
  return { shape: "sphere", radius: Math.max(0.01, radius), offset };
}

export function uniqueBooleanKey(
  asset: CreationAssetRecipe,
  assetKey: string,
  operation: string,
): string {
  const existing = new Set(asset.nodes.map((node) => node.id));
  let candidate = idSegment(operation, "bool");
  let index = 2;
  while (existing.has(`node-${assetKey}-boolean-${candidate}`)) {
    candidate = idSegment(`${operation}-${index}`, "bool");
    index += 1;
  }
  return candidate;
}

export function updateCreationAssetBoolean(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  options: { readonly operation: string; readonly smoothing: number; readonly now: number },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const explicitKey = optionalString(args.key) ?? optionalString(args.name);
  const key = explicitKey
    ? idSegment(explicitKey, "bool")
    : uniqueBooleanKey(asset, assetKey, options.operation);
  const toolNodeId = `node-${assetKey}-sdftool-${key}`;
  const booleanNodeId = `node-${assetKey}-boolean-${key}`;
  const existingBoolean = asset.nodes.find(
    (node) => node.id === booleanNodeId && node.type === "boolean",
  );
  const existingRoot = existingBoolean?.inputs[0];
  let bodyNode: ReturnType<typeof bodySdfNodeFromGeometry> | undefined;
  let rootId: string;
  if (existingRoot && asset.nodes.some((node) => node.id === existingRoot)) {
    rootId = existingRoot;
  } else {
    const derivedRoot = currentSdfRootId(
      asset.nodes,
      new Set([toolNodeId, booleanNodeId]),
    );
    if (derivedRoot) {
      rootId = derivedRoot;
    } else {
      bodyNode = bodySdfNodeFromGeometry(asset, assetKey);
      rootId = bodyNode.id;
    }
  }
  const toolNode = {
    id: toolNodeId,
    type: "sdf" as const,
    name: optionalString(args.nodeName) ?? "Boolean tool",
    inputs: [] as string[],
    parameters: sdfToolNodeParameters(args),
  };
  const booleanNode = {
    id: booleanNodeId,
    type: "boolean" as const,
    name: optionalString(args.name) ?? `Boolean ${options.operation}`,
    inputs: [rootId, toolNodeId],
    parameters: compactCreationParameters({
      source: "agent-boolean",
      operation: options.operation,
      smoothing: options.smoothing,
    }),
  };
  const withoutDup = asset.nodes.filter(
    (node) => node.id !== toolNodeId && node.id !== booleanNodeId,
  );
  const hasBody = bodyNode ? withoutDup.some((node) => node.id === bodyNode.id) : true;
  const nextNodes = [
    ...withoutDup,
    ...(bodyNode && !hasBody ? [bodyNode] : []),
    toolNode,
    booleanNode,
  ];
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      motionObjectKind: "sdf",
      booleanOperation: options.operation,
    }),
    nodes: nextNodes,
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-${key}-preview`,
      "agent-boolean-v1",
    ),
    modifiedAt: options.now,
  };
}

export function updateCreationAssetArray(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  now: number,
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-array`;
  const geometryNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part" ||
      node.type === "curve" ||
      node.type === "sdf" ||
      node.type === "boolean" ||
      node.type === "deform",
  );
  const arrayParameters = compactCreationParameters({
    source: "agent-array",
    count: Math.round(clampNumber(optionalNumber(args.count) ?? 3, 1, 64)),
    offsetX: optionalNumber(args.offsetX) ?? optionalNumber(args.spacingX),
    offsetY: optionalNumber(args.offsetY) ?? optionalNumber(args.spacingY),
    offsetZ: optionalNumber(args.offsetZ) ?? optionalNumber(args.spacingZ),
  });
  const arrayNode = {
    id: nodeId,
    type: "array" as const,
    name: optionalString(args.nodeName) ?? optionalString(args.name) ?? "Array",
    inputs: geometryNode ? [geometryNode.id] : [],
    parameters: arrayParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({ ...asset.parameters, array: arrayParameters }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? arrayNode : node))
      : [...asset.nodes, arrayNode],
    caches: dirtyCreationAssetCaches(asset, `cache-${assetKey}-array-preview`, "agent-array-v1"),
    modifiedAt: now,
  };
}

export function cameraFromArgs(
  args: Record<string, unknown>,
  fallback: CreationCamera,
): CreationCamera {
  return {
    ...fallback,
    name: optionalString(args.name) ?? fallback.name,
    position: vec3FromArgs(
      args.position,
      fallback.position,
      ["posX", "posY", "posZ"],
      args,
    ),
    target: vec3FromArgs(
      args.target,
      fallback.target,
      ["targetX", "targetY", "targetZ"],
      args,
    ),
    fov: optionalNumber(args.fov) ?? fallback.fov,
    focusDistance: optionalNumber(args.focusDistance) ?? fallback.focusDistance,
    depthOfField:
      typeof args.depthOfField === "boolean" ? args.depthOfField : fallback.depthOfField,
  };
}

export function shiftCameraKeyframeValue(
  keyframe: Keyframe,
  previous: CreationCamera,
  next: CreationCamera,
): Keyframe {
  if (!keyframe.property.startsWith("scene.camera.") || typeof keyframe.value !== "number") {
    return keyframe;
  }
  const property = keyframe.property.slice("scene.camera.".length);
  const deltas: Record<string, number> = {
    "position.x": next.position.x - previous.position.x,
    "position.y": next.position.y - previous.position.y,
    "position.z": next.position.z - previous.position.z,
    "target.x": next.target.x - previous.target.x,
    "target.y": next.target.y - previous.target.y,
    "target.z": next.target.z - previous.target.z,
    fov: next.fov - previous.fov,
  };
  return property in deltas
    ? { ...keyframe, value: keyframe.value + deltas[property] }
    : keyframe;
}

export function updateScene3DLayerCamera(
  layer: MotionScene3DLayer,
  previous: CreationCamera,
  next: CreationCamera,
): MotionScene3DLayer {
  return {
    ...layer,
    fov: next.fov,
    camera: {
      ...layer.camera,
      position: next.position,
      target: next.target,
      fov: next.fov,
    },
    keyframes: layer.keyframes.map((keyframe) =>
      shiftCameraKeyframeValue(keyframe, previous, next),
    ),
  };
}

export const CREATION_ASSET_KINDS: ReadonlySet<string> = new Set([
  "product",
  "character",
  "environment",
  "prop",
  "ui",
  "material",
  "custom",
]);

export const CREATION_MATERIAL_MODELS: ReadonlySet<string> = new Set([
  "pbr",
  "screen",
  "glass",
  "metal",
  "plastic",
  "fabric",
  "emissive",
  "procedural",
]);

export const CREATION_ENVIRONMENT_KINDS: ReadonlySet<string> = new Set([
  "none",
  "studio",
  "stage",
  "outdoor",
  "space",
  "custom",
]);

export const CREATION_LIGHT_KINDS: ReadonlySet<string> = new Set([
  "ambient",
  "directional",
  "point",
  "area",
  "spot",
]);

export type CreationMaterialPreset = {
  readonly name: string;
  readonly model: CreationMaterialModel;
  readonly baseColor: string;
  readonly metallic?: number;
  readonly roughness?: number;
  readonly opacity?: number;
  readonly transmission?: number;
  readonly clearcoat?: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly texture: string;
};

export const CREATION_MATERIAL_PRESETS = {
  "brushed-titanium": {
    name: "Brushed titanium",
    model: "metal",
    baseColor: "#b7b8b4",
    metallic: 0.95,
    roughness: 0.28,
    clearcoat: 0.22,
    texture: "anisotropic-brushed-metal",
  },
  "polished-aluminum": {
    name: "Polished aluminum",
    model: "metal",
    baseColor: "#d7dce1",
    metallic: 0.9,
    roughness: 0.18,
    clearcoat: 0.35,
    texture: "fine-metal-grain",
  },
  "ceramic-glass": {
    name: "Ceramic glass",
    model: "glass",
    baseColor: "#eef5ff",
    metallic: 0,
    roughness: 0.04,
    opacity: 0.82,
    transmission: 0.72,
    clearcoat: 0.8,
    texture: "subtle-smudges",
  },
  "oled-screen": {
    name: "OLED screen",
    model: "screen",
    baseColor: "#050816",
    metallic: 0,
    roughness: 0.16,
    emissive: "#38bdf8",
    emissiveIntensity: 1.35,
    texture: "screen-subpixels",
  },
  "silicon-chip": {
    name: "Silicon chip",
    model: "pbr",
    baseColor: "#111827",
    metallic: 0.25,
    roughness: 0.38,
    emissive: "#22c55e",
    emissiveIntensity: 0.18,
    texture: "circuit-traces",
  },
  "copper-trace": {
    name: "Copper trace",
    model: "metal",
    baseColor: "#b86b2f",
    metallic: 0.88,
    roughness: 0.24,
    clearcoat: 0.18,
    texture: "copper-brush",
  },
  "matte-plastic": {
    name: "Matte plastic",
    model: "plastic",
    baseColor: "#1f2937",
    metallic: 0,
    roughness: 0.72,
    texture: "fine-plastic-grain",
  },
  "rubber-gasket": {
    name: "Rubber gasket",
    model: "plastic",
    baseColor: "#0f172a",
    metallic: 0,
    roughness: 0.86,
    texture: "soft-rubber",
  },
  "lunar-dust": {
    name: "Lunar dust",
    model: "procedural",
    baseColor: "#c8c3b8",
    metallic: 0,
    roughness: 0.94,
    texture: "regolith-noise",
  },
  "flag-fabric": {
    name: "Flag fabric",
    model: "fabric",
    baseColor: "#facc15",
    metallic: 0,
    roughness: 0.82,
    texture: "woven-fabric",
  },
} as const satisfies Record<string, CreationMaterialPreset>;

export type CreationMaterialPresetId = keyof typeof CREATION_MATERIAL_PRESETS;

export function idSegment(value: unknown, fallback: string): string {
  const source = optionalString(value) ?? fallback;
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function uniqueIdSegment(
  value: unknown,
  fallback: string,
  used: Set<string>,
): string {
  const base = idSegment(value, fallback);
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

export function compactCreationParameters(
  entries: Record<string, unknown>,
): CreationParameters {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      out[key] = value.flatMap((entry) => {
        if (
          entry === null ||
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean"
        ) {
          return [entry];
        }
        const record = asRecord(entry);
        if (!record) return [];
        const nested = compactCreationParameters(record);
        return Object.keys(nested).length > 0 ? [nested] : [];
      });
      continue;
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
      continue;
    }
    const record = asRecord(value);
    if (record) {
      const nested = compactCreationParameters(record);
      if (Object.keys(nested).length > 0) out[key] = nested;
    }
  }
  return out as CreationParameters;
}

export function parseCreationAssetKind(
  raw: Record<string, unknown>,
  objectKind: MotionObject3DKind,
): CreationAssetKind {
  const explicit = optionalString(raw.assetKind);
  if (explicit && CREATION_ASSET_KINDS.has(explicit)) {
    return explicit as CreationAssetKind;
  }
  if (objectKind === "room" || raw.environment === true) return "environment";
  if (objectKind === "phone") return "product";
  if (objectKind === "text3d") return "ui";
  return "prop";
}

export function parseCreationMaterialModel(
  raw: Record<string, unknown>,
  material: MotionMaterial3D | undefined,
): CreationMaterialModel {
  const explicit =
    optionalString(raw.materialModel) ??
    optionalString(raw.model) ??
    optionalString(raw.creationMaterialModel);
  if (explicit && CREATION_MATERIAL_MODELS.has(explicit)) {
    return explicit as CreationMaterialModel;
  }
  if (material?.emissive) return "emissive";
  if ((material?.opacity ?? 1) < 0.92) return "glass";
  if ((material?.metalness ?? 0) > 0.55) return "metal";
  return "pbr";
}

export function creationMaterialFromSceneObject(
  key: string,
  raw: Record<string, unknown>,
  motionObject: MotionSceneObject3D,
): CreationMaterial {
  const material = motionObject.material;
  return {
    id: optionalString(raw.materialId) ?? `mat-${key}`,
    name: optionalString(raw.materialName) ?? `${motionObject.name ?? key} material`,
    model: parseCreationMaterialModel(raw, material),
    baseColor: material?.color ?? optionalString(raw.baseColor) ?? "#cbd5e1",
    metallic: material?.metalness,
    roughness: material?.roughness,
    opacity: motionObject.opacity ?? material?.opacity,
    emissive: material?.emissive,
    emissiveIntensity: material?.emissiveIntensity,
    textureCacheId: material?.mapAssetId,
    parameters: compactCreationParameters({
      materialKind: material?.kind,
      mapAssetId: material?.mapAssetId,
      normalMapAssetId: material?.normalMapAssetId,
      roughnessMapAssetId: material?.roughnessMapAssetId,
      metalnessMapAssetId: material?.metalnessMapAssetId,
    }),
  };
}

export function creationAssetFromSceneObject(
  key: string,
  raw: Record<string, unknown>,
  motionObject: MotionSceneObject3D,
  material: CreationMaterial,
  now: number,
): CreationAssetRecipe {
  const object = motionObject.object;
  const assetId = optionalString(raw.assetId) ?? `asset-${key}`;
  const modelUrl = optionalString(raw.modelUrl);
  return {
    id: assetId,
    name: optionalString(raw.assetName) ?? motionObject.name ?? key,
    kind: parseCreationAssetKind(raw, object.kind),
    seed: optionalString(raw.seed) ?? `${assetId}-seed`,
    parameters: compactCreationParameters({
      source: "agent-native-3d-scene",
      motionObjectKind: object.kind,
      size: object.size,
      depth: object.depth,
      aspect: object.aspect,
      cornerRadius: object.cornerRadius,
      text: object.text,
      extrude: object.extrude,
      panelTexts: object.panelTexts,
      lidAngle: motionObject.lidAngle,
    }),
    nodes: [
      {
        id: `node-${key}-${modelUrl ? "model" : "primitive"}`,
        type: modelUrl ? "cache" : "primitive",
        name: motionObject.name ?? key,
        inputs: [],
        parameters: compactCreationParameters({
          kind: object.kind,
          size: object.size,
          depth: object.depth,
          aspect: object.aspect,
          cornerRadius: object.cornerRadius,
          modelUrl,
          text: object.text,
          extrude: object.extrude,
          panelTexts: object.panelTexts,
          materialId: material.id,
        }),
      },
      {
        id: `node-${key}-material`,
        type: "material",
        name: material.name,
        inputs: [`node-${key}-${modelUrl ? "model" : "primitive"}`],
        parameters: compactCreationParameters({
          materialId: material.id,
          model: material.model,
          baseColor: material.baseColor,
        }),
      },
    ],
    materials: [material],
    dependencies: modelUrl
      ? [
          {
            id: `dep-${key}-model`,
            kind: "mesh",
            uri: modelUrl,
            required: true,
          },
        ]
      : [],
    caches: [
      {
        id: `cache-${key}-preview`,
        kind: "preview-mesh",
        status: "dirty",
        generatorVersion: "agent-native-3d-scene-v1",
      },
    ],
    createdAt: now,
    modifiedAt: now,
  };
}

export function updateCreationAssetProductPart(
  asset: CreationAssetRecipe,
  object: CreationSceneObject,
  args: Record<string, unknown>,
  options: {
    readonly role: CreationProductPartRole;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-product-part`;
  const sourceNode = asset.nodes.find(
    (node) => node.type === "primitive" || node.type === "cache",
  );
  const anchor = vec3FromArgs(
    args.anchor ?? args.calloutAnchor,
    object.transform.position,
    ["anchorX", "anchorY", "anchorZ"],
    args,
  );
  const productPartParameters = compactCreationParameters({
    source: "agent-product-part",
    role: options.role,
    objectId: object.id,
    partId: object.partId,
    parentId: object.parentId,
    name: object.name,
    calloutAnchor: anchor,
    semanticLayer: optionalString(args.semanticLayer) ?? optionalString(args.layer),
    exactness: optionalString(args.exactness) ?? "plausible-editable",
    referenceIds: parseStringArray(args.referenceIds ?? args.references),
    notes: optionalString(args.notes),
  });
  const productPartNode = {
    id: nodeId,
    type: "product-part" as const,
    name: optionalString(args.nodeName) ?? object.name,
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: productPartParameters,
  };
  return {
    ...asset,
    kind: "product",
    parameters: compactCreationParameters({
      ...asset.parameters,
      productPart: productPartParameters,
      productPartRole: options.role,
      productPartId: object.partId,
      calloutAnchor: anchor,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? productPartNode : node))
      : [...asset.nodes, productPartNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-product-part-preview`,
      "agent-product-part-v1",
    ),
    modifiedAt: options.now,
  };
}

export interface CreationScreenStackLayerSpec {
  readonly key: string;
  readonly name: string;
  readonly kind: MotionObject3DKind;
  readonly materialModel: CreationMaterialModel;
  readonly materialKind?: "basic" | "physical";
  readonly color: string;
  readonly opacity: number;
  readonly roughness: number;
  readonly metalness?: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly thickness: number;
  readonly localZ?: number;
  readonly widthMultiplier: number;
  readonly heightMultiplier: number;
  readonly cornerRadius?: number;
  readonly mapAssetId?: string;
  readonly semanticLayer: string;
  readonly tags: readonly string[];
}

export function creationMaterialModelFromValue(
  value: unknown,
  fallback: CreationMaterialModel,
): CreationMaterialModel {
  const model = optionalString(value);
  return model && CREATION_MATERIAL_MODELS.has(model)
    ? (model as CreationMaterialModel)
    : fallback;
}

export function creationMotionObjectKindFromValue(
  value: unknown,
  fallback: MotionObject3DKind,
): MotionObject3DKind {
  const kind = optionalString(value);
  return kind && MOTION_OBJECT_3D_KINDS.includes(kind as never)
    ? (kind as MotionObject3DKind)
    : fallback;
}

export function parseCreationScreenStackLayers(
  args: Record<string, unknown>,
): readonly CreationScreenStackLayerSpec[] {
  const fallbackCornerRadius = optionalNumber(args.cornerRadius);
  const fallbackMapAssetId = optionalString(args.mapAssetId);
  const fallbackThickness = optionalNumber(args.thickness);
  const defaultLayers: CreationScreenStackLayerSpec[] = [
    {
      key: "cover-glass",
      name: "Cover glass",
      kind: "rounded-box",
      materialModel: "glass",
      color: "#dbeafe",
      opacity: 0.42,
      roughness: 0.04,
      emissive: "#93c5fd",
      emissiveIntensity: 0.05,
      thickness: fallbackThickness ?? 0.012,
      widthMultiplier: 1,
      heightMultiplier: 1,
      cornerRadius: fallbackCornerRadius ?? 0.035,
      semanticLayer: "display-cover",
      tags: ["glass", "cover"],
    },
    {
      key: "oled",
      name: "OLED panel",
      kind: "rounded-box",
      materialModel: "screen",
      color: "#020617",
      opacity: 0.96,
      roughness: 0.16,
      emissive: "#38bdf8",
      emissiveIntensity: 0.78,
      thickness: fallbackThickness ?? 0.018,
      widthMultiplier: 0.98,
      heightMultiplier: 0.98,
      cornerRadius: fallbackCornerRadius ?? 0.03,
      mapAssetId: fallbackMapAssetId,
      semanticLayer: "display-emissive",
      tags: ["display", "oled", "emissive"],
    },
    {
      key: "digitizer",
      name: "Touch digitizer",
      kind: "rounded-box",
      materialModel: "glass",
      color: "#0f172a",
      opacity: 0.28,
      roughness: 0.1,
      thickness: fallbackThickness ?? 0.01,
      widthMultiplier: 0.99,
      heightMultiplier: 0.99,
      cornerRadius: fallbackCornerRadius ?? 0.032,
      semanticLayer: "display-touch",
      tags: ["touch", "digitizer", "transparent"],
    },
    {
      key: "backplate",
      name: "Display backplate",
      kind: "rounded-box",
      materialModel: "metal",
      color: "#1f2937",
      opacity: 1,
      roughness: 0.38,
      metalness: 0.36,
      thickness: fallbackThickness ?? 0.024,
      widthMultiplier: 1.01,
      heightMultiplier: 1.01,
      cornerRadius: fallbackCornerRadius ?? 0.038,
      semanticLayer: "display-support",
      tags: ["backplate", "support"],
    },
  ];

  const removeDefaultLayer = (key: string): void => {
    const index = defaultLayers.findIndex((layer) => layer.key === key);
    if (index >= 0) defaultLayers.splice(index, 1);
  };
  if (args.includeGlass === false) removeDefaultLayer("cover-glass");
  if (args.includeOled === false) removeDefaultLayer("oled");
  if (args.includeDigitizer === false) removeDefaultLayer("digitizer");
  if (args.includeBacklight === false || args.includeBackplate === false) {
    removeDefaultLayer("backplate");
  }
  if (args.includeFrame === true) {
    defaultLayers.push({
      key: "bezel-frame",
      name: "Display frame",
      kind: "rounded-box",
      materialModel: "metal",
      color: "#111827",
      opacity: 1,
      roughness: 0.3,
      metalness: 0.64,
      thickness: fallbackThickness ?? 0.03,
      widthMultiplier: 1.08,
      heightMultiplier: 1.08,
      cornerRadius: fallbackCornerRadius ?? 0.045,
      semanticLayer: "display-frame",
      tags: ["frame", "bezel"],
    });
  }

  const provided = Array.isArray(args.layers) ? args.layers : undefined;
  if (!provided || provided.length === 0) return defaultLayers;

  const usedKeys = new Set<string>();
  const layers: CreationScreenStackLayerSpec[] = [];
  for (let index = 0; index < provided.length; index += 1) {
    const record = asRecord(provided[index]);
    if (!record) continue;
    const fallback = defaultLayers[Math.min(index, defaultLayers.length - 1)];
    const key = uniqueIdSegment(
      record.key ?? record.id ?? record.name,
      `layer-${index + 1}`,
      usedKeys,
    );
    const materialModel = creationMaterialModelFromValue(
      record.materialModel ?? record.model,
      fallback?.materialModel ?? "pbr",
    );
    const materialKind =
      optionalString(record.materialKind) === "basic" ? "basic" : "physical";
    layers.push({
      key,
      name: optionalString(record.name) ?? fallback?.name ?? `Screen layer ${index + 1}`,
      kind: creationMotionObjectKindFromValue(record.kind, fallback?.kind ?? "rounded-box"),
      materialModel,
      materialKind,
      color:
        optionalString(record.color) ??
        optionalString(record.baseColor) ??
        fallback?.color ??
        "#0f172a",
      opacity: clampNumber(optionalNumber(record.opacity) ?? fallback?.opacity ?? 1, 0.02, 1),
      roughness: clampNumber(optionalNumber(record.roughness) ?? fallback?.roughness ?? 0.35, 0, 1),
      metalness:
        optionalNumber(record.metalness) ??
        optionalNumber(record.metallic) ??
        fallback?.metalness,
      emissive: optionalString(record.emissive) ?? fallback?.emissive,
      emissiveIntensity:
        optionalNumber(record.emissiveIntensity) ?? fallback?.emissiveIntensity,
      thickness: Math.max(
        0.001,
        optionalNumber(record.thickness) ??
          optionalNumber(record.depth) ??
          fallback?.thickness ??
          0.012,
      ),
      localZ: optionalNumber(record.localZ) ?? optionalNumber(record.z),
      widthMultiplier: Math.max(
        0.01,
        optionalNumber(record.widthMultiplier) ?? fallback?.widthMultiplier ?? 1,
      ),
      heightMultiplier: Math.max(
        0.01,
        optionalNumber(record.heightMultiplier) ?? fallback?.heightMultiplier ?? 1,
      ),
      cornerRadius:
        optionalNumber(record.cornerRadius) ??
        fallback?.cornerRadius ??
        fallbackCornerRadius,
      mapAssetId: optionalString(record.mapAssetId) ?? fallback?.mapAssetId,
      semanticLayer:
        optionalString(record.semanticLayer) ??
        optionalString(record.layer) ??
        fallback?.semanticLayer ??
        "display-stack",
      tags: [
        ...new Set([
          ...(parseStringArray(record.tags) ?? []),
          ...(fallback?.tags ?? []),
        ]),
      ],
    });
  }
  return layers.length > 0 ? layers : defaultLayers;
}

export function updateCreationAssetScreenStackLayer(
  asset: CreationAssetRecipe,
  object: CreationSceneObject,
  args: Record<string, unknown>,
  options: {
    readonly stackId: string;
    readonly layer: CreationScreenStackLayerSpec;
    readonly layerIndex: number;
    readonly layerCount: number;
    readonly layerObjectIds: readonly string[];
    readonly layerAssetIds: readonly string[];
    readonly layerRenderObjectIds: readonly string[];
    readonly targetObjects: readonly CreationSceneObject[];
    readonly normal: CreationVec3;
    readonly width: number;
    readonly height: number;
    readonly spacing: number;
    readonly localZ: number;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-screen-stack`;
  const sourceNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part",
  );
  const stackParameters = compactCreationParameters({
    source: "agent-screen-stack",
    stackId: options.stackId,
    layerKey: options.layer.key,
    layerName: options.layer.name,
    layerIndex: options.layerIndex,
    layerCount: options.layerCount,
    objectId: object.id,
    partId: object.partId,
    targetObjectIds: options.targetObjects.map((target) => target.id),
    targetPartIds: options.targetObjects.map((target) => target.partId).filter(Boolean),
    layerObjectIds: options.layerObjectIds,
    layerAssetIds: options.layerAssetIds,
    layerRenderObjectIds: options.layerRenderObjectIds,
    normal: options.normal,
    width: options.width,
    height: options.height,
    thickness: options.layer.thickness,
    spacing: options.spacing,
    localZ: options.localZ,
    semanticLayer: options.layer.semanticLayer,
    mapAssetId: options.layer.mapAssetId,
    exactness: optionalString(args.exactness) ?? "plausible-editable",
    bakeTarget: optionalString(args.bakeTarget) ?? "display-stack-mesh",
  });
  const stackNode = {
    id: nodeId,
    type: "array" as const,
    name: optionalString(args.nodeName) ?? "Screen stack layer",
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: stackParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      screenStack: stackParameters,
      screenStackId: options.stackId,
      screenStackLayerKey: options.layer.key,
      screenStackLayerIndex: options.layerIndex,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? stackNode : node))
      : [...asset.nodes, stackNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-screen-stack-preview`,
      "agent-screen-stack-v1",
    ),
    modifiedAt: options.now,
  };
}

export interface CreationCameraModuleComponentSpec {
  readonly key: string;
  readonly name: string;
  readonly role: CreationProductPartRole;
  readonly kind: MotionObject3DKind;
  readonly materialModel: CreationMaterialModel;
  readonly materialKind?: "basic" | "physical";
  readonly color: string;
  readonly opacity?: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly scale: CreationVec3;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  readonly cornerRadius?: number;
  readonly lensIndex?: number;
  readonly semanticLayer: string;
  readonly tags: readonly string[];
}

export function creationCameraLensPositions(
  count: number,
  width: number,
  height: number,
): readonly { readonly x: number; readonly y: number }[] {
  if (count <= 1) return [{ x: 0, y: 0 }];
  if (count === 2) {
    return [
      { x: -width * 0.2, y: height * 0.16 },
      { x: width * 0.2, y: -height * 0.16 },
    ];
  }
  if (count === 3) {
    return [
      { x: -width * 0.22, y: height * 0.2 },
      { x: width * 0.22, y: height * 0.2 },
      { x: 0, y: -height * 0.2 },
    ];
  }
  return [
    { x: -width * 0.22, y: height * 0.22 },
    { x: width * 0.22, y: height * 0.22 },
    { x: -width * 0.22, y: -height * 0.22 },
    { x: width * 0.22, y: -height * 0.22 },
  ];
}

export function parseCreationCameraModuleComponents(
  args: Record<string, unknown>,
  options: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly lensCount: number;
  },
): readonly CreationCameraModuleComponentSpec[] {
  const lensDiameter = Math.max(
    0.04,
    optionalNumber(args.lensDiameter) ??
      Math.min(options.width, options.height) * 0.32,
  );
  const ringDiameter = Math.max(lensDiameter, optionalNumber(args.ringDiameter) ?? lensDiameter * 1.18);
  const lensDepth = Math.max(0.006, optionalNumber(args.lensDepth) ?? options.depth * 0.55);
  const componentZ = options.depth * 0.58;
  const components: CreationCameraModuleComponentSpec[] = [
    {
      key: "island",
      name: optionalString(args.name) ?? "Camera island",
      role: "camera-module",
      kind: "rounded-box",
      materialModel: "metal",
      color:
        optionalString(args.color) ??
        optionalString(args.baseColor) ??
        "#1e293b",
      roughness: optionalNumber(args.roughness) ?? 0.28,
      metalness:
        optionalNumber(args.metalness) ??
        optionalNumber(args.metallic) ??
        0.65,
      scale: { x: options.width, y: options.height, z: options.depth },
      localX: 0,
      localY: 0,
      localZ: 0,
      cornerRadius: optionalNumber(args.cornerRadius) ?? 0.05,
      semanticLayer: "camera-housing",
      tags: ["camera", "module", "housing"],
    },
  ];

  const positions = creationCameraLensPositions(
    options.lensCount,
    options.width,
    options.height,
  );
  positions.forEach((position, index) => {
    const lensIndex = index + 1;
    components.push(
      {
        key: `lens-${lensIndex}-ring`,
        name: `Lens ${lensIndex} ring`,
        role: "lens",
        kind: "torus",
        materialModel: "metal",
        color: optionalString(args.ringColor) ?? "#475569",
        roughness: optionalNumber(args.ringRoughness) ?? 0.2,
        metalness: optionalNumber(args.ringMetalness) ?? 0.86,
        scale: { x: ringDiameter, y: ringDiameter, z: Math.max(0.012, lensDepth * 0.36) },
        localX: position.x,
        localY: position.y,
        localZ: componentZ,
        lensIndex,
        semanticLayer: "camera-lens-ring",
        tags: ["camera", "lens", "ring", "metal"],
      },
      {
        key: `lens-${lensIndex}-glass`,
        name: `Lens ${lensIndex} glass`,
        role: "lens",
        kind: "cylinder",
        materialModel: "glass",
        color: optionalString(args.lensColor) ?? "#020617",
        opacity: clampNumber(optionalNumber(args.lensOpacity) ?? 0.86, 0.02, 1),
        roughness: optionalNumber(args.lensRoughness) ?? 0.05,
        metalness: optionalNumber(args.lensMetalness) ?? 0.1,
        emissive: optionalString(args.lensEmissive) ?? "#1e293b",
        emissiveIntensity: optionalNumber(args.lensEmissiveIntensity) ?? 0.18,
        scale: { x: lensDiameter, y: lensDepth, z: lensDiameter },
        localX: position.x,
        localY: position.y,
        localZ: componentZ + 0.012,
        lensIndex,
        semanticLayer: "camera-lens-glass",
        tags: ["camera", "lens", "glass"],
      },
    );
    if (args.includeSensors !== false) {
      components.push({
        key: `lens-${lensIndex}-sensor`,
        name: `Lens ${lensIndex} sensor`,
        role: "camera-module",
        kind: "cylinder",
        materialModel: "screen",
        color: optionalString(args.sensorColor) ?? "#0f172a",
        opacity: 0.94,
        roughness: optionalNumber(args.sensorRoughness) ?? 0.22,
        emissive: optionalString(args.sensorEmissive) ?? "#2563eb",
        emissiveIntensity: optionalNumber(args.sensorEmissiveIntensity) ?? 0.22,
        scale: { x: lensDiameter * 0.56, y: lensDepth * 0.45, z: lensDiameter * 0.56 },
        localX: position.x,
        localY: position.y,
        localZ: componentZ - 0.018,
        lensIndex,
        semanticLayer: "camera-sensor",
        tags: ["camera", "sensor", "internal"],
      });
    }
  });

  if (args.includeFlash !== false) {
    components.push({
      key: "flash",
      name: "Camera flash",
      role: "decorative",
      kind: "cylinder",
      materialModel: "emissive",
      materialKind: "basic",
      color: optionalString(args.flashColor) ?? "#fde68a",
      opacity: 0.92,
      roughness: 0.18,
      emissive: optionalString(args.flashEmissive) ?? "#facc15",
      emissiveIntensity: optionalNumber(args.flashEmissiveIntensity) ?? 0.85,
      scale: { x: lensDiameter * 0.38, y: lensDepth * 0.35, z: lensDiameter * 0.38 },
      localX: options.width * 0.28,
      localY: -options.height * 0.28,
      localZ: componentZ + 0.006,
      semanticLayer: "camera-flash",
      tags: ["camera", "flash", "emissive"],
    });
  }

  if (args.includeDepthSensor === true || args.includeLidar === true) {
    components.push({
      key: "depth-sensor",
      name: "Depth sensor",
      role: "camera-module",
      kind: "cylinder",
      materialModel: "glass",
      color: optionalString(args.depthSensorColor) ?? "#111827",
      opacity: 0.78,
      roughness: 0.08,
      emissive: optionalString(args.depthSensorEmissive) ?? "#38bdf8",
      emissiveIntensity: optionalNumber(args.depthSensorEmissiveIntensity) ?? 0.16,
      scale: { x: lensDiameter * 0.34, y: lensDepth * 0.3, z: lensDiameter * 0.34 },
      localX: -options.width * 0.28,
      localY: -options.height * 0.28,
      localZ: componentZ + 0.004,
      semanticLayer: "camera-depth-sensor",
      tags: ["camera", "depth-sensor", "glass"],
    });
  }

  return components;
}

export function creationCameraModuleComponentRotation(
  normal: CreationVec3,
  baseRotation: CreationVec3,
  kind: MotionObject3DKind,
): CreationVec3 {
  if (kind !== "cylinder" && kind !== "torus") return baseRotation;
  const absX = Math.abs(normal.x);
  const absY = Math.abs(normal.y);
  const absZ = Math.abs(normal.z);
  if (absZ >= absX && absZ >= absY) {
    return {
      ...baseRotation,
      x: baseRotation.x + (normal.z >= 0 ? 90 : -90),
    };
  }
  if (absX >= absY && absX >= absZ) {
    return {
      ...baseRotation,
      z: baseRotation.z + (normal.x >= 0 ? -90 : 90),
    };
  }
  return baseRotation;
}

export function updateCreationAssetCameraModuleComponent(
  asset: CreationAssetRecipe,
  object: CreationSceneObject,
  args: Record<string, unknown>,
  options: {
    readonly moduleId: string;
    readonly component: CreationCameraModuleComponentSpec;
    readonly componentIndex: number;
    readonly componentCount: number;
    readonly componentObjectIds: readonly string[];
    readonly componentAssetIds: readonly string[];
    readonly componentRenderObjectIds: readonly string[];
    readonly targetObjects: readonly CreationSceneObject[];
    readonly normal: CreationVec3;
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly lensCount: number;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-camera-module`;
  const sourceNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part",
  );
  const moduleParameters = compactCreationParameters({
    source: "agent-camera-module",
    moduleId: options.moduleId,
    componentKey: options.component.key,
    componentName: options.component.name,
    componentRole: options.component.role,
    componentIndex: options.componentIndex,
    componentCount: options.componentCount,
    objectId: object.id,
    partId: object.partId,
    lensIndex: options.component.lensIndex,
    lensCount: options.lensCount,
    targetObjectIds: options.targetObjects.map((target) => target.id),
    targetPartIds: options.targetObjects.map((target) => target.partId).filter(Boolean),
    componentObjectIds: options.componentObjectIds,
    componentAssetIds: options.componentAssetIds,
    componentRenderObjectIds: options.componentRenderObjectIds,
    normal: options.normal,
    width: options.width,
    height: options.height,
    depth: options.depth,
    localX: options.component.localX,
    localY: options.component.localY,
    localZ: options.component.localZ,
    semanticLayer: options.component.semanticLayer,
    exactness: optionalString(args.exactness) ?? "plausible-editable",
    bakeTarget: optionalString(args.bakeTarget) ?? "camera-module-mesh",
  });
  const moduleNode = {
    id: nodeId,
    type: "array" as const,
    name: optionalString(args.nodeName) ?? "Camera module component",
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: moduleParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      cameraModule: moduleParameters,
      cameraModuleId: options.moduleId,
      cameraModuleComponentKey: options.component.key,
      cameraModuleComponentIndex: options.componentIndex,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? moduleNode : node))
      : [...asset.nodes, moduleNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-camera-module-preview`,
      "agent-camera-module-v1",
    ),
    modifiedAt: options.now,
  };
}

export interface CreationProductInternalsComponentSpec {
  readonly key: string;
  readonly name: string;
  readonly role: CreationProductPartRole;
  readonly kind: MotionObject3DKind;
  readonly materialModel: CreationMaterialModel;
  readonly materialKind?: "basic" | "physical";
  readonly color: string;
  readonly opacity?: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly scale: CreationVec3;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  readonly cornerRadius?: number;
  readonly semanticLayer: string;
  readonly tags: readonly string[];
}

export function parseCreationProductInternalsComponents(
  args: Record<string, unknown>,
  options: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
  },
): readonly CreationProductInternalsComponentSpec[] {
  const width = options.width;
  const height = options.height;
  const depth = options.depth;
  const boardWidth = Math.max(0.05, optionalNumber(args.boardWidth) ?? width * 0.44);
  const boardHeight = Math.max(0.05, optionalNumber(args.boardHeight) ?? height * 0.5);
  const boardThickness = Math.max(0.004, optionalNumber(args.boardThickness) ?? depth * 0.3);
  const boardX = optionalNumber(args.boardX) ?? width * 0.18;
  const boardY = optionalNumber(args.boardY) ?? height * 0.04;
  const batteryWidth = Math.max(0.05, optionalNumber(args.batteryWidth) ?? width * 0.38);
  const batteryHeight = Math.max(0.05, optionalNumber(args.batteryHeight) ?? height * 0.62);
  const batteryThickness = Math.max(0.004, optionalNumber(args.batteryThickness) ?? depth * 0.32);
  const batteryX = optionalNumber(args.batteryX) ?? -width * 0.22;
  const batteryY = optionalNumber(args.batteryY) ?? -height * 0.04;
  const components: CreationProductInternalsComponentSpec[] = [];

  if (args.includeThermal !== false) {
    components.push({
      key: "thermal-layer",
      name: "Thermal layer",
      role: "thermal",
      kind: "rounded-box",
      materialModel: "metal",
      color: optionalString(args.thermalColor) ?? "#b86b2f",
      roughness: optionalNumber(args.thermalRoughness) ?? 0.34,
      metalness: optionalNumber(args.thermalMetalness) ?? 0.72,
      scale: { x: width * 0.86, y: height * 0.78, z: depth * 0.18 },
      localX: 0,
      localY: 0,
      localZ: 0,
      cornerRadius: optionalNumber(args.thermalCornerRadius) ?? 0.018,
      semanticLayer: "internal-thermal",
      tags: ["internal", "thermal", "heat-spreader"],
    });
  }

  if (args.includeBoard !== false) {
    components.push({
      key: "logic-board",
      name: optionalString(args.boardName) ?? "Logic board",
      role: "board",
      kind: "rounded-box",
      materialModel: "pbr",
      color: optionalString(args.boardColor) ?? "#064e3b",
      roughness: optionalNumber(args.boardRoughness) ?? 0.56,
      metalness: optionalNumber(args.boardMetalness) ?? 0.08,
      scale: { x: boardWidth, y: boardHeight, z: boardThickness },
      localX: boardX,
      localY: boardY,
      localZ: depth * 0.35,
      cornerRadius: optionalNumber(args.boardCornerRadius) ?? 0.024,
      semanticLayer: "internal-board",
      tags: ["internal", "board", "circuit"],
    });
  }

  if (args.includeBattery !== false) {
    components.push({
      key: "battery-pack",
      name: optionalString(args.batteryName) ?? "Battery pack",
      role: "battery",
      kind: "rounded-box",
      materialModel: "plastic",
      color: optionalString(args.batteryColor) ?? "#111827",
      roughness: optionalNumber(args.batteryRoughness) ?? 0.68,
      metalness: optionalNumber(args.batteryMetalness) ?? 0.02,
      scale: { x: batteryWidth, y: batteryHeight, z: batteryThickness },
      localX: batteryX,
      localY: batteryY,
      localZ: depth * 0.33,
      cornerRadius: optionalNumber(args.batteryCornerRadius) ?? 0.04,
      semanticLayer: "internal-power",
      tags: ["internal", "battery", "power"],
    });
  }

  const chipCount =
    args.includeChips === false
      ? 0
      : Math.max(0, Math.min(16, Math.floor(optionalNumber(args.chipCount) ?? 3)));
  const chipColumns = Math.max(1, Math.ceil(Math.sqrt(chipCount)));
  const chipRows = Math.max(1, Math.ceil(chipCount / chipColumns));
  for (let index = 0; index < chipCount; index += 1) {
    const col = index % chipColumns;
    const row = Math.floor(index / chipColumns);
    components.push({
      key: `chip-${index + 1}`,
      name: index === 0 ? "Main processor" : `Support chip ${index + 1}`,
      role: "chip",
      kind: "rounded-box",
      materialModel: "pbr",
      color: optionalString(args.chipColor) ?? "#111827",
      roughness: optionalNumber(args.chipRoughness) ?? 0.38,
      metalness: optionalNumber(args.chipMetalness) ?? 0.22,
      emissive: optionalString(args.chipEmissive) ?? "#22c55e",
      emissiveIntensity: optionalNumber(args.chipEmissiveIntensity) ?? 0.16,
      scale: {
        x: Math.max(0.025, optionalNumber(args.chipWidth) ?? boardWidth * 0.18),
        y: Math.max(0.02, optionalNumber(args.chipHeight) ?? boardHeight * 0.18),
        z: Math.max(0.004, optionalNumber(args.chipThickness) ?? depth * 0.18),
      },
      localX: boardX + (col - (chipColumns - 1) / 2) * boardWidth * 0.26,
      localY: boardY + (row - (chipRows - 1) / 2) * boardHeight * 0.24,
      localZ: depth * 0.68,
      cornerRadius: optionalNumber(args.chipCornerRadius) ?? 0.012,
      semanticLayer: "internal-chip",
      tags: ["internal", "chip", index === 0 ? "processor" : "support-chip"],
    });
  }

  const connectorCount =
    args.includeConnectors === false
      ? 0
      : Math.max(0, Math.min(24, Math.floor(optionalNumber(args.connectorCount) ?? 3)));
  for (let index = 0; index < connectorCount; index += 1) {
    const centered = index - (connectorCount - 1) / 2;
    components.push({
      key: `connector-${index + 1}`,
      name: `Connector ${index + 1}`,
      role: "connector",
      kind: "rounded-box",
      materialModel: "metal",
      color: optionalString(args.connectorColor) ?? "#b86b2f",
      roughness: optionalNumber(args.connectorRoughness) ?? 0.22,
      metalness: optionalNumber(args.connectorMetalness) ?? 0.88,
      scale: {
        x: Math.max(0.02, optionalNumber(args.connectorWidth) ?? width * 0.1),
        y: Math.max(0.01, optionalNumber(args.connectorHeight) ?? height * 0.035),
        z: Math.max(0.004, optionalNumber(args.connectorThickness) ?? depth * 0.16),
      },
      localX: -width * 0.02 + centered * width * 0.1,
      localY: -height * 0.38,
      localZ: depth * 0.5,
      cornerRadius: optionalNumber(args.connectorCornerRadius) ?? 0.008,
      semanticLayer: "internal-connector",
      tags: ["internal", "connector", "contact"],
    });
  }

  const screwCount =
    args.includeScrews === false
      ? 0
      : Math.max(0, Math.min(32, Math.floor(optionalNumber(args.screwCount) ?? 4)));
  const screwPositions = [
    { x: -width * 0.38, y: height * 0.34 },
    { x: width * 0.38, y: height * 0.34 },
    { x: -width * 0.38, y: -height * 0.34 },
    { x: width * 0.38, y: -height * 0.34 },
  ];
  for (let index = 0; index < screwCount; index += 1) {
    const base = screwPositions[index % screwPositions.length];
    const ring = Math.floor(index / screwPositions.length);
    components.push({
      key: `screw-${index + 1}`,
      name: `Micro screw ${index + 1}`,
      role: "screw",
      kind: "cylinder",
      materialModel: "metal",
      color: optionalString(args.screwColor) ?? "#cbd5e1",
      roughness: optionalNumber(args.screwRoughness) ?? 0.18,
      metalness: optionalNumber(args.screwMetalness) ?? 0.86,
      scale: {
        x: Math.max(0.008, optionalNumber(args.screwDiameter) ?? width * 0.035),
        y: Math.max(0.004, optionalNumber(args.screwDepth) ?? depth * 0.16),
        z: Math.max(0.008, optionalNumber(args.screwDiameter) ?? width * 0.035),
      },
      localX: base.x * Math.max(0.65, 1 - ring * 0.16),
      localY: base.y * Math.max(0.65, 1 - ring * 0.16),
      localZ: depth * 0.62,
      semanticLayer: "internal-fastener",
      tags: ["internal", "screw", "fastener"],
    });
  }

  return components;
}

export function updateCreationAssetProductInternalsComponent(
  asset: CreationAssetRecipe,
  object: CreationSceneObject,
  args: Record<string, unknown>,
  options: {
    readonly layoutId: string;
    readonly component: CreationProductInternalsComponentSpec;
    readonly componentIndex: number;
    readonly componentCount: number;
    readonly componentObjectIds: readonly string[];
    readonly componentAssetIds: readonly string[];
    readonly componentRenderObjectIds: readonly string[];
    readonly targetObjects: readonly CreationSceneObject[];
    readonly normal: CreationVec3;
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-product-internals`;
  const sourceNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part",
  );
  const internalsParameters = compactCreationParameters({
    source: "agent-product-internals",
    layoutId: options.layoutId,
    componentKey: options.component.key,
    componentName: options.component.name,
    componentRole: options.component.role,
    componentIndex: options.componentIndex,
    componentCount: options.componentCount,
    objectId: object.id,
    partId: object.partId,
    targetObjectIds: options.targetObjects.map((target) => target.id),
    targetPartIds: options.targetObjects.map((target) => target.partId).filter(Boolean),
    componentObjectIds: options.componentObjectIds,
    componentAssetIds: options.componentAssetIds,
    componentRenderObjectIds: options.componentRenderObjectIds,
    normal: options.normal,
    width: options.width,
    height: options.height,
    depth: options.depth,
    localX: options.component.localX,
    localY: options.component.localY,
    localZ: options.component.localZ,
    semanticLayer: options.component.semanticLayer,
    exactness: optionalString(args.exactness) ?? "plausible-editable",
    bakeTarget: optionalString(args.bakeTarget) ?? "product-internals-layout",
  });
  const internalsNode = {
    id: nodeId,
    type: "array" as const,
    name: optionalString(args.nodeName) ?? "Product internals component",
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: internalsParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      productInternals: internalsParameters,
      productInternalsId: options.layoutId,
      productInternalsComponentKey: options.component.key,
      productInternalsComponentIndex: options.componentIndex,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? internalsNode : node))
      : [...asset.nodes, internalsNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-product-internals-preview`,
      "agent-product-internals-v1",
    ),
    modifiedAt: options.now,
  };
}

export const CREATION_CHARACTER_STYLES = [
  "stylized",
  "realistic",
  "low-poly",
  "robot",
  "astronaut",
  "mascot",
] as const;

export type CreationCharacterStyle = (typeof CREATION_CHARACTER_STYLES)[number];

export const CREATION_CHARACTER_PART_ROLES = [
  "head",
  "neck",
  "torso",
  "pelvis",
  "upper-arm",
  "forearm",
  "hand",
  "thigh",
  "shin",
  "foot",
  "helmet",
  "visor",
  "backpack",
] as const;

export type CreationCharacterPartRole = (typeof CREATION_CHARACTER_PART_ROLES)[number];

export const CREATION_CHARACTER_POSES = [
  "wave",
  "idle",
  "point",
  "cheer",
  "t-pose",
  "a-pose",
] as const;

export type CreationCharacterPose = (typeof CREATION_CHARACTER_POSES)[number];

export interface CreationCharacterStylePreset {
  readonly height: number;
  readonly bodyMaterialModel: CreationMaterialModel;
  readonly bodyMaterialKind: "basic" | "physical";
  readonly skinColor: string;
  readonly suitColor: string;
  readonly accentColor: string;
  readonly visorColor: string;
  readonly visorEmissive: string;
  readonly roughness: number;
  readonly metalness: number;
  readonly headScale: number;
  readonly limbThickness: number;
  readonly includeHelmet: boolean;
  readonly includeVisor: boolean;
  readonly includeBackpack: boolean;
  readonly tags: readonly string[];
}

export const CREATION_CHARACTER_STYLE_PRESETS: Record<
  CreationCharacterStyle,
  CreationCharacterStylePreset
> = {
  stylized: {
    height: 1.8,
    bodyMaterialModel: "plastic",
    bodyMaterialKind: "physical",
    skinColor: "#e2b48c",
    suitColor: "#3b82f6",
    accentColor: "#1e3a8a",
    visorColor: "#0ea5e9",
    visorEmissive: "#38bdf8",
    roughness: 0.62,
    metalness: 0.04,
    headScale: 1,
    limbThickness: 0.075,
    includeHelmet: false,
    includeVisor: false,
    includeBackpack: false,
    tags: ["stylized"],
  },
  realistic: {
    height: 1.78,
    bodyMaterialModel: "pbr",
    bodyMaterialKind: "physical",
    skinColor: "#d8a47f",
    suitColor: "#64748b",
    accentColor: "#334155",
    visorColor: "#0ea5e9",
    visorEmissive: "#38bdf8",
    roughness: 0.7,
    metalness: 0.05,
    headScale: 1,
    limbThickness: 0.07,
    includeHelmet: false,
    includeVisor: false,
    includeBackpack: false,
    tags: ["realistic"],
  },
  "low-poly": {
    height: 1.8,
    bodyMaterialModel: "plastic",
    bodyMaterialKind: "basic",
    skinColor: "#f0b27a",
    suitColor: "#22c55e",
    accentColor: "#15803d",
    visorColor: "#0ea5e9",
    visorEmissive: "#38bdf8",
    roughness: 0.85,
    metalness: 0.02,
    headScale: 1.05,
    limbThickness: 0.085,
    includeHelmet: false,
    includeVisor: false,
    includeBackpack: false,
    tags: ["low-poly", "toy"],
  },
  robot: {
    height: 1.85,
    bodyMaterialModel: "metal",
    bodyMaterialKind: "physical",
    skinColor: "#cbd5e1",
    suitColor: "#94a3b8",
    accentColor: "#475569",
    visorColor: "#f97316",
    visorEmissive: "#fb923c",
    roughness: 0.32,
    metalness: 0.88,
    headScale: 0.95,
    limbThickness: 0.08,
    includeHelmet: false,
    includeVisor: true,
    includeBackpack: false,
    tags: ["robot", "mechanical"],
  },
  astronaut: {
    height: 1.9,
    bodyMaterialModel: "fabric",
    bodyMaterialKind: "physical",
    skinColor: "#e2b48c",
    suitColor: "#f8fafc",
    accentColor: "#cbd5e1",
    visorColor: "#0b1120",
    visorEmissive: "#fbbf24",
    roughness: 0.66,
    metalness: 0.06,
    headScale: 1,
    limbThickness: 0.095,
    includeHelmet: true,
    includeVisor: true,
    includeBackpack: true,
    tags: ["astronaut", "eva-suit"],
  },
  mascot: {
    height: 1.6,
    bodyMaterialModel: "fabric",
    bodyMaterialKind: "physical",
    skinColor: "#fcd34d",
    suitColor: "#ef4444",
    accentColor: "#b91c1c",
    visorColor: "#0ea5e9",
    visorEmissive: "#38bdf8",
    roughness: 0.78,
    metalness: 0.02,
    headScale: 1.4,
    limbThickness: 0.11,
    includeHelmet: false,
    includeVisor: false,
    includeBackpack: false,
    tags: ["mascot", "toy"],
  },
};

export function creationCharacterStyle(value: unknown): CreationCharacterStyle {
  const style = optionalString(value);
  return style && CREATION_CHARACTER_STYLES.includes(style as CreationCharacterStyle)
    ? (style as CreationCharacterStyle)
    : "stylized";
}

export function creationCharacterPose(value: unknown): CreationCharacterPose {
  const pose = optionalString(value);
  return pose && CREATION_CHARACTER_POSES.includes(pose as CreationCharacterPose)
    ? (pose as CreationCharacterPose)
    : "wave";
}

export function creationCharacterSide(value: unknown): "left" | "right" {
  return optionalString(value) === "left" ? "left" : "right";
}

export interface CreationCharacterPartSpec {
  readonly key: string;
  readonly name: string;
  readonly role: CreationCharacterPartRole;
  readonly bone: string;
  readonly parentBone?: string;
  readonly side: "left" | "right" | "center";
  readonly kind: MotionObject3DKind;
  readonly materialModel: CreationMaterialModel;
  readonly materialKind: "basic" | "physical";
  readonly color: string;
  readonly opacity?: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly scale: CreationVec3;
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  readonly cornerRadius?: number;
  readonly semanticLayer: string;
  readonly tags: readonly string[];
}

export function parseCreationCharacterParts(
  args: Record<string, unknown>,
  options: {
    readonly height: number;
    readonly style: CreationCharacterStyle;
    readonly preset: CreationCharacterStylePreset;
  },
): readonly CreationCharacterPartSpec[] {
  const h = options.height;
  const preset = options.preset;
  const flag = (value: unknown, fallback: boolean): boolean =>
    value === true ? true : value === false ? false : fallback;
  const suitColor =
    optionalString(args.suitColor ?? args.bodyColor ?? args.color) ?? preset.suitColor;
  const skinColor = optionalString(args.skinColor) ?? preset.skinColor;
  const accentColor =
    optionalString(args.accentColor ?? args.gloveColor ?? args.bootColor) ?? preset.accentColor;
  const visorColor = optionalString(args.visorColor) ?? preset.visorColor;
  const visorEmissive = optionalString(args.visorEmissive) ?? preset.visorEmissive;
  const helmetColor = optionalString(args.helmetColor) ?? suitColor;
  const roughness = optionalNumber(args.roughness) ?? preset.roughness;
  const metalness = optionalNumber(args.metalness) ?? preset.metalness;
  const requestedModel = optionalString(args.materialModel);
  const materialModel: CreationMaterialModel =
    requestedModel && CREATION_MATERIAL_MODELS.has(requestedModel)
      ? (requestedModel as CreationMaterialModel)
      : preset.bodyMaterialModel;
  const materialKind = preset.bodyMaterialKind;
  const limb = (optionalNumber(args.limbThickness) ?? preset.limbThickness) * h;
  const includeArms = flag(args.includeArms, true);
  const includeLegs = flag(args.includeLegs, true);
  const includeHelmet = flag(args.includeHelmet, preset.includeHelmet);
  const includeVisor = flag(args.includeVisor, preset.includeVisor);
  const includeBackpack = flag(args.includeBackpack, preset.includeBackpack);

  const footH = 0.05 * h;
  const shinLen = 0.23 * h;
  const thighLen = 0.24 * h;
  const pelvisH = 0.1 * h;
  const torsoH = 0.28 * h;
  const neckH = 0.05 * h;
  const headD = 0.15 * h * preset.headScale;
  const pelvisW = 0.2 * h;
  const pelvisD = 0.13 * h;
  const torsoW = 0.26 * h;
  const torsoD = 0.16 * h;
  const hipX = 0.06 * h;

  const footCenterY = footH / 2;
  const shinCenterY = footH + shinLen / 2;
  const thighCenterY = footH + shinLen + thighLen / 2;
  const pelvisCenterY = footH + shinLen + thighLen + pelvisH / 2;
  const pelvisTop = pelvisCenterY + pelvisH / 2;
  const torsoCenterY = pelvisTop + torsoH / 2;
  const torsoTop = torsoCenterY + torsoH / 2;
  const neckCenterY = torsoTop + neckH / 2;
  const headCenterY = torsoTop + neckH + headD / 2;
  const shoulderY = torsoTop - 0.03 * h;
  const shoulderX = torsoW / 2 + limb / 2;
  const upperArmLen = 0.19 * h;
  const forearmLen = 0.18 * h;
  const handSize = 0.06 * h;

  const bodyTags = [...preset.tags];
  const parts: CreationCharacterPartSpec[] = [];

  parts.push({
    key: "pelvis",
    name: "Pelvis",
    role: "pelvis",
    bone: "pelvis",
    side: "center",
    kind: "rounded-box",
    materialModel,
    materialKind,
    color: suitColor,
    roughness,
    metalness,
    scale: { x: pelvisW, y: pelvisH, z: pelvisD },
    localX: 0,
    localY: pelvisCenterY,
    localZ: 0,
    cornerRadius: 0.03,
    semanticLayer: "character-core",
    tags: ["hips", ...bodyTags],
  });
  parts.push({
    key: "torso",
    name: "Torso",
    role: "torso",
    bone: "spine",
    parentBone: "pelvis",
    side: "center",
    kind: "rounded-box",
    materialModel,
    materialKind,
    color: suitColor,
    roughness,
    metalness,
    scale: { x: torsoW, y: torsoH, z: torsoD },
    localX: 0,
    localY: torsoCenterY,
    localZ: 0,
    cornerRadius: 0.04,
    semanticLayer: "character-core",
    tags: ["chest", "spine", ...bodyTags],
  });
  parts.push({
    key: "neck",
    name: "Neck",
    role: "neck",
    bone: "neck",
    parentBone: "spine",
    side: "center",
    kind: "cylinder",
    materialModel,
    materialKind,
    color: skinColor,
    roughness,
    metalness,
    scale: { x: 0.05 * h, y: neckH, z: 0.05 * h },
    localX: 0,
    localY: neckCenterY,
    localZ: 0,
    semanticLayer: "character-core",
    tags: ["neck", ...bodyTags],
  });
  parts.push({
    key: "head",
    name: "Head",
    role: "head",
    bone: "head",
    parentBone: "neck",
    side: "center",
    kind: "sphere",
    materialModel,
    materialKind,
    color: skinColor,
    roughness,
    metalness,
    scale: { x: headD, y: headD, z: headD },
    localX: 0,
    localY: headCenterY,
    localZ: 0,
    semanticLayer: "character-head",
    tags: ["head", "face", ...bodyTags],
  });

  if (includeHelmet) {
    const helmetD = headD * 1.35;
    parts.push({
      key: "helmet",
      name: "Helmet",
      role: "helmet",
      bone: "head",
      parentBone: "neck",
      side: "center",
      kind: "sphere",
      materialModel,
      materialKind,
      color: helmetColor,
      roughness,
      metalness,
      scale: { x: helmetD, y: helmetD, z: helmetD },
      localX: 0,
      localY: headCenterY,
      localZ: 0,
      semanticLayer: "character-head",
      tags: ["helmet", "head-gear", ...bodyTags],
    });
  }
  if (includeVisor) {
    const helmetD = headD * 1.35;
    parts.push({
      key: "visor",
      name: "Visor",
      role: "visor",
      bone: "head",
      parentBone: "neck",
      side: "center",
      kind: "sphere",
      materialModel: "glass",
      materialKind: "physical",
      color: visorColor,
      opacity: 0.92,
      roughness: 0.08,
      metalness: 0.6,
      emissive: visorEmissive,
      emissiveIntensity: 0.3,
      scale: { x: helmetD * 0.78, y: helmetD * 0.55, z: helmetD * 0.5 },
      localX: 0,
      localY: headCenterY,
      localZ: helmetD * 0.32,
      semanticLayer: "character-head",
      tags: ["visor", "reflective", ...bodyTags],
    });
  }
  if (includeBackpack) {
    parts.push({
      key: "backpack",
      name: "Backpack",
      role: "backpack",
      bone: "spine",
      parentBone: "spine",
      side: "center",
      kind: "rounded-box",
      materialModel,
      materialKind,
      color: accentColor,
      roughness,
      metalness,
      scale: { x: torsoW * 0.8, y: torsoH * 0.82, z: 0.12 * h },
      localX: 0,
      localY: torsoCenterY,
      localZ: -(torsoD / 2 + 0.06 * h),
      cornerRadius: 0.03,
      semanticLayer: "character-gear",
      tags: ["backpack", "life-support", ...bodyTags],
    });
  }

  const sides: readonly ("left" | "right")[] = ["left", "right"];
  for (const side of sides) {
    const sign = side === "left" ? -1 : 1;
    if (includeLegs) {
      parts.push({
        key: `thigh-${side}`,
        name: `${side === "left" ? "Left" : "Right"} thigh`,
        role: "thigh",
        bone: `thigh.${side === "left" ? "L" : "R"}`,
        parentBone: "pelvis",
        side,
        kind: "cylinder",
        materialModel,
        materialKind,
        color: suitColor,
        roughness,
        metalness,
        scale: { x: limb * 1.15, y: thighLen, z: limb * 1.15 },
        localX: sign * hipX,
        localY: thighCenterY,
        localZ: 0,
        semanticLayer: "character-leg",
        tags: ["leg", "thigh", side, ...bodyTags],
      });
      parts.push({
        key: `shin-${side}`,
        name: `${side === "left" ? "Left" : "Right"} shin`,
        role: "shin",
        bone: `shin.${side === "left" ? "L" : "R"}`,
        parentBone: `thigh.${side === "left" ? "L" : "R"}`,
        side,
        kind: "cylinder",
        materialModel,
        materialKind,
        color: suitColor,
        roughness,
        metalness,
        scale: { x: limb, y: shinLen, z: limb },
        localX: sign * hipX,
        localY: shinCenterY,
        localZ: 0,
        semanticLayer: "character-leg",
        tags: ["leg", "shin", side, ...bodyTags],
      });
      parts.push({
        key: `foot-${side}`,
        name: `${side === "left" ? "Left" : "Right"} foot`,
        role: "foot",
        bone: `foot.${side === "left" ? "L" : "R"}`,
        parentBone: `shin.${side === "left" ? "L" : "R"}`,
        side,
        kind: "rounded-box",
        materialModel,
        materialKind,
        color: accentColor,
        roughness,
        metalness,
        scale: { x: 0.09 * h, y: footH, z: 0.16 * h },
        localX: sign * hipX,
        localY: footCenterY,
        localZ: 0.04 * h,
        cornerRadius: 0.02,
        semanticLayer: "character-leg",
        tags: ["foot", "boot", side, ...bodyTags],
      });
    }
    if (includeArms) {
      parts.push({
        key: `arm-${side}-upper`,
        name: `${side === "left" ? "Left" : "Right"} upper arm`,
        role: "upper-arm",
        bone: `upperarm.${side === "left" ? "L" : "R"}`,
        parentBone: "spine",
        side,
        kind: "cylinder",
        materialModel,
        materialKind,
        color: suitColor,
        roughness,
        metalness,
        scale: { x: limb, y: upperArmLen, z: limb },
        localX: sign * shoulderX,
        localY: shoulderY - upperArmLen / 2,
        localZ: 0,
        semanticLayer: "character-arm",
        tags: ["arm", "upper-arm", side, ...bodyTags],
      });
      parts.push({
        key: `arm-${side}-forearm`,
        name: `${side === "left" ? "Left" : "Right"} forearm`,
        role: "forearm",
        bone: `forearm.${side === "left" ? "L" : "R"}`,
        parentBone: `upperarm.${side === "left" ? "L" : "R"}`,
        side,
        kind: "cylinder",
        materialModel,
        materialKind,
        color: suitColor,
        roughness,
        metalness,
        scale: { x: limb * 0.92, y: forearmLen, z: limb * 0.92 },
        localX: sign * shoulderX,
        localY: shoulderY - upperArmLen - forearmLen / 2,
        localZ: 0,
        semanticLayer: "character-arm",
        tags: ["arm", "forearm", side, ...bodyTags],
      });
      parts.push({
        key: `hand-${side}`,
        name: `${side === "left" ? "Left" : "Right"} hand`,
        role: "hand",
        bone: `hand.${side === "left" ? "L" : "R"}`,
        parentBone: `forearm.${side === "left" ? "L" : "R"}`,
        side,
        kind: "rounded-box",
        materialModel,
        materialKind,
        color: accentColor,
        roughness,
        metalness,
        scale: { x: handSize, y: handSize, z: handSize * 0.7 },
        localX: sign * shoulderX,
        localY: shoulderY - upperArmLen - forearmLen - handSize / 2,
        localZ: 0,
        cornerRadius: 0.015,
        semanticLayer: "character-arm",
        tags: ["hand", "glove", side, ...bodyTags],
      });
    }
  }

  return parts;
}

export function updateCreationAssetCharacterPart(
  asset: CreationAssetRecipe,
  object: CreationSceneObject,
  args: Record<string, unknown>,
  options: {
    readonly characterId: string;
    readonly style: CreationCharacterStyle;
    readonly component: CreationCharacterPartSpec;
    readonly componentIndex: number;
    readonly componentCount: number;
    readonly componentObjectIds: readonly string[];
    readonly componentAssetIds: readonly string[];
    readonly componentRenderObjectIds: readonly string[];
    readonly height: number;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-character-part`;
  const sourceNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" || node.type === "cache" || node.type === "product-part",
  );
  const characterParameters = compactCreationParameters({
    source: "agent-character-part",
    characterId: options.characterId,
    style: options.style,
    role: options.component.role,
    bone: options.component.bone,
    parentBone: options.component.parentBone,
    side: options.component.side,
    partKey: options.component.key,
    partId: object.partId,
    objectId: object.id,
    componentIndex: options.componentIndex,
    componentCount: options.componentCount,
    componentObjectIds: options.componentObjectIds,
    componentAssetIds: options.componentAssetIds,
    componentRenderObjectIds: options.componentRenderObjectIds,
    semanticLayer: options.component.semanticLayer,
    height: options.height,
    anchor: object.transform.position,
    exactness: optionalString(args.exactness) ?? "plausible-editable",
  });
  const skeletonNode = {
    id: nodeId,
    type: "skeleton" as const,
    name: optionalString(args.nodeName) ?? `${options.component.bone} bone`,
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: characterParameters,
  };
  return {
    ...asset,
    kind: "character",
    parameters: compactCreationParameters({
      ...asset.parameters,
      character: characterParameters,
      characterId: options.characterId,
      characterStyle: options.style,
      characterPartRole: options.component.role,
      characterBone: options.component.bone,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? skeletonNode : node))
      : [...asset.nodes, skeletonNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-character-part-preview`,
      "agent-character-part-v1",
    ),
    modifiedAt: options.now,
  };
}

export function findCreationCharacterPart(
  parts: readonly CreationSceneObject[],
  role: CreationCharacterPartRole,
  side?: "left" | "right",
): CreationSceneObject | undefined {
  return parts.find(
    (object) =>
      object.tags.includes(role) && (side ? object.tags.includes(side) : true),
  );
}

export function buildCreationCharacterPoseTracks(
  parts: readonly CreationSceneObject[],
  clipId: string,
  options: {
    readonly pose: CreationCharacterPose;
    readonly side: "left" | "right";
    readonly startTime: number;
    readonly duration: number;
    readonly cycles: number;
    readonly amplitude: number;
    readonly easing: CreationAnimationKeyframe["easing"];
  },
): { readonly tracks: CreationAnimationTrack[]; readonly animatedObjectIds: string[] } {
  const tracks: CreationAnimationTrack[] = [];
  const animatedObjectIds: string[] = [];
  const start = Math.max(0, options.startTime);
  const end = start + Math.max(0.1, options.duration);
  const easing = options.easing;
  const cycles = Math.max(0.25, options.cycles);
  const amp = options.amplitude;
  const samples = Math.round(clampNumber(cycles * 6 + 1, 3, 48));

  const addTrack = (
    object: CreationSceneObject | undefined,
    keyframes: CreationAnimationKeyframe<CreationVec3>[],
  ): void => {
    if (!object || keyframes.length === 0) return;
    tracks.push({
      id: `${clipId}-${object.id}-rotation`,
      targetId: object.id,
      channel: "rotation",
      keyframes,
    });
    animatedObjectIds.push(object.id);
  };

  const sineFrames = (
    from: number,
    to: number,
    fn: (t: number) => CreationVec3,
    skipFirst: boolean,
  ): CreationAnimationKeyframe<CreationVec3>[] => {
    const frames: CreationAnimationKeyframe<CreationVec3>[] = [];
    for (let i = skipFirst ? 1 : 0; i < samples; i += 1) {
      const t = samples === 1 ? 0 : i / (samples - 1);
      frames.push({ time: from + (to - from) * t, value: fn(t), easing });
    }
    return frames;
  };

  const raiseAngle = (side: "left" | "right"): number => (side === "right" ? -150 : 150);

  if (options.pose === "wave") {
    const side = options.side;
    const upper = findCreationCharacterPart(parts, "upper-arm", side);
    const forearm = findCreationCharacterPart(parts, "forearm", side);
    const raise = raiseAngle(side);
    const raiseTime = start + Math.min(0.45, options.duration * 0.3);
    addTrack(upper, [
      { time: start, value: { x: 0, y: 0, z: 0 }, easing },
      { time: raiseTime, value: { x: 0, y: 0, z: raise }, easing },
      { time: end, value: { x: 0, y: 0, z: raise }, easing },
    ]);
    addTrack(forearm, [
      { time: start, value: { x: 0, y: 0, z: 0 }, easing },
      { time: raiseTime, value: { x: 0, y: 0, z: raise }, easing },
      ...sineFrames(
        raiseTime,
        end,
        (t) => ({ x: 0, y: 0, z: raise + Math.sin(t * cycles * Math.PI * 2) * amp }),
        true,
      ),
    ]);
  } else if (options.pose === "cheer") {
    for (const side of ["left", "right"] as const) {
      const upper = findCreationCharacterPart(parts, "upper-arm", side);
      const raise = side === "right" ? -160 : 160;
      const raiseTime = start + Math.min(0.4, options.duration * 0.3);
      addTrack(upper, [
        { time: start, value: { x: 0, y: 0, z: 0 }, easing },
        { time: raiseTime, value: { x: 0, y: 0, z: raise }, easing },
        ...sineFrames(
          raiseTime,
          end,
          (t) => ({ x: 0, y: 0, z: raise + Math.sin(t * cycles * Math.PI * 2) * amp }),
          true,
        ),
      ]);
    }
  } else if (options.pose === "point") {
    const side = options.side;
    const upper = findCreationCharacterPart(parts, "upper-arm", side);
    const forearm = findCreationCharacterPart(parts, "forearm", side);
    addTrack(upper, [
      { time: start, value: { x: 0, y: 0, z: 0 }, easing },
      { time: end, value: { x: -85, y: 0, z: 0 }, easing },
    ]);
    addTrack(forearm, [
      { time: start, value: { x: 0, y: 0, z: 0 }, easing },
      { time: end, value: { x: -85, y: 0, z: 0 }, easing },
    ]);
  } else if (options.pose === "t-pose" || options.pose === "a-pose") {
    const angle = options.pose === "t-pose" ? 90 : 35;
    for (const side of ["left", "right"] as const) {
      const upper = findCreationCharacterPart(parts, "upper-arm", side);
      const z = side === "right" ? -angle : angle;
      addTrack(upper, [
        { time: start, value: { x: 0, y: 0, z: 0 }, easing },
        { time: end, value: { x: 0, y: 0, z }, easing },
      ]);
    }
  } else {
    const torso = findCreationCharacterPart(parts, "torso");
    const head = findCreationCharacterPart(parts, "head");
    addTrack(
      torso,
      sineFrames(start, end, (t) => ({ x: 0, y: Math.sin(t * cycles * Math.PI * 2) * amp, z: 0 }), false),
    );
    addTrack(
      head,
      sineFrames(
        start,
        end,
        (t) => ({ x: Math.sin(t * cycles * Math.PI * 2) * amp * 1.2, y: 0, z: 0 }),
        false,
      ),
    );
    for (const side of ["left", "right"] as const) {
      const upper = findCreationCharacterPart(parts, "upper-arm", side);
      const sign = side === "right" ? -1 : 1;
      addTrack(
        upper,
        sineFrames(
          start,
          end,
          (t) => ({ x: 0, y: 0, z: sign * Math.abs(Math.sin(t * cycles * Math.PI * 2)) * amp }),
          false,
        ),
      );
    }
  }

  return { tracks, animatedObjectIds };
}

export function updateCreationAssetCharacterPose(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  options: {
    readonly pose: CreationCharacterPose;
    readonly side: "left" | "right";
    readonly clipId: string;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-character-pose`;
  const sourceNode = asset.nodes.find(
    (node) => node.type === "skeleton" || node.type === "primitive" || node.type === "cache",
  );
  const poseParameters = compactCreationParameters({
    source: "agent-character-pose",
    pose: options.pose,
    side: options.side,
    clipId: options.clipId,
  });
  const poseNode = {
    id: nodeId,
    type: "ik-control" as const,
    name: optionalString(args.nodeName) ?? `${options.pose} pose`,
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: poseParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      characterPose: poseParameters,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? poseNode : node))
      : [...asset.nodes, poseNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-character-pose-preview`,
      "agent-character-pose-v1",
    ),
    modifiedAt: options.now,
  };
}

export const CREATION_PARTICLE_KINDS = [
  "stars",
  "dust",
  "sparks",
  "embers",
  "snow",
  "confetti",
  "bokeh",
] as const;

export type CreationParticleKind = (typeof CREATION_PARTICLE_KINDS)[number];

export interface CreationParticleKindPreset {
  readonly shape: MotionObject3DKind;
  readonly materialModel: CreationMaterialModel;
  readonly materialKind: "basic" | "physical";
  readonly color: string;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly opacity: number;
  readonly size: number;
  readonly sizeJitter: number;
  readonly drift: CreationVec3;
  readonly twinkle: boolean;
  readonly tags: readonly string[];
}

export const CREATION_PARTICLE_PRESETS: Record<CreationParticleKind, CreationParticleKindPreset> = {
  stars: {
    shape: "sphere",
    materialModel: "emissive",
    materialKind: "basic",
    color: "#ffffff",
    emissive: "#ffffff",
    emissiveIntensity: 1.6,
    opacity: 1,
    size: 0.02,
    sizeJitter: 0.6,
    drift: { x: 0, y: 0, z: 0 },
    twinkle: true,
    tags: ["star", "space"],
  },
  dust: {
    shape: "sphere",
    materialModel: "pbr",
    materialKind: "physical",
    color: "#cbd5e1",
    opacity: 0.5,
    size: 0.015,
    sizeJitter: 0.7,
    drift: { x: 0, y: 0.15, z: 0 },
    twinkle: false,
    tags: ["dust", "motes"],
  },
  sparks: {
    shape: "plane",
    materialModel: "emissive",
    materialKind: "basic",
    color: "#fbbf24",
    emissive: "#f59e0b",
    emissiveIntensity: 2,
    opacity: 1,
    size: 0.03,
    sizeJitter: 0.5,
    drift: { x: 0, y: 0.6, z: 0 },
    twinkle: true,
    tags: ["spark", "fire"],
  },
  embers: {
    shape: "sphere",
    materialModel: "emissive",
    materialKind: "basic",
    color: "#f97316",
    emissive: "#ea580c",
    emissiveIntensity: 1.8,
    opacity: 0.9,
    size: 0.025,
    sizeJitter: 0.6,
    drift: { x: 0, y: 0.5, z: 0 },
    twinkle: true,
    tags: ["ember", "fire"],
  },
  snow: {
    shape: "sphere",
    materialModel: "pbr",
    materialKind: "physical",
    color: "#f8fafc",
    opacity: 0.9,
    size: 0.02,
    sizeJitter: 0.5,
    drift: { x: 0, y: -0.4, z: 0 },
    twinkle: false,
    tags: ["snow", "winter"],
  },
  confetti: {
    shape: "plane",
    materialModel: "pbr",
    materialKind: "physical",
    color: "#f43f5e",
    opacity: 1,
    size: 0.04,
    sizeJitter: 0.4,
    drift: { x: 0, y: -0.5, z: 0 },
    twinkle: false,
    tags: ["confetti", "celebration"],
  },
  bokeh: {
    shape: "plane",
    materialModel: "emissive",
    materialKind: "basic",
    color: "#a5b4fc",
    emissive: "#818cf8",
    emissiveIntensity: 1.2,
    opacity: 0.6,
    size: 0.08,
    sizeJitter: 0.7,
    drift: { x: 0, y: 0.1, z: 0 },
    twinkle: true,
    tags: ["bokeh", "glow"],
  },
};

export function creationParticleKind(value: unknown): CreationParticleKind {
  const kind = optionalString(value);
  return kind && CREATION_PARTICLE_KINDS.includes(kind as CreationParticleKind)
    ? (kind as CreationParticleKind)
    : "stars";
}

export interface CreationDropMotion {
  readonly object: CreationSceneObject;
  readonly startY: number;
  readonly restY: number;
  readonly startTime: number;
  readonly endTime: number;
}

export function creationDropHeightAt(
  t: number,
  startY: number,
  restY: number,
  gravity: number,
  restitution: number,
  bounces: number,
): number {
  const drop = Math.max(0, startY - restY);
  if (drop <= 0 || t <= 0) return startY;
  const tFall = Math.sqrt((2 * drop) / gravity);
  if (t <= tFall) {
    return Math.max(restY, startY - 0.5 * gravity * t * t);
  }
  let elapsed = tFall;
  let velocity = gravity * tFall;
  for (let bounce = 0; bounce < bounces; bounce += 1) {
    velocity *= restitution;
    if (velocity < 0.05) break;
    const air = (2 * velocity) / gravity;
    if (t <= elapsed + air) {
      const local = t - elapsed;
      return restY + velocity * local - 0.5 * gravity * local * local;
    }
    elapsed += air;
  }
  return restY;
}

export function creationDropTotalTime(
  startY: number,
  restY: number,
  gravity: number,
  restitution: number,
  bounces: number,
): number {
  const drop = Math.max(0, startY - restY);
  if (drop <= 0) return 0;
  let total = Math.sqrt((2 * drop) / gravity);
  let velocity = gravity * total;
  for (let bounce = 0; bounce < bounces; bounce += 1) {
    velocity *= restitution;
    if (velocity < 0.05) break;
    total += (2 * velocity) / gravity;
  }
  return total;
}

export function buildCreationDropTracks(
  args: Record<string, unknown>,
  objects: readonly CreationSceneObject[],
  clipId: string,
): {
  readonly tracks: CreationAnimationTrack[];
  readonly motions: CreationDropMotion[];
  readonly duration: number;
  readonly dropHeight: number;
  readonly gravity: number;
  readonly bounces: number;
  readonly restitution: number;
  readonly groundY?: number;
} {
  const dropHeight = Math.max(0.01, optionalNumber(args.dropHeight) ?? optionalNumber(args.height) ?? 2);
  const gravity = Math.max(0.1, optionalNumber(args.gravity) ?? 9.8);
  const bounces = Math.round(clampNumber(optionalNumber(args.bounces) ?? 2, 0, 8));
  const restitution = clampNumber(
    optionalNumber(args.restitution) ?? optionalNumber(args.bounce) ?? 0.35,
    0,
    0.95,
  );
  const stagger = Math.max(0, optionalNumber(args.stagger) ?? 0.06);
  const startTime = Math.max(0, optionalNumber(args.startTime) ?? 0.2);
  const settleHold = Math.max(0, optionalNumber(args.holdTime) ?? 0.2);
  const easing = creationAnimationEasing(args.easing ?? "linear");
  const groundY = optionalNumber(args.groundY);

  const tracks: CreationAnimationTrack[] = [];
  const motions: CreationDropMotion[] = [];
  let duration = 0;

  objects.forEach((object, index) => {
    const restY = groundY ?? object.transform.position.y;
    const startY = restY + dropHeight;
    const motionTime = creationDropTotalTime(startY, restY, gravity, restitution, bounces);
    const start = startTime + stagger * index;
    const end = start + motionTime;
    const samples = Math.round(clampNumber(motionTime * 14 + 2, 6, 120));
    const keyframes: CreationAnimationKeyframe<CreationVec3>[] = [];
    for (let sample = 0; sample < samples; sample += 1) {
      const t = samples === 1 ? 0 : (sample / (samples - 1)) * motionTime;
      keyframes.push({
        time: start + t,
        value: {
          x: object.transform.position.x,
          y: creationDropHeightAt(t, startY, restY, gravity, restitution, bounces),
          z: object.transform.position.z,
        },
        easing,
      });
    }
    keyframes.push({
      time: end + settleHold,
      value: {
        x: object.transform.position.x,
        y: restY,
        z: object.transform.position.z,
      },
      easing,
    });
    tracks.push({
      id: `${clipId}-${object.id}-drop-position`,
      targetId: object.id,
      channel: "position",
      keyframes,
    });
    motions.push({ object, startY, restY, startTime: start, endTime: end + settleHold });
    duration = Math.max(duration, end + settleHold);
  });

  return { tracks, motions, duration, dropHeight, gravity, bounces, restitution, groundY };
}

export function rigidBodyRadiusForObject(
  object: CreationSceneObject,
  args: Record<string, unknown>,
  assetSize?: number,
): number {
  const explicit = optionalNumber(args.radius) ?? optionalNumber(args.bodyRadius);
  if (explicit !== undefined) return Math.max(0.05, explicit);
  const scale = object.transform.scale;
  const maxScale = Math.max(
    Math.abs(scale.x),
    Math.abs(scale.y),
    Math.abs(scale.z),
    0.1,
  );
  const baseRadius = (assetSize && assetSize > 0 ? assetSize : 1) / 2;
  return Math.max(0.05, baseRadius * maxScale);
}

export function buildCreationRigidSolverTracks(
  args: Record<string, unknown>,
  objects: readonly CreationSceneObject[],
  clipId: string,
  assetsById: ReadonlyMap<string, CreationAssetRecipe>,
): CreationRigidBuildResult {
  const dropHeight = Math.max(0, optionalNumber(args.dropHeight) ?? optionalNumber(args.height) ?? 2);
  const gravity = Math.max(0.1, optionalNumber(args.gravity) ?? 9.8);
  const groundY = optionalNumber(args.groundY) ?? 0;
  const restitution = clampNumber(
    optionalNumber(args.restitution) ?? optionalNumber(args.bounce) ?? 0.4,
    0,
    0.95,
  );
  const friction = clampNumber(optionalNumber(args.friction) ?? 0.2, 0, 1);
  const collide = args.collide !== false && args.collideEachOther !== false;
  const startTime = Math.max(0, optionalNumber(args.startTime) ?? 0.2);
  const fps = Math.round(clampNumber(optionalNumber(args.fps) ?? 30, 8, 60));
  const simDuration = clampNumber(
    optionalNumber(args.simDuration) ?? optionalNumber(args.duration) ?? 2.5,
    0.3,
    8,
  );
  const dt = 1 / 120;
  const steps = Math.max(1, Math.round(simDuration / dt));
  const easing = creationAnimationEasing(args.easing ?? "linear");

  const bodies: RigidBody[] = objects.map((object) => {
    const assetSize = creationParameterNumber(
      creationGeometryParameters(assetsById.get(object.assetId)),
      "size",
    );
    return makeRigidBody({
      position: {
        x: object.transform.position.x,
        y: object.transform.position.y + dropHeight,
        z: object.transform.position.z,
      },
      radius: rigidBodyRadiusForObject(object, args, assetSize),
      restitution,
    });
  });
  const baked = bakeRigidBodyTracks(bodies, {
    steps,
    dt,
    gravity,
    groundY,
    friction,
    collideEachOther: collide,
    sleepThreshold: 0.04,
    fps,
  });

  const tracks: CreationAnimationTrack[] = [];
  const motions: CreationDropMotion[] = [];
  let duration = startTime;
  objects.forEach((object, index) => {
    const positions = baked.positionsByBody[index] ?? [];
    const keyframes: CreationAnimationKeyframe<CreationVec3>[] = positions.map(
      (position, sample) => ({
        time: startTime + (baked.times[sample] ?? 0),
        value: { x: position.x, y: position.y, z: position.z },
        easing,
      }),
    );
    if (keyframes.length === 0) {
      keyframes.push({ time: startTime, value: { ...object.transform.position }, easing });
    }
    tracks.push({
      id: `${clipId}-${object.id}-rigid-position`,
      targetId: object.id,
      channel: "position",
      keyframes,
    });
    const last = positions[positions.length - 1] ?? object.transform.position;
    const endTime = startTime + (baked.times[baked.times.length - 1] ?? 0);
    motions.push({
      object,
      startY: object.transform.position.y + dropHeight,
      restY: last.y,
      startTime,
      endTime,
    });
    duration = Math.max(duration, endTime);
  });
  return { tracks, motions, duration, dropHeight, gravity, bounces: 0, restitution, groundY };
}

export function updateCreationAssetRigidDrop(
  asset: CreationAssetRecipe,
  objects: readonly CreationSceneObject[],
  motionsByObjectId: ReadonlyMap<string, CreationDropMotion>,
  options: {
    readonly args: Record<string, unknown>;
    readonly clipId: string;
    readonly gravity: number;
    readonly bounces: number;
    readonly restitution: number;
    readonly dropHeight: number;
    readonly groundY?: number;
    readonly solver?: string;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-rigid-drop`;
  const sourceNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" || node.type === "cache" || node.type === "product-part",
  );
  const dropParameters = compactCreationParameters({
    source: "agent-rigid-drop",
    solver: options.solver ?? "procedural-ballistic-bake",
    clipId: options.clipId,
    gravity: options.gravity,
    bounces: options.bounces,
    restitution: options.restitution,
    dropHeight: options.dropHeight,
    groundY: options.groundY,
    objectIds: objects.map((object) => object.id),
    restYByObjectId: Object.fromEntries(
      objects.map((object) => [object.id, motionsByObjectId.get(object.id)?.restY ?? 0]),
    ),
  });
  const dropNode = {
    id: nodeId,
    type: "bake" as const,
    name: optionalString(options.args.nodeName) ?? "Rigid-body drop bake",
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: dropParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      rigidDrop: dropParameters,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? dropNode : node))
      : [...asset.nodes, dropNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-rigid-drop-preview`,
      "agent-rigid-drop-v1",
    ),
    modifiedAt: options.now,
  };
}

export interface CreationRigidBuildResult {
  readonly tracks: CreationAnimationTrack[];
  readonly motions: CreationDropMotion[];
  readonly duration: number;
  readonly dropHeight: number;
  readonly gravity: number;
  readonly bounces: number;
  readonly restitution: number;
  readonly groundY?: number;
}

export async function commitCreationRigidBake(
  host: EditingHost,
  options: {
    readonly scene: CreationScene;
    readonly assetsById: ReadonlyMap<string, CreationAssetRecipe>;
    readonly objects: readonly CreationSceneObject[];
    readonly built: CreationRigidBuildResult;
    readonly clipId: string;
    readonly clipName: string;
    readonly now: number;
    readonly durationOverride?: number;
    readonly assetLabel: string;
    readonly assetUpdater: (
      asset: CreationAssetRecipe,
      assetObjects: readonly CreationSceneObject[],
      motionsByObjectId: ReadonlyMap<string, CreationDropMotion>,
    ) => CreationAssetRecipe;
    readonly animationLabel: string;
    readonly successVerb: string;
    readonly extraData: Record<string, unknown>;
  },
) {
  const { scene, assetsById, objects, built, clipId, now } = options;
  const objectsByAssetId = new Map<string, CreationSceneObject[]>();
  for (const object of objects) {
    const asset = assetsById.get(object.assetId);
    if (!asset) return fail(`Creation asset not found: ${object.assetId}`, "NOT_FOUND");
    const group = objectsByAssetId.get(object.assetId) ?? [];
    group.push(object);
    objectsByAssetId.set(object.assetId, group);
  }

  const existingClip = scene.animations.find((clip) => clip.id === clipId);
  const duration = Math.max(
    built.duration,
    options.durationOverride ?? existingClip?.duration ?? scene.duration ?? 0,
  );
  const targetIds = new Set(objects.map((object) => object.id));
  const clip = mergeCreationObjectAnimationClipForTargets(
    existingClip,
    targetIds,
    built.tracks,
    new Set(["position"]),
    { clipId, name: options.clipName, duration },
  );

  const motionsByObjectId = new Map(built.motions.map((motion) => [motion.object.id, motion]));
  const assetOperations = [...objectsByAssetId].map(([assetId, assetObjects]) => {
    const asset = assetsById.get(assetId);
    if (!asset) throw new Error(`Creation asset not found: ${assetId}`);
    return {
      id: genId(),
      type: "asset/upsert" as const,
      timestamp: now,
      source: "agent" as const,
      label: `${options.assetLabel} ${asset.name}`,
      asset: options.assetUpdater(asset, assetObjects, motionsByObjectId),
    };
  });
  const animationOperation = {
    id: genId(),
    type: "animation/upsert-clip" as const,
    timestamp: now,
    source: "agent" as const,
    label: options.animationLabel,
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
  for (const object of objects) {
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
    const applied = await applyMotionAction(host, "creation/applyOperation", { operation });
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
      ? `${options.successVerb} for ${objects.length} creation objects and synced ${syncedRenderObjectIds.length} render objects`
      : `${options.successVerb} for ${objects.length} creation objects`,
    {
      sceneId: scene.id,
      clipId,
      objectIds: objects.map((object) => object.id),
      partIds: objects.map((object) => object.partId).filter(Boolean),
      assetIds: [...objectsByAssetId.keys()],
      trackIds: built.tracks.map((track) => track.id),
      channels: ["position"],
      ...options.extraData,
      duration,
      operationIds,
      syncedRenderObjectIds,
      syncedCompositionIds: [...nextCompositions.keys()],
      renderKeyframeCount,
    },
  );
}

export const MESH_FRAME_FLOAT_BUDGET = 180000;

export const CLOTH_PIN_VALUES: ReadonlySet<string> = new Set([
  "top",
  "bottom",
  "left",
  "left-edge",
  "right",
  "top-corners",
  "none",
]);

export function clothPinFromArgs(value: unknown): ClothPin {
  const raw = optionalString(value)?.toLowerCase();
  if (raw && CLOTH_PIN_VALUES.has(raw)) return raw as ClothPin;
  return "top";
}

export function buildClothMeshFrames(
  args: Record<string, unknown>,
  worldWidth: number,
  worldHeight: number,
): MotionObjectMeshFrames {
  const columns = Math.round(clampNumber(optionalNumber(args.columns) ?? 14, 2, 36));
  const rows = Math.round(clampNumber(optionalNumber(args.rows) ?? 14, 2, 36));
  const plane = optionalString(args.plane) === "xz" ? "xz" : "xy";
  const pin = clothPinFromArgs(args.pin);
  const grid = createClothGrid({
    width: Math.max(0.1, worldWidth),
    height: Math.max(0.1, worldHeight),
    columns,
    rows,
    pin,
    plane,
    bendSprings: true,
  });
  const gravity = optionalNumber(args.gravity) ?? 9.8;
  const damping = clampNumber(optionalNumber(args.damping) ?? 0.04, 0, 1);
  const wind = vec3FromArgs(args.wind, { x: 0, y: 0, z: 0 }, ["windX", "windY", "windZ"], args);
  const fps = Math.round(clampNumber(optionalNumber(args.fps) ?? 24, 8, 30));
  const simDuration = clampNumber(
    optionalNumber(args.simDuration) ?? optionalNumber(args.duration) ?? 2.5,
    0.3,
    6,
  );
  const dt = 1 / 60;
  const totalSteps = Math.max(1, Math.round(simDuration / dt));
  const requestedSampleEvery = Math.max(1, Math.round(1 / fps / dt));
  const vertexCount = columns * rows;
  const maxFrames = Math.max(2, Math.floor(MESH_FRAME_FLOAT_BUDGET / (vertexCount * 3)));
  const sampleEvery = Math.max(requestedSampleEvery, Math.ceil(totalSteps / maxFrames));
  const effectiveFps = 1 / (sampleEvery * dt);
  let state = grid;
  const frames: number[][] = [];
  let indices: number[] = [];
  let uvs: number[] | undefined;
  for (let step = 0; step <= totalSteps; step += 1) {
    if (step > 0) state = stepCloth(state, { dt, gravity, damping, wind });
    if (step % sampleEvery === 0 || step === totalSteps) {
      const mesh = clothToMesh(state);
      frames.push(Array.from(mesh.positions));
      if (frames.length === 1) {
        indices = Array.from(mesh.indices);
        uvs = mesh.uvs.length > 0 ? Array.from(mesh.uvs) : undefined;
      }
    }
  }
  return { fps: effectiveFps, indices, uvs, frames, loop: false };
}

export function updateCreationAssetClothBake(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  now: number,
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const clothNodeId = `node-${assetKey}-cloth-bake`;
  const geometryNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part" ||
      node.type === "curve",
  );
  const clothParameters = compactCreationParameters({
    source: "agent-cloth-bake",
    solver: "mass-spring-verlet",
    pin: clothPinFromArgs(args.pin),
    plane: optionalString(args.plane) === "xz" ? "xz" : "xy",
    columns: Math.round(clampNumber(optionalNumber(args.columns) ?? 14, 2, 36)),
    rows: Math.round(clampNumber(optionalNumber(args.rows) ?? 14, 2, 36)),
    gravity: optionalNumber(args.gravity) ?? 9.8,
    damping: clampNumber(optionalNumber(args.damping) ?? 0.04, 0, 1),
    wind: vec3FromArgs(args.wind, { x: 0, y: 0, z: 0 }, ["windX", "windY", "windZ"], args),
    fps: Math.round(clampNumber(optionalNumber(args.fps) ?? 24, 8, 30)),
  });
  const clothNode = {
    id: clothNodeId,
    type: "cloth" as const,
    name: optionalString(args.nodeName) ?? "Cloth simulation",
    inputs: geometryNode ? [geometryNode.id] : [],
    parameters: clothParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({ ...asset.parameters, cloth: clothParameters }),
    nodes: asset.nodes.some((node) => node.id === clothNodeId)
      ? asset.nodes.map((node) => (node.id === clothNodeId ? clothNode : node))
      : [...asset.nodes, clothNode],
    caches: dirtyCreationAssetCaches(asset, `cache-${assetKey}-cloth-preview`, "agent-cloth-bake-v1"),
    modifiedAt: now,
  };
}

export function buildSkinnedLimbMeshFrames(
  args: Record<string, unknown>,
  worldLength: number,
): MotionObjectMeshFrames {
  const segments = Math.round(clampNumber(optionalNumber(args.segments) ?? 8, 2, 24));
  const radialSegments = Math.round(clampNumber(optionalNumber(args.radialSegments) ?? 10, 3, 24));
  const radius = Math.max(0.02, optionalNumber(args.radius) ?? worldLength * 0.07);
  const limb = buildSkinnedLimb({ length: worldLength, radius, segments, radialSegments });

  const amplitude = optionalNumber(args.amplitudeDegrees) ?? optionalNumber(args.amplitude) ?? 14;
  const frequency = optionalNumber(args.frequency) ?? 2.2;
  const axis = optionalString(args.axis) === "x" ? "x" : "z";
  const fps = Math.round(clampNumber(optionalNumber(args.fps) ?? 24, 8, 30));
  const simDuration = clampNumber(
    optionalNumber(args.simDuration) ?? optionalNumber(args.duration) ?? 2.5,
    0.3,
    6,
  );
  const baseSpeed = optionalNumber(args.speed) ?? 3;
  const cycles = Math.max(1, Math.round((baseSpeed * simDuration) / (2 * Math.PI)));
  const speed = (cycles * 2 * Math.PI) / simDuration;

  const vertexCount = limb.mesh.positions.length / 3;
  const maxFrames = Math.max(2, Math.floor(MESH_FRAME_FLOAT_BUDGET / (vertexCount * 3)));
  const frameCount = Math.min(maxFrames, Math.max(2, Math.round(simDuration * fps)));
  const indices = Array.from(limb.mesh.indices);
  const uvs = limb.mesh.uvs.length > 0 ? Array.from(limb.mesh.uvs) : undefined;
  const frames: number[][] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = (frame / frameCount) * simDuration;
    const pose = limbWavePose(limb.segments, time, {
      amplitudeDegrees: amplitude,
      frequency,
      speed,
      axis,
    });
    const skinned = skinMesh(limb.mesh, limb.binding, limb.skeleton, pose);
    frames.push(Array.from(skinned.positions));
  }
  return { fps: frameCount / simDuration, indices, uvs, frames, loop: true };
}

export function updateCreationAssetSkinnedLimb(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  now: number,
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const skeletonNodeId = `node-${assetKey}-skinned-limb`;
  const geometryNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part" ||
      node.type === "curve",
  );
  const limbParameters = compactCreationParameters({
    source: "agent-skinned-limb",
    solver: "linear-blend-skinning",
    segments: Math.round(clampNumber(optionalNumber(args.segments) ?? 8, 2, 24)),
    amplitudeDegrees: optionalNumber(args.amplitudeDegrees) ?? optionalNumber(args.amplitude) ?? 14,
    frequency: optionalNumber(args.frequency) ?? 2.2,
    speed: optionalNumber(args.speed) ?? 3,
    axis: optionalString(args.axis) === "x" ? "x" : "z",
    fps: Math.round(clampNumber(optionalNumber(args.fps) ?? 24, 8, 30)),
  });
  const skeletonNode = {
    id: skeletonNodeId,
    type: "skeleton" as const,
    name: optionalString(args.nodeName) ?? "Skinned limb rig",
    inputs: geometryNode ? [geometryNode.id] : [],
    parameters: limbParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({ ...asset.parameters, skinnedLimb: limbParameters }),
    nodes: asset.nodes.some((node) => node.id === skeletonNodeId)
      ? asset.nodes.map((node) => (node.id === skeletonNodeId ? skeletonNode : node))
      : [...asset.nodes, skeletonNode],
    caches: dirtyCreationAssetCaches(asset, `cache-${assetKey}-limb-preview`, "agent-skinned-limb-v1"),
    modifiedAt: now,
  };
}

export function buildHumanoidMeshFrames(
  args: Record<string, unknown>,
  worldHeight: number,
): MotionObjectMeshFrames {
  const radialSegments = Math.round(clampNumber(optionalNumber(args.radialSegments) ?? 7, 3, 12));
  const human = buildSkinnedHumanoid({ height: worldHeight, radialSegments });

  const fps = Math.round(clampNumber(optionalNumber(args.fps) ?? 24, 8, 30));
  const simDuration = clampNumber(
    optionalNumber(args.simDuration) ?? optionalNumber(args.duration) ?? 2.5,
    0.3,
    6,
  );
  const baseSpeed = optionalNumber(args.speed) ?? 6;
  const cycles = Math.max(1, Math.round((baseSpeed * simDuration) / (2 * Math.PI)));
  const speed = (cycles * 2 * Math.PI) / simDuration;
  const idleSway = optionalNumber(args.idleSway) ?? 3;
  const animation = creationHumanoidAnimation(args.animation);

  const vertexCount = human.mesh.positions.length / 3;
  const maxFrames = Math.max(2, Math.floor(MESH_FRAME_FLOAT_BUDGET / (vertexCount * 3)));
  const frameCount = Math.min(maxFrames, Math.max(2, Math.round(simDuration * fps)));
  const indices = Array.from(human.mesh.indices);
  const uvs = human.mesh.uvs.length > 0 ? Array.from(human.mesh.uvs) : undefined;
  const frames: number[][] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = (frame / frameCount) * simDuration;
    const pose = humanoidAnimationPose(animation, time, { speed, idleSway });
    const skinned = skinMesh(human.mesh, human.binding, human.skeleton, pose);
    frames.push(Array.from(skinned.positions));
  }
  return { fps: frameCount / simDuration, indices, uvs, frames, loop: true };
}

export const HUMANOID_ANIMATIONS: ReadonlySet<HumanoidAnimation> = new Set([
  "wave",
  "walk",
  "idle",
  "point",
]);

export function creationHumanoidAnimation(value: unknown): HumanoidAnimation {
  const raw = optionalString(value)?.toLowerCase();
  if (raw && HUMANOID_ANIMATIONS.has(raw as HumanoidAnimation)) {
    return raw as HumanoidAnimation;
  }
  return "wave";
}

export function updateCreationAssetHumanoid(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  now: number,
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const skeletonNodeId = `node-${assetKey}-humanoid`;
  const geometryNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part" ||
      node.type === "curve",
  );
  const humanoidParameters = compactCreationParameters({
    source: "agent-skinned-humanoid",
    solver: "linear-blend-skinning",
    animation: creationHumanoidAnimation(args.animation),
    speed: optionalNumber(args.speed) ?? 6,
    idleSway: optionalNumber(args.idleSway) ?? 3,
    fps: Math.round(clampNumber(optionalNumber(args.fps) ?? 24, 8, 30)),
  });
  const skeletonNode = {
    id: skeletonNodeId,
    type: "skeleton" as const,
    name: optionalString(args.nodeName) ?? "Humanoid rig",
    inputs: geometryNode ? [geometryNode.id] : [],
    parameters: humanoidParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({ ...asset.parameters, humanoid: humanoidParameters }),
    nodes: asset.nodes.some((node) => node.id === skeletonNodeId)
      ? asset.nodes.map((node) => (node.id === skeletonNodeId ? skeletonNode : node))
      : [...asset.nodes, skeletonNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-humanoid-preview`,
      "agent-skinned-humanoid-v1",
    ),
    modifiedAt: now,
  };
}

export const PARTICLE_OCTA_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export const PARTICLE_OCTA_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 2, 4],
  [2, 1, 4],
  [1, 3, 4],
  [3, 0, 4],
  [2, 0, 5],
  [1, 2, 5],
  [3, 1, 5],
  [0, 3, 5],
];

export function buildParticleMeshFrames(
  args: Record<string, unknown>,
  worldSize: number,
): MotionObjectMeshFrames {
  const count = Math.round(clampNumber(optionalNumber(args.count) ?? 90, 1, 600));
  const seed = optionalString(args.seed) ?? "openreel-particles";
  const speed = Math.max(0, optionalNumber(args.speed) ?? worldSize * 1.1);
  const spread = clampNumber(optionalNumber(args.spread) ?? 0.7, 0, Math.PI);
  const gravity = optionalNumber(args.gravity) ?? 2.5;
  const drag = clampNumber(optionalNumber(args.drag) ?? 0.04, 0, 1);
  const lifetime = clampNumber(optionalNumber(args.lifetime) ?? 2.4, 0.2, 8);
  const wind = vec3FromArgs(args.wind, { x: 0, y: 0, z: 0 }, ["windX", "windY", "windZ"], args);
  const particleSize = Math.max(0.005, optionalNumber(args.particleSize) ?? worldSize * 0.035);
  const half = particleSize / 2;
  const fps = Math.round(clampNumber(optionalNumber(args.fps) ?? 24, 8, 30));
  const simDuration = clampNumber(
    optionalNumber(args.simDuration) ?? optionalNumber(args.duration) ?? 2.5,
    0.3,
    8,
  );

  const particles = spawnParticles({
    count,
    seed,
    origin: { x: 0, y: 0, z: 0 },
    speed,
    speedJitter: 0.4,
    spread,
    lifetime,
    gravity,
    drag,
    wind,
  });
  const n = particles.length;

  const indices: number[] = [];
  const uvs: number[] = [];
  for (let p = 0; p < n; p += 1) {
    const base = p * 6;
    for (const face of PARTICLE_OCTA_FACES) {
      indices.push(base + face[0], base + face[1], base + face[2]);
    }
    for (let k = 0; k < 6; k += 1) uvs.push(0.5, 0.5);
  }

  const dt = 1 / 60;
  const totalSteps = Math.max(1, Math.round(simDuration / dt));
  const vertsPerFrame = n * 6;
  const maxFrames = Math.max(2, Math.floor(MESH_FRAME_FLOAT_BUDGET / (vertsPerFrame * 3)));
  const requestedSampleEvery = Math.max(1, Math.round(1 / fps / dt));
  const sampleEvery = Math.max(requestedSampleEvery, Math.ceil(totalSteps / maxFrames));
  const effectiveFps = 1 / (sampleEvery * dt);

  let state = particles;
  const frames: number[][] = [];
  for (let step = 0; step <= totalSteps; step += 1) {
    if (step > 0) state = stepParticles(state, { dt, gravity, drag, wind });
    if (step % sampleEvery === 0 || step === totalSteps) {
      const positions: number[] = [];
      for (let p = 0; p < n; p += 1) {
        const particle = state[p]!;
        const cx = particle.position.x;
        const cy = particle.position.y;
        const cz = particle.position.z;
        if (!particle.alive) {
          for (let k = 0; k < 6; k += 1) positions.push(cx, cy, cz);
        } else {
          for (const offset of PARTICLE_OCTA_OFFSETS) {
            positions.push(cx + offset[0] * half, cy + offset[1] * half, cz + offset[2] * half);
          }
        }
      }
      frames.push(positions);
    }
  }
  return { fps: effectiveFps, indices, uvs, frames, loop: false };
}

export function updateCreationAssetParticleBake(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  now: number,
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-particle-bake`;
  const geometryNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part" ||
      node.type === "curve",
  );
  const particleParameters = compactCreationParameters({
    source: "agent-particle-bake",
    solver: "euler-particles",
    count: Math.round(clampNumber(optionalNumber(args.count) ?? 90, 1, 600)),
    speed: optionalNumber(args.speed),
    spread: optionalNumber(args.spread) ?? 0.7,
    gravity: optionalNumber(args.gravity) ?? 2.5,
    drag: clampNumber(optionalNumber(args.drag) ?? 0.04, 0, 1),
    lifetime: clampNumber(optionalNumber(args.lifetime) ?? 2.4, 0.2, 8),
    seed: optionalString(args.seed) ?? "openreel-particles",
    fps: Math.round(clampNumber(optionalNumber(args.fps) ?? 24, 8, 30)),
  });
  const particleNode = {
    id: nodeId,
    type: "bake" as const,
    name: optionalString(args.nodeName) ?? "Particle system bake",
    inputs: geometryNode ? [geometryNode.id] : [],
    parameters: particleParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({ ...asset.parameters, particles: particleParameters }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? particleNode : node))
      : [...asset.nodes, particleNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-particle-preview`,
      "agent-particle-bake-v1",
    ),
    modifiedAt: now,
  };
}

export function creationParticlePoint(
  random: () => number,
  center: CreationVec3,
  options: {
    readonly shape: "box" | "sphere";
    readonly width: number;
    readonly height: number;
    readonly depth: number;
    readonly radius: number;
  },
): CreationVec3 {
  if (options.shape === "sphere") {
    const dir = normalizeVec3(
      { x: random() * 2 - 1, y: random() * 2 - 1, z: random() * 2 - 1 },
      { x: 0, y: 1, z: 0 },
    );
    const r = options.radius * Math.cbrt(random());
    return { x: center.x + dir.x * r, y: center.y + dir.y * r, z: center.z + dir.z * r };
  }
  return {
    x: center.x + (random() - 0.5) * options.width,
    y: center.y + (random() - 0.5) * options.height,
    z: center.z + (random() - 0.5) * options.depth,
  };
}

export function updateCreationAssetParticleSystem(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  options: {
    readonly particleSystemId: string;
    readonly kind: CreationParticleKind;
    readonly count: number;
    readonly seed: string;
    readonly shape: "box" | "sphere";
    readonly clipId?: string;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-particle-system`;
  const sourceNode = asset.nodes.find(
    (node) => node.type === "primitive" || node.type === "cache",
  );
  const particleParameters = compactCreationParameters({
    source: "agent-particle-system",
    particleSystemId: options.particleSystemId,
    kind: options.kind,
    count: options.count,
    seed: options.seed,
    region: options.shape,
    clipId: options.clipId,
    solver: "procedural-instanced-preview",
  });
  const particleNode = {
    id: nodeId,
    type: "scatter" as const,
    name: optionalString(args.nodeName) ?? `${options.kind} particle system`,
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: particleParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      particleSystem: particleParameters,
      particleSystemId: options.particleSystemId,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? particleNode : node))
      : [...asset.nodes, particleNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-particle-system-preview`,
      "agent-particle-system-v1",
    ),
    modifiedAt: options.now,
  };
}

export function requiredTransform3D(object: MotionSceneObject3D): Transform3D {
  return {
    position: {
      x: object.transform3d?.position?.x ?? 0,
      y: object.transform3d?.position?.y ?? 0,
      z: object.transform3d?.position?.z ?? 0,
    },
    rotation: {
      x: object.transform3d?.rotation?.x ?? 0,
      y: object.transform3d?.rotation?.y ?? 0,
      z: object.transform3d?.rotation?.z ?? 0,
    },
    scale: {
      x: object.transform3d?.scale?.x ?? 1,
      y: object.transform3d?.scale?.y ?? 1,
      z: object.transform3d?.scale?.z ?? 1,
    },
  };
}

export function parseCreationLights(value: unknown): CreationLight[] {
  const entries = Array.isArray(value) ? value : [];
  const lights: CreationLight[] = [];
  entries.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) return;
    const kind = optionalString(record.kind) ?? "point";
    if (!CREATION_LIGHT_KINDS.has(kind)) return;
    lights.push({
      id: optionalString(record.id) ?? `light-${index + 1}`,
      name: optionalString(record.name) ?? `${kind} light`,
      kind: kind as CreationLight["kind"],
      color: optionalString(record.color) ?? "#ffffff",
      intensity: optionalNumber(record.intensity) ?? 1,
      position:
        optionalNumber(record.x) !== undefined ||
        optionalNumber(record.y) !== undefined ||
        optionalNumber(record.z) !== undefined
          ? {
              x: optionalNumber(record.x) ?? 0,
              y: optionalNumber(record.y) ?? 3,
              z: optionalNumber(record.z) ?? 4,
            }
          : undefined,
      target:
        optionalNumber(record.targetX) !== undefined ||
        optionalNumber(record.targetY) !== undefined ||
        optionalNumber(record.targetZ) !== undefined
          ? {
              x: optionalNumber(record.targetX) ?? 0,
              y: optionalNumber(record.targetY) ?? 0,
              z: optionalNumber(record.targetZ) ?? 0,
            }
          : undefined,
      size: optionalNumber(record.size),
    });
  });
  return lights.length > 0
    ? lights
    : [
        {
          id: "light-ambient",
          name: "Ambient fill",
          kind: "ambient",
          color: "#ffffff",
          intensity: 0.5,
        },
        {
          id: "light-key",
          name: "Key light",
          kind: "directional",
          color: "#ffffff",
          intensity: 1.8,
          position: { x: 4, y: 6, z: 5 },
          target: { x: 0, y: 0, z: 0 },
        },
      ];
}

export function parseCreationLightEntries(value: unknown): CreationLight[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lights: CreationLight[] = [];
  value.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) return;
    const kind = optionalString(record.kind) ?? "point";
    if (!CREATION_LIGHT_KINDS.has(kind)) return;
    lights.push({
      id: optionalString(record.id) ?? `light-${index + 1}`,
      name: optionalString(record.name) ?? `${kind} light`,
      kind: kind as CreationLight["kind"],
      color: optionalString(record.color) ?? "#ffffff",
      intensity: optionalNumber(record.intensity) ?? 1,
      position:
        optionalNumber(record.x) !== undefined ||
        optionalNumber(record.y) !== undefined ||
        optionalNumber(record.z) !== undefined
          ? {
              x: optionalNumber(record.x) ?? 0,
              y: optionalNumber(record.y) ?? 3,
              z: optionalNumber(record.z) ?? 4,
            }
          : undefined,
      target:
        optionalNumber(record.targetX) !== undefined ||
        optionalNumber(record.targetY) !== undefined ||
        optionalNumber(record.targetZ) !== undefined
          ? {
              x: optionalNumber(record.targetX) ?? 0,
              y: optionalNumber(record.targetY) ?? 0,
              z: optionalNumber(record.targetZ) ?? 0,
            }
          : undefined,
      size: optionalNumber(record.size),
    });
  });
  return lights;
}

export function creationCameraFromSceneCamera(
  camera: MotionScene3DCamera | undefined,
  raw?: Record<string, unknown> | null,
): CreationCamera {
  return {
    id: optionalString(raw?.id ?? raw?.cameraId) ?? "camera-hero",
    name: optionalString(raw?.name) ?? "Hero camera",
    position: camera?.position ?? { x: 0, y: 3, z: 12 },
    target: camera?.target ?? { x: 0, y: 0, z: 0 },
    fov: camera?.fov ?? 35,
  };
}

export function parseCreationEnvironmentKind(value: unknown): CreationScene["environment"]["kind"] {
  const explicit = optionalString(value);
  if (explicit && CREATION_ENVIRONMENT_KINDS.has(explicit)) {
    return explicit as CreationScene["environment"]["kind"];
  }
  return "studio";
}

export function parseMotionSceneEnvironment(
  value: unknown,
  fallback?: MotionScene3DLighting,
): MotionScene3DLighting["environment"] | undefined {
  const explicit = optionalString(value);
  if (explicit === "studio" || explicit === "dark" || explicit === "none") {
    return explicit;
  }
  return fallback?.environment;
}

export function syncLightingFromCreation(
  layer: MotionScene3DLayer,
  scene: CreationScene,
  args: Record<string, unknown>,
): MotionScene3DLayer {
  const ambientLight = scene.lights.find((light) => light.kind === "ambient");
  const keyLight = scene.lights.find((light) => light.kind !== "ambient");
  const renderEnvironment = parseMotionSceneEnvironment(
    args.renderEnvironment ?? args.environment,
    layer.lighting,
  );
  const roomRecord = asRecord(args.room);
  const floorColor =
    optionalString(roomRecord?.floorColor) ??
    optionalString(args.floorColor) ??
    scene.environment.groundColor ??
    layer.room?.floorColor;
  const wallColor =
    optionalString(roomRecord?.wallColor) ??
    optionalString(args.wallColor) ??
    scene.environment.backgroundColor ??
    layer.room?.wallColor;
  return {
    ...layer,
    lighting: {
      ...layer.lighting,
      ambient:
        optionalNumber(args.ambient) ??
        ambientLight?.intensity ??
        layer.lighting?.ambient,
      keyIntensity:
        optionalNumber(args.keyIntensity) ??
        keyLight?.intensity ??
        layer.lighting?.keyIntensity,
      keyColor:
        optionalString(args.keyColor) ??
        keyLight?.color ??
        layer.lighting?.keyColor,
      rimIntensity: optionalNumber(args.rimIntensity) ?? layer.lighting?.rimIntensity,
      environment: renderEnvironment,
      groundShadow:
        typeof args.groundShadow === "boolean"
          ? args.groundShadow
          : (scene.environment.groundEnabled ?? layer.lighting?.groundShadow),
    },
    room: {
      ...layer.room,
      enabled:
        typeof roomRecord?.enabled === "boolean"
          ? roomRecord.enabled
          : layer.room?.enabled,
      size: optionalNumber(roomRecord?.size) ?? optionalNumber(args.roomSize) ?? layer.room?.size,
      wallColor,
      floorColor,
    },
  };
}

export function creationGeometryParameters(
  asset: CreationAssetRecipe | undefined,
): Record<string, unknown> {
  if (!asset) return {};
  const geometryNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part" ||
      node.type === "curve",
  );
  return {
    ...asRecord(asset.parameters),
    ...asRecord(geometryNode?.parameters),
  };
}

export function creationParameterNumber(
  parameters: Record<string, unknown>,
  key: string,
): number | undefined {
  return optionalNumber(parameters[key]);
}

export function creationParameterString(
  parameters: Record<string, unknown>,
  key: string,
): string | undefined {
  return optionalString(parameters[key]);
}

export function creationParameterStringArray(
  parameters: Record<string, unknown>,
  key: string,
): string[] | undefined {
  return parseStringArray(parameters[key]);
}

export function creationMotionObjectKind(
  value: unknown,
): MotionObject3DKind | undefined {
  const kind = optionalString(value);
  return kind && MOTION_OBJECT_3D_KINDS.includes(kind as never)
    ? (kind as MotionObject3DKind)
    : undefined;
}

export function materialForCreationSceneObject(
  asset: CreationAssetRecipe | undefined,
  object: CreationSceneObject,
): CreationMaterial | undefined {
  return (
    asset?.materials.find((material) => material.id === object.materialId) ??
    asset?.materials[0]
  );
}

export function meshDependencyUrl(asset: CreationAssetRecipe | undefined): string | undefined {
  return asset?.dependencies.find((dependency) => dependency.kind === "mesh")?.uri;
}

export interface ResolvedModelInspectionSource {
  readonly modelUrl: string;
  readonly name?: string;
  readonly source: string;
  readonly compositionId?: string;
  readonly layerId?: string;
  readonly objectId?: string;
  readonly sceneId?: string;
  readonly creationObjectId?: string;
  readonly assetId?: string;
}

export function modelUrlFromCreationAsset(asset: CreationAssetRecipe | undefined): string | undefined {
  const parameters = creationGeometryParameters(asset);
  return creationParameterString(parameters, "modelUrl") ?? meshDependencyUrl(asset);
}

export function resolveModelInspectionSource(
  args: Record<string, unknown>,
  host: EditingHost,
): ResolvedModelInspectionSource | string {
  const directModelUrl = optionalString(args.modelUrl ?? args.url);
  if (directModelUrl) {
    return {
      modelUrl: directModelUrl,
      name: optionalString(args.name),
      source: "direct",
    };
  }

  const compositionId = optionalString(args.compositionId);
  const layerId = optionalString(args.layerId);
  if (compositionId || layerId) {
    const composition = getMotionComposition(host, compositionId);
    if (!composition) return "Motion composition not found";
    const layer = getMotionLayer(composition, layerId);
    if (!layer || layer.type !== "scene3d") {
      return "layerId must reference a scene3d layer";
    }
    const objectId = optionalString(args.objectId ?? args.renderObjectId);
    if (layer.objects && layer.objects.length > 0) {
      const modelObjects = layer.objects.filter(
        (object) => object.object.kind === "model" && !!object.object.modelUrl,
      );
      const target = objectId
        ? layer.objects.find((object) => object.id === objectId)
        : modelObjects.length === 1
          ? modelObjects[0]
          : undefined;
      if (!target) {
        return objectId
          ? `Scene object not found: ${objectId}`
          : "objectId is required when the scene has multiple or no model objects";
      }
      if (target.object.kind !== "model" || !target.object.modelUrl) {
        return "objectId must reference a model object with modelUrl";
      }
      return {
        modelUrl: target.object.modelUrl,
        name: target.name,
        source: "motion-scene3d-object",
        compositionId: composition.id,
        layerId: layer.id,
        objectId: target.id,
      };
    }
    if (layer.object.kind !== "model" || !layer.object.modelUrl) {
      return "layer must contain a model object with modelUrl";
    }
    return {
      modelUrl: layer.object.modelUrl,
      name: layer.name,
      source: "motion-scene3d-layer",
      compositionId: composition.id,
      layerId: layer.id,
    };
  }

  const state = creationState(host);
  const sceneId = optionalString(args.sceneId);
  if (sceneId || args.creationObjectId || args.objectId) {
    const scene = resolveCreationScene(state, sceneId);
    if (!scene) return "Creation scene not found";
    const requestedObjectId = optionalString(args.creationObjectId ?? args.objectId);
    const assetsById = new Map((state?.assets ?? []).map((asset) => [asset.id, asset]));
    const candidates = scene.objects
      .map((object) => {
        const asset = assetsById.get(object.assetId);
        const modelUrl = modelUrlFromCreationAsset(asset);
        return { object, asset, modelUrl };
      })
      .filter((entry) => !!entry.modelUrl);
    const target = requestedObjectId
      ? candidates.find(
          (entry) =>
            entry.object.id === requestedObjectId ||
            entry.object.partId === requestedObjectId ||
            entry.object.name === requestedObjectId,
        )
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!target) {
      return requestedObjectId
        ? `Creation model object not found: ${requestedObjectId}`
        : "creationObjectId is required when the scene has multiple or no model objects";
    }
    return {
      modelUrl: target.modelUrl!,
      name: target.object.name,
      source: "creation-scene-object",
      sceneId: scene.id,
      creationObjectId: target.object.id,
      assetId: target.asset?.id,
    };
  }

  const assetId = optionalString(args.assetId);
  if (assetId) {
    if (!state) return "No creation state is available";
    const asset = state.assets.find((candidate) => candidate.id === assetId);
    if (!asset) return `Creation asset not found: ${assetId}`;
    const modelUrl = modelUrlFromCreationAsset(asset);
    if (!modelUrl) return "Creation asset has no modelUrl or mesh dependency";
    return {
      modelUrl,
      name: asset.name,
      source: "creation-asset",
      assetId: asset.id,
    };
  }

  return "Provide modelUrl, compositionId/layerId, sceneId/creationObjectId, or assetId";
}

export function bakeAssetMeshCached(
  asset: CreationAssetRecipe,
  cache?: Map<string, MotionObjectMeshData | null>,
): MotionObjectMeshData | null {
  if (!cache) return bakeAssetToMotionObjectMesh(asset);
  if (!cache.has(asset.id)) {
    cache.set(asset.id, bakeAssetToMotionObjectMesh(asset));
  }
  return cache.get(asset.id) ?? null;
}

export function motionObjectFromCreationAsset(
  asset: CreationAssetRecipe | undefined,
  object: CreationSceneObject,
  existing?: MotionSceneObject3D,
  bakeMeshCache?: Map<string, MotionObjectMeshData | null>,
): MotionObject3D {
  if (existing) return existing.object;
  const parameters = creationGeometryParameters(asset);
  let kind =
    creationMotionObjectKind(parameters.motionObjectKind) ??
    creationMotionObjectKind(parameters.kind);
  if (!kind) {
    if (asset?.kind === "ui" && creationParameterString(parameters, "text")) {
      kind = "text3d";
    } else if (asset?.kind === "product" && asset.nodes.some((node) => node.type === "product-part")) {
      kind = "rounded-box";
    } else {
      kind = "box";
    }
  }
  const modelUrl =
    kind === "model"
      ? creationParameterString(parameters, "modelUrl") ?? meshDependencyUrl(asset)
      : undefined;
  if (kind === "model" && !modelUrl) kind = "box";
  const text =
    kind === "text3d"
      ? creationParameterString(parameters, "text") ?? object.name
      : undefined;
  const mesh =
    kind === "model" || kind === "text3d" || !assetNeedsBakedMesh(asset)
      ? undefined
      : bakeAssetMeshCached(asset!, bakeMeshCache) ?? undefined;
  return {
    kind,
    mesh,
    size: creationParameterNumber(parameters, "size"),
    depth: creationParameterNumber(parameters, "depth"),
    aspect: creationParameterNumber(parameters, "aspect"),
    cornerRadius: creationParameterNumber(parameters, "cornerRadius"),
    modelUrl,
    animation: kind === "model" ? motionModelAnimationFromArgs(parameters) : undefined,
    text,
    extrude:
      kind === "text3d"
        ? creationParameterNumber(parameters, "extrude")
        : undefined,
    panelTexts:
      kind === "soccer-ball"
        ? creationParameterStringArray(parameters, "panelTexts")
        : undefined,
  };
}

export function renderObjectIdForCreationObject(
  scene: CreationScene,
  object: CreationSceneObject,
  binding: CreationRenderBinding | undefined,
  used: Set<string>,
): string {
  const existing = binding?.objectBindings.find(
    (candidate) => candidate.sceneObjectId === object.id,
  )?.renderObjectId;
  const base =
    existing ??
    `obj-${idSegment(scene.id, "scene")}-${idSegment(
      object.partId ?? object.name ?? object.id,
      "object",
    )}`;
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

export function motionSceneObjectFromCreation(
  object: CreationSceneObject,
  asset: CreationAssetRecipe | undefined,
  renderObjectId: string,
  existing?: MotionSceneObject3D,
  bakeMeshCache?: Map<string, MotionObjectMeshData | null>,
): MotionSceneObject3D {
  const material = materialForCreationSceneObject(asset, object);
  const parameters = creationGeometryParameters(asset);
  return {
    id: renderObjectId,
    name: object.name,
    object: motionObjectFromCreationAsset(asset, object, existing, bakeMeshCache),
    material: material
      ? motionMaterialForCreation(material)
      : existing?.material ?? {
          kind: "physical",
          color: "#cbd5e1",
          metalness: 0,
          roughness: 0.65,
        },
    transform3d: {
      position: object.transform.position,
      rotation: object.transform.rotation,
      scale: object.transform.scale,
    },
    lidAngle:
      creationParameterNumber(parameters, "lidAngle") ?? existing?.lidAngle,
    opacity:
      material?.opacity ??
      creationParameterNumber(parameters, "opacity") ??
      existing?.opacity,
  };
}

export function cameraForCreationScene(scene: CreationScene): MotionScene3DCamera {
  const camera =
    scene.cameras.find((candidate) => candidate.id === scene.activeCameraId) ??
    scene.cameras[0];
  return {
    position: camera?.position ?? { x: 0, y: 3, z: 12 },
    target: camera?.target ?? { x: 0, y: 0, z: 0 },
    fov: camera?.fov ?? 35,
    near: 0.05,
    far: 120,
  };
}

export function lightingForCreationScene(scene: CreationScene): MotionScene3DLighting {
  const ambientLight = scene.lights.find((light) => light.kind === "ambient");
  const keyLight = scene.lights.find((light) => light.kind !== "ambient");
  return {
    ambient: ambientLight?.intensity ?? 0.45,
    keyIntensity: keyLight?.intensity ?? 1.8,
    keyColor: keyLight?.color ?? "#ffffff",
    rimIntensity: scene.environment.kind === "space" ? 0.8 : 0.45,
    environment:
      scene.environment.kind === "none"
        ? "none"
        : scene.environment.kind === "space"
          ? "dark"
          : "studio",
    groundShadow: scene.environment.groundEnabled ?? false,
  };
}

export function roomForCreationScene(scene: CreationScene): MotionScene3DRoom {
  return {
    enabled: scene.environment.groundEnabled ?? true,
    size: 12,
    wallColor: scene.environment.backgroundColor ?? "#0f172a",
    floorColor: scene.environment.groundColor ?? scene.environment.backgroundColor ?? "#111827",
  };
}

export function creationSceneAnimationKeyframes(
  scene: CreationScene,
  renderObjectIdsBySceneObjectId: ReadonlyMap<string, string>,
): Keyframe[] {
  const keyframes: Keyframe[] = [];
  for (const clip of scene.animations) {
    for (const object of scene.objects) {
      const renderObjectId = renderObjectIdsBySceneObjectId.get(object.id);
      if (!renderObjectId) continue;
      const tracks = clip.tracks.filter((track) => track.targetId === object.id);
      keyframes.push(...motionKeyframesForCreationObjectTracks(renderObjectId, tracks, genId));
    }
    for (const camera of scene.cameras) {
      const tracks = clip.tracks.filter((track) => track.targetId === camera.id);
      keyframes.push(...motionKeyframesForCreationCameraTracks(tracks, genId));
    }
  }
  return keyframes;
}

export function preservedScene3DKeyframes(
  layer: MotionScene3DLayer | undefined,
  validRenderObjectIds: ReadonlySet<string>,
): Keyframe[] {
  if (!layer) return [];
  return layer.keyframes.filter((keyframe) => {
    const match = /^scene\.object\.([^.]+)\./.exec(keyframe.property);
    if (!match) return true;
    return validRenderObjectIds.has(match[1]);
  });
}

export function buildMotionScene3DFromCreation(
  scene: CreationScene,
  assets: readonly CreationAssetRecipe[],
  options: {
    readonly compositionWidth: number;
    readonly compositionHeight: number;
    readonly layerId: string;
    readonly layerName: string;
    readonly duration: number;
    readonly binding?: CreationRenderBinding;
    readonly existingLayer?: MotionScene3DLayer;
  },
): {
  readonly layer: MotionScene3DLayer;
  readonly objectBindings: CreationRenderBinding["objectBindings"];
  readonly renderObjectIdsBySceneObjectId: Record<string, string>;
  readonly missingAssetObjectIds: string[];
} {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const existingObjectById = new Map(
    (options.existingLayer?.objects ?? []).map((object) => [object.id, object]),
  );
  const usedRenderIds = new Set<string>();
  const renderObjectIdMap = new Map<string, string>();
  const objectBindings: CreationRenderObjectBinding[] = [];
  const objects: MotionSceneObject3D[] = [];
  const missingAssetObjectIds: string[] = [];
  const bakeMeshCache = new Map<string, MotionObjectMeshData | null>();
  for (const object of scene.objects) {
    const asset = assetById.get(object.assetId);
    if (!asset) missingAssetObjectIds.push(object.id);
    const renderObjectId = renderObjectIdForCreationObject(
      scene,
      object,
      options.binding,
      usedRenderIds,
    );
    renderObjectIdMap.set(object.id, renderObjectId);
    objectBindings.push({ sceneObjectId: object.id, renderObjectId });
    objects.push(
      motionSceneObjectFromCreation(
        object,
        asset,
        renderObjectId,
        existingObjectById.get(renderObjectId),
        bakeMeshCache,
      ),
    );
  }

  const camera = cameraForCreationScene(scene);
  const baseLayer = createMotionScene3DLayer({
    id: options.layerId,
    name: options.layerName,
    duration: options.duration,
    compositionWidth: options.compositionWidth,
    compositionHeight: options.compositionHeight,
    object: { kind: "box" },
    objects,
    camera,
    room: roomForCreationScene(scene),
    lighting: lightingForCreationScene(scene),
    fov: camera.fov,
    width: options.compositionWidth,
    height: options.compositionHeight,
  });
  const validRenderObjectIds = new Set(renderObjectIdMap.values());
  const semanticKeyframes = creationSceneAnimationKeyframes(scene, renderObjectIdMap);
  const keyframes = mergeSceneKeyframes(
    preservedScene3DKeyframes(options.existingLayer, validRenderObjectIds),
    semanticKeyframes,
  );
  const layer: MotionScene3DLayer = {
    ...baseLayer,
    startTime: options.existingLayer?.startTime ?? baseLayer.startTime,
    visible: options.existingLayer?.visible ?? baseLayer.visible,
    locked: options.existingLayer?.locked ?? baseLayer.locked,
    transform: options.existingLayer?.transform ?? baseLayer.transform,
    keyframes,
  };
  return {
    layer,
    objectBindings,
    renderObjectIdsBySceneObjectId: Object.fromEntries(renderObjectIdMap),
    missingAssetObjectIds,
  };
}

export interface MotionSceneCreationDraftEntry {
  readonly key: string;
  readonly parentKey?: string;
  readonly asset: CreationAssetRecipe;
  readonly sceneObject: CreationSceneObject;
  readonly renderObjectId: string;
}

export interface MotionSceneCreationDraft {
  readonly scene: CreationScene;
  readonly assets: readonly CreationAssetRecipe[];
  readonly binding: CreationRenderBinding;
  readonly objectIdsByKey: Record<string, string>;
  readonly renderObjectIdsByKey: Record<string, string>;
}

export function rawRecordFromMotionSceneObject(
  object: MotionSceneObject3D,
): Record<string, unknown> {
  return {
    name: object.name,
    kind: object.object.kind,
    size: object.object.size,
    depth: object.object.depth,
    aspect: object.object.aspect,
    cornerRadius: object.object.cornerRadius,
    modelUrl: object.object.modelUrl,
    text: object.object.text,
    extrude: object.object.extrude,
    panelTexts: object.object.panelTexts,
    color: object.material?.color,
    metalness: object.material?.metalness,
    roughness: object.material?.roughness,
    materialKind: object.material?.kind,
    emissive: object.material?.emissive,
    emissiveIntensity: object.material?.emissiveIntensity,
    mapAssetId: object.material?.mapAssetId,
    opacity: object.opacity,
    lidAngle: object.lidAngle,
  };
}

export function buildCreationDraftEntryFromMotionObject(options: {
  readonly sceneKey: string;
  readonly objectKey: string;
  readonly raw: Record<string, unknown>;
  readonly motionObject: MotionSceneObject3D;
  readonly renderObjectId: string;
  readonly now: number;
}): MotionSceneCreationDraftEntry {
  const material = creationMaterialFromSceneObject(
    `${options.sceneKey}-${options.objectKey}`,
    options.raw,
    options.motionObject,
  );
  const asset = creationAssetFromSceneObject(
    `${options.sceneKey}-${options.objectKey}`,
    options.raw,
    options.motionObject,
    material,
    options.now,
  );
  const sceneObject: CreationSceneObject = {
    id:
      optionalString(options.raw.objectId) ??
      `object-${options.sceneKey}-${options.objectKey}`,
    name: options.motionObject.name ?? options.objectKey,
    assetId: asset.id,
    materialId: material.id,
    partId: optionalString(options.raw.partId) ?? options.objectKey,
    parentId: optionalString(options.raw.parentId),
    transform: requiredTransform3D(options.motionObject),
    visible: options.raw.visible !== false,
    selectable: options.raw.selectable !== false,
    tags: [
      ...new Set([
        "agent-created",
        "legacy-motion-3d",
        options.motionObject.object.kind,
        ...(parseStringArray(options.raw.tags) ?? []),
      ]),
    ],
  };
  return {
    key: options.objectKey,
    parentKey: optionalString(options.raw.parentKey),
    asset,
    sceneObject,
    renderObjectId: options.renderObjectId,
  };
}

export function buildCreationDraftFromMotionSceneLayer(options: {
  readonly composition: MotionComposition;
  readonly layer: MotionScene3DLayer;
  readonly rawObjects?: readonly Record<string, unknown>[];
  readonly args?: Record<string, unknown>;
  readonly sceneId?: string;
  readonly now: number;
}): MotionSceneCreationDraft {
  const name =
    optionalString(options.args?.name) ??
    options.layer.name ??
    options.composition.name ??
    "Motion 3D Scene";
  const sceneId =
    options.sceneId ??
    optionalString(options.args?.sceneId) ??
    `scene-${idSegment(name, "motion-3d")}-${idSegment(options.layer.id, "layer")}`;
  const sceneKey = idSegment(sceneId, "scene");
  const usedObjectKeys = new Set<string>();
  const objects = options.layer.objects ?? [];
  const entries = objects.map((motionObject, index) => {
    const raw =
      options.rawObjects?.[index] ?? rawRecordFromMotionSceneObject(motionObject);
    const key = uniqueIdSegment(
      raw.key ?? raw.objectId ?? raw.partId ?? motionObject.name ?? motionObject.id,
      `object-${index + 1}`,
      usedObjectKeys,
    );
    return buildCreationDraftEntryFromMotionObject({
      sceneKey,
      objectKey: key,
      raw,
      motionObject,
      renderObjectId: motionObject.id,
      now: options.now,
    });
  });

  const objectIdByKey = new Map(entries.map((entry) => [entry.key, entry.sceneObject.id]));
  const sceneObjects: CreationSceneObject[] = entries.map((entry) => {
    const parentId = entry.parentKey
      ? objectIdByKey.get(entry.parentKey)
      : entry.sceneObject.parentId;
    return { ...entry.sceneObject, parentId };
  });
  const room = parseSceneRoom(asRecord(options.args?.room));
  const environment =
    optionalString(options.args?.creationEnvironment) ??
    optionalString(options.args?.environment) ??
    options.layer.lighting?.environment;
  const creationCamera = creationCameraFromSceneCamera(
    options.layer.camera,
    asRecord(options.args?.camera),
  );
  const binding: CreationRenderBinding = {
    id: `binding-${sceneId}-${options.composition.id}`,
    kind: "motion-scene3d",
    compositionId: options.composition.id,
    layerId: options.layer.id,
    objectBindings: entries.map((entry) => ({
      sceneObjectId: entry.sceneObject.id,
      renderObjectId: entry.renderObjectId,
    })),
    createdAt: options.now,
    modifiedAt: options.now,
  };
  const scene: CreationScene = {
    id: sceneId,
    name,
    duration: options.layer.duration ?? options.composition.duration,
    frameRate: options.composition.frameRate,
    objects: sceneObjects,
    cameras: [creationCamera],
    activeCameraId: creationCamera.id,
    lights: parseCreationLights(options.args?.lights),
    animations: [],
    environment: {
      kind: parseCreationEnvironmentKind(environment),
      backgroundColor:
        optionalString(options.args?.backgroundColor) ??
        options.composition.backgroundColor,
      groundEnabled:
        options.args?.groundShadow === true ||
        options.layer.lighting?.groundShadow === true,
      groundColor: room?.floorColor ?? options.layer.room?.floorColor,
    },
    renderBindings: [binding],
    createdAt: options.now,
    modifiedAt: options.now,
  };
  return {
    scene,
    assets: entries.map((entry) => entry.asset),
    binding,
    objectIdsByKey: Object.fromEntries(
      entries.map((entry) => [entry.key, entry.sceneObject.id]),
    ),
    renderObjectIdsByKey: Object.fromEntries(
      entries.map((entry) => [entry.key, entry.renderObjectId]),
    ),
  };
}

export async function applyCreationOperations(
  host: EditingHost,
  operations: readonly CreationOperation[],
): Promise<ToolResult> {
  for (const operation of operations) {
    const applied = await applyMotionAction(host, "creation/applyOperation", {
      operation,
    });
    if (!applied.ok) return applied;
  }
  return ok("Applied creation operations", {
    operationIds: operations.map((operation) => operation.id),
  });
}

export async function persistMotionSceneCreationDraft(
  host: EditingHost,
  draft: MotionSceneCreationDraft,
  options: {
    readonly now: number;
    readonly setActive?: boolean;
    readonly source?: CreationOperation["source"];
    readonly labelPrefix?: string;
  },
): Promise<ToolResult> {
  const operations: CreationOperation[] = [
    ...draft.assets.map((asset): CreationOperation => ({
      id: genId(),
      type: "asset/upsert",
      timestamp: options.now,
      source: options.source ?? "agent",
      label: `${options.labelPrefix ?? "Create"} ${asset.name}`,
      asset,
    })),
    {
      id: genId(),
      type: "scene/upsert",
      timestamp: options.now,
      source: options.source ?? "agent",
      label: `${options.labelPrefix ?? "Create"} ${draft.scene.name}`,
      scene: draft.scene,
    },
  ];
  if (options.setActive !== false) {
    operations.push({
      id: genId(),
      type: "scene/set-active",
      timestamp: options.now,
      source: options.source ?? "agent",
      label: `Activate ${draft.scene.name}`,
      sceneId: draft.scene.id,
    });
  }
  return applyCreationOperations(host, operations);
}

export function findCreationBindingForMotionSceneLayer(
  state: CreationProjectState | undefined,
  compositionId: string,
  layerId: string,
): { readonly scene: CreationScene; readonly binding: CreationRenderBinding } | undefined {
  for (const scene of state?.scenes ?? []) {
    const binding = scene.renderBindings.find(
      (candidate) =>
        candidate.kind === "motion-scene3d" &&
        candidate.compositionId === compositionId &&
        candidate.layerId === layerId,
    );
    if (binding) return { scene, binding };
  }
  return undefined;
}

export async function ensureCreationBindingForMotionSceneLayer(
  host: EditingHost,
  composition: MotionComposition,
  layer: MotionScene3DLayer,
  args?: Record<string, unknown>,
): Promise<
  | { readonly ok: true; readonly scene: CreationScene; readonly binding: CreationRenderBinding }
  | { readonly ok: false; readonly result: ToolResult }
> {
  const existing = findCreationBindingForMotionSceneLayer(
    creationState(host),
    composition.id,
    layer.id,
  );
  if (existing) return { ok: true, ...existing };
  if (!layer.objects || layer.objects.length === 0) {
    return {
      ok: false,
      result: fail("scene3d layer has no editable objects to materialize", "INVALID_PARAMS"),
    };
  }
  const now = Date.now();
  const draft = buildCreationDraftFromMotionSceneLayer({
    composition,
    layer,
    args,
    now,
  });
  const applied = await persistMotionSceneCreationDraft(host, draft, {
    now,
    labelPrefix: "Recover",
  });
  if (!applied.ok) return { ok: false, result: applied };
  return { ok: true, scene: draft.scene, binding: draft.binding };
}

export async function syncLegacyMotionSceneObjectAnimationToCreation(options: {
  readonly host: EditingHost;
  readonly composition: MotionComposition;
  readonly layer: MotionScene3DLayer;
  readonly renderObjectId: string;
  readonly args: Record<string, unknown>;
}): Promise<ToolResult> {
  const ensured = await ensureCreationBindingForMotionSceneLayer(
    options.host,
    options.composition,
    options.layer,
    options.args,
  );
  if (!ensured.ok) return ensured.result;
  const objectBinding = ensured.binding.objectBindings.find(
    (candidate) => candidate.renderObjectId === options.renderObjectId,
  );
  if (!objectBinding) {
    return fail(
      `Creation binding not found for render object ${options.renderObjectId}`,
      "NOT_FOUND",
    );
  }
  const sceneObject = ensured.scene.objects.find(
    (candidate) => candidate.id === objectBinding.sceneObjectId,
  );
  if (!sceneObject) {
    return fail(`Creation object not found: ${objectBinding.sceneObjectId}`, "NOT_FOUND");
  }
  const clipId =
    optionalString(options.args.clipId) ??
    `anim-${sceneObject.id}-legacy-motion`;
  const built = buildCreationObjectAnimationTracks(options.args, sceneObject, clipId);
  if (built.tracks.length === 0) {
    return fail(
      "Provide position, rotation, scale, and/or opacity keyframes",
      "INVALID_PARAMS",
    );
  }
  const existingClip = ensured.scene.animations.find((clip) => clip.id === clipId);
  const duration = Math.max(
    0,
    optionalNumber(options.args.duration) ??
      existingClip?.duration ??
      ensured.scene.duration,
    maxCreationKeyframeTime(built.tracks),
  );
  const clip = mergeCreationObjectAnimationClip(
    existingClip,
    sceneObject,
    built.tracks,
    built.channels,
    {
      clipId,
      name: optionalString(options.args.name),
      duration,
    },
  );
  const nextScene: CreationScene = {
    ...ensured.scene,
    animations: existingClip
      ? ensured.scene.animations.map((candidate) =>
          candidate.id === clip.id ? clip : candidate,
        )
      : [...ensured.scene.animations, clip],
    modifiedAt: Date.now(),
  };
  const operation: CreationOperation = {
    id: genId(),
    type: "scene/upsert",
    timestamp: Date.now(),
    source: "agent",
    label: `Mirror ${sceneObject.name} motion animation`,
    scene: nextScene,
  };
  const applied = await applyCreationOperations(options.host, [operation]);
  return applied.ok
    ? ok("Mirrored legacy scene object animation to creation state", {
        sceneId: nextScene.id,
        objectId: sceneObject.id,
        renderObjectId: options.renderObjectId,
        clipId,
        operationId: operation.id,
      })
    : applied;
}

export async function syncLegacyMotionSceneCameraAnimationToCreation(options: {
  readonly host: EditingHost;
  readonly composition: MotionComposition;
  readonly layer: MotionScene3DLayer;
  readonly args: Record<string, unknown>;
}): Promise<ToolResult> {
  const ensured = await ensureCreationBindingForMotionSceneLayer(
    options.host,
    options.composition,
    options.layer,
    options.args,
  );
  if (!ensured.ok) return ensured.result;
  const camera =
    ensured.scene.cameras.find(
      (candidate) => candidate.id === ensured.scene.activeCameraId,
    ) ?? ensured.scene.cameras[0];
  if (!camera) return fail("Creation scene has no camera to animate", "NOT_FOUND");
  const clipId =
    optionalString(options.args.clipId) ??
    `anim-${ensured.scene.id}-camera-legacy-motion`;
  const built = buildCreationCameraAnimationTracks(
    options.args,
    camera,
    ensured.scene,
    clipId,
  );
  if (built.tracks.length === 0) {
    return fail("Provide position, target, and/or fov keyframes", "INVALID_PARAMS");
  }
  const existingClip = ensured.scene.animations.find((clip) => clip.id === clipId);
  const duration = Math.max(
    0,
    optionalNumber(options.args.duration) ??
      existingClip?.duration ??
      ensured.scene.duration,
    maxCreationKeyframeTime(built.tracks),
  );
  const clip = mergeCreationCameraAnimationClip(
    existingClip,
    camera,
    built.tracks,
    built.channels,
    {
      clipId,
      name: optionalString(options.args.name),
      duration,
    },
  );
  const nextScene: CreationScene = {
    ...ensured.scene,
    animations: existingClip
      ? ensured.scene.animations.map((candidate) =>
          candidate.id === clip.id ? clip : candidate,
        )
      : [...ensured.scene.animations, clip],
    modifiedAt: Date.now(),
  };
  const operation: CreationOperation = {
    id: genId(),
    type: "scene/upsert",
    timestamp: Date.now(),
    source: "agent",
    label: `Mirror ${camera.name} motion animation`,
    scene: nextScene,
  };
  const applied = await applyCreationOperations(options.host, [operation]);
  return applied.ok
    ? ok("Mirrored legacy scene camera animation to creation state", {
        sceneId: nextScene.id,
        cameraId: camera.id,
        clipId,
        operationId: operation.id,
      })
    : applied;
}

export function resolveCreationParentId(
  scene: CreationScene,
  parentId: unknown,
  parentKey: unknown,
): { ok: true; parentId?: string } | { ok: false; error: string } {
  const explicitParentId = optionalString(parentId);
  if (explicitParentId) {
    return scene.objects.some((object) => object.id === explicitParentId)
      ? { ok: true, parentId: explicitParentId }
      : { ok: false, error: `parentId not found: ${explicitParentId}` };
  }
  const key = optionalString(parentKey);
  if (!key) return { ok: true };
  const normalized = idSegment(key, key);
  const parent = scene.objects.find(
    (object) =>
      object.id === key ||
      object.partId === key ||
      object.partId === normalized ||
      idSegment(object.name, object.id) === normalized,
  );
  return parent
    ? { ok: true, parentId: parent.id }
    : { ok: false, error: `parentKey not found: ${key}` };
}

export type CreationVectorChannel = "position" | "rotation" | "scale";

export type CreationScalarChannel = "opacity";

export type CreationObjectAnimationChannel = CreationVectorChannel | CreationScalarChannel;

export type CreationCameraVectorChannel = "camera.position" | "camera.target";

export type CreationCameraScalarChannel = "camera.fov" | "camera.focusDistance";

export type CreationCameraAnimationChannel =
  | CreationCameraVectorChannel
  | CreationCameraScalarChannel;

export type CreationVec3 = Transform3D["position"];

export type CreationExplodedViewAxis = "radial" | "x" | "y" | "z";

export interface CreationExplodedViewObjectMotion {
  readonly object: CreationSceneObject;
  readonly direction: CreationVec3;
  readonly basePosition: CreationVec3;
  readonly explodedPosition: CreationVec3;
  readonly startTime: number;
  readonly endTime: number;
  readonly returnTime?: number;
}

export const CREATION_ANIMATION_EASINGS: ReadonlySet<string> = new Set([
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
]);

export const CREATION_PRODUCT_PART_ROLES = [
  "shell",
  "screen",
  "lens",
  "camera-module",
  "board",
  "battery",
  "chip",
  "thermal",
  "screw",
  "connector",
  "gasket",
  "decorative",
] as const;

export type CreationProductPartRole = (typeof CREATION_PRODUCT_PART_ROLES)[number];

export interface CreationProductPartDefaults {
  readonly kind: MotionObject3DKind;
  readonly name: string;
  readonly scale: CreationVec3;
  readonly position: CreationVec3;
  readonly color: string;
  readonly materialModel: CreationMaterialModel;
  readonly metalness?: number;
  readonly roughness?: number;
  readonly opacity?: number;
  readonly emissive?: string;
  readonly emissiveIntensity?: number;
  readonly cornerRadius?: number;
  readonly tags: readonly string[];
}

export const CREATION_PRODUCT_PART_DEFAULTS = {
  shell: {
    kind: "rounded-box",
    name: "Product shell",
    scale: { x: 1.2, y: 0.16, z: 0.72 },
    position: { x: 0, y: 0, z: 0 },
    color: "#94a3b8",
    materialModel: "metal",
    metalness: 0.82,
    roughness: 0.24,
    cornerRadius: 0.08,
    tags: ["outer", "body"],
  },
  screen: {
    kind: "plane",
    name: "Display glass",
    scale: { x: 0.92, y: 0.5, z: 1 },
    position: { x: 0, y: 0, z: 0.09 },
    color: "#020617",
    materialModel: "screen",
    roughness: 0.14,
    emissive: "#38bdf8",
    emissiveIntensity: 0.7,
    tags: ["display", "glass"],
  },
  lens: {
    kind: "cylinder",
    name: "Camera lens",
    scale: { x: 0.12, y: 0.045, z: 0.12 },
    position: { x: 0.38, y: 0.04, z: 0.14 },
    color: "#0f172a",
    materialModel: "glass",
    roughness: 0.06,
    opacity: 0.82,
    emissive: "#1e293b",
    emissiveIntensity: 0.14,
    tags: ["camera", "glass"],
  },
  "camera-module": {
    kind: "rounded-box",
    name: "Camera module",
    scale: { x: 0.42, y: 0.08, z: 0.32 },
    position: { x: 0.35, y: 0.02, z: 0.08 },
    color: "#1e293b",
    materialModel: "metal",
    metalness: 0.65,
    roughness: 0.28,
    cornerRadius: 0.05,
    tags: ["camera", "module"],
  },
  board: {
    kind: "rounded-box",
    name: "Logic board",
    scale: { x: 0.76, y: 0.05, z: 0.42 },
    position: { x: 0, y: 0, z: 0.04 },
    color: "#064e3b",
    materialModel: "pbr",
    roughness: 0.56,
    cornerRadius: 0.025,
    tags: ["internal", "circuit"],
  },
  battery: {
    kind: "rounded-box",
    name: "Battery pack",
    scale: { x: 0.54, y: 0.055, z: 0.32 },
    position: { x: -0.28, y: 0, z: 0.02 },
    color: "#111827",
    materialModel: "plastic",
    roughness: 0.68,
    cornerRadius: 0.04,
    tags: ["internal", "power"],
  },
  chip: {
    kind: "rounded-box",
    name: "Silicon chip",
    scale: { x: 0.22, y: 0.045, z: 0.18 },
    position: { x: 0.24, y: 0.04, z: 0.08 },
    color: "#111827",
    materialModel: "pbr",
    metalness: 0.24,
    roughness: 0.38,
    emissive: "#22c55e",
    emissiveIntensity: 0.16,
    cornerRadius: 0.018,
    tags: ["internal", "chip"],
  },
  thermal: {
    kind: "plane",
    name: "Thermal layer",
    scale: { x: 0.82, y: 0.42, z: 1 },
    position: { x: 0, y: -0.04, z: 0.03 },
    color: "#b86b2f",
    materialModel: "metal",
    metalness: 0.72,
    roughness: 0.32,
    tags: ["internal", "thermal"],
  },
  screw: {
    kind: "cylinder",
    name: "Micro screw",
    scale: { x: 0.035, y: 0.02, z: 0.035 },
    position: { x: 0.42, y: 0.04, z: 0.24 },
    color: "#cbd5e1",
    materialModel: "metal",
    metalness: 0.86,
    roughness: 0.18,
    tags: ["fastener", "internal"],
  },
  connector: {
    kind: "rounded-box",
    name: "Connector",
    scale: { x: 0.18, y: 0.025, z: 0.05 },
    position: { x: 0.12, y: 0.05, z: -0.2 },
    color: "#b86b2f",
    materialModel: "metal",
    metalness: 0.88,
    roughness: 0.22,
    cornerRadius: 0.01,
    tags: ["internal", "connector"],
  },
  gasket: {
    kind: "torus",
    name: "Rubber gasket",
    scale: { x: 0.32, y: 0.04, z: 0.32 },
    position: { x: 0, y: 0.03, z: 0.1 },
    color: "#020617",
    materialModel: "plastic",
    roughness: 0.86,
    tags: ["seal", "rubber"],
  },
  decorative: {
    kind: "rounded-box",
    name: "Decorative part",
    scale: { x: 0.28, y: 0.04, z: 0.12 },
    position: { x: 0, y: 0, z: 0.12 },
    color: "#e5e7eb",
    materialModel: "pbr",
    roughness: 0.44,
    cornerRadius: 0.02,
    tags: ["decorative"],
  },
} as const satisfies Record<CreationProductPartRole, CreationProductPartDefaults>;

export function creationProductPartRole(value: unknown): CreationProductPartRole | undefined {
  const role = optionalString(value);
  return CREATION_PRODUCT_PART_ROLES.includes(role as CreationProductPartRole)
    ? (role as CreationProductPartRole)
    : undefined;
}

export function addVec3(a: CreationVec3, b: CreationVec3): CreationVec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function crossVec3(a: CreationVec3, b: CreationVec3): CreationVec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function subtractVec3(a: CreationVec3, b: CreationVec3): CreationVec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scaleVec3(value: CreationVec3, scale: number): CreationVec3 {
  return { x: value.x * scale, y: value.y * scale, z: value.z * scale };
}

export function hashStringToUint32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: unknown): () => number {
  let state = hashStringToUint32(optionalString(seed) ?? String(seed ?? "openreel"));
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSigned(random: () => number, amount: number): number {
  return (random() * 2 - 1) * amount;
}

export function normalizeVec3(value: CreationVec3, fallback: CreationVec3): CreationVec3 {
  const length = Math.hypot(value.x, value.y, value.z);
  if (length < 1e-6) return fallback;
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}

export function averageCreationObjectPosition(
  objects: readonly CreationSceneObject[],
): CreationVec3 {
  if (objects.length === 0) return { x: 0, y: 0, z: 0 };
  const total = objects.reduce(
    (sum, object) => addVec3(sum, object.transform.position),
    { x: 0, y: 0, z: 0 },
  );
  return scaleVec3(total, 1 / objects.length);
}

export function creationCutawayTargets(
  scene: CreationScene,
  args: Record<string, unknown>,
): readonly CreationSceneObject[] {
  const selected: CreationSceneObject[] = [];
  const seen = new Set<string>();
  const push = (object: CreationSceneObject): void => {
    if (seen.has(object.id)) return;
    seen.add(object.id);
    selected.push(object);
  };

  const objectIds = parseStringArray(args.targetObjectIds ?? args.objectIds);
  if (objectIds) {
    for (const reference of objectIds) {
      const object = findCreationSceneObjectByReference(scene, reference);
      if (object) push(object);
    }
  }

  const partIds = parseStringArray(args.targetPartIds ?? args.partIds ?? args.parts);
  if (partIds) {
    for (const reference of partIds) {
      const normalized = idSegment(reference, reference);
      for (const object of scene.objects) {
        if (
          object.partId === reference ||
          object.partId === normalized ||
          object.id === reference ||
          idSegment(object.name, object.id) === normalized
        ) {
          push(object);
        }
      }
    }
  }

  const includeTags = parseStringArray(args.tags ?? args.includeTags);
  if (includeTags) {
    for (const object of scene.objects) {
      if (object.tags.some((tag) => includeTags.includes(tag))) push(object);
    }
  }

  if (selected.length > 0) return selected;
  return scene.objects.filter(
    (object) =>
      object.visible &&
      !object.tags.includes("cutaway") &&
      !object.tags.includes("cutaway-plane") &&
      (object.tags.includes("product-part") || Boolean(object.partId)),
  );
}

export function cutawayNormalFromArgs(args: Record<string, unknown>): CreationVec3 {
  const axis = optionalString(args.axis ?? args.planeAxis);
  const fallback =
    axis === "x"
      ? { x: 1, y: 0, z: 0 }
      : axis === "y"
        ? { x: 0, y: 1, z: 0 }
        : { x: 0, y: 0, z: 1 };
  const normal = normalizeVec3(
    vec3FromArgs(args.normal, fallback, ["normalX", "normalY", "normalZ"], args),
    fallback,
  );
  return args.flip === true ? scaleVec3(normal, -1) : normal;
}

export function cutawayRotationForNormal(normal: CreationVec3): CreationVec3 {
  const absX = Math.abs(normal.x);
  const absY = Math.abs(normal.y);
  const absZ = Math.abs(normal.z);
  if (absX >= absY && absX >= absZ) {
    return { x: 0, y: normal.x >= 0 ? 90 : -90, z: 0 };
  }
  if (absY >= absX && absY >= absZ) {
    return { x: normal.y >= 0 ? -90 : 90, y: 0, z: 0 };
  }
  return { x: 0, y: normal.z >= 0 ? 0 : 180, z: 0 };
}

export function updateCreationAssetCutawayPlane(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  options: {
    readonly normal: CreationVec3;
    readonly offset: number;
    readonly targetObjects: readonly CreationSceneObject[];
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-cutaway-plane`;
  const sourceNode = asset.nodes.find(
    (node) => node.type === "primitive" || node.type === "cache",
  );
  const cutawayParameters = compactCreationParameters({
    source: "agent-cutaway-plane",
    mode: optionalString(args.mode) ?? "preview-plane",
    normal: options.normal,
    offset: options.offset,
    targetObjectIds: options.targetObjects.map((object) => object.id),
    targetPartIds: options.targetObjects.map((object) => object.partId).filter(Boolean),
    invert: args.invert === true,
    previewOnly: args.previewOnly !== false,
    tint:
      optionalString(args.tint) ??
      optionalString(args.color) ??
      optionalString(args.baseColor) ??
      "#38bdf8",
    opacity: optionalNumber(args.opacity) ?? 0.28,
  });
  const cutawayNode = {
    id: nodeId,
    type: "boolean" as const,
    name: optionalString(args.nodeName) ?? "Cutaway plane",
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: cutawayParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      cutawayPlane: cutawayParameters,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? cutawayNode : node))
      : [...asset.nodes, cutawayNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-cutaway-preview`,
      "agent-cutaway-plane-v1",
    ),
    modifiedAt: options.now,
  };
}

export function creationDecalTargets(
  scene: CreationScene,
  args: Record<string, unknown>,
): readonly CreationSceneObject[] {
  const selected: CreationSceneObject[] = [];
  const seen = new Set<string>();
  const push = (object: CreationSceneObject): void => {
    if (seen.has(object.id)) return;
    seen.add(object.id);
    selected.push(object);
  };

  const singleObjectId = optionalString(args.targetObjectId);
  if (singleObjectId) {
    const object = findCreationSceneObjectByReference(scene, singleObjectId);
    if (object) push(object);
  }

  const singlePartId = optionalString(args.targetPartId ?? args.targetPart);
  if (singlePartId) {
    const object = findCreationSceneObjectByReference(scene, singlePartId);
    if (object) push(object);
  }

  const objectIds = parseStringArray(args.targetObjectIds ?? args.objectIds);
  if (objectIds) {
    for (const reference of objectIds) {
      const object = findCreationSceneObjectByReference(scene, reference);
      if (object) push(object);
    }
  }

  const partIds = parseStringArray(args.targetPartIds ?? args.partIds ?? args.parts);
  if (partIds) {
    for (const reference of partIds) {
      const object = findCreationSceneObjectByReference(scene, reference);
      if (object) push(object);
    }
  }

  const includeTags = parseStringArray(args.tags ?? args.includeTags);
  if (includeTags) {
    for (const object of scene.objects) {
      if (object.tags.some((tag) => includeTags.includes(tag))) push(object);
    }
  }

  return selected;
}

export function updateCreationAssetDecal(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  options: {
    readonly targetObjects: readonly CreationSceneObject[];
    readonly normal: CreationVec3;
    readonly offset: number;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-decal`;
  const sourceNode = asset.nodes.find(
    (node) => node.type === "primitive" || node.type === "cache",
  );
  const decalParameters = compactCreationParameters({
    source: "agent-decal",
    projection: optionalString(args.projection) ?? "surface",
    targetObjectIds: options.targetObjects.map((object) => object.id),
    targetPartIds: options.targetObjects.map((object) => object.partId).filter(Boolean),
    normal: options.normal,
    offset: options.offset,
    text: optionalString(args.text) ?? optionalString(args.label),
    mapAssetId: optionalString(args.mapAssetId),
    tint:
      optionalString(args.tint) ??
      optionalString(args.color) ??
      optionalString(args.baseColor) ??
      "#f8fafc",
    opacity: optionalNumber(args.opacity) ?? 1,
    wrap: optionalString(args.wrap) ?? "flat",
    bakeTarget: optionalString(args.bakeTarget) ?? "material-texture",
  });
  const decalNode = {
    id: nodeId,
    type: "decal" as const,
    name: optionalString(args.nodeName) ?? optionalString(args.name) ?? "Surface decal",
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: decalParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      decal: decalParameters,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? decalNode : node))
      : [...asset.nodes, decalNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-decal-preview`,
      "agent-decal-v1",
    ),
    modifiedAt: options.now,
  };
}

export interface CreationUiPanelRowSpec {
  readonly key: string;
  readonly text: string;
  readonly localX: number;
  readonly localY: number;
  readonly z: number;
  readonly size: number;
  readonly color?: string;
  readonly emissiveIntensity?: number;
}

export function creationUiPanelBasis(normal: CreationVec3): {
  readonly right: CreationVec3;
  readonly up: CreationVec3;
} {
  const worldUp = Math.abs(normal.y) > 0.95
    ? { x: 0, y: 0, z: 1 }
    : { x: 0, y: 1, z: 0 };
  const right = normalizeVec3(crossVec3(worldUp, normal), { x: 1, y: 0, z: 0 });
  return {
    right,
    up: normalizeVec3(crossVec3(normal, right), { x: 0, y: 1, z: 0 }),
  };
}

export function uiPanelWorldPosition(
  center: CreationVec3,
  basis: { readonly right: CreationVec3; readonly up: CreationVec3 },
  normal: CreationVec3,
  localX: number,
  localY: number,
  localZ: number,
): CreationVec3 {
  return addVec3(
    addVec3(center, scaleVec3(basis.right, localX)),
    addVec3(scaleVec3(basis.up, localY), scaleVec3(normal, localZ)),
  );
}

export function uiPanelRowText(value: unknown): string | undefined {
  const direct = optionalString(value);
  if (direct) return direct;
  const record = asRecord(value);
  return (
    optionalString(record?.text) ??
    optionalString(record?.label) ??
    optionalString(record?.name) ??
    optionalString(record?.value)
  );
}

export function parseCreationUiPanelRows(
  args: Record<string, unknown>,
  options: {
    readonly width: number;
    readonly height: number;
    readonly fontSize: number;
    readonly lineGap: number;
    readonly textColor: string;
  },
): readonly CreationUiPanelRowSpec[] {
  const rows: CreationUiPanelRowSpec[] = [];
  const usedKeys = new Set<string>();
  const fallbackX = -options.width * 0.42;
  const pushRow = (
    value: unknown,
    fallback: Partial<CreationUiPanelRowSpec>,
  ): void => {
    const text = uiPanelRowText(value);
    if (!text) return;
    const record = asRecord(value);
    const key = uniqueIdSegment(
      record?.key ?? record?.id ?? text,
      `row-${rows.length + 1}`,
      usedKeys,
    );
    rows.push({
      key,
      text,
      localX:
        optionalNumber(record?.localX) ??
        optionalNumber(record?.x) ??
        fallback.localX ??
        fallbackX,
      localY:
        optionalNumber(record?.localY) ??
        optionalNumber(record?.y) ??
        fallback.localY ??
        options.height * 0.32 -
          rows.length * (options.fontSize + options.lineGap),
      z:
        optionalNumber(record?.localZ) ??
        optionalNumber(record?.z) ??
        fallback.z ??
        0.018,
      size:
        optionalNumber(record?.size) ??
        optionalNumber(record?.fontSize) ??
        fallback.size ??
        options.fontSize,
      color:
        optionalString(record?.color) ??
        optionalString(record?.textColor) ??
        fallback.color ??
        options.textColor,
      emissiveIntensity:
        optionalNumber(record?.emissiveIntensity) ??
        fallback.emissiveIntensity,
    });
  };

  pushRow(args.title, {
    localY: options.height * 0.32,
    size: options.fontSize * 1.18,
    color: optionalString(args.titleColor) ?? options.textColor,
    emissiveIntensity: optionalNumber(args.titleEmissiveIntensity),
  });
  pushRow(args.subtitle, {
    localY: options.height * 0.18,
    size: options.fontSize * 0.78,
    color: optionalString(args.subtitleColor) ?? optionalString(args.mutedTextColor) ?? options.textColor,
  });

  const contentEntries = [
    ...(Array.isArray(args.rows) ? args.rows : []),
    ...(Array.isArray(args.items) ? args.items : []),
    ...(Array.isArray(args.texts) ? args.texts : []),
    ...(Array.isArray(args.panelTexts) ? args.panelTexts : []),
  ];
  for (const entry of contentEntries) {
    pushRow(entry, {});
  }
  if (contentEntries.length === 0) {
    pushRow(args.text ?? args.label, {});
  }

  return rows;
}

export function updateCreationAssetUiPanel(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  options: {
    readonly targetObjects: readonly CreationSceneObject[];
    readonly normal: CreationVec3;
    readonly offset: number;
    readonly width: number;
    readonly height: number;
    readonly rowObjectIds: readonly string[];
    readonly rowAssetIds: readonly string[];
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-ui-panel`;
  const sourceNode = asset.nodes.find(
    (node) => node.type === "primitive" || node.type === "cache",
  );
  const panelParameters = compactCreationParameters({
    source: "agent-ui-panel",
    style: optionalString(args.style) ?? "screen",
    layout: optionalString(args.layout) ?? "stack",
    interaction: optionalString(args.interaction) ?? "display",
    targetObjectIds: options.targetObjects.map((object) => object.id),
    targetPartIds: options.targetObjects.map((object) => object.partId).filter(Boolean),
    normal: options.normal,
    offset: options.offset,
    width: options.width,
    height: options.height,
    rowObjectIds: options.rowObjectIds,
    rowAssetIds: options.rowAssetIds,
    title: optionalString(args.title),
    subtitle: optionalString(args.subtitle),
    mapAssetId: optionalString(args.mapAssetId),
    backgroundColor:
      optionalString(args.backgroundColor) ??
      optionalString(args.tint) ??
      optionalString(args.color) ??
      "#020617",
    textColor: optionalString(args.textColor) ?? "#e0f2fe",
    opacity: optionalNumber(args.opacity) ?? 0.86,
    editable: args.editable !== false,
    bakeTarget: optionalString(args.bakeTarget) ?? "ui-texture-atlas",
  });
  const panelNode = {
    id: nodeId,
    type: "decal" as const,
    name: optionalString(args.nodeName) ?? optionalString(args.name) ?? "3D UI panel",
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: panelParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      uiPanel: panelParameters,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? panelNode : node))
      : [...asset.nodes, panelNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-ui-panel-preview`,
      "agent-ui-panel-v1",
    ),
    modifiedAt: options.now,
  };
}

export function updateCreationAssetUiPanelText(
  asset: CreationAssetRecipe,
  options: {
    readonly panelObjectId: string;
    readonly panelAssetId: string;
    readonly row: CreationUiPanelRowSpec;
    readonly now: number;
  },
): CreationAssetRecipe {
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      uiPanelText: {
        source: "agent-ui-panel-text",
        panelObjectId: options.panelObjectId,
        panelAssetId: options.panelAssetId,
        rowKey: options.row.key,
        text: options.row.text,
        localX: options.row.localX,
        localY: options.row.localY,
        localZ: options.row.z,
        size: options.row.size,
        color: options.row.color,
      },
    }),
    modifiedAt: options.now,
  };
}

export type CreationScatterPattern = "grid" | "line" | "ring" | "random";

export interface CreationScatterInstance {
  readonly object: CreationSceneObject;
  readonly renderObjectId: string;
  readonly transform: Transform3D;
}

export function creationScatterPattern(value: unknown): CreationScatterPattern {
  const pattern = optionalString(value);
  if (
    pattern === "grid" ||
    pattern === "line" ||
    pattern === "ring" ||
    pattern === "random"
  ) {
    return pattern;
  }
  return "grid";
}

export function resolveCreationScatterSource(
  scene: CreationScene,
  args: Record<string, unknown>,
): CreationSceneObject | string {
  const reference =
    optionalString(args.sourceObjectId) ??
    optionalString(args.sourcePartId) ??
    optionalString(args.sourcePart) ??
    optionalString(args.sourceObject) ??
    optionalString(args.objectId) ??
    optionalString(args.partId);
  if (!reference) {
    return "Provide sourceObjectId or sourcePartId for scatter_creation_objects";
  }
  return (
    findCreationSceneObjectByReference(scene, reference) ??
    `Creation source object not found: ${reference}`
  );
}

export function uniqueCreationEntityId(
  prefix: string,
  segment: string,
  used: Set<string>,
): string {
  const base = `${prefix}-${segment}`;
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

export function scatterPlaneOffset(
  plane: string | undefined,
  a: number,
  b: number,
  c: number,
): CreationVec3 {
  if (plane === "xy") return { x: a, y: b, z: c };
  if (plane === "yz") return { x: c, y: a, z: b };
  return { x: a, y: c, z: b };
}

export function creationScatterOffset(
  pattern: CreationScatterPattern,
  index: number,
  count: number,
  args: Record<string, unknown>,
  random: () => number,
): CreationVec3 {
  const plane = optionalString(args.plane) ?? "xz";
  if (pattern === "line") {
    const spacing = optionalNumber(args.spacing) ?? optionalNumber(args.spacingX) ?? 0.5;
    const centered = index - (count - 1) / 2;
    const axis = optionalString(args.axis) ?? "x";
    if (axis === "y") return { x: 0, y: centered * spacing, z: 0 };
    if (axis === "z") return { x: 0, y: 0, z: centered * spacing };
    return { x: centered * spacing, y: 0, z: 0 };
  }

  if (pattern === "ring") {
    const radius = Math.max(0, optionalNumber(args.radius) ?? 1);
    const arc = optionalNumber(args.arcDegrees) ?? optionalNumber(args.arc) ?? 360;
    const startAngle = optionalNumber(args.startAngle) ?? 0;
    const denom = Math.max(1, arc >= 360 ? count : count - 1);
    const angle = ((startAngle + (arc * index) / denom) * Math.PI) / 180;
    return scatterPlaneOffset(plane, Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  }

  if (pattern === "random") {
    const width = Math.max(0, optionalNumber(args.areaWidth) ?? optionalNumber(args.width) ?? 2);
    const depth = Math.max(0, optionalNumber(args.areaDepth) ?? optionalNumber(args.depth) ?? 2);
    const height = Math.max(0, optionalNumber(args.areaHeight) ?? optionalNumber(args.height) ?? 0);
    return scatterPlaneOffset(
      plane,
      (random() - 0.5) * width,
      (random() - 0.5) * depth,
      height > 0 ? (random() - 0.5) * height : 0,
    );
  }

  const columns = Math.max(
    1,
    Math.floor(optionalNumber(args.columns) ?? Math.ceil(Math.sqrt(count))),
  );
  const spacingX = optionalNumber(args.spacingX) ?? optionalNumber(args.spacing) ?? 0.5;
  const spacingZ = optionalNumber(args.spacingZ) ?? optionalNumber(args.spacingY) ?? spacingX;
  const col = index % columns;
  const row = Math.floor(index / columns);
  const rows = Math.max(1, Math.ceil(count / columns));
  return scatterPlaneOffset(
    plane,
    (col - (Math.min(columns, count) - 1) / 2) * spacingX,
    (row - (rows - 1) / 2) * spacingZ,
    0,
  );
}

export function buildCreationScatterInstances(
  scene: CreationScene,
  source: CreationSceneObject,
  args: Record<string, unknown>,
): {
  readonly groupId: string;
  readonly pattern: CreationScatterPattern;
  readonly seed: string;
  readonly instances: readonly CreationScatterInstance[];
} | string {
  const count = Math.max(1, Math.min(500, Math.floor(optionalNumber(args.count) ?? 6)));
  const sceneKey = idSegment(scene.id, "scene");
  const key = idSegment(
    args.key ?? args.groupId ?? source.partId ?? source.name,
    `${idSegment(source.partId ?? source.id, "object")}-scatter`,
  );
  const groupId = optionalString(args.groupId) ?? `scatter-${sceneKey}-${key}`;
  const pattern = creationScatterPattern(args.pattern ?? args.mode);
  const seed = optionalString(args.seed) ?? `${scene.id}-${source.id}-${groupId}`;
  const random = createSeededRandom(seed);
  const usedObjectIds = new Set(scene.objects.map((object) => object.id));
  const usedRenderIds = new Set(
    scene.renderBindings.flatMap((binding) =>
      binding.objectBindings.map((objectBinding) => objectBinding.renderObjectId),
    ),
  );
  const parent = resolveCreationParentId(scene, args.parentId, args.parentKey);
  if (!parent.ok) return parent.error;
  const origin = vec3FromArgs(
    args.position,
    source.transform.position,
    ["x", "y", "z"],
    args,
  );
  const positionJitter = optionalNumber(args.jitter) ?? 0;
  const jitterX = optionalNumber(args.jitterX) ?? positionJitter;
  const jitterY = optionalNumber(args.jitterY) ?? 0;
  const jitterZ = optionalNumber(args.jitterZ) ?? positionJitter;
  const scaleJitter = Math.max(0, optionalNumber(args.scaleJitter) ?? 0);
  const baseScale = Math.max(0.001, optionalNumber(args.scale) ?? 1);
  const rotationJitterX = optionalNumber(args.rotationJitterX) ?? 0;
  const rotationJitterY =
    optionalNumber(args.rotationJitterY) ??
    optionalNumber(args.rotationJitter) ??
    0;
  const rotationJitterZ = optionalNumber(args.rotationJitterZ) ?? 0;
  const rotateStep = optionalNumber(args.rotateStep) ?? 0;
  const startIndex = Math.max(0, Math.floor(optionalNumber(args.startIndex) ?? 1));
  const namePrefix = optionalString(args.namePrefix) ?? `${source.name} copy`;
  const partPrefix = idSegment(
    args.partIdPrefix ?? args.partPrefix ?? args.key ?? source.partId ?? source.name,
    key,
  );
  const renderPrefix = `obj-${sceneKey}`;
  const objectPrefix = `object-${sceneKey}`;
  const instances: CreationScatterInstance[] = [];
  for (let index = 0; index < count; index += 1) {
    const displayIndex = startIndex + index;
    const segment = idSegment(`${key}-${displayIndex}`, `${key}-${displayIndex}`);
    const objectId = uniqueCreationEntityId(objectPrefix, segment, usedObjectIds);
    const renderObjectId = uniqueCreationEntityId(renderPrefix, segment, usedRenderIds);
    const offset = creationScatterOffset(pattern, index, count, args, random);
    const position = addVec3(origin, {
      x: offset.x + randomSigned(random, jitterX),
      y: offset.y + randomSigned(random, jitterY),
      z: offset.z + randomSigned(random, jitterZ),
    });
    const scaleFactor = baseScale * (1 + randomSigned(random, scaleJitter));
    const transform: Transform3D = {
      position,
      rotation: {
        x: source.transform.rotation.x + randomSigned(random, rotationJitterX),
        y:
          source.transform.rotation.y +
          rotateStep * index +
          randomSigned(random, rotationJitterY),
        z: source.transform.rotation.z + randomSigned(random, rotationJitterZ),
      },
      scale: {
        x: source.transform.scale.x * scaleFactor,
        y: source.transform.scale.y * scaleFactor,
        z: source.transform.scale.z * scaleFactor,
      },
    };
    const instanceObject: CreationSceneObject = {
      id: objectId,
      name: `${namePrefix} ${displayIndex}`,
      assetId: source.assetId,
      materialId: source.materialId,
      partId: `${partPrefix}-${displayIndex}`,
      parentId: parent.parentId ?? source.parentId,
      transform,
      visible: args.visible !== false,
      selectable: args.selectable !== false,
      tags: [
        ...new Set([
          "agent-created",
          "scatter",
          "scatter-instance",
          pattern,
          ...source.tags.filter((tag) => tag !== "agent-created"),
          ...(parseStringArray(args.tags) ?? []),
        ]),
      ],
    };
    instances.push({ object: instanceObject, renderObjectId, transform });
  }
  return { groupId, pattern, seed, instances };
}

export function updateCreationAssetScatterGroup(
  asset: CreationAssetRecipe,
  source: CreationSceneObject,
  args: Record<string, unknown>,
  options: {
    readonly groupId: string;
    readonly pattern: CreationScatterPattern;
    readonly seed: string;
    readonly instances: readonly CreationScatterInstance[];
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-${idSegment(options.groupId, "scatter")}`;
  const geometryNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part" ||
      node.type === "curve" ||
      node.type === "deform",
  );
  const scatterParameters = compactCreationParameters({
    source: "agent-scatter",
    groupId: options.groupId,
    sourceObjectId: source.id,
    sourcePartId: source.partId,
    pattern: options.pattern,
    seed: options.seed,
    count: options.instances.length,
    instanceObjectIds: options.instances.map((instance) => instance.object.id),
    instancePartIds: options.instances.map((instance) => instance.object.partId).filter(Boolean),
    instanceRenderObjectIds: options.instances.map((instance) => instance.renderObjectId),
    transforms: options.instances.map((instance) => instance.transform),
    plane: optionalString(args.plane),
    spacing: optionalNumber(args.spacing),
    spacingX: optionalNumber(args.spacingX),
    spacingY: optionalNumber(args.spacingY),
    spacingZ: optionalNumber(args.spacingZ),
    radius: optionalNumber(args.radius),
    areaWidth: optionalNumber(args.areaWidth) ?? optionalNumber(args.width),
    areaDepth: optionalNumber(args.areaDepth) ?? optionalNumber(args.depth),
    jitter: optionalNumber(args.jitter),
    scaleJitter: optionalNumber(args.scaleJitter),
  });
  const scatterNode = {
    id: nodeId,
    type: "scatter" as const,
    name: optionalString(args.nodeName) ?? optionalString(args.name) ?? "Scatter instances",
    inputs: geometryNode ? [geometryNode.id] : [],
    parameters: scatterParameters,
  };
  const previousGroups = asRecord(asset.parameters.scatterGroups) ?? {};
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      scatterGroups: {
        ...previousGroups,
        [options.groupId]: scatterParameters,
      },
      scatterGroup: scatterParameters,
    }),
    nodes: asset.nodes.some((node) => node.id === nodeId)
      ? asset.nodes.map((node) => (node.id === nodeId ? scatterNode : node))
      : [...asset.nodes, scatterNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-${idSegment(options.groupId, "scatter")}-preview`,
      "agent-scatter-v1",
    ),
    modifiedAt: options.now,
  };
}

export function creationAnimationEasing(
  value: unknown,
): CreationAnimationKeyframe["easing"] {
  const easing = optionalString(value);
  return easing && CREATION_ANIMATION_EASINGS.has(easing)
    ? (easing as CreationAnimationKeyframe["easing"])
    : "ease";
}

export function creationVectorKeyframes(
  entries: unknown,
  fallback: CreationVec3,
): CreationAnimationKeyframe<CreationVec3>[] {
  if (!Array.isArray(entries)) return [];
  const keyframes: CreationAnimationKeyframe<CreationVec3>[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    const time = optionalNumber(record.time);
    if (time === undefined) continue;
    const x = optionalNumber(record.x);
    const y = optionalNumber(record.y);
    const z = optionalNumber(record.z);
    if (x === undefined && y === undefined && z === undefined) continue;
    keyframes.push({
      time: Math.max(0, time),
      value: {
        x: x ?? fallback.x,
        y: y ?? fallback.y,
        z: z ?? fallback.z,
      },
      easing: creationAnimationEasing(record.easing),
    });
  }
  return keyframes.sort((a, b) => a.time - b.time);
}

export function creationScalarKeyframes(
  entries: unknown,
): CreationAnimationKeyframe<number>[] {
  if (!Array.isArray(entries)) return [];
  const keyframes: CreationAnimationKeyframe<number>[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    const time = optionalNumber(record.time);
    const value = optionalNumber(record.value);
    if (time === undefined || value === undefined) continue;
    keyframes.push({
      time: Math.max(0, time),
      value,
      easing: creationAnimationEasing(record.easing),
    });
  }
  return keyframes.sort((a, b) => a.time - b.time);
}

export function creationScalarKeyframesFromKeys(
  entries: unknown,
  valueKeys: readonly string[],
): CreationAnimationKeyframe<number>[] {
  if (!Array.isArray(entries)) return [];
  const keyframes: CreationAnimationKeyframe<number>[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    const time = optionalNumber(record.time);
    if (time === undefined) continue;
    let value: number | undefined;
    for (const key of valueKeys) {
      value = optionalNumber(record[key]);
      if (value !== undefined) break;
    }
    if (value === undefined) continue;
    keyframes.push({
      time: Math.max(0, time),
      value,
      easing: creationAnimationEasing(record.easing),
    });
  }
  return keyframes.sort((a, b) => a.time - b.time);
}

export function maxCreationKeyframeTime(
  tracks: readonly CreationAnimationTrack[],
): number {
  let maxTime = 0;
  for (const track of tracks) {
    for (const keyframe of track.keyframes) {
      maxTime = Math.max(maxTime, keyframe.time);
    }
  }
  return maxTime;
}

export function buildCreationObjectAnimationTracks(
  args: Record<string, unknown>,
  object: CreationSceneObject,
  clipId: string,
): {
  readonly tracks: CreationAnimationTrack[];
  readonly channels: ReadonlySet<CreationObjectAnimationChannel>;
} {
  const tracks: CreationAnimationTrack[] = [];
  const channels = new Set<CreationObjectAnimationChannel>();
  const vectorChannels: readonly CreationVectorChannel[] = [
    "position",
    "rotation",
    "scale",
  ];
  for (const channel of vectorChannels) {
    const keyframes = creationVectorKeyframes(args[channel], object.transform[channel]);
    if (keyframes.length === 0) continue;
    channels.add(channel);
    tracks.push({
      id: `${clipId}-${object.id}-${channel}`,
      targetId: object.id,
      channel,
      keyframes,
    });
  }
  const opacity = creationScalarKeyframes(args.opacity);
  if (opacity.length > 0) {
    channels.add("opacity");
    tracks.push({
      id: `${clipId}-${object.id}-opacity`,
      targetId: object.id,
      channel: "opacity",
      keyframes: opacity,
    });
  }
  return { tracks, channels };
}

export function clothWaveAxis(value: unknown): "x" | "y" | "z" {
  const axis = optionalString(value);
  return axis === "x" || axis === "y" || axis === "z" ? axis : "z";
}

export function buildCreationClothWaveTracks(
  args: Record<string, unknown>,
  object: CreationSceneObject,
  clipId: string,
): {
  readonly tracks: CreationAnimationTrack[];
  readonly channels: ReadonlySet<CreationObjectAnimationChannel>;
  readonly sampleCount: number;
} {
  const startTime = Math.max(0, optionalNumber(args.startTime) ?? 0);
  const duration = Math.max(0.1, optionalNumber(args.duration) ?? 2.4);
  const endTime = startTime + duration;
  const cycles = Math.max(0.25, optionalNumber(args.cycles) ?? optionalNumber(args.frequency) ?? 2);
  const sampleCount = Math.round(
    clampNumber(optionalNumber(args.samples) ?? optionalNumber(args.sampleCount) ?? cycles * 6 + 1, 3, 72),
  );
  const axis = clothWaveAxis(args.axis);
  const amplitude = optionalNumber(args.amplitudeDegrees) ?? optionalNumber(args.amplitude) ?? 7;
  const phase = optionalNumber(args.phase) ?? 0;
  const easing = creationAnimationEasing(args.easing);
  const keyframes: CreationAnimationKeyframe<CreationVec3>[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const angle = Math.sin(t * cycles * Math.PI * 2 + phase) * amplitude;
    keyframes.push({
      time: startTime + (endTime - startTime) * t,
      value: {
        x: object.transform.rotation.x + (axis === "x" ? angle : 0),
        y: object.transform.rotation.y + (axis === "y" ? angle : 0),
        z: object.transform.rotation.z + (axis === "z" ? angle : 0),
      },
      easing,
    });
  }
  return {
    tracks: [
      {
        id: `${clipId}-${object.id}-cloth-wave-rotation`,
        targetId: object.id,
        channel: "rotation",
        keyframes,
      },
    ],
    channels: new Set(["rotation"]),
    sampleCount,
  };
}

export function updateCreationAssetClothWave(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  clipId: string,
  now: number,
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const clothNodeId = `node-${assetKey}-cloth-wave`;
  const geometryNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part" ||
      node.type === "curve",
  );
  const clothParameters = compactCreationParameters({
    source: "agent-procedural-cloth-wave",
    clipId,
    solver: "procedural-transform-preview",
    pinnedEdge: optionalString(args.pinnedEdge) ?? "left",
    windStrength: optionalNumber(args.windStrength) ?? 0.55,
    frequency: optionalNumber(args.frequency) ?? optionalNumber(args.cycles) ?? 2,
    amplitudeDegrees: optionalNumber(args.amplitudeDegrees) ?? optionalNumber(args.amplitude) ?? 7,
    axis: clothWaveAxis(args.axis),
    phase: optionalNumber(args.phase) ?? 0,
  });
  const clothNode = {
    id: clothNodeId,
    type: "cloth" as const,
    name: optionalString(args.nodeName) ?? "Procedural cloth wave",
    inputs: geometryNode ? [geometryNode.id] : [],
    parameters: clothParameters,
  };
  return {
    ...asset,
    parameters: {
      ...asset.parameters,
      clothWave: clothParameters,
    },
    nodes: asset.nodes.some((node) => node.id === clothNodeId)
      ? asset.nodes.map((node) => (node.id === clothNodeId ? clothNode : node))
      : [...asset.nodes, clothNode],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-cloth-preview`,
      "agent-procedural-cloth-wave-v1",
    ),
    modifiedAt: now,
  };
}

export function lightSweepDirection(
  args: Record<string, unknown>,
  basis: { readonly right: CreationVec3; readonly up: CreationVec3 },
): CreationVec3 {
  const direction = optionalString(args.direction ?? args.sweepDirection);
  if (direction === "vertical" || direction === "y") return basis.up;
  if (direction === "diagonal" || direction === "diag") {
    return normalizeVec3(addVec3(basis.right, basis.up), basis.right);
  }
  if (direction === "diagonal-down") {
    return normalizeVec3(addVec3(basis.right, scaleVec3(basis.up, -1)), basis.right);
  }
  return basis.right;
}

export function buildCreationLightSweepTracks(
  args: Record<string, unknown>,
  object: CreationSceneObject,
  clipId: string,
  options: {
    readonly startPosition: CreationVec3;
    readonly endPosition: CreationVec3;
    readonly maxOpacity: number;
  },
): {
  readonly tracks: CreationAnimationTrack[];
  readonly channels: ReadonlySet<CreationObjectAnimationChannel>;
  readonly startTime: number;
  readonly endTime: number;
  readonly fadeDuration: number;
} {
  const startTime = Math.max(0, optionalNumber(args.startTime) ?? 0.35);
  const duration = Math.max(0.05, optionalNumber(args.duration) ?? 1.15);
  const endTime = startTime + duration;
  const fadeDuration = Math.max(
    0,
    Math.min(duration / 2, optionalNumber(args.fadeDuration) ?? Math.min(0.18, duration * 0.22)),
  );
  const easing = creationAnimationEasing(args.easing ?? "ease-in-out");
  const positionKeyframes: CreationAnimationKeyframe<CreationVec3>[] = [
    { time: startTime, value: options.startPosition, easing },
    { time: endTime, value: options.endPosition, easing },
  ];
  const opacityKeyframes: CreationAnimationKeyframe<number>[] = [
    { time: startTime, value: 0, easing: "ease-out" },
    {
      time: startTime + fadeDuration,
      value: options.maxOpacity,
      easing: "ease-out",
    },
    {
      time: Math.max(startTime + fadeDuration, endTime - fadeDuration),
      value: options.maxOpacity,
      easing: "ease-in",
    },
    { time: endTime, value: 0, easing: "ease-in" },
  ];
  return {
    tracks: [
      {
        id: `${clipId}-${object.id}-light-sweep-position`,
        targetId: object.id,
        channel: "position",
        keyframes: positionKeyframes,
      },
      {
        id: `${clipId}-${object.id}-light-sweep-opacity`,
        targetId: object.id,
        channel: "opacity",
        keyframes: opacityKeyframes,
      },
    ],
    channels: new Set(["position", "opacity"]),
    startTime,
    endTime,
    fadeDuration,
  };
}

export function updateCreationAssetLightSweep(
  asset: CreationAssetRecipe,
  args: Record<string, unknown>,
  options: {
    readonly clipId: string;
    readonly targetObjects: readonly CreationSceneObject[];
    readonly normal: CreationVec3;
    readonly startPosition: CreationVec3;
    readonly endPosition: CreationVec3;
    readonly width: number;
    readonly height: number;
    readonly travelDistance: number;
    readonly maxOpacity: number;
    readonly startTime: number;
    readonly endTime: number;
    readonly fadeDuration: number;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-light-sweep`;
  const sourceNode = asset.nodes.find(
    (node) => node.type === "primitive" || node.type === "cache",
  );
  const lightSweepParameters = compactCreationParameters({
    source: "agent-light-sweep",
    clipId: options.clipId,
    targetObjectIds: options.targetObjects.map((target) => target.id),
    targetPartIds: options.targetObjects.map((target) => target.partId).filter(Boolean),
    normal: options.normal,
    startPosition: options.startPosition,
    endPosition: options.endPosition,
    width: options.width,
    height: options.height,
    travelDistance: options.travelDistance,
    maxOpacity: options.maxOpacity,
    startTime: options.startTime,
    endTime: options.endTime,
    fadeDuration: options.fadeDuration,
    color:
      optionalString(args.color) ??
      optionalString(args.tint) ??
      optionalString(args.emissive) ??
      "#ffffff",
    blend: optionalString(args.blend) ?? "additive-preview",
    bakeTarget: optionalString(args.bakeTarget) ?? "animated-highlight-texture",
  });
  const node = {
    id: nodeId,
    type: "decal" as const,
    name: optionalString(args.nodeName) ?? "Animated light sweep",
    inputs: sourceNode ? [sourceNode.id] : [],
    parameters: lightSweepParameters,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      lightSweep: lightSweepParameters,
    }),
    nodes: asset.nodes.some((candidate) => candidate.id === nodeId)
      ? asset.nodes.map((candidate) => (candidate.id === nodeId ? node : candidate))
      : [...asset.nodes, node],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-light-sweep-preview`,
      "agent-light-sweep-v1",
    ),
    modifiedAt: options.now,
  };
}

export function creationExplodedViewAxis(value: unknown): CreationExplodedViewAxis {
  const axis = optionalString(value);
  if (axis === "x" || axis === "horizontal") return "x";
  if (axis === "y" || axis === "vertical") return "y";
  if (axis === "z" || axis === "depth") return "z";
  return "radial";
}

export function findCreationSceneObjectByReference(
  scene: CreationScene,
  reference: string,
): CreationSceneObject | undefined {
  const normalized = idSegment(reference, reference);
  return scene.objects.find(
    (object) =>
      object.id === reference ||
      object.partId === reference ||
      object.partId === normalized ||
      idSegment(object.name, object.id) === normalized,
  );
}

export function resolveCreationExplodedViewObjects(
  scene: CreationScene,
  args: Record<string, unknown>,
): readonly CreationSceneObject[] | string {
  const selected: CreationSceneObject[] = [];
  const seen = new Set<string>();
  const push = (object: CreationSceneObject): void => {
    if (seen.has(object.id)) return;
    seen.add(object.id);
    selected.push(object);
  };

  const objectRefs = parseStringArray(args.objectIds ?? args.objects);
  if (objectRefs) {
    for (const reference of objectRefs) {
      const object = findCreationSceneObjectByReference(scene, reference);
      if (!object) return `Creation object not found: ${reference}`;
      push(object);
    }
  }

  const partRefs = parseStringArray(args.partIds ?? args.parts);
  if (partRefs) {
    for (const reference of partRefs) {
      const normalized = idSegment(reference, reference);
      const matches = scene.objects.filter(
        (object) =>
          object.partId === reference ||
          object.partId === normalized ||
          object.id === reference ||
          idSegment(object.name, object.id) === normalized,
      );
      if (matches.length === 0) return `Creation part/object not found: ${reference}`;
      for (const object of matches) push(object);
    }
  }

  const includeTags = parseStringArray(args.tags ?? args.includeTags);
  if (includeTags) {
    for (const object of scene.objects) {
      if (object.tags.some((tag) => includeTags.includes(tag))) push(object);
    }
  }

  if (selected.length > 0) return selected;

  const excludeTags = parseStringArray(args.excludeTags) ?? ["callout"];
  const defaultObjects = scene.objects.filter(
    (object) =>
      object.visible &&
      object.selectable &&
      !object.tags.some((tag) => excludeTags.includes(tag)),
  );
  return defaultObjects.length > 0
    ? defaultObjects
    : "No visible selectable creation objects found for exploded-view animation";
}

export function explodedDirectionForObject(
  axis: CreationExplodedViewAxis,
  object: CreationSceneObject,
  origin: CreationVec3,
  index: number,
  total: number,
): CreationVec3 {
  if (axis === "x") return { x: 1, y: 0, z: 0 };
  if (axis === "y") return { x: 0, y: 1, z: 0 };
  if (axis === "z") return { x: 0, y: 0, z: 1 };
  const angle = (index / Math.max(1, total)) * Math.PI * 2;
  const fallback = normalizeVec3(
    { x: Math.cos(angle), y: index % 2 === 0 ? 0.12 : -0.12, z: Math.sin(angle) },
    { x: 0, y: 0, z: 1 },
  );
  return normalizeVec3(subtractVec3(object.transform.position, origin), fallback);
}

export function buildCreationExplodedViewTracks(
  args: Record<string, unknown>,
  objects: readonly CreationSceneObject[],
  clipId: string,
): {
  readonly tracks: CreationAnimationTrack[];
  readonly motions: readonly CreationExplodedViewObjectMotion[];
  readonly axis: CreationExplodedViewAxis;
  readonly origin: CreationVec3;
  readonly distance: number;
  readonly spacing: number;
  readonly duration: number;
  readonly returnToAssembled: boolean;
} {
  const axis = creationExplodedViewAxis(args.axis ?? args.mode);
  const distance = Math.max(
    0,
    optionalNumber(args.distance) ?? optionalNumber(args.amount) ?? 1.2,
  );
  const spacing = Math.max(0, optionalNumber(args.spacing) ?? 0);
  const startTime = Math.max(0, optionalNumber(args.startTime) ?? 0.6);
  const explicitEndTime = optionalNumber(args.endTime);
  const explodeDuration = Math.max(
    0.05,
    explicitEndTime !== undefined
      ? explicitEndTime - startTime
      : optionalNumber(args.explodeDuration) ?? optionalNumber(args.duration) ?? 1.15,
  );
  const stagger = Math.max(0, optionalNumber(args.stagger) ?? 0.04);
  const returnToAssembled =
    args.returnToAssembled === true ||
    args.reassemble === true ||
    args.return === true;
  const holdTime = Math.max(
    0,
    optionalNumber(args.holdTime) ?? (returnToAssembled ? 0.7 : 0),
  );
  const returnDuration = Math.max(
    0.05,
    optionalNumber(args.returnDuration) ?? explodeDuration * 0.8,
  );
  const easing = creationAnimationEasing(args.easing ?? "ease-out");
  const returnEasing = creationAnimationEasing(args.returnEasing ?? "ease-in-out");
  const origin = vec3FromArgs(
    args.origin,
    averageCreationObjectPosition(objects),
    ["originX", "originY", "originZ"],
    args,
  );
  const motions: CreationExplodedViewObjectMotion[] = [];
  const tracks: CreationAnimationTrack[] = [];

  objects.forEach((object, index) => {
    const direction = explodedDirectionForObject(
      axis,
      object,
      origin,
      index,
      objects.length,
    );
    const magnitude = distance + spacing * index;
    const start = startTime + stagger * index;
    const end = start + explodeDuration;
    const basePosition = object.transform.position;
    const explodedPosition = addVec3(basePosition, scaleVec3(direction, magnitude));
    const keyframes: CreationAnimationKeyframe<CreationVec3>[] = [
      { time: start, value: basePosition, easing },
      { time: end, value: explodedPosition, easing },
    ];
    let returnTime: number | undefined;
    if (returnToAssembled) {
      const holdEnd = end + holdTime;
      returnTime = holdEnd + returnDuration;
      keyframes.push(
        { time: holdEnd, value: explodedPosition, easing: returnEasing },
        { time: returnTime, value: basePosition, easing: returnEasing },
      );
    }
    motions.push({
      object,
      direction,
      basePosition,
      explodedPosition,
      startTime: start,
      endTime: end,
      returnTime,
    });
    tracks.push({
      id: `${clipId}-${object.id}-exploded-position`,
      targetId: object.id,
      channel: "position",
      keyframes,
    });
  });

  const duration = Math.max(
    optionalNumber(args.clipDuration) ?? optionalNumber(args.totalDuration) ?? 0,
    maxCreationKeyframeTime(tracks),
  );
  return {
    tracks,
    motions,
    axis,
    origin,
    distance,
    spacing,
    duration,
    returnToAssembled,
  };
}

export function mergeCreationObjectAnimationClipForTargets(
  existing: CreationAnimationClip | undefined,
  targetIds: ReadonlySet<string>,
  nextTracks: readonly CreationAnimationTrack[],
  replacedChannels: ReadonlySet<CreationObjectAnimationChannel>,
  options: {
    readonly clipId: string;
    readonly name?: string;
    readonly duration: number;
  },
): CreationAnimationClip {
  const preservedTracks =
    existing?.tracks.filter(
      (track) =>
        !targetIds.has(track.targetId) ||
        !replacedChannels.has(track.channel as CreationObjectAnimationChannel),
    ) ?? [];
  return {
    id: options.clipId,
    name: options.name ?? existing?.name ?? "Exploded view",
    duration: options.duration,
    tracks: [...preservedTracks, ...nextTracks],
  };
}

export function updateCreationAssetExplodedView(
  asset: CreationAssetRecipe,
  objects: readonly CreationSceneObject[],
  motionsByObjectId: ReadonlyMap<string, CreationExplodedViewObjectMotion>,
  options: {
    readonly args: Record<string, unknown>;
    readonly clipId: string;
    readonly axis: CreationExplodedViewAxis;
    readonly origin: CreationVec3;
    readonly distance: number;
    readonly spacing: number;
    readonly returnToAssembled: boolean;
    readonly now: number;
  },
): CreationAssetRecipe {
  const assetKey = idSegment(asset.id, "asset");
  const nodeId = `node-${assetKey}-exploded-view`;
  const geometryNode = asset.nodes.find(
    (node) =>
      node.type === "primitive" ||
      node.type === "cache" ||
      node.type === "product-part" ||
      node.type === "curve" ||
      node.type === "deform",
  );
  const overview = compactCreationParameters({
    source: "agent-exploded-view",
    clipId: options.clipId,
    axis: options.axis,
    origin: options.origin,
    distance: options.distance,
    spacing: options.spacing,
    objectIds: objects.map((object) => object.id),
    partIds: objects.map((object) => object.partId).filter(Boolean),
    returnToAssembled: options.returnToAssembled,
  });
  const previousByObject = asRecord(asset.parameters.explodedViewByObject) ?? {};
  const nextByObject: Record<string, unknown> = { ...previousByObject };
  for (const object of objects) {
    const motion = motionsByObjectId.get(object.id);
    if (!motion) continue;
    nextByObject[object.id] = compactCreationParameters({
      source: "agent-exploded-view",
      clipId: options.clipId,
      objectId: object.id,
      partId: object.partId,
      direction: motion.direction,
      basePosition: motion.basePosition,
      explodedPosition: motion.explodedPosition,
      startTime: motion.startTime,
      endTime: motion.endTime,
      returnTime: motion.returnTime,
    });
  }
  const node = {
    id: nodeId,
    type: "deform" as const,
    name: optionalString(options.args.nodeName) ?? "Exploded view offsets",
    inputs: geometryNode ? [geometryNode.id] : [],
    parameters: overview,
  };
  return {
    ...asset,
    parameters: compactCreationParameters({
      ...asset.parameters,
      explodedView: overview,
      explodedViewByObject: nextByObject,
    }),
    nodes: asset.nodes.some((candidate) => candidate.id === nodeId)
      ? asset.nodes.map((candidate) => (candidate.id === nodeId ? node : candidate))
      : [...asset.nodes, node],
    caches: dirtyCreationAssetCaches(
      asset,
      `cache-${assetKey}-exploded-preview`,
      "agent-exploded-view-v1",
    ),
    modifiedAt: options.now,
  };
}

export function creationAnimationTrackIdChannel(channel: string): string {
  return channel.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

export function mergeCreationObjectAnimationClip(
  existing: CreationAnimationClip | undefined,
  object: CreationSceneObject,
  nextTracks: readonly CreationAnimationTrack[],
  replacedChannels: ReadonlySet<CreationObjectAnimationChannel>,
  options: {
    readonly clipId: string;
    readonly name?: string;
    readonly duration: number;
  },
): CreationAnimationClip {
  const preservedTracks =
    existing?.tracks.filter(
      (track) =>
        track.targetId !== object.id ||
        !replacedChannels.has(track.channel as CreationObjectAnimationChannel),
    ) ?? [];
  return {
    id: options.clipId,
    name: options.name ?? existing?.name ?? `Animate ${object.name}`,
    duration: options.duration,
    tracks: [...preservedTracks, ...nextTracks],
  };
}

export function buildCreationCameraOrbitTracks(
  args: Record<string, unknown>,
  camera: CreationCamera,
  scene: CreationScene,
  clipId: string,
): {
  readonly tracks: CreationAnimationTrack[];
  readonly channels: ReadonlySet<CreationCameraAnimationChannel>;
} {
  const mode = optionalString(args.mode);
  const orbit = mode === "orbit" || args.orbit === true;
  const dolly = mode === "dolly";
  const zoom = mode === "zoom";
  if (!orbit && !dolly && !zoom) {
    return { tracks: [], channels: new Set() };
  }

  const tracks: CreationAnimationTrack[] = [];
  const channels = new Set<CreationCameraAnimationChannel>();
  const startTime = Math.max(0, optionalNumber(args.startTime) ?? 0);
  const endTime = Math.max(
    startTime,
    optionalNumber(args.endTime) ??
      optionalNumber(args.duration) ??
      scene.duration ??
      startTime + 1,
  );
  const easing = creationAnimationEasing(args.easing);
  const target = vec3FromArgs(
    args.orbitTarget,
    camera.target,
    ["targetX", "targetY", "targetZ"],
    args,
  );
  const endTarget = vec3FromArgs(
    args.endTarget,
    target,
    ["endTargetX", "endTargetY", "endTargetZ"],
    args,
  );

  if (orbit) {
    const dx = camera.position.x - target.x;
    const dz = camera.position.z - target.z;
    const defaultRadius = Math.hypot(dx, dz) || 6;
    const startAngle =
      optionalNumber(args.startAngle) ??
      optionalNumber(args.startAngleDeg) ??
      (Math.atan2(dz, dx) * 180) / Math.PI;
    const endAngle =
      optionalNumber(args.endAngle) ??
      optionalNumber(args.endAngleDeg) ??
      startAngle + (optionalNumber(args.orbitDegrees) ?? 180);
    const radiusStart =
      optionalNumber(args.radiusStart) ??
      optionalNumber(args.startRadius) ??
      optionalNumber(args.radius) ??
      defaultRadius;
    const radiusEnd =
      optionalNumber(args.radiusEnd) ??
      optionalNumber(args.endRadius) ??
      optionalNumber(args.radius) ??
      radiusStart;
    const heightStart =
      optionalNumber(args.heightStart) ??
      optionalNumber(args.startHeight) ??
      optionalNumber(args.height) ??
      camera.position.y;
    const heightEnd =
      optionalNumber(args.heightEnd) ??
      optionalNumber(args.endHeight) ??
      optionalNumber(args.height) ??
      heightStart;
    const sampleCount = Math.round(
      clampNumber(optionalNumber(args.samples) ?? optionalNumber(args.sampleCount) ?? 5, 2, 24),
    );
    const keyframes: CreationAnimationKeyframe<CreationVec3>[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
      const angle = ((startAngle + (endAngle - startAngle) * t) * Math.PI) / 180;
      const radius = radiusStart + (radiusEnd - radiusStart) * t;
      const height = heightStart + (heightEnd - heightStart) * t;
      keyframes.push({
        time: startTime + (endTime - startTime) * t,
        value: {
          x: target.x + Math.cos(angle) * radius,
          y: height,
          z: target.z + Math.sin(angle) * radius,
        },
        easing,
      });
    }
    tracks.push({
      id: `${clipId}-${camera.id}-camera-position`,
      targetId: camera.id,
      channel: "camera.position",
      keyframes,
    });
    channels.add("camera.position");
  } else if (dolly) {
    const startPosition = vec3FromArgs(
      args.startPosition,
      camera.position,
      ["startPosX", "startPosY", "startPosZ"],
      args,
    );
    const endPosition = vec3FromArgs(
      args.endPosition,
      camera.position,
      ["endPosX", "endPosY", "endPosZ"],
      args,
    );
    tracks.push({
      id: `${clipId}-${camera.id}-camera-position`,
      targetId: camera.id,
      channel: "camera.position",
      keyframes: [
        { time: startTime, value: startPosition, easing },
        { time: endTime, value: endPosition, easing },
      ],
    });
    channels.add("camera.position");
  }

  if (orbit || dolly) {
    tracks.push({
      id: `${clipId}-${camera.id}-camera-target`,
      targetId: camera.id,
      channel: "camera.target",
      keyframes: [
        { time: startTime, value: target, easing },
        { time: endTime, value: endTarget, easing },
      ],
    });
    channels.add("camera.target");
  }

  const fovStart =
    optionalNumber(args.fovStart) ??
    optionalNumber(args.startFov) ??
    (zoom ? camera.fov : undefined);
  const fovEnd =
    optionalNumber(args.fovEnd) ??
    optionalNumber(args.endFov) ??
    optionalNumber(args.fovTo) ??
    optionalNumber(args.fov);
  if (fovStart !== undefined || fovEnd !== undefined) {
    tracks.push({
      id: `${clipId}-${camera.id}-camera-fov`,
      targetId: camera.id,
      channel: "camera.fov",
      keyframes: [
        { time: startTime, value: fovStart ?? camera.fov, easing },
        { time: endTime, value: fovEnd ?? fovStart ?? camera.fov, easing },
      ],
    });
    channels.add("camera.fov");
  }

  const focusStart =
    optionalNumber(args.focusDistanceStart) ??
    optionalNumber(args.startFocusDistance) ??
    (zoom ? camera.focusDistance : undefined);
  const focusEnd =
    optionalNumber(args.focusDistanceEnd) ??
    optionalNumber(args.endFocusDistance) ??
    optionalNumber(args.focusDistanceTo) ??
    optionalNumber(args.focusDistance);
  if (focusStart !== undefined || focusEnd !== undefined) {
    tracks.push({
      id: `${clipId}-${camera.id}-camera-focus-distance`,
      targetId: camera.id,
      channel: "camera.focusDistance",
      keyframes: [
        { time: startTime, value: focusStart ?? camera.focusDistance ?? 1, easing },
        {
          time: endTime,
          value: focusEnd ?? focusStart ?? camera.focusDistance ?? 1,
          easing,
        },
      ],
    });
    channels.add("camera.focusDistance");
  }

  return { tracks, channels };
}

export function buildCreationCameraAnimationTracks(
  args: Record<string, unknown>,
  camera: CreationCamera,
  scene: CreationScene,
  clipId: string,
): {
  readonly tracks: CreationAnimationTrack[];
  readonly channels: ReadonlySet<CreationCameraAnimationChannel>;
} {
  const generated = buildCreationCameraOrbitTracks(args, camera, scene, clipId);
  const trackByChannel = new Map<CreationCameraAnimationChannel, CreationAnimationTrack>();
  const channels = new Set<CreationCameraAnimationChannel>();
  for (const track of generated.tracks) {
    const channel = track.channel as CreationCameraAnimationChannel;
    trackByChannel.set(channel, track);
    channels.add(channel);
  }

  const vectorInputs: readonly [CreationCameraVectorChannel, unknown, CreationVec3][] = [
    ["camera.position", args.position, camera.position],
    ["camera.target", args.target, camera.target],
  ];
  for (const [channel, value, fallback] of vectorInputs) {
    const keyframes = creationVectorKeyframes(value, fallback);
    if (keyframes.length === 0) continue;
    trackByChannel.set(channel, {
      id: `${clipId}-${camera.id}-${creationAnimationTrackIdChannel(channel)}`,
      targetId: camera.id,
      channel,
      keyframes,
    });
    channels.add(channel);
  }

  const scalarInputs: readonly [CreationCameraScalarChannel, unknown, readonly string[]][] = [
    ["camera.fov", args.fov, ["value", "fov"]],
    ["camera.focusDistance", args.focusDistance, ["value", "focusDistance"]],
  ];
  for (const [channel, value, valueKeys] of scalarInputs) {
    const keyframes = creationScalarKeyframesFromKeys(value, valueKeys);
    if (keyframes.length === 0) continue;
    trackByChannel.set(channel, {
      id: `${clipId}-${camera.id}-${creationAnimationTrackIdChannel(channel)}`,
      targetId: camera.id,
      channel,
      keyframes,
    });
    channels.add(channel);
  }

  return { tracks: [...trackByChannel.values()], channels };
}

export function mergeCreationCameraAnimationClip(
  existing: CreationAnimationClip | undefined,
  camera: CreationCamera,
  nextTracks: readonly CreationAnimationTrack[],
  replacedChannels: ReadonlySet<CreationCameraAnimationChannel>,
  options: {
    readonly clipId: string;
    readonly name?: string;
    readonly duration: number;
  },
): CreationAnimationClip {
  const preservedTracks =
    existing?.tracks.filter(
      (track) =>
        track.targetId !== camera.id ||
        !replacedChannels.has(track.channel as CreationCameraAnimationChannel),
    ) ?? [];
  return {
    id: options.clipId,
    name: options.name ?? existing?.name ?? `Animate ${camera.name}`,
    duration: options.duration,
    tracks: [...preservedTracks, ...nextTracks],
  };
}

export function motionKeyframesForCreationObjectTracks(
  renderObjectId: string,
  tracks: readonly CreationAnimationTrack[],
  idFactory: () => string,
): Keyframe[] {
  const keyframes: Keyframe[] = [];
  const prefix = `scene.object.${renderObjectId}`;
  for (const track of tracks) {
    if (
      track.channel === "position" ||
      track.channel === "rotation" ||
      track.channel === "scale"
    ) {
      for (const keyframe of track.keyframes as readonly CreationAnimationKeyframe<CreationVec3>[]) {
        keyframes.push(
          {
            id: idFactory(),
            time: keyframe.time,
            property: `${prefix}.${track.channel}.x`,
            value: keyframe.value.x,
            easing: keyframe.easing,
          },
          {
            id: idFactory(),
            time: keyframe.time,
            property: `${prefix}.${track.channel}.y`,
            value: keyframe.value.y,
            easing: keyframe.easing,
          },
          {
            id: idFactory(),
            time: keyframe.time,
            property: `${prefix}.${track.channel}.z`,
            value: keyframe.value.z,
            easing: keyframe.easing,
          },
        );
      }
    } else if (track.channel === "opacity") {
      for (const keyframe of track.keyframes as readonly CreationAnimationKeyframe<number>[]) {
        keyframes.push({
          id: idFactory(),
          time: keyframe.time,
          property: `${prefix}.opacity`,
          value: keyframe.value,
          easing: keyframe.easing,
        });
      }
    }
  }
  return keyframes;
}

export function motionKeyframesForCreationCameraTracks(
  tracks: readonly CreationAnimationTrack[],
  idFactory: () => string,
): Keyframe[] {
  const keyframes: Keyframe[] = [];
  for (const track of tracks) {
    if (track.channel === "camera.position" || track.channel === "camera.target") {
      const prefix =
        track.channel === "camera.position"
          ? "scene.camera.position"
          : "scene.camera.target";
      for (const keyframe of track.keyframes as readonly CreationAnimationKeyframe<CreationVec3>[]) {
        keyframes.push(
          {
            id: idFactory(),
            time: keyframe.time,
            property: `${prefix}.x`,
            value: keyframe.value.x,
            easing: keyframe.easing,
          },
          {
            id: idFactory(),
            time: keyframe.time,
            property: `${prefix}.y`,
            value: keyframe.value.y,
            easing: keyframe.easing,
          },
          {
            id: idFactory(),
            time: keyframe.time,
            property: `${prefix}.z`,
            value: keyframe.value.z,
            easing: keyframe.easing,
          },
        );
      }
    } else if (track.channel === "camera.fov") {
      for (const keyframe of track.keyframes as readonly CreationAnimationKeyframe<number>[]) {
        keyframes.push({
          id: idFactory(),
          time: keyframe.time,
          property: "scene.camera.fov",
          value: keyframe.value,
          easing: keyframe.easing,
        });
      }
    }
  }
  return keyframes;
}

export function updateScene3DLayerObjectAnimation(
  layer: MotionScene3DLayer,
  renderObjectId: string,
  tracks: readonly CreationAnimationTrack[],
): MotionScene3DLayer | string {
  const objects = layer.objects ?? [];
  if (!objects.some((object) => object.id === renderObjectId)) {
    return `Render object not found: ${renderObjectId}`;
  }
  const added = motionKeyframesForCreationObjectTracks(renderObjectId, tracks, genId);
  if (added.length === 0) {
    return "Provide position, rotation, scale, and/or opacity keyframes";
  }
  return {
    ...layer,
    keyframes: mergeSceneKeyframes(layer.keyframes, added),
  };
}

export function updateScene3DLayerObjectAnimations(
  layer: MotionScene3DLayer,
  renderObjectIdsByObjectId: ReadonlyMap<string, string>,
  tracks: readonly CreationAnimationTrack[],
): { readonly layer: MotionScene3DLayer; readonly renderKeyframeCount: number } | string {
  const objects = layer.objects ?? [];
  const objectIdSet = new Set(objects.map((object) => object.id));
  const added: Keyframe[] = [];
  const tracksByObjectId = new Map<string, CreationAnimationTrack[]>();
  for (const track of tracks) {
    const group = tracksByObjectId.get(track.targetId) ?? [];
    group.push(track);
    tracksByObjectId.set(track.targetId, group);
  }
  for (const [objectId, objectTracks] of tracksByObjectId) {
    const renderObjectId = renderObjectIdsByObjectId.get(objectId);
    if (!renderObjectId) return `Render binding not found for creation object: ${objectId}`;
    if (!objectIdSet.has(renderObjectId)) return `Render object not found: ${renderObjectId}`;
    added.push(
      ...motionKeyframesForCreationObjectTracks(renderObjectId, objectTracks, genId),
    );
  }
  if (added.length === 0) {
    return "Provide position, rotation, scale, and/or opacity keyframes";
  }
  return {
    layer: {
      ...layer,
      keyframes: mergeSceneKeyframes(layer.keyframes, added),
    },
    renderKeyframeCount: added.length,
  };
}

export function updateScene3DLayerCameraAnimation(
  layer: MotionScene3DLayer,
  camera: CreationCamera,
  tracks: readonly CreationAnimationTrack[],
): { readonly layer: MotionScene3DLayer; readonly renderKeyframeCount: number } {
  const added = motionKeyframesForCreationCameraTracks(tracks, genId);
  return {
    layer: {
      ...layer,
      fov: camera.fov,
      camera: {
        ...layer.camera,
        position: camera.position,
        target: camera.target,
        fov: camera.fov,
      },
      keyframes: mergeSceneKeyframes(layer.keyframes, added),
    },
    renderKeyframeCount: added.length,
  };
}

export function createProductCalloutLayer(
  args: Record<string, unknown>,
  composition: MotionComposition,
  scene: CreationScene,
  layerId: string,
): MotionTextLayer {
  const label = optionalString(args.label) ?? optionalString(args.text) ?? "Product detail";
  const offsetX = optionalNumber(args.offsetX) ?? optionalNumber(args.screenOffsetX) ?? 0;
  const offsetY = optionalNumber(args.offsetY) ?? optionalNumber(args.screenOffsetY) ?? 0;
  const x = optionalNumber(args.x) ?? composition.width / 2 + offsetX;
  const y = optionalNumber(args.y) ?? composition.height / 2 + offsetY;
  const revealTime = clampNumber(optionalNumber(args.revealTime) ?? 0.55, 0, scene.duration);
  const revealIn = Math.max(0, revealTime - 0.16);
  const hideTime = Math.max(revealTime, scene.duration - 0.55);
  const align = optionalString(args.align);
  return {
    id: layerId,
    type: "text",
    name: optionalString(args.name) ?? label,
    startTime: 0,
    duration: composition.duration,
    visible: true,
    locked: false,
    transform: {
      ...DEFAULT_MOTION_TRANSFORM,
      position: { x, y },
      scale: { x: 0.98, y: 0.98 },
      opacity: 0,
    },
    keyframes: [
      { id: genId(), time: 0, property: "transform.opacity", value: 0, easing: "linear" },
      { id: genId(), time: revealIn, property: "transform.opacity", value: 0, easing: "ease-out" },
      { id: genId(), time: revealTime, property: "transform.opacity", value: 1, easing: "ease-out" },
      { id: genId(), time: hideTime, property: "transform.opacity", value: 1, easing: "ease-in" },
      { id: genId(), time: scene.duration, property: "transform.opacity", value: 0, easing: "ease-in" },
      { id: genId(), time: revealIn, property: "transform.position.y", value: y + 18, easing: "ease-out" },
      { id: genId(), time: revealTime, property: "transform.position.y", value: y, easing: "ease-out" },
    ],
    text: label,
    style: {
      fontFamily: optionalString(args.fontFamily) ?? "Inter",
      fontSize:
        optionalNumber(args.fontSize) ??
        Math.max(22, Math.min(34, composition.width * 0.017)),
      fontWeight: optionalNumber(args.fontWeight) ?? 760,
      color: optionalString(args.color) ?? "#0f172a",
      align:
        align === "left" || align === "center" || align === "right"
          ? align
          : x < composition.width / 2
            ? "left"
            : "right",
      lineHeight: optionalNumber(args.lineHeight) ?? 1.05,
      maxWidth: optionalNumber(args.maxWidth) ?? Math.min(360, composition.width * 0.22),
      verticalAlign: "middle",
      backgroundColor: optionalString(args.backgroundColor) ?? "rgba(255,255,255,0.86)",
      backgroundPadding: optionalNumber(args.backgroundPadding) ?? 14,
      backgroundRadius: optionalNumber(args.backgroundRadius) ?? 18,
      shadow: {
        color: optionalString(args.shadowColor) ?? "#64748b",
        blur: optionalNumber(args.shadowBlur) ?? 18,
        offsetX: optionalNumber(args.shadowOffsetX) ?? 0,
        offsetY: optionalNumber(args.shadowOffsetY) ?? 8,
        spread: optionalNumber(args.shadowSpread) ?? 0,
      },
    },
  };
}

export function inspectCreationProductParts(
  state: CreationProjectState | undefined,
  args: Record<string, unknown>,
) {
  const scene = resolveCreationScene(state, args.sceneId);
  const assetsById = new Map((state?.assets ?? []).map((asset) => [asset.id, asset]));
  const includeAllObjects = args.includeAllObjects === true;
  const objectRefs = new Set(parseStringArray(args.objectIds ?? args.objects) ?? []);
  const partRefs = new Set(parseStringArray(args.partIds ?? args.parts) ?? []);
  const includeTags = parseStringArray(args.tags ?? args.includeTags);

  const selectedObjects = scene?.objects.filter((object) => {
    const asset = assetsById.get(object.assetId);
    if (objectRefs.size > 0) {
      return objectRefs.has(object.id) || objectRefs.has(object.name);
    }
    if (partRefs.size > 0) {
      return object.partId ? partRefs.has(object.partId) : false;
    }
    if (includeTags) {
      return object.tags.some((tag) => includeTags.includes(tag));
    }
    return (
      includeAllObjects ||
      object.tags.includes("product-part") ||
      asset?.kind === "product" ||
      Boolean(object.partId)
    );
  }) ?? [];

  const parts = selectedObjects.map((object) => {
    const asset = assetsById.get(object.assetId);
    const material = asset?.materials.find((candidate) => candidate.id === object.materialId);
    const binding = bindingForObject(scene!, object.id);
    const animationClips = scene!.animations
      .map((clip) => {
        const tracks = clip.tracks.filter((track) => track.targetId === object.id);
        if (tracks.length === 0) return undefined;
        return {
          clipId: clip.id,
          name: clip.name,
          duration: clip.duration,
          channels: [...new Set(tracks.map((track) => track.channel))],
          trackIds: tracks.map((track) => track.id),
          keyframeCount: tracks.reduce(
            (total, track) => total + track.keyframes.length,
            0,
          ),
        };
      })
      .filter(Boolean);
    const materialParameters = asRecord(material?.parameters) ?? {};
    const assetXrayByMaterial = asRecord(asset?.parameters.xrayMaterialsById);
    const assetExplodedByObject = asRecord(asset?.parameters.explodedViewByObject);
    return {
      objectId: object.id,
      partId: object.partId,
      name: object.name,
      parentId: object.parentId,
      visible: object.visible,
      selectable: object.selectable,
      tags: object.tags,
      transform: object.transform,
      asset: asset
        ? {
            assetId: asset.id,
            name: asset.name,
            kind: asset.kind,
            seed: asset.seed,
            nodeTypes: [...new Set(asset.nodes.map((node) => node.type))],
            cacheStatus: {
              dirty: asset.caches.filter((cache) => cache.status === "dirty").length,
              ready: asset.caches.filter((cache) => cache.status === "ready").length,
              missing: asset.caches.filter((cache) => cache.status === "missing").length,
              failed: asset.caches.filter((cache) => cache.status === "failed").length,
            },
          }
        : undefined,
      material: material
        ? {
            materialId: material.id,
            name: material.name,
            model: material.model,
            baseColor: material.baseColor,
            metallic: material.metallic,
            roughness: material.roughness,
            opacity: material.opacity,
            transmission: material.transmission,
            emissive: material.emissive,
            emissiveIntensity: material.emissiveIntensity,
            presetId:
              optionalString(materialParameters.presetId) ??
              optionalString(asset?.parameters.materialPresetId),
            proceduralTexture:
              optionalString(materialParameters.proceduralTexture) ??
              optionalString(asset?.parameters.materialPresetTexture),
            surfaceDetail:
              materialParameters.surfaceDetail ??
              (object.materialId
                ? asRecord(asset?.parameters.surfaceDetailsByMaterialId)?.[object.materialId]
                : undefined),
            xrayMaterial:
              materialParameters.xrayMaterial ??
              (object.materialId ? assetXrayByMaterial?.[object.materialId] : undefined),
          }
        : undefined,
        recipeFeatures: {
          explodedView: assetExplodedByObject?.[object.id] ?? asset?.parameters.explodedView,
          productPart: asset?.parameters.productPart,
          productPartRole: asset?.parameters.productPartRole,
          screenStack: asset?.parameters.screenStack,
          screenStackId: asset?.parameters.screenStackId,
          screenStackLayerKey: asset?.parameters.screenStackLayerKey,
          cameraModule: asset?.parameters.cameraModule,
          cameraModuleId: asset?.parameters.cameraModuleId,
          cameraModuleComponentKey: asset?.parameters.cameraModuleComponentKey,
          productInternals: asset?.parameters.productInternals,
          productInternalsId: asset?.parameters.productInternalsId,
          productInternalsComponentKey: asset?.parameters.productInternalsComponentKey,
          lightSweep: asset?.parameters.lightSweep,
          cutawayPlane: asset?.parameters.cutawayPlane,
          decal: asset?.parameters.decal,
          uiPanel: asset?.parameters.uiPanel,
          uiPanelText: asset?.parameters.uiPanelText,
          scatterGroup: asset?.parameters.scatterGroup,
          scatterGroups: asset?.parameters.scatterGroups,
          bevel: asset?.parameters.bevel,
          bevelsByObjectId: asset?.parameters.bevelsByObjectId,
          displacement: asset?.parameters.displacement,
          displacementsByObjectId: asset?.parameters.displacementsByObjectId,
          clothWave: asset?.parameters.clothWave,
          surfaceDetail:
            materialParameters.surfaceDetail ??
          (object.materialId
            ? asRecord(asset?.parameters.surfaceDetailsByMaterialId)?.[object.materialId]
            : undefined),
        xrayMaterial:
          materialParameters.xrayMaterial ??
          (object.materialId ? assetXrayByMaterial?.[object.materialId] : undefined),
        materialPresetId: asset?.parameters.materialPresetId,
      },
      renderBinding: binding
        ? {
            bindingId: binding.binding.id,
            compositionId: binding.binding.compositionId,
            layerId: binding.binding.layerId,
            renderObjectId: binding.renderObjectId,
          }
        : undefined,
      animations: animationClips,
    };
  });

  return {
    ...creationReadHeader(state),
    scene: scene
      ? {
          id: scene.id,
          name: scene.name,
          duration: scene.duration,
          frameRate: scene.frameRate,
          objectCount: scene.objects.length,
          animationCount: scene.animations.length,
          renderBindingCount: scene.renderBindings.length,
        }
      : undefined,
    partCount: parts.length,
    parts,
    objectIdsByPartId: Object.fromEntries(
      parts
        .filter((part) => typeof part.partId === "string")
        .map((part) => [part.partId as string, part.objectId]),
    ),
    renderObjectIdsByPartId: Object.fromEntries(
      parts
        .filter(
          (part) =>
            typeof part.partId === "string" &&
            typeof part.renderBinding?.renderObjectId === "string",
        )
        .map((part) => [
          part.partId as string,
          part.renderBinding!.renderObjectId,
        ]),
    ),
  };
}

export function jobTool(
  name: string,
  domain: ToolDomain,
  title: string,
  description: string,
  kind: JobKind,
  inputSchema: JSONSchema,
): RegisteredTool {
  return {
    name,
    domain,
    title,
    description,
    inputSchema,
    readOnly: false,
    destructive: false,
    expensive: true,
    handler: async (args, host) => {
      host.requireOpenProject();
      const result = await host.runJob(kind, args);
      return result.ok
        ? ok(`${kind} job complete`, result.data)
        : fail(result.error ?? `${kind} job failed`, "JOB_FAILED");
    },
  };
}

export function overlayRemoveTool(
  name: string,
  kind: "text" | "shape" | "sticker" | "svg",
  rawType: string,
  domain: ToolDomain,
  title: string,
): RegisteredTool {
  return {
    name,
    domain,
    title,
    description: `Remove a ${kind} overlay clip. Engine-aware so the preview and export stop rendering it.`,
    inputSchema: obj({ clipId: str }, ["clipId"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      if (typeof args.clipId !== "string" || !args.clipId.trim()) {
        return fail("clipId is required", "INVALID_PARAMS");
      }
      const clipId = args.clipId;
      if (typeof host.removeOverlay === "function") {
        const removed = await host.removeOverlay(kind, clipId);
        return removed
          ? ok(`Removed ${kind} overlay`, { clipId })
          : fail(`${kind} overlay "${clipId}" not found`, "NOT_FOUND");
      }
      const result = await host.applyAction({
        type: rawType,
        id: genId(),
        timestamp: Date.now(),
        params: { clipId },
      });
      return result.success
        ? ok(`Removed ${kind} (action)`, { clipId })
        : fail(result.error?.message ?? `${rawType} failed`, result.error?.code);
    },
  };
}
