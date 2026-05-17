import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import * as fs from "fs";
import type { NotificationChecker } from "./notification-checker.interface";
import type { RecruitmentNotification } from "./notification.types";
import { loadNotificationState, saveNotificationState } from "./notification-state";
import { logger } from "../../../shared/logger";
import { hasValidSession, getCookieFile, getStorageFile, refreshLogin } from "../connectors/ajobthing-login";

const EMPLOYER_COMPANY_ID = "196036";
const STREAM_CHAT_API_KEY = "vh9sqajrjfe2";

/**
 * AJobThing 通知检查器
 *
 * 检查两个来源：
 * 1. 新投递：POST /api/employer/whats-new/latest
 * 2. 消息回复：Stream Chat 轮询（chat-comp-{companyId}-js-* 频道的新消息）
 */
export class AJobThingNotificationChecker implements NotificationChecker {
  readonly platformName = "AJobThing";
  private readonly siteUrl = "https://www.ajobthing.com";

  async checkNewNotifications(): Promise<RecruitmentNotification[]> {
    if (!hasValidSession()) {
      logger.debug("AJobThing notifications: no valid session");
      return [];
    }

    let browser: Browser | null = null;
    const notifications: RecruitmentNotification[] = [];

    try {
      browser = await chromium.launch({ headless: true });
      const context = await this.createAuthContext(browser);
      const page = await context.newPage();

      if (!(await this.verifyCookies(page))) {
        logger.warn("AJobThing notifications: cookies expired, trying auto-refresh...");
        await refreshLogin();
        return [];
      }

      const state = loadNotificationState();

      // 1. 检查新投递
      const applicants = await this.checkNewApplicants(page, state.ajtLastNotificationId);
      notifications.push(...applicants);

      // 2. 检查消息回复
      const replies = await this.checkNewMessages(page, state.ajtLastMessageTimestamp);
      notifications.push(...replies);

      // 更新 state — 存储原始 id（不带前缀）
      if (applicants.length > 0) {
        // id 格式: ajt-notif-{原始id}，提取原始 id
        const rawId = applicants[0].id.replace("ajt-notif-", "");
        state.ajtLastNotificationId = rawId;
      }
      if (replies.length > 0) {
        state.ajtLastMessageTimestamp = replies[0].timestamp;
      }
      saveNotificationState(state);

      await context.close();
    } catch (err) {
      logger.error("AJobThing notification check failed", { error: String(err) });
    } finally {
      if (browser) await browser.close();
    }

    return notifications;
  }

  /**
   * 检查新通知 — GET /api/employer/whats-new/latest
   *
   * 响应格式（已通过 discovery 确认）:
   * [{ id, notify_type, notify_category, message, job_id, applicant_id, created_at, is_read }]
   */
  private async checkNewApplicants(page: Page, lastId?: string): Promise<RecruitmentNotification[]> {
    try {
      const result = await page.evaluate(async () => {
        const res = await fetch("/api/employer/whats-new/latest", {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        return { status: res.status, body: await res.text() };
      });

      if (result.status !== 200) return [];

      const items = JSON.parse(result.body);
      if (!Array.isArray(items)) return [];

      const notifications: RecruitmentNotification[] = [];
      for (const item of items) {
        const id = String(item.id || "");
        if (!id) continue;
        if (lastId && Number(id) <= Number(lastId)) break;
        // 跳过已读通知
        if (item.is_read === "yes") continue;

        // 从 notify_category 提取类型和信息
        const category = item.notify_category || "";
        const isQuestion = category.includes("Question");
        const isApplicant = category.includes("Applicant") || category.includes("Applied");
        const isDraft = category.includes("Draft");

        // 跳过草稿通知
        if (isDraft) continue;

        // 从 category 提取职位名称
        const jobMatch = category.match(/job\s*:\s*(.+)$/i);
        const jobTitle = jobMatch ? jobMatch[1].trim() : undefined;

        notifications.push({
          id: `ajt-notif-${id}`,
          type: isApplicant ? "new_applicant" : "candidate_reply",
          platform: this.platformName,
          candidateName: isQuestion ? "求职者提问" : "新申请人",
          jobTitle,
          message: category.slice(0, 100),
          timestamp: item.created_at || new Date().toISOString(),
          sourceUrl: item.message?.match(/href\s*=\s*"([^"]+)"/)?.[1]
            ? `${this.siteUrl}${item.message.match(/href\s*=\s*"([^"]+)"/)[1]}`
            : `${this.siteUrl}/dashboard`,
        });
      }

      return notifications;
    } catch (err) {
      logger.error("AJobThing: checkNewApplicants failed", { error: String(err) });
      return [];
    }
  }

  /**
   * 检查 Stream Chat 新消息
   * 使用 POST /api/stream-chat/chat/unread-count 检查未读数
   * 然后导航到 /chat 获取具体消息
   */
  private async checkNewMessages(page: Page, lastTimestamp?: string): Promise<RecruitmentNotification[]> {
    try {
      // 先检查是否有未读消息
      const unreadResult = await page.evaluate(
        async (companyId) => {
          try {
            const res = await fetch("/api/stream-chat/chat/unread-count", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ user_id: companyId }),
            });
            return { status: res.status, body: await res.text() };
          } catch (err) {
            return { status: 0, body: String(err) };
          }
        },
        EMPLOYER_COMPANY_ID,
      );

      if (unreadResult.status !== 200) return [];

      const unreadData = JSON.parse(unreadResult.body);
      const totalUnread = unreadData?.data?.unreadCount?.totalUnreadCount || 0;

      if (totalUnread === 0) return [];

      // 有未读消息，导航到 /chat 获取详情
      await page.goto(`${this.siteUrl}/chat`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(3000);

      // 通过页面内 API 查询最近消息
      const result = await page.evaluate(
        async ({ companyId }) => {
          try {
            const res = await fetch("/api/stream-chat/channels", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({
                filter: { id: { $regex: `chat-comp-${companyId}-js-` } },
                sort: [{ field: "last_message_at", direction: -1 }],
                limit: 10,
              }),
            });
            return { status: res.status, body: await res.text() };
          } catch (err) {
            return { status: 0, body: String(err) };
          }
        },
        { companyId: EMPLOYER_COMPANY_ID },
      );

      if (result.status !== 200) return [];

      const data = JSON.parse(result.body);
      const channels = data.channels || data.data || [];

      const notifications: RecruitmentNotification[] = [];
      const cutoff = lastTimestamp ? new Date(lastTimestamp) : new Date(Date.now() - 15 * 60 * 1000);

      for (const ch of channels) {
        const lastMsg = ch.last_message || ch.messages?.[ch.messages.length - 1];
        if (!lastMsg) continue;

        const msgTime = new Date(lastMsg.created_at || lastMsg.timestamp);
        if (msgTime <= cutoff) continue;

        // 只关注求职者发的消息（不是雇主自己发的）
        const senderId = lastMsg.user?.id || lastMsg.user_id || "";
        if (senderId === EMPLOYER_COMPANY_ID) continue;

        notifications.push({
          id: `ajt-msg-${lastMsg.id || ch.id}`,
          type: "candidate_reply",
          platform: this.platformName,
          candidateName: lastMsg.user?.name || senderId,
          message: (lastMsg.text || "").slice(0, 100),
          timestamp: lastMsg.created_at || new Date().toISOString(),
          sourceUrl: `${this.siteUrl}/chat`,
        });
      }

      return notifications;
    } catch (err) {
      logger.error("AJobThing: checkNewMessages failed", { error: String(err) });
      return [];
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
