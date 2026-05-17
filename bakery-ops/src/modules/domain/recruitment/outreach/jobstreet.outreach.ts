import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import type { OutreachConnector, OutreachMessage } from "./outreach.interface";
import type { ScoredCandidate, ParsedJD, OutreachBatchResult, OutreachResult } from "../types";
import { logger } from "../../../shared/logger";
import { hasValidSession, getCookieFile, getStorageFile } from "../connectors/jobstreet-login";

/**
 * JobStreet 自动触达 — 优先 GraphQL API，回退 UI 自动化
 * 每月 10 个免费 connection，每发一条消耗 1 个
 */
export class JobStreetOutreach implements OutreachConnector {
  readonly platformName = "JobStreet";
  private readonly siteUrl = "https://my.employer.seek.com";

  // 捕获到的完整 mutation（用于 GraphQL 直接调用）
  private static readonly SEND_MESSAGE_MUTATION = `
    mutation InitiateTalentSearchSendMessage($input: InitiateSendMessageV2Input!) {
      initiateSendMessage(input: $input) {
        ... on InitiateConnectionSuccessResponse {
          connectionId
          __typename
        }
        ... on InitiateConnectionErrorResponse {
          error
          __typename
        }
        __typename
      }
    }
  `;

  // 默认签名信息
  private static readonly ADVERTISER = {
    firstName: "HR",
    lastName: "Team",
    title: "HR Manager",
    email: "hotcrushmalaysia@gmail.com",
    phone: `+${process.env.OWNER_PHONE || "601162351961"}`,
  };

  async sendMessages(
    candidates: ScoredCandidate[],
    jd: ParsedJD,
    message: OutreachMessage,
  ): Promise<OutreachBatchResult> {
    const results: OutreachResult[] = [];
    let browser: Browser | null = null;

    try {
      if (!hasValidSession()) {
        return this.allSkipped(candidates, "未找到登录 Cookie");
      }

      browser = await chromium.launch({ headless: true });
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        return this.allSkipped(candidates, "Cookie 已过期");
      }

      // 检查预算
      const budget = await this.getRemainingBudgetFromPage(page);
      logger.info("JobStreet outreach: remaining budget", { budget });

      let budgetUsed = 0;

      for (const candidate of candidates) {
        try {
          if (budget !== null && budgetUsed >= budget) {
            results.push({
              candidateId: candidate.candidateId,
              candidateName: candidate.name,
              platform: this.platformName,
              status: "budget_exceeded",
              error: `月度 connection 已用完 (${budget})`,
            });
            continue;
          }

          const profileGuid = candidate.rawData?.profileGuid as string | undefined;
          const profileId = candidate.rawData?.profileId as string | undefined;
          if (!profileGuid && !profileId) {
            results.push({
              candidateId: candidate.candidateId,
              candidateName: candidate.name,
              platform: this.platformName,
              status: "skipped",
              error: "缺少 profileGuid 和 profileId",
            });
            continue;
          }

          const body = this.renderMessage(message.body, candidate, jd);
          const subject = this.renderMessage(message.subject, candidate, jd);

          // 优先尝试 GraphQL 直接调用（需要 profileId）
          if (profileId) {
            const graphqlResult = await this.sendViaGraphQL(page, profileId, subject, body);
            if (graphqlResult.success) {
              budgetUsed++;
              results.push({
                candidateId: candidate.candidateId,
                candidateName: candidate.name,
                platform: this.platformName,
                status: "sent",
                sentAt: new Date().toISOString(),
              });
              logger.info("JobStreet outreach: sent via GraphQL", { name: candidate.name });
              await page.waitForTimeout(1000 + Math.random() * 1000);
              continue;
            }
            logger.warn("JobStreet outreach: GraphQL failed, falling back to UI", {
              name: candidate.name,
              error: graphqlResult.error,
            });
          }

          // 回退到 UI 自动化
          if (!profileGuid) {
            results.push({
              candidateId: candidate.candidateId,
              candidateName: candidate.name,
              platform: this.platformName,
              status: "failed",
              error: "GraphQL 失败且缺少 profileGuid 无法回退 UI",
            });
            continue;
          }

          const uiResult = await this.sendViaUI(page, candidate, profileGuid, subject, body);
          if (uiResult.success) budgetUsed++;
          results.push({
            candidateId: candidate.candidateId,
            candidateName: candidate.name,
            platform: this.platformName,
            status: uiResult.success ? "sent" : "failed",
            sentAt: uiResult.success ? new Date().toISOString() : undefined,
            error: uiResult.error,
          });

          await page.waitForTimeout(2000 + Math.random() * 2000);
        } catch (err) {
          results.push({
            candidateId: candidate.candidateId,
            candidateName: candidate.name,
            platform: this.platformName,
            status: "failed",
            error: String(err),
          });
          logger.error("JobStreet outreach: failed", { name: candidate.name, error: String(err) });
        }
      }

      await context.close();
    } catch (err) {
      logger.error("JobStreet outreach: fatal error", { error: String(err) });
      for (const c of candidates) {
        if (!results.find((r) => r.candidateId === c.candidateId)) {
          results.push({
            candidateId: c.candidateId,
            candidateName: c.name,
            platform: this.platformName,
            status: "failed",
            error: String(err),
          });
        }
      }
    } finally {
      if (browser) await browser.close();
    }

    return this.buildBatchResult(results);
  }
  /**
   * GraphQL 直接调用发送消息（快速，~1秒/条）
   */
  private async sendViaGraphQL(
    page: Page,
    profileId: string,
    subject: string,
    body: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const adv = JobStreetOutreach.ADVERTISER;
      const result = await page.evaluate(
        async ({ mutation, input }) => {
          const res = await fetch("/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: mutation, variables: { input } }),
          });
          return { status: res.status, body: await res.text() };
        },
        {
          mutation: JobStreetOutreach.SEND_MESSAGE_MUTATION,
          input: {
            advertiserEmail: adv.email,
            advertiserFirstName: adv.firstName,
            advertiserLastName: adv.lastName,
            advertiserTitle: adv.title,
            advertiserPhone: adv.phone,
            body,
            subject,
            origin: "UNCOUPLED_SEARCH",
            searchType: "UNCOUPLED",
            profileId,
          },
        },
      );

      if (result.status !== 200) {
        return { success: false, error: `HTTP ${result.status}: ${result.body.slice(0, 200)}` };
      }

      const parsed = JSON.parse(result.body);
      const response = parsed?.data?.initiateSendMessage;

      if (response?.__typename === "InitiateConnectionErrorResponse") {
        return { success: false, error: `GraphQL error: ${response.error}` };
      }

      if (response?.connectionId || response?.__typename === "InitiateConnectionSuccessResponse") {
        logger.info("JobStreet GraphQL: message sent", { profileId, connectionId: response.connectionId });
        return { success: true };
      }

      // 检查 GraphQL errors
      if (parsed?.errors?.length > 0) {
        return { success: false, error: parsed.errors[0].message };
      }

      return { success: false, error: `Unexpected response: ${result.body.slice(0, 200)}` };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * UI 自动化发送消息（慢，~10秒/条，作为 GraphQL 的 fallback）
   */
  private async sendViaUI(
    page: Page,
    candidate: ScoredCandidate,
    profileGuid: string,
    subject: string,
    body: string,
  ): Promise<{ success: boolean; error?: string }> {
    const serviceToken = candidate.rawData?.serviceToken as string | undefined;
    const profileUrl =
      `${this.siteUrl}/talentsearch/profiles/${profileGuid}` +
      `?market=MY${serviceToken ? `&serviceToken=${serviceToken}` : ""}`;
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    const sendBtn = page.locator('button:has-text("Send message")').first();
    if (!(await sendBtn.isVisible().catch(() => false))) {
      return { success: false, error: "Send message 按钮不可见" };
    }

    await sendBtn.click();
    await page.waitForTimeout(3000);

    const dialog = page.locator('[role="dialog"], [role="presentation"]').first();
    if (!(await dialog.isVisible().catch(() => false))) {
      return { success: false, error: "对话框未出现" };
    }

    // 按位置填写字段
    const allInputs = dialog.locator("input:visible");
    const inputCount = await allInputs.count();
    const adv = JobStreetOutreach.ADVERTISER;
    const inputValues = [subject, adv.firstName, adv.lastName, adv.title, adv.email, adv.phone];

    for (let idx = 0; idx < Math.min(inputCount, inputValues.length); idx++) {
      const inp = allInputs.nth(idx);
      if (!(await inp.inputValue().catch(() => ""))) {
        await inp.fill(inputValues[idx]);
      }
    }

    const textarea = dialog.locator("textarea:visible").first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill(body);
    }

    await page.waitForTimeout(500);

    // 找 Send 按钮并点击
    const dialogButtons = dialog.locator("button");
    const btnCount = await dialogButtons.count();
    for (let bi = btnCount - 1; bi >= 0; bi--) {
      const btn = dialogButtons.nth(bi);
      const btnText = ((await btn.textContent().catch(() => "")) || "").trim();
      if (btnText === "Send" || btnText === "Send message") {
        await btn.scrollIntoViewIfNeeded();
        await btn.click({ force: true });
        break;
      }
    }

    await page.waitForTimeout(5000);

    const dialogStillVisible = await dialog.isVisible().catch(() => false);
    if (!dialogStillVisible) {
      logger.info("JobStreet UI: message sent", { name: candidate.name });
      return { success: true };
    }

    return { success: false, error: "发送后对话框未关闭" };
  }

  async getRemainingBudget(): Promise<number | null> {
    let browser: Browser | null = null;
    try {
      if (!hasValidSession()) return null;
      browser = await chromium.launch({ headless: true });
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();
      if (!(await this.verifyCookies(page))) return null;
      const budget = await this.getRemainingBudgetFromPage(page);
      await context.close();
      return budget;
    } catch {
      return null;
    } finally {
      if (browser) await browser.close();
    }
  }

  private async getRemainingBudgetFromPage(page: Page): Promise<number | null> {
    try {
      // 通过 GraphQL 查询 GetAccountBalance
      const result = await page.evaluate(async () => {
        const res = await fetch("/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `query GetAccountBalance { accountBalance { balance } }`,
          }),
        });
        return res.text();
      });
      const parsed = JSON.parse(result);
      const balance = parsed?.data?.accountBalance?.balance;
      return typeof balance === "number" ? balance : null;
    } catch (err) {
      logger.error("JobStreet: getRemainingBudget error", { error: String(err) });
      return null;
    }
  }

  private renderMessage(template: string, candidate: ScoredCandidate, jd: ParsedJD): string {
    return template
      .replace(/\{candidateName\}/g, candidate.name)
      .replace(/\{jobTitle\}/g, jd.jobTitle)
      .replace(/\{location\}/g, jd.location)
      .replace(/\{companyName\}/g, "our company");
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
      await page.waitForTimeout(2000);
      const url = page.url();
      return !url.includes("login") && !url.includes("oauth") && !url.includes("authenticate");
    } catch {
      return false;
    }
  }

  private allSkipped(candidates: ScoredCandidate[], reason: string): OutreachBatchResult {
    return {
      platform: this.platformName,
      total: candidates.length,
      sent: 0,
      failed: 0,
      results: candidates.map((c) => ({
        candidateId: c.candidateId,
        candidateName: c.name,
        platform: this.platformName,
        status: "skipped" as const,
        error: reason,
      })),
    };
  }

  private buildBatchResult(results: OutreachResult[]): OutreachBatchResult {
    return {
      platform: this.platformName,
      total: results.length,
      sent: results.filter((r) => r.status === "sent").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    };
  }
}
