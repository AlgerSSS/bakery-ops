import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { lightragClient } from "../../domain/knowledge/lightrag-client";
import { employeeRepository } from "../../data/repositories/employee.repository";
import { aiProvider } from "../../domain/ai/ai-provider";
import { queryDataForQuestion } from "../../domain/forecast/ops-data-query";
import { logger } from "../../shared/logger";

export const knowledgeQuerySkillDefinition: SkillDefinition = {
  skillId: "knowledge_query",
  name: "知识查询",
  description: "查询员工数据规律、离职分析、招聘效果、团队统计等，也可查销量/营业额/单品/时段等经营数据",
  priority: 80,
  disambiguation: "对员工/招聘数据做统计、规律与趋势分析，或查单品销量/营业额/时段等经营数据；不是记录单个员工事件(employee_management)，也不是结合销售数据的每日复盘(daily_review_chat)",
  triggerKeywords: [
    "分析", "规律", "离职率", "留存", "什么样的人",
    "数据", "统计", "趋势", "效果", "多少人",
    "离职原因", "团队", "人员", "在职员工",
    "卖得怎么样", "销量", "营业额",
  ],
  examples: [
    "最近离职的人都是什么原因",
    "什么样的人在我们公司待得久",
    "目前有多少在职员工",
    "烘焙岗位的离职率高吗",
    "昨天蛋挞卖得怎么样",
  ],
  requiredInputs: [],
  optionalInputs: [],
  permissions: ["sales.view"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: false,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

function todayKL(): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

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

      // 2. 经营类分支：问题涉及销售/单品/时段时查经营数据 — IMPROVEMENT-PLAN.md F9
      let opsData = "";
      if (/销量|销售|卖|营业额|时段|单品|客单/.test(question)) {
        try {
          opsData = await queryDataForQuestion(question, todayKL());
        } catch (err) {
          logger.warn("Ops data query failed", { error: String(err) });
        }
      }

      // 3. Get DB stats
      const stats = await employeeRepository.getStats();

      // 4. LLM synthesizes the answer
      const prompt = `你是 Hot Crush 的数据分析助手。请根据以下信息回答用户的问题。

用户问题: ${question}

${knowledgeAnswer ? `知识图谱分析:\n${knowledgeAnswer}\n` : "（知识图谱暂未启用）\n"}
${opsData ? `经营数据:\n${opsData}\n` : ""}
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
      // 原始错误只进日志，用户可见文案固定中文 — IMPROVEMENT-PLAN.md G3f
      logger.error("Knowledge query failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "knowledge_query",
        status: "error",
        summary: "AI 分析暂时不可用，请稍后再试",
        error: String(err),
      };
    }
  }
}
