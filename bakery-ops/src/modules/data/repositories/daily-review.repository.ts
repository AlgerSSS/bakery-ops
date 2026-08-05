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
    `INSERT INTO daily_review (date, review_json, suggestions_json, manager_revenue, manager_transaction_count, manager_avg_transaction, manager_revenue_at)
     VALUES (?, '{}'::jsonb, '[]'::jsonb, ?, ?, ?, now())
     ON CONFLICT (date) DO UPDATE SET
       manager_revenue = EXCLUDED.manager_revenue,
       manager_transaction_count = COALESCE(EXCLUDED.manager_transaction_count, daily_review.manager_transaction_count),
       manager_avg_transaction = COALESCE(EXCLUDED.manager_avg_transaction, daily_review.manager_avg_transaction),
       manager_revenue_at = now()`,
    [date, revenue, transactionCount ?? null, avgTransactionValue ?? null]
  );
}

export async function getDailyRevenues(startDate: string, endDate: string): Promise<{ date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null }[]> {
  return query(
    "SELECT date, revenue, transaction_count, avg_transaction_value FROM daily_revenue WHERE date >= ? AND date <= ? ORDER BY date",
    [startDate, endDate]
  );
}
