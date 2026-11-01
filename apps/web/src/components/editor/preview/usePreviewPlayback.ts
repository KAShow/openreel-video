import { useCallback, useEffect, useRef } from "react";

interface PlaybackMediaResource {
  input: { [Symbol.dispose]?: () => void };
  sink: unknown;
  mediaId: string;
  clipId: string;
  trackIndex: number;
}

interface UsePreviewPlaybackOptions {
  playbackRate: number;
  isPlaying: boolean;
  playheadPosition: number;
  motionAssetBitmapCacheRef: { current: Map<string, ImageBitmap> };
}

export const usePreviewPlayback = ({
  playbackRate,
  isPlaying,
  playheadPosition,
  motionAssetBitmapCacheRef,
}: UsePreviewPlaybackOptions) => {
  const rateRef = useRef(playbackRate);
  const startPositionRef = useRef(playheadPosition);
  const playbackResourcesRef = useRef<Map<string, PlaybackMediaResource>>(
    new Map(),
  );
  const imageBitmapCacheRef = useRef<Map<string, ImageBitmap>>(new Map());
  const failedImageDecodesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    rateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    if (!isPlaying) {
      startPositionRef.current = playheadPosition;
    }
  }, [isPlaying, playheadPosition]);

  const cleanupPlaybackResources = useCallback(() => {
    const resources = playbackResourcesRef.current;
    for (const [, resource] of resources) {
      resource.input[Symbol.dispose]?.();
    }
    playbackResourcesRef.current = new Map();

    for (const [, bitmap] of imageBitmapCacheRef.current) {
      bitmap.close();
    }
    imageBitmapCacheRef.current = new Map();

    for (const [, bitmap] of motionAssetBitmapCacheRef.current) {
      bitmap.close();
    }
    motionAssetBitmapCacheRef.current = new Map();
  }, [motionAssetBitmapCacheRef]);

  return {
    rateRef,
    startPositionRef,
    playbackResourcesRef,
    imageBitmapCacheRef,
    failedImageDecodesRef,
    cleanupPlaybackResources,
  };
};
