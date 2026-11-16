import type { MessageKey } from "../../../hawsh/i18n/messages";

/** The parts of a project the starting suggestions depend on. */
export interface SuggestionProject {
  readonly mediaLibrary: { readonly items: ReadonlyArray<{ readonly id: string; readonly type: string }> };
  readonly timeline: { readonly tracks: ReadonlyArray<{ readonly clips: ReadonlyArray<{ readonly mediaId?: string }> }> };
  readonly textClips?: ReadonlyArray<unknown>;
}

export type ChatStart =
  | { readonly kind: "needsMedia" }
  | { readonly kind: "suggest"; readonly keys: readonly MessageKey[] };

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

  const typeOf = new Map(media.map((item) => [item.id, item.type]));
  const hasSound = clips.some((clip) => {
    const type = clip.mediaId ? typeOf.get(clip.mediaId) : undefined;
    return type === "video" || type === "audio";
  });
  const keys: MessageKey[] = [];
  if (hasSound) keys.push("chat.suggestion.silence");
  if ((project.textClips?.length ?? 0) === 0) keys.push("chat.suggestion.title");
  keys.push("chat.suggestion.trim", "chat.suggestion.fade");
  return { kind: "suggest", keys: keys.slice(0, 4) };
}
