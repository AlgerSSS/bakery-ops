import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import type { ActiveJobsFetcher } from "./active-jobs.interface";
import type { ActiveJob, JobApplicant } from "../types";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../connectors/jobstreet-login";
import { logger } from "../../../shared/logger";

const SITE_URL = "https://my.employer.seek.com";

export class JobStreetActiveJobs implements ActiveJobsFetcher {
  readonly platformName = "JobStreet" as const;

  async fetchActiveJobs(): Promise<ActiveJob[]> {
    if (!hasValidSession()) {
      logger.warn("JobStreet: no valid session for active jobs");
      return [];
    }

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        logger.warn("JobStreet: session expired, cannot fetch active jobs");
        return [];
      }

      return await this.doFetchActiveJobs(page);
    } catch (err) {
      logger.error("JobStreet fetchActiveJobs failed", { error: String(err) });
      return [];
    } finally {
      await browser.close();
    }
  }

  async fetchApplicants(jobId: string): Promise<JobApplicant[]> {
    if (!hasValidSession()) return [];

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) return [];

      return await this.doFetchApplicants(page, jobId);
    } catch (err) {
      logger.error("JobStreet fetchApplicants failed", { error: String(err) });
      return [];
    } finally {
      await browser.close();
    }
  }

  async downloadResume(applicant: JobApplicant): Promise<{ buffer: Buffer; fileName: string } | null> {
    if (!hasValidSession() || !applicant.profileUrl) return null;

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) return null;

      return await this.doDownloadResume(page, applicant);
    } catch (err) {
      logger.error("JobStreet downloadResume failed", { error: String(err) });
      return null;
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

    await page.goto(`${SITE_URL}/job/managejob`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

    // 尝试从 GraphQL 响应提取岗位
    for (const resp of graphqlResponses) {
      const extracted = this.extractJobsFromGraphQL(resp);
      if (extracted.length > 0) {
        logger.info("JobStreet: extracted jobs from GraphQL", { count: extracted.length });
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

    // 尝试多种 URL 模式
    const urls = [
      `${SITE_URL}/manage-applications/${jobId}`,
      `${SITE_URL}/job/${jobId}/applications`,
      `${SITE_URL}/job/managejob/${jobId}/applications`,
    ];

    let loaded = false;
    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(3000);
        if (!page.url().includes("error") && !page.url().includes("404")) {
          loaded = true;
          break;
        }
      } catch { /* try next URL */ }
    }

    if (!loaded) {
      logger.warn("JobStreet: could not load applicants page", { jobId });
      return [];
    }

    // 尝试从 GraphQL 提取
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
    if (!applicant.profileUrl) return null;

    try {
      await page.goto(applicant.profileUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await page.waitForTimeout(2000);

      // 尝试点击下载按钮
      const downloadBtn = await page.$(
        "button:has-text('Download CV'), button:has-text('Download Resume'), a:has-text('Download CV'), a:has-text('Download Resume'), [data-testid='download-resume'], [class*='download']",
      );

      if (downloadBtn) {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 15000 }),
          downloadBtn.click(),
        ]);

        const filePath = await download.path();
        if (filePath) {
          const buffer = fs.readFileSync(filePath);
          const fileName = download.suggestedFilename() || `${applicant.name.replace(/\s+/g, "_")}_resume.pdf`;
          return { buffer, fileName };
        }
      }

      // 如果有直接的 resumeUrl，尝试直接下载
      if (applicant.resumeUrl) {
        const response = await page.goto(applicant.resumeUrl, { timeout: 15000 });
        if (response && response.ok()) {
          const buffer = Buffer.from(await response.body());
          const fileName = `${applicant.name.replace(/\s+/g, "_")}_resume.pdf`;
          return { buffer, fileName };
        }
      }

      logger.warn("JobStreet: no download button or resume URL found", { applicantId: applicant.applicantId });
      return null;
    } catch (err) {
      logger.error("JobStreet: resume download failed", { error: String(err) });
      return null;
    }
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
      await page.goto(`${SITE_URL}/`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(5000);
      const url = page.url();
      return !url.includes("login") && !url.includes("oauth") && !url.includes("authenticate");
    } catch {
      return false;
    }
  }
}
