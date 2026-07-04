// morning-brief.service.ts — 今日复盘自动推送（IMPROVEMENT-PLAN.md F1；原每日早报改造）。
//
// 23:30 (Asia/Kuala_Lumpur) cron：23:00 数据刷新后推送当天复盘。口径=应收(gross_sales)。
// 主：完整 AI 复盘（复用 daily-review-chat 的 generateDailyReviewText）；
// AI 失败时回落固定中文模板（营业额/单数/客单价/折扣率 + 上周同日 + Top5 单品 + 报废）。
// 收件人：config/team.json 里订阅 daily_review 的成员（名字→Lark open_id，直发卡片）。
// 幂等：daily_push_log (kind='morning_brief', recipient=open_id, date)，发送成功才写。
// 当天 daily_revenue 无行时静默跳过（logger.info），交给 freshness-check 报警。

import { query } from "@/modules/shared/db/postgres";
import { logger } from "@/modules/shared/logger";
import { sendLarkToUser } from "@/modules/channel/lark/lark-messenger";
import { teamRepository } from "@/modules/data/repositories/team.repository";
import { localDate } from "@/modules/channel/whatsapp/outbound.config";
import { generateDailyReviewText } from "@/modules/skills/daily-review-chat/daily-review-chat.definition";
import { hasPushLog, recordPushLog } from "./push-log";

const WASTE_ALERT_THRESHOLD = 0.03; // 报废率警戒线 3%

const REASON_LABELS: Record<string, string> = {
  scheduling: "排产报废",
  tasting: "试吃报废",
  production: "生产报废",
};

export interface MorningBriefData {
  date: string;
  revenue: number;
  transactionCount: number;
  avgTransactionValue: number;
  discountRate: number; // 0-1
  lastWeek: { date: string; revenue: number; transactionCount: number; avgTransactionValue: number } | null;
  topItems: Array<{ itemName: string; qty: number; sales: number }>;
  waste: {
    totalAmount: number;
    wasteRate: number; // 0-1，金额/营业额
    topItems: Array<{ itemName: string; reason: string; qty: number; amount: number }>;
  } | null;
}

/** 固定中文模板（纯函数，单测覆盖阈值/对比分支）。 */
export function buildMorningBriefText(data: MorningBriefData): string {
  const lines: string[] = [];
  lines.push(`📊 *今日复盘* ${data.date}`);
  lines.push(
    `营业额: RM${data.revenue} | 单数: ${data.transactionCount} | 客单价: RM${data.avgTransactionValue}`,
  );
  lines.push(`折扣率: ${(data.discountRate * 100).toFixed(1)}%`);

  if (data.lastWeek) {
    const lw = data.lastWeek;
    const revDiff = lw.revenue > 0 ? (((data.revenue - lw.revenue) / lw.revenue) * 100).toFixed(1) : null;
    const diffStr = revDiff === null ? "" : ` (${Number(revDiff) > 0 ? "+" : ""}${revDiff}%)`;
    lines.push(`vs 上周同日(${lw.date}): RM${lw.revenue}${diffStr}, ${lw.transactionCount}单, 客单价RM${lw.avgTransactionValue}`);
  }

  if (data.topItems.length) {
    lines.push("");
    lines.push(`🏆 昨日单品TOP${data.topItems.length}`);
    data.topItems.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.itemName}: ${item.qty}个, RM${item.sales.toFixed(0)}`);
    });
  }

  lines.push("");
  lines.push(`🗑️ 报废`);
  if (data.waste && data.waste.totalAmount > 0) {
    const w = data.waste;
    const alert = w.wasteRate > WASTE_ALERT_THRESHOLD ? "⚠️ " : "";
    lines.push(`${alert}金额: RM${w.totalAmount.toFixed(0)} | 报废率: ${(w.wasteRate * 100).toFixed(1)}% (警戒线 ${(WASTE_ALERT_THRESHOLD * 100).toFixed(0)}%)`);
    w.topItems.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.itemName}（${REASON_LABELS[item.reason] || item.reason}）: ${item.qty}个, RM${item.amount.toFixed(0)}`);
    });
  } else {
    lines.push(`昨日无报废记录`);
  }

  return lines.join("\n");
}

/** 取数（SQL 参照 daily-review-chat getSalesData）。昨日无 daily_revenue 时返回 null。 */
async function fetchBriefData(date: string): Promise<MorningBriefData | null> {
  const revenue = await query<any>("SELECT * FROM daily_revenue WHERE date = $1", [date]);
  if (!revenue.length) return null;
  const r = revenue[0];

  // 上周同天对比
  const lastWeekDate = new Date(date);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lwStr = `${lastWeekDate.getFullYear()}-${String(lastWeekDate.getMonth() + 1).padStart(2, "0")}-${String(lastWeekDate.getDate()).padStart(2, "0")}`;
  const lastWeekRows = await query<any>("SELECT * FROM daily_revenue WHERE date = $1", [lwStr]);

  // 口径=应收(gross_sales，折扣前)，与复盘一致；客单价按 应收÷客单数 算。
  const topItems = await query<any>(
    "SELECT item_name, SUM(qty) as total_qty, SUM(gross_sales) as total_sales FROM item_hourly_sales WHERE date = $1 GROUP BY item_name ORDER BY total_sales DESC LIMIT 5",
    [date],
  );

  const wasteTotalRows = await query<any>("SELECT SUM(amount) as total_amount FROM item_waste WHERE date = $1", [date]);
  const wasteTop = await query<any>(
    "SELECT item_name, waste_reason, qty, amount FROM item_waste WHERE date = $1 ORDER BY amount DESC LIMIT 3",
    [date],
  );

  const wasteTotal = Number(wasteTotalRows[0]?.total_amount || 0);
  const revenueNum = Number(r.gross_sales) || 0;
  const cnt = Number(r.transaction_count) || 0;

  return {
    date,
    revenue: revenueNum,
    transactionCount: cnt,
    avgTransactionValue: cnt > 0 ? Math.round((revenueNum / cnt) * 10) / 10 : 0,
    discountRate: Number(r.discount_rate) || 0,
    lastWeek: lastWeekRows.length
      ? (() => {
          const lwGross = Number(lastWeekRows[0].gross_sales) || 0;
          const lwCnt = Number(lastWeekRows[0].transaction_count) || 0;
          return {
            date: lwStr,
            revenue: lwGross,
            transactionCount: lwCnt,
            avgTransactionValue: lwCnt > 0 ? Math.round((lwGross / lwCnt) * 10) / 10 : 0,
          };
        })()
      : null,
    topItems: topItems.map((item: any) => ({
      itemName: String(item.item_name),
      qty: Number(item.total_qty) || 0,
      sales: Number(item.total_sales) || 0,
    })),
    waste:
      wasteTotal > 0
        ? {
            totalAmount: wasteTotal,
            wasteRate: revenueNum > 0 ? wasteTotal / revenueNum : 0,
            topItems: wasteTop.map((w: any) => ({
              itemName: String(w.item_name),
              reason: String(w.waste_reason),
              qty: Number(w.qty) || 0,
              amount: Number(w.amount) || 0,
            })),
          }
        : null,
  };
}

/** 入口 — bootstrap cron '30 23 * * *'（23:00 数据刷新后推当天复盘）。无数据/未连接时安全 no-op。 */
export async function runMorningBrief(): Promise<void> {
  const today = localDate();

  let data: MorningBriefData | null;
  try {
    data = await fetchBriefData(today);
  } catch (err) {
    logger.error("Today review: data fetch failed", { date: today, error: String(err) });
    return;
  }
  if (!data) {
    logger.info("Today review: no daily_revenue for date, skipping (freshness-check will alert)", { date: today });
    return;
  }

  // 主：完整 AI 复盘（应收口径）；失败回落固定模板，保证复盘每天必到。
  let text: string;
  try {
    const review = await generateDailyReviewText(today);
    if (!review || !review.trim()) throw new Error("empty review");
    text = `📊 **今日复盘** ${today}\n\n${review}`;
  } catch (err) {
    logger.error("Today review: AI review failed, falling back to template", { date: today, error: String(err) });
    text = buildMorningBriefText(data);
  }

  // 收件人 = team_member 表里订阅 daily_review 的在职成员（open_id 直发卡片）。
  const openIds = await teamRepository.getSubscriberOpenIds("daily_review");
  if (openIds.length === 0) {
    logger.error("Today review: 无有效收件人(team_member 无 daily_review 订阅者)");
    return;
  }

  for (const openId of openIds) {
    try {
      if (await hasPushLog("morning_brief", openId, today)) {
        logger.info("Today review: already sent, skipping", { openId, date: today });
        continue;
      }
      const sent = await sendLarkToUser(openId, text);
      if (sent) {
        await recordPushLog("morning_brief", openId, today);
        logger.info("Today review: sent", { openId, date: today });
      } else {
        logger.error("Today review: send failed", { openId });
      }
    } catch (err) {
      logger.error("Today review: recipient failed", { openId, error: String(err) });
    }
  }
}
