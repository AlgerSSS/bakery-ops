import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { handleEmployeeMessage } from "../../domain/employee/employee.service";
import { logger } from "../../shared/logger";

export const employeeManagementSkillDefinition: SkillDefinition = {
  skillId: "employee_management",
  name: "员工管理",
  description: "记录员工面试反馈、入职、离职、绩效等信息，自动更新员工档案",
  priority: 90,
  disambiguation: "记录单个员工的面试反馈/入职/离职/绩效等事件；不是对员工或招聘数据做统计分析(knowledge_query)",
  triggerKeywords: [
    "面试", "入职", "离职", "辞职", "开除", "表现",
    "绩效", "试用期", "转正", "员工", "新人",
  ],
  examples: [
    "张三面试表现不错，沟通能力强",
    "李四上个月离职了，干了3个月",
    "王五试用期通过了，表现很好",
  ],
  requiredInputs: [],
  optionalInputs: [],
  permissions: ["employee.manage"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: true,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

export class EmployeeManagementSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const message = String(input.input.jdText || "");

    try {
      const result = await handleEmployeeMessage(message, input.userId);

      return {
        runId: uuidv4(),
        skillId: "employee_management",
        status: result.success ? "success" : "error",
        summary: result.summary,
      };
    } catch (err) {
      logger.error("Employee management skill failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "employee_management",
        status: "error",
        summary: `处理失败: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }
  }
}
