import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/session/route";
import { createMemberLinkToken } from "@/lib/member-link/crypto";

const ORIGIN = "https://hbti-test.hotcrush.net";

describe("retired invitation session route", () => {
  it("retires a previously valid invitation without accepting its bearer", async () => {
    const token = createMemberLinkToken({
      phone: "+1 202 555 0123",
      campaignVersion: "2026-08-pistachio-v1",
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      secret: "test-only-retired-link-secret".repeat(2),
    });

    await expectRetiredResponse(
      POST(
        new Request(`${ORIGIN}/api/session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: ORIGIN,
          },
          body: JSON.stringify({ token }),
        }),
      ),
      token,
    );
  });

  it("returns the same safe retirement response without parsing legacy input", async () => {
    for (const request of [
      new Request(`${ORIGIN}/api/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
      new Request(`${ORIGIN}/api/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
        },
        body: JSON.stringify({ token: "supplied-legacy-bearer" }),
      }),
    ]) {
      await expectRetiredResponse(POST(request), "supplied-legacy-bearer");
    }
  });
});

async function expectRetiredResponse(
  responsePromise: Promise<Response>,
  forbiddenBearer: string,
): Promise<void> {
  const response = await responsePromise;
  const body = await response.json();

  expect(response.status).toBe(410);
  expect(body).toEqual({
    valid: false,
    error: "INVITATION_LINK_RETIRED",
  });
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  expect(response.headers.get("retry-after")).toBeNull();
  expect(JSON.stringify(body)).not.toContain(forbiddenBearer);
}
