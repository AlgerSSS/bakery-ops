import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";
import type { JobSiteConnector } from "../connector.interface";
import type { Candidate, CrawlResult, ParsedJD } from "../types";
import { logger } from "../../../shared/logger";
import { hasValidSession, getCookieFile, getStorageFile } from "./jobstreet-login";

const DELAY_MIN = parseInt(process.env.CRAWLER_DELAY_MIN_MS || "2000");
const DELAY_MAX = parseInt(process.env.CRAWLER_DELAY_MAX_MS || "4000");

function randomDelay(): Promise<void> {
  const ms = DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
  return new Promise((r) => setTimeout(r, ms));
}

/** Talent Search 搜索结果中的 profile */
interface TalentProfile {
  id: string;
  profileGuid: string;
  firstName: string;
  lastName: string;
  currentJobTitle: string | null;
  currentLocation: string | null;
  lastModifiedDurationLabel: string;
  workHistories: Array<{
    companyName: string;
    jobTitle: string;
    durationLabel: string;
    foundInCV: boolean;
    description?: string;
  }>;
  hasVerifiedCredentials: boolean;
  nationalities: string[];
  salary: { value: number; currency: string } | null;
  // 详细 profile 额外字段
  languages?: string[];
  skills?: string[];
  profileEducation?: Array<{
    qualificationName: string;
    institutionName: string;
  }>;
  personalSummary?: string;
  hasResume?: boolean;
  currentIndustry?: string | null;
  rightToWork?: { label: string; isVerified: boolean } | null;
}

/**
 * JobStreet Malaysia — Talent Search
 * 从 SEEK 人才库中搜索匹配 JD 的候选人
 * 需要雇主账号 + 手动登录保存的 Cookie
 */
export class JobStreetConnector implements JobSiteConnector {
  readonly siteName = "JobStreet";
  readonly siteUrl = "https://my.employer.seek.com";

  async search(jd: ParsedJD, maxResults: number): Promise<CrawlResult> {
    const candidates: Candidate[] = [];
    const errors: string[] = [];
    let browser: Browser | null = null;

    try {
      if (!hasValidSession()) {
        return this.errorResult([
          "JobStreet: 未找到登录 Cookie。请先运行: npx tsx src/modules/domain/recruitment/connectors/jobstreet-login.ts",
        ]);
      }

      browser = await chromium.launch({ headless: true });
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        return this.errorResult([
          "JobStreet: Cookie 已过期。请重新运行登录脚本。",
        ]);
      }

      // Step 1: 构建搜索查询并搜索
      const query = this.buildSearchQuery(jd);
      logger.info("JobStreet Talent Search: searching", { query });

      const searchProfiles = await this.searchTalentPool(page, query);
      logger.info("JobStreet Talent Search: found profiles", { count: searchProfiles.length });

      if (searchProfiles.length === 0) {
        return {
          source: this.siteName,
          candidates: [],
          totalFound: 0,
          crawledAt: new Date().toISOString(),
          errors: ["JobStreet: Talent Search 未找到匹配的候选人"],
        };
      }

      // Step 2: 获取每个 profile 的详细信息
      const serviceToken = this.lastServiceToken;
      for (const profile of searchProfiles.slice(0, maxResults)) {
        try {
          const detailed = await this.fetchDetailedProfile(page, profile.profileGuid, serviceToken);
          const merged = { ...profile, ...detailed };
          const candidate = this.buildCandidate(merged, jd);
          candidates.push(candidate);
          logger.info("JobStreet: processed profile", {
            name: candidate.name,
            title: candidate.currentTitle,
          });
          await randomDelay();
        } catch (err) {
          // 如果详细 profile 获取失败，用搜索结果的基本数据
          try {
            const candidate = this.buildCandidate(profile, jd);
            candidates.push(candidate);
          } catch {}
          errors.push(`JobStreet: ${profile.firstName} ${profile.lastName} 详情获取失败: ${String(err)}`);
        }
      }

      await context.close();
    } catch (err) {
      errors.push(`JobStreet Talent Search error: ${String(err)}`);
      logger.error("JobStreet: search failed", { error: String(err) });
    } finally {
      if (browser) await browser.close();
    }

    return {
      source: this.siteName,
      candidates,
      totalFound: candidates.length,
      crawledAt: new Date().toISOString(),
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private lastServiceToken = "";

  /** 只保留能被 Talent Search 识别的语言名称 */
  private static KNOWN_LANGUAGES = new Set([
    "english", "mandarin", "chinese", "malay", "bahasa", "tamil",
    "cantonese", "japanese", "korean", "hindi", "arabic", "french",
    "german", "spanish", "thai", "vietnamese", "indonesian", "tagalog",
  ]);

  /**
   * 构建 Talent Search 搜索查询
   * 只用英文关键词，避免中文导致 URL 过长或搜索失败
   */
  private buildSearchQuery(jd: ParsedJD): string {
    const parts: string[] = [];
    if (jd.jobTitle) parts.push(jd.jobTitle);
    if (jd.location) parts.push(`in ${jd.location}`);
    // 只附加能识别的语言名称，忽略中文描述
    const langs = jd.languageRequirements
      .map((l) => l.trim().toLowerCase())
      .filter((l) => JobStreetConnector.KNOWN_LANGUAGES.has(l));
    if (langs.length > 0) {
      parts.push(langs.join(" "));
    }
    return parts.join(" ") || "staff";
  }

  /**
   * 搜索人才库，返回搜索结果中的 profiles
   */
  private async searchTalentPool(page: Page, query: string): Promise<TalentProfile[]> {
    const profiles: TalentProfile[] = [];
    let totalCount = 0;

    const handler = async (res: import("playwright").Response) => {
      if (!res.url().includes("/graphql")) return;
      try {
        const body = await res.text();
        if (!body.includes("talentSearchProfilesNaturalLanguageSearch")) return;
        const parsed = JSON.parse(body);
        const result = parsed?.data?.talentSearchProfilesNaturalLanguageSearch?.result;
        if (!result) return;

        totalCount = result.totalCount || 0;
        if (result.serviceToken) {
          this.lastServiceToken = result.serviceToken;
        }
        const edges = result.edges || [];
        for (const edge of edges) {
          if (edge?.node) profiles.push(edge.node);
        }
      } catch {}
    };
    page.on("response", handler);

    const encodedQuery = encodeURIComponent(query).replace(/%20/g, "+");
    const searchUrl = `${this.siteUrl}/talentsearch?searchQuery=${encodedQuery}&market=MY`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(10000);

    // 关闭可能出现的 modal
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    page.off("response", handler);
    logger.info("JobStreet Talent Search: results", { totalCount, pageProfiles: profiles.length });

    return profiles;
  }

  /**
   * 获取候选人详细 profile（通过导航到 profile 页面）
   */
  private async fetchDetailedProfile(
    page: Page,
    profileGuid: string,
    serviceToken: string,
  ): Promise<Partial<TalentProfile>> {
    let detailed: Partial<TalentProfile> = {};

    const handler = async (res: import("playwright").Response) => {
      if (!res.url().includes("/graphql")) return;
      try {
        const body = await res.text();
        if (!body.includes("talentSearchProfileV3")) return;
        const parsed = JSON.parse(body);
        const result = parsed?.data?.talentSearchProfileV3?.result;
        if (result) {
          detailed = {
            languages: result.languages || [],
            skills: result.skills || [],
            profileEducation: result.profileEducation || [],
            personalSummary: result.personalSummary || "",
            hasResume: result.hasResume,
            currentIndustry: result.currentIndustry,
            rightToWork: result.rightToWork || null,
            // 覆盖 workHistories（详细版有 description）
            workHistories: result.workHistories || [],
          };
        }
      } catch {}
    };
    page.on("response", handler);

    const profileUrl =
      `${this.siteUrl}/talentsearch/profiles/${profileGuid}` +
      `?market=MY&serviceToken=${serviceToken}`;
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);

    // 关闭 modal
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    page.off("response", handler);
    return detailed;
  }

  /**
   * 从 Talent Search profile 数据构建 Candidate 对象
   */
  private buildCandidate(profile: TalentProfile, jd: ParsedJD): Candidate {
    const skills = (profile.skills || []).filter(Boolean);
    const education = (profile.profileEducation || [])
      .map((e) => `${e.qualificationName} — ${e.institutionName}`)
      .join("; ");
    const experience = (profile.workHistories || [])
      .map((w) => {
        let entry = `${w.jobTitle} @ ${w.companyName} (${w.durationLabel})`;
        if (w.description) entry += ` — ${w.description.slice(0, 100)}`;
        return entry;
      })
      .join("; ");
    const location = profile.currentLocation || jd.location;
    const languages = profile.languages || [];

    const name = `${profile.firstName} ${profile.lastName}`.trim();
    const profileUrl =
      `${this.siteUrl}/talentsearch/profiles/${profile.profileGuid}?market=MY`;

    return {
      candidateId: uuidv4(),
      source: this.siteName,
      sourceUrl: profileUrl,
      name,
      location,
      currentTitle: profile.currentJobTitle ||
        (profile.workHistories?.[0]?.jobTitle) || undefined,
      experience: experience || undefined,
      skills,
      languages,
      education: education || undefined,
      summary: profile.personalSummary ||
        (profile.currentJobTitle
          ? `${profile.currentJobTitle} at ${profile.workHistories?.[0]?.companyName || "N/A"}`
          : undefined),
      rawData: { profileId: profile.id, profileGuid: profile.profileGuid, serviceToken: this.lastServiceToken },
    };
  }

  private async createAuthContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      acceptDownloads: true,
    });

    const cookieFile = getCookieFile();
    if (fs.existsSync(cookieFile)) {
      const cookies = JSON.parse(fs.readFileSync(cookieFile, "utf-8"));
      await context.addCookies(cookies);
    }

    const storageFile = getStorageFile();
    if (fs.existsSync(storageFile)) {
      const storage = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
      await context.addInitScript((data: Record<string, string>) => {
        for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
      }, storage);
    }

    return context;
  }

  private async verifyCookies(page: Page): Promise<boolean> {
    try {
      await page.goto(`${this.siteUrl}/`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      // 等待所有 JS 重定向完成（首页 → dashboard 等）
      await page.waitForTimeout(2000);
      const url = page.url();
      const loggedIn = !url.includes("login") && !url.includes("oauth") && !url.includes("authenticate");
      logger.info("JobStreet: cookie verification", { url, loggedIn });
      return loggedIn;
    } catch {
      return false;
    }
  }

  private errorResult(errors: string[]): CrawlResult {
    return {
      source: this.siteName,
      candidates: [],
      totalFound: 0,
      crawledAt: new Date().toISOString(),
      errors,
    };
  }
}
