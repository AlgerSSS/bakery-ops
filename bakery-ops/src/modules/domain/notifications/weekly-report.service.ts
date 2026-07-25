// weekly-report.service.ts — 周一经营周报（IMPROVEMENT-PLAN.md F3）。
//
// 周一 (Asia/Kuala_Lumpur) cron：上周(周一至周日) vs 上上周纯 SQL 聚合——
// 营业额/单数/客单价环比、最好与最差的一天、会员占比均值及趋势箭头、
// 折扣率、报废合计 (item_waste)，外加 manager_review 复盘要点回顾（B7，不调 LightRAG）。
// 末尾附【清货建议】：sell-through 折扣候选 Top 3（G5-1，无候选整节省略）。
// 推老板 (OWNER_WHATSAPP) + 店长 (users 表 role=store_manager)。
// 固定中文模板，不调 AI。结构参照 morning-brief.service.ts。
// 幂等：daily_push_log (kind='weekly_report', recipient, date=上周一)，发送成功才写。
// 上周无 daily_revenue 行时静默跳过（logger.info）。

import { query } from "@/modules/shared/db/postgres";
import { logger } from "@/modules/shared/logger";
import { notifyInternal } from "@/modules/channel/internal-notify";
import { userRepository } from "@/modules/data/repositories/user.repository";
import { localDate } from "@/modules/channel/whatsapp/outbound.config";
import { findDiscountCandidates, type DiscountCandidate } from "@/modules/domain/forecast/sell-through";
import { hasPushLog, recordPushLog } from "./push-log";

export interface WeeklyAgg {
  revenue: number;
  transactionCount: number;
  avgTransactionValue: number; // SUM(revenue)/SUM(transaction_count)
  memberSalesRatio: number; // 0-1，AVG(member_sales_ratio)
  discountRate: number; // 0-1，AVG(discount_rate)
}

export interface WeeklyReportData {
  weekStart: string; // 上周一
  weekEnd: string; // 上周日
  current: WeeklyAgg;
  previous: WeeklyAgg | null; // 上上周，无数据时 null
  bestDay: { date: string; revenue: number } | null;
  worstDay: { date: string; revenue: number } | null;
  wasteTotal: number;
  reviews: Array<{ date: string; insight: string }>;
  discountCandidates: DiscountCandidate[]; // 清货建议候选（G5-1），空则整节省略
}

/** 以 today (YYYY-MM-DD) 所在周为基准，返回上周与上上周的周一/周日（纯函数，单测覆盖）。 */
export function getWeekRanges(today: string): {
  weekStart: string;
  weekEnd: string;
  prevStart: string;
  prevEnd: string;
} {
  const base = new Date(`${today}T00:00:00Z`);
  const day = base.getUTCDay(); // 0=Sun..6=Sat
  const offsetToMonday = day === 0 ? 6 : day - 1;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (days: number) => new Date(base.getTime() + days * 86400000);
  return {
    weekStart: fmt(shift(-offsetToMonday - 7)),
    weekEnd: fmt(shift(-offsetToMonday - 1)),
    prevStart: fmt(shift(-offsetToMonday - 14)),
    prevEnd: fmt(shift(-offsetToMonday - 8)),
  };
}

/** 环比百分比字符串，如 " (+5.2%)"；上期为 0 时返回空串。 */
function pctDiff(current: number, previous: number | undefined): string {
  if (!previous || previous <= 0) return "";
  const pct = (((current - previous) / previous) * 100).toFixed(1);
  return ` (${Number(pct) > 0 ? "+" : ""}${pct}%)`;
}

/** 会员占比趋势箭头：与上上周均值比较。 */
function trendArrow(current: number, previous: number | undefined): string {
  if (previous === undefined) return "";
  if (current > previous) return " ↑";
  if (current < previous) return " ↓";
  return " →";
}

/** 固定中文模板（纯函数，单测覆盖环比/箭头/复盘分支）。 */
export function buildWeeklyReportText(data: WeeklyReportData): string {
  const c = data.current;
  const p = data.previous;
  const lines: string[] = [];
  lines.push(`📈 *每周经营周报* ${data.weekStart} ~ ${data.weekEnd}`);
  lines.push(
    `营业额: RM${c.revenue.toFixed(0)}${pctDiff(c.revenue, p?.revenue)} | 单数: ${c.transactionCount}${pctDiff(c.transactionCount, p?.transactionCount)}`,
  );
  lines.push(`客单价: RM${c.avgTransactionValue.toFixed(2)}${pctDiff(c.avgTransactionValue, p?.avgTransactionValue)}`);
  lines.push(
    `会员占比: ${(c.memberSalesRatio * 100).toFixed(1)}%${trendArrow(c.memberSalesRatio, p?.memberSalesRatio)}${p ? ` (上上周 ${(p.memberSalesRatio * 100).toFixed(1)}%)` : ""}`,
  );
  lines.push(`折扣率: ${(c.discountRate * 100).toFixed(1)}%`);

  if (data.bestDay && data.worstDay) {
    lines.push(`最好: ${data.bestDay.date} RM${data.bestDay.revenue.toFixed(0)} | 最差: ${data.worstDay.date} RM${data.worstDay.revenue.toFixed(0)}`);
  }

  lines.push("");
  lines.push(`🗑️ 报废合计: ${data.wasteTotal > 0 ? `RM${data.wasteTotal.toFixed(0)}` : "无记录"}`);

  lines.push("");
  lines.push(`📝 复盘要点回顾`);
  if (data.reviews.length) {
    for (const r of data.reviews) {
      lines.push(`- ${r.date}: ${r.insight}`);
    }
  } else {
    lines.push(`上周无复盘要点记录`);
  }

  if (data.discountCandidates.length) {
    lines.push("");
    lines.push(`🏷️ 【清货建议】`);
    for (const c of data.discountCandidates.slice(0, 3)) {
      lines.push(`- ${c.advice}`);
    }
  }

  return lines.join("\n");
}

/** 一周聚合（纯 SQL）。无行时返回 null。 */
async function fetchWeekAgg(start: string, end: string): Promise<WeeklyAgg | null> {
  const rows = await query<any>(
    `SELECT SUM(revenue) as revenue,
            SUM(transaction_count) as transaction_count,
            AVG(member_sales_ratio) as member_sales_ratio,
            AVG(discount_rate) as discount_rate,
            COUNT(*) as day_count
     FROM daily_revenue WHERE date >= $1 AND date <= $2`,
    [start, end],
  );
  if (!rows.length || !Number(rows[0].day_count)) return null;
  const r = rows[0];
  const revenue = Number(r.revenue) || 0;
  const txCount = Number(r.transaction_count) || 0;
  return {
    revenue,
    transactionCount: txCount,
    avgTransactionValue: txCount > 0 ? revenue / txCount : 0,
    memberSalesRatio: Number(r.member_sales_ratio) || 0,
    discountRate: Number(r.discount_rate) || 0,
  };
}

/** 取数：上周聚合 + 上上周聚合 + 最好/最差 + 报废合计 + 复盘要点。上周无数据时返回 null。 */
async function fetchWeeklyData(today: string): Promise<WeeklyReportData | null> {
  const { weekStart, weekEnd, prevStart, prevEnd } = getWeekRanges(today);

  const current = await fetchWeekAgg(weekStart, weekEnd);
  if (!current) return null;
  const previous = await fetchWeekAgg(prevStart, prevEnd);

  const bestRows = await query<any>(
    "SELECT date, revenue FROM daily_revenue WHERE date >= $1 AND date <= $2 ORDER BY revenue DESC LIMIT 1",
    [weekStart, weekEnd],
  );
  const worstRows = await query<any>(
    "SELECT date, revenue FROM daily_revenue WHERE date >= $1 AND date <= $2 ORDER BY revenue ASC LIMIT 1",
    [weekStart, weekEnd],
  );

  const wasteRows = await query<any>(
    "SELECT SUM(amount) as total_amount FROM item_waste WHERE date >= $1 AND date <= $2",
    [weekStart, weekEnd],
  );

  const reviewRows = await query<any>(
    "SELECT date, insight FROM manager_review WHERE date >= $1 AND date <= $2 AND insight IS NOT NULL ORDER BY date",
    [weekStart, weekEnd],
  );

  // 清货建议：近 7 个完整天（周一执行时正好是上周一至周日）。失败不影响周报主体。
  let discountCandidates: DiscountCandidate[] = [];
  try {
    discountCandidates = await findDiscountCandidates(7, today);
  } catch (err) {
    logger.warn("Weekly report: discount candidates failed, omitting section", { error: String(err) });
  }

  return {
    weekStart,
    weekEnd,
    current,
    previous,
    bestDay: bestRows.length ? { date: String(bestRows[0].date), revenue: Number(bestRows[0].revenue) || 0 } : null,
    worstDay: worstRows.length ? { date: String(worstRows[0].date), revenue: Number(worstRows[0].revenue) || 0 } : null,
    wasteTotal: Number(wasteRows[0]?.total_amount || 0),
    reviews: reviewRows.map((r: any) => ({ date: String(r.date), insight: String(r.insight) })),
    discountCandidates,
  };
}

/** 收件人：老板 (OWNER_WHATSAPP) + 所有在职店长（与 morning-brief 一致）。 */
async function resolveRecipients(): Promise<string[]> {
  const recipients = new Set<string>();
  const owner = process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE || "";
  if (owner) recipients.add(owner);
  const users = await userRepository.getAll();
  for (const u of users) {
    if (u.role === "store_manager" && u.phone) recipients.add(u.phone);
  }
  return Array.from(recipients);
}

/** 入口 — 接线 agent 挂周一 cron。无数据/未连接时安全 no-op。幂等 date=上周一。 */
export async function runWeeklyReport(): Promise<void> {
  const today = localDate();

  let data: WeeklyReportData | null;
  try {
    data = await fetchWeeklyData(today);
  } catch (err) {
    logger.error("Weekly report: data fetch failed", { today, error: String(err) });
    return;
  }
  if (!data) {
    logger.info("Weekly report: no daily_revenue for last week, skipping", { today });
    return;
  }

  const text = buildWeeklyReportText(data);
  const recipients = await resolveRecipients();

  for (const recipient of recipients) {
    try {
      if (await hasPushLog("weekly_report", recipient, data.weekStart)) {
        logger.info("Weekly report: already sent, skipping", { recipient, date: data.weekStart });
        continue;
      }
      const sent = await notifyInternal(recipient, text);
      if (sent) {
        await recordPushLog("weekly_report", recipient, data.weekStart);
        logger.info("Weekly report: sent", { recipient, date: data.weekStart });
      } else {
        logger.error("Weekly report: send failed", { recipient });
      }
    } catch (err) {
      logger.error("Weekly report: recipient failed", { recipient, error: String(err) });
    }
  }
}
