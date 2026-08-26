import { createHmac } from "node:crypto";

import { z } from "zod";

import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import { getDb } from "@/lib/db/postgres";
import { readClientIp } from "@/lib/rate-limit/auth-rate-limit";
import { bumpRateLimitBucket } from "@/lib/rate-limit/pg-rate-limit";
import { readHbtiServerConfig } from "@/lib/server-config";
import {
  createStaffSessionToken,
  setStaffSessionCookie,
  staffSessionSigningSecret,
  verifyStaffAccessCode,
} from "@/lib/staff/session";

export const runtime = "nodejs";

const bodySchema = z.strictObject({
  staffId: z.string().trim().min(2).max(40),
  accessCode: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const rejection = getJsonMutationRejection(
      request,
      readHbtiServerConfig().linkBaseUrl,
    );
    if (rejection) return rejection;
    const input = bodySchema.parse(await request.json());
    const ipHash = createHmac("sha256", staffSessionSigningSecret())
      .update("staff-login-ip:", "utf8")
      .update(readClientIp(request), "utf8")
      .digest("hex");
    const now = Date.now();
    const windowMs = 15 * 60_000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const count = await bumpRateLimitBucket(
      getDb(),
      `staff-login:${windowStart}:${ipHash}`,
      new Date(windowStart + windowMs * 2),
    );
    if (count > 10) {
      return noStoreJson({ error: "RATE_LIMITED" }, { status: 429 });
    }
    if (!verifyStaffAccessCode(input.accessCode)) {
      return noStoreJson({ error: "INVALID_CREDENTIALS" }, { status: 401 });
    }

    const issued = createStaffSessionToken(input.staffId);
    const response = noStoreJson({ authenticated: true, staffId: issued.session.staffId });
    setStaffSessionCookie(response, issued.token, issued.session.expiresAt);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    console.error("[staff] login failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return noStoreJson({ error: "LOGIN_FAILED" }, { status: 503 });
  }
}
