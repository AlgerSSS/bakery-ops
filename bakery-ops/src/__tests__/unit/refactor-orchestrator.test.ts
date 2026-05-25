import { describe, it, expect, vi } from "vitest";
import { ConversationManager } from "@/modules/orchestrator/conversation-manager";
import { ResponseFormatter } from "@/modules/orchestrator/response-formatter";
import { IntentRouter, type AiRouterProvider } from "@/modules/orchestrator/intent-router";
import { SkillRegistry } from "@/modules/orchestrator/skill-registry";
import { StateManager } from "@/modules/orchestrator/state-manager";
import { PermissionService } from "@/modules/orchestrator/permission-service";
import { AuditService } from "@/modules/orchestrator/audit-service";
import { Orchestrator } from "@/modules/orchestrator/orchestrator";
import type { AiProvider, ChatMessage } from "@/modules/shared/ai/ai-provider.interface";
import type { SkillExecutionResult, SkillHandler, SkillExecutionInput, SkillDefinition } from "@/modules/shared/types";
import type { ChannelMessage } from "@/modules/shared/types";

// ========== ConversationManager ==========

describe("ConversationManager", () => {
  it("returns empty array for new conversation", () => {
    const cm = new ConversationManager();
    const history = cm.getHistory("conv_new");
    expect(history).toEqual([]);
  });

  it("addMessage adds entry to history", () => {
    const cm = new ConversationManager();
    cm.addMessage("conv_1", { role: "user", content: "hello" });
    const history = cm.getHistory("conv_1");
    expect(history).toHaveLength(1);
    expect(history[0]).toEqual({ role: "user", content: "hello" });
  });

  it("addMessage appends multiple entries in order", () => {
    const cm = new ConversationManager();
    cm.addMessage("conv_1", { role: "user", content: "first" });
    cm.addMessage("conv_1", { role: "assistant", content: "second" });
    const history = cm.getHistory("conv_1");
    expect(history).toHaveLength(2);
    expect(history[1].content).toBe("second");
  });

  it("trimHistory trims to MAX_HISTORY (20) when exceeded", () => {
    const cm = new ConversationManager();
    for (let i = 0; i < 25; i++) {
      cm.addMessage("conv_trim", { role: "user", content: `msg_${i}` });
    }
    cm.trimHistory("conv_trim");
    const history = cm.getHistory("conv_trim");
    expect(history).toHaveLength(20);
    expect(history[0].content).toBe("msg_5");
    expect(history[19].content).toBe("msg_24");
  });

  it("trimHistory does nothing when history is within limit", () => {
    const cm = new ConversationManager();
    for (let i = 0; i < 10; i++) {
      cm.addMessage("conv_small", { role: "user", content: `msg_${i}` });
    }
    cm.trimHistory("conv_small");
    expect(cm.getHistory("conv_small")).toHaveLength(10);
  });

  it("multiple conversations are isolated", () => {
    const cm = new ConversationManager();
    cm.addMessage("conv_a", { role: "user", content: "from a" });
    cm.addMessage("conv_b", { role: "user", content: "from b" });
    expect(cm.getHistory("conv_a")).toHaveLength(1);
    expect(cm.getHistory("conv_a")[0].content).toBe("from a");
    expect(cm.getHistory("conv_b")[0].content).toBe("from b");
  });
});

// ========== ResponseFormatter ==========

describe("ResponseFormatter", () => {
  it("format delegates to WhatsAppFormatter and returns text response for summary", () => {
    const formatter = new ResponseFormatter();
    const result: SkillExecutionResult = {
      runId: "r1",
      skillId: "test_skill",
      status: "success",
      summary: "操作成功",
    };
    const responses = formatter.format(result);
    expect(responses).toHaveLength(1);
    expect(responses[0].type).toBe("text");
    expect(responses[0].text).toBe("操作成功");
  });

  it("format returns empty array when result has no summary and no files", () => {
    const formatter = new ResponseFormatter();
    const result: SkillExecutionResult = {
      runId: "r2",
      skillId: "test_skill",
      status: "success",
      summary: "",
    };
    const responses = formatter.format(result);
    expect(responses).toHaveLength(0);
  });

  it("formatError returns error response with given message", () => {
    const formatter = new ResponseFormatter();
    const responses = formatter.formatError("出错了");
    expect(responses).toHaveLength(1);
    expect(responses[0].type).toBe("text");
    expect(responses[0].text).toBe("出错了");
  });

  it("prependAck prepends ack message before existing responses", () => {
    const formatter = new ResponseFormatter();
    const existing = [{ type: "text" as const, text: "结果" }];
    const result = formatter.prependAck("好的，处理中", existing);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("好的，处理中");
    expect(result[1].text).toBe("结果");
  });

  it("prependAck with empty responses returns only ack", () => {
    const formatter = new ResponseFormatter();
    const result = formatter.prependAck("收到", []);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("收到");
  });
});

// ========== AiProvider interface mock ==========

describe("AiProvider interface — chatCompletionMessages", () => {
  it("mock implementing full interface can be called with messages array", async () => {
    const mockProvider: AiProvider = {
      async chatCompletion(prompt: string) { return "ok"; },
      async chatCompletionLong(prompt: string) { return "ok long"; },
      async chatCompletionMessages(messages: ChatMessage[], options?) {
        return JSON.stringify({ action: "chat", reply: "hello" });
      },
      async getEmbedding(text: string) { return [0.1, 0.2]; },
      async getEmbeddings(texts: string[]) { return texts.map(() => [0.1, 0.2]); },
    };

    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" },
    ];

    const result = await mockProvider.chatCompletionMessages(messages);
    const parsed = JSON.parse(result);
    expect(parsed.action).toBe("chat");
    expect(parsed.reply).toBe("hello");
  });

  it("mock chatCompletionMessages receives correct message roles", async () => {
    const receivedMessages: ChatMessage[] = [];
    const mockProvider: AiProvider = {
      async chatCompletion() { return ""; },
      async chatCompletionLong() { return ""; },
      async chatCompletionMessages(messages: ChatMessage[]) {
        receivedMessages.push(...messages);
        return JSON.stringify({ action: "chat", reply: "ok" });
      },
      async getEmbedding() { return []; },
      async getEmbeddings() { return [[]]; },
    };

    const messages: ChatMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "user", content: "user message" },
      { role: "assistant", content: "assistant reply" },
    ];

    await mockProvider.chatCompletionMessages(messages);
    expect(receivedMessages[0].role).toBe("system");
    expect(receivedMessages[1].role).toBe("user");
    expect(receivedMessages[2].role).toBe("assistant");
  });
});

// ========== IntentRouter with chatCompletionMessages ==========

describe("IntentRouter — chatCompletionMessages", () => {
  function makeRegistry(): SkillRegistry {
    const registry = new SkillRegistry();
    const skill: SkillDefinition = {
      skillId: "test_skill",
      name: "测试技能",
      description: "用于测试",
      priority: 50,
      triggerKeywords: ["测试关键词"],
      examples: ["测试示例"],
      requiredInputs: [],
      optionalInputs: [],
      permissions: [],
      riskLevel: "low",
      requiresConfirmation: false,
      supportsMultiTurn: false,
      supportsFiles: false,
      supportsCron: false,
      outputTypes: ["text"],
      handler: null,
    };
    registry.register(skill);
    return registry;
  }

  it("calls chatCompletionMessages with system message as first element", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const mockAi: AiRouterProvider = {
      async chatCompletion() { return ""; },
      async chatCompletionLong() { return ""; },
      async chatCompletionMessages(messages: ChatMessage[]) {
        capturedMessages.push([...messages]);
        return JSON.stringify({ action: "chat", reply: "你好" });
      },
      async getEmbedding() { return []; },
      async getEmbeddings() { return [[]]; },
    };

    const registry = makeRegistry();
    const router = new IntentRouter(registry, mockAi);
    await router.route("你好", []);

    expect(capturedMessages.length).toBeGreaterThan(0);
    const messages = capturedMessages[0];
    expect(messages[0].role).toBe("system");
  });

  it("passes history messages after system message", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const mockAi: AiRouterProvider = {
      async chatCompletion() { return ""; },
      async chatCompletionLong() { return ""; },
      async chatCompletionMessages(messages: ChatMessage[]) {
        capturedMessages.push([...messages]);
        return JSON.stringify({ action: "chat", reply: "好的" });
      },
      async getEmbedding() { return []; },
      async getEmbeddings() { return [[]]; },
    };

    const registry = makeRegistry();
    const router = new IntentRouter(registry, mockAi);
    const history = [
      { role: "user", content: "上一条消息" },
      { role: "assistant", content: "上一条回复" },
    ];
    await router.route("新消息", history);

    const messages = capturedMessages[0];
    expect(messages[0].role).toBe("system");
    const nonSystem = messages.slice(1);
    expect(nonSystem.some((m) => m.content === "上一条消息")).toBe(true);
    expect(nonSystem.some((m) => m.content === "上一条回复")).toBe(true);
  });

  it("spy records messages passed to chatCompletionMessages", async () => {
    const spy = vi.fn().mockResolvedValue(JSON.stringify({ action: "chat", reply: "spy reply" }));
    const mockAi: AiRouterProvider = {
      async chatCompletion() { return ""; },
      async chatCompletionLong() { return ""; },
      chatCompletionMessages: spy,
      async getEmbedding() { return []; },
      async getEmbeddings() { return [[]]; },
    };

    const registry = makeRegistry();
    const router = new IntentRouter(registry, mockAi);
    await router.route("测试消息", [{ role: "user", content: "历史消息" }]);

    expect(spy).toHaveBeenCalledOnce();
    const [calledMessages] = spy.mock.calls[0] as [ChatMessage[], unknown];
    expect(calledMessages[0].role).toBe("system");
    expect(calledMessages.some((m) => m.content === "历史消息")).toBe(true);
  });
});

// ========== Orchestrator integration ==========

describe("Orchestrator integration", () => {
  function makeSkillDef(skillId: string, handler: SkillHandler): SkillDefinition {
    return {
      skillId,
      name: skillId,
      description: "test skill",
      priority: 100,
      triggerKeywords: [],
      examples: [],
      requiredInputs: [],
      optionalInputs: [],
      permissions: [],
      riskLevel: "low",
      requiresConfirmation: false,
      supportsMultiTurn: false,
      supportsFiles: false,
      supportsCron: false,
      outputTypes: ["text"],
      handler,
    };
  }

  function makeMessage(phone: string, text: string, conversationId = "conv_test"): ChannelMessage {
    return {
      channel: "whatsapp",
      messageId: `msg_${Date.now()}_${Math.random()}`,
      conversationId,
      phone,
      text,
      timestamp: new Date().toISOString(),
    };
  }

  function buildOrchestrator(aiProvider: AiProvider) {
    const registry = new SkillRegistry();
    const stateManager = new StateManager();
    const permissionService = new PermissionService();
    const auditService = new AuditService();

    permissionService.registerUser({
      userId: "u_owner",
      phone: "60123456789",
      name: "Test Owner",
      role: "owner",
      permissions: [],
      storeIds: ["store1"],
    });

    const mockHandler: SkillHandler = {
      async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
        return {
          runId: "run_1",
          skillId: input.skillId,
          status: "success",
          summary: `skill executed: ${input.skillId}`,
        };
      },
    };
    registry.register(makeSkillDef("test_skill", mockHandler));

    const orchestrator = new Orchestrator(registry, stateManager, permissionService, auditService, aiProvider);
    return { orchestrator, stateManager };
  }

  it("full flow: message in → user identified → intent routed → response formatted", async () => {
    const mockAi: AiProvider = {
      async chatCompletion() { return ""; },
      async chatCompletionLong() { return ""; },
      async chatCompletionMessages() {
        return JSON.stringify({ action: "chat", reply: "你好，有什么可以帮你的？" });
      },
      async getEmbedding() { return []; },
      async getEmbeddings() { return [[]]; },
    };

    const { orchestrator } = buildOrchestrator(mockAi);
    const msg = makeMessage("60123456789", "你好");
    const responses = await orchestrator.handle(msg);

    expect(responses.length).toBeGreaterThan(0);
    expect(responses[0].type).toBe("text");
    expect(responses[0].text).toContain("你好");
  });

  it("conversation history is persisted across messages in same conversation", async () => {
    const capturedHistories: ChatMessage[][] = [];
    const mockAi: AiProvider = {
      async chatCompletion() { return ""; },
      async chatCompletionLong() { return ""; },
      async chatCompletionMessages(messages: ChatMessage[]) {
        capturedHistories.push([...messages]);
        return JSON.stringify({ action: "chat", reply: "收到" });
      },
      async getEmbedding() { return []; },
      async getEmbeddings() { return [[]]; },
    };

    const { orchestrator } = buildOrchestrator(mockAi);
    const convId = "conv_persist";

    await orchestrator.handle(makeMessage("60123456789", "第一条消息", convId));
    await orchestrator.handle(makeMessage("60123456789", "第二条消息", convId));

    // Second call should have history from first message
    expect(capturedHistories.length).toBe(2);
    const secondCallMessages = capturedHistories[1];
    const nonSystem = secondCallMessages.filter((m) => m.role !== "system");
    expect(nonSystem.some((m) => m.content === "第一条消息")).toBe(true);
  });

  it("returns error response for unregistered user", async () => {
    const mockAi: AiProvider = {
      async chatCompletion() { return ""; },
      async chatCompletionLong() { return ""; },
      async chatCompletionMessages() {
        return JSON.stringify({ action: "chat", reply: "ok" });
      },
      async getEmbedding() { return []; },
      async getEmbeddings() { return [[]]; },
    };

    const { orchestrator } = buildOrchestrator(mockAi);
    const msg = makeMessage("99999999999", "你好");
    const responses = await orchestrator.handle(msg);

    expect(responses.length).toBeGreaterThan(0);
    expect(responses[0].type).toBe("text");
  });
});
