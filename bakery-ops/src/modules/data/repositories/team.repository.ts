// team.repository.ts — team_member 表读写（Lark 组织架构 + 权限/推送配置，migration 025）。
import { query, execute } from "@/modules/shared/db/postgres";

export interface TeamMemberRow {
  open_id: string;
  name: string;
  lark_department: string | null;
  alias: string;
  role: string;
  subscriptions: string[];
  active: boolean;
}

export const teamRepository = {
  /** 订阅某推送(如 daily_review)的在职成员 open_id。 */
  async getSubscriberOpenIds(kind: string): Promise<string[]> {
    const rows = await query<{ open_id: string }>(
      "SELECT open_id FROM team_member WHERE active = TRUE AND $1 = ANY(subscriptions)",
      [kind],
    );
    return rows.map((r) => r.open_id);
  },

  /** open_id → role（权限）。查不到/停用返回 null。 */
  async getRoleByOpenId(openId: string): Promise<string | null> {
    const rows = await query<{ role: string }>(
      "SELECT role FROM team_member WHERE open_id = $1 AND active = TRUE",
      [openId],
    );
    return rows[0]?.role ?? null;
  },

  async getAll(): Promise<TeamMemberRow[]> {
    return query<TeamMemberRow>("SELECT * FROM team_member ORDER BY active DESC, name");
  },

  /** 同步前先全部标停用；随后 upsert 把在职的重新激活（不在组织架构里的即留停用=离职）。 */
  async setAllInactive(): Promise<void> {
    await execute("UPDATE team_member SET active = FALSE, updated_at = NOW() WHERE active = TRUE");
  },

  /** 从 Lark 同步 upsert：只更新 name/部门/active/synced_at，保留用户配的 role/subscriptions/alias。
   *  新行用 defaultRole（按部门推断）+ 空订阅。 */
  async upsertFromLark(m: { openId: string; name: string; department: string; defaultRole: string }): Promise<void> {
    await execute(
      `INSERT INTO team_member (open_id, name, lark_department, role, active, synced_at, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
       ON CONFLICT (open_id) DO UPDATE SET
         name = EXCLUDED.name,
         lark_department = EXCLUDED.lark_department,
         active = TRUE,
         synced_at = NOW()`,
      [m.openId, m.name, m.department, m.defaultRole],
    );
  },
};
