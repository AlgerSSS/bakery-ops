import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemberLinkToken } from "@/lib/member-link/crypto";

const routeMocks = vi.hoisted(() => ({
  consumeTokenRateLimit: vi.fn(),
}));

vi.mock("@/lib/rate-limit/mongo-rate-limit", () => ({
  consumeTokenRateLimit: routeMocks.consumeTokenRateLimit,
}));

import { POST } from "@/app/api/session/route";

const ORIGIN = "https://hbti-test.hotcrush.net";
const LINK_SECRET = "l".repeat(48);
const MEMBER_HASH_SECRET = "m".repeat(48);
const CAMPAIGN_VERSION = "2026-08-pistachio-v1";

describe("session route", () => {
  beforeEach(() => {
    stubValidServerEnvironment();
    routeMocks.consumeTokenRateLimit.mockReset();
    routeMocks.consumeTokenRateLimit.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a tampered invitation without exposing cacheable member state", async () => {
    const token = createToken(Math.floor(Date.now() / 1_000) + 3_600);
    const bytes = Buffer.from(token, "base64url");
    bytes[bytes.length - 1] ^= 1;

    const response = await POST(
      sessionRequest(bytes.toString("base64url")),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      valid: false,
      error: "INVALID_LINK",
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(routeMocks.consumeTokenRateLimit).not.toHaveBeenCalled();
  });

  it("returns the expired-link contract at the expiry boundary", async () => {
    const response = await POST(
      sessionRequest(createToken(Math.floor(Date.now() / 1_000))),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      valid: false,
      error: "LINK_EXPIRED",
    });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(routeMocks.consumeTokenRateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After after a valid invitation exceeds its limit", async () => {
    routeMocks.consumeTokenRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 37,
    });
    const token = createToken(Math.floor(Date.now() / 1_000) + 3_600);

    const response = await POST(sessionRequest(token));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      valid: false,
      error: "RATE_LIMITED",
    });
    expect(response.headers.get("retry-after")).toBe("37");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(routeMocks.consumeTokenRateLimit).toHaveBeenCalledWith({
      scope: "session",
      token,
      limit: 30,
      windowMs: 60_000,
    });
  });

  it("reports server configuration failure as retryable service unavailability", async () => {
    vi.stubEnv("HBTI_LINK_SECRET", "");

    const response = await POST(
      sessionRequest(createToken(Math.floor(Date.now() / 1_000) + 3_600)),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(routeMocks.consumeTokenRateLimit).not.toHaveBeenCalled();
  });
});

function stubValidServerEnvironment(): void {
  vi.stubEnv("HBTI_LINK_SECRET", LINK_SECRET);
  vi.stubEnv("HBTI_MEMBER_HASH_SECRET", MEMBER_HASH_SECRET);
  vi.stubEnv("HBTI_LINK_BASE_URL", ORIGIN);
  vi.stubEnv("HBTI_CAMPAIGN_VERSION", CAMPAIGN_VERSION);
  vi.stubEnv("RES_COUPON_TEMPLATE_NAME", "Pistachio Green Jewel");
  vi.stubEnv(
    "RES_MEMBER_WALLET_URL",
    "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex",
  );
}

function createToken(expiresAt: number): string {
  return createMemberLinkToken({
    phone: "+1 202 555 0123",
    campaignVersion: CAMPAIGN_VERSION,
    expiresAt,
    secret: LINK_SECRET,
  });
}

function sessionRequest(token: string): Request {
  return new Request(`${ORIGIN}/api/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
    },
    body: JSON.stringify({ token }),
  });
}
