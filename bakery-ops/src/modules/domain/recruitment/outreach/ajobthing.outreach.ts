import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import type { OutreachConnector, OutreachMessage } from "./outreach.interface";
import type { ScoredCandidate, ParsedJD, OutreachBatchResult, OutreachResult } from "../types";
import { logger } from "../../../shared/logger";
import { hasValidSession, getCookieFile, getStorageFile } from "../connectors/ajobthing-login";

// AJobThing 雇主账号信息
const EMPLOYER_COMPANY_ID = "196036";
const EMPLOYER_USER_ID = "5630750";
const EMPLOYER_NAME = "Yuns & Hot Crush Sdn. Bhd.";
const EMPLOYER_LOGO = "https://files.ajobthing.com/employers/196036-1764931811.png";

/**
 * AJobThing 自动触达 — 通过 Stream Chat API 发送消息
 * 不消耗积分，使用平台内聊天功能
 *
 * API 发现自 /chat 页面的 Nuxt SPA (EDHqNICO.js):
 * - channel_id 格式: chat-comp-{company_id}-js-{jobseeker_id}
 * - 创建频道 + 发消息可以一步完成
 * - member id 格式: employer = company_id, jobseeker = "js_{id}"
 */
export class AJobThingOutreach implements OutreachConnector {
  readonly platformName = "AJobThing";
  private readonly siteUrl = "https://www.ajobthing.com";

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

      for (const candidate of candidates) {
        try {
          const candidateId = this.getCandidateId(candidate);
          if (!candidateId) {
            results.push({
              candidateId: candidate.candidateId,
              candidateName: candidate.name,
              platform: this.platformName,
              status: "skipped",
              error: "缺少候选人 ID (rawData.encoded_id 或 rawData.id)",
            });
            continue;
          }

          const body = this.renderMessage(message.body, candidate, jd);

          // 创建频道 + 发送消息（一步完成）
          const sendResult = await this.createChannelAndSend(
            page, candidateId, candidate.name, body,
          );
          if (sendResult.success) {
            results.push({
              candidateId: candidate.candidateId,
              candidateName: candidate.name,
              platform: this.platformName,
              status: "sent",
              sentAt: new Date().toISOString(),
            });
            logger.info("AJobThing outreach: message sent", {
              name: candidate.name,
              channelId: sendResult.channelId,
            });
          } else {
            results.push({
              candidateId: candidate.candidateId,
              candidateName: candidate.name,
              platform: this.platformName,
              status: "failed",
              error: sendResult.error || "发送失败",
            });
          }

          // 间隔 1-2 秒避免频率限制
          await page.waitForTimeout(1000 + Math.random() * 1000);
        } catch (err) {
          results.push({
            candidateId: candidate.candidateId,
            candidateName: candidate.name,
            platform: this.platformName,
            status: "failed",
            error: String(err),
          });
          logger.error("AJobThing outreach: failed", { name: candidate.name, error: String(err) });
        }
      }

      await context.close();
    } catch (err) {
      logger.error("AJobThing outreach: fatal error", { error: String(err) });
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

  async getRemainingBudget(): Promise<number | null> {
    return null;
  }

  /**
   * 生成 channel_id: chat-comp-{companyId}-js-{jobseekerId}
   */
  private generateChannelId(jobseekerId: string): string {
    return `chat-comp-${EMPLOYER_COMPANY_ID}-js-${jobseekerId}`;
  }

  /**
   * 创建频道并发送消息（单次 API 调用）
   */
  private async createChannelAndSend(
    page: Page,
    jobseekerId: string,
    candidateName: string,
    messageText: string,
  ): Promise<{ success: boolean; channelId?: string; error?: string }> {
    try {
      const channelId = this.generateChannelId(jobseekerId);

      const result = await page.evaluate(
        async ({ channelId, companyId, companyName, companyLogo, userId, jsId, candidateName, messageText }) => {
          const res = await fetch("/api/stream-chat/chat/create", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
            },
            body: JSON.stringify({
              channel_id: channelId,
              members: [
                {
                  id: companyId,
                  name: companyName,
                  role: "employer",
                  image: companyLogo,
                },
                {
                  id: `js_${jsId}`,
                  name: candidateName,
                  role: "jobseeker",
                  image: `https://getstream.io/random_png/?name=${candidateName}`,
                },
              ],
              meta: { employer_user_id: userId },
              source: { name: "candidate_search", meta: {} },
              message: {
                channel_id: channelId,
                user_id: companyId,
                text: messageText,
              },
            }),
          });
          return { status: res.status, body: await res.text() };
        },
        {
          channelId,
          companyId: EMPLOYER_COMPANY_ID,
          companyName: EMPLOYER_NAME,
          companyLogo: EMPLOYER_LOGO,
          userId: EMPLOYER_USER_ID,
          jsId: jobseekerId,
          candidateName,
          messageText,
        },
      );

      if (result.status === 200 || result.status === 201) {
        return { success: true, channelId };
      }

      logger.error("AJobThing: createChannelAndSend failed", {
        status: result.status,
        body: result.body.slice(0, 300),
      });
      return { success: false, error: `HTTP ${result.status}: ${result.body.slice(0, 200)}` };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  private getCandidateId(candidate: ScoredCandidate): string | null {
    const raw = candidate.rawData;
    if (!raw) return null;
    if (raw.encoded_id) return String(raw.encoded_id);
    if (raw.id) return String(raw.id);
    return null;
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
      // 导航到 /chat 页面（API 调用需要在此页面上下文中执行）
      await page.goto(`${this.siteUrl}/chat`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.waitForTimeout(3000);
      const url = page.url();
      return !url.includes("login") && !url.includes("auth") && !url.includes("register");
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
