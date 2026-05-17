import { aiProvider } from "../ai/ai-provider";
import type { GeneratedJD } from "./types";
import { logger } from "../../shared/logger";

/**
 * 将中文岗位需求转为结构化英文 JD，用于发布到招聘平台
 */
export async function generateJobDescription(rawChineseInput: string): Promise<GeneratedJD> {
  const prompt = `You are a professional HR copywriter for a Malaysian bakery chain (Hot Crush).
Convert the following Chinese job requirement into a structured English job description suitable for posting on Malaysian job portals (JobStreet, AJobThing).

Chinese input:
"""
${rawChineseInput}
"""

Return JSON only (no other text):
{
  "title": "English job title (e.g. Bakery Staff, Kitchen Helper, Cashier)",
  "description": "<p>HTML formatted job description, 2-3 paragraphs about the role and company</p>",
  "requirements": ["requirement 1", "requirement 2"],
  "benefits": ["benefit 1", "benefit 2"],
  "location": "city, state (default: Kuala Lumpur, Selangor)",
  "salaryRange": "RM XXXX - RM XXXX (if mentioned, otherwise omit)",
  "jobType": "full_time",
  "experienceYears": 0,
  "languageRequirements": ["language 1"]
}

Guidelines:
- title should be concise and standard (Bakery Assistant, not 烘焙助手)
- description should be professional but warm, mention Hot Crush as the company
- If salary not mentioned, omit salaryRange
- Default location is Kuala Lumpur if not specified
- Always include Mandarin/Chinese in languageRequirements (this is a Chinese-owned bakery)
- benefits should include reasonable defaults: EPF/SOCSO, annual leave, staff discount`;

  try {
    const response = await aiProvider.chatCompletionLong(prompt);
    const jsonStr = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    return {
      title: parsed.title || fallbackTitle(rawChineseInput),
      description: parsed.description || `<p>We are hiring for ${parsed.title || "this position"}.</p>`,
      requirements: parsed.requirements || [],
      benefits: parsed.benefits || ["EPF/SOCSO", "Annual leave", "Staff discount"],
      location: parsed.location || "Kuala Lumpur, Selangor",
      salaryRange: parsed.salaryRange,
      jobType: parsed.jobType || "full_time",
      experienceYears: parsed.experienceYears || 0,
      languageRequirements: parsed.languageRequirements || ["Mandarin", "Bahasa Malaysia"],
    };
  } catch (err) {
    logger.error("JD generation failed, using fallback", { error: String(err) });
    return {
      title: fallbackTitle(rawChineseInput),
      description: "<p>We are hiring. Please apply if interested.</p>",
      requirements: [],
      benefits: ["EPF/SOCSO", "Annual leave"],
      location: "Kuala Lumpur, Selangor",
      jobType: "full_time",
      experienceYears: 0,
      languageRequirements: ["Mandarin"],
    };
  }
}

/** 从中文输入提取英文职位名（复用 jd-parser 的映射） */
function fallbackTitle(text: string): string {
  const mapping: Record<string, string> = {
    "店员": "Retail Staff",
    "前场": "Front of House Staff",
    "后厨": "Kitchen Staff",
    "师傅": "Chef",
    "烘焙": "Bakery Staff",
    "面包": "Bakery Staff",
    "蛋糕": "Pastry Chef",
    "收银": "Cashier",
    "服务员": "Waiter/Waitress",
    "经理": "Manager",
    "主管": "Supervisor",
  };
  for (const [cn, en] of Object.entries(mapping)) {
    if (text.includes(cn)) return en;
  }
  return "Staff";
}
