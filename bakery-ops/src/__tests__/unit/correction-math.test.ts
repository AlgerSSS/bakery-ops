import { describe, it, expect } from "vitest";
import {
  roundCorrections,
  rebalanceToTarget,
  type CorrectionProduct,
} from "@/modules/domain/forecast/correction-math";

function makeProduct(overrides: Partial<CorrectionProduct> & { productName: string }): CorrectionProduct {
  return {
    price: 10,
    packMultiple: 1,
    unitType: "individual",
    positioning: "其他",
    roundedQuantity: 0,
    ...overrides,
  };
}

function toMap(products: CorrectionProduct[]): Map<string, CorrectionProduct> {
  return new Map(products.map((p) => [p.productName, p]));
}

describe("roundCorrections", () => {
  it("rounds fractional quantities to nearest integer", () => {
    const products = [makeProduct({ productName: "A" })];
    const result = roundCorrections(
      [{ productName: "A", suggestedQuantity: 4.6, reason: "涨" }],
      toMap(products)
    );
    expect(result).toEqual([{ productName: "A", suggestedQuantity: 5, reason: "涨" }]);
  });

  it("clamps negative quantities to zero", () => {
    const products = [makeProduct({ productName: "A" })];
    const result = roundCorrections(
      [{ productName: "A", suggestedQuantity: -3, reason: "" }],
      toMap(products)
    );
    expect(result[0].suggestedQuantity).toBe(0);
  });

  it("snaps batch products to packMultiple", () => {
    const products = [makeProduct({ productName: "B", unitType: "batch", packMultiple: 6 })];
    const result = roundCorrections(
      [{ productName: "B", suggestedQuantity: 10, reason: "" }],
      toMap(products)
    );
    // round(10/6)=2 → 12
    expect(result[0].suggestedQuantity).toBe(12);
  });

  it("does not snap batch products with packMultiple <= 1", () => {
    const products = [makeProduct({ productName: "B", unitType: "batch", packMultiple: 1 })];
    const result = roundCorrections(
      [{ productName: "B", suggestedQuantity: 7, reason: "" }],
      toMap(products)
    );
    expect(result[0].suggestedQuantity).toBe(7);
  });

  it("keeps plain rounding when product is unknown", () => {
    const result = roundCorrections(
      [{ productName: "未知", suggestedQuantity: 3.2, reason: "" }],
      new Map()
    );
    expect(result[0].suggestedQuantity).toBe(3);
  });

  it("defaults missing reason to empty string", () => {
    const result = roundCorrections(
      [{ productName: "A", suggestedQuantity: 1, reason: undefined as unknown as string }],
      new Map()
    );
    expect(result[0].reason).toBe("");
  });

  it("preserves zero quantity", () => {
    const result = roundCorrections(
      [{ productName: "A", suggestedQuantity: 0, reason: "" }],
      new Map()
    );
    expect(result[0].suggestedQuantity).toBe(0);
  });
});

describe("rebalanceToTarget", () => {
  it("leaves corrections untouched when total is within 2% tolerance", () => {
    const products = [makeProduct({ productName: "A", price: 10 })];
    const corrections = [{ productName: "A", suggestedQuantity: 10, reason: "" }];
    // total=100, target=101, diff=1 <= tolerance 2.02
    const total = rebalanceToTarget(corrections, products, toMap(products), 101);
    expect(total).toBe(100);
    expect(corrections[0].suggestedQuantity).toBe(10);
  });

  it("adds quantity to close a positive gap", () => {
    const products = [makeProduct({ productName: "A", price: 10 })];
    const corrections = [{ productName: "A", suggestedQuantity: 10, reason: "" }];
    // total=100, target=112, diff=12 > tolerance 2.24; step=10 <= 12*1.5 → +1
    const total = rebalanceToTarget(corrections, products, toMap(products), 112);
    expect(corrections[0].suggestedQuantity).toBe(11);
    expect(total).toBe(110);
  });

  it("reduces quantity when total exceeds target (negative diff)", () => {
    const products = [makeProduct({ productName: "A", price: 10 })];
    const corrections = [{ productName: "A", suggestedQuantity: 12, reason: "" }];
    // total=120, target=110, diff=-10 > tolerance 2.2; qty 12 > unit 1 → -1
    const total = rebalanceToTarget(corrections, products, toMap(products), 110);
    expect(corrections[0].suggestedQuantity).toBe(11);
    expect(total).toBe(110);
  });

  it("prefers TOP positioning, then higher price", () => {
    const products = [
      makeProduct({ productName: "普通", price: 50, positioning: "其他" }),
      makeProduct({ productName: "头牌", price: 10, positioning: "TOP" }),
    ];
    const corrections = [
      { productName: "普通", suggestedQuantity: 2, reason: "" },
      { productName: "头牌", suggestedQuantity: 5, reason: "" },
    ];
    // total=150, target=165, diff=15; TOP first: step 10 <= 22.5 → 头牌 +1 → remaining 5
    // 普通 step 50 > 5*1.5 → skipped
    rebalanceToTarget(corrections, products, toMap(products), 165);
    expect(corrections.find((c) => c.productName === "头牌")!.suggestedQuantity).toBe(6);
    expect(corrections.find((c) => c.productName === "普通")!.suggestedQuantity).toBe(2);
  });

  it("uses packMultiple as the adjustment unit for batch products", () => {
    const products = [
      makeProduct({ productName: "B", price: 5, unitType: "batch", packMultiple: 6 }),
    ];
    const corrections = [{ productName: "B", suggestedQuantity: 12, reason: "" }];
    // total=60, target=95, diff=35 > tolerance 1.9; step=30 <= 52.5 → +6
    const total = rebalanceToTarget(corrections, products, toMap(products), 95);
    expect(corrections[0].suggestedQuantity).toBe(18);
    expect(total).toBe(90);
  });

  it("does not reduce below one unit", () => {
    const products = [makeProduct({ productName: "A", price: 10 })];
    const corrections = [{ productName: "A", suggestedQuantity: 1, reason: "" }];
    // total=10, target=5, diff=-5; qty 1 is not > unit 1 → unchanged
    const total = rebalanceToTarget(corrections, products, toMap(products), 5);
    expect(corrections[0].suggestedQuantity).toBe(1);
    expect(total).toBe(10);
  });

  it("falls back to adjusted/rounded quantity for products without corrections", () => {
    const products = [
      makeProduct({ productName: "A", price: 10 }),
      makeProduct({ productName: "无校正", price: 20, roundedQuantity: 3, adjustedQuantity: 2 }),
    ];
    const corrections = [{ productName: "A", suggestedQuantity: 10, reason: "" }];
    // A=100 + 无校正 uses adjustedQuantity 2*20=40 → total=140, target=140 → no change
    const total = rebalanceToTarget(corrections, products, toMap(products), 140);
    expect(total).toBe(140);
  });

  it("handles zero quantities without adjusting downward", () => {
    const products = [makeProduct({ productName: "A", price: 10 })];
    const corrections = [{ productName: "A", suggestedQuantity: 0, reason: "" }];
    // total=0, target=5, diff=5 > tolerance 0.1; step 10 > 7.5 → no add possible
    const total = rebalanceToTarget(corrections, products, toMap(products), 5);
    expect(corrections[0].suggestedQuantity).toBe(0);
    expect(total).toBe(0);
  });
});
