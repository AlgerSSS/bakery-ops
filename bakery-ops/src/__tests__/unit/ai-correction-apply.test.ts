// G2-②: 采纳 AI 修正落库生效 —— aiCorrections 乘法路径 + AI_CORRECTION_APPLY 开关行为
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateDailyTargets } from "@/modules/domain/forecast/forecast-engine";
import type { BusinessRules, MonthlyTarget } from "@/modules/domain/forecast/types";

const h = vi.hoisted(() => ({
  getAIDailyCorrections: vi.fn(),
}));

vi.mock("@/modules/data/repositories/forecast.repository", () => ({
  getBusinessRulesFromDB: vi.fn().mockResolvedValue({
    firstMonthRevenue: 1640000,
    operationEnhancement: 0.02,
    marketEnhancement: 0.04,
    totalEnhancement: 0.06,
    monthlyCoefficients: {},
    weekdayWeights: { mondayToThursday: 1.0, friday: 1.25, saturday: 1.55, sunday: 1.55 },
    shipmentFormula: { tastingWasteRate: 0.06, waterBarRate: 0.11, shipmentRate: 0.95 },
    baselineOverrides: {},
  }),
  getPlanningRulesFromDB: vi.fn().mockResolvedValue({
    timeSlots: ["10:00", "11:00"],
    restockLeadTime: { hot: "", cold: "" },
    reductionLeadTime: { hot: "", cold: "" },
    topPriorityRestock: true,
    breakStockThresholds: {},
    fixedShipmentSchedule: {},
  }),
  getProducts: vi.fn().mockResolvedValue([]),
  getStrategies: vi.fn().mockResolvedValue([]),
  getSalesBaselines: vi.fn().mockResolvedValue([]),
  getTimeslotSalesRecords: vi.fn().mockResolvedValue([]),
  getDailyRevenues: vi.fn().mockResolvedValue([]),
  getDailySalesTotal: vi.fn().mockResolvedValue(0),
  getDailyReview: vi.fn().mockResolvedValue(null),
  getAIDailyCorrections: h.getAIDailyCorrections,
}));

import { getProductForecast, formatForecastCompact } from "@/modules/domain/forecast/forecast.service";

const mockRules: BusinessRules = {
  firstMonthRevenue: 1640000,
  operationEnhancement: 0.02,
  marketEnhancement: 0.04,
  totalEnhancement: 0.06,
  monthlyCoefficients: {},
  weekdayWeights: { mondayToThursday: 1.0, friday: 1.25, saturday: 1.55, sunday: 1.55 },
  shipmentFormula: { tastingWasteRate: 0.06, waterBarRate: 0.11, shipmentRate: 0.95 },
};

const monthly: MonthlyTarget = { month: 5, year: 2026, coefficient: 1.0, baseRevenue: 1640000, enhancedRevenue: 1738400 };

describe("calculateDailyTargets aiCorrections 乘法路径", () => {
  it("对指定日期的权重乘以系数，其余日期不变", () => {
    const base = calculateDailyTargets(monthly, mockRules);
    const corrected = calculateDailyTargets(monthly, mockRules, { "2026-05-04": 1.5 });

    const baseDay = base.find((d) => d.date === "2026-05-04")!; // 周一
    const day = corrected.find((d) => d.date === "2026-05-04")!;
    // 周一原始权重 = 1.0 * 1.025（prophet 默认周一系数），乘 1.5 后按 3 位小数取整
    expect(day.weight).toBe(Math.round(1.0 * 1.025 * 1.5 * 1000) / 1000);
    expect(day.revenue).toBeGreaterThan(baseDay.revenue);

    const baseOther = base.find((d) => d.date === "2026-05-08")!;
    const other = corrected.find((d) => d.date === "2026-05-08")!;
    expect(other.weight).toBe(baseOther.weight);
  });

  it("应用修正后日营收总和仍等于月度目标", () => {
    const corrected = calculateDailyTargets(monthly, mockRules, { "2026-05-04": 1.5, "2026-05-10": 0.8 });
    const total = corrected.reduce((s, d) => s + d.revenue, 0);
    expect(total).toBe(monthly.enhancedRevenue);
  });

  it("不传 aiCorrections 与传 undefined 结果一致", () => {
    const a = calculateDailyTargets(monthly, mockRules);
    const b = calculateDailyTargets(monthly, mockRules, undefined);
    expect(b).toEqual(a);
  });
});

describe("AI_CORRECTION_APPLY 开关（forecast.service）", () => {
  beforeEach(() => {
    h.getAIDailyCorrections.mockReset().mockResolvedValue({ "2026-05-04": 1.5 });
    delete process.env.AI_CORRECTION_APPLY;
    // AI 修正是 legacy 预算法的特性；锁 legacy，隔离 .env 里可能存在的 FORECAST_MODE=new。
    process.env.FORECAST_MODE = "legacy";
  });
  afterEach(() => {
    delete process.env.AI_CORRECTION_APPLY;
    delete process.env.FORECAST_MODE;
  });

  it("开关关闭时不读修正表，行为不变（无 aiCorrection、文案无标注）", async () => {
    const off = await getProductForecast("2026-05-04");
    expect(h.getAIDailyCorrections).not.toHaveBeenCalled();
    expect(off.aiCorrection).toBeUndefined();
    expect(formatForecastCompact(off)).not.toContain("已应用 AI 修正");

    // 再跑一次结果稳定
    const off2 = await getProductForecast("2026-05-04");
    expect(off2.targetRevenue).toBe(off.targetRevenue);
  });

  it("开关开启时读取当月系数并生效，文案标注 ±X%", async () => {
    const off = await getProductForecast("2026-05-04");

    process.env.AI_CORRECTION_APPLY = "true";
    const on = await getProductForecast("2026-05-04");

    expect(h.getAIDailyCorrections).toHaveBeenCalledWith(2026, 5);
    expect(on.aiCorrection).toBe(1.5);
    expect(on.targetRevenue).toBeGreaterThan(off.targetRevenue);
    expect(formatForecastCompact(on)).toContain("已应用 AI 修正 +50%");
  });
});
