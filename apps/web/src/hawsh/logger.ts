/**
 * Usage and error log for the owner (Hawsh Khalifa build): rows in the Hawsh project's `editor_logs`
 * table (Front repo, migration 20261116120000_editor_logs.sql), readable only by admins, so the
 * program can be reviewed and fixed later.
 *
 * - "assistant": one row per AI assistant request: what was asked, the reply, each tool step and
 *   whether it worked, steps, points, how the request ended.
 * - "error": uncaught errors, failed promises and React crashes (deduplicated, capped per session).
 * - "usage": product events the app already tracks (project created/opened/exported…).
 *
 * Rows are queued and sent in batches with the signed-in session. Signed out, they wait (up to a cap)
 * until the user signs in. Logging never throws and never blocks the editor.
 */
import { hawshClient, useHawshStore } from "./session";

export type LogKind = "assistant" | "error" | "usage";

interface Row { kind: LogKind; session_id: string; app_version: string; data: Record<string, unknown> }

const TABLE = "editor_logs";
const BATCH = 40;
const MAX_QUEUE = 200;
const FLUSH_MS = 15_000;
const MAX_ERRORS = 40;
const SAME_ERROR = 3;
const TEXT = 2000;

const SESSION_ID = (() => {
  try { return crypto.randomUUID(); } catch { return `s-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
})();
const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) || import.meta.env.MODE || "dev";

const queue: Row[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sending = false;

/** Shortens long strings anywhere in a value, so one row stays small. */
export function clip(value: unknown, max = TEXT, depth = 0): unknown {
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => clip(v, max, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50).map(([k, v]) => [k, clip(v, max, depth + 1)]));
}

function schedule(delay = FLUSH_MS): void {
  if (timer || typeof window === "undefined") return;
  timer = setTimeout(() => { timer = null; void flushLogs(); }, delay);
}

/** Queues one row. Safe to call anywhere, any time. */
export function logEvent(kind: LogKind, data: Record<string, unknown>): void {
  try {
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push({ kind, session_id: SESSION_ID, app_version: APP_VERSION, data: { ...(clip(data) as Record<string, unknown>), route: typeof location !== "undefined" ? location.hash.slice(0, 80) : undefined } });
    schedule(kind === "error" ? 3_000 : FLUSH_MS);
  } catch { /* logging must never break the editor */ }
}

/** Sends what is queued, if signed in. Exported for tests and for page hide. */
export async function flushLogs(): Promise<void> {
  const client = hawshClient();
  if (!client || sending || queue.length === 0) return;
  sending = true;
  try {
    while (queue.length) {
      const batch = queue.splice(0, BATCH);
      const { error } = await client.from(TABLE).insert(batch);
      // A refused batch is dropped rather than retried: a broken table must not loop or grow memory.
      if (error) break;
    }
  } catch { /* offline: the rows are lost, the editor carries on */ } finally {
    sending = false;
  }
}

/** The rows waiting to be sent (tests). */
export function pendingLogs(): readonly Row[] { return queue; }

// ── errors ─────────────────────────────────────────────────────────────────
const seenErrors = new Map<string, number>();
let errorCount = 0;
const IGNORED = /ResizeObserver loop|Script error\.?$|AbortError|cancelled/i;

/** Records an error once per kind (a few times at most), with a short stack. */
export function logError(source: string, error: unknown, extra: Record<string, unknown> = {}): void {
  // A cancelled request is not a bug (DOMException is not always an Error subclass).
  if ((error as { name?: unknown } | null)?.name === "AbortError") return;
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(clip(error, 300)));
  const message = err.message || String(error);
  if (IGNORED.test(message) || err.name === "AbortError") return;
  const key = `${source}:${message.slice(0, 200)}`;
  const seen = seenErrors.get(key) ?? 0;
  if (seen >= SAME_ERROR || errorCount >= MAX_ERRORS) return;
  seenErrors.set(key, seen + 1);
  errorCount++;
  logEvent("error", { source, name: err.name, message, stack: err.stack?.split("\n").slice(0, 8).join("\n"), ...extra });
}

let installed = false;
/** Catches uncaught errors and promise failures for the whole page, and sends on sign-in and page hide. Call once at startup. */
export function installLogger(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => logError("window", event.error ?? event.message, { file: event.filename?.split("/").pop(), line: event.lineno }));
  window.addEventListener("unhandledrejection", (event) => logError("promise", event.reason));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flushLogs(); });
  useHawshStore.subscribe((state, before) => { if (state.status === "ready" && before.status !== "ready") void flushLogs(); });
}

// ── assistant requests ─────────────────────────────────────────────────────
export interface AssistantTurnLog {
  readonly phase: string;
  readonly request: string;
  readonly reply: string;
  readonly notice?: string;
  readonly plan?: boolean;
  readonly toolCalls: ReadonlyArray<{ name: string; status: string; error?: string }>;
  readonly steps: number;
  readonly points: number;
  readonly stoppedReason: string;
  readonly committed: boolean;
  readonly error?: string | null;
  readonly durationMs: number;
  readonly project?: { clips: number; media: number; texts: number; durationSec: number };
}

export function logAssistantTurn(turn: AssistantTurnLog): void {
  logEvent("assistant", { ...turn });
}
