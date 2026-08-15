import type { BirthdayBenefitRule, BirthdayConfig } from "@/lib/birthday/config";

/**
 * 会员等级 → 生日权益组的解析与预约资格判定。规则本身在 config.ts，
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

/** 等级 → 可选权益组（2026-08-15 用户二次修订：L1 空组=只有贺卡；L2 免费巴斯克；
 *  L3/L4 免费巴斯克 + 450 积分兑换，二选一）。 */
export function resolveBenefits(
  levelName: string | null,
  config: BirthdayConfig,
): BirthdayBenefitRule[] {
  if (levelName) {
    const direct = config.benefitsByLevel[levelName];
    if (direct) return direct;
    // RES 等级名可能长成「L1 会员」这类带后缀的形式，做一次归一化匹配。
    const normalized = levelName.trim().toUpperCase();
    for (const [key, rules] of Object.entries(config.benefitsByLevel)) {
      if (normalized === key.toUpperCase() || normalized.startsWith(key.toUpperCase())) {
        return rules;
      }
    }
  }
  // 未知等级（如 RES 的 VIP1）落保险丝默认：只有贺卡，没有蛋糕权益。
  return config.defaultBenefits;
}

export type ReserveDenial =
  | "FREE_BASQUE_ALREADY_CLAIMED"
  | "GIFT_NOT_ALLOWED"
  | "INSUFFICIENT_POINTS"
  | "TOO_MANY_ACTIVE_RESERVATIONS"
  | "BENEFIT_NOT_AVAILABLE";

export const POINTS_EXCHANGE_COST = 450;

/**
 * 会员当前可选的生日礼选项（2026-08-15 用户二次修订定版）：
 *   - L1：[] —— 只有电子贺卡，没有任何蛋糕选项；
 *   - L2：[免费巴斯克]；
 *   - L3：[免费巴斯克, 450 积分兑换（限自己）]；
 *   - L4：[免费巴斯克, 450 积分兑换（可送亲友）]。
 * 等级来自 deriveLevelKey(年累计消费)，见 config.ts；积分在门店 POS 结算。
 */
export interface BirthdayOption {
  giftType: "free_basque" | "points_450";
  label: string;
  /** 0 = 免费；450 = 积分兑换（积分在门店 POS 结算，H5 不扣）。 */
  cost: number;
  allowGift: boolean;
  yearlyLimit: number | null;
  available: boolean;
  deniedReason?: ReserveDenial;
}

export function listBirthdayOptions(
  member: MemberLevelSnapshot,
  existing: readonly ExistingReservationLike[],
  config: BirthdayConfig,
): BirthdayOption[] {
  const rules = resolveBenefits(member.levelName, config);
  const options: BirthdayOption[] = [];

  for (const rule of rules) {
    if (rule.kind === "free_basque") {
      const claimed = existing.some(
        (r) => r.giftType === "free_basque" && r.status !== "cancelled",
      );
      options.push({
        giftType: "free_basque",
        label: rule.label,
        cost: 0,
        allowGift: rule.allowGift,
        yearlyLimit: rule.yearlyLimit,
        available:
          !claimed && (rule.yearlyLimit === null || rule.yearlyLimit > 0),
        deniedReason: claimed ? "FREE_BASQUE_ALREADY_CLAIMED" : undefined,
      });
    }

    if (rule.kind === "points_450") {
      const balance = member.pointBalance;
      const activePoints = existing.filter(
        (r) => r.giftType === "points_450" && r.status === "reserved",
      ).length;
      let pointsDenied: ReserveDenial | undefined;
      if (balance === null || balance < POINTS_EXCHANGE_COST) {
        pointsDenied = "INSUFFICIENT_POINTS";
      } else if (activePoints >= config.maxActivePointsReservations) {
        pointsDenied = "TOO_MANY_ACTIVE_RESERVATIONS";
      }
      options.push({
        giftType: "points_450",
        label: rule.label,
        cost: POINTS_EXCHANGE_COST,
        allowGift: rule.allowGift,
        yearlyLimit: null,
        available: pointsDenied === undefined,
        deniedReason: pointsDenied,
      });
    }
  }

  return options;
}

export interface ReserveDecision {
  ok: boolean;
  denial?: ReserveDenial;
}

export function decideReservation(
  member: MemberLevelSnapshot,
  existing: readonly ExistingReservationLike[],
  input: { forWhom: "self" | "gift"; giftType: "free_basque" | "points_450" },
  config: BirthdayConfig,
): ReserveDecision {
  const option = listBirthdayOptions(member, existing, config).find(
    (candidate) => candidate.giftType === input.giftType,
  );
  if (!option) {
    return { ok: false, denial: "BENEFIT_NOT_AVAILABLE" };
  }
  if (!option.available) {
    return { ok: false, denial: option.deniedReason ?? "BENEFIT_NOT_AVAILABLE" };
  }
  if (input.forWhom === "gift" && !option.allowGift) {
    return { ok: false, denial: "GIFT_NOT_ALLOWED" };
  }
  return { ok: true };
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

