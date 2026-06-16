import { execute } from "@/modules/shared/db/postgres";
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
}

export const auditLogRepository = new AuditLogRepository();
