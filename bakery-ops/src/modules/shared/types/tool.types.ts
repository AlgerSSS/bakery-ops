// Tool 类型定义（Skill 内部可调用的工具）

export interface ToolDefinition {
  toolId: string;
  name: string;
  description: string;
  permissions: string[];
  parameters: ToolParameter[];
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
