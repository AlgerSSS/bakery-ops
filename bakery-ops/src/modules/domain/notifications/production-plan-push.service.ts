// production-plan-push.service.ts — 后厨生产计划定时推送（IMPROVEMENT-PLAN.md F2）。
//
// 7:00 (Asia/Kuala_Lumpur) cron：调 generateProductionPlan 生成【当日】计划文本，
// 推主厨 (users 表 role=kitchen_manager) + 抄送老板 (OWNER_WHATSAPP)。
// 幂等：daily_push_log (kind='production_plan', recipient, date)，发送成功才写。

import { logger } from "@/modules/shared/logger";
import { notifyInternal } from "@/modules/channel/internal-notify";
import { userRepository } from "@/modules/data/repositories/user.repository";
import { localDate } from "@/modules/channel/whatsapp/outbound.config";
import { generateProductionPlan } from "@/modules/domain/production-plan/plan-generator";
import { hasPushLog, recordPushLog } from "./push-log";

/** 收件人：主厨 (kitchen_manager) + 抄送老板。 */
async function resolveRecipients(): Promise<string[]> {
  const recipients = new Set<string>();
  const users = await userRepository.getAll();
  for (const u of users) {
    if (u.role === "kitchen_manager" && u.phone) recipients.add(u.phone);
  }
  const owner = process.env.OWNER_WHATSAPP || process.env.OWNER_PHONE || "";
  if (owner) recipients.add(owner);
  return Array.from(recipients);
}

/** 入口 — bootstrap cron '0 7 * * *'。生成失败/未连接时安全 no-op。 */
export async function runProductionPlanPush(): Promise<void> {
  const today = localDate();

  let summary: string;
  try {
    const plan = await generateProductionPlan(today);
    if (!plan.batches.length) {
      logger.info("Production plan push: empty plan, skipping", { date: today });
      return;
    }
    summary = plan.summary;
  } catch (err) {
    logger.error("Production plan push: plan generation failed", { date: today, error: String(err) });
    return;
  }

  const recipients = await resolveRecipients();

  for (const recipient of recipients) {
    try {
      if (await hasPushLog("production_plan", recipient, today)) {
        logger.info("Production plan push: already sent, skipping", { recipient, date: today });
        continue;
      }
      const sent = await notifyInternal(recipient, summary);
      if (sent) {
        await recordPushLog("production_plan", recipient, today);
        logger.info("Production plan push: sent", { recipient, date: today });
      } else {
        logger.error("Production plan push: send failed", { recipient });
      }
    } catch (err) {
      logger.error("Production plan push: recipient failed", { recipient, error: String(err) });
    }
  }
}
