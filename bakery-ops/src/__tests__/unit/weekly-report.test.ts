// F3: 周一经营周报的聚合区间/模板/幂等逻辑（IMPROVEMENT-PLAN.md F3）
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

import {
  runWeeklyReport,
  buildWeeklyReportText,
  getWeekRanges,
  type WeeklyReportData,
} from "../../modules/domain/notifications/weekly-report.service";

const AGG_ROW = {
  revenue: 7000,
  transaction_count: 1400,
  member_sales_ratio: 0.3,
  discount_rate: 0.05,
  day_count: 7,
};

/** 按 SQL 文本路由 query mock。 */
function setupQueryMock(opts: {
  aggRows?: unknown[]; // 上周与上上周共用（依次返回）
  pushLogRows?: unknown[];
  wasteTotal?: number;
  reviewRows?: unknown[];
} = {}) {
  const aggQueue = opts.aggRows ? [...(opts.aggRows as unknown[][])] : [[AGG_ROW], [AGG_ROW]];
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("SUM(revenue)")) return aggQueue.shift() ?? [];
    if (sql.includes("GROUP BY item_name")) return []; // sell-through 聚合（G5-1）
    if (sql.includes("FROM hourly_sales_summary")) return [];
    if (sql.includes("ORDER BY revenue DESC")) return [{ date: "2026-06-27", revenue: 1500 }];
    if (sql.includes("ORDER BY revenue ASC")) return [{ date: "2026-06-23", revenue: 600 }];
    if (sql.includes("FROM item_waste")) return [{ total_amount: opts.wasteTotal ?? 0 }];
    if (sql.includes("FROM manager_review")) return opts.reviewRows ?? [];
    if (sql.includes("FROM daily_push_log")) return opts.pushLogRows ?? [];
    return [];
  });
}

const agg = (overrides: Partial<WeeklyReportData["current"]> = {}) => ({
  revenue: 7000,
  transactionCount: 1400,
  avgTransactionValue: 5,
  memberSalesRatio: 0.3,
  discountRate: 0.05,
  ...overrides,
});

const reportData = (overrides: Partial<WeeklyReportData> = {}): WeeklyReportData => ({
  weekStart: "2026-06-22",
  weekEnd: "2026-06-28",
  current: agg(),
  previous: null,
  bestDay: null,
  worstDay: null,
  wasteTotal: 0,
  reviews: [],
  discountCandidates: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OWNER_WHATSAPP = "60000000000@c.us";
  isClientConnectedMock.mockResolvedValue(true);
  sendTextToMock.mockResolvedValue({ ok: true, messageId: "m1" });
  getAllUsersMock.mockResolvedValue([]);
});

describe("getWeekRanges 周区间", () => {
  it("周一执行 -> 上周一至上周日 + 上上周", () => {
    // 2026-06-29 是周一
    expect(getWeekRanges("2026-06-29")).toEqual({
      weekStart: "2026-06-22",
      weekEnd: "2026-06-28",
      prevStart: "2026-06-15",
      prevEnd: "2026-06-21",
    });
  });

  it("周日执行 -> 仍取已完整结束的上一周", () => {
    // 2026-06-28 是周日，所在周周一为 06-22
    expect(getWeekRanges("2026-06-28")).toEqual({
      weekStart: "2026-06-15",
      weekEnd: "2026-06-21",
      prevStart: "2026-06-08",
      prevEnd: "2026-06-14",
    });
  });
});

describe("buildWeeklyReportText 模板", () => {
  it("有上上周 -> 环比百分比 + 会员占比箭头", () => {
    const text = buildWeeklyReportText(
      reportData({
        current: agg({ revenue: 7700, memberSalesRatio: 0.35 }),
        previous: agg({ revenue: 7000, transactionCount: 1400, avgTransactionValue: 5, memberSalesRatio: 0.3 }),
      }),
    );
    expect(text).toContain("营业额: RM7700 (+10.0%)");
    expect(text).toContain("会员占比: 35.0% ↑ (上上周 30.0%)");
    expect(text).toContain("折扣率: 5.0%");
  });

  it("会员占比下降 -> ↓ 箭头", () => {
    const text = buildWeeklyReportText(
      reportData({ current: agg({ memberSalesRatio: 0.25 }), previous: agg({ memberSalesRatio: 0.3 }) }),
    );
    expect(text).toContain("会员占比: 25.0% ↓");
  });

  it("无上上周 -> 无环比无箭头", () => {
    const text = buildWeeklyReportText(reportData());
    expect(text).toContain("营业额: RM7000 | 单数: 1400");
    expect(text).not.toContain("%)");
    expect(text).not.toContain("↑");
  });

  it("最好/最差 + 报废 + 复盘要点", () => {
    const text = buildWeeklyReportText(
      reportData({
        bestDay: { date: "2026-06-27", revenue: 1500 },
        worstDay: { date: "2026-06-23", revenue: 600 },
        wasteTotal: 320,
        reviews: [{ date: "2026-06-24", insight: "雨天客流下滑，加推热饮" }],
      }),
    );
    expect(text).toContain("最好: 2026-06-27 RM1500 | 最差: 2026-06-23 RM600");
    expect(text).toContain("报废合计: RM320");
    expect(text).toContain("- 2026-06-24: 雨天客流下滑，加推热饮");
  });

  it("无报废无复盘 -> 显示无记录", () => {
    const text = buildWeeklyReportText(reportData());
    expect(text).toContain("报废合计: 无记录");
    expect(text).toContain("上周无复盘要点记录");
  });

  it("有折扣候选 -> 【清货建议】仅列 Top 3；无候选 -> 整节省略", () => {
    const cand = (name: string) => ({
      itemName: name,
      soldQty: 70,
      wasteQty: 30,
      wasteAmount: 100,
      sellThrough: 0.7,
      advice: `${name} sell-through 70%，建议晚 8 点后加大折度或减产`,
    });
    const text = buildWeeklyReportText(
      reportData({ discountCandidates: [cand("轻乳酪"), cand("可颂"), cand("贝果"), cand("吐司")] }),
    );
    expect(text).toContain("【清货建议】");
    expect(text).toContain("- 轻乳酪 sell-through 70%");
    expect(text).toContain("- 贝果 sell-through 70%");
    expect(text).not.toContain("吐司");

    expect(buildWeeklyReportText(reportData())).not.toContain("清货建议");
  });
});

describe("runWeeklyReport 该不该发/幂等", () => {
  it("上周无 daily_revenue -> 静默跳过", async () => {
    setupQueryMock({ aggRows: [[{ ...AGG_ROW, day_count: 0 }]] });
    await runWeeklyReport();
    expect(sendTextToMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("有数据 -> 发老板+店长，成功后写 daily_push_log (kind=weekly_report)", async () => {
    setupQueryMock();
    getAllUsersMock.mockResolvedValue([
      { role: "store_manager", phone: "60111@c.us" },
      { role: "staff", phone: "60999@c.us" },
    ]);
    await runWeeklyReport();
    const recipients = sendTextToMock.mock.calls.map((c) => c[0]);
    expect(recipients).toContain("60000000000@c.us");
    expect(recipients).toContain("60111@c.us");
    expect(recipients).not.toContain("60999@c.us");
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(String(executeMock.mock.calls[0][0])).toContain("INSERT INTO daily_push_log");
    expect(executeMock.mock.calls[0][1][0]).toBe("weekly_report");
  });

  it("daily_push_log 已有记录 -> 跳过不重发", async () => {
    setupQueryMock({ pushLogRows: [{ id: 1 }] });
    await runWeeklyReport();
    expect(sendTextToMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("发送失败 -> 不写 daily_push_log", async () => {
    setupQueryMock();
    sendTextToMock.mockResolvedValue({ ok: false, error: "boom" });
    await runWeeklyReport();
    expect(sendTextToMock).toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("WhatsApp 未连接 -> 跳过", async () => {
    setupQueryMock();
    isClientConnectedMock.mockResolvedValue(false);
    await runWeeklyReport();
    expect(sendTextToMock).not.toHaveBeenCalled();
  });
});
