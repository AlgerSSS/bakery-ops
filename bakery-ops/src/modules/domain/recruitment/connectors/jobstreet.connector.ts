import { chromium } from "playwright-extra";
import type { Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";
import type { JobSiteConnector } from "../connector.interface";
import type { Candidate, CrawlResult, ParsedJD } from "../types";
import { logger } from "../../../shared/logger";
import { hasValidSession, getCookieFile, getStorageFile, refreshLogin } from "./jobstreet-login";
import { JOBSTREET_BASE_URL } from "./jobstreet.constants";

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
  readonly siteUrl = JOBSTREET_BASE_URL;

  async search(jd: ParsedJD, maxResults: number): Promise<CrawlResult> {
    const candidates: Candidate[] = [];
    const errors: string[] = [];
    let browser: Browser | null = null;

    try {
      if (!hasValidSession()) {
        logger.info("JobStreet: no session found, attempting auto login");
        const loginOk = await refreshLogin();
        if (!loginOk) {
          return this.errorResult([
            "JobStreet: 自动登录失败，请检查 JOBSTREET_EMAIL 和 JOBSTREET_PASSWORD 环境变量。",
          ]);
        }
      }

      browser = await chromium.launch({ headless: true });
      let context = await this.createAuthContext(browser);
      let page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        logger.info("JobStreet: cookie expired, attempting auto re-login");
        await context.close();
        await browser.close();

        const loginOk = await refreshLogin();
        if (!loginOk) {
          return this.errorResult([
            "JobStreet: 自动登录失败，请检查 JOBSTREET_EMAIL 和 JOBSTREET_PASSWORD 环境变量。",
          ]);
        }

        browser = await chromium.launch({ headless: true });
        context = await this.createAuthContext(browser);
        page = await context.newPage();

        if (!(await this.verifyCookies(page))) {
          return this.errorResult([
            "JobStreet: 重新登录后 Cookie 仍无效。",
          ]);
        }
      }

      // Step 1: 构建搜索查询并搜索
      const query = this.buildSearchQuery(jd);
      logger.info("JobStreet Talent Search: searching", { query, location: jd.location });

      const searchProfiles = await this.searchTalentPool(page, query, jd.location);
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
   * 构建 Talent Search 搜索查询（仅关键词，不含地点）
   */
  private buildSearchQuery(jd: ParsedJD): string {
    const parts: string[] = [];
    if (jd.jobTitle) parts.push(jd.jobTitle);
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
  private async searchTalentPool(page: Page, query: string, location?: string): Promise<TalentProfile[]> {
    const profiles: TalentProfile[] = [];
    let totalCount = 0;
    let graphqlResponseReceived = false;

    const handler = async (res: import("playwright").Response) => {
      if (!res.url().includes("/graphql")) return;
      try {
        const body = await res.text();
        if (!body.includes("talentSearchProfilesNaturalLanguageSearch")) return;
        const parsed = JSON.parse(body);
        const tsData = parsed?.data?.talentSearchProfilesNaturalLanguageSearch;

        if (!tsData) {
          graphqlResponseReceived = true;
          logger.warn("JobStreet GraphQL: talentSearchProfilesNaturalLanguageSearch is null/undefined", {
            hasErrors: !!parsed?.errors,
            errors: parsed?.errors?.map((e: any) => e.message)?.slice(0, 3),
            dataKeys: Object.keys(parsed?.data || {}),
          });
          return;
        }

        const result = tsData.result;
        if (!result) {
          graphqlResponseReceived = true;
          logger.warn("JobStreet GraphQL: result is null — likely no Talent Search subscription", {
            typename: tsData.__typename,
            responseKeys: Object.keys(tsData),
          });
          return;
        }

        totalCount = result.totalCount || 0;
        graphqlResponseReceived = true;
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
    let searchUrl = `${this.siteUrl}/talentsearch?searchQuery=${encodedQuery}&market=MY`;
    if (location) {
      searchUrl += `&where=${encodeURIComponent(location).replace(/%20/g, "+")}`;
    }
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(10000);

    // 诊断：截图 + 页面 URL + 是否收到 GraphQL 响应
    const currentUrl = page.url();
    if (!graphqlResponseReceived) {
      logger.warn("JobStreet: no GraphQL response intercepted after 10s", { currentUrl });
    }
    const pageTitle = await page.title();
    logger.info("JobStreet: page state after search", { currentUrl, pageTitle, graphqlResponseReceived });
    try {
      await page.screenshot({ path: "/tmp/jobstreet-talent-search-debug.png", fullPage: false });
      logger.info("JobStreet: debug screenshot saved to /tmp/jobstreet-talent-search-debug.png");
    } catch {}

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
      await page.goto(`${this.siteUrl}/talentsearch`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(3000);
      const url = page.url();
      const loggedIn = !url.includes("login") && !url.includes("oauth") && !url.includes("authenticate");
      logger.info("JobStreet: cookie verification", { url: url.slice(0, 80), loggedIn });
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
