import { describe, expect, it } from "vitest";
import { EDIT_TOOL_SCHEMAS } from "../../../services/agent/editing-tools";
import { toolLabel } from "./tool-labels";

describe("toolLabel", () => {
  it("has an Arabic label for every editing tool the AI Editor can call", () => {
    const missing = Object.keys(EDIT_TOOL_SCHEMAS).filter((name) => !toolLabel(name));
    expect(missing).toEqual([]);
  });

  it("returns null for an unknown tool so the caller can show its raw name", () => {
    expect(toolLabel("not_a_tool")).toBeNull();
  });
});
