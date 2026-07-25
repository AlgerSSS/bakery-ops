import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs";

// 懒加载 stealth（与 jobstreet-login.ts 一致）：顶层 use 会在 Next.js instrumentation
// 导入阶段触发依赖崩溃。SEEK 雇主端会拦截非 stealth 的 headless 浏览器并跳登录页。
let _stealthApplied = false;
function ensureStealth() {
  if (_stealthApplied) return;
  chromium.use(StealthPlugin());
  _stealthApplied = true;
}
import type { ActiveJobsFetcher } from "./active-jobs.interface";
import type { ActiveJob, JobApplicant } from "../types";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../connectors/jobstreet-login";
import { JOBSTREET_BASE_URL as SITE_URL } from "../connectors/jobstreet.constants";
import { logger } from "../../../shared/logger";

export class JobStreetActiveJobs implements ActiveJobsFetcher {
  readonly platformName = "JobStreet" as const;

  async fetchActiveJobs(): Promise<ActiveJob[]> {
    if (!hasValidSession()) {
      logger.warn("JobStreet: no valid session for active jobs");
      return [];
    }

    return this.withAuthedPage(
      {
        methodName: "fetchActiveJobs",
        fallback: [] as ActiveJob[],
        expiredWarning: "JobStreet: session expired, cannot fetch active jobs",
      },
      (page) => this.doFetchActiveJobs(page),
    );
  }

  async fetchApplicants(jobId: string): Promise<JobApplicant[]> {
    if (!hasValidSession()) return [];

    return this.withAuthedPage(
      { methodName: "fetchApplicants", fallback: [] as JobApplicant[] },
      (page) => this.doFetchApplicants(page, jobId),
    );
  }

  async downloadResume(applicant: JobApplicant): Promise<{ buffer: Buffer; fileName: string } | null> {
    // 需要 RESUME 附件 id + correlationId 走 SEEK 的 /attachment/applications 端点。
    if (!hasValidSession() || !applicant.resumeAttachmentId || !applicant.correlationId) return null;

    return this.withAuthedPage(
      { methodName: "downloadResume", fallback: null },
      (page) => this.doDownloadResume(page, applicant),
    );
  }

  /**
   * 三个 public 方法共用的开会话样板：
   * ensureStealth → launch（stealth+args，勿改）→ auth context → verifyCookies → fn。
   * verifyCookies 失败或抛错时返回 fallback，浏览器保证关闭。
   */
  private async withAuthedPage<T>(
    opts: { methodName: string; fallback: T; expiredWarning?: string },
    fn: (page: Page) => Promise<T>,
  ): Promise<T> {
    ensureStealth();
    const browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });
    try {
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        if (opts.expiredWarning) logger.warn(opts.expiredWarning);
        return opts.fallback;
      }

      return await fn(page);
    } catch (err) {
      logger.error(`JobStreet ${opts.methodName} failed`, { error: String(err) });
      return opts.fallback;
    } finally {
      await browser.close();
    }
  }

  // ── 核心抓取逻辑 ──

  private async doFetchActiveJobs(page: Page): Promise<ActiveJob[]> {
    const jobs: ActiveJob[] = [];

    // 拦截 GraphQL 响应
    const graphqlResponses: unknown[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("graphql") || url.includes("/api/")) {
        try {
          const json = await response.json();
          graphqlResponses.push(json);
        } catch { /* ignore non-JSON */ }
      }
    });

    // Express-ad accounts list their jobs on /dashboard via the `dashboardJobs` GraphQL op
    // (/job/managejob redirects a logged-in express account to the create-ad funnel).
    await page.goto(`${SITE_URL}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);
    await this.selectAccountIfNeeded(page);
    await page.waitForTimeout(3000);

    // Primary: extract from the dashboardJobs GraphQL response
    for (const resp of graphqlResponses) {
      const extracted = this.extractDashboardJobs(resp);
      if (extracted.length > 0) {
        logger.info("JobStreet: extracted jobs from dashboardJobs", { count: extracted.length });
        return extracted;
      }
    }

    // Secondary: legacy managejob GraphQL shape
    for (const resp of graphqlResponses) {
      const extracted = this.extractJobsFromGraphQL(resp);
      if (extracted.length > 0) {
        logger.info("JobStreet: extracted jobs from GraphQL (legacy)", { count: extracted.length });
        return extracted;
      }
    }

    // Fallback: DOM 抓取
    logger.info("JobStreet: falling back to DOM scraping for active jobs");
    const jobCards = await page.$$("[data-testid='job-card'], .job-card, [class*='JobCard'], [class*='job-item'], tr[data-job-id], .job-list-item");

    if (jobCards.length === 0) {
      // 尝试更宽泛的选择器
      const rows = await page.$$("table tbody tr, [role='row'], .job-row");
      for (const row of rows) {
        const job = await this.extractJobFromRow(row);
        if (job) jobs.push(job);
      }
    } else {
      for (const card of jobCards) {
        const job = await this.extractJobFromCard(card);
        if (job) jobs.push(job);
      }
    }

    // 如果 DOM 也没抓到，尝试从页面 JSON 数据提取
    if (jobs.length === 0) {
      const pageJobs = await this.extractJobsFromPageData(page);
      jobs.push(...pageJobs);
    }

    logger.info("JobStreet: fetched active jobs", { count: jobs.length });
    return jobs;
  }

  private extractJobsFromGraphQL(data: unknown): ActiveJob[] {
    const jobs: ActiveJob[] = [];
    try {
      const obj = data as Record<string, unknown>;
      // 递归搜索包含 jobs/listings 的数据
      const found = this.findJobsArray(obj);
      for (const item of found) {
        const j = item as Record<string, unknown>;
        const jobId = String(j.id || j.jobId || j.job_id || "");
        const title = String(j.title || j.jobTitle || j.job_title || "");
        if (!jobId || !title) continue;

        jobs.push({
          jobId,
          platform: "JobStreet",
          title,
          location: String(j.location || j.locationName || ""),
          status: "active",
          applicantCount: Number(j.applicantCount || j.applicationCount || j.applications || 0),
          postedAt: String(j.postedAt || j.createdAt || j.postDate || ""),
          jobUrl: j.jobUrl ? String(j.jobUrl) : `${SITE_URL}/job/${jobId}`,
        });
      }
    } catch { /* ignore parse errors */ }
    return jobs;
  }

  private findJobsArray(obj: unknown, depth = 0): unknown[] {
    if (depth > 5 || !obj || typeof obj !== "object") return [];
    const record = obj as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      if (["jobs", "listings", "activeJobs", "jobList", "edges", "nodes"].includes(key)) {
        const val = record[key];
        if (Array.isArray(val) && val.length > 0) {
          // edges pattern: [{node: {...}}]
          if (val[0] && typeof val[0] === "object" && "node" in (val[0] as Record<string, unknown>)) {
            return val.map((e) => (e as Record<string, unknown>).node);
          }
          return val;
        }
      }
      const nested = this.findJobsArray(record[key], depth + 1);
      if (nested.length > 0) return nested;
    }
    return [];
  }

  private async extractJobFromCard(card: import("playwright").ElementHandle): Promise<ActiveJob | null> {
    try {
      const title = await card.$eval(
        "[class*='title'], h3, h4, a[href*='job']",
        (el) => el.textContent?.trim() || "",
      ).catch(() => "");
      if (!title) return null;

      const location = await card.$eval(
        "[class*='location'], [class*='Location']",
        (el) => el.textContent?.trim() || "",
      ).catch(() => "");

      const applicantText = await card.$eval(
        "[class*='applicant'], [class*='application'], [class*='Applicant']",
        (el) => el.textContent?.trim() || "0",
      ).catch(() => "0");
      const applicantCount = parseInt(applicantText.replace(/\D/g, ""), 10) || 0;

      const jobId = await card.getAttribute("data-job-id")
        || await card.$eval("a[href*='job']", (el) => {
          const href = el.getAttribute("href") || "";
          const match = href.match(/\/job\/(\d+)/);
          return match ? match[1] : "";
        }).catch(() => "");

      return {
        jobId: jobId || `js-${Date.now()}`,
        platform: "JobStreet",
        title,
        location,
        status: "active",
        applicantCount,
      };
    } catch {
      return null;
    }
  }

  private async extractJobFromRow(row: import("playwright").ElementHandle): Promise<ActiveJob | null> {
    try {
      const cells = await row.$$("td");
      if (cells.length < 2) return null;

      const title = await cells[0].textContent() || "";
      if (!title.trim()) return null;

      const location = cells.length > 2 ? (await cells[2].textContent() || "").trim() : "";
      const applicantText = cells.length > 3 ? (await cells[3].textContent() || "0").trim() : "0";
      const applicantCount = parseInt(applicantText.replace(/\D/g, ""), 10) || 0;

      return {
        jobId: `js-row-${Date.now()}`,
        platform: "JobStreet",
        title: title.trim(),
        location,
        status: "active",
        applicantCount,
      };
    } catch {
      return null;
    }
  }

  private async extractJobsFromPageData(page: Page): Promise<ActiveJob[]> {
    try {
      const data = await page.evaluate(() => {
        const nextData = (window as unknown as Record<string, unknown>).__NEXT_DATA__;
        return nextData ? JSON.stringify(nextData) : null;
      });
      if (!data) return [];

      const parsed = JSON.parse(data);
      return this.extractJobsFromGraphQL(parsed);
    } catch {
      return [];
    }
  }

  private async doFetchApplicants(page: Page, jobId: string): Promise<JobApplicant[]> {
    const applicants: JobApplicant[] = [];

    const graphqlResponses: unknown[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("graphql") || url.includes("/api/")) {
        try {
          const json = await response.json();
          graphqlResponses.push(json);
        } catch { /* ignore */ }
      }
    });

    // Applicants to our posted ad live at /candidates?jobid=<jobId> (the `applications` GraphQL op,
    // whose result[] exposes firstName/lastName/phone/email for everyone who applied to our ad).
    await page.goto(`${SITE_URL}/candidates?jobid=${jobId}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);
    await this.selectAccountIfNeeded(page);
    await page.waitForTimeout(4000);

    // Primary: the `applications` GraphQL op (result[] includes phone + email)
    for (const resp of graphqlResponses) {
      const extracted = this.extractApplicationsResult(resp, jobId);
      if (extracted.length > 0) {
        logger.info("JobStreet: extracted applicants from applications op", { jobId, count: extracted.length });
        return extracted;
      }
    }

    // Secondary: legacy applicant extractor
    for (const resp of graphqlResponses) {
      const extracted = this.extractApplicantsFromData(resp, jobId);
      if (extracted.length > 0) return extracted;
    }

    // Fallback: DOM 抓取
    const cards = await page.$$(
      "[data-testid='applicant-card'], .applicant-card, [class*='Applicant'], [class*='candidate'], tr[data-applicant-id]",
    );

    for (const card of cards) {
      const applicant = await this.extractApplicantFromCard(card, jobId);
      if (applicant) applicants.push(applicant);
    }

    // 尝试表格行
    if (applicants.length === 0) {
      const rows = await page.$$("table tbody tr, [role='row']");
      for (const row of rows) {
        const applicant = await this.extractApplicantFromRow(row, jobId);
        if (applicant) applicants.push(applicant);
      }
    }

    logger.info("JobStreet: fetched applicants", { jobId, count: applicants.length });
    return applicants;
  }

  private extractApplicantsFromData(data: unknown, jobId: string): JobApplicant[] {
    const applicants: JobApplicant[] = [];
    try {
      const found = this.findApplicantsArray(data);
      for (const item of found) {
        const a = item as Record<string, unknown>;
        const name = String(a.name || a.candidateName || a.fullName || "");
        if (!name) continue;

        applicants.push({
          applicantId: String(a.id || a.applicantId || a.candidateId || `js-${Date.now()}-${Math.random()}`),
          platform: "JobStreet",
          jobId,
          name,
          currentTitle: a.currentTitle ? String(a.currentTitle) : a.jobTitle ? String(a.jobTitle) : undefined,
          experienceYears: a.experienceYears ? Number(a.experienceYears) : a.experience ? Number(a.experience) : undefined,
          appliedAt: a.appliedAt ? String(a.appliedAt) : a.applicationDate ? String(a.applicationDate) : undefined,
          resumeUrl: a.resumeUrl ? String(a.resumeUrl) : undefined,
          profileUrl: a.profileUrl ? String(a.profileUrl) : a.candidateUrl ? String(a.candidateUrl) : undefined,
        });
      }
    } catch { /* ignore */ }
    return applicants;
  }

  private findApplicantsArray(obj: unknown, depth = 0): unknown[] {
    if (depth > 5 || !obj || typeof obj !== "object") return [];
    const record = obj as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      if (["applicants", "applications", "candidates", "edges", "nodes"].includes(key)) {
        const val = record[key];
        if (Array.isArray(val) && val.length > 0) {
          if (val[0] && typeof val[0] === "object" && "node" in (val[0] as Record<string, unknown>)) {
            return val.map((e) => (e as Record<string, unknown>).node);
          }
          return val;
        }
      }
      const nested = this.findApplicantsArray(record[key], depth + 1);
      if (nested.length > 0) return nested;
    }
    return [];
  }

  private async extractApplicantFromCard(card: import("playwright").ElementHandle, jobId: string): Promise<JobApplicant | null> {
    try {
      const name = await card.$eval(
        "[class*='name'], [class*='Name'], h3, h4",
        (el) => el.textContent?.trim() || "",
      ).catch(() => "");
      if (!name) return null;

      const title = await card.$eval(
        "[class*='title'], [class*='Title'], [class*='position']",
        (el) => el.textContent?.trim() || "",
      ).catch(() => "");

      const dateText = await card.$eval(
        "[class*='date'], [class*='Date'], time",
        (el) => el.textContent?.trim() || "",
      ).catch(() => "");

      const profileLink = await card.$eval(
        "a[href*='candidate'], a[href*='profile'], a[href*='applicant']",
        (el) => el.getAttribute("href") || "",
      ).catch(() => "");

      return {
        applicantId: `js-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        platform: "JobStreet",
        jobId,
        name,
        currentTitle: title || undefined,
        appliedAt: dateText || undefined,
        profileUrl: profileLink ? (profileLink.startsWith("http") ? profileLink : `${SITE_URL}${profileLink}`) : undefined,
      };
    } catch {
      return null;
    }
  }

  private async extractApplicantFromRow(row: import("playwright").ElementHandle, jobId: string): Promise<JobApplicant | null> {
    try {
      const cells = await row.$$("td");
      if (cells.length < 2) return null;

      const name = (await cells[0].textContent() || "").trim();
      if (!name) return null;

      const title = cells.length > 1 ? (await cells[1].textContent() || "").trim() : "";
      const dateText = cells.length > 2 ? (await cells[2].textContent() || "").trim() : "";

      return {
        applicantId: `js-row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        platform: "JobStreet",
        jobId,
        name,
        currentTitle: title || undefined,
        appliedAt: dateText || undefined,
      };
    } catch {
      return null;
    }
  }

  private async doDownloadResume(page: Page, applicant: JobApplicant): Promise<{ buffer: Buffer; fileName: string } | null> {
    // SEEK 简历下载：GET {SITE}/attachment/applications?jobId&applicationCorrelationId&attachmentType&actionType&attachmentId
    // 需带 Authorization: Bearer <auth0 access_token>（存在 SPA 缓存 @@auth0spajs@@ 里，scope advertiser:*）。
    // 端点/参数/鉴权均经实测确认；付费(paid)账号返回 200+PDF，express 免费账号返回 422（付费墙）→ 本方法返回 null 降级。
    try {
      // 先进候选人列表页，确保 auth0 SPA 缓存已注入 localStorage
      await page.goto(`${SITE_URL}/candidates?jobid=${applicant.jobId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2500);
      await this.selectAccountIfNeeded(page);

      const params = new URLSearchParams({
        jobId: applicant.jobId,
        applicationCorrelationId: applicant.correlationId!,
        attachmentType: "PdfConvertedResume",
        actionType: "Download",
        attachmentId: applicant.resumeAttachmentId!,
      });
      const url = `${SITE_URL}/attachment/applications?${params.toString()}`;

      const result = await page.evaluate(async (u: string) => {
        // 内联读取 auth0 access_token（避免命名内部函数触发打包器的 __name 注入）
        let token = "";
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !/auth0|@@/.test(k)) continue;
          try {
            const v = JSON.parse(localStorage.getItem(k) || "{}");
            const at = (v.body || v)?.access_token;
            if (at) { token = at as string; break; }
          } catch { /* ignore */ }
        }
        const res = await fetch(u, {
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const ct = res.headers.get("content-type") || "";
        if (res.ok && /pdf|octet-stream/i.test(ct)) {
          const buf = new Uint8Array(await res.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i += 8192) {
            bin += String.fromCharCode(...buf.subarray(i, i + 8192));
          }
          return { ok: true, status: res.status, base64: btoa(bin) };
        }
        return { ok: false, status: res.status, ct };
      }, url);

      if (result.ok && result.base64) {
        const buffer = Buffer.from(result.base64, "base64");
        const fileName = `${applicant.name.replace(/\s+/g, "_")}_resume.pdf`;
        return { buffer, fileName };
      }

      // 422 = SEEK express 免费套餐付费墙（付费账号可下）；401 = 会话/令牌过期
      logger.info("JobStreet: resume download not available (likely SEEK express paywall)", {
        applicantId: applicant.applicantId,
        status: (result as { status?: number }).status,
      });
      return null;
    } catch (err) {
      logger.error("JobStreet: resume download failed", { error: String(err) });
      return null;
    }
  }

  /** SEEK shows an /account/select interstitial for multi-account users; pick the Hot Crush account. */
  private async selectAccountIfNeeded(page: Page): Promise<void> {
    if (!page.url().includes("/account/select")) return;
    try {
      await page.waitForTimeout(1500);
      const clicked = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("a,button,[role=button],li,div"));
        const target = els.find(
          (e) => (e as HTMLElement).offsetParent && /hot\s*crush|yune|sdn\.?\s*bhd/i.test((e as HTMLElement).innerText || ""),
        );
        if (target) { (target as HTMLElement).click(); return true; }
        return false;
      });
      logger.info("JobStreet: account/select handled", { clicked });
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    } catch (err) {
      logger.warn("JobStreet: account/select handling failed", { error: String(err) });
    }
  }

  /** Extract active jobs from the `dashboardJobs` GraphQL op (data.dashboardJobs.jobs.edges[].node). */
  private extractDashboardJobs(data: unknown): ActiveJob[] {
    const jobs: ActiveJob[] = [];
    try {
      const root = data as Record<string, any>;
      const edges = root?.data?.dashboardJobs?.jobs?.edges;
      if (!Array.isArray(edges)) return [];
      for (const edge of edges) {
        const n = edge?.node;
        if (!n?.id || !n?.title) continue;
        const status = String(n.status || "").toUpperCase();
        jobs.push({
          jobId: String(n.id),
          platform: "JobStreet",
          title: String(n.title),
          location: String(n.locations?.[0]?.description || ""),
          status:
            status === "ACTIVE" ? "active"
              : status === "EXPIRED" ? "expired"
                : status === "DRAFT" ? "draft" : "closed",
          applicantCount: Number(n.candidatesCount ?? 0),
          postedAt: n.listingDate ? String(n.listingDate) : undefined,
          jobUrl: `${SITE_URL}/candidates?jobid=${n.id}`,
        });
      }
    } catch { /* ignore parse errors */ }
    return jobs;
  }

  /** Extract applicants from the `applications` GraphQL op (data.applications.result[] has phone/email). */
  private extractApplicationsResult(data: unknown, jobId: string): JobApplicant[] {
    const applicants: JobApplicant[] = [];
    try {
      const root = data as Record<string, any>;
      const result = root?.data?.applications?.result;
      if (!Array.isArray(result)) return [];
      for (const r of result) {
        const name = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
        if (!name) continue;
        applicants.push({
          applicantId: String(r.applicationId || r.id || r.candidateId || ""),
          platform: "JobStreet",
          jobId,
          name,
          phone: r.phone ? this.normalizeMyPhone(String(r.phone)) : undefined,
          email: r.email ? String(r.email) : undefined,
          currentTitle: r.mostRecentJobTitle ? String(r.mostRecentJobTitle) : undefined,
          experienceYears:
            typeof r.mostRecentRoleMonths === "number"
              ? Math.round((r.mostRecentRoleMonths / 12) * 10) / 10
              : undefined,
          appliedAt: r.appliedDateUtc ? String(r.appliedDateUtc) : undefined,
          candidateId: r.candidateId != null ? String(r.candidateId) : undefined,
          correlationId: r.id != null ? String(r.id) : undefined,
          hasResumeAttachment: Array.isArray(r.attachmentsV2?.result)
            ? r.attachmentsV2.result.some((a: { attachmentType?: string }) => /RESUME|CV/i.test(String(a?.attachmentType)))
            : undefined,
          resumeAttachmentId: Array.isArray(r.attachmentsV2?.result)
            ? (r.attachmentsV2.result.find((a: { attachmentType?: string }) => /RESUME|CV/i.test(String(a?.attachmentType)))?.attachmentId != null
                ? String(r.attachmentsV2.result.find((a: { attachmentType?: string }) => /RESUME|CV/i.test(String(a?.attachmentType))).attachmentId)
                : undefined)
            : undefined,
        });
      }
    } catch { /* ignore parse errors */ }
    return applicants;
  }

  /**
   * 拉取候选人在线档案（教育/技能/工作经历/工作权利/国籍）。
   * SEEK express 免费套餐无法下载简历 PDF（详情抽屉显示 "Upgrade to download"），
   * 但这些结构化档案可免费获取——点开候选人卡片会触发 ProfileDrawerApplication，
   * 我们被动截获其响应并提取。applicantIndex = 列表顺序（卡片 data-testid=job-application-card-N）。
   */
  async fetchApplicantProfile(
    jobId: string,
    applicantIndex: number,
    applicant: JobApplicant,
  ): Promise<import("../types").ApplicantProfile | null> {
    if (!hasValidSession()) return null;
    return this.withAuthedPage(
      { methodName: "fetchApplicantProfile", fallback: null },
      (page) => this.doFetchApplicantProfile(page, jobId, applicantIndex, applicant),
    );
  }

  private async doFetchApplicantProfile(
    page: Page,
    jobId: string,
    applicantIndex: number,
    applicant: JobApplicant,
  ): Promise<import("../types").ApplicantProfile | null> {
    const responses: unknown[] = [];
    page.on("response", async (response) => {
      if (!response.url().includes("graphql")) return;
      try { responses.push(await response.json()); } catch { /* ignore */ }
    });

    await page.goto(`${SITE_URL}/candidates?jobid=${jobId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    await this.selectAccountIfNeeded(page);
    await page.waitForTimeout(3000);

    // 点开对应候选人卡片打开档案抽屉（触发 ProfileDrawerApplication）
    const card =
      (await page.$(`[data-testid='job-application-card-${applicantIndex}']`)) ||
      (applicant.name ? await page.$(`text=${applicant.name.split(" ")[0]}`) : null);
    if (!card) return null;
    await card.click().catch(() => {});
    await page.waitForTimeout(5000);

    return this.extractProfileFromResponses(responses, applicant);
  }

  private extractProfileFromResponses(
    responses: unknown[],
    applicant: JobApplicant,
  ): import("../types").ApplicantProfile | null {
    for (const resp of responses) {
      const p = (resp as Record<string, any>)?.data?.application?.result?.profile?.result;
      if (!p) continue;
      const list = (arr: unknown, fmt: (x: any) => string | undefined): string[] =>
        (Array.isArray(arr) ? arr.map(fmt).filter((s): s is string => Boolean(s)) : []);
      return {
        education: list(p.education, (e) => [e?.name, e?.institute].filter(Boolean).join(" @ ") || undefined),
        skills: list(p.skills, (s) => s?.keyword),
        workHistory: list(p.workHistory, (w) => [w?.title || w?.jobTitle, w?.companyName || w?.company].filter(Boolean).join(" @ ") || undefined),
        rightToWork: list(p.rightsToWorkV2, (r) => r?.displayLabel),
        nationalities: list(p.nationalities?.result, (n) => n?.countryName),
        hasResumeAttachment: Boolean(applicant.hasResumeAttachment),
      };
    }
    return null;
  }

  /** Normalize a SEEK phone (e.g. "+60 0182479081" / "0182479081") to 60XXXXXXXXX (no +, no leading 0). */
  private normalizeMyPhone(raw: string): string {
    let d = raw.replace(/\D/g, "");
    if (d.startsWith("60")) d = d.slice(2);
    d = d.replace(/^0+/, "");
    return `60${d}`;
  }

  // ── Auth helpers ──

  private async createAuthContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      acceptDownloads: true,
    });

    const cookieFile = getCookieFile();
    if (fs.existsSync(cookieFile)) {
      await context.addCookies(JSON.parse(fs.readFileSync(cookieFile, "utf-8")));
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
      // Probe a REAL authenticated page (/dashboard), not "/" — root redirects through
      // /onboarding + a silent auth0 check that transiently sits on an oauth URL and would
      // false-negative. A stale session bounces to authenticate.seek.com/login.
      await page.goto(`${SITE_URL}/dashboard`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(5000);
      const url = page.url();
      return !url.includes("authenticate.seek.com") && !url.includes("/login") && !url.includes("/oauth/");
    } catch {
      return false;
    }
  }
}
