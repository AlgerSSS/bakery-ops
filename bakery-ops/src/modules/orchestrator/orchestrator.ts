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
import { resolveGroupsForMessage } from "./department-resolver";
import { isSkillAllowedForGroups, GROUP_LABELS } from "./department-permissions";
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

    // 0. 招聘漏斗优先：活跃的候选人对话 / 经理待办 1 键回复 / APPLY-* 扫码，先于 ops 身份识别处理
    //    （已联系=白名单，回复直接进招聘自动流程）。只有命中招聘场景才接管；普通 ops 消息返回 null，
    //    继续走下面原有的身份识别与技能流程，行为不变。懒加载避免循环依赖。
    try {
      const { recruitmentPreRouter } = await import(
        "../domain/recruitment/intake/recruitment-pre-router"
      );
      // 注册的 ops 用户绝不是求职候选人：跳过候选人/扫码分支（仅经理待办 1 键回复仍生效），
      // 避免 ops 消息走招聘热路径（无谓 DB 查询 + 被招聘流程劫持）。身份查询是内存缓存，无 DB。
      // 测试旁路：RECRUITMENT_TEST_CANDIDATE_PHONES 里的号码即使是注册用户也按候选人处理（便于 owner 自测）。
      const testPhones = (process.env.RECRUITMENT_TEST_CANDIDATE_PHONES || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const phoneNum = message.phone || "";
      const isRegisteredOps =
        !testPhones.includes(phoneNum) && Boolean(this.permissionService.getUserByPhone(phoneNum));
      const pre = await recruitmentPreRouter.tryRoute(message, isRegisteredOps);
      if (pre) return pre;
    } catch (preErr) {
      logger.warn("Recruitment pre-router failed, falling through", { error: String(preErr) });
    }

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
          // 陌生号码：友好英文邀约 + 建一个"潜在候选人"对话，回复 1 即进入招聘漏斗（之前一样的流程）。
          try {
            const { recruitmentPreRouter } = await import(
              "../domain/recruitment/intake/recruitment-pre-router"
            );
            const greet = await recruitmentPreRouter.greetStranger(message);
            if (greet) return greet;
          } catch (greetErr) {
            logger.warn("greetStranger failed, falling through", { error: String(greetErr) });
          }
          // 兜底：开放收件箱，不回拒绝语。
          logger.info("Unregistered inbound — open inbox, no auto-reply", { phone });
          return [];
        }
      } else {
        throw err;
      }
    }

    // 1a. KOL 回流闭环（F15）：博主的入站消息不走技能路由——记 dm_received 样本、
    //     合作置 negotiating、原文转发老板、回一句固定英文致谢。
    if (user.role === "kol") {
      return this.handleKolInbound(user, text);
    }

    // 2. 获取对话历史
    const history = this.conversationManager.getHistory(message.conversationId);
    history.push({ role: "user", content: text });

    // 3. 检查是否有进行中的 skill（等待补充信息）
    const conversation = this.stateManager.load(message.conversationId);

    // 全局逃生门：pending 状态下一句"退出"即可脱身，不再被当前技能"劫持"
    // （active_jobs 等技能没有退出词，此前只能等 60 分钟 TTL）— IMPROVEMENT-PLAN.md B3
    // 注：不含"取消/cancel"，那两个词留给技能自身的取消流程处理（行为保持）。
    if (
      conversation.currentSkillId &&
      (conversation.pendingAction === "waiting_for_confirm" || conversation.pendingAction === "waiting_for_info") &&
      /^(退出|算了|不要了|不用了)$/i.test(text.trim())
    ) {
      const escapedSkillName = this.registry.get(conversation.currentSkillId)?.name ?? conversation.currentSkillId;
      this.stateManager.finishSkill(message.conversationId);
      const reply = `已退出「${escapedSkillName}」流程，有需要随时再叫我。`;
      history.push({ role: "assistant", content: reply });
      this.conversationManager.trimHistory(message.conversationId);
      logger.info("Orchestrator: user escaped pending skill", { skillId: conversation.currentSkillId });
      return [{ type: "text", text: reply }];
    }

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
      // 检查 skill 是否已注册且有 handler（权限体系尚未接线，见 IMPROVEMENT-PLAN.md B6）
      const skill = this.registry.get(decision.skillId);
      if (!skill || !skill.handler) {
        const reply = decision.reply || "这个功能还在开发中，暂时用不了。";
        history.push({ role: "assistant", content: reply });
        this.conversationManager.trimHistory(message.conversationId);
        return [{ type: "text", text: reply }];
      }

      // 需要更多信息？
      if (decision.needMoreInfo) {
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

      // 先回复用户"正在处理"（仅对耗时较长的 skill）；按技能名生成，
      // 避免非招聘技能收到"找人选"的错位话术 — IMPROVEMENT-PLAN.md B1
      const ackReply = decision.reply || `好的，正在处理「${skill.name}」，稍等一下~`;
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

  /**
   * F15: role=kol 的入站消息处理。记录/转发失败只进日志，不影响给博主的固定致谢回复。
   * 懒加载 repositories 与 internal-notify（内含 whatsapp.client），避免把 whatsapp-web.js 拖进非 WhatsApp 调用方。
   */
  private async handleKolInbound(user: User, text: string): Promise<ChannelResponse[]> {
    const kolId = user.userId.startsWith("kol_") ? user.userId.slice("kol_".length) : user.userId;

    try {
      const { chatSampleRepository } = await import("../data/repositories/chat-sample.repository");
      await chatSampleRepository.create({
        kol_id: kolId,
        platform: "whatsapp",
        message_content: text,
        message_type: "dm_received",
      });

      const { kolCollaborationRepository } = await import(
        "../data/repositories/kol-collaboration.repository"
      );
      const collabs = await kolCollaborationRepository.getByKOLId(kolId);
      if (collabs[0]) {
        await kolCollaborationRepository.updateStatus(collabs[0].id, "negotiating", {
          dm_response: text,
          dm_responded_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger.error("KOL inbound: failed to record reply", { kolId, error: String(err) });
    }

    // 原文转发老板（已建立会话号码，非冷发送）
    const owner = process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE || "";
    if (owner) {
      try {
        const { notifyInternal } = await import("../channel/internal-notify");
        await notifyInternal(owner, `【KOL 回复】${user.name} (${user.phone}):\n${text}`);
      } catch (fwdErr) {
        logger.error("KOL inbound: owner forward failed", { kolId, error: String(fwdErr) });
      }
    }

    return [{
      type: "text",
      text: "Thank you for getting back to us! We've received your message and our team will reply to you shortly.",
    }];
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

    // 按 Lark 组织架构的部门权限检查（用户确认 2026-07-03）。
    // 老板/admin 直接放行；否则按其 Lark 部门解析权限组。解析不到部门时 fail-open（放行+日志），
    // 绝不误锁真人。LARK_PERMISSION_ENFORCE!="true" 时退回 log-only 观测。
    const denial = await this.checkDepartmentPermission(user, message, skillId);
    if (denial) {
      this.stateManager.finishSkill(message.conversationId);
      return [{ type: "text", text: denial }];
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
      // 原始异常只进日志，不透传给用户 — IMPROVEMENT-PLAN.md B1
      const skillName = this.registry.get(skillId)?.name ?? skillId;
      return [{ type: "text", text: `「${skillName}」执行失败了，请稍后重试；如果一直不行请联系管理员。` }];
    }
  }

  /**
   * 按 Lark 组织架构检查部门权限。返回拒绝提示串则拦截，返回 null 则放行。
   * 老板/admin 与"帮助/系统状态"永远放行；解析不到 Lark 部门时 fail-open。
   * LARK_PERMISSION_ENFORCE!=="true" 时只记日志不拦截（观测模式）。
   */
  private async checkDepartmentPermission(
    user: User,
    message: ChannelMessage,
    skillId: string,
  ): Promise<string | null> {
    if (user.role === "owner" || user.role === "admin") return null;
    if (skillId === "help" || skillId === "system_status") return null;

    const { groups, resolved } = await resolveGroupsForMessage(message);
    if (!resolved) {
      logger.warn("Department permission: no Lark dept resolved, fail-open", {
        userId: user.userId, skillId, phone: message.phone?.replace(/@.*/, ""),
      });
      return null; // 解析不到 → 放行，绝不误锁
    }
    if (isSkillAllowedForGroups(skillId, groups)) return null;

    const groupLabels = [...groups].filter((g) => g !== "everyone").map((g) => GROUP_LABELS[g]).join("/") || "所在";
    const skillName = this.registry.get(skillId)?.name ?? skillId;
    if (process.env.LARK_PERMISSION_ENFORCE !== "true") {
      logger.warn("Department permission (observe-only): would deny", {
        userId: user.userId, skillId, groups: [...groups],
      });
      return null; // 观测模式：只记不拦
    }
    logger.info("Department permission denied", { userId: user.userId, skillId, groups: [...groups] });
    return `「${skillName}」需要相应部门权限，你当前属于「${groupLabels}」部门，没有开通这个功能。如需使用请联系总经办。`;
  }
}
