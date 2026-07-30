import { NextResponse } from "next/server";

import { reconcilePendingCompletions } from "@/lib/completion/reconcile-pending";
import { createResApiClientFromEnv } from "@/lib/res/client";
import { readHbtiServerConfig } from "@/lib/server-config";
import { createCompletionStoreFromEnv } from "@/lib/store/mongo-completion-store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return noStoreJson({ ok: false }, 401);
  }

  try {
    const config = readHbtiServerConfig();
    const res = createResApiClientFromEnv();
    await res.resolveEnabledCouponTemplateByName(
      config.couponTemplateName,
    );
    const summary = await reconcilePendingCompletions({
      store: await createCompletionStoreFromEnv(),
      res,
    });
    const ok = summary.errors === 0;
    return noStoreJson({ ok, ...summary }, ok ? 200 : 503);
  } catch {
    return noStoreJson({ ok: false }, 503);
  }
}

export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  return (
    typeof secret === "string" &&
    secret.length >= 32 &&
    request.headers.get("authorization") === `Bearer ${secret}`
  );
}

function noStoreJson(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
