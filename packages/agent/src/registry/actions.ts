import {
  RegisteredTool,
  fail,
  genId,
  obj,
  ok,
  str,
} from "./shared";
import {
  type Action,
} from "@openreel/core/types/actions";

export const actionToolsList: RegisteredTool[] = [
  {
    name: "execute_action",
    domain: "raw",
    title: "Execute action",
    description:
      "Escape hatch: dispatch any underlying editor action by type + params. Use get_capabilities and the action catalog for valid types.",
    inputSchema: obj({ type: str, params: { type: "object" } }, ["type"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const action: Action = {
        type: String(args.type),
        id: genId(),
        timestamp: Date.now(),
        params: (args.params as Record<string, unknown>) ?? {},
      };
      const result = await host.applyAction(action);
      return result.success
        ? ok(`executed ${action.type}`, { actionId: action.id })
        : fail(result.error?.message ?? "action failed", result.error?.code ?? "ACTION_FAILED");
    },
  },
  {
    name: "batch_actions",
    domain: "raw",
    title: "Batch actions",
    description: "Dispatch a sequence of raw actions in order; stops on first failure.",
    inputSchema: obj({ actions: { type: "array" } }, ["actions"]),
    readOnly: false,
    destructive: true,
    expensive: false,
    handler: async (args, host) => {
      host.requireOpenProject();
      const list = (args.actions as Array<{ type: string; params?: Record<string, unknown> }>) ?? [];
      let applied = 0;
      for (const a of list) {
        const action: Action = {
          type: String(a.type),
          id: genId(),
          timestamp: Date.now(),
          params: a.params ?? {},
        };
        const result = await host.applyAction(action);
        if (!result.success) {
          return fail(`batch failed at #${applied} (${a.type}): ${result.error?.message}`, "BATCH_FAILED");
        }
        applied++;
      }
      return ok(`applied ${applied} actions`);
    },
  }
];
