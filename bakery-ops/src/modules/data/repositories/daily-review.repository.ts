import { query, execute, withTransaction } from "@/modules/shared/db/postgres";
import type {
  DailyReviewResult,
} from "@/modules/domain/forecast/types";

// ========== DB Row Types ==========
interface DailyReviewRow {
  id: number;
  date: string;
  review_json: string;
  suggestions_json: string;
  adopted: boolean;
}

// ========== Daily Review ==========
export async function getDailyReview(date: string): Promise<DailyReviewResult | null> {
  const rows = await query<DailyReviewRow>("SELECT * FROM daily_review WHERE date = ?", [date]);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    date: row.date,
    review: JSON.parse(row.review_json),
    tomorrowSuggestions: JSON.parse(row.suggestions_json),
    adopted: row.adopted,
  };
}

export async function saveDailyReview(date: string, reviewJson: string, suggestionsJson: string): Promise<void> {
  await execute(
    `INSERT INTO daily_review (date, review_json, suggestions_json)
     VALUES (?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET review_json = EXCLUDED.review_json, suggestions_json = EXCLUDED.suggestions_json, adopted = false`,
    [date, reviewJson, suggestionsJson]
  );
}

export async function adoptDailyReview(date: string): Promise<void> {
  await execute("UPDATE daily_review SET adopted = true WHERE date = ?", [date]);
}

// ========== Daily Revenue ==========
export async function upsertDailyRevenue(date: string, revenue: number, transactionCount?: number, avgTransactionValue?: number): Promise<void> {
  await execute(
    `INSERT INTO daily_revenue (date, revenue, transaction_count, avg_transaction_value) VALUES (?, ?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET revenue = EXCLUDED.revenue, transaction_count = COALESCE(EXCLUDED.transaction_count, daily_revenue.transaction_count), avg_transaction_value = COALESCE(EXCLUDED.avg_transaction_value, daily_revenue.avg_transaction_value)`,
    [date, revenue, transactionCount ?? null, avgTransactionValue ?? null]
  );
}

export async function getDailyRevenues(startDate: string, endDate: string): Promise<{ date: string; revenue: number; transaction_count: number | null; avg_transaction_value: number | null }[]> {
  return query(
    "SELECT date, revenue, transaction_count, avg_transaction_value FROM daily_revenue WHERE date >= ? AND date <= ? ORDER BY date",
    [startDate, endDate]
  );
}
