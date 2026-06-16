import { logger } from "../shared/logger";

export interface ConversationState {
  conversationId: string;
  userId?: string;
  currentSkillId?: string;
  pendingAction?: string;
  collectedInputs: Record<string, unknown>;
  missingInputs: string[];
  lastActiveAt: number;
}

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 分钟超时

export class StateManager {
  private sessions: Map<string, ConversationState> = new Map();

  constructor(
    private repo?: {
      upsert(state: ConversationState): Promise<void>;
      delete(conversationId: string): Promise<void>;
    },
  ) {}

  /** 冷启动时从持久层恢复未过期的会话到内存（best-effort，失败则忽略） */
  async hydrate(repo: { getActive(ttlMs: number): Promise<ConversationState[]> }): Promise<void> {
    const active = await repo.getActive(SESSION_TTL_MS);
    for (const state of active) {
      if (!this.sessions.has(state.conversationId)) {
        this.sessions.set(state.conversationId, state);
      }
    }
  }

  load(conversationId: string): ConversationState {
    const existing = this.sessions.get(conversationId);
    if (existing && Date.now() - existing.lastActiveAt < SESSION_TTL_MS) {
      return existing;
    }
    // 过期或不存在，创建新会话
    if (existing) {
      logger.info("Session expired, creating new", { conversationId });
    }
    const fresh: ConversationState = {
      conversationId,
      collectedInputs: {},
      missingInputs: [],
      lastActiveAt: Date.now(),
    };
    this.sessions.set(conversationId, fresh);
    return fresh;
  }

  save(state: ConversationState): void {
    state.lastActiveAt = Date.now();
    this.sessions.set(state.conversationId, state);
    void this.repo?.upsert(state);
  }

  clear(conversationId: string): void {
    this.sessions.delete(conversationId);
    void this.repo?.delete(conversationId);
  }

  /** 开始一个 Skill 的多轮对话 */
  startSkill(
    conversationId: string,
    skillId: string,
    missingInputs: string[],
  ): ConversationState {
    const state = this.load(conversationId);
    state.currentSkillId = skillId;
    state.pendingAction = "collect_inputs";
    state.missingInputs = missingInputs;
    state.collectedInputs = {};
    this.save(state);
    return state;
  }

  /** 收集一个参数 */
  collectInput(
    conversationId: string,
    inputName: string,
    value: unknown,
  ): ConversationState {
    const state = this.load(conversationId);
    state.collectedInputs[inputName] = value;
    state.missingInputs = state.missingInputs.filter((n) => n !== inputName);
    this.save(state);
    return state;
  }

  /** 检查是否所有参数已收集 */
  isComplete(conversationId: string): boolean {
    const state = this.load(conversationId);
    return state.missingInputs.length === 0;
  }

  /** 完成 Skill 执行，清理状态 */
  finishSkill(conversationId: string): void {
    const state = this.load(conversationId);
    state.currentSkillId = undefined;
    state.pendingAction = undefined;
    state.collectedInputs = {};
    state.missingInputs = [];
    this.save(state);
  }

  /** 清理过期会话 */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, state] of this.sessions) {
      if (now - state.lastActiveAt >= SESSION_TTL_MS) {
        this.sessions.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired sessions`);
    }
    return cleaned;
  }
}

export const stateManager = new StateManager();
