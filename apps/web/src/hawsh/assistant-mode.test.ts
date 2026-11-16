import { describe, expect, it } from "vitest";
import { PHASE_GUIDE, PLAN_MARKER, readOnlyToolDefs, splitPlan } from "./assistant-mode";
import { assistantSystem } from "./assistant-prompt";
import type { Project } from "@openreel/core";

describe("splitPlan", () => {
  it("takes the marker off a plan and says it was one", () => {
    expect(splitPlan(`سأفعل كذا:\n1. قص\n${PLAN_MARKER}`)).toEqual({ text: "سأفعل كذا:\n1. قص", plan: true });
  });
  it("leaves an ordinary reply alone", () => {
    expect(splitPlan("أستطيع القص والترجمة.")).toEqual({ text: "أستطيع القص والترجمة.", plan: false });
  });
});

describe("readOnlyToolDefs", () => {
  const readOnly = (name: string) => name.startsWith("list_");
  it("keeps only read-only tools, in both provider formats", () => {
    expect(readOnlyToolDefs([{ type: "function", function: { name: "list_clips" } }, { type: "function", function: { name: "trim_clip" } }], readOnly))
      .toEqual([{ type: "function", function: { name: "list_clips" } }]);
    expect(readOnlyToolDefs([{ name: "list_media" }, { name: "remove_clip" }], readOnly)).toEqual([{ name: "list_media" }]);
  });
});

describe("the mode in the system prompt", () => {
  const project = { id: "p", name: "p", settings: { width: 1080, height: 1920, frameRate: 30 }, mediaLibrary: { items: [] }, timeline: { duration: 0, tracks: [] }, textClips: [] } as unknown as Project;
  it("asks for a plan ending with the marker, and never an edit, in chat mode", () => {
    const system = assistantSystem(project, {}, "plan");
    expect(system).toContain(PHASE_GUIDE.plan);
    expect(PHASE_GUIDE.plan).toContain(PLAN_MARKER);
    expect(PHASE_GUIDE.plan).toContain("you cannot change the project");
    expect(system.indexOf(PHASE_GUIDE.plan)).toBeLessThan(system.indexOf("PROJECT STATE at the start"));
  });
  it("carries out the approved plan without asking again", () => {
    expect(assistantSystem(project, {}, "execute")).toContain("The user just approved the plan");
  });
  it("adds nothing in direct mode", () => {
    const direct = assistantSystem(project, {});
    expect(direct).not.toContain("MODE:");
  });
});
