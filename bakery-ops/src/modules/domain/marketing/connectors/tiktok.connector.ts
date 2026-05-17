/**
 * TikTok Connector — 直接调 TikTok 内部 Web API（fetch 方案，零额外依赖）
 *
 * 通过 hashtag 搜索发现 KOL：
 * 1. 根据 niche 获取对应 hashtag 的 challengeID
 * 2. 抓取 hashtag 下帖子，提取作者
 * 3. 过滤粉丝数 → 获取详情 → 返回 Top N
 */

import type { SocialPlatformConnector } from "./social-platform.interface";
import type { KOLRaw, KOLSearchParams } from "../types";
import { logger } from "../../../shared/logger";

const BASE = "https://www.tiktok.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// 中文领域 → TikTok hashtag 映射
const NICHE_HASHTAGS: Record<string, string[]> = {
  "美食": ["malaysiafood", "klfoodie", "malaysianfood", "foodreviewmy"],
  "烘焙": ["malaysiabakery", "klbakery", "bakerymy"],
  "咖啡": ["malaysiacoffee", "klcoffee", "cafehopmy"],
  "甜点": ["malaysiadessert", "kldessert"],
  "探店": ["klfoodie", "malaysiacafe", "cafehopmy"],
  "生活": ["malaysialifestyle", "kllifestyle"],
  "美妆": ["malaysiabeauty", "klbeauty"],
  "健身": ["malaysiafitness", "klfitness"],
  "旅游": ["malaysiatravel", "cuticutimalaysia"],
  "时尚": ["malaysiafashion", "klfashion"],
};

const DEFAULT_HASHTAGS = ["malaysiafood", "klfoodie", "malaysianfood"];

function getHashtagsForNiche(niche?: string): string[] {
  if (!niche) return DEFAULT_HASHTAGS;
  for (const [key, tags] of Object.entries(NICHE_HASHTAGS)) {
    if (niche.includes(key) || key.includes(niche)) return tags;
  }
  return DEFAULT_HASHTAGS;
}

function getSidTT(): string {
  return process.env.TIKTOK_SID_TT || "";
}

function getHeaders(): Record<string, string> {
  return {
    "User-Agent": UA,
    Referer: `${BASE}/`,
    Cookie: getSidTT(),
  };
}

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export class TikTokConnector implements SocialPlatformConnector {
  readonly platformName = "tiktok";

  async searchKOLs(params: KOLSearchParams): Promise<KOLRaw[]> {
    const sidTT = getSidTT();
    if (!sidTT) {
      logger.warn("TikTok: TIKTOK_SID_TT not set, cannot search");
      return [];
    }

    const maxResults = params.maxResults || 20;
    const minFollowers = params.minFollowers || 5000;
    const hashtags = getHashtagsForNiche(params.niche);

    logger.info("TikTok: searching", { hashtags: hashtags.slice(0, 3), minFollowers });

    const authorSet = new Map<string, { id: string; name: string; fans: number; verified: boolean }>();

    for (const tag of hashtags.slice(0, 3)) {
      try {
        // Step 1: Get challenge/hashtag ID
        const detailUrl = `${BASE}/api/challenge/detail/?challengeName=${encodeURIComponent(tag)}`;
        const detail = await fetchJSON(detailUrl);
        const challengeID = detail?.challengeInfo?.challenge?.id;
        if (!challengeID) continue;

        // Step 2: Get posts from hashtag
        const feedUrl = `${BASE}/api/challenge/item_list/?challengeID=${challengeID}&count=30`;
        const feed = await fetchJSON(feedUrl);

        for (const post of feed?.itemList || []) {
          const author = post.author;
          if (!author?.uniqueId) continue;
          if ((author.followerCount || 0) < minFollowers) continue;

          const key = author.uniqueId.toLowerCase();
          if (!authorSet.has(key)) {
            authorSet.set(key, {
              id: author.id || author.uid || "",
              name: author.uniqueId,
              fans: author.followerCount || 0,
              verified: author.verified || false,
            });
          }
        }
      } catch (err) {
        logger.warn("TikTok: hashtag failed", { tag, error: String(err).slice(0, 80) });
      }
    }

    if (authorSet.size === 0) return [];

    const sorted = [...authorSet.values()].sort((a, b) => b.fans - a.fans);

    // Step 3: Get detailed profile for top authors
    const kols: KOLRaw[] = [];
    for (const author of sorted) {
      if (kols.length >= maxResults) break;
      try {
        const profileUrl = `${BASE}/api/user/detail/?uniqueId=${encodeURIComponent(author.name)}`;
        const profile = await fetchJSON(profileUrl);
        const user = profile?.userInfo?.user;
        if (!user) continue;

        kols.push({
          platform: "tiktok",
          platformId: user.id || author.id,
          handle: user.uniqueId || author.name,
          name: user.nickname || author.name,
          bio: user.signature || "",
          followerCount: user.followerCount || author.fans,
          avgLikes: user.heartCount,
          avgViews: undefined,
          niche: params.niche ? [params.niche] : [],
          location: user.region || params.location,
          verified: user.verified || author.verified,
          avatarUrl: user.avatarMedium,
          profileUrl: `${BASE}/@${user.uniqueId || author.name}`,
          contactInfo: {},
        });
      } catch (err) {
        logger.warn("TikTok: profile failed", { name: author.name, error: String(err).slice(0, 80) });
      }
    }

    logger.info("TikTok: search complete", { found: kols.length });
    return kols;
  }

  async sendDM(_kol: KOLRaw, _message: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: "TikTok DM requires browser (Phase 2)" };
  }

  async getProfile(handleOrUrl: string): Promise<KOLRaw | null> {
    const handle = handleOrUrl.replace(`${BASE}/@`, "").replace("@", "").split("?")[0];
    try {
      const profile = await fetchJSON(`${BASE}/api/user/detail/?uniqueId=${encodeURIComponent(handle)}`);
      const user = profile?.userInfo?.user;
      if (!user) return null;

      return {
        platform: "tiktok",
        platformId: user.id || handle,
        handle: user.uniqueId || handle,
        name: user.nickname || handle,
        bio: user.signature || "",
        followerCount: user.followerCount || 0,
        avgLikes: user.heartCount,
        niche: [],
        verified: user.verified || false,
        avatarUrl: user.avatarMedium,
        profileUrl: `${BASE}/@${user.uniqueId || handle}`,
        contactInfo: {},
      };
    } catch {
      return null;
    }
  }

  hasValidSession(): boolean {
    return !!getSidTT();
  }

  async refreshLogin(): Promise<boolean> {
    return true;
  }
}

export const tiktokConnector = new TikTokConnector();
