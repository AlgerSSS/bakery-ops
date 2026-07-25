import { query } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";

export type RoleArea = "FOH" | "BOH";

export interface JobOpeningRow {
  id: string;
  store_id: string;
  source: string;
  external_job_id?: string;
  role_area: RoleArea;
  title?: string;
  qr_token?: string;
  status: string;
  description?: string;
  created_at: string;
}

const SELECT_COLS =
  "id, store_id, source, external_job_id, role_area, title, qr_token, status, description, created_at::text AS created_at";

export class JobOpeningRepository {
  async upsertFromJobStreet(
    storeId: string,
    externalJobId: string,
    roleArea: RoleArea,
    title?: string,
  ): Promise<JobOpeningRow | null> {
    try {
      const rows = await query<JobOpeningRow>(
        `INSERT INTO job_openings (store_id, source, external_job_id, role_area, title)
         VALUES (?, 'jobstreet', ?, ?, ?)
         ON CONFLICT (store_id, external_job_id) WHERE external_job_id IS NOT NULL
         DO UPDATE SET role_area = EXCLUDED.role_area, title = EXCLUDED.title
         RETURNING ${SELECT_COLS}`,
        [storeId, externalJobId, roleArea, title ?? null],
      );
      return rows[0] ?? null;
    } catch (e) {
      logger.error("Failed to upsert JobStreet opening", { storeId, externalJobId, error: (e as Error).message });
      return null;
    }
  }

  async upsertQrPoster(
    storeId: string,
    roleArea: RoleArea,
    qrToken: string,
  ): Promise<JobOpeningRow | null> {
    try {
      const rows = await query<JobOpeningRow>(
        `INSERT INTO job_openings (store_id, source, role_area, qr_token)
         VALUES (?, 'qr_poster', ?, ?)
         ON CONFLICT (qr_token) WHERE qr_token IS NOT NULL
         DO UPDATE SET role_area = EXCLUDED.role_area
         RETURNING ${SELECT_COLS}`,
        [storeId, roleArea, qrToken],
      );
      return rows[0] ?? null;
    } catch (e) {
      logger.error("Failed to upsert QR opening", { storeId, qrToken, error: (e as Error).message });
      return null;
    }
  }

  async findByQrToken(qrToken: string): Promise<JobOpeningRow | null> {
    try {
      const rows = await query<JobOpeningRow>(
        `SELECT ${SELECT_COLS} FROM job_openings WHERE qr_token = ? LIMIT 1`,
        [qrToken],
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("job-opening.repository.findByQrToken failed", { error: String(error) });
      return null;
    }
  }

  async findById(id: string): Promise<JobOpeningRow | null> {
    try {
      const rows = await query<JobOpeningRow>(
        `SELECT ${SELECT_COLS} FROM job_openings WHERE id = ? LIMIT 1`,
        [id],
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("job-opening.repository.findById failed", { error: String(error) });
      return null;
    }
  }
}

export const jobOpeningRepository = new JobOpeningRepository();
