import type { MessageKey } from "../../../hawsh/i18n/messages";
import { msg } from "../../../hawsh/i18n/messages";

/** The parts of a project the suggestions depend on. */
export interface SuggestionProject {
  readonly settings?: { readonly width: number; readonly height: number };
  readonly mediaLibrary: { readonly items: ReadonlyArray<{ readonly id: string; readonly type: string }> };
  readonly timeline: { readonly tracks: ReadonlyArray<{ readonly clips: ReadonlyArray<{ readonly mediaId?: string }> }> };
  readonly textClips?: ReadonlyArray<unknown>;
}

/** The parts of a chat message the follow-up suggestions depend on. */
export interface SuggestionMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly toolCalls: ReadonlyArray<{ readonly name: string; readonly status: string }>;
}

export type ChatStart =
  | { readonly kind: "needsMedia" }
  | { readonly kind: "suggest"; readonly keys: readonly MessageKey[] };

const isCaption = (text: unknown): boolean =>
  !!(text as { metadata?: { captionSource?: unknown } } | null)?.metadata?.captionSource;

/** Requests that make sense for a timeline with clips on it, most valuable first. */
function editSuggestions(project: SuggestionProject): MessageKey[] {
  const typeOf = new Map(project.mediaLibrary.items.map((item) => [item.id, item.type]));
  const clips = project.timeline.tracks.flatMap((track) => track.clips);
  const hasSound = clips.some((clip) => {
    const type = clip.mediaId ? typeOf.get(clip.mediaId) : undefined;
    return type === "video" || type === "audio";
  });
  const texts = project.textClips ?? [];
  const keys: MessageKey[] = [];
  if (hasSound && !texts.some(isCaption)) keys.push("chat.suggestion.captions");
  if (hasSound) keys.push("chat.suggestion.silence");
  if (texts.every(isCaption)) keys.push("chat.suggestion.title");
  if (project.settings && project.settings.height <= project.settings.width) keys.push("chat.suggestion.vertical");
  keys.push("chat.suggestion.fade", "chat.suggestion.trim");
  return keys;
}

/**
 * What the empty chat offers, from what is in the project: a request the assistant can actually
 * carry out now. It cannot import files, so with nothing to edit it asks for media instead of
 * suggesting edits that would fail.
 */
export function chatStart(project: SuggestionProject): ChatStart {
  const media = project.mediaLibrary.items;
  const clips = project.timeline.tracks.flatMap((track) => track.clips);

  if (clips.length === 0) {
    if (media.length === 0) return { kind: "needsMedia" };
    return {
      kind: "suggest",
      keys: media.length > 1
        ? ["chat.suggestion.addFirst", "chat.suggestion.addAll"]
        : ["chat.suggestion.addFirst"],
    };
  }
  return { kind: "suggest", keys: editSuggestions(project).slice(0, 4) };
}

/** The tool that carries out each suggestion: once it has run in this chat, the suggestion is spent. */
const DONE_BY: Partial<Record<MessageKey, string>> = {
  "chat.suggestion.captions": "transcribe_clip",
  "chat.suggestion.silence": "cut_silence",
  "chat.suggestion.title": "create_text_clip",
  "chat.suggestion.vertical": "update_project_settings",
  "chat.suggestion.fade": "set_clip_fade",
};

/**
 * Up to three one-tap requests offered under the assistant's last reply: what this project still lacks,
 * leaving out anything already done or already asked for in this chat (so a declined offer is not
 * pushed again).
 */
export function nextSteps(project: SuggestionProject, messages: readonly SuggestionMessage[]): MessageKey[] {
  if (project.timeline.tracks.every((track) => track.clips.length === 0)) return [];
  const ran = new Set(messages.flatMap((m) => m.toolCalls.filter((call) => call.status === "done" || call.status === "corrected").map((call) => call.name)));
  const asked = new Set(messages.filter((m) => m.role === "user").map((m) => m.text.trim()));
  return editSuggestions(project)
    .filter((key) => key in DONE_BY && !ran.has(DONE_BY[key]!) && !asked.has(msg(key)))
    .slice(0, 3);
}
