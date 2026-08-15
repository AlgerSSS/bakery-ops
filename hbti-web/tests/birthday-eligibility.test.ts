import { describe, expect, it } from "vitest";

import type { BirthdayConfig } from "@/lib/birthday/config";
import { decideReservation, pickupWindow, resolveBenefit } from "@/lib/birthday/eligibility";

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

describe("decideReservation 预约资格", () => {
  const config = makeConfig();
  it("免费巴斯克每年限一份", () => {
    const member = { levelName: "L1", pointBalance: 0 };
    expect(decideReservation(member, [], { forWhom: "self" }, config).ok).toBe(true);
    const existing = [{ giftType: "free_basque" as const, status: "reserved" as const }];
    const second = decideReservation(member, existing, { forWhom: "self" }, config);
    expect(second.ok).toBe(false);
    expect(second.denial).toBe("FREE_BASQUE_ALREADY_CLAIMED");
  });

  it("已取消的免费预约不占名额", () => {
    const member = { levelName: "L1", pointBalance: 0 };
    const existing = [{ giftType: "free_basque" as const, status: "cancelled" as const }];
    expect(decideReservation(member, existing, { forWhom: "self" }, config).ok).toBe(true);
  });

  it("L1 不能送亲友", () => {
    const d = decideReservation({ levelName: "L1", pointBalance: 999 }, [], { forWhom: "gift" }, config);
    expect(d.denial).toBe("GIFT_NOT_ALLOWED");
  });

  it("积分兑换要余额够 450", () => {
    expect(decideReservation({ levelName: "L3", pointBalance: 449 }, [], { forWhom: "self" }, config).denial)
      .toBe("INSUFFICIENT_POINTS");
    expect(decideReservation({ levelName: "L3", pointBalance: 450 }, [], { forWhom: "self" }, config).ok).toBe(true);
  });

  it("积分预约有防呆上限", () => {
    const member = { levelName: "L4", pointBalance: 9000 };
    const existing = [
      { giftType: "points_450" as const, status: "reserved" as const },
      { giftType: "points_450" as const, status: "reserved" as const },
      { giftType: "points_450" as const, status: "reserved" as const },
    ];
    const d = decideReservation(member, existing, { forWhom: "gift" }, config);
    expect(d.denial).toBe("TOO_MANY_ACTIVE_RESERVATIONS");
  });

  it("L4 送亲友且余额够则放行", () => {
    const d = decideReservation({ levelName: "L4", pointBalance: 500 }, [], { forWhom: "gift" }, config);
    expect(d.ok).toBe(true);
  });
});

describe("pickupWindow 取货窗口", () => {
  it("默认提前 2 天、最长 30 天（吉隆坡时区）", () => {
    const w = pickupWindow(makeConfig(), new Date("2026-08-15T04:00:00.000Z"));
    expect(w.minDate).toBe("2026-08-17");
    expect(w.maxDate).toBe("2026-09-14");
  });
});
