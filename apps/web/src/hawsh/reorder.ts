/**
 * Drag to move a clip earlier or later on its own track, shared by the desktop timeline and the phone
 * timeline. Dropped over other clips, it takes a place among them: the clips swap places, the spaces
 * between places stay as they were, and clips outside the moved range do not move. Stock OpenReel moves
 * an overlapping drop to another track instead.
 */
import { create } from "zustand";
import { useProjectStore } from "../stores/project-store";
import { moveLinkedCaptions } from "../utils/linked-caption-edit";

export interface Slot { id: string; start: number; duration: number }
export interface Move { id: string; start: number }

const EPS = 0.0001;
const endOf = (s: Slot) => s.start + s.duration;
const centerOf = (s: Slot) => s.start + s.duration / 2;

/**
 * Where every clip ends up when `id`, which started at the `start` given in `clips`, is dropped at
 * `dropStart`. Only clips that change are returned, except the dragged clip, which is always included.
 *
 * It passes a neighbour when its leading edge crosses that neighbour's center, so long clips swap as
 * easily as short ones. With `free` (desktop, and phone rows other than the main one) a drop on empty
 * time stays where it was dropped, and a drop that keeps the order settles in the nearest free time.
 * Without it (phone main track) only the order can change.
 */
export function reorderPlan(clips: readonly Slot[], id: string, dropStart: number, free: boolean): Move[] {
  const order = [...clips].sort((a, b) => a.start - b.start);
  const from = order.findIndex((c) => c.id === id);
  if (from < 0) return [];
  const dragged = order[from];
  const others = order.filter((c) => c.id !== id);
  const drop = Math.max(0, dropStart);
  const dropEnd = drop + dragged.duration;

  if (free && others.every((c) => dropEnd <= c.start + EPS || drop >= endOf(c) - EPS)) return [{ id, start: drop }];

  const movingRight = drop > dragged.start;
  const to = others.filter((c) => (movingRight ? centerOf(c) <= dropEnd + EPS : centerOf(c) < drop - EPS)).length;

  if (to === from) {
    if (!free) return [{ id, start: dragged.start }];
    const min = from > 0 ? endOf(order[from - 1]) : 0;
    const max = from < others.length ? order[from + 1].start - dragged.duration : Infinity;
    return [{ id, start: max >= min ? Math.min(max, Math.max(min, drop)) : dragged.start }];
  }

  const first = Math.min(from, to);
  const last = Math.max(from, to);
  const reordered = [...others];
  reordered.splice(to, 0, dragged);

  // The clips in the moved range swap places; the spaces between the places keep their sizes.
  const gaps = order.slice(first, last).map((c, i) => Math.max(0, order[first + i + 1].start - endOf(c)));
  const moves: Move[] = [];
  let cursor = order[first].start;
  reordered.forEach((c, i) => {
    if (i < first) return;
    let start = c.start;
    if (i <= last) {
      start = cursor;
      cursor += c.duration + (gaps[i - first] ?? 0);
    } else if (start < cursor - EPS) {
      // Only clips that overlapped before can get here.
      start = cursor;
      cursor += c.duration;
    }
    if (c.id === id || Math.abs(start - c.start) > EPS) moves.push({ id: c.id, start });
  });
  return moves;
}

/** Beyond this gap two clips are no longer neighbours (the timeline's own transition-handle tolerance). */
const ADJACENT = 0.05;

interface TransitionTrack {
  clips: readonly { id: string; startTime: number; duration: number }[];
  transitions?: readonly { id: string; clipAId: string; clipBId?: string | null }[];
}

/**
 * Transitions between two clips that a move has separated, among those touching `movedIds`. They would
 * play at the wrong time and fail project validation ("invalid clips, adjacency"), so they go with the
 * move. Transitions on a single clip's edge have no neighbour to lose and stay.
 */
export function brokenTransitions(tracks: readonly TransitionTrack[], movedIds: readonly string[]): string[] {
  const moved = new Set(movedIds);
  return tracks.flatMap((track) => (track.transitions ?? []).filter((t) => {
    if (!t.clipBId || (!moved.has(t.clipAId) && !moved.has(t.clipBId))) return false;
    const a = track.clips.find((c) => c.id === t.clipAId);
    const b = track.clips.find((c) => c.id === t.clipBId);
    return !a || !b || Math.abs(a.startTime + a.duration - b.startTime) > ADJACENT;
  }).map((t) => t.id));
}

const store = () => useProjectStore.getState();

/** Removes the transitions a move separated. Call inside the move's undo group. */
export async function dropBrokenTransitions(movedIds: readonly string[]): Promise<void> {
  for (const id of brokenTransitions(store().project.timeline.tracks, movedIds)) await store().removeClipTransition(id);
}

/** The clips of `clipId`'s track, with `clipId` back at the start it had before the drag. */
export function trackSlots(clipId: string, originStart: number): Slot[] {
  const track = store().project.timeline.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  return (track?.clips ?? []).map((c) => ({ id: c.id, start: c.id === clipId ? originStart : c.startTime, duration: c.duration }));
}

export function overlapsOthers(slots: readonly Slot[], id: string, dropStart: number): boolean {
  const dragged = slots.find((s) => s.id === id);
  if (!dragged) return false;
  const dropEnd = dropStart + dragged.duration;
  return slots.some((s) => s.id !== id && dropEnd > s.start + EPS && dropStart < endOf(s) - EPS);
}

/** Runs the moves, taking any captions tied to a moved clip along, like the desktop timeline's drag. */
export async function applyMoves(moves: readonly Move[]): Promise<boolean> {
  for (const m of moves) {
    const source = store().getClip(m.id);
    if (!source) return false;
    if (!(await store().moveClip(m.id, m.start)).success) return false;
    moveLinkedCaptions(store(), source, m.start);
  }
  await dropBrokenTransitions(moves.map((m) => m.id));
  return true;
}

/**
 * What a drop would do, shown while the desktop drag is in the air: where the other clips would go and
 * the slot the dragged clip would land in. Empty when the drop is on free time or another track.
 */
interface DropPreview { trackId: string | null; starts: Record<string, number>; slot: { start: number; duration: number } | null }
const NO_PREVIEW: DropPreview = { trackId: null, starts: {}, slot: null };
export const useDropPreview = create<DropPreview>(() => NO_PREVIEW);

export function clearDropPreview(): void {
  if (useDropPreview.getState() !== NO_PREVIEW) useDropPreview.setState(NO_PREVIEW, true);
}

export function showDropPreview(clipId: string, trackId: string, originStart: number, dropStart: number): void {
  const slots = trackSlots(clipId, originStart);
  if (!overlapsOthers(slots, clipId, dropStart)) { clearDropPreview(); return; }
  const dragged = slots.find((s) => s.id === clipId);
  const moves = reorderPlan(slots, clipId, dropStart, true);
  const start = moves.find((m) => m.id === clipId)?.start;
  if (!dragged || start === undefined) { clearDropPreview(); return; }
  const starts: Record<string, number> = {};
  for (const m of moves) if (m.id !== clipId) starts[m.id] = m.start;
  useDropPreview.setState({ trackId, starts, slot: { start, duration: dragged.duration } }, true);
}

/**
 * Desktop drop on the clip's own track. Returns true when it was dropped over other clips and has been
 * reordered; false leaves the drop to the stock timeline (free time on the track).
 */
export async function reorderOnDrop(clipId: string, originStart: number, dropStart: number): Promise<boolean> {
  const slots = trackSlots(clipId, originStart);
  if (!overlapsOthers(slots, clipId, dropStart)) return false;
  return applyMoves(reorderPlan(slots, clipId, dropStart, true));
}

/** Phone drop: applies the plan for the row as one undo step. A drop that changes nothing does nothing. */
export async function moveOnTrack(slots: readonly Slot[], id: string, dropStart: number, free: boolean): Promise<boolean> {
  const moves = reorderPlan(slots, id, dropStart, free);
  const before = new Map(slots.map((s) => [s.id, s.start]));
  if (moves.every((m) => Math.abs((before.get(m.id) ?? 0) - m.start) <= EPS)) return true;
  store().beginHistoryGroup("Move clip");
  try { return await applyMoves(moves); } finally { store().endHistoryGroup(); }
}

// One drag, one undo step. The timeline's own group lives in a React effect that re-runs during the
// drag and closes it midway, so the whole gesture holds a group of its own, outside React.
let holding = false;
let safetyTimer: ReturnType<typeof setTimeout> | undefined;
const SAFETY_MS = 5000;

const armSafety = () => {
  clearTimeout(safetyTimer);
  safetyTimer = setTimeout(releaseDragHistory, SAFETY_MS);
};

export function holdDragHistory(): void {
  if (holding) return;
  holding = true;
  store().beginHistoryGroup("Move clip");
  // A drag that dies without a drop (its clip removed mid-gesture) must not swallow later edits.
  document.addEventListener("mouseup", armSafety, { once: true, capture: true });
  document.addEventListener("pointerup", armSafety, { once: true, capture: true });
}

export function releaseDragHistory(): void {
  clearTimeout(safetyTimer);
  document.removeEventListener("mouseup", armSafety, true);
  document.removeEventListener("pointerup", armSafety, true);
  if (!holding) return;
  holding = false;
  store().endHistoryGroup();
}
