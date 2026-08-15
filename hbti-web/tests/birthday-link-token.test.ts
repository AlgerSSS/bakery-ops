import { describe, expect, it } from "vitest";

import {
  signBirthdayLinkToken,
  verifyBirthdayLinkToken,
} from "@/lib/birthday/link-token";

const SECRET = "test-secret-key-with-at-least-32-bytes!!";
const NOW = new Date("2026-08-15T04:00:00.000Z");
const EXP = Math.floor(NOW.getTime() / 1000) + 30 * 86400;

describe("birthday link token", () => {
  it("签发后可验证并还原载荷", () => {
    const token = signBirthdayLinkToken({ mid: "2063178969381101576", exp: EXP, name: "Nicole" }, SECRET);
    const result = verifyBirthdayLinkToken(token, SECRET, NOW);
    expect(result).toEqual({
      ok: true,
      payload: { mid: "2063178969381101576", exp: EXP, name: "Nicole" },
    });
  });

  it("不带称呼也可以", () => {
    const token = signBirthdayLinkToken({ mid: "abc123", exp: EXP }, SECRET);
    const result = verifyBirthdayLinkToken(token, SECRET, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.name).toBeUndefined();
  });

  it("篡改任一字节都过不了签名校验", () => {
    const token = signBirthdayLinkToken({ mid: "abc123", exp: EXP }, SECRET);
    const body = token.slice(0, -2);
    const tampered = body + (token.endsWith("AA") ? "BB" : "AA");
    expect(verifyBirthdayLinkToken(tampered, SECRET, NOW)).toEqual({
      ok: false, reason: "bad_signature",
    });
  });

  it("密钥错了就是无效签名", () => {
    const token = signBirthdayLinkToken({ mid: "abc123", exp: EXP }, SECRET);
    const result = verifyBirthdayLinkToken(token, SECRET + "x", NOW);
    expect(result.ok).toBe(false);
  });

  it("过期令牌给出明确原因", () => {
    const token = signBirthdayLinkToken({ mid: "abc123", exp: EXP }, SECRET);
    const later = new Date((EXP + 1) * 1000);
    expect(verifyBirthdayLinkToken(token, SECRET, later)).toEqual({
      ok: false, reason: "expired",
    });
  });

  it("畸形输入安全拒绝", () => {
    expect(verifyBirthdayLinkToken("", SECRET, NOW).ok).toBe(false);
    expect(verifyBirthdayLinkToken("no-dot-here", SECRET, NOW).ok).toBe(false);
    expect(verifyBirthdayLinkToken("a".repeat(600), SECRET, NOW).ok).toBe(false);
    const badJson = Buffer.from("not json").toString("base64url");
    expect(verifyBirthdayLinkToken(badJson + ".sig", SECRET, NOW).ok).toBe(false);
  });

  it("签发侧校验 member id 与称呼长度", () => {
    expect(() => signBirthdayLinkToken({ mid: "bad id!", exp: EXP }, SECRET)).toThrow();
    expect(() => signBirthdayLinkToken({ mid: "abc123", exp: EXP, name: "x".repeat(65) }, SECRET)).toThrow();
  });
});
