import { supabase } from "../supabase";
import type { User, UserRole } from "../../shared/types";
import { logger } from "../../shared/logger";

export class UserRepository {
  async getAll(): Promise<User[]> {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("is_active", true);

    if (error) {
      logger.error("Failed to fetch users", { error: error.message });
      return [];
    }

    return (data || []).map(this.toUser);
  }

  async getByPhone(phone: string): Promise<User | null> {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .or(`phone.eq.${phone},lid.eq.${phone}`)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (error || !data) return null;
    return this.toUser(data);
  }

  async upsert(user: User): Promise<void> {
    const { error } = await supabase.from("users").upsert(
      {
        user_id: user.userId,
        phone: user.phone,
        lid: user.lid || null,
        name: user.name,
        role: user.role,
        permissions: user.permissions,
        store_ids: user.storeIds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) {
      logger.error("Failed to upsert user", { userId: user.userId, error: error.message });
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
