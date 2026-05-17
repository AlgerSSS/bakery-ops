import type { SkillDefinition } from "../shared/types";
import { logger } from "../shared/logger";

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();

  register(skill: SkillDefinition): void {
    if (this.skills.has(skill.skillId)) {
      logger.warn(`Skill already registered: ${skill.skillId}`);
      return;
    }
    this.skills.set(skill.skillId, skill);
    logger.info(`Skill registered: ${skill.skillId}`, { name: skill.name, priority: skill.priority });
  }

  get(skillId: string): SkillDefinition | undefined {
    return this.skills.get(skillId);
  }

  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values()).sort((a, b) => b.priority - a.priority);
  }

  getAllWithKeywords(): Array<{ skill: SkillDefinition; keywords: string[] }> {
    return this.getAll().map((skill) => ({
      skill,
      keywords: skill.triggerKeywords,
    }));
  }

  getMenuText(): string {
    const skills = this.getAll();
    const lines = skills.map((s, i) => `${i + 1}. ${s.name} — ${s.description}`);
    return `请选择你要使用的功能：\n\n${lines.join("\n")}\n\n你也可以直接描述你的需求。`;
  }
}

// 单例
export const skillRegistry = new SkillRegistry();
