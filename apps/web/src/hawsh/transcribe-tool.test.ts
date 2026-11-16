import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTurn, type LLMClient, type ToolCall, type ToolResult } from "@openreel/agent";
import { UNIVERSAL_TRACKS_CAPABILITY } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { EditingSession } from "../services/agent/editing-session";
import { EDITING_SYSTEM, editingToolDefs, editingToolNeedsConfirm, editingToolReadOnly, executeEditingTool } from "../services/agent/editing-tools";
import { toolLabel } from "../components/editor/chat/tool-labels";
import { clearTranscribeCache, transcribeChargeNotice, transcribeConfirmNote, transcribePointsCharged } from "./transcribe-tool";
import { transcribeClip, loadTranscribePrice } from "./transcribe";

vi.mock("./transcribe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./transcribe")>()),
  transcribeClip: vi.fn(),
  loadTranscribePrice: vi.fn(),
}));
const transcribeMock = vi.mocked(transcribeClip);
const priceMock = vi.mocked(loadTranscribePrice);

const WORDS = [
  { text: "السلام", start: 0.2, end: 0.6 }, { text: "عليكم.", start: 0.7, end: 1.1 },
  { text: "أهلاً", start: 2, end: 2.4 }, { text: "وسهلاً.", start: 2.5, end: 3 },
];
const SEGMENTS = [
  { text: "السلام عليكم.", startTime: 0.2, endTime: 1.25, confidence: 1 },
  { text: "أهلاً وسهلاً.", startTime: 2, endTime: 3.15, confidence: 1 },
];

function ok(result: ToolResult): Record<string, unknown> {
  expect(result.ok, result.error?.message).toBe(true);
  return result.data as Record<string, unknown>;
}

async function setup(capabilities?: string[]) {
  if (capabilities) useProjectStore.setState({ project: { ...useProjectStore.getState().project, capabilities } });
  const session = new EditingSession();
  const txn = session.beginTransaction();
  const { trackId } = ok(await executeEditingTool("add_track", { trackType: "video" }, session));
  const { clipId } = ok(await executeEditingTool("add_clip", { trackId, mediaId: "talk", startTime: 0 }, session));
  return { session, txn, trackId: trackId as string, clipId: clipId as string };
}

/** A model that calls transcribe_clip once on the project's first clip, then stops. */
function captionModel(): LLMClient {
  let step = 0;
  return { complete: async () => {
    if (step++ === 0) {
      const clipId = useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips)[0].id;
      return { text: "", stopReason: "tool_use", toolUses: [{ id: "cap", name: "transcribe_clip", input: { clipId } }] };
    }
    return { text: "أضفت الترجمة.", stopReason: "end_turn", toolUses: [] };
  } };
}

describe("transcribe_clip tool", () => {
  beforeEach(() => {
    clearTranscribeCache();
    transcribeMock.mockReset();
    transcribeMock.mockResolvedValue({ segments: SEGMENTS, points: 2, minutes: 1, words: WORDS });
    priceMock.mockReset();
    priceMock.mockResolvedValue(2);
    useProjectStore.getState().createNewProject("Captions");
    const { project } = useProjectStore.getState();
    useProjectStore.setState({ project: { ...project, mediaLibrary: { items: [{
      id: "talk", name: "talk.mp4", type: "video", blob: new Blob(["fixture"]),
      fileHandle: null, thumbnailUrl: null, waveformData: null,
      metadata: { duration: 10, width: 640, height: 360, frameRate: 24, codec: "avc", sampleRate: 48000, channels: 1, fileSize: 7 },
    }] } } });
  });
  afterEach(() => { vi.clearAllMocks(); });

  it("is offered to the model with an Arabic label, needs confirmation and is not read-only", () => {
    const names = editingToolDefs("openai").map((d) => (d as { function: { name: string } }).function.name);
    expect(names).toContain("transcribe_clip");
    expect(editingToolNeedsConfirm("transcribe_clip")).toBe(true);
    expect(editingToolNeedsConfirm("add_clip")).toBe(false);
    expect(editingToolReadOnly("transcribe_clip")).toBe(false);
    expect(toolLabel("transcribe_clip")).toContain("بالنقاط");
    expect(EDITING_SYSTEM).toContain("transcribe_clip");
    expect(EDITING_SYSTEM).toContain("every started minute");
    expect(EDITING_SYSTEM).not.toContain("automatic transcription");
    expect(EDITING_SYSTEM).toContain("write every reply in Arabic");
  });

  it("adds one caption text clip per line inside the draft, like the manual panel", async () => {
    const { session, trackId, clipId } = await setup();
    const data = ok(await executeEditingTool("transcribe_clip", { clipId, maxWordsPerLine: 4 }, session));
    expect(data).toMatchObject({ lines: 2, points: 2, minutes: 1, reused: false, language: "ar", maxWordsPerLine: 4 });
    expect(transcribeMock).toHaveBeenCalledOnce();
    expect(transcribeMock.mock.calls[0].slice(2)).toEqual(["ar", 4]);

    const draft = session.getProject();
    const captions = draft.timeline.tracks.find((t) => t.id === data.trackId)!;
    expect(captions).toMatchObject({ role: "captions", name: "Captions", type: "text" });
    expect(draft.timeline.tracks[0].id).toBe(captions.id); // in front of the footage
    expect(captions.groupId).toBeTruthy();
    expect(draft.timeline.tracks.find((t) => t.id === trackId)!.groupId).toBe(captions.groupId);
    expect(draft.textClips).toEqual([
      expect.objectContaining({ trackId: captions.id, text: "السلام عليكم.", startTime: 0.2, metadata: { captionSource: "whisper", captionSourceClipId: clipId, captionMaxWordsPerLine: 4 } }),
      expect.objectContaining({ trackId: captions.id, text: "أهلاً وسهلاً.", startTime: 2 }),
    ]);
    expect(draft.textClips![0].duration).toBeCloseTo(1.05);
    expect(draft.textClips![0].transform.position).toEqual({ x: 0.5, y: 0.85 });
    expect(draft.textClips![0].style.textAlign).toBe("center");
    // Nothing reaches the live project before the turn commits.
    expect(useProjectStore.getState().project.textClips ?? []).toHaveLength(0);

    // A later edit in the same turn still works on the (now non-portable) draft.
    ok(await executeEditingTool("set_clip_fade", { clipId, fadeIn: 0.5 }, session));
  });

  it("uses a standard captions track when the project already has universal tracks", async () => {
    const { session, clipId } = await setup([UNIVERSAL_TRACKS_CAPABILITY]);
    const data = ok(await executeEditingTool("transcribe_clip", { clipId }, session));
    expect(session.getProject().timeline.tracks.find((t) => t.id === data.trackId)).toMatchObject({ type: "video", mode: "standard", role: "captions", name: "Captions" });
  });

  it("commits with the turn and undoes as one step", async () => {
    const before = useProjectStore.getState().project.timeline.tracks.length;
    const result = await runTurn({
      host: new EditingSession(), llm: (() => {
        let step = 0;
        return { complete: async ({ messages }) => {
          step++;
          const last = messages.at(-1);
          const data = last?.role === "tool" ? JSON.parse(last.results[0].content as string).data : undefined;
          if (step === 1) return { text: "", stopReason: "tool_use", toolUses: [{ id: "t", name: "add_track", input: { trackType: "video" } }] };
          if (step === 2) return { text: "", stopReason: "tool_use", toolUses: [{ id: "c", name: "add_clip", input: { trackId: data.trackId, mediaId: "talk", startTime: 0 } }] };
          if (step === 3) return { text: "", stopReason: "tool_use", toolUses: [{ id: "x", name: "transcribe_clip", input: { clipId: data.clipId } }] };
          return { text: "تم.", stopReason: "end_turn", toolUses: [] };
        } } satisfies LLMClient;
      })(),
      tools: editingToolDefs("openai"), system: EDITING_SYSTEM, messages: [{ role: "user", content: "ضع كابشن للفيديو" }],
      execute: executeEditingTool, readOnly: editingToolReadOnly, requiresConfirmation: editingToolNeedsConfirm, confirmGate: () => "approve", atomic: true,
    });
    expect(result.committed).toBe(true);
    expect(useProjectStore.getState().project.textClips?.map((t) => t.text)).toEqual(["السلام عليكم.", "أهلاً وسهلاً."]);
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before + 2);
    await useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.textClips ?? []).toHaveLength(0);
    expect(useProjectStore.getState().project.timeline.tracks.length).toBe(before);
  });

  it("surfaces the server's Arabic error and leaves the draft unchanged", async () => {
    transcribeMock.mockRejectedValueOnce(new Error("رصيد النقاط غير كافٍ."));
    const { session, clipId } = await setup();
    const tracks = session.getProject().timeline.tracks.length;
    const result = await executeEditingTool("transcribe_clip", { clipId }, session);
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "TRANSCRIBE_FAILED", message: "رصيد النقاط غير كافٍ." });
    expect(result.error?.recoverable).toBeUndefined();
    expect(session.getProject().timeline.tracks).toHaveLength(tracks);
    expect(session.getProject().textClips ?? []).toHaveLength(0);
  });

  it("fails the whole atomic turn with that message, without retrying", async () => {
    transcribeMock.mockRejectedValue(new Error("أقصى مدّة للتفريغ 30 دقيقة — قصّ المقطع أولاً."));
    const { session, txn } = await setup();
    await session.commitTransaction(txn, "fixture");
    const errors: string[] = [];
    const result = await runTurn({
      host: new EditingSession(), llm: captionModel(), tools: editingToolDefs("openai"), system: EDITING_SYSTEM,
      messages: [{ role: "user", content: "ضع كابشن للفيديو" }], execute: executeEditingTool, readOnly: editingToolReadOnly,
      requiresConfirmation: editingToolNeedsConfirm, confirmGate: () => "approve", atomic: true,
      onEvent: (e) => { if (e.type === "error") errors.push(e.error.message); },
    });
    expect(result.committed).toBe(false);
    expect(transcribeMock).toHaveBeenCalledOnce();
    expect(errors[0]).toContain("أقصى مدّة للتفريغ 30 دقيقة");
  });

  it("never calls the server in dry-run (preview edits only)", async () => {
    const { session, txn } = await setup();
    await session.commitTransaction(txn, "fixture");
    const confirmGate = vi.fn(() => "approve" as const);
    const result = await runTurn({
      host: new EditingSession(), llm: captionModel(), tools: editingToolDefs("openai"), system: EDITING_SYSTEM,
      messages: [{ role: "user", content: "ضع كابشن للفيديو" }], execute: executeEditingTool, readOnly: editingToolReadOnly,
      requiresConfirmation: editingToolNeedsConfirm, confirmGate, atomic: true, dryRun: true,
    });
    expect(result.messages.some((m) => m.role === "tool" && JSON.stringify(m.results).includes("[dry-run] would call transcribe_clip"))).toBe(true);
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(confirmGate).not.toHaveBeenCalled();
    expect(useProjectStore.getState().project.textClips ?? []).toHaveLength(0);
  });

  it("asks before every call and does nothing when the user rejects", async () => {
    const { session, txn } = await setup();
    await session.commitTransaction(txn, "fixture");
    const asked: ToolCall[] = [];
    const result = await runTurn({
      host: new EditingSession(), llm: captionModel(), tools: editingToolDefs("openai"), system: EDITING_SYSTEM,
      messages: [{ role: "user", content: "ضع كابشن للفيديو" }], execute: executeEditingTool, readOnly: editingToolReadOnly,
      requiresConfirmation: editingToolNeedsConfirm, confirmGate: (call) => { asked.push(call); return "reject"; }, atomic: true,
    });
    expect(asked.map((c) => c.name)).toEqual(["transcribe_clip"]);
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(result.committed).toBe(false);
  });

  it("reuses paid words after a discarded turn instead of charging again", async () => {
    const first = await setup();
    ok(await executeEditingTool("transcribe_clip", { clipId: first.clipId }, first.session));
    await first.session.rollbackTransaction();

    const again = await setup();
    const data = ok(await executeEditingTool("transcribe_clip", { clipId: again.clipId, maxWordsPerLine: 2 }, again.session));
    expect(transcribeMock).toHaveBeenCalledOnce();
    expect(data).toMatchObject({ points: 0, reused: true, lines: 2 });
    expect(again.session.getProject().textClips?.map((t) => t.text)).toEqual(["السلام عليكم.", "أهلاً وسهلاً."]);
    expect(await transcribeConfirmNote({ id: "c", name: "transcribe_clip", args: { clipId: again.clipId } }, again.session)).toContain("دون خصم");
  });

  it("leaves a clip that already has captions alone, without charging", async () => {
    const { session, clipId } = await setup();
    ok(await executeEditingTool("transcribe_clip", { clipId }, session));
    clearTranscribeCache();
    const data = ok(await executeEditingTool("transcribe_clip", { clipId }, session));
    expect(data).toMatchObject({ lines: 0, existing: 2, points: 0 });
    expect(transcribeMock).toHaveBeenCalledOnce();
  });

  it("estimates the cost for the confirmation card", async () => {
    const { session, clipId } = await setup();
    const call = (args: Record<string, unknown>): ToolCall => ({ id: "c", name: "transcribe_clip", args });
    // 10 s clip → one started minute at 2 points per minute.
    expect(await transcribeConfirmNote(call({ clipId }), session)).toContain("نحو 2 نقطة");
    expect(await transcribeConfirmNote(call({ clipId: "nope" }), session)).toContain("عن كل دقيقة");
    priceMock.mockRejectedValueOnce(new Error("offline"));
    expect(await transcribeConfirmNote(call({ clipId }), session)).toContain("عن كل دقيقة");
    expect(await transcribeConfirmNote({ id: "x", name: "add_clip", args: {} }, session)).toBeUndefined();
  });

  it("counts the points it has had charged, even when the turn is then cancelled", async () => {
    const before = transcribePointsCharged();
    const controller = new AbortController();
    transcribeMock.mockImplementationOnce(async () => { controller.abort(); return { segments: SEGMENTS, points: 2, minutes: 1, words: WORDS }; });
    const session = new EditingSession(controller.signal);
    session.beginTransaction();
    const { trackId } = ok(await executeEditingTool("add_track", { trackType: "video" }, session));
    const { clipId } = ok(await executeEditingTool("add_clip", { trackId, mediaId: "talk", startTime: 0 }, session));
    const result = await executeEditingTool("transcribe_clip", { clipId }, session);
    expect(result.ok).toBe(false); // the draft refused the captions after the cancel
    expect(transcribePointsCharged() - before).toBe(2);
    // Asking again reuses the paid words: no new charge.
    const retry = await setup();
    ok(await executeEditingTool("transcribe_clip", { clipId: retry.clipId }, retry.session));
    expect(transcribePointsCharged() - before).toBe(2);
    expect(transcribeMock).toHaveBeenCalledOnce();
  });

  it("tells the user about points spent in a turn that was discarded", () => {
    expect(transcribeChargeNotice(3)).toContain("خُصم 3 نقطة");
    expect(transcribeChargeNotice(1.234)).toContain("خُصم 1.23 نقطة");
    expect(transcribeChargeNotice(0)).toBeUndefined();
  });
});
