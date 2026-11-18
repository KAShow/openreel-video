import type { Context } from "hono";

/**
 * Identity behind the token gate (STUDIO_PLAN §45.3). `Authorization` now
 * carries the server-issued API token (verified by requireApiToken); the
 * acting identity is the X-User-Id / X-Creator-Id headers, which are only
 * trusted on requests that already passed that gate.
 */
export interface Identity {
  userId: string;
  creatorId?: string;
  handle?: string;
}

export function getIdentity(c: Context): Identity | null {
  const userId = c.req.header("x-user-id");
  if (!userId) return null;
  const creatorId = c.req.header("x-creator-id") || userId;
  const handle = c.req.header("x-creator-handle") || undefined;
  return { userId, creatorId, handle };
}

export function requireUser(c: Context): Identity | Response {
  const id = getIdentity(c);
  if (!id) return c.json({ error: "unauthorized" }, 401);
  return id;
}

export function requireCreator(c: Context): (Identity & { creatorId: string }) | Response {
  const id = getIdentity(c);
  if (!id || !id.creatorId) return c.json({ error: "creator_required" }, 401);
  return { ...id, creatorId: id.creatorId };
}

export function isResponse(v: unknown): v is Response {
  return v instanceof Response;
}

// ── Bearer token gate (security fix: /v1 + templates) ────────────────────────
//
// Identity headers were previously trusted verbatim, so anyone could act as
// any creator/reviewer. Gated routes now require a server-side bearer token;
// identity headers are only an internal routing hint behind that gate. The
// secrets live in Worker env (wrangler secret put). Fail-closed: an unset
// secret denies everyone.

const encoder = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

export function bearerToken(c: Context): string | undefined {
  const auth = c.req.header("authorization");
  return auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : undefined;
}

export function tokenMatches(c: Context, secret: string | undefined): boolean {
  const presented = bearerToken(c);
  if (!secret || !presented) return false;
  return timingSafeEqual(presented, secret);
}

/** Returns a 401 Response when the request lacks the expected token, else null. */
export function requireApiToken(
  c: Context,
  envKey: "STUDIO_API_TOKEN" | "REVIEW_ADMIN_TOKEN",
): Response | null {
  if (!tokenMatches(c, c.env[envKey])) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return null;
}
