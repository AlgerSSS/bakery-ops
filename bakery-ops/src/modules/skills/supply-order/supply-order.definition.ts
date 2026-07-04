import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { parseOrderItems, isOrderMessage, isConsolidateRequest } from "../../domain/supplychain/order-parser";
import { supplyOrderRepository } from "../../data/repositories/supply-order.repository";
import { orderConsolidator } from "../../domain/supplychain/order-consolidator";
import { logger } from "../../shared/logger";
import type { OrderItem } from "../../domain/supplychain/types";

export const supplyOrderSkillDefinition: SkillDefinition = {
  skillId: "supply_order",
  name: "供应链订货",
  description: "员工报数订货、汇总当日订货（按渠道分组展示）",
  priority: 88,
  disambiguation: "员工报数/记录与汇总当日订货；不是把订货确认并发给供应商(supply_send)",
  triggerKeywords: [
    "订货", "报数", "要货", "补货", "采购",
    "汇总订货", "汇总今天", "今天的订货",
    "照上次订", "按上次订",
  ],
  examples: [
    "订货: 面粉:50kg, 糖:20kg",
    "订货: 鸡蛋:200个, 牛奶:10升",
    "汇总今天的订货",
    "照上次订",
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

export class SupplyOrderSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const text = String(input.input.text || "");
    const userId = input.userId;
    // 默认 store，后续可从用户信息获取
    const storeId = "default";

    try {
      // 模式0: 照上次订（复制最近一张已发订单为今日 draft）
      if (/照上次订|按上次订/.test(text)) {
        return this.handleRepeatLast(storeId, userId);
      }

      // 模式1: 汇总请求
      if (isConsolidateRequest(text)) {
        return this.handleConsolidate(storeId);
      }

      // 模式2: 报数
      if (isOrderMessage(text)) {
        return this.handleReport(text, storeId, userId);
      }

      // 尝试解析（可能没有"订货:"前缀但包含物品格式）
      const items = parseOrderItems(text);
      if (items.length > 0) {
        return this.handleReport(text, storeId, userId);
      }

      return {
        runId: uuidv4(),
        skillId: "supply_order",
        status: "error",
        summary: "没有识别到订货内容。请用格式: 订货: 品名:数量单位, 品名:数量单位\n例如: 订货: 面粉:50kg, 糖:20kg",
      };
    } catch (err) {
      logger.error("supply_order execution failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "supply_order",
        status: "error",
        summary: `订货处理失败: ${String(err)}`,
        error: String(err),
      };
    }
  }

  private async handleReport(text: string, storeId: string, userId: string): Promise<SkillExecutionResult> {
    const items = parseOrderItems(text);
    if (items.length === 0) {
      return {
        runId: uuidv4(),
        skillId: "supply_order",
        status: "error",
        summary: "没有解析到有效的物品。请检查格式: 品名:数量单位\n例如: 面粉:50kg, 糖:20kg",
      };
    }

    const orderItems: OrderItem[] = items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
    }));

    // 查找今日订单，有则追加，无则新建
    const today = new Date().toISOString().split("T")[0];
    let order = await supplyOrderRepository.getTodayOrder(storeId);

    if (order) {
      await supplyOrderRepository.appendItems(order.id, orderItems, userId);
    } else {
      order = await supplyOrderRepository.create({
        orderDate: today,
        storeId,
        status: "draft",
        items: orderItems.map((i) => ({ ...i, reportedBy: userId } as any)),
        createdBy: userId,
      });
    }

    const itemList = items.map((i) => `${i.name}: ${i.quantity}${i.unit}`).join("\n");
    return {
      runId: uuidv4(),
      skillId: "supply_order",
      status: "success",
      summary: `已记录 ${items.length} 项订货:\n${itemList}\n\n今日订单已更新。发送"汇总今天的订货"可查看完整汇总。`,
    };
  }

  private async handleRepeatLast(storeId: string, userId: string): Promise<SkillExecutionResult> {
    const recent = await supplyOrderRepository.getRecentOrders(storeId, 10);
    const lastSent = recent.find((o) => o.status === "sent" && Array.isArray(o.items) && o.items.length > 0);

    if (!lastSent) {
      return {
        runId: uuidv4(),
        skillId: "supply_order",
        status: "error",
        summary: "没有找到已发出的历史订单，无法照上次订。请直接报数: 订货: 品名:数量单位",
      };
    }

    const orderItems: OrderItem[] = lastSent.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
    }));

    // 查找今日订单，有则追加，无则新建（与 handleReport 一致）
    const today = new Date().toISOString().split("T")[0];
    const order = await supplyOrderRepository.getTodayOrder(storeId);

    if (order) {
      await supplyOrderRepository.appendItems(order.id, orderItems, userId);
    } else {
      await supplyOrderRepository.create({
        orderDate: today,
        storeId,
        status: "draft",
        items: orderItems.map((i) => ({ ...i, reportedBy: userId } as any)),
        createdBy: userId,
      });
    }

    const itemList = orderItems.map((i) => `${i.name}: ${i.quantity}${i.unit}`).join("\n");
    return {
      runId: uuidv4(),
      skillId: "supply_order",
      status: "success",
      summary: `已按上次订单（${lastSent.order_date}）复制 ${orderItems.length} 项到今日订货:\n${itemList}\n\n可继续增删，确认后发送「发给供应商」下单。`,
    };
  }

  private async handleConsolidate(storeId: string): Promise<SkillExecutionResult> {
    const consolidation = await orderConsolidator.consolidateToday(storeId);

    if (!consolidation) {
      return {
        runId: uuidv4(),
        skillId: "supply_order",
        status: "success",
        summary: "今天还没有订货记录。",
      };
    }

    return {
      runId: uuidv4(),
      skillId: "supply_order",
      status: "success",
      summary: consolidation.summaryText + '\n\n确认无误后，发送「发给供应商」执行下单。',
    };
  }
}
