import { NextResponse } from "next/server";

import { reconcilePendingCompletions } from "@/lib/completion/reconcile-pending";
import { createResApiClientFromEnv } from "@/lib/res/client";
import { readHbtiServerConfig } from "@/lib/server-config";
import {
  createCompletionStoreFromEnv,
  purgeExpired,
} from "@/lib/store/pg-completion-store";

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
    // PostgreSQL 没有 Mongo 的 TTL 索引，过期行得自己收。放在对账之后、且吞掉异常：
    // 清理失败不该让一次成功的对账报 503，正确性也不依赖它——读路径都带 expires_at 过滤。
    const purged = await purgeExpired().catch(() => -1);
    const ok = summary.errors === 0;
    return noStoreJson({ ok, ...summary, purged }, ok ? 200 : 503);
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
