/**
 * A whole assistant turn on the real loop, tools and draft: one wrong call must not cost the user the
 * rest of the edit (assistant-recovery.ts), and the turn still commits and undoes as one step.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runTurn, type AgentEvent } from "@openreel/agent";
import type { LLMClient } from "@openreel/agent/llm";
import { useProjectStore } from "../stores/project-store";
import { EditingSession } from "../services/agent/editing-session";
import { editingToolDefs, editingToolReadOnly, executeEditingTool } from "../services/agent/editing-tools";
import { forgivingExecutor } from "./assistant-recovery";
import { assistantSystem } from "./assistant-prompt";

/** A model that places the video, then trims it with a wrong clip ID before getting it right. */
function clumsyModel(seen: { system: string[]; errors: string[] }): LLMClient {
  let step = 0;
  let clipId = "";
  return { complete: async ({ system, messages }) => {
    step++;
    seen.system.push(system ?? "");
    const last = messages.at(-1);
    const results = last?.role === "tool" ? last.results.map((r) => JSON.parse(r.content as string)) : [];
    if (step === 1) return { text: "", stopReason: "tool_use", toolUses: [{ id: "t", name: "add_track", input: { trackType: "video" } }] };
    if (step === 2) return { text: "", stopReason: "tool_use", toolUses: [{ id: "c", name: "add_clip", input: { trackId: results[0].data.trackId, mediaId: "talk", startTime: 0 } }] };
    if (step === 3) {
      clipId = results[0].data.clipId;
      return { text: "", stopReason: "tool_use", toolUses: [
        { id: "bad", name: "trim_clip", input: { clipId: "no-such-clip", outPoint: 6 } },
        { id: "fade", name: "set_clip_fade", input: { clipId, fadeIn: 0.5 } },
      ] };
    }
    if (step === 4) {
      seen.errors.push(results[0].error.message);
      return { text: "", stopReason: "tool_use", toolUses: [{ id: "good", name: "trim_clip", input: { clipId, outPoint: 6 } }] };
    }
    return { text: "قصصت المقطع إلى 6 ثوانٍ وأضفت ظهوراً تدريجياً.", stopReason: "end_turn", toolUses: [] };
  } };
}

describe("an assistant turn with a mistake in it", () => {
  beforeEach(() => {
    useProjectStore.getState().createNewProject("Turn");
    const { project } = useProjectStore.getState();
    useProjectStore.setState({ project: { ...project, mediaLibrary: { items: [{
      id: "talk", name: "talk.mp4", type: "video", blob: new Blob(["fixture"]), fileHandle: null, thumbnailUrl: null, waveformData: null,
      metadata: { duration: 10, width: 640, height: 360, frameRate: 24, codec: "avc", sampleRate: 48000, channels: 1, fileSize: 7 },
    }] } } });
  });

  const turn = (forgive: boolean, seen = { system: [] as string[], errors: [] as string[] }, events: AgentEvent[] = []) => {
    const forgiving = forgivingExecutor(executeEditingTool, editingToolReadOnly);
    return runTurn({
      host: new EditingSession(), llm: clumsyModel(seen), tools: editingToolDefs("openai"),
      system: assistantSystem(useProjectStore.getState().getFullProject()),
      messages: [{ role: "user", content: "ضع الفيديو وقصّه إلى 6 ثوانٍ مع ظهور تدريجي" }],
      execute: forgive ? forgiving.execute : executeEditingTool, readOnly: editingToolReadOnly, atomic: true,
      ...(forgive ? { continueAfterFailure: forgiving.continueAfterFailure } : {}),
      onEvent: (event) => events.push(event),
    });
  };
  const clips = () => useProjectStore.getState().project.timeline.tracks.flatMap((t) => t.clips);

  it("used to lose the whole edit to one wrong ID", async () => {
    const result = await turn(false);
    expect(result.committed).toBe(false);
    expect(clips()).toHaveLength(0);
  });

  it("now shows the model its mistake, keeps the other edits, and commits once it is corrected", async () => {
    const seen = { system: [] as string[], errors: [] as string[] };
    const events: AgentEvent[] = [];
    const result = await turn(true, seen, events);
    expect(result).toMatchObject({ committed: true, stoppedReason: "end_turn", toolCalls: 5 });
    expect(seen.errors[0]).toMatch(/Nothing was changed by this call/);
    expect(clips()).toHaveLength(1);
    expect(clips()[0]).toMatchObject({ outPoint: 6, duration: 6, fade: { fadeIn: 0.5 } });
    // The failed call stays visible to the user as failed.
    const failed = events.filter((e) => e.type === "tool_result" && !e.result.ok).map((e) => (e.type === "tool_result" ? e.call.id : ""));
    expect(failed).toEqual(["bad"]);

    await useProjectStore.getState().undo();
    expect(clips()).toHaveLength(0);
  });

  it("gives the model the project up front, so it need not look first", async () => {
    const seen = { system: [] as string[], errors: [] as string[] };
    await turn(true, seen);
    expect(seen.system[0]).toContain('mediaId=talk "talk.mp4" video 10s 640x360, NOT on the timeline yet');
  });
});
