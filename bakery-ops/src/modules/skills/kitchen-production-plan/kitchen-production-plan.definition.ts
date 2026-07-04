import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { generateProductionPlan } from "../../domain/production-plan/plan-generator";
import dayjs from "dayjs";

export const kitchenProductionPlanSkillDefinition: SkillDefinition = {
  skillId: "kitchen_production_plan",
  name: "后厨生产计划单",
  description: "根据预估单生成后厨可执行的生产计划，包含批次拆分、时间倒推、工位分配",
  priority: 85,
  disambiguation: "把预估单转成后厨可执行的生产计划/排班；不是生成营业额预估本身(forecast_order)",
  triggerKeywords: [
    "后厨计划", "生产计划", "后厨", "生产计划单",
    "批次", "烘烤计划", "后厨任务",
  ],
  examples: [
    "根据明天预估单生成后厨生产计划",
    "看一下 13 点前后厨要做什么",
    "后厨计划发给后厨主管",
  ],
  requiredInputs: [
    {
      name: "storeId", type: "string", description: "门店 ID",
      promptQuestion: "请问要生成哪家门店的后厨计划？",
    },
    {
      name: "targetDate", type: "date", description: "目标日期",
      promptQuestion: "请问要生成哪一天的后厨计划？",
    },
  ],
  optionalInputs: [
    { name: "forecastSnapshotId", type: "string", description: "关联的预估单 ID" },
  ],
  permissions: ["kitchen_plan.generate"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: true,
  supportsFiles: true,
  supportsCron: true,
  outputTypes: ["text", "excel"],
  handler: null,
};

export class KitchenProductionPlanSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const text = (input.input.text as string) || "";
    let targetDate = (input.input.targetDate as string) || "";

    if (!targetDate) {
      const today = dayjs();
      const lower = text.toLowerCase();
      if (lower.includes("今天") || lower.includes("今日")) {
        targetDate = today.format("YYYY-MM-DD");
      } else if (lower.includes("后天")) {
        targetDate = today.add(2, "day").format("YYYY-MM-DD");
      } else {
        targetDate = today.add(1, "day").format("YYYY-MM-DD");
      }
    }

    try {
      const plan = await generateProductionPlan(targetDate);
      return {
        runId: uuidv4(),
        skillId: "kitchen_production_plan",
        status: "success",
        summary: plan.summary,
      };
    } catch (err) {
      return {
        runId: uuidv4(),
        skillId: "kitchen_production_plan",
        status: "error",
        summary: `后厨计划生成失败：${err instanceof Error ? err.message : String(err)}`,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
