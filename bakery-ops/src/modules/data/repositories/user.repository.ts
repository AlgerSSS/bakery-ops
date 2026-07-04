import { query, execute } from "@/modules/shared/db/postgres";
import type { User, UserRole } from "../../shared/types";
import { logger } from "../../shared/logger";

export class UserRepository {
  async getAll(): Promise<User[]> {
    try {
      const rows = await query<Record<string, unknown>>(
        "SELECT * FROM users WHERE is_active = true"
      );
      return rows.map(this.toUser);
    } catch (error) {
      logger.error("Failed to fetch users", { error: (error as Error).message });
      return [];
    }
  }

  async getByPhone(phone: string): Promise<User | null> {
    try {
      const rows = await query<Record<string, unknown>>(
        "SELECT * FROM users WHERE (phone = ? OR lid = ?) AND is_active = true LIMIT 1",
        [phone, phone]
      );
      if (rows.length === 0) return null;
      return this.toUser(rows[0]);
    } catch (error) {
      logger.error("user.repository.getByPhone failed", { error: String(error) });
      return null;
    }
  }

  async getByUserId(userId: string): Promise<User | null> {
    try {
      const rows = await query<Record<string, unknown>>(
        "SELECT * FROM users WHERE user_id = ? AND is_active = true LIMIT 1",
        [userId],
      );
      if (rows.length === 0) return null;
      return this.toUser(rows[0]);
    } catch (error) {
      logger.error("user.repository.getByUserId failed", { error: String(error) });
      return null;
    }
  }

  async getByRoleAndStore(role: UserRole, storeCode: string): Promise<User | null> {
    try {
      const rows = await query<Record<string, unknown>>(
        "SELECT * FROM users WHERE role = ? AND ? = ANY (store_ids) AND is_active = true LIMIT 1",
        [role, storeCode],
      );
      if (rows.length === 0) return null;
      return this.toUser(rows[0]);
    } catch (error) {
      logger.error("user.repository.getByRoleAndStore failed", { error: String(error) });
      return null;
    }
  }

  async upsert(user: User): Promise<void> {
    try {
      await execute(
        `INSERT INTO users (user_id, phone, lid, name, role, permissions, store_ids, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           phone = EXCLUDED.phone,
           lid = EXCLUDED.lid,
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           permissions = EXCLUDED.permissions,
           store_ids = EXCLUDED.store_ids,
           updated_at = EXCLUDED.updated_at`,
        [
          user.userId,
          user.phone,
          user.lid || null,
          user.name,
          user.role,
          user.permissions,
          user.storeIds,
          new Date().toISOString(),
        ]
      );
    } catch (error) {
      logger.error("Failed to upsert user", { userId: user.userId, error: (error as Error).message });
    }
  }

  private toUser(row: Record<string, unknown>): User {
    return {
      userId: String(row.user_id),
      phone: String(row.phone || ""),
      lid: row.lid ? String(row.lid) : undefined,
      name: String(row.name),
      role: String(row.role) as UserRole,
      permissions: (row.permissions as string[]) || [],
      storeIds: (row.store_ids as string[]) || [],
    };
  }
}

export const userRepository = new UserRepository();
