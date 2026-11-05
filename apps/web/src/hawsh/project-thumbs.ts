/**
 * Thumbnails for the saved-projects page: a frame of each project's first clip on the timeline. Made
 * on demand from the media kept in this browser, so projects saved before this existed get one too,
 * and cached per project until its first clip changes.
 */
import type { Project } from "@openreel/core";
import { autoSaveManager } from "../services/auto-save";
import { loadMediaBlob } from "../services/media-storage";

const THUMB_WIDTH = 480;
const QUALITY = 0.72;
const VIDEO_TIMEOUT_MS = 8000;
const cacheKey = (projectId: string) => `hawsh-project-thumb:${projectId}`;

export interface ThumbSource { mediaId: string; type: "video" | "image"; time: number; thumbnailUrl?: string | null }

/** The earliest visible video or image clip on the timeline, and the source time of its first frame. */
export function firstVisualClip(project: Pick<Project, "timeline" | "mediaLibrary">): ThumbSource | null {
  const media = new Map(project.mediaLibrary.items.map((m) => [m.id, m]));
  let best: { start: number; source: ThumbSource } | null = null;
  for (const track of project.timeline.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      const item = media.get(clip.mediaId);
      if (!item || (item.type !== "video" && item.type !== "image")) continue;
      if (best && clip.startTime >= best.start) continue;
      best = { start: clip.startTime, source: { mediaId: item.id, type: item.type, time: clip.inPoint ?? 0, thumbnailUrl: item.thumbnailUrl } };
    }
  }
  return best?.source ?? null;
}

const signature = (s: ThumbSource) => `${s.mediaId}@${s.time.toFixed(2)}`;

function readCache(projectId: string): { sig: string; url: string } | null {
  try {
    const raw = localStorage.getItem(cacheKey(projectId));
    return raw ? JSON.parse(raw) as { sig: string; url: string } : null;
  } catch { return null; }
}

function writeCache(projectId: string, sig: string, url: string): void {
  try { localStorage.setItem(cacheKey(projectId), JSON.stringify({ sig, url })); } catch { /* storage full: it is made again next time */ }
}

export function forgetProjectThumbnail(projectId: string): void {
  try { localStorage.removeItem(cacheKey(projectId)); } catch { /* nothing to forget */ }
}

function drawToJpeg(source: HTMLVideoElement | ImageBitmap, width: number, height: number): string | null {
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(width, THUMB_WIDTH);
  canvas.height = Math.round((canvas.width / width) * height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", QUALITY);
}

async function imageThumb(blob: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(blob);
  try { return drawToJpeg(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
}

function videoThumb(blob: Blob, time: number): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), VIDEO_TIMEOUT_MS);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadeddata = () => { video.currentTime = Math.min(time + 0.05, Math.max(0, (video.duration || 0) - 0.05)); };
    video.onseeked = () => {
      try { finish(drawToJpeg(video, video.videoWidth, video.videoHeight)); } catch { finish(null); }
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

async function makeThumb(source: ThumbSource): Promise<string | null> {
  const blob = await loadMediaBlob(source.mediaId);
  if (blob) return source.type === "image" ? imageThumb(blob) : videoThumb(blob, source.time);
  // The file is gone from this browser; a saved still is better than nothing.
  return source.thumbnailUrl?.startsWith("data:") ? source.thumbnailUrl : null;
}

// One at a time: a phone should not decode every saved project's video at once.
let queue: Promise<unknown> = Promise.resolve();

/** The project's thumbnail as a data URL, or null when it has no video or image to show. */
export function projectThumbnail(projectId: string, saveId: string): Promise<string | null> {
  const run = queue.then(async () => {
    const project = await autoSaveManager.readSave(saveId);
    const source = project && firstVisualClip(project);
    if (!source) { forgetProjectThumbnail(projectId); return null; }
    const sig = signature(source);
    const cached = readCache(projectId);
    if (cached?.sig === sig) return cached.url;
    const url = await makeThumb(source);
    if (url) writeCache(projectId, sig, url);
    return url;
  }).catch(() => null);
  queue = run;
  return run;
}
