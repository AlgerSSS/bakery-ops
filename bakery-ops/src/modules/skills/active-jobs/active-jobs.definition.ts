import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { activeJobsInteractive, type ActiveJobsStepResult } from "../../domain/recruitment/jobs/active-jobs.service";
import type { ActiveJobsState } from "../../domain/recruitment/types";
import { logger } from "../../shared/logger";

export const activeJobsSkillDefinition: SkillDefinition = {
  skillId: "active_jobs",
  name: "查看招聘岗位",
  description: "查看 JobStreet 和 AJobThing 上当前在招的岗位、申请者列表，下载简历",
  priority: 85,
  triggerKeywords: [
    "在招", "在招岗位", "招聘岗位", "查看岗位", "看看岗位",
    "有哪些岗位", "岗位列表", "申请者", "申请人", "投递",
    "active jobs", "applicants", "查看招聘", "招聘情况", "招聘进度",
  ],
  examples: [
    "看看我现在有哪些在招的岗位",
    "查看招聘岗位的申请者",
    "招聘进度怎么样了",
    "有多少人投递了",
  ],
  requiredInputs: [],
  optionalInputs: [],
  permissions: ["recruitment.use"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: true,
  supportsFiles: true,
  supportsCron: false,
  outputTypes: ["text", "pdf"],
  handler: null,
};

export class ActiveJobsSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const currentState = input.input._activeJobsState as ActiveJobsState | undefined;
    const userReply = String(input.input.text || "");

    try {
      const result: ActiveJobsStepResult = await activeJobsInteractive(currentState, userReply);

      if (result.waitForReply) {
        return {
          runId: uuidv4(),
          skillId: "active_jobs",
          status: "pending",
          summary: result.messages.join("\n"),
          data: { _activeJobsState: result.state },
          files: result.files,
        };
      }

      return {
        runId: uuidv4(),
        skillId: "active_jobs",
        status: "success",
        summary: result.messages.join("\n"),
        files: result.files,
      };
    } catch (err) {
      logger.error("Active jobs skill failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "active_jobs",
        status: "error",
        summary: `查询岗位失败: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }
  }
}
