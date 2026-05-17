import { query } from "@/modules/shared/db/postgres";

interface PromptSegmentRow {
  segment_key: string;
  category: string;
  content: string;
  variables: string;
}

interface PromptTemplateRow {
  template_key: string;
  title: string;
  system_instruction_key: string;
  segment_keys: string;
  model: string;
  temperature: number;
  top_p: number;
}

export interface BuildPromptResult {
  systemInstruction: string;
  prompt: string;
  model: string;
  temperature: number;
  topP: number;
}

export async function buildPrompt(
  templateKey: string,
  vars: Record<string, string>
): Promise<BuildPromptResult> {
  const templates = await query<PromptTemplateRow>(
    "SELECT template_key, title, system_instruction_key, segment_keys, model, temperature, top_p FROM prompt_template WHERE template_key = $1 AND is_active = true",
    [templateKey]
  );

  if (!templates || templates.length === 0) {
    throw new Error(`Prompt template "${templateKey}" not found or inactive`);
  }
  const template = templates[0];

  const segmentKeys = template.segment_keys.split(",").map((k) => k.trim());

  const allKeys = [template.system_instruction_key, ...segmentKeys];
  const placeholders = allKeys.map((_, i) => `$${i + 1}`).join(",");
  const segments = await query<PromptSegmentRow>(
    `SELECT segment_key, category, content, variables FROM prompt_segment WHERE segment_key IN (${placeholders}) AND is_active = true`,
    allKeys
  );
  const segmentMap = new Map(segments.map((s) => [s.segment_key, s]));

  const sysSegment = segmentMap.get(template.system_instruction_key);
  const systemInstruction = sysSegment ? replaceVars(sysSegment.content, vars) : "";

  const promptParts: string[] = [];
  for (const key of segmentKeys) {
    const seg = segmentMap.get(key);
    if (seg) {
      promptParts.push(replaceVars(seg.content, vars));
    }
  }

  return {
    systemInstruction,
    prompt: promptParts.join("\n\n"),
    model: template.model,
    temperature: template.temperature,
    topP: template.top_p,
  };
}

function replaceVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] ?? "");
}

export async function previewPrompt(
  templateKey: string,
  sampleVars?: Record<string, string>
): Promise<{ systemInstruction: string; fullPrompt: string }> {
  const vars = sampleVars || {
    year: "2026",
    month: "4",
    daysInMonth: "30",
    cityInfo: "吉隆坡",
    holidayInfo: "[示例节假日数据]",
    adjacentInfo: "[示例相邻月数据]",
    yearOverview: "[示例全年概览]",
    eventsInfo: "[示例事件数据]",
  };
  const result = await buildPrompt(templateKey, vars);
  return {
    systemInstruction: result.systemInstruction,
    fullPrompt: result.prompt,
  };
}
