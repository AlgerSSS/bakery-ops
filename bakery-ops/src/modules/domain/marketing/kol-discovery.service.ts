import type { SocialPlatformConnector } from "./connectors/social-platform.interface";
import type { KOLRaw, KOLSearchParams, KOLDiscoveryResult } from "./types";
import { tiktokConnector } from "./connectors/tiktok.connector";
import { instagramConnector } from "./connectors/instagram.connector";
import { kolRepository } from "../../data/repositories/kol.repository";
import { logger } from "../../shared/logger";

const connectors: SocialPlatformConnector[] = [tiktokConnector, instagramConnector];

function scoreKOL(raw: KOLRaw, params: KOLSearchParams): number {
  let score = 0;

  // Follower count (0-40)
  if (raw.followerCount > 0) {
    if (params.minFollowers && raw.followerCount >= params.minFollowers) score += 20;
    score += Math.min(raw.followerCount / 50000, 20);
  }

  // Engagement rate (0-30)
  if (raw.engagementRate) {
    score += Math.min(raw.engagementRate * 100 * 3, 30);
  }

  // Niche match (0-20)
  if (params.niche && raw.niche.some((n) => n.toLowerCase().includes(params.niche!.toLowerCase()))) {
    score += 20;
  }

  // Verified (0-10)
  if (raw.verified) score += 10;

  // Location bonus (0-10)
  if (params.location && raw.location?.toLowerCase().includes(params.location.toLowerCase())) {
    score += 10;
  }

  return Math.round(score);
}

function generateMatchReason(raw: KOLRaw, params: KOLSearchParams): string {
  const reasons: string[] = [];

  if (raw.followerCount >= 10000) {
    reasons.push(`${raw.followerCount >= 100000 ? "high" : "moderate"} follower count (${formatNumber(raw.followerCount)})`);
  }
  if (raw.engagementRate && raw.engagementRate > 0.02) {
    reasons.push(`engagement rate ${(raw.engagementRate * 100).toFixed(1)}%`);
  }
  if (raw.verified) reasons.push("verified");
  if (params.niche && raw.niche.some((n) => n.toLowerCase().includes(params.niche!.toLowerCase()))) {
    reasons.push(`niche match: ${params.niche}`);
  }

  return reasons.join(", ") || "general match";
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * 跨平台搜索 KOL，去重，打分，入库，返回结果
 */
export async function discoverKOLs(params: KOLSearchParams): Promise<{
  results: KOLDiscoveryResult[];
  summary: string;
}> {
  const allRaw: KOLRaw[] = [];
  const platforms = params.platform === "all" || !params.platform
    ? connectors
    : connectors.filter((c) => c.platformName === params.platform);

  // 并行搜索各平台
  const searchResults = await Promise.allSettled(
    platforms.map((c) => c.searchKOLs(params)),
  );

  for (const result of searchResults) {
    if (result.status === "fulfilled") {
      allRaw.push(...result.value);
    }
  }

  logger.info("KOL discovery: search complete", { total: allRaw.length });

  // 去重（跨平台同一个人可能有不同 handle，简化处理：只按 handle 去重）
  const seen = new Set<string>();
  const unique = allRaw.filter((raw) => {
    const key = `${raw.platform}:${raw.handle.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 打分 + 排序
  const scored = unique
    .map((raw) => ({
      raw,
      score: scoreKOL(raw, params),
      reason: generateMatchReason(raw, params),
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // 取 top N
  const maxResults = params.maxResults || 20;
  const top = scored.slice(0, maxResults);

  // 入库
  const results: KOLDiscoveryResult[] = [];
  for (const item of top) {
    const kol = await kolRepository.upsertFromRaw(item.raw);
    if (kol) {
      results.push({
        kol,
        source: item.raw.platform,
        matchScore: item.score,
        matchReason: item.reason,
      });
    }
  }

  // 构建 WhatsApp 摘要
  const lines: string[] = [`找到 ${results.length} 位符合条件的博主：`, ""];

  const tiktokResults = results.filter((r) => r.source === "tiktok");
  const igResults = results.filter((r) => r.source === "instagram");

  if (tiktokResults.length > 0) {
    lines.push("*TikTok*");
    tiktokResults.forEach((r, i) => {
      lines.push(
        `${i + 1}. @${r.kol.platform_handle} — ${formatNumber(r.kol.follower_count)} followers | 评分: ${r.matchScore}`,
      );
    });
    lines.push("");
  }

  if (igResults.length > 0) {
    lines.push("*Instagram*");
    igResults.forEach((r, i) => {
      lines.push(
        `${tiktokResults.length + i + 1}. @${r.kol.platform_handle} — ${formatNumber(r.kol.follower_count)} followers | 评分: ${r.matchScore}`,
      );
    });
    lines.push("");
  }

  lines.push(`回复 "联系前N个" 发送合作邀请 DM。`);

  return { results, summary: lines.join("\n") };
}
