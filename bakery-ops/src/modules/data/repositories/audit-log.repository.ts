import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";
import type { SkillRun } from "../../orchestrator/audit-service";

export class AuditLogRepository {
  async upsert(run: SkillRun): Promise<void> {
    try {
      await execute(
        `INSERT INTO audit_log (run_id, skill_id, user_id, channel, status, input, output, error, started_at, finished_at, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?)
         ON CONFLICT (run_id) DO UPDATE SET
           skill_id = EXCLUDED.skill_id,
           user_id = EXCLUDED.user_id,
           channel = EXCLUDED.channel,
           status = EXCLUDED.status,
           input = EXCLUDED.input,
           output = EXCLUDED.output,
           error = EXCLUDED.error,
           started_at = EXCLUDED.started_at,
           finished_at = EXCLUDED.finished_at,
           duration_ms = EXCLUDED.duration_ms`,
        [
          run.runId,
          run.skillId,
          run.userId,
          run.channel,
          run.status,
          JSON.stringify(run.input),
          run.output != null ? JSON.stringify(run.output) : null,
          run.error ?? null,
          run.startedAt,
          run.finishedAt ?? null,
          run.durationMs ?? null,
        ]
      );
    } catch (err) {
      logger.debug("audit_log persist skipped", { error: String(err) });
    }
  }

  /** 按 channel 统计某时刻以来的运行次数（"状态"指令读取近 24h cron 心跳）。查询失败时返回全 0。 */
  async countRunsSince(channel: string, sinceIso: string): Promise<{ total: number; success: number; error: number }> {
    try {
      const rows = await query<{ total: number; success: number; error: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'success')::int AS success,
                COUNT(*) FILTER (WHERE status = 'error')::int AS error
         FROM audit_log
         WHERE channel = ? AND started_at >= ?`,
        [channel, sinceIso]
      );
      const r = rows[0];
      return { total: r?.total ?? 0, success: r?.success ?? 0, error: r?.error ?? 0 };
    } catch (err) {
      logger.debug("audit_log stats query skipped", { error: String(err) });
      return { total: 0, success: 0, error: 0 };
    }
  }
}

export const auditLogRepository = new AuditLogRepository();
