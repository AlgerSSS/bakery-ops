import { describe, it, expect, beforeEach, vi } from "vitest";
import { SkillRegistry } from "@/modules/orchestrator/skill-registry";
import { SkillRouter, type AiRouterProvider } from "@/modules/orchestrator/skill-router";
import { StateManager } from "@/modules/orchestrator/state-manager";
import { PermissionService } from "@/modules/orchestrator/permission-service";
import { AuditService } from "@/modules/orchestrator/audit-service";
import { Orchestrator } from "@/modules/orchestrator/orchestrator";
import type { ChannelMessage, User } from "@/modules/shared/types";
import {
  recruitmentSkillDefinition,
} from "@/modules/skills/recruitment/recruitment.definition";
import {
  forecastOrderSkillDefinition,
  ForecastOrderSkillHandler,
} from "@/modules/skills/forecast-order/forecast-order.definition";
import {
  kitchenProductionPlanSkillDefinition,
  KitchenProductionPlanSkillHandler,
} from "@/modules/skills/kitchen-production-plan/kitchen-production-plan.definition";
import {
  employeeManagementSkillDefinition,
} from "@/modules/skills/employee-management/employee-management.definition";
import type { SkillHandler, SkillExecutionInput, SkillExecutionResult } from "@/modules/shared/types";

// Mock recruitment handler
class MockRecruitmentHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    return {
      runId: "mock-run-id",
      skillId: "recruitment_sourcing",
      status: "success",
      summary: `已收到招聘需求：${input.input.jdText || "未指定"}`,
    };
  }
}

// Mock employee management handler
class MockEmployeeHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    return {
      runId: "mock-emp-id",
      skillId: "employee_management",
      status: "success",
      summary: `已记录员工事件：${String(input.input.jdText || "").slice(0, 50)}`,
    };
  }
}

/**
 * Smart mock AI provider that returns context-appropriate LLM decisions.
 * The orchestrator calls chatCompletionLong with a system prompt containing
 * conversation history. We parse the last user message to decide the response.
 */
function createSmartMockAi(): AiRouterProvider {
  return {
    async getEmbedding() { return []; },
    async getEmbeddings() { return []; },
    async chatCompletion() { return '{"skill_id": null, "confidence": 0}'; },
    async chatCompletionLong(prompt: string) {
      // Extract last user message from the prompt
      const userLines = prompt.match(/用户: (.+)/g) || [];
      const lastUserMsg = userLines.length > 0
        ? userLines[userLines.length - 1].replace("用户: ", "")
        : "";

      // Recruitment keywords
      if (/招聘|招人|找人|JD|岗位/.test(lastUserMsg)) {
        // If very vague (just "招人" without details), ask for more info
        if (/^(帮我)?招人$/.test(lastUserMsg.trim())) {
          return JSON.stringify({
            action: "skill",
            skillId: "recruitment_sourcing",
            reply: "好的，你需要招什么岗位？请提供一下岗位要求。",
            needMoreInfo: true,
          });
        }
        return JSON.stringify({
          action: "skill",
          skillId: "recruitment_sourcing",
          reply: "好的，我来帮你搜索合适的候选人。",
          needMoreInfo: false,
        });
      }

      // Employee management keywords
      if (/面试|入职|离职|辞职|表现|绩效|试用期|转正/.test(lastUserMsg)) {
        return JSON.stringify({
          action: "skill",
          skillId: "employee_management",
          reply: "好的，我来记录这个信息。",
          needMoreInfo: false,
        });
      }

      // Forced skill (补充信息 scenario) — check if prompt mentions forcedSkillId
      if (prompt.includes("当前正在进行") && prompt.includes("用户在补充信息")) {
        return JSON.stringify({
          action: "skill",
          reply: "信息足够了，开始处理。",
          needMoreInfo: false,
        });
      }

      // Default: chat
      return JSON.stringify({
        action: "chat",
        reply: "你好，有什么可以帮你的？",
      });
    },
  };
}

// Simple mock that always returns chat (for router tests)
const simpleMockAi: AiRouterProvider = {
  async getEmbedding() { return []; },
  async getEmbeddings() { return []; },
  async chatCompletion() { return '{"skill_id": null, "confidence": 0}'; },
  async chatCompletionLong() { return '{"action": "chat", "reply": "你好"}'; },
};

function createTestOrchestrator() {
  const registry = new SkillRegistry();
  const stateManager = new StateManager();
  const permissionService = new PermissionService();
  const auditService = new AuditService();
  const mockAiProvider = createSmartMockAi();

  // Register skills with mock handlers
  recruitmentSkillDefinition.handler = new MockRecruitmentHandler();
  registry.register(recruitmentSkillDefinition);

  forecastOrderSkillDefinition.handler = new ForecastOrderSkillHandler();
  registry.register(forecastOrderSkillDefinition);

  kitchenProductionPlanSkillDefinition.handler = new KitchenProductionPlanSkillHandler();
  registry.register(kitchenProductionPlanSkillDefinition);

  employeeManagementSkillDefinition.handler = new MockEmployeeHandler();
  registry.register(employeeManagementSkillDefinition);

  // Register test users
  permissionService.registerUser({
    userId: "u_owner",
    phone: "60123456789",
    name: "Test Owner",
    role: "owner",
    permissions: [],
    storeIds: ["pavilion"],
  });

  permissionService.registerUser({
    userId: "u_staff",
    phone: "60111111111",
    name: "Test Staff",
    role: "staff",
    permissions: [],
    storeIds: ["pavilion"],
  });

  permissionService.registerUser({
    userId: "u_hr",
    phone: "60222222222",
    name: "Test HR",
    role: "hr_manager",
    permissions: [],
    storeIds: ["pavilion"],
  });

  const orchestrator = new Orchestrator(
    registry,
    stateManager,
    permissionService,
    auditService,
    mockAiProvider,
  );

  return { orchestrator, registry, stateManager, permissionService, auditService };
}

function makeMessage(phone: string, text: string, conversationId = "conv_1"): ChannelMessage {
  return {
    channel: "whatsapp",
    messageId: `msg_${Date.now()}`,
    conversationId,
    phone,
    text,
    timestamp: new Date().toISOString(),
  };
}

// ========== Tests ==========

describe("SkillRegistry", () => {
  it("registers and retrieves skills sorted by priority", () => {
    const { registry } = createTestOrchestrator();
    const all = registry.getAll();
    expect(all.length).toBe(4);
    expect(all[0].skillId).toBe("recruitment_sourcing"); // priority 100
  });

  it("generates menu text", () => {
    const { registry } = createTestOrchestrator();
    const menu = registry.getMenuText();
    expect(menu).toContain("招聘");
    expect(menu).toContain("员工管理");
  });
});

describe("SkillRouter Layer 1 — 关键词匹配", () => {
  it("routes '招聘' to recruitment skill", async () => {
    const { registry } = createTestOrchestrator();
    const router = new SkillRouter(registry, simpleMockAi);
    const result = await router.route("帮我招聘一个店员");
    expect(result).not.toBeNull();
    expect(result!.selectedSkill.skillId).toBe("recruitment_sourcing");
    expect(result!.layer).toBe(1);
    expect(result!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("routes '预估单' to forecast skill", async () => {
    const { registry } = createTestOrchestrator();
    const router = new SkillRouter(registry, simpleMockAi);
    const result = await router.route("生成明天预估单");
    expect(result).not.toBeNull();
    expect(result!.selectedSkill.skillId).toBe("forecast_order");
    expect(result!.layer).toBe(1);
  });

  it("routes '后厨计划' to kitchen skill", async () => {
    const { registry } = createTestOrchestrator();
    const router = new SkillRouter(registry, simpleMockAi);
    const result = await router.route("生成后厨计划");
    expect(result).not.toBeNull();
    expect(result!.selectedSkill.skillId).toBe("kitchen_production_plan");
    expect(result!.layer).toBe(1);
  });

  it("returns null for unrecognized text (with mock AI)", async () => {
    const { registry } = createTestOrchestrator();
    const router = new SkillRouter(registry, simpleMockAi);
    const result = await router.route("今天天气怎么样");
    expect(result).toBeNull();
  });
});

describe("Orchestrator — LLM 决策", () => {
  it("returns chat reply for general messages", async () => {
    const { orchestrator } = createTestOrchestrator();
    const msg = makeMessage("60123456789", "你好");
    const responses = await orchestrator.handle(msg);
    expect(responses.length).toBeGreaterThan(0);
    expect(responses[0].text).toContain("你好");
  });

  it("routes recruitment request to skill", async () => {
    const { orchestrator } = createTestOrchestrator();
    const msg = makeMessage("60123456789", "帮我招聘一个收银员，要会中英文");
    const responses = await orchestrator.handle(msg);
    // Should have ack + skill result
    expect(responses.length).toBeGreaterThanOrEqual(2);
    expect(responses.some(r => r.text?.includes("已收到招聘需求"))).toBe(true);
  });

  it("asks for more info when recruitment request is vague", async () => {
    const { orchestrator } = createTestOrchestrator();
    const msg = makeMessage("60123456789", "帮我招人", "conv_vague");
    const responses = await orchestrator.handle(msg);
    expect(responses[0].text).toContain("岗位");
  });

  it("routes employee event to employee_management skill", async () => {
    const { orchestrator } = createTestOrchestrator();
    const msg = makeMessage("60123456789", "张三面试表现不错，沟通能力强");
    const responses = await orchestrator.handle(msg);
    expect(responses.some(r => r.text?.includes("已记录员工事件"))).toBe(true);
  });
});

describe("Orchestrator — 权限", () => {
  it("rejects unregistered user", async () => {
    const { orchestrator } = createTestOrchestrator();
    const msg = makeMessage("99999999999", "招聘");
    const responses = await orchestrator.handle(msg);
    expect(responses[0].text).toContain("尚未注册");
  });
});

describe("Orchestrator — 多轮对话 (needMoreInfo)", () => {
  it("asks for details then executes skill on follow-up", async () => {
    const { orchestrator } = createTestOrchestrator();
    const convId = "conv_multiturn";

    // Round 1: vague request → needMoreInfo
    const msg1 = makeMessage("60123456789", "帮我招人", convId);
    const resp1 = await orchestrator.handle(msg1);
    expect(resp1[0].text).toContain("岗位");

    // Round 2: provide details → skill executes
    const msg2 = makeMessage("60123456789", "需要一个会中文的前场收银员", convId);
    const resp2 = await orchestrator.handle(msg2);
    // Should execute the skill (ack + result from formatter)
    expect(resp2.some(r => r.text?.includes("已收到招聘需求"))).toBe(true);
  });
});

describe("StateManager", () => {
  it("manages session lifecycle", () => {
    const sm = new StateManager();
    const state = sm.startSkill("conv_1", "recruitment_sourcing", ["jdText", "location"]);
    expect(state.missingInputs).toEqual(["jdText", "location"]);

    sm.collectInput("conv_1", "jdText", "test");
    expect(sm.isComplete("conv_1")).toBe(false);

    sm.collectInput("conv_1", "location", "KL");
    expect(sm.isComplete("conv_1")).toBe(true);

    sm.finishSkill("conv_1");
    const fresh = sm.load("conv_1");
    expect(fresh.currentSkillId).toBeUndefined();
  });
});

describe("PermissionService", () => {
  it("owner has all permissions", () => {
    const ps = new PermissionService();
    const owner: User = {
      userId: "u1", phone: "123", name: "O", role: "owner", permissions: [], storeIds: [],
    };
    expect(ps.hasPermission(owner, "recruitment.use")).toBe(true);
    expect(ps.hasPermission(owner, "anything")).toBe(true);
  });

  it("staff has limited permissions", () => {
    const ps = new PermissionService();
    const staff: User = {
      userId: "u2", phone: "456", name: "S", role: "staff", permissions: [], storeIds: [],
    };
    expect(ps.hasPermission(staff, "forecast.export")).toBe(true);
    expect(ps.hasPermission(staff, "recruitment.use")).toBe(false);
  });

  it("hr_manager has employee.manage permission", () => {
    const ps = new PermissionService();
    const hr: User = {
      userId: "u3", phone: "789", name: "H", role: "hr_manager", permissions: [], storeIds: [],
    };
    expect(ps.hasPermission(hr, "employee.manage")).toBe(true);
    expect(ps.hasPermission(hr, "recruitment.use")).toBe(true);
    expect(ps.hasPermission(hr, "forecast.generate")).toBe(false);
  });
});
