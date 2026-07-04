import { z } from "zod";
import { employeeRepository, type EmployeeRow } from "../../data/repositories/employee.repository";
import { employeeEventRepository } from "../../data/repositories/employee-event.repository";
import { screeningRuleRepository } from "../../data/repositories/screening-rule.repository";
import { lightragClient } from "../knowledge/lightrag-client";
import { aiProvider } from "../ai/ai-provider";
import { logger } from "../../shared/logger";

// G3b: LLM 输出 upsert 进 screening_rules 前的形状校验。
// description/evidence 必须是字符串；其余字段与既有 `|| 默认值` 兜底保持一致的宽松度。
const extractedRuleSchema = z.object({
  rule_type: z.string().optional(),
  category: z.string().optional(),
  description: z.string(),
  evidence: z.string(),
  confidence: z.number().optional(),
  job_titles: z.array(z.string()).optional(),
});
const extractedRulesSchema = z.array(extractedRuleSchema);

/**
 * 从员工历史数据中提炼筛选规则。
 * 触发时机：
 * 1. 员工离职时（事件触发）
 * 2. 每周定时全量分析
 * 3. 老板手动触发
 */
export async function extractRules(): Promise<{ rulesExtracted: number; error?: string }> {
  try {
    // 1. 获取所有已离职和在职员工
    const resigned = await employeeRepository.getByStatus("resigned");
    const terminated = await employeeRepository.getByStatus("terminated");
    const active = await employeeRepository.getByStatus("hired");

    const allResigned = [...resigned, ...terminated];
    const totalSamples = allResigned.length + active.length;

    if (totalSamples < 3) {
      logger.info("Not enough data for rule extraction", { total: totalSamples });
      return { rulesExtracted: 0 };
    }

    // 2. 获取离职员工的事件历史
    const resignedWithEvents = await Promise.all(
      allResigned.map(async (emp) => {
        const events = await employeeEventRepository.getByEmployee(emp.id);
        return { ...emp, events };
      }),
    );

    // 3. 构造分析 prompt
    const prompt = buildExtractionPrompt(resignedWithEvents, active, totalSamples);

    // 4. LLM 分析
    const response = await aiProvider.chatCompletionLong(prompt);
    const jsonStr = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    let rulesJson: unknown;
    try {
      rulesJson = JSON.parse(jsonStr);
      if (!Array.isArray(rulesJson)) rulesJson = [];
    } catch {
      logger.error("Failed to parse rule extraction response", { response: jsonStr.slice(0, 200) });
      return { rulesExtracted: 0, error: "LLM response not valid JSON" };
    }

    const validated = extractedRulesSchema.safeParse(rulesJson);
    if (!validated.success) {
      logger.error("Rule extraction response failed schema validation", {
        issues: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        response: jsonStr.slice(0, 200),
      });
      return { rulesExtracted: 0, error: "LLM response failed schema validation" };
    }
    const rules = validated.data;

    // 5. 写入 screening_rules 表
    let saved = 0;
    for (const rule of rules) {
      try {
        await screeningRuleRepository.upsert({
          rule_type: rule.rule_type || "neutral",
          category: rule.category || "retention",
          description: rule.description,
          evidence: rule.evidence,
          confidence: Math.min(1, Math.max(0, rule.confidence || 0.5)),
          sample_count: totalSamples,
          job_titles: rule.job_titles || [],
          departments: [],
          is_active: true,
        });
        saved++;
      } catch (err) {
        logger.warn("Failed to save rule", { description: rule.description, error: String(err) });
      }
    }

    // 6. 喂入 LightRAG
    if (rules.length > 0) {
      const rulesText = rules
        .map((r) => `筛选规则: ${r.description}\n证据: ${r.evidence}\n置信度: ${r.confidence}`)
        .join("\n\n");
      lightragClient.ingest(`筛选规则更新 (${new Date().toISOString()})\n\n${rulesText}`).catch(() => {});
    }

    logger.info("Rule extraction completed", { extracted: rules.length, saved });
    return { rulesExtracted: saved };
  } catch (err) {
    logger.error("Rule extraction failed", { error: String(err) });
    return { rulesExtracted: 0, error: String(err) };
  }
}

function formatEmployeeForAnalysis(emp: EmployeeRow, events?: Array<{ event_type: string; summary: string; data?: unknown }>): string {
  const lines = [
    `姓名: ${emp.name}`,
    `岗位: ${emp.job_title || "未知"}`,
    `门店: ${emp.store_id || "未知"}`,
    `状态: ${emp.status}`,
    `技能: ${emp.skills.join(", ") || "未知"}`,
    `语言: ${emp.languages.join(", ") || "未知"}`,
    `学历: ${emp.education || "未知"}`,
    `来源: ${emp.source || "未知"}`,
  ];

  if (emp.hired_at) lines.push(`入职时间: ${emp.hired_at}`);
  if (emp.resigned_at) lines.push(`离职时间: ${emp.resigned_at}`);

  if (events && events.length > 0) {
    lines.push(`事件记录:`);
    for (const e of events) {
      lines.push(`  - [${e.event_type}] ${e.summary}`);
    }
  }

  return lines.join("\n");
}

function buildExtractionPrompt(
  resignedWithEvents: Array<EmployeeRow & { events: Array<{ event_type: string; summary: string; data?: unknown }> }>,
  active: EmployeeRow[],
  totalSamples: number,
): string {
  const resignedText = resignedWithEvents
    .map((e) => formatEmployeeForAnalysis(e, e.events))
    .join("\n---\n");

  const activeText = active
    .slice(0, 20) // Limit to avoid token overflow
    .map((e) => formatEmployeeForAnalysis(e))
    .join("\n---\n");

  return `你是 Hot Crush 的 HR 数据分析师。请分析以下员工数据，提炼出招聘筛选规则。

已离职/被辞退员工 (${resignedWithEvents.length} 人):
${resignedText || "（暂无数据）"}

在职员工 (${active.length} 人):
${activeText || "（暂无数据）"}

请提炼规则，返回 JSON 数组（不要返回其他内容）:
[
  {
    "rule_type": "negative",
    "category": "retention",
    "description": "规则描述（具体、可操作）",
    "evidence": "支撑证据（引用具体员工数据）",
    "confidence": 0.75,
    "job_titles": ["适用岗位，空数组=全部"]
  }
]

规则类型:
- positive: 正面特征（留存率高、绩效好）
- negative: 负面特征（离职风险高）
- neutral: 中性观察

类别:
- retention: 留存相关
- performance: 绩效相关
- culture_fit: 文化匹配

要求:
- 每条规则必须有具体证据支撑
- confidence 基于样本量和一致性（样本少则低）
- 至少提炼 1 条规则，最多 5 条
- 如果数据太少无法得出可靠结论，降低 confidence 并在 evidence 中说明`;
}
