import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { supplyOrderRepository } from "../../data/repositories/supply-order.repository";
import { orderConsolidator } from "../../domain/supplychain/order-consolidator";
import { excelFiller } from "../../domain/supplychain/excel-filler";
import { supplierMessenger } from "../../domain/supplychain/supplier-messenger";
import { wmsConnector } from "../../domain/supplychain/connectors/wms.connector";
import { kdocsConnector } from "../../domain/supplychain/connectors/kdocs.connector";
import { logger } from "../../shared/logger";

export const supplySendSkillDefinition: SkillDefinition = {
  skillId: "supply_send",
  name: "发送订货",
  description: "确认并执行订货：渠道A发WhatsApp给供应商，渠道B在WMS系统下单，写回金山文档",
  priority: 86,
  triggerKeywords: [
    "发给供应商", "发送订货", "下单", "确认订货", "执行订货",
  ],
  examples: [
    "发给供应商",
    "确认下单",
  ],
  requiredInputs: [],
  optionalInputs: [],
  permissions: ["supplychain.send"],
  riskLevel: "medium",
  requiresConfirmation: true,
  supportsMultiTurn: true,
  supportsFiles: true,
  supportsCron: false,
  outputTypes: ["text", "excel"],
  handler: null,
};

export class SupplySendSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const text = String(input.input.text || "");
    const storeId = "default";

    try {
      // 检查是否是确认回复（多步流程第二步）
      const pendingOrderId = input.input.pendingOrderId as string | undefined;
      if (pendingOrderId && this.isConfirmation(text)) {
        return this.executeOrder(pendingOrderId, storeId);
      }

      // 第一步：生成预览，等待确认
      return this.generatePreview(storeId);
    } catch (err) {
      logger.error("supply_send execution failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "supply_send",
        status: "error",
        summary: `发送订货失败: ${String(err)}`,
        error: String(err),
      };
    }
  }

  private isConfirmation(text: string): boolean {
    return /^(确认|确定|是|好|ok|yes|发|发送|下单)$/i.test(text.trim());
  }

  private async generatePreview(storeId: string): Promise<SkillExecutionResult> {
    const consolidation = await orderConsolidator.consolidateToday(storeId);
    if (!consolidation) {
      return {
        runId: uuidv4(),
        skillId: "supply_send",
        status: "error",
        summary: "今天没有订货记录可以发送。",
      };
    }

    const order = await supplyOrderRepository.getTodayOrder(storeId);
    if (!order) {
      return {
        runId: uuidv4(),
        skillId: "supply_send",
        status: "error",
        summary: "找不到今日订单。",
      };
    }

    const preview = consolidation.summaryText + '\n\n回复「确认」执行下单，回复其他内容取消。';

    return {
      runId: uuidv4(),
      skillId: "supply_send",
      status: "pending",
      summary: preview,
      data: { pendingOrderId: order.id },
    };
  }

  private async executeOrder(orderId: string, storeId: string): Promise<SkillExecutionResult> {
    const consolidation = await orderConsolidator.consolidateOrder(orderId);
    if (!consolidation) {
      return {
        runId: uuidv4(),
        skillId: "supply_send",
        status: "error",
        summary: "订单数据异常，无法执行。",
      };
    }

    const results: string[] = [];
    const { whatsappItems, wmsItems } = consolidation.channelSplit;

    // 渠道A: 填 Excel → WhatsApp 发供应商
    if (whatsappItems.length > 0) {
      const excelPath = await excelFiller.fillOrderTemplate(
        whatsappItems,
        storeId,
        consolidation.date,
      );

      if (excelPath) {
        const caption = `${consolidation.date} 订货单 (${whatsappItems.length} 项)`;
        const sendResult = await supplierMessenger.sendOrderToSupplier(
          undefined, // 使用默认供应商
          excelPath,
          caption,
        );

        if (sendResult.success) {
          results.push(`渠道A: 已发送 ${whatsappItems.length} 项物品给供应商`);
        } else {
          results.push(`渠道A: 发送失败 - ${sendResult.error}`);
        }
      } else {
        results.push("渠道A: Excel 生成失败");
      }
    }

    // 渠道B: WMS 系统下单
    if (wmsItems.length > 0) {
      const wmsResult = await wmsConnector.placeOrder(wmsItems);
      if (wmsResult.success) {
        results.push(`渠道B: 已在 WMS 系统下单 ${wmsItems.length} 项物品`);
      } else {
        results.push(`渠道B: WMS 下单失败 - ${wmsResult.error}`);
      }
    }

    // 写回 KDocs 记录
    const allItems = [...whatsappItems, ...wmsItems];
    const kdocsResult = await kdocsConnector.writeOrderRecord(
      consolidation.date,
      allItems.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit })),
    );
    if (kdocsResult) {
      results.push("金山文档: 订货记录已写入");
    } else {
      results.push("金山文档: 写入失败（不影响订货）");
    }

    // 更新订单状态
    await supplyOrderRepository.updateStatus(orderId, "sent", {
      sent_at: new Date().toISOString(),
    });

    return {
      runId: uuidv4(),
      skillId: "supply_send",
      status: "success",
      summary: `订货执行完成:\n\n${results.join("\n")}`,
    };
  }
}
