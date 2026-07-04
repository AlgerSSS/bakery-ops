// F6/F7: 预测闭环——快照写入、偏差计算、实测报废率（IMPROVEMENT-PLAN.md F6/F7）
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const executeMock = vi.fn();
vi.mock("@/modules/shared/db/postgres", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  execute: (...args: unknown[]) => executeMock(...args),
}));

import { saveForecastSnapshot, formatForecastCompact, getProductForecast } from "../../modules/domain/forecast/forecast.service";
import {
  matchWasteToProducts,
  computeForecastDeviations,
  formatForecastReview,
} from "../../modules/skills/forecast-review/forecast-review.definition";
import { computeWasteRate } from "../../modules/data/repositories/forecast-calc.repository";

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockResolvedValue({ affectedRows: 1 });
});

// ========== F6-② 快照写入 ==========
describe("saveForecastSnapshot", () => {
  it("批量 INSERT 且 ON CONFLICT 覆盖", async () => {
    await saveForecastSnapshot("2026-07-01", [
      { name: "蛋挞", suggestedQty: 100 },
      { name: "可颂", suggestedQty: 40 },
    ]);
    expect(executeMock).toHaveBeenCalledTimes(1);
    const [sql, params] = executeMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO forecast_snapshot");
    expect(sql).toContain("ON CONFLICT (date, product_name) DO UPDATE SET suggested_qty = EXCLUDED.suggested_qty");
    expect(params).toEqual(["2026-07-01", "蛋挞", 100, "2026-07-01", "可颂", 40]);
  });

  it("空建议列表不写库", async () => {
    await saveForecastSnapshot("2026-07-01", []);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("写入失败不抛异常（fire-and-forget 不阻塞预估单）", async () => {
    executeMock.mockRejectedValue(new Error("db down"));
    await expect(
      saveForecastSnapshot("2026-07-01", [{ name: "蛋挞", suggestedQty: 100 }])
    ).resolves.toBeUndefined();
  });
});

// ========== F7-① 报废警告行 ==========
type Forecast = Awaited<ReturnType<typeof getProductForecast>>;

const baseForecast = (overrides: Partial<Forecast> = {}): Forecast => ({
  date: "2026-07-02",
  dayType: "周末",
  dayOfWeek: "周六",
  targetShipment: 10000,
  targetRevenue: 9000,
  forecastMode: "legacy",
  legacyBudgetRevenue: 9000,
  products: [
    { name: "蛋挞", positioning: "TOP", coldHot: "热", price: 5, packMultiple: 1, baselineQty: 90, suggestedQty: 100, totalAmount: 500 },
    { name: "可颂", positioning: "其他", coldHot: "热", price: 6, packMultiple: 1, baselineQty: 20, suggestedQty: 20, totalAmount: 120 },
  ],
  timeSlots: [],
  ...overrides,
});

describe("formatForecastCompact 报废警告", () => {
  it("输出里的单品追加警告行，未列出的超标品末尾汇总一行", () => {
    const text = formatForecastCompact(baseForecast({ wasteAlerts: { 蛋挞: 168, 可颂: 120 } }));
    const lines = text.split("\n");
    const idx = lines.findIndex((l) => l.includes("蛋挞"));
    expect(lines[idx + 1]).toContain("⚠️ 近7天排产报废 RM168，建议下调");
    expect(lines[lines.length - 1]).toContain("另有 1 款近7天排产报废超标");
    expect(lines[lines.length - 1]).toContain("可颂(RM120)");
  });

  it("无 wasteAlerts 时输出与原格式一致（零行为变化）", () => {
    const text = formatForecastCompact(baseForecast());
    expect(text).not.toContain("排产报废");
    expect(text).toContain("• 蛋挞: *100*个");
    expect(text.split("\n").pop()).toContain("_其他 1 款产品已按历史销量分配_");
  });
});

// ========== F6-③ 偏差计算纯函数 ==========
describe("matchWasteToProducts", () => {
  it("alias 命中归一到标准名并累加，匹配不上记入 unmatched", () => {
    const { byProduct, unmatched } = matchWasteToProducts(
      [
        { itemName: "Egg Tart", qty: 5, amount: 25 },
        { itemName: "EggTart-B", qty: 2, amount: 10 },
        { itemName: "蛋挞", qty: 1, amount: 5 },
        { itemName: "Mystery Item", qty: 3, amount: 30 },
      ],
      { "Egg Tart": "蛋挞", "EggTart-B": "蛋挞" },
      new Set(["蛋挞"])
    );
    expect(byProduct["蛋挞"]).toEqual({ qty: 8, amount: 40 });
    expect(unmatched).toEqual(["Mystery Item"]);
  });
});

describe("computeForecastDeviations", () => {
  it("按 |实卖-建议| 降序，缺数据按 0 处理", () => {
    const items = computeForecastDeviations(
      [
        { productName: "蛋挞", suggestedQty: 100 },
        { productName: "可颂", suggestedQty: 20 },
        { productName: "马卡龙", suggestedQty: 30 },
      ],
      { 蛋挞: 85, 马卡龙: 31 },
      { 蛋挞: { qty: 10, amount: 25 } },
      { 可颂: "14:00" }
    );
    expect(items.map((i) => i.productName)).toEqual(["可颂", "蛋挞", "马卡龙"]);
    expect(items[0]).toMatchObject({ actualQty: 0, deviation: -20, soldoutTime: "14:00" });
    expect(items[1]).toMatchObject({ deviation: -15, wasteQty: 10, wasteAmount: 25 });
    expect(items[2]).toMatchObject({ deviation: 1, soldoutTime: null });
  });
});

describe("formatForecastReview", () => {
  it("只取 Top5，带报废/断货附注与未匹配说明", () => {
    const items = computeForecastDeviations(
      [
        { productName: "A", suggestedQty: 100 },
        { productName: "B", suggestedQty: 50 },
        { productName: "C", suggestedQty: 40 },
        { productName: "D", suggestedQty: 30 },
        { productName: "E", suggestedQty: 20 },
        { productName: "F", suggestedQty: 10 },
      ],
      { A: 40, B: 20, C: 20, D: 20, E: 15, F: 9 },
      { A: { qty: 12, amount: 60 } },
      { B: "15:00" }
    );
    const text = formatForecastReview("2026-07-01", items, ["POS-X"]);
    expect(text).toContain("预测复盘 2026-07-01");
    expect(text).toContain("1. A：建议 100 / 实卖 40（-60，-60%）");
    expect(text).toContain("报废 12个 RM60");
    expect(text).toContain("🚫 15:00 断货");
    expect(text).not.toContain("F：建议"); // 第 6 名不出现
    expect(text).toContain("已跳过：POS-X");
  });
});

// ========== F7-② 实测报废率 ==========
describe("computeWasteRate", () => {
  it("正常：报废 ÷ 营业额", () => {
    expect(computeWasteRate(300, 10000)).toBeCloseTo(0.03);
  });

  it("无报废/无营业额/非法值返回 null（调用方 fallback 0.02）", () => {
    expect(computeWasteRate(0, 10000)).toBeNull();
    expect(computeWasteRate(300, 0)).toBeNull();
    expect(computeWasteRate(null, null)).toBeNull();
    expect(computeWasteRate(NaN, 10000)).toBeNull();
  });
});
