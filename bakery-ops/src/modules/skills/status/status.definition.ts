import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import dayjs from "dayjs";
import { query } from "@/modules/shared/db/postgres";
import { isClientConnected } from "@/modules/channel/whatsapp/whatsapp.client";
import { waOutboundQueueRepository } from "@/modules/data/repositories/wa-outbound-queue.repository";
import { auditLogRepository } from "@/modules/data/repositories/audit-log.repository";
import { logger } from "../../shared/logger";

export const statusSkillDefinition: SkillDefinition = {
  skillId: "system_status",
  name: "系统状态",
  description: "查看系统运行状态：WhatsApp 连接、POS 数据新鲜度、外呼队列积压、近 24 小时定时任务",
  priority: 60,
  triggerKeywords: ["状态", "系统状态"],
  examples: [
    "状态",
    "系统状态",
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

export class StatusSkillHandler implements SkillHandler {
  async execute(_input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const lines: string[] = [];

    // ① WhatsApp 连接（isClientConnected 内部已做 getState 防御，抛错视为未连接）
    const connected = await isClientConnected();
    lines.push(`① WhatsApp 连接：${connected ? "✅ 正常" : "❌ 未连接"}`);

    // ② POS 数据新鲜度（同 freshness-check：只读 daily_revenue 的 MAX(date)）
    try {
      const rows = await query<{ max_date: string | null }>(
        "SELECT MAX(date) AS max_date FROM daily_revenue"
      );
      const maxDate = rows[0]?.max_date ?? null;
      if (maxDate === null) {
        lines.push("② POS 数据：无记录");
      } else {
        const staleDays = dayjs().diff(dayjs(maxDate), "day");
        lines.push(`② POS 数据：最新 ${dayjs(maxDate).format("YYYY-MM-DD")}，滞后 ${staleDays} 天`);
      }
    } catch (err) {
      logger.warn("System status: POS freshness query failed", { error: String(err) });
      lines.push("② POS 数据：查询失败");
    }

    // ③ 外呼队列积压（repository 查询失败时内部降级返回 0）
    const queued = await waOutboundQueueRepository.countQueued();
    lines.push(`③ 外呼队列积压：${queued} 条`);

    // ④ 近 24h 定时任务运行统计（cron 心跳写入 audit_log，channel='cron'）
    const since = dayjs().subtract(24, "hour").toISOString();
    const stats = await auditLogRepository.countRunsSince("cron", since);
    lines.push(`④ 近 24h 定时任务：共 ${stats.total} 次，成功 ${stats.success}，失败 ${stats.error}`);

    return {
      runId: uuidv4(),
      skillId: "system_status",
      status: "success",
      summary: lines.join("\n"),
    };
  }
}
