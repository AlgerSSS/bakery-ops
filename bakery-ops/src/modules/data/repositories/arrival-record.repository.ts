import { supabase } from "../supabase";
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

export class ArrivalRecordRepository {
  async create(record: {
    orderId: string;
    arrivalDate?: string;
    storeId: string;
    items: ArrivalItem[];
    reportedBy: string;
  }): Promise<ArrivalRecordRow | null> {
    const { data, error } = await supabase
      .from("arrival_records")
      .insert({
        order_id: record.orderId,
        arrival_date: record.arrivalDate || new Date().toISOString().split("T")[0],
        store_id: record.storeId,
        items: JSON.stringify(record.items),
        reported_by: record.reportedBy,
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create arrival record", { error: error.message });
      return null;
    }
    return data as ArrivalRecordRow;
  }

  async getByOrderId(orderId: string): Promise<ArrivalRecordRow[]> {
    const { data, error } = await supabase
      .from("arrival_records")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });

    if (error) return [];
    return (data || []) as ArrivalRecordRow[];
  }

  async getByDate(storeId: string, date: string): Promise<ArrivalRecordRow[]> {
    const { data, error } = await supabase
      .from("arrival_records")
      .select("*")
      .eq("store_id", storeId)
      .eq("arrival_date", date)
      .order("created_at", { ascending: false });

    if (error) return [];
    return (data || []) as ArrivalRecordRow[];
  }

  async markSynced(id: string): Promise<void> {
    const { error } = await supabase
      .from("arrival_records")
      .update({ synced_to_inventory: true })
      .eq("id", id);

    if (error) {
      logger.error("Failed to mark arrival record as synced", { id, error: error.message });
    }
  }
}

export const arrivalRecordRepository = new ArrivalRecordRepository();
