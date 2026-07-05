// production-plan-push.service.ts — 后厨生产计划定时推送（IMPROVEMENT-PLAN.md F2）。
//
// 7:00 (Asia/Kuala_Lumpur) cron：调 generateProductionPlan 生成【当日】计划文本，
// 推给 team_member 里订阅 'production_plan' 的成员（Lark 直发卡片，对内只走 Lark）。
// 收件人配置在 DB：给某人订阅 = team_member.subscriptions 加 'production_plan'。
// 幂等：daily_push_log (kind='production_plan', recipient=open_id, date)，发送成功才写。

import { logger } from "@/modules/shared/logger";
import { sendLarkToUser } from "@/modules/channel/lark/lark-messenger";
import { teamRepository } from "@/modules/data/repositories/team.repository";
import { localDate } from "@/modules/channel/whatsapp/outbound.config";
import { generateProductionPlan } from "@/modules/domain/production-plan/plan-generator";
import { hasPushLog, recordPushLog } from "./push-log";

/** 入口 — bootstrap cron '0 7 * * *'。生成失败/无订阅者时安全 no-op。 */
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

  // 收件人 = team_member 里订阅 production_plan 的在职成员（open_id 直发卡片）。
  const openIds = await teamRepository.getSubscriberOpenIds("production_plan");
  if (!openIds.length) {
    logger.error("Production plan push: 无有效收件人(team_member 无 production_plan 订阅者)");
    return;
  }

  for (const openId of openIds) {
    try {
      if (await hasPushLog("production_plan", openId, today)) {
        logger.info("Production plan push: already sent, skipping", { openId, date: today });
        continue;
      }
      const sent = await sendLarkToUser(openId, summary);
      if (sent) {
        await recordPushLog("production_plan", openId, today);
        logger.info("Production plan push: sent", { openId, date: today });
      } else {
        logger.error("Production plan push: send failed", { openId });
      }
    } catch (err) {
      logger.error("Production plan push: recipient failed", { openId, error: String(err) });
    }
  }
}
