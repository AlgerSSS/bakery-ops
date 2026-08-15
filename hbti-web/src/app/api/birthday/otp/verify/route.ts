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

const RES_DEADLINE_MS = 24_000;

/**
 * 与 HBTI 的 verify 差别只有两处：
 * - 不要求 acceptMembership——生日卡不为非会员静默开户（产品决定，2026-08-15）；
 * - RES 侧查无会员时返回 404 NOT_A_MEMBER，前端据此展示「加入会员」引导。
 * 发码与图形验证码完全复用 /api/auth/otp/request 与 /api/auth/captcha。
 */
const requestSchema = z.strictObject({
  challengeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().regex(/^\d{6}$/),
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
    const rejection = getJsonMutationRejection(request, config.linkBaseUrl);
    if (rejection) return rejection;

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
    const loginInput = {
      session: {
        deviceId: attempt.payload.deviceId,
        token: attempt.payload.guestToken,
      },
      phone: {
        countryCode: attempt.payload.identity.countryCode,
        isoCode: attempt.payload.identity.isoCode,
        phone: attempt.payload.identity.phone,
      },
      code: input.code,
      resolveConflicts: input.confirmConflict === true,
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

    let outcome;
    try {
      outcome = await res.verifyLoginExistingMember(loginInput);
    } catch (error) {
      if (error instanceof ResH5LoginConflictError) {
        const marked = await store.markConflict(input.challengeToken, input.code);
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

    if (outcome.kind === "not_member") {
      await store.releaseAttempt(input.challengeToken).catch(() => false);
      acquired = undefined;
      return noStoreJson({ error: "NOT_A_MEMBER" }, { status: 404 });
    }

    const session = await store.createSession({
      memberId: outcome.memberId,
      resToken: outcome.resToken,
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
      console.error("Birthday RES member authentication failed", {
        stage: error.stage,
        providerCode: error.providerCode,
        httpStatus: error.httpStatus,
        topLevelKeys: error.topLevelKeys,
        dataKeys: error.dataKeys,
      });
      if (error.timedOut) {
        return noStoreJson(
          { error: "VERIFICATION_TIMEOUT", retryable: true },
          { status: 503 },
        );
      }
    }
    return noStoreJson({ error: "VERIFICATION_FAILED" }, { status: 503 });
  }
}
