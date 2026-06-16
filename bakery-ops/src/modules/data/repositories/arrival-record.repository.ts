import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";
import type { ArrivalItem } from "../../domain/supplychain/types";

export interface ArrivalRecordRow {
  id: string;
  order_id: string;
  arrival_date: string;
  store_id: string;
  items: ArrivalItem[];
  reported_by: string;
  synced_to_inventory: boolean;
  created_at: string;
}

interface RawArrivalRecordRow {
  id: string;
  order_id: string;
  arrival_date: string;
  store_id: string;
  items: ArrivalItem[] | string;
  reported_by: string;
  synced_to_inventory: boolean;
  created_at: string | Date;
}

function toRow(raw: RawArrivalRecordRow): ArrivalRecordRow {
  return {
    id: raw.id,
    order_id: raw.order_id,
    arrival_date: raw.arrival_date,
    store_id: raw.store_id,
    items: typeof raw.items === "string" ? JSON.parse(raw.items) : raw.items,
    reported_by: raw.reported_by,
    synced_to_inventory: raw.synced_to_inventory,
    created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : raw.created_at,
  };
}

export class ArrivalRecordRepository {
  async create(record: {
    orderId: string;
    arrivalDate?: string;
    storeId: string;
    items: ArrivalItem[];
    reportedBy: string;
  }): Promise<ArrivalRecordRow | null> {
    try {
      const rows = await query<RawArrivalRecordRow>(
        `INSERT INTO arrival_records (order_id, arrival_date, store_id, items, reported_by)
         VALUES (?, ?, ?, ?, ?)
         RETURNING *`,
        [
          record.orderId,
          record.arrivalDate || new Date().toISOString().split("T")[0],
          record.storeId,
          JSON.stringify(record.items),
          record.reportedBy,
        ]
      );
      return rows[0] ? toRow(rows[0]) : null;
    } catch (error) {
      logger.error("Failed to create arrival record", { error: (error as Error).message });
      return null;
    }
  }

  async getByOrderId(orderId: string): Promise<ArrivalRecordRow[]> {
    try {
      const rows = await query<RawArrivalRecordRow>(
        "SELECT * FROM arrival_records WHERE order_id = ? ORDER BY created_at DESC",
        [orderId]
      );
      return rows.map(toRow);
    } catch {
      return [];
    }
  }

  async getByDate(storeId: string, date: string): Promise<ArrivalRecordRow[]> {
    try {
      const rows = await query<RawArrivalRecordRow>(
        "SELECT * FROM arrival_records WHERE store_id = ? AND arrival_date = ? ORDER BY created_at DESC",
        [storeId, date]
      );
      return rows.map(toRow);
    } catch {
      return [];
    }
  }

  async markSynced(id: string): Promise<void> {
    try {
      await execute("UPDATE arrival_records SET synced_to_inventory = true WHERE id = ?", [id]);
    } catch (error) {
      logger.error("Failed to mark arrival record as synced", { id, error: (error as Error).message });
    }
  }
}

export const arrivalRecordRepository = new ArrivalRecordRepository();
