import { query } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";
import { RECOMMENDATION } from "../../domain/recruitment/recruitment-vocab";

export type Recommendation = (typeof RECOMMENDATION)[number];

export interface TrialRow {
  id: string;
  store_id: string;
  appointment_id: string;
  position_code?: string;
  score?: number;
  feedback?: string;
  attitude_summary?: string;
  red_line?: boolean;
  recommendation?: Recommendation;
  decided_by_user_id?: string;
  decided_at?: string;
  created_at: string;
}

const SELECT_COLS =
  "id, store_id, appointment_id, position_code, score, feedback, attitude_summary, red_line, " +
  "recommendation, decided_by_user_id, decided_at::text AS decided_at, created_at::text AS created_at";

export interface TrialResultInput {
  position_code?: string;
  score?: number;
  feedback?: string;
  attitude_summary?: string;
  red_line?: boolean;
  recommendation?: Recommendation;
  decided_by_user_id?: string;
}

export class TrialRepository {
  /** One trial row per appointment. Inserts if absent, otherwise no-op (use recordResult to fill it in). */
  async create(storeId: string, appointmentId: string): Promise<TrialRow | null> {
    try {
      const existing = await query<TrialRow>(
        `SELECT ${SELECT_COLS} FROM trials WHERE appointment_id = ? LIMIT 1`,
        [appointmentId],
      );
      if (existing[0]) return existing[0];

      const rows = await query<TrialRow>(
        `INSERT INTO trials (store_id, appointment_id)
         VALUES (?, ?)
         RETURNING ${SELECT_COLS}`,
        [storeId, appointmentId],
      );
      return rows[0] ?? null;
    } catch (e) {
      logger.error("Failed to create trial", { storeId, appointmentId, error: (e as Error).message });
      return null;
    }
  }

  /** Records the chef/store evaluation for the appointment's trial, creating the row if needed. */
  async recordResult(
    storeId: string,
    appointmentId: string,
    result: TrialResultInput,
  ): Promise<TrialRow | null> {
    try {
      const base = await this.create(storeId, appointmentId);
      if (!base) return null;

      const rows = await query<TrialRow>(
        `UPDATE trials SET
           position_code = COALESCE(?, position_code),
           score = COALESCE(?, score),
           feedback = COALESCE(?, feedback),
           attitude_summary = COALESCE(?, attitude_summary),
           red_line = COALESCE(?, red_line),
           recommendation = COALESCE(?, recommendation),
           decided_by_user_id = COALESCE(?, decided_by_user_id),
           decided_at = NOW()
         WHERE appointment_id = ?
         RETURNING ${SELECT_COLS}`,
        [
          result.position_code ?? null,
          result.score ?? null,
          result.feedback ?? null,
          result.attitude_summary ?? null,
          result.red_line ?? null,
          result.recommendation ?? null,
          result.decided_by_user_id ?? null,
          appointmentId,
        ],
      );
      return rows[0] ?? null;
    } catch (e) {
      logger.error("Failed to record trial result", { storeId, appointmentId, error: (e as Error).message });
      return null;
    }
  }
}

export const trialRepository = new TrialRepository();
