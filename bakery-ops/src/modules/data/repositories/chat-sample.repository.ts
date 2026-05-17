import { supabase } from "../supabase";
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
    const { data: row, error } = await supabase
      .from("marketing_chat_samples")
      .insert({
        kol_id: data.kol_id,
        platform: data.platform,
        message_content: data.message_content,
        message_type: data.message_type,
        chat_context: data.chat_context || {},
        captured_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create chat sample", { error: error.message });
      return null;
    }
    return row as ChatSampleRow;
  }

  async getByKOLId(kolId: string): Promise<ChatSampleRow[]> {
    const { data, error } = await supabase
      .from("marketing_chat_samples")
      .select("*")
      .eq("kol_id", kolId)
      .order("captured_at", { ascending: true });

    if (error) return [];
    return (data || []) as ChatSampleRow[];
  }

  async getRecent(limit = 50): Promise<ChatSampleRow[]> {
    const { data, error } = await supabase
      .from("marketing_chat_samples")
      .select("*")
      .order("captured_at", { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as ChatSampleRow[];
  }
}

export const chatSampleRepository = new ChatSampleRepository();
