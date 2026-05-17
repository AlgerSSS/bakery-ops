import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import type { JobPostingConnector } from "./posting.interface";
import type { GeneratedJD, JobPostingResult } from "../types";
import { logger } from "../../../shared/logger";
import { hasValidSession, getCookieFile, getStorageFile } from "../connectors/ajobthing-login";

/**
 * AJobThing 职位发布 — 通过 Playwright + cookie 调用发布 API
 *
 * 具体 API 端点需要通过 discovery 脚本确认。
 * 当前实现基于 UI 自动化兜底：导航到发布页面，填写表单，提交。
 */
export class AJobThingPosting implements JobPostingConnector {
  readonly platformName = "AJobThing";
  private readonly siteUrl = "https://www.ajobthing.com";

  // ── 原有一步到位方法（保留兼容） ──

  async postJob(jd: GeneratedJD): Promise<JobPostingResult> {
    if (!hasValidSession()) {
      return { platform: this.platformName, status: "failed", error: "未找到登录 Cookie" };
    }

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        return { platform: this.platformName, status: "failed", error: "Cookie 已过期" };
      }

      // 尝试 API 方式发布（快速）
      const apiResult = await this.postViaApi(page, jd);
      if (apiResult.status === "posted") {
        await context.close();
        return apiResult;
      }

      // API 失败则用 UI 自动化兜底
      logger.info("AJobThing: API posting failed, falling back to UI automation");
      const uiResult = await this.doFillForm(page, jd);
      const submitResult = await this.doSubmit(page);
      await context.close();
      return submitResult;
    } catch (err) {
      logger.error("AJobThing posting failed", { error: String(err) });
      return { platform: this.platformName, status: "failed", error: String(err) };
    } finally {
      if (browser) await browser.close();
    }
  }

  // PLACEHOLDER_STEP_METHODS

  // ── 交互式分步方法 ──

  /**
   * Step 1: 填写表单（职位标题、语言、薪资、描述）
   * 返回截图路径
   */
  async fillFormStep(jd: GeneratedJD): Promise<{ screenshot: string }> {
    if (!hasValidSession()) {
      throw new Error("未找到 AJobThing 登录 Cookie");
    }

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        throw new Error("AJobThing Cookie 已过期");
      }

      const result = await this.doFillForm(page, jd);
      await context.close();
      return result;
    } finally {
      if (browser) await browser.close();
    }
  }

  /**
   * Step 2: 提交发布
   */
  async submitPost(jd: GeneratedJD): Promise<JobPostingResult> {
    if (!hasValidSession()) {
      return { platform: this.platformName, status: "failed", error: "未找到登录 Cookie" };
    }

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        return { platform: this.platformName, status: "failed", error: "Cookie 已过期" };
      }

      // 重新填写表单再提交（AJobThing 没有 draft 机制）
      await this.doFillForm(page, jd);
      const result = await this.doSubmit(page);
      await context.close();
      return result;
    } finally {
      if (browser) await browser.close();
    }
  }

  // ── 内部实现方法 ──

  /**
   * 通过 API 发布职位（端点待 discovery 确认）
   */
  private async postViaApi(page: Page, jd: GeneratedJD): Promise<JobPostingResult> {
    try {
      const jobTypeMap: Record<string, number> = {
        full_time: 1,
        part_time: 2,
        contract: 3,
      };

      const payload = {
        title: jd.title,
        description: jd.description,
        requirements: jd.requirements.join("\n"),
        benefits: jd.benefits.join("\n"),
        location: jd.location,
        salary_min: jd.salaryRange ? parseInt(jd.salaryRange.replace(/\D/g, "")) : undefined,
        job_type: jobTypeMap[jd.jobType] || 1,
        experience_years: jd.experienceYears,
        languages: jd.languageRequirements,
      };

      const result = await page.evaluate(
        async (data) => {
          const res = await fetch("/api/employer/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(data),
          });
          return { status: res.status, body: await res.text() };
        },
        payload,
      );

      if (result.status === 200 || result.status === 201) {
        const body = JSON.parse(result.body);
        return {
          platform: this.platformName,
          status: "posted",
          jobId: body.id || body.job_id,
          jobUrl: body.url || `${this.siteUrl}/job/${body.id || body.job_id}`,
          postedAt: new Date().toISOString(),
        };
      }

      logger.warn("AJobThing API posting returned non-success", { status: result.status });
      return { platform: this.platformName, status: "failed", error: `API HTTP ${result.status}` };
    } catch (err) {
      return { platform: this.platformName, status: "failed", error: `API error: ${String(err)}` };
    }
  }

  // PLACEHOLDER_DO_FILL_FORM

  /**
   * 填写 UI 表单（不提交）
   */
  private async doFillForm(page: Page, jd: GeneratedJD): Promise<{ screenshot: string }> {
    await page.goto(`${this.siteUrl}/v4/post-job`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // 关闭可能出现的引导弹窗
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const closeBtn = page.locator('.modal-wrapper button:has-text("Close"), .modal-wrapper button:has-text("Skip"), .modal-wrapper button:has-text("Got it"), .modal-wrapper [aria-label="Close"], .modal-close, button.close').first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }

    // 填写职位标题
    const titleInput = page.locator('input[placeholder*="Software Engineer"], input[placeholder*="title"]').first();
    if (await titleInput.isVisible()) {
      await titleInput.fill(jd.title);
      await page.waitForTimeout(500);
    }

    // 勾选语言复选框
    for (const lang of jd.languageRequirements) {
      const langLower = lang.toLowerCase();
      if (langLower.includes("mandarin") || langLower.includes("chinese")) {
        await page.locator('#language-ZH').check().catch(() => {});
      }
      if (langLower.includes("english")) {
        await page.locator('#language-EN').check().catch(() => {});
      }
      if (langLower.includes("malay") || langLower.includes("bahasa")) {
        await page.locator('#language-MS').check().catch(() => {});
      }
    }

    // 填写薪资
    if (jd.salaryRange) {
      const salaryNum = jd.salaryRange.replace(/[^\d]/g, "");
      const minInput = page.locator('input[placeholder="Minimum"]').first();
      const maxInput = page.locator('input[placeholder="Maximum"]').first();
      if (await minInput.isVisible()) await minInput.fill(salaryNum);
      if (await maxInput.isVisible()) await maxInput.fill(salaryNum);
    }

    // 填写职位描述
    const descInput = page.locator('[contenteditable="true"], .ql-editor, textarea').first();
    if (await descInput.isVisible()) {
      await descInput.fill(jd.description.replace(/<[^>]+>/g, ""));
    }

    const screenshotPath = "./ajobthing-posting-form.png";
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info("AJobThing: form filled");

    return { screenshot: screenshotPath };
  }

  /**
   * 提交表单
   */
  private async doSubmit(page: Page): Promise<JobPostingResult> {
    try {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      const submitBtn = page.locator('button:has-text("Post Job"), button:has-text("Submit"), button:has-text("Publish"), button:has-text("Next"), button:has-text("Continue")').first();
      if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click({ force: true });
        await page.waitForTimeout(5000);

        const currentUrl = page.url();
        if (currentUrl.includes("success") || currentUrl.includes("dashboard") || currentUrl.includes("jobs")) {
          return {
            platform: this.platformName,
            status: "posted",
            jobUrl: currentUrl,
            postedAt: new Date().toISOString(),
          };
        }
      }

      return {
        platform: this.platformName,
        status: "draft",
        error: "UI 自动化未能确认发布成功，可能需要手动确认",
      };
    } catch (err) {
      return { platform: this.platformName, status: "failed", error: `UI error: ${String(err)}` };
    }
  }

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
      await page.goto(`${this.siteUrl}/dashboard`, {
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
