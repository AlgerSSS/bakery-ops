import { createHash } from "node:crypto";

import { MongoClient, type Collection } from "mongodb";

interface RateLimitDocument {
  _id: string;
  count: number;
  expiresAt: Date;
}

interface RateLimitInput {
  scope: "session" | "complete";
  token: string;
  limit: number;
  windowMs: number;
  now?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

let mongoClientPromise: Promise<MongoClient> | undefined;
let rateLimitIndexPromise: Promise<string> | undefined;

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
  const expiresAt = new Date(windowStart + windowMs * 2);
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const collection = await getRateLimitCollection();
  const result = await collection.findOneAndUpdate(
    { _id: `${scope}:${windowStart}:${tokenHash}` },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt },
    },
    {
      upsert: true,
      returnDocument: "after",
    },
  );
  if (!result) {
    throw new Error("Rate-limit counter was not returned.");
  }

  return {
    allowed: result.count <= limit,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((windowStart + windowMs - now) / 1_000),
    ),
  };
}

async function getRateLimitCollection(): Promise<
  Collection<RateLimitDocument>
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
    appName: "hotcrush-hbti-rate-limit",
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
    .collection<RateLimitDocument>("rate_limits");
  rateLimitIndexPromise ??= collection
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    .catch((error) => {
      rateLimitIndexPromise = undefined;
      throw error;
    });
  await rateLimitIndexPromise;
  return collection;
}
