import { afterEach, describe, expect, it, vi } from "vitest";

import { notifyStore } from "@/lib/birthday/notify";

const reservation = {
  reservationId: 7,
  giftType: "free_basque" as const,
  forWhom: "self" as const,
  recipientNote: null,
  pickupDate: "2026-08-20",
  slot: "noon" as const,
  memberNote: null,
  status: "reserved" as const,
  createdAt: "2026-08-15T04:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("notifyStore", () => {
  it("未配置 webhook 时静默跳过", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(notifyStore(undefined, { reservation, maskedPhone: null, levelName: null, pointsSnapshot: null, allergies: null }))
      .resolves.toBe("skipped");
    expect(info).toHaveBeenCalled();
  });

  it("发送成功返回 sent，消息体含取货日期与过敏原", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await notifyStore("https://open.larksuite.com/open-apis/bot/v2/hook/abc", {
      reservation, maskedPhone: "**** 1234", levelName: "L1", pointsSnapshot: 120, allergies: "坚果",
    });
    expect(outcome).toBe("sent");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.content.text).toContain("2026-08-20");
    expect(body.content.text).toContain("坚果");
    expect(body.content.text).toContain("**** 1234");
  });

  it("非 200 与网络异常都算 failed 且不抛", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(notifyStore("https://example.com/hook", { reservation, maskedPhone: null, levelName: null, pointsSnapshot: null, allergies: null }))
      .resolves.toBe("failed");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(notifyStore("https://example.com/hook", { reservation, maskedPhone: null, levelName: null, pointsSnapshot: null, allergies: null }))
      .resolves.toBe("failed");
    expect(err).toHaveBeenCalled();
  });
});
