// KOL 线（IMPROVEMENT-PLAN.md F14–F17）单元测试：
// - F14 触达人机协作：文案生成、确认流程不再调 sendDM/不写 dm_sent 脏样本、「已发 @handle」、跨平台查 handle
// - F15 回流闭环：「博主 @handle 电话」绑定、orchestrator role=kol 入站分支
// - F16/F17 合作跟踪与效果：指令解析、列表分组、效果对账
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- module mocks（repositories / whatsapp / db，全部不落库） ----

vi.mock("@/modules/domain/recruitment/intake/recruitment-pre-router", () => ({
  recruitmentPreRouter: {
    async tryRoute() { return null; },
    async greetStranger() { return null; },
  },
}));

vi.mock("@/modules/data/repositories/kol.repository", () => ({
  kolRepository: {
    getById: vi.fn(),
    getByPhone: vi.fn(async () => null),
    getByHandle: vi.fn(),
    getByHandleAnyPlatform: vi.fn(),
    getRecent: vi.fn(async () => []),
    updateContactPhone: vi.fn(async () => undefined),
  },
}));

vi.mock("@/modules/data/repositories/kol-collaboration.repository", () => ({
  kolCollaborationRepository: {
    create: vi.fn(async () => ({ id: "collab_new" })),
    getByKOLId: vi.fn(async () => []),
    getRecent: vi.fn(async () => []),
    updateStatus: vi.fn(async () => undefined),
    markDMSent: vi.fn(async () => undefined),
  },
}));

vi.mock("@/modules/data/repositories/chat-sample.repository", () => ({
  chatSampleRepository: {
    create: vi.fn(async () => null),
  },
}));

vi.mock("@/modules/channel/whatsapp/whatsapp.client", () => ({
  isClientConnected: vi.fn(async () => true),
  sendTextTo: vi.fn(async () => ({ ok: true, chatId: "x@c.us", resolved: true })),
}));

vi.mock("@/modules/shared/db/postgres", () => ({
  query: vi.fn(async () => []),
  execute: vi.fn(async () => ({ affectedRows: 0 })),
}));

import dayjs from "dayjs";
import { kolRepository } from "@/modules/data/repositories/kol.repository";
import { kolCollaborationRepository } from "@/modules/data/repositories/kol-collaboration.repository";
import { chatSampleRepository } from "@/modules/data/repositories/chat-sample.repository";
import { sendTextTo } from "@/modules/channel/whatsapp/whatsapp.client";
import { query } from "@/modules/shared/db/postgres";
import {
  buildOutreachMessage,
  KOLOutreachSkillHandler,
} from "@/modules/skills/kol-outreach/kol-outreach.definition";
import {
  parseChineseDate,
  parseCollabCommand,
  KOLCollabSkillHandler,
} from "@/modules/skills/kol-collab/kol-collab.definition";
import { Orchestrator } from "@/modules/orchestrator/orchestrator";
import { SkillRegistry } from "@/modules/orchestrator/skill-registry";
import { StateManager } from "@/modules/orchestrator/state-manager";
import { PermissionService } from "@/modules/orchestrator/permission-service";
import { AuditService } from "@/modules/orchestrator/audit-service";
import type { AiProvider } from "@/modules/shared/ai/ai-provider.interface";
import type { ChannelMessage, SkillExecutionInput } from "@/modules/shared/types";

const TEST_KOL = {
  id: "k1",
  name: "Amy Eats",
  platform: "tiktok",
  platform_handle: "amy_eats",
  platform_id: "tt_amy",
  follower_count: 80000,
  niche: ["美食"],
  verified: false,
  contact_info: {},
  metadata: {},
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

function makeSkillInput(text: string, extra: Record<string, unknown> = {}): SkillExecutionInput {
  return {
    skillId: "test",
    userId: "u_owner",
    channel: "whatsapp",
    conversationId: "conv_test",
    input: { text, ...extra },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ========== F14 文案生成 ==========

describe("F14 buildOutreachMessage", () => {
  it("replaces {name} and {platform} placeholders", () => {
    const msg = buildOutreachMessage({ name: "Amy Eats", platform: "tiktok" });
    expect(msg).toContain("Hi Amy Eats!");
    expect(msg).toContain("on tiktok");
    expect(msg).not.toContain("{name}");
    expect(msg).not.toContain("{platform}");
  });
});

// ========== F14 确认流程：生成文案，不发 DM、不写 dm_sent 样本 ==========

describe("F14 kol_outreach confirm flow (human-in-the-loop)", () => {
  it("returns copyable message + profile link, keeps collab at prospected, no dm_sent sample", async () => {
    vi.mocked(kolRepository.getById).mockResolvedValue(TEST_KOL as never);

    const handler = new KOLOutreachSkillHandler();
    const result = await handler.execute(
      makeSkillInput("确认", { _kolOutreachState: { step: "confirm", kolIds: ["k1"] } }),
    );

    expect(result.status).toBe("success");
    expect(result.summary).toContain("https://www.tiktok.com/@amy_eats");
    expect(result.summary).toContain("Hi Amy Eats!");
    expect(result.summary).toContain("已发");

    // collab 建了且停在 prospected；不再 markDMSent，也不写 dm_sent 样本
    expect(kolCollaborationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ kol_id: "k1", status: "prospected" }),
    );
    expect(kolCollaborationRepository.markDMSent).not.toHaveBeenCalled();
    expect(chatSampleRepository.create).not.toHaveBeenCalled();
  });

  it("uses instagram profile link for instagram KOLs", async () => {
    vi.mocked(kolRepository.getById).mockResolvedValue(
      { ...TEST_KOL, platform: "instagram" } as never,
    );

    const handler = new KOLOutreachSkillHandler();
    const result = await handler.execute(
      makeSkillInput("确认", { _kolOutreachState: { step: "confirm", kolIds: ["k1"] } }),
    );
    expect(result.summary).toContain("https://www.instagram.com/amy_eats");
  });

  it("looks up handles cross-platform (no hardcoded tiktok)", async () => {
    vi.mocked(kolRepository.getByHandleAnyPlatform).mockResolvedValue(TEST_KOL as never);

    const handler = new KOLOutreachSkillHandler();
    const result = await handler.execute(
      makeSkillInput("给 @amy_eats 发合作邀请", { kolHandles: "@amy_eats" }),
    );

    expect(kolRepository.getByHandleAnyPlatform).toHaveBeenCalledWith("amy_eats");
    expect(kolRepository.getByHandle).not.toHaveBeenCalled();
    expect(result.status).toBe("pending"); // 进入确认流程
  });
});

// ========== F14 「已发 @handle」 ==========

describe("F14 '已发 @handle' command", () => {
  it("marks latest collab contacted and logs dm_sent sample", async () => {
    vi.mocked(kolRepository.getByHandleAnyPlatform).mockResolvedValue(TEST_KOL as never);
    vi.mocked(kolCollaborationRepository.getByKOLId).mockResolvedValue([
      { id: "c1", kol_id: "k1", status: "prospected", dm_template_used: "MSG_FOR_AMY" },
    ] as never);

    const handler = new KOLOutreachSkillHandler();
    const result = await handler.execute(makeSkillInput("已发 @amy_eats"));

    expect(kolRepository.getByHandleAnyPlatform).toHaveBeenCalledWith("amy_eats");
    expect(kolCollaborationRepository.markDMSent).toHaveBeenCalledWith("c1", "MSG_FOR_AMY");
    expect(chatSampleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ kol_id: "k1", message_type: "dm_sent", message_content: "MSG_FOR_AMY" }),
    );
    expect(result.status).toBe("success");
    expect(result.summary).toContain("已联系");
  });

  it("creates a collab first when none exists", async () => {
    vi.mocked(kolRepository.getByHandleAnyPlatform).mockResolvedValue(TEST_KOL as never);
    vi.mocked(kolCollaborationRepository.getByKOLId).mockResolvedValue([] as never);
    vi.mocked(kolCollaborationRepository.create).mockResolvedValue({ id: "c_new" } as never);

    const handler = new KOLOutreachSkillHandler();
    await handler.execute(makeSkillInput("已发 @amy_eats"));

    expect(kolCollaborationRepository.create).toHaveBeenCalled();
    expect(kolCollaborationRepository.markDMSent).toHaveBeenCalledWith("c_new", expect.stringContaining("Hi Amy Eats!"));
  });

  it("returns error for unknown handle", async () => {
    vi.mocked(kolRepository.getByHandleAnyPlatform).mockResolvedValue(null as never);

    const handler = new KOLOutreachSkillHandler();
    const result = await handler.execute(makeSkillInput("已发 @nobody"));
    expect(result.status).toBe("error");
    expect(result.summary).toContain("@nobody");
  });
});

// ========== F15 「博主 @handle 电话 60xxx」 ==========

describe("F15 phone binding command", () => {
  it("writes kols.contact_info.phone", async () => {
    vi.mocked(kolRepository.getByHandleAnyPlatform).mockResolvedValue(TEST_KOL as never);

    const handler = new KOLOutreachSkillHandler();
    const result = await handler.execute(makeSkillInput("博主 @amy_eats 电话 60123456789"));

    expect(kolRepository.updateContactPhone).toHaveBeenCalledWith("k1", "60123456789");
    expect(result.status).toBe("success");
    expect(result.summary).toContain("60123456789");
  });

  it("returns error for unknown handle", async () => {
    vi.mocked(kolRepository.getByHandleAnyPlatform).mockResolvedValue(null as never);

    const handler = new KOLOutreachSkillHandler();
    const result = await handler.execute(makeSkillInput("博主 @nobody 电话 60123456789"));
    expect(result.status).toBe("error");
    expect(kolRepository.updateContactPhone).not.toHaveBeenCalled();
  });
});

// ========== F15 orchestrator role=kol 入站分支 ==========

describe("F15 orchestrator KOL inbound", () => {
  const mockAi: AiProvider = {
    async chatCompletion() { return ""; },
    async chatCompletionLong() { return ""; },
    async chatCompletionMessages() { return JSON.stringify({ action: "chat", reply: "ok" }); },
    async getEmbedding() { return []; },
    async getEmbeddings() { return [[]]; },
  };

  function makeMessage(phone: string, text: string): ChannelMessage {
    return {
      channel: "whatsapp",
      messageId: `msg_${Math.random()}`,
      conversationId: "conv_kol",
      phone,
      text,
      timestamp: new Date().toISOString(),
    };
  }

  function buildOrchestrator() {
    const permissionService = new PermissionService();
    permissionService.registerUser({
      userId: "kol_k1",
      phone: "60999000111",
      name: "Amy Eats",
      role: "kol",
      permissions: ["marketing.use"],
      storeIds: [],
    });
    return new Orchestrator(
      new SkillRegistry(), new StateManager(), permissionService, new AuditService(), mockAi,
    );
  }

  it("records dm_received sample, moves collab to negotiating, forwards to owner, thanks the KOL", async () => {
    process.env.OWNER_WHATSAPP = "60111222333";
    vi.mocked(kolCollaborationRepository.getByKOLId).mockResolvedValue([
      { id: "c1", kol_id: "k1", status: "contacted" },
    ] as never);

    const orchestrator = buildOrchestrator();
    const responses = await orchestrator.handle(makeMessage("60999000111", "Yes I'm interested!"));

    // dm_received 样本
    expect(chatSampleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kol_id: "k1",
        platform: "whatsapp",
        message_type: "dm_received",
        message_content: "Yes I'm interested!",
      }),
    );
    // collab → negotiating + dm_response/dm_responded_at
    expect(kolCollaborationRepository.updateStatus).toHaveBeenCalledWith(
      "c1",
      "negotiating",
      expect.objectContaining({
        dm_response: "Yes I'm interested!",
        dm_responded_at: expect.any(String),
      }),
    );
    // 原文转发老板
    expect(sendTextTo).toHaveBeenCalledWith(
      "60111222333",
      expect.stringContaining("Yes I'm interested!"),
    );
    // 回博主固定英文致谢
    expect(responses).toHaveLength(1);
    expect(responses[0].text).toContain("Thank you for getting back to us");
  });

  it("identifies unregistered KOL by bound phone (getByPhone) and handles inbound", async () => {
    process.env.OWNER_WHATSAPP = "60111222333";
    vi.mocked(kolRepository.getByPhone).mockResolvedValue(
      { ...TEST_KOL, id: "k2" } as never,
    );
    vi.mocked(kolCollaborationRepository.getByKOLId).mockResolvedValue([] as never);

    const orchestrator = buildOrchestrator();
    const responses = await orchestrator.handle(makeMessage("60888777666", "Hello, saw your DM"));

    expect(chatSampleRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ kol_id: "k2", message_type: "dm_received" }),
    );
    // 没有合作记录时不更新状态，但仍转发 + 致谢
    expect(kolCollaborationRepository.updateStatus).not.toHaveBeenCalled();
    expect(sendTextTo).toHaveBeenCalled();
    expect(responses[0].text).toContain("Thank you");
  });
});

// ========== F16 指令解析 ==========

describe("F16 parseCollabCommand / parseChineseDate", () => {
  const year = dayjs().year();

  it("parses 确认 with amount and date", () => {
    expect(parseCollabCommand("合作 @amy_eats 确认 500 7月10日")).toEqual({
      type: "confirm",
      handle: "amy_eats",
      amount: 500,
      scheduledDate: `${year}-07-10`,
    });
  });

  it("parses 确认 with 块/RM suffix and no date", () => {
    expect(parseCollabCommand("合作 @amy_eats 确认 500块")).toEqual({
      type: "confirm",
      handle: "amy_eats",
      amount: 500,
      scheduledDate: null,
    });
  });

  it("parses 完成 / 放弃 / 列表 / 效果", () => {
    expect(parseCollabCommand("合作 @amy_eats 完成")).toEqual({ type: "complete", handle: "amy_eats" });
    expect(parseCollabCommand("合作 @amy_eats 放弃")).toEqual({ type: "decline", handle: "amy_eats" });
    expect(parseCollabCommand("合作列表")).toEqual({ type: "list" });
    expect(parseCollabCommand("合作效果 @amy_eats")).toEqual({ type: "effect", handle: "amy_eats" });
  });

  it("returns null for unrelated text", () => {
    expect(parseCollabCommand("今天卖了多少")).toBeNull();
  });

  it("parseChineseDate handles X月X日/号 and rejects invalid dates", () => {
    expect(parseChineseDate("7月10日")).toBe(`${year}-07-10`);
    expect(parseChineseDate("12月3号")).toBe(`${year}-12-03`);
    expect(parseChineseDate("13月40日")).toBeNull();
    expect(parseChineseDate("没有日期")).toBeNull();
  });
});

// ========== F16 handler：确认 / 完成 / 列表 ==========

describe("F16 kol_collab handler", () => {
  it("确认 updates latest collab to confirmed with deal_amount + scheduled_at", async () => {
    vi.mocked(kolRepository.getByHandleAnyPlatform).mockResolvedValue(TEST_KOL as never);
    vi.mocked(kolCollaborationRepository.getByKOLId).mockResolvedValue([
      { id: "c1", kol_id: "k1", status: "negotiating" },
    ] as never);

    const handler = new KOLCollabSkillHandler();
    const result = await handler.execute(makeSkillInput("合作 @amy_eats 确认 500 7月10日"));

    expect(result.status).toBe("success");
    expect(kolCollaborationRepository.updateStatus).toHaveBeenCalledWith(
      "c1",
      "confirmed",
      expect.objectContaining({ deal_amount: 500, scheduled_at: expect.any(String) }),
    );
  });

  it("完成 sets completed + completed_at", async () => {
    vi.mocked(kolRepository.getByHandleAnyPlatform).mockResolvedValue(TEST_KOL as never);
    vi.mocked(kolCollaborationRepository.getByKOLId).mockResolvedValue([
      { id: "c1", kol_id: "k1", status: "confirmed" },
    ] as never);

    const handler = new KOLCollabSkillHandler();
    const result = await handler.execute(makeSkillInput("合作 @amy_eats 完成"));

    expect(result.status).toBe("success");
    expect(kolCollaborationRepository.updateStatus).toHaveBeenCalledWith(
      "c1",
      "completed",
      expect.objectContaining({ completed_at: expect.any(String) }),
    );
  });

  it("合作列表 groups by status with handle/amount", async () => {
    vi.mocked(kolCollaborationRepository.getRecent).mockResolvedValue([
      { id: "c1", kol_id: "k1", status: "confirmed", deal_amount: 500, scheduled_at: dayjs().add(3, "day").toISOString(), created_at: "2026-06-25T00:00:00Z" },
      { id: "c2", kol_id: "k2", status: "negotiating", created_at: "2026-06-28T00:00:00Z" },
    ] as never);
    vi.mocked(kolRepository.getById).mockImplementation(async (id: string) =>
      (id === "k1" ? TEST_KOL : { ...TEST_KOL, id: "k2", platform_handle: "ben_bakes" }) as never,
    );

    const handler = new KOLCollabSkillHandler();
    const result = await handler.execute(makeSkillInput("合作列表"));

    expect(result.status).toBe("success");
    expect(result.summary).toContain("已确认");
    expect(result.summary).toContain("洽谈中");
    expect(result.summary).toContain("@amy_eats");
    expect(result.summary).toContain("@ben_bakes");
    expect(result.summary).toContain("RM500");
  });

  it("unknown command replies with usage guide", async () => {
    const handler = new KOLCollabSkillHandler();
    const result = await handler.execute(makeSkillInput("合作一下呗"));
    expect(result.status).toBe("error");
    expect(result.summary).toContain("合作 @handle 确认");
  });
});

// ========== F17 合作效果 ==========

describe("F17 合作效果 @handle", () => {
  it("guides to register a collab first when none confirmed/completed", async () => {
    vi.mocked(kolRepository.getByHandleAnyPlatform).mockResolvedValue(TEST_KOL as never);
    vi.mocked(kolCollaborationRepository.getByKOLId).mockResolvedValue([
      { id: "c1", kol_id: "k1", status: "contacted" },
    ] as never);

    const handler = new KOLCollabSkillHandler();
    const result = await handler.execute(makeSkillInput("合作效果 @amy_eats"));

    expect(result.status).toBe("error");
    expect(result.summary).toContain("合作 @amy_eats 确认");
  });

  it("compares 7 days before vs after, computes rough ROI and top gainers", async () => {
    const base = dayjs().subtract(8, "day").startOf("day"); // 前后 7 天都有数据
    vi.mocked(kolRepository.getByHandleAnyPlatform).mockResolvedValue(TEST_KOL as never);
    vi.mocked(kolCollaborationRepository.getByKOLId).mockResolvedValue([
      { id: "c1", kol_id: "k1", status: "confirmed", deal_amount: 500, scheduled_at: base.toISOString() },
    ] as never);

    const beforeEnd = base.subtract(1, "day").format("YYYY-MM-DD");
    vi.mocked(query).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM daily_revenue")) {
        const rows: unknown[] = [];
        for (let i = -7; i <= 6; i++) {
          const d = base.add(i, "day").format("YYYY-MM-DD");
          const isAfter = i >= 0;
          rows.push({
            date: d,
            revenue: isAfter ? 1200 : 1000,
            transaction_count: isAfter ? 90 : 80,
            avg_transaction_value: isAfter ? 13.3 : 12.5,
          });
        }
        return rows as never;
      }
      if (sql.includes("FROM daily_sales_record")) {
        const isBefore = params?.[1] === beforeEnd;
        return (isBefore
          ? [{ standard_name: "蛋挞", qty: 30 }, { standard_name: "面包", qty: 50 }]
          : [{ standard_name: "蛋挞", qty: 90 }, { standard_name: "面包", qty: 40 }]) as never;
      }
      return [] as never;
    });

    const handler = new KOLCollabSkillHandler();
    const result = await handler.execute(makeSkillInput("合作效果 @amy_eats"));

    expect(result.status).toBe("success");
    expect(result.summary).toContain("日均营业额: 1000 → 1200");
    expect(result.summary).toContain("日均单数: 80 → 90");
    expect(result.summary).toContain("粗 ROI");
    // 增量 = (1200-1000)*7 = 1400 → 1400/500 = 2.8x
    expect(result.summary).toContain("2.8x");
    // 蛋挞 +60 是唯一上涨单品；面包下跌不该出现在涨幅榜
    expect(result.summary).toContain("蛋挞: 30 → 90");
    expect(result.summary).not.toContain("面包: 50");
  });
});
