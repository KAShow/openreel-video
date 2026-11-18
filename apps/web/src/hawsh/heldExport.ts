/**
 * The finished phone export, kept until the user saves or shares it (Hawsh build). A web page cannot
 * write to the photo album or hand a file to WhatsApp by link; the system share sheet can (on iPhone its
 * first row is "Save Video"). The sheet opens only from a tap, so instead of downloading the file when
 * the export ends, export-runner's "hold" delivery leaves it here and the export sheet shows a button.
 */
import { create } from "zustand";

interface HeldExportState { file: Blob | null; filename: string | null }
export const useHeldExport = create<HeldExportState>(() => ({ file: null, filename: null }));

let release: (() => void) | null = null;

/** Keeps the export; `onRelease` frees its storage (the OPFS temp file) when it is no longer needed. */
export function holdExport(file: Blob, filename: string, onRelease?: () => void): void {
  releaseHeldExport();
  release = onRelease ?? null;
  useHeldExport.setState({ file, filename });
}

export function releaseHeldExport(): void {
  const done = release;
  release = null;
  useHeldExport.setState({ file: null, filename: null });
  done?.();
}

const asFile = (blob: Blob, name: string) => new File([blob], name, { type: blob.type || "video/mp4" });

/** Whether this browser can open the share sheet with a video file (iPhone, Android). */
export function canShareVideo(): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (data: { files?: File[] }) => boolean };
    if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
    return nav.canShare({ files: [new File([new Uint8Array(1)], "video.mp4", { type: "video/mp4" })] });
  } catch {
    return false;
  }
}

/**
 * Opens the share sheet with the held video. Call it straight from the tap: iOS refuses a share that
 * does not follow a user gesture, so nothing is awaited before navigator.share.
 */
export async function shareHeldExport(): Promise<"shared" | "cancelled" | "failed"> {
  const { file, filename } = useHeldExport.getState();
  if (!file || !filename) return "failed";
  try {
    await navigator.share({ files: [asFile(file, filename)] });
    return "shared";
  } catch (error) {
    return (error as { name?: string } | null)?.name === "AbortError" ? "cancelled" : "failed";
  }
}

/** The old way: the video as a download (Files / Downloads). */
export function downloadHeldExport(): void {
  const { file, filename } = useHeldExport.getState();
  if (!file || !filename) return;
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
