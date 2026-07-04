import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { postJobInteractive, type PostingState } from "../../domain/recruitment/posting/posting.service";
import { fileService } from "../../domain/files/file-service";
import { logger } from "../../shared/logger";
import * as fs from "fs";

export const jobPostingSkillDefinition: SkillDefinition = {
  skillId: "job_posting",
  name: "发布职位",
  description: "将中文岗位需求生成英文 JD，发布到 JobStreet 招聘平台",
  priority: 90,
  disambiguation: "把岗位发布/上架到招聘网站；不是采集候选人(recruitment_sourcing)，也不是查看已在招岗位(active_jobs)",
  triggerKeywords: ["发岗位", "发职位", "post job", "上架", "挂职位", "发布职位", "发一个岗位"],
  examples: [
    "帮我发一个收银员岗位",
    "发布一个烘焙师傅的职位，要求3年经验",
    "帮我在招聘网站上架一个前场店员的岗位",
  ],
  requiredInputs: [
    { name: "jdText", type: "string", description: "岗位描述（中文）", promptQuestion: "请描述你要发布的岗位（岗位名称、地点、要求、薪资等）" },
  ],
  optionalInputs: [
    { name: "location", type: "string", description: "工作地点" },
    { name: "salary", type: "string", description: "薪资范围" },
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

export class JobPostingSkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const currentState = input.input._postingState as PostingState | undefined;
    const userReply = String(input.input.text || "");
    const rawJd = String(input.input.jdText || "");

    try {
      const result = await postJobInteractive(rawJd, currentState, userReply);

      // 把截图保存为 OutputFile
      const files = await saveScreenshots(result.images);

      if (result.waitForConfirm) {
        // 返回 pending 状态，orchestrator 会保存 state 等用户回复
        return {
          runId: uuidv4(),
          skillId: "job_posting",
          status: "pending",
          summary: result.messages.join("\n"),
          data: { _postingState: result.state },
          files: files.length > 0 ? files : undefined,
        };
      }

      // 流程结束
      const hasPosted = result.state.jsResult?.status === "posted";
      return {
        runId: uuidv4(),
        skillId: "job_posting",
        status: hasPosted ? "success" : result.state.step === "done" && !result.state.jsResult ? "success" : "error",
        summary: result.messages.join("\n"),
        files: files.length > 0 ? files : undefined,
      };
    } catch (err) {
      logger.error("Job posting skill failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "job_posting",
        status: "error",
        summary: `职位发布失败: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }
  }
}

async function saveScreenshots(imagePaths?: string[]) {
  if (!imagePaths || imagePaths.length === 0) return [];

  const files = [];
  for (const imgPath of imagePaths) {
    try {
      if (!fs.existsSync(imgPath)) continue;
      const buffer = fs.readFileSync(imgPath);
      const fileName = imgPath.split("/").pop() || "screenshot.png";
      const file = await fileService.saveFile(buffer, fileName, "image/png");
      files.push(file);
    } catch (err) {
      logger.warn("Failed to save screenshot", { path: imgPath, error: String(err) });
    }
  }
  return files;
}
