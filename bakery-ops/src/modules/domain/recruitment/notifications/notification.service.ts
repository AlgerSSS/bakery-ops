import type { NotificationChecker } from "./notification-checker.interface";
import type { RecruitmentNotification } from "./notification.types";
import { JobStreetNotificationChecker, jobStreetNotificationsEnabled } from "./jobstreet.notifications";
import { loadNotificationState, saveNotificationState } from "./notification-state";
import { notifyInternal } from "../../../channel/internal-notify";
import { logger } from "../../../shared/logger";

const FEEDBACK_WHATSAPP = process.env.OWNER_WHATSAPP || "";

/**
 * 启用的通知检查器。JobStreet 默认关闭（query 未经 live discovery 验证），
 * 仅在 JOBSTREET_NOTIFICATIONS_ENABLED=true 时注册，否则干净跳过。
 */
function activeCheckers(): NotificationChecker[] {
  const list: NotificationChecker[] = [];
  if (jobStreetNotificationsEnabled()) {
    list.push(new JobStreetNotificationChecker());
  } else {
    logger.debug("Notification check: JobStreet checker disabled (JOBSTREET_NOTIFICATIONS_ENABLED!=true), skipping");
  }
  return list;
}

/**
 * 检查所有平台的新通知，去重后通过 WhatsApp 推送
 */
export async function checkAndNotify(): Promise<void> {
  logger.info("Notification check: starting");

  const allNotifications: RecruitmentNotification[] = [];

  for (const checker of activeCheckers()) {
    try {
      const items = await checker.checkNewNotifications();
      allNotifications.push(...items);
      logger.info(`Notification check: ${checker.platformName} returned ${items.length} items`);
    } catch (err) {
      logger.error(`Notification check: ${checker.platformName} failed`, { error: String(err) });
    }
  }

  if (allNotifications.length === 0) {
    logger.info("Notification check: no new notifications");
    return;
  }

  // 按时间排序（最新在前）
  allNotifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // 格式化 WhatsApp 消息
  await sendNotifications(allNotifications);

  // 更新检查时间
  const state = loadNotificationState();
  state.lastCheckedAt = new Date().toISOString();
  saveNotificationState(state);

  logger.info(`Notification check: sent ${allNotifications.length} notifications`);
}

async function sendNotifications(notifications: RecruitmentNotification[]): Promise<void> {
  const lines: string[] = ["*\uD83D\uDD14 招聘通知*", ""];

  for (const n of notifications) {
    const icon = n.type === "new_applicant" ? "\uD83D\uDCE9" : "\uD83D\uDCAC";
    const typeLabel = n.type === "new_applicant" ? "新投递" : "消息回复";
    lines.push(`${icon} *${typeLabel}* — ${n.platform}`);
    lines.push(`   候选人: ${n.candidateName}`);
    if (n.jobTitle) lines.push(`   职位: ${n.jobTitle}`);
    if (n.message) lines.push(`   消息: ${n.message}`);
    if (n.sourceUrl) lines.push(`   查看: ${n.sourceUrl}`);
    lines.push("");
  }

  lines.push(`共 ${notifications.length} 条新通知`);

  // FEEDBACK_WHATSAPP is a pre-formatted chat id (ends in @c.us) — notifyInternal handles both forms.
  const sent = await notifyInternal(FEEDBACK_WHATSAPP, lines.join("\n"));
  if (sent) {
    logger.info("Notification push sent", { count: notifications.length });
  } else {
    logger.error("Failed to send notifications");
  }
}
