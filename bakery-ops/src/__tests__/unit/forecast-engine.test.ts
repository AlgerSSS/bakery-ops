import { describe, it, expect } from "vitest";
import {
  calculateMonthlyTargets,
  calculateDailyTargets,
  calculateSalesBaselines,
  calculateProductSuggestions,
} from "@/modules/domain/forecast/forecast-engine";
import type { BusinessRules, MonthlyTarget, Product, ProductSalesBaseline, ProductStrategy } from "@/modules/domain/forecast/types";

const mockRules: BusinessRules = {
  firstMonthRevenue: 1640000,
  operationEnhancement: 0.02,
  marketEnhancement: 0.04,
  totalEnhancement: 0.06,
  monthlyCoefficients: { "1": 1.0, "5": 1.1 },
  weekdayWeights: { mondayToThursday: 1.0, friday: 1.25, saturday: 1.55, sunday: 1.55 },
  shipmentFormula: { tastingWasteRate: 0.06, waterBarRate: 0.11, shipmentRate: 0.95 },
};

describe("calculateMonthlyTargets", () => {
  it("returns 12 months", () => {
    const targets = calculateMonthlyTargets(mockRules, 2026);
    expect(targets).toHaveLength(12);
  });

  it("applies monthly coefficient correctly", () => {
    const targets = calculateMonthlyTargets(mockRules, 2026);
    const may = targets.find((t) => t.month === 5)!;
    const jan = targets.find((t) => t.month === 1)!;
    expect(may.enhancedRevenue).toBeGreaterThan(jan.enhancedRevenue);
  });

  it("applies totalEnhancement", () => {
    const targets = calculateMonthlyTargets(mockRules, 2026);
    const jan = targets.find((t) => t.month === 1)!;
    expect(jan.enhancedRevenue).toBeGreaterThan(jan.baseRevenue);
  });
});

describe("calculateDailyTargets", () => {
  it("returns correct number of days", () => {
    const monthly: MonthlyTarget = { month: 5, year: 2026, coefficient: 1.1, baseRevenue: 1804000, enhancedRevenue: 1912240 };
    const targets = calculateDailyTargets(monthly, mockRules);
    expect(targets).toHaveLength(31); // May has 31 days
  });

  it("daily revenues sum to monthly target", () => {
    const monthly: MonthlyTarget = { month: 5, year: 2026, coefficient: 1.1, baseRevenue: 1804000, enhancedRevenue: 1912240 };
    const targets = calculateDailyTargets(monthly, mockRules);
    const total = targets.reduce((s, d) => s + d.revenue, 0);
    expect(total).toBe(monthly.enhancedRevenue);
  });

  it("weekends have higher revenue than weekdays", () => {
    const monthly: MonthlyTarget = { month: 5, year: 2026, coefficient: 1.0, baseRevenue: 1640000, enhancedRevenue: 1738400 };
    const targets = calculateDailyTargets(monthly, mockRules);
    const weekdays = targets.filter((d) => d.dayType === "mondayToThursday");
    const weekends = targets.filter((d) => d.dayType === "weekend");
    const avgWeekday = weekdays.reduce((s, d) => s + d.revenue, 0) / weekdays.length;
    const avgWeekend = weekends.reduce((s, d) => s + d.revenue, 0) / weekends.length;
    expect(avgWeekend).toBeGreaterThan(avgWeekday);
  });
});

describe("calculateSalesBaselines", () => {
  it("returns baseline for each product", () => {
    const products: Product[] = [
      { id: "1", category: "蛋挞", name: "蛋挞", nameEn: "Egg Tart", price: 5.5, packMultiple: 6, unitType: "batch", displayFullQuantity: 24 },
    ];
    const baselines = calculateSalesBaselines([], products);
    expect(baselines).toHaveLength(1);
    expect(baselines[0].productName).toBe("蛋挞");
  });
});

describe("calculateProductSuggestions", () => {
  it("returns suggestions for all products", () => {
    const products: Product[] = [
      { id: "1", category: "蛋挞", name: "蛋挞", nameEn: "Egg Tart", price: 5.5, packMultiple: 6, unitType: "batch", displayFullQuantity: 24 },
    ];
    const baselines: ProductSalesBaseline[] = [
      { productName: "蛋挞", avgMondayToThursday: 30, avgFriday: 40, avgWeekend: 50, totalSales: 1000, dayCount: 30 },
    ];
    const strategies: ProductStrategy[] = [
      { productName: "蛋挞", positioning: "TOP", category: "蛋挞", coldHot: "热", salesRatio: 0.3, targetTC: null, audience: "all", breakStockTime: "18:00", sortOrder: 1 },
    ];
    const dailyTarget = { date: "2026-05-12", dayOfWeek: 1, dayType: "mondayToThursday" as const, baseWeight: 1.0, weight: 1.0, revenue: 50000, shipmentAmount: 47500 };
    const suggestions = calculateProductSuggestions(dailyTarget, products, baselines, strategies);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].productName).toBe("蛋挞");
    expect(suggestions[0].roundedQuantity).toBeGreaterThan(0);
  });
});
