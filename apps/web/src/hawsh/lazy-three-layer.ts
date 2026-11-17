/**
 * Loads three.js only when it is needed (Hawsh, plan phase 5).
 *
 * The preview draws 3D text, 3D shapes and blend-mode layers with OpenReel's
 * `ThreeJSLayerRenderer`, which needs three.js (about 290 KB compressed). Most projects never use
 * them, so instead of putting three.js in the editor's opening download, `canvas-renderers.ts`
 * imports this stand-in with the same methods. The real renderer downloads the first time a 3D
 * layer is drawn. Until it arrives that layer draws nothing (as the real renderer does while a 3D
 * font loads); then the preview is asked to redraw (`openreel:preview-invalidate`, which
 * `Preview.tsx` listens for), so a paused frame fills in too.
 */
import type * as THREE from "three";
import type { ThreeJSLayerRenderer as RealRenderer } from "../components/editor/preview/threejs-layer-renderer";

type RealModule = typeof import("../components/editor/preview/threejs-layer-renderer");

let realModule: RealModule | null = null;
let loading: Promise<RealModule> | null = null;
let missedFrame = false;

export function loadThreeLayerRenderer(): Promise<RealModule> {
  loading ??= import("../components/editor/preview/threejs-layer-renderer").then(
    (module) => {
      realModule = module;
      if (missedFrame && typeof window !== "undefined") {
        missedFrame = false;
        window.dispatchEvent(new Event("openreel:preview-invalidate"));
      }
      return module;
    },
    (error: unknown) => {
      loading = null; // try again the next time a 3D layer is drawn
      throw error;
    },
  );
  return loading;
}

export class ThreeJSLayerRenderer {
  private real: RealRenderer | null = null;
  private readonly placeholder: HTMLCanvasElement;
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.placeholder = document.createElement("canvas");
    this.placeholder.width = width;
    this.placeholder.height = height;
  }

  private ready(): RealRenderer | null {
    if (!this.real && realModule) this.real = new realModule.ThreeJSLayerRenderer(this.width, this.height);
    return this.real;
  }

  /** For the draw calls: the real renderer, or null after noting that this frame lacks a layer. */
  private drawing(): RealRenderer | null {
    const real = this.ready();
    if (!real) {
      missedFrame = true;
      void loadThreeLayerRenderer().catch((error) => console.warn("[Preview] three.js failed to load:", error));
    }
    return real;
  }

  get canvas(): HTMLCanvasElement {
    return this.ready()?.canvas ?? this.placeholder;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const real = this.ready();
    if (real) real.resize(width, height);
    else {
      this.placeholder.width = width;
      this.placeholder.height = height;
    }
  }

  clear(): void {
    this.ready()?.clear();
  }

  renderTextClip(...args: Parameters<RealRenderer["renderTextClip"]>): THREE.Mesh | THREE.Group | null {
    return this.drawing()?.renderTextClip(...args) ?? null;
  }

  renderShapeClip(...args: Parameters<RealRenderer["renderShapeClip"]>): THREE.Mesh | THREE.Group | null {
    return this.drawing()?.renderShapeClip(...args) ?? null;
  }

  renderSVGClip(...args: Parameters<RealRenderer["renderSVGClip"]>): THREE.Mesh | null {
    return this.drawing()?.renderSVGClip(...args) ?? null;
  }

  renderStickerClip(...args: Parameters<RealRenderer["renderStickerClip"]>): THREE.Mesh | null {
    return this.drawing()?.renderStickerClip(...args) ?? null;
  }

  /** Only called after a render*Clip returned a mesh, which means the real renderer exists. */
  getScene(): THREE.Scene {
    const real = this.ready();
    if (!real) throw new Error("three.js layer renderer is not loaded yet");
    return real.getScene();
  }

  render(): HTMLCanvasElement {
    return this.ready()?.render() ?? this.placeholder;
  }

  setFontReadyCallback(callback: (() => void) | null): void {
    this.ready()?.setFontReadyCallback(callback);
  }

  dispose(): void {
    this.real?.dispose();
    this.real = null;
  }
}
