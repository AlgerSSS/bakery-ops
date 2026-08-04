import { NextResponse } from "next/server";
import { z } from "zod";

import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import {
  createAuthStoreFromEnv,
  type PgAuthStore,
} from "@/lib/auth/pg-auth-store";
import { maskAuthPhone } from "@/lib/auth/phone";
import { createResH5MemberAuthClientFromEnv } from "@/lib/auth/res-auth-client";
import { setHbtiSessionCookie } from "@/lib/auth/session-cookie";
import {
  ResH5AuthDiagnosticError,
  ResH5LoginConflictError,
  ResH5VerificationCodeError,
} from "@/lib/res/h5-member-auth";
import { readHbtiServerConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * verify 路径的路由级总时限。
 *
 * 信号在 handler 入口就开始计时，不是等 beginAttempt 之后才开始：这样解析、冷连接与
 * RES 的正常三次/新会员五次串行调用共享同一个 24 秒预算。路由 maxDuration 是 30 秒，
 * 余下 6 秒留给 releaseAttempt / createSession / consumeChallenge、组装响应与网络回程。
 * 单次调用仍有自己的 12 秒上限，取两个信号中先到者。
 *
 * 没有这个总时限时，五次调用各自 12 秒、最坏 60 秒：函数 30 秒就被平台砍掉，
 * catch 根本轮不到跑，attempt 不会释放，challenge 会卡在 verifying 直到 TTL 过期。
 */
const RES_DEADLINE_MS = 24_000;

const requestSchema = z.strictObject({
  challengeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().regex(/^\d{6}$/),
  acceptMembership: z.literal(true),
  confirmConflict: z.boolean().optional(),
});

interface AcquiredChallenge {
  store: PgAuthStore;
  token: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  const resDeadline = AbortSignal.timeout(RES_DEADLINE_MS);
  let acquired: AcquiredChallenge | undefined;
  try {
    const config = readHbtiServerConfig();
    const rejection = getJsonMutationRejection(
      request,
      config.linkBaseUrl,
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
    const store = await createAuthStoreFromEnv();
    const attempt = await store.beginAttempt(input.challengeToken);
    if (!attempt) {
      return noStoreJson(
        { error: "CHALLENGE_EXPIRED_OR_USED" },
        { status: 410 },
      );
    }
    acquired = { store, token: input.challengeToken };

    const res = createResH5MemberAuthClientFromEnv(resDeadline);
    const phone = {
      countryCode: attempt.payload.identity.countryCode,
      isoCode: attempt.payload.identity.isoCode,
      phone: attempt.payload.identity.phone,
    };
    if (
      input.confirmConflict === true &&
      attempt.payload.verifiedCode !== input.code
    ) {
      await store.releaseAttempt(input.challengeToken).catch(() => false);
      acquired = undefined;
      return noStoreJson(
        { error: "ACCOUNT_CONFLICT_CONFIRMATION_REQUIRED" },
        { status: 409 },
      );
    }

    let member;
    try {
      const loginInput = {
        session: {
          deviceId: attempt.payload.deviceId,
          token: attempt.payload.guestToken,
        },
        phone,
        code: input.code,
      };
      member =
        input.confirmConflict === true
          ? await res.loginAndEnsureMember({
              ...loginInput,
              resolveConflicts: true,
            })
          : await res.verifyLoginAndEnsureMember({
              ...loginInput,
              resolveConflicts: false,
            });
    } catch (error) {
      if (error instanceof ResH5LoginConflictError) {
        const marked = await store.markConflict(
          input.challengeToken,
          input.code,
        );
        acquired = undefined;
        if (!marked) {
          return noStoreJson(
            { error: "CHALLENGE_EXPIRED_OR_USED" },
            { status: 410 },
          );
        }
        return noStoreJson(
          { error: "ACCOUNT_CONFLICT_CONFIRMATION_REQUIRED" },
          { status: 409 },
        );
      }
      if (error instanceof ResH5VerificationCodeError) {
        await store.releaseAttempt(input.challengeToken).catch(() => false);
        acquired = undefined;
        return noStoreJson(
          { error: "INVALID_VERIFICATION_CODE" },
          { status: 400 },
        );
      }
      throw error;
    }

    const session = await store.createSession({
      memberId: member.memberId,
      resToken: member.resToken,
      identity: attempt.payload.identity,
    });
    if (!(await store.consumeChallenge(input.challengeToken))) {
      await store.deleteSession(session.token).catch(() => false);
      acquired = undefined;
      return noStoreJson(
        { error: "CHALLENGE_EXPIRED_OR_USED" },
        { status: 410 },
      );
    }
    acquired = undefined;
    const response = noStoreJson({
      authenticated: true,
      maskedPhone: maskAuthPhone(attempt.payload.identity),
      draftKey: session.draftKey,
    });
    setHbtiSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    if (acquired) {
      await acquired.store.releaseAttempt(acquired.token).catch(() => false);
    }
    if (error instanceof z.ZodError) {
      return noStoreJson({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    if (error instanceof ResH5AuthDiagnosticError) {
      console.error("HBTI RES member authentication failed", {
        stage: error.stage,
        providerCode: error.providerCode,
        httpStatus: error.httpStatus,
        topLevelKeys: error.topLevelKeys,
        dataKeys: error.dataKeys,
        dataValueTypes: error.dataValueTypes,
      });
    }
    // 只有实际被请求 AbortSignal 截断的 RES 失败才叫超时。路由总预算可能在后续
    // 数据库步骤中到点，不能据此把真实 HTTP/网络/存储故障重标成 timeout。
    if (
      error instanceof ResH5AuthDiagnosticError &&
      error.timedOut
    ) {
      return noStoreJson(
        { error: "VERIFICATION_TIMEOUT", retryable: true },
        { status: 503 },
      );
    }
    return noStoreJson(
      { error: "VERIFICATION_FAILED" },
      { status: 503 },
    );
  }
}
