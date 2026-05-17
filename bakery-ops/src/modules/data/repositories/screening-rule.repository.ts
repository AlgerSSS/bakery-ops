import { supabase } from "../supabase";
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
    let query = supabase
      .from("screening_rules")
      .select("*")
      .eq("is_active", true)
      .order("confidence", { ascending: false });

    const { data, error } = await query;
    if (error) return [];

    const rows = (data || []) as ScreeningRuleRow[];
    if (!jobTitle) return rows;

    // Filter: rules with empty job_titles apply to all, otherwise match
    return rows.filter(
      (r) => r.job_titles.length === 0 || r.job_titles.some((t) => t.toLowerCase().includes(jobTitle.toLowerCase())),
    );
  }

  async upsert(rule: Omit<ScreeningRuleRow, "id" | "created_at" | "updated_at">): Promise<void> {
    const { error } = await supabase.from("screening_rules").insert({
      ...rule,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      logger.error("Failed to upsert screening rule", { error: error.message });
    }
  }
}

export const screeningRuleRepository = new ScreeningRuleRepository();
