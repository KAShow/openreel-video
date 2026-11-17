import { getBackgroundRemovalEngine, isNeutralColorGrading } from "@openreel/core";
import { canRenderFast, renderFastEffects, type FastEffect } from "../../../hawsh/fast-effects";
import { getEffectsBridge } from "../../../bridges/effects-bridge";
import {
  applyEffectsToFrame,
  applyEffectsToFrameCanvas,
} from "./canvas-renderers";

export interface PreparedPreviewFrame {
  frame: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
  cleanup: () => void;
}

export const clipNeedsFrameProcessing = (clipId: string): boolean => {
  const bgEngine = getBackgroundRemovalEngine();
  if (bgEngine?.isInitialized() && bgEngine.getSettings(clipId).enabled) {
    return true;
  }

  const effectsBridge = getEffectsBridge();
  if (!effectsBridge.isInitialized()) {
    return false;
  }

  if (effectsBridge.getEffects(clipId).some((effect) => effect.enabled)) {
    return true;
  }

  return Object.keys(effectsBridge.getColorGrading(clipId)).length > 0;
};

/**
 * The clip's enabled effects when all of them can run on the graphics card (hawsh/fast-effects.ts),
 * else null (CPU path). Not with background removal or an active colour grade.
 */
export const clipFastEffects = (clipId: string): FastEffect[] | null => {
  const bgEngine = getBackgroundRemovalEngine();
  if (bgEngine?.isInitialized() && bgEngine.getSettings(clipId).enabled) return null;
  const effectsBridge = getEffectsBridge();
  if (!effectsBridge.isInitialized()) return null;
  const grading = effectsBridge.getColorGrading(clipId);
  if (Object.keys(grading).length > 0 && !isNeutralColorGrading(grading)) return null;
  const enabled = effectsBridge.getEffects(clipId).filter((effect) => effect.enabled);
  return canRenderFast(enabled) ? enabled : null;
};

export const clipCssFilterOnly = (clipId: string): string | null => {
  const bgEngine = getBackgroundRemovalEngine();
  if (bgEngine?.isInitialized() && bgEngine.getSettings(clipId).enabled) {
    return null;
  }
  const effectsBridge = getEffectsBridge();
  if (!effectsBridge.isInitialized()) {
    return null;
  }
  return effectsBridge.getNativeCssFilter(clipId);
};

export const preparePreviewFrame = async (
  clipId: string,
  frameCanvas: HTMLCanvasElement | OffscreenCanvas,
  preferBitmap: boolean,
  allowCanvasByRef = false,
): Promise<PreparedPreviewFrame> => {
  const needsProcessing = clipNeedsFrameProcessing(clipId);
  if (!preferBitmap && !needsProcessing) {
    return {
      frame: frameCanvas,
      cleanup: () => {},
    };
  }

  if (needsProcessing) {
    const fast = clipFastEffects(clipId);
    const fastFrame = fast ? renderFastEffects(clipId, frameCanvas, fast) : null;
    if (fastFrame) return { frame: fastFrame, cleanup: () => {} };
  }

  let frameBitmap: ImageBitmap | null = null;
  let processedFrame: ImageBitmap | null = null;

  try {
    frameBitmap = await createImageBitmap(frameCanvas);

    if (!needsProcessing) {
      return {
        frame: frameBitmap,
        cleanup: () => {
          frameBitmap?.close();
        },
      };
    }

    if (allowCanvasByRef) {
      const effectsCanvas = await applyEffectsToFrameCanvas(
        clipId,
        frameBitmap,
      );
      if (effectsCanvas) {
        const sourceBitmap = frameBitmap;
        return {
          frame: effectsCanvas,
          cleanup: () => {
            sourceBitmap.close();
          },
        };
      }
    }

    processedFrame = await applyEffectsToFrame(clipId, frameBitmap);
    if (processedFrame === frameBitmap) {
      return {
        frame: frameBitmap,
        cleanup: () => {
          frameBitmap?.close();
        },
      };
    }

    return {
      frame: processedFrame,
      cleanup: () => {
        processedFrame?.close();
        frameBitmap?.close();
      },
    };
  } catch {
    processedFrame?.close();
    frameBitmap?.close();

    return {
      frame: frameCanvas,
      cleanup: () => {},
    };
  }
};
