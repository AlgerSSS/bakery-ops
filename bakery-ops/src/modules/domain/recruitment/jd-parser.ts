import { aiProvider } from "../ai/ai-provider";
import type { ParsedJD } from "./types";
import { logger } from "../../shared/logger";

export async function parseJD(rawText: string): Promise<ParsedJD> {
  const prompt = `你是一个招聘 JD 解析器。请从以下招聘描述中提取结构化信息。
注意：jobTitle 必须是英文（用于在招聘网站搜索），如果原文是中文请翻译。

招聘描述：
"""
${rawText}
"""

请返回 JSON 格式（不要返回其他内容）：
{
  "jobTitle": "英文岗位名称（如 Bakery Staff, Kitchen Helper, Cashier）",
  "location": "工作地点（如未提及默认 Kuala Lumpur）",
  "requirements": ["要求1", "要求2"],
  "preferredSkills": ["优先技能1"],
  "experienceYears": 0,
  "languageRequirements": ["语言要求"],
  "salaryRange": "薪资范围（如有）",
  "jobType": "full_time"
}`;

  try {
    const response = await aiProvider.chatCompletionLong(prompt);
    const jsonStr = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    return {
      jobTitle: parsed.jobTitle || "Staff",
      location: parsed.location || "Kuala Lumpur",
      requirements: parsed.requirements || [],
      preferredSkills: parsed.preferredSkills || [],
      experienceYears: parsed.experienceYears || 0,
      languageRequirements: parsed.languageRequirements || [],
      salaryRange: parsed.salaryRange,
      jobType: parsed.jobType || "full_time",
      rawText,
    };
  } catch (err) {
    logger.error("JD parsing failed, using fallback", { error: String(err) });
    // 降级：简单提取
    return {
      jobTitle: extractEnglishTitle(rawText),
      location: "Kuala Lumpur",
      requirements: [],
      preferredSkills: [],
      experienceYears: 0,
      languageRequirements: [],
      jobType: "full_time",
      rawText,
    };
  }
}

/** 从中文 JD 中提取英文搜索关键词 */
function extractEnglishTitle(text: string): string {
  const mapping: Record<string, string> = {
    "店员": "retail staff",
    "前场": "front of house",
    "后厨": "kitchen staff",
    "师傅": "chef",
    "烘焙": "bakery",
    "面包": "bakery",
    "蛋糕": "pastry",
    "收银": "cashier",
    "服务员": "waiter",
    "经理": "manager",
    "主管": "supervisor",
  };

  for (const [cn, en] of Object.entries(mapping)) {
    if (text.includes(cn)) return en;
  }
  return "staff";
}
