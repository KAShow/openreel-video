import { beforeEach, describe, expect, it, vi } from "vitest";

/* A small fake project store: applies the actions the phone sheets use, and records them. */
type Effect = { id: string; type: string; params: Record<string, unknown>; enabled: boolean };
type Clip = { id: string; trackId: string; mediaId: string; startTime: number; duration: number; volume?: number; effects: Effect[]; audioEffects: Effect[]; fade?: { fadeIn: number; fadeOut: number }; reversed?: boolean; transform?: Record<string, unknown> };
type Track = { id: string; type: string; clips: Clip[]; transitions: { id: string; clipAId: string; clipBId: string; type: string; duration: number }[]; muted?: boolean; locked?: boolean };

const log: string[] = [];
const state = {
  project: null as unknown as { settings: { width: number; height: number }; mediaLibrary: { items: { id: string; type: string }[] }; timeline: { tracks: Track[] } },
  groups: 0,
  beginHistoryGroup: vi.fn(() => { state.groups++; log.push("begin"); }),
  endHistoryGroup: vi.fn(() => log.push("end")),
  addClipToNewTrack: vi.fn(async (mediaId: string, startTime: number) => {
    const id = `new-${mediaId}`;
    state.project.timeline.tracks.push({ id: `t-${id}`, type: "audio", transitions: [], clips: [{ id, trackId: `t-${id}`, mediaId, startTime, duration: 30, effects: [], audioEffects: [] }] });
    log.push(`addClipToNewTrack ${mediaId} ${startTime}`);
    return { success: true };
  }),
  executeAction: vi.fn(async (a: { type: string; params: Record<string, unknown> }) => {
    const p = a.params;
    const clips = state.project.timeline.tracks.flatMap((t) => t.clips);
    const clip = clips.find((c) => c.id === p.clipId);
    switch (a.type) {
      case "effect/add": clip!.effects.push({ id: String(p.effectId), type: String(p.effectType), params: p.params as Record<string, unknown>, enabled: true }); break;
      case "effect/remove": clip!.effects = clip!.effects.filter((e) => e.id !== p.effectId); break;
      case "effect/update": { const e = clip!.effects.find((x) => x.id === p.effectId)!; e.params = { ...e.params, ...(p.params as object) }; break; }
      case "transition/set": {
        const t = p.transition as Track["transitions"][number];
        const track = state.project.timeline.tracks.find((x) => x.clips.some((c) => c.id === t.clipAId))!;
        track.transitions = [...track.transitions.filter((x) => !(x.clipAId === t.clipAId && x.clipBId === t.clipBId)), t];
        break;
      }
      case "transition/remove": for (const t of state.project.timeline.tracks) t.transitions = t.transitions.filter((x) => x.id !== p.transitionId); break;
      case "audio/setFade": clip!.fade = { fadeIn: Number(p.fadeIn), fadeOut: Number(p.fadeOut) }; break;
      case "audio/setVolume": clip!.volume = Number(p.volume); break;
      case "audio/addEffect": clip!.audioEffects.push(p.effect as Effect); break;
      case "audio/removeEffect": clip!.audioEffects = clip!.audioEffects.filter((e) => e.id !== p.effectId); break;
      case "track/mute": state.project.timeline.tracks.find((t) => t.id === p.trackId)!.muted = Boolean(p.muted); break;
      case "project/updateSettings": state.project.settings = { ...state.project.settings, ...(p as object) }; break;
      case "transform/update": clip!.transform = { ...clip!.transform, ...(p.transform as object) }; break;
      case "clip/setReverse": clip!.reversed = Boolean(p.reversed); break;
      default: return { success: false };
    }
    log.push(a.type);
    return { success: true };
  }),
};
vi.mock("../../stores/project-store", () => ({ useProjectStore: { getState: () => state } }));
vi.mock("@openreel/core", async (orig) => ({ ...(await orig<object>()), getSpeedEngine: () => ({ setReverse: vi.fn() }) }));

const cuts = await import("./cuts");
const fx = await import("./effect-tools");
const audio = await import("./audio-tools");
const proj = await import("./project-tools");
const { sheetTarget } = await import("./live");

const clip = (id: string, start: number, mediaId = "vid"): Clip => ({ id, trackId: "main", mediaId, startTime: start, duration: 5, effects: [], audioEffects: [] });

beforeEach(() => {
  log.length = 0;
  state.groups = 0;
  state.project = {
    settings: { width: 1920, height: 1080 },
    mediaLibrary: { items: [{ id: "vid", type: "video" }, { id: "img", type: "image" }, { id: "song", type: "audio" }] },
    timeline: { tracks: [{ id: "main", type: "video", transitions: [], clips: [clip("a", 0), clip("b", 5), clip("c", 10, "img")] }] },
  };
});

describe("transitions on the phone", () => {
  it("lists the cuts of the main track and picks the one nearest the playhead", () => {
    const list = cuts.mainCuts(state.project as never);
    expect(list.map((c) => [c.clipAId, c.clipBId, c.time, c.index])).toEqual([["a", "b", 5, 1], ["b", "c", 10, 2]]);
    expect(cuts.nearestCut(list, 8.9)?.clipAId).toBe("b");
    expect(cuts.nearestCut([], 3)).toBeNull();
  });

  it("puts, replaces and removes a transition, and does all cuts as one undo step", async () => {
    const [first] = cuts.mainCuts(state.project as never);
    expect(await cuts.setTransition(first, "crossfade", 0.4)).toBeNull();
    expect(await cuts.setTransition(first, "slide", 0.4)).toBeNull();
    expect(state.project.timeline.tracks[0].transitions.map((t) => t.type)).toEqual(["slide"]);
    expect(await cuts.removeTransition(cuts.mainCuts(state.project as never)[0])).toBeNull();
    expect(state.project.timeline.tracks[0].transitions).toEqual([]);

    log.length = 0;
    expect(await cuts.setTransitionEverywhere("dipToBlack", 0.5)).toBeNull();
    expect(log).toEqual(["begin", "transition/set", "transition/set", "end"]);
    expect(cuts.mainCuts(state.project as never).every((c) => c.transition?.type === "dipToBlack")).toBe(true);
    expect(await cuts.removeAllTransitions()).toBeNull();
    expect(state.project.timeline.tracks[0].transitions).toEqual([]);
  });
});

describe("effects on the phone", () => {
  it("replaces the look instead of stacking it, and reads its strength back", async () => {
    expect(await fx.applyLook("a", "cinematic", 1)).toBeNull();
    const n = state.project.timeline.tracks[0].clips[0].effects.length;
    expect(n).toBe(4);
    expect(await fx.applyLook("a", "bw", 0.5)).toBeNull();
    const a = state.project.timeline.tracks[0].clips[0];
    expect(a.effects.map((e) => e.type)).toEqual(["saturation", "contrast"]);
    expect(fx.currentLook(a as never)).toEqual({ id: "bw", strength: 0.5 });
    expect(a.effects[0].params).toEqual({ value: 0.5 });
    expect(await fx.applyLook("a", null)).toBeNull();
    expect(a.effects).toEqual([]);
  });

  it("keeps manual adjustments when the look changes, and removes one set back to neutral", async () => {
    const brightness = fx.ADJUSTMENTS.find((x) => x.type === "brightness")!;
    expect(await fx.setAdjustment("a", brightness, 0.2)).toBeNull();
    expect(await fx.setAdjustment("a", brightness, 0.3)).toBeNull();
    await fx.applyLook("a", "vivid");
    const a = state.project.timeline.tracks[0].clips[0];
    expect(fx.adjustmentValue(a as never, brightness)).toBe(0.3);
    expect(a.effects.filter((e) => e.type === "brightness")).toHaveLength(1);
    expect(await fx.setAdjustment("a", brightness, 0)).toBeNull();
    expect(fx.adjustmentValue(a as never, brightness)).toBe(0);
    expect(a.effects.some((e) => e.id.startsWith("hawsh-adj-"))).toBe(false);
  });

  it("keeps every look inside the effect ranges the export accepts", () => {
    for (const look of fx.LOOKS) {
      for (const e of fx.lookEffects(look, 1)) {
        for (const v of Object.values(e.params)) expect(Number.isFinite(v)).toBe(true);
        if (e.type === "saturation" || e.type === "contrast") expect(e.params.value).toBeLessThanOrEqual(3);
        if (e.type === "vignette" || e.type === "grain") expect(e.params.amount).toBeLessThanOrEqual(1);
      }
    }
  });

  it("puts the look on every picture clip of the main track at once", async () => {
    expect(await fx.applyLookEverywhere("drama", 1)).toBeNull();
    expect(state.groups).toBe(1);
    expect(state.project.timeline.tracks[0].clips.every((c) => fx.currentLook(c as never)?.id === "drama")).toBe(true);
  });
});

describe("sound on the phone", () => {
  it("puts music at the playhead, quiet under a video with sound, with fades", async () => {
    expect(audio.hasVideoSound(state.project as never)).toBe(true);
    expect(await audio.placeAudio(["song", "vid"], 7)).toBe(1);
    const added = state.project.timeline.tracks.at(-1)!.clips[0];
    expect(added).toMatchObject({ startTime: 7, volume: audio.MUSIC_UNDER_SPEECH, fade: { fadeIn: 0.5, fadeOut: 0.5 } });
  });

  it("keeps music at full volume when the video is muted", async () => {
    expect(await audio.muteOriginal(true)).toBeNull();
    expect(audio.isOriginalMuted(state.project as never)).toBe(true);
    await audio.placeAudio(["song"], 0);
    expect(state.project.timeline.tracks.at(-1)!.clips[0].volume).toBeUndefined();
  });

  it("turns noise reduction on once and off again", async () => {
    await audio.setNoiseReduction("a", true);
    await audio.setNoiseReduction("a", true);
    const a = state.project.timeline.tracks[0].clips[0];
    expect(a.audioEffects.map((e) => e.type)).toEqual(["noiseReduction"]);
    expect(audio.hasNoiseReduction(a as never)).toBe(true);
    await audio.setNoiseReduction("a", false);
    expect(a.audioEffects).toEqual([]);
  });

  it("names recordings by their format", () => {
    expect(audio.recordingName("audio/webm;codecs=opus")).toMatch(/^تسجيل .*\.webm$/);
    expect(audio.recordingName("audio/mp4")).toMatch(/\.m4a$/);
  });
});

describe("project tools on the phone", () => {
  it("changes the format and makes every picture fill the frame, as one undo step", async () => {
    expect(proj.currentFormat(state.project.settings)?.id).toBe("16:9");
    expect(await proj.setFormat("9:16")).toBeNull();
    expect(state.project.settings).toMatchObject({ width: 1080, height: 1920 });
    expect(state.project.timeline.tracks[0].clips.every((c) => c.transform?.fitMode === "cover")).toBe(true);
    expect(state.groups).toBe(1);
  });

  it("reverses a clip", async () => {
    expect(await proj.setReversed("b", true)).toBeNull();
    expect(state.project.timeline.tracks[0].clips[1].reversed).toBe(true);
  });

  it("works on the selected clip, else the main-track clip under the playhead", () => {
    expect(sheetTarget(state.project as never, [], 6)).toMatchObject({ index: 2, clip: { id: "b" } });
    expect(sheetTarget(state.project as never, [{ type: "clip", id: "c" }], 0)).toMatchObject({ index: 3, clip: { id: "c" } });
    expect(sheetTarget(state.project as never, [], 99)?.clip.id).toBe("c");
  });
});
