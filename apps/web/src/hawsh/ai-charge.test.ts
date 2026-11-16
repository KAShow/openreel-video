import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({
  hawshClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) } }),
}));

import { makeHawshAIClient } from "./ai";

const reply = { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
const ok = (): Response => new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
const fail = (status: number): Response => new Response(JSON.stringify({ error: "خطأ" }), { status });
const input = { messages: [{ role: "user" as const, content: "hi" }], tools: [] };

describe("makeHawshAIClient charged-call count", () => {
  const fetchMock = vi.fn<unknown[], Promise<Response>>();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("counts every successful reply once", async () => {
    fetchMock.mockImplementation(async () => ok());
    const onCharged = vi.fn();
    const client = makeHawshAIClient(undefined, onCharged);
    await client.complete(input);
    await client.complete(input);
    expect(onCharged).toHaveBeenCalledTimes(2);
  });

  it("counts a step that was retried after a refunded provider failure once", async () => {
    fetchMock.mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(ok());
    const onCharged = vi.fn();
    await makeHawshAIClient(undefined, onCharged).complete(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onCharged).toHaveBeenCalledTimes(1);
  });

  it("does not count calls the server refused", async () => {
    const onCharged = vi.fn();
    fetchMock.mockResolvedValueOnce(fail(402));
    await expect(makeHawshAIClient(undefined, onCharged).complete(input)).rejects.toThrow("خطأ");
    fetchMock.mockResolvedValueOnce(fail(429));
    await expect(makeHawshAIClient(undefined, onCharged).complete(input)).rejects.toThrow("خطأ");
    expect(onCharged).not.toHaveBeenCalled();
  });
});
