import { describe, expect, it } from "vitest";

import { deriveLevelKey, type BirthdayConfig } from "@/lib/birthday/config";
import {
  decideReservation,
  listBirthdayOptions,
  pickupWindow,
  resolveBenefits,
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
      L1: [],
      L2: [{ kind: "free_basque", allowGift: false, yearlyLimit: 1, label: "免费巴斯克" }],
      L3: [
        { kind: "free_basque", allowGift: false, yearlyLimit: 1, label: "免费巴斯克" },
        { kind: "points_450", allowGift: false, yearlyLimit: null, label: "450积分兑换" },
      ],
      L4: [
        { kind: "free_basque", allowGift: false, yearlyLimit: 1, label: "免费巴斯克" },
        { kind: "points_450", allowGift: true, yearlyLimit: null, label: "450积分兑换(可送亲友)" },
      ],
    },
    defaultBenefits: [],
    notifyWebhook: undefined,
    ...overrides,
  };
}

describe("deriveLevelKey 等级升级线（用户定版）", () => {
  it("注册即 L1，累计消费逐级升级", () => {
    expect(deriveLevelKey(0)).toBe("L1");
    expect(deriveLevelKey(249.99)).toBe("L1");
    expect(deriveLevelKey(250)).toBe("L2");
    expect(deriveLevelKey(749.99)).toBe("L2");
    expect(deriveLevelKey(750)).toBe("L3");
    expect(deriveLevelKey(1499.99)).toBe("L3");
    expect(deriveLevelKey(1500)).toBe("L4");
    expect(deriveLevelKey(4290.45)).toBe("L4");
  });
  it("无消费记录按 L1 初见", () => {
    expect(deriveLevelKey(null)).toBe("L1");
    expect(deriveLevelKey(undefined)).toBe("L1");
  });
});

describe("resolveBenefits 等级权益组", () => {
  const config = makeConfig();
  it("L1 空组（只有贺卡）", () => {
    expect(resolveBenefits("L1", config)).toEqual([]);
  });
  it("L2 只有免费巴斯克", () => {
    expect(resolveBenefits("L2", config).map((r) => r.kind)).toEqual(["free_basque"]);
  });
  it("L3/L4 免费巴斯克 + 积分兑换，L4 可送亲友", () => {
    expect(resolveBenefits("L3", config).map((r) => r.kind)).toEqual(["free_basque", "points_450"]);
    expect(resolveBenefits("L3", config)[1].allowGift).toBe(false);
    expect(resolveBenefits("L4", config)[1].allowGift).toBe(true);
  });
  it("未知等级（如 RES 的 VIP1）落默认=只有贺卡", () => {
    expect(resolveBenefits("VIP1", config)).toEqual([]);
    expect(resolveBenefits(null, config)).toEqual([]);
  });
});

describe("listBirthdayOptions 按等级给选项", () => {
  const config = makeConfig();
  it("L1 没有任何蛋糕选项", () => {
    expect(listBirthdayOptions({ levelName: "L1", pointBalance: 9999 }, [], config)).toEqual([]);
  });
  it("L2 只有免费巴斯克——积分再多也不给兑换", () => {
    const options = listBirthdayOptions({ levelName: "L2", pointBalance: 5000 }, [], config);
    expect(options.map((o) => o.giftType)).toEqual(["free_basque"]);
    expect(options[0].available).toBe(true);
  });
  it("L3 双选项，积分兑换限自己", () => {
    const options = listBirthdayOptions({ levelName: "L3", pointBalance: 500 }, [], config);
    expect(options.map((o) => o.giftType)).toEqual(["free_basque", "points_450"]);
    expect(options[0].available).toBe(true);
    expect(options[1].available).toBe(true);
    expect(options[1].allowGift).toBe(false);
  });
  it("L4 双选项，积分兑换可送亲友", () => {
    const options = listBirthdayOptions({ levelName: "L4", pointBalance: 500 }, [], config);
    expect(options[1].allowGift).toBe(true);
  });
  it("L3 积分不足时积分选项给 INSUFFICIENT_POINTS，免费选项不受影响", () => {
    const options = listBirthdayOptions({ levelName: "L3", pointBalance: 120 }, [], config);
    expect(options[0].available).toBe(true);
    expect(options[1].available).toBe(false);
    expect(options[1].deniedReason).toBe("INSUFFICIENT_POINTS");
  });
  it("免费巴斯克已领过后免费选项不可用，积分选项仍可用", () => {
    const existing = [{ giftType: "free_basque" as const, status: "reserved" as const }];
    const options = listBirthdayOptions({ levelName: "L4", pointBalance: 900 }, existing, config);
    expect(options[0].available).toBe(false);
    expect(options[0].deniedReason).toBe("FREE_BASQUE_ALREADY_CLAIMED");
    expect(options[1].available).toBe(true);
  });
  it("进行中的积分预约达到防呆上限", () => {
    const existing = [
      { giftType: "points_450" as const, status: "reserved" as const },
      { giftType: "points_450" as const, status: "reserved" as const },
      { giftType: "points_450" as const, status: "reserved" as const },
    ];
    const options = listBirthdayOptions({ levelName: "L4", pointBalance: 9000 }, existing, config);
    expect(options[1].available).toBe(false);
    expect(options[1].deniedReason).toBe("TOO_MANY_ACTIVE_RESERVATIONS");
  });
});

describe("decideReservation 预约资格", () => {
  const config = makeConfig();
  it("L1 预约任何蛋糕 → BENEFIT_NOT_AVAILABLE", () => {
    const member = { levelName: "L1", pointBalance: 9999 };
    expect(decideReservation(member, [], { forWhom: "self", giftType: "free_basque" }, config).denial)
      .toBe("BENEFIT_NOT_AVAILABLE");
    expect(decideReservation(member, [], { forWhom: "self", giftType: "points_450" }, config).denial)
      .toBe("BENEFIT_NOT_AVAILABLE");
  });
  it("L2 免费巴斯克每年限一份", () => {
    const member = { levelName: "L2", pointBalance: 0 };
    const input = { forWhom: "self" as const, giftType: "free_basque" as const };
    expect(decideReservation(member, [], input, config).ok).toBe(true);
    const existing = [{ giftType: "free_basque" as const, status: "reserved" as const }];
    const second = decideReservation(member, existing, input, config);
    expect(second.ok).toBe(false);
    expect(second.denial).toBe("FREE_BASQUE_ALREADY_CLAIMED");
  });
  it("L2 选积分兑换 → BENEFIT_NOT_AVAILABLE", () => {
    const input = { forWhom: "self" as const, giftType: "points_450" as const };
    expect(decideReservation({ levelName: "L2", pointBalance: 9999 }, [], input, config).denial)
      .toBe("BENEFIT_NOT_AVAILABLE");
  });
  it("L3/L4 可以选免费巴斯克，也可以选积分兑换", () => {
    const free = { forWhom: "self" as const, giftType: "free_basque" as const };
    const points = { forWhom: "self" as const, giftType: "points_450" as const };
    expect(decideReservation({ levelName: "L3", pointBalance: 900 }, [], free, config).ok).toBe(true);
    expect(decideReservation({ levelName: "L3", pointBalance: 900 }, [], points, config).ok).toBe(true);
    expect(decideReservation({ levelName: "L4", pointBalance: 900 }, [], free, config).ok).toBe(true);
    expect(decideReservation({ levelName: "L4", pointBalance: 900 }, [], points, config).ok).toBe(true);
  });
  it("L3 积分兑换要余额够 450", () => {
    const input = { forWhom: "self" as const, giftType: "points_450" as const };
    expect(decideReservation({ levelName: "L3", pointBalance: 449 }, [], input, config).denial)
      .toBe("INSUFFICIENT_POINTS");
  });
  it("L3 不能送亲友，L4 可以", () => {
    const gift = { forWhom: "gift" as const, giftType: "points_450" as const };
    expect(decideReservation({ levelName: "L3", pointBalance: 900 }, [], gift, config).denial)
      .toBe("GIFT_NOT_ALLOWED");
    expect(decideReservation({ levelName: "L4", pointBalance: 900 }, [], gift, config).ok).toBe(true);
  });
});

describe("pickupWindow 取货窗口", () => {
  it("默认提前 2 天、最长 30 天（吉隆坡时区）", () => {
    const w = pickupWindow(makeConfig(), new Date("2026-08-15T04:00:00.000Z"));
    expect(w.minDate).toBe("2026-08-17");
    expect(w.maxDate).toBe("2026-09-14");
  });
});

