import type { AiProvider, ChatMessage } from "../shared/ai/ai-provider.interface";
import { SkillRegistry } from "./skill-registry";
import { logger } from "../shared/logger";

export type AiRouterProvider = AiProvider;

export interface IntentResult {
  action: "chat" | "skill" | "need_info";
  reply: string;
  skillId?: string;
  skillInput?: Record<string, unknown>;
  needMoreInfo?: boolean;
}

export class IntentRouter {
  constructor(
    private registry: SkillRegistry,
    private aiProvider: AiProvider,
  ) {}

  async route(text: string, history: { role: string; content: string }[], forcedSkillId?: string): Promise<IntentResult> {
    // Layer 1: 关键词匹配
    if (!forcedSkillId) {
      const keywordMatch = this.matchByKeyword(text);
      if (keywordMatch) {
        logger.info("IntentRouter Layer 1 hit", { skillId: keywordMatch });
        return this.llmDecide(history, keywordMatch);
      }

      // Layer 2: Embedding 语义相似度
      const embeddingMatch = await this.matchByEmbedding(text);
      if (embeddingMatch) {
        logger.info("IntentRouter Layer 2 hit", { skillId: embeddingMatch });
        return this.llmDecide(history, embeddingMatch);
      }
    }

    // Layer 3: LLM 分类
    return this.llmDecide(history, forcedSkillId);
  }

  private matchByKeyword(text: string): string | null {
    const normalized = text.toLowerCase().trim();
    const allSkills = this.registry.getAllWithKeywords();

    for (const { skill, keywords } of allSkills) {
      for (const kw of keywords) {
        if (normalized.includes(kw.toLowerCase())) {
          return skill.skillId;
        }
      }
    }
    return null;
  }

  private async matchByEmbedding(text: string): Promise<string | null> {
    const skills = this.registry.getAll();
    if (skills.length === 0) return null;

    const candidates = skills.map((s) => ({
      skill: s,
      text: `${s.name}: ${s.description}. 例如: ${s.examples.join("; ")}`,
    }));

    try {
      const userEmbedding = await this.aiProvider.getEmbedding(text);
      const candidateEmbeddings = await this.aiProvider.getEmbeddings(candidates.map((c) => c.text));

      let bestScore = -1;
      let bestIdx = -1;
      for (let i = 0; i < candidateEmbeddings.length; i++) {
        const score = cosineSimilarity(userEmbedding, candidateEmbeddings[i]);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0 && bestScore >= 0.60) {
        return candidates[bestIdx].skill.skillId;
      }
    } catch (err) {
      logger.warn("IntentRouter Layer 2 embedding failed, falling through to Layer 3", {
        error: String(err),
      });
    }

    return null;
  }

  private async llmDecide(
    history: { role: string; content: string }[],
    forcedSkillId?: string,
  ): Promise<IntentResult> {
    const skills = this.registry.getAll();
    const skillList = skills
      .map((s) => `- ${s.skillId}: ${s.name} — ${s.description}`)
      .join("\n");

    const systemContent = `你是 Hot Crush 的 AI 助手，一家马来西亚连锁烘焙店的智能工作伙伴。
你的风格：友好、专业、简洁。用中文回复。不要用 emoji。

你可以使用以下技能：
${skillList}

${forcedSkillId ? `当前正在进行 ${forcedSkillId} 技能，用户在补充信息。` : ""}

请分析用户最新消息，返回 JSON（不要返回其他内容）：
{
  "action": "chat" | "skill" | "need_info",
  "reply": "你要回复给用户的话（自然、友好）",
  "skillId": "要触发的技能ID（仅 action=skill 时）",
  "skillInput": {},
  "needMoreInfo": false
}

重要区分 — "联系候选人" vs "招聘搜索" vs "发布职位" vs "查看岗位"：
- 用户说"联系/联络/发消息给 XXX"、"跟 XXX 联系"、"联系前几个"、"通知他们" → candidate_outreach
- 用户说"帮我招一个XXX"、"找一个XXX岗位的人"、"我要招人" → recruitment_sourcing
- 用户说"发布/发岗位/发职位/上架/挂职位/post job" → job_posting
- 用户说"看看岗位"、"在招岗位"、"有哪些岗位"、"申请者"、"投递情况" → active_jobs

规则：
1. 如果用户在聊天、打招呼、问问题，action="chat"，给出自然回复
2. 如果用户描述了招聘需求，action="skill"，skillId="recruitment_sourcing"
   - 如果 JD 信息太少，needMoreInfo=true，reply 里追问
3. 如果用户要联系候选人，action="skill"，skillId="candidate_outreach"
   - skillInput 提取：candidateNames 或 topN
4. 如果用户要发布职位，action="skill"，skillId="job_posting"
5. 如果用户反馈员工信息，action="skill"，skillId="employee_management"
6. 如果用户询问数据规律/分析，action="skill"，skillId="knowledge_query"
7. 如果是补充信息场景，判断信息是否足够
8. 如果用户要查看在招岗位，action="skill"，skillId="active_jobs"
9. 订货/报数消息 → supply_order
10. 到货消息 → arrival_check
11. 发给供应商 → supply_send
12. 找KOL/网红/博主 → kol_discovery
13. 联系KOL → kol_outreach
14. 复盘/日复盘/今天总结/门店复盘/业绩分析 → daily_review_chat（不是forecast_order）
15. reply 必须自然、口语化`;

    const recentHistory = history.slice(-10);
    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
      ...recentHistory.map((h) => ({
        role: (h.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: h.content.slice(0, 500),
      })),
    ];

    try {
      const response = await this.aiProvider.chatCompletionMessages(messages, { maxTokens: 4096 });
      const jsonStr = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      logger.info("IntentRouter LLM decision", {
        action: parsed.action,
        skillId: parsed.skillId,
        needMoreInfo: parsed.needMoreInfo,
      });
      return {
        action: parsed.action || "chat",
        reply: parsed.reply || "",
        skillId: parsed.skillId || forcedSkillId,
        skillInput: parsed.skillInput,
        needMoreInfo: parsed.needMoreInfo || false,
      };
    } catch (err) {
      logger.error("IntentRouter LLM failed", { error: String(err) });
      return { action: "chat", reply: "不好意思，我没太理解你的意思，能再说一下吗？" };
    }
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
