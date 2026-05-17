import { query, execute, withTransaction } from "@/modules/shared/db/postgres";
import type {
  PromptSegment,
  PromptTemplate,
} from "@/modules/domain/forecast/types";

// ========== DB Row Types ==========
interface PromptSegmentRow {
  id: number;
  segment_key: string;
  category: string;
  title: string;
  content: string;
  variables: string;
  sort_order: number;
  is_active: boolean;
  version: number;
}

interface PromptTemplateRow {
  id: number;
  template_key: string;
  title: string;
  system_instruction_key: string;
  segment_keys: string;
  model: string;
  temperature: number;
  top_p: number;
  is_active: boolean;
}

// ========== Converters ==========
function rowToPromptSegment(row: PromptSegmentRow): PromptSegment {
  return {
    id: row.id,
    segmentKey: row.segment_key,
    category: row.category as PromptSegment["category"],
    title: row.title,
    content: row.content,
    variables: row.variables,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    version: row.version,
  };
}

function rowToPromptTemplate(row: PromptTemplateRow): PromptTemplate {
  return {
    id: row.id,
    templateKey: row.template_key,
    title: row.title,
    systemInstructionKey: row.system_instruction_key,
    segmentKeys: row.segment_keys,
    model: row.model,
    temperature: row.temperature,
    topP: row.top_p,
    isActive: row.is_active,
  };
}

// ========== Prompt Segments & Templates ==========
export async function getPromptSegments(category?: string): Promise<PromptSegment[]> {
  let sql = "SELECT * FROM prompt_segment";
  const params: string[] = [];
  if (category) { sql += " WHERE category = ?"; params.push(category); }
  sql += " ORDER BY category, sort_order";
  const rows = await query<PromptSegmentRow>(sql, params);
  return rows.map(rowToPromptSegment);
}

export async function upsertPromptSegment(segment: Omit<PromptSegment, "id">): Promise<void> {
  await execute(
    `INSERT INTO prompt_segment (segment_key, category, title, content, variables, sort_order, is_active, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (segment_key) DO UPDATE SET
       category = EXCLUDED.category, title = EXCLUDED.title, content = EXCLUDED.content,
       variables = EXCLUDED.variables, sort_order = EXCLUDED.sort_order, is_active = EXCLUDED.is_active,
       version = prompt_segment.version + 1`,
    [segment.segmentKey, segment.category, segment.title, segment.content, segment.variables, segment.sortOrder, segment.isActive, segment.version]
  );
}

export async function deletePromptSegment(segmentKey: string): Promise<void> {
  await execute("DELETE FROM prompt_segment WHERE segment_key = ?", [segmentKey]);
}

export async function getPromptTemplates(): Promise<PromptTemplate[]> {
  const rows = await query<PromptTemplateRow>("SELECT * FROM prompt_template ORDER BY template_key");
  return rows.map(rowToPromptTemplate);
}

export async function upsertPromptTemplate(template: Omit<PromptTemplate, "id">): Promise<void> {
  await execute(
    `INSERT INTO prompt_template (template_key, title, system_instruction_key, segment_keys, model, temperature, top_p, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (template_key) DO UPDATE SET
       title = EXCLUDED.title, system_instruction_key = EXCLUDED.system_instruction_key,
       segment_keys = EXCLUDED.segment_keys, model = EXCLUDED.model, temperature = EXCLUDED.temperature,
       top_p = EXCLUDED.top_p, is_active = EXCLUDED.is_active`,
    [template.templateKey, template.title, template.systemInstructionKey, template.segmentKeys, template.model, template.temperature, template.topP, template.isActive]
  );
}

export async function deletePromptTemplate(templateKey: string): Promise<void> {
  await execute("DELETE FROM prompt_template WHERE template_key = ?", [templateKey]);
}