import type { ToolResult } from "../types";

export function ok(summary: string, data?: unknown): ToolResult {
  return { ok: true, summary, data };
}

export function fail(message: string, code = "ERROR"): ToolResult {
  return { ok: false, summary: message, error: { code, message } };
}
