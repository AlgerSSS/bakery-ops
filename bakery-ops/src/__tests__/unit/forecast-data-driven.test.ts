// 数据驱动目标(应收)的分位数核心数学 — 新预测法 需求=中位数 / 目标=P85
import { describe, it, expect } from "vitest";
import { percentile } from "../../modules/domain/forecast/data-driven-target";

describe("percentile 线性插值", () => {
  it("P50 中位数（奇/偶个）", () => {
    expect(percentile([10, 20, 30], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
  });
  it("P85（n=8 trailing-8 场景）", () => {
    // idx = 0.85 * 7 = 5.95 → 60 + (70-60)*0.95 = 69.5
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80], 85)).toBeCloseTo(69.5, 5);
  });
  it("单元素恒等", () => {
    expect(percentile([42], 85)).toBe(42);
    expect(percentile([42], 50)).toBe(42);
  });
  it("P0 / P100 取边界", () => {
    expect(percentile([5, 15, 25], 0)).toBe(5);
    expect(percentile([5, 15, 25], 100)).toBe(25);
  });
  it("P85 ≥ P50（目标≥需求）", () => {
    const s = [30, 41, 42, 45, 47, 48, 51, 55];
    expect(percentile(s, 85)).toBeGreaterThanOrEqual(percentile(s, 50));
  });
});
