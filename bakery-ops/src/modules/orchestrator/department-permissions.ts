// 按 Lark 组织架构的部门 → 权限组 → 可用技能映射（用户确认 2026-07-03）。
// 权限来源是 Lark 部门名（按子串匹配，自动覆盖 区域/海外 两套同名职能部门）。
// 多部门用户取并集；总经办=全部。改组织架构在 Lark 里改即可，无需改代码。

export type DeptGroup = "gm" | "ops" | "supply" | "hr" | "marketing" | "finance" | "everyone";

// 每个权限组开放的 skillId。gm 是特例（全部），单列在 isSkillAllowed 里。
const GROUP_SKILLS: Record<Exclude<DeptGroup, "gm">, string[]> = {
  ops: ["forecast_order", "forecast_review", "kitchen_production_plan", "daily_review_chat", "knowledge_query"],
  supply: ["supply_order", "supply_send", "arrival_check", "wms_stock"],
  hr: ["recruitment_sourcing", "recruitment_progress", "job_posting", "active_jobs", "backup_pool", "employee_management", "resume_upload"],
  marketing: ["kol_discovery", "kol_outreach", "kol_collab"],
  finance: [], // 暂无专属技能，财务功能以后再加
  everyone: ["help", "system_status"], // 所有内部人员都可用
};

// Lark 部门名 → 权限组（子串匹配，先到先得）。门店/生产/战队默认归营运；研发/容器部门默认只给 everyone。
const DEPT_NAME_RULES: Array<{ match: RegExp; group: DeptGroup }> = [
  { match: /总经办/, group: "gm" },
  { match: /营运|前厅|生产|店|战队/, group: "ops" },
  { match: /供应链/, group: "supply" },
  { match: /人事/, group: "hr" },
  { match: /市场/, group: "marketing" },
  { match: /财务/, group: "finance" },
  // 研发部、区域职能中心、海外服务中心等未匹配 → 只给 everyone（保守，不自动给业务权限）
];

/** 单个 Lark 部门名 → 权限组（未匹配返回 everyone）。 */
export function departmentToGroup(deptName: string): DeptGroup {
  for (const rule of DEPT_NAME_RULES) {
    if (rule.match.test(deptName)) return rule.group;
  }
  return "everyone";
}

/** 一组部门名 → 去重后的权限组集合。 */
export function departmentsToGroups(deptNames: string[]): Set<DeptGroup> {
  const groups = new Set<DeptGroup>(["everyone"]); // 内部人员至少有 everyone
  for (const name of deptNames) groups.add(departmentToGroup(name));
  return groups;
}

/** 给定权限组集合，判断某 skill 是否放行。gm 放行全部。 */
export function isSkillAllowedForGroups(skillId: string, groups: Set<DeptGroup>): boolean {
  if (groups.has("gm")) return true;
  for (const g of groups) {
    if (g === "gm") return true;
    if (GROUP_SKILLS[g]?.includes(skillId)) return true;
  }
  return false;
}

/** 权限组集合 → 可用 skillId 列表（用于「帮助」菜单按部门过滤；gm 返回 null 表示全部）。 */
export function allowedSkillsForGroups(groups: Set<DeptGroup>): string[] | null {
  if (groups.has("gm")) return null; // 全部
  const set = new Set<string>();
  for (const g of groups) {
    if (g === "gm") continue;
    for (const s of GROUP_SKILLS[g] || []) set.add(s);
  }
  return [...set];
}

/** 部门组的中文名（拒绝提示用）。 */
export const GROUP_LABELS: Record<DeptGroup, string> = {
  gm: "总经办", ops: "营运", supply: "供应链", hr: "人事", marketing: "市场", finance: "财务", everyone: "全员",
};

// 菜单展示顺序（everyone 单列为「通用」，gm 不单列——它按分组展示全部业务组）。
const MENU_SECTION_ORDER: Array<Exclude<DeptGroup, "gm" | "everyone">> = ["ops", "supply", "hr", "marketing", "finance"];

/**
 * 结构化菜单：总经办(或解析不到部门的 fail-open)按部门分组列出全部；
 * 其他部门只列自己组的功能。始终附「通用」。
 */
export function buildDepartmentMenu(
  skillInfo: Map<string, { name: string; description: string }>,
  groups: Set<DeptGroup>,
  showAll: boolean,
): string {
  const line = (id: string): string | null => {
    const s = skillInfo.get(id);
    return s ? `· ${s.name} — ${s.description}` : null;
  };
  const section = (label: string, ids: string[]): string[] => {
    const items = ids.map(line).filter((x): x is string => x !== null);
    return items.length ? [`【${label}】`, ...items, ""] : [];
  };

  const out: string[] = [showAll ? "📋 可用功能（按部门）" : "📋 你可以使用的功能", ""];
  for (const g of MENU_SECTION_ORDER) {
    if (showAll || groups.has(g)) out.push(...section(GROUP_LABELS[g], GROUP_SKILLS[g]));
  }
  out.push(...section("通用", GROUP_SKILLS.everyone));
  out.push("直接描述你的需求也可以，例如「预估明天」「发给供应商」。");
  return out.join("\n");
}
