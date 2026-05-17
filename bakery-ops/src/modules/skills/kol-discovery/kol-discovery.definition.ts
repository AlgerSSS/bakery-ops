import type { SkillDefinition, SkillExecutionInput, SkillExecutionResult, SkillHandler } from "../../shared/types";
import { v4 as uuidv4 } from "uuid";
import { discoverKOLs } from "../../domain/marketing/kol-discovery.service";
import { kolRepository } from "../../data/repositories/kol.repository";
import { logger } from "../../shared/logger";

export const kolDiscoverySkillDefinition: SkillDefinition = {
  skillId: "kol_discovery",
  name: "寻找KOL",
  description: "添加博主或搜索博主。手动添加格式：添加博主 @handle 平台 粉丝量 领域。也可以尝试自动搜索。",
  priority: 85,
  triggerKeywords: [
    "找KOL", "寻找网红", "kol", "influencer", "博主", "达人",
    "推广", "合作", "添加博主", "添加KOL", "录入博主",
  ],
  examples: [
    "添加博主 @foodlover_kl tiktok 8万粉 美食探店",
    "录入博主 @kl_bakes instagram 5万粉 烘焙",
    "帮我找吉隆坡的美食博主",
  ],
  requiredInputs: [
    { name: "text", type: "string", description: "搜索条件或添加博主的信息" },
  ],
  optionalInputs: [
    { name: "platform", type: "string", description: "平台：tiktok / instagram" },
    { name: "niche", type: "string", description: "领域" },
    { name: "minFollowers", type: "number", description: "最低粉丝数" },
    { name: "handle", type: "string", description: "博主 handle（手动添加时）" },
  ],
  permissions: ["marketing.use"],
  riskLevel: "low",
  requiresConfirmation: false,
  supportsMultiTurn: true,
  supportsFiles: false,
  supportsCron: false,
  outputTypes: ["text"],
  handler: null,
};

export class KOLDiscoverySkillHandler implements SkillHandler {
  async execute(input: SkillExecutionInput): Promise<SkillExecutionResult> {
    const text = String(input.input.text || "");

    // ====== 模式 1: 手动添加博主 ======
    // 格式: "添加博主 @handle 平台 粉丝量 领域" 或 "录入博主 @handle tiktok 8万粉 美食"
    const addMatch = text.match(
      /(?:添加|录入|新增)\s*(?:博主|KOL|网红)?\s*@?([a-zA-Z0-9_.]+)\s*(tiktok|instagram|ins)?\s*(\d+[万千]?)\s*(?:粉|粉丝)?\s*(.*)/i,
    );

    if (addMatch) {
      return this.addKOLManually(addMatch);
    }

    // Simple "add" with handle and platform
    const simpleAdd = text.match(/@([a-zA-Z0-9_.]+)\s*(tiktok|instagram|ins)/i);
    if (simpleAdd && (text.includes("添加") || text.includes("录入") || text.includes("加一个"))) {
      return this.addKOLSimple(simpleAdd);
    }

    // ====== 模式 2: 自动搜索（尝试调用 Playwright，可能因反爬失败） ======
    const platform = (input.input.platform as string) || "all";
    const niche = input.input.niche as string | undefined;
    const minFollowers = input.input.minFollowers as number | undefined;
    const location = input.input.location as string | undefined;

    let keywords = [text];
    let parsedNiche = niche;
    let parsedMinFollowers = minFollowers;
    let parsedLocation = location;

    if (!niche) {
      const nicheMatch = text.match(/(美食|烘焙|甜点|咖啡|饮料|探店|生活|时尚|美妆|健身|旅游|母婴|亲子)/);
      if (nicheMatch) {
        parsedNiche = nicheMatch[1];
        keywords = [nicheMatch[1], "food", "KL", "Malaysia"];
      }
    }

    if (!location) {
      const locMatch = text.match(/(吉隆坡|KL|PJ|槟城|新山|马六甲|Kuala Lumpur|Petaling Jaya)/i);
      if (locMatch) parsedLocation = locMatch[1];
    }

    if (!minFollowers) {
      const followerMatch = text.match(/(\d+)\s*[万千]\s*(粉|粉丝|followers?)/i);
      if (followerMatch) {
        const num = parseInt(followerMatch[1]);
        parsedMinFollowers = followerMatch[0].includes("万") ? num * 10000 : num * 1000;
      }
    }

    try {
      logger.info("KOL discovery: auto search", { text: text.slice(0, 80) });

      const { results, summary } = await discoverKOLs({
        keywords,
        platform: platform as "tiktok" | "instagram" | "all",
        niche: parsedNiche,
        minFollowers: parsedMinFollowers,
        location: parsedLocation,
        maxResults: 20,
      });

      if (results.length === 0) {
        return {
          runId: uuidv4(),
          skillId: "kol_discovery",
          status: "success",
          summary:
            '自动搜索暂无结果。\n\n提示：TikTok 反爬很严格，自动搜索可能受限。你可以手动添加博主：\n\n"添加博主 @handle tiktok 10万粉 美食"',
        };
      }

      return {
        runId: uuidv4(),
        skillId: "kol_discovery",
        status: "success",
        summary,
        data: { _kolDiscoveryResults: results.slice(0, 10).map((r) => r.kol.id) },
      };
    } catch (err) {
      logger.error("KOL discovery: auto search failed", { error: String(err) });
      return {
        runId: uuidv4(),
        skillId: "kol_discovery",
        status: "success",
        summary:
          '自动搜索暂时不可用（TikTok 反爬限制）。\n\n你可以手动添加博主，格式：\n"添加博主 @handle tiktok 10万粉 美食"\n\n已录入的博主可以用"联系博主"来发合作邀请。',
      };
    }
  }

  /** 手动添加博主 — 完整格式 */
  private async addKOLManually(match: RegExpMatchArray): Promise<SkillExecutionResult> {
    const handle = match[1].trim();
    let platform = (match[2] || "tiktok").trim().toLowerCase();
    if (platform === "ins") platform = "instagram";

    const followersRaw = match[3] || "0";
    let followerCount = 0;
    if (followersRaw.endsWith("万")) {
      followerCount = parseFloat(followersRaw) * 10000;
    } else if (followersRaw.endsWith("千")) {
      followerCount = parseFloat(followersRaw) * 1000;
    } else {
      followerCount = parseInt(followersRaw) || 0;
    }

    const nicheRaw = (match[4] || "").trim();

    return this.saveKOLToDB(handle, platform, followerCount, nicheRaw);
  }

  /** 手动添加博主 — 简化格式 @handle platform */
  private async addKOLSimple(match: RegExpMatchArray): Promise<SkillExecutionResult> {
    const handle = match[1].trim();
    let platform = (match[2] || "tiktok").trim().toLowerCase();
    if (platform === "ins") platform = "instagram";

    return this.saveKOLToDB(handle, platform, 0, "");
  }

  private async saveKOLToDB(
    handle: string,
    platform: string,
    followerCount: number,
    nicheRaw: string,
  ): Promise<SkillExecutionResult> {
    const niche = nicheRaw ? nicheRaw.split(/[,，\s]+/).filter(Boolean) : [];

    const existing = await kolRepository.getByHandle(platform, handle);
    if (existing) {
      return {
        runId: uuidv4(),
        skillId: "kol_discovery",
        status: "success",
        summary: `博主 @${handle} 已存在（${platform}，${formatNum(existing.follower_count)} 粉）。用"联系博主 @${handle}"来发消息。`,
      };
    }

    const profileUrl =
      platform === "instagram"
        ? `https://www.instagram.com/${handle}`
        : `https://www.tiktok.com/@${handle}`;

    const row = await kolRepository.upsertFromRaw({
      platform: platform as "tiktok" | "instagram",
      platformId: handle,
      handle,
      name: handle,
      bio: "",
      followerCount,
      niche,
      verified: false,
      profileUrl,
      contactInfo: {},
    });

    if (!row) {
      return {
        runId: uuidv4(),
        skillId: "kol_discovery",
        status: "error",
        summary: "保存失败，请重试。",
      };
    }

    const lines = [
      `✓ 已添加博主：`,
      `  名字: @${handle}`,
      `  平台: ${platform}`,
      followerCount > 0 ? `  粉丝: ${formatNum(followerCount)}` : "",
      niche.length > 0 ? `  领域: ${niche.join(", ")}` : "",
      "",
      `用"联系博主 @${handle}"来发合作邀请。`,
    ];

    return {
      runId: uuidv4(),
      skillId: "kol_discovery",
      status: "success",
      summary: lines.filter(Boolean).join("\n"),
    };
  }
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
