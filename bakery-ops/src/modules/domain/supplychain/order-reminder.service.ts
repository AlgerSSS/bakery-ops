// order-reminder.service.ts — 订货漏报提醒（IMPROVEMENT-PLAN.md F8 ①）。
//
// 工作日 16:00 (Asia/Kuala_Lumpur) cron：supply_orders 无今日记录 →
// 提醒店长 (users 表 role=store_manager)"今天还没报订货"，附最近一次已发 (status=sent)
// 订单的清单文本，提示可回复"照上次订"快捷下单。
// 幂等：daily_push_log (kind='order_reminder', recipient, date)，发送成功才写。

import { logger } from "@/modules/shared/logger";
import { notifyInternal } from "@/modules/channel/internal-notify";
import { userRepository } from "@/modules/data/repositories/user.repository";
import { localDate } from "@/modules/channel/whatsapp/outbound.config";
import { supplyOrderRepository, type SupplyOrderRow } from "@/modules/data/repositories/supply-order.repository";
import { hasPushLog, recordPushLog } from "@/modules/domain/notifications/push-log";

const STORE_ID = "default";

/** 收件人：店长 (store_manager)；未配置时兜底老板 (OWNER_WHATSAPP)。 */
async function resolveRecipients(): Promise<string[]> {
  const recipients = new Set<string>();
  const users = await userRepository.getAll();
  for (const u of users) {
    if (u.role === "store_manager" && u.phone) recipients.add(u.phone);
  }
  if (recipients.size === 0) {
    const owner = process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE || "";
    if (owner) recipients.add(owner);
  }
  return Array.from(recipients);
}

/** 提醒文本：漏报提示 + 最近一次已发订单清单（无历史时省略清单段）。 */
export function buildOrderReminderText(lastSent: SupplyOrderRow | null): string {
  const lines = ["⏰ 今天还没报订货，别忘了哦。"];
  if (lastSent && Array.isArray(lastSent.items) && lastSent.items.length > 0) {
    const itemList = lastSent.items.map((i) => `${i.name}: ${i.quantity}${i.unit}`).join("\n");
    lines.push("", `上次订单（${lastSent.order_date}）:`, itemList, "", "回复「照上次订」可直接复制为今日订单。");
  }
  return lines.join("\n");
}

/** 入口 — bootstrap cron '0 16 * * 1-5'。今日已有记录/未连接时安全 no-op。 */
export async function runOrderReminder(): Promise<void> {
  const today = localDate();

  const todayOrder = await supplyOrderRepository.getTodayOrder(STORE_ID);
  if (todayOrder) {
    logger.info("Order reminder: today's order exists, skipping", { date: today });
    return;
  }

  const recent = await supplyOrderRepository.getRecentOrders(STORE_ID, 10);
  const lastSent = recent.find((o) => o.status === "sent") ?? null;
  const text = buildOrderReminderText(lastSent);

  const recipients = await resolveRecipients();

  for (const recipient of recipients) {
    try {
      if (await hasPushLog("order_reminder", recipient, today)) {
        logger.info("Order reminder: already sent, skipping", { recipient, date: today });
        continue;
      }
      const sent = await notifyInternal(recipient, text);
      if (sent) {
        await recordPushLog("order_reminder", recipient, today);
        logger.info("Order reminder: sent", { recipient, date: today });
      } else {
        logger.error("Order reminder: send failed", { recipient });
      }
    } catch (err) {
      logger.error("Order reminder: recipient failed", { recipient, error: String(err) });
    }
  }
}
