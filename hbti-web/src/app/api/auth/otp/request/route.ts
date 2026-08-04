import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  forgetCaptchaConfig,
  readCaptchaConfig,
} from "@/lib/auth/captcha-config";
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
  // 顾客解出的图形验证码。RES 关掉验证码时这一项不该出现，所以是可选而不是可空。
  captcha: z
    .strictObject({
      token: z.string().min(1).max(1024),
      randstr: z.string().min(1).max(256),
    })
    .optional(),
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

    // 验证码要求在**限流之前**判定：缺验证码的请求根本到不了 RES，不该消耗顾客
    // 当天的发码额度。用缓存的配置判断，常见路径零 RES 调用。
    const captchaConfig = await readCaptchaConfig();
    if (captchaConfig.provider === "unsupported") {
      // RES 换了我们驱动不了的供应商。fail closed —— 让顾客看到明确的不可用，
      // 好过发出一个必定在 RES 那里失败的请求。
      return noStoreJson(
        { error: "CAPTCHA_UNSUPPORTED" },
        { status: 503 },
      );
    }
    if (captchaConfig.enable && !input.captcha) {
      return noStoreJson(
        { error: "CAPTCHA_REQUIRED", captcha: captchaConfig },
        { status: 400 },
      );
    }

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
    // 这里**不再**重复问一次 captcha/config：上面已经用缓存判过，再问一次就是
    // 每次发码多一趟 RES 往返。代价是缓存窗口内 RES 拨动开关会漏判——那种情况下
    // sendVerifyCode 会失败，catch 里顺手把缓存作废，下一次请求就能拿到真相。

    const challenge = await store.createChallenge({
      guestToken: guestSession.token,
      deviceId: guestSession.deviceId,
      identity: phone.identity,
    });
    let receipt;
    try {
      receipt = await res.sendVerifyCode({
        session: guestSession,
        phone: phone.resPhone,
        captcha: input.captcha,
      });
    } catch (error) {
      // 发码失败最可能的新原因就是「缓存里的验证码配置过时了」。作废缓存，让下一次
      // 请求重新问 RES —— 否则开关被拨动后我们要一直错到缓存自然过期。
      forgetCaptchaConfig();
      throw error;
    }

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
