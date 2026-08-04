import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  hasAlertDestination: vi.fn(),
  createCompletionStoreFromEnv: vi.fn(),
  purgeExpired: vi.fn(),
  deliverPendingReviewAlerts: vi.fn(),
  createResApiClientFromEnv: vi.fn(),
  readHbtiServerConfig: vi.fn(),
  reconcilePendingCompletions: vi.fn(),
  resolveEnabledCouponTemplateByName: vi.fn(),
}));

vi.mock("@/lib/alert", () => ({
  hasAlertDestination: routeMocks.hasAlertDestination,
}));

vi.mock("@/lib/completion/reconcile-pending", () => ({
  reconcilePendingCompletions: routeMocks.reconcilePendingCompletions,
}));

vi.mock("@/lib/store/pg-completion-store", () => ({
  createCompletionStoreFromEnv: routeMocks.createCompletionStoreFromEnv,
  deliverPendingReviewAlerts: routeMocks.deliverPendingReviewAlerts,
  purgeExpired: routeMocks.purgeExpired,
}));

vi.mock("@/lib/res/client", () => ({
  createResApiClientFromEnv: routeMocks.createResApiClientFromEnv,
}));

vi.mock("@/lib/server-config", () => ({
  readHbtiServerConfig: routeMocks.readHbtiServerConfig,
}));

import { GET } from "@/app/api/cron/reconcile/route";

const CRON_SECRET = "c".repeat(48);
const request = () =>
  new Request("https://hbti-test.hotcrush.net/api/cron/reconcile", {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

describe("cron reconciliation route", () => {
  beforeEach(() => {
    routeMocks.hasAlertDestination.mockReset();
    routeMocks.hasAlertDestination.mockReturnValue(true);
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    routeMocks.createCompletionStoreFromEnv.mockReset();
    routeMocks.purgeExpired.mockReset();
    routeMocks.purgeExpired.mockResolvedValue(0);
    routeMocks.deliverPendingReviewAlerts.mockReset();
    routeMocks.deliverPendingReviewAlerts.mockResolvedValue({
      claimed: 0,
      sent: 0,
    });
    routeMocks.createResApiClientFromEnv.mockReset();
    routeMocks.readHbtiServerConfig.mockReset();
    routeMocks.reconcilePendingCompletions.mockReset();
    routeMocks.resolveEnabledCouponTemplateByName.mockReset();

    routeMocks.readHbtiServerConfig.mockReturnValue({
      couponTemplateName: "Pistachio Green Jewel",
    });
    routeMocks.createResApiClientFromEnv.mockReturnValue({
      resolveEnabledCouponTemplateByName:
        routeMocks.resolveEnabledCouponTemplateByName,
    });
    routeMocks.resolveEnabledCouponTemplateByName.mockResolvedValue({
      id: "template-1",
      name: "Pistachio Green Jewel",
    });
    routeMocks.createCompletionStoreFromEnv.mockResolvedValue({
      kind: "fake-store",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs the read-only RES readiness probe before reconciliation", async () => {
    routeMocks.reconcilePendingCompletions.mockResolvedValue({
      scanned: 1,
      issued: 1,
      processing: 0,
      review: 0,
      errors: 0,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      scanned: 1,
      issued: 1,
      processing: 0,
      review: 0,
      errors: 0,
      purged: 0,
      purgeOk: true,
      alerts: { claimed: 0, sent: 0 },
      alertsOk: true,
    });
    expect(
      routeMocks.resolveEnabledCouponTemplateByName,
    ).toHaveBeenCalledWith("Pistachio Green Jewel");
    expect(
      routeMocks.resolveEnabledCouponTemplateByName.mock.invocationCallOrder[0],
    ).toBeLessThan(
      routeMocks.reconcilePendingCompletions.mock.invocationCallOrder[0],
    );
    expect(response.headers.get("cache-control")).toBe(
      "no-store, max-age=0",
    );
  });

  it("fails closed when review alerts have no destination", async () => {
    routeMocks.hasAlertDestination.mockReturnValue(false);
    routeMocks.reconcilePendingCompletions.mockResolvedValue({
      scanned: 0,
      issued: 0,
      processing: 0,
      review: 0,
      errors: 0,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      alertsOk: false,
    });
    expect(routeMocks.deliverPendingReviewAlerts).not.toHaveBeenCalled();
  });

  // 这次改动的核心分支:清理抛异常时,一次成功的对账不该被判失败。
  // 旧代码 `.catch(() => -1)` 连日志都不留,失败与「本来就没有过期行」不可区分。
  it("keeps a successful reconciliation green when cleanup throws, and says so", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    routeMocks.reconcilePendingCompletions.mockResolvedValue({
      scanned: 1,
      issued: 1,
      processing: 0,
      review: 0,
      errors: 0,
    });
    routeMocks.purgeExpired.mockRejectedValue(new Error("relation missing"));

    const response = await GET(request());

    // 200,不是 503:清理是卫生工作,正确性不依赖它。
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      scanned: 1,
      issued: 1,
      processing: 0,
      review: 0,
      errors: 0,
      purged: 0,
      purgeOk: false,
      alerts: { claimed: 0, sent: 0 },
      alertsOk: true,
    });
    // 且没有掉进外层 catch--那会返回不带 scanned 的裸 { ok: false }。
    expect(consoleError).toHaveBeenCalledWith(
      "[cron/reconcile] purgeExpired failed",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("returns 503 when reconciliation reports any record error", async () => {
    routeMocks.reconcilePendingCompletions.mockResolvedValue({
      scanned: 2,
      issued: 0,
      processing: 1,
      review: 0,
      errors: 1,
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      scanned: 2,
      issued: 0,
      processing: 1,
      review: 0,
      errors: 1,
      purged: 0,
      purgeOk: true,
      alerts: { claimed: 0, sent: 0 },
      alertsOk: true,
    });
    expect(response.headers.get("cache-control")).toBe(
      "no-store, max-age=0",
    );
  });

  it("fails closed before database reconciliation when RES readiness fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    routeMocks.resolveEnabledCouponTemplateByName.mockRejectedValue(
      new Error("expired credential"),
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(routeMocks.createCompletionStoreFromEnv).not.toHaveBeenCalled();
    expect(routeMocks.reconcilePendingCompletions).not.toHaveBeenCalled();
    // 503 也要带上清理与告警的结果——裸 { ok: false } 分不清哪一路挂了。
    await expect(response.json()).resolves.toEqual({
      ok: false,
      purged: 0,
      purgeOk: true,
      alerts: { claimed: 0, sent: 0 },
      alertsOk: true,
    });
    consoleError.mockRestore();
  });

  // 这条是 2026-08-04 那个真实故障的回归闸：清理曾排在 RES 探测之后、同一个 try 里，
  // RES 一抖就整个 handler 走 catch，连续四个调度点一次都没收过过期行。
  it("RES 探测失败时仍然执行清理与告警重试", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    routeMocks.purgeExpired.mockResolvedValue(111);
    routeMocks.deliverPendingReviewAlerts.mockResolvedValue({
      claimed: 2,
      sent: 2,
    });
    routeMocks.resolveEnabledCouponTemplateByName.mockRejectedValue(
      new Error("expired credential"),
    );

    const response = await GET(request());

    expect(routeMocks.purgeExpired).toHaveBeenCalledTimes(1);
    expect(routeMocks.deliverPendingReviewAlerts).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      purged: 111,
      purgeOk: true,
      alerts: { claimed: 2, sent: 2 },
      alertsOk: true,
    });
    consoleError.mockRestore();
  });
});
