import type { BirthdayReservation } from "@/lib/birthday/store";

/**
 * 预约成功后的门店通知。沿用 lib/alert.ts 的纪律：
 * webhook 只从环境变量读、未配置就静默跳过（只留日志）、通知失败永不向上抛——
 * 预约已经落库，不能因为推送失败把顾客的确认页变成错误页。
 *
 * 通道：Lark 自定义群机器人 webhook（BIRTHDAY_NOTIFY_WEBHOOK）。
 * 推送给哪个群/哪些人由门店后续在 Lark 侧决定，应用只负责把结构化内容发出去。
 */

const NOTIFY_TIMEOUT_MS = 5_000;

export interface ReservationNotice {
  reservation: BirthdayReservation;
  maskedPhone: string | null;
  levelName: string | null;
  pointsSnapshot: number | null;
  allergies: string | null;
}

export async function notifyStore(
  webhook: string | undefined,
  notice: ReservationNotice,
): Promise<"sent" | "skipped" | "failed"> {
  if (!webhook) {
    console.info("[birthday] notify skipped: BIRTHDAY_NOTIFY_WEBHOOK not set");
    return "skipped";
  }
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msg_type: "text",
        content: { text: formatNotice(notice) },
      }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("[birthday] notify failed", { httpStatus: response.status });
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("[birthday] notify failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  }
}

function formatNotice(notice: ReservationNotice): string {
  const r = notice.reservation;
  const lines = [
    "[HOT CRUSH] 新的生日礼预约 #" + r.reservationId,
    "蛋糕：" + (r.giftType === "free_basque" ? "免费巴斯克" : "450 积分兑换（取货时 POS 扣积分）"),
    "取货：" + r.pickupDate + " " + (r.slot === "noon" ? "午间" : "晚间"),
    "送给：" + (r.forWhom === "gift" ? "亲友（" + (r.recipientNote ?? "未填") + "）" : "会员自己"),
  ];
  if (notice.maskedPhone) lines.push("会员：" + notice.maskedPhone);
  if (notice.levelName) lines.push("等级：" + notice.levelName);
  if (notice.pointsSnapshot !== null) lines.push("预约时积分余额：" + notice.pointsSnapshot);
  if (notice.allergies) lines.push("⚠️ 过敏原：" + notice.allergies);
  if (r.memberNote) lines.push("留言：" + r.memberNote);
  return lines.join("\n");
}
