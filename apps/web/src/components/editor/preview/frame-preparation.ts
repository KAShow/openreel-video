import { getBackgroundRemovalEngine } from "@openreel/core";
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
