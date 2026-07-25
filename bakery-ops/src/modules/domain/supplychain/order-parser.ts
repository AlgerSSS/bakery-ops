import { logger } from "../../shared/logger";
import type { ParsedItem } from "./types";

/**
 * 订货消息解析器
 * 支持格式: "品名:数量单位" 或 "品名：数量单位"
 * 例如: "面粉:50kg, 糖:20kg" / "鸡蛋：200个，牛奶：10升"
 */

// 常见单位
const UNITS = ["kg", "g", "斤", "包", "箱", "瓶", "桶", "袋", "个", "盒", "升", "L", "ml", "条", "块", "片", "打", "罐", "支", "把"];
const UNIT_PATTERN = UNITS.map(u => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

// 匹配 "品名:数量单位" 或 "品名：数量 单位"
const ITEM_REGEX = new RegExp(
  `([^,，、:：;；\\d]+?)[：:]\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})`,
  "gi",
);

/**
 * 解析订货文本为结构化物品列表
 */
export function parseOrderItems(text: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const cleaned = text
    .replace(/^订货[：:]\s*/i, "")
    .replace(/^到货[：:]\s*/i, "")
    .trim();

  let match: RegExpExecArray | null;
  const regex = new RegExp(ITEM_REGEX.source, "gi");

  while ((match = regex.exec(cleaned)) !== null) {
    const name = match[1].trim();
    const quantity = parseFloat(match[2]);
    const unit = match[3];

    if (name && quantity > 0) {
      items.push({ name, quantity, unit });
    }
  }

  if (items.length > 0) {
    logger.info("Order parser: parsed items", { count: items.length, items });
  }

  return items;
}

/**
 * 检测消息是否为订货格式
 */
export function isOrderMessage(text: string): boolean {
  return /^订货[：:]/.test(text.trim());
}

/**
 * 检测消息是否为到货格式
 */
export function isArrivalMessage(text: string): boolean {
  return /^到货[：:]/.test(text.trim());
}

/**
 * 检测消息是否为汇总请求
 */
export function isConsolidateRequest(text: string): boolean {
  const t = text.trim();
  return /汇总/.test(t) && /订货|今天|今日/.test(t);
}
