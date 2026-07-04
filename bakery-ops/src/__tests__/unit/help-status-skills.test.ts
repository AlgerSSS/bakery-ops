// F4: 帮助菜单 + 系统状态指令 —— handler 单测（mock registry / query / client / repositories）
import { describe, it, expect, vi, beforeEach } from "vitest";
import dayjs from "dayjs";
import type { SkillExecutionInput } from "@/modules/shared/types";

const h = vi.hoisted(() => ({
  getAll: vi.fn(),
  query: vi.fn(),
  isClientConnected: vi.fn(),
  countQueued: vi.fn(),
  countRunsSince: vi.fn(),
}));

vi.mock("@/modules/orchestrator/skill-registry", () => ({
  skillRegistry: { getAll: h.getAll },
}));

// 部门解析：无 rawMessage/phone → 解析不到 → fail-open showAll（不打 Lark）
vi.mock("@/modules/orchestrator/department-resolver", () => ({
  resolveGroupsForMessage: vi.fn().mockResolvedValue({ groups: new Set(["everyone"]), resolved: false }),
}));

vi.mock("@/modules/shared/db/postgres", () => ({
  query: h.query,
  execute: vi.fn(),
}));

vi.mock("@/modules/channel/whatsapp/whatsapp.client", () => ({
  isClientConnected: h.isClientConnected,
}));

vi.mock("@/modules/data/repositories/wa-outbound-queue.repository", () => ({
  waOutboundQueueRepository: { countQueued: h.countQueued },
}));

vi.mock("@/modules/data/repositories/audit-log.repository", () => ({
  auditLogRepository: { countRunsSince: h.countRunsSince },
}));

import { HelpSkillHandler } from "@/modules/skills/help/help.definition";
import { StatusSkillHandler } from "@/modules/skills/status/status.definition";

const baseInput: SkillExecutionInput = {
  skillId: "help",
  userId: "user-1",
  channel: "whatsapp",
  conversationId: "conv-1",
  input: { text: "帮助" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HelpSkillHandler", () => {
  it("解析不到部门时 fail-open：按部门分组展示全部功能", async () => {
    h.getAll.mockReturnValue([
      { skillId: "forecast_order", name: "预估单", description: "生成明日订货" },
      { skillId: "supply_send", name: "发送订货", description: "确认下单" },
      { skillId: "help", name: "帮助菜单", description: "看功能" },
    ]);

    const result = await new HelpSkillHandler().execute(baseInput);

    expect(result.status).toBe("success");
    expect(result.skillId).toBe("help");
    expect(result.summary).toContain("【营运】");
    expect(result.summary).toContain("预估单");
    expect(result.summary).toContain("【供应链】");
    expect(result.summary).toContain("【通用】");
    expect(h.getAll).toHaveBeenCalledTimes(1);
  });
});

describe("StatusSkillHandler", () => {
  it("正常路径：输出 4 行状态", async () => {
    h.isClientConnected.mockResolvedValue(true);
    h.query.mockResolvedValue([{ max_date: "2026-06-30" }]);
    h.countQueued.mockResolvedValue(3);
    h.countRunsSince.mockResolvedValue({ total: 10, success: 9, error: 1 });

    const result = await new StatusSkillHandler().execute({ ...baseInput, skillId: "system_status" });

    expect(result.status).toBe("success");
    const lines = result.summary.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("✅ 正常");
    const staleDays = dayjs().diff(dayjs("2026-06-30"), "day");
    expect(lines[1]).toContain("最新 2026-06-30");
    expect(lines[1]).toContain(`滞后 ${staleDays} 天`);
    expect(lines[2]).toContain("3 条");
    expect(lines[3]).toContain("共 10 次，成功 9，失败 1");

    // 近 24h 统计按 channel='cron' 读取
    expect(h.countRunsSince).toHaveBeenCalledWith("cron", expect.any(String));
  });

  it("降级路径：WhatsApp 未连接 + POS 查询失败 + 无审计数据，仍返回 success", async () => {
    h.isClientConnected.mockResolvedValue(false);
    h.query.mockRejectedValue(new Error("db down"));
    h.countQueued.mockResolvedValue(0);
    h.countRunsSince.mockResolvedValue({ total: 0, success: 0, error: 0 });

    const result = await new StatusSkillHandler().execute({ ...baseInput, skillId: "system_status" });

    expect(result.status).toBe("success");
    const lines = result.summary.split("\n");
    expect(lines[0]).toContain("❌ 未连接");
    expect(lines[1]).toContain("查询失败");
    expect(lines[2]).toContain("0 条");
    expect(lines[3]).toContain("共 0 次");
  });

  it("POS 无记录时第二行显示无记录", async () => {
    h.isClientConnected.mockResolvedValue(true);
    h.query.mockResolvedValue([{ max_date: null }]);
    h.countQueued.mockResolvedValue(0);
    h.countRunsSince.mockResolvedValue({ total: 0, success: 0, error: 0 });

    const result = await new StatusSkillHandler().execute({ ...baseInput, skillId: "system_status" });

    expect(result.summary.split("\n")[1]).toContain("无记录");
  });
});
