/**
 * Chat first, then confirm (Hawsh Khalifa build). In "chat" mode (the default) a request never edits:
 * the assistant answers, or replies with a plan of what it would do, and the user carries the plan out
 * with one button. "direct" mode edits straight away, as before. The plan reply ends with PLAN_MARKER,
 * which the chat strips and turns into the confirmation card.
 */
export type AssistantMode = "chat" | "direct";
/** What one request is: a plan in chat mode, carrying out an approved plan, or a direct edit. */
export type AssistantPhase = "plan" | "execute" | "direct";

export const PLAN_MARKER = "[[RUN]]";
const MODE_KEY = "hawsh:assistant-mode";

export function loadAssistantMode(): AssistantMode {
  try { return localStorage.getItem(MODE_KEY) === "direct" ? "direct" : "chat"; } catch { return "chat"; }
}
export function saveAssistantMode(mode: AssistantMode): void {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage blocked: the choice lasts for this page only */ }
}

/** A reply without the marker, and whether it was a plan to confirm. */
export function splitPlan(text: string): { text: string; plan: boolean } {
  if (!text.includes(PLAN_MARKER)) return { text, plan: false };
  return { text: text.split(PLAN_MARKER).join("").trim(), plan: true };
}

export const PHASE_GUIDE: Record<AssistantPhase, string> = {
  plan: `MODE: DISCUSS FIRST. In this reply you cannot change the project: only read-only tools are available, and the user confirms before anything is edited.
- A question or small talk gets a direct answer.
- An edit request gets a plan, not the edit: one short line on what you understood, then the steps as a short numbered list in plain Arabic, each with the concrete values you will use (which clip, which seconds, sizes, how many). If the plan spends extra points (captions), say roughly how many. Then, alone on the very last line, the exact marker ${PLAN_MARKER}. The user sees a button to carry it out.
- Ask one question instead of a plan only when a wrong guess would spoil the work.
- Never say or imply that you already changed anything. Never write the marker except at the end of a plan.`,
  execute: `MODE: CARRY OUT THE PLAN. The user just approved the plan in your previous message. Do exactly that plan now, in as few steps as you can, without asking again, then report what changed. If the project no longer matches the plan, do what still applies and say what you skipped.`,
  direct: "",
};

/** Tool definitions (OpenAI or Anthropic format) limited to the read-only tools, for a plan. */
export function readOnlyToolDefs(defs: unknown[], readOnly: (name: string) => boolean): unknown[] {
  return defs.filter((def) => {
    const d = def as { name?: string; function?: { name?: string } };
    const name = d.function?.name ?? d.name;
    return typeof name === "string" && readOnly(name);
  });
}
