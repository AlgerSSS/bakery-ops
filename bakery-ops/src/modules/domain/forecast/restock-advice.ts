// restock-advice.ts — 下午实时「加减货建议」引擎（用户 2026-07-05 设计）。
//
// 思路：拿今天到决策时刻(默认 14:20)的单品实际销量 soldSoFar，用「近 8 个同星期几的逐时曲线」
// 把当天速度外推到全天需求 projFullDay，再和今天的计划产量 plan 比：
//   卖超(projFullDay>plan) → 加货；卖慢(projFullDay<plan) → 减货。
// 两条硬约束（用户要求）：
//   1. 加减货量按「出货倍数」packMultiple 取整（加向上、减向下）。
//   2. 加货要过「售罄检查」：加的货 T+提前量 后才上柜，只算那之后曲线里还剩的需求量，
//      卖不完的部分不建议加（否则只会变明天的报废）。
// 纯函数 computeRestockAdvice 便于单测与回测；数据层 getSoldSoFar / 编排 generateRestockAdvice。

import dayjs from "dayjs";
import { query } from "@/modules/shared/db/postgres";
import { logger } from "@/modules/shared/logger";
import { getProductForecast } from "./forecast.service";
import { getProductSalesStats } from "./product-demand";

const NORM = (col: string) => `lower(btrim(regexp_replace(${col}, '[[:space:]]+', ' ', 'g')))`;

// —— 可调参数 ——
export const CLOSE_MIN = 22 * 60;            // 打烊 22:00
export const LEAD_MIN: Record<string, number> = { 热: 60, 冷: 240 }; // 加货提前量(分钟)：热~1h / 冷~4h
const MIN_PASSED_RATIO = 0.25;               // 到此刻常态应发生的需求占比太低 → 太早，不外推
const REL_THRESHOLD = 0.15;                  // |gap| 需 ≥ 15% × 计划 才提示（降噪）
const MIN_HIST_BEFORE = 3;                   // 常态此刻应售绝对件数下限，低于此判不准 → hold
// 纯速度外推 sold/passedRatio 系统性偏低(近日晚市比 8 日均曲线更重)，回测日级 k≈1.10 → 校准回补。
// env RESTOCK_CAL 可重新标定(定期用回测复核)。
const EXTRAP_CAL = Number(process.env.RESTOCK_CAL) || 1.10;

export interface RestockInput {
  productName: string;
  soldSoFar: number;                 // 今日到决策时刻已售件数
  plan: number;                      // 今日计划产量(预估单)
  packMultiple: number;              // 出货倍数
  coldHot: string;                   // 冷/热 → 提前量
  hourly: Record<number, number>;    // 近 8 个同星期几的逐时均量(常态曲线)
}

export interface RestockAdvice {
  productName: string;
  action: "add" | "reduce" | "hold";
  qty: number;                       // 加/减数量(已按倍数取整)；hold=0
  soldSoFar: number;
  expectedByNow: number;             // 常态此刻应售 = plan × passedRatio
  projFullDay: number;               // 外推全天需求
  plan: number;
  reason: string;                    // hold 时给不提示的原因（调试用）
}

/** 曲线里「分钟数 boundary 之后」还会发生的需求占全天比例（当前小时按剩余分钟数按比例切）。 */
export function ratioAfter(hourly: Record<number, number>, boundaryMin: number): number {
  let total = 0;
  let after = 0;
  for (const [hStr, q] of Object.entries(hourly)) {
    const h = Number(hStr);
    total += q;
    const start = h * 60;
    const end = start + 60;
    if (end <= boundaryMin) continue;               // 整个小时都在 boundary 之前
    if (start >= boundaryMin) { after += q; continue; } // 整个小时都在 boundary 之后
    after += (q * (end - boundaryMin)) / 60;        // 跨界小时：按剩余分钟比例
  }
  return total > 0 ? after / total : 0;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * 单品加减货建议（纯函数）。cutoffMin = 决策时刻(自午夜起分钟)，如 14:20 → 860。
 * soldSoFar 必须与 cutoffMin 口径一致（都截到该时刻）。
 */
export function computeRestockAdvice(input: RestockInput, cutoffMin: number): RestockAdvice {
  const { productName, soldSoFar, plan, packMultiple, coldHot, hourly } = input;
  const pack = packMultiple > 0 ? packMultiple : 1;
  const base = { productName, soldSoFar, plan, expectedByNow: 0, projFullDay: 0 };

  const mult = (q: number) => (pack > 1 ? `（${q / pack}倍）` : ""); // 个装(倍数1)不标「X倍」

  const total = Object.values(hourly).reduce((s, v) => s + v, 0);
  if (total <= 0) return { ...base, action: "hold", qty: 0, reason: "无历史曲线" };

  const passedRatio = 1 - ratioAfter(hourly, cutoffMin);
  if (passedRatio < MIN_PASSED_RATIO) return { ...base, action: "hold", qty: 0, reason: "此刻常态占比过低，外推不稳" };

  // 低信号护栏：常态此刻应售件数太少 → 速度不可信；零销量存疑(可能缺数)不据此减货。
  const histBefore = total * passedRatio;
  if (histBefore < MIN_HIST_BEFORE) return { ...base, action: "hold", qty: 0, reason: "此刻常态销量太少，判不准" };
  if (soldSoFar <= 0) return { ...base, action: "hold", qty: 0, reason: "此刻零销量存疑（可能缺数），不据此减货" };

  const projFullDay = (soldSoFar / passedRatio) * EXTRAP_CAL; // 校准回补晚市偏低
  const expectedByNow = plan * passedRatio;
  const gap = projFullDay - plan;
  const threshold = Math.max(pack, plan * REL_THRESHOLD);
  const full = { ...base, expectedByNow, projFullDay };

  if (Math.abs(gap) < threshold) return { ...full, action: "hold", qty: 0, reason: "与计划相差不大" };

  if (gap > 0) {
    // 加货：T+提前量 之后才上柜，只算那之后曲线里还剩的需求 → 售罄检查。
    // 覆盖缺口向上取整，但不超过「能卖完的整批数」(向下取整)；卖不满一批 → 不加。
    const availMin = cutoffMin + (LEAD_MIN[coldHot] ?? LEAD_MIN["热"]);
    const sellable = projFullDay * ratioAfter(hourly, availMin);
    const need = Math.ceil(gap / pack) * pack;
    const canSell = Math.floor(sellable / pack) * pack;
    const addQty = Math.min(need, canSell);
    if (addQty <= 0) return { ...full, action: "hold", qty: 0, reason: `卖超但 ${hhmm(availMin)} 后卖不满一批，加了会报废` };
    return {
      ...full, action: "add", qty: addQty,
      reason: `卖超：已售 ${soldSoFar}（常态此刻~${Math.round(expectedByNow)}），全天预计~${Math.round(projFullDay)} > 计划 ${plan}；建议加 ${addQty}${mult(addQty)}，${hhmm(availMin)} 前出炉可卖完`,
    };
  }

  // 减货：只能减掉「还没卖出」的剩余批次，向下取整到倍数
  const reducible = Math.max(0, plan - soldSoFar);
  const reduceQty = Math.floor(Math.min(-gap, reducible) / pack) * pack;
  if (reduceQty <= 0) return { ...full, action: "hold", qty: 0, reason: "卖慢但可减批次不足一倍" };
  return {
    ...full, action: "reduce", qty: reduceQty,
    reason: `卖慢：已售 ${soldSoFar}（常态此刻~${Math.round(expectedByNow)}），全天预计~${Math.round(projFullDay)} < 计划 ${plan}；剩余批次建议减 ${reduceQty}${mult(reduceQty)}防报废`,
  };
}

/** 把建议列表拼成推送文本（Lark Markdown）。纯函数，供定时推送与 bot 即时版共用。 */
export function buildRestockAdviceText(date: string, advices: RestockAdvice[], clock = "14:30"): string {
  const add = advices.filter((a) => a.action === "add").sort((a, b) => (b.projFullDay - b.plan) - (a.projFullDay - a.plan));
  const red = advices.filter((a) => a.action === "reduce").sort((a, b) => (b.plan - b.projFullDay) - (a.plan - a.projFullDay));
  const lines = [`🍞 *加减货建议* · ${date} ${clock}`, "（据今日实际销量外推全天需求，数量已按出货倍数取整）"];
  if (!add.length && !red.length) {
    lines.push("", "今日各单品基本按计划，暂无显著加减货建议 ✅");
    return lines.join("\n");
  }
  if (add.length) { lines.push("", "🔺 *加货*"); for (const a of add) lines.push(`• *${a.productName}* ${a.reason}`); }
  if (red.length) { lines.push("", "🔻 *减货*"); for (const a of red) lines.push(`• *${a.productName}* ${a.reason}`); }
  return lines.join("\n");
}

/** 今日到 cutoffMin 的单品实际销量（中文品名）。当前小时桶天然是部分数据，不再切分。 */
export async function getSoldSoFar(date: string, cutoffMin: number): Promise<Map<string, number>> {
  const cutoffHour = Math.floor(cutoffMin / 60);
  const rows = await query<{ cn: string; qty: number }>(
    `SELECT p.name AS cn, SUM(s.qty)::int AS qty
       FROM item_hourly_sales s
       JOIN product p ON ${NORM("p.name_en")} = ${NORM("s.item_name")}
      WHERE s.date = $1 AND s.hour <= $2
      GROUP BY p.name`,
    [date, cutoffHour],
  );
  return new Map(rows.map((r) => [r.cn, Number(r.qty)]));
}

/**
 * 编排：拼装某天在 cutoffMin 时刻的加减货建议。
 * plan 来自当日预估单(getProductForecast)，曲线来自 getProductSalesStats，实际来自 getSoldSoFar。
 * 只对烘焙品（排除饮品/水吧），返回按 |加减量×单价| 排序、action≠hold 的建议。
 */
export async function generateRestockAdvice(
  date: string = dayjs().format("YYYY-MM-DD"),
  cutoffMin = 14 * 60 + 20,
): Promise<RestockAdvice[]> {
  const [forecast, stats, sold] = await Promise.all([
    getProductForecast(date),
    getProductSalesStats(date),
    getSoldSoFar(date, cutoffMin),
  ]);

  // 数据完整性护栏：常态此刻本应有销量(histBefore≥1)的品里，实际有数据的占比过低 →
  // 判为拉取不全(如只抓到部分单品)，整轮跳过，避免把「缺数」误报成一堆减货。
  let expectCount = 0, haveCount = 0;
  for (const p of forecast.products) {
    const hourly = stats.get(p.name)?.hourly;
    if (!hourly) continue;
    const total = Object.values(hourly).reduce((s, v) => s + v, 0);
    if (total * (1 - ratioAfter(hourly, cutoffMin)) >= 1) {
      expectCount++;
      if ((sold.get(p.name) ?? 0) > 0) haveCount++;
    }
  }
  if (expectCount >= 5 && haveCount < expectCount * 0.5) {
    logger.warn(`[restock] ${date} 到 ${Math.floor(cutoffMin / 60)}:${cutoffMin % 60} 仅 ${haveCount}/${expectCount} 应有销量的品有数据，疑今日销量拉取不全，跳过加减货`);
    return [];
  }

  const advices: RestockAdvice[] = [];
  for (const p of forecast.products) {
    if (/饮品|水吧/.test(p.positioning)) continue;
    const hourly = stats.get(p.name)?.hourly;
    if (!hourly) continue; // 无曲线不判
    advices.push(
      computeRestockAdvice(
        { productName: p.name, soldSoFar: sold.get(p.name) ?? 0, plan: p.suggestedQty, packMultiple: p.packMultiple, coldHot: p.coldHot, hourly },
        cutoffMin,
      ),
    );
  }
  return advices.filter((a) => a.action !== "hold");
}
