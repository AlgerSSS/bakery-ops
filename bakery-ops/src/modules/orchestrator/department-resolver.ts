// 把一条渠道消息解析成发送者的 Lark 部门权限组（orchestrator 拦截 + 帮助菜单 共用）。
// 依赖 lark-messenger 的异步解析（带缓存）；把纯映射逻辑留在 department-permissions.ts 便于测试。
import { resolveLarkOpenId, resolveUserDepartments } from "../channel/lark/lark-messenger";
import { departmentsToGroups, type DeptGroup } from "./department-permissions";
import { teamRepository } from "../data/repositories/team.repository";
import type { ChannelMessage } from "../shared/types";

/**
 * 消息 → 权限组。优先读 team_member 表里配的 role（DB 是权限真源，用户可在库里改）；
 * team_member 里没有该人时，回落到 Lark 部门实时推断。
 * resolved=false 表示两条路都解析不到（Lark 不可用 / 不在组织里），上层据此 fail-open
 * （放行 + 菜单显示全部），绝不误锁。
 */
export async function resolveGroupsForMessage(
  message: Pick<ChannelMessage, "phone" | "larkOpenId">,
): Promise<{ groups: Set<DeptGroup>; resolved: boolean }> {
  let openId = message.larkOpenId;
  if (!openId && message.phone) openId = (await resolveLarkOpenId(message.phone)) ?? undefined;
  if (openId) {
    const role = await teamRepository.getRoleByOpenId(openId).catch(() => null);
    if (role) return { groups: new Set<DeptGroup>(["everyone", role as DeptGroup]), resolved: true };
  }
  const deptNames = openId ? await resolveUserDepartments(openId) : [];
  return { groups: departmentsToGroups(deptNames), resolved: deptNames.length > 0 };
}
