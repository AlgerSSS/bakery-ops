// G3c+G3d：模型分流透传 + ai_call_log fire-and-forget 落库。
// - chatCompletion 的可选 model 参数要透传到 OpenRouter 请求体（未传时回落 CHAT_MODEL 默认）。
// - ai_call_log 写失败只 logger.warn，绝不影响主流程返回。
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/modules/shared/db/postgres", () => ({
  execute: vi.fn().mockRejectedValue(new Error("db down")),
  query: vi.fn().mockRejectedValue(new Error("db down")),
}));

import { openrouterProvider } from "@/modules/shared/ai/openrouter.provider";
import { execute } from "@/modules/shared/db/postgres";
import { logger } from "@/modules/shared/logger";

function stubChatFetch(content = '{"kind":"unclear"}') {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** fire-and-forget 的落库 promise 不被 await，flush 微任务让 .catch 跑完。 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("chatCompletion model passthrough (G3c)", () => {
  it("passes the explicit model through to the OpenRouter request body", async () => {
    const fetchMock = stubChatFetch();

    await openrouterProvider.chatCompletion("classify this", 60, "google/gemini-2.5-flash");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("google/gemini-2.5-flash");
    expect(body.max_tokens).toBe(60);
    await flush();
  });

  it("falls back to the default chat model when model is omitted", async () => {
    const fetchMock = stubChatFetch();

    await openrouterProvider.chatCompletion("classify this", 60);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // 默认 = AI_CHAT_MODEL 或 openai/chatgpt-5.5-latest，绝不该是空
    expect(body.model).toBeTruthy();
    expect(body.model).not.toBe("google/gemini-2.5-flash");
    await flush();
  });

  it("jsonCompletion passes options.model through to the request body", async () => {
    const fetchMock = stubChatFetch('{"ok":true}');

    await openrouterProvider.jsonCompletion({ prompt: "p", model: "google/gemini-2.5-flash" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("google/gemini-2.5-flash");
    await flush();
  });
});

describe("ai_call_log fire-and-forget (G3d)", () => {
  it("chatCompletion returns normally and only warns when the log INSERT fails", async () => {
    stubChatFetch("hello");
    const warnSpy = vi.spyOn(logger, "warn");

    const result = await openrouterProvider.chatCompletion("prompt", 60);
    await flush();

    expect(result).toBe("hello");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(execute).mock.calls[0][0])).toContain("INSERT INTO ai_call_log");
    expect(warnSpy).toHaveBeenCalledWith("ai_call_log write failed", expect.anything());
  });

  it("jsonCompletion returns normally when the log INSERT fails", async () => {
    stubChatFetch('{"ok":true}');
    const warnSpy = vi.spyOn(logger, "warn");

    const result = await openrouterProvider.jsonCompletion({ prompt: "p" });
    await flush();

    expect(result).toBe('{"ok":true}');
    expect(warnSpy).toHaveBeenCalledWith("ai_call_log write failed", expect.anything());
  });
});
