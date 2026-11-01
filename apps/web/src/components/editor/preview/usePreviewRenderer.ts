import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  RendererFactory,
  isWebGPUSupported,
  type Renderer,
} from "@openreel/core";
import type { PreviewResourceManager } from "./preview-resource-manager";

interface PreviewResolution {
  width: number;
  height: number;
}

interface UsePreviewRendererOptions {
  canvasRef: { current: HTMLCanvasElement | null };
  previewRes: PreviewResolution;
  resourceManager: PreviewResourceManager;
}

export const usePreviewRenderer = ({
  canvasRef,
  previewRes,
  resourceManager,
}: UsePreviewRendererOptions) => {
  const rendererRef = useRef<Renderer | null>(null);
  const rendererInitializedRef = useRef(false);
  const initialResolutionRef = useRef(previewRes);
  const [, setRendererType] = useState("none");

  // Keep the drawing buffer tied to the project resolution, not its CSS size.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (
      canvas.width !== previewRes.width ||
      canvas.height !== previewRes.height
    ) {
      canvas.width = previewRes.width;
      canvas.height = previewRes.height;
    }
  }, [canvasRef, previewRes.width, previewRes.height]);

  useEffect(() => {
    if (rendererInitializedRef.current || !canvasRef.current) return;
    const initializationRequest = resourceManager.beginRequest();
    const { width, height } = initialResolutionRef.current;

    const initializeRenderer = async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const factory = RendererFactory.getInstance();
        const renderer = await factory.createRenderer({
          canvas,
          width,
          height,
          preferredRenderer: isWebGPUSupported() ? "webgpu" : "canvas2d",
        });

        if (!resourceManager.isCurrent(initializationRequest)) {
          renderer.destroy();
          return;
        }

        rendererRef.current = renderer;
        rendererInitializedRef.current = true;
        setRendererType(renderer.type);
        resourceManager.own(() => {
          renderer.destroy();
          if (rendererRef.current === renderer) {
            rendererRef.current = null;
            rendererInitializedRef.current = false;
          }
        });

        renderer.onDeviceLost(() => {
          console.warn("[Preview] GPU device lost, attempting recovery...");
          void renderer.recreateDevice().then((success) => {
            if (!success && resourceManager.isCurrent(initializationRequest)) {
              console.error("[Preview] Failed to recover GPU device");
              setRendererType("canvas2d");
            }
          });
        });
      } catch (error) {
        if (!resourceManager.isCurrent(initializationRequest)) return;
        console.warn("[Preview] Failed to initialize GPU renderer:", error);
        setRendererType("canvas2d");
      }
    };

    void initializeRenderer();
  }, [canvasRef, resourceManager]);

  useEffect(() => {
    if (rendererRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      if (
        canvas.width !== previewRes.width ||
        canvas.height !== previewRes.height
      ) {
        rendererRef.current.resize(previewRes.width, previewRes.height);
      }
    }
  }, [canvasRef, previewRes.width, previewRes.height]);

  return { rendererRef };
};
