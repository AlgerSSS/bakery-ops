#!/usr/bin/env node
/**
 * 生日礼预约 → Lark 群 的门店通知 relay（跑在 tokyo-01，cron 每 2 分钟）。
 *
 * 为什么不在 Vercel 上直接发：通知通道按 2026-08-15 决定部署在服务器上，
 * 与 res_api / 招募同步同一台机器；Vercel 侧不配 BIRTHDAY_NOTIFY_WEBHOOK，
 * 预约落库时 notify_status 保持 pending，由本脚本收编发送。
 *
 * 流程：读 pending（attempts<3）预约 → 发到 Lark「HOT CRUSH 生日礼预约」群
 * （app cli_aa82af2c7878de17 的机器人，chat 在 env 里配）→ 置 sent；
 * 发送失败 attempts+1，达到 3 置 failed 停止重试。
 *
 * 用法：
 *   node birthday-notify.mjs              # 正常轮询（cron 用）
 *   node birthday-notify.mjs --dry-run    # 只读预演：打印将发送的内容，不发不写
 *   node birthday-notify.mjs --send-test  # 往群里发一条测试消息（验证链路）
 *
 * 配置（服务器上，不入 git）：
 *   /opt/hotcrush/scripts/birthday-notify.env   DATABASE_URL + BIRTHDAY_NOTIFY_CHAT_ID
 *   /opt/hotcrush/scripts/lark_app.json         app_id / app_secret（与招募脚本共用）
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const resApiRequire = createRequire(
  process.env.RES_API_PACKAGE_JSON ?? "/opt/hotcrush/res_api/package.json",
);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE =
  process.env.BIRTHDAY_NOTIFY_ENV_FILE ?? path.join(SCRIPT_DIR, "birthday-notify.env");
const LARK_APP_FILE =
  process.env.LARK_APP_FILE ?? path.join(SCRIPT_DIR, "lark_app.json");
const TOKEN_CACHE_FILE =
  process.env.BIRTHDAY_TOKEN_CACHE_FILE ?? path.join(SCRIPT_DIR, "birthday_token_cache.json");

const LARK_BASE = "https://open.larksuite.com/open-apis";
const MAX_ATTEMPTS = 3;

function log(message) {
  console.log(new Date().toISOString() + " [birthday-notify] " + message);
}

function logError(message) {
  console.error(new Date().toISOString() + " [birthday-notify] " + message);
}

/* ── 轻量 env 文件解析 ── */

function loadEnvFile(file) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^["\']|["\']$/g, "");
      }
    }
  } catch {
    /* 文件不存在就只靠进程环境变量（测试场景） */
  }
}

function loadLarkApp() {
  const raw = JSON.parse(readFileSync(LARK_APP_FILE, "utf8"));
  if (typeof raw.app_id !== "string" || typeof raw.app_secret !== "string") {
    throw new Error("lark_app.json 缺 app_id/app_secret");
  }
  return { appId: raw.app_id, appSecret: raw.app_secret };
}

/* ── tenant_access_token（磁盘缓存，约 2 小时有效） ── */

function readTokenCache() {
  try {
    const cached = JSON.parse(readFileSync(TOKEN_CACHE_FILE, "utf8"));
    if (typeof cached.token !== "string" || typeof cached.expires_at !== "number") {
      return null;
    }
    if (cached.expires_at <= Date.now() + 60_000) return null;
    return cached.token;
  } catch {
    return null;
  }
}

function writeTokenCache(token, expiresInSeconds) {
  try {
    writeFileSync(
      TOKEN_CACHE_FILE,
      JSON.stringify({ token, expires_at: Date.now() + expiresInSeconds * 1000 }),
      { mode: 0o600 },
    );
  } catch (error) {
    logError("token 缓存写入失败：" + (error instanceof Error ? error.message : String(error)));
  }
}

async function fetchTenantToken(appId, appSecret) {
  const cached = readTokenCache();
  if (cached) return cached;
  const response = await fetch(
    LARK_BASE + "/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error("tenant token 请求失败 http=" + response.status);
  }
  const body = await response.json();
  if (body.code !== 0 || typeof body.tenant_access_token !== "string") {
    throw new Error("tenant token 响应异常 code=" + body.code + " msg=" + body.msg);
  }
  writeTokenCache(body.tenant_access_token, body.expire ?? 7200);
  return body.tenant_access_token;
}

/* ── 消息拼装（纯函数，供单测） ── */

export function maskPhoneTail(e164) {
  if (typeof e164 !== "string" || e164.length < 5) return null;
  return "**** " + e164.slice(-4);
}

export function buildNoticeText(row) {
  const lines = [
    "[HOT CRUSH] 新的生日礼预约 #" + row.reservation_id,
    "蛋糕：" +
      (row.gift_type === "free_basque"
        ? "免费巴斯克"
        : "450 积分兑换（取货时 POS 扣积分）"),
    "取货：" + row.pickup_date + " " + (row.slot === "noon" ? "午间 12:00–17:00" : "晚间 17:00–21:00"),
    "送给：" +
      (row.for_whom === "gift"
        ? "亲友（" + (row.recipient_note ?? "未填") + "）"
        : "会员自己"),
  ];
  const masked = maskPhoneTail(row.phone_e164);
  if (masked) lines.push("会员：" + masked);
  if (row.level_snapshot) lines.push("等级：" + row.level_snapshot);
  if (row.points_snapshot !== null && row.points_snapshot !== undefined) {
    lines.push("预约时积分余额：" + row.points_snapshot);
  }
  if (row.allergies) lines.push("⚠️ 过敏原：" + row.allergies);
  if (row.member_note) lines.push("留言：" + row.member_note);
  return lines.join("\n");
}

export async function sendLarkText(token, chatId, text) {
  const response = await fetch(
    LARK_BASE + "/im/v1/messages?receive_id_type=chat_id",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error("发消息失败 http=" + response.status);
  }
  const body = await response.json();
  if (body.code !== 0) {
    throw new Error("发消息被拒 code=" + body.code + " msg=" + body.msg);
  }
  return body.data?.message_id ?? null;
}

/* ── 主流程 ── */

const PENDING_SQL =
  "SELECT r.reservation_id, r.gift_type, r.for_whom, r.recipient_note, " +
  "       r.pickup_date::text AS pickup_date, r.slot, r.member_note, " +
  "       r.level_snapshot, r.points_snapshot, r.notify_attempts, " +
  "       p.allergies, m.phone_e164 " +
  "  FROM public.mkt_birthday_reservation r " +
  "  LEFT JOIN public.mkt_birthday_profile p ON p.member_id = r.member_id " +
  "  LEFT JOIN public.pos_member m ON m.member_id = r.member_id " +
  " WHERE r.notify_status = $1 AND r.notify_attempts < $2 " +
  " ORDER BY r.reservation_id LIMIT 20";

const SENT_SQL =
  "UPDATE public.mkt_birthday_reservation " +
  "   SET notify_status = $1, notify_attempts = notify_attempts + 1, updated_at = now() " +
  " WHERE reservation_id = $2";

async function main() {
  loadEnvFile(ENV_FILE);
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const sendTest = args.includes("--send-test");

  const chatId = process.env.BIRTHDAY_NOTIFY_CHAT_ID?.trim();
  if (!chatId) {
    logError("BIRTHDAY_NOTIFY_CHAT_ID is required.");
    process.exit(2);
  }
  const { appId, appSecret } = loadLarkApp();
  const token = await fetchTenantToken(appId, appSecret);

  if (sendTest) {
    await sendLarkText(token, chatId, "[HOT CRUSH] 生日礼预约通知链路测试：服务器 relay 正常。");
    log("测试消息已发送");
    return;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    logError("DATABASE_URL is required.");
    process.exit(2);
  }
  const postgres = resApiRequire("postgres");
  const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 15 });

  try {
    const rows = await sql.unsafe(PENDING_SQL, ["pending", MAX_ATTEMPTS]);
    if (rows.length === 0) {
      log("没有待通知的预约");
      return;
    }

    for (const row of rows) {
      const text = buildNoticeText(row);
      if (dryRun) {
        log("dry-run 将发送 #" + row.reservation_id + ":\n" + text);
        continue;
      }
      try {
        await sendLarkText(token, chatId, text);
        await sql.unsafe(SENT_SQL, ["sent", row.reservation_id]);
        log("已通知 #" + row.reservation_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError("通知失败 #" + row.reservation_id + ": " + message);
        const attempts = Number(row.notify_attempts) + 1;
        const nextStatus = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
        await sql.unsafe(
          "UPDATE public.mkt_birthday_reservation SET notify_attempts = $1, " +
          "  notify_status = $2, updated_at = now() WHERE reservation_id = $3",
          [attempts, nextStatus, row.reservation_id],
        );
      }
    }
  } finally {
    await sql.end();
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    logError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
