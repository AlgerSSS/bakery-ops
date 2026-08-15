import { describe, expect, it } from "vitest";

import {
  buildNoticeText,
  maskPhoneTail,
} from "../../scripts/birthday-notify.mjs";

describe("生日通知 relay 的消息拼装", () => {
  const row = {
    reservation_id: 7,
    gift_type: "free_basque",
    for_whom: "self",
    recipient_note: null,
    pickup_date: "2026-08-20",
    slot: "noon",
    member_note: null,
    level_snapshot: "VIP1",
    points_snapshot: 120,
    allergies: "坚果",
    phone_e164: "+60123456789",
  };

  it("拼出预约号、蛋糕、取货、等级与过敏原", () => {
    const text = buildNoticeText(row);
    expect(text).toContain("新的生日礼预约 #7");
    expect(text).toContain("免费巴斯克");
    expect(text).toContain("2026-08-20 午间 12:00–17:00");
    expect(text).toContain("VIP1");
    expect(text).toContain("预约时积分余额：120");
    expect(text).toContain("⚠️ 过敏原：坚果");
    expect(text).toContain("会员：**** 6789");
  });

  it("450 积分兑换标注 POS 扣积分", () => {
    const text = buildNoticeText({ ...row, gift_type: "points_450" });
    expect(text).toContain("450 积分兑换（取货时 POS 扣积分）");
  });

  it("送亲友时带上称呼", () => {
    const text = buildNoticeText({ ...row, for_whom: "gift", recipient_note: "妈妈" });
    expect(text).toContain("亲友（妈妈）");
  });

  it("手机号只留尾号 4 位", () => {
    expect(maskPhoneTail("+60123456789")).toBe("**** 6789");
    expect(maskPhoneTail(null)).toBe(null);
    expect(maskPhoneTail("123")).toBe(null);
  });
});
