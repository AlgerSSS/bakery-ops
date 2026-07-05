// F1/F2: 每日经营早报 + 排产推送的"该不该发/幂等"逻辑（IMPROVEMENT-PLAN.md F1/F2）
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const executeMock = vi.fn();
vi.mock("@/modules/shared/db/postgres", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  execute: (...args: unknown[]) => executeMock(...args),
}));

const sendTextToMock = vi.fn();
const isClientConnectedMock = vi.fn();
vi.mock("@/modules/channel/whatsapp/whatsapp.client", () => ({
  isClientConnected: (...args: unknown[]) => isClientConnectedMock(...args),
  sendTextTo: (...args: unknown[]) => sendTextToMock(...args),
}));

const getAllUsersMock = vi.fn();
vi.mock("@/modules/data/repositories/user.repository", () => ({
  userRepository: { getAll: (...args: unknown[]) => getAllUsersMock(...args) },
}));

const generatePlanMock = vi.fn();
vi.mock("@/modules/domain/production-plan/plan-generator", () => ({
  generateProductionPlan: (...args: unknown[]) => generatePlanMock(...args),
}));

// 早报改为「完整 AI 复盘为主」，mock 掉复盘文本生成，避免测试里真调 LLM。
const generateReviewMock = vi.fn();
vi.mock("@/modules/skills/daily-review-chat/daily-review-chat.definition", () => ({
  generateDailyReviewText: (...args: unknown[]) => generateReviewMock(...args),
}));

// 收件人来自 team_member（订阅 daily_review）；发送走 sendLarkToUser（按 open_id 发卡片）。
const getSubscriberOpenIdsMock = vi.fn();
vi.mock("@/modules/data/repositories/team.repository", () => ({
  teamRepository: { getSubscriberOpenIds: (...a: unknown[]) => getSubscriberOpenIdsMock(...a) },
}));
const sendLarkToUserMock = vi.fn();
vi.mock("@/modules/channel/lark/lark-messenger", () => ({
  sendLarkToUser: (...a: unknown[]) => sendLarkToUserMock(...a),
}));

import { runMorningBrief, buildMorningBriefText, type MorningBriefData } from "../../modules/domain/notifications/morning-brief.service";
import { runProductionPlanPush } from "../../modules/domain/notifications/production-plan-push.service";

const REVENUE_ROW = {
  revenue: 1000,
  gross_sales: 1030,
  transaction_count: 200,
  avg_transaction_value: 5,
  discount_rate: 0.03,
};

/** 按 SQL 文本路由 query mock 的返回值。 */
function setupQueryMock(opts: { revenueRows?: unknown[]; pushLogRows?: unknown[]; wasteTotal?: number }) {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM daily_revenue")) return opts.revenueRows ?? [REVENUE_ROW];
    if (sql.includes("FROM daily_push_log")) return opts.pushLogRows ?? [];
    if (sql.includes("SUM(amount)")) return [{ total_amount: opts.wasteTotal ?? 0 }];
    return [];
  });
}

const briefData = (overrides: Partial<MorningBriefData> = {}): MorningBriefData => ({
  date: "2026-07-01",
  revenue: 1000,
  transactionCount: 200,
  avgTransactionValue: 5,
  discountRate: 0.03,
  lastWeek: null,
  topItems: [],
  waste: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OWNER_WHATSAPP = "60000000000@c.us";
  isClientConnectedMock.mockResolvedValue(true);
  sendTextToMock.mockResolvedValue({ ok: true, messageId: "m1" });
  getAllUsersMock.mockResolvedValue([]);
  generateReviewMock.mockResolvedValue("🔍 AI复盘正文");
  getSubscriberOpenIdsMock.mockResolvedValue(["ou_owner"]);
  sendLarkToUserMock.mockResolvedValue(true);
});

describe("buildMorningBriefText 模板", () => {
  it("报废率超 3% 时行首加 ⚠️", () => {
    const text = buildMorningBriefText(
      briefData({ waste: { totalAmount: 40, wasteRate: 0.04, topItems: [{ itemName: "蛋挞", reason: "scheduling", qty: 5, amount: 40 }] } }),
    );
    expect(text).toContain("⚠️ 金额: RM40");
    expect(text).toContain("蛋挞（排产报废）");
  });

  it("报废率未超 3% 时不加 ⚠️", () => {
    const text = buildMorningBriefText(
      briefData({ waste: { totalAmount: 20, wasteRate: 0.02, topItems: [] } }),
    );
    expect(text).not.toContain("⚠️");
    expect(text).toContain("报废率: 2.0%");
  });

  it("无报废时显示无记录；含上周同日对比", () => {
    const text = buildMorningBriefText(
      briefData({ lastWeek: { date: "2026-06-24", revenue: 800, transactionCount: 180, avgTransactionValue: 4.4 } }),
    );
    expect(text).toContain("昨日无报废记录");
    expect(text).toContain("vs 上周同日(2026-06-24): RM800 (+25.0%)");
  });
});

describe("runMorningBrief 该不该发/幂等", () => {
  it("当天无 daily_revenue -> 静默跳过，不发送", async () => {
    setupQueryMock({ revenueRows: [] });
    await runMorningBrief();
    expect(sendLarkToUserMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("有数据 -> 发给 team_member 里订阅 daily_review 的 open_id，成功后写 daily_push_log", async () => {
    setupQueryMock({});
    getSubscriberOpenIdsMock.mockResolvedValue(["ou_owner", "ou_leo"]);
    await runMorningBrief();
    const recipients = sendLarkToUserMock.mock.calls.map((c) => c[0]);
    expect(recipients).toEqual(["ou_owner", "ou_leo"]);
    expect(executeMock).toHaveBeenCalledTimes(2); // 两个收件人两条 push_log
    expect(String(executeMock.mock.calls[0][0])).toContain("INSERT INTO daily_push_log");
  });

  it("无订阅者 -> 不发", async () => {
    setupQueryMock({});
    getSubscriberOpenIdsMock.mockResolvedValue([]);
    await runMorningBrief();
    expect(sendLarkToUserMock).not.toHaveBeenCalled();
  });

  it("发的是完整 AI 复盘（带今日复盘抬头），不是固定模板", async () => {
    setupQueryMock({});
    await runMorningBrief();
    expect(generateReviewMock).toHaveBeenCalled();
    const sentText = String(sendLarkToUserMock.mock.calls[0][1]);
    expect(sentText).toContain("今日复盘");
    expect(sentText).toContain("🔍 AI复盘正文");
  });

  it("AI 复盘失败 -> 回落固定模板，复盘仍发出", async () => {
    setupQueryMock({});
    generateReviewMock.mockRejectedValue(new Error("LLM down"));
    await runMorningBrief();
    const sentText = String(sendLarkToUserMock.mock.calls[0][1]);
    expect(sentText).toContain("今日复盘"); // buildMorningBriefText 抬头
    expect(sentText).not.toContain("🔍 AI复盘正文");
  });

  it("daily_push_log 已有记录 -> 跳过不重发", async () => {
    setupQueryMock({ pushLogRows: [{ id: 1 }] });
    await runMorningBrief();
    expect(sendLarkToUserMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("发送失败 -> 不写 daily_push_log", async () => {
    setupQueryMock({});
    sendLarkToUserMock.mockResolvedValue(false);
    await runMorningBrief();
    expect(sendLarkToUserMock).toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("runProductionPlanPush 该不该发/幂等", () => {
  const PLAN = { date: "2026-07-02", dayType: "工作日", targetRevenue: 3000, batches: [{}], summary: "🍞 计划" };

  it("有计划 -> 推 production_plan 订阅者(Lark)，成功后写 daily_push_log", async () => {
    setupQueryMock({});
    generatePlanMock.mockResolvedValue(PLAN);
    getSubscriberOpenIdsMock.mockResolvedValue(["ou_owner"]);
    await runProductionPlanPush();
    const recipients = sendLarkToUserMock.mock.calls.map((c) => c[0]);
    expect(recipients).toContain("ou_owner");
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("空计划 -> 不发送", async () => {
    generatePlanMock.mockResolvedValue({ ...PLAN, batches: [] });
    await runProductionPlanPush();
    expect(sendLarkToUserMock).not.toHaveBeenCalled();
  });

  it("生成失败 -> 安全 no-op", async () => {
    generatePlanMock.mockRejectedValue(new Error("forecast not configured"));
    await runProductionPlanPush();
    expect(sendLarkToUserMock).not.toHaveBeenCalled();
  });

  it("无订阅者 -> 不发送", async () => {
    generatePlanMock.mockResolvedValue(PLAN);
    getSubscriberOpenIdsMock.mockResolvedValue([]);
    await runProductionPlanPush();
    expect(sendLarkToUserMock).not.toHaveBeenCalled();
  });

  it("daily_push_log 已有记录 -> 跳过不重发", async () => {
    setupQueryMock({ pushLogRows: [{ id: 1 }] });
    generatePlanMock.mockResolvedValue(PLAN);
    await runProductionPlanPush();
    expect(sendLarkToUserMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });
});
