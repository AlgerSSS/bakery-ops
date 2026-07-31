import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import { MongoClient, type Collection } from "mongodb";
import { z } from "zod";

export const AUTH_CHALLENGE_TTL_MS = 10 * 60 * 1_000;
export const AUTH_SESSION_TTL_MS = 2 * 60 * 60 * 1_000;
export const AUTH_MAX_VERIFY_ATTEMPTS = 5;

const authPhoneIdentitySchema = z.strictObject({
  countryCode: z.string().regex(/^[1-9]\d{0,3}$/),
  isoCode: z.string().regex(/^[A-Z]{2}$/),
  phone: z.string().regex(/^\d{4,15}$/),
  e164: z.string().regex(/^\+[1-9]\d{6,14}$/),
});

const pendingAuthPayloadSchema = z.strictObject({
  guestToken: z.string().min(1).max(4_096),
  deviceId: z.string().min(1).max(1_024),
  identity: authPhoneIdentitySchema,
  verifiedCode: z.string().regex(/^\d{6}$/).optional(),
});

const authSessionPayloadSchema = z.strictObject({
  resToken: z.string().min(1).max(8_192),
  memberId: z.string().min(1).max(1_024),
  identity: authPhoneIdentitySchema,
});

const encryptedPayloadSchema = z.strictObject({
  version: z.literal(1),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/),
});

const authChallengeDocumentSchema = encryptedPayloadSchema.extend({
  _id: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["pending", "verifying", "consumed"]),
  attempts: z.number().int().min(0).max(AUTH_MAX_VERIFY_ATTEMPTS),
  createdAt: z.date(),
  expiresAt: z.date(),
});

const authSessionDocumentSchema = encryptedPayloadSchema.extend({
  _id: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.date(),
  expiresAt: z.date(),
});

export type AuthPhoneIdentity = z.infer<typeof authPhoneIdentitySchema>;
export type PendingAuthPayload = z.infer<typeof pendingAuthPayloadSchema>;
export type AuthSessionPayload = z.infer<typeof authSessionPayloadSchema>;

interface EncryptedPayload {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

interface AuthChallengeDocument extends EncryptedPayload {
  _id: string;
  state: "pending" | "verifying" | "consumed";
  attempts: number;
  createdAt: Date;
  expiresAt: Date;
}

interface AuthSessionDocument extends EncryptedPayload {
  _id: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface MongoAuthStoreOptions {
  now?: () => number;
}

export interface CreatedAuthChallenge {
  token: string;
  expiresAt: Date;
}

export interface AuthChallengeAttempt {
  payload: PendingAuthPayload;
  attempts: number;
  expiresAt: Date;
}

export interface CreatedAuthSession {
  token: string;
  expiresAt: Date;
  draftKey: string;
}

export interface AuthSession {
  payload: AuthSessionPayload;
  expiresAt: Date;
  draftKey: string;
}

export class MongoAuthStore {
  private readonly challengeEncryptionKey: Buffer;
  private readonly sessionEncryptionKey: Buffer;
  private readonly draftHmacKey: Buffer;
  private readonly now: () => number;

  constructor(
    private readonly challenges: Collection<AuthChallengeDocument>,
    private readonly sessions: Collection<AuthSessionDocument>,
    secret: string,
    options: MongoAuthStoreOptions = {},
  ) {
    const secretBytes = Buffer.from(secret, "utf8");
    if (secretBytes.byteLength < 32) {
      throw new Error("HBTI_AUTH_SECRET must contain at least 32 bytes.");
    }
    this.challengeEncryptionKey = deriveKey(
      secretBytes,
      "hbti-auth:v1:challenge-encryption",
    );
    this.sessionEncryptionKey = deriveKey(
      secretBytes,
      "hbti-auth:v1:session-encryption",
    );
    this.draftHmacKey = deriveKey(
      secretBytes,
      "hbti-auth:v1:draft-hmac",
    );
    this.now = options.now ?? Date.now;
  }

  async createChallenge(
    payload: PendingAuthPayload,
  ): Promise<CreatedAuthChallenge> {
    const parsedPayload = pendingAuthPayloadSchema.parse(payload);
    const token = randomToken();
    const createdAt = validNow(this.now());
    const expiresAt = new Date(createdAt.getTime() + AUTH_CHALLENGE_TTL_MS);
    await this.challenges.insertOne({
      _id: tokenHash(token),
      state: "pending",
      attempts: 0,
      createdAt,
      expiresAt,
      ...encryptPayload(parsedPayload, this.challengeEncryptionKey),
    });
    return { token, expiresAt };
  }

  async beginAttempt(token: string): Promise<AuthChallengeAttempt | null> {
    if (!isRawToken(token)) {
      return null;
    }
    const now = validNow(this.now());
    const document = await this.challenges.findOneAndUpdate(
      {
        _id: tokenHash(token),
        state: "pending",
        attempts: { $lt: AUTH_MAX_VERIFY_ATTEMPTS },
        expiresAt: { $gt: now },
      },
      {
        $set: { state: "verifying" },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after" },
    );
    const parsedDocument = authChallengeDocumentSchema.safeParse(document);
    if (
      !parsedDocument.success ||
      parsedDocument.data._id !== tokenHash(token) ||
      parsedDocument.data.state !== "verifying" ||
      parsedDocument.data.expiresAt <= now
    ) {
      return null;
    }
    const payload = decryptAndValidate(
      parsedDocument.data,
      this.challengeEncryptionKey,
      pendingAuthPayloadSchema,
    );
    if (!payload) {
      return null;
    }
    return {
      payload,
      attempts: parsedDocument.data.attempts,
      expiresAt: parsedDocument.data.expiresAt,
    };
  }

  async releaseAttempt(token: string): Promise<boolean> {
    if (!isRawToken(token)) {
      return false;
    }
    const result = await this.challenges.updateOne(
      {
        _id: tokenHash(token),
        state: "verifying",
        attempts: { $lt: AUTH_MAX_VERIFY_ATTEMPTS },
        expiresAt: { $gt: validNow(this.now()) },
      },
      { $set: { state: "pending" } },
    );
    return result.modifiedCount === 1;
  }

  async markConflict(token: string, code: string): Promise<boolean> {
    if (!isRawToken(token) || !/^\d{6}$/.test(code)) {
      return false;
    }
    const now = validNow(this.now());
    const expectedId = tokenHash(token);
    const document = await this.challenges.findOne({
      _id: expectedId,
      state: "verifying",
      expiresAt: { $gt: now },
    });
    const parsedDocument = authChallengeDocumentSchema.safeParse(document);
    if (
      !parsedDocument.success ||
      parsedDocument.data._id !== expectedId ||
      parsedDocument.data.state !== "verifying" ||
      parsedDocument.data.expiresAt <= now
    ) {
      return false;
    }
    const payload = decryptAndValidate(
      parsedDocument.data,
      this.challengeEncryptionKey,
      pendingAuthPayloadSchema,
    );
    if (!payload) {
      return false;
    }
    const encrypted = encryptPayload(
      { ...payload, verifiedCode: code },
      this.challengeEncryptionKey,
    );
    const result = await this.challenges.updateOne(
      {
        _id: expectedId,
        state: "verifying",
        expiresAt: { $gt: now },
        ciphertext: parsedDocument.data.ciphertext,
      },
      {
        $set: {
          state: "pending",
          ...encrypted,
        },
      },
    );
    return result.modifiedCount === 1;
  }

  async consumeChallenge(token: string): Promise<boolean> {
    if (!isRawToken(token)) {
      return false;
    }
    const result = await this.challenges.updateOne(
      {
        _id: tokenHash(token),
        state: "verifying",
        expiresAt: { $gt: validNow(this.now()) },
      },
      { $set: { state: "consumed" } },
    );
    return result.modifiedCount === 1;
  }

  async createSession(payload: AuthSessionPayload): Promise<CreatedAuthSession> {
    const parsedPayload = authSessionPayloadSchema.parse(payload);
    const token = randomToken();
    const createdAt = validNow(this.now());
    const expiresAt = new Date(createdAt.getTime() + AUTH_SESSION_TTL_MS);
    await this.sessions.insertOne({
      _id: tokenHash(token),
      createdAt,
      expiresAt,
      ...encryptPayload(parsedPayload, this.sessionEncryptionKey),
    });
    return {
      token,
      expiresAt,
      draftKey: deriveDraftKey(parsedPayload.memberId, this.draftHmacKey),
    };
  }

  async getSession(token: string): Promise<AuthSession | null> {
    if (!isRawToken(token)) {
      return null;
    }
    const now = validNow(this.now());
    const expectedId = tokenHash(token);
    const document = await this.sessions.findOne({ _id: expectedId });
    const parsedDocument = authSessionDocumentSchema.safeParse(document);
    if (
      !parsedDocument.success ||
      parsedDocument.data._id !== expectedId ||
      parsedDocument.data.expiresAt <= now ||
      parsedDocument.data.createdAt >= parsedDocument.data.expiresAt
    ) {
      return null;
    }
    const payload = decryptAndValidate(
      parsedDocument.data,
      this.sessionEncryptionKey,
      authSessionPayloadSchema,
    );
    if (!payload) {
      return null;
    }
    return {
      payload,
      expiresAt: parsedDocument.data.expiresAt,
      draftKey: deriveDraftKey(payload.memberId, this.draftHmacKey),
    };
  }

  async deleteSession(token: string): Promise<boolean> {
    if (!isRawToken(token)) {
      return false;
    }
    const result = await this.sessions.deleteOne({ _id: tokenHash(token) });
    return result.deletedCount === 1;
  }
}

let mongoClientPromise: Promise<MongoClient> | undefined;
let authIndexesPromise: Promise<void> | undefined;

export async function createAuthStoreFromEnv(): Promise<MongoAuthStore> {
  const secret = requireAuthSecret();
  const { challenges, sessions } = await getAuthCollections();
  return new MongoAuthStore(challenges, sessions, secret);
}

async function getAuthCollections(): Promise<{
  challenges: Collection<AuthChallengeDocument>;
  sessions: Collection<AuthSessionDocument>;
}> {
  const client = await getMongoClient();
  const database = client.db("hotcrush_hbti");
  const challenges =
    database.collection<AuthChallengeDocument>("auth_challenges");
  const sessions = database.collection<AuthSessionDocument>("auth_sessions");
  authIndexesPromise ??= Promise.all([
    challenges.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ])
    .then(() => undefined)
    .catch((error) => {
      authIndexesPromise = undefined;
      throw error;
    });
  await authIndexesPromise;
  return { challenges, sessions };
}

async function getMongoClient(): Promise<MongoClient> {
  const connectionString = process.env.MONGODB_URI?.trim();
  if (
    !connectionString ||
    (!connectionString.startsWith("mongodb://") &&
      !connectionString.startsWith("mongodb+srv://"))
  ) {
    throw new Error("MONGODB_URI is invalid.");
  }

  mongoClientPromise ??= new MongoClient(connectionString, {
    appName: "hotcrush-hbti-auth",
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

  return mongoClientPromise;
}

function requireAuthSecret(): string {
  const secret = process.env.HBTI_AUTH_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("HBTI_AUTH_SECRET must contain at least 32 bytes.");
  }
  return secret;
}

function deriveKey(secret: Buffer, label: string): Buffer {
  return createHmac("sha256", secret).update(label, "utf8").digest();
}

function encryptPayload(
  payload: unknown,
  encryptionKey: Buffer,
): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function decryptAndValidate<T>(
  encrypted: EncryptedPayload,
  encryptionKey: Buffer,
  schema: z.ZodType<T>,
): T | null {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(encrypted.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64url")),
      decipher.final(),
    ]);
    return schema.parse(JSON.parse(plaintext.toString("utf8")));
  } catch {
    return null;
  }
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function deriveDraftKey(memberId: string, draftKey: Buffer): string {
  return createHmac("sha256", draftKey)
    .update(memberId, "utf8")
    .digest("base64url");
}

function isRawToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function validNow(now: number): Date {
  if (!Number.isFinite(now)) {
    throw new Error("Auth store clock returned an invalid time.");
  }
  return new Date(now);
}
