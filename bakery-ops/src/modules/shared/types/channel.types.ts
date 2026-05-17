// 渠道消息类型定义

export interface ChannelMessage {
  channel: "whatsapp" | "web" | "api" | "cron";
  messageId: string;
  conversationId: string;
  userId?: string;
  phone?: string;
  text?: string;
  attachments?: ChannelAttachment[];
  timestamp: string;
  rawPayload?: unknown;
}

export interface ChannelAttachment {
  type: "image" | "document" | "audio" | "video";
  mimeType: string;
  url?: string;
  localPath?: string;
  fileName?: string;
}

export interface ChannelResponse {
  type: "text" | "document" | "image" | "interactive" | "batch";
  text?: string;
  files?: import("./common.types").OutputFile[];
  actions?: NextAction[];
  metadata?: Record<string, unknown>;
}

export interface NextAction {
  label: string;
  actionId: string;
  payload?: Record<string, unknown>;
}
