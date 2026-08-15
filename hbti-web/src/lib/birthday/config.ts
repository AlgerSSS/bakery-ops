/**
 * 生日贺卡的服务端配置。全部从环境变量读，缺敏感项时 fail closed
 * （与 server-config.ts 的 requireEnvironmentVariable 同一套纪律）。
 *
 * 会员等级（2026-08-15 用户定版，等级由年累计实付消费实时计算，不看 RES 等级名）：
 *   Lv1 初见会员 First Crush     注册入会（RM0）
 *   Lv2 心动会员 Sweet Crush     年累计消费 RM250
 *   Lv3 热爱会员 Hot Crush       年累计消费 RM750
 *   Lv4 挚爱会员 Forever Crush   年累计消费 RM1,500
 * 生日权益：L1/L2 只有免费巴斯克（每年一份）；L3/L4 才有 450 积分兑换蛋糕
 * （L3 限自己、L4 可送亲友）。RES 里的等级名（如 VIP1）只作原始档案保留，
 * 权益判定一律用 deriveLevelKey(年消费)。
 */

export interface BirthdayBenefitRule {
  /** free_basque = 免费巴斯克；points_450 = 450 积分兑换（积分在门店 POS 结算，H5 不扣）。 */
  kind: "free_basque" | "points_450";
  /** 是否允许给亲友兑换（L4）。 */
  allowGift: boolean;
  /** 每会员每年份数上限；null = 不限量（L3/L4 积分兑换）。 */
  yearlyLimit: number | null;
  /** 页面上给顾客看的权益文案。 */
  label: string;
}

export interface BirthdayConfig {
  linkSecret: string;
  campaignYear: number;
  /** 签名链接有效期（天）。 */
  linkTtlDays: number;
  /** 预约需提前的天数。 */
  pickupLeadDays: number;
  /** 最多可以提前多少天预约。 */
  pickupWindowDays: number;
  /** 积分兑换每会员同时有效的预约数上限（防呆，不限量的业务规则不变）。 */
  maxActivePointsReservations: number;
  benefitsByLevel: Record<string, BirthdayBenefitRule>;
  defaultBenefit: BirthdayBenefitRule;
  notifyWebhook: string | undefined;
}

export const FREE_BASQUE_RULE: BirthdayBenefitRule = {
  kind: "free_basque",
  allowGift: false,
  yearlyLimit: 1,
  label: "免费巴斯克生日蛋糕",
};

const POINTS_450_SELF_RULE: BirthdayBenefitRule = {
  kind: "points_450",
  allowGift: false,
  yearlyLimit: null,
  label: "450 积分兑换生日蛋糕",
};

const POINTS_450_GIFT_RULE: BirthdayBenefitRule = {
  kind: "points_450",
  allowGift: true,
  yearlyLimit: null,
  label: "450 积分兑换生日蛋糕（可送亲友）",
};

const DEFAULT_BENEFITS: Record<string, BirthdayBenefitRule> = {
  L1: FREE_BASQUE_RULE,
  L2: FREE_BASQUE_RULE,
  L3: POINTS_450_SELF_RULE,
  L4: POINTS_450_GIFT_RULE,
};

export const POINTS_CAKE_COST = 450;

/** 会员等级体系（升级条件来自用户定版）。 */
export interface MemberLevelInfo {
  key: "L1" | "L2" | "L3" | "L4";
  nameZh: string;
  nameEn: string;
  /** 年累计消费（RM，实付口径）达到即升级。 */
  annualThreshold: number;
}

export const MEMBER_LEVELS: readonly MemberLevelInfo[] = [
  { key: "L1", nameZh: "Lv1 初见会员", nameEn: "First Crush", annualThreshold: 0 },
  { key: "L2", nameZh: "Lv2 心动会员", nameEn: "Sweet Crush", annualThreshold: 250 },
  { key: "L3", nameZh: "Lv3 热爱会员", nameEn: "Hot Crush", annualThreshold: 750 },
  { key: "L4", nameZh: "Lv4 挚爱会员", nameEn: "Forever Crush", annualThreshold: 1500 },
];

/** 年累计实付消费 → 等级。无消费记录（含消费口径外只付现金的会员）按 L1 初见。 */
export function deriveLevelKey(
  annualSpend: number | null | undefined,
): MemberLevelInfo["key"] {
  const spend = annualSpend ?? 0;
  if (spend >= 1500) return "L4";
  if (spend >= 750) return "L3";
  if (spend >= 250) return "L2";
  return "L1";
}

export function memberLevelInfo(key: MemberLevelInfo["key"]): MemberLevelInfo {
  return MEMBER_LEVELS.find((level) => level.key === key) ?? MEMBER_LEVELS[0];
}

export function readBirthdayConfig(): BirthdayConfig {
  const linkSecret = requireEnvironmentVariable("BIRTHDAY_LINK_SECRET");
  if (new TextEncoder().encode(linkSecret).byteLength < 32) {
    throw new Error("BIRTHDAY_LINK_SECRET must contain at least 32 bytes.");
  }

  let benefitsByLevel = DEFAULT_BENEFITS;
  const override = process.env.BIRTHDAY_BENEFITS_JSON?.trim();
  if (override) {
    try {
      benefitsByLevel = JSON.parse(override) as Record<string, BirthdayBenefitRule>;
    } catch {
      throw new Error("BIRTHDAY_BENEFITS_JSON is not valid JSON.");
    }
  }

  return {
    linkSecret,
    campaignYear: readInteger("BIRTHDAY_CAMPAIGN_YEAR", currentKlYear()),
    linkTtlDays: readInteger("BIRTHDAY_LINK_TTL_DAYS", 30),
    pickupLeadDays: readInteger("BIRTHDAY_PICKUP_LEAD_DAYS", 2),
    pickupWindowDays: readInteger("BIRTHDAY_PICKUP_WINDOW_DAYS", 30),
    maxActivePointsReservations: readInteger("BIRTHDAY_MAX_ACTIVE_POINTS_RESERVATIONS", 3),
    benefitsByLevel,
    defaultBenefit: FREE_BASQUE_RULE,
    notifyWebhook: readWebhook(),
  };
}

/** 门店在吉隆坡，年度边界按 Asia/Kuala_Lumpur。 */
export function currentKlYear(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === "year")?.value);
}

function readInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(name + " must be a positive integer.");
  }
  return value;
}

function readWebhook(): string | undefined {
  const raw = process.env.BIRTHDAY_NOTIFY_WEBHOOK?.trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(name + " is required.");
  }
  return value;
}
