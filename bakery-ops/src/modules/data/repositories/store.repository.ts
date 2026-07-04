import { query } from "@/modules/shared/db/postgres";
import { logger } from "../../shared/logger";

export interface StoreRow {
  store_code: string;
  name: string;
  address?: string;
  area?: string;
  timezone: string;
  manager_user_id?: string;
  head_chef_user_id?: string;
  interview_windows: Record<string, unknown>;
  trial_windows: Record<string, unknown>;
  lark_base_token?: string;
  lark_table_id?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const SELECT_COLS =
  "store_code, name, address, area, timezone, manager_user_id, head_chef_user_id, " +
  "interview_windows, trial_windows, lark_base_token, lark_table_id, active, " +
  "created_at::text AS created_at, updated_at::text AS updated_at";

function mapRow(row: StoreRow): StoreRow {
  if (typeof row.interview_windows === "string") {
    row.interview_windows = JSON.parse(row.interview_windows) as Record<string, unknown>;
  }
  if (typeof row.trial_windows === "string") {
    row.trial_windows = JSON.parse(row.trial_windows) as Record<string, unknown>;
  }
  return row;
}

export class StoreRepository {
  async getByCode(storeCode: string): Promise<StoreRow | null> {
    try {
      const rows = await query<StoreRow>(
        `SELECT ${SELECT_COLS} FROM stores WHERE store_code = ?`,
        [storeCode],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    } catch (e) {
      logger.error("Failed to get store", { storeCode, error: (e as Error).message });
      return null;
    }
  }

  async listActive(): Promise<StoreRow[]> {
    try {
      const rows = await query<StoreRow>(
        `SELECT ${SELECT_COLS} FROM stores WHERE active = true ORDER BY store_code`,
      );
      return rows.map(mapRow);
    } catch (error) {
      logger.error("store.repository.listActive failed", { error: String(error) });
      return [];
    }
  }

  async getManagerAndChef(
    storeCode: string,
  ): Promise<{ managerUserId: string | null; headChefUserId: string | null }> {
    try {
      const rows = await query<{ manager_user_id: string | null; head_chef_user_id: string | null }>(
        "SELECT manager_user_id, head_chef_user_id FROM stores WHERE store_code = ?",
        [storeCode],
      );
      const row = rows[0];
      return {
        managerUserId: row?.manager_user_id ?? null,
        headChefUserId: row?.head_chef_user_id ?? null,
      };
    } catch (error) {
      logger.error("store.repository.getManagerAndChef failed", { error: String(error) });
      return { managerUserId: null, headChefUserId: null };
    }
  }
}

export const storeRepository = new StoreRepository();
