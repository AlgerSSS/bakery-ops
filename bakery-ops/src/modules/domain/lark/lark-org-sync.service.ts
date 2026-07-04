// lark-org-sync.service.ts — 把 Lark 组织架构同步进 team_member 表（migration 025）。
// 保留用户在 DB 里配的 role/subscriptions/alias；新人 role 按部门默认；离职者标 active=false。
// 由 bootstrap cron 每日跑 + 可手动 npm run team:sync。
import { getOrgMembersFull } from "@/modules/channel/lark/lark-messenger";
import { departmentToGroup, type DeptGroup } from "@/modules/orchestrator/department-permissions";
import { teamRepository } from "@/modules/data/repositories/team.repository";
import { logger } from "@/modules/shared/logger";

/** 多部门取最有权限的一个作默认 role：有总经办→gm，否则第一个具体组，否则 everyone。 */
function deriveRole(deptNames: string[]): DeptGroup {
  const groups = deptNames.map(departmentToGroup);
  if (groups.includes("gm")) return "gm";
  return groups.find((g) => g !== "everyone") ?? "everyone";
}

export async function syncLarkOrg(): Promise<{ synced: number }> {
  const members = await getOrgMembersFull();
  if (members.length === 0) {
    logger.warn("syncLarkOrg: Lark 组织架构返回为空，跳过（不清空 team_member）");
    return { synced: 0 };
  }
  await teamRepository.setAllInactive();
  for (const m of members) {
    await teamRepository.upsertFromLark({
      openId: m.openId,
      name: m.name,
      department: m.deptNames.join(", "),
      defaultRole: deriveRole(m.deptNames),
    });
  }
  logger.info("syncLarkOrg: done", { synced: members.length });
  return { synced: members.length };
}
