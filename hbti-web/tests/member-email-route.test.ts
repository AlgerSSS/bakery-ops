import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  readHbtiAuthSession: vi.fn(),
  saveMemberEmail: vi.fn(),
  readHbtiServerConfig: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  readHbtiAuthSession: routeMocks.readHbtiAuthSession,
}));

vi.mock("@/lib/member/email-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/member/email-store")>(
    "@/lib/member/email-store",
  );
  return { ...actual, saveMemberEmail: routeMocks.saveMemberEmail };
});

vi.mock("@/lib/server-config", () => ({
  readHbtiServerConfig: routeMocks.readHbtiServerConfig,
}));

import { POST } from "@/app/api/member/email/route";
import { InvalidMemberEmailError } from "@/lib/member/email-store";

const ORIGIN = "https://hbti-test.hotcrush.net";

describe("POST /api/member/email", () => {
  beforeEach(() => {
    vi.stubEnv("HBTI_LINK_BASE_URL", ORIGIN);
    vi.stubEnv("HBTI_CAMPAIGN_VERSION", "test-campaign");
    vi.stubEnv("RES_COUPON_TEMPLATE_NAME", "test-template");
    vi.stubEnv("RES_MEMBER_WALLET_URL", "https://example.com/wallet");
    routeMocks.readHbtiAuthSession.mockReset();
    routeMocks.saveMemberEmail.mockReset();
    routeMocks.readHbtiServerConfig.mockReset();
    routeMocks.readHbtiServerConfig.mockReturnValue({ linkBaseUrl: ORIGIN });
    routeMocks.readHbtiAuthSession.mockResolvedValue({
      payload: { memberId: "member-1" },
    });
    routeMocks.saveMemberEmail.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores email only for the authenticated member and does not echo the PII", async () => {
    const response = await POST(emailRequest({ email: "hello@example.com" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ emailCollected: true });
    expect(JSON.stringify(body)).not.toContain("hello@example.com");
    expect(routeMocks.saveMemberEmail).toHaveBeenCalledWith(
      "member-1",
      "hello@example.com",
    );
  });

  it("requires a valid session before accepting email", async () => {
    routeMocks.readHbtiAuthSession.mockResolvedValue(null);

    const response = await POST(emailRequest({ email: "hello@example.com" }));

    expect(response.status).toBe(401);
    expect(routeMocks.saveMemberEmail).not.toHaveBeenCalled();
  });

  it("returns a stable client error for an invalid email", async () => {
    routeMocks.saveMemberEmail.mockRejectedValue(new InvalidMemberEmailError());

    const response = await POST(emailRequest({ email: "not-an-email" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "INVALID_EMAIL" });
  });

  it("rejects cross-site writes before reading the member session", async () => {
    const response = await POST(
      emailRequest({ email: "hello@example.com" }, "https://attacker.example"),
    );

    expect(response.status).toBe(403);
    expect(routeMocks.readHbtiAuthSession).not.toHaveBeenCalled();
    expect(routeMocks.saveMemberEmail).not.toHaveBeenCalled();
  });
});

function emailRequest(
  body: Record<string, unknown>,
  origin = ORIGIN,
): Request {
  return new Request(`${ORIGIN}/api/member/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": origin === ORIGIN ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  });
}
