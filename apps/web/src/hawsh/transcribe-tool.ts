/**
 * AI Editor tool for server captions (Hawsh Khalifa build): transcribe_clip. The clip's speech goes to
 * the site's `editor-transcribe` function (src/hawsh/transcribe.ts, charged per started minute from the
 * user's Director's Eyes points) and the lines are added as caption text on the AI's draft, exactly like
 * the manual panel (ServerCaptionPanel → addSubtitle): single-line text clips on the "Captions" track,
 * marked with captionSource "whisper" and the source clip, grouped with the source clip's track. The
 * captions therefore commit — and undo — with the rest of the AI turn.
 *
 * Points are spent as soon as the server answers, before the turn commits. If the turn then fails or is
 * cancelled the draft is discarded, so the words are kept for this page session: asking again for the
 * same clip reuses them without a second charge, and the chat says so (transcribeChargeNotice).
 */
import { projectUsesUniversalTracks, type Clip, type Project, type Track, type TranscriptionSegment } from "@openreel/core";
import { TitleEngine } from "@openreel/core/text/title-engine";
import type { EditingHost, ToolCall, ToolResult } from "@openreel/agent";
import { msg } from "./i18n/messages";
import { defaultCaptionLook, lookStyle } from "./caption-look";
import { loadTranscribePrice, NoSpeechError, transcribeClip, transcribePoints, wordsToCaptions, type Word } from "./transcribe";

export const TRANSCRIBE_TOOL = "transcribe_clip";
export const TRANSCRIBE_LANGUAGES = ["ar", "en", "auto", "fr", "es", "tr", "ur", "hi"];
const DEFAULT_LANGUAGE = "ar";
const DEFAULT_MAX_WORDS = 5;
const PRICE_TIMEOUT_MS = 4000;

/** Hosts that can take a non-portable draft and a whole-project replacement (EditingSession). */
interface DraftHost extends EditingHost {
  allowNonPortableDraft?: () => void;
  replaceDraft?: (project: Project) => void;
}

/** Words already paid for in this page session, by clip source range and language. */
const paidWords = new Map<string, Word[]>();
export function clearTranscribeCache(): void { paidWords.clear(); }

/**
 * Points this tool has had charged in this page session (only grows). The chat reads it before and
 * after a turn, so a turn that is discarded — failed, cancelled, or stale at commit — can still say
 * what it spent, even when the tool's own result never reached the chat.
 */
let pointsCharged = 0;
export function transcribePointsCharged(): number { return pointsCharged; }

function findClip(project: Project, clipId: string): { clip: Clip; track: Track } | null {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

const sourceSeconds = (clip: Clip) => clip.duration * Math.max(clip.speed ?? 1, 0.01);
const cacheKey = (clip: Clip, language: string) =>
  JSON.stringify([clip.mediaId, clip.audioTrackIndex ?? null, clip.inPoint, clip.outPoint, Math.round(sourceSeconds(clip) * 1000), language]);

function options(args: Record<string, unknown>): { language: string; maxWords: number } {
  const language = typeof args.language === "string" && TRANSCRIBE_LANGUAGES.includes(args.language) ? args.language : DEFAULT_LANGUAGE;
  const n = typeof args.maxWordsPerLine === "number" && Number.isFinite(args.maxWordsPerLine) ? Math.round(args.maxWordsPerLine) : DEFAULT_MAX_WORDS;
  return { language, maxWords: Math.min(12, Math.max(1, n)) };
}

const fail = (message: string): ToolResult => ({ ok: false, summary: "Transcription failed", error: { code: "TRANSCRIBE_FAILED", message } });

/** The unlocked, visible captions track, created like addSubtitle does when there is none. */
async function captionsTrack(host: EditingHost): Promise<Track> {
  const isCaptions = (t: Track) => !t.locked && !t.hidden && (t.role === "captions" || t.name === "Captions");
  const existing = host.getProject().timeline.tracks.find(isCaptions);
  if (existing) return existing;
  const trackId = `track-${crypto.randomUUID()}`;
  // Same track as the manual panel (a standard track in front of everything). A project without the
  // universal-tracks marker gets a text track instead, because a draft commit cannot add that marker.
  const params = projectUsesUniversalTracks(host.getProject())
    ? { trackType: "video", position: 0, mode: "standard", role: "captions", name: "Captions", trackId }
    : { trackType: "text", position: 0, role: "captions", name: "Captions", trackId };
  const result = await host.applyAction({ type: "track/add", id: crypto.randomUUID(), timestamp: Date.now(), params });
  const track = host.getProject().timeline.tracks.find((t) => t.id === trackId);
  if (!result.success || !track) throw new Error(result.error?.message ?? "Could not create the Captions track");
  return track;
}

/** groupTracks(sourceTrack, captionsTrack) from the project store, on the draft. */
function groupWithSource(host: DraftHost, sourceTrackId: string, captionsTrackId: string): void {
  if (!host.replaceDraft || sourceTrackId === captionsTrackId) return;
  const project = host.getProject();
  const source = project.timeline.tracks.find((t) => t.id === sourceTrackId);
  const partner = project.timeline.tracks.find((t) => t.id === captionsTrackId);
  if (!source || !partner) return;
  const groupId = source.groupId ?? partner.groupId ?? `track-group-${crypto.randomUUID()}`;
  const merged = new Set([source.groupId, partner.groupId].filter(Boolean) as string[]);
  host.replaceDraft({
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((t) =>
        t.id === source.id || t.id === partner.id || (t.groupId && merged.has(t.groupId)) ? { ...t, groupId } : t),
    },
  });
}

export async function transcribeClipTool(args: Record<string, unknown>, host: DraftHost): Promise<ToolResult> {
  const clipId = String(args.clipId);
  const { language, maxWords } = options(args);
  const project = host.getProject();
  const found = findClip(project, clipId);
  if (!found) return fail("Clip ID was not found; use list_clips");
  const { clip, track } = found;
  const media = project.mediaLibrary.items.find((m) => m.id === clip.mediaId);
  if (!media || (media.type !== "video" && media.type !== "audio") || (track.type !== "video" && track.type !== "audio" && track.mode !== "standard")) {
    return fail("Only video or audio clips have speech to transcribe");
  }
  if (clip.reversed) return fail("Transcribe the clip before reversing it");
  const existing = (project.textClips ?? []).filter((t) => t.metadata?.captionSourceClipId === clipId).length;
  if (existing > 0) {
    return { ok: true, summary: `This clip already has ${existing} caption lines; nothing was added and no points were charged. Edit or remove those captions instead.`, data: { clipId, lines: 0, existing, points: 0, minutes: 0 } };
  }

  // Server first (the only step that costs points), then the draft.
  const key = cacheKey(clip, language);
  const cached = paidWords.get(key);
  let segments: TranscriptionSegment[];
  let points = 0, minutes = 0;
  if (cached) {
    segments = wordsToCaptions(cached, clip, maxWords);
  } else {
    try {
      const res = await transcribeClip(clip, media, language, maxWords);
      pointsCharged += Number(res.points) || 0;
      if (res.words?.length) paidWords.set(key, res.words);
      ({ segments, points, minutes } = res);
    } catch (error) {
      if (error instanceof NoSpeechError) {
        // Already charged: not a failure (that would discard the turn and invite a paid retry). Remember
        // the empty result so asking again for this clip costs nothing, and have the model tell the user.
        pointsCharged += error.points;
        paidWords.set(key, []);
        return {
          ok: true,
          summary: `No speech was detected in this clip; ${error.points} Director's Eyes points were charged for ${error.minutes} min. Tell the user; do not call transcribe_clip again for this clip.`,
          data: { clipId, lines: 0, points: error.points, minutes: error.minutes, noSpeech: true },
        };
      }
      return fail(error instanceof Error ? error.message : "تعذّر التفريغ.");
    }
  }
  const charged = cached ? "no points were charged (reused the earlier transcription of this clip)" : `${points} Director's Eyes points were charged for ${minutes} min`;
  if (!segments.length) return { ok: true, summary: `No caption lines were produced; ${charged}.`, data: { clipId, lines: 0, points, minutes, reused: !!cached } };

  const target = await captionsTrack(host);
  host.allowNonPortableDraft?.();
  const look = defaultCaptionLook(host.getProject().settings);
  const style = lookStyle(look);
  const y = look.y;
  const titles = new TitleEngine();
  for (const s of segments) {
    const text = titles.createTextClip({
      trackId: target.id,
      startTime: s.startTime,
      duration: s.endTime - s.startTime,
      text: s.text,
      style,
      transform: { position: { x: 0.5, y } },
      metadata: { captionSource: "whisper", captionSourceClipId: clipId, captionMaxWordsPerLine: maxWords },
    });
    const result = await host.applyAction({ type: "text/create", id: crypto.randomUUID(), timestamp: Date.now(), params: { clip: text } });
    if (!result.success) return fail(`Could not add a caption line: ${result.error?.message ?? "invalid text"}`);
  }
  groupWithSource(host, track.id, target.id);
  return {
    ok: true,
    summary: `Added ${segments.length} caption lines to the Captions track; ${charged}.`,
    data: { clipId, trackId: target.id, lines: segments.length, minutes, points, reused: !!cached, language, maxWordsPerLine: maxWords },
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); })]);
  } finally { clearTimeout(timer); }
}

/** Extra line for the confirmation card: what this call will cost. Undefined for other tools. */
export async function transcribeConfirmNote(call: ToolCall, host: EditingHost): Promise<string | undefined> {
  if (call.name !== TRANSCRIBE_TOOL) return undefined;
  try {
    const found = findClip(host.getProject(), String(call.args.clipId));
    if (!found) return msg("chat.transcribe.costGeneric");
    if (paidWords.has(cacheKey(found.clip, options(call.args).language))) return msg("chat.transcribe.costReuse");
    const price = await withTimeout(loadTranscribePrice(), PRICE_TIMEOUT_MS);
    if (price === null) return msg("chat.transcribe.costGeneric");
    return msg("chat.transcribe.costEstimate", { points: transcribePoints(sourceSeconds(found.clip), price), price });
  } catch {
    return msg("chat.transcribe.costGeneric");
  }
}

/** For a turn that did not commit: the points it spent on transcription (a transcribePointsCharged() difference), as a chat notice. */
export function transcribeChargeNotice(points: number): string | undefined {
  return points > 0 ? msg("chat.transcribe.chargedNotApplied", { points: Math.round(points * 100) / 100 }) : undefined;
}
