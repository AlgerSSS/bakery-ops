import { NextRequest, NextResponse } from "next/server";
import { query } from "@/modules/shared/db/postgres";
import { buildPrompt } from "@/modules/domain/forecast/prompt-engine";
import { generateJsonFromPrompt } from "@/modules/domain/forecast/gemini-client";
import dayjs from "dayjs";


export async function POST(req: NextRequest) {
  try {
    const { feedData } = await req.json();
    if (!feedData || !feedData.date) {
      return NextResponse.json({ error: "缺少 feedData 参数" }, { status: 400 });
    }

    // 获取明日信息
    const tomorrow = dayjs(feedData.date).add(1, "day").format("YYYY-MM-DD");
    const tomorrowDow = dayjs(tomorrow).day();
    let tomorrowDayType = "mondayToThursday";
    if (tomorrowDow === 0 || tomorrowDow === 6) tomorrowDayType = "weekend";
    else if (tomorrowDow === 5) tomorrowDayType = "friday";

    // 读取明日事件
    const tomorrowEvents = await query<{ event_tag: string; description: string }>(
      "SELECT event_tag, description FROM context_event WHERE date = ?",
      [tomorrow]
    );

    const tomorrowEventsStr = tomorrowEvents.length > 0
      ? tomorrowEvents.map((e) => `[${e.event_tag}] ${e.description}`).join("; ")
      : "无已录入事件";

    // 读取今日和明日的节日信息
    const holidays = await query<{ date: string; name: string; type: string; note: string }>(
      "SELECT date, name, type, note FROM holiday WHERE date IN (?, ?) ORDER BY date",
      [feedData.date, tomorrow]
    );
    const todayHoliday = holidays.filter((h) => h.date === feedData.date);
    const tomorrowHoliday = holidays.filter((h) => h.date === tomorrow);
    const todayHolidayStr = todayHoliday.length > 0
      ? todayHoliday.map((h) => `[${h.type}] ${h.name}${h.note ? `（${h.note}）` : ""}`).join("; ")
      : "无";
    const tomorrowHolidayStr = tomorrowHoliday.length > 0
      ? tomorrowHoliday.map((h) => `[${h.type}] ${h.name}${h.note ? `（${h.note}）` : ""}`).join("; ")
      : "无";

    // 查询近7天客单数据（用于展示趋势）
    const txStart = dayjs(feedData.date).subtract(6, "day").format("YYYY-MM-DD");
    const txRows = await query<{ date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null }>(
      "SELECT date, revenue, transaction_count, avg_transaction_value FROM daily_revenue WHERE date >= $1 AND date <= $2 ORDER BY date",
      [txStart, feedData.date]
    );
    const transactionData = txRows.length > 0
      ? txRows.map((r) => `${r.date}: 营业额=${r.revenue}, 客单数=${r.transaction_count ?? "N/A"}, 客单价=${r.avg_transaction_value ?? "N/A"}`).join("\n")
      : "暂无客单数据";

    // 查询近30天客单数据（用于同日型对比，保证足够样本量）
    const txStart30 = dayjs(feedData.date).subtract(29, "day").format("YYYY-MM-DD");
    const txRows30 = await query<{ date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null }>(
      "SELECT date, revenue, transaction_count, avg_transaction_value FROM daily_revenue WHERE date >= $1 AND date < $2 ORDER BY date",
      [txStart30, feedData.date]
    );

    // 构建今日 vs 历史对比（按日型分类，周末只与周末比，周五只与周五比，周中只与周中比）
    const todayTxCount = feedData.transactionCount || null;
    const todayAvgTxValue = feedData.avgTransactionValue || null;
    const todayRevenue = feedData.actualRevenue || 0;
    const todayDow = dayjs(feedData.date).day();
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
    let transactionComparison = "";
    if (todayTxCount && historyWithTx.length > 0) {
      const avgHistTxCount = historyWithTx.reduce((s, r) => s + (r.transaction_count || 0), 0) / historyWithTx.length;
      const avgHistAvgTxValue = historyWithTx.reduce((s, r) => s + (r.avg_transaction_value || 0), 0) / historyWithTx.length;
      const avgHistRevenue = historyWithTx.reduce((s, r) => s + r.revenue, 0) / historyWithTx.length;
      const txCountChange = avgHistTxCount > 0 ? ((todayTxCount - avgHistTxCount) / avgHistTxCount * 100).toFixed(1) : "N/A";
      const avgTxValueChange = avgHistAvgTxValue > 0 && todayAvgTxValue ? ((todayAvgTxValue - avgHistAvgTxValue) / avgHistAvgTxValue * 100).toFixed(1) : "N/A";
      const revenueChange = avgHistRevenue > 0 ? ((todayRevenue - avgHistRevenue) / avgHistRevenue * 100).toFixed(1) : "N/A";
      transactionComparison = `【今日客单指标 vs 历史${dayTypeLabel}均值（同日型对比）】
- 今日客单数: ${todayTxCount}，近期${historyWithTx.length}个${dayTypeLabel}均值: ${avgHistTxCount.toFixed(0)}，变化: ${txCountChange}%
- 今日客单价: ${todayAvgTxValue ?? "N/A"}，近期${dayTypeLabel}均值: ${avgHistAvgTxValue.toFixed(2)}，变化: ${avgTxValueChange}%
- 今日营业额: ${todayRevenue}，近期${dayTypeLabel}均值: ${avgHistRevenue.toFixed(0)}，变化: ${revenueChange}%
- 营业额拆解: ${todayRevenue} = ${todayTxCount}笔 × ${todayAvgTxValue ?? (todayTxCount > 0 ? (todayRevenue / todayTxCount).toFixed(2) : "N/A")}元/笔`;
    }

    // 查询TOP产品近14天销售趋势（按日型分组计算均值）
    const trendStart = dayjs(feedData.date).subtract(13, "day").format("YYYY-MM-DD");
    const topProducts = await query<{ standard_name: string }>(
      `SELECT standard_name FROM daily_sales_record
       WHERE date >= ? AND date <= ?
       GROUP BY standard_name
       ORDER BY SUM(quantity) DESC LIMIT 10`,
      [trendStart, feedData.date]
    );
    let productTrendData = "暂无产品趋势数据";
    if (topProducts.length > 0) {
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
      // Group by product, then by day type
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
      productTrendData = lines.join("\n");
    }

    // 需求2: 查询同类型日期历史营业额对比
    const reviewDow = dayjs(feedData.date).day();
    let sameDayTypeLabel = "周中(周一至周四)";
    let sameDayTypeFilter = "EXTRACT(DOW FROM date::date) NOT IN (0, 5, 6)";
    if (reviewDow === 0 || reviewDow === 6) {
      sameDayTypeLabel = "周末";
      sameDayTypeFilter = "EXTRACT(DOW FROM date::date) IN (0, 6)";
    } else if (reviewDow === 5) {
      sameDayTypeLabel = "周五";
      sameDayTypeFilter = "EXTRACT(DOW FROM date::date) = 5";
    }
    const histStart = dayjs(feedData.date).subtract(60, "day").format("YYYY-MM-DD");
    const sameDayRows = await query<{ date: string; revenue: number }>(
      `SELECT date, revenue FROM daily_revenue WHERE date >= $1 AND date < $2 AND ${sameDayTypeFilter} ORDER BY date DESC LIMIT 8`,
      [histStart, feedData.date]
    );
    let sameDayTypeComparison = "";
    if (sameDayRows.length > 0) {
      const avgRevenue = sameDayRows.reduce((s, r) => s + r.revenue, 0) / sameDayRows.length;
      const todayRevenue = feedData.actualRevenue || 0;
      const diff = todayRevenue - avgRevenue;
      const diffPct = avgRevenue > 0 ? ((diff / avgRevenue) * 100).toFixed(1) : "N/A";
      sameDayTypeComparison = `【同类型日期（${sameDayTypeLabel}）营业额对比】
- 今日营业额: ${todayRevenue.toLocaleString()}
- 近期${sameDayRows.length}个${sameDayTypeLabel}均值: ${Math.round(avgRevenue).toLocaleString()}
- 偏差: ${diff > 0 ? "+" : ""}${Math.round(diff).toLocaleString()} (${diffPct}%)
- 历史明细: ${sameDayRows.map((r) => `${r.date}=${r.revenue.toLocaleString()}`).join(", ")}`;
    }

    // 构建断货损失摘要（基于真实产品价格计算，AI必须直接引用这些数据）
    let stockoutSummary = "无断货记录";
    if (feedData.stockoutRecords && feedData.stockoutRecords.length > 0) {
      const lines = feedData.stockoutRecords
        .filter((r: { estimatedLossQty: number }) => r.estimatedLossQty > 0)
        .sort((a: { estimatedLossAmount: number }, b: { estimatedLossAmount: number }) => b.estimatedLossAmount - a.estimatedLossAmount)
        .map((r: { productName: string; soldoutTime: string; estimatedLossQty: number; estimatedLossAmount: number }) =>
          `${r.productName}: 断货时间=${r.soldoutTime}, 损失数量=${r.estimatedLossQty}个, 损失金额=RM ${r.estimatedLossAmount}`
        );
      stockoutSummary = lines.length > 0 ? lines.join("\n") : "断货记录已提交但无可计算的损失";
    }

    // 构建prompt
    const dayTypeLabels: Record<string, string> = {
      mondayToThursday: "周中(周一至周四)",
      friday: "周五",
      weekend: "周末",
    };

    const vars: Record<string, string> = {
      feedData: JSON.stringify(feedData, null, 2) + "\n\n" + `【断货损失明细（已基于真实产品单价计算，请直接引用以下数据，不要自行估算价格）】\n${stockoutSummary}`,
      tomorrowDate: tomorrow,
      tomorrowDayType: dayTypeLabels[tomorrowDayType] || tomorrowDayType,
      eventsInfo: tomorrowEventsStr,
      todayHoliday: todayHolidayStr,
      tomorrowHoliday: tomorrowHolidayStr,
      transactionData,
      productTrendData,
      transactionComparison: transactionComparison || "无客单对比数据",
      sameDayTypeComparison: sameDayTypeComparison || "无同类型日期对比数据",
      weatherCondition: feedData.weatherCondition || "未填写",
      specialNotes: feedData.specialNotes || "无",
    };
    const built = await buildPrompt("daily_review", vars);

    const text = await generateJsonFromPrompt(built);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "AI 返回格式解析失败", rawText: text }, { status: 500 });
    }

    if (!parsed.review || !parsed.tomorrowSuggestions) {
      return NextResponse.json({ error: "AI 返回结构不完整", rawText: text }, { status: 500 });
    }

    // 保存到数据库
    await query(
      `INSERT INTO daily_review (date, review_json, suggestions_json)
       VALUES ($1, $2, $3)
       ON CONFLICT (date) DO UPDATE SET review_json = EXCLUDED.review_json, suggestions_json = EXCLUDED.suggestions_json, adopted = false`,
      [feedData.date, JSON.stringify(parsed.review), JSON.stringify(parsed.tomorrowSuggestions)]
    );

    return NextResponse.json({
      review: parsed.review,
      tomorrowSuggestions: parsed.tomorrowSuggestions,
    });
  } catch (error) {
    console.error("Daily review error:", error);
    return NextResponse.json(
      { error: `AI 调用失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
