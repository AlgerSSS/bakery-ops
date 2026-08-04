// 发码限流里不需要数据库的部分：密钥校验、输入校验、以及 readClientIp 的解析。
// 计数与窗口行为搬到了 tests/pg-stores.integration.test.ts——`INSERT ... ON CONFLICT
// DO UPDATE ... RETURNING count` 的原子性只有真库能验证。
import { describe, expect, it, vi } from "vitest";

import {
  PgAuthRateLimiter,
  readClientIp,
  UNTRUSTED_IP_IDENTITY,
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
  it("Vercel 部署优先采用边缘专有头", () => {
    vi.stubEnv("VERCEL", "1");
    try {
      const request = new Request("https://hbti.example/api", {
        headers: {
          "x-vercel-forwarded-for": "198.51.100.23",
          "x-forwarded-for": "203.0.113.7",
        },
      });
      expect(readClientIp(request)).toBe("198.51.100.23");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("Vercel 缺失专有头时采用边缘覆写的标准 XFF，避免所有顾客共用一个桶", () => {
    vi.stubEnv("VERCEL", "1");
    try {
      const request = new Request("https://hbti.example/api", {
        headers: { "x-forwarded-for": "203.0.113.7" },
      });
      expect(readClientIp(request)).toBe("203.0.113.7");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("非 Vercel 的 production 不信任 XFF，统一进入固定兜底桶", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    try {
      const request = new Request("https://hbti.example/api", {
        headers: { "x-forwarded-for": "203.0.113.7" },
      });
      expect(readClientIp(request)).toBe(UNTRUSTED_IP_IDENTITY);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("x-forwarded-for 取最后一段：客户端塞在链首的伪造值开不了新桶", () => {
    const request = new Request("https://hbti.example/api", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1, 203.0.113.7" },
    });
    expect(readClientIp(request)).toBe("203.0.113.7");
  });

  it("接受合法 IPv6 字面量，并统一小写消除写法变体", () => {
    const request = new Request("https://hbti.example/api", {
      headers: { "x-forwarded-for": "2001:DB8::1" },
    });
    expect(readClientIp(request)).toBe("2001:db8::1");
  });

  it("链尾不是合法 IP 时不回显原始字符串，收敛到固定兜底身份", () => {
    const request = new Request("https://hbti.example/api", {
      headers: {
        "x-forwarded-for": `203.0.113.7, ${"b".repeat(600)}`,
      },
    });
    expect(readClientIp(request)).toBe(UNTRUSTED_IP_IDENTITY);
  });

  it("不信任 x-real-ip：即使提供合法伪造值也只能进固定兜底桶", () => {
    // x-real-ip 不是边缘覆写的可信来源，客户端可任意伪造；
    // 接受它就等于留下「轮换合法伪造 IP 开无限桶」的口子。
    expect(
      readClientIp(
        new Request("https://hbti.example/api", {
          headers: { "x-real-ip": "192.0.2.1" },
        }),
      ),
    ).toBe(UNTRUSTED_IP_IDENTITY);
    expect(
      readClientIp(
        new Request("https://hbti.example/api", {
          headers: { "x-real-ip": "c".repeat(600) },
        }),
      ),
    ).toBe(UNTRUSTED_IP_IDENTITY);
  });

  it("所有头都缺失时给出固定兜底身份，而不是空串或 unknown", () => {
    expect(readClientIp(new Request("https://hbti.example/api"))).toBe(
      UNTRUSTED_IP_IDENTITY,
    );
  });
});
