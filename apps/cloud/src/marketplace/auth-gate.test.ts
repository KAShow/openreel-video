import { describe, it, expect } from "vitest";
import app from "../index";
import { getBlueprint } from "@openreel/fxpkg";

/**
 * Security regression tests for the /v1 + /templates auth gate (Vulns 2-4).
 *
 * Before the gate, identity was read verbatim from request headers, template
 * writes were unauthenticated, and /highlights ran paid AI inference for
 * anyone. These tests pin the new contract: mutating + identity-scoped routes
 * require a server-side bearer token (fail-closed when unset), the review
 * surface requires its own admin token, template deletes enforce ownership,
 * and /highlights is gone.
 */

const STUDIO_TOKEN = "studio-test-token";
const ADMIN_TOKEN = "review-test-token";

const studioAuth = { Authorization: `Bearer ${STUDIO_TOKEN}` };
const adminAuth = { Authorization: `Bearer ${ADMIN_TOKEN}` };

const creatorHeaders = {
  "Content-Type": "application/json",
  "X-User-Id": "u-creator",
  "X-Creator-Id": "c-1",
  "X-Creator-Handle": "augani",
  ...studioAuth,
};

/** Minimal R2 bucket mock covering the surface the templates routes use. */
function mockBucket() {
  interface Entry { body: string; customMetadata?: Record<string, string>; httpMetadata?: Record<string, string>; }
  const map = new Map<string, Entry>();
  return {
    async get(key: string) {
      const entry = map.get(key);
      if (!entry) return null;
      return {
        async json() { return JSON.parse(entry.body); },
        get customMetadata() { return entry.customMetadata; },
        get httpMetadata() { return entry.httpMetadata; },
      };
    },
    async head(key: string) {
      const entry = map.get(key);
      if (!entry) return null;
      return { customMetadata: entry.customMetadata, size: entry.body.length };
    },
    async put(key: string, body: string, opts?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }) {
      map.set(key, { body, customMetadata: opts?.customMetadata, httpMetadata: opts?.httpMetadata });
    },
    async delete(key: string) { map.delete(key); },
    async list(opts?: { limit?: number; cursor?: string }) {
      const keys = [...map.keys()];
      return { objects: keys.map((key) => ({ key })), truncated: false, cursor: undefined };
    },
  };
}

function makeEnv(overrides: Record<string, unknown> = {}) {
  const bucket = mockBucket();
  return {
    ENVIRONMENT: "test",
    STUDIO_API_TOKEN: STUDIO_TOKEN,
    REVIEW_ADMIN_TOKEN: ADMIN_TOKEN,
    TEMPLATES_BUCKET: bucket,
    ...overrides,
    bucket,
  } as unknown as Record<string, unknown> & { bucket: ReturnType<typeof mockBucket> };
}

const jsonBody = (payload: unknown) => JSON.stringify(payload);

describe("auth gate — /v1 identity routes (Vuln 2)", () => {
  it("fails closed when STUDIO_API_TOKEN is not configured", async () => {
    const env = makeEnv({ STUDIO_API_TOKEN: undefined });
    const r = await app.request("/v1/drafts", {
      method: "POST",
      headers: creatorHeaders,
      body: jsonBody({ kind: "filter" }),
    }, env as never);
    expect(r.status).toBe(401);
  });

  it("rejects header-only identity (the old spoofing attack)", async () => {
    const r = await app.request("/v1/drafts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": "u-victim",
        "X-Creator-Id": "c-victim",
      },
      body: jsonBody({ kind: "filter" }),
    }, makeEnv() as never);
    expect(r.status).toBe(401);
  });

  it("rejects a wrong bearer token", async () => {
    const r = await app.request("/v1/drafts", {
      method: "POST",
      headers: { ...creatorHeaders, Authorization: "Bearer wrong-token" },
      body: jsonBody({ kind: "filter" }),
    }, makeEnv() as never);
    expect(r.status).toBe(401);
  });

  it("accepts the studio token for creator routes", async () => {
    const graph = getBlueprint("passthrough.v1")!.build({});
    const r = await app.request("/v1/drafts", {
      method: "POST",
      headers: creatorHeaders,
      body: jsonBody({ kind: "filter", title: "Gated", graph }),
    }, makeEnv() as never);
    expect(r.status).toBe(201);
  });

  it("keeps public catalog reads open without a token", async () => {
    for (const path of ["/v1/blueprints", "/v1/nodelib?abi=1.0", "/v1/assets", "/v1/search?q=x"]) {
      const r = await app.request(path, {}, makeEnv() as never);
      expect(r.status, path).toBe(200);
    }
  });

  it("requires the review admin token on the review surface, not the studio token", async () => {
    const graph = getBlueprint("passthrough.v1")!.build({});
    const env = makeEnv();
    const create = await app.request("/v1/drafts", {
      method: "POST",
      headers: creatorHeaders,
      body: jsonBody({ kind: "filter", title: "Review", graph }),
    }, env as never);
    const draftId = ((await create.json()) as { id: string }).id;
    const submit = await app.request(`/v1/drafts/${draftId}/submit`, { method: "POST", headers: creatorHeaders }, env as never);
    const submissionId = ((await submit.json()) as { submission: { id: string } }).submission.id;

    const withStudio = await app.request(`/v1/submissions/${submissionId}/review`, {
      method: "POST",
      headers: { ...creatorHeaders },
      body: jsonBody({ decision: "approve" }),
    }, env as never);
    expect(withStudio.status).toBe(401);

    const listWithoutAdmin = await app.request("/v1/submissions", { headers: creatorHeaders }, env as never);
    expect(listWithoutAdmin.status).toBe(401);

    const withAdmin = await app.request(`/v1/submissions/${submissionId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuth },
      body: jsonBody({ decision: "approve" }),
    }, env as never);
    expect(withAdmin.status).toBe(200);
  });
});

describe("auth gate — community templates (Vuln 3)", () => {
  const templateBody = {
    id: "community-test-template",
    name: "Test Template",
    category: "test",
    timeline: { duration: 5, tracks: [] },
  };

  it("keeps template reads public", async () => {
    const list = await app.request("/templates", {}, makeEnv() as never);
    expect(list.status).toBe(200);
  });

  it("rejects anonymous template uploads and deletes", async () => {
    const env = makeEnv();
    const post = await app.request("/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonBody(templateBody),
    }, env as never);
    expect(post.status).toBe(401);

    const del = await app.request(`/templates/${templateBody.id}`, { method: "DELETE" }, env as never);
    expect(del.status).toBe(401);
  });

  it("accepts an authenticated upload and records the uploader", async () => {
    const env = makeEnv();
    const r = await app.request("/templates", {
      method: "POST",
      headers: { ...creatorHeaders },
      body: jsonBody(templateBody),
    }, env as never);
    expect(r.status).toBe(201);

    const head = await env.bucket.head("community-test-template.json") as { customMetadata?: Record<string, string> };
    expect(head.customMetadata?.uploadedBy).toBe("u-creator");
  });

  it("rejects template ids that are not URL-safe slugs", async () => {
    for (const id of ["../evil", "a b", "UPPER", "x/y", ""]) {
      const r = await app.request("/templates", {
        method: "POST",
        headers: { ...creatorHeaders },
        body: jsonBody({ ...templateBody, id }),
      }, makeEnv() as never);
      expect(r.status, `id=${JSON.stringify(id)}`).toBe(400);
    }
  });

  it("blocks deleting a template uploaded by someone else", async () => {
    const env = makeEnv();
    await app.request("/templates", {
      method: "POST",
      headers: { ...creatorHeaders },
      body: jsonBody(templateBody),
    }, env as never);

    const other = await app.request(`/templates/${templateBody.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${STUDIO_TOKEN}`, "X-User-Id": "u-other" },
    }, env as never);
    expect(other.status).toBe(403);

    const owner = await app.request(`/templates/${templateBody.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${STUDIO_TOKEN}`, "X-User-Id": "u-creator" },
    }, env as never);
    expect(owner.status).toBe(200);
  });

  it("still refuses to delete built-in templates, admin included", async () => {
    const env = makeEnv();
    await env.bucket.put("builtin-hero.json", "{}");
    const r = await app.request("/templates/builtin-hero", {
      method: "DELETE",
      headers: adminAuth,
    }, env as never);
    expect(r.status).toBe(403);
  });
});

describe("auth gate — /highlights removal (Vuln 4)", () => {
  it("no longer exposes the anonymous AI endpoint", async () => {
    const r = await app.request("/highlights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonBody({ transcript: [{ text: "a", start: 0, end: 1 }], energy: [], duration: 60 }),
    }, makeEnv() as never);
    expect(r.status).toBe(404);
  });
});
