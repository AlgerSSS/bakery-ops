import { query } from "@/modules/shared/db/postgres";
import dayjs from "dayjs";

export async function buildTransactionComparison(
  feedData: Record<string, unknown>,
  txRows30: { date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null }[]
): Promise<string> {
  const todayTxCount = (feedData.transactionCount as number) || null;
  const todayAvgTxValue = (feedData.avgTransactionValue as number) || null;
  const todayRevenue = (feedData.actualRevenue as number) || 0;
  const todayDow = dayjs(feedData.date as string).day();

  const isSameDayType = (dow: number) => {
    if (todayDow === 0 || todayDow === 6) return dow === 0 || dow === 6;
    if (todayDow === 5) return dow === 5;
    return dow >= 1 && dow <= 4;
  };
  const dayTypeLabel = (todayDow === 0 || todayDow === 6) ? "周末" : todayDow === 5 ? "周五" : "周中";

  const historyWithTx = txRows30.filter((r) => {
    if (r.transaction_count == null || r.date === feedData.date) return false;
    return isSameDayType(dayjs(r.date).day());
  });

  if (!todayTxCount || historyWithTx.length === 0) return "";

  const avgHistTxCount = historyWithTx.reduce((s, r) => s + (r.transaction_count || 0), 0) / historyWithTx.length;
  const avgHistAvgTxValue = historyWithTx.reduce((s, r) => s + (r.avg_transaction_value || 0), 0) / historyWithTx.length;
  const avgHistRevenue = historyWithTx.reduce((s, r) => s + r.revenue, 0) / historyWithTx.length;
  const txCountChange = avgHistTxCount > 0 ? ((todayTxCount - avgHistTxCount) / avgHistTxCount * 100).toFixed(1) : "N/A";
  const avgTxValueChange = avgHistAvgTxValue > 0 && todayAvgTxValue ? ((todayAvgTxValue - avgHistAvgTxValue) / avgHistAvgTxValue * 100).toFixed(1) : "N/A";
  const revenueChange = avgHistRevenue > 0 ? ((todayRevenue - avgHistRevenue) / avgHistRevenue * 100).toFixed(1) : "N/A";

  return `【今日客单指标 vs 历史${dayTypeLabel}均值（同日型对比）】
- 今日客单数: ${todayTxCount}，近期${historyWithTx.length}个${dayTypeLabel}均值: ${avgHistTxCount.toFixed(0)}，变化: ${txCountChange}%
- 今日客单价: ${todayAvgTxValue ?? "N/A"}，近期${dayTypeLabel}均值: ${avgHistAvgTxValue.toFixed(2)}，变化: ${avgTxValueChange}%
- 今日营业额: ${todayRevenue}，近期${dayTypeLabel}均值: ${avgHistRevenue.toFixed(0)}，变化: ${revenueChange}%
- 营业额拆解: ${todayRevenue} = ${todayTxCount}笔 × ${todayAvgTxValue ?? (todayTxCount > 0 ? (todayRevenue / todayTxCount).toFixed(2) : "N/A")}元/笔`;
}

export async function buildSameDayTypeComparison(
  feedData: Record<string, unknown>
): Promise<string> {
  const reviewDow = dayjs(feedData.date as string).day();
  let sameDayTypeLabel = "周中(周一至周四)";
  let sameDayTypeFilter = "EXTRACT(DOW FROM date::date) NOT IN (0, 5, 6)";
  if (reviewDow === 0 || reviewDow === 6) {
    sameDayTypeLabel = "周末";
    sameDayTypeFilter = "EXTRACT(DOW FROM date::date) IN (0, 6)";
  } else if (reviewDow === 5) {
    sameDayTypeLabel = "周五";
    sameDayTypeFilter = "EXTRACT(DOW FROM date::date) = 5";
  }

  const histStart = dayjs(feedData.date as string).subtract(60, "day").format("YYYY-MM-DD");
  const sameDayRows = await query<{ date: string; revenue: number }>(
    `SELECT date, revenue FROM daily_revenue WHERE date >= $1 AND date < $2 AND ${sameDayTypeFilter} ORDER BY date DESC LIMIT 8`,
    [histStart, feedData.date]
  );

  if (sameDayRows.length === 0) return "";

  const avgRevenue = sameDayRows.reduce((s, r) => s + r.revenue, 0) / sameDayRows.length;
  const todayRevenue = (feedData.actualRevenue as number) || 0;
  const diff = todayRevenue - avgRevenue;
  const diffPct = avgRevenue > 0 ? ((diff / avgRevenue) * 100).toFixed(1) : "N/A";

  return `【同类型日期（${sameDayTypeLabel}）营业额对比】
- 今日营业额: ${todayRevenue.toLocaleString()}
- 近期${sameDayRows.length}个${sameDayTypeLabel}均值: ${Math.round(avgRevenue).toLocaleString()}
- 偏差: ${diff > 0 ? "+" : ""}${Math.round(diff).toLocaleString()} (${diffPct}%)
- 历史明细: ${sameDayRows.map((r) => `${r.date}=${r.revenue.toLocaleString()}`).join(", ")}`;
}

export async function buildProductTrends(feedData: Record<string, unknown>): Promise<string> {
  const trendStart = dayjs(feedData.date as string).subtract(13, "day").format("YYYY-MM-DD");
  const topProducts = await query<{ standard_name: string }>(
    `SELECT standard_name FROM daily_sales_record
     WHERE date >= ? AND date <= ?
     GROUP BY standard_name
     ORDER BY SUM(quantity) DESC LIMIT 10`,
    [trendStart, feedData.date]
  );

  if (topProducts.length === 0) return "暂无产品趋势数据";

  const topNames = topProducts.map((p) => p.standard_name);
  const placeholders = topNames.map((_, i) => `$${i + 3}`).join(", ");
  const trendRows = await query<{ standard_name: string; day_of_week: number; avg_qty: number }>(
    `SELECT standard_name, day_of_week, AVG(quantity) AS avg_qty
     FROM daily_sales_record
     WHERE date >= $1 AND date <= $2 AND standard_name IN (${placeholders})
     GROUP BY standard_name, day_of_week
     ORDER BY standard_name, day_of_week`,
    [trendStart, feedData.date, ...topNames]
  );

  const trendMap = new Map<string, { monThu: number[]; fri: number[]; weekend: number[] }>();
  for (const row of trendRows) {
    if (!trendMap.has(row.standard_name)) {
      trendMap.set(row.standard_name, { monThu: [], fri: [], weekend: [] });
    }
    const entry = trendMap.get(row.standard_name)!;
    const dow = row.day_of_week;
    if (dow === 0 || dow === 6) entry.weekend.push(Number(row.avg_qty));
    else if (dow === 5) entry.fri.push(Number(row.avg_qty));
    else entry.monThu.push(Number(row.avg_qty));
  }

  const lines: string[] = [];
  for (const [name, data] of trendMap) {
    const avg = (arr: number[]) => arr.length > 0 ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : "N/A";
    lines.push(`${name}: 周中均值=${avg(data.monThu)}, 周五均值=${avg(data.fri)}, 周末均值=${avg(data.weekend)}`);
  }
  return lines.join("\n");
}

export function buildStockoutSummary(feedData: Record<string, unknown>): string {
  const stockoutRecords = feedData.stockoutRecords as { estimatedLossQty: number; estimatedLossAmount: number; productName: string; soldoutTime: string }[] | undefined;
  if (!stockoutRecords || stockoutRecords.length === 0) return "无断货记录";

  const lines = stockoutRecords
    .filter((r) => r.estimatedLossQty > 0)
    .sort((a, b) => b.estimatedLossAmount - a.estimatedLossAmount)
    .map((r) => `${r.productName}: 断货时间=${r.soldoutTime}, 损失数量=${r.estimatedLossQty}个, 损失金额=RM ${r.estimatedLossAmount}`);

  return lines.length > 0 ? lines.join("\n") : "断货记录已提交但无可计算的损失";
}
