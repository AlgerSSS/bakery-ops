import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isTrustedRequestOrigin,
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

  it("keeps member identity hashing independent from link-key rotation", () => {
    vi.stubEnv("HBTI_LINK_SECRET", "l".repeat(48));
    vi.stubEnv("HBTI_MEMBER_HASH_SECRET", "m".repeat(48));
    vi.stubEnv("HBTI_LINK_BASE_URL", expectedOrigin);
    vi.stubEnv("HBTI_CAMPAIGN_VERSION", "campaign-v1");
    vi.stubEnv("RES_COUPON_TEMPLATE_NAME", "Pistachio Green Jewel");
    vi.stubEnv(
      "RES_MEMBER_WALLET_URL",
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex",
    );

    const first = readHbtiServerConfig();
    vi.stubEnv("HBTI_LINK_SECRET", "r".repeat(48));
    const rotated = readHbtiServerConfig();

    expect(first.linkSecret).not.toBe(rotated.linkSecret);
    expect(first.memberHashSecret).toEqual(rotated.memberHashSecret);
    expect(new TextDecoder().decode(first.memberHashSecret)).toBe(
      "m".repeat(48),
    );
  });

  it("rejects reusing the link secret as the member hash secret", () => {
    vi.stubEnv("HBTI_LINK_SECRET", "s".repeat(48));
    vi.stubEnv("HBTI_MEMBER_HASH_SECRET", "s".repeat(48));
    vi.stubEnv("HBTI_LINK_BASE_URL", expectedOrigin);
    vi.stubEnv("HBTI_CAMPAIGN_VERSION", "campaign-v1");
    vi.stubEnv("RES_COUPON_TEMPLATE_NAME", "Pistachio Green Jewel");
    vi.stubEnv(
      "RES_MEMBER_WALLET_URL",
      "https://f4klzbmr9n2d.m.sea.restosuite.ai/couponIndex",
    );

    expect(() => readHbtiServerConfig()).toThrow(
      "must be independent from HBTI_LINK_SECRET",
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
