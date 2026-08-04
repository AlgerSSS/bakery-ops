#!/usr/bin/env node
// 告警中转：把「谁都能发的 {text} webhook」翻译成 Lark 应用 API 的一条消息。
//
// 为什么需要它：四个告警发送点（hbti-web/Vercel、res_api 每晚刷新、HBTI 令牌轮换与保温）
// 都只会 POST 一个 URL，而这台机器上唯一在用的 Lark 投递通道是**应用 API**
// （/opt/hotcrush/scripts/lark_app.json，招聘早报每天在用），不是群机器人 hook。
// 中转让四个运行时共用一个 URL，同时把 app_secret 留在这台机器的 600 文件里——
// 不必复制进 Vercel（那把密钥同时能读 HR 多维表格，扩散出去代价太大）。
//
// 契约（对调用方）：
//   POST <BASE>/<PATH_TOKEN>   body: {"text": "..."}  或 Lark 形状 {"msg_type","content":{"text"}}
//   200 {"code":0}      = Lark 已接收
//   502 {"code":<非零>} = Lark 拒收，调用方应记为未送达并重试
// 路径里的随机段就是凭据（与 Slack/Lark webhook 同一模型）；不在日志里回显它。

import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT || 8791);
const LARK_APP_FILE =
  process.env.LARK_APP_FILE || "/opt/hotcrush/scripts/lark_app.json";
const PATH_TOKEN = process.env.ALERT_PATH_TOKEN?.trim();
const OPEN_IDS = (process.env.ALERT_OPEN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const LARK_BASE = process.env.LARK_BASE || "https://open.larksuite.com";
const MAX_BODY_BYTES = 16 * 1024;

if (!PATH_TOKEN || PATH_TOKEN.length < 24) {
  console.error("ALERT_PATH_TOKEN 缺失或太短（至少 24 字符）——那是这个端点唯一的凭据");
  process.exit(1);
}
if (OPEN_IDS.length === 0) {
  console.error("ALERT_OPEN_IDS 为空——没有收件人的告警等于没有告警");
  process.exit(1);
}

// 租户令牌有效期约 2 小时。提前 5 分钟过期重取，避免拿着刚好过期的令牌去发告警。
let cachedToken = { value: "", expiresAt: 0 };

async function tenantAccessToken() {
  if (cachedToken.value && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }
  const app = JSON.parse(readFileSync(LARK_APP_FILE, "utf8"));
  const res = await fetch(
    `${LARK_BASE}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: app.app_id,
        app_secret: app.app_secret,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = await res.json();
  if (body.code !== 0 || !body.tenant_access_token) {
    throw new Error(`tenant_access_token failed code=${body.code}`);
  }
  cachedToken = {
    value: body.tenant_access_token,
    expiresAt: Date.now() + Math.max(60, (body.expire ?? 7200) - 300) * 1_000,
  };
  return cachedToken.value;
}

async function deliver(text) {
  const token = await tenantAccessToken();
  const failures = [];
  for (const openId of OPEN_IDS) {
    const res = await fetch(
      `${LARK_BASE}/open-apis/im/v1/messages?receive_id_type=open_id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: openId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = await res.json().catch(() => ({ code: -1 }));
    // Lark 用 HTTP 200 + 非零 code 表示「没送到」，必须看 code 而不是状态码。
    if (body.code !== 0) failures.push(`${openId.slice(0, 6)}…:${body.code}`);
  }
  return failures;
}

createServer((request, response) => {
  const reply = (status, payload) => {
    const json = JSON.stringify(payload);
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(json),
    });
    response.end(json);
  };

  if (request.method !== "POST") return reply(405, { code: 405 });
  // 路径就是凭据。长度不同直接判错，避免把「路径长度」当侧信道。
  const supplied = (request.url || "").replace(/^\/+/, "").split("?")[0];
  if (supplied !== PATH_TOKEN) return reply(404, { code: 404 });

  let raw = "";
  let tooLarge = false;
  request.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) {
      tooLarge = true;
      request.destroy();
    }
  });
  request.on("end", async () => {
    if (tooLarge) return reply(413, { code: 413 });
    let text = "";
    try {
      const parsed = JSON.parse(raw);
      // 两种上游形状都收：老脚本发 {text}，改造后的 Lark 分支发 msg_type/content。
      text =
        typeof parsed?.text === "string"
          ? parsed.text
          : typeof parsed?.content?.text === "string"
            ? parsed.content.text
            : "";
    } catch {
      return reply(400, { code: 400 });
    }
    if (!text.trim()) return reply(400, { code: 400 });

    try {
      const failures = await deliver(text);
      if (failures.length > 0) {
        console.error(`[relay] 未送达 ${failures.join(" ")}`);
        return reply(502, { code: 1, undelivered: failures.length });
      }
      console.log(`[relay] 已送达 ${OPEN_IDS.length} 人：${text.slice(0, 80)}`);
      return reply(200, { code: 0 });
    } catch (error) {
      console.error(`[relay] 发送失败 ${String(error)}`);
      return reply(502, { code: 2 });
    }
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[relay] listening on 127.0.0.1:${PORT}, ${OPEN_IDS.length} 个收件人`);
});
