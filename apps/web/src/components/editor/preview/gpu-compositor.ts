import {
  resolveCanvasFitDimensions,
  type Renderer,
} from "@openreel/core";
import type { ClipTransform } from "./types";

export interface GPULayer {
  bitmap: ImageBitmap;
  transform: ClipTransform;
}

// The WebGPU renderer maps a layer's texture onto a full-canvas quad, so a
// scale of {1,1} stretches the source to the canvas. Bake the aspect-fit
// ratio into the layer scale so GPU compositing letterboxes ("contain") like
// the Canvas2D path instead of distorting mismatched-aspect clips.
export const computeFitScale = (
  fitMode: ClipTransform["fitMode"],
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  crop?: ClipTransform["crop"],
): { x: number; y: number } => {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return { x: 1, y: 1 };
  }
  const visibleSourceWidth = crop ? crop.width * sourceWidth : sourceWidth;
  const visibleSourceHeight = crop ? crop.height * sourceHeight : sourceHeight;
  const { width: drawWidth, height: drawHeight } =
    resolveCanvasFitDimensions(
      fitMode,
      visibleSourceWidth,
      visibleSourceHeight,
      canvasWidth,
      canvasHeight,
    );
  return { x: drawWidth / canvasWidth, y: drawHeight / canvasHeight };
};

export const renderFrameWithGPU = async (
  renderer: Renderer,
  frame: ImageBitmap,
  transform: ClipTransform,
  canvasWidth: number,
  canvasHeight: number,
): Promise<ImageBitmap | null> => {
  try {
    const device = renderer.getDevice();
    if (!device) {
      return null;
    }

    renderer.beginFrame();

    const texture = renderer.createTextureFromImage(frame);

    const fitScale = computeFitScale(
      transform.fitMode,
      frame.width,
      frame.height,
      canvasWidth,
      canvasHeight,
      transform.crop,
    );
    const gpuTransform = {
      position: transform.position,
      scale: {
        x: transform.scale.x * fitScale.x,
        y: transform.scale.y * fitScale.y,
      },
      rotation: transform.rotation,
      anchor: transform.anchor,
      opacity: transform.opacity,
      borderRadius: transform.borderRadius,
      crop: transform.crop,
    };

    renderer.renderLayer({
      texture,
      transform: gpuTransform,
      effects: [],
      opacity: transform.opacity,
      borderRadius: transform.borderRadius || 0,
    });

    const result = await renderer.endFrame();
    renderer.releaseTexture(texture);

    return result;
  } catch {
    return null;
  }
};

export const renderAllLayersWithGPU = async (
  renderer: Renderer,
  layers: GPULayer[],
  canvasWidth: number,
  canvasHeight: number,
): Promise<ImageBitmap | null> => {
  try {
    const device = renderer.getDevice();

    if (!device || layers.length === 0) {
      return null;
    }

    renderer.beginFrame();

    const textures: ReturnType<typeof renderer.createTextureFromImage>[] = [];

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];

      const texture = renderer.createTextureFromImage(layer.bitmap);
      textures.push(texture);

      const fitScale = computeFitScale(
        layer.transform.fitMode,
        layer.bitmap.width,
        layer.bitmap.height,
        canvasWidth,
        canvasHeight,
        layer.transform.crop,
      );
      const gpuTransform = {
        position: layer.transform.position,
        scale: {
          x: layer.transform.scale.x * fitScale.x,
          y: layer.transform.scale.y * fitScale.y,
        },
        rotation: layer.transform.rotation,
        anchor: layer.transform.anchor,
        opacity: layer.transform.opacity,
        borderRadius: layer.transform.borderRadius,
        crop: layer.transform.crop,
      };

      renderer.renderLayer({
        texture,
        transform: gpuTransform,
        effects: [],
        opacity: layer.transform.opacity,
        borderRadius: layer.transform.borderRadius || 0,
      });
    }

    const result = await renderer.endFrame();

    for (const texture of textures) {
      renderer.releaseTexture(texture);
    }

    return result;
  } catch (e) {
    console.error("[renderAllLayersWithGPU] Error:", e);
    return null;
  }
};
