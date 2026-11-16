/**
 * Keeps an AI turn alive through small mistakes (Hawsh Khalifa build). The agent loop is atomic: by
 * default one failed tool call (a wrong ID, a value out of range) discards every edit of the turn, and
 * the user has already paid for the steps. A failed call that left the draft untouched is harmless, so
 * here it goes back to the model as an error to correct, up to a few times per turn. A call that failed
 * after changing the draft still ends the turn, as before.
 */
import { editSnapshot } from "@openreel/core/actions/handlers/edit-snapshot";
import type { EditingHost, ToolCall, ToolResult } from "@openreel/agent";

type Execute = (name: string, args: Record<string, unknown>, host: EditingHost) => Promise<ToolResult>;

/** Failed calls forgiven in one turn; past this the model is flailing and the turn ends. */
export const MAX_FORGIVEN_FAILURES = 4;

const RETRY_HINT = "Nothing was changed by this call. Correct the arguments and try once more, or continue without this step and tell the user; do not repeat the same call.";

const fingerprint = (host: EditingHost): string => JSON.stringify({ ...editSnapshot(host.getProject()), mediaLibrary: undefined });

export interface ForgivingExecutor {
  readonly execute: Execute;
  /** For runTurn({ continueAfterFailure }). */
  readonly continueAfterFailure: (call: ToolCall, result: ToolResult) => boolean;
}

/**
 * Wraps the tool executor for one turn. `note`, when it returns text, is added to every result summary
 * (used to warn the model that its step budget is nearly spent).
 */
export function forgivingExecutor(execute: Execute, readOnly: (name: string) => boolean, note?: () => string | undefined): ForgivingExecutor {
  const forgiven = new WeakSet<ToolResult>();
  let failures = 0;
  return {
    execute: async (name, args, host) => {
      const before = readOnly(name) ? null : fingerprint(host);
      let result = await execute(name, args, host);
      // `recoverable` failures keep the loop's own correction path (add_transition's retryOf).
      if (!result.ok && !result.error?.recoverable && failures < MAX_FORGIVEN_FAILURES && (before === null || fingerprint(host) === before)) {
        failures++;
        const error = result.error ?? { code: "INVALID_EDIT", message: result.summary };
        result = { ...result, error: { ...error, message: `${error.message}. ${RETRY_HINT}` } };
        forgiven.add(result);
      }
      const extra = note?.();
      if (extra) {
        const kept = forgiven.has(result);
        result = { ...result, summary: `${result.summary} ${extra}` };
        if (kept) forgiven.add(result);
      }
      return result;
    },
    // A rejection on the confirmation card never ran, so the draft is unchanged by definition.
    continueAfterFailure: (_call, result) => forgiven.has(result) || result.error?.code === "REJECTED",
  };
}
