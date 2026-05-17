import type { OrderItem } from "./types";

/**
 * 进销存 API 接口定义
 * 用于将到货数据同步到进销存系统
 */
export interface InventoryApiClient {
  /** 同步到货记录到进销存系统 */
  syncArrival(items: OrderItem[], date: string): Promise<{ success: boolean; error?: string }>;

  /** 查询库存余量 */
  getStock(itemNames: string[]): Promise<Array<{ name: string; stock: number; unit: string }>>;

  /** 健康检查 */
  healthCheck(): Promise<boolean>;
}
