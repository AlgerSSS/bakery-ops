import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";

export type ConversationFsmState =
  | "INTAKE"
  | "AWAITING_INTERVIEW_CONFIRM"
  | "INTERVIEW_SCHEDULED"
  | "AWAITING_TRIAL_CONFIRM"
  | "TRIAL_SCHEDULED"
  | "POST_TRIAL"
  | "DONE"
  | "OPTED_OUT";

export interface CandidateConversationRow {
  id: string;
  store_id: string;
  application_id?: string;
  phone: string;
  state: ConversationFsmState;
  context: Record<string, unknown>;
  opted_out: boolean;
  last_inbound_at?: string;
  last_outbound_at?: string;
  created_at: string;
  updated_at: string;
}

const SELECT_COLS =
  "id, store_id, application_id, phone, state, context, opted_out, " +
  "last_inbound_at::text AS last_inbound_at, last_outbound_at::text AS last_outbound_at, " +
  "created_at::text AS created_at, updated_at::text AS updated_at";

function mapRow(row: CandidateConversationRow): CandidateConversationRow {
  if (typeof row.context === "string") {
    row.context = JSON.parse(row.context) as Record<string, unknown>;
  }
  return row;
}

export class CandidateConversationRepository {
  async getByPhone(storeId: string, phone: string): Promise<CandidateConversationRow | null> {
    try {
      const rows = await query<CandidateConversationRow>(
        `SELECT ${SELECT_COLS} FROM candidate_conversations WHERE store_id = ? AND phone = ? LIMIT 1`,
        [storeId, phone],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    } catch (error) {
      logger.error("candidate-conversation.repository.getByPhone failed", { error: String(error) });
      return null;
    }
  }

  /**
   * Upsert one conversation per (store_id, phone). Sets the FSM state and shallow-merges contextPatch
   * into the existing context. NOTE: the merge is done in JS (existing then patch — patch keys win) and
   * the merged object is passed DIRECTLY as a jsonb param. Do NOT `JSON.stringify(...)::jsonb` here:
   * in this pg driver a stringified value casts to a jsonb *string scalar* (not an object), which makes
   * `context->>'key'` return null and breaks a SQL-side `||` merge (it concatenates two scalars into an
   * array). Passing the object lets the driver encode a proper jsonb object.
   */
  async upsertState(
    storeId: string,
    phone: string,
    state: ConversationFsmState,
    contextPatch: Record<string, unknown> = {},
    applicationId?: string,
  ): Promise<CandidateConversationRow | null> {
    try {
      const existing = await this.getByPhone(storeId, phone);
      const merged = { ...(existing?.context || {}), ...contextPatch };
      const rows = await query<CandidateConversationRow>(
        `INSERT INTO candidate_conversations (store_id, phone, state, context, application_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (store_id, phone) DO UPDATE SET
           state = EXCLUDED.state,
           context = EXCLUDED.context,
           application_id = COALESCE(EXCLUDED.application_id, candidate_conversations.application_id),
           updated_at = NOW()
         RETURNING ${SELECT_COLS}`,
        [storeId, phone, state, merged as unknown as string, applicationId ?? null],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    } catch (e) {
      logger.error("Failed to upsert candidate conversation", { storeId, phone, error: (e as Error).message });
      return null;
    }
  }

  async markOptedOut(storeId: string, phone: string): Promise<void> {
    try {
      await execute(
        `UPDATE candidate_conversations
         SET opted_out = TRUE, state = 'OPTED_OUT', updated_at = NOW()
         WHERE store_id = ? AND phone = ?`,
        [storeId, phone],
      );
    } catch (e) {
      logger.error("Failed to mark conversation opted out", { storeId, phone, error: (e as Error).message });
    }
  }

  async isOptedOut(storeId: string, phone: string): Promise<boolean> {
    try {
      const rows = await query<{ opted_out: boolean }>(
        "SELECT opted_out FROM candidate_conversations WHERE store_id = ? AND phone = ? LIMIT 1",
        [storeId, phone],
      );
      return rows[0]?.opted_out === true;
    } catch (error) {
      logger.error("candidate-conversation.repository.isOptedOut failed", { error: String(error) });
      return false;
    }
  }

  async touchInbound(storeId: string, phone: string): Promise<void> {
    try {
      await execute(
        "UPDATE candidate_conversations SET last_inbound_at = NOW(), updated_at = NOW() WHERE store_id = ? AND phone = ?",
        [storeId, phone],
      );
    } catch (e) {
      logger.error("Failed to touch inbound", { storeId, phone, error: (e as Error).message });
    }
  }

  async touchOutbound(storeId: string, phone: string): Promise<void> {
    try {
      await execute(
        "UPDATE candidate_conversations SET last_outbound_at = NOW(), updated_at = NOW() WHERE store_id = ? AND phone = ?",
        [storeId, phone],
      );
    } catch (e) {
      logger.error("Failed to touch outbound", { storeId, phone, error: (e as Error).message });
    }
  }
}

export const candidateConversationRepository = new CandidateConversationRepository();
