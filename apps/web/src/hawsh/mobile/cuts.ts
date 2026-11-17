/**
 * Transitions on the phone: the cuts between neighbouring clips of the main track, and adding or
 * removing a transition on one cut or on all of them. Placement and checks are the assistant's own
 * (addEditingTransition), so both put transitions the same way.
 */
import type { Project, Transition } from "@openreel/core";
import { addEditingTransition, getTransitionOptions } from "../../services/agent/transition-tools";
import { mainTrack } from "./add-tools";
import { act, FAILED, grouped, liveHost, store } from "./live";

export const PHONE_TRANSITIONS = [
  { type: "crossfade", label: "تلاشٍ" },
  { type: "dipToBlack", label: "عبر الأسود" },
  { type: "dipToWhite", label: "عبر الأبيض" },
  { type: "slide", label: "انزلاق" },
  { type: "push", label: "دفع" },
  { type: "zoom", label: "تكبير" },
  { type: "whipPan", label: "سحب سريع" },
  { type: "blur", label: "ضبابية" },
  { type: "spin", label: "دوران" },
  { type: "glitch", label: "تشويش" },
] as const;

export const DEFAULT_TRANSITION_SECONDS = 0.4;
export const TRANSITION_MIN = 0.2;
export const TRANSITION_MAX = 1.5;

export interface Cut {
  clipAId: string;
  clipBId: string;
  /** Timeline time of the cut. */
  time: number;
  /** 1-based place of the clip before the cut on the main track. */
  index: number;
  transition?: Transition;
}

/** Cuts between touching clips of the main track, in order, with the transition already on each. */
export function mainCuts(project: Project): Cut[] {
  const track = mainTrack(project);
  if (!track) return [];
  const order = [...track.clips].sort((a, b) => a.startTime - b.startTime).map((c) => c.id);
  return getTransitionOptions(project)
    .filter((p) => p.trackId === track.id)
    .map((p) => ({
      clipAId: p.clipAId,
      clipBId: p.clipBId,
      time: p.cutTime,
      index: order.indexOf(p.clipAId) + 1,
      transition: (track.transitions ?? []).find((t) => t.clipAId === p.clipAId && t.clipBId === p.clipBId),
    }));
}

/** The cut closest to `time`, or null when there is none. */
export function nearestCut(cuts: readonly Cut[], time: number): Cut | null {
  let best: Cut | null = null;
  for (const c of cuts) if (!best || Math.abs(c.time - time) < Math.abs(best.time - time)) best = c;
  return best;
}

export const transitionLabel = (type: string | undefined) => PHONE_TRANSITIONS.find((t) => t.type === type)?.label ?? (type ? "انتقال" : "بلا انتقال");

async function put(cut: Cut, type: string, seconds: number): Promise<boolean> {
  const res = await addEditingTransition({ clipAId: cut.clipAId, clipBId: cut.clipBId, transitionType: type, duration: seconds }, liveHost());
  return res.ok;
}

/** Puts (or replaces) the transition on one cut. Returns an Arabic error or null. */
export async function setTransition(cut: Cut, type: string, seconds: number): Promise<string | null> {
  return (await put(cut, type, seconds)) ? null : FAILED;
}

/** The same transition on every cut of the main track, as one undo step. */
export async function setTransitionEverywhere(type: string, seconds: number): Promise<string | null> {
  const cuts = mainCuts(store().project);
  if (!cuts.length) return "ما فيه قطعات بين لقطات.";
  return grouped("Transitions", async () => {
    for (const cut of cuts) if (!(await put(cut, type, seconds))) return FAILED;
    return null;
  });
}

export async function removeTransition(cut: Cut): Promise<string | null> {
  if (!cut.transition) return null;
  return (await act("transition/remove", { transitionId: cut.transition.id })) ? null : FAILED;
}

export async function removeAllTransitions(): Promise<string | null> {
  const ids = mainCuts(store().project).flatMap((c) => (c.transition ? [c.transition.id] : []));
  if (!ids.length) return null;
  return grouped("Remove transitions", async () => {
    for (const id of ids) if (!(await act("transition/remove", { transitionId: id }))) return FAILED;
    return null;
  });
}
