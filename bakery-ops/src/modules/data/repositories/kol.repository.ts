import { query, execute } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";
import type { KOLRow, KOLRaw } from "../../domain/marketing/types";

export type { KOLRow };

export class KOLRepository {
  async upsertFromRaw(raw: KOLRaw): Promise<KOLRow | null> {
    const existingRows = await query<{ id: string }>(
      "SELECT id FROM kols WHERE platform = ? AND platform_id = ? LIMIT 1",
      [raw.platform, raw.platformId]
    );
    const existing = existingRows[0];

    if (existing) {
      try {
        await execute(
          `UPDATE kols SET
             name = ?,
             platform_handle = ?,
             follower_count = ?,
             engagement_rate = ?,
             avg_views = ?,
             avg_likes = ?,
             niche = ?,
             location = ?,
             bio = ?,
             verified = ?,
             avatar_url = ?,
             contact_info = ?,
             updated_at = ?
           WHERE id = ?`,
          [
            raw.name,
            raw.handle,
            raw.followerCount,
            raw.engagementRate,
            raw.avgViews,
            raw.avgLikes,
            raw.niche,
            raw.location,
            raw.bio,
            raw.verified,
            raw.avatarUrl,
            raw.contactInfo || {},
            new Date().toISOString(),
            existing.id,
          ]
        );
      } catch (error) {
        logger.error("Failed to update KOL", { error: (error as Error).message });
      }
      return existing as KOLRow;
    }

    try {
      const rows = await query<KOLRow>(
        `INSERT INTO kols (
           name, platform, platform_handle, platform_id, follower_count,
           engagement_rate, avg_views, avg_likes, niche, location,
           bio, verified, avatar_url, contact_info
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          raw.name,
          raw.platform,
          raw.handle,
          raw.platformId,
          raw.followerCount,
          raw.engagementRate,
          raw.avgViews,
          raw.avgLikes,
          raw.niche,
          raw.location,
          raw.bio,
          raw.verified,
          raw.avatarUrl,
          raw.contactInfo || {},
        ]
      );
      return (rows[0] as KOLRow) ?? null;
    } catch (error) {
      logger.error("Failed to insert KOL", { error: (error as Error).message });
      return null;
    }
  }

  async getById(id: string): Promise<KOLRow | null> {
    const rows = await query<KOLRow>("SELECT * FROM kols WHERE id = ?", [id]);
    return rows[0] ?? null;
  }

  async getByPhone(phone: string): Promise<KOLRow | null> {
    // 从 contact_info JSONB 中查找 phone
    const rows = await query<KOLRow>(
      "SELECT * FROM kols WHERE contact_info->>'phone' = ? LIMIT 1",
      [phone]
    );
    return rows[0] ?? null;
  }

  async getByHandle(platform: string, handle: string): Promise<KOLRow | null> {
    const rows = await query<KOLRow>(
      "SELECT * FROM kols WHERE platform = ? AND platform_handle = ? LIMIT 1",
      [platform, handle]
    );
    return rows[0] ?? null;
  }

  async findByPlatform(platform: string, limit = 50): Promise<KOLRow[]> {
    return query<KOLRow>(
      "SELECT * FROM kols WHERE platform = ? ORDER BY follower_count DESC LIMIT ?",
      [platform, limit]
    );
  }

  async search(filters: {
    platform?: string;
    niche?: string;
    minFollowers?: number;
    location?: string;
    limit?: number;
  }): Promise<KOLRow[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.platform && filters.platform !== "all") {
      conditions.push("platform = ?");
      params.push(filters.platform);
    }
    if (filters.minFollowers) {
      conditions.push("follower_count >= ?");
      params.push(filters.minFollowers);
    }
    if (filters.location) {
      conditions.push("location ILIKE ?");
      params.push(`%${filters.location}%`);
    }
    // niche filtering via GIN: array contains
    if (filters.niche) {
      conditions.push("niche @> ?::text[]");
      params.push([filters.niche]);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(filters.limit || 20);

    try {
      return await query<KOLRow>(
        `SELECT * FROM kols ${where} ORDER BY follower_count DESC LIMIT ?`,
        params
      );
    } catch (error) {
      logger.error("Failed to search KOLs", { error: (error as Error).message });
      return [];
    }
  }

  async getRecent(limit = 20): Promise<KOLRow[]> {
    return query<KOLRow>(
      "SELECT * FROM kols ORDER BY created_at DESC LIMIT ?",
      [limit]
    );
  }
}

export const kolRepository = new KOLRepository();
