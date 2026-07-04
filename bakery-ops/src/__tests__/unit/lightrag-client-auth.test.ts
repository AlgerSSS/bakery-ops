import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { LightRAGClient } from "@/modules/domain/knowledge/lightrag-client";

const okResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as Response;

describe("LightRAGClient auth header", () => {
  const originalKey = process.env.LIGHTRAG_API_KEY;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.LIGHTRAG_API_KEY;
    else process.env.LIGHTRAG_API_KEY = originalKey;
  });

  it("sends Authorization: Bearer header when LIGHTRAG_API_KEY is set", async () => {
    process.env.LIGHTRAG_API_KEY = "test-key-123";
    const client = new LightRAGClient("http://localhost:8020");

    fetchMock.mockResolvedValue(okResponse({ chars: 5 }));
    await client.ingest("hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, ingestInit] = fetchMock.mock.calls[0];
    expect(ingestInit.headers).toMatchObject({ Authorization: "Bearer test-key-123" });

    fetchMock.mockResolvedValue(okResponse({ answer: "hi" }));
    await client.query("question");
    const [, queryInit] = fetchMock.mock.calls[1];
    expect(queryInit.headers).toMatchObject({ Authorization: "Bearer test-key-123" });
  });

  it("omits Authorization header when LIGHTRAG_API_KEY is unset", async () => {
    delete process.env.LIGHTRAG_API_KEY;
    const client = new LightRAGClient("http://localhost:8020");

    fetchMock.mockResolvedValue(okResponse({ chars: 5 }));
    await client.ingest("hello");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).not.toHaveProperty("Authorization");
  });
});
