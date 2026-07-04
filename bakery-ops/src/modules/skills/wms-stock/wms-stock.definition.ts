import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { wmsConnector, type StockQueryResult } from "../../domain/supplychain/connectors/wms.connector";
import { logger } from "../../shared/logger";

export const wmsStockSkillDefinition: SkillDefinition = {
  skillId: "wms_stock",
  name: "库存查询",
  description: "查询 WMS 仓库物品库存余量",
  priority: 85,
  triggerKeywords: [
    "库存", "查库存",
  ],
  examples: [
    "库存 面粉",
    "查库存 面粉 黄油",
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

/**
 * 从消息文本解析待查询物品名。
 * "库存 面粉" -> ["面粉"]；"查库存 面粉 黄油" -> ["面粉", "黄油"]
 */
export function parseStockQueryItems(text: string): string[] {
  const stripped = text.replace(/查库存|查询库存|库存/g, " ");
  return stripped
    .split(/[\s,，、;；:：]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 将 WMS 查询结果格式化为回复文本 */
export function formatStockReply(items: StockQueryResult["items"]): string {
  const lines: string[] = ["📦 WMS 库存查询结果", ""];
  for (const item of items) {
    if (item.matches.length === 0) {
      lines.push(`❓ ${item.query}: 未找到匹配 SKU`);
      continue;
    }
    lines.push(`${item.query}:`);
    for (const m of item.matches.slice(0, 5)) {
      lines.push(`  - ${m.sku} ${m.name}: ${m.qty}`);
    }
    if (item.matches.length > 5) {
      lines.push(`  （共 ${item.matches.length} 个匹配，仅显示前 5 个）`);
    }
  }
  return lines.join("\n");
}

export class WmsStockSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const text = String(input.input.text || "");
    const names = parseStockQueryItems(text);

    if (names.length === 0) {
      return {
        runId: uuidv4(),
        skillId: "wms_stock",
        status: "error",
        summary: "请指定要查询的物品名。例如: 库存 面粉",
      };
    }

    try {
      const result = await wmsConnector.getStock(names);
      if (!result.success) {
        logger.warn("wms_stock: WMS query failed", { error: result.error });
        return {
          runId: uuidv4(),
          skillId: "wms_stock",
          status: "error",
          summary: "WMS 暂时连不上，请稍后再试",
        };
      }

      return {
        runId: uuidv4(),
        skillId: "wms_stock",
        status: "success",
        summary: formatStockReply(result.items),
      };
    } catch (err) {
      logger.error("wms_stock execution failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "wms_stock",
        status: "error",
        summary: "WMS 暂时连不上，请稍后再试",
        error: String(err),
      };
    }
  }
}
