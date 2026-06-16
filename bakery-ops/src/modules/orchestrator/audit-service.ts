import { v4 as uuidv4 } from "uuid";
import { logger } from "../shared/logger";

export interface SkillRun {
  runId: string;
  skillId: string;
  userId: string;
  channel: string;
  status: "queued" | "running" | "success" | "error";
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export class AuditService {
  // Phase 1: 内存存储，后续迁移到 skill_runs 表
  private runs: Map<string, SkillRun> = new Map();

  constructor(private repo?: { upsert(run: SkillRun): Promise<void> }) {}

  startRun(skillId: string, userId: string, channel: string, input: Record<string, unknown>): SkillRun {
    const run: SkillRun = {
      runId: uuidv4(),
      skillId,
      userId,
      channel,
      status: "running",
      input,
      startedAt: new Date().toISOString(),
    };
    this.runs.set(run.runId, run);
    void this.repo?.upsert(run);
    logger.info("Skill run started", { runId: run.runId, skillId, userId });
    return run;
  }

  completeRun(runId: string, output: Record<string, unknown>): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "success";
    run.output = output;
    run.finishedAt = new Date().toISOString();
    run.durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    void this.repo?.upsert(run);
    logger.info("Skill run completed", { runId, skillId: run.skillId, durationMs: run.durationMs });
  }

  failRun(runId: string, error: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "error";
    run.error = error;
    run.finishedAt = new Date().toISOString();
    run.durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    void this.repo?.upsert(run);
    logger.error("Skill run failed", { runId, skillId: run.skillId, error });
  }

  getRun(runId: string): SkillRun | undefined {
    return this.runs.get(runId);
  }
}

export const auditService = new AuditService();
