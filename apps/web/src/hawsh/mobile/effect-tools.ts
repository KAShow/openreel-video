/**
 * Effects on the phone: ready looks (filters) with a strength, and a few manual adjustments. Only the
 * portable video effects (the ones the assistant and export use), within their documented ranges.
 * Effects the phone adds carry their role in the effect id, so changing the look replaces it instead of
 * stacking, and the strength can be read back:
 *   hawsh-look-<lookId>-<percent>-<uuid>     one per effect of the look
 *   hawsh-adj-<type>-<uuid>                  one per manual adjustment
 */
import type { Clip, Effect } from "@openreel/core";
import { act, FAILED, grouped, mainClips, store } from "./live";

type Params = Record<string, number>;
interface Fx { type: string; params: Params }

/** Neutral value of each effect's main parameter (no change to the picture). */
const NEUTRAL: Record<string, Params> = {
  brightness: { value: 0 }, contrast: { value: 1 }, saturation: { value: 1 }, hue: { rotation: 0 },
  blur: { radius: 0 }, sharpen: { amount: 0, radius: 1, threshold: 0 },
  vignette: { amount: 0, midpoint: 0.5, roundness: 0.5, feather: 0.5 }, grain: { amount: 0, size: 1, roughness: 0.5 },
};

/** `full` at strength 1, neutral at 0, in between linearly. */
function scaled(type: string, full: Params, strength: number): Fx {
  const base = NEUTRAL[type] ?? {};
  const params: Params = { ...base };
  for (const [k, v] of Object.entries(full)) {
    const n = base[k] ?? 0;
    params[k] = Math.round((n + (v - n) * strength) * 1000) / 1000;
  }
  return { type, params };
}

export interface Look { id: string; label: string; swatch: string; effects: { type: string; full: Params }[] }

export const LOOKS: Look[] = [
  { id: "vivid", label: "حيوي", swatch: "linear-gradient(135deg,#ff5f6d,#ffc371)", effects: [{ type: "saturation", full: { value: 1.35 } }, { type: "contrast", full: { value: 1.1 } }] },
  { id: "cinematic", label: "سينمائي", swatch: "linear-gradient(135deg,#0f2027,#2c5364)", effects: [{ type: "contrast", full: { value: 1.18 } }, { type: "saturation", full: { value: 0.85 } }, { type: "vignette", full: { amount: 0.4 } }, { type: "grain", full: { amount: 0.12 } }] },
  { id: "bw", label: "أبيض وأسود", swatch: "linear-gradient(135deg,#111,#eee)", effects: [{ type: "saturation", full: { value: 0 } }, { type: "contrast", full: { value: 1.15 } }] },
  { id: "vintage", label: "قديم", swatch: "linear-gradient(135deg,#a8865b,#e9d8b4)", effects: [{ type: "saturation", full: { value: 0.7 } }, { type: "contrast", full: { value: 0.92 } }, { type: "grain", full: { amount: 0.25 } }, { type: "vignette", full: { amount: 0.3 } }] },
  { id: "drama", label: "درامي", swatch: "linear-gradient(135deg,#000,#5b2a86)", effects: [{ type: "contrast", full: { value: 1.35 } }, { type: "saturation", full: { value: 0.9 } }, { type: "vignette", full: { amount: 0.5 } }] },
  { id: "soft", label: "ناعم", swatch: "linear-gradient(135deg,#fbc2eb,#a6c1ee)", effects: [{ type: "contrast", full: { value: 0.9 } }, { type: "brightness", full: { value: 0.05 } }, { type: "blur", full: { radius: 1 } }] },
];

export interface Adjustment { type: string; label: string; key: string; min: number; max: number; step: number }

export const ADJUSTMENTS: Adjustment[] = [
  { type: "brightness", label: "السطوع", key: "value", min: -0.5, max: 0.5, step: 0.01 },
  { type: "contrast", label: "التباين", key: "value", min: 0.5, max: 1.5, step: 0.01 },
  { type: "saturation", label: "التشبّع", key: "value", min: 0, max: 2, step: 0.01 },
  { type: "sharpen", label: "الحدّة", key: "amount", min: 0, max: 2, step: 0.05 },
  { type: "vignette", label: "إطار معتم", key: "amount", min: 0, max: 1, step: 0.01 },
  { type: "grain", label: "حبيبات", key: "amount", min: 0, max: 1, step: 0.01 },
];

export const neutralOf = (a: Adjustment) => NEUTRAL[a.type][a.key];

const LOOK = /^hawsh-look-([a-z]+)-(\d+)-/;
const adjPrefix = (type: string) => `hawsh-adj-${type}-`;

/** The look on a clip and its strength (0–1), or null. */
export function currentLook(clip: Pick<Clip, "effects">): { id: string; strength: number } | null {
  for (const e of clip.effects ?? []) {
    const m = LOOK.exec(e.id);
    if (m) return { id: m[1], strength: Number(m[2]) / 100 };
  }
  return null;
}

/** The value of a manual adjustment on a clip (its neutral value when there is none). */
export function adjustmentValue(clip: Pick<Clip, "effects">, a: Adjustment): number {
  const e = (clip.effects ?? []).find((x) => x.id.startsWith(adjPrefix(a.type)));
  const v = e?.params?.[a.key];
  return typeof v === "number" ? v : neutralOf(a);
}

/** The effects a look adds at a strength; exported for the tests. */
export function lookEffects(look: Look, strength: number): Fx[] {
  return look.effects.map((e) => scaled(e.type, e.full, strength));
}

const liveClip = (clipId: string) => store().project.timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);

async function removeEffects(clipId: string, keep: (e: Effect) => boolean): Promise<boolean> {
  for (const e of [...(liveClip(clipId)?.effects ?? [])]) {
    if (!keep(e) && !(await act("effect/remove", { clipId, effectId: e.id }))) return false;
  }
  return true;
}

async function putLook(clipId: string, look: Look | null, strength: number): Promise<boolean> {
  if (!(await removeEffects(clipId, (e) => !LOOK.test(e.id)))) return false;
  if (!look || strength <= 0) return true;
  const pct = Math.round(Math.min(1, strength) * 100);
  for (const fx of lookEffects(look, pct / 100)) {
    const ok = await act("effect/add", { clipId, effectType: fx.type, params: fx.params, effectId: `hawsh-look-${look.id}-${pct}-${crypto.randomUUID()}` });
    if (!ok) return false;
  }
  return true;
}

/** Applies a look (null removes it) to one clip as one undo step. Returns an Arabic error or null. */
export async function applyLook(clipId: string, lookId: string | null, strength = 1): Promise<string | null> {
  const look = LOOKS.find((l) => l.id === lookId) ?? null;
  return grouped("Filter", async () => ((await putLook(clipId, look, strength)) ? null : FAILED));
}

/** A look (null removes it) at a strength on every video and image clip of the main track, as one undo step. */
export async function applyLookEverywhere(lookId: string | null, strength = 1): Promise<string | null> {
  const look = LOOKS.find((l) => l.id === lookId) ?? null;
  const media = new Map(store().project.mediaLibrary.items.map((m) => [m.id, m.type]));
  const clips = mainClips(store().project).filter((c) => media.get(c.mediaId) !== "audio");
  if (!clips.length) return "أضف فيديو أولاً.";
  return grouped("Filter on all clips", async () => {
    for (const c of clips) if (!(await putLook(c.id, look, strength))) return FAILED;
    return null;
  });
}

/** Sets one manual adjustment; the neutral value removes it. */
export async function setAdjustment(clipId: string, a: Adjustment, value: number): Promise<string | null> {
  const v = Math.min(a.max, Math.max(a.min, value));
  const existing = (liveClip(clipId)?.effects ?? []).find((e) => e.id.startsWith(adjPrefix(a.type)));
  const neutral = Math.abs(v - neutralOf(a)) < a.step / 2;
  let ok: boolean;
  if (neutral) ok = existing ? await act("effect/remove", { clipId, effectId: existing.id }) : true;
  else if (existing) ok = await act("effect/update", { clipId, effectId: existing.id, params: { [a.key]: v } });
  else ok = await act("effect/add", { clipId, effectType: a.type, params: { ...NEUTRAL[a.type], [a.key]: v }, effectId: `${adjPrefix(a.type)}${crypto.randomUUID()}` });
  return ok ? null : FAILED;
}

/** Removes every video effect from the clip, as one undo step. */
export async function clearEffects(clipId: string): Promise<string | null> {
  return grouped("Remove effects", async () => ((await removeEffects(clipId, () => false)) ? null : FAILED));
}
