import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemberLinkToken } from "@/lib/member-link/crypto";

const routeMocks = vi.hoisted(() => ({
  completeHbti: vi.fn(),
  createCompletionStoreFromEnv: vi.fn(),
  createResApiClientFromEnv: vi.fn(),
  consumeTokenRateLimit: vi.fn(),
}));

vi.mock("@/lib/completion/complete-hbti", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/completion/complete-hbti")
  >("@/lib/completion/complete-hbti");
  return { ...actual, completeHbti: routeMocks.completeHbti };
});

vi.mock("@/lib/store/mongo-completion-store", () => ({
  createCompletionStoreFromEnv: routeMocks.createCompletionStoreFromEnv,
}));

vi.mock("@/lib/res/client", () => ({
  createResApiClientFromEnv: routeMocks.createResApiClientFromEnv,
}));

vi.mock("@/lib/rate-limit/mongo-rate-limit", () => ({
  consumeTokenRateLimit: routeMocks.consumeTokenRateLimit,
}));

import { POST } from "@/app/api/complete/route";

const ORIGIN = "https://hbti-test.hotcrush.net";
const LINK_SECRET = "l".repeat(48);
const CAMPAIGN_VERSION = "2026-08-pistachio-v1";
const validAnswers = {
  q1: "iced",
  q2: "light",
  q3: "bitter",
  q4: "alone",
  q5: "morning",
  q6: "drink",
} as const;

describe("complete route", () => {
  beforeEach(() => {
    stubValidServerEnvironment();
    routeMocks.completeHbti.mockReset();
    routeMocks.createCompletionStoreFromEnv.mockReset();
    routeMocks.createResApiClientFromEnv.mockReset();
    routeMocks.consumeTokenRateLimit.mockReset();
    routeMocks.createCompletionStoreFromEnv.mockResolvedValue({
      kind: "fake-store",
    });
    routeMocks.createResApiClientFromEnv.mockReturnValue({
      kind: "fake-res",
    });
    routeMocks.consumeTokenRateLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
    routeMocks.completeHbti.mockResolvedValue({
      status: "issued",
      code: "ILBA",
      visitTime: "morning",
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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a completion without the required colour before creating dependencies", async () => {
    const response = await POST(
      completionRequest({
        token: createValidToken(),
        answers: validAnswers,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_REQUEST",
      retryable: false,
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(routeMocks.createCompletionStoreFromEnv).not.toHaveBeenCalled();
    expect(routeMocks.createResApiClientFromEnv).not.toHaveBeenCalled();
    expect(routeMocks.completeHbti).not.toHaveBeenCalled();
    expect(routeMocks.consumeTokenRateLimit).not.toHaveBeenCalled();
  });

  it("rejects an untrusted Origin before decrypting or calling RES and Mongo", async () => {
    const response = await POST(
      completionRequest(
        {
          token: createValidToken(),
          answers: validAnswers,
          color: "pistachio",
        },
        "https://attacker.example",
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "INVALID_ORIGIN",
      retryable: false,
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(routeMocks.createCompletionStoreFromEnv).not.toHaveBeenCalled();
    expect(routeMocks.createResApiClientFromEnv).not.toHaveBeenCalled();
    expect(routeMocks.completeHbti).not.toHaveBeenCalled();
    expect(routeMocks.consumeTokenRateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After before creating RES or Mongo dependencies", async () => {
    routeMocks.consumeTokenRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 91,
    });
    const token = createValidToken();

    const response = await POST(
      completionRequest({
        token,
        answers: validAnswers,
        color: "pistachio",
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "RATE_LIMITED",
      retryable: true,
    });
    expect(response.headers.get("retry-after")).toBe("91");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(routeMocks.consumeTokenRateLimit).toHaveBeenCalledWith({
      scope: "complete",
      token,
      limit: 60,
      windowMs: 5 * 60_000,
    });
    expect(routeMocks.createCompletionStoreFromEnv).not.toHaveBeenCalled();
    expect(routeMocks.createResApiClientFromEnv).not.toHaveBeenCalled();
    expect(routeMocks.completeHbti).not.toHaveBeenCalled();
  });

  it("accepts a valid completion without optional gender or age and never exposes the receipt ID", async () => {
    const response = await POST(
      completionRequest({
        token: createValidToken(),
        answers: validAnswers,
        color: "pistachio",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(body).toMatchObject({
      status: "issued",
      code: "ILBA",
      color: "pistachio",
      reward: { couponTemplateName: "Pistachio Green Jewel" },
    });
    expect(JSON.stringify(body)).not.toContain("server-only-coupon-id");
    expect(routeMocks.completeHbti).toHaveBeenCalledOnce();
    expect(routeMocks.completeHbti.mock.calls[0][0]).toEqual({
      phone: "+12025550123",
      campaignVersion: CAMPAIGN_VERSION,
      answers: validAnswers,
      color: "pistachio",
    });
    expect(routeMocks.consumeTokenRateLimit).toHaveBeenCalledWith({
      scope: "complete",
      token: expect.any(String),
      limit: 60,
      windowMs: 5 * 60_000,
    });
  });
});

function stubValidServerEnvironment(): void {
  vi.stubEnv("HBTI_LINK_SECRET", LINK_SECRET);
  vi.stubEnv("HBTI_MEMBER_HASH_SECRET", "m".repeat(48));
  vi.stubEnv("HBTI_LINK_BASE_URL", ORIGIN);
  vi.stubEnv("HBTI_CAMPAIGN_VERSION", CAMPAIGN_VERSION);
  vi.stubEnv("RES_COUPON_TEMPLATE_NAME", "Pistachio Green Jewel");
  vi.stubEnv(
    "RES_MEMBER_WALLET_URL",
    "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex",
  );
}

function createValidToken(): string {
  return createMemberLinkToken({
    phone: "+1 202 555 0123",
    campaignVersion: CAMPAIGN_VERSION,
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    secret: LINK_SECRET,
  });
}

function completionRequest(
  body: Record<string, unknown>,
  origin = ORIGIN,
): Request {
  return new Request(`${ORIGIN}/api/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}
