import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import type { NotificationChecker } from "./notification-checker.interface";
import type { RecruitmentNotification } from "./notification.types";
import { loadNotificationState, saveNotificationState } from "./notification-state";
import { logger } from "../../../shared/logger";
import { hasValidSession, getCookieFile, getStorageFile, refreshLogin } from "../connectors/jobstreet-login";
import { JOBSTREET_BASE_URL } from "../connectors/jobstreet.constants";

/**
 * Feature flag：JobStreet 通知检查是否启用。
 * 默认关闭，因为 query 仍是未验证的占位符（见 class 注释 / 各 query 的 TODO）。
 */
export function jobStreetNotificationsEnabled(): boolean {
  return process.env.JOBSTREET_NOTIFICATIONS_ENABLED === "true";
}

/**
 * JobStreet 通知检查器
 *
 * 通过 GraphQL query 查询：
 * 1. 新 applications（投递）
 * 2. inbox 消息（候选人回复）
 *
 * ⚠️ 默认关闭（feature flag JOBSTREET_NOTIFICATIONS_ENABLED=true 才启用）。
 * 下面 checkNewApplications / checkNewMessages 用的 GraphQL query 名称/字段是
 * 未经验证的占位符，尚未由真实的 live discovery 确认（service-crew 的 Test 阶段
 * 正在跑这套发现）。在确认之前保持关闭，避免每 15 分钟静默报错/产生噪音。
 *
 * TODO: 待 live discovery 确认真实的 applications / messages GraphQL query
 *       （query 名、input 变量、edges 字段）后，替换占位符并把 flag 默认改为开启。
 */
export class JobStreetNotificationChecker implements NotificationChecker {
  readonly platformName = "JobStreet";
  private readonly siteUrl = JOBSTREET_BASE_URL;

  async checkNewNotifications(): Promise<RecruitmentNotification[]> {
    if (!jobStreetNotificationsEnabled()) {
      // 防御性二次守卫：query 未验证前默认关闭，干净 no-op（service 层通常已先跳过）。
      logger.debug("JobStreet notifications: disabled (JOBSTREET_NOTIFICATIONS_ENABLED!=true)");
      return [];
    }

    if (!hasValidSession()) {
      logger.debug("JobStreet notifications: no valid session");
      return [];
    }

    let browser: Browser | null = null;
    const notifications: RecruitmentNotification[] = [];

    try {
      browser = await chromium.launch({ headless: true });
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        logger.warn("JobStreet notifications: cookies expired, trying auto-refresh...");
        await refreshLogin();
        return [];
      }

      const state = loadNotificationState();

      // 1. 检查新投递
      const applicants = await this.checkNewApplications(page, state.jsLastApplicationId);
      notifications.push(...applicants);

      // 2. 检查消息回复
      const replies = await this.checkNewMessages(page, state.jsLastMessageTimestamp);
      notifications.push(...replies);

      // 更新 state
      if (applicants.length > 0) {
        state.jsLastApplicationId = applicants[0].id.replace("js-app-", "");
      }
      if (replies.length > 0) {
        state.jsLastMessageTimestamp = replies[0].timestamp;
      }
      saveNotificationState(state);

      await context.close();
    } catch (err) {
      logger.error("JobStreet notification check failed", { error: String(err) });
    } finally {
      if (browser) await browser.close();
    }

    return notifications;
  }

  /**
   * 查询新投递 — GraphQL query
   * TODO: 此 query（名称/input/edges 字段）是未验证的占位符，必须由真实的 live
   *       discovery 确认后才能开启（JOBSTREET_NOTIFICATIONS_ENABLED=true）。
   */
  private async checkNewApplications(page: Page, lastId?: string): Promise<RecruitmentNotification[]> {
    try {
      const query = `
        query GetApplications($input: ApplicationsInput) {
          applications(input: $input) {
            edges {
              node {
                id
                candidateName
                jobTitle
                appliedAt
                profileUrl
              }
            }
          }
        }
      `;

      const result = await page.evaluate(
        async ({ query }) => {
          const res = await fetch("/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query,
              variables: { input: { limit: 10, sort: "NEWEST" } },
            }),
          });
          return { status: res.status, body: await res.text() };
        },
        { query },
      );

      if (result.status !== 200) return [];

      const data = JSON.parse(result.body);
      const edges = data?.data?.applications?.edges || [];

      const notifications: RecruitmentNotification[] = [];
      for (const edge of edges) {
        const node = edge.node;
        if (!node) continue;
        if (lastId && node.id <= lastId) break;

        notifications.push({
          id: `js-app-${node.id}`,
          type: "new_applicant",
          platform: this.platformName,
          candidateName: node.candidateName || "未知",
          jobTitle: node.jobTitle,
          timestamp: node.appliedAt || new Date().toISOString(),
          sourceUrl: node.profileUrl || `${this.siteUrl}/applications`,
        });
      }

      return notifications;
    } catch (err) {
      logger.error("JobStreet: checkNewApplications failed", { error: String(err) });
      return [];
    }
  }

  /**
   * 查询 inbox 新消息 — GraphQL query
   * TODO: 此 query（名称/input/edges 字段）是未验证的占位符，必须由真实的 live
   *       discovery 确认后才能开启（JOBSTREET_NOTIFICATIONS_ENABLED=true）。
   */
  private async checkNewMessages(page: Page, lastTimestamp?: string): Promise<RecruitmentNotification[]> {
    try {
      const query = `
        query GetMessages($input: MessagesInput) {
          messages(input: $input) {
            edges {
              node {
                id
                senderName
                body
                sentAt
                conversationId
              }
            }
          }
        }
      `;

      const result = await page.evaluate(
        async ({ query }) => {
          const res = await fetch("/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query,
              variables: { input: { limit: 10, sort: "NEWEST" } },
            }),
          });
          return { status: res.status, body: await res.text() };
        },
        { query },
      );

      if (result.status !== 200) return [];

      const data = JSON.parse(result.body);
      const edges = data?.data?.messages?.edges || [];
      const cutoff = lastTimestamp ? new Date(lastTimestamp) : new Date(Date.now() - 15 * 60 * 1000);

      const notifications: RecruitmentNotification[] = [];
      for (const edge of edges) {
        const node = edge.node;
        if (!node) continue;

        const msgTime = new Date(node.sentAt);
        if (msgTime <= cutoff) break;

        notifications.push({
          id: `js-msg-${node.id}`,
          type: "candidate_reply",
          platform: this.platformName,
          candidateName: node.senderName || "未知",
          message: (node.body || "").slice(0, 100),
          timestamp: node.sentAt || new Date().toISOString(),
          sourceUrl: `${this.siteUrl}/messages/${node.conversationId || ""}`,
        });
      }

      return notifications;
    } catch (err) {
      logger.error("JobStreet: checkNewMessages failed", { error: String(err) });
      return [];
    }
  }

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
