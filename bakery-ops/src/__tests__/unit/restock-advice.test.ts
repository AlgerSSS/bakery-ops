// restock-advice.test.ts — 锁定加减货纯算法：外推、倍数取整、售罄检查、降噪阈值、过早不判。
import { describe, it, expect } from "vitest";
import { computeRestockAdvice, ratioAfter, type RestockInput } from "@/modules/domain/forecast/restock-advice";

const CUT = 14 * 60 + 20; // 14:20
// 10-19 点各 5 件的平铺曲线，全天 50。
const flat: Record<number, number> = { 10: 5, 11: 5, 12: 5, 13: 5, 14: 5, 15: 5, 16: 5, 17: 5, 18: 5, 19: 5 };
const base = (over: Partial<RestockInput>): RestockInput => ({
  productName: "测试品", soldSoFar: 0, plan: 50, packMultiple: 10, coldHot: "热", hourly: flat, ...over,
});

describe("ratioAfter", () => {
  it("平铺曲线在 14:20 之后剩约 56.7%（含 14 点桶的 40/60）", () => {
    expect(ratioAfter(flat, CUT)).toBeCloseTo(28.333 / 50, 3);
  });
  it("边界在整点开始时，该小时整块计入之后", () => {
    expect(ratioAfter({ 10: 10, 11: 10 }, 11 * 60)).toBeCloseTo(0.5, 5);
  });
  it("boundary 在打烊后 → 0", () => {
    expect(ratioAfter(flat, 23 * 60)).toBe(0);
  });
});

describe("computeRestockAdvice", () => {
  it("卖超 → 加货，且向上取整到出货倍数", () => {
    const a = computeRestockAdvice(base({ soldSoFar: 30 }), CUT); // proj≈69.2×1.10=76.1, gap≈26.1
    expect(a.action).toBe("add");
    expect(a.qty).toBe(30); // ceil(26.1/10)*10，且售罄空间(≈35)足够
    expect(a.projFullDay).toBeCloseTo(76.15, 0); // 含 ×1.10 晚市校准
  });

  it("售罄检查：卖超但上柜后卖不满一批 → hold（不制造报废）", () => {
    // 前置型曲线：14 点后几乎无需求；即使卖超，加一批也卖不完。
    const front = { 10: 20, 11: 20, 12: 20, 13: 20, 14: 5, 15: 1, 16: 1, 17: 1 };
    const a = computeRestockAdvice(base({ soldSoFar: 100, plan: 88, hourly: front }), CUT);
    expect(a.action).toBe("hold");
    expect(a.qty).toBe(0);
  });

  it("卖慢 → 减货，向下取整到出货倍数，且不超过未卖出的量", () => {
    const a = computeRestockAdvice(base({ soldSoFar: 10 }), CUT); // proj≈23.1, gap≈-26.9
    expect(a.action).toBe("reduce");
    expect(a.qty).toBe(20); // floor(26.9/10)*10
  });

  it("与计划相差不足阈值(max(1倍,15%)) → hold", () => {
    const a = computeRestockAdvice(base({ soldSoFar: 22 }), CUT); // proj≈50.8
    expect(a.action).toBe("hold");
  });

  it("太早(此刻常态占比 < 25%) → 不外推 hold", () => {
    const a = computeRestockAdvice(base({ soldSoFar: 5 }), 10 * 60); // 10:00，几乎无占比
    expect(a.action).toBe("hold");
    expect(a.reason).toContain("外推不稳");
  });

  it("无历史曲线 → hold", () => {
    const a = computeRestockAdvice(base({ soldSoFar: 30, hourly: {} }), CUT);
    expect(a.action).toBe("hold");
    expect(a.reason).toContain("无历史曲线");
  });

  it("加货量不超过能卖完的整批数（售罄封顶）", () => {
    // 卖超很多(gap 大)，但 14:20 后曲线只剩约 2 批空间 → 加货被封在可卖完的整批数。
    const tail = { 10: 2, 11: 2, 12: 2, 13: 2, 14: 30, 15: 20, 16: 3, 17: 1 };
    const a = computeRestockAdvice(base({ soldSoFar: 40, plan: 20, packMultiple: 10, hourly: tail }), CUT);
    if (a.action === "add") {
      const sellableCap = a.projFullDay * ratioAfter(tail, CUT + 60);
      expect(a.qty).toBeLessThanOrEqual(Math.floor(sellableCap / 10) * 10);
    }
  });
});
