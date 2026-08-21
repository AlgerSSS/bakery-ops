import { afterEach, describe, expect, it, vi } from "vitest";

import { KnowledgeClient, SupabaseKnowledgeClient } from "@/modules/domain/knowledge/knowledge-client";

const okResponse = (body: unknown = {}) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as unknown as Response;

afterEach(() => {
  delete process.env.KNOWLEDGE_UNCLASSIFIED_INGEST_ENABLED;
});

describe("SupabaseKnowledgeClient", () => {
  it("checks the controlled platform health RPC without creating an embedding", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse());
    const embed = vi.fn();
    const client = new SupabaseKnowledgeClient({
      baseUrl: "https://r6.example.test/",
      serviceKey: "secret",
      fetchFn,
      embed,
    });

    expect(await client.isAvailable()).toBe(true);
    expect(embed).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledWith(
      "https://r6.example.test/rest/v1/rpc/ops_get_platform_health",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ apikey: "secret", Authorization: "Bearer secret" }),
        body: "{}",
      }),
    );
  });

  it("searches only explicit spaces and returns page citations", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([
      {
        title: "Colleague Skill",
        page_from: 2,
        page_to: 2,
        section_path: ["Part A"],
        content: "Work Skill and Persona are separate parts.",
        hybrid_score: 0.83,
        citation_uri: null,
        citation_label: "Colleague Skill · page 2",
      },
    ]));
    const embed = vi.fn().mockResolvedValue([0.1, 0.2]);
    const client = new SupabaseKnowledgeClient({
      baseUrl: "https://r6.example.test",
      serviceKey: "secret",
      spaceIds: ["10000000-0000-7000-8000-000000000001"],
      modelVersion: "openai/text-embedding-3-small",
      fetchFn,
      embed,
    });

    const result = await client.query("What are the two parts?");

    expect(result).toContain("Colleague Skill");
    expect(result).toContain("第 2 页");
    expect(result).toContain("Part A");
    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://r6.example.test/rest/v1/rpc/ai_search_knowledge_v2",
    );
    const request = fetchFn.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      p_query: "What are the two parts?",
      p_query_embedding: [0.1, 0.2],
      p_limit: 4,
      p_space_ids: ["10000000-0000-7000-8000-000000000001"],
      p_model_version: "openai/text-embedding-3-small",
    });
  });

  it("returns a direct Lark source link without inventing PDF page numbers", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse([
      {
        title: "门店文件",
        page_from: null,
        page_to: null,
        section_path: ["门店文件"],
        content: "Pavilion 门店营业资料。",
        hybrid_score: 0.91,
        citation_uri: "https://example.larksuite.com/wiki/node-1",
        citation_label: "门店文件",
      },
    ]));
    const client = new SupabaseKnowledgeClient({
      baseUrl: "https://r6.example.test",
      serviceKey: "secret",
      spaceIds: ["10000000-0000-7000-8000-000000000001"],
      fetchFn,
      embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    });

    const result = await client.query("Pavilion 门店资料");

    expect(result).toContain("在线文档");
    expect(result).toContain("来源：https://example.larksuite.com/wiki/node-1");
    expect(result).not.toContain("页码未知");
  });

  it("blocks direct text ingestion", async () => {
    const client = new SupabaseKnowledgeClient({ baseUrl: "https://r6.example.test", serviceKey: "secret" });
    expect(await client.ingest("员工姓名：张三")).toBe(false);
  });
});

describe("KnowledgeClient", () => {
  it("blocks unclassified LightRAG ingestion only when explicitly disabled", async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal("fetch", fetchFn);
    try {
      process.env.KNOWLEDGE_UNCLASSIFIED_INGEST_ENABLED = "false";
      const client = new KnowledgeClient("lightrag");
      expect(await client.ingest("未分级文本")).toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
