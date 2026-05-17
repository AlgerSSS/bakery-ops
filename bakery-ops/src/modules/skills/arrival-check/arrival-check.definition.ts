import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { parseOrderItems } from "../../domain/supplychain/order-parser";
import { supplyOrderRepository } from "../../data/repositories/supply-order.repository";
import { arrivalRecordRepository } from "../../data/repositories/arrival-record.repository";
import { logger } from "../../shared/logger";
import type { ArrivalItem, OrderItem } from "../../domain/supplychain/types";

export const arrivalCheckSkillDefinition: SkillDefinition = {
  skillId: "arrival_check",
  name: "到货核对",
  description: "核对到货数量与订货差异，记录到货情况",
  priority: 87,
  triggerKeywords: [
    "到货", "收货", "验货", "核对到货",
  ],
  examples: [
    "到货: 面粉:48kg, 糖:20kg",
    "到货: 鸡蛋:195个, 牛奶:10升",
  ],
  requiredInputs: [],
  optionalInputs: [],
  permissions: ["supplychain.order"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: false,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

export class ArrivalCheckSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const text = String(input.input.text || "");
    const userId = input.userId;
    const storeId = "default";

    try {
      const items = parseOrderItems(text);
      if (items.length === 0) {
        return {
          runId: uuidv4(),
          skillId: "arrival_check",
          status: "error",
          summary: "没有解析到到货物品。请用格式: 到货: 品名:数量单位\n例如: 到货: 面粉:48kg, 糖:20kg",
        };
      }

      // 查找最近的订单
      const order = await supplyOrderRepository.getTodayOrder(storeId);
      if (!order) {
        return {
          runId: uuidv4(),
          skillId: "arrival_check",
          status: "error",
          summary: "今天没有找到对应的订货记录，无法核对差异。",
        };
      }

      // 保存到货记录
      const arrivalItems: ArrivalItem[] = items.map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
      }));

      await arrivalRecordRepository.create({
        orderId: order.id,
        storeId,
        items: arrivalItems,
        reportedBy: userId,
      });

      // 对比差异
      const orderItems: OrderItem[] = Array.isArray(order.items) ? order.items : [];
      const diffLines = this.compareDifferences(orderItems, arrivalItems);

      const summary = diffLines.length > 0
        ? `到货核对完成，发现以下差异:\n\n${diffLines.join("\n")}\n\n到货记录已保存。`
        : `到货核对完成，所有物品数量一致。\n\n到货记录已保存。`;

      return {
        runId: uuidv4(),
        skillId: "arrival_check",
        status: "success",
        summary,
      };
    } catch (err) {
      logger.error("arrival_check execution failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "arrival_check",
        status: "error",
        summary: `到货核对失败: ${String(err)}`,
        error: String(err),
      };
    }
  }

  private compareDifferences(ordered: OrderItem[], arrived: ArrivalItem[]): string[] {
    const diffs: string[] = [];

    for (const arrival of arrived) {
      // 在订单中查找对应物品
      const orderItem = ordered.find(
        (o) => o.name === arrival.name || o.name.includes(arrival.name) || arrival.name.includes(o.name),
      );

      if (!orderItem) {
        diffs.push(`⚠️ ${arrival.name}: 到货 ${arrival.quantity}${arrival.unit}（未在订单中找到）`);
        continue;
      }

      const diff = arrival.quantity - orderItem.quantity;
      if (Math.abs(diff) > 0.01) {
        const sign = diff > 0 ? "多" : "少";
        diffs.push(
          `${diff > 0 ? "📈" : "📉"} ${arrival.name}: 订 ${orderItem.quantity}${orderItem.unit} → 到 ${arrival.quantity}${arrival.unit}（${sign} ${Math.abs(diff)}${arrival.unit}）`,
        );
      }
    }

    // 检查订了但没到的
    for (const orderItem of ordered) {
      const found = arrived.find(
        (a) => a.name === orderItem.name || a.name.includes(orderItem.name) || orderItem.name.includes(a.name),
      );
      if (!found) {
        diffs.push(`❌ ${orderItem.name}: 订 ${orderItem.quantity}${orderItem.unit} → 未到货`);
      }
    }

    return diffs;
  }
}
