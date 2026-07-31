import { createHash } from "node:crypto";

import { getDb, type SqlRunner } from "@/lib/db/postgres";

/**
 * 固定窗口计数器，存在 `hbti_rate_limit`（迁移 063）。
 *
 * Mongo 的 `findOneAndUpdate({$inc:{count:1}, $setOnInsert:{expiresAt}}, {upsert:true,
 * returnDocument:'after'})` 在 PG 里就是 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`：
 * 同样单语句原子、同样返回自增之后的值。**不能拆成先 SELECT 再 UPDATE**——并发下每个请求
 * 都会读到同一个旧值，限流上限就成了摆设。
 *
 * 桶键里只放主体的哈希，不放手机号或 IP 明文。
 */

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateLimitInput {
  scope: "session" | "complete";
  token: string;
  limit: number;
  windowMs: number;
  now?: number;
}

async function bump(
  sql: SqlRunner,
  bucket: string,
  expiresAt: Date,
): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    INSERT INTO hbti_rate_limit (bucket, count, expires_at)
    VALUES (${bucket}, 1, ${expiresAt})
    ON CONFLICT (bucket) DO UPDATE SET count = hbti_rate_limit.count + 1
    RETURNING count
  `;
  if (rows.length !== 1) {
    throw new Error("Rate-limit counter was not returned.");
  }
  return rows[0].count;
}

export async function consumeTokenRateLimit({
  scope,
  token,
  limit,
  windowMs,
  now = Date.now(),
}: RateLimitInput): Promise<RateLimitDecision> {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    !Number.isInteger(windowMs) ||
    windowMs < 1_000 ||
    !Number.isFinite(now)
  ) {
    throw new Error("Invalid rate-limit configuration.");
  }

  const windowStart = Math.floor(now / windowMs) * windowMs;
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const count = await bump(
    getDb(),
    `${scope}:${windowStart}:${tokenHash}`,
    new Date(windowStart + windowMs * 2),
  );

  return {
    allowed: count <= limit,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((windowStart + windowMs - now) / 1_000),
    ),
  };
}

export { bump as bumpRateLimitBucket };
