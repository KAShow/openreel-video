/**
 * The parts of the Three.js motion renderer that do not need three.js: render-quality settings
 * and mesh-frame sampling. Split out (Hawsh, plan phase 5) so `motion-renderer.ts` and the
 * package index can use them without loading three.js; the renderer class itself is imported on
 * demand when a 3D layer is drawn. `motion-three-renderer.ts` re-exports everything here.
 */
import type { MotionObject3D } from "./types";

/** View transform applied at present time — "agx" matches the Blender 4.x look. */
export type MotionToneMapping =
  | "agx"
  | "aces"
  | "filmic"
  | "neutral"
  | "linear"
  | "none";

export interface MotionRenderQuality {
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly environment: boolean;
  /** Cinematic post-processing (bloom + optional AO/DOF). Off for fast preview. */
  readonly postProcessing?: boolean;
  /** UnrealBloom strength when postProcessing is on. */
  readonly bloomStrength?: number;
  /** Screen-space ambient occlusion (GTAO) — grounds objects with contact shadows. */
  readonly ambientOcclusion?: boolean;
  /** Cinematic depth-of-field (Bokeh): focal plane on the camera target. */
  readonly depthOfField?: boolean;
  /** DOF aperture (blur strength) when depthOfField is on. */
  readonly dofAperture?: number;
  /** MSAA samples for the post-processing pipeline (0 disables; 4 is a good default). */
  readonly antialiasSamples?: number;
  /** View transform / tonemap applied on present. Defaults to AgX (the Blender look). */
  readonly toneMapping?: MotionToneMapping;
  /** Tonemap exposure multiplier. */
  readonly exposure?: number;
  /** Soft area (softbox) key light for product-grade speculars. */
  readonly softLighting?: boolean;
  /** Image-based-lighting intensity (reflections + ambient fill). */
  readonly environmentIntensity?: number;
}

export const DEFAULT_ENVIRONMENT_INTENSITY = 0.85;

export const DEFAULT_MOTION_RENDER_QUALITY: MotionRenderQuality = {
  shadows: true,
  shadowMapSize: 2048,
  environment: true,
  postProcessing: true,
  bloomStrength: 0.34,
  ambientOcclusion: true,
  depthOfField: true,
  dofAperture: 0.0016,
  antialiasSamples: 4,
  toneMapping: "agx",
  exposure: 1,
  softLighting: true,
  environmentIntensity: DEFAULT_ENVIRONMENT_INTENSITY,
};

export function mergeMotionRenderQuality(
  partial?: Partial<MotionRenderQuality>,
): MotionRenderQuality {
  return { ...DEFAULT_MOTION_RENDER_QUALITY, ...(partial ?? {}) };
}

export function sampleMotionObjectMeshFrame(
  object: MotionObject3D,
  timeSeconds: number,
): MotionObject3D {
  const frames = object.meshFrames;
  if (!frames || frames.frames.length === 0 || frames.fps <= 0) return object;
  const count = frames.frames.length;
  const raw = Math.floor(timeSeconds * frames.fps);
  const index = frames.loop
    ? ((raw % count) + count) % count
    : Math.max(0, Math.min(count - 1, raw));
  const positions = frames.frames[index] ?? frames.frames[count - 1]!;
  if (positions.length < 9 || frames.indices.length < 3) return object;
  const { meshFrames: _meshFrames, ...rest } = object;
  return {
    ...rest,
    mesh: { positions, indices: frames.indices, uvs: frames.uvs, preScaled: true },
  };
}
