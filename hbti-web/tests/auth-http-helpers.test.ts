import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getJsonMutationRejection,
  noStoreJson,
} from "@/lib/auth/http";
import { maskAuthPhone, normalizeAuthPhone } from "@/lib/auth/phone";
import {
  clearHbtiSessionCookie,
  hbtiSessionCookieName,
  readHbtiSessionCookie,
  setHbtiSessionCookie,
} from "@/lib/auth/session-cookie";

const origin = "https://hbti-test.hotcrush.net";
const sessionToken = "a".repeat(43);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth request helpers", () => {
  it("accepts only same-origin JSON mutations", async () => {
    const request = jsonRequest(`${origin}/api/auth/logout`);

    expect(getJsonMutationRejection(request, origin)).toBeNull();
  });

  it.each([
    {
      headers: { "Content-Type": "text/plain", Origin: origin },
      status: 415,
      error: "UNSUPPORTED_MEDIA_TYPE",
    },
    {
      headers: { "Content-Type": "application/json" },
      status: 403,
      error: "INVALID_ORIGIN",
    },
    {
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
      },
      status: 403,
      error: "INVALID_ORIGIN",
    },
    {
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "Sec-Fetch-Site": "cross-site",
      },
      status: 403,
      error: "INVALID_ORIGIN",
    },
  ])("rejects an unsafe mutation", async ({ headers, status, error }) => {
    const rejection = getJsonMutationRejection(
      new Request(`${origin}/api/auth/logout`, {
        method: "POST",
        headers: Object.entries(headers).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string",
        ),
        body: "{}",
      }),
      origin,
    );

    expect(rejection?.status).toBe(status);
    await expect(rejection?.json()).resolves.toEqual({ error });
    expect(rejection?.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows an exact localhost origin only outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const request = jsonRequest("http://localhost:3000/api/auth/logout", {
      Origin: "http://localhost:3000",
    });
    expect(getJsonMutationRejection(request, origin)).toBeNull();

    vi.stubEnv("NODE_ENV", "production");
    expect(getJsonMutationRejection(request, origin)?.status).toBe(403);
  });

  it("sets no-store headers on every JSON response", () => {
    const response = noStoreJson({ ok: true });

    expect(response.headers.get("cache-control")).toBe(
      "no-store, max-age=0",
    );
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});

describe("auth phone normalization", () => {
  it.each([
    [
      { countryCode: "60", isoCode: "MY", phone: "123456789" },
      "+60123456789",
      "+60 12*****89",
    ],
    [
      { countryCode: "86", isoCode: "CN", phone: "13912345678" },
      "+8613912345678",
      "+86 139****5678",
    ],
    [
      { countryCode: "65", isoCode: "SG", phone: "81234567" },
      "+6581234567",
      "+65 81****67",
    ],
    // Brunei is the shortest national number the table allows, and the only
    // three-digit dial code with a seven-digit number — the combination the
    // mask arithmetic is most likely to get wrong.
    [
      { countryCode: "673", isoCode: "BN", phone: "7123456" },
      "+6737123456",
      "+673 71***56",
    ],
    [
      { countryCode: "886", isoCode: "TW", phone: "912345678" },
      "+886912345678",
      "+886 91*****78",
    ],
    [
      { countryCode: "1", isoCode: "US", phone: "2025550123" },
      "+12025550123",
      "+1 202***0123",
    ],
  ])("normalizes a supported phone", (input, e164, maskedPhone) => {
    expect(normalizeAuthPhone(input)).toEqual({
      identity: { ...input, e164 },
      resPhone: input,
      maskedPhone,
    });
  });

  it.each([
    { countryCode: "+60", isoCode: "MY", phone: "123456789" },
    { countryCode: "60", isoCode: "CN", phone: "123456789" },
    { countryCode: "60", isoCode: "MY", phone: "0123456789" },
    { countryCode: "86", isoCode: "CN", phone: "12912345678" },
    { countryCode: "86", isoCode: "CN", phone: "139 1234 5678" },
    // The dial code and the ISO code must come from the same row, for every
    // row — not just for the two the app originally shipped with.
    { countryCode: "852", isoCode: "SG", phone: "81234567" },
    { countryCode: "65", isoCode: "HK", phone: "91234567" },
    // A country the table does not carry must not slip through on a plausible
    // dial code.
    { countryCode: "44", isoCode: "GB", phone: "7911123456" },
    { countryCode: "65", isoCode: "SG", phone: "1234567" },
    { countryCode: "673", isoCode: "BN", phone: "123456" },
  ])("rejects an unsupported or noncanonical phone: %o", (input) => {
    expect(() => normalizeAuthPhone(input)).toThrow();
  });

  it("masks a phone without returning its E.164 value", () => {
    const masked = maskAuthPhone({
      countryCode: "86",
      isoCode: "CN",
      phone: "13912345678",
      e164: "+8613912345678",
    });

    expect(masked).toBe("+86 139****5678");
    expect(masked).not.toContain("3062");
  });
});

describe("auth session cookie", () => {
  it("uses a local HttpOnly cookie outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = NextResponse.json({});

    setHbtiSessionCookie(
      response,
      sessionToken,
      new Date("2026-07-30T12:00:00.000Z"),
    );

    expect(hbtiSessionCookieName()).toBe("hbti_session");
    expect(response.headers.get("set-cookie")).toContain(
      `hbti_session=${sessionToken}`,
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("uses a Secure __Host cookie in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = NextResponse.json({});

    setHbtiSessionCookie(
      response,
      sessionToken,
      new Date("2026-07-30T12:00:00.000Z"),
    );

    expect(hbtiSessionCookieName()).toBe("__Host-hbti_session");
    expect(response.headers.get("set-cookie")).toContain(
      `__Host-hbti_session=${sessionToken}`,
    );
    expect(response.headers.get("set-cookie")).toContain("Path=/");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")?.toLowerCase()).toContain(
      "samesite=lax",
    );
  });

  it("reads only a canonical session token and clears it safely", () => {
    vi.stubEnv("NODE_ENV", "test");
    const request = new Request(origin, {
      headers: {
        Cookie: `other=x; hbti_session=${sessionToken}`,
      },
    });
    expect(readHbtiSessionCookie(request)).toBe(sessionToken);
    expect(
      readHbtiSessionCookie(
        new Request(origin, {
          headers: { Cookie: "hbti_session=not-valid" },
        }),
      ),
    ).toBeNull();

    const response = NextResponse.json({});
    clearHbtiSessionCookie(response);
    expect(response.headers.get("set-cookie")).toContain(
      "hbti_session=;",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

function jsonRequest(
  url: string,
  additionalHeaders: Record<string, string> = {},
): Request {
  const requestOrigin = new URL(url).origin;
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Origin: requestOrigin,
      "Sec-Fetch-Site": "same-origin",
      ...additionalHeaders,
    },
    body: "{}",
  });
}
