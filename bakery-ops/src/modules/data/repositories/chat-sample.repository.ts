import { query } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";
import type { ChatSampleRow } from "../../domain/marketing/types";

export type { ChatSampleRow };

export class ChatSampleRepository {
  async create(data: {
    kol_id?: string;
    platform: string;
    message_content: string;
    message_type: "dm_sent" | "dm_received" | "comment" | "post";
    chat_context?: Record<string, unknown>;
  }): Promise<ChatSampleRow | null> {
    try {
      const rows = await query<ChatSampleRow>(
        `INSERT INTO marketing_chat_samples (kol_id, platform, message_content, message_type, chat_context, captured_at)
         VALUES (?, ?, ?, ?, ?::jsonb, ?)
         RETURNING id, kol_id, platform, message_content, message_type, chat_context, captured_at, created_at`,
        [
          data.kol_id ?? null,
          data.platform,
          data.message_content,
          data.message_type,
          JSON.stringify(data.chat_context || {}),
          new Date().toISOString(),
        ],
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("Failed to create chat sample", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getByKOLId(kolId: string): Promise<ChatSampleRow[]> {
    try {
      return await query<ChatSampleRow>(
        "SELECT * FROM marketing_chat_samples WHERE kol_id = ? ORDER BY captured_at ASC",
        [kolId],
      );
    } catch {
      return [];
    }
  }

  async getRecent(limit = 50): Promise<ChatSampleRow[]> {
    try {
      return await query<ChatSampleRow>(
        "SELECT * FROM marketing_chat_samples ORDER BY captured_at DESC LIMIT ?",
        [limit],
      );
    } catch {
      return [];
    }
  }
}

export const chatSampleRepository = new ChatSampleRepository();
