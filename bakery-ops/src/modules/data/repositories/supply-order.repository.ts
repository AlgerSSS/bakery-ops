import { supabase } from "../supabase";
import { logger } from "../../shared/logger";
import type { SupplyOrder, OrderItem } from "../../domain/supplychain/types";

export interface SupplyOrderRow {
  id: string;
  order_date: string;
  store_id: string;
  status: string;
  items: OrderItem[];
  sent_at?: string;
  notes?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export class SupplyOrderRepository {
  async create(order: Omit<SupplyOrder, "id">): Promise<SupplyOrderRow | null> {
    const { data, error } = await supabase
      .from("supply_orders")
      .insert({
        order_date: order.orderDate,
        store_id: order.storeId,
        status: order.status,
        items: order.items,
        notes: order.notes,
        created_by: order.createdBy,
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create supply order", { error: error.message });
      return null;
    }
    return data as SupplyOrderRow;
  }

  async getById(id: string): Promise<SupplyOrderRow | null> {
    const { data, error } = await supabase
      .from("supply_orders")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return null;
    return data as SupplyOrderRow;
  }

  async getTodayOrder(storeId: string): Promise<SupplyOrderRow | null> {
    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("supply_orders")
      .select("*")
      .eq("store_id", storeId)
      .eq("order_date", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data as SupplyOrderRow;
  }

  async getByDate(storeId: string, date: string): Promise<SupplyOrderRow[]> {
    const { data, error } = await supabase
      .from("supply_orders")
      .select("*")
      .eq("store_id", storeId)
      .eq("order_date", date)
      .order("created_at", { ascending: false });

    if (error) return [];
    return (data || []) as SupplyOrderRow[];
  }

  async appendItems(id: string, newItems: OrderItem[], reportedBy: string): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;

    const currentItems = Array.isArray(existing.items) ? existing.items : [];
    const merged = [...currentItems, ...newItems.map(item => ({ ...item, reportedBy }))];

    const { error } = await supabase
      .from("supply_orders")
      .update({
        items: merged,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      logger.error("Failed to append items to supply order", { id, error: error.message });
      return false;
    }
    return true;
  }

  async updateStatus(id: string, status: string, extra?: Record<string, unknown>): Promise<void> {
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
      ...extra,
    };
    const { error } = await supabase
      .from("supply_orders")
      .update(update)
      .eq("id", id);

    if (error) {
      logger.error("Failed to update supply order status", { id, error: error.message });
    }
  }

  async getRecentOrders(storeId: string, limit = 10): Promise<SupplyOrderRow[]> {
    const { data, error } = await supabase
      .from("supply_orders")
      .select("*")
      .eq("store_id", storeId)
      .order("order_date", { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as SupplyOrderRow[];
  }
}

export const supplyOrderRepository = new SupplyOrderRepository();
