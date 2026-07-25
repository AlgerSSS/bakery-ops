// G5-1: 按品 sell-through 聚合与折扣候选筛选（IMPROVEMENT-PLAN.md 第 7 章 G5-1）
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/shared/db/postgres", () => ({
  query: (...args: unknown[]) => queryMock(...args),
}));

import { calcSellThrough, findDiscountCandidates, getRecentRange } from "../../modules/domain/forecast/sell-through";

const TODAY = "2026-06-29"; // 周一

/** 按 SQL 文本路由 query mock。 */
function setupQueryMock(opts: {
  soldRows?: unknown[];
  wasteRows?: unknown[];
  discountRow?: { evening_discount: number; total_discount: number };
} = {}) {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM item_hourly_sales")) return opts.soldRows ?? [];
    if (sql.includes("FROM item_waste")) return opts.wasteRows ?? [];
    if (sql.includes("FROM hourly_sales_summary")) return opts.discountRow ? [opts.discountRow] : [];
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SELL_THROUGH_WARN;
});

describe("getRecentRange 近 N 个完整天", () => {
  it("[today-N, today-1]，周一取 7 天正好是上周一至周日", () => {
    expect(getRecentRange(TODAY, 7)).toEqual({ start: "2026-06-22", end: "2026-06-28" });
  });
});

describe("calcSellThrough 按品聚合", () => {
  it("销量+报废合并算 sell-through，升序（最差在前）", async () => {
    setupQueryMock({
      soldRows: [
        { item_name: "轻乳酪", sold_qty: 70 },
        { item_name: "可颂", sold_qty: 95 },
      ],
      wasteRows: [
        { item_name: "轻乳酪", waste_qty: 30, waste_amount: 120 },
        { item_name: "可颂", waste_qty: 5, waste_amount: 15 },
      ],
    });
    const items = await calcSellThrough(7, TODAY);
    expect(items.map((i) => i.itemName)).toEqual(["轻乳酪", "可颂"]);
    expect(items[0].sellThrough).toBeCloseTo(0.7);
    expect(items[0].wasteAmount).toBe(120);
    expect(items[1].sellThrough).toBeCloseTo(0.95);
  });

  it("只报废没销量 -> sell-through 0；只销量没报废 -> 1；双零品剔除", async () => {
    setupQueryMock({
      soldRows: [
        { item_name: "吐司", sold_qty: 50 },
        { item_name: "空品", sold_qty: 0 },
      ],
      wasteRows: [{ item_name: "贝果", waste_qty: 10, waste_amount: 40 }],
    });
    const items = await calcSellThrough(7, TODAY);
    expect(items.map((i) => i.itemName)).toEqual(["贝果", "吐司"]);
    expect(items[0].sellThrough).toBe(0);
    expect(items[1].sellThrough).toBe(1);
  });

  it("查询带近 N 天区间参数", async () => {
    setupQueryMock();
    await calcSellThrough(7, TODAY);
    expect(queryMock.mock.calls[0][1]).toEqual(["2026-06-22", "2026-06-28"]);
  });
});

describe("findDiscountCandidates 阈值与文案", () => {
  const sold = (name: string, qty: number) => ({ item_name: name, sold_qty: qty });
  const waste = (name: string, qty: number, amount: number) => ({
    item_name: name,
    waste_qty: qty,
    waste_amount: amount,
  });

  it("默认阈值 0.85：恰好 0.85 不入选，0.84 入选；按报废金额降序", async () => {
    setupQueryMock({
      soldRows: [sold("恰好", 85), sold("入选A", 84), sold("入选B", 80)],
      wasteRows: [waste("恰好", 15, 100), waste("入选A", 16, 50), waste("入选B", 20, 90)],
      discountRow: { evening_discount: 0, total_discount: 0 },
    });
    const cands = await findDiscountCandidates(7, TODAY);
    expect(cands.map((c) => c.itemName)).toEqual(["入选B", "入选A"]);
  });

  it("SELL_THROUGH_WARN env 覆盖阈值", async () => {
    process.env.SELL_THROUGH_WARN = "0.9";
    setupQueryMock({
      soldRows: [sold("恰好", 85)],
      wasteRows: [waste("恰好", 15, 100)],
      discountRow: { evening_discount: 0, total_discount: 0 },
    });
    const cands = await findDiscountCandidates(7, TODAY);
    expect(cands.map((c) => c.itemName)).toEqual(["恰好"]);
  });

  it("低 sell-through 但报废金额为 0 -> 不入选；无候选不查折扣", async () => {
    setupQueryMock({
      soldRows: [sold("试吃品", 10)],
      wasteRows: [waste("试吃品", 90, 0)],
    });
    expect(await findDiscountCandidates(7, TODAY)).toEqual([]);
    const sqls = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("hourly_sales_summary"))).toBe(false);
  });

  it("晚间折扣占比高 -> 加大折度文案；低 -> 启动折扣文案", async () => {
    setupQueryMock({
      soldRows: [sold("轻乳酪", 78)],
      wasteRows: [waste("轻乳酪", 22, 120)],
      discountRow: { evening_discount: 60, total_discount: 100 },
    });
    let cands = await findDiscountCandidates(7, TODAY);
    expect(cands[0].advice).toContain("轻乳酪 sell-through 78%");
    expect(cands[0].advice).toContain("晚间折扣后仍有报废，建议晚 8 点后加大折度或减产");

    setupQueryMock({
      soldRows: [sold("轻乳酪", 78)],
      wasteRows: [waste("轻乳酪", 22, 120)],
      discountRow: { evening_discount: 10, total_discount: 100 },
    });
    cands = await findDiscountCandidates(7, TODAY);
    expect(cands[0].advice).toContain("晚间折扣力度不足，建议晚 8 点后启动折扣清货");
  });
});
