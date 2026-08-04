import { NextResponse } from "next/server";

import { hasAlertDestination } from "@/lib/alert";

import { reconcilePendingCompletions } from "@/lib/completion/reconcile-pending";
import { createResApiClientFromEnv } from "@/lib/res/client";
import { readHbtiServerConfig } from "@/lib/server-config";
import {
  createCompletionStoreFromEnv,
  deliverPendingReviewAlerts,
  purgeExpired,
} from "@/lib/store/pg-completion-store";

export const runtime = "nodejs";
export const maxDuration = 60;

const RES_DEADLINE_MS = 40_000;

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return noStoreJson({ ok: false }, 401);
  }

  let alerts = { claimed: 0, sent: 0 };
  let alertsOk = hasAlertDestination();
  if (!alertsOk) {
    console.error("[cron/reconcile] ALERT_WEBHOOK is not configured");
  } else {
    try {
      // 告警重试不依赖 RES，必须放在 readiness probe 前；坏凭据正是仍要通知的故障。
      alerts = await deliverPendingReviewAlerts();
      alertsOk = alerts.sent === alerts.claimed;
    } catch (error) {
      alertsOk = false;
      console.error("[cron/reconcile] review alert delivery failed", error);
    }
  }
  try {
    const config = readHbtiServerConfig();
    const res = createResApiClientFromEnv(
      AbortSignal.timeout(RES_DEADLINE_MS),
    );
    await res.resolveEnabledCouponTemplateByName(
      config.couponTemplateName,
    );
    const summary = await reconcilePendingCompletions({
      store: await createCompletionStoreFromEnv(),
      res,
    });
    // PostgreSQL 没有 Mongo 的 TTL 索引，过期行得自己收。清理失败不该让一次成功的
    // 对账报 503——正确性不依赖它，读路径都带 expires_at 过滤。
    // 但**必须留痕**：此前这里是 `.catch(() => -1)`，异常连日志都没有，
    // 于是「清理坏了」和「本来就没有过期行」在响应里长得一模一样，无法诊断。
    let purged = 0;
    let purgeOk = true;
    try {
      purged = await purgeExpired();
    } catch (error) {
      purgeOk = false;
      console.error("[cron/reconcile] purgeExpired failed", error);
    }
    const ok = summary.errors === 0 && alertsOk;
    return noStoreJson(
      { ok, ...summary, purged, purgeOk, alerts, alertsOk },
      ok ? 200 : 503,
    );
  } catch (error) {
    // 同理：不留痕的 503 无法区分「RES 挂了」「配置缺失」「数据库不可达」。
    console.error("[cron/reconcile] run failed", error);
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
