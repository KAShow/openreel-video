import { useRef, useState } from "react";
import type { HandlePosition, InteractionMode } from "./types";

export const STORE_UPDATE_THROTTLE_MS = 32;

export const usePreviewInteractions = () => {
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("none");
  const [activeHandle, setActiveHandle] = useState<HandlePosition | null>(null);
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const interactionStartRef = useRef<{
    x: number;
    y: number;
    transform: { x: number; y: number; scaleX: number; scaleY: number };
  } | null>(null);
  const pendingTransformRef = useRef<{
    clipId: string;
    transform: {
      position?: { x: number; y: number };
      scale?: { x: number; y: number };
    };
  } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);
  const lastStoreUpdateRef = useRef(0);
  const [liveTransform, setLiveTransform] = useState<{
    position: { x: number; y: number };
    scale: { x: number; y: number };
  } | null>(null);
  const [canvasSnapGuides, setCanvasSnapGuides] = useState<{
    x: number | null;
    y: number | null;
  }>({ x: null, y: null });
  const [interactionTargetType, setInteractionTargetType] = useState<
    "clip" | "text-clip" | "shape-clip" | null
  >(null);
  const interactionTargetIdRef = useRef<string | null>(null);

  return {
    interactionMode,
    setInteractionMode,
    activeHandle,
    setActiveHandle,
    lockAspectRatio,
    setLockAspectRatio,
    interactionStartRef,
    pendingTransformRef,
    rafIdRef,
    isInteractingRef,
    lastStoreUpdateRef,
    liveTransform,
    setLiveTransform,
    canvasSnapGuides,
    setCanvasSnapGuides,
    interactionTargetType,
    setInteractionTargetType,
    interactionTargetIdRef,
  };
};
