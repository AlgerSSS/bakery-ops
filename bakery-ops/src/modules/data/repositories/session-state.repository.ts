import { supabase } from "../supabase";
import { logger } from "../../shared/logger";
import type { ConversationState } from "../../orchestrator/state-manager";

export class SessionStateRepository {
  async upsert(state: ConversationState): Promise<void> {
    try {
      await supabase.from("session_state").upsert(
        {
          conversation_id: state.conversationId,
          user_id: state.userId ?? null,
          current_skill_id: state.currentSkillId ?? null,
          pending_action: state.pendingAction ?? null,
          collected_inputs: state.collectedInputs,
          missing_inputs: state.missingInputs,
          last_active_at: new Date(state.lastActiveAt).toISOString(),
        },
        { onConflict: "conversation_id" },
      );
    } catch (err) {
      logger.debug("session_state persist skipped", { error: String(err) });
    }
  }

  async delete(conversationId: string): Promise<void> {
    try {
      await supabase.from("session_state").delete().eq("conversation_id", conversationId);
    } catch (err) {
      logger.debug("session_state persist skipped", { error: String(err) });
    }
  }

  async getActive(ttlMs: number): Promise<ConversationState[]> {
    try {
      const cutoff = new Date(Date.now() - ttlMs).toISOString();
      const { data, error } = await supabase
        .from("session_state")
        .select("*")
        .gte("last_active_at", cutoff);
      if (error || !data) return [];
      return data.map((row) => ({
        conversationId: String(row.conversation_id),
        userId: row.user_id ? String(row.user_id) : undefined,
        currentSkillId: row.current_skill_id ? String(row.current_skill_id) : undefined,
        pendingAction: row.pending_action ? String(row.pending_action) : undefined,
        collectedInputs: (row.collected_inputs as Record<string, unknown>) || {},
        missingInputs: (row.missing_inputs as string[]) || [],
        lastActiveAt: new Date(String(row.last_active_at)).getTime(),
      }));
    } catch (err) {
      logger.debug("session_state persist skipped", { error: String(err) });
      return [];
    }
  }
}

export const sessionStateRepository = new SessionStateRepository();
