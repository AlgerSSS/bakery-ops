import { NextResponse } from "next/server";

import { createResApiClientFromEnv } from "@/lib/res/client";
import { readHbtiServerConfig } from "@/lib/server-config";
import { checkCompletionStoreFromEnv } from "@/lib/store/mongo-completion-store";

export const runtime = "nodejs";

const RES_READINESS_TTL_MS = 60_000;
let resReadiness:
  | { expiresAt: number; promise: Promise<void> }
  | undefined;

export async function GET(): Promise<NextResponse> {
  try {
    const config = readHbtiServerConfig();
    const res = createResApiClientFromEnv();
    await Promise.all([
      checkCompletionStoreFromEnv(),
      checkResAccess(res, config.couponTemplateName),
    ]);
    return json({ status: "ok", service: "hbti-web" }, 200);
  } catch {
    return json({ status: "degraded", service: "hbti-web" }, 503);
  }
}

async function checkResAccess(
  res: ReturnType<typeof createResApiClientFromEnv>,
  couponTemplateName: string,
): Promise<void> {
  const now = Date.now();
  if (resReadiness && resReadiness.expiresAt > now) {
    return resReadiness.promise;
  }

  const promise = res
    .resolveEnabledCouponTemplateByName(couponTemplateName)
    .then(() => undefined);
  resReadiness = {
    expiresAt: now + RES_READINESS_TTL_MS,
    promise,
  };
  try {
    await promise;
  } catch (error) {
    if (resReadiness?.promise === promise) {
      resReadiness = undefined;
    }
    throw error;
  }
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
