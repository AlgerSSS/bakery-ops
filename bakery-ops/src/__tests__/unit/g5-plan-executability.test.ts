import { describe, it, expect } from "vitest";
import { getPrepMinutes } from "@/modules/domain/production-plan/plan-generator";
import {
  calculateTimeSlotSuggestions,
  selectDefaultTimeSlots,
} from "@/modules/domain/forecast/engine/timeslot-allocation";
import type { DailyTarget, PlanningRules, ProductSuggestion } from "@/modules/domain/forecast/types";

// ========== G5-3 ①: getPrepMinutes ==========
describe("getPrepMinutes", () => {
  it("returns default 50/240 from shipped prep-times.json", () => {
    expect(getPrepMinutes("可颂", "热")).toBe(50);
    expect(getPrepMinutes("提拉米苏", "冷")).toBe(240);
  });

  it("uses per-product numeric override regardless of cold/hot", () => {
    const config = { "默认": { hot: 50, cold: 240 }, "可颂": 90 };
    expect(getPrepMinutes("可颂", "热", config)).toBe(90);
    expect(getPrepMinutes("可颂", "冷", config)).toBe(90);
    expect(getPrepMinutes("吐司", "热", config)).toBe(50);
  });

  it("uses per-product object override with hot/cold split", () => {
    const config = { "默认": { hot: 50, cold: 240 }, "芝士挞": { hot: 70, cold: 180 } };
    expect(getPrepMinutes("芝士挞", "热", config)).toBe(70);
    expect(getPrepMinutes("芝士挞", "冷", config)).toBe(180);
  });

  it("falls back to built-in 50/240 when config has no default", () => {
    expect(getPrepMinutes("未知品", "热", {})).toBe(50);
    expect(getPrepMinutes("未知品", "冷", {})).toBe(240);
  });
});

// ========== G5-3 ②: selectDefaultTimeSlots ==========
describe("selectDefaultTimeSlots", () => {
  it("picks the top-2 hours by bill_count, sorted ascending", () => {
    const curve = [
      { hour: 10, billCount: 30 },
      { hour: 11, billCount: 80 },
      { hour: 12, billCount: 50 },
      { hour: 15, billCount: 120 },
    ];
    expect(selectDefaultTimeSlots(curve)).toEqual(["11:00", "15:00"]);
  });

  it("falls back to 11:00 when curve is empty or missing", () => {
    expect(selectDefaultTimeSlots()).toEqual(["11:00"]);
    expect(selectDefaultTimeSlots([])).toEqual(["11:00"]);
    expect(selectDefaultTimeSlots([{ hour: 12, billCount: 0 }])).toEqual(["11:00"]);
  });

  it("returns a single slot when only one hour has sales", () => {
    expect(selectDefaultTimeSlots([{ hour: 14, billCount: 9 }])).toEqual(["14:00"]);
  });
});

// ========== G5-3 ②: fallback wiring in calculateTimeSlotSuggestions ==========
const dailyTarget: DailyTarget = {
  date: "2026-07-06",
  dayOfWeek: 1,
  dayType: "mondayToThursday",
  baseWeight: 1,
  weight: 1,
  revenue: 3000,
  shipmentAmount: 3000,
};

const planningRules: PlanningRules = {
  timeSlots: [],
  restockLeadTime: { hot: "", cold: "" },
  reductionLeadTime: { hot: "", cold: "" },
  topPriorityRestock: false,
  breakStockThresholds: {},
  fixedShipmentSchedule: {},
};

function makeProduct(name: string, qty: number): ProductSuggestion {
  return {
    productName: name,
    price: 10,
    packMultiple: 1,
    unitType: "individual",
    baselineQuantity: qty,
    suggestedQuantity: qty,
    roundedQuantity: qty,
    totalAmount: qty * 10,
    positioning: "其他",
    coldHot: "热",
    displayFullQuantity: 0,
  };
}

describe("calculateTimeSlotSuggestions default slots", () => {
  it("uses provided defaultSlots when product has no history", () => {
    const result = calculateTimeSlotSuggestions(
      [makeProduct("新品", 10)],
      dailyTarget,
      planningRules,
      [],
      ["11:00", "15:00"]
    );
    expect(result.map((r) => r.timeSlot).sort()).toEqual(["11:00", "15:00"]);
    expect(result.reduce((s, r) => s + r.quantity, 0)).toBe(10);
  });

  it("falls back to 11:00 when no defaultSlots provided (unchanged behavior)", () => {
    const result = calculateTimeSlotSuggestions([makeProduct("新品", 10)], dailyTarget, planningRules, []);
    expect(result).toEqual([{ productName: "新品", timeSlot: "11:00", quantity: 10, amount: 100 }]);
  });

  it("product history still wins over defaultSlots", () => {
    const result = calculateTimeSlotSuggestions(
      [makeProduct("老品", 10)],
      dailyTarget,
      planningRules,
      [{ productName: "老品", dayType: "mondayToThursday", timeSlot: "09:00", avgQuantity: 5, sampleCount: 4 }],
      ["11:00", "15:00"]
    );
    expect(result).toEqual([{ productName: "老品", timeSlot: "09:00", quantity: 10, amount: 100 }]);
  });
});
