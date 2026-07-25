import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";

/**
 * Append-only per-number-per-day send ledger backing the daily cold-send cap.
 * sent_on is computed in Asia/Kuala_Lumpur by the column default, so counts group on local midnight.
 */
export class WaSendLogRepository {
  async record(phone: string): Promise<void> {
    try {
      await execute("INSERT INTO wa_send_log (phone) VALUES (?)", [phone]);
    } catch (e) {
      logger.error("Failed to record wa send log", { phone, error: (e as Error).message });
    }
  }

  /** Count of sends today (Asia/Kuala_Lumpur). Pass no date to use the current local date. */
  async countSentToday(): Promise<number> {
    try {
      const rows = await query<{ n: string }>(
        "SELECT COUNT(*)::text AS n FROM wa_send_log WHERE sent_on = (NOW() AT TIME ZONE 'Asia/Kuala_Lumpur')::date",
      );
      return Number(rows[0]?.n ?? 0);
    } catch (error) {
      logger.error("wa-send-log.repository.countSentToday failed", { error: String(error) });
      return 0;
    }
  }

  async countSentOn(localDate: string): Promise<number> {
    try {
      const rows = await query<{ n: string }>(
        "SELECT COUNT(*)::text AS n FROM wa_send_log WHERE sent_on = ?::date",
        [localDate],
      );
      return Number(rows[0]?.n ?? 0);
    } catch (error) {
      logger.error("wa-send-log.repository.countSentOn failed", { error: String(error) });
      return 0;
    }
  }
}

export const waSendLogRepository = new WaSendLogRepository();
