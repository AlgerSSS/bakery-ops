// sell-through.ts — day-old 折扣分析：按品 sell-through 与清货候选（IMPROVEMENT-PLAN.md 第 7 章 G5-1）。
//
// calcSellThrough(days)：近 N 个完整天（昨日起往前 N 天）按品聚合 item_hourly_sales 销量
// 与 item_waste 报废，sell-through = 销量/(销量+报废)，低者在前。
// findDiscountCandidates()：sell-through < 阈值（env SELL_THROUGH_WARN，默认 0.85）且有报废金额的品，
// 按报废金额降序，结合 hourly_sales_summary 晚间（19-22 点）折扣占比给规则式建议文案（固定模板，不调 AI）。

import { query } from "@/modules/shared/db/postgres";
import { localDate } from "@/modules/channel/whatsapp/outbound.config";

export interface SellThroughItem {
  itemName: string;
  soldQty: number;
  wasteQty: number;
  wasteAmount: number; // 报废金额 RM
  sellThrough: number; // 0-1，销量/(销量+报废)
}

export interface DiscountCandidate extends SellThroughItem {
  advice: string; // 规则式建议文案
}

const DEFAULT_WARN = 0.85;
/** 晚间折扣占全周折扣的占比超过该值，视为"已在打折仍报废"。 */
const EVENING_DISCOUNT_HEAVY = 0.5;

/** 近 N 个完整天区间 [today-N, today-1]（YYYY-MM-DD，纯函数便于单测）。 */
export function getRecentRange(today: string, days: number): { start: string; end: string } {
  const base = new Date(`${today}T00:00:00Z`);
  const fmt = (offset: number) => new Date(base.getTime() + offset * 86400000).toISOString().slice(0, 10);
  return { start: fmt(-days), end: fmt(-1) };
}

/** 按品聚合近 N 天销量与报废，算 sell-through，升序（最差在前）。 */
export async function calcSellThrough(days: number, today: string = localDate()): Promise<SellThroughItem[]> {
  const { start, end } = getRecentRange(today, days);

  const soldRows = await query<any>(
    `SELECT item_name, SUM(qty) as sold_qty
     FROM item_hourly_sales WHERE date >= $1 AND date <= $2 GROUP BY item_name`,
    [start, end],
  );
  const wasteRows = await query<any>(
    `SELECT item_name, SUM(qty) as waste_qty, SUM(amount) as waste_amount
     FROM item_waste WHERE date >= $1 AND date <= $2 GROUP BY item_name`,
    [start, end],
  );

  const byName = new Map<string, SellThroughItem>();
  const get = (name: string): SellThroughItem => {
    let item = byName.get(name);
    if (!item) {
      item = { itemName: name, soldQty: 0, wasteQty: 0, wasteAmount: 0, sellThrough: 0 };
      byName.set(name, item);
    }
    return item;
  };
  for (const r of soldRows) {
    get(String(r.item_name)).soldQty = Number(r.sold_qty) || 0;
  }
  for (const r of wasteRows) {
    const item = get(String(r.item_name));
    item.wasteQty = Number(r.waste_qty) || 0;
    item.wasteAmount = Number(r.waste_amount) || 0;
  }

  const items = Array.from(byName.values()).filter((i) => i.soldQty + i.wasteQty > 0);
  for (const i of items) {
    i.sellThrough = i.soldQty / (i.soldQty + i.wasteQty);
  }
  return items.sort((a, b) => a.sellThrough - b.sellThrough);
}

/** sell-through < 阈值且有报废金额的品，按报废金额降序，附一句规则式建议。 */
export async function findDiscountCandidates(days = 7, today: string = localDate()): Promise<DiscountCandidate[]> {
  const threshold = Number(process.env.SELL_THROUGH_WARN) || DEFAULT_WARN;

  const items = await calcSellThrough(days, today);
  const candidates = items
    .filter((i) => i.sellThrough < threshold && i.wasteAmount > 0)
    .sort((a, b) => b.wasteAmount - a.wasteAmount);
  if (!candidates.length) return [];

  // 晚间（19-22 点）折扣占比：判断"折了还废"还是"没怎么折"。
  const { start, end } = getRecentRange(today, days);
  const rows = await query<any>(
    `SELECT SUM(CASE WHEN hour >= 19 AND hour <= 22 THEN total_discount ELSE 0 END) as evening_discount,
            SUM(total_discount) as total_discount
     FROM hourly_sales_summary WHERE date >= $1 AND date <= $2`,
    [start, end],
  );
  const totalDiscount = Number(rows[0]?.total_discount) || 0;
  const eveningRatio = totalDiscount > 0 ? (Number(rows[0]?.evening_discount) || 0) / totalDiscount : 0;
  const tail =
    eveningRatio >= EVENING_DISCOUNT_HEAVY
      ? "晚间折扣后仍有报废，建议晚 8 点后加大折度或减产"
      : "晚间折扣力度不足，建议晚 8 点后启动折扣清货";

  return candidates.map((i) => ({
    ...i,
    advice: `${i.itemName} sell-through ${(i.sellThrough * 100).toFixed(0)}%（报废 RM${i.wasteAmount.toFixed(0)}），${tail}`,
  }));
}
