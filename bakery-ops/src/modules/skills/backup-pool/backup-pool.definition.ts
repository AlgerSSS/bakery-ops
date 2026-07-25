// backup-pool.definition.ts — "备选池"只读查询指令（IMPROVEMENT-PLAN.md F13）。
//
// listByStoreStage('backup_pool') 只读列出：姓名 / FOH-BOH / 入池日期 / 电话，
// 末尾提示可人工联系。不发送任何消息、不写任何数据。
// ⚠️ 未注册：需接线 agent 在 skills/index.ts + bootstrap 注册 skillId=backup_pool。

import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { applicationRepository, type ApplicationRow } from "@/modules/data/repositories/application.repository";
import { storeRepository } from "@/modules/data/repositories/store.repository";
import { ROLE_AREA } from "@/modules/domain/recruitment/recruitment-vocab";
import { logger } from "../../shared/logger";

export const backupPoolSkillDefinition: SkillDefinition = {
  skillId: "backup_pool",
  name: "备选池",
  description: "查看招聘备选池（候补名单）：姓名、前场/后厨、入池日期、电话",
  priority: 85,
  triggerKeywords: ["备选池", "候补名单"],
  examples: [
    "备选池",
    "看看候补名单",
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

/** 固定中文模板（纯函数）。入池日期取 updated_at（转入 backup_pool 时被 advanceStage 刷新）。 */
export function buildBackupPoolText(rows: ApplicationRow[]): string {
  if (rows.length === 0) return "👥 备选池暂无候选人。";
  const lines: string[] = [`👥 备选池（${rows.length} 人）`];
  rows.forEach((r, i) => {
    const name = r.name || "（未留姓名）";
    const area = r.role_area ? ROLE_AREA[r.role_area] : "—";
    const date = (r.updated_at || "").slice(0, 10) || "—";
    const phone = r.phone || "—";
    lines.push(`${i + 1}. ${name} ｜ ${area} ｜ ${date} ｜ ${phone}`);
  });
  lines.push("");
  lines.push("如需启用，请人工联系候选人。");
  return lines.join("\n");
}

export class BackupPoolSkillHandler implements SkillHandler {
  async execute(_input: SkillExecutionInput): Promise<SkillExecutionResult> {
    try {
      const stores = await storeRepository.listActive();
      const store = stores[0]; // 单店经营：与 pre-router greetStranger 同一取法
      if (!store) {
        return {
          runId: uuidv4(),
          skillId: "backup_pool",
          status: "error",
          summary: "没有找到有效门店，无法查询备选池。",
          error: "no active store",
        };
      }

      const rows = await applicationRepository.listByStoreStage(store.store_code, "backup_pool");
      return {
        runId: uuidv4(),
        skillId: "backup_pool",
        status: "success",
        summary: buildBackupPoolText(rows),
      };
    } catch (error) {
      logger.error("backup_pool skill failed", { error: String(error) });
      return {
        runId: uuidv4(),
        skillId: "backup_pool",
        status: "error",
        summary: "查询备选池失败，请稍后重试。",
        error: String(error),
      };
    }
  }
}
