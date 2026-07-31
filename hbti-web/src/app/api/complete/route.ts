import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getJsonMutationRejection,
  noStoreJson,
} from "@/lib/auth/http";
import { readHbtiAuthSession } from "@/lib/auth/session";
import { readHbtiSessionCookie } from "@/lib/auth/session-cookie";
import {
  completeHbti,
  CompleteHbtiError,
} from "@/lib/completion/complete-hbti";
import { hbtiAnswersSchema } from "@/lib/hbti/schema";
import { consumeTokenRateLimit } from "@/lib/rate-limit/mongo-rate-limit";
import { createResApiClientFromEnv } from "@/lib/res/client";
import { readHbtiServerConfig } from "@/lib/server-config";
import { createCompletionStoreFromEnv } from "@/lib/store/mongo-completion-store";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.strictObject({
  answers: hbtiAnswersSchema,
  color: z.enum([
    "cherry",
    "blush",
    "apricot",
    "sunshine",
    "pistachio",
    "sky",
    "lavender",
    "cocoa",
    "cream",
  ]),
  gender: z
    .enum(["woman", "man", "nonbinary", "prefer-not"])
    .optional(),
  age: z
    .enum([
      "under-18",
      "18-24",
      "25-34",
      "35-44",
      "45-plus",
      "prefer-not",
    ])
    .optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
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
    const sessionToken = readHbtiSessionCookie(request);
    if (!sessionToken) {
      return noStoreJson(
        { error: "AUTHENTICATION_REQUIRED", retryable: false },
        { status: 401 },
      );
    }
    const session = await readHbtiAuthSession(request);
    if (!session) {
      return noStoreJson(
        { error: "AUTHENTICATION_REQUIRED", retryable: false },
        { status: 401 },
      );
    }
    const rateLimit = await consumeTokenRateLimit({
      scope: "complete",
      token: sessionToken,
      limit: 60,
      windowMs: 5 * 60_000,
    });
    if (!rateLimit.allowed) {
      return noStoreJson(
        { error: "RATE_LIMITED", retryable: true },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    const result = await completeHbti(
      {
        phone: session.payload.identity.e164,
        expectedMemberId: session.payload.memberId,
        campaignVersion: config.campaignVersion,
        answers: input.answers,
        color: input.color,
        ...(input.gender ? { gender: input.gender } : {}),
        ...(input.age ? { age: input.age } : {}),
      },
      {
        store: await createCompletionStoreFromEnv(),
        res: createResApiClientFromEnv(),
        memberHashSecret: config.memberHashSecret,
        couponTemplateName: config.couponTemplateName,
      },
    );

    const response = noStoreJson(
      publicCompletionPayload(result, config.memberWalletUrl),
      result.status === "issued" ? { status: 200 } : { status: 202 },
    );
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return noStoreJson(
        { error: "INVALID_REQUEST", retryable: false },
        { status: 400 },
      );
    }
    if (error instanceof CompleteHbtiError) {
      const status =
        error.code === "INVALID_INPUT"
          ? 400
          : error.code === "MEMBER_IDENTITY_MISMATCH"
            ? 403
          : error.code === "INVALID_CONFIGURATION"
            ? 500
            : 503;
      return noStoreJson(
        { error: error.code, retryable: error.retryable },
        { status },
      );
    }
    return noStoreJson(
      { error: "SERVICE_UNAVAILABLE", retryable: true },
      { status: 503 },
    );
  }
}

export function publicCompletionPayload(
  result: Awaited<ReturnType<typeof completeHbti>>,
  memberWalletUrl: string,
): Record<string, unknown> {
  if (result.status !== "issued") {
    return { ...result, memberWalletUrl };
  }
  return {
    status: result.status,
    code: result.code,
    visitTime: result.visitTime,
    category: result.category,
    color: result.color,
    ...(result.gender ? { gender: result.gender } : {}),
    ...(result.age ? { age: result.age } : {}),
    reward: {
      couponTemplateName: result.reward.couponTemplateName,
    },
    memberWalletUrl,
  };
}
