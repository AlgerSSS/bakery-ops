import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 生日贺卡专属链接的签名令牌。店家在推送（WhatsApp/Lark）时按会员生成，
 * 顾客点开即识别身份，不用再收短信验证码。
 *
 * 设计取舍：
 * - 不透明、不可伪造：HMAC-SHA256 签名 + 常数时间比对；令牌本身只是一张
 *   「入场券」，不包含手机号等 PII（name 仅在生成侧明确提供时才带）。
 * - 有有效期：生日卡是时令活动，过期令牌直接失效，降低长期泄露面。
 * - 只能看 + 只能约：持有者可读该会员的年度回顾并预约生日礼。
 *   转发泄露的最坏结果是帮这位会员多看到一次自己的卡片；预约有年度唯一约束
 *   与门店取货核对兜底，风险接受。
 */

const PAYLOAD_VERSION = 1;
const MEMBER_ID_PATTERN = /^[A-Za-z0-9]{6,32}$/;
const MAX_NAME_LENGTH = 64;
const MAX_TOKEN_LENGTH = 512;

export interface BirthdayLinkPayload {
  /** RES 会员 ID。 */
  mid: string;
  /** 过期时间（epoch 秒）。 */
  exp: number;
  /** 可选称呼：链接生成侧从 RES 拿到名字时带上，卡片用它做问候。 */
  name?: string;
}

export function signBirthdayLinkToken(
  payload: BirthdayLinkPayload,
  secret: string,
): string {
  if (!MEMBER_ID_PATTERN.test(payload.mid)) {
    throw new Error("Invalid member id for birthday link.");
  }
  if (!Number.isSafeInteger(payload.exp) || payload.exp <= 0) {
    throw new Error("Invalid expiry for birthday link.");
  }
  if (payload.name !== undefined && payload.name.length > MAX_NAME_LENGTH) {
    throw new Error("Birthday link display name is too long.");
  }
  const body = base64UrlEncode(
    JSON.stringify({ v: PAYLOAD_VERSION, ...payload }),
  );
  return body + "." + sign(body, secret);
}

export type BirthdayLinkVerification =
  | { ok: true; payload: BirthdayLinkPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyBirthdayLinkToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): BirthdayLinkVerification {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "malformed" };
  }
  const dot = token.lastIndexOf(".");
  if (dot <= 0) {
    return { ok: false, reason: "malformed" };
  }
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body, secret);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(body));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== PAYLOAD_VERSION
  ) {
    return { ok: false, reason: "malformed" };
  }
  const candidate = parsed as { mid?: unknown; exp?: unknown; name?: unknown };
  if (
    typeof candidate.mid !== "string" ||
    !MEMBER_ID_PATTERN.test(candidate.mid) ||
    typeof candidate.exp !== "number" ||
    !Number.isSafeInteger(candidate.exp) ||
    (candidate.name !== undefined &&
      (typeof candidate.name !== "string" ||
        candidate.name.length > MAX_NAME_LENGTH))
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (candidate.exp * 1000 <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return {
    ok: true,
    payload: {
      mid: candidate.mid,
      exp: candidate.exp,
      name: candidate.name as string | undefined,
    },
  };
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}
