import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  readHbtiAuthSession: vi.fn(),
  getHbtiCompletionStatus: vi.fn(),
  createCompletionStoreFromEnv: vi.fn(),
  createResApiClientFromEnv: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  readHbtiAuthSession: routeMocks.readHbtiAuthSession,
}));

vi.mock("@/lib/completion/complete-hbti", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/completion/complete-hbti")
  >("@/lib/completion/complete-hbti");
  return {
    ...actual,
    getHbtiCompletionStatus: routeMocks.getHbtiCompletionStatus,
  };
});

vi.mock("@/lib/store/pg-completion-store", () => ({
  createCompletionStoreFromEnv: routeMocks.createCompletionStoreFromEnv,
}));

vi.mock("@/lib/res/client", () => ({
  createResApiClientFromEnv: routeMocks.createResApiClientFromEnv,
}));

import { GET } from "@/app/api/complete/status/route";

const ORIGIN = "https://hbti-test.hotcrush.net";
const CAMPAIGN_VERSION = "2026-08-pistachio-v1";

describe("completion status route", () => {
  beforeEach(() => {
    stubValidServerEnvironment();
    routeMocks.readHbtiAuthSession.mockReset();
    routeMocks.getHbtiCompletionStatus.mockReset();
    routeMocks.createCompletionStoreFromEnv.mockReset();
    routeMocks.createResApiClientFromEnv.mockReset();
    routeMocks.createCompletionStoreFromEnv.mockResolvedValue({
      kind: "fake-store",
    });
    routeMocks.createResApiClientFromEnv.mockReturnValue({
      kind: "fake-res",
    });
    routeMocks.readHbtiAuthSession.mockResolvedValue({
      payload: {
        resToken: "server-only-res-token",
        memberId: "member-1",
        identity: {
          countryCode: "+60",
          isoCode: "MY",
          phone: "123456789",
          e164: "+60123456789",
        },
      },
      expiresAt: new Date("2026-07-30T10:00:00.000Z"),
      draftKey: "server-only-draft-key",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires the encrypted member session before reading completion state", async () => {
    routeMocks.readHbtiAuthSession.mockResolvedValue(null);

    const response = await GET(statusRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "AUTHENTICATION_REQUIRED",
      retryable: false,
    });
    expect(routeMocks.getHbtiCompletionStatus).not.toHaveBeenCalled();
    expect(routeMocks.createCompletionStoreFromEnv).not.toHaveBeenCalled();
  });

  it("returns the authenticated member status without exposing the coupon id", async () => {
    routeMocks.getHbtiCompletionStatus.mockResolvedValue({
      status: "issued",
      code: "ISBA",
      visitTime: "night",
      category: "drink",
      color: "pistachio",
      reward: {
        couponTemplateName: "Pistachio Green Jewel",
        newCouponId: "server-only-coupon-id",
        usableCouponCountBefore: 1,
        usableCouponCountAfter: 2,
        confirmedAt: "2026-07-30T08:00:00.000Z",
      },
    });

    const response = await GET(statusRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(body).toMatchObject({
      status: "issued",
      reward: { couponTemplateName: "Pistachio Green Jewel" },
    });
    expect(JSON.stringify(body)).not.toContain("server-only-coupon-id");
    expect(routeMocks.getHbtiCompletionStatus).toHaveBeenCalledWith(
      {
        phone: "+60123456789",
        expectedMemberId: "member-1",
        campaignVersion: CAMPAIGN_VERSION,
      },
      {
        store: { kind: "fake-store" },
        res: { kind: "fake-res" },
        memberHashSecret: new TextEncoder().encode("m".repeat(48)),
      },
    );
  });

  it("returns a read-only not-found state instead of issuing a coupon", async () => {
    routeMocks.getHbtiCompletionStatus.mockResolvedValue(null);

    const response = await GET(statusRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      status: "not_found",
      retryable: true,
    });
  });
});

function statusRequest(): Request {
  return new Request(`${ORIGIN}/api/complete/status`, {
    headers: { Origin: ORIGIN },
  });
}

function stubValidServerEnvironment(): void {
  vi.stubEnv("HBTI_LINK_SECRET", "l".repeat(48));
  vi.stubEnv("HBTI_MEMBER_HASH_SECRET", "m".repeat(48));
  vi.stubEnv("HBTI_LINK_BASE_URL", ORIGIN);
  vi.stubEnv("HBTI_CAMPAIGN_VERSION", CAMPAIGN_VERSION);
  vi.stubEnv("RES_COUPON_TEMPLATE_NAME", "Pistachio Green Jewel");
  vi.stubEnv(
    "RES_MEMBER_WALLET_URL",
    "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex",
  );
}
