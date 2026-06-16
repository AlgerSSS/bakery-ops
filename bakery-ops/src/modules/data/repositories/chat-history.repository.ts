import { supabase } from "../supabase";
import { logger } from "../../shared/logger";
import type { ChatHistoryEntry } from "../../orchestrator/conversation-manager";

export class ChatHistoryRepository {
  async replace(conversationId: string, entries: ChatHistoryEntry[]): Promise<void> {
    try {
      await supabase.from("chat_history").delete().eq("conversation_id", conversationId);
      if (entries.length === 0) return;
      const now = Date.now();
      await supabase.from("chat_history").insert(
        entries.map((entry, i) => ({
          conversation_id: conversationId,
          role: entry.role,
          content: entry.content,
          // preserve ordering of the trimmed window via monotonic timestamps
          created_at: new Date(now + i).toISOString(),
        })),
      );
    } catch (err) {
      logger.debug("chat_history persist skipped", { error: String(err) });
    }
  }

  async getByConversation(conversationId: string): Promise<ChatHistoryEntry[]> {
    try {
      const { data, error } = await supabase
        .from("chat_history")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error || !data) return [];
      return data.map((row) => ({
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
