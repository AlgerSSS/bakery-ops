import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import { createAuthStoreFromEnv } from "@/lib/auth/pg-auth-store";
import { normalizeAuthPhone } from "@/lib/auth/phone";
import { createResH5MemberAuthClientFromEnv } from "@/lib/auth/res-auth-client";
import { ResH5AuthDiagnosticError } from "@/lib/res/h5-member-auth";
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

/**
 * 三次 RES 调用共享的总时限。
 *
 * 必须同时小于函数上限（30 秒）和浏览器的放弃时间（见 MemberSignIn 的
 * SEND_TIMEOUT_MS），否则会出现最糟的一种失败：顾客看到「网络错误」，
 * 短信其实正在路上，然后他们去点重发——而重发正是 RES 会静默丢掉的那一类。
 */
const RES_DEADLINE_MS = 18_000;

const requestSchema = z.strictObject({
  phone: z.unknown(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    const serverConfig = readHbtiServerConfig();
    const rejection = getJsonMutationRejection(
      request,
      serverConfig.linkBaseUrl,
    );
    if (rejection) {
      return rejection;
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const input = requestSchema.parse(rawBody);
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
      Promise.resolve(
        createResH5MemberAuthClientFromEnv(
          AbortSignal.timeout(RES_DEADLINE_MS),
        ),
      ),
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
    const receipt = await res.sendVerifyCode({
      session: guestSession,
      phone: phone.resPhone,
    });

    // 唯一一处能看见 RES 究竟说了什么的地方。receipt 已在客户端脱敏（长数字串被掐掉），
    // 这里再不落日志，下次「回了 000 但短信没到」就还是只能看到一个光秃秃的 200。
    console.info(
      "[otp/request] sent",
      JSON.stringify({
        resCode: receipt.code,
        resMessage: receipt.message,
        resBodyKeys: receipt.bodyKeys,
        attemptsToday: rateLimit.phoneAttemptsToday,
        elapsedMs: Date.now() - startedAt,
      }),
    );

    return noStoreJson({
      challengeToken: challenge.token,
      maskedPhone: phone.maskedPhone,
      // 实测同号码当天第二次起，RES 回 "000" 但短信不再送达。据实告诉前端，
      // 让它把「已发送」换成「今天已经发过，可能收不到新的」，而不是让顾客干等。
      resendMayNotArrive: rateLimit.phoneAttemptsToday > 1,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    // 此前这里是一个不留痕的 503：RES 挂了、配置缺失、数据库不可达，日志里长得一模一样。
    console.error("[otp/request] failed", {
      stage:
        error instanceof ResH5AuthDiagnosticError ? error.stage : "unknown",
      providerCode:
        error instanceof ResH5AuthDiagnosticError
          ? error.providerCode
          : undefined,
      httpStatus:
        error instanceof ResH5AuthDiagnosticError
          ? error.httpStatus
          : undefined,
      name: error instanceof Error ? error.name : typeof error,
      elapsedMs: Date.now() - startedAt,
    });
    return noStoreJson(
      { error: "SERVICE_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
