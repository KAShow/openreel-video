import {
  getPersonSegmentationEngine,
  type SegmentationResult,
  type ShapeClip,
  type StickerClip,
  type SVGClip,
  type TextClip,
} from "@openreel/core";
import {
  renderShapeClipToCanvas,
  renderTextClipToCanvas,
} from "./canvas-renderers";
import {
  clipNeedsFrameProcessing,
  preparePreviewFrame,
} from "./frame-preparation";
import {
  applySubjectOcclusionMask,
  getSubjectMaskForFrame,
} from "./subject-occlusion";

export const renderOverlayLayerWithEffects = async (
  ctx: CanvasRenderingContext2D,
  clipId: string,
  canvasWidth: number,
  canvasHeight: number,
  render: (layerCtx: CanvasRenderingContext2D) => void | Promise<void>,
): Promise<void> => {
  if (!clipNeedsFrameProcessing(clipId)) {
    await render(ctx);
    return;
  }
  const layerCanvas = document.createElement("canvas");
  layerCanvas.width = canvasWidth;
  layerCanvas.height = canvasHeight;
  const layerCtx = layerCanvas.getContext("2d");
  if (!layerCtx) return;
  await render(layerCtx);
  const prepared = await preparePreviewFrame(
    clipId,
    layerCanvas,
    false,
    true,
  );
  try {
    ctx.drawImage(prepared.frame, 0, 0, canvasWidth, canvasHeight);
  } finally {
    prepared.cleanup();
  }
};

export const renderShapeClipWithEffects = async (
  ctx: CanvasRenderingContext2D,
  shapeClip: ShapeClip | SVGClip | StickerClip,
  canvasWidth: number,
  canvasHeight: number,
  time: number,
): Promise<void> => {
  await renderOverlayLayerWithEffects(
    ctx,
    shapeClip.id,
    canvasWidth,
    canvasHeight,
    (layerCtx) =>
      renderShapeClipToCanvas(
        layerCtx,
        shapeClip,
        canvasWidth,
        canvasHeight,
        time,
      ),
  );
};

export const renderTextClipWithSubjectMask = async (
  ctx: CanvasRenderingContext2D,
  textClip: TextClip,
  canvasWidth: number,
  canvasHeight: number,
  time: number,
  subjectFrame: ImageBitmap | null,
  realtime = true,
  streamId = "editor:text-behind-subject:canvas",
): Promise<void> => {
  let subjectMask: SegmentationResult | null = null;
  if (textClip.behindSubject && subjectFrame) {
    const segEngine = getPersonSegmentationEngine();
    if (segEngine.isInitialized()) {
      subjectMask = await getSubjectMaskForFrame(
        subjectFrame,
        time,
        realtime,
        streamId,
      );
    }
    // During the worker's first realtime inference, keep the text hidden
    // instead of flashing it in front of the subject for one or two frames.
    if (!subjectMask && realtime) return;
  }

  const renderTextLayer = (targetCtx: CanvasRenderingContext2D) =>
    renderOverlayLayerWithEffects(
      targetCtx,
      textClip.id,
      canvasWidth,
      canvasHeight,
      (layerCtx) =>
        renderTextClipToCanvas(
          layerCtx,
          textClip,
          canvasWidth,
          canvasHeight,
          time,
        ),
    );

  if (!textClip.behindSubject || !subjectFrame || !subjectMask) {
    await renderTextLayer(ctx);
    return;
  }

  const textLayerCanvas = document.createElement("canvas");
  textLayerCanvas.width = canvasWidth;
  textLayerCanvas.height = canvasHeight;
  const textLayerCtx = textLayerCanvas.getContext("2d");
  if (!textLayerCtx) return;
  await renderTextLayer(textLayerCtx);
  if (
    !applySubjectOcclusionMask(
      textLayerCtx,
      subjectFrame,
      canvasWidth,
      canvasHeight,
      subjectMask,
    )
  ) {
    return;
  }
  ctx.drawImage(textLayerCanvas, 0, 0, canvasWidth, canvasHeight);
};
