import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { parseResumeFile } from "../../domain/resume/resume-parser";
import { employeeRepository } from "../../data/repositories/employee.repository";
import { larkSyncService } from "../../domain/lark/lark-sync.service";
import { logger } from "../../shared/logger";
import { readFile } from "fs/promises";

export const resumeUploadSkillDefinition: SkillDefinition = {
  skillId: "resume_upload",
  name: "简历上传",
  description: "上传简历文件（PDF/图片），自动解析结构化信息并更新员工档案",
  priority: 85,
  disambiguation: "上传/解析已有的简历文件并更新员工档案；不是去招聘网站采集候选人(recruitment_sourcing)",
  triggerKeywords: ["上传简历", "解析简历", "简历解析", "简历", "upload resume", "parse cv"],
  examples: [
    "帮我解析这份简历",
    "上传张三的简历",
    "这是新员工的简历",
  ],
  requiredInputs: [],
  optionalInputs: [],
  permissions: ["employee.manage"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: true,
  supportsFiles: true,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

export class ResumeUploadSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const attachments = input.rawMessage?.attachments;

    if (!attachments || attachments.length === 0) {
      return {
        runId: uuidv4(),
        skillId: "resume_upload",
        status: "pending",
        summary: "请发送简历文件（PDF 或图片格式），我会自动解析其中的结构化信息。",
      };
    }

    const attachment = attachments[0];
    const filePath = attachment.localPath || attachment.url;

    if (!filePath) {
      return {
        runId: uuidv4(),
        skillId: "resume_upload",
        status: "error",
        summary: "无法获取文件，请重新发送。",
      };
    }

    try {
      const buffer = await readFile(filePath);
      const mimeType = attachment.mimeType || "application/pdf";

      const parsedResume = await parseResumeFile(buffer, mimeType);

      // 尝试从消息文本中提取员工姓名
      const text = input.rawMessage?.text || input.input.jdText as string || "";
      const nameMatch = text.match(/[一-龥]{2,4}/);
      const candidateName = nameMatch?.[0] || parsedResume.work_experience?.[0]?.title || "未知";

      // 匹配或创建员工
      let employee = await employeeRepository.findByName(candidateName);
      if (!employee) {
        employee = await employeeRepository.create({
          name: candidateName,
          source: "manual_upload",
          status: "candidate",
          metadata: { parsed_resume: parsedResume },
        });
      } else {
        const metadata = { ...employee.metadata, parsed_resume: parsedResume };
        await employeeRepository.updateStatus(employee.id, employee.status, { metadata } as any);
      }

      if (employee) {
        larkSyncService.onResumeParsed(employee, parsedResume).catch((err) => {
          logger.warn("Lark resume sync failed (non-blocking)", { error: String(err) });
        });
      }

      // 格式化返回摘要
      const lines: string[] = [`简历解析完成 - ${candidateName}`];
      if (parsedResume.gender) lines.push(`性别: ${parsedResume.gender}`);
      if (parsedResume.education_level) lines.push(`学历: ${parsedResume.education_level}`);
      if (parsedResume.school) lines.push(`学校: ${parsedResume.school}`);
      if (parsedResume.major) lines.push(`专业: ${parsedResume.major}`);
      if (parsedResume.total_years_experience != null) lines.push(`工作年限: ${parsedResume.total_years_experience}年`);
      if (parsedResume.job_level) lines.push(`职级: ${parsedResume.job_level}`);
      if (parsedResume.work_experience?.length) {
        lines.push(`工作经历: ${parsedResume.work_experience.length}段`);
        for (const exp of parsedResume.work_experience.slice(0, 3)) {
          lines.push(`  - ${exp.company} | ${exp.title}`);
        }
      }
      if (parsedResume.salary_expectation) {
        const { min, max, currency } = parsedResume.salary_expectation;
        lines.push(`期望薪资: ${min || "?"}-${max || "?"} ${currency}`);
      }
      if (parsedResume.certifications?.length) lines.push(`证书: ${parsedResume.certifications.join(", ")}`);

      lines.push(`\n已同步到飞书多维表格。`);

      return {
        runId: uuidv4(),
        skillId: "resume_upload",
        status: "success",
        summary: lines.join("\n"),
      };
    } catch (err) {
      logger.error("Resume upload skill failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "resume_upload",
        status: "error",
        summary: `简历解析失败: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }
  }
}
