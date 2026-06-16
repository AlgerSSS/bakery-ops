import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";
import type { ChatHistoryEntry } from "../../orchestrator/conversation-manager";

export class ChatHistoryRepository {
  async replace(conversationId: string, entries: ChatHistoryEntry[]): Promise<void> {
    try {
      await execute("DELETE FROM chat_history WHERE conversation_id = ?", [conversationId]);
      if (entries.length === 0) return;
      const now = Date.now();
      const placeholders = entries.map(() => "(?, ?, ?, ?)").join(",");
      const flat = entries.flatMap((entry, i) => [
        conversationId,
        entry.role,
        entry.content,
        // preserve ordering of the trimmed window via monotonic timestamps
        new Date(now + i).toISOString(),
      ]);
      await execute(
        `INSERT INTO chat_history (conversation_id, role, content, created_at) VALUES ${placeholders}`,
        flat,
      );
    } catch (err) {
      logger.debug("chat_history persist skipped", { error: String(err) });
    }
  }

  async getByConversation(conversationId: string): Promise<ChatHistoryEntry[]> {
    try {
      const rows = await query<{ role: string; content: string }>(
        "SELECT role, content FROM chat_history WHERE conversation_id = ? ORDER BY created_at ASC",
        [conversationId],
      );
      return rows.map((row) => ({
        role: row.role as ChatHistoryEntry["role"],
        content: String(row.content),
      }));
    } catch (err) {
      logger.debug("chat_history persist skipped", { error: String(err) });
      return [];
    }
  }
}

export const chatHistoryRepository = new ChatHistoryRepository();
