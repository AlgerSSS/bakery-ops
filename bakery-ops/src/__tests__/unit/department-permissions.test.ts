// 部门 → 权限组 → 技能映射（按 Lark 组织架构）
import { describe, it, expect } from "vitest";
import {
  departmentToGroup,
  departmentsToGroups,
  isSkillAllowedForGroups,
  allowedSkillsForGroups,
  buildDepartmentMenu,
} from "../../modules/orchestrator/department-permissions";

describe("departmentToGroup（Lark 部门名 → 权限组）", () => {
  it("总经办 → gm", () => {
    expect(departmentToGroup("总经办·移动指挥中心")).toBe("gm");
  });
  it("营运中心 / 前厅组 / 生产组 / 门店 / 战队 → ops", () => {
    for (const n of ["营运中心", "前厅组", "生产组", "马来西亚 01 店", "马来西亚战队"]) {
      expect(departmentToGroup(n)).toBe("ops");
    }
  });
  it("区域/海外 职能部门按名字归组", () => {
    expect(departmentToGroup("人事（区域）")).toBe("hr");
    expect(departmentToGroup("人事（海外）")).toBe("hr");
    expect(departmentToGroup("供应链（区域）")).toBe("supply");
    expect(departmentToGroup("市场（海外）")).toBe("marketing");
    expect(departmentToGroup("财务（区域）")).toBe("finance");
  });
  it("研发部/容器部门 → everyone（保守，不给业务权限）", () => {
    expect(departmentToGroup("研发部")).toBe("everyone");
    expect(departmentToGroup("区域职能中心")).toBe("everyone");
  });
});

describe("多部门取并集 + 技能放行", () => {
  it("老板在 总经办+人事 → gm → 放行全部", () => {
    const groups = departmentsToGroups(["总经办·移动指挥中心", "人事（区域）"]);
    expect(groups.has("gm")).toBe(true);
    expect(isSkillAllowedForGroups("supply_send", groups)).toBe(true);
    expect(isSkillAllowedForGroups("kol_outreach", groups)).toBe(true);
    expect(allowedSkillsForGroups(groups)).toBeNull(); // 全部
  });

  it("Leo 在 前厅组 → ops → 只能营运技能，不能订货/招聘", () => {
    const groups = departmentsToGroups(["前厅组"]);
    expect(isSkillAllowedForGroups("forecast_order", groups)).toBe(true);
    expect(isSkillAllowedForGroups("daily_review_chat", groups)).toBe(true);
    expect(isSkillAllowedForGroups("supply_order", groups)).toBe(false);
    expect(isSkillAllowedForGroups("recruitment_sourcing", groups)).toBe(false);
  });

  it("人事只能招聘/员工，不能订货/KOL", () => {
    const groups = departmentsToGroups(["人事（区域）"]);
    expect(isSkillAllowedForGroups("recruitment_progress", groups)).toBe(true);
    expect(isSkillAllowedForGroups("employee_management", groups)).toBe(true);
    expect(isSkillAllowedForGroups("supply_order", groups)).toBe(false);
    expect(isSkillAllowedForGroups("kol_discovery", groups)).toBe(false);
  });

  it("供应链只能订货，不能招聘", () => {
    const groups = departmentsToGroups(["供应链（区域）"]);
    expect(isSkillAllowedForGroups("supply_order", groups)).toBe(true);
    expect(isSkillAllowedForGroups("wms_stock", groups)).toBe(true);
    expect(isSkillAllowedForGroups("recruitment_sourcing", groups)).toBe(false);
  });

  it("跨部门用户取并集（人事+供应链）", () => {
    const groups = departmentsToGroups(["人事（区域）", "供应链（区域）"]);
    expect(isSkillAllowedForGroups("recruitment_sourcing", groups)).toBe(true);
    expect(isSkillAllowedForGroups("supply_order", groups)).toBe(true);
    expect(isSkillAllowedForGroups("kol_discovery", groups)).toBe(false);
  });

  it("help/system_status 对任何组都放行（everyone）", () => {
    const groups = departmentsToGroups(["财务（区域）"]);
    expect(isSkillAllowedForGroups("help", groups)).toBe(true);
    expect(isSkillAllowedForGroups("system_status", groups)).toBe(true);
  });

  it("财务暂无专属业务技能", () => {
    const groups = departmentsToGroups(["财务（区域）"]);
    expect(isSkillAllowedForGroups("daily_review_chat", groups)).toBe(false);
    expect(isSkillAllowedForGroups("supply_order", groups)).toBe(false);
  });
});

describe("buildDepartmentMenu 结构化 + 过滤", () => {
  const info = new Map([
    ["forecast_order", { name: "预估单", description: "生成明日订货" }],
    ["supply_send", { name: "发送订货", description: "确认下单" }],
    ["employee_management", { name: "员工管理", description: "增删改员工" }],
    ["help", { name: "帮助菜单", description: "看功能" }],
    ["system_status", { name: "系统状态", description: "健康检查" }],
  ]);

  it("总经办 showAll → 按部门分组，含营运/供应链/人事/通用", () => {
    const menu = buildDepartmentMenu(info, new Set(["gm"]), true);
    expect(menu).toContain("【营运】");
    expect(menu).toContain("【供应链】");
    expect(menu).toContain("【人事】");
    expect(menu).toContain("【通用】");
    expect(menu).toContain("预估单");
    expect(menu).toContain("按部门");
  });

  it("单部门(供应链)只列自己组 + 通用，看不到别的部门", () => {
    const menu = buildDepartmentMenu(info, departmentsToGroups(["供应链（区域）"]), false);
    expect(menu).toContain("【供应链】");
    expect(menu).toContain("发送订货");
    expect(menu).not.toContain("【营运】");
    expect(menu).not.toContain("【人事】");
    expect(menu).toContain("【通用】");
    expect(menu).not.toContain("预估单");
  });
});
