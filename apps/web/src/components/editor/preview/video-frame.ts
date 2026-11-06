/**
 * Capture only the decoded video pixels for preview compositing.
 *
 * The caller owns project background and layer ordering. Expanding a paused
 * video frame to the project canvas here would add opaque letterbox padding
 * that can cover lower tracks and would make paused rendering diverge from
 * native playback.
 */
export const captureNativeVideoFrame = (
  video: HTMLVideoElement,
): Promise<ImageBitmap> => createImageBitmap(video);

// A slow decoder gets time to land: capturing before that shows the old frame or fails outright. Same limit as opening the file.
const SEEK_TIMEOUT_MS = 10_000;

/**
 * Chromium has the new frame ready when "seeked" fires, and never fires the frame callback for a video
 * outside the page, so waiting there only adds delay. Safari is known to lag behind "seeked" and could
 * not be measured here, so it keeps a short wait for the frame.
 */
const isSafari = (userAgent: string): boolean =>
  /AppleWebKit/.test(userAgent) && !/Chrom(e|ium)|CriOS|Edg|OPR/.test(userAgent);
const defaultFrameGraceMs = (): number =>
  typeof navigator !== "undefined" && isSafari(navigator.userAgent) ? 100 : 0;

/**
 * Seek a paused video and resolve once the new frame can be captured. The frame callback is asked for
 * before seeking because it can fire before "seeked"; asked for afterwards it would be missed.
 */
export const seekVideoToFrame = (
  video: HTMLVideoElement,
  time: number,
  frameGraceMs: number = defaultFrameGraceMs(),
): Promise<void> =>
  new Promise((resolve) => {
    const watchesFrames = frameGraceMs > 0 && "requestVideoFrameCallback" in video;
    let landed = false;
    let presented = false;
    let frameRequest: number | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      clearTimeout(timeoutTimer);
      if (graceTimer) clearTimeout(graceTimer);
      video.removeEventListener("seeked", onSeeked);
      if (frameRequest !== null) video.cancelVideoFrameCallback(frameRequest);
      resolve();
    };
    const onSeeked = () => {
      if (video.seeking) return; // A newer seek replaced this one; wait for it.
      landed = true;
      video.removeEventListener("seeked", onSeeked);
      if (presented || !watchesFrames) finish();
      else graceTimer = setTimeout(finish, frameGraceMs);
    };
    const timeoutTimer = setTimeout(finish, SEEK_TIMEOUT_MS);

    if (watchesFrames) {
      frameRequest = video.requestVideoFrameCallback(() => {
        frameRequest = null;
        presented = true;
        if (landed) finish();
      });
    }
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
