import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";
import type { ApplicationStage } from "../../domain/recruitment/recruitment-vocab";
import type { RoleArea } from "./job-opening.repository";

export interface ApplicationRow {
  id: string;
  store_id: string;
  job_opening_id?: string;
  employee_id?: string;
  external_applicant_id?: string;
  name?: string;
  phone?: string;
  contact_status: "ready" | "needs_manual";
  role_area?: RoleArea;
  position_code?: string;
  stage: ApplicationStage;
  source?: string;
  lark_record_id?: string;
  applied_at?: string;
  created_at: string;
  updated_at: string;
}

const SELECT_COLS =
  "id, store_id, job_opening_id, employee_id, external_applicant_id, name, phone, contact_status, " +
  "role_area, position_code, stage, source, lark_record_id, " +
  "applied_at::text AS applied_at, created_at::text AS created_at, updated_at::text AS updated_at";

export interface CreateApplicationInput {
  store_id: string;
  job_opening_id?: string;
  phone?: string;
  name?: string;
  external_applicant_id?: string;
  role_area?: RoleArea;
  contact_status?: "ready" | "needs_manual";
  source?: string;
}

export class ApplicationRepository {
  /**
   * Idempotent intake. If a phone is present, dedups on (store_id, phone). Otherwise, if an
   * external_applicant_id is present, dedups on (store_id, job_opening_id, external_applicant_id).
   * Returns the existing or newly-created row.
   */
  async createOrGet(input: CreateApplicationInput): Promise<ApplicationRow | null> {
    try {
      if (input.phone) {
        const existing = await this.findByPhone(input.store_id, input.phone);
        if (existing) return existing;
      } else if (input.external_applicant_id) {
        const existing = await this.findByExternalId(
          input.store_id,
          input.job_opening_id ?? null,
          input.external_applicant_id,
        );
        if (existing) return existing;
      }

      const rows = await query<ApplicationRow>(
        `INSERT INTO applications
           (store_id, job_opening_id, phone, name, external_applicant_id, role_area, contact_status, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${SELECT_COLS}`,
        [
          input.store_id,
          input.job_opening_id ?? null,
          input.phone ?? null,
          input.name ?? null,
          input.external_applicant_id ?? null,
          input.role_area ?? null,
          input.contact_status ?? (input.phone ? "ready" : "needs_manual"),
          input.source ?? null,
        ],
      );
      return rows[0] ?? null;
    } catch (e) {
      logger.error("Failed to createOrGet application", {
        store_id: input.store_id,
        error: (e as Error).message,
      });
      return null;
    }
  }

  async findByPhone(storeId: string, phone: string): Promise<ApplicationRow | null> {
    try {
      const rows = await query<ApplicationRow>(
        `SELECT ${SELECT_COLS} FROM applications WHERE store_id = ? AND phone = ? LIMIT 1`,
        [storeId, phone],
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("application.repository.findByPhone failed", { error: String(error) });
      return null;
    }
  }

  async findById(id: string): Promise<ApplicationRow | null> {
    try {
      const rows = await query<ApplicationRow>(
        `SELECT ${SELECT_COLS} FROM applications WHERE id = ? LIMIT 1`,
        [id],
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("application.repository.findById failed", { error: String(error) });
      return null;
    }
  }

  /** Public so the JobStreet intake (F12) can pre-check external_applicant_id dedup before insert. */
  async findByExternalId(
    storeId: string,
    jobOpeningId: string | null,
    externalApplicantId: string,
  ): Promise<ApplicationRow | null> {
    try {
      const rows = jobOpeningId
        ? await query<ApplicationRow>(
            `SELECT ${SELECT_COLS} FROM applications
             WHERE store_id = ? AND job_opening_id = ? AND external_applicant_id = ? LIMIT 1`,
            [storeId, jobOpeningId, externalApplicantId],
          )
        : await query<ApplicationRow>(
            `SELECT ${SELECT_COLS} FROM applications
             WHERE store_id = ? AND job_opening_id IS NULL AND external_applicant_id = ? LIMIT 1`,
            [storeId, externalApplicantId],
          );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("application.repository.findByExternalId failed", { error: String(error) });
      return null;
    }
  }

  async advanceStage(id: string, stage: ApplicationStage): Promise<void> {
    try {
      await execute(
        "UPDATE applications SET stage = ?, updated_at = NOW() WHERE id = ?",
        [stage, id],
      );
    } catch (e) {
      logger.error("Failed to advance application stage", { id, stage, error: (e as Error).message });
    }
  }

  async setLarkRecordId(id: string, larkRecordId: string): Promise<void> {
    try {
      await execute(
        "UPDATE applications SET lark_record_id = ?, updated_at = NOW() WHERE id = ?",
        [larkRecordId, id],
      );
    } catch (e) {
      logger.error("Failed to set application lark_record_id", { id, error: (e as Error).message });
    }
  }

  async setPosition(id: string, positionCode: string): Promise<void> {
    try {
      await execute(
        "UPDATE applications SET position_code = ?, updated_at = NOW() WHERE id = ?",
        [positionCode, id],
      );
    } catch (e) {
      logger.error("Failed to set application position", { id, error: (e as Error).message });
    }
  }

  async setContactStatus(id: string, status: "ready" | "needs_manual"): Promise<void> {
    try {
      await execute(
        "UPDATE applications SET contact_status = ?, updated_at = NOW() WHERE id = ?",
        [status, id],
      );
    } catch (e) {
      logger.error("Failed to set application contact_status", { id, error: (e as Error).message });
    }
  }

  async linkEmployee(id: string, employeeId: string): Promise<void> {
    try {
      await execute(
        "UPDATE applications SET employee_id = ?, updated_at = NOW() WHERE id = ?",
        [employeeId, id],
      );
    } catch (e) {
      logger.error("Failed to link employee to application", { id, error: (e as Error).message });
    }
  }

  /** Per-stage application counts for a store (GROUP BY stage). Stages with no rows are absent. */
  async countByStage(storeId: string): Promise<Partial<Record<ApplicationStage, number>>> {
    try {
      const rows = await query<{ stage: ApplicationStage; count: number }>(
        "SELECT stage, COUNT(*)::int AS count FROM applications WHERE store_id = ? GROUP BY stage",
        [storeId],
      );
      const counts: Partial<Record<ApplicationStage, number>> = {};
      for (const r of rows) counts[r.stage] = Number(r.count);
      return counts;
    } catch (error) {
      logger.error("application.repository.countByStage failed", { error: String(error) });
      return {};
    }
  }

  /** Number of applications created in the last `days` days for a store. */
  async countRecentApplications(storeId: string, days: number): Promise<number> {
    try {
      const rows = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM applications
         WHERE store_id = ? AND created_at >= NOW() - make_interval(days => ?::int)`,
        [storeId, days],
      );
      return Number(rows[0]?.count ?? 0);
    } catch (error) {
      logger.error("application.repository.countRecentApplications failed", { error: String(error) });
      return 0;
    }
  }

  async listByStoreStage(storeId: string, stage: ApplicationStage): Promise<ApplicationRow[]> {
    try {
      return await query<ApplicationRow>(
        `SELECT ${SELECT_COLS} FROM applications WHERE store_id = ? AND stage = ? ORDER BY created_at DESC`,
        [storeId, stage],
      );
    } catch (error) {
      logger.error("application.repository.listByStoreStage failed", { error: String(error) });
      return [];
    }
  }
}

export const applicationRepository = new ApplicationRepository();
