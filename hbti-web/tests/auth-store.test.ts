// PgAuthStore 里不需要数据库就能验证的部分：构造期的密钥校验，以及「形状不对的令牌
// 必须在发出任何 SQL 之前就被拒绝」。
//
// 有状态的行为（挑战自增与占用、过期、密文被篡改、会话生命周期、PII 不落明文）搬到了
// tests/pg-stores.integration.test.ts——那些断言的是 SQL 判词，只有真库测得出来。
import { describe, expect, it, vi } from "vitest";

import {
  AUTH_CHALLENGE_TTL_MS,
  AUTH_MAX_VERIFY_ATTEMPTS,
  AUTH_SESSION_TTL_MS,
  PgAuthStore,
} from "@/lib/auth/pg-auth-store";
import type { SqlRunner } from "@/lib/db/postgres";

const secret = "auth-store-unit-secret-".repeat(2);

/** 任何一次查询都算失败：这些用例的重点就是「根本没查库」。 */
function forbiddenSql() {
  const sql = vi.fn(() => {
    throw new Error("store must not query the database for this input");
  });
  return sql as unknown as SqlRunner & { mock: { calls: unknown[] } };
}

describe("PgAuthStore", () => {
  it("拒绝短于 32 字节的密钥，不留下一个加密强度不足的 store", () => {
    expect(() => new PgAuthStore(forbiddenSql(), "too-short")).toThrow(
      "HBTI_AUTH_SECRET must contain at least 32 bytes.",
    );
  });

  it("TTL 与尝试上限保持在业务约定的值上", () => {
    expect(AUTH_CHALLENGE_TTL_MS).toBe(10 * 60 * 1_000);
    expect(AUTH_SESSION_TTL_MS).toBe(2 * 60 * 60 * 1_000);
    expect(AUTH_MAX_VERIFY_ATTEMPTS).toBe(5);
  });

  it.each([
    ["空串", ""],
    ["长度不对", "short-token"],
    ["含非法字符", `${"a".repeat(42)}!`],
    ["像 SQL 注入", "'; DROP TABLE hbti_auth_session; --"],
  ])("形状不对的令牌（%s）在查库之前就被拒绝", async (_label, token) => {
    const sql = forbiddenSql();
    const store = new PgAuthStore(sql, secret);

    await expect(store.beginAttempt(token)).resolves.toBeNull();
    await expect(store.getSession(token)).resolves.toBeNull();
    await expect(store.releaseAttempt(token)).resolves.toBe(false);
    await expect(store.consumeChallenge(token)).resolves.toBe(false);
    await expect(store.deleteSession(token)).resolves.toBe(false);
    await expect(store.markConflict(token, "123456")).resolves.toBe(false);
    expect(sql.mock.calls).toHaveLength(0);
  });

  it("验证码格式不对时 markConflict 直接拒绝，不查库", async () => {
    const sql = forbiddenSql();
    const store = new PgAuthStore(sql, secret);
    const token = "a".repeat(43);

    for (const code of ["", "12345", "1234567", "12a456"]) {
      await expect(store.markConflict(token, code)).resolves.toBe(false);
    }
    expect(sql.mock.calls).toHaveLength(0);
  });
});
