import { logger } from "../../shared/logger";
import type { InventoryApiClient } from "./inventory-api.interface";
import type { OrderItem } from "./types";

/**
 * 进销存 API 空实现（预留）
 * 当前仅打日志，待对接实际系统后替换
 */
export class InventoryApiClientImpl implements InventoryApiClient {
  async syncArrival(items: OrderItem[], date: string): Promise<{ success: boolean; error?: string }> {
    logger.info("[InventoryAPI] syncArrival called (stub)", {
      date,
      itemCount: items.length,
      items: items.map((i) => `${i.name}:${i.quantity}${i.unit}`),
    });
    // TODO: 对接实际进销存 API
    return { success: true };
  }

  async getStock(itemNames: string[]): Promise<Array<{ name: string; stock: number; unit: string }>> {
    logger.info("[InventoryAPI] getStock called (stub)", { itemNames });
    // TODO: 对接实际进销存 API
    return itemNames.map((name) => ({ name, stock: 0, unit: "" }));
  }

  async healthCheck(): Promise<boolean> {
    logger.info("[InventoryAPI] healthCheck called (stub)");
    return true;
  }
}

export const inventoryApiClient = new InventoryApiClientImpl();
