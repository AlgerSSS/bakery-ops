#!/usr/bin/env node
// 刷新 RES_VULCAN_TOKEN 并同步到 Vercel。
//
// 为什么这是个反复要做的动作：`RES_VULCAN_TOKEN` 不是服务凭证，是从 RES 后台（BO）
// 浏览器会话里借出来的令牌，**约 24 小时自然失效**。失效后顾客照样能登录、能答题
// （登录走 RES H5 每请求现取的访客令牌，不碰这个后台令牌），但**答完题发券会失败**，
// `/api/health` 也会因为券模板只读探测 401 而返回 503。
// 根治仍然是向 RES 申请受限服务凭证；在那之前就是跑这个脚本。
//
// 用法：
//   node ~/hot/res_api/login.js                                   # 先刷新 BO 会话
//   node --env-file=.env.local scripts/refresh-res-token.mjs      # 借令牌、验证、写 Vercel
//   npx vercel redeploy <当前生产 URL> --scope algersss-projects  # 让新变量生效
//
// ⚠ 最后一步必须用 `redeploy`，**不要在 hbti-web 目录跑 `vercel --prod`**：
//   那会从本地工作树重新打包，把还没准备好上线的代码一起推上去。
//   `redeploy` 复用目标部署的源码，只重新注入环境变量。
import { spawnSync } from "node:child_process";

const { openAuthedPage } = await import(
  "file:///Users/weiliangshao/hot/res_api/lib/report-client.js"
);

const REQUIRED = [
  "RES_CORPORATION_ID",
  "RES_ORGANIZATION_ID",
  "RES_ORGANIZATION_TYPE",
  "RES_BRAND_ID",
  "RES_SHOP_ID",
  "RES_TENANT",
  "RES_COUPON_TEMPLATE_NAME",
];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  process.stderr.write(`缺少环境变量：${missing.join(", ")}\n`);
  process.exit(2);
}

let session;
try {
  session = await openAuthedPage({
    storageState: "/Users/weiliangshao/hot/res_api/storageState.json",
    warmupPath: "/member-overview",
    settleMs: 5_000,
    log: () => {},
  });
  const headers = session.authHeaders;
  const token = headers["vulcan-token"];
  if (typeof token !== "string" || token.length < 32) {
    throw new Error(
      "没有从页面请求里借到 vulcan-token —— BO 会话多半已经过期，先跑 res_api/login.js。",
    );
  }

  // 只校验租户边界。
  //
  // 曾经这里连 organization-id / organization-type / brand-id 一起做等值断言，结果是
  // **每次重新登录后都会误判**：刚登录的会话落在集团级作用域（organization-type=0、
  // 没有 brand-id），而 HBTI 配的是品牌/门店级（type=7）。
  // 那个断言的前提本来就不成立 —— hbti-web 的 ResApiClient 在 client.ts:317-321 里
  // 是拿**自己 env 里的**组织/品牌/门店头去发请求的，只有 vulcan-token 来自这个会话。
  // 抓取时的作用域是什么，与运行时用什么作用域无关。
  //
  // 真正的把关是下面那次只读验证：它用运行时那套头去查券模板，查得到才算这个令牌可用。
  for (const [name, expected] of [
    ["corporation-id", process.env.RES_CORPORATION_ID],
    ["shop-id", process.env.RES_SHOP_ID],
  ]) {
    if (headers[name] !== expected) {
      throw new Error(
        `抓到的会话不属于目标租户：${name} 是 ${headers[name]}，期望 ${expected}。`,
      );
    }
  }

  const runtimeHeaders = {
    "corporation-id": process.env.RES_CORPORATION_ID,
    "organization-id": process.env.RES_ORGANIZATION_ID,
    "organization-type": process.env.RES_ORGANIZATION_TYPE,
    "brand-id": process.env.RES_BRAND_ID,
    "shop-id": process.env.RES_SHOP_ID,
  };
  const verification = await fetch(
    new URL(
      "/crm/coupon/template/queryGroup",
      process.env.RES_BASE_URL || "https://bo.sea.restosuite.ai",
    ),
    {
      method: "POST",
      redirect: "error",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Content-Type": "application/json",
        "vulcan-token": token,
        ...runtimeHeaders,
        "language-code": "en_US",
        "accept-timezone": "Asia/Kuala_Lumpur",
        Cookie: `i18next=en_US; tenant=${process.env.RES_TENANT}`,
      },
      body: JSON.stringify({ orgId: process.env.RES_ORGANIZATION_ID }),
      signal: AbortSignal.timeout(12_000),
    },
  );
  const body = await verification.json();
  if (!verification.ok || body?.code !== "000" || !Array.isArray(body?.data)) {
    throw new Error(
      `新令牌没通过只读验证：HTTP ${verification.status} code=${body?.code ?? "?"}。`,
    );
  }

  // 券模板必须唯一命中且启用。发券链路认的是名字，命中 0 条或多条都会在顾客提交时才炸。
  const matches = body.data
    .flatMap((group) => group.couponTemplateList ?? [])
    .filter(
      (template) =>
        template.couponTemplateName === process.env.RES_COUPON_TEMPLATE_NAME &&
        template.couponTemplateType === 2301 &&
        template.couponTemplateStatus === 1,
    );
  if (matches.length !== 1) {
    throw new Error(
      `目标券模板「${process.env.RES_COUPON_TEMPLATE_NAME}」命中 ${matches.length} 条，期望恰好 1 条。`,
    );
  }

  const dryRun = process.argv.includes("--dry-run");
  const updated = [];
  if (!dryRun) {
    for (const environment of ["production", "development"]) {
      const result = spawnSync(
        "npx",
        ["vercel", "env", "update", "RES_VULCAN_TOKEN", environment, "--yes",
         "--scope", "algersss-projects"],
        {
          cwd: new URL("..", import.meta.url).pathname,
          env: process.env,
          input: token,
          encoding: "utf8",
          timeout: 60_000,
        },
      );
      if (result.status !== 0) {
        throw new Error(
          `写入 Vercel ${environment} 失败：${result.stderr || result.stdout}`,
        );
      }
      updated.push(environment);
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      verified: true,
      couponTemplateUniquelyEnabled: true,
      capturedScope: {
        organizationType: headers["organization-type"] ?? null,
        brandId: headers["brand-id"] ?? null,
      },
      updated: dryRun ? "dry-run，未写入" : updated,
      next: dryRun
        ? null
        : "npx vercel redeploy <当前生产 URL> --scope algersss-projects（不要用 vercel --prod）",
    }, null, 2)}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      verified: false,
      error: error instanceof Error ? error.message : "未知错误",
    }, null, 2)}\n`,
  );
  process.exitCode = 1;
} finally {
  await session?.close();
}
