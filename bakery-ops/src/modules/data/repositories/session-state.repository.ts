import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";
import type { ConversationState } from "../../orchestrator/state-manager";

interface SessionStateRow {
  conversation_id: string;
  user_id: string | null;
  current_skill_id: string | null;
  pending_action: string | null;
  collected_inputs: unknown;
  missing_inputs: string[] | null;
  last_active_at: string;
}

export class SessionStateRepository {
  async upsert(state: ConversationState): Promise<void> {
    try {
      await execute(
        `INSERT INTO session_state (conversation_id, user_id, current_skill_id, pending_action, collected_inputs, missing_inputs, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (conversation_id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           current_skill_id = EXCLUDED.current_skill_id,
           pending_action = EXCLUDED.pending_action,
           collected_inputs = EXCLUDED.collected_inputs,
           missing_inputs = EXCLUDED.missing_inputs,
           last_active_at = EXCLUDED.last_active_at`,
        [
          state.conversationId,
          state.userId ?? null,
          state.currentSkillId ?? null,
          state.pendingAction ?? null,
          JSON.stringify(state.collectedInputs),
          state.missingInputs,
          new Date(state.lastActiveAt).toISOString(),
        ],
      );
    } catch (err) {
      logger.debug("session_state persist skipped", { error: String(err) });
    }
  }

  async delete(conversationId: string): Promise<void> {
    try {
      await execute("DELETE FROM session_state WHERE conversation_id = ?", [conversationId]);
    } catch (err) {
      logger.debug("session_state persist skipped", { error: String(err) });
    }
  }

  async getActive(ttlMs: number): Promise<ConversationState[]> {
    try {
      const cutoff = new Date(Date.now() - ttlMs).toISOString();
      const rows = await query<SessionStateRow>(
        "SELECT * FROM session_state WHERE last_active_at >= ?",
        [cutoff],
      );
      return rows.map((row) => ({
        conversationId: String(row.conversation_id),
        userId: row.user_id ? String(row.user_id) : undefined,
        currentSkillId: row.current_skill_id ? String(row.current_skill_id) : undefined,
        pendingAction: row.pending_action ? String(row.pending_action) : undefined,
        collectedInputs: parseCollectedInputs(row.collected_inputs),
        missingInputs: (row.missing_inputs as string[]) || [],
        lastActiveAt: new Date(String(row.last_active_at)).getTime(),
      }));
    } catch (err) {
      logger.debug("session_state persist skipped", { error: String(err) });
      return [];
    }
  }
}

function parseCollectedInputs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch (error) {
      logger.error("session-state.repository.parseCollectedInputs failed", { error: String(error) });
      return {};
    }
  }
  return {};
}

export const sessionStateRepository = new SessionStateRepository();
