import { logger } from "../../shared/logger";
import { supplyOrderRepository } from "../../data/repositories/supply-order.repository";
import { kdocsConnector } from "./connectors/kdocs.connector";
import type { OrderItem, CatalogItem, ChannelSplit, OrderConsolidation } from "./types";

/**
 * 订货汇总器
 * 合并当日所有报数，按渠道分流
 */
export class OrderConsolidator {
  /**
   * 汇总指定订单，按渠道分组
   */
  async consolidateOrder(orderId: string): Promise<OrderConsolidation | null> {
    const order = await supplyOrderRepository.getById(orderId);
    if (!order) return null;

    const items: OrderItem[] = Array.isArray(order.items) ? order.items : [];
    const catalog = await kdocsConnector.getCatalog();

    // 合并同名物品
    const merged = this.mergeItems(items);

    // 按渠道分流
    const channelSplit = this.splitByChannel(merged, catalog);

    // 生成文字汇总
    const summaryText = this.formatSummary(channelSplit, order.order_date);

    return {
      date: order.order_date,
      storeId: order.store_id,
      totalItems: merged.length,
      channelSplit,
      summaryText,
    };
  }

  /**
   * 汇总今日订单
   */
  async consolidateToday(storeId: string): Promise<OrderConsolidation | null> {
    const order = await supplyOrderRepository.getTodayOrder(storeId);
    if (!order) return null;
    return this.consolidateOrder(order.id);
  }

  /**
   * 合并同名物品（累加数量）
   */
  mergeItems(items: OrderItem[]): OrderItem[] {
    const map = new Map<string, OrderItem>();

    for (const item of items) {
      const key = `${item.name}|${item.unit}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        map.set(key, { ...item });
      }
    }

    return Array.from(map.values());
  }

  /**
   * 按 KDocs 目录分流
   * NO 1-93 → WhatsApp 渠道
   * NO 94+  → WMS 渠道
   */
  splitByChannel(items: OrderItem[], catalog: CatalogItem[]): ChannelSplit {
    const whatsappItems: OrderItem[] = [];
    const wmsItems: OrderItem[] = [];

    for (const item of items) {
      // 在目录中查找匹配
      const catalogEntry = catalog.find(
        (c) => c.name === item.name || c.name.includes(item.name) || item.name.includes(c.name),
      );

      if (catalogEntry) {
        item.catalogNo = catalogEntry.no;
        item.channel = catalogEntry.channel;
        item.supplier = catalogEntry.supplier;

        if (catalogEntry.channel === "wms") {
          wmsItems.push(item);
        } else {
          whatsappItems.push(item);
        }
      } else {
        // 未在目录中找到，默认走 WhatsApp
        item.channel = "whatsapp";
        whatsappItems.push(item);
      }
    }

    return { whatsappItems, wmsItems };
  }

  /**
   * 格式化文字汇总
   */
  formatSummary(split: ChannelSplit, date: string): string {
    const lines: string[] = [];
    lines.push(`📋 ${date} 订货汇总`);
    lines.push("");

    if (split.whatsappItems.length > 0) {
      lines.push("【渠道A - WhatsApp供应商】");
      for (const item of split.whatsappItems) {
        const no = item.catalogNo ? `(NO.${item.catalogNo})` : "";
        lines.push(`  ${item.name}${no}: ${item.quantity}${item.unit}`);
      }
      lines.push("");
    }

    if (split.wmsItems.length > 0) {
      lines.push("【渠道B - WMS系统下单】");
      for (const item of split.wmsItems) {
        const no = item.catalogNo ? `(NO.${item.catalogNo})` : "";
        lines.push(`  ${item.name}${no}: ${item.quantity}${item.unit}`);
      }
      lines.push("");
    }

    const total = split.whatsappItems.length + split.wmsItems.length;
    lines.push(`合计: ${total} 项物品`);
    lines.push(`  渠道A: ${split.whatsappItems.length} 项 | 渠道B: ${split.wmsItems.length} 项`);

    return lines.join("\n");
  }
}

export const orderConsolidator = new OrderConsolidator();
