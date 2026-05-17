import { supabase } from "../supabase";
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
    const { data: row, error } = await supabase
      .from("kol_collaborations")
      .insert({
        kol_id: data.kol_id,
        campaign_id: data.campaign_id,
        status: data.status || "prospected",
        dm_sent: data.dm_sent || false,
        dm_sent_at: data.dm_sent_at,
        dm_template_used: data.dm_template_used,
        metadata: data.metadata || {},
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create collaboration", { error: error.message });
      return null;
    }
    return row as KOLCollaborationRow;
  }

  async getByKOLId(kolId: string): Promise<KOLCollaborationRow[]> {
    const { data, error } = await supabase
      .from("kol_collaborations")
      .select("*")
      .eq("kol_id", kolId)
      .order("created_at", { ascending: false });

    if (error) return [];
    return (data || []) as KOLCollaborationRow[];
  }

  async getById(id: string): Promise<KOLCollaborationRow | null> {
    const { data, error } = await supabase
      .from("kol_collaborations")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return null;
    return data as KOLCollaborationRow;
  }

  async updateStatus(
    id: string,
    status: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await supabase
      .from("kol_collaborations")
      .update({ status, updated_at: new Date().toISOString(), ...extra })
      .eq("id", id);

    if (error) {
      logger.error("Failed to update collaboration status", { id, error: error.message });
    }
  }

  async markDMSent(
    id: string,
    template: string,
  ): Promise<void> {
    const { error } = await supabase
      .from("kol_collaborations")
      .update({
        dm_sent: true,
        dm_sent_at: new Date().toISOString(),
        dm_template_used: template,
        status: "contacted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      logger.error("Failed to mark DM sent", { id, error: error.message });
    }
  }

  async getRecent(limit = 20): Promise<KOLCollaborationRow[]> {
    const { data, error } = await supabase
      .from("kol_collaborations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as KOLCollaborationRow[];
  }
}

export const kolCollaborationRepository = new KOLCollaborationRepository();
