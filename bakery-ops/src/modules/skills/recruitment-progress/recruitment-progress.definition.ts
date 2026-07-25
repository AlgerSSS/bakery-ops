// recruitment-progress.definition.ts — "招聘进展"只读指令（IMPROVEMENT-PLAN.md F10）。
//
// 一条消息输出招聘漏斗：申请→联系→初面→试工→录用 ｜ 淘汰 ｜ 备选池 ｜ 本周新增。
// 阶段中文标签取 recruitment-vocab 的 STAGE_TO_LARK；new/opted_out/no_show 映射为 null，
// 自备标签（新申请/已退出/爽约）。纯读 applications 表，不写任何数据。
// ⚠️ 未注册：需接线 agent 在 skills/index.ts + bootstrap 注册 skillId=recruitment_progress。

import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { applicationRepository } from "@/modules/data/repositories/application.repository";
import { storeRepository } from "@/modules/data/repositories/store.repository";
import { STAGE_TO_LARK, type ApplicationStage } from "@/modules/domain/recruitment/recruitment-vocab";
import { logger } from "../../shared/logger";

export const recruitmentProgressSkillDefinition: SkillDefinition = {
  skillId: "recruitment_progress",
  name: "招聘进展",
  description: "查看招聘漏斗进展：各阶段候选人数（申请/联系/初面/试工/录用/淘汰/备选池）及本周新增",
  priority: 86,
  disambiguation:
    "只读汇总本店招聘漏斗各阶段人数；不是采集新候选人(recruitment_sourcing)，也不是查看 JobStreet 在招岗位与申请者明细(active_jobs)",
  triggerKeywords: ["招聘进展", "招聘漏斗"],
  examples: [
    "招聘进展",
    "现在招聘漏斗怎么样",
  ],
  requiredInputs: [],
  optionalInputs: [],
  permissions: ["recruitment.use"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: false,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

/** new/opted_out/no_show 在 STAGE_TO_LARK 中映射为 null，自备中文标签。 */
const EXTRA_STAGE_LABELS: Partial<Record<ApplicationStage, string>> = {
  new: "新申请",
  opted_out: "已退出",
  no_show: "爽约",
};

/** 漏斗主线（按流程顺序）与旁路（淘汰/备选/退出/爽约）。 */
const FUNNEL_STAGES: ApplicationStage[] = [
  "new",
  "contacting",
  "first_interview",
  "trial",
  "post_trial_interview",
  "feedback",
  "hired",
];
const SIDE_STAGES: ApplicationStage[] = ["rejected", "backup_pool", "opted_out", "no_show"];

export function stageLabel(stage: ApplicationStage): string {
  return STAGE_TO_LARK[stage] ?? EXTRA_STAGE_LABELS[stage] ?? stage;
}

export interface RecruitmentProgressData {
  storeName: string;
  counts: Partial<Record<ApplicationStage, number>>;
  recentCount: number; // 近 7 天新增申请
}

/** 固定中文模板（纯函数，单测覆盖）。 */
export function buildProgressText(data: RecruitmentProgressData): string {
  const n = (s: ApplicationStage) => data.counts[s] ?? 0;
  const lines: string[] = [];
  lines.push(`📋 招聘进展（${data.storeName}）`);
  lines.push(FUNNEL_STAGES.map((s) => `${stageLabel(s)} ${n(s)}`).join(" → "));
  lines.push(SIDE_STAGES.map((s) => `${stageLabel(s)} ${n(s)}`).join(" ｜ "));
  lines.push(`本周新增申请：${data.recentCount}`);
  return lines.join("\n");
}

export class RecruitmentProgressSkillHandler implements SkillHandler {
  async execute(_input: SkillExecutionInput): Promise<SkillExecutionResult> {
    try {
      const stores = await storeRepository.listActive();
      const store = stores[0]; // 单店经营：与 pre-router greetStranger 同一取法
      if (!store) {
        return {
          runId: uuidv4(),
          skillId: "recruitment_progress",
          status: "error",
          summary: "没有找到有效门店，无法查询招聘进展。",
          error: "no active store",
        };
      }

      const counts = await applicationRepository.countByStage(store.store_code);
      const recentCount = await applicationRepository.countRecentApplications(store.store_code, 7);

      return {
        runId: uuidv4(),
        skillId: "recruitment_progress",
        status: "success",
        summary: buildProgressText({ storeName: store.name, counts, recentCount }),
      };
    } catch (error) {
      logger.error("recruitment_progress skill failed", { error: String(error) });
      return {
        runId: uuidv4(),
        skillId: "recruitment_progress",
        status: "error",
        summary: "查询招聘进展失败，请稍后重试。",
        error: String(error),
      };
    }
  }
}
