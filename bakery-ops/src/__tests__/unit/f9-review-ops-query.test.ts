// f9-review-ops-query.test.ts
//
// 锁定 IMPROVEMENT-PLAN.md F9 + G3c/G3f + G4 客户端侧行为：
// - F9a：handleInitialReview 用 SQL 精确读昨日 manager_review.insight，非空注入 prompt
//   并要求输出「昨日决策跟进」小节；无 insight 不注入。
// - F9b：knowledge_query 经营类分支——问题涉及销售/单品/时段时调共享 queryDataForQuestion。
// - G3c：意图分类走 AI_SMALL_MODEL（chatCompletion 第三参）。
// - G3f：错误文案固定中文，不透传原始异常。
// - G4-①：lightragClient.ingest fire-and-forget，不 await（未 resolve 的 ingest 不阻塞回复）。
// - G4-⑤：daily-review 的 RAG 查询 mode=naive，查询串只用店长原文（无固定前缀）。

import { describe, it, expect, vi, beforeEach } from "vitest";

const chatCompletionLong = vi.fn();
const chatCompletion = vi.fn();
vi.mock("@/modules/domain/ai/ai-provider", () => ({
  aiProvider: {
    chatCompletionLong: (...args: unknown[]) => chatCompletionLong(...args),
    chatCompletion: (...args: unknown[]) => chatCompletion(...args),
  },
}));

const query = vi.fn();
vi.mock("@/modules/shared/db/postgres", () => ({
  query: (...args: unknown[]) => query(...args),
}));

const ragIsAvailable = vi.fn();
const ragQuery = vi.fn();
const ragIngest = vi.fn();
vi.mock("@/modules/domain/knowledge/lightrag-client", () => ({
  lightragClient: {
    isAvailable: (...args: unknown[]) => ragIsAvailable(...args),
    query: (...args: unknown[]) => ragQuery(...args),
    ingest: (...args: unknown[]) => ragIngest(...args),
  },
}));

vi.mock("@/modules/domain/forecast/forecast.service", () => ({
  getProductForecast: vi.fn().mockRejectedValue(new Error("not configured")),
}));

const getStats = vi.fn();
vi.mock("@/modules/data/repositories/employee.repository", () => ({
  employeeRepository: { getStats: (...args: unknown[]) => getStats(...args) },
}));

import { DailyReviewChatSkillHandler } from "@/modules/skills/daily-review-chat/daily-review-chat.definition";
import { KnowledgeQuerySkillHandler, knowledgeQuerySkillDefinition } from "@/modules/skills/knowledge-query/knowledge-query.definition";
import { queryDataForQuestion } from "@/modules/domain/forecast/ops-data-query";
import type { SkillExecutionInput } from "@/modules/shared/types";

function makeInput(skillId: string, input: Record<string, unknown>): SkillExecutionInput {
  return { skillId, userId: "u1", channel: "whatsapp", conversationId: "c1", input };
}

beforeEach(() => {
  chatCompletionLong.mockReset().mockResolvedValue("AI分析结果");
  chatCompletion.mockReset().mockResolvedValue('{"type":"general"}');
  query.mockReset().mockResolvedValue([]);
  ragIsAvailable.mockReset().mockResolvedValue(false);
  ragQuery.mockReset().mockResolvedValue(null);
  ragIngest.mockReset().mockResolvedValue(true);
  getStats.mockReset().mockResolvedValue({ total: 10, active: 8, resigned: 2, avgTenure: 6, resignedThisMonth: 1 });
});

describe("F9a 昨日决策闭环", () => {
  const handler = new DailyReviewChatSkillHandler();

  it("昨日 insight 非空：SQL 精确读取并注入 prompt，要求「昨日决策跟进」小节", async () => {
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("SELECT insight FROM manager_review")) {
        return [{ insight: "蛋挞备货量从40提高到50" }];
      }
      return [];
    });

    const result = await handler.execute(
      makeInput("daily_review_chat", { jdText: "今天复盘：2026-07-01 一切正常", text: "今天复盘：2026-07-01 一切正常" }),
    );

    expect(result.status).toBe("pending");
    const insightSelects = query.mock.calls.filter((c) => String(c[0]).includes("SELECT insight FROM manager_review"));
    expect(insightSelects).toHaveLength(1);
    expect(insightSelects[0][1]).toEqual(["2026-06-30"]);

    const prompt = String(chatCompletionLong.mock.calls[0][0]);
    expect(prompt).toContain("蛋挞备货量从40提高到50");
    expect(prompt).toContain("2026-06-30");
    expect(prompt).toContain("昨日决策跟进");
  });

  it("昨日 insight 为空：prompt 不含「昨日决策跟进」要求", async () => {
    await handler.execute(
      makeInput("daily_review_chat", { jdText: "今天复盘：2026-07-01 一切正常", text: "今天复盘：2026-07-01 一切正常" }),
    );
    const prompt = String(chatCompletionLong.mock.calls[0][0]);
    expect(prompt).not.toContain("昨日决策跟进");
  });
});

describe("G4 客户端侧：RAG 查询与 ingest", () => {
  const handler = new DailyReviewChatSkillHandler();

  it("daily-review 的 RAG 查询 mode=naive，查询串只用店长原文（无固定前缀）", async () => {
    ragIsAvailable.mockResolvedValue(true);
    const text = "今天复盘：2026-07-01 下午蛋挞断货";
    await handler.execute(makeInput("daily_review_chat", { jdText: text, text }));

    expect(ragQuery).toHaveBeenCalledTimes(1);
    const [q, mode] = ragQuery.mock.calls[0];
    expect(mode).toBe("naive");
    expect(String(q)).not.toContain("复盘 运营问题 策略");
    expect(String(q)).toContain("下午蛋挞断货");
  });

  it("ingest 不阻塞回复链路：ingest promise 未 resolve，handler 仍正常返回", async () => {
    ragIsAvailable.mockResolvedValue(true);
    ragIngest.mockImplementation(() => new Promise(() => { /* never resolves */ }));

    const text = "今天复盘：2026-07-01 下午蛋挞断货";
    const result = await handler.execute(makeInput("daily_review_chat", { jdText: text, text }));

    expect(ragIngest).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("pending");

    // 结束复盘（写 insight → ingest 复盘总结）同样不被未 resolve 的 ingest 阻塞
    const end = await handler.execute(makeInput("daily_review_chat", { text: "没了", ...result.data }));
    expect(end.status).toBe("success");
  });
});

describe("G3c 意图分类走 AI_SMALL_MODEL", () => {
  it("chatCompletion 第三参 = process.env.AI_SMALL_MODEL", async () => {
    const prev = process.env.AI_SMALL_MODEL;
    process.env.AI_SMALL_MODEL = "test/small-model";
    try {
      await queryDataForQuestion("蛋挞几点卖完的？", "2026-07-01");
      expect(chatCompletion).toHaveBeenCalledTimes(1);
      expect(chatCompletion.mock.calls[0][2]).toBe("test/small-model");
    } finally {
      if (prev === undefined) delete process.env.AI_SMALL_MODEL;
      else process.env.AI_SMALL_MODEL = prev;
    }
  });

  it("AI_SMALL_MODEL 未设时第三参为 undefined（回落 provider 默认）", async () => {
    const prev = process.env.AI_SMALL_MODEL;
    delete process.env.AI_SMALL_MODEL;
    try {
      await queryDataForQuestion("蛋挞几点卖完的？", "2026-07-01");
      expect(chatCompletion.mock.calls[0][2]).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.AI_SMALL_MODEL = prev;
    }
  });
});

describe("F9b knowledge_query 经营类分支", () => {
  const handler = new KnowledgeQuerySkillHandler();

  it("triggerKeywords 补齐经营词，permissions 放宽为 sales.view", () => {
    expect(knowledgeQuerySkillDefinition.triggerKeywords).toContain("卖得怎么样");
    expect(knowledgeQuerySkillDefinition.triggerKeywords).toContain("销量");
    expect(knowledgeQuerySkillDefinition.triggerKeywords).toContain("营业额");
    expect(knowledgeQuerySkillDefinition.permissions).toEqual(["sales.view"]);
  });

  it("经营类问题：调 queryDataForQuestion 查数并连同员工统计合成回答", async () => {
    chatCompletion.mockResolvedValue('{"type":"item_detail","item_name":"蛋挞"}');
    query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("item_hourly_sales")) return [{ hour: 14, qty: 10, net_sales: 55 }];
      return [];
    });

    const result = await handler.execute(makeInput("knowledge_query", { jdText: "昨天蛋挞卖得怎么样" }));

    expect(result.status).toBe("success");
    // 意图分类被调用（经营分支走了 queryDataForQuestion）
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    const prompt = String(chatCompletionLong.mock.calls[0][0]);
    expect(prompt).toContain("经营数据");
    expect(prompt).toContain("蛋挞");
    expect(prompt).toContain("总员工数: 10");
  });

  it("纯员工问题：不走经营查数分支", async () => {
    const result = await handler.execute(makeInput("knowledge_query", { jdText: "最近离职的人都是什么原因" }));

    expect(result.status).toBe("success");
    expect(chatCompletion).not.toHaveBeenCalled();
    const prompt = String(chatCompletionLong.mock.calls[0][0]);
    expect(prompt).not.toContain("经营数据:");
    expect(prompt).toContain("总员工数: 10");
  });
});

describe("G3f 错误文案不透传原始异常", () => {
  it("daily_review_chat：LLM 失败 → 固定中文文案", async () => {
    chatCompletionLong.mockRejectedValue(new Error("connect ECONNREFUSED secret-host:443"));
    const handler = new DailyReviewChatSkillHandler();
    const result = await handler.execute(
      makeInput("daily_review_chat", { jdText: "今天复盘：2026-07-01 正常", text: "今天复盘：2026-07-01 正常" }),
    );
    expect(result.status).toBe("error");
    expect(result.summary).toBe("AI 分析暂时不可用，请稍后再试");
    expect(result.summary).not.toContain("ECONNREFUSED");
  });

  it("knowledge_query：查询失败 → 固定中文文案", async () => {
    getStats.mockRejectedValue(new Error("relation employees does not exist"));
    const handler = new KnowledgeQuerySkillHandler();
    const result = await handler.execute(makeInput("knowledge_query", { jdText: "目前有多少在职员工" }));
    expect(result.status).toBe("error");
    expect(result.summary).toBe("AI 分析暂时不可用，请稍后再试");
    expect(result.summary).not.toContain("relation");
  });
});
