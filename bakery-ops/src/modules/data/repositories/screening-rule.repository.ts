import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";

export interface ScreeningRuleRow {
  id: string;
  rule_type: string;
  category: string;
  description: string;
  evidence: string;
  confidence: number;
  sample_count: number;
  job_titles: string[];
  departments: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export class ScreeningRuleRepository {
  async getActiveRules(jobTitle?: string): Promise<ScreeningRuleRow[]> {
    let rows: ScreeningRuleRow[];
    try {
      rows = await query<ScreeningRuleRow>(
        `SELECT id, rule_type, category, description, evidence, confidence, sample_count,
                job_titles, departments, is_active,
                created_at::text AS created_at, updated_at::text AS updated_at
         FROM screening_rules
         WHERE is_active = ?
         ORDER BY confidence DESC`,
        [true],
      );
    } catch (error) {
      logger.error("screening-rule.repository.getActiveRules failed", { error: String(error) });
      return [];
    }

    if (!jobTitle) return rows;

    // Filter: rules with empty job_titles apply to all, otherwise match
    return rows.filter(
      (r) => r.job_titles.length === 0 || r.job_titles.some((t) => t.toLowerCase().includes(jobTitle.toLowerCase())),
    );
  }

  async upsert(rule: Omit<ScreeningRuleRow, "id" | "created_at" | "updated_at">): Promise<void> {
    try {
      await execute(
        `INSERT INTO screening_rules
           (rule_type, category, description, evidence, confidence, sample_count, job_titles, departments, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rule.rule_type,
          rule.category,
          rule.description,
          rule.evidence,
          rule.confidence,
          rule.sample_count,
          rule.job_titles,
          rule.departments,
          rule.is_active,
          new Date().toISOString(),
        ],
      );
    } catch (error) {
      logger.error("Failed to upsert screening rule", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const screeningRuleRepository = new ScreeningRuleRepository();
