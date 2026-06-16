import { supabase } from "../supabase";
import { logger } from "../../shared/logger";
import type { SkillRun } from "../../orchestrator/audit-service";

export class AuditLogRepository {
  async upsert(run: SkillRun): Promise<void> {
    try {
      await supabase.from("audit_log").upsert(
        {
          run_id: run.runId,
          skill_id: run.skillId,
          user_id: run.userId,
          channel: run.channel,
          status: run.status,
          input: run.input,
          output: run.output ?? null,
          error: run.error ?? null,
          started_at: run.startedAt,
          finished_at: run.finishedAt ?? null,
          duration_ms: run.durationMs ?? null,
        },
        { onConflict: "run_id" },
      );
    } catch (err) {
      logger.debug("audit_log persist skipped", { error: String(err) });
    }
  }
}

export const auditLogRepository = new AuditLogRepository();
