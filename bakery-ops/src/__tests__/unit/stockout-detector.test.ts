// F5: 断货自动检测的判定规则（纯函数）与推送文案（IMPROVEMENT-PLAN.md F5）
import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/shared/db/postgres", () => ({
  query: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("@/modules/channel/whatsapp/whatsapp.client", () => ({
  isClientConnected: vi.fn(),
  sendTextTo: vi.fn(),
}));

import {
  detectStockoutHour,
  buildStockoutDetectText,
  type StockoutDetectionInput,
} from "../../modules/domain/forecast/stockout-detector.service";

/** 12–21 点整店都有单的客流基线。 */
const fullTraffic = (): Record<number, number> => {
  const bills: Record<number, number> = {};
  for (let h = 12; h <= 21; h++) bills[h] = 30;
  return bills;
};

const input = (overrides: Partial<StockoutDetectionInput> = {}): StockoutDetectionInput => ({
  // 卖到 15 点，16 点起零销量
  itemQtyByHour: { 12: 5, 13: 4, 14: 6, 15: 3 },
  storeBillsByHour: fullTraffic(),
  // 同日型历史全天每小时均销 2 个 → 16 点后剩余 2×6=12 ≥ 3
  histAvgQtyByHour: { 12: 2, 13: 2, 14: 2, 15: 2, 16: 2, 17: 2, 18: 2, 19: 2, 20: 2, 21: 2 },
  ...overrides,
});

describe("detectStockoutHour 判定规则", () => {
  it("正常售罄：15 点后连续零销 + 整店仍有单 + 历史均量足 → 判 16 点售罄", () => {
    expect(detectStockoutHour(input())).toBe(16);
  });

  it("全店没客流误报排除：16 点起整店无单（早收/没客流）→ 不判断货", () => {
    expect(
      detectStockoutHour(input({ storeBillsByHour: { 12: 50, 13: 60, 14: 40, 15: 20 } })),
    ).toBeNull();
  });

  it("h 后有客流的零销小时不足 2 个 → 不判断货（宁严勿松）", () => {
    expect(
      detectStockoutHour(input({ storeBillsByHour: { 12: 50, 13: 60, 14: 40, 15: 20, 16: 5 } })),
    ).toBeNull();
  });

  it("低销量品排除：历史 h 后平均日销 <3 → 不判断货", () => {
    expect(
      detectStockoutHour(
        input({ histAvgQtyByHour: { 12: 2, 13: 2, 14: 2, 15: 2, 16: 0.5, 17: 0.5, 18: 0.5, 19: 0.5, 20: 0.4 } }),
      ),
    ).toBeNull();
  });

  it("卖到打烊 → 不判断货", () => {
    const qty: Record<number, number> = {};
    for (let h = 12; h <= 21; h++) qty[h] = 3;
    expect(detectStockoutHour(input({ itemQtyByHour: qty }))).toBeNull();
  });

  it("全天零销（可能未生产）→ 不判断货", () => {
    expect(detectStockoutHour(input({ itemQtyByHour: {} }))).toBeNull();
  });
});

describe("buildStockoutDetectText 文案", () => {
  it("汇总款数与总估损，标注自动检测可修正", () => {
    const text = buildStockoutDetectText("2026-07-01", [
      { productName: "轻乳酪", soldoutHour: 16, lossQty: 8, lossAmount: 64 },
      { productName: "开心果蛋挞", soldoutHour: 18, lossQty: 2, lossAmount: 26 },
    ]);
    expect(text).toContain("昨日疑似断货 2 款，估损 RM90（自动检测，网页端可修正）");
    expect(text).toContain("1. 轻乳酪: 16:00 后无销量, 估损 8个/RM64");
    expect(text).toContain("2. 开心果蛋挞: 18:00 后无销量, 估损 2个/RM26");
  });
});
