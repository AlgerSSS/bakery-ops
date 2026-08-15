import { describe, expect, it } from "vitest";

import type { BirthdayConfig } from "@/lib/birthday/config";
import {
  decideReservation,
  listBirthdayOptions,
  pickupWindow,
  resolveBenefit,
} from "@/lib/birthday/eligibility";

function makeConfig(overrides: Partial<BirthdayConfig> = {}): BirthdayConfig {
  return {
    linkSecret: "x".repeat(32),
    campaignYear: 2026,
    linkTtlDays: 30,
    pickupLeadDays: 2,
    pickupWindowDays: 30,
    maxActivePointsReservations: 3,
    benefitsByLevel: {
      L1: { kind: "free_basque", allowGift: false, yearlyLimit: 1, label: "免费巴斯克" },
      L3: { kind: "points_450", allowGift: false, yearlyLimit: null, label: "450积分兑换" },
      L4: { kind: "points_450", allowGift: true, yearlyLimit: null, label: "450积分兑换(可送亲友)" },
    },
    defaultBenefit: { kind: "free_basque", allowGift: false, yearlyLimit: 1, label: "免费巴斯克" },
    notifyWebhook: undefined,
    ...overrides,
  };
}

describe("resolveBenefit 等级映射", () => {
  const config = makeConfig();
  it("L1/L2 是免费巴斯克", () => {
    expect(resolveBenefit("L1", config).kind).toBe("free_basque");
  });
  it("L3 限自己，L4 可送亲友", () => {
    expect(resolveBenefit("L3", config).allowGift).toBe(false);
    expect(resolveBenefit("L4", config).allowGift).toBe(true);
  });
  it("VIP1 与未知等级都落默认权益", () => {
    expect(resolveBenefit("VIP1", config).kind).toBe("free_basque");
    expect(resolveBenefit(null, config).kind).toBe("free_basque");
    expect(resolveBenefit("VIP9", config).kind).toBe("free_basque");
  });
  it("带后缀的等级名归一化匹配", () => {
    expect(resolveBenefit("l4 会员", config).allowGift).toBe(true);
  });
});

describe("listBirthdayOptions 双选项", () => {
  const config = makeConfig();
  it("免费等级 + 积分够 → 两个选项都出现，积分选项可选", () => {
    const options = listBirthdayOptions({ levelName: "L1", pointBalance: 500 }, [], config);
    expect(options.map((o) => o.giftType)).toEqual(["free_basque", "points_450"]);
    expect(options[0].available).toBe(true);
    expect(options[1].available).toBe(true);
    expect(options[1].cost).toBe(450);
  });
  it("积分不足时积分选项给 INSUFFICIENT_POINTS", () => {
    const options = listBirthdayOptions({ levelName: "L1", pointBalance: 120 }, [], config);
    expect(options[1].available).toBe(false);
    expect(options[1].deniedReason).toBe("INSUFFICIENT_POINTS");
  });
  it("没有积分记录同样不给积分选项", () => {
    const options = listBirthdayOptions({ levelName: "L1", pointBalance: null }, [], config);
    expect(options[1].available).toBe(false);
  });
  it("免费巴斯克已领过后免费选项不可用", () => {
    const existing = [{ giftType: "free_basque" as const, status: "reserved" as const }];
    const options = listBirthdayOptions({ levelName: "L1", pointBalance: 500 }, existing, config);
    expect(options[0].available).toBe(false);
    expect(options[0].deniedReason).toBe("FREE_BASQUE_ALREADY_CLAIMED");
    expect(options[1].available).toBe(true);
  });
  it("已取消的免费预约不占名额", () => {
    const existing = [{ giftType: "free_basque" as const, status: "cancelled" as const }];
    const options = listBirthdayOptions({ levelName: "L1", pointBalance: 0 }, existing, config);
    expect(options[0].available).toBe(true);
  });
  it("积分等级（L3/L4）没有免费选项，只有积分兑换", () => {
    const options = listBirthdayOptions({ levelName: "L4", pointBalance: 900 }, [], config);
    expect(options.map((o) => o.giftType)).toEqual(["points_450"]);
    expect(options[0].allowGift).toBe(true);
  });
  it("进行中的积分预约达到防呆上限", () => {
    const existing = [
      { giftType: "points_450" as const, status: "reserved" as const },
      { giftType: "points_450" as const, status: "reserved" as const },
      { giftType: "points_450" as const, status: "reserved" as const },
    ];
    const options = listBirthdayOptions({ levelName: "L4", pointBalance: 9000 }, existing, config);
    expect(options[0].available).toBe(false);
    expect(options[0].deniedReason).toBe("TOO_MANY_ACTIVE_RESERVATIONS");
  });
});

describe("decideReservation 预约资格", () => {
  const config = makeConfig();
  it("免费巴斯克每年限一份", () => {
    const member = { levelName: "L1", pointBalance: 0 };
    const input = { forWhom: "self" as const, giftType: "free_basque" as const };
    expect(decideReservation(member, [], input, config).ok).toBe(true);
    const existing = [{ giftType: "free_basque" as const, status: "reserved" as const }];
    const second = decideReservation(member, existing, input, config);
    expect(second.ok).toBe(false);
    expect(second.denial).toBe("FREE_BASQUE_ALREADY_CLAIMED");
  });
  it("积分兑换要余额够 450", () => {
    const input = { forWhom: "self" as const, giftType: "points_450" as const };
    expect(decideReservation({ levelName: "L1", pointBalance: 449 }, [], input, config).denial)
      .toBe("INSUFFICIENT_POINTS");
    expect(decideReservation({ levelName: "L1", pointBalance: 450 }, [], input, config).ok).toBe(true);
  });
  it("L1 不能送亲友（无论哪种礼物）", () => {
    const gift = { forWhom: "gift" as const, giftType: "free_basque" as const };
    expect(decideReservation({ levelName: "L1", pointBalance: 999 }, [], gift, config).denial)
      .toBe("GIFT_NOT_ALLOWED");
  });
  it("积分等级选免费巴斯克 → BENEFIT_NOT_AVAILABLE", () => {
    const input = { forWhom: "self" as const, giftType: "free_basque" as const };
    expect(decideReservation({ levelName: "L4", pointBalance: 900 }, [], input, config).denial)
      .toBe("BENEFIT_NOT_AVAILABLE");
  });
  it("L4 送亲友且余额够则放行", () => {
    const input = { forWhom: "gift" as const, giftType: "points_450" as const };
    expect(decideReservation({ levelName: "L4", pointBalance: 500 }, [], input, config).ok).toBe(true);
  });
});

describe("pickupWindow 取货窗口", () => {
  it("默认提前 2 天、最长 30 天（吉隆坡时区）", () => {
    const w = pickupWindow(makeConfig(), new Date("2026-08-15T04:00:00.000Z"));
    expect(w.minDate).toBe("2026-08-17");
    expect(w.maxDate).toBe("2026-09-14");
  });
});

