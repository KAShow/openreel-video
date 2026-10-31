/**
 * Phone export sheet (stage 5): replaces the desktop export dialog, which is wider than a phone. Two
 * choices on the same export engine as the desktop (useExportRunner, MP4/H.264, browser download),
 * a progress bar, and afterwards "Save to my library" (the export is kept by rememberExport while
 * signed in to Director's Eyes).
 */
import React, { useState } from "react";
import type { VideoExportSettings } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { exportFilename, useExportRunner } from "../../services/export-runner";
import { saveExportToLibrary } from "../api";
import { clearLastExport, useLastExport } from "../lastExport";
import { useHawshStore } from "../session";

export type Quality = "high" | "small";

/** Export size: the project's own size, or scaled so the short side is 720 (even numbers for H.264). */
export function exportSettings(project: { settings: { width: number; height: number; frameRate: number } }, quality: Quality): Partial<VideoExportSettings> {
  const { width, height, frameRate } = project.settings;
  const scale = quality === "small" ? Math.min(1, 720 / Math.min(width, height)) : 1;
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return {
    width: even(width), height: even(height), frameRate: frameRate || 30,
    format: "mp4", codec: "h264",
    bitrate: quality === "small" ? 5000 : 12000, quality: quality === "small" ? 75 : 85,
  };
}

const choice = (on: boolean) => `flex-1 rounded-xl border p-3 text-start ${on ? "border-primary bg-primary/10" : "border-border bg-bg-1"}`;
const primary = "w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-40";

export const PhoneExport: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const project = useProjectStore((s) => s.project);
  const hasContent = (project.timeline?.duration ?? 0) > 0;
  const signedIn = useHawshStore((s) => s.status === "ready");
  const { blob, filename } = useLastExport();
  const [quality, setQuality] = useState<Quality>("high");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "done" | string>("idle");
  const runner = useExportRunner({ project });
  const { isExporting, progress, error } = runner.state;
  const done = startedAt !== null && !isExporting && !error && progress >= 100;
  // Only offer saving the file this sheet just exported, not an older one.
  const exported = done && blob && filename ? { blob, filename } : null;

  const start = async () => {
    clearLastExport();
    setSaved("idle");
    setStartedAt(Date.now());
    try {
      const writable = await runner.showSavePicker(exportFilename(project.name, "mp4"), "mp4", { delivery: "download" });
      runner.beginExport(writable);
      await runner.runExport(exportSettings(project, quality), "mp4", writable);
    } catch (e) {
      runner.failExport(e);
      if (e instanceof DOMException && e.name === "AbortError") setStartedAt(null);
    }
  };

  const save = async () => {
    if (!exported) return;
    setSaved("saving");
    try {
      await saveExportToLibrary(exported.blob, exported.filename);
      setSaved("done");
      clearLastExport();
    } catch (e) {
      setSaved(e instanceof Error ? e.message : "تعذّر الحفظ.");
    }
  };

  const close = () => { if (isExporting) runner.cancel(); onClose(); };
  const s = exportSettings(project, quality);
  const phase = !startedAt || (!isExporting && error) ? "choose" : done ? "done" : "progress";

  return (
    <div className="fixed inset-0 z-[90] flex flex-col justify-end bg-black/40" onClick={() => { if (!isExporting) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="تصدير الفيديو" onClick={(e) => e.stopPropagation()} dir="rtl" data-no-translate=""
        data-testid="phone-export" className="space-y-3 rounded-t-2xl border-t border-border bg-bg p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold">تصدير الفيديو</span>
          <button type="button" aria-label="إغلاق" onClick={close} className="grid h-8 w-8 place-items-center rounded-full text-lg">✕</button>
        </div>

        {phase === "choose" ? (
          <>
            <div className="flex gap-2">
              <button type="button" className={choice(quality === "high")} onClick={() => setQuality("high")} aria-pressed={quality === "high"}>
                <b className="block text-sm">عالية</b>
                <span className="text-xs text-fg-muted" dir="ltr">{exportSettings(project, "high").width}×{exportSettings(project, "high").height}</span>
              </button>
              <button type="button" className={choice(quality === "small")} onClick={() => setQuality("small")} aria-pressed={quality === "small"}>
                <b className="block text-sm">حجم أصغر</b>
                <span className="text-xs text-fg-muted" dir="ltr">{exportSettings(project, "small").width}×{exportSettings(project, "small").height}</span>
              </button>
            </div>
            {error && <p className="text-sm text-red-400">تعذّر التصدير: {error}</p>}
            <button type="button" className={primary} disabled={!hasContent} onClick={() => void start()}>
              {hasContent ? "صدّر الفيديو" : "أضف لقطات أولاً"}
            </button>
            <p className="text-center text-xs text-fg-muted">MP4 · {s.frameRate} fps · يُحفظ في تنزيلات جهازك</p>
          </>
        ) : phase === "progress" ? (
          <div className="space-y-2" role="status">
            <div className="h-2 overflow-hidden rounded-full bg-bg-2">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(progress)}%` }} />
            </div>
            <p className="text-center text-sm">جارٍ التصدير… {Math.round(progress)}%</p>
            <p className="text-center text-xs text-fg-muted">خلّ الصفحة مفتوحة حتى ينتهي.</p>
            <button type="button" className="w-full py-2 text-sm text-fg-muted" onClick={() => runner.cancel()}>إلغاء</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-center text-sm">✅ تم التصدير، والفيديو في تنزيلات جهازك.</p>
            {signedIn && (
              saved === "done" ? <p className="text-center text-sm text-primary">انحفظ في مكتبتك في عيون المخرج (مراجعي).</p>
                : <button type="button" className={primary} disabled={!exported || saved === "saving"} onClick={() => void save()}>
                  {saved === "saving" ? "جارٍ الحفظ…" : exported ? "احفظ في مكتبتي" : "جارٍ تجهيز الحفظ…"}
                </button>
            )}
            {saved !== "idle" && saved !== "saving" && saved !== "done" && <p className="text-center text-sm text-red-400">{saved}</p>}
            <button type="button" className="w-full py-2 text-sm text-fg-muted" onClick={() => setStartedAt(null)}>تصدير مرة ثانية</button>
          </div>
        )}
      </div>
    </div>
  );
};
