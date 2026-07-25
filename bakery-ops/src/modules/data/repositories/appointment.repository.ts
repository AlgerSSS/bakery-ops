import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";
import type { RoleArea } from "./job-opening.repository";

export type AppointmentKind = "interview" | "trial";
export type TrialDuration = "1小时" | "4小时";

export interface AppointmentRow {
  id: string;
  store_id: string;
  application_id: string;
  kind: AppointmentKind;
  role_area?: RoleArea;
  position_code?: string;
  scheduled_for?: string;
  trial_duration?: TrialDuration;
  status: string;
  confirmed_by_user_id?: string;
  confirmed_at?: string;
  lark_record_id?: string;
  created_at: string;
}

const SELECT_COLS =
  "id, store_id, application_id, kind, role_area, position_code, " +
  "scheduled_for::text AS scheduled_for, trial_duration, status, confirmed_by_user_id, " +
  "confirmed_at::text AS confirmed_at, lark_record_id, created_at::text AS created_at";

export interface CreateAppointmentInput {
  role_area?: RoleArea;
  position_code?: string;
  scheduled_for?: string;
  trial_duration?: TrialDuration;
  status?: string;
}

export class AppointmentRepository {
  async create(
    storeId: string,
    applicationId: string,
    kind: AppointmentKind,
    fields: CreateAppointmentInput = {},
  ): Promise<AppointmentRow | null> {
    try {
      const rows = await query<AppointmentRow>(
        `INSERT INTO appointments
           (store_id, application_id, kind, role_area, position_code, scheduled_for, trial_duration, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${SELECT_COLS}`,
        [
          storeId,
          applicationId,
          kind,
          fields.role_area ?? null,
          fields.position_code ?? null,
          fields.scheduled_for ?? null,
          fields.trial_duration ?? null,
          fields.status ?? "proposed",
        ],
      );
      return rows[0] ?? null;
    } catch (e) {
      logger.error("Failed to create appointment", { storeId, applicationId, kind, error: (e as Error).message });
      return null;
    }
  }

  /** Appointments of a kind whose scheduled_for falls on the given local (Asia/Kuala_Lumpur) date. */
  async getByStoreAndDate(
    storeId: string,
    date: string,
    kind: AppointmentKind,
  ): Promise<AppointmentRow[]> {
    try {
      return await query<AppointmentRow>(
        `SELECT ${SELECT_COLS} FROM appointments
         WHERE store_id = ? AND kind = ?
           AND (scheduled_for AT TIME ZONE 'Asia/Kuala_Lumpur')::date = ?::date
         ORDER BY scheduled_for`,
        [storeId, kind, date],
      );
    } catch (error) {
      logger.error("appointment.repository.getByStoreAndDate failed", { error: String(error) });
      return [];
    }
  }

  async confirm(
    id: string,
    fields: { position_code?: string; role_area?: RoleArea; confirmed_by_user_id: string },
  ): Promise<void> {
    try {
      await execute(
        `UPDATE appointments SET
           status = 'confirmed',
           position_code = COALESCE(?, position_code),
           role_area = COALESCE(?, role_area),
           confirmed_by_user_id = ?,
           confirmed_at = NOW()
         WHERE id = ?`,
        [fields.position_code ?? null, fields.role_area ?? null, fields.confirmed_by_user_id, id],
      );
    } catch (e) {
      logger.error("Failed to confirm appointment", { id, error: (e as Error).message });
    }
  }

  /** Trial appointments scheduled for the next local day — feeds the 23:00 nightly trial digest. */
  async getNextDayTrials(storeId: string): Promise<AppointmentRow[]> {
    try {
      return await query<AppointmentRow>(
        `SELECT ${SELECT_COLS} FROM appointments
         WHERE store_id = ? AND kind = 'trial'
           AND (scheduled_for AT TIME ZONE 'Asia/Kuala_Lumpur')::date
               = ((NOW() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + INTERVAL '1 day')::date
         ORDER BY scheduled_for`,
        [storeId],
      );
    } catch (error) {
      logger.error("appointment.repository.getNextDayTrials failed", { error: String(error) });
      return [];
    }
  }

  async linkLarkRecord(id: string, larkRecordId: string): Promise<void> {
    try {
      await execute("UPDATE appointments SET lark_record_id = ? WHERE id = ?", [larkRecordId, id]);
    } catch (e) {
      logger.error("Failed to link lark record to appointment", { id, error: (e as Error).message });
    }
  }
}

export const appointmentRepository = new AppointmentRepository();
