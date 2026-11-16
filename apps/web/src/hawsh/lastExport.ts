/**
 * Remembers the last browser export so it can be saved to the Director's Eyes library afterwards.
 * Called by export-runner just before it hands the file to the browser download. OPFS temp files are
 * deleted about a minute later, so the bytes are copied into memory right away (only when signed in
 * and within the library limit — otherwise nothing is kept).
 */
import { create } from "zustand";
import { HAWSH_LIBRARY_MAX_BYTES } from "./config";
import { useHawshStore } from "./session";
import { saveExportToLibrary } from "./api";
import { toast } from "../stores/notification-store";

interface LastExportState { blob: Blob | null; filename: string | null; at: number | null }
export const useLastExport = create<LastExportState>(() => ({ blob: null, filename: null, at: null }));

/** Set by the AI assistant ("export and save to My references"): the next finished export is saved there. */
let saveNext = false;
export function saveNextExportToLibrary(): void { saveNext = true; }
export function willSaveNextExport(): boolean { return saveNext; }

export function rememberExport(data: Blob, filename: string, mime?: string): void {
  if (useHawshStore.getState().status !== "ready") return;
  if (data.size <= 0 || data.size > HAWSH_LIBRARY_MAX_BYTES) {
    if (saveNext) { saveNext = false; toast.error("الفيديو أكبر من حدّ «مراجعي»، فلم يُحفظ فيها."); }
    return;
  }
  void data.arrayBuffer().then(
    (buf) => {
      const blob = new Blob([buf], { type: mime || data.type });
      useLastExport.setState({ blob, filename, at: Date.now() });
      if (!saveNext) return;
      saveNext = false;
      saveExportToLibrary(blob, filename).then(
        ({ reused }) => toast.success(reused ? "الفيديو محفوظ مسبقاً في «مراجعي»." : "حُفظ الفيديو في «مراجعي»."),
        (error) => toast.error("تعذّر حفظ الفيديو في «مراجعي».", error instanceof Error ? error.message : undefined),
      );
    },
    () => { saveNext = false; },
  );
}

export function clearLastExport(): void {
  useLastExport.setState({ blob: null, filename: null, at: null });
}
