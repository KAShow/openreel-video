/**
 * Preview playback meter (Hawsh build): how many frames the preview really draws per second, the
 * longest gap between two frames, and which drawing path ran ("native" = the browser's own video
 * element, fast; "multi" = frame-by-frame decoding, used for effects, speed changes and layers).
 *
 * `?perf=1` shows a small live readout over the editor. Every playback of 3 seconds or more also
 * sends one summary line to `editor_logs` (kind "usage", event "playback"), so we can see how the
 * editor runs on the phones people actually use, not only on our computers.
 */
import { useSyncExternalStore } from "react";
import { logEvent } from "./logger";

export type PreviewPath = "native" | "multi";

export interface PlaybackStats {
  path: PreviewPath;
  /** Frames drawn per second over the whole playback so far. */
  fps: number;
  /** Frames drawn per second over the last second (the live readout). */
  recentFps: number;
  /** Longest gap between two drawn frames, in milliseconds. */
  longestGapMs: number;
  frames: number;
  seconds: number;
}

const MIN_LOGGED_SECONDS = 3;
const RECENT_WINDOW_MS = 1000;

interface Run {
  path: PreviewPath;
  startedAt: number;
  lastAt: number;
  frames: number;
  longestGapMs: number;
  recent: number[];
}

let run: Run | null = null;
let shown: PlaybackStats | null = null;
let lastEmit = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function snapshot(r: Run, now: number): PlaybackStats {
  const seconds = Math.max(0.001, (now - r.startedAt) / 1000);
  const recentFrom = now - RECENT_WINDOW_MS;
  const recent = r.recent.filter((t) => t >= recentFrom).length;
  return {
    path: r.path,
    // N frames span N-1 intervals.
    fps: Math.max(0, r.frames - 1) / seconds,
    // At least half a second of window, so one early frame does not read as hundreds per second.
    recentFps: recent / Math.max(0.5, Math.min(1, seconds)),
    longestGapMs: r.longestGapMs,
    frames: r.frames,
    seconds,
  };
}

/** Call once for every frame the preview puts on screen while playing. */
export function markPreviewFrame(path: PreviewPath, now: number = performance.now()): void {
  if (!run || run.path !== path) {
    if (run) finishPreviewPlayback();
    run = { path, startedAt: now, lastAt: now, frames: 0, longestGapMs: 0, recent: [] };
  }
  if (run.frames > 0) run.longestGapMs = Math.max(run.longestGapMs, now - run.lastAt);
  run.frames++;
  run.lastAt = now;
  run.recent.push(now);
  if (run.recent.length > 240) run.recent.splice(0, run.recent.length - 240);
  if (now - lastEmit >= 500) {
    lastEmit = now;
    shown = snapshot(run, now);
    emit();
  }
}

/** Call when playback stops (pause, end, or the preview going away). Logs the summary once. */
export function finishPreviewPlayback(): PlaybackStats | null {
  const r = run;
  run = null;
  if (!r || r.frames < 2) return null;
  const stats = snapshot(r, r.lastAt);
  shown = stats;
  emit();
  if (stats.seconds >= MIN_LOGGED_SECONDS) {
    logEvent("usage", {
      event: "playback",
      path: stats.path,
      fps: Math.round(stats.fps * 10) / 10,
      longest_gap_ms: Math.round(stats.longestGapMs),
      seconds: Math.round(stats.seconds * 10) / 10,
      ...deviceInfo(),
      ...extraInfo(),
    });
  }
  return stats;
}

let extra: () => Record<string, unknown> = () => ({});
/** Lets the preview add what it knows (resolution, effects in use) to the summary line. */
export function setPlaybackContext(read: () => Record<string, unknown>): void {
  extra = read;
}
function extraInfo(): Record<string, unknown> {
  try { return extra(); } catch { return {}; }
}

function deviceInfo(): Record<string, unknown> {
  if (typeof navigator === "undefined") return {};
  const ua = navigator.userAgent;
  const device = /iPhone|iPad/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : /Mac/.test(ua) ? "mac" : /Windows/.test(ua) ? "windows" : "other";
  return {
    device,
    cores: navigator.hardwareConcurrency ?? null,
    dpr: typeof window !== "undefined" ? Math.round(window.devicePixelRatio * 100) / 100 : null,
    screen: typeof window !== "undefined" ? `${window.screen.width}x${window.screen.height}` : null,
  };
}

/** Whether the live readout is on (`?perf=1` anywhere in the address). */
export function perfReadoutEnabled(): boolean {
  if (typeof location === "undefined") return false;
  return /[?&]perf=1\b/.test(location.search) || /[?&]perf=1\b/.test(location.hash);
}

export function usePlaybackStats(): PlaybackStats | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => shown,
    () => null,
  );
}

/** Test helper. */
export function resetPerfMeter(): void {
  run = null;
  shown = null;
  lastEmit = 0;
  extra = () => ({});
}
