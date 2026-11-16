import { describe, expect, it } from "vitest";
import { msg } from "../../../hawsh/i18n/messages";
import { chatStart, nextSteps, type SuggestionMessage, type SuggestionProject } from "./suggestions";

function project(
  media: Array<{ id: string; type: string }>,
  clipMediaIds: string[] = [],
  textClips: unknown[] = [],
  settings = { width: 1920, height: 1080 },
): SuggestionProject {
  return {
    settings,
    mediaLibrary: { items: media },
    timeline: { tracks: [{ clips: clipMediaIds.map((mediaId) => ({ mediaId })) }] },
    textClips,
  };
}
const title = { text: "مرحباً" };
const caption = { text: "أهلاً", metadata: { captionSource: "whisper" } };
const user = (text: string): SuggestionMessage => ({ role: "user", text, toolCalls: [] });
const reply = (...tools: Array<[string, string]>): SuggestionMessage => ({ role: "assistant", text: "تم", toolCalls: tools.map(([name, status]) => ({ name, status })) });

describe("chatStart", () => {
  it("asks for media when there is nothing to edit", () => {
    expect(chatStart(project([]))).toEqual({ kind: "needsMedia" });
  });

  it("offers to place media on an empty timeline", () => {
    expect(chatStart(project([{ id: "a", type: "video" }]))).toEqual({ kind: "suggest", keys: ["chat.suggestion.addFirst"] });
    expect(chatStart(project([{ id: "a", type: "video" }, { id: "b", type: "image" }]))).toEqual({
      kind: "suggest",
      keys: ["chat.suggestion.addFirst", "chat.suggestion.addAll"],
    });
  });

  it("leads with captions and silence removal when a clip has sound", () => {
    expect(chatStart(project([{ id: "a", type: "video" }], ["a"]))).toEqual({
      kind: "suggest",
      keys: ["chat.suggestion.captions", "chat.suggestion.silence", "chat.suggestion.title", "chat.suggestion.vertical"],
    });
    expect(chatStart(project([{ id: "a", type: "image" }], ["a"]))).toEqual({
      kind: "suggest",
      keys: ["chat.suggestion.title", "chat.suggestion.vertical", "chat.suggestion.fade", "chat.suggestion.trim"],
    });
  });

  it("drops what the project already has: a title, captions, a vertical frame", () => {
    const done = chatStart(project([{ id: "a", type: "video" }], ["a"], [title, caption], { width: 1080, height: 1920 }));
    expect(done).toEqual({ kind: "suggest", keys: ["chat.suggestion.silence", "chat.suggestion.fade", "chat.suggestion.trim"] });
  });

  it("still offers a title when the only text is caption lines", () => {
    const keys = chatStart(project([{ id: "a", type: "video" }], ["a"], [caption]));
    expect(keys).toMatchObject({ keys: expect.arrayContaining(["chat.suggestion.title"]) });
  });
});

describe("nextSteps", () => {
  const video = project([{ id: "a", type: "video" }], ["a"]);

  it("offers up to three things the project still lacks", () => {
    expect(nextSteps(video, [user("قص البداية"), reply(["trim_clip", "done"])])).toEqual([
      "chat.suggestion.captions", "chat.suggestion.silence", "chat.suggestion.title",
    ]);
  });

  it("leaves out what the assistant already did in this chat", () => {
    const keys = nextSteps(video, [user("نظّف"), reply(["cut_silence", "done"], ["create_text_clip", "corrected"])]);
    expect(keys).toEqual(["chat.suggestion.captions", "chat.suggestion.vertical", "chat.suggestion.fade"]);
  });

  it("does not push an offer the user already asked for, even if it did not go through", () => {
    const keys = nextSteps(video, [user(msg("chat.suggestion.captions")), reply(["transcribe_clip", "rejected"])]);
    expect(keys).not.toContain("chat.suggestion.captions");
  });

  it("offers nothing on an empty timeline", () => {
    expect(nextSteps(project([{ id: "a", type: "video" }]), [user("مرحبا"), reply()])).toEqual([]);
  });
});
