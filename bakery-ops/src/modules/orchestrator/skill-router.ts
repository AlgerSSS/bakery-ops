import type { SkillDefinition, RouteResult } from "../shared/types";
import type { AiProvider } from "../shared/ai/ai-provider.interface";
import { SkillRegistry } from "./skill-registry";
import { logger } from "../shared/logger";

export type AiRouterProvider = AiProvider;

export class SkillRouter {
  constructor(
    private registry: SkillRegistry,
    private aiProvider: AiProvider,
  ) {}

  async route(text: string): Promise<RouteResult | null> {
    // Layer 1: 关键词匹配
    const keywordResult = this.matchByKeyword(text);
    if (keywordResult) {
      logger.info("Router Layer 1 hit", {
        skillId: keywordResult.selectedSkill.skillId,
        keyword: keywordResult.matchedKeyword,
      });
      return keywordResult;
    }

    // Layer 2: Embedding 语义相似度
    const embeddingResult = await this.matchByEmbedding(text);
    if (embeddingResult && embeddingResult.confidence >= 0.60) {
      logger.info("Router Layer 2 hit", {
        skillId: embeddingResult.selectedSkill.skillId,
        confidence: embeddingResult.confidence,
      });
      return embeddingResult;
    }

    // Layer 3: LLM JSON 分类
    const llmResult = await this.matchByLLM(text);
    if (llmResult) {
      logger.info("Router Layer 3 hit", {
        skillId: llmResult.selectedSkill.skillId,
        confidence: llmResult.confidence,
      });
      return llmResult;
    }

    logger.info("Router: no skill matched", { text });
    return null;
  }

  // --- Layer 1: 关键词匹配 ---
  private matchByKeyword(text: string): RouteResult | null {
    const normalized = text.toLowerCase().trim();
    const allSkills = this.registry.getAllWithKeywords();

    for (const { skill, keywords } of allSkills) {
      for (const kw of keywords) {
        if (normalized.includes(kw.toLowerCase())) {
          return {
            selectedSkill: skill,
            confidence: 0.95,
            layer: 1,
            matchedKeyword: kw,
          };
        }
      }
    }
    return null;
  }

  // --- Layer 2: Embedding 语义相似度 ---
  private async matchByEmbedding(text: string): Promise<RouteResult | null> {
    const skills = this.registry.getAll();
    if (skills.length === 0) return null;

    // 构建候选文本：每个 Skill 的 name + description + examples
    const candidates = skills.map((s) => ({
      skill: s,
      text: `${s.name}: ${s.description}. 例如: ${s.examples.join("; ")}`,
    }));

    try {
      // 获取用户输入的 embedding
      const userEmbedding = await this.aiProvider.getEmbedding(text);

      // 获取所有候选的 embedding
      const candidateTexts = candidates.map((c) => c.text);
      const candidateEmbeddings = await this.aiProvider.getEmbeddings(candidateTexts);

      // 计算余弦相似度
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
        return {
          selectedSkill: candidates[bestIdx].skill,
          confidence: bestScore,
          layer: 2,
        };
      }
    } catch (err) {
      logger.warn("Router Layer 2 embedding failed, falling through to Layer 3", {
        error: String(err),
      });
    }

    return null;
  }

  // --- Layer 3: LLM JSON 分类 ---
  private async matchByLLM(text: string): Promise<RouteResult | null> {
    const skills = this.registry.getAll();
    if (skills.length === 0) return null;

    const skillList = skills
      .map((s) => `- skill_id: "${s.skillId}", name: "${s.name}", description: "${s.description}"`)
      .join("\n");

    const prompt = `你是一个意图分类器。根据用户输入，判断最匹配的 Skill。

可用 Skill 列表：
${skillList}

用户输入: "${text}"

请返回 JSON 格式（不要返回其他内容）：
{"skill_id": "xxx", "confidence": 0.85}

如果没有匹配的 Skill，返回：
{"skill_id": null, "confidence": 0}`;

    try {
      const response = await this.aiProvider.chatCompletion(prompt);
      const parsed = JSON.parse(response);

      if (parsed.skill_id && parsed.confidence > 0) {
        const skill = this.registry.get(parsed.skill_id);
        if (skill) {
          return {
            selectedSkill: skill,
            confidence: parsed.confidence,
            layer: 3,
          };
        }
      }
    } catch (err) {
      logger.warn("Router Layer 3 LLM classification failed", {
        error: String(err),
      });
    }

    return null;
  }
}

// --- 余弦相似度 ---
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
