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
import { consumeTokenRateLimit } from "@/lib/rate-limit/pg-rate-limit";
import { createResApiClientFromEnv } from "@/lib/res/client";
import { readHbtiServerConfig } from "@/lib/server-config";
import { drawGift, releaseGift } from "@/lib/store/gift-pool";
import { createCompletionStoreFromEnv } from "@/lib/store/pg-completion-store";

export const runtime = "nodejs";
export const maxDuration = 30;
const RES_DEADLINE_MS = 24_000;

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
    const resDeadline = AbortSignal.timeout(RES_DEADLINE_MS);
    const config = readHbtiServerConfig();
    const rejection = getJsonMutationRejection(
      request,
      config.linkBaseUrl,
    );
    if (rejection) {
      return rejection;
    }
    // 会话检查放在 body 解析之前：未登录请求直接 401，
    // 不能让匿名调用者不花任何成本就触发解析与校验层。
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
    // request.json() 在 body 不是合法 JSON 时抛的是 SyntaxError 而不是 ZodError，
    // 若交给外层 catch 会掉进兜底分支被误报成 503 SERVICE_UNAVAILABLE——
    // 客户端错误被计入服务可用性指标，且 retryable:true 会误导客户端重试
    // 一个永远不会成功的请求。因此在这里单独捕获，按客户端错误返回 400，
    // 与下面 ZodError 的处理（同样是请求方发错了东西）保持一致。
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return noStoreJson(
        { error: "INVALID_REQUEST", retryable: false },
        { status: 400 },
      );
    }
    const input = requestSchema.parse(rawBody);
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
        res: createResApiClientFromEnv(resDeadline),
        couponTemplateName: config.couponTemplateName,
        gifts: {
          draw: () => drawGift(),
          release: (templateName) => releaseGift(templateName),
        },
      },
    );

    // 202 的含义是「还没完，接着轮询」。unrewarded 是终态——周边发完了，不会再变——
    // 所以和 issued 一样返回 200，前端不该为它继续轮询。
    const response = noStoreJson(
      publicCompletionPayload(result, config.memberWalletUrl),
      result.status === "issued" || result.status === "unrewarded"
        ? { status: 200 }
        : { status: 202 },
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
