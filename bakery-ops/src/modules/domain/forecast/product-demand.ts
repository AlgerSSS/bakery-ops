// product-demand.ts — 单品级「数据驱动需求」（P0/P1 改进，用户 2026-07-05）。
//
// 直接从 item_hourly_sales（POS 实时销量，英文名）按 product.name_en↔item_name 归一化连接，
// 取目标日之前最近 N 个同星期几的当日销量：中位数(需求) + P85(TOP 品的防断货缓冲) + 逐时曲线。
// 取代 12 周未更新的 product_sales_baseline 和中英文名对不上、恒等分的 timeslot 老路。
// 只在 FORECAST_MODE=new 生效；名映射见 product.name_en（已对齐 POS）。
import dayjs from "dayjs";
import { query } from "@/modules/shared/db/postgres";
import { percentile } from "./data-driven-target";

const N_TRAILING = 8;       // 最近 8 个同星期几
const WINDOW_DAYS = 63;     // 回看窗口(~9 周)，够取 8 个同星期几

export interface ProductDemand {
  median: number;               // 同星期几当日销量中位数（需求）
  p85: number;                  // P85（TOP 品缓冲）
  n: number;                    // 样本天数
  hourly: Record<number, number>; // 逐小时平均销量（分配用）
}

/** 品名归一化 SQL 片段：折叠所有空白(含 tab)→单空格 + trim + 小写。 */
const NORM = (col: string) => `lower(btrim(regexp_replace(${col}, '[[:space:]]+', ' ', 'g')))`;

/** 目标日 date 之前最近 N 个同星期几的单品需求统计（中位数/P85/逐时），按中文 product.name 键。 */
export async function getProductSalesStats(date: string): Promise<Map<string, ProductDemand>> {
  const dow = dayjs(date).day(); // 0=日..6=六
  const rows = await query<{ cn: string; d: string; hour: number; qty: number }>(
    `SELECT p.name AS cn, s.date::text AS d, s.hour AS hour, s.qty AS qty
       FROM item_hourly_sales s
       JOIN product p ON ${NORM("p.name_en")} = ${NORM("s.item_name")}
      WHERE EXTRACT(DOW FROM s.date) = $1 AND s.date < $2::date AND s.date >= $2::date - ${WINDOW_DAYS}`,
    [dow, date],
  );

  // cn -> date -> hour -> qty
  const byCn = new Map<string, Map<string, Map<number, number>>>();
  for (const r of rows) {
    let dm = byCn.get(r.cn);
    if (!dm) { dm = new Map(); byCn.set(r.cn, dm); }
    let hm = dm.get(r.d);
    if (!hm) { hm = new Map(); dm.set(r.d, hm); }
    hm.set(Number(r.hour), (hm.get(Number(r.hour)) || 0) + Number(r.qty));
  }

  const out = new Map<string, ProductDemand>();
  for (const [cn, dm] of byCn) {
    const dates = [...dm.keys()].sort().reverse().slice(0, N_TRAILING); // 最近 N 个同星期几
    if (!dates.length) continue;
    const totals = dates
      .map((d) => [...dm.get(d)!.values()].reduce((s, v) => s + v, 0))
      .sort((a, b) => a - b);
    const hourly: Record<number, number> = {};
    for (const d of dates) for (const [h, q] of dm.get(d)!) hourly[h] = (hourly[h] || 0) + q;
    for (const h of Object.keys(hourly)) hourly[Number(h)] = hourly[Number(h)] / dates.length;
    out.set(cn, {
      median: Math.round(percentile(totals, 50)),
      p85: Math.round(percentile(totals, 85)),
      n: dates.length,
      hourly,
    });
  }
  return out;
}
