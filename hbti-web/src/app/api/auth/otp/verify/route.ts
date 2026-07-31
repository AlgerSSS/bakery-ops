import { NextResponse } from "next/server";
import { z } from "zod";

import { getJsonMutationRejection, noStoreJson } from "@/lib/auth/http";
import {
  createAuthStoreFromEnv,
  type MongoAuthStore,
} from "@/lib/auth/mongo-auth-store";
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

const requestSchema = z.strictObject({
  challengeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code: z.string().regex(/^\d{6}$/),
  acceptMembership: z.literal(true),
  confirmConflict: z.boolean().optional(),
});

interface AcquiredChallenge {
  store: MongoAuthStore;
  token: string;
}

export async function POST(request: Request): Promise<NextResponse> {
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
    const input = requestSchema.parse(await request.json());
    const store = await createAuthStoreFromEnv();
    const attempt = await store.beginAttempt(input.challengeToken);
    if (!attempt) {
      return noStoreJson(
        { error: "CHALLENGE_EXPIRED_OR_USED" },
        { status: 410 },
      );
    }
    acquired = { store, token: input.challengeToken };

    const res = createResH5MemberAuthClientFromEnv();
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
    return noStoreJson(
      { error: "VERIFICATION_FAILED" },
      { status: 503 },
    );
  }
}
