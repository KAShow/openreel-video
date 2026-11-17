/**
 * Video effects on the graphics card for the preview (Hawsh build).
 *
 * The CPU engine (VideoEffectsEngine.applyEffects) reads every pixel back into JavaScript for
 * vignette, grain and sharpen and runs colour filters through a software canvas: about half a second
 * per 1080×1920 frame for the "cinematic" look, so playback fell to 2 frames a second. Here each effect
 * is one WebGL2 pass (a few milliseconds for all of them), in the order the user added them, with the
 * same formulas as the CPU engine, which export still uses, so the preview matches the exported file:
 *   brightness/contrast/saturation/hue: the CSS filter functions (Filter Effects spec matrices)
 *   sharpen: the CPU 3×3 kernel (centre 1+4k, sides −k; the 1-pixel border is left as it is)
 *   vignette: smoothstep(midpoint ± feather) of the distance to the centre, darkening by `amount`
 *   grain: uniform noise of ±(amount × 25) levels, new every frame
 * Strengths go through `effectStrength` (portable scale), like the CPU engine.
 *
 * Anything else (blur, chroma key, colour grading, background removal…) returns null and the caller
 * keeps the CPU path. So does a lost or missing WebGL2 context.
 */
import { effectStrength } from "@openreel/core";

export interface FastEffect {
  type: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
}

export type FastSource = HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

const SUPPORTED = new Set(["brightness", "contrast", "saturation", "hue", "sharpen", "vignette", "grain"]);

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Whether every enabled effect in the list can run here. */
export function canRenderFast(effects: readonly FastEffect[]): boolean {
  const enabled = effects.filter((e) => e.enabled !== false);
  return enabled.length > 0 && enabled.every((e) => SUPPORTED.has(e.type));
}

/* ------------------------------------------------------------------ colour matrices (CSS filters) */

type Mat = { m: number[]; off: [number, number, number] }; // row-major 3×3

/** The affine colour transform of a CSS filter function, or null for effects that are not one. */
export function colorMatrix(effect: FastEffect): Mat | null {
  const p = effect.params ?? {};
  switch (effect.type) {
    case "brightness": {
      const a = 1 + effectStrength("brightness", p.value);
      return { m: [a, 0, 0, 0, a, 0, 0, 0, a], off: [0, 0, 0] };
    }
    case "contrast": {
      const a = num(p.value, 1);
      const o = 0.5 - 0.5 * a;
      return { m: [a, 0, 0, 0, a, 0, 0, 0, a], off: [o, o, o] };
    }
    case "saturation": {
      const s = num(p.value, 1);
      return {
        m: [
          0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
          0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
          0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
        ],
        off: [0, 0, 0],
      };
    }
    case "hue": {
      const a = (num(p.rotation, 0) * Math.PI) / 180;
      const c = Math.cos(a), s = Math.sin(a);
      return {
        m: [
          0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
          0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
          0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
        ],
        off: [0, 0, 0],
      };
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ WebGL */

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const HEADER = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_size;
out vec4 outColor;
vec4 px(vec2 fc) { return texture(u_tex, fc / u_size); }
`;

const FRAGMENTS = {
  copy: `${HEADER}
void main() { outColor = px(gl_FragCoord.xy); }`,
  matrix: `${HEADER}
uniform mat3 u_m;
uniform vec3 u_off;
void main() {
  vec4 c = px(gl_FragCoord.xy);
  outColor = vec4(clamp(u_m * c.rgb + u_off, 0.0, 1.0), c.a);
}`,
  sharpen: `${HEADER}
uniform float u_k;
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec4 c = px(fc);
  if (fc.x < 1.0 || fc.y < 1.0 || fc.x > u_size.x - 1.0 || fc.y > u_size.y - 1.0) { outColor = c; return; }
  vec3 s = c.rgb * (1.0 + 4.0 * u_k)
    - u_k * (px(fc + vec2(1.0, 0.0)).rgb + px(fc - vec2(1.0, 0.0)).rgb + px(fc + vec2(0.0, 1.0)).rgb + px(fc - vec2(0.0, 1.0)).rgb);
  outColor = vec4(clamp(s, 0.0, 1.0), c.a);
}`,
  vignette: `${HEADER}
uniform float u_amount;
uniform float u_mid;
uniform float u_feather;
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec4 c = px(fc);
  vec2 center = u_size * 0.5;
  vec2 d = (floor(fc) - center) / center;
  float dist = length(d) / 1.41421356;
  float v = smoothstep(u_mid - u_feather, u_mid + u_feather, dist);
  outColor = vec4(c.rgb * (1.0 - v * u_amount), c.a);
}`,
  grain: `${HEADER}
uniform float u_intensity;
uniform float u_seed;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21) + u_seed); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec4 c = px(fc);
  float n = (hash(floor(fc)) - 0.5) * u_intensity;
  outColor = vec4(clamp(c.rgb + n, 0.0, 1.0), c.a);
}`,
} as const;

type ProgramName = keyof typeof FRAGMENTS;

interface Gl {
  gl: WebGL2RenderingContext;
  canvas: OffscreenCanvas | HTMLCanvasElement;
  programs: Record<ProgramName, { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> }>;
  source: WebGLTexture;
  targets: [{ tex: WebGLTexture; fb: WebGLFramebuffer }, { tex: WebGLTexture; fb: WebGLFramebuffer }];
  width: number;
  height: number;
}

let state: Gl | null = null;
let broken = false;
/** Video frames are staged through a 2D canvas so the file's rotation is applied like drawImage does. */
let staging: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
const outputs = new Map<string, OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D>();
let frameSeed = 0;

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function setup(): Gl | null {
  if (broken) return null;
  if (state) return state.gl.isContextLost() ? ((broken = true), null) : state;
  try {
    const options = { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false };
    let canvas = makeCanvas(2, 2);
    let gl = canvas.getContext("webgl2", options) as WebGL2RenderingContext | null;
    // Older iPhone Safari has OffscreenCanvas for 2D only: try a regular canvas before giving up.
    if (!gl && typeof document !== "undefined" && !(canvas instanceof HTMLCanvasElement)) {
      const element = document.createElement("canvas");
      element.width = 2; element.height = 2;
      canvas = element;
      gl = element.getContext("webgl2", options) as WebGL2RenderingContext | null;
    }
    if (!gl) { broken = true; return null; }
    canvas.addEventListener("webglcontextlost", () => { broken = true; state = null; });
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const programs = {} as Gl["programs"];
    for (const [name, src] of Object.entries(FRAGMENTS) as [ProgramName, string][]) {
      const program = gl.createProgram()!;
      gl.attachShader(program, vs);
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, src));
      gl.bindAttribLocation(program, 0, "a_pos");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
      programs[name] = { program, uniforms: new Map() };
    }
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const target = () => {
      const tex = texture(gl);
      const fb = gl.createFramebuffer()!;
      return { tex, fb };
    };
    state = { gl, canvas, programs, source: texture(gl), targets: [target(), target()], width: 0, height: 0 };
    return state;
  } catch (error) {
    console.warn("[fast-effects] WebGL2 unavailable, effects stay on the CPU:", error);
    broken = true;
    return null;
  }
}

function resize(s: Gl, w: number, h: number): void {
  if (s.width === w && s.height === h) return;
  const { gl } = s;
  s.canvas.width = w; s.canvas.height = h;
  for (const t of s.targets) {
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  }
  s.width = w; s.height = h;
}

function uniform(s: Gl, name: ProgramName, u: string): WebGLUniformLocation | null {
  const p = s.programs[name];
  if (!p.uniforms.has(u)) p.uniforms.set(u, s.gl.getUniformLocation(p.program, u));
  return p.uniforms.get(u) ?? null;
}

function sourceSize(src: FastSource): [number, number] {
  if (typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement) return [src.videoWidth, src.videoHeight];
  return [src.width, src.height];
}

/**
 * Applies the effects to a frame and returns a canvas with the result, or null to fall back to the CPU.
 * `key` identifies the clip: each clip gets its own result canvas, so several clips with effects in the
 * same frame never overwrite each other before they are composited.
 */
export function renderFastEffects(key: string, src: FastSource, effects: readonly FastEffect[]): OffscreenCanvas | HTMLCanvasElement | null {
  const enabled = effects.filter((e) => e.enabled !== false);
  if (!canRenderFast(enabled)) return null;
  const [w, h] = sourceSize(src);
  if (!(w > 0 && h > 0)) return null;
  const s = setup();
  if (!s) return null;
  const { gl } = s;
  try {
    let upload: FastSource = src;
    if (typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement) {
      if (!staging || staging.canvas.width !== w || staging.canvas.height !== h) {
        staging = makeCanvas(w, h).getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
      }
      staging.drawImage(src, 0, 0, w, h);
      upload = staging.canvas;
    }
    resize(s, w, h);
    gl.viewport(0, 0, w, h);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.source);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, upload as ImageBitmap);

    frameSeed = (frameSeed + 0.6180339887) % 1;
    let input = s.source;
    let target = 0;
    const pass = (name: ProgramName, set: () => void, toScreen = false) => {
      gl.useProgram(s.programs[name].program);
      gl.uniform1i(uniform(s, name, "u_tex"), 0);
      gl.uniform2f(uniform(s, name, "u_size"), w, h);
      set();
      gl.bindTexture(gl.TEXTURE_2D, input);
      gl.bindFramebuffer(gl.FRAMEBUFFER, toScreen ? null : s.targets[target].fb);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!toScreen) { input = s.targets[target].tex; target = 1 - target; }
    };

    for (const e of enabled) {
      const p = e.params ?? {};
      const m = colorMatrix(e);
      if (m) {
        pass("matrix", () => {
          // GLSL matrices are column-major: transpose the row-major CSS matrix.
          gl.uniformMatrix3fv(uniform(s, "matrix", "u_m"), true, m.m);
          gl.uniform3f(uniform(s, "matrix", "u_off"), ...m.off);
        });
      } else if (e.type === "sharpen") {
        const k = effectStrength("sharpen", p.amount);
        if (k > 0) pass("sharpen", () => gl.uniform1f(uniform(s, "sharpen", "u_k"), k));
      } else if (e.type === "vignette") {
        const amount = effectStrength("vignette", p.amount);
        if (amount > 0) pass("vignette", () => {
          gl.uniform1f(uniform(s, "vignette", "u_amount"), amount);
          gl.uniform1f(uniform(s, "vignette", "u_mid"), num(p.midpoint, 0.5));
          gl.uniform1f(uniform(s, "vignette", "u_feather"), num(p.feather, 0.3));
        });
      } else if (e.type === "grain") {
        const amount = effectStrength("grain", p.amount);
        if (amount > 0) pass("grain", () => {
          gl.uniform1f(uniform(s, "grain", "u_intensity"), (amount * 50) / 255);
          gl.uniform1f(uniform(s, "grain", "u_seed"), frameSeed);
        });
      }
    }
    pass("copy", () => undefined, true);

    let out = outputs.get(key);
    if (!out || out.canvas.width !== w || out.canvas.height !== h) {
      out = makeCanvas(w, h).getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
      outputs.set(key, out);
    }
    out.globalCompositeOperation = "copy";
    out.drawImage(s.canvas as HTMLCanvasElement, 0, 0);
    return out.canvas;
  } catch (error) {
    console.warn("[fast-effects] render failed, using the CPU path:", error);
    return null;
  }
}

/** Frees the result canvas of clips no longer on the timeline (called when playback stops). */
export function releaseFastEffectOutputs(keep: ReadonlySet<string> = new Set()): void {
  for (const key of outputs.keys()) if (!keep.has(key)) outputs.delete(key);
}

/** Test helper: forget the context so the next call sets up again. */
export function resetFastEffects(): void {
  state = null;
  broken = false;
  staging = null;
  outputs.clear();
}
