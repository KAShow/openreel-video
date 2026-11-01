import type { EditingHost } from "../host";
import type { JSONSchema, ToolDef, ToolResult } from "../types";

export type ToolHandler = (
  args: Record<string, unknown>,
  host: EditingHost,
) => Promise<ToolResult> | ToolResult;

export interface RegisteredTool extends ToolDef {
  readonly handler: ToolHandler;
}

export interface NamedToolSchema {
  name: string;
  description: string;
  input_schema: JSONSchema;
}
