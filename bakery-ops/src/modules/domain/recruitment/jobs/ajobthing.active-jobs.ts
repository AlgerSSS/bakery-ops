import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import type { ActiveJobsFetcher } from "./active-jobs.interface";
import type { ActiveJob, JobApplicant } from "../types";
import {
  getCookieFile,
  getStorageFile,
  hasValidSession,
} from "../connectors/ajobthing-login";
import { logger } from "../../../shared/logger";

const SITE_URL = "https://www.ajobthing.com";

export class AJobThingActiveJobs implements ActiveJobsFetcher {
  readonly platformName = "AJobThing" as const;

  async fetchActiveJobs(): Promise<ActiveJob[]> {
    if (!hasValidSession()) {
      logger.warn("AJobThing: no valid session for active jobs");
      return [];
    }

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        logger.warn("AJobThing: session expired, cannot fetch active jobs");
        return [];
      }

      return await this.doFetchActiveJobs(page);
    } catch (err) {
      logger.error("AJobThing fetchActiveJobs failed", { error: String(err) });
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
      logger.error("AJobThing fetchApplicants failed", { error: String(err) });
      return [];
    } finally {
      await browser.close();
    }
  }

  async downloadResume(applicant: JobApplicant): Promise<{ buffer: Buffer; fileName: string } | null> {
    // AJobThing 通常有直接的 resumeUrl（来自 AjtProfile 的 resume.file_url）
    if (applicant.resumeUrl) {
      try {
        const response = await fetch(applicant.resumeUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const fileName = `${applicant.name.replace(/\s+/g, "_")}_resume.pdf`;
          return { buffer, fileName };
        }
      } catch (err) {
        logger.warn("AJobThing: direct resume download failed, trying browser", { error: String(err) });
      }
    }

    // Fallback: 用浏览器下载
    if (!hasValidSession() || !applicant.profileUrl) return null;

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) return null;

      return await this.doDownloadResume(page, applicant);
    } catch (err) {
      logger.error("AJobThing downloadResume failed", { error: String(err) });
      return null;
    } finally {
      await browser.close();
    }
  }

  // ── 核心抓取逻辑 ──

  private async doFetchActiveJobs(page: Page): Promise<ActiveJob[]> {
    const jobs: ActiveJob[] = [];

    // 拦截 XHR 响应
    const apiResponses: unknown[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/") || url.includes("/v4/")) {
        try {
          const json = await response.json();
          apiResponses.push(json);
        } catch { /* ignore */ }
      }
    });

    // 尝试 API 端点
    try {
      const apiResponse = await page.goto(`${SITE_URL}/api/employer/jobs`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      if (apiResponse && apiResponse.ok()) {
        const data = await apiResponse.json();
        const extracted = this.extractJobsFromApiResponse(data);
        if (extracted.length > 0) {
          logger.info("AJobThing: extracted jobs from API", { count: extracted.length });
          return extracted;
        }
      }
    } catch {
      logger.info("AJobThing: API endpoint not available, falling back to UI");
    }

    // Fallback: 导航到管理页面
    await page.goto(`${SITE_URL}/v4/manage-jobs`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // 检查拦截到的 API 响应
    for (const resp of apiResponses) {
      const extracted = this.extractJobsFromApiResponse(resp);
      if (extracted.length > 0) {
        logger.info("AJobThing: extracted jobs from intercepted API", { count: extracted.length });
        return extracted;
      }
    }

    // DOM 抓取
    logger.info("AJobThing: falling back to DOM scraping");
    const jobCards = await page.$$(
      ".job-card, [class*='JobCard'], [class*='job-item'], [class*='job-list'], .card",
    );

    for (const card of jobCards) {
      const job = await this.extractJobFromCard(card);
      if (job) jobs.push(job);
    }

    // 尝试表格
    if (jobs.length === 0) {
      const rows = await page.$$("table tbody tr, [role='row']");
      for (const row of rows) {
        const job = await this.extractJobFromRow(row);
        if (job) jobs.push(job);
      }
    }

    logger.info("AJobThing: fetched active jobs", { count: jobs.length });
    return jobs;
  }

  private extractJobsFromApiResponse(data: unknown): ActiveJob[] {
    const jobs: ActiveJob[] = [];
    try {
      const obj = data as Record<string, unknown>;
      // 尝试常见的 API 响应结构
      let items: unknown[] = [];
      if (Array.isArray(obj.data)) items = obj.data;
      else if (Array.isArray(obj.jobs)) items = obj.jobs;
      else if (obj.data && typeof obj.data === "object" && Array.isArray((obj.data as Record<string, unknown>).jobs)) {
        items = (obj.data as Record<string, unknown>).jobs as unknown[];
      }

      for (const item of items) {
        const j = item as Record<string, unknown>;
        const jobId = String(j.id || j.job_id || j.jobId || "");
        const title = String(j.title || j.job_title || j.jobTitle || "");
        if (!jobId || !title) continue;

        const statusRaw = String(j.status || "active").toLowerCase();
        if (statusRaw !== "active" && statusRaw !== "open" && statusRaw !== "published") continue;

        jobs.push({
          jobId,
          platform: "AJobThing",
          title,
          location: String(j.location || j.area || j.city || ""),
          status: "active",
          applicantCount: Number(j.applicant_count || j.applicantCount || j.applications_count || 0),
          postedAt: j.posted_at ? String(j.posted_at) : j.created_at ? String(j.created_at) : undefined,
          jobUrl: j.url ? String(j.url) : `${SITE_URL}/job/${jobId}`,
        });
      }
    } catch { /* ignore */ }
    return jobs;
  }

  private async extractJobFromCard(card: import("playwright").ElementHandle): Promise<ActiveJob | null> {
    try {
      const title = await card.$eval(
        "[class*='title'], h3, h4, h5, a[href*='job']",
        (el) => el.textContent?.trim() || "",
      ).catch(() => "");
      if (!title) return null;

      const location = await card.$eval(
        "[class*='location'], [class*='area']",
        (el) => el.textContent?.trim() || "",
      ).catch(() => "");

      const applicantText = await card.$eval(
        "[class*='applicant'], [class*='application']",
        (el) => el.textContent?.trim() || "0",
      ).catch(() => "0");
      const applicantCount = parseInt(applicantText.replace(/\D/g, ""), 10) || 0;

      const jobLink = await card.$eval(
        "a[href*='job']",
        (el) => el.getAttribute("href") || "",
      ).catch(() => "");
      const jobIdMatch = jobLink.match(/\/job[s]?\/(\d+)/);

      return {
        jobId: jobIdMatch ? jobIdMatch[1] : `ajt-${Date.now()}`,
        platform: "AJobThing",
        title,
        location,
        status: "active",
        applicantCount,
        jobUrl: jobLink ? (jobLink.startsWith("http") ? jobLink : `${SITE_URL}${jobLink}`) : undefined,
      };
    } catch {
      return null;
    }
  }

  private async extractJobFromRow(row: import("playwright").ElementHandle): Promise<ActiveJob | null> {
    try {
      const cells = await row.$$("td");
      if (cells.length < 2) return null;

      const title = (await cells[0].textContent() || "").trim();
      if (!title) return null;

      const location = cells.length > 2 ? (await cells[2].textContent() || "").trim() : "";
      const applicantText = cells.length > 3 ? (await cells[3].textContent() || "0").trim() : "0";
      const applicantCount = parseInt(applicantText.replace(/\D/g, ""), 10) || 0;

      return {
        jobId: `ajt-row-${Date.now()}`,
        platform: "AJobThing",
        title,
        location,
        status: "active",
        applicantCount,
      };
    } catch {
      return null;
    }
  }

  private async doFetchApplicants(page: Page, jobId: string): Promise<JobApplicant[]> {
    const applicants: JobApplicant[] = [];

    const apiResponses: unknown[] = [];
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/") || url.includes("/v4/")) {
        try {
          const json = await response.json();
          apiResponses.push(json);
        } catch { /* ignore */ }
      }
    });

    // 尝试 API
    try {
      const apiResponse = await page.goto(`${SITE_URL}/api/employer/jobs/${jobId}/applicants`, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      if (apiResponse && apiResponse.ok()) {
        const data = await apiResponse.json();
        const extracted = this.extractApplicantsFromApiResponse(data, jobId);
        if (extracted.length > 0) return extracted;
      }
    } catch {
      logger.info("AJobThing: applicants API not available, falling back to UI");
    }

    // Fallback: 导航到岗位申请者页面
    const urls = [
      `${SITE_URL}/v4/manage-jobs/${jobId}/applicants`,
      `${SITE_URL}/employer/jobs/${jobId}/applicants`,
    ];

    for (const url of urls) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(3000);
        if (!page.url().includes("error") && !page.url().includes("404")) break;
      } catch { /* try next */ }
    }

    // 检查拦截到的响应
    for (const resp of apiResponses) {
      const extracted = this.extractApplicantsFromApiResponse(resp, jobId);
      if (extracted.length > 0) return extracted;
    }

    // DOM 抓取
    const cards = await page.$$(
      ".applicant-card, [class*='Applicant'], [class*='candidate'], .card",
    );

    for (const card of cards) {
      const applicant = await this.extractApplicantFromCard(card, jobId);
      if (applicant) applicants.push(applicant);
    }

    if (applicants.length === 0) {
      const rows = await page.$$("table tbody tr, [role='row']");
      for (const row of rows) {
        const applicant = await this.extractApplicantFromRow(row, jobId);
        if (applicant) applicants.push(applicant);
      }
    }

    logger.info("AJobThing: fetched applicants", { jobId, count: applicants.length });
    return applicants;
  }

  private extractApplicantsFromApiResponse(data: unknown, jobId: string): JobApplicant[] {
    const applicants: JobApplicant[] = [];
    try {
      const obj = data as Record<string, unknown>;
      let items: unknown[] = [];
      if (Array.isArray(obj.data)) items = obj.data;
      else if (Array.isArray(obj.applicants)) items = obj.applicants;
      else if (obj.data && typeof obj.data === "object" && Array.isArray((obj.data as Record<string, unknown>).applicants)) {
        items = (obj.data as Record<string, unknown>).applicants as unknown[];
      }

      for (const item of items) {
        const a = item as Record<string, unknown>;
        const name = String(a.name || a.full_name || a.fullName || "");
        if (!name) continue;

        // AJobThing 的 resume 通常在 profile.resume.file_url
        let resumeUrl: string | undefined;
        if (a.resume_url) resumeUrl = String(a.resume_url);
        else if (a.resume && typeof a.resume === "object") {
          const resume = a.resume as Record<string, unknown>;
          resumeUrl = resume.file_url ? String(resume.file_url) : resume.url ? String(resume.url) : undefined;
        }

        applicants.push({
          applicantId: String(a.id || a.applicant_id || `ajt-${Date.now()}-${Math.random()}`),
          platform: "AJobThing",
          jobId,
          name,
          currentTitle: a.current_title ? String(a.current_title) : a.job_title ? String(a.job_title) : undefined,
          experienceYears: a.experience_years ? Number(a.experience_years) : undefined,
          appliedAt: a.applied_at ? String(a.applied_at) : a.created_at ? String(a.created_at) : undefined,
          resumeUrl,
          profileUrl: a.profile_url ? String(a.profile_url) : undefined,
        });
      }
    } catch { /* ignore */ }
    return applicants;
  }

  private async extractApplicantFromCard(card: import("playwright").ElementHandle, jobId: string): Promise<JobApplicant | null> {
    try {
      const name = await card.$eval(
        "[class*='name'], [class*='Name'], h3, h4, h5",
        (el) => el.textContent?.trim() || "",
      ).catch(() => "");
      if (!name) return null;

      const title = await card.$eval(
        "[class*='title'], [class*='position']",
        (el) => el.textContent?.trim() || "",
      ).catch(() => "");

      const dateText = await card.$eval(
        "[class*='date'], time",
        (el) => el.textContent?.trim() || "",
      ).catch(() => "");

      const profileLink = await card.$eval(
        "a[href*='applicant'], a[href*='profile'], a[href*='candidate']",
        (el) => el.getAttribute("href") || "",
      ).catch(() => "");

      return {
        applicantId: `ajt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        platform: "AJobThing",
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
        applicantId: `ajt-row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        platform: "AJobThing",
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

      // 尝试找到下载按钮
      const downloadBtn = await page.$(
        "a:has-text('Download'), button:has-text('Download'), a:has-text('Resume'), [class*='download'], [class*='resume'] a",
      );

      if (downloadBtn) {
        const href = await downloadBtn.getAttribute("href");
        if (href && (href.endsWith(".pdf") || href.includes("resume") || href.includes("download"))) {
          const fullUrl = href.startsWith("http") ? href : `${SITE_URL}${href}`;
          const response = await fetch(fullUrl);
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            const fileName = `${applicant.name.replace(/\s+/g, "_")}_resume.pdf`;
            return { buffer, fileName };
          }
        }

        // 尝试浏览器下载
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 10000 }),
          downloadBtn.click(),
        ]).catch(() => [null]);

        if (download) {
          const filePath = await download.path();
          if (filePath) {
            const buffer = fs.readFileSync(filePath);
            const fileName = download.suggestedFilename() || `${applicant.name.replace(/\s+/g, "_")}_resume.pdf`;
            return { buffer, fileName };
          }
        }
      }

      return null;
    } catch (err) {
      logger.error("AJobThing: resume download failed", { error: String(err) });
      return null;
    }
  }

  // ── Auth helpers ──

  private async createAuthContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
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
      await page.goto(`${SITE_URL}/dashboard`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(2000);
      const url = page.url();
      return !url.includes("login") && !url.includes("auth") && !url.includes("register");
    } catch {
      return false;
    }
  }
}
