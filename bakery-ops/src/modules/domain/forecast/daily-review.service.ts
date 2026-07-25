import { query } from "@/modules/shared/db/postgres";
import { buildPrompt } from "./prompt-engine";
import { generateJsonFromPrompt } from "./gemini-client";
import {
  buildTransactionComparison,
  buildSameDayTypeComparison,
  buildProductTrends,
  buildStockoutSummary,
} from "./context-builder";
import dayjs from "dayjs";

export async function generateDailyReview(
  feedData: Record<string, unknown>
): Promise<{ review: unknown; tomorrowSuggestions: unknown }> {
  const tomorrow = dayjs(feedData.date as string).add(1, "day").format("YYYY-MM-DD");
  const tomorrowDow = dayjs(tomorrow).day();
  let tomorrowDayType = "mondayToThursday";
  if (tomorrowDow === 0 || tomorrowDow === 6) tomorrowDayType = "weekend";
  else if (tomorrowDow === 5) tomorrowDayType = "friday";

  const tomorrowEvents = await query<{ event_tag: string; description: string }>(
    "SELECT event_tag, description FROM context_event WHERE date = ?",
    [tomorrow]
  );
  const tomorrowEventsStr = tomorrowEvents.length > 0
    ? tomorrowEvents.map((e) => `[${e.event_tag}] ${e.description}`).join("; ")
    : "无已录入事件";

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

  const txStart = dayjs(feedData.date as string).subtract(6, "day").format("YYYY-MM-DD");
  const txRows = await query<{ date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null }>(
    "SELECT date, revenue, transaction_count, avg_transaction_value FROM daily_revenue WHERE date >= $1 AND date <= $2 ORDER BY date",
    [txStart, feedData.date]
  );
  const transactionData = txRows.length > 0
    ? txRows.map((r) => `${r.date}: 营业额=${r.revenue}, 客单数=${r.transaction_count ?? "N/A"}, 客单价=${r.avg_transaction_value ?? "N/A"}`).join("\n")
    : "暂无客单数据";

  const txStart30 = dayjs(feedData.date as string).subtract(29, "day").format("YYYY-MM-DD");
  const txRows30 = await query<{ date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null }>(
    "SELECT date, revenue, transaction_count, avg_transaction_value FROM daily_revenue WHERE date >= $1 AND date < $2 ORDER BY date",
    [txStart30, feedData.date]
  );

  const transactionComparison = await buildTransactionComparison(feedData, txRows30);
  const sameDayTypeComparison = await buildSameDayTypeComparison(feedData);
  const productTrendData = await buildProductTrends(feedData);
  const stockoutSummary = buildStockoutSummary(feedData);

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
    weatherCondition: (feedData.weatherCondition as string) || "未填写",
    specialNotes: (feedData.specialNotes as string) || "无",
  };

  const built = await buildPrompt("daily_review", vars);
  const text = await generateJsonFromPrompt(built);

  let parsed: { review: unknown; tomorrowSuggestions: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`AI 返回格式解析失败: ${text}`);
  }

  if (!parsed.review || !parsed.tomorrowSuggestions) {
    throw new Error(`AI 返回结构不完整: ${text}`);
  }

  await query(
    `INSERT INTO daily_review (date, review_json, suggestions_json)
     VALUES ($1, $2, $3)
     ON CONFLICT (date) DO UPDATE SET review_json = EXCLUDED.review_json, suggestions_json = EXCLUDED.suggestions_json, adopted = false`,
    [feedData.date, JSON.stringify(parsed.review), JSON.stringify(parsed.tomorrowSuggestions)]
  );

  return { review: parsed.review, tomorrowSuggestions: parsed.tomorrowSuggestions };
}
