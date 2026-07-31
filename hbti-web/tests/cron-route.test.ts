import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  createCompletionStoreFromEnv: vi.fn(),
  purgeExpired: vi.fn(),
  createResApiClientFromEnv: vi.fn(),
  readHbtiServerConfig: vi.fn(),
  reconcilePendingCompletions: vi.fn(),
  resolveEnabledCouponTemplateByName: vi.fn(),
}));

vi.mock("@/lib/completion/reconcile-pending", () => ({
  reconcilePendingCompletions: routeMocks.reconcilePendingCompletions,
}));

vi.mock("@/lib/store/pg-completion-store", () => ({
  createCompletionStoreFromEnv: routeMocks.createCompletionStoreFromEnv,
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
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
    routeMocks.createCompletionStoreFromEnv.mockReset();
    routeMocks.purgeExpired.mockReset();
    routeMocks.purgeExpired.mockResolvedValue(0);
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
    });
    expect(response.headers.get("cache-control")).toBe(
      "no-store, max-age=0",
    );
  });

  it("fails closed before database reconciliation when RES readiness fails", async () => {
    routeMocks.resolveEnabledCouponTemplateByName.mockRejectedValue(
      new Error("expired credential"),
    );

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(routeMocks.createCompletionStoreFromEnv).not.toHaveBeenCalled();
    expect(routeMocks.reconcilePendingCompletions).not.toHaveBeenCalled();
  });
});
