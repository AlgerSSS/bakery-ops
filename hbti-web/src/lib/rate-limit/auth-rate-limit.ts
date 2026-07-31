import { createHmac } from "node:crypto";

import { getDb, type SqlRunner } from "@/lib/db/postgres";
import { bumpRateLimitBucket } from "@/lib/rate-limit/pg-rate-limit";

interface AuthRateLimitRule {
  scope: string;
  identity: "phone" | "ip";
  limit: number;
  windowMs: number;
}

const OTP_REQUEST_RULES: readonly AuthRateLimitRule[] = [
  {
    scope: "otp-phone-minute",
    identity: "phone",
    limit: 1,
    windowMs: 60_000,
  },
  {
    scope: "otp-phone-day",
    identity: "phone",
    limit: 5,
    windowMs: 24 * 60 * 60_000,
  },
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
}

export interface OtpRequestRateLimitInput {
  phoneE164: string;
  ipAddress: string;
  now?: number;
}

/**
 * 发码限流，四条规则同时生效（手机号 1/分、5/天；IP 10/10 分、50/天）。
 * 计数器存在 `hbti_rate_limit`（迁移 063）；手机号与 IP 只以 HMAC 摘要入库。
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

    const identities = {
      phone: this.hashIdentity("phone", phoneE164),
      ip: this.hashIdentity("ip", ipAddress),
    };
    // 四条规则全部自增，即使前面已经判定拒绝——与 Mongo 版行为一致。
    // 只扣第一条会让攻击者靠触发最严格的那条来规避其余窗口的计数。
    const decisions = await Promise.all(
      OTP_REQUEST_RULES.map(async (rule) => {
        const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
        const count = await bumpRateLimitBucket(
          this.sql,
          `${rule.scope}:${windowStart}:${identities[rule.identity]}`,
          new Date(windowStart + rule.windowMs),
        );
        return {
          allowed: count <= rule.limit,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((windowStart + rule.windowMs - now) / 1_000),
          ),
        };
      }),
    );

    const denied = decisions.filter((decision) => !decision.allowed);
    return {
      allowed: denied.length === 0,
      retryAfterSeconds:
        denied.length === 0
          ? 0
          : Math.max(...denied.map((decision) => decision.retryAfterSeconds)),
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
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstAddress = forwardedFor.split(",", 1)[0]?.trim();
    if (firstAddress) {
      return firstAddress.slice(0, 512);
    }
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp ? realIp.slice(0, 512) : "unknown";
}
