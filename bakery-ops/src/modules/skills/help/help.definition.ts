import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { skillRegistry } from "../../orchestrator/skill-registry";
import { resolveGroupsForMessage } from "../../orchestrator/department-resolver";
import { buildDepartmentMenu } from "../../orchestrator/department-permissions";

export const helpSkillDefinition: SkillDefinition = {
  skillId: "help",
  name: "帮助菜单",
  description: "列出系统当前支持的全部功能",
  priority: 60,
  triggerKeywords: ["帮助", "菜单", "你能做什么", "help"],
  examples: [
    "帮助",
    "菜单",
    "你能做什么",
  ],
  requiredInputs: [],
  optionalInputs: [],
  permissions: [],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: false,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

export class HelpSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    // 按发送者的 Lark 部门过滤菜单：总经办(或解析不到时 fail-open)看全部并按部门分组，
    // 其他部门只看自己组的功能。
    const skillInfo = new Map(
      skillRegistry.getAll().map((s) => [s.skillId, { name: s.name, description: s.description }]),
    );
    const { groups, resolved } = await resolveGroupsForMessage(input.rawMessage ?? {});
    const showAll = !resolved || groups.has("gm");
    return {
      runId: uuidv4(),
      skillId: "help",
      status: "success",
      summary: buildDepartmentMenu(skillInfo, groups, showAll),
    };
  }
}
