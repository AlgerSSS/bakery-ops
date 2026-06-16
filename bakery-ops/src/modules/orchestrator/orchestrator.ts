import type { ChannelMessage, ChannelResponse, SkillExecutionInput, User } from "../shared/types";
import type { AiProvider } from "../shared/ai/ai-provider.interface";
import { SkillRegistry } from "./skill-registry";
import { IntentRouter } from "./intent-router";
import { StateManager } from "./state-manager";
import { PermissionService } from "./permission-service";
import { AuditService } from "./audit-service";
import { ConversationManager } from "./conversation-manager";
import type { ChatHistoryEntry } from "./conversation-manager";
import { ResponseFormatter } from "./response-formatter";
import { UserNotRegisteredError } from "../shared/errors/skill-error";
import { kolRepository } from "../data/repositories/kol.repository";
import { chatHistoryRepository } from "../data/repositories/chat-history.repository";
import { logger } from "../shared/logger";

export class Orchestrator {
  private intentRouter: IntentRouter;
  private conversationManager = new ConversationManager(chatHistoryRepository);
  private responseFormatter = new ResponseFormatter();

  constructor(
    private registry: SkillRegistry,
    private stateManager: StateManager,
    private permissionService: PermissionService,
    private auditService: AuditService,
    aiProvider: AiProvider,
  ) {
    this.intentRouter = new IntentRouter(registry, aiProvider);
  }

  async handle(message: ChannelMessage): Promise<ChannelResponse[]> {
    const text = message.text?.trim() || "";
    if (!text) return [];

    // 1. 识别用户
    let user: User;
    try {
      user = this.permissionService.identifyUser(message.phone || "");
    } catch (err) {
      if (err instanceof UserNotRegisteredError) {
        // 检查是否是已知 KOL（博主被 DM 引流来 WhatsApp）
        const phone = message.phone || "";
        // 限定 KOL 查询时长：DB 不可达/缓慢时退回未注册响应（与原行为一致），避免阻塞
        const kol = await Promise.race([
          kolRepository.getByPhone(phone).catch(() => null),
          new Promise<null>((res) => setTimeout(() => res(null), 2000)),
        ]);
        if (kol) {
          user = {
            userId: `kol_${kol.id}`,
            phone,
            name: kol.name,
            role: "kol",
            permissions: ["marketing.use"],
            storeIds: [],
          };
          this.permissionService.registerUser(user);
        } else {
          return this.responseFormatter.formatError(err.message);
        }
      } else {
        throw err;
      }
    }

    // 2. 获取对话历史
    const history = this.conversationManager.getHistory(message.conversationId);
    history.push({ role: "user", content: text });

    // 3. 检查是否有进行中的 skill（等待补充信息）
    const conversation = this.stateManager.load(message.conversationId);

    // 3a. 等待用户确认（交互式多步流程，如发布职位）
    if (conversation.currentSkillId && conversation.pendingAction === "waiting_for_confirm") {
      logger.info("Orchestrator: resuming confirm flow", {
        skillId: conversation.currentSkillId,
        conversationId: message.conversationId,
      });

      // 把用户回复和之前保存的 posting state 传入 skill handler
      const input: Record<string, unknown> = {
        text,
        ...conversation.collectedInputs,
      };

      return this.runSkillAndRespond(
        conversation.currentSkillId,
        user,
        message,
        input,
        history,
      );
    }

    // 3b. 等待补充信息
    if (conversation.currentSkillId && conversation.pendingAction === "waiting_for_info") {
      // 用户在补充信息，把之前的 JD + 新消息合并
      const prevJd = String(conversation.collectedInputs.jdText || "");
      const combined = prevJd ? `${prevJd}\n\n补充信息: ${text}` : text;
      conversation.collectedInputs.jdText = combined;
      this.stateManager.save(conversation);

      // 让 IntentRouter 判断信息是否足够
      const checkResult = await this.intentRouter.route(text, history, conversation.currentSkillId);
      if (checkResult.action === "need_info") {
        const reply = checkResult.reply;
        history.push({ role: "assistant", content: reply });
        this.conversationManager.trimHistory(message.conversationId);
        return [{ type: "text", text: reply }];
      }

      // 信息足够，执行 skill
      return this.runSkillAndRespond(
        conversation.currentSkillId,
        user,
        message,
        conversation.collectedInputs,
        history,
      );
    }

    // 4. IntentRouter 决策：聊天 / 触发 skill / 追问
    const decision = await this.intentRouter.route(text, history);

    if (decision.action === "skill" && decision.skillId) {
      // 检查权限
      const skill = this.registry.get(decision.skillId);
      if (!skill || !skill.handler) {
        const reply = decision.reply || "这个功能还在开发中，暂时用不了。";
        history.push({ role: "assistant", content: reply });
        this.conversationManager.trimHistory(message.conversationId);
        return [{ type: "text", text: reply }];
      }

      // 需要更多信息？
      if (decision.action === "skill" && decision.needMoreInfo) {
        this.stateManager.startSkill(message.conversationId, decision.skillId, ["jdText"]);
        const state = this.stateManager.load(message.conversationId);
        state.pendingAction = "waiting_for_info";
        state.collectedInputs = { jdText: text };
        this.stateManager.save(state);

        const reply = decision.reply;
        history.push({ role: "assistant", content: reply });
        this.conversationManager.trimHistory(message.conversationId);
        return [{ type: "text", text: reply }];
      }

      // 先回复用户"正在处理"（仅对耗时较长的 skill）
      const ackReply = decision.reply || "好的，我来帮你找合适的人选，稍等一下~";
      history.push({ role: "assistant", content: ackReply });

      // 执行 skill
      const input: Record<string, unknown> = { jdText: text, text, ...decision.skillInput };
      const responses = await this.runSkillAndRespond(
        decision.skillId, user, message, input, history,
      );

      // 快速 skill（员工管理、知识查询）只返回结果，不加 ack 前缀
      const fastSkills = ["employee_management", "knowledge_query", "resume_upload"];
      if (fastSkills.includes(decision.skillId)) {
        return responses.length > 0 ? responses : [{ type: "text", text: ackReply }];
      }

      // 耗时 skill（招聘等）在结果前插入 ack 消息
      return [{ type: "text", text: ackReply }, ...responses];
    }

    // 普通聊天回复
    const reply = decision.reply || "你好，有什么可以帮你的？";
    history.push({ role: "assistant", content: reply });
    this.conversationManager.trimHistory(message.conversationId);
    return [{ type: "text", text: reply }];
  }

  private async runSkillAndRespond(
    skillId: string,
    user: User,
    message: ChannelMessage,
    input: Record<string, unknown>,
    history: ChatHistoryEntry[],
  ): Promise<ChannelResponse[]> {
    const skill = this.registry.get(skillId);
    if (!skill || !skill.handler) {
      this.stateManager.finishSkill(message.conversationId);
      return [{ type: "text", text: "这个功能暂时还没准备好。" }];
    }

    const executionInput: SkillExecutionInput = {
      skillId,
      userId: user.userId,
      channel: message.channel,
      conversationId: message.conversationId,
      input,
      rawMessage: message,
    };

    const run = this.auditService.startRun(skillId, user.userId, message.channel, input);

    try {
      const result = await skill.handler.execute(executionInput);
      this.auditService.completeRun(run.runId, { summary: result.summary });

      // 如果 skill 返回 pending，保存状态等待用户确认
      if (result.status === "pending" && result.data) {
        const state = this.stateManager.load(message.conversationId);
        state.currentSkillId = skillId;
        state.pendingAction = "waiting_for_confirm";
        state.collectedInputs = { ...state.collectedInputs, ...result.data };
        this.stateManager.save(state);

        logger.info("Orchestrator: skill pending, waiting for confirm", { skillId });
      } else {
        this.stateManager.finishSkill(message.conversationId);
      }

      // 用 formatter 输出结果（包含文件/截图）
      const formatted = this.responseFormatter.format(result);

      // 记录到历史
      if (result.summary) {
        history.push({ role: "assistant", content: result.summary.slice(0, 500) });
      }
      this.conversationManager.trimHistory(message.conversationId);

      return formatted;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.auditService.failRun(run.runId, errorMsg);
      this.stateManager.finishSkill(message.conversationId);
      logger.error("Skill execution failed", { skillId, error: errorMsg });
      return [{ type: "text", text: `搜索过程中遇到了问题: ${errorMsg}\n要不换个方式描述一下需求？` }];
    }
  }
}
