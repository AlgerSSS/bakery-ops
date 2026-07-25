// restock-advice-push.service.ts — 下午加减货建议定时推送（用户 2026-07-05 设计）。
//
// 14:30 (Asia/Kuala_Lumpur) cron：据今日到 14:20 的实际销量(item_hourly_sales，由 res_api
// intraday-refresh 14:20 拉取)生成加减货建议，推给订阅 'restock_advice' 的成员（对内只走 Lark）。
// 测试期只发我 = 只有 owner 订阅。生成引擎 restock-advice.ts；数据不全时引擎自带完整性护栏返回空。
// 幂等：daily_push_log (kind='restock_advice', recipient=open_id, date)，发送成功才写。

import { logger } from "@/modules/shared/logger";
import { sendLarkToUser } from "@/modules/channel/lark/lark-messenger";
import { teamRepository } from "@/modules/data/repositories/team.repository";
import { localDate } from "@/modules/channel/whatsapp/outbound.config";
import { generateRestockAdvice, buildRestockAdviceText } from "@/modules/domain/forecast/restock-advice";
import { hasPushLog, recordPushLog } from "./push-log";

const CUTOFF_MIN = 14 * 60 + 20; // 数据口径截到 14:20（与 res_api 拉取时刻一致）

/** 入口 — bootstrap cron '30 14 * * *'。生成失败/无订阅者时安全 no-op。 */
export async function runRestockAdvicePush(): Promise<void> {
  const today = localDate();

  let text: string;
  try {
    const advices = await generateRestockAdvice(today, CUTOFF_MIN);
    text = buildRestockAdviceText(today, advices);
  } catch (err) {
    logger.error("Restock advice push: generation failed", { date: today, error: String(err) });
    return;
  }

  const openIds = await teamRepository.getSubscriberOpenIds("restock_advice");
  if (!openIds.length) {
    logger.error("Restock advice push: 无有效收件人(team_member 无 restock_advice 订阅者)");
    return;
  }

  for (const openId of openIds) {
    try {
      if (await hasPushLog("restock_advice", openId, today)) {
        logger.info("Restock advice push: already sent, skipping", { openId, date: today });
        continue;
      }
      const sent = await sendLarkToUser(openId, text);
      if (sent) {
        await recordPushLog("restock_advice", openId, today);
        logger.info("Restock advice push: sent", { openId, date: today });
      } else {
        logger.error("Restock advice push: send failed", { openId });
      }
    } catch (err) {
      logger.error("Restock advice push: recipient failed", { openId, error: String(err) });
    }
  }
}
