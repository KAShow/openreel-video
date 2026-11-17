/**
 * How captions look (Hawsh Khalifa build). Captions are text clips on the Captions track (see
 * ServerCaptionPanel and transcribe-tool). OpenReel's subtitle presets are 22–32px, which is tiny on a
 * 1080×1920 frame; new captions get a size that reads on a phone instead, sized from the frame, in a
 * bold Arabic font with an outline. The editor (CaptionStyleEditor) changes size, colour, font,
 * outline, background and position on all captions — or one line — as one undo step. Pure helpers;
 * applying a look to the project is in caption-apply.ts.
 */
import type { Project, TextClip, TextStyle } from "@openreel/core";

export interface CaptionLook {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  /** Outline width in pixels; 0 = none. */
  outline: number;
  outlineColor: string;
  /** Box behind the text, or "" for none. */
  background: string;
  /** Vertical position 0 (top) – 1 (bottom). */
  y: number;
}

export const CAPTION_FONTS = [
  { family: "Cairo", label: "القاهرة" },
  { family: "Tajawal", label: "تجوّل" },
  { family: "Almarai", label: "المراعي" },
  { family: "Changa", label: "تشانغا" },
  { family: "Lalezar", label: "لاله زار" },
  { family: "Noto Kufi Arabic", label: "كوفي" },
  { family: "Reem Kufi", label: "ريم كوفي" },
  { family: "Amiri", label: "أميري" },
] as const;

export const CAPTION_COLORS = ["#ffffff", "#ffe600", "#00e5ff", "#7CFC00", "#ff4d6d", "#ff9f1c", "#000000"] as const;

/** The size captions get by default: about 6% of the frame's short side (65px on 1080). */
export function defaultCaptionSize(settings: Pick<Project["settings"], "width" | "height">): number {
  return Math.round(Math.min(settings.width, settings.height) * 0.06);
}

/** Size limits of the size slider, from the frame. */
export function captionSizeRange(settings: Pick<Project["settings"], "width" | "height">) {
  const short = Math.min(settings.width, settings.height);
  return { min: Math.round(short * 0.025), max: Math.round(short * 0.14) };
}

/** Above the like/comment buttons on vertical video; near the bottom on other formats. */
export const defaultCaptionY = (settings: Pick<Project["settings"], "width" | "height">) => (settings.height > settings.width ? 0.72 : 0.85);

/** The look new captions get. */
export function defaultCaptionLook(settings: Pick<Project["settings"], "width" | "height">): CaptionLook {
  const fontSize = defaultCaptionSize(settings);
  return { fontFamily: "Cairo", fontSize, fontWeight: 800, color: "#ffffff", outline: Math.max(2, Math.round(fontSize * 0.08)), outlineColor: "#000000", background: "", y: defaultCaptionY(settings) };
}

export interface CaptionPreset { id: string; label: string; look: (base: CaptionLook) => CaptionLook }

/** Ready looks; each keeps the current size and position. */
export const CAPTION_PRESETS: CaptionPreset[] = [
  { id: "classic", label: "أبيض بحدود", look: (b) => ({ ...b, fontFamily: "Cairo", fontWeight: 800, color: "#ffffff", outline: Math.max(2, Math.round(b.fontSize * 0.08)), outlineColor: "#000000", background: "" }) },
  { id: "yellow", label: "أصفر بارز", look: (b) => ({ ...b, fontFamily: "Lalezar", fontWeight: 400, color: "#ffe600", outline: Math.max(2, Math.round(b.fontSize * 0.09)), outlineColor: "#000000", background: "" }) },
  { id: "box", label: "صندوق أسود", look: (b) => ({ ...b, fontFamily: "Tajawal", fontWeight: 800, color: "#ffffff", outline: 0, outlineColor: "#000000", background: "rgba(0,0,0,0.75)" }) },
  { id: "white-box", label: "صندوق أبيض", look: (b) => ({ ...b, fontFamily: "Almarai", fontWeight: 800, color: "#000000", outline: 0, outlineColor: "#000000", background: "rgba(255,255,255,0.92)" }) },
  { id: "neon", label: "نيون", look: (b) => ({ ...b, fontFamily: "Changa", fontWeight: 800, color: "#00e5ff", outline: Math.max(2, Math.round(b.fontSize * 0.06)), outlineColor: "#001b3a", background: "" }) },
  { id: "clean", label: "بسيط", look: (b) => ({ ...b, fontFamily: "Noto Kufi Arabic", fontWeight: 600, color: "#ffffff", outline: Math.max(1, Math.round(b.fontSize * 0.04)), outlineColor: "#000000", background: "" }) },
];

/** The text style for a look. */
export function lookStyle(look: CaptionLook): Partial<TextStyle> {
  return {
    fontFamily: look.fontFamily,
    fontSize: look.fontSize,
    fontWeight: look.fontWeight as TextStyle["fontWeight"],
    color: look.color,
    strokeColor: look.outline > 0 ? look.outlineColor : undefined,
    strokeWidth: look.outline > 0 ? look.outline : 0,
    backgroundColor: look.background || undefined,
    textAlign: "center",
    letterSpacing: 0,
  };
}

/** Reads the look back from a caption clip. */
export function lookOf(clip: Pick<TextClip, "style" | "transform">, settings: Pick<Project["settings"], "width" | "height">): CaptionLook {
  const s = clip.style;
  const base = defaultCaptionLook(settings);
  const weight = typeof s.fontWeight === "number" ? s.fontWeight : s.fontWeight === "bold" ? 700 : 400;
  return {
    fontFamily: s.fontFamily || base.fontFamily,
    fontSize: s.fontSize || base.fontSize,
    fontWeight: weight,
    color: s.color || base.color,
    outline: s.strokeColor && s.strokeWidth ? s.strokeWidth : 0,
    outlineColor: s.strokeColor || "#000000",
    background: s.backgroundColor || "",
    y: clip.transform?.position?.y ?? base.y,
  };
}

/** Whether a text clip is a caption line. */
export function isCaption(clip: Pick<TextClip, "trackId" | "metadata">, project: Pick<Project, "timeline">): boolean {
  if (typeof clip.metadata?.captionSource === "string") return true;
  const track = project.timeline.tracks.find((t) => t.id === clip.trackId);
  return !!track && (track.role === "captions" || track.name === "Captions");
}

/** Caption lines of the project, in time order. */
export function captionClips(project: Pick<Project, "timeline" | "textClips">): TextClip[] {
  return (project.textClips ?? []).filter((c) => isCaption(c, project)).sort((a, b) => a.startTime - b.startTime);
}

