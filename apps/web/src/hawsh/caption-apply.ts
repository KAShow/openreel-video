/** Applies a caption look (caption-look.ts) to text clips in the project. */
import { useProjectStore } from "../stores/project-store";
import { ensureFontFamily } from "../services/project-fonts";
import { lookStyle, type CaptionLook } from "./caption-look";

const store = () => useProjectStore.getState();

/**
 * Applies a look to the given text clips as one undo step (each clip keeps its x). Loads the font
 * first so the preview and export draw it. False when a clip could not be changed.
 */
export async function applyCaptionLook(clipIds: readonly string[], look: CaptionLook): Promise<boolean> {
  if (!clipIds.length) return false;
  await ensureFontFamily(look.fontFamily, look.fontWeight, "أبجد هوز").catch(() => undefined);
  const style = lookStyle(look);
  const s = store();
  s.beginHistoryGroup("Caption style");
  try {
    let ok = true;
    for (const id of clipIds) {
      const clip = s.getTextClip(id);
      if (!clip) { ok = false; continue; }
      if (!s.updateTextStyle(id, style)) ok = false;
      const pos = clip.transform?.position ?? { x: 0.5, y: look.y };
      if (Math.abs(pos.y - look.y) > 0.0005 && !s.updateTextTransform(id, { position: { x: pos.x, y: look.y } })) ok = false;
    }
    return ok;
  } finally { s.endHistoryGroup(); }
}
