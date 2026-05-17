import { supabase } from "../supabase";
import { logger } from "../../shared/logger";
import type { KOLRow, KOLRaw } from "../../domain/marketing/types";

export type { KOLRow };

export class KOLRepository {
  async upsertFromRaw(raw: KOLRaw): Promise<KOLRow | null> {
    const { data: existing } = await supabase
      .from("kols")
      .select("id")
      .eq("platform", raw.platform)
      .eq("platform_id", raw.platformId)
      .limit(1)
      .single();

    if (existing) {
      const { error } = await supabase
        .from("kols")
        .update({
          name: raw.name,
          platform_handle: raw.handle,
          follower_count: raw.followerCount,
          engagement_rate: raw.engagementRate,
          avg_views: raw.avgViews,
          avg_likes: raw.avgLikes,
          niche: raw.niche,
          location: raw.location,
          bio: raw.bio,
          verified: raw.verified,
          avatar_url: raw.avatarUrl,
          contact_info: raw.contactInfo || {},
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (error) logger.error("Failed to update KOL", { error: error.message });
      return existing as KOLRow;
    }

    const { data, error } = await supabase
      .from("kols")
      .insert({
        name: raw.name,
        platform: raw.platform,
        platform_handle: raw.handle,
        platform_id: raw.platformId,
        follower_count: raw.followerCount,
        engagement_rate: raw.engagementRate,
        avg_views: raw.avgViews,
        avg_likes: raw.avgLikes,
        niche: raw.niche,
        location: raw.location,
        bio: raw.bio,
        verified: raw.verified,
        avatar_url: raw.avatarUrl,
        contact_info: raw.contactInfo || {},
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to insert KOL", { error: error.message });
      return null;
    }
    return data as KOLRow;
  }

  async getById(id: string): Promise<KOLRow | null> {
    const { data, error } = await supabase
      .from("kols")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return null;
    return data as KOLRow;
  }

  async getByPhone(phone: string): Promise<KOLRow | null> {
    // 从 contact_info JSONB 中查找 phone
    const { data, error } = await supabase
      .from("kols")
      .select("*")
      .filter("contact_info->>phone", "eq", phone)
      .limit(1)
      .single();

    if (error || !data) return null;
    return data as KOLRow;
  }

  async getByHandle(platform: string, handle: string): Promise<KOLRow | null> {
    const { data, error } = await supabase
      .from("kols")
      .select("*")
      .eq("platform", platform)
      .eq("platform_handle", handle)
      .limit(1)
      .single();

    if (error || !data) return null;
    return data as KOLRow;
  }

  async findByPlatform(platform: string, limit = 50): Promise<KOLRow[]> {
    const { data, error } = await supabase
      .from("kols")
      .select("*")
      .eq("platform", platform)
      .order("follower_count", { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as KOLRow[];
  }

  async search(filters: {
    platform?: string;
    niche?: string;
    minFollowers?: number;
    location?: string;
    limit?: number;
  }): Promise<KOLRow[]> {
    let query = supabase.from("kols").select("*");

    if (filters.platform && filters.platform !== "all") {
      query = query.eq("platform", filters.platform);
    }
    if (filters.minFollowers) {
      query = query.gte("follower_count", filters.minFollowers);
    }
    if (filters.location) {
      query = query.ilike("location", `%${filters.location}%`);
    }
    // niche filtering via GIN: use .contains() on the niche array
    if (filters.niche) {
      query = query.contains("niche", [filters.niche]);
    }

    query = query
      .order("follower_count", { ascending: false })
      .limit(filters.limit || 20);

    const { data, error } = await query;
    if (error) {
      logger.error("Failed to search KOLs", { error: error.message });
      return [];
    }
    return (data || []) as KOLRow[];
  }

  async getRecent(limit = 20): Promise<KOLRow[]> {
    const { data, error } = await supabase
      .from("kols")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return [];
    return (data || []) as KOLRow[];
  }
}

export const kolRepository = new KOLRepository();
