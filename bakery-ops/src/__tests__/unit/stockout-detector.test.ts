// F5: 断货自动检测的判定规则（纯函数）与推送文案（IMPROVEMENT-PLAN.md F5）
// 规则（用户 2026-07-04）：断货 = 无排产报废 + 有销量 + 最后成交时间 < 打烊时间；
// 断货时间 = 最后成交(分钟)。有排产报废=有剩余=没断货；卖到打烊=不算提前断货。
// 精度：优先 item_last_sale(分钟级)，缺失回落 item_hourly_sales(小时级)；此处测纯函数(分钟数)。
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
  detectStockout,
  minutesToHHMM,
  buildStockoutDetectText,
  type StockoutDetectionInput,
} from "../../modules/domain/forecast/stockout-detector.service";

const HHMM = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

const input = (overrides: Partial<StockoutDetectionInput> = {}): StockoutDetectionInput => ({
  // 最后成交 18:47；打烊 22:17
  lastSaleMinutes: HHMM("18:47"),
  closeMinutes: HHMM("22:17"),
  hasSchedulingWaste: false,
  isBeverage: false,
  ...overrides,
});

describe("detectStockout 判定规则（分钟级）", () => {
  it("无排产报废 + 18:47 后无销量 → 断货时间 = 最后成交 18:47", () => {
    expect(detectStockout(input())).toBe(HHMM("18:47"));
  });

  it("有排产报废 → 收工有剩余 → 没断货", () => {
    expect(detectStockout(input({ hasSchedulingWaste: true }))).toBeNull();
  });

  it("饮品类 → 永不做断货检测（即便早早卖完）", () => {
    expect(detectStockout(input({ isBeverage: true }))).toBeNull();
    // 饮品优先级最高：即使无报废、明显提前售罄，也不判
    expect(detectStockout(input({ isBeverage: true, lastSaleMinutes: HHMM("14:00") }))).toBeNull();
  });

  it("卖到打烊（最后成交 = 打烊时间）→ 不算提前断货", () => {
    expect(detectStockout(input({ lastSaleMinutes: HHMM("22:17") }))).toBeNull();
  });

  it("最后成交晚于打烊（数据异常）→ 不判断货", () => {
    expect(detectStockout(input({ lastSaleMinutes: HHMM("22:30") }))).toBeNull();
  });

  it("当天无销量（lastSaleMinutes = null）→ 不判断货", () => {
    expect(detectStockout(input({ lastSaleMinutes: null }))).toBeNull();
  });

  it("分钟精度保留：21:59 断货 vs 22:00 打烊 → 断货 21:59", () => {
    expect(detectStockout(input({ lastSaleMinutes: HHMM("21:59"), closeMinutes: HHMM("22:00") }))).toBe(HHMM("21:59"));
  });
});

describe("minutesToHHMM", () => {
  it("补零到 HH:MM", () => {
    expect(minutesToHHMM(HHMM("09:05"))).toBe("09:05");
    expect(minutesToHHMM(HHMM("18:47"))).toBe("18:47");
    expect(minutesToHHMM(0)).toBe("00:00");
  });
});

describe("buildStockoutDetectText 文案", () => {
  it("汇总款数与总估损，分钟精度断货时间，标注自动检测可修正", () => {
    const text = buildStockoutDetectText("2026-07-01", [
      { productName: "轻乳酪", soldoutTime: "16:23", lossQty: 8, lossAmount: 64 },
      { productName: "开心果蛋挞", soldoutTime: "18:47", lossQty: 2, lossAmount: 26 },
    ]);
    expect(text).toContain("昨日疑似断货 2 款，估损 RM90（自动检测，网页端可修正）");
    expect(text).toContain("1. 轻乳酪: 最后成交 16:23, 之后断货, 估损 8个/RM64");
    expect(text).toContain("2. 开心果蛋挞: 最后成交 18:47, 之后断货, 估损 2个/RM26");
  });
});
