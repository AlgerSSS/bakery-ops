import type { BirthdayBenefitRule, BirthdayConfig } from "@/lib/birthday/config";

/**
 * 会员等级 → 生日权益的解析与预约资格判定。规则本身在 config.ts，
 * 这里只做纯函数判定，不碰数据库与网络，方便单测。
 */

export interface MemberLevelSnapshot {
  levelName: string | null;
  pointBalance: number | null;
}

export interface ExistingReservationLike {
  giftType: "free_basque" | "points_450";
  status: "reserved" | "fulfilled" | "cancelled";
}

export function resolveBenefit(
  levelName: string | null,
  config: BirthdayConfig,
): BirthdayBenefitRule {
  if (levelName) {
    const direct = config.benefitsByLevel[levelName];
    if (direct) return direct;
    // RES 等级名可能长成「L1 会员」这类带后缀的形式，做一次归一化匹配。
    const normalized = levelName.trim().toUpperCase();
    for (const [key, rule] of Object.entries(config.benefitsByLevel)) {
      if (normalized === key.toUpperCase() || normalized.startsWith(key.toUpperCase())) {
        return rule;
      }
    }
  }
  // VIP1（当前唯一在用的等级）与未知等级都落到默认权益：免费巴斯克。
  return config.defaultBenefit;
}

export type ReserveDenial =
  | "FREE_BASQUE_ALREADY_CLAIMED"
  | "GIFT_NOT_ALLOWED"
  | "INSUFFICIENT_POINTS"
  | "TOO_MANY_ACTIVE_RESERVATIONS";

export interface ReserveDecision {
  ok: boolean;
  denial?: ReserveDenial;
  rule: BirthdayBenefitRule;
}

export function decideReservation(
  member: MemberLevelSnapshot,
  existing: readonly ExistingReservationLike[],
  input: { forWhom: "self" | "gift" },
  config: BirthdayConfig,
): ReserveDecision {
  const rule = resolveBenefit(member.levelName, config);

  if (input.forWhom === "gift" && !rule.allowGift) {
    return { ok: false, denial: "GIFT_NOT_ALLOWED", rule };
  }

  if (rule.kind === "free_basque") {
    const claimed = existing.some(
      (r) => r.giftType === "free_basque" && r.status !== "cancelled",
    );
    if (claimed || (rule.yearlyLimit !== null && rule.yearlyLimit <= 0)) {
      return { ok: false, denial: "FREE_BASQUE_ALREADY_CLAIMED", rule };
    }
    return { ok: true, rule };
  }

  // points_450：积分在门店 POS 结算，这里只做预约当时的余额资格检查。
  if (
    member.pointBalance === null ||
    member.pointBalance < 450
  ) {
    return { ok: false, denial: "INSUFFICIENT_POINTS", rule };
  }
  const active = existing.filter(
    (r) => r.giftType === "points_450" && r.status === "reserved",
  ).length;
  if (active >= config.maxActivePointsReservations) {
    return { ok: false, denial: "TOO_MANY_ACTIVE_RESERVATIONS", rule };
  }
  return { ok: true, rule };
}

/** 可选取货日期窗口：提前 pickupLeadDays 天起，最长 pickupWindowDays 天。 */
export function pickupWindow(
  config: BirthdayConfig,
  now: Date = new Date(),
): { minDate: string; maxDate: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayMs = 24 * 60 * 60 * 1000;
  return {
    minDate: fmt.format(new Date(now.getTime() + config.pickupLeadDays * dayMs)),
    maxDate: fmt.format(new Date(now.getTime() + config.pickupWindowDays * dayMs)),
  };
}
