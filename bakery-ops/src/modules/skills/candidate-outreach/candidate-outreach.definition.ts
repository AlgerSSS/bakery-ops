import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { employeeRepository, type EmployeeRow } from "../../data/repositories/employee.repository";
import { runOutreach } from "../../domain/recruitment/outreach/outreach.service";
import type { ScoredCandidate, ParsedJD } from "../../domain/recruitment/types";
import { logger } from "../../shared/logger";

export const candidateOutreachSkillDefinition: SkillDefinition = {
  skillId: "candidate_outreach",
  name: "联系候选人",
  description: "联系/触达指定的候选人，通过招聘平台发送消息邀请",
  priority: 95,
  triggerKeywords: ["联系", "联络", "发消息", "通知", "邀请", "触达", "contact", "reach out"],
  examples: [
    "跟 Mikhail Haiqal 联系",
    "联系前三个候选人",
    "给排名前5的人发消息",
    "帮我联络 Muhammad 和 Liya",
  ],
  requiredInputs: [
    { name: "text", type: "string", description: "用户的联系指令", promptQuestion: "你想联系哪些候选人？" },
  ],
  optionalInputs: [
    { name: "candidateNames", type: "string", description: "候选人姓名列表（逗号分隔）" },
    { name: "topN", type: "number", description: "联系前N个候选人" },
  ],
  permissions: ["recruitment.use"],
  riskLevel: "medium",
  requiresConfirmation: false,
  supportsMultiTurn: true,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};
export class CandidateOutreachSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const text = String(input.input.text || input.input.jdText || "");
    const candidateNamesRaw = input.input.candidateNames as string | undefined;
    const topN = input.input.topN as number | undefined;

    try {
      // 解析要联系的候选人
      let employees: EmployeeRow[] = [];

      if (candidateNamesRaw) {
        // LLM 提取了具体姓名
        const names = candidateNamesRaw.split(",").map((n) => n.trim()).filter(Boolean);
        employees = await employeeRepository.findByNames(names);
      } else if (topN && topN > 0) {
        // 联系前 N 个
        employees = await employeeRepository.findRecentCandidates(topN);
      } else {
        // 从文本中尝试提取姓名或数字
        const parsed = this.parseOutreachIntent(text);
        if (parsed.topN) {
          employees = await employeeRepository.findRecentCandidates(parsed.topN);
        } else if (parsed.names.length > 0) {
          employees = await employeeRepository.findByNames(parsed.names);
        } else {
          // 默认取最近的候选人
          employees = await employeeRepository.findRecentCandidates(5);
        }
      }

      if (employees.length === 0) {
        return {
          runId: uuidv4(),
          skillId: "candidate_outreach",
          status: "error",
          summary: "没有找到匹配的候选人。请确认姓名是否正确，或者先运行招聘搜索。",
        };
      }

      // 将 EmployeeRow 转换为 ScoredCandidate
      const candidates = employees.map((e) => this.toScoredCandidate(e));

      // 从候选人 metadata 读取之前 recruitment_sourcing 存下的真实 JD
      const firstMeta = (employees[0]?.metadata || {}) as Record<string, unknown>;
      const jobTitle = String(firstMeta.recruitmentJdTitle || employees[0]?.job_title || "职位");
      const location = String(firstMeta.recruitmentJdLocation || employees[0]?.location || "Kuala Lumpur");
      const jd: ParsedJD = {
        jobTitle,
        location,
        requirements: [],
        preferredSkills: [],
        experienceYears: 0,
        languageRequirements: [],
        jobType: "full_time",
        rawText: "",
      };

      logger.info("Candidate outreach: starting", {
        count: candidates.length,
        names: candidates.map((c) => c.name),
      });
      const outreachResults = await runOutreach(candidates, jd);

      // 构建结果摘要
      const lines: string[] = ["━━━ 自动触达结果 ━━━", ""];
      let totalSent = 0;
      let totalFailed = 0;

      for (const batch of outreachResults) {
        totalSent += batch.sent;
        totalFailed += batch.failed;
        const skipped = batch.results.filter((r) => r.status === "skipped").length;
        const budgetExceeded = batch.results.filter((r) => r.status === "budget_exceeded").length;

        let detail = `${batch.platform}: 发送 ${batch.sent}/${batch.total}`;
        if (batch.failed > 0) detail += `, 失败 ${batch.failed}`;
        if (skipped > 0) detail += `, 跳过 ${skipped}`;
        if (budgetExceeded > 0) detail += `, 预算超限 ${budgetExceeded}`;
        lines.push(detail);

        // 列出每个候选人的状态
        for (const r of batch.results) {
          const icon = r.status === "sent" ? "✓" : r.status === "failed" ? "✗" : "—";
          lines.push(`  ${icon} ${r.candidateName}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
        }
        lines.push("");
      }

      lines.push(`总计: 发送 ${totalSent}, 失败 ${totalFailed}`);

      return {
        runId: uuidv4(),
        skillId: "candidate_outreach",
        status: "success",
        summary: lines.join("\n"),
      };
    } catch (err) {
      logger.error("Candidate outreach skill failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "candidate_outreach",
        status: "error",
        summary: `联系候选人失败: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }
  }
  private parseOutreachIntent(text: string): { names: string[]; topN?: number } {
    // 匹配 "前N个" / "top N" / "前 N 名"
    const topNMatch = text.match(/前\s*(\d+)\s*[个名位人]|top\s*(\d+)/i);
    if (topNMatch) {
      return { names: [], topN: parseInt(topNMatch[1] || topNMatch[2], 10) };
    }

    // 匹配 "全部" / "所有"
    if (text.includes("全部") || text.includes("所有")) {
      return { names: [], topN: 20 };
    }

    // 尝试提取人名（英文名模式：首字母大写的连续词）
    const namePattern = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g;
    const names = text.match(namePattern) || [];

    return { names: names.filter((n) => n.length > 2), topN: undefined };
  }

  private toScoredCandidate(row: EmployeeRow): ScoredCandidate {
    const metadata = (row.metadata || {}) as Record<string, unknown>;
    let rawData = (metadata.rawData || {}) as Record<string, unknown>;

    // Fallback: 从 source_url 提取平台 ID
    if (Object.keys(rawData).length === 0 && row.source_url) {
      rawData = this.extractRawDataFromUrl(row.source, row.source_url);
    }

    return {
      candidateId: row.candidate_id || row.id,
      source: row.source,
      sourceUrl: row.source_url || "",
      name: row.name,
      phone: row.phone,
      email: row.email,
      location: row.location,
      currentTitle: row.job_title,
      experience: row.experience_summary,
      skills: row.skills || [],
      languages: row.languages || [],
      education: row.education,
      summary: row.resume_text,
      resumeFileId: row.resume_file_id,
      rawData,
      matchScore: (metadata.matchScore as number) || 0,
      scoreBreakdown: { skillMatch: 0, experienceMatch: 0, locationMatch: 0, languageMatch: 0 },
      scoreReason: (metadata.scoreReason as string) || "",
    };
  }

  /**
   * 从 source_url 提取平台 ID 作为 rawData 的 fallback
   * JobStreet: https://my.employer.seek.com/talentsearch/profiles/{profileGuid}?market=MY
   * AJobThing: https://www.ajobthing.com/candidatesearch?profile={encoded_id}
   */
  private extractRawDataFromUrl(source: string, url: string): Record<string, unknown> {
    if (source === "JobStreet") {
      const match = url.match(/\/profiles\/([^?/]+)/);
      if (match) return { profileGuid: match[1] };
    }
    if (source === "AJobThing") {
      const match = url.match(/[?&]profile=([^&]+)/);
      if (match) return { encoded_id: match[1] };
    }
    return {};
  }
}

