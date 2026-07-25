import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import type { JobPostingConnector } from "./posting.interface";
import type { GeneratedJD, JobPostingResult } from "../types";
import { logger } from "../../../shared/logger";
import { hasValidSession, getCookieFile, getStorageFile } from "../connectors/jobstreet-login";
import { JOBSTREET_BASE_URL } from "../connectors/jobstreet.constants";

/** 从 URL 提取 draft/job ID（支持多种参数名） */
function extractIdFromUrl(url: string): string | undefined {
  const patterns = [
    /[?&]draftid=(\d+)/i,
    /[?&]draftJobId=(\d+)/i,
    /[?&]draft[_-]?id=([^&]+)/i,
    /[?&]jobId=(\d+)/i,
    /[?&]job[_-]?id=(\d+)/i,
    /[?&]id=(\d{6,})/i,
    /\/(\d{6,})(?:\?|$|\/)/,  // ID in path segment
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * JobStreet 职位发布 — 通过 Express Create 多步骤向导
 *
 * 真实发布 URL: /job/managejob/express/create?referrer=createJob
 * 页面自动跳转到 /job/managejob/express/create/classify（第一步：分类）
 *
 * 表单字段（Step 1 - Classify）:
 *   #JobTitleTextField — 职位标题
 *   #JobLocation — 地点（combobox，需要选择下拉项）
 *   #salary_currency — 货币（select）
 *   #minSalary / #maxSalary — 薪资范围
 *   Job type 按钮: Full-time / Part-time / Contract / Casual
 *   Pay frequency 按钮: Hourly / Monthly / Annually
 *   #next-page-button — Continue（进入下一步）
 */
export class JobStreetPosting implements JobPostingConnector {
  readonly platformName = "JobStreet";
  private readonly siteUrl = JOBSTREET_BASE_URL;

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

      const classifyResult = await this.doFillClassify(page, jd);
      if (!classifyResult.draftId) {
        await context.close();
        return { platform: this.platformName, status: "failed", error: "未能获取 draft ID" };
      }

      await this.doFillWrite(page, jd);
      const result = await this.doManageAndPost(page);
      await context.close();
      return result;
    } catch (err) {
      logger.error("JobStreet posting failed", { error: String(err) });
      return { platform: this.platformName, status: "failed", error: String(err) };
    } finally {
      if (browser) await browser.close();
    }
  }

  // ── 交互式分步方法（每步独立 browser 生命周期） ──

  /**
   * Step 1: 填写 Classify 表单（职位标题、地点、薪资、工作类型）
   * 返回 draftId（从 URL 提取）和截图路径
   */
  async fillClassifyStep(jd: GeneratedJD): Promise<{ draftId?: string; screenshot: string }> {
    if (!hasValidSession()) {
      throw new Error("未找到 JobStreet 登录 Cookie");
    }

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        throw new Error("JobStreet Cookie 已过期");
      }

      const result = await this.doFillClassify(page, jd);
      await context.close();
      return result;
    } finally {
      if (browser) await browser.close();
    }
  }

  /**
   * Step 2: 填写 Write Ad 步骤（职位描述、摘要、卖点）
   * 需要 draftId 来导航到正确的 draft
   */
  async fillWriteStep(jd: GeneratedJD, draftId: string): Promise<{ screenshot: string }> {
    if (!hasValidSession()) {
      throw new Error("未找到 JobStreet 登录 Cookie");
    }

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        throw new Error("JobStreet Cookie 已过期");
      }

      // 导航到 draft 的 write 步骤
      await page.goto(
        `${this.siteUrl}/job/managejob/express/create/write?draftid=${draftId}`,
        { waitUntil: "domcontentloaded", timeout: 30000 },
      );
      await page.waitForTimeout(8000);

      const result = await this.doFillWrite(page, jd);
      await context.close();
      return result;
    } finally {
      if (browser) await browser.close();
    }
  }

  /**
   * Step 3: manage-applications → preview → 最终发布
   * 需要 draftId 来导航到正确的 draft
   */
  async fillManageAndPost(draftId: string): Promise<JobPostingResult> {
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

      // 导航到 draft 的 manage 步骤
      await page.goto(
        `${this.siteUrl}/job/managejob/express/create/manage?draftid=${draftId}`,
        { waitUntil: "domcontentloaded", timeout: 30000 },
      );
      await page.waitForTimeout(8000);

      const result = await this.doManageAndPost(page);
      await context.close();
      return result;
    } finally {
      if (browser) await browser.close();
    }
  }

  // ── 内部实现方法 ──

  /**
   * 填写 Classify 步骤并点击 Continue，返回 draftId 和截图
   */
  private async doFillClassify(page: Page, jd: GeneratedJD): Promise<{ draftId?: string; screenshot: string }> {
    // === Step 1: Classify ===
    await page.goto(`${this.siteUrl}/job/managejob/express/create?referrer=createJob`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(8000);

    logger.info("JobStreet: Step 1 loaded", { url: page.url() });

    await page.waitForSelector("#JobTitleTextField", { timeout: 15000 }).catch(() => {});

    // 填写职位标题
    const titleInput = page.locator("#JobTitleTextField");
    if (await titleInput.isVisible()) {
      await titleInput.click();
      await titleInput.fill(jd.title);
      await page.waitForTimeout(1500);
      const suggestion = page.locator('[role="option"]').first();
      if (await suggestion.isVisible().catch(() => false)) {
        await suggestion.click();
        await page.waitForTimeout(500);
      } else {
        await titleInput.press("Enter");
        await page.waitForTimeout(500);
      }
    }

    // 填写地点
    const locationInput = page.locator("#JobLocation");
    if (await locationInput.isVisible()) {
      await locationInput.click();
      await locationInput.fill("");
      await page.waitForTimeout(300);
      await locationInput.pressSequentially(jd.location || "Kuala Lumpur", { delay: 100 });
      await page.waitForTimeout(3000);
      const locSuggestion = page.locator('[role="option"]').first();
      if (await locSuggestion.isVisible().catch(() => false)) {
        await locSuggestion.click();
        await page.waitForTimeout(1000);
      } else {
        await locationInput.fill("");
        await page.waitForTimeout(300);
        await locationInput.pressSequentially("Kuala Lumpur", { delay: 150 });
        await page.waitForTimeout(3000);
        const retry = page.locator('[role="option"]').first();
        if (await retry.isVisible().catch(() => false)) {
          await retry.click();
          await page.waitForTimeout(1000);
        }
      }
    }

    // 选择工作类型
    const jobTypeMap: Record<string, string> = {
      full_time: "Full-time",
      part_time: "Part-time",
      contract: "Contract",
    };
    const jobTypeText = jobTypeMap[jd.jobType] || "Full-time";
    const jobTypeBtn = page.locator(`button:has-text("${jobTypeText}")`);
    if (await jobTypeBtn.isVisible().catch(() => false)) {
      await jobTypeBtn.click();
      await page.waitForTimeout(500);
    }

    // 选择薪资频率 — Monthly
    const monthlyBtn = page.locator('button:has-text("Monthly")');
    if (await monthlyBtn.isVisible().catch(() => false)) {
      await monthlyBtn.click();
      await page.waitForTimeout(500);
    }

    // 填写薪资
    if (jd.salaryRange) {
      const salaryNum = jd.salaryRange.replace(/[^\d]/g, "");
      const minInput = page.locator("#minSalary");
      const maxInput = page.locator("#maxSalary");
      if (await minInput.isVisible()) await minInput.fill(salaryNum);
      if (await maxInput.isVisible()) {
        const maxVal = String(Math.round(Number(salaryNum) * 1.2));
        await maxInput.fill(maxVal);
      }
    }

    // 截图 Step 1
    const screenshotPath = "./jobstreet-posting-step1.png";
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info("JobStreet: Step 1 filled, clicking Continue");

    // 拦截网络响应，捕获 draft ID（GraphQL CreateDraftJob mutation）
    let capturedDraftId: string | undefined;
    const responseHandler = async (response: import("playwright").Response) => {
      try {
        const url = response.url();
        if (!url.includes("graphql") && !url.includes("api") && !url.includes("draft") && !url.includes("job")) return;
        const contentType = response.headers()["content-type"] || "";
        if (!contentType.includes("json")) return;
        const text = await response.text().catch(() => "");
        // 尝试多种 ID 字段名
        const patterns = [
          /"draftId"\s*:\s*"?(\d+)"?/i,
          /"draftJobId"\s*:\s*"?(\d+)"?/i,
          /"draft_id"\s*:\s*"?(\d+)"?/i,
          /"jobId"\s*:\s*"?(\d+)"?/i,
          /"job_id"\s*:\s*"?(\d+)"?/i,
          /"id"\s*:\s*(\d{6,})/,  // 6+ digit ID to avoid matching small IDs
        ];
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match) {
            capturedDraftId = match[1];
            logger.info("JobStreet: captured draft ID from response", { draftId: capturedDraftId, url });
            break;
          }
        }
      } catch { /* ignore */ }
    };
    page.on("response", responseHandler);

    // 点击 Continue
    await page.evaluate(() => {
      const btn = document.querySelector("#next-page-button") as HTMLButtonElement;
      if (btn) btn.click();
    });
    await page.waitForTimeout(8000);

    // 停止拦截
    page.off("response", responseHandler);

    const afterUrl = page.url();
    logger.info("JobStreet: after Step 1 Continue", { url: afterUrl, capturedDraftId });

    // 处理 select-ad-type 步骤（如果出现）
    if (afterUrl.includes("select-ad-type")) {
      // 重新开启拦截（ad-type 步骤也可能返回 draft ID）
      page.on("response", responseHandler);

      const freeBtn = page.locator('button:has-text("Post for free"), a:has-text("Post for free")').first();
      if (await freeBtn.isVisible().catch(() => false)) {
        await freeBtn.click();
        await page.waitForTimeout(3000);
        logger.info("JobStreet: selected 'Post for free'");
      }
      await page.evaluate(() => {
        const btn = document.querySelector("#next-page-button") as HTMLButtonElement;
        if (btn) btn.click();
      });
      await page.waitForTimeout(8000);

      page.off("response", responseHandler);
    }

    // 从 URL 提取 draftId（多种参数名）
    const currentUrl = page.url();
    const urlDraftId = extractIdFromUrl(currentUrl);

    // 也尝试从页面 JS 状态提取
    const pageDraftId = await page.evaluate(() => {
      try {
        // Next.js / React state
        const nextData = (window as unknown as Record<string, unknown>).__NEXT_DATA__ as Record<string, unknown> | undefined;
        if (nextData?.props) {
          const json = JSON.stringify(nextData.props);
          const m = json.match(/"draftId"\s*:\s*"?(\d+)"?/i)
            || json.match(/"jobId"\s*:\s*"?(\d+)"?/i)
            || json.match(/"draftJobId"\s*:\s*"?(\d+)"?/i);
          if (m) return m[1];
        }
        // 也检查 URL hash
        const hash = window.location.hash;
        const hm = hash.match(/(\d{6,})/);
        if (hm) return hm[1];
      } catch { /* ignore */ }
      return null;
    }).catch(() => null);

    const draftId = urlDraftId || capturedDraftId || pageDraftId || undefined;
    logger.info("JobStreet: classify done", { draftId, urlDraftId, capturedDraftId, pageDraftId, url: currentUrl });

    return { draftId, screenshot: screenshotPath };
  }

  // PLACEHOLDER_FILL_WRITE

  /**
   * 填写 Write Ad 步骤（职位描述、摘要、卖点），点击 Continue
   */
  private async doFillWrite(page: Page, jd: GeneratedJD): Promise<{ screenshot: string }> {
    await page.waitForTimeout(3000);

    // 填写富文本编辑器（职位描述）
    const descEditor = page.locator('[contenteditable="true"]').first();
    if (await descEditor.isVisible().catch(() => false)) {
      await descEditor.click();
      const plainDesc = jd.description.replace(/<[^>]+>/g, "");
      await descEditor.fill(plainDesc);
      await page.waitForTimeout(1000);
    }

    // 填写职位摘要
    const summaryArea = page.locator("#JobSummaryTextarea");
    if (await summaryArea.isVisible().catch(() => false)) {
      const summary = jd.requirements.slice(0, 3).join(". ") + ".";
      await summaryArea.fill(summary);
      await page.waitForTimeout(500);
    }

    // 填写关键卖点
    const sellingPoints = [
      jd.benefits[0] || "Competitive salary package",
      jd.benefits[1] || "Career growth opportunities",
      "Friendly and dynamic work environment",
    ];
    for (let i = 0; i < 3; i++) {
      const spInput = page.locator(`#keySellingPoint${i + 1}`);
      if (await spInput.isVisible().catch(() => false)) {
        await spInput.fill(sellingPoints[i]);
        await page.waitForTimeout(300);
      }
    }

    const screenshotPath = "./jobstreet-posting-write-ad.png";
    await page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info("JobStreet: Write Ad step filled");

    // 点击 Continue
    await page.evaluate(() => {
      const btn = document.querySelector("#next-page-button") as HTMLButtonElement;
      if (btn) btn.click();
    });
    await page.waitForTimeout(8000);

    return { screenshot: screenshotPath };
  }

  // PLACEHOLDER_MANAGE_AND_POST

  /**
   * manage-applications → preview → 最终发布
   */
  private async doManageAndPost(page: Page): Promise<JobPostingResult> {
    const currentUrl = page.url();
    await page.screenshot({ path: "./jobstreet-posting-final.png", fullPage: true });
    logger.info("JobStreet: final step", { url: currentUrl });

    // manage 步骤（筛选问题）
    if (currentUrl.includes("manage")) {
      await page.waitForTimeout(5000);

      // 选择所有未选中的必填 radio 按钮
      await page.evaluate(() => {
        const radioGroups = new Map<string, HTMLInputElement[]>();
        document.querySelectorAll('input[type="radio"]').forEach((el) => {
          const radio = el as HTMLInputElement;
          if (!radioGroups.has(radio.name)) radioGroups.set(radio.name, []);
          radioGroups.get(radio.name)!.push(radio);
        });
        for (const [, radios] of radioGroups) {
          const hasChecked = radios.some((r) => r.checked);
          if (!hasChecked && radios.length > 0) {
            radios[0].click();
          }
        }
      });
      await page.waitForTimeout(1000);

      // 点击 Continue
      const manageContinue = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
        for (const btn of buttons) {
          const text = (btn.textContent || "").replace(/[\u200B-\u200D\uFEFF\u2060]/g, "").trim();
          if (text === "Continue") {
            (btn as HTMLButtonElement).click();
            return "clicked-continue";
          }
        }
        const nextBtn = document.querySelector("#next-page-button") as HTMLButtonElement;
        if (nextBtn) {
          nextBtn.click();
          return "clicked-next-page";
        }
        return "no-button-found";
      });
      logger.info("JobStreet: manage page click result", { result: manageContinue });
      await page.waitForTimeout(8000);

      const afterManageUrl = page.url();
      logger.info("JobStreet: after manage step", { url: afterManageUrl });
      await page.screenshot({ path: "./jobstreet-posting-preview.png", fullPage: true });

      // pay-and-post / preview 步骤
      if (afterManageUrl.includes("pay") || afterManageUrl.includes("preview") || afterManageUrl.includes("confirm") || afterManageUrl.includes("post")) {
        return this.doFinalPost(page, afterManageUrl);
      }
    }

    // 直接在 preview/confirm 页面
    if (currentUrl.includes("preview") || currentUrl.includes("confirm") || currentUrl.includes("payment") || currentUrl.includes("pay")) {
      return this.doFinalPost(page, currentUrl);
    }

    return {
      platform: this.platformName,
      status: "draft",
      jobUrl: currentUrl,
      error: `UI 自动化进行到 ${currentUrl}，可能需要手动完成后续步骤`,
    };
  }

  // PLACEHOLDER_FINAL_POST

  /**
   * 点击最终发布按钮
   */
  private async doFinalPost(page: Page, pageUrl: string): Promise<JobPostingResult> {
    await page.waitForTimeout(5000);

    const allBtnTexts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("button, [role='button'], a")).map((el) =>
        (el.textContent || "").replace(/[\u200B-\u200D\uFEFF\u2060]/g, "").replace(/\s+/g, " ").trim().slice(0, 80)
      ).filter(Boolean);
    });
    logger.debug("JobStreet: pay-and-post buttons", { buttons: allBtnTexts });

    const posted = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button, [role='button'], a"));
      const targets = ["post my ad", "post job", "post for free", "post ad", "confirm and post", "confirm", "submit", "place order"];
      for (const btn of buttons) {
        const text = (btn.textContent || "").replace(/[\u200B-\u200D\uFEFF\u2060]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
        for (const target of targets) {
          if (text.includes(target)) {
            (btn as HTMLButtonElement).click();
            return `clicked: ${text}`;
          }
        }
      }
      const submitBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (submitBtn) {
        const text = (submitBtn.textContent || "").trim();
        submitBtn.click();
        return `clicked-submit: ${text}`;
      }
      return "no-post-button";
    });
    logger.info("JobStreet: pay-and-post click", { result: posted });
    await page.waitForTimeout(10000);

    const successUrl = page.url();
    logger.info("JobStreet: after submit", { url: successUrl });
    await page.screenshot({ path: "./jobstreet-posting-success.png", fullPage: true });

    if (successUrl.includes("complete") || successUrl.includes("success") || successUrl.includes("confirmation") || successUrl.includes("dashboard") || successUrl.includes("posted")) {
      const jobIdMatch = successUrl.match(/postedjobid=(\d+)/);
      const jobId = jobIdMatch ? jobIdMatch[1] : undefined;
      return {
        platform: this.platformName,
        status: "posted",
        jobId,
        jobUrl: jobId ? `${this.siteUrl}/job/${jobId}` : successUrl,
        postedAt: new Date().toISOString(),
      };
    }

    return {
      platform: this.platformName,
      status: "draft",
      jobUrl: pageUrl,
      error: "已到支付/发布步骤，请手动确认",
    };
  }

  // PLACEHOLDER_AUTH_METHODS

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
      await page.goto(`${this.siteUrl}/`, {
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
