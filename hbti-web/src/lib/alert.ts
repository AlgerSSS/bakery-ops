import { z } from "zod";

import type { ReviewCompletionRecord } from "@/lib/store/completion-store";

/**
 * 失败告警出口。
 *
 * 为什么需要它:在此之前 HBTI 的坏结局是**完全静默**的——一条完成记录进了
 * `review`,库存已经扣掉、RES 那边可能已经发出券,但没有任何人会知道。
 * 兜底靠顾客到柜台说「我没收到礼物」,那时线索早就凉了。
 *
 * 沿用仓库里 res_api/daily-refresh.sh 与 ops/hbti-token/run.sh 的同一套惯例:
 *   - webhook 地址只从环境变量读,不写死;
 *   - 没配就静默跳过(只留服务端日志),不因为告警发不出去而拖垮主流程;
 *   - 告警本身的失败永远不向上抛。
 *
 * 「不抛」是刻意的:这里的调用点都在补偿路径上(标记 review、库存归还失败),
 * 那些地方已经是在处理一次故障了。让通知的失败再掀翻一次,只会把一个
 * 可人工挽回的局面变成一个连记录都没写下的局面。
 */

const ALERT_TIMEOUT_MS = 5_000;

export type AlertSeverity = "warn" | "error";

export interface AlertPayload {
  severity: AlertSeverity;
  /** 一句话说清发生了什么,会直接出现在群消息里。 */
  title: string;
  /** 处置线索。键值会按 `键=值` 拼进消息,不要放明文手机号等 PII。 */
  context?: Readonly<Record<string, string | number | undefined>>;
}
function readAlertWebhook(): string | undefined {
  const raw = process.env.ALERT_WEBHOOK?.trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function hasAlertDestination(): boolean {
  return readAlertWebhook() !== undefined;
}

/**
 * 飞书/Lark 自定义群机器人的 hook 路径。它**不吃** `{"text": …}`——
 * 收到形状不对的包体照样回 HTTP 200，只在 JSON 里给一个非零 `code`。
 * 所以既要按它的形状发，也要按它的 `code` 判成败，否则告警会「静默成功」。
 */
const LARK_BOT_HOOK_PATH = "/open-apis/bot/v2/hook/";

const larkBotReceiptSchema = z.object({ code: z.number() });

/**
 * 人工复核告警的唯一格式。即时发送与 Cron 重试必须共用它，否则同一条记录
 * 第一次和重试时会给运营两套不同线索。attemptId 同时充当人工去重键。
 */
export function reviewAlertPayload(
  record: ReviewCompletionRecord,
): AlertPayload {
  return {
    severity: "error",
    title:
      record.reason === "inventory_release_ambiguous"
        ? "礼品库存归还结果未知（先对账再校正）"
        : "HBTI 发券进入人工复核",
    context: {
      alertKey: `review:${record.attemptId}`,
      reason: record.reason,
      memberId: record.rewardContext.memberId,
      gift: record.rewardContext.templateName,
      baselineCoupons: record.baselineCouponIds.length,
      attemptId: record.attemptId,
    },
  };
}

/**
 * 发一条告警。永不抛错,永不阻塞调用方的补偿逻辑。
 *
 * 返回值只用于测试与日志:`"sent"` / `"skipped"`(未配置) / `"failed"`。
 */
export async function sendAlert({
  severity,
  title,
  context,
}: AlertPayload): Promise<"sent" | "skipped" | "failed"> {
  const details = Object.entries(context ?? {})
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const tag = severity === "error" ? "[HOT CRUSH][ERROR]" : "[HOT CRUSH][WARN]";
  const message = details ? `${tag} ${title} — ${details}` : `${tag} ${title}`;

  // 无论有没有 webhook 都先落服务端日志:日志是最后一道底,
  // webhook 配错了、群机器人被移除了,至少 Vercel 日志里还查得到。
  if (severity === "error") {
    console.error(message);
  } else {
    console.warn(message);
  }

  const webhook = readAlertWebhook();
  if (!webhook) return "skipped";

  const isLarkBot = new URL(webhook).pathname.startsWith(LARK_BOT_HOOK_PATH);
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isLarkBot
          ? { msg_type: "text", content: { text: message } }
          : { text: message },
      ),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
    if (!response.ok) return "failed";
    if (!isLarkBot) return "sent";

    // 读不出 code 就当没送到——宁可让 Cron 重试，也不要假成功。
    const receipt = larkBotReceiptSchema.safeParse(
      await response.json().catch(() => null),
    );
    return receipt.success && receipt.data.code === 0 ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
