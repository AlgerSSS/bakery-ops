#!/usr/bin/env node
/**
 * 生日贺卡专属链接生成器（门店/运营使用）。
 *
 * 用法：
 *   node scripts/generate-birthday-links.mjs --member <memberId>[,<memberId>...] [--name 称呼] [--days 30]
 *   node scripts/generate-birthday-links.mjs --top 10        # 年度消费前 10 的会员（预览/灰度用）
 *
 * 环境：
 *   BIRTHDAY_LINK_SECRET  签名密钥（必须，≥32 字节；与 Vercel 上的一致）
 *   DATABASE_URL          仅 --top 需要（只读查询 pos_member / pos_member_order_item）
 *   BIRTHDAY_LINK_BASE    链接前缀，默认 https://birthday.hotcrush.net
 *
 * 输出只含 memberId 与链接，绝不打印手机号（仓库纪律）。
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

// 轻量读 .env.local（存在的话），不引依赖。
for (const candidate of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(new URL("../" + candidate, import.meta.url), "utf8").split("\n")) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* 不存在就算了 */ }
}

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const secret = process.env.BIRTHDAY_LINK_SECRET?.trim();
if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
  console.error("BIRTHDAY_LINK_SECRET is required (>= 32 bytes).");
  process.exit(1);
}
const baseUrl = (process.env.BIRTHDAY_LINK_BASE?.trim() || "https://birthday.hotcrush.net").replace(/\/$/, "");
const days = Number(argValue("days", "30"));
if (!Number.isSafeInteger(days) || days <= 0) {
  console.error("--days must be a positive integer.");
  process.exit(1);
}
const singleName = argValue("name", undefined);

function sign(memberId, name) {
  const payload = { v: 1, mid: memberId, exp: Math.floor(Date.now() / 1000) + days * 86400 };
  if (name) payload.name = name;
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return baseUrl + "/t/" + body + "." + sig;
}

async function main() {
  const membersArg = argValue("member", undefined);
  const topArg = argValue("top", undefined);

  if (membersArg) {
    const ids = membersArg.split(",").map((s) => s.trim()).filter(Boolean);
    for (const id of ids) {
      if (!/^[A-Za-z0-9]{6,32}$/.test(id)) {
        console.error("invalid member id: " + id);
        process.exit(1);
      }
    }
    // 有 DATABASE_URL 时先核对会员在库里存在（防手滑把链接发给错的人）。
    // 库里查不到只警告不拦截：爬虫每日同步，RES 里可能已有更新的会员。
    if (process.env.DATABASE_URL) {
      const { default: postgres } = await import("postgres");
      const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
      try {
        const rows = await sql`
          SELECT member_id FROM public.pos_member WHERE member_id = ANY(${ids})
        `;
        const known = new Set(rows.map((r) => String(r.member_id)));
        for (const id of ids) {
          if (!known.has(id)) {
            console.error("warn: member " + id + " 不在 pos_member（可能是新会员尚未同步）");
          }
        }
      } finally {
        await sql.end();
      }
    }
    for (const id of ids) {
      console.log(id + "  " + sign(id, singleName));
    }
    return;
  }

  if (topArg) {
    const n = Number(topArg);
    if (!Number.isSafeInteger(n) || n <= 0 || n > 500) {
      console.error("--top must be 1..500");
      process.exit(1);
    }
    const { default: postgres } = await import("postgres");
    const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
    try {
      const year = new Date().getFullYear();
      const rows = await sql`
        SELECT member_id, SUM(net_sales)::float8 AS net
          FROM public.pos_member_order_item
         WHERE member_id IS NOT NULL
           AND business_date >= ${year + "-01-01"}::date
         GROUP BY member_id
         ORDER BY net DESC
         LIMIT ${n}
      `;
      for (const row of rows) {
        console.log(String(row.member_id) + "  " + sign(String(row.member_id), singleName));
      }
    } finally {
      await sql.end();
    }
    return;
  }

  console.error("usage: --member <id>[,<id>...] [--name 称呼] [--days 30]  |  --top N");
  process.exit(1);
}

await main();
