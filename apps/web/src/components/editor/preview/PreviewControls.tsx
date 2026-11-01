import React, { useState } from "react";
import type { ProjectSettings } from "@openreel/core";
import {
  Loader2,
  Magnet,
  Maximize2,
  Minimize2,
  Monitor,
  Move,
  Pause,
  Play,
  Proportions,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ZoomIn,
} from "@/icons/lucide-compat";
import {
  ToolcraftButton as Button,
  ToolcraftIconButton as IconButton,
} from "@openreel/ui";
import { formatFrameTimecode } from "../../../utils/frame-timecode";
import { PreviewTimecode } from "../PreviewTimecode";
import {
  PREVIEW_QUALITY_OPTIONS,
  type PreviewQuality,
} from "./preview-resolution";

const ASPECT_PRESETS: Array<{
  label: string;
  width: number;
  height: number;
}> = [
  { label: "16:9", width: 1920, height: 1080 },
  { label: "9:16", width: 1080, height: 1920 },
  { label: "1:1", width: 1080, height: 1080 },
  { label: "4:5", width: 1080, height: 1350 },
  { label: "4:3", width: 1440, height: 1080 },
  { label: "21:9", width: 2560, height: 1080 },
];

const ZOOM_OPTIONS = [
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "100%", value: 1 },
  { label: "125%", value: 1.25 },
  { label: "150%", value: 1.5 },
  { label: "200%", value: 2 },
];

const aspectLabelFor = (width: number, height: number): string => {
  const ratio = width / height;
  let closest = ASPECT_PRESETS[0];
  let smallestDelta = Infinity;
  for (const preset of ASPECT_PRESETS) {
    const delta = Math.abs(preset.width / preset.height - ratio);
    if (delta < smallestDelta) {
      smallestDelta = delta;
      closest = preset;
    }
  }
  return smallestDelta < 0.01 ? closest.label : "Custom";
};

export interface PreviewControlsProps {
  settings: Pick<ProjectSettings, "width" | "height" | "frameRate">;
  playheadPosition: number;
  actualEndTime: number;
  playbackLockedReason: string | null;
  isPlaying: boolean;
  isExporting: boolean;
  loopEnabled: boolean;
  previewLoopRange: { start: number; end: number } | null;
  isMuted: boolean;
  playbackQuality: PreviewQuality;
  zoomLevel: number;
  canvasSnappingEnabled: boolean;
  showCompositionGrid: boolean;
  showSafeMargins: boolean;
  isMaximized: boolean;
  isFullscreen: boolean;
  onScrubClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onTogglePlayback: () => void;
  onToggleLoop: () => void;
  onMutedChange: (muted: boolean) => void;
  onAspectRatioChange: (width: number, height: number) => void;
  onPlaybackQualityChange: (quality: PreviewQuality) => void;
  onZoomLevelChange: (zoom: number) => void;
  onToggleCanvasSnapping: () => void;
  onShowCompositionGridChange: (visible: boolean) => void;
  onShowSafeMarginsChange: (visible: boolean) => void;
  onFullscreen: () => void;
  onMaximize: () => void;
}

export const PreviewControls: React.FC<PreviewControlsProps> = ({
  settings,
  playheadPosition,
  actualEndTime,
  playbackLockedReason,
  isPlaying,
  isExporting,
  loopEnabled,
  previewLoopRange,
  isMuted,
  playbackQuality,
  zoomLevel,
  canvasSnappingEnabled,
  showCompositionGrid,
  showSafeMargins,
  isMaximized,
  isFullscreen,
  onScrubClick,
  onSkipBack,
  onSkipForward,
  onTogglePlayback,
  onToggleLoop,
  onMutedChange,
  onAspectRatioChange,
  onPlaybackQualityChange,
  onZoomLevelChange,
  onToggleCanvasSnapping,
  onShowCompositionGridChange,
  onShowSafeMarginsChange,
  onFullscreen,
  onMaximize,
}) => {
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showAspectMenu, setShowAspectMenu] = useState(false);
  const progressPercentage =
    actualEndTime > 0 ? (playheadPosition / actualEndTime) * 100 : 0;

  return (
    <div
      className={`shrink-0 border-t border-border transition-all duration-300 ${
        isMaximized || isFullscreen
          ? "z-50 bg-bg-1 backdrop-blur-sm"
          : "z-20 bg-bg-1"
      }`}
    >
      <div
        className="h-1.5 bg-bg-2 cursor-pointer group hover:h-2.5 transition-all relative"
        onClick={onScrubClick}
      >
        <div
          className="h-full bg-accent relative pointer-events-none shadow-glow"
          style={{ width: `${progressPercentage}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity transform scale-0 group-hover:scale-100 duration-100 border border-black/20" />
        </div>
      </div>

      <div data-preview-transport className="min-h-12 px-3 py-1 flex flex-wrap items-center gap-2">
        <div data-preview-timecode className="flex items-center gap-2">
          <PreviewTimecode
            position={playheadPosition}
            duration={actualEndTime}
            frameRate={settings.frameRate}
            disabled={Boolean(playbackLockedReason) || isExporting}
          />
        </div>

        <div data-preview-playback className="flex items-center gap-4 mx-auto">
          <IconButton
            label="Skip back 5s"
            icon={<SkipBack size={18} />}
            variant="ghost"
            size="sm"
            onClick={onSkipBack}
            className="w-8 h-8 grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
          />
          <IconButton
            label={playbackLockedReason ?? (isPlaying ? "Pause" : "Play")}
            icon={
              isPlaying ? (
                <Pause size={18} fill="currentColor" />
              ) : playbackLockedReason ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Play size={18} fill="currentColor" className="ml-0.5" />
              )
            }
            variant="ghost"
            size="md"
            onClick={onTogglePlayback}
            isDisabled={Boolean(playbackLockedReason)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              playbackLockedReason
                ? "bg-bg-2 text-fg-muted cursor-not-allowed"
                : "bg-bg-2 text-fg hover:bg-bg-3"
            }`}
          />
          <IconButton
            label="Skip forward 5s"
            icon={<SkipForward size={18} />}
            variant="ghost"
            size="sm"
            onClick={onSkipForward}
            className="w-8 h-8 grid place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg transition-colors"
          />
        </div>

        <div data-preview-tools className="flex gap-1.5 items-center">
          <IconButton
            label={loopEnabled ? "Disable preview loop" : "Enable preview loop"}
            title={`Loop ${formatFrameTimecode(previewLoopRange?.start ?? 0, settings.frameRate)} to ${formatFrameTimecode(previewLoopRange?.end ?? 0, settings.frameRate)} • I: mark start • O: mark end • Shift+L: toggle`}
            icon={<Repeat size={16} />}
            aria-pressed={loopEnabled}
            variant="ghost"
            size="sm"
            onClick={onToggleLoop}
            isDisabled={actualEndTime <= 0 || isExporting}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${loopEnabled ? "bg-accent/15 text-accent" : "bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg"}`}
          />
          <IconButton
            label={isMuted ? "Unmute" : "Mute"}
            icon={isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            variant="ghost"
            size="sm"
            onClick={() => onMutedChange(!isMuted)}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              isMuted
                ? "bg-bg-2 text-status-error"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />

          <div className="relative">
            <Button
              label="Aspect ratio"
              variant="ghost"
              onClick={() => setShowAspectMenu(!showAspectMenu)}
              className="flex items-center gap-1.5 rounded-[7px] bg-bg-2 px-[11px] py-[7px] text-[12px] font-medium text-fg-2 hover:bg-bg-3 hover:text-fg transition-colors"
            >
              <div className="flex items-center gap-1">
                <Proportions size={12} />
                <span>{aspectLabelFor(settings.width, settings.height)}</span>
              </div>
            </Button>
            {showAspectMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowAspectMenu(false)} />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-bg-elev border border-border rounded-md shadow-md py-1 z-50 min-w-[120px]">
                  {ASPECT_PRESETS.map((opt) => {
                    const isActive =
                      settings.width === opt.width && settings.height === opt.height;
                    return (
                      <Button
                        key={opt.label}
                        label={`${opt.label} ${opt.width} by ${opt.height}`}
                        variant="ghost"
                        onClick={() => {
                          onAspectRatioChange(opt.width, opt.height);
                          setShowAspectMenu(false);
                        }}
                        className={`w-full px-3 py-1.5 text-[11px] font-mono text-left hover:bg-hover transition-colors flex items-center justify-between gap-3 ${
                          isActive ? "text-accent" : "text-fg-2"
                        }`}
                      >
                        <span>{opt.label}</span>
                        <span className="text-fg-3 text-[10px]">{opt.width}×{opt.height}</span>
                      </Button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <Button
              label="Playback quality"
              variant="ghost"
              onClick={() => setShowQualityMenu(!showQualityMenu)}
              className="rounded-[7px] bg-bg-2 px-[11px] py-[7px] text-[12px] font-medium text-fg-2 hover:bg-bg-3 hover:text-fg transition-colors"
            >
              {PREVIEW_QUALITY_OPTIONS.find((o) => o.value === playbackQuality)?.label ?? "Auto"}
            </Button>
            {showQualityMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowQualityMenu(false)} />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-bg-elev border border-border rounded-md shadow-md py-1 z-50 min-w-[80px]">
                  {PREVIEW_QUALITY_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      label={opt.label}
                      variant="ghost"
                      onClick={() => {
                        onPlaybackQualityChange(opt.value);
                        setShowQualityMenu(false);
                      }}
                      className={`w-full px-3 py-1.5 text-[11px] font-mono text-left hover:bg-hover transition-colors ${
                        playbackQuality === opt.value ? "text-accent" : "text-fg-2"
                      }`}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <Button
              label="Preview Zoom"
              variant="ghost"
              onClick={() => setShowZoomMenu(!showZoomMenu)}
              className="flex items-center gap-1.5 rounded-[7px] bg-bg-2 px-[11px] py-[7px] text-[12px] font-medium text-fg-2 hover:bg-bg-3 hover:text-fg transition-colors"
            >
              <div className="flex items-center gap-1">
                <ZoomIn size={12} />
                <span>{Math.round(zoomLevel * 100)}%</span>
              </div>
            </Button>
            {showZoomMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowZoomMenu(false)} />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-bg-elev border border-border rounded-md shadow-md py-1 z-50 min-w-[80px]">
                  {ZOOM_OPTIONS.map((opt) => (
                    <Button
                      key={opt.value}
                      label={opt.label}
                      variant="ghost"
                      onClick={() => {
                        onZoomLevelChange(opt.value);
                        setShowZoomMenu(false);
                      }}
                      className={`w-full px-3 py-1.5 text-[11px] font-mono text-left hover:bg-hover transition-colors ${
                        zoomLevel === opt.value ? "text-accent" : "text-fg-2"
                      }`}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>

          <IconButton
            label="Canvas snapping"
            icon={<Magnet size={16} />}
            variant="ghost"
            size="sm"
            aria-pressed={canvasSnappingEnabled}
            onClick={onToggleCanvasSnapping}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              canvasSnappingEnabled
                ? "bg-accent-soft text-accent"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />
          <IconButton
            label="Composition grid"
            icon={<Move size={16} />}
            variant="ghost"
            size="sm"
            aria-pressed={showCompositionGrid}
            onClick={() => onShowCompositionGridChange(!showCompositionGrid)}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              showCompositionGrid
                ? "bg-accent-soft text-accent"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />
          <IconButton
            label="Title and action safe margins"
            icon={<Proportions size={16} />}
            variant="ghost"
            size="sm"
            aria-pressed={showSafeMargins}
            onClick={() => onShowSafeMarginsChange(!showSafeMargins)}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              showSafeMargins
                ? "bg-accent-soft text-accent"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />
          <IconButton
            label={isFullscreen ? "Exit Full Screen" : "Full Screen"}
            icon={<Monitor size={16} />}
            variant="ghost"
            size="sm"
            onClick={onFullscreen}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              isFullscreen
                ? "bg-accent-soft text-accent"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />
          <IconButton
            label={isMaximized ? "Restore Size" : "Maximize Preview"}
            icon={isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            variant="ghost"
            size="sm"
            onClick={onMaximize}
            className={`w-[34px] h-[34px] grid place-items-center rounded-[7px] transition-colors ${
              isMaximized
                ? "bg-accent-soft text-accent"
                : "bg-bg-2 text-fg-2 hover:text-fg hover:bg-bg-3"
            }`}
          />
        </div>
      </div>
    </div>
  );
};
