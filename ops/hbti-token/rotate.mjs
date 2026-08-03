#!/usr/bin/env node
// 轮换 RES_VULCAN_TOKEN 并让它在生产生效。服务器版(Contabo)。
//
// 为什么需要这个：`RES_VULCAN_TOKEN` 不是服务凭证，是从 RES 后台(BO)浏览器会话里
// 借出来的令牌。失效后顾客照样能登录、能答题(登录走 RES H5 每请求现取的访客令牌，
// 不碰这个后台令牌)，但**答完题发券会失败**，`/api/health` 也会因为券模板只读探测
// 401 而返回 503。
//
// 失效机制(2026-08-02 两轮实验实测，此前「约 24 小时自然失效」的说法已证伪)：
// 它是**空闲超时**，不是固定寿命 —— 空闲 1h/2h 仍可用，4h/6h/8h 全部 401；
// 而每 15 分钟调用一次的同龄令牌 8 小时全程可用。交叉对照(OLD/NEW × ACTIVE/IDLE)
// 进一步排除「新登录顶掉旧令牌」：最旧的只要在用就活着，最新的闲着也死。
// 所以常规保活靠 keepalive.sh(每 30 分钟打一次 /api/health)，本脚本是兜底。
// 根治仍然是向 RES 申请受限服务凭证。
//
// 与 Mac 版(hbti-web/scripts/refresh-res-token.mjs)的差异:
//   1. 路径不写死,从 RES_API_ROOT 解析;
//   2. Vercel CLI 固定版本并用专用 --token,不依赖交互式登录态;
//   3. 多做三步:redeploy -> alias -> 轮询 /api/health,任一步失败即非零退出。
//      只写 env 不 redeploy 等于没生效 —— 这是最容易自欺的一步。
import { spawnSync } from "node:child_process";

const VERCEL = "vercel@54.1.0"; // 固定版本:CLI 的 `env update` 语义随版本变过
const SCOPE = process.env.VERCEL_SCOPE ?? "algersss-projects";
const RES_API_ROOT = process.env.RES_API_ROOT ?? "/opt/hotcrush/res_api";
const HEALTH_URL =
  process.env.HBTI_HEALTH_URL ?? "https://hbti-test.hotcrush.net/api/health";
const DOMAIN = process.env.HBTI_DOMAIN ?? "hbti-test.hotcrush.net";

const REQUIRED = [
  "RES_CORPORATION_ID",
  "RES_ORGANIZATION_ID",
  "RES_ORGANIZATION_TYPE",
  "RES_BRAND_ID",
  "RES_SHOP_ID",
  "RES_TENANT",
  "RES_COUPON_TEMPLATE_NAME",
  "VERCEL_TOKEN",
  "VERCEL_PROJECT_ID",
  "VERCEL_ORG_ID",
];
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  process.stderr.write(`缺少环境变量：${missing.join(", ")}\n`);
  process.exit(2);
}

const step = (msg) =>
  process.stdout.write(`${new Date().toISOString()} ${msg}\n`);

function vercel(args, { input } = {}) {
  const result = spawnSync(
    "npx",
    // token 走环境变量,不进 argv —— `--token <值>` 会出现在 `ps` 的进程参数表里,
    // 同机任何用户都能读到。Vercel CLI 原生读 VERCEL_TOKEN,已在 --env-file 里。
    ["--yes", VERCEL, ...args, "--scope", SCOPE],
    {
      cwd: new URL(".", import.meta.url).pathname,
      env: process.env,
      input,
      encoding: "utf8",
      timeout: 300_000,
    },
  );
  if (result.status !== 0) {
    // 仍然做一次兜底脱敏:CLI 报错时可能回显它读到的配置。
    const safe = `${result.stderr ?? ""}${result.stdout ?? ""}`
      .replaceAll(process.env.VERCEL_TOKEN, "<redacted>")
      .slice(0, 400);
    throw new Error(`vercel ${args[0]} ${args[1] ?? ""} 失败：${safe}`);
  }
  return `${result.stdout ?? ""}`;
}

const { openAuthedPage } = await import(
  new URL("lib/report-client.js", `file://${RES_API_ROOT}/`).href
);

let session;
try {
  step("1/6 借 BO 会话里的 vulcan-token");
  session = await openAuthedPage({
    storageState: `${RES_API_ROOT}/storageState.json`,
    warmupPath: "/member-overview",
    settleMs: 5_000,
    log: () => {},
  });
  const headers = session.authHeaders;
  const token = headers["vulcan-token"];
  if (typeof token !== "string" || token.length < 32) {
    throw new Error(
      "没有从页面请求里借到 vulcan-token —— BO 会话多半已经过期，run.sh 应先跑 login.js。",
    );
  }

  // 只校验租户边界。组织/品牌作用域不校验：刚登录的会话是集团级(type=0、无 brand-id)，
  // 而运行时用的是 env 里的品牌/门店级头，抓取作用域与运行作用域本就无关。
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

  step("2/6 用运行时头做只读验证");
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
        "corporation-id": process.env.RES_CORPORATION_ID,
        "organization-id": process.env.RES_ORGANIZATION_ID,
        "organization-type": process.env.RES_ORGANIZATION_TYPE,
        "brand-id": process.env.RES_BRAND_ID,
        "shop-id": process.env.RES_SHOP_ID,
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
      `券模板「${process.env.RES_COUPON_TEMPLATE_NAME}」命中 ${matches.length} 条(应为 1)。`,
    );
  }

  step("3/6 写入 Vercel env(production + development)");
  for (const environment of ["production", "development"]) {
    vercel(["env", "update", "RES_VULCAN_TOKEN", environment, "--yes"], {
      input: token,
    });
  }

  // env 改了但不重新部署 = 线上仍是旧令牌。Vercel 在构建时把 env 固化进部署。
  step("4/6 查当前生产部署并 redeploy");
  const listed = await fetch(
    `https://api.vercel.com/v6/deployments?projectId=${process.env.VERCEL_PROJECT_ID}` +
      `&target=production&state=READY&limit=1&teamId=${process.env.VERCEL_ORG_ID}`,
    { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } },
  );
  if (!listed.ok) {
    throw new Error(`查生产部署失败：HTTP ${listed.status}`);
  }
  const current = (await listed.json()).deployments?.[0]?.url;
  if (!current) {
    throw new Error("没有找到 READY 的生产部署。");
  }
  const out = vercel(["redeploy", current]);
  const fresh = out.match(/https:\/\/[a-z0-9-]+\.vercel\.app/)?.[0];
  if (!fresh) {
    throw new Error("redeploy 没返回新部署 URL。");
  }

  step("5/6 指向域名");
  vercel(["alias", "set", fresh, DOMAIN]);

  // 真正的验收：域名上的 /api/health 必须回 200。
  // 前面每一步都可能“成功”而线上依旧是旧令牌，只有这一步能证伪。
  step("6/6 轮询 /api/health");
  let healthy = false;
  let last = "";
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 5_000));
    try {
      const res = await fetch(`${HEALTH_URL}?cb=${Date.now()}`, {
        signal: AbortSignal.timeout(15_000),
      });
      last = `HTTP ${res.status}`;
      if (res.status === 200) {
        healthy = true;
        break;
      }
    } catch (error) {
      last = `请求失败 ${error.message}`;
    }
  }
  if (!healthy) {
    throw new Error(`轮换后 /api/health 仍未恢复(${last})。`);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        rotatedAt: new Date().toISOString(),
        deployment: fresh,
        domain: DOMAIN,
        health: "200",
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${new Date().toISOString()} 轮换失败：${error?.message ?? error}\n`,
  );
  // 用 exitCode 而不是 process.exit(1):后者同步终止进程,下面 finally 里的
  // `await session.close()` 不会跑完,每次失败都漏一个 Chromium。
  // 这个任务每 12 小时一班,失败若连续发生,泄漏的浏览器会把内存吃光。
  process.exitCode = 1;
} finally {
  await session?.close();
}
