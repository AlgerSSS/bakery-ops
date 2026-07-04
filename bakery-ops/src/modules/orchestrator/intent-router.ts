import type { AiProvider, ChatMessage } from "../shared/ai/ai-provider.interface";
import type { SkillDefinition } from "../shared/types";
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

// 这些技能即使关键词高置信命中，也必须交给 LLM 三连判（chat / skill / need_info）：
// 它们需要 LLM 评估用户是否给够了信息（如招聘需要先有 JD），单凭关键词不足以直接执行。
// 目前仅招聘搜索属于此类（orchestrator 的 needMoreInfo→收集 jdText 流程专为它而设）。
const NEEDS_LLM_TRIAGE = new Set<string>(["recruitment_sourcing"]);

// Embedding 置信阈值
const EMBED_HIGH = 0.65; // 高置信：top 分数下限
const EMBED_MARGIN = 0.08; // 高置信：top 与 second 的最小间距
const EMBED_AMBIGUOUS_FLOOR = 0.55; // 低于此且无关键词 → 交给 LLM 全量裁决

interface KeywordMatch {
  skillId: string; // 最长匹配关键词所属技能（priority 破平局）
  keyword: string; // 命中的（最长）关键词
  confident: boolean; // true=唯一且非"软"关键词 → 快速通道跳过 LLM
  candidateSkillIds: string[]; // confident=false 时，交给 LLM 裁决的候选子集
}

interface EmbeddingMatch {
  skillId: string;
  confident: boolean; // true=高置信直接返回；false=进入候选子集交给 LLM
  candidateSkillIds: string[]; // confident=false 时携带 top-N 候选
}

export class IntentRouter {
  // 候选 skill 描述的 embedding 惰性缓存：registry 仅在 bootstrap 注册一次、无注销接口，
  // 候选文本跨消息不变，首次计算后复用即可。key = 候选文本 join 串，防御性校验注册表未变。
  private candidateEmbeddingsCache: { key: string; embeddings: number[][] } | null = null;

  constructor(
    private registry: SkillRegistry,
    private aiProvider: AiProvider,
  ) {}

  async route(text: string, history: { role: string; content: string }[], forcedSkillId?: string): Promise<IntentResult> {
    // 多轮补充信息：维持原行为，带软提示交给 LLM。
    if (forcedSkillId) {
      return this.llmDecide(text, history, forcedSkillId);
    }

    // Layer 1：整词/最长关键词匹配。
    const kw = this.matchByKeyword(text);
    if (kw) {
      // 高置信快速通道：消息只命中一个技能、命中关键词不是某个相邻技能更长关键词的子串
      //（例如"订货"是 supply_send 的"发送订货"子串 → 不算高置信），且该技能不需要 LLM 评估信息是否充分
      // → 直接返回，跳过 LLM。
      if (kw.confident && !NEEDS_LLM_TRIAGE.has(kw.skillId)) {
        logger.info("IntentRouter fast-path (keyword)", { skillId: kw.skillId, keyword: kw.keyword });
        return { action: "skill", reply: "", skillId: kw.skillId, needMoreInfo: false };
      }
      // 命中但有歧义 → 限定到候选子集交给 LLM 裁决（候选 = 命中的技能 ∪ 拥有该关键词超串的相邻技能）。
      logger.info("IntentRouter ambiguous keyword → LLM", {
        winner: kw.skillId,
        keyword: kw.keyword,
        candidates: kw.candidateSkillIds,
      });
      return this.llmDecide(text, history, undefined, kw.candidateSkillIds, kw.skillId);
    }

    // Layer 2：Embedding 语义相似度（带 margin 判定）。
    const emb = await this.matchByEmbedding(text);
    if (emb) {
      if (emb.confident) {
        logger.info("IntentRouter fast-path (embedding)", { skillId: emb.skillId });
        return { action: "skill", reply: "", skillId: emb.skillId, needMoreInfo: false };
      }
      logger.info("IntentRouter ambiguous embedding → LLM", { candidates: emb.candidateSkillIds });
      return this.llmDecide(text, history, undefined, emb.candidateSkillIds, emb.skillId);
    }

    // Layer 3：无任何匹配 → LLM 全量裁决（含 chat 兜底）。
    return this.llmDecide(text, history);
  }

  /**
   * 整词/最长匹配：在所有技能的 triggerKeywords 中找出所有作为消息子串的关键词，winner=最长的那个
   *（等长用技能 priority 破平局）。这修复了旧 includes()+优先级顺序导致的"短关键词吞掉长短语"误路由。
   *
   * 高置信（confident=true → 跳过 LLM）的条件：
   *   (a) 消息只命中了"一个"技能（matchedSkills.size === 1）；且
   *   (b) winner 关键词不是任何"相邻技能"更长关键词的子串（"软关键词"）——例如"订货"是 supply_send
   *       "发送订货"的子串、"博主"是 kol_outreach"联系博主"的子串，这类词单独出现时意图不明确。
   * 否则 confident=false，并给出候选子集（命中的技能 ∪ 拥有该关键词超串的相邻技能），交 LLM 裁决。
   */
  private matchByKeyword(text: string): KeywordMatch | null {
    const normalized = text.toLowerCase().trim();
    const skills = this.registry.getAll();

    const matchedSkills = new Set<string>();
    let best: { skillId: string; keyword: string; priority: number } | null = null;
    for (const s of skills) {
      for (const kw of s.triggerKeywords) {
        const k = kw.toLowerCase();
        if (!normalized.includes(k)) continue;
        matchedSkills.add(s.skillId);
        if (
          best === null ||
          k.length > best.keyword.length ||
          (k.length === best.keyword.length && s.priority > best.priority)
        ) {
          best = { skillId: s.skillId, keyword: k, priority: s.priority };
        }
      }
    }

    if (!best) return null;

    // 找出"拥有 winner 关键词超串"的相邻技能（更具体的措辞落在兄弟技能上 → winner 关键词偏软）。
    const superstringOwners = new Set<string>();
    for (const s of skills) {
      if (s.skillId === best.skillId) continue;
      for (const kw of s.triggerKeywords) {
        const k = kw.toLowerCase();
        if (k !== best.keyword && k.includes(best.keyword)) {
          superstringOwners.add(s.skillId);
          break;
        }
      }
    }

    const confident = matchedSkills.size === 1 && superstringOwners.size === 0;
    const candidateSkillIds = Array.from(new Set([...matchedSkills, ...superstringOwners]));
    return { skillId: best.skillId, keyword: best.keyword, confident, candidateSkillIds };
  }

  private async matchByEmbedding(text: string): Promise<EmbeddingMatch | null> {
    const skills = this.registry.getAll();
    if (skills.length === 0) return null;

    const candidates = skills.map((s) => ({
      skill: s,
      text: `${s.name}: ${s.description}. 例如: ${s.examples.join("; ")}`,
    }));

    try {
      const userEmbedding = await this.aiProvider.getEmbedding(text);
      const cacheKey = candidates.map((c) => c.text).join("\n");
      if (!this.candidateEmbeddingsCache || this.candidateEmbeddingsCache.key !== cacheKey) {
        this.candidateEmbeddingsCache = {
          key: cacheKey,
          embeddings: await this.aiProvider.getEmbeddings(candidates.map((c) => c.text)),
        };
      }
      const candidateEmbeddings = this.candidateEmbeddingsCache.embeddings;

      const scored = candidateEmbeddings
        .map((emb, i) => ({ skillId: candidates[i].skill.skillId, score: cosineSimilarity(userEmbedding, emb) }))
        .sort((a, b) => b.score - a.score);

      const top = scored[0];
      const second = scored[1];
      if (!top || top.score < EMBED_AMBIGUOUS_FLOOR) return null;

      const margin = second ? top.score - second.score : Infinity;
      if (top.score >= EMBED_HIGH && margin >= EMBED_MARGIN) {
        return { skillId: top.skillId, confident: true, candidateSkillIds: [top.skillId] };
      }

      // 模糊带：top 与 second（及任何与 top 相近的）作为候选交给 LLM。
      const candidateIds = scored
        .filter((s) => top.score - s.score <= EMBED_MARGIN)
        .slice(0, 3)
        .map((s) => s.skillId);
      return { skillId: top.skillId, confident: false, candidateSkillIds: candidateIds };
    } catch (err) {
      logger.warn("IntentRouter embedding failed, falling through to LLM", {
        error: String(err),
      });
    }

    return null;
  }

  private async llmDecide(
    text: string,
    history: { role: string; content: string }[],
    forcedSkillId?: string,
    candidateSkillIds?: string[],
    fallbackSkillId?: string,
  ): Promise<IntentResult> {
    const all = this.registry.getAll();
    const skills =
      candidateSkillIds && candidateSkillIds.length > 0
        ? all.filter((s) => candidateSkillIds.includes(s.skillId))
        : all;

    // 单一事实来源：技能清单 + 区分说明全部由 skill 定义生成，永不与 allSkills 漂移。
    const skillList = skills.map((s) => `- ${s.skillId}: ${s.name} — ${s.description}`).join("\n");
    const disambiguation = skills
      .filter((s): s is SkillDefinition & { disambiguation: string } => Boolean(s.disambiguation))
      .map((s) => `- ${s.skillId}: ${s.disambiguation}`)
      .join("\n");

    const systemContent = `你是 Hot Crush 的 AI 助手，一家马来西亚连锁烘焙店的智能工作伙伴。
你的风格：友好、专业、简洁。用中文回复。不要用 emoji。

你可以使用以下技能：
${skillList}
${disambiguation ? `\n技能边界区分（务必据此选择最贴切的一个）：\n${disambiguation}\n` : ""}${forcedSkillId ? `\n当前正在进行 ${forcedSkillId} 技能，用户在补充信息。\n` : ""}
请分析用户最新消息，返回 JSON（不要返回其他内容）：
{
  "action": "chat" | "skill" | "need_info",
  "reply": "你要回复给用户的话（自然、友好）",
  "skillId": "要触发的技能ID（仅 action=skill 时，必须从上面的技能列表中选）",
  "skillInput": {},
  "needMoreInfo": false
}

规则：
1. 用户在聊天、打招呼、闲聊时，action="chat"。
2. 命中某个技能时，action="skill"，skillId 必须是上面列表中的某个 ID。
3. 描述了招聘需求但信息太少时，needMoreInfo=true，reply 里追问。
4. reply 必须自然、口语化。`;

    const recentHistory = history.slice(-10);
    const lastIsUser = recentHistory[recentHistory.length - 1]?.content === text;
    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
      ...recentHistory.map((h) => ({
        role: (h.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: h.content.slice(0, 500),
      })),
    ];
    // 若历史里还没有当前消息（直接调用 route 的场景），显式补上最新用户消息。
    if (!lastIsUser && text) {
      messages.push({ role: "user", content: text.slice(0, 500) });
    }

    try {
      const response = await this.aiProvider.chatCompletionMessages(messages, { maxTokens: 512, jsonMode: true });
      const jsonStr = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(jsonStr);
      logger.info("IntentRouter LLM decision", {
        action: parsed.action,
        skillId: parsed.skillId,
        needMoreInfo: parsed.needMoreInfo,
      });

      // 不允许发射孤儿 skillId：LLM 返回的技能必须在注册表中存在，否则降级为 chat。
      const chosenSkillId = parsed.skillId || forcedSkillId;
      const action = parsed.action || "chat";
      if (action === "skill" && chosenSkillId && !this.registry.get(chosenSkillId)) {
        logger.warn("IntentRouter LLM returned unregistered skillId, downgrading to chat", {
          skillId: chosenSkillId,
        });
        return { action: "chat", reply: parsed.reply || "", needMoreInfo: false };
      }

      return {
        action,
        reply: parsed.reply || "",
        skillId: chosenSkillId,
        skillInput: parsed.skillInput,
        needMoreInfo: parsed.needMoreInfo || false,
      };
    } catch (err) {
      logger.error("IntentRouter LLM failed", { error: String(err) });
      // LLM 不可用（余额耗尽/限流）时，回落到关键词/语义赢家或多轮进行中的技能，
      // 避免本可路由的消息（如"复盘"）被"没太理解"吞掉。仅在该技能已注册时回落。
      const degraded = fallbackSkillId ?? forcedSkillId;
      if (degraded && this.registry.get(degraded)) {
        logger.warn("IntentRouter LLM down → 回落到赢家技能", { skillId: degraded });
        return { action: "skill", reply: "", skillId: degraded, needMoreInfo: false };
      }
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
