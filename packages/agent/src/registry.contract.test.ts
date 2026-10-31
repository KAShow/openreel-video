import { describe, expect, it } from "vitest";
import {
  listTools,
  toAnthropicTools,
  toCapabilityDoc,
  toMcpTools,
  toOpenAITools,
  toolDefs,
} from "./registry";

describe("registry public contract", () => {
  it("preserves the ordered public tool definitions", () => {
    const tools = listTools();
    const names = tools.map((tool) => tool.name);

    expect(tools.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(toolDefs()).toMatchSnapshot();
  });

  it("projects the same ordered definitions to every provider", () => {
    const definitions = toolDefs();

    expect(toAnthropicTools()).toEqual(
      definitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
    );
    expect(toOpenAITools()).toEqual(
      definitions.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })),
    );
    expect(toMcpTools()).toEqual(
      definitions.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    );
  });

  it("preserves the generated capability reference", () => {
    expect(toCapabilityDoc()).toMatchSnapshot();
  });
});
