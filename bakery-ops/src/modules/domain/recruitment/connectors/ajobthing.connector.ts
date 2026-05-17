import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";
import type { JobSiteConnector } from "../connector.interface";
import type { Candidate, CrawlResult, ParsedJD } from "../types";
import { logger } from "../../../shared/logger";
import { hasValidSession, getCookieFile, getStorageFile } from "./ajobthing-login";

/** AJobThing 搜索 API 返回的候选人 profile */
interface AjtProfile {
  expected_salary?: { currency: string; amount: number };
  location?: { city: string; state: string; country: string };
  latest_education?: { level: string; institute: string; course: string; graduated_at: string };
  latest_working_experience?: { position: string; company: string; industry: string };
  is_public: boolean;
  resume?: { file_type: string; file_url: string | boolean; resume_id: string };
  working_experiences?: Array<{
    company: string; position: string; job_desc: string;
    start_date: string; end_date: string; work_period: number;
    currently_working: boolean;
  }>;
  matched_highlight?: {
    skills?: Array<{ name: string }>;
    languages?: Array<{ name: string }>;
    working_experiences?: Array<{ position: string; company: string }>;
  };
  // 联系方式（已解锁候选人显示明文，未解锁显示 ***）
  name?: string;
  email?: string;
  contact_number?: string;
  phone?: string;
  mobile?: string;
  // 额外信息
  gender?: string;
  age?: number;
  nationality?: string;
  availability?: string;
  languages?: string[];
  personal_description?: string;
  whatsapp_verified_status?: string;
  is_mandarin_speaker?: boolean;
  encoded_id?: string;
  id?: number;
  unlock_source?: string | null;
}

/**
 * AJobThing Malaysia — 雇主端候选人搜索
 * 通过 API 直接搜索 AJobThing 人才库
 * 需要雇主账号 + 手动登录保存的 Cookie
 */
export class AJobThingConnector implements JobSiteConnector {
  readonly siteName = "AJobThing";
  readonly siteUrl = "https://www.ajobthing.com";

  async search(jd: ParsedJD, maxResults: number): Promise<CrawlResult> {
    const errors: string[] = [];
    let browser: Browser | null = null;

    try {
      if (!hasValidSession()) {
        return this.errorResult([
          "AJobThing: 未找到登录 Cookie。请先运行: npx tsx src/modules/domain/recruitment/connectors/ajobthing-login.ts",
        ]);
      }

      browser = await chromium.launch({ headless: true });
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        return this.errorResult(["AJobThing: Cookie 已过期。请重新运行登录脚本。"]);
      }

      // 导航到候选人搜索页获取 CSRF token
      await page.goto(`${this.siteUrl}/candidatesearch`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.waitForTimeout(2000);

      const csrfToken = await page.$eval(
        'meta[name="csrf-token"]',
        (el) => el.getAttribute("content") || "",
      ).catch(() => "");

      if (!csrfToken) {
        return this.errorResult(["AJobThing: 无法获取 CSRF token"]);
      }

      // 通过 API 搜索候选人
      const query = this.buildSearchQuery(jd);
      logger.info("AJobThing: searching via API", { query });

      const searchBody = {
        keywords: query.keywords,
        locations: [{ country: "Malaysia", state: jd.location?.toLowerCase() || "kuala lumpur" }],
        page: 1,
        limit: maxResults,
      };

      const apiResult = await page.evaluate(
        async ({ body, csrf }) => {
          const res = await fetch("/api/v4/employer/candidates/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "X-CSRF-TOKEN": csrf,
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify(body),
          });
          return { status: res.status, body: await res.text() };
        },
        { body: searchBody, csrf: csrfToken },
      );

      if (apiResult.status !== 200) {
        return this.errorResult([`AJobThing API error [${apiResult.status}]: ${apiResult.body.slice(0, 200)}`]);
      }

      const parsed = JSON.parse(apiResult.body);
      const profiles: AjtProfile[] = parsed.data || [];
      const total: number = parsed.total || 0;

      logger.info("AJobThing: API returned candidates", { total, returned: profiles.length });

      const candidates = profiles.map((p) => this.buildCandidate(p, jd));

      await context.close();

      return {
        source: this.siteName,
        candidates,
        totalFound: total,
        crawledAt: new Date().toISOString(),
      };
    } catch (err) {
      errors.push(`AJobThing search error: ${String(err)}`);
      logger.error("AJobThing: search failed", { error: String(err) });
    } finally {
      if (browser) await browser.close();
    }

    return {
      source: this.siteName,
      candidates: [],
      totalFound: 0,
      crawledAt: new Date().toISOString(),
      errors,
    };
  }
  private buildSearchQuery(jd: ParsedJD): { keywords: string[] } {
    const keywords: string[] = [];
    if (jd.jobTitle) keywords.push(jd.jobTitle);
    return { keywords: keywords.length > 0 ? keywords : ["staff"] };
  }

  private buildCandidate(profile: AjtProfile, jd: ParsedJD): Candidate {
    const name = profile.name || profile.latest_working_experience?.position || "Unknown";

    const location = profile.location
      ? [profile.location.city, profile.location.state].filter(Boolean).join(", ")
      : jd.location;

    const currentTitle = profile.latest_working_experience?.position || undefined;

    const experience = (profile.working_experiences || [])
      .map((w) => {
        let entry = `${w.position} @ ${w.company}`;
        if (w.work_period) entry += ` (${w.work_period}mo)`;
        if (w.job_desc) entry += ` — ${w.job_desc.replace(/<[^>]*>/g, "").slice(0, 100)}`;
        return entry;
      })
      .join("; ");

    const skills = (profile.matched_highlight?.skills || [])
      .map((s) => s.name)
      .filter(Boolean);

    // 语言：优先用顶层 languages 数组，回退到 matched_highlight
    const languages = profile.languages?.length
      ? profile.languages
      : (profile.matched_highlight?.languages || []).map((l) => l.name).filter(Boolean);

    const education = profile.latest_education?.level
      ? [profile.latest_education.level, profile.latest_education.institute, profile.latest_education.course]
          .filter(Boolean).join(" — ")
      : undefined;

    const salary = profile.expected_salary
      ? `${profile.expected_salary.currency} ${profile.expected_salary.amount}`
      : undefined;

    // 联系方式：过滤掉被打码的值（包含 ***）
    const email = profile.email && !profile.email.includes("*") ? profile.email : undefined;
    const phone = this.cleanContact(profile.contact_number || profile.phone || profile.mobile);

    const summaryParts = [
      currentTitle ? `Current: ${currentTitle}` : null,
      salary ? `Expected salary: ${salary}` : null,
      profile.availability ? `Available: ${profile.availability}` : null,
      profile.nationality ? `Nationality: ${profile.nationality}` : null,
      profile.gender ? `Gender: ${profile.gender}` : null,
      profile.age ? `Age: ${profile.age}` : null,
    ].filter(Boolean);

    // 候选人详情页 URL
    const profileUrl = profile.encoded_id
      ? `${this.siteUrl}/candidatesearch?profile=${profile.encoded_id}`
      : this.siteUrl;

    return {
      candidateId: uuidv4(),
      source: this.siteName,
      sourceUrl: profileUrl,
      name,
      phone,
      email,
      location,
      currentTitle,
      experience: experience || undefined,
      skills,
      languages,
      education,
      summary: summaryParts.join(". ") || undefined,
      rawData: { encoded_id: profile.encoded_id, id: profile.id },
    };
  }

  /** 过滤掉被打码的联系方式 */
  private cleanContact(value?: string): string | undefined {
    if (!value) return undefined;
    if (value.includes("*")) return undefined;
    return value;
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
      await page.goto(`${this.siteUrl}/dashboard`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(2000);
      const url = page.url();
      const loggedIn = !url.includes("login") && !url.includes("auth") && !url.includes("register");
      logger.info("AJobThing: cookie verification", { url, loggedIn });
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
