import { query, execute } from "@/modules/shared/db/postgres";
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
    try {
      const rows = await query<SupplyOrderRow>(
        `INSERT INTO supply_orders (order_date, store_id, status, items, notes, created_by)
         VALUES (?, ?, ?, ?::jsonb, ?, ?)
         RETURNING *`,
        [
          order.orderDate,
          order.storeId,
          order.status,
          JSON.stringify(order.items),
          order.notes ?? null,
          order.createdBy ?? null,
        ]
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("Failed to create supply order", { error: (error as Error).message });
      return null;
    }
  }

  async getById(id: string): Promise<SupplyOrderRow | null> {
    const rows = await query<SupplyOrderRow>(
      "SELECT * FROM supply_orders WHERE id = ?",
      [id]
    );
    return rows[0] ?? null;
  }

  async getTodayOrder(storeId: string): Promise<SupplyOrderRow | null> {
    const today = new Date().toISOString().split("T")[0];
    const rows = await query<SupplyOrderRow>(
      `SELECT * FROM supply_orders
       WHERE store_id = ? AND order_date = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [storeId, today]
    );
    return rows[0] ?? null;
  }

  async getByDate(storeId: string, date: string): Promise<SupplyOrderRow[]> {
    return query<SupplyOrderRow>(
      `SELECT * FROM supply_orders
       WHERE store_id = ? AND order_date = ?
       ORDER BY created_at DESC`,
      [storeId, date]
    );
  }

  async appendItems(id: string, newItems: OrderItem[], reportedBy: string): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;

    const currentItems = Array.isArray(existing.items) ? existing.items : [];
    const merged = [...currentItems, ...newItems.map(item => ({ ...item, reportedBy }))];

    try {
      await execute(
        `UPDATE supply_orders
         SET items = ?::jsonb, updated_at = ?
         WHERE id = ?`,
        [JSON.stringify(merged), new Date().toISOString(), id]
      );
      return true;
    } catch (error) {
      logger.error("Failed to append items to supply order", { id, error: (error as Error).message });
      return false;
    }
  }

  async updateStatus(id: string, status: string, extra?: Record<string, unknown>): Promise<void> {
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
      ...extra,
    };
    const columns = Object.keys(update);
    const setClause = columns.map(col => `${col} = ?`).join(", ");
    const params = [...columns.map(col => update[col]), id];

    try {
      await execute(`UPDATE supply_orders SET ${setClause} WHERE id = ?`, params);
    } catch (error) {
      logger.error("Failed to update supply order status", { id, error: (error as Error).message });
    }
  }

  async getRecentOrders(storeId: string, limit = 10): Promise<SupplyOrderRow[]> {
    return query<SupplyOrderRow>(
      `SELECT * FROM supply_orders
       WHERE store_id = ?
       ORDER BY order_date DESC
       LIMIT ?`,
      [storeId, limit]
    );
  }
}

export const supplyOrderRepository = new SupplyOrderRepository();
