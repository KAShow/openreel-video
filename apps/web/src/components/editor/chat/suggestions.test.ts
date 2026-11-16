import { describe, expect, it } from "vitest";
import { chatStart, type SuggestionProject } from "./suggestions";

function project(
  media: Array<{ id: string; type: string }>,
  clipMediaIds: string[] = [],
  textClips = 0,
): SuggestionProject {
  return {
    mediaLibrary: { items: media },
    timeline: { tracks: [{ clips: clipMediaIds.map((mediaId) => ({ mediaId })) }] },
    textClips: Array.from({ length: textClips }),
  };
}

describe("chatStart", () => {
  it("asks for media when there is nothing to edit", () => {
    expect(chatStart(project([]))).toEqual({ kind: "needsMedia" });
  });

  it("offers to place media on an empty timeline", () => {
    expect(chatStart(project([{ id: "a", type: "video" }]))).toEqual({
      kind: "suggest",
      keys: ["chat.suggestion.addFirst"],
    });
    expect(chatStart(project([{ id: "a", type: "video" }, { id: "b", type: "image" }]))).toEqual({
      kind: "suggest",
      keys: ["chat.suggestion.addFirst", "chat.suggestion.addAll"],
    });
  });

  it("offers silence removal only when a clip has sound", () => {
    const video = chatStart(project([{ id: "a", type: "video" }], ["a"]));
    expect(video).toEqual({
      kind: "suggest",
      keys: ["chat.suggestion.silence", "chat.suggestion.title", "chat.suggestion.trim", "chat.suggestion.fade"],
    });
    const image = chatStart(project([{ id: "a", type: "image" }], ["a"]));
    expect(image).toEqual({
      kind: "suggest",
      keys: ["chat.suggestion.title", "chat.suggestion.trim", "chat.suggestion.fade"],
    });
  });

  it("skips the title suggestion once the project has text", () => {
    expect(chatStart(project([{ id: "a", type: "audio" }], ["a"], 1))).toEqual({
      kind: "suggest",
      keys: ["chat.suggestion.silence", "chat.suggestion.trim", "chat.suggestion.fade"],
    });
  });
});
