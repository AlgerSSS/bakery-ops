import { afterEach, describe, expect, it, vi } from "vitest";

import { readBirthdayConfig } from "@/lib/birthday/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readBirthdayConfig", () => {
  it("缺密钥时 fail closed", () => {
    vi.stubEnv("BIRTHDAY_LINK_SECRET", "");
    expect(() => readBirthdayConfig()).toThrow("BIRTHDAY_LINK_SECRET");
  });

  it("密钥太短也 fail closed", () => {
    vi.stubEnv("BIRTHDAY_LINK_SECRET", "short");
    expect(() => readBirthdayConfig()).toThrow("32 bytes");
  });

  it("默认配置完整可读：最新五等级与年度生日礼二选一", () => {
    vi.stubEnv("BIRTHDAY_LINK_SECRET", "s".repeat(32));
    vi.stubEnv("BIRTHDAY_NOTIFY_WEBHOOK", "");
    const config = readBirthdayConfig();
    expect(config.linkTtlDays).toBe(30);
    expect(config.pickupLeadDaysByGift).toEqual({
      free_basque: 2,
      points_450: 3,
    });
    expect(config.benefitsByLevel.L1).toEqual([]);
    expect(config.benefitsByLevel.L2.map((r) => r.kind)).toEqual(["free_basque"]);
    expect(config.benefitsByLevel.L3.map((r) => r.kind)).toEqual([
      "free_basque",
      "points_450",
    ]);
    expect(config.benefitsByLevel.L3[1].allowGift).toBe(false);
    expect(config.benefitsByLevel.L3[1].yearlyLimit).toBe(1);
    expect(config.benefitsByLevel.L4[1].allowGift).toBe(true);
    expect(config.benefitsByLevel.L4[1].yearlyLimit).toBe(1);
    expect(config.benefitsByLevel.L5[1].allowGift).toBe(true);
    expect(config.defaultBenefits).toEqual([]);
    expect(config.notifyWebhook).toBeUndefined();
  });

  it("BIRTHDAY_BENEFITS_JSON 可整体覆盖权益映射（每个等级一个数组）", () => {
    vi.stubEnv("BIRTHDAY_LINK_SECRET", "s".repeat(32));
    vi.stubEnv("BIRTHDAY_BENEFITS_JSON", JSON.stringify({
      VIP1: [{ kind: "points_450", allowGift: false, yearlyLimit: null, label: "兑换" }],
    }));
    const config = readBirthdayConfig();
    expect(config.benefitsByLevel.VIP1[0].kind).toBe("points_450");
    expect(config.benefitsByLevel.L1).toBeUndefined();
  });

  it("权益 JSON 非法时报配置错误而不是静默走默认", () => {
    vi.stubEnv("BIRTHDAY_LINK_SECRET", "s".repeat(32));
    vi.stubEnv("BIRTHDAY_BENEFITS_JSON", "{not json");
    expect(() => readBirthdayConfig()).toThrow("BIRTHDAY_BENEFITS_JSON");
  });

  it("webhook 只认裸 HTTPS 地址", () => {
    vi.stubEnv("BIRTHDAY_LINK_SECRET", "s".repeat(32));
    vi.stubEnv("BIRTHDAY_NOTIFY_WEBHOOK", "http://insecure.example/hook");
    expect(readBirthdayConfig().notifyWebhook).toBeUndefined();
    vi.stubEnv("BIRTHDAY_NOTIFY_WEBHOOK", "https://open.larksuite.com/open-apis/bot/v2/hook/abc");
    expect(readBirthdayConfig().notifyWebhook).toContain("larksuite");
  });
});
