import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import { createAuthStoreFromEnv } from "@/lib/auth/pg-auth-store";
import { normalizeAuthPhone } from "@/lib/auth/phone";
import { createResH5MemberAuthClientFromEnv } from "@/lib/auth/res-auth-client";
import {
  createAuthRateLimiterFromEnv,
  readClientIp,
} from "@/lib/rate-limit/auth-rate-limit";
import {
  readHbtiAuthConfig,
  readHbtiServerConfig,
} from "@/lib/server-config";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.strictObject({
  phone: z.unknown(),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const serverConfig = readHbtiServerConfig();
    const rejection = getJsonMutationRejection(
      request,
      serverConfig.linkBaseUrl,
    );
    if (rejection) {
      return rejection;
    }

    const input = requestSchema.parse(await request.json());
    const phone = normalizeAuthPhone(input.phone);
    const authConfig = readHbtiAuthConfig();
    const rateLimiter = await createAuthRateLimiterFromEnv(
      authConfig.authSecret,
    );
    const rateLimit = await rateLimiter.consumeOtpRequest({
      phoneE164: phone.identity.e164,
      ipAddress: readClientIp(request),
    });
    if (!rateLimit.allowed) {
      return noStoreJson(
        { error: "RATE_LIMITED" },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    const [store, res] = await Promise.all([
      createAuthStoreFromEnv(),
      Promise.resolve(createResH5MemberAuthClientFromEnv()),
    ]);
    const guestSession = await res.createGuestSession(randomUUID());
    const captcha = await res.getCaptchaConfig(guestSession);
    if (captcha.enable) {
      return noStoreJson(
        { error: "CAPTCHA_REQUIRED_UNSUPPORTED" },
        { status: 503 },
      );
    }

    const challenge = await store.createChallenge({
      guestToken: guestSession.token,
      deviceId: guestSession.deviceId,
      identity: phone.identity,
    });
    await res.sendVerifyCode({
      session: guestSession,
      phone: phone.resPhone,
    });

    return noStoreJson({
      challengeToken: challenge.token,
      maskedPhone: phone.maskedPhone,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    return noStoreJson(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
