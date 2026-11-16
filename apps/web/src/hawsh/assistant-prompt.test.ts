import { describe, expect, it } from "vitest";
import type { Project } from "@openreel/core";
import { EDITING_SYSTEM } from "../services/agent/editing-tools";
import { ASSISTANT_GUIDE, assistantSystem } from "./assistant-prompt";

const project = {
  id: "p", name: "Demo", settings: { width: 1920, height: 1080, frameRate: 30 },
  mediaLibrary: { items: [{ id: "m1", name: "talk.mp4", type: "video", metadata: { duration: 10, width: 1920, height: 1080 } }] },
  timeline: { duration: 10, tracks: [{ id: "t1", name: "Video 1", type: "video", clips: [{ id: "c1", mediaId: "m1", startTime: 0, duration: 10 }], transitions: [] }] },
  textClips: [],
} as unknown as Project;

describe("assistantSystem", () => {
  it("is the guide, then the tool rules, then the project as it is now", () => {
    const system = assistantSystem(project, { selectedIds: ["c1"] });
    const rules = system.indexOf(EDITING_SYSTEM);
    const state = system.indexOf("PROJECT STATE at the start of this request");
    expect(system.indexOf(ASSISTANT_GUIDE)).toBe(0);
    expect(rules).toBeGreaterThan(0);
    expect(state).toBeGreaterThan(rules);
    expect(system).toContain("clipId=c1");
    expect(system).toContain("SELECTED BY THE USER");
  });

  it("tells the model to work from the project state in few steps", () => {
    expect(ASSISTANT_GUIDE).toContain("Every model step costs the user points");
    expect(ASSISTANT_GUIDE).toContain("Do not call list or get tools for what it shows");
    expect(EDITING_SYSTEM).not.toContain("Inspect media, tracks and clips before editing");
  });

  it("orders captions before the silence cut, where one clip costs one transcription", () => {
    const rule = ASSISTANT_GUIDE.split("\n").find((line) => line.includes("Order matters")) ?? "";
    expect(rule.indexOf("transcribe each clip first")).toBeGreaterThan(0);
    expect(rule.indexOf("then cut the silence")).toBeGreaterThan(rule.indexOf("transcribe each clip first"));
    expect(rule).toContain("Caption lines move with the cut");
  });

  it("keeps the reply honest, in Arabic, and free of internals", () => {
    expect(ASSISTANT_GUIDE).toContain("Never claim a change that did not succeed");
    expect(ASSISTANT_GUIDE).toContain("no tool names, IDs, JSON");
    expect(EDITING_SYSTEM).toContain("write every reply in Arabic");
  });
});
