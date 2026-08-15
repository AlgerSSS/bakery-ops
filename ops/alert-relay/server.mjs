#!/usr/bin/env node
// 本机告警中转：把 HTTP POST 转成一条 Lark 私聊消息。
//
// 为什么要它，而不是直接往 .env 填一个 Lark 群机器人 webhook：
//   · 群机器人 webhook 是一个新的长期密钥，拿到它的人就能往群里发东西；
//     而这台机器上**已经有** Lark 应用凭据（/opt/hotcrush/scripts/lark_app.json），
//     复用它就不必再引入、保管、轮换一个新密钥。
//   · 调用方（hbti-token 的 keepalive.sh / run.sh）只认「POST 一个 JSON，看 HTTP 2xx」，
//     本机中转完全满足，而且只监听 127.0.0.1，不对外暴露。
//
// 2026-08-06 重建。原版在 Contabo 的 /opt/hotcrush/alert-relay/server.mjs，
// **从未纳入版本控制**，随那台机器一起没了 —— 所以这次放进仓库。
//
// 用法：ALERT_WEBHOOK=http://127.0.0.1:8791/alert
// 接受两种包体（调用方按目标 URL 形状二选一，这里都收）：
//   {"text":"..."}                                  ← 通用分支
//   {"msg_type":"text","content":{"text":"..."}}    ← Lark 群机器人分支
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.ALERT_RELAY_PORT || 8791);
const HOST = "127.0.0.1"; // 只监听回环：这台机器同时跑着 Xray，任何多余的对外监听面都不要开
const CONFIG = process.env.LARK_APP_CONFIG || "/opt/hotcrush/scripts/lark_app.json";
const BASE = "https://open.larksuite.com/open-apis";

const log = (msg, extra) =>
  process.stdout.write(
    `${new Date().toISOString()} ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}\n`,
  );

function loadConfig() {
  const c = JSON.parse(readFileSync(CONFIG, "utf8"));
  const openId = process.env.ALERT_OPEN_ID || c.hr_open_id;
  if (!c.app_id || !c.app_secret) throw new Error(`${CONFIG} 缺 app_id/app_secret`);
  if (!openId) throw new Error(`${CONFIG} 缺 hr_open_id，且未设 ALERT_OPEN_ID`);
  return { appId: c.app_id, appSecret: c.app_secret, openId };
}

// tenant_access_token 有效期约 2 小时。缓存它不只是省延迟 —— Lark 是按自然月
// 10000 次计费的，告警本身很少，但每次都换令牌会让计费翻倍。提前 60 秒过期。
let cached = { token: "", expiresAt: 0 };
async function tenantToken({ appId, appSecret }) {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (body.code !== 0 || !body.tenant_access_token) {
    throw new Error(`取 tenant_access_token 失败 code=${body.code} msg=${body.msg}`);
  }
  cached = {
    token: body.tenant_access_token,
    expiresAt: Date.now() + Math.max(60, (body.expire ?? 7200) - 60) * 1000,
  };
  return cached.token;
}

async function sendLark(text) {
  const cfg = loadConfig();
  const token = await tenantToken(cfg);
  const res = await fetch(`${BASE}/im/v1/messages?receive_id_type=open_id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: cfg.openId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  // Lark 用「HTTP 200 + 非零 code」表示拒收，只看状态码会把失败当成功。
  if (body.code !== 0) throw new Error(`发送失败 code=${body.code} msg=${body.msg}`);
  return body.data?.message_id ?? "";
}

function extractText(raw) {
  try {
    const o = JSON.parse(raw);
    if (typeof o?.text === "string" && o.text.trim()) return o.text.trim();
    if (typeof o?.content?.text === "string" && o.content.text.trim()) return o.content.text.trim();
    if (typeof o?.content === "string") {
      const inner = JSON.parse(o.content);
      if (typeof inner?.text === "string" && inner.text.trim()) return inner.text.trim();
    }
  } catch { /* 非 JSON：当纯文本处理 */ }
  return raw.trim();
}

const server = createServer((req, res) => {
  const reply = (status, obj) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(obj));
  };

  if (req.method === "GET") return reply(200, { ok: true, service: "alert-relay" });
  if (req.method !== "POST") return reply(405, { code: 405, msg: "POST only" });

  let raw = "";
  req.on("data", (c) => {
    raw += c;
    if (raw.length > 64_000) req.destroy(); // 告警文案不可能这么长，防呆
  });
  req.on("end", async () => {
    const text = extractText(raw);
    if (!text) return reply(400, { code: 400, msg: "empty text" });
    try {
      const id = await sendLark(text);
      log("已转发到 Lark", { chars: text.length, messageId: id });
      // 回 code:0 —— 与 Lark 群机器人回包同形，调用方那套收据校验不用区分目标。
      reply(200, { code: 0, msg: "ok" });
    } catch (err) {
      log("转发失败", { error: String(err) });
      // 必须回非 2xx：调用方靠状态码判「送到了没有」，
      // 这里回 200 会让一条没送出去的告警被记成已送达。
      reply(502, { code: 502, msg: String(err) });
    }
  });
});

server.listen(PORT, HOST, () => log(`alert-relay 就绪 http://${HOST}:${PORT}`));
