import type { AdjustmentLayer, BlendMode } from "@openreel/core";
import { getEffectsBridge } from "../../../bridges/effects-bridge";

type PreviewCompositeOperation =
  CanvasRenderingContext2D["globalCompositeOperation"];

const adjustmentBlendOperation = (mode: BlendMode): PreviewCompositeOperation =>
  mode === "add" || mode === "linear-dodge"
    ? "lighter"
    : (mode as PreviewCompositeOperation);

export const applyPreviewAdjustmentLayers = async (
  canvas: OffscreenCanvas,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  layers: readonly AdjustmentLayer[],
  time: number,
): Promise<boolean> => {
  let applied = false;
  const effectsBridge = getEffectsBridge();
  if (!effectsBridge.isInitialized()) return false;
  for (const layer of layers) {
    if (
      !layer.enabled ||
      layer.opacity <= 0 ||
      time < layer.startTime ||
      time >= layer.startTime + layer.duration
    ) continue;
    const effects = layer.effects.filter((effect) => effect.enabled !== false);
    if (effects.length === 0) continue;
    let source: ImageBitmap | null = null;
    let processed: ImageBitmap | null = null;
    try {
      source = await createImageBitmap(canvas);
      processed = await effectsBridge.processEffectList(source, effects);
      if (processed.width <= 0 || processed.height <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
      ctx.globalCompositeOperation = adjustmentBlendOperation(layer.blendMode);
      ctx.drawImage(processed, 0, 0, canvas.width, canvas.height);
      ctx.restore();
      applied = true;
    } catch (error) {
      console.warn(`[Preview] Adjustment layer ${layer.id} failed:`, error);
    } finally {
      if (processed && processed !== source) processed.close();
      source?.close();
    }
  }
  return applied;
};
