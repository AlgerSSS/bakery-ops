import { logger } from "../../shared/logger";
import type { InventoryApiClient } from "./inventory-api.interface";
import type { OrderItem } from "./types";
import { wmsConnector } from "./connectors/wms.connector";

/**
 * 进销存 API 空实现（预留）
 * 当前仅打日志，待对接实际系统后替换
 */
export class InventoryApiClientImpl implements InventoryApiClient {
  async syncArrival(items: OrderItem[], date: string): Promise<{ success: boolean; error?: string }> {
    logger.warn("inventory-api stub — returning fake data (IMPROVEMENT-PLAN D4/F18)");
    logger.info("[InventoryAPI] syncArrival called (stub)", {
      date,
      itemCount: items.length,
      items: items.map((i) => `${i.name}:${i.quantity}${i.unit}`),
    });
    // TODO: 对接实际进销存 API
    return { success: true };
  }

  async getStock(itemNames: string[]): Promise<Array<{ name: string; stock: number; unit: string }>> {
    // F18: 库存查询走 WMS 连接器（下单页 AJAX 搜索接口自带 QTY）
    try {
      const result = await wmsConnector.getStock(itemNames);
      if (result.success) {
        // WMS 只有 SKU 粒度数量，无单位；取每个查询词的首个匹配
        return result.items.map((item) => ({
          name: item.query,
          stock: item.matches[0]?.qty ?? 0,
          unit: "",
        }));
      }
      logger.warn("[InventoryAPI] getStock WMS query failed", { error: result.error });
    } catch (err) {
      logger.warn("[InventoryAPI] getStock WMS query threw", { error: String(err) });
    }
    // 失败 fallback：保留 D4 的 stub warn
    logger.warn("inventory-api stub — returning fake data (IMPROVEMENT-PLAN D4/F18)");
    logger.info("[InventoryAPI] getStock called (stub)", { itemNames });
    return itemNames.map((name) => ({ name, stock: 0, unit: "" }));
  }

  async healthCheck(): Promise<boolean> {
    logger.warn("inventory-api stub — returning fake data (IMPROVEMENT-PLAN D4/F18)");
    logger.info("[InventoryAPI] healthCheck called (stub)");
    return true;
  }
}

export const inventoryApiClient = new InventoryApiClientImpl();
