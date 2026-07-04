import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { runRecruitmentPipeline } from "../../domain/recruitment/recruitment.service";
import { fileService } from "../../domain/files/file-service";
import { logger } from "../../shared/logger";

export const recruitmentSkillDefinition: SkillDefinition = {
  skillId: "recruitment_sourcing",
  name: "招聘",
  description: "根据岗位 JD 从招聘网站采集候选人，筛选匹配，推送简历",
  priority: 100,
  disambiguation: "从招聘网站主动采集/搜索新候选人来招人；不是查看已发布岗位(active_jobs)，也不是把岗位发布上架(job_posting)，更不是上传解析简历文件(resume_upload)",
  triggerKeywords: ["招聘", "招人", "找人", "候选人", "JD", "求职", "找工"],
  examples: [
    "帮我找吉隆坡前场店员，要求会中文，有餐饮经验",
    "招一个后厨师傅，要有烘焙经验",
    "帮我看看最近有没有合适的候选人",
  ],
  requiredInputs: [
    { name: "jdText", type: "string", description: "岗位描述", promptQuestion: "请描述你要招聘的岗位要求（岗位名称、地点、技能要求、语言要求等）" },
  ],
  optionalInputs: [
    { name: "location", type: "string", description: "工作地点" },
    { name: "maxCandidates", type: "number", description: "最多推送候选人数", defaultValue: 10 },
  ],
  permissions: ["recruitment.use"],
  riskLevel: "medium",
  requiresConfirmation: false,
  supportsMultiTurn: true,
  supportsFiles: true,
  supportsCron: true,
  outputTypes: ["text", "pdf"],
  handler: null,
};

export class RecruitmentSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const jdText = String(input.input.jdText || "");
    const maxCandidates = Number(input.input.maxCandidates) || 10;

    try {
      const result = await runRecruitmentPipeline(jdText, maxCandidates);

      // 构建文本摘要 — 按来源平台分组
      const lines: string[] = [
        `招聘结果：${result.jd.jobTitle}（${result.jd.location}）`,
        `采集 ${result.totalCrawled} 人，去重后 ${result.totalAfterDedup} 人`,
        "",
      ];

      // 收集有简历的候选人文件
      const files: import("../../shared/types").OutputFile[] = [];

      // 按来源分组
      const grouped = new Map<string, typeof result.topCandidates>();
      for (const c of result.topCandidates) {
        const source = c.source || "其他";
        if (!grouped.has(source)) grouped.set(source, []);
        grouped.get(source)!.push(c);
      }

      for (const [source, candidates] of grouped) {
        lines.push(`━━━ ${source}（${candidates.length} 人）━━━`);
        lines.push("");
        candidates.forEach((c, i) => {
          lines.push(`#${i + 1} ${c.name} — 匹配度 ${c.matchScore}/100`);
          if (c.currentTitle) lines.push(`   职位: ${c.currentTitle}`);
          if (c.location) lines.push(`   地点: ${c.location}`);
          if (c.skills.length > 0) lines.push(`   技能: ${c.skills.slice(0, 5).join(", ")}`);
          if (c.languages.length > 0) lines.push(`   语言: ${c.languages.join(", ")}`);
          if (c.scoreReason) lines.push(`   ${c.scoreReason}`);
          if (c.resumeFileId) {
            lines.push(`   简历: 已下载 ✓`);
            files.push({
              fileId: c.resumeFileId,
              fileName: c.resumeFileName || `resume_${c.name.replace(/\s+/g, "_")}.pdf`,
              mimeType: "application/pdf",
              url: fileService.getAbsoluteUrl(c.resumeFileId),
              size: 0,
            });
          } else if (c.sourceUrl) {
            lines.push(`   Profile: ${c.sourceUrl}`);
          }
          lines.push("");
        });
      }

      return {
        runId: uuidv4(),
        skillId: "recruitment_sourcing",
        status: "success",
        summary: lines.join("\n"),
        files: files.length > 0 ? files : undefined,
      };
    } catch (err) {
      logger.error("Recruitment skill execution failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "recruitment_sourcing",
        status: "error",
        summary: `招聘执行失败: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }
  }
}
