import { describe, expect, it } from "vitest";
import {
  DEFAULT_BEVERAGE_ITEMS,
  DEFAULT_NON_PRODUCTION_ITEMS,
  normCaliberName,
} from "@/modules/domain/forecast/beverage-caliber";
import { detectStockout } from "@/modules/domain/forecast/stockout-detector.service";

/* 回归：2026-07-07 财务站把 item_category 整表换成英文营销分组后，
   原来按 '%饮品%' 查饮品的判据静默返回 0 行，近 30 天 326 条断货记录里 101 条是误报。
   口径已迁到 bakery-ops 自持的 business_rule，这里钉住三件事：
   清单不为空、不误伤同词根的烘焙品、饮品与周边都不进断货检测。 */
describe("现制饮品与非生产品口径", () => {
  const bev = new Set(DEFAULT_BEVERAGE_ITEMS.map(normCaliberName));
  const non = new Set(DEFAULT_NON_PRODUCTION_ITEMS.map(normCaliberName));

  it("内置清单永不为空——空集等于全量误报", () => {
    expect(DEFAULT_BEVERAGE_ITEMS.length).toBeGreaterThan(0);
    expect(DEFAULT_NON_PRODUCTION_ITEMS.length).toBeGreaterThan(0);
  });

  it("同词根的烘焙品不得被当成饮品", () => {
    // 用子串匹配会把这些全吞掉，所以清单必须逐品枚举
    for (const baked of [
      "Thai Milk Tea Tiramisu",              // Chocolate series 里的杯装甜品，近30天真实断货13次
      "Berlin Volufra Coffee Pretzel",       // 含 Coffee
      "French Rich Coffee Macaron",          // 含 Coffee
      "Japanese Matcha Red Bean Bagel",      // 含 Matcha
      "Italian Matcha Lava Moritozzo",       // 含 Matcha
      "Hot Crush Strawberry Iced Croissant", // 含 Iced
    ]) {
      expect(bev.has(normCaliberName(baked)), `${baked} 不该被判为饮品`).toBe(false);
    }
  });

  it("归一化吃掉 POS 品名里的尾部 tab、双空格与 U+00A0", () => {
    expect(normCaliberName("Hot Crush Dual-Layer  Coffee Cup")).toBe(
      normCaliberName("Hot Crush Dual-Layer Coffee Cup"),
    );
    expect(normCaliberName("Berlin Volufra Tomato Beef Pretzel\t")).toBe(
      "berlin volufra tomato beef pretzel",
    );
    expect(normCaliberName("Latte ")).toBe("latte");
  });

  it("饮品与周边都不进断货检测，烘焙品照常检测", () => {
    const base = { lastSaleMinutes: 900, closeMinutes: 1320, hasSchedulingWaste: false };
    expect(detectStockout({ ...base, isBeverage: true })).toBeNull();
    expect(detectStockout({ ...base, isBeverage: false, isNonProduction: true })).toBeNull();
    // 2026-07-18 爱心形纸香片当天只卖 1 片被判断货、估损 RM13545，占近30天总估损 16.2%
    expect(non.has(normCaliberName("Hot Crush Heart Scent Card"))).toBe(true);
    // 真烘焙品必须仍被检测出来
    expect(detectStockout({ ...base, isBeverage: false })).toBe(900);
  });
});
