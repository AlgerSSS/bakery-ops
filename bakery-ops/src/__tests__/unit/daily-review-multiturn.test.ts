// daily-review-multiturn.test.ts
//
// 锁定每日复盘多轮追问的状态流转（IMPROVEMENT-PLAN.md B5）：
// initial → pending（data 带 _isFollowUp/_reviewDate/_history）
// → follow_up（继续 pending，_history 增长，不写 manager_review.content）
// → "没了" → end（success，写 insight）。
// orchestrator 侧复用现成 waiting_for_confirm 状态机：pending 的 data 存入
// collectedInputs，resume 时原样并回 input，这里直接模拟这个并回过程。

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

vi.mock("@/modules/domain/knowledge/lightrag-client", () => ({
  lightragClient: {
    isAvailable: vi.fn().mockResolvedValue(false),
    query: vi.fn(),
    ingest: vi.fn(),
  },
}));

vi.mock("@/modules/domain/forecast/forecast.service", () => ({
  getProductForecast: vi.fn().mockRejectedValue(new Error("not configured")),
}));

import { DailyReviewChatSkillHandler } from "@/modules/skills/daily-review-chat/daily-review-chat.definition";
import type { SkillExecutionInput } from "@/modules/shared/types";

function makeInput(input: Record<string, unknown>): SkillExecutionInput {
  return {
    skillId: "daily_review_chat",
    userId: "u1",
    channel: "whatsapp",
    conversationId: "c1",
    input,
  };
}

describe("daily-review-chat 多轮追问状态流转", () => {
  const handler = new DailyReviewChatSkillHandler();

  beforeEach(() => {
    chatCompletionLong.mockReset().mockResolvedValue("AI分析结果");
    chatCompletion.mockReset().mockResolvedValue('{"type":"general"}');
    query.mockReset().mockResolvedValue([]);
  });

  it("initial：返回 pending，data 携带 _isFollowUp/_reviewDate/_history，正文写 manager_review", async () => {
    const result = await handler.execute(
      makeInput({ jdText: "今天复盘：2026-07-01 下午蛋挞断货", text: "今天复盘：2026-07-01 下午蛋挞断货" }),
    );

    expect(result.status).toBe("pending");
    expect(result.data?._isFollowUp).toBe(true);
    expect(result.data?._reviewDate).toBe("2026-07-01");
    expect(String(result.data?._history)).toContain("蛋挞断货");
    expect(String(result.data?._history)).toContain("AI分析结果");
    expect(result.summary).toContain("没了");

    const insertCalls = query.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO manager_review"));
    expect(insertCalls).toHaveLength(1);
  });

  it("follow_up：继续 pending，_history 增长，不写 manager_review.content", async () => {
    const initial = await handler.execute(
      makeInput({ jdText: "今天复盘：2026-07-01 下午蛋挞断货", text: "今天复盘：2026-07-01 下午蛋挞断货" }),
    );
    query.mockClear();
    chatCompletionLong.mockResolvedValue("追问的回答");

    // 模拟 orchestrator resume：{ text: 新消息, ...collectedInputs }
    const followUp = await handler.execute(
      makeInput({ text: "蛋挞具体几点卖完的？", ...initial.data }),
    );

    expect(followUp.status).toBe("pending");
    expect(followUp.data?._isFollowUp).toBe(true);
    expect(followUp.data?._reviewDate).toBe("2026-07-01");
    const history = String(followUp.data?._history);
    expect(history).toContain(String(initial.data?._history));
    expect(history).toContain("蛋挞具体几点卖完的？");
    expect(history).toContain("追问的回答");
    expect(history.length).toBeGreaterThan(String(initial.data?._history).length);
    expect(followUp.summary).toContain("没了");

    const managerReviewWrites = query.mock.calls.filter((c) => String(c[0]).includes("manager_review"));
    expect(managerReviewWrites).toHaveLength(0);
  });

  it("resume 时残留首轮 jdText 也以本条 text 为准", async () => {
    const initial = await handler.execute(
      makeInput({ jdText: "今天复盘：2026-07-01 下午蛋挞断货", text: "今天复盘：2026-07-01 下午蛋挞断货" }),
    );
    const followUp = await handler.execute(
      makeInput({ text: "折扣多不多？", jdText: "今天复盘：2026-07-01 下午蛋挞断货", ...initial.data }),
    );
    expect(followUp.status).toBe("pending");
    expect(String(followUp.data?._history)).toContain("折扣多不多？");
  });

  it("「没了」：返回 success 结束，insight 写入 manager_review", async () => {
    const initial = await handler.execute(
      makeInput({ jdText: "今天复盘：2026-07-01 下午蛋挞断货", text: "今天复盘：2026-07-01 下午蛋挞断货" }),
    );
    query.mockClear();
    chatCompletionLong.mockResolvedValue("提炼出的经验条目");

    const end = await handler.execute(makeInput({ text: "没了", ...initial.data }));

    expect(end.status).toBe("success");
    expect(end.data?.phase).toBe("end");
    expect(end.summary).toContain("提炼出的经验条目");

    const insightUpdates = query.mock.calls.filter((c) => String(c[0]).includes("UPDATE manager_review SET insight"));
    expect(insightUpdates).toHaveLength(1);
    expect(insightUpdates[0][1]).toEqual(["2026-07-01", "提炼出的经验条目"]);
  });
});
