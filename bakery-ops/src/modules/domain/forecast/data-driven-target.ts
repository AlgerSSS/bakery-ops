// data-driven-target.ts — 应收(gross)口径的数据驱动目标（新预测法）。
//
// 需求(排产用) = trailing-8 同星期 gross 中位数；经营目标(KPI/达成率分母) = trailing-8 同星期 gross P85。
// 权威 gross = COALESCE(daily_revenue.gross_sales, SUM(hourly_sales_summary.gross_sales))，
// 剔除 <20000 的残缺日（如某天只抓到 2 小时）。历史不足 MIN_SAMPLES 时返回 null（调用方回落 legacy 预算法）。
// 由 FORECAST_MODE=new 启用；默认 legacy。backtest(应收,127 天)验证：中位数偏差 −2.4%(近校准，偏保守少报废)，
// 旧预算周末过预测 +21.5%；P85 作为“够得着的顶部目标”，达标率约 25%。
import dayjs from "dayjs";
import { query } from "@/modules/shared/db/postgres";

const N_TRAILING = 8;      // 回看最近 8 个同星期日
const MIN_SAMPLES = 6;     // 少于 6 个同星期样本则回落 legacy
const PARTIAL_DAY_FLOOR = 20000; // 应收低于此判为残缺日，剔除

/** 线性插值分位数；sortedAsc 必须升序且非空。 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

export interface DataDrivenTarget {
  medianDemand: number; // 需求（排产用）
  p85Target: number;    // 经营目标（KPI / 达成率分母）
  n: number;            // 实际样本数
}

/**
 * 取 date 之前最近 N_TRAILING 个同星期日的应收(gross)，算中位数(需求)与 P85(目标)。
 * `h.d < $2::date` 严格早于目标日 → 无数据泄漏。历史不足 MIN_SAMPLES 返回 null。
 */
export async function computeDataDrivenTarget(date: string): Promise<DataDrivenTarget | null> {
  const dow = dayjs(date).day(); // 0=日 .. 6=六
  const rows = await query<{ gross: number }>(
    `SELECT COALESCE(dr.gross_sales, h.hg)::float AS gross
       FROM (SELECT date::date d, SUM(gross_sales) hg
               FROM hourly_sales_summary GROUP BY 1 HAVING SUM(gross_sales) > ${PARTIAL_DAY_FLOOR}) h
       LEFT JOIN daily_revenue dr ON dr.date::date = h.d AND dr.gross_sales IS NOT NULL
      WHERE EXTRACT(DOW FROM h.d) = $1 AND h.d < $2::date
      ORDER BY h.d DESC
      LIMIT ${N_TRAILING}`,
    [dow, date],
  );
  if (rows.length < MIN_SAMPLES) return null;
  const gross = rows.map((r) => Number(r.gross)).sort((a, b) => a - b);
  return {
    medianDemand: Math.round(percentile(gross, 50)),
    p85Target: Math.round(percentile(gross, 85)),
    n: gross.length,
  };
}
