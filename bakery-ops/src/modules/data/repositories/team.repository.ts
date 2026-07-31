// team.repository.ts — staff 表飞书侧读写（Lark 组织架构 + 权限/推送配置）。
// 迁移 072：team_member 并入 staff。open_id→lark_open_id、active→is_active、synced_at→lark_synced_at，
// 在此用 SQL 别名映射，调用方接口（TeamMemberRow）不变。
// 所有查询都必须限定 lark_open_id IS NOT NULL —— staff 里还有 WhatsApp 来源的员工，
// 不加这个条件，组织架构同步会把他们也当成飞书成员停用掉。
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
      "SELECT lark_open_id AS open_id FROM staff WHERE is_active = TRUE AND lark_open_id IS NOT NULL AND $1 = ANY(subscriptions)",
      [kind],
    );
    return rows.map((r) => r.open_id);
  },

  /** open_id → role（权限）。查不到/停用返回 null。 */
  async getRoleByOpenId(openId: string): Promise<string | null> {
    const rows = await query<{ role: string }>(
      "SELECT role FROM staff WHERE lark_open_id = $1 AND is_active = TRUE",
      [openId],
    );
    return rows[0]?.role ?? null;
  },

  async getAll(): Promise<TeamMemberRow[]> {
    return query<TeamMemberRow>(
      `SELECT lark_open_id AS open_id, name, lark_department, alias, role, subscriptions,
              is_active AS active
       FROM staff WHERE lark_open_id IS NOT NULL ORDER BY is_active DESC, name`
    );
  },

  /** 同步前先全部标停用；随后 upsert 把在职的重新激活（不在组织架构里的即留停用=离职）。 */
  async setAllInactive(): Promise<void> {
    await execute("UPDATE staff SET is_active = FALSE, updated_at = NOW() WHERE is_active = TRUE AND lark_open_id IS NOT NULL");
  },

  /** 从 Lark 同步 upsert：只更新 name/部门/active/synced_at，保留用户配的 role/subscriptions/alias。
   *  新行用 defaultRole（按部门推断）+ 空订阅。 */
  async upsertFromLark(m: { openId: string; name: string; department: string; defaultRole: string }): Promise<void> {
    await execute(
      `INSERT INTO staff (user_id, lark_open_id, name, lark_department, role, is_active, lark_synced_at, updated_at)
       VALUES ('lark:' || $1, $1, $2, $3, $4, TRUE, NOW(), NOW())
       ON CONFLICT (lark_open_id) DO UPDATE SET
         name = EXCLUDED.name,
         lark_department = EXCLUDED.lark_department,
         is_active = TRUE,
         lark_synced_at = NOW(),
         updated_at = NOW()`,
      [m.openId, m.name, m.department, m.defaultRole],
    );
  },
};
