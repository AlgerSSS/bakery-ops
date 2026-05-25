import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 1. Forecast-engine barrel re-exports ────────────────────────────────────

describe("forecast-engine barrel re-exports", () => {
  it("exports calculateMonthlyTargets as a function", async () => {
    const { calculateMonthlyTargets } = await import("@/modules/domain/forecast/forecast-engine");
    expect(typeof calculateMonthlyTargets).toBe("function");
  });

  it("exports calculateDailyTargets as a function", async () => {
    const { calculateDailyTargets } = await import("@/modules/domain/forecast/forecast-engine");
    expect(typeof calculateDailyTargets).toBe("function");
  });

  it("exports calculateProductSuggestions as a function", async () => {
    const { calculateProductSuggestions } = await import("@/modules/domain/forecast/forecast-engine");
    expect(typeof calculateProductSuggestions).toBe("function");
  });

  it("exports calculateTimeSlotSuggestions as a function", async () => {
    const { calculateTimeSlotSuggestions } = await import("@/modules/domain/forecast/forecast-engine");
    expect(typeof calculateTimeSlotSuggestions).toBe("function");
  });

  it("exports calculateStockoutLoss as a function", async () => {
    const { calculateStockoutLoss } = await import("@/modules/domain/forecast/forecast-engine");
    expect(typeof calculateStockoutLoss).toBe("function");
  });

  it("exports calculateSalesBaselines as a function", async () => {
    const { calculateSalesBaselines } = await import("@/modules/domain/forecast/forecast-engine");
    expect(typeof calculateSalesBaselines).toBe("function");
  });
});

// ─── 2. Individual engine sub-modules ────────────────────────────────────────

describe("engine sub-module: monthly-target", () => {
  it("exports calculateMonthlyTargets as a function", async () => {
    const { calculateMonthlyTargets } = await import("@/modules/domain/forecast/engine/monthly-target");
    expect(typeof calculateMonthlyTargets).toBe("function");
  });
});

describe("engine sub-module: daily-target", () => {
  it("exports calculateDailyTargets as a function", async () => {
    const { calculateDailyTargets } = await import("@/modules/domain/forecast/engine/daily-target");
    expect(typeof calculateDailyTargets).toBe("function");
  });
});

describe("engine sub-module: product-suggestion", () => {
  it("exports calculateProductSuggestions as a function", async () => {
    const { calculateProductSuggestions } = await import("@/modules/domain/forecast/engine/product-suggestion");
    expect(typeof calculateProductSuggestions).toBe("function");
  });
});

describe("engine sub-module: timeslot-allocation", () => {
  it("exports calculateTimeSlotSuggestions as a function", async () => {
    const { calculateTimeSlotSuggestions } = await import("@/modules/domain/forecast/engine/timeslot-allocation");
    expect(typeof calculateTimeSlotSuggestions).toBe("function");
  });
});

describe("engine sub-module: stockout-calculator", () => {
  it("exports calculateStockoutLoss as a function", async () => {
    const { calculateStockoutLoss } = await import("@/modules/domain/forecast/engine/stockout-calculator");
    expect(typeof calculateStockoutLoss).toBe("function");
  });
});

describe("engine sub-module: sales-baseline", () => {
  it("exports calculateSalesBaselines as a function", async () => {
    const { calculateSalesBaselines } = await import("@/modules/domain/forecast/engine/sales-baseline");
    expect(typeof calculateSalesBaselines).toBe("function");
  });
});

// ─── 4. context-builder ───────────────────────────────────────────────────────

describe("buildStockoutSummary", () => {
  it("returns 无断货记录 when stockoutRecords is empty array", async () => {
    const { buildStockoutSummary } = await import("@/modules/domain/forecast/context-builder");
    const result = buildStockoutSummary({ stockoutRecords: [] });
    expect(result).toBe("无断货记录");
  });

  it("returns 无断货记录 when stockoutRecords is undefined", async () => {
    const { buildStockoutSummary } = await import("@/modules/domain/forecast/context-builder");
    const result = buildStockoutSummary({});
    expect(result).toBe("无断货记录");
  });

  it("formats stockout records sorted by loss amount descending", async () => {
    const { buildStockoutSummary } = await import("@/modules/domain/forecast/context-builder");
    const result = buildStockoutSummary({
      stockoutRecords: [
        { productName: "Croissant", soldoutTime: "14:00", estimatedLossQty: 5, estimatedLossAmount: 25 },
        { productName: "Baguette", soldoutTime: "15:00", estimatedLossQty: 10, estimatedLossAmount: 50 },
      ],
    });
    // Baguette has higher loss amount, should appear first
    expect(result.indexOf("Baguette")).toBeLessThan(result.indexOf("Croissant"));
    expect(result).toContain("Croissant");
    expect(result).toContain("断货时间=14:00");
    expect(result).toContain("损失数量=5个");
    expect(result).toContain("损失金额=RM 25");
  });

  it("filters out records with zero estimatedLossQty", async () => {
    const { buildStockoutSummary } = await import("@/modules/domain/forecast/context-builder");
    const result = buildStockoutSummary({
      stockoutRecords: [
        { productName: "ZeroLoss", soldoutTime: "10:00", estimatedLossQty: 0, estimatedLossAmount: 0 },
      ],
    });
    expect(result).toBe("断货记录已提交但无可计算的损失");
  });
});

// ─── 5. postgres.ts exports ───────────────────────────────────────────────────

describe("postgres module exports", () => {
  it("exports query as a function", async () => {
    const mod = await import("@/modules/shared/db/postgres");
    expect(typeof mod.query).toBe("function");
  });

  it("exports execute as a function", async () => {
    const mod = await import("@/modules/shared/db/postgres");
    expect(typeof mod.execute).toBe("function");
  });

  it("exports withTransaction as a function", async () => {
    const mod = await import("@/modules/shared/db/postgres");
    expect(typeof mod.withTransaction).toBe("function");
  });

  it("does not export a sql Proxy (only getSQL helper)", async () => {
    const mod = await import("@/modules/shared/db/postgres") as Record<string, unknown>;
    // There should be no top-level `sql` export; only getSQL
    expect("sql" in mod).toBe(false);
    expect(typeof mod.getSQL).toBe("function");
  });
});
