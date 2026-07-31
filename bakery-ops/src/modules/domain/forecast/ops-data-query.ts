// ops-data-query.ts
//
// 经营数据问答共享模块（IMPROVEMENT-PLAN.md F9 经营问答）：
// 从 daily-review-chat 的 queryDataForQuestion 抽出，供复盘追问与 knowledge_query
// 经营类分支共用。LLM 判意图 → 查 item_hourly_sales / hourly_sales_summary / daily_revenue。
// 意图分类是纯小任务，走 AI_SMALL_MODEL（未设时回落 provider 默认）— G3c。

import { aiProvider } from "@/modules/domain/ai/ai-provider";
import { query } from "@/modules/shared/db/postgres";
import { NORM_SQL } from "./beverage-caliber";

/**
 * 店长问的是中文（「蛋挞今天卖了多少」），item_hourly_sales.item_name 从 2026-07 起是英文 POS 名。
 * 直接 ILIKE '%蛋挞%' 恒 0 行，而且返回的是「未找到数据」而不是报错——看起来像那天真没卖。
 *
 * 两座桥都要走，缺一不可：
 *   · pos_product（en→cn；迁移 067 后 item_alias 并入，中文名取人工覆盖值优先）覆盖全部在售品，**且覆盖饮品**
 *   · product（name↔name_en，54 行）只有排产用的烘焙品，查「拿铁」是 0 条
 * 同时保留对 item_name 本身的匹配，这样店长直接输英文也能查到。
 */
const ITEM_NAME_MATCH = (dollarWord: string) => `(
     s.item_name ILIKE ${dollarWord}
  OR ${NORM_SQL("s.item_name")} IN (
       SELECT ${NORM_SQL("a.name_en")} FROM pos_product a
        WHERE COALESCE(a.name_zh_display, a.name_zh) ILIKE ${dollarWord}
       UNION
       SELECT ${NORM_SQL("p.name_en")} FROM product p
        WHERE p.name ILIKE ${dollarWord} AND p.name_en IS NOT NULL
     )
)`;

export async function queryDataForQuestion(question: string, date: string): Promise<string> {
  // LLM 判断用户问的是什么数据，生成对应查询
  const intentPrompt = `用户在复盘对话中追问了一个问题。判断他需要什么数据，返回JSON。

用户问题: "${question}"
当前复盘日期: ${date}

返回格式:
{"type": "hourly_detail" | "item_detail" | "compare_days" | "item_by_hour" | "general", "item_name": "如果问具体产品", "hour": "如果问具体时段", "compare_date": "如果要对比某天"}

只返回JSON，不要其他文字。`;

  let intent: any = { type: "general" };
  try {
    const raw = await aiProvider.chatCompletion(intentPrompt, 200, process.env.AI_SMALL_MODEL || undefined);
    intent = JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
  } catch { /* fallback to general */ }

  // 口径与复盘一致：营业额/单品金额用应收(gross_sales)，客单价按 应收÷单数 算。
  let data = "";
  if (intent.type === "item_detail" && intent.item_name) {
    const rows = await query<any>(
      `SELECT s.hour, s.qty, s.gross_sales FROM item_hourly_sales s
        WHERE s.date = $1 AND ${ITEM_NAME_MATCH("$2")} ORDER BY s.hour`,
      [date, `%${intent.item_name}%`]);
    if (rows.length) {
      data = `【${intent.item_name} 在 ${date} 的时段销量】\n`;
      for (const r of rows) data += `${r.hour}:00 — ${r.qty}个, RM${Number(r.gross_sales).toFixed(0)}\n`;
      data += `合计: ${rows.reduce((a: number, r: any) => a + Number(r.qty), 0)}个, RM${rows.reduce((a: number, r: any) => a + Number(r.gross_sales), 0).toFixed(0)}`;
    } else {
      data = `未找到 "${intent.item_name}" 在 ${date} 的数据`;
    }
  } else if (intent.type === "hourly_detail" || intent.hour) {
    const h = intent.hour || 12;
    const rows = await query<any>("SELECT item_name, qty, gross_sales FROM item_hourly_sales WHERE date = $1 AND hour = $2 ORDER BY qty DESC LIMIT 10", [date, h]);
    const summary = await query<any>("SELECT * FROM hourly_sales_summary WHERE date = $1 AND hour = $2", [date, h]);
    data = `【${date} ${h}:00-${h + 1}:00 数据】\n`;
    if (summary.length) {
      const s = summary[0];
      const bc = Number(s.bill_count) || 0;
      const avg = bc > 0 ? (Number(s.gross_sales) / bc).toFixed(1) : s.avg_order_net_sales;
      data += `客单数: ${s.bill_count} | 营业额: RM${Number(s.gross_sales).toFixed(0)} | 客单价: RM${avg}\n`;
    }
    if (rows.length) { data += `单品:\n`; for (const r of rows) data += `  ${r.item_name}: ${r.qty}个, RM${Number(r.gross_sales).toFixed(0)}\n`; }
  } else if (intent.type === "compare_days" && intent.compare_date) {
    const rows = await query<any>("SELECT * FROM daily_revenue WHERE date = $1", [intent.compare_date]);
    if (rows.length) {
      const r = rows[0];
      const cnt = Number(r.transaction_count) || 0;
      const avg = cnt > 0 ? (Number(r.gross_sales) / cnt).toFixed(1) : r.avg_transaction_value;
      data = `【${intent.compare_date} 数据】\n营业额: RM${r.gross_sales} | 客单数: ${r.transaction_count} | 客单价: RM${avg} | 折扣率: ${((r.discount_rate || 0) * 100).toFixed(1)}%`;
    }
  } else if (intent.type === "item_by_hour" && intent.item_name) {
    const rows = await query<any>(
      `SELECT s.date, s.hour, s.qty, s.net_sales FROM item_hourly_sales s
        WHERE ${ITEM_NAME_MATCH("$1")} ORDER BY s.date DESC, s.hour LIMIT 30`,
      [`%${intent.item_name}%`]);
    if (rows.length) {
      data = `【${intent.item_name} 近期销量】\n`;
      let currentDate = "";
      for (const r of rows) {
        const d = String(r.date).slice(0, 10);
        if (d !== currentDate) { currentDate = d; data += `\n${d}:\n`; }
        data += `  ${r.hour}:00 — ${r.qty}个\n`;
      }
    }
  }
  return data;
}
