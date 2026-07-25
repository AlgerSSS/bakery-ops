// Skill 类型定义

export interface SkillDefinition {
  skillId: string;
  name: string;
  description: string;
  priority: number;
  triggerKeywords: string[];
  /** 仅对易混淆的技能填写：一句话点明该技能与相邻技能的边界，注入到 LLM 分类提示中（替代旧的硬编码规则块）。 */
  disambiguation?: string;
  examples: string[];
  requiredInputs: SkillInput[];
  optionalInputs: SkillInput[];
  permissions: string[];
  riskLevel: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  supportsMultiTurn: boolean;
  supportsFiles: boolean;
  supportsCron: boolean;
  outputTypes: string[];
  handler: SkillHandler | null;
}

export interface SkillInput {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "enum";
  description: string;
  promptQuestion?: string;
  enumValues?: string[];
  defaultValue?: unknown;
}

export interface SkillExecutionInput {
  skillId: string;
  userId: string;
  channel: "whatsapp" | "lark" | "web" | "api" | "cron";
  conversationId: string;
  input: Record<string, unknown>;
  rawMessage?: import("./channel.types").ChannelMessage;
}

export interface SkillExecutionResult {
  runId: string;
  skillId: string;
  status: "success" | "error" | "pending" | "queued";
  summary: string;
  data?: Record<string, unknown>;
  files?: import("./common.types").OutputFile[];
  nextActions?: import("./channel.types").NextAction[];
  error?: string;
}

export interface SkillHandler {
  execute(input: SkillExecutionInput): Promise<SkillExecutionResult>;
}

export interface RouteResult {
  selectedSkill: SkillDefinition;
  confidence: number;
  layer: 1 | 2 | 3;
  matchedKeyword?: string;
}
