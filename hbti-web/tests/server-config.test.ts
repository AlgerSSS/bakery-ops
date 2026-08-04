import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isTrustedRequestOrigin,
  readHbtiAuthConfig,
  readHbtiServerConfig,
} from "@/lib/server-config";

const expectedOrigin = "https://hbti-test.hotcrush.net";

describe("isTrustedRequestOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts same-origin browser requests and server calls without Origin", () => {
    expect(
      isTrustedRequestOrigin(
        new Request(`${expectedOrigin}/api/session`, {
          headers: { Origin: expectedOrigin },
        }),
        expectedOrigin,
      ),
    ).toBe(true);
    expect(
      isTrustedRequestOrigin(
        new Request(`${expectedOrigin}/api/session`),
        expectedOrigin,
      ),
    ).toBe(true);
  });

  it("reads the campaign configuration behind the verified wallet host", () => {
    stubServerConfigEnvironment();

    expect(readHbtiServerConfig()).toEqual({
      campaignVersion: "2026-08-pistachio-v1",
      couponTemplateName: "Pistachio Green Jewel",
      linkBaseUrl: expectedOrigin,
      memberWalletUrl:
        "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex",
    });
  });

  it("rejects a member wallet URL pointing anywhere but the verified RES H5 host", () => {
    stubServerConfigEnvironment();
    vi.stubEnv("RES_MEMBER_WALLET_URL", "https://attacker.example/couponIndex");

    expect(() => readHbtiServerConfig()).toThrow(
      "RES_MEMBER_WALLET_URL must use the verified RES H5 host.",
    );
  });

  it("rejects a plaintext HTTP link base URL", () => {
    stubServerConfigEnvironment();
    vi.stubEnv("HBTI_LINK_BASE_URL", "http://hbti-test.hotcrush.net");

    expect(() => readHbtiServerConfig()).toThrow(
      "HBTI_LINK_BASE_URL must use HTTPS.",
    );
  });

  it("reads the pinned RES H5 member-auth configuration", () => {
    vi.stubEnv("HBTI_AUTH_SECRET", "a".repeat(48));
    vi.stubEnv(
      "RES_H5_BASE_URL",
      "https://f4klzbmr9n2d.m.sea.restosuite.ai",
    );
    vi.stubEnv("RES_H5_CORPORATION_ID", "450020844");
    vi.stubEnv("RES_H5_APP_ID", "1991043406914285569");
    vi.stubEnv("RES_H5_CARD_PROGRAM_ID", "1991044916737863680");

    expect(readHbtiAuthConfig()).toEqual({
      authSecret: "a".repeat(48),
      h5BaseUrl: "https://f4klzbmr9n2d.m.sea.restosuite.ai",
      corporationId: "450020844",
      appId: "1991043406914285569",
      cardProgramId: "1991044916737863680",
    });
  });

  it("rejects a weak auth secret", () => {
    vi.stubEnv("HBTI_AUTH_SECRET", "too-short");
    vi.stubEnv("RES_H5_CORPORATION_ID", "450020844");
    vi.stubEnv("RES_H5_APP_ID", "1991043406914285569");
    vi.stubEnv("RES_H5_CARD_PROGRAM_ID", "1991044916737863680");

    expect(() => readHbtiAuthConfig()).toThrow(
      "HBTI_AUTH_SECRET must contain at least 32 bytes",
    );
  });

  it("rejects another HTTPS website", () => {
    expect(
      isTrustedRequestOrigin(
        new Request(`${expectedOrigin}/api/session`, {
          headers: { Origin: "https://attacker.example" },
        }),
        expectedOrigin,
      ),
    ).toBe(false);
  });

  it("rejects the right Origin on a Vercel alias host", () => {
    expect(
      isTrustedRequestOrigin(
        new Request("https://hotcrush-hbti.vercel.app/api/session", {
          headers: { Origin: expectedOrigin },
        }),
        expectedOrigin,
      ),
    ).toBe(false);
    expect(
      isTrustedRequestOrigin(
        new Request("https://hotcrush-hbti.vercel.app/api/session"),
        expectedOrigin,
      ),
    ).toBe(false);
  });
});

function stubServerConfigEnvironment(): void {
  vi.stubEnv("HBTI_LINK_BASE_URL", expectedOrigin);
  vi.stubEnv("HBTI_CAMPAIGN_VERSION", "2026-08-pistachio-v1");
  vi.stubEnv("RES_COUPON_TEMPLATE_NAME", "Pistachio Green Jewel");
  vi.stubEnv(
    "RES_MEMBER_WALLET_URL",
    "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex",
  );
}
