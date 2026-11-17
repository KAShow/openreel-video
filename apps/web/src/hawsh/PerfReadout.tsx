/** Live preview frame rate over the editor, only with `?perf=1` (see perf.ts). */
import React from "react";
import { perfReadoutEnabled, usePlaybackStats } from "./perf";

export const PerfReadout: React.FC = () => {
  const stats = usePlaybackStats();
  if (!perfReadoutEnabled()) return null;
  return (
    <div className="pointer-events-none fixed left-2 top-14 z-[100] rounded-md bg-black/75 px-2 py-1 font-mono text-[11px] leading-4 text-white" dir="ltr" data-testid="perf-readout" data-no-translate="">
      {stats ? (
        <>
          <div>{stats.path} · {stats.recentFps.toFixed(0)} fps</div>
          <div>avg {stats.fps.toFixed(1)} · max gap {stats.longestGapMs.toFixed(0)}ms</div>
        </>
      ) : <div>press play</div>}
    </div>
  );
};
