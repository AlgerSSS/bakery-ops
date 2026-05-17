import { aiProvider } from "../ai/ai-provider";
import type { Candidate, ParsedJD, ScoredCandidate } from "./types";
import { screeningRuleRepository } from "../../data/repositories/screening-rule.repository";
import { logger } from "../../shared/logger";

/**
 * 使用 OpenRouter API 对候选人进行匹配评分
 * 注入历史筛选规则提升评分准确度
 */
export async function scoreCandidates(
  candidates: Candidate[],
  jd: ParsedJD,
): Promise<ScoredCandidate[]> {
  // 预加载与该岗位相关的筛选规则
  let rulesText = "";
  try {
    const rules = await screeningRuleRepository.getActiveRules(jd.jobTitle);
    if (rules.length > 0) {
      rulesText = rules
        .map((r) => `- [${r.rule_type}] ${r.description} (置信度: ${r.confidence})`)
        .join("\n");
      logger.info("Screening rules loaded for scoring", { count: rules.length });
    }
  } catch {
    // DB not available yet — proceed without rules
  }

  const scored: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    try {
      const score = await scoreOne(candidate, jd, rulesText);
      scored.push(score);
    } catch (err) {
      logger.warn("Scoring failed for candidate", {
        candidateId: candidate.candidateId,
        error: String(err),
      });
      scored.push({
        ...candidate,
        matchScore: 0,
        scoreBreakdown: { skillMatch: 0, experienceMatch: 0, locationMatch: 0, languageMatch: 0 },
        scoreReason: "评分失败",
      });
    }
  }

  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored;
}

async function scoreOne(candidate: Candidate, jd: ParsedJD, rulesText: string): Promise<ScoredCandidate> {
  const rulesSection = rulesText
    ? `\n【历史数据提炼的筛选规则】\n${rulesText}\n请在评分时参考这些规则。\n`
    : "";

  const prompt = `你是一个招聘匹配评分专家。请根据岗位要求对候选人进行匹配评分。

岗位要求：
- 岗位: ${jd.jobTitle}
- 地点: ${jd.location}
- 要求: ${jd.requirements.join(", ")}
- 优先技能: ${jd.preferredSkills.join(", ")}
- 经验要求: ${jd.experienceYears} 年
- 语言要求: ${jd.languageRequirements.join(", ")}

候选人信息：
- 姓名: ${candidate.name}
- 当前职位: ${candidate.currentTitle || "未知"}
- 地点: ${candidate.location || "未知"}
- 技能: ${candidate.skills.join(", ") || "未知"}
- 语言: ${candidate.languages.join(", ") || "未知"}
- 经历: ${(candidate.experience || "").slice(0, 300)}
- 简介: ${candidate.summary || "无"}
${rulesSection}
请返回 JSON 格式（不要返回其他内容）：
{
  "matchScore": 75,
  "skillMatch": 80,
  "experienceMatch": 70,
  "locationMatch": 90,
  "languageMatch": 60,
  "reason": "一句话说明匹配原因"
}

matchScore 为 0-100 的综合分数。`;

  const response = await aiProvider.chatCompletionLong(prompt);
  const jsonStr = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(jsonStr);

  return {
    ...candidate,
    matchScore: parsed.matchScore || 0,
    scoreBreakdown: {
      skillMatch: parsed.skillMatch || 0,
      experienceMatch: parsed.experienceMatch || 0,
      locationMatch: parsed.locationMatch || 0,
      languageMatch: parsed.languageMatch || 0,
    },
    scoreReason: parsed.reason || "",
  };
}
