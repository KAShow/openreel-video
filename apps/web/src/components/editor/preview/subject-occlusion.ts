import {
  createMotionAwareOcclusionMask,
  getMediaItemCapabilities,
  getPersonSegmentationEngine,
  type MediaItem,
  type SegmentationResult,
  type TextClip,
  type Track,
} from "@openreel/core";

export const hasBehindSubjectText = (textClips: TextClip[]): boolean =>
  textClips.some((textClip) => textClip.behindSubject);

export const getBehindSubjectStreamId = (
  tracks: readonly Track[],
  time: number,
  getMediaItem: (mediaId: string) => MediaItem | undefined,
): string => {
  const activeSourceIds = tracks
    .filter((track) => !track.hidden)
    .flatMap((track) =>
      track.clips
        .filter(
          (clip) =>
            time >= clip.startTime &&
            time < clip.startTime + clip.duration &&
            getMediaItemCapabilities(getMediaItem(clip.mediaId)).visual,
        )
        .map((clip) => clip.id),
    )
    .sort();
  return `editor:text-behind-subject:${activeSourceIds.join("|") || "canvas"}`;
};

const subjectMaskRequestCache = new WeakMap<
  ImageBitmap,
  Map<string, Promise<SegmentationResult | null>>
>();
const subjectOcclusionMaskCache = new WeakMap<
  ImageBitmap,
  WeakMap<SegmentationResult, ImageData>
>();

export const getSubjectMaskForFrame = (
  subjectFrame: ImageBitmap,
  time: number,
  realtime: boolean,
  streamId: string,
): Promise<SegmentationResult | null> => {
  let requests = subjectMaskRequestCache.get(subjectFrame);
  if (!requests) {
    requests = new Map();
    subjectMaskRequestCache.set(subjectFrame, requests);
  }
  const key = `${streamId}:${time}:${Number(realtime)}`;
  const cached = requests.get(key);
  if (cached) return cached;
  const request = getPersonSegmentationEngine().getPersonMask(subjectFrame, {
    timestampMs: time * 1000,
    streamId,
    realtime,
  });
  requests.set(key, request);
  return request;
};

export const createTransparentCanvasSource = (
  width: number,
  height: number,
): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.clearRect(0, 0, width, height);
  return canvas;
};

export const createTransparentImageBitmap = async (
  width: number,
  height: number,
): Promise<ImageBitmap | null> => {
  try {
    return await createImageBitmap(createTransparentCanvasSource(width, height));
  } catch {
    return null;
  }
};

export const captureSubjectFrame = async (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): Promise<ImageBitmap | null> => {
  try {
    return await createImageBitmap(
      ctx.canvas as HTMLCanvasElement | OffscreenCanvas,
      0,
      0,
      width,
      height,
    );
  } catch {
    return null;
  }
};

export const applySubjectOcclusionMask = (
  textCtx: CanvasRenderingContext2D,
  subjectFrame: ImageBitmap | null,
  canvasWidth: number,
  canvasHeight: number,
  maskResult: SegmentationResult | null,
): boolean => {
  if (!subjectFrame || !maskResult) return false;

  try {
    const maskCanvas = new OffscreenCanvas(maskResult.width, maskResult.height);
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return false;

    let occlusionMask = subjectOcclusionMaskCache
      .get(subjectFrame)
      ?.get(maskResult);
    if (!occlusionMask) {
      occlusionMask = maskResult.mask;
    }
    if (
      !subjectOcclusionMaskCache.get(subjectFrame)?.has(maskResult) &&
      maskResult.referenceWidth > 0 &&
      maskResult.referenceHeight > 0 &&
      maskResult.referenceRgba.length ===
        maskResult.referenceWidth * maskResult.referenceHeight * 4
    ) {
      try {
        const currentReferenceCanvas = new OffscreenCanvas(
          maskResult.referenceWidth,
          maskResult.referenceHeight,
        );
        const currentReferenceCtx = currentReferenceCanvas.getContext("2d", {
          willReadFrequently: true,
        });
        if (currentReferenceCtx) {
          currentReferenceCtx.drawImage(
            subjectFrame,
            0,
            0,
            maskResult.referenceWidth,
            maskResult.referenceHeight,
          );
          const currentRgba = currentReferenceCtx.getImageData(
            0,
            0,
            maskResult.referenceWidth,
            maskResult.referenceHeight,
          ).data;
          const motionAwareMaskRgba = createMotionAwareOcclusionMask(
            maskResult.mask.data,
            maskResult.width,
            maskResult.height,
            maskResult.referenceRgba,
            currentRgba,
            maskResult.referenceWidth,
            maskResult.referenceHeight,
          );
          occlusionMask = new ImageData(maskResult.width, maskResult.height);
          occlusionMask.data.set(motionAwareMaskRgba);
        }
      } catch {
        // Keep using the exact matte if frame readback or motion estimation
        // fails. Dropping the whole text layer here creates a visible blink.
        occlusionMask = maskResult.mask;
      }
    }

    let frameMasks = subjectOcclusionMaskCache.get(subjectFrame);
    if (!frameMasks) {
      frameMasks = new WeakMap();
      subjectOcclusionMaskCache.set(subjectFrame, frameMasks);
    }
    frameMasks.set(maskResult, occlusionMask);

    maskCtx.putImageData(occlusionMask, 0, 0);
    textCtx.save();
    textCtx.globalCompositeOperation = "destination-out";
    textCtx.imageSmoothingEnabled = true;
    textCtx.imageSmoothingQuality = "high";
    textCtx.drawImage(maskCanvas, 0, 0, canvasWidth, canvasHeight);
    textCtx.restore();
    return true;
  } catch {
    return false;
  }
};
