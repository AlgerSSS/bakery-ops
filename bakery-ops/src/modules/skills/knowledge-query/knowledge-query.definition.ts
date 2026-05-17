import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { lightragClient } from "../../domain/knowledge/lightrag-client";
import { employeeRepository } from "../../data/repositories/employee.repository";
import { aiProvider } from "../../domain/ai/ai-provider";
import { logger } from "../../shared/logger";

export const knowledgeQuerySkillDefinition: SkillDefinition = {
  skillId: "knowledge_query",
  name: "知识查询",
  description: "查询员工数据规律、离职分析、招聘效果、团队统计等",
  priority: 80,
  triggerKeywords: [
    "分析", "规律", "离职率", "留存", "什么样的人",
    "数据", "统计", "趋势", "效果", "多少人",
    "离职原因", "团队", "人员",
  ],
  examples: [
    "最近离职的人都是什么原因",
    "什么样的人在我们公司待得久",
    "目前有多少在职员工",
    "烘焙岗位的离职率高吗",
  ],
  requiredInputs: [],
  optionalInputs: [],
  permissions: ["employee.manage"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: false,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

export class KnowledgeQuerySkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const question = String(input.input.jdText || "");

    try {
      // 1. Query LightRAG knowledge graph (if available)
      let knowledgeAnswer: string | null = null;
      const ragAvailable = await lightragClient.isAvailable();
      if (ragAvailable) {
        knowledgeAnswer = await lightragClient.query(question, "hybrid");
      }

      // 2. Get DB stats
      const stats = await employeeRepository.getStats();

      // 3. LLM synthesizes the answer
      const prompt = `你是 Hot Crush 的数据分析助手。请根据以下信息回答用户的问题。

用户问题: ${question}

${knowledgeAnswer ? `知识图谱分析:\n${knowledgeAnswer}\n` : "（知识图谱暂未启用）\n"}
数据库统计:
- 总员工数: ${stats.total}
- 在职: ${stats.active}
- 已离职: ${stats.resigned}
- 平均在职时长: ${stats.avgTenure} 个月
- 本月离职: ${stats.resignedThisMonth}

请用自然语言回答，包含具体数据支撑。如果数据不足以回答，诚实说明。`;

      const reply = await aiProvider.chatCompletionLong(prompt);

      return {
        runId: uuidv4(),
        skillId: "knowledge_query",
        status: "success",
        summary: reply,
      };
    } catch (err) {
      logger.error("Knowledge query failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "knowledge_query",
        status: "error",
        summary: `查询失败: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }
  }
}
