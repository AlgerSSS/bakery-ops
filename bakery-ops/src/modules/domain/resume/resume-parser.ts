import { aiProvider } from "../ai/ai-provider";
import { logger } from "../../shared/logger";
import type { ParsedResume } from "./types";

const RESUME_PARSE_PROMPT = `你是一个简历解析器。请从以下简历/候选人信息中提取结构化数据。
尽可能多地提取信息，缺失的字段留空或不返回。

简历内容：
"""
{TEXT}
"""

请返回 JSON 格式（不要返回其他内容）：
{
  "gender": "male/female/other（如能推断）",
  "age": null,
  "education_level": "high_school/diploma/bachelor/master/phd",
  "school": "学校名称",
  "major": "专业",
  "graduation_year": null,
  "work_experience": [
    {
      "company": "公司名",
      "title": "职位",
      "start_date": "YYYY-MM",
      "end_date": "YYYY-MM 或 present",
      "duration_months": 12,
      "description": "工作内容简述",
      "industry": "行业"
    }
  ],
  "project_experience": [
    {
      "name": "项目名",
      "role": "角色",
      "description": "项目描述",
      "technologies": ["技术1"]
    }
  ],
  "total_years_experience": null,
  "salary_expectation": { "min": null, "max": null, "currency": "MYR" },
  "current_salary": { "amount": null, "currency": "MYR" },
  "job_level": "junior/mid/senior/lead",
  "certifications": ["证书1"],
  "nationality": "国籍",
  "availability": "immediate/1 month/2 months"
}`;

export async function parseResumeText(rawText: string): Promise<ParsedResume> {
  const truncated = rawText.slice(0, 4000);
  const prompt = RESUME_PARSE_PROMPT.replace("{TEXT}", truncated);

  try {
    const response = await aiProvider.chatCompletionLong(prompt);
    const jsonStr = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    return normalize(parsed);
  } catch (err) {
    logger.error("Resume text parsing failed", { error: String(err) });
    return { work_experience: [], project_experience: [], certifications: [] };
  }
}

export async function parseResumeFile(buffer: Buffer, mimeType: string): Promise<ParsedResume> {
  let text = "";

  if (mimeType === "application/pdf") {
    // @ts-expect-error pdf-parse v2 type mismatch
    const pdfParse = (await import("pdf-parse")).default ?? (await import("pdf-parse"));
    const data = await pdfParse(buffer);
    text = data.text;
  } else if (mimeType.startsWith("image/")) {
    const base64 = buffer.toString("base64");
    const visionPrompt = `请提取这张简历图片中的所有文字内容，保持原始格式。只返回提取的文字，不要其他说明。`;
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY || ""}`,
      },
      body: JSON.stringify({
        model: process.env.AI_VISION_MODEL || "openai/gpt-4o",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: visionPrompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        }],
        max_tokens: 2000,
      }),
    });
    if (!res.ok) {
      logger.warn("Resume OCR request failed", { status: res.status, statusText: res.statusText });
      text = "";
    } else {
      const data = await res.json() as any;
      text = data.choices?.[0]?.message?.content || "";
    }
  } else {
    text = buffer.toString("utf-8");
  }

  if (!text.trim()) {
    logger.warn("Resume file extraction returned empty text", { mimeType });
    return { work_experience: [], project_experience: [], certifications: [] };
  }

  return parseResumeText(text);
}

export async function parseFromCandidateData(
  rawData: Record<string, unknown>,
  experienceText?: string,
  educationText?: string,
): Promise<ParsedResume> {
  const parts: string[] = [];

  if (rawData.name) parts.push(`Name: ${rawData.name}`);
  if (rawData.currentTitle) parts.push(`Current Title: ${rawData.currentTitle}`);
  if (rawData.location) parts.push(`Location: ${rawData.location}`);
  if (rawData.skills) parts.push(`Skills: ${Array.isArray(rawData.skills) ? rawData.skills.join(", ") : rawData.skills}`);
  if (rawData.languages) parts.push(`Languages: ${Array.isArray(rawData.languages) ? rawData.languages.join(", ") : rawData.languages}`);
  if (educationText) parts.push(`Education: ${educationText}`);
  if (experienceText) parts.push(`Experience: ${experienceText}`);

  // Include any additional raw fields
  for (const [key, value] of Object.entries(rawData)) {
    if (value && !["name", "currentTitle", "location", "skills", "languages"].includes(key)) {
      const str = typeof value === "string" ? value : JSON.stringify(value);
      if (str.length < 500) parts.push(`${key}: ${str}`);
    }
  }

  const combined = parts.join("\n");
  if (!combined.trim()) {
    return { work_experience: [], project_experience: [], certifications: [] };
  }

  return parseResumeText(combined);
}

function normalize(raw: Record<string, unknown>): ParsedResume {
  return {
    gender: validEnum(raw.gender, ["male", "female", "other"]),
    age: typeof raw.age === "number" ? raw.age : undefined,
    education_level: validEnum(raw.education_level, ["high_school", "diploma", "bachelor", "master", "phd"]),
    school: str(raw.school),
    major: str(raw.major),
    graduation_year: typeof raw.graduation_year === "number" ? raw.graduation_year : undefined,
    work_experience: Array.isArray(raw.work_experience) ? raw.work_experience : [],
    project_experience: Array.isArray(raw.project_experience) ? raw.project_experience : [],
    total_years_experience: typeof raw.total_years_experience === "number" ? raw.total_years_experience : undefined,
    salary_expectation: raw.salary_expectation && typeof raw.salary_expectation === "object" ? raw.salary_expectation as ParsedResume["salary_expectation"] : undefined,
    current_salary: raw.current_salary && typeof raw.current_salary === "object" ? raw.current_salary as ParsedResume["current_salary"] : undefined,
    job_level: str(raw.job_level),
    certifications: Array.isArray(raw.certifications) ? raw.certifications : [],
    nationality: str(raw.nationality),
    availability: str(raw.availability),
  };
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}

function validEnum<T extends string>(v: unknown, allowed: T[]): T | undefined {
  if (typeof v === "string" && allowed.includes(v as T)) return v as T;
  return undefined;
}
