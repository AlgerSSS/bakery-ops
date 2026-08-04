import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/session/route";

const ORIGIN = "https://hbti-test.hotcrush.net";

describe("retired invitation session route", () => {
  it("retires a legacy invitation bearer without accepting or echoing it", async () => {
    // 邀请链接停用前发出去的 token 仍会被点开：这里只保证服务端既不解析它，
    // 也不把它回显到响应体里。
    const token = "eyJsZWdhY3kiOiJpbnZpdGF0aW9uLXRva2VuIn0.signature";

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
