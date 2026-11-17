import { describe, expect, it, vi } from "vitest";

const renderTextClip = vi.fn(() => ({ isMesh: true }));
vi.mock("../components/editor/preview/threejs-layer-renderer", () => ({
  ThreeJSLayerRenderer: class {
    canvas = document.createElement("canvas");
    renderTextClip = renderTextClip;
    resize = vi.fn();
    clear = vi.fn();
  },
}));

describe("three.js loaded on demand for 3D preview layers", () => {
  it("draws nothing until three.js arrives, then asks the preview to redraw", async () => {
    const { ThreeJSLayerRenderer, loadThreeLayerRenderer } = await import("./lazy-three-layer");
    const invalidated = vi.fn();
    window.addEventListener("openreel:preview-invalidate", invalidated);

    const renderer = new ThreeJSLayerRenderer(320, 180);
    expect(renderer.canvas.width).toBe(320);
    const args = [{} as never, 320, 180] as const;
    expect(renderer.renderTextClip(...args)).toBeNull();

    await loadThreeLayerRenderer();
    expect(invalidated).toHaveBeenCalledOnce();
    expect(renderer.renderTextClip(...args)).toEqual({ isMesh: true });
    expect(renderTextClip).toHaveBeenCalledOnce();
    window.removeEventListener("openreel:preview-invalidate", invalidated);
  });
});
