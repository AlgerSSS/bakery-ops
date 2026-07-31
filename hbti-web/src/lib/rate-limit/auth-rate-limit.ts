import { createHmac } from "node:crypto";

import { MongoClient, type Collection } from "mongodb";

interface AuthRateLimitDocument {
  _id: string;
  count: number;
  expiresAt: Date;
}

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

export class MongoAuthRateLimiter {
  private readonly identityKey: Buffer;

  constructor(
    private readonly collection: Collection<AuthRateLimitDocument>,
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
    const decisions = await Promise.all(
      OTP_REQUEST_RULES.map(async (rule) => {
        const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
        const result = await this.collection.findOneAndUpdate(
          {
            _id: `${rule.scope}:${windowStart}:${identities[rule.identity]}`,
          },
          {
            $inc: { count: 1 },
            $setOnInsert: {
              expiresAt: new Date(windowStart + rule.windowMs),
            },
          },
          {
            upsert: true,
            returnDocument: "after",
          },
        );
        if (!result) {
          throw new Error("Auth rate-limit counter was not returned.");
        }
        return {
          allowed: result.count <= rule.limit,
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
          : Math.max(
              ...denied.map((decision) => decision.retryAfterSeconds),
            ),
    };
  }

  private hashIdentity(kind: "phone" | "ip", value: string): string {
    return createHmac("sha256", this.identityKey)
      .update(`${kind}:`, "utf8")
      .update(value, "utf8")
      .digest("hex");
  }
}

let mongoClientPromise: Promise<MongoClient> | undefined;
let rateLimitIndexPromise: Promise<string> | undefined;

export async function createAuthRateLimiterFromEnv(
  secret: string,
): Promise<MongoAuthRateLimiter> {
  const collection = await getAuthRateLimitCollection();
  return new MongoAuthRateLimiter(collection, secret);
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

async function getAuthRateLimitCollection(): Promise<
  Collection<AuthRateLimitDocument>
> {
  const connectionString = process.env.MONGODB_URI?.trim();
  if (
    !connectionString ||
    (!connectionString.startsWith("mongodb://") &&
      !connectionString.startsWith("mongodb+srv://"))
  ) {
    throw new Error("MONGODB_URI is invalid.");
  }

  mongoClientPromise ??= new MongoClient(connectionString, {
    appName: "hotcrush-hbti-auth-rate-limit",
    maxPoolSize: 2,
    maxIdleTimeMS: 10_000,
    serverSelectionTimeoutMS: 8_000,
    retryWrites: true,
    writeConcern: {
      w: "majority",
      j: true,
    },
  })
    .connect()
    .catch((error) => {
      mongoClientPromise = undefined;
      throw error;
    });

  const client = await mongoClientPromise;
  const collection = client
    .db("hotcrush_hbti")
    .collection<AuthRateLimitDocument>("auth_rate_limits");
  rateLimitIndexPromise ??= collection
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    .catch((error) => {
      rateLimitIndexPromise = undefined;
      throw error;
    });
  await rateLimitIndexPromise;
  return collection;
}
