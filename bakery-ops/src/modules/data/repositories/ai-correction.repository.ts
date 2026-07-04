import { query, execute } from "@/modules/shared/db/postgres";

// ========== DB Row Types ==========
interface AIDailyCorrectionRow {
  date: string;
  coefficient: number;
}

// ========== AI Daily Correction（采纳落库，IMPROVEMENT-PLAN.md G2-②） ==========
export async function saveAIDailyCorrection(
  date: string,
  coefficient: number,
  reason: string,
  adoptedBy: string = "web"
): Promise<void> {
  await execute(
    `INSERT INTO ai_daily_correction (date, coefficient, reason, adopted_at, adopted_by)
     VALUES (?, ?, ?, NOW(), ?)
     ON CONFLICT (date) DO UPDATE SET coefficient=EXCLUDED.coefficient, reason=EXCLUDED.reason, adopted_at=NOW(), adopted_by=EXCLUDED.adopted_by`,
    [date, coefficient, reason, adoptedBy]
  );
}

/** 某年某月已采纳的修正系数，键为 YYYY-MM-DD。 */
export async function getAIDailyCorrections(year: number, month: number): Promise<Record<string, number>> {
  const rows = await query<AIDailyCorrectionRow>(
    "SELECT date, coefficient FROM ai_daily_correction WHERE date LIKE ?",
    [`${year}-${String(month).padStart(2, "0")}%`]
  );
  const map: Record<string, number> = {};
  for (const row of rows) map[row.date] = Number(row.coefficient);
  return map;
}
