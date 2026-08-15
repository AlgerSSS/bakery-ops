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
  | "TOO_MANY_ACTIVE_RESERVATIONS"
  | "BENEFIT_NOT_AVAILABLE";

export const POINTS_EXCHANGE_COST = 450;

/**
 * 会员当前可选的生日礼选项。等级权益之外，积分兑换对任何会员开放
 * （2026-08-15 产品决定：会员卡上展示了积分，就应当有花法）：
 *   - free_basque：等级权益是免费巴斯克时才有（每会员每年一份）；
 *   - points_450：余额 ≥ 450 且进行中的积分预约未超上限即可选。
 * 两者的 allowGift 都跟随等级权益规则（VIP1/L1/L2 限自己，L4 可送亲友）。
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
  const rule = resolveBenefit(member.levelName, config);
  const options: BirthdayOption[] = [];

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
    label: rule.allowGift
      ? "450 积分兑换生日蛋糕（可送亲友）"
      : "450 积分兑换生日蛋糕",
    cost: POINTS_EXCHANGE_COST,
    allowGift: rule.allowGift,
    yearlyLimit: null,
    available: pointsDenied === undefined,
    deniedReason: pointsDenied,
  });

  return options;
}

export interface ReserveDecision {
  ok: boolean;
  denial?: ReserveDenial;
  rule: BirthdayBenefitRule;
}

export function decideReservation(
  member: MemberLevelSnapshot,
  existing: readonly ExistingReservationLike[],
  input: { forWhom: "self" | "gift"; giftType: "free_basque" | "points_450" },
  config: BirthdayConfig,
): ReserveDecision {
  const rule = resolveBenefit(member.levelName, config);
  const option = listBirthdayOptions(member, existing, config).find(
    (candidate) => candidate.giftType === input.giftType,
  );
  if (!option) {
    return { ok: false, denial: "BENEFIT_NOT_AVAILABLE", rule };
  }
  if (!option.available) {
    return { ok: false, denial: option.deniedReason ?? "BENEFIT_NOT_AVAILABLE", rule };
  }
  if (input.forWhom === "gift" && !option.allowGift) {
    return { ok: false, denial: "GIFT_NOT_ALLOWED", rule };
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
