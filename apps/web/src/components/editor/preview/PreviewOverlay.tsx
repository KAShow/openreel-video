import React from "react";
import { Move } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import type { HandlePosition } from "./types";

export interface PreviewOverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

type OverlayTone = "primary" | "cyan" | "green";

const TONE_CLASSES: Record<
  OverlayTone,
  { border: string; move: string; lock: string; handle: string }
> = {
  primary: {
    border: "border-primary",
    move: "bg-primary/80 hover:bg-primary",
    lock: "bg-primary",
    handle: "border-primary hover:bg-primary",
  },
  cyan: {
    border: "border-cyan-500",
    move: "bg-cyan-500/80 hover:bg-cyan-500",
    lock: "bg-cyan-500",
    handle: "border-cyan-500 hover:bg-cyan-500",
  },
  green: {
    border: "border-green-500",
    move: "bg-green-500/80 hover:bg-green-500",
    lock: "bg-green-500",
    handle: "border-green-500 hover:bg-green-500",
  },
};

const HANDLES: Array<{ position: HandlePosition; className: string }> = [
  { position: "nw", className: "-left-2 -top-2 w-4 h-4 cursor-nw-resize" },
  { position: "ne", className: "-right-2 -top-2 w-4 h-4 cursor-ne-resize" },
  { position: "sw", className: "-left-2 -bottom-2 w-4 h-4 cursor-sw-resize" },
  { position: "se", className: "-right-2 -bottom-2 w-4 h-4 cursor-se-resize" },
  {
    position: "n",
    className: "left-1/2 -translate-x-1/2 -top-2 w-6 h-4 cursor-n-resize",
  },
  {
    position: "s",
    className: "left-1/2 -translate-x-1/2 -bottom-2 w-6 h-4 cursor-s-resize",
  },
  {
    position: "w",
    className: "top-1/2 -translate-y-1/2 -left-2 w-4 h-6 cursor-w-resize",
  },
  {
    position: "e",
    className: "top-1/2 -translate-y-1/2 -right-2 w-4 h-6 cursor-e-resize",
  },
];

interface TransformOverlayProps {
  bounds: PreviewOverlayBounds;
  tone: OverlayTone;
  moveTitle: string;
  hideControls: boolean;
  lockAspectRatio: boolean;
  showBorder?: boolean;
  responsiveBorder?: boolean;
  onMoveMouseDown: (event: React.MouseEvent) => void;
  onHandleMouseDown: (
    event: React.MouseEvent,
    handle: HandlePosition,
  ) => void;
  onLockAspectRatioChange: (locked: boolean) => void;
}

export const TransformOverlay: React.FC<TransformOverlayProps> = ({
  bounds,
  tone,
  moveTitle,
  hideControls,
  lockAspectRatio,
  showBorder = true,
  responsiveBorder = true,
  onMoveMouseDown,
  onHandleMouseDown,
  onLockAspectRatioChange,
}) => {
  const classes = TONE_CLASSES[tone];
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }}
    >
      {showBorder && (
        <div
          className={`absolute inset-0 ${classes.border} pointer-events-none ${
            responsiveBorder
              ? hideControls
                ? "border"
                : "border-2"
              : "border-2"
          }`}
        />
      )}

      {!hideControls && (
        <>
          <div
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 ${classes.move} rounded-full flex items-center justify-center cursor-move pointer-events-auto transition-colors`}
            onMouseDown={onMoveMouseDown}
            title={moveTitle}
          >
            <Move size={14} className="text-white" />
          </div>

          <Button
            label={lockAspectRatio ? "Unlock aspect ratio" : "Lock aspect ratio"}
            variant="ghost"
            className={`absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] rounded pointer-events-auto transition-colors ${
              lockAspectRatio
                ? `${classes.lock} text-white`
                : "bg-background-tertiary text-text-secondary border border-border hover:bg-background-elevated"
            }`}
            onClick={() => onLockAspectRatioChange(!lockAspectRatio)}
          >
            {lockAspectRatio ? "🔒 Locked" : "🔓 Free"}
          </Button>

          {HANDLES.map(({ position, className }) => (
            <div
              key={position}
              className={`absolute ${className} bg-white border-2 ${classes.handle} rounded-sm pointer-events-auto hover:border-white transition-colors`}
              onMouseDown={(event) => onHandleMouseDown(event, position)}
            />
          ))}
        </>
      )}
    </div>
  );
};

interface PreviewGuidesProps {
  showCompositionGrid: boolean;
  showSafeMargins: boolean;
  cropMode: boolean;
  snapGuides: { x: number | null; y: number | null };
}

export const PreviewGuides: React.FC<PreviewGuidesProps> = ({
  showCompositionGrid,
  showSafeMargins,
  cropMode,
  snapGuides,
}) => (
  <>
    {showCompositionGrid && !cropMode ? (
      <div
        aria-label="Composition grid"
        className="pointer-events-none absolute inset-0 z-20"
      >
        {[1, 2].map((line) => (
          <React.Fragment key={line}>
            <span
              className="absolute inset-y-0 w-px bg-white/45 shadow-[0_0_1px_rgba(0,0,0,0.9)]"
              style={{ left: `${(line / 3) * 100}%` }}
            />
            <span
              className="absolute inset-x-0 h-px bg-white/45 shadow-[0_0_1px_rgba(0,0,0,0.9)]"
              style={{ top: `${(line / 3) * 100}%` }}
            />
          </React.Fragment>
        ))}
      </div>
    ) : null}

    {showSafeMargins && !cropMode ? (
      <div
        aria-label="Title and action safe margins"
        className="pointer-events-none absolute inset-0 z-20"
      >
        <span className="absolute inset-[5%] border border-dashed border-white/60 shadow-[0_0_1px_rgba(0,0,0,0.9)]" />
        <span className="absolute inset-[10%] border border-white/75 shadow-[0_0_1px_rgba(0,0,0,0.9)]" />
        <span className="absolute left-[10%] top-[10%] rounded-br bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/80">
          Title safe
        </span>
      </div>
    ) : null}

    {snapGuides.x !== null && !cropMode ? (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 z-30 w-px bg-accent shadow-[0_0_3px_var(--accent)]"
        style={{ left: `${snapGuides.x * 100}%` }}
      />
    ) : null}
    {snapGuides.y !== null && !cropMode ? (
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 z-30 h-px bg-accent shadow-[0_0_3px_var(--accent)]"
        style={{ top: `${snapGuides.y * 100}%` }}
      />
    ) : null}
  </>
);

export const SubtitleSelectionOverlay: React.FC<{
  bounds: PreviewOverlayBounds;
}> = ({ bounds }) => (
  <div
    className="absolute pointer-events-none"
    style={{
      left: bounds.x,
      top: bounds.y,
      width: bounds.width,
      height: bounds.height,
    }}
  >
    <div className="absolute inset-0 border-2 border-yellow-500 rounded-lg pointer-events-none animate-pulse" />
    <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-yellow-500 rounded text-[10px] font-medium text-black whitespace-nowrap">
      Subtitle Selected - Edit in Inspector
    </div>
  </div>
);
