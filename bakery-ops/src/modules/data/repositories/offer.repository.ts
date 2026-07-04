import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";

export type OfferStatus = "draft" | "approved" | "sent" | "accepted" | "declined";
export type SalarySource = "lark" | "manual";

export interface OfferRow {
  id: string;
  store_id: string;
  application_id: string;
  position_code?: string;
  suggested_salary?: string;
  salary_source: SalarySource;
  approved_by_user_id?: string;
  status: OfferStatus;
  created_at: string;
  updated_at: string;
}

const SELECT_COLS =
  "id, store_id, application_id, position_code, suggested_salary, salary_source, approved_by_user_id, " +
  "status, created_at::text AS created_at, updated_at::text AS updated_at";

export class OfferRepository {
  /** Creates a draft offer. suggested_salary defaults to the Lark 建议薪资 value (salary_source 'lark'). */
  async draft(
    storeId: string,
    applicationId: string,
    fields: { position_code?: string; suggested_salary?: string; salary_source?: SalarySource } = {},
  ): Promise<OfferRow | null> {
    try {
      const rows = await query<OfferRow>(
        `INSERT INTO offers (store_id, application_id, position_code, suggested_salary, salary_source)
         VALUES (?, ?, ?, ?, ?)
         RETURNING ${SELECT_COLS}`,
        [
          storeId,
          applicationId,
          fields.position_code ?? null,
          fields.suggested_salary ?? null,
          fields.salary_source ?? "lark",
        ],
      );
      return rows[0] ?? null;
    } catch (e) {
      logger.error("Failed to draft offer", { storeId, applicationId, error: (e as Error).message });
      return null;
    }
  }

  async setSuggestedSalary(id: string, salary: string, source: SalarySource = "lark"): Promise<void> {
    try {
      await execute(
        "UPDATE offers SET suggested_salary = ?, salary_source = ?, updated_at = NOW() WHERE id = ?",
        [salary, source, id],
      );
    } catch (e) {
      logger.error("Failed to set offer salary", { id, error: (e as Error).message });
    }
  }

  async setStatus(id: string, status: OfferStatus): Promise<void> {
    try {
      await execute("UPDATE offers SET status = ?, updated_at = NOW() WHERE id = ?", [status, id]);
    } catch (e) {
      logger.error("Failed to set offer status", { id, error: (e as Error).message });
    }
  }

  async approve(id: string, approvedByUserId: string): Promise<void> {
    try {
      await execute(
        "UPDATE offers SET status = 'approved', approved_by_user_id = ?, updated_at = NOW() WHERE id = ?",
        [approvedByUserId, id],
      );
    } catch (e) {
      logger.error("Failed to approve offer", { id, error: (e as Error).message });
    }
  }
}

export const offerRepository = new OfferRepository();
