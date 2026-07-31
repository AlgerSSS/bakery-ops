// 发码限流里不需要数据库的部分：密钥校验、输入校验、以及 readClientIp 的解析。
// 计数与窗口行为搬到了 tests/pg-stores.integration.test.ts——`INSERT ... ON CONFLICT
// DO UPDATE ... RETURNING count` 的原子性只有真库能验证。
import { describe, expect, it, vi } from "vitest";

import {
  PgAuthRateLimiter,
  readClientIp,
} from "@/lib/rate-limit/auth-rate-limit";
import type { SqlRunner } from "@/lib/db/postgres";

const secret = "auth-rate-limit-secret-".repeat(3);

function forbiddenSql() {
  const sql = vi.fn(() => {
    throw new Error("limiter must not query the database for this input");
  });
  return sql as unknown as SqlRunner & { mock: { calls: unknown[] } };
}

describe("PgAuthRateLimiter", () => {
  it("拒绝短于 32 字节的密钥", () => {
    expect(() => new PgAuthRateLimiter(forbiddenSql(), "short")).toThrow(
      "HBTI_AUTH_SECRET must contain at least 32 bytes.",
    );
  });

  it.each([
    ["手机号不是 E.164", { phoneE164: "0123456789", ipAddress: "1.2.3.4" }],
    ["手机号带前导 0", { phoneE164: "+0123456789", ipAddress: "1.2.3.4" }],
    ["IP 为空", { phoneE164: "+60123456789", ipAddress: "" }],
    ["IP 过长", { phoneE164: "+60123456789", ipAddress: "a".repeat(513) }],
  ])("输入非法时（%s）在查库之前抛错", async (_label, input) => {
    const sql = forbiddenSql();
    const limiter = new PgAuthRateLimiter(sql, secret);
    await expect(limiter.consumeOtpRequest(input)).rejects.toThrow(
      "Invalid auth rate-limit input.",
    );
    expect(sql.mock.calls).toHaveLength(0);
  });
});

describe("readClientIp", () => {
  it("取 x-forwarded-for 的第一段并截断，不回显整个头", () => {
    const request = new Request("https://hbti.example/api", {
      headers: {
        "x-forwarded-for": ` 203.0.113.7 , 10.0.0.1, ${"b".repeat(600)}`,
      },
    });
    expect(readClientIp(request)).toBe("203.0.113.7");
  });

  it("没有 x-forwarded-for 时回落 x-real-ip，也做长度上限", () => {
    const long = "c".repeat(600);
    expect(
      readClientIp(
        new Request("https://hbti.example/api", {
          headers: { "x-real-ip": long },
        }),
      ),
    ).toHaveLength(512);
  });

  it("两个头都没有时给出 unknown，而不是空串", () => {
    expect(readClientIp(new Request("https://hbti.example/api"))).toBe(
      "unknown",
    );
  });
});
