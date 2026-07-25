import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";
import type { KOLCollaborationRow } from "../../domain/marketing/types";

export type { KOLCollaborationRow };

export class KOLCollaborationRepository {
  async create(data: {
    kol_id: string;
    campaign_id?: string;
    status?: string;
    dm_sent?: boolean;
    dm_sent_at?: string;
    dm_template_used?: string;
    metadata?: Record<string, unknown>;
  }): Promise<KOLCollaborationRow | null> {
    try {
      const rows = await query<KOLCollaborationRow>(
        `INSERT INTO kol_collaborations
           (kol_id, campaign_id, status, dm_sent, dm_sent_at, dm_template_used, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          data.kol_id,
          data.campaign_id ?? null,
          data.status || "prospected",
          data.dm_sent || false,
          data.dm_sent_at ?? null,
          data.dm_template_used ?? null,
          JSON.stringify(data.metadata || {}),
        ]
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("Failed to create collaboration", { error: String(error) });
      return null;
    }
  }

  async getByKOLId(kolId: string): Promise<KOLCollaborationRow[]> {
    try {
      return await query<KOLCollaborationRow>(
        "SELECT * FROM kol_collaborations WHERE kol_id = ? ORDER BY created_at DESC",
        [kolId]
      );
    } catch (error) {
      logger.error("kol-collaboration.repository.getByKOLId failed", { error: String(error) });
      return [];
    }
  }

  async getById(id: string): Promise<KOLCollaborationRow | null> {
    try {
      const rows = await query<KOLCollaborationRow>(
        "SELECT * FROM kol_collaborations WHERE id = ?",
        [id]
      );
      return rows[0] ?? null;
    } catch (error) {
      logger.error("kol-collaboration.repository.getById failed", { error: String(error) });
      return null;
    }
  }

  async updateStatus(
    id: string,
    status: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const columns = ["status = ?", "updated_at = ?"];
      const params: unknown[] = [status, new Date().toISOString()];
      for (const [key, value] of Object.entries(extra ?? {})) {
        columns.push(`${key} = ?`);
        params.push(value);
      }
      params.push(id);
      await execute(
        `UPDATE kol_collaborations SET ${columns.join(", ")} WHERE id = ?`,
        params
      );
    } catch (error) {
      logger.error("Failed to update collaboration status", { id, error: String(error) });
    }
  }

  async markDMSent(
    id: string,
    template: string,
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      await execute(
        `UPDATE kol_collaborations
         SET dm_sent = true, dm_sent_at = ?, dm_template_used = ?, status = 'contacted', updated_at = ?
         WHERE id = ?`,
        [now, template, now, id]
      );
    } catch (error) {
      logger.error("Failed to mark DM sent", { id, error: String(error) });
    }
  }

  async getRecent(limit = 20): Promise<KOLCollaborationRow[]> {
    try {
      return await query<KOLCollaborationRow>(
        "SELECT * FROM kol_collaborations ORDER BY created_at DESC LIMIT ?",
        [limit]
      );
    } catch (error) {
      logger.error("kol-collaboration.repository.getRecent failed", { error: String(error) });
      return [];
    }
  }
}

export const kolCollaborationRepository = new KOLCollaborationRepository();
