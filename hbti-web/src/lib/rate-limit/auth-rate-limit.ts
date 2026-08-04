import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import { getDb, type SqlRunner } from "@/lib/db/postgres";
import { bumpRateLimitBucket } from "@/lib/rate-limit/pg-rate-limit";

interface AuthRateLimitRule {
  scope: string;
  identity: "phone" | "ip";
  limit: number;
  windowMs: number;
}

const OTP_PHONE_DAY_RULE: AuthRateLimitRule = {
  scope: "otp-phone-day",
  identity: "phone",
  limit: 5,
  windowMs: 24 * 60 * 60_000,
};

const OTP_REQUEST_RULES: readonly AuthRateLimitRule[] = [
  {
    scope: "otp-phone-minute",
    identity: "phone",
    limit: 1,
    windowMs: 60_000,
  },
  OTP_PHONE_DAY_RULE,
  {
    scope: "otp-ip-ten-minute",
    identity: "ip",
    limit: 10,
    windowMs: 10 * 60_000,
  },
  {
    scope: "otp-ip-day",
    identity: "ip",
    limit: 50,
    windowMs: 24 * 60 * 60_000,
  },
];

export interface AuthRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  /**
   * 这个号码在当前 24 小时窗口内第几次获准进入发码流程（含本次）。
   *
   * 被分钟/IP 门禁拒绝的请求不会消耗这个每日发送额度。它只用于在真正获准
   * 调用 RES 时如实提示：当天第二次及以后，供应商可能返回成功但不再送达短信。
   */
  phoneAttemptsToday: number;
}

export interface OtpRequestRateLimitInput {
  phoneE164: string;
  ipAddress: string;
  now?: number;
}

/**
 * 无法确定客户端 IP 时使用的固定兜底身份。
 *
 * 必须对所有请求恒定、且不可能与任何合法 IP 字面量撞车：非法/缺失的 IP 若按
 * 原始字符串各开一桶，伪造者轮换任意字符串就等于手握无限个独立限流桶，
 * 既绕过配额又把 `hbti_rate_limit` 表撑爆。
 */
export const UNTRUSTED_IP_IDENTITY = "untrusted-ip";

/**
 * 兜底桶的 IP 配额按正常配额的 1/5 收紧（10 分钟 2 次、每天 10 次）。
 *
 * 正常 IP 配额是按家庭宽带 / 共享 NAT 下可能有多个真实用户定的；而 Vercel 边缘
 * 总会覆写 `x-vercel-forwarded-for`，真实用户正常不会落进兜底桶——落进去的基本是
 * 边缘配置异常或在故意伪造头。1/5 的取舍：偶发异常的真实流量不至于完全不可用，
 * 而「主动发垃圾头挤进兜底桶」的攻击被压到每天最多 10 条短信。
 */
const UNTRUSTED_IP_LIMIT_DIVISOR = 5;

/**
 * 发码限流：手机号 1/分、5 次获准发送/天；IP 10/10 分、50/天。
 * IP 落入兜底身份时两条 IP 规则自动收紧到 1/5。IP 与手机号分钟桶始终计数；
 * 只有这些门禁全部通过才原子增加手机号每日发送额度，避免攻击者用分钟内的
 * 拒绝请求耗尽受害者整天的 OTP 配额。
 */
export class PgAuthRateLimiter {
  private readonly identityKey: Buffer;

  constructor(
    private readonly sql: SqlRunner,
    secret: string,
  ) {
    if (Buffer.byteLength(secret, "utf8") < 32) {
      throw new Error("HBTI_AUTH_SECRET must contain at least 32 bytes.");
    }
    this.identityKey = createHmac("sha256", secret)
      .update("hbti-auth:v1:rate-limit", "utf8")
      .digest();
  }

  async consumeOtpRequest({
    phoneE164,
    ipAddress,
    now = Date.now(),
  }: OtpRequestRateLimitInput): Promise<AuthRateLimitDecision> {
    if (
      !/^\+[1-9]\d{6,14}$/.test(phoneE164) ||
      !ipAddress ||
      ipAddress.length > 512 ||
      !Number.isFinite(now)
    ) {
      throw new Error("Invalid auth rate-limit input.");
    }

    const untrustedIp = ipAddress === UNTRUSTED_IP_IDENTITY;
    const identities = {
      phone: this.hashIdentity("phone", phoneE164),
      ip: this.hashIdentity("ip", ipAddress),
    };
    const consumeRule = async (rule: AuthRateLimitRule) => {
      const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
      const count = await bumpRateLimitBucket(
        this.sql,
        `${rule.scope}:${windowStart}:${identities[rule.identity]}`,
        new Date(windowStart + rule.windowMs),
      );
      const limit =
        untrustedIp && rule.identity === "ip"
          ? Math.max(1, Math.floor(rule.limit / UNTRUSTED_IP_LIMIT_DIVISOR))
          : rule.limit;
      return {
        scope: rule.scope,
        count,
        allowed: count <= limit,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((windowStart + rule.windowMs - now) / 1_000),
        ),
      };
    };

    // IP abuse counters and the atomic phone-minute gate always advance. The long-lived
    // phone-day quota advances only for the one concurrent request that clears all gates.
    const gateDecisions = await Promise.all(
      OTP_REQUEST_RULES.filter((rule) => rule !== OTP_PHONE_DAY_RULE).map(
        consumeRule,
      ),
    );
    const gateDenied = gateDecisions.filter((decision) => !decision.allowed);
    if (gateDenied.length > 0) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          ...gateDenied.map((decision) => decision.retryAfterSeconds),
        ),
        phoneAttemptsToday: 0,
      };
    }

    const phoneDay = await consumeRule(OTP_PHONE_DAY_RULE);
    return {
      allowed: phoneDay.allowed,
      retryAfterSeconds: phoneDay.allowed ? 0 : phoneDay.retryAfterSeconds,
      phoneAttemptsToday: phoneDay.count,
    };
  }

  private hashIdentity(kind: "phone" | "ip", value: string): string {
    return createHmac("sha256", this.identityKey)
      .update(`${kind}:`, "utf8")
      .update(value, "utf8")
      .digest("hex");
  }
}

export async function createAuthRateLimiterFromEnv(
  secret: string,
): Promise<PgAuthRateLimiter> {
  return new PgAuthRateLimiter(getDb(), secret);
}

export function readClientIp(request: Request): string {
  // Vercel 会在边缘覆写 X-Forwarded-For，防止客户端伪造；专有头是有上游代理时
  // 更可靠的同义来源。只在 VERCEL=1 的受控部署里信任它们，不能仅凭 NODE_ENV。
  if (process.env.VERCEL === "1") {
    return (
      lastValidIp(request.headers.get("x-vercel-forwarded-for")) ??
      lastValidIp(request.headers.get("x-forwarded-for")) ??
      UNTRUSTED_IP_IDENTITY
    );
  }

  // 本地开发/测试允许 XFF 来模拟代理后的请求。其他 production 运行时没有可信代理
  // 契约，缺失专有签名时必须收敛到固定桶，不能按客户端原始头开无限个桶。
  if (process.env.NODE_ENV !== "production") {
    return (
      lastValidIp(request.headers.get("x-forwarded-for")) ??
      UNTRUSTED_IP_IDENTITY
    );
  }

  return UNTRUSTED_IP_IDENTITY;
}

/**
 * 取逗号分隔链的最后一段并校验；只返回合法 IP 字面量。
 * 统一小写以消除 IPv6 十六进制的大小写写法变体，避免同一地址开出多个桶。
 */
function lastValidIp(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }
  const segments = headerValue.split(",");
  const last = segments[segments.length - 1]?.trim().toLowerCase();
  return last && isIP(last) ? last : null;
}
