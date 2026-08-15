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

/**
 * daily_revenue 的完整口径行。compare_days 与 general 兜底共用。
 *
 * 原先 compare_days 只吐 营业额/客单数/客单价/折扣率 四个字段，缺的三个（实收、折扣额、会员占比）
 * 模型会自己补：2026-08-06 实测它把应收当成实收、用「应收 × 折扣率」反推出 RM1155.04
 * （真值 total_discount=1175.89，差在折扣率被四舍五入成 2.3%）、会员占比凭空写 23.1%（真值 2.78%）。
 * 结论：凡是模型可能需要的字段，宁可多给，也不要让它算。
 */
/** pg 的 numeric 经驱动回来是字符串，所以数值列一律按 number | string 收，用处再 Number()。 */
type ItemHourRow = {
  hour: number;
  qty: number | string;
  gross_sales: number | string;
};
type ItemNameRow = {
  item_name: string;
  qty: number | string;
  gross_sales: number | string;
};
type HourlySummaryRow = {
  bill_count?: number | string | null;
  gross_sales?: number | string | null;
  avg_order_net_sales?: number | string | null;
};
type ItemByHourRow = {
  date: string | Date;
  hour: number;
  qty: number | string;
  net_sales: number | string;
};

type DailyRevenueRow = {
  transaction_count?: number | string | null;
  gross_sales?: number | string | null;
  revenue?: number | string | null;
  total_discount?: number | string | null;
  discount_rate?: number | string | null;
  member_sales_ratio?: number | string | null;
  avg_transaction_value?: number | string | null;
};

function revenueLine(r: DailyRevenueRow): string {
  const cnt = Number(r.transaction_count) || 0;
  const gross = Number(r.gross_sales) || 0;
  const net = Number(r.revenue) || 0;
  // 客单价口径与复盘一致：应收 ÷ 客单数（刻意不同于库里的 avg_transaction_value = 实收 ÷ 客单数）
  const avg = cnt > 0 ? (gross / cnt).toFixed(1) : String(r.avg_transaction_value ?? "-");
  return (
    // 比率列必须显式 Number()：pg 的 numeric 走驱动回来是【字符串】，
    // 直接 `(r.discount_rate || 0) * 100` 在运行时是字符串乘法。原先 row 是 any，
    // 类型层看不出来；收紧成 DailyRevenueRow 后 tsc 立刻指出了这两处。
    `营业额(应收,折扣前): RM${gross.toFixed(2)} | 实收(折后): RM${net.toFixed(2)} | ` +
    `折扣额: RM${Number(r.total_discount ?? 0).toFixed(2)} (折扣率 ${(Number(r.discount_rate ?? 0) * 100).toFixed(1)}%)\n` +
    `客单数: ${cnt}单 | 客单价(应收÷客单数): RM${avg} | ` +
    `会员支付占比: ${(Number(r.member_sales_ratio ?? 0) * 100).toFixed(1)}%`
  );
}

type IntentType = "hourly_detail" | "item_detail" | "compare_days" | "item_by_hour" | "general";
const INTENT_TYPES: readonly IntentType[] = [
  "hourly_detail", "item_detail", "compare_days", "item_by_hour", "general",
];

/** 校验后的意图。字段都已收敛到可以安全进 SQL 的形态。 */
type Intent = {
  type: IntentType;
  item_name?: string;
  hour?: number;        // 已保证是 0-23 的整数
  compare_date?: string; // 已保证是 YYYY-MM-DD
};

/**
 * 把 LLM 吐的 JSON 收敛成 Intent。**这一层不能省** —— 原先是 `let intent: any = JSON.parse(...)`，
 * 字段不加校验直接进 SQL 参数，实测有两个后果：
 *
 *   · `hour:"下午"` → item_hourly_sales.hour 是 integer 列 →
 *     `invalid input syntax for type integer` 抛出 → 整个追问挂掉，店长只看到
 *     「AI 分析暂时不可用」。店长问「下午卖得怎么样」就会触发。
 *   · `hour:"14"`（字符串）→ SQL 能过，但下面 `${h}:00-${h+1}:00` 是**字符串拼接**，
 *     标题变成 "14:00-141:00"。这种不报错、只是数字错，更难发现。
 *
 * compare_date 同理：daily_revenue.date 是 varchar，脏值不抛异常、只静默返回 0 行，
 * 会被当成「那天没数据」——比报错更难查，所以这里限死 YYYY-MM-DD。
 */
export function parseIntent(raw: string): Intent {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
  } catch {
    return { type: "general" };
  }
  if (!o || typeof o !== "object") return { type: "general" };

  const type = INTENT_TYPES.includes(o.type as IntentType) ? (o.type as IntentType) : "general";

  const hourNum = Number(o.hour);
  const hour =
    o.hour !== undefined && o.hour !== null && o.hour !== "" &&
    Number.isInteger(hourNum) && hourNum >= 0 && hourNum <= 23
      ? hourNum
      : undefined;

  const rawItem = typeof o.item_name === "string" ? o.item_name.trim() : "";
  const rawCompare = typeof o.compare_date === "string" ? o.compare_date.trim() : "";

  return {
    type,
    item_name: rawItem || undefined,
    hour,
    compare_date: /^\d{4}-\d{2}-\d{2}$/.test(rawCompare) ? rawCompare : undefined,
  };
}

export async function queryDataForQuestion(question: string, date: string): Promise<string> {
  // LLM 判断用户问的是什么数据，生成对应查询
  const intentPrompt = `用户在复盘对话中追问了一个问题。判断他需要什么数据，返回JSON。

用户问题: "${question}"
当前复盘日期: ${date}

返回格式:
{"type": "hourly_detail" | "item_detail" | "compare_days" | "item_by_hour" | "general", "item_name": "如果问具体产品", "hour": 如果问具体时段(0-23整数), "compare_date": "如果要对比某天(YYYY-MM-DD)"}

字段要求（不满足就填 null，不要猜）：
- hour 必须是 0-23 的**整数**，不是文字。「下午」→ 14，「晚上」→ 19，「早上」→ 9，「中午」→ 12。
  说不清具体钟点就填 null。
- compare_date 必须是 YYYY-MM-DD。「昨天」这类相对说法请按"当前复盘日期"换算成绝对日期。

只返回JSON，不要其他文字。`;

  let intent: Intent = { type: "general" };
  try {
    const raw = await aiProvider.chatCompletion(intentPrompt, 200, process.env.AI_SMALL_MODEL || undefined);
    intent = parseIntent(raw);
  } catch { /* LLM 不可用：按 general 兜底，下面的 else 分支会给出当日完整数据 */ }

  // 口径与复盘一致：营业额/单品金额用应收(gross_sales)，客单价按 应收÷单数 算。
  let data = "";
  if (intent.type === "item_detail" && intent.item_name) {
    const rows = await query<ItemHourRow>(
      `SELECT s.hour, s.qty, s.gross_sales FROM item_hourly_sales s
        WHERE s.date = $1 AND ${ITEM_NAME_MATCH("$2")} ORDER BY s.hour`,
      [date, `%${intent.item_name}%`]);
    if (rows.length) {
      data = `【${intent.item_name} 在 ${date} 的时段销量】\n`;
      for (const r of rows) data += `${r.hour}:00 — ${r.qty}个, RM${Number(r.gross_sales).toFixed(0)}\n`;
      data += `合计: ${rows.reduce((a: number, r) => a + Number(r.qty), 0)}个, RM${rows.reduce((a: number, r) => a + Number(r.gross_sales), 0).toFixed(0)}`;
    } else {
      data = `未找到 "${intent.item_name}" 在 ${date} 的数据`;
    }
    // 用 !== undefined 而不是真值判断：hour=0（午夜）是合法时段，`|| 12` 会把它悄悄改成 12 点。
  } else if (intent.type === "hourly_detail" || intent.hour !== undefined) {
    const h = intent.hour ?? 12; // parseIntent 已保证是 0-23 的整数，下面的 h+1 才是算术而非拼接
    const rows = await query<ItemNameRow>("SELECT item_name, qty, gross_sales FROM item_hourly_sales WHERE date = $1 AND hour = $2 ORDER BY qty DESC LIMIT 10", [date, h]);
    const summary = await query<HourlySummaryRow>("SELECT * FROM hourly_sales_summary WHERE date = $1 AND hour = $2", [date, h]);
    data = `【${date} ${h}:00-${h + 1}:00 数据】\n`;
    if (summary.length) {
      const s = summary[0];
      const bc = Number(s.bill_count) || 0;
      const avg = bc > 0 ? (Number(s.gross_sales) / bc).toFixed(1) : s.avg_order_net_sales;
      data += `客单数: ${s.bill_count} | 营业额: RM${Number(s.gross_sales).toFixed(0)} | 客单价: RM${avg}\n`;
    }
    if (rows.length) { data += `单品:\n`; for (const r of rows) data += `  ${r.item_name}: ${r.qty}个, RM${Number(r.gross_sales).toFixed(0)}\n`; }
  } else if (intent.type === "compare_days" && intent.compare_date) {
    const rows = await query<DailyRevenueRow>("SELECT * FROM daily_revenue WHERE date = $1", [intent.compare_date]);
    if (rows.length) {
      data = `【${intent.compare_date} 数据】\n${revenueLine(rows[0])}`;
    } else {
      data = `【${intent.compare_date}】系统没有这一天的 daily_revenue 记录`;
    }
  } else if (intent.type === "item_by_hour" && intent.item_name) {
    const rows = await query<ItemByHourRow>(
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
  } else {
    // general 兜底。原先这里【没有任何分支】——意图判成 general（或 item_detail 缺 item_name
    // 之类的残缺组合）时 data 恒为空串，调用方的提示词里于是一个数字都没有，模型开始编。
    // knowledge_query 的经营类分支没有别的数据源，更是全靠这里。
    const rows = await query<DailyRevenueRow>("SELECT * FROM daily_revenue WHERE date = $1", [date]);
    if (rows.length) data = `【${date} 当日数据】\n${revenueLine(rows[0])}\n`;

    const items = await query<{ name: string; qty: number | string; gross: number | string }>(
      `SELECT COALESCE(p.name, s.item_name) AS name, SUM(s.qty) AS qty, SUM(s.gross_sales) AS gross
         FROM item_hourly_sales s
         LEFT JOIN product p ON ${NORM_SQL("p.name_en")} = ${NORM_SQL("s.item_name")}
        WHERE s.date = $1
        GROUP BY COALESCE(p.name, s.item_name)
        ORDER BY gross DESC LIMIT 10`, [date]);
    if (items.length) {
      data += `\n【${date} 单品 TOP10（按应收金额）】\n`;
      for (const r of items) {
        data += `  ${r.name}: ${Number(r.qty)}个, RM${Number(r.gross).toFixed(0)}\n`;
      }
    }

    // 空串会让调用方静默降级成「无数据提示词」，那正是编造的温床。
    // 明确说没有，模型才有话可讲；也便于排查是真没数据还是查错了日期。
    if (!data) data = `【${date}】系统没有这一天的销售数据（可能该日无营业，或 POS 刷新尚未跑到）`;
  }
  return data;
}
