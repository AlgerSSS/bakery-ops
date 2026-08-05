import { query, execute, withTransaction } from "@/modules/shared/db/postgres";
import type {
  DailyReviewResult,
} from "@/modules/domain/forecast/types";

// ========== DB Row Types ==========
interface DailyReviewRow {
  id: number;
  date: string;
  // 迁移 070 把这两列从 text 改成了 jsonb：驱动直接返回对象，不再是字符串。
  // 迁移执行前旧库还是 text，所以读侧两种形态都兼容。
  review_json: unknown;
  suggestions_json: unknown;
  adopted: boolean;
}

const asJson = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

// ========== Daily Review ==========
export async function getDailyReview(date: string): Promise<DailyReviewResult | null> {
  const rows = await query<DailyReviewRow>("SELECT * FROM daily_review WHERE date = ?", [date]);
  if (rows.length === 0) return null;
  const row = rows[0];
  // 迁移 070 后同一天可能只有店长手记（manager_text）、没有 AI 复盘 ——
  // 这与合并前「daily_review 里查不到这一天」等价，保持返回 null。
  if (row.review_json == null) return null;
  return {
    id: row.id,
    date: row.date,
    review: asJson(row.review_json),
    tomorrowSuggestions: asJson(row.suggestions_json),
    adopted: row.adopted,
  };
}

export async function saveDailyReview(date: string, reviewJson: string, suggestionsJson: string): Promise<void> {
  // ::jsonb 显式转换：迁移 070 后列是 jsonb，驱动送来的字符串参数需要明确转型。
  await execute(
    `INSERT INTO daily_review (date, review_json, suggestions_json)
     VALUES (?, ?::jsonb, ?::jsonb)
     ON CONFLICT (date) DO UPDATE SET review_json = EXCLUDED.review_json, suggestions_json = EXCLUDED.suggestions_json, adopted = false`,
    [date, reviewJson, suggestionsJson]
  );
}

export async function adoptDailyReview(date: string): Promise<void> {
  await execute("UPDATE daily_review SET adopted = true WHERE date = ?", [date]);
}

// ========== Daily Revenue ==========
/**
 * 店长在复盘页手填的营业额，写进 daily_review 而不是 daily_revenue（迁移 104）。
 *
 * 此前这里是 `INSERT INTO daily_revenue ... ON CONFLICT (date) DO UPDATE
 * SET revenue = EXCLUDED.revenue` —— 无条件覆盖 res_api 每晚抓来的 POS 实测值，
 * 而当晚 23:00 的同步又反向把店长填的抹掉。两个数互相消灭，谁也不知道自己填的活了多久。
 *
 * 它们本来就是两件事：POS 实测是机器抓的事实，店长填的是人的判断（手工单、跑单、
 * 当天特殊情况）。并排存着互相对照才有意义，对照视图见 v_revenue_manager_vs_pos。
 */
export async function saveManagerRevenue(date: string, revenue: number, transactionCount?: number, avgTransactionValue?: number): Promise<void> {
  await execute(
    // ⚠ 列清单里绝不能带 review_json / suggestions_json。
    // 这两列可空，而本文件 :26 的 `if (row.review_json == null) return null;` 正是用 NULL 表达
    // 「这天只有店长手记、没有 AI 复盘」—— 070 定下的契约，生产库 15 行里 10 行如此，
    // daily-review-chat.definition.ts:442 那条每天在跑的 upsert 也不写这两列。
    // 一旦这里拿 '{}' 占位：店长填完营业额、紧接着的 AI 复盘超时失败（daily-review.service.ts:90/94
    // 抛错，真正写 review_json 的 :97 从未执行），这一行就永久停在 '{}'，
    // 而后续两个写者都是 DO UPDATE，谁也改不回 NULL。
    // 后果是 getDailyReview 返回一个非 null 但全空的对象：总览页渲染一张空复盘卡（还带可点的
    // 「采纳」按钮），Lark/WhatsApp 回一条只有标题、正文空白的消息，
    // 而不是本该出现的「暂无昨日复盘数据。请先在网页端完成复盘。」
    // DO UPDATE 分支本来就不碰这两列，所以 INSERT 里也不写，两边一致。
    `INSERT INTO daily_review (date, manager_revenue, manager_transaction_count, manager_avg_transaction, manager_revenue_at)
     VALUES (?, ?, ?, ?, now())
     ON CONFLICT (date) DO UPDATE SET
       manager_revenue = EXCLUDED.manager_revenue,
       manager_transaction_count = COALESCE(EXCLUDED.manager_transaction_count, daily_review.manager_transaction_count),
       manager_avg_transaction = COALESCE(EXCLUDED.manager_avg_transaction, daily_review.manager_avg_transaction),
       manager_revenue_at = now()`,
    [date, revenue, transactionCount ?? null, avgTransactionValue ?? null]
  );
}

/**
 * 优先 POS 实测（daily_revenue），那天没有实测值时退回店长手填（daily_review.manager_*）。
 *
 * 104 把手填值从 daily_revenue 挪到 daily_review 之后，如果读侧不跟着改，
 * 手填就变成一个只写不读的列 —— 而手填通道存在的全部理由，正是 res_api 当晚抓取失败、
 * daily_revenue 那天压根没有行的情况。那时店长填的数会一个地方都看不见，
 * 比 104 之前（直接覆盖 daily_revenue）还差。
 *
 * 优先级不能反：POS 实测是机器抓的事实，手填是人的判断，两者都在时以机器为准，
 * 差异去看 v_revenue_manager_vs_pos，而不是让手填盖掉实测（那正是 104 要根除的病）。
 *
 * manager_revenue 是 numeric，驱动会返回字符串，显式转 float8 以匹配返回类型。
 */
export async function getDailyRevenues(startDate: string, endDate: string): Promise<{ date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null }[]> {
  return query(
    `SELECT date, revenue, transaction_count, avg_transaction_value
       FROM daily_revenue WHERE date >= ? AND date <= ?
     UNION ALL
     SELECT r.date, r.manager_revenue::float8, r.manager_transaction_count, r.manager_avg_transaction::float8
       FROM daily_review r
      WHERE r.date >= ? AND r.date <= ? AND r.manager_revenue IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM daily_revenue d WHERE d.date = r.date)
     ORDER BY date`,
    [startDate, endDate, startDate, endDate]
  );
}
