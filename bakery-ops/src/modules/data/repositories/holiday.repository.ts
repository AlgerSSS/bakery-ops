import { query, execute, withTransaction } from "@/modules/shared/db/postgres";
import type {
  Holiday,
  ContextEvent,
} from "@/modules/domain/forecast/types";

// ========== DB Row Types ==========
interface HolidayRow {
  id: number;
  date: string;
  name: string;
  type: string;
  coefficient: number | null;
  note: string;
}

interface ContextEventRow {
  id: number;
  date: string;
  event_type: string;
  event_tag: string;
  description: string;
  impact_products: string;
  created_by: string;
}


// ========== Converters ==========
function rowToContextEvent(row: ContextEventRow): ContextEvent {
  return {
    id: row.id,
    date: row.date,
    eventType: row.event_type as ContextEvent["eventType"],
    eventTag: row.event_tag,
    description: row.description,
    impactProducts: row.impact_products,
    createdBy: row.created_by,
  };
}


// ========== Holidays ==========
export async function getHolidays(year?: number, month?: number): Promise<Holiday[]> {
  let sql = "SELECT * FROM holiday";
  const params: (string | number)[] = [];
  if (year && month) {
    sql += " WHERE date LIKE ?";
    params.push(`${year}-${String(month).padStart(2, "0")}%`);
  } else if (year) {
    sql += " WHERE date LIKE ?";
    params.push(`${year}%`);
  }
  sql += " ORDER BY date";
  const rows = await query<HolidayRow>(sql, params);
  return rows.map((row) => ({
    id: row.id, date: row.date, name: row.name,
    type: row.type as Holiday["type"], coefficient: row.coefficient ?? undefined, note: row.note,
  }));
}

export async function addHoliday(holiday: Omit<Holiday, "id">): Promise<void> {
  await execute(
    `INSERT INTO holiday (date, name, type, coefficient, note) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type, coefficient=EXCLUDED.coefficient, note=EXCLUDED.note`,
    [holiday.date, holiday.name, holiday.type, holiday.coefficient ?? null, holiday.note]
  );
}

export async function deleteHoliday(id: number): Promise<void> {
  await execute("DELETE FROM holiday WHERE id = ?", [id]);
}

// ========== Context Events ==========
export async function getContextEvents(date?: string, rangeStart?: string, rangeEnd?: string): Promise<ContextEvent[]> {
  let sql = "SELECT * FROM context_event";
  const params: string[] = [];
  if (date) { sql += " WHERE date = ?"; params.push(date); }
  else if (rangeStart && rangeEnd) { sql += " WHERE date >= ? AND date <= ?"; params.push(rangeStart, rangeEnd); }
  sql += " ORDER BY date";
  const rows = await query<ContextEventRow>(sql, params);
  return rows.map(rowToContextEvent);
}

export async function addContextEvent(event: Omit<ContextEvent, "id">): Promise<void> {
  await execute(
    `INSERT INTO context_event (date, event_type, event_tag, description, impact_products, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [event.date, event.eventType, event.eventTag, event.description, event.impactProducts, event.createdBy || "manual"]
  );
}

export async function deleteContextEvent(id: number): Promise<void> {
  await execute("DELETE FROM context_event WHERE id = ?", [id]);
}

