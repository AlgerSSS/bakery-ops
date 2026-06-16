import { query } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";

export interface EmployeeEventRow {
  id: string;
  employee_id: string;
  event_type: string;
  summary: string;
  raw_message?: string;
  reported_by?: string;
  data: Record<string, unknown>;
  created_at: string;
}

const SELECT_COLUMNS =
  "id, employee_id, event_type, summary, raw_message, reported_by, data, created_at::text AS created_at";

export class EmployeeEventRepository {
  async create(event: Omit<EmployeeEventRow, "id" | "created_at">): Promise<EmployeeEventRow | null> {
    try {
      const rows = await query<EmployeeEventRow>(
        `INSERT INTO employee_events (employee_id, event_type, summary, raw_message, reported_by, data)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING ${SELECT_COLUMNS}`,
        [
          event.employee_id,
          event.event_type,
          event.summary,
          event.raw_message ?? null,
          event.reported_by ?? null,
          JSON.stringify(event.data),
        ]
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("Failed to create employee event", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getByEmployee(employeeId: string): Promise<EmployeeEventRow[]> {
    try {
      return await query<EmployeeEventRow>(
        `SELECT ${SELECT_COLUMNS} FROM employee_events WHERE employee_id = ? ORDER BY created_at DESC`,
        [employeeId]
      );
    } catch {
      return [];
    }
  }

  async getByType(eventType: string, limit = 50): Promise<EmployeeEventRow[]> {
    try {
      return await query<EmployeeEventRow>(
        `SELECT ${SELECT_COLUMNS} FROM employee_events WHERE event_type = ? ORDER BY created_at DESC LIMIT ?`,
        [eventType, limit]
      );
    } catch {
      return [];
    }
  }
}

export const employeeEventRepository = new EmployeeEventRepository();
