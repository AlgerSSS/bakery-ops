import { NextResponse } from "next/server";

import { createResApiClientFromEnv } from "@/lib/res/client";
import { readHbtiServerConfig } from "@/lib/server-config";
import { checkCompletionStoreFromEnv } from "@/lib/store/pg-completion-store";

export const runtime = "nodejs";

const RES_READINESS_TTL_MS = 60_000;
let resReadiness:
  | { expiresAt: number; promise: Promise<void> }
  | undefined;

export async function GET(): Promise<NextResponse> {
  let config: ReturnType<typeof readHbtiServerConfig>;
  let res: ReturnType<typeof createResApiClientFromEnv>;
  try {
    config = readHbtiServerConfig();
    res = createResApiClientFromEnv();
  } catch (error) {
    // 配置缺失与依赖故障是两回事,分开报,否则「degraded」什么也不说明。
    console.error("[health] configuration invalid", error);
    return json(
      { status: "degraded", service: "hbti-web", checks: { config: "fail" } },
      503,
    );
  }

  // allSettled 而非 all:两项都要跑完。用 all 的话先失败的那个会掩盖另一个,
  // 于是线上只剩一行「503 (no message)」,分不清是数据库还是 RES ——
  // 这正是 2026-08-01/02 两次发券中断查了很久才定位的原因。
  const [db, resAccess] = await Promise.allSettled([
    checkCompletionStoreFromEnv(),
    checkResAccess(res, config.couponTemplateName),
  ]);
  if (db.status === "rejected") {
    console.error("[health] completion store unreachable", db.reason);
  }
  if (resAccess.status === "rejected") {
    console.error("[health] RES access failed", resAccess.reason);
  }

  const checks = {
    db: db.status === "fulfilled" ? "ok" : "fail",
    res: resAccess.status === "fulfilled" ? "ok" : "fail",
  } as const;
  const ok = checks.db === "ok" && checks.res === "ok";
  // 只报哪一路挂了,不回显异常内容 —— 这个端点无鉴权,错误信息里可能带
  // 上游 URL 或凭证片段。细节留在服务端日志。
  return json(
    { status: ok ? "ok" : "degraded", service: "hbti-web", checks },
    ok ? 200 : 503,
  );
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
