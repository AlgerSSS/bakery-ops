import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

import { getDb, type SqlRunner } from "@/lib/db/postgres";

/**
 * OTP 挑战与登录会话存在 `hbti_auth_challenge` / `hbti_auth_session`（迁移 063）。
 *
 * ⚠ 加密没有随迁库一起去掉，这是有意的。payload 仍然是用 HBTI_AUTH_SECRET 派生密钥做的
 * AES-256-GCM 密文，明文含手机号与 RES token。这个库同时被财务站、爬虫、bakery-ops 和
 * Contabo 的脚本连着——把 RES 后台会话令牌以明文摊在上面，等于把发券权限交给任何一个
 * 拿到只读连接串的人。行主键存的也只是令牌的 sha256，不是令牌本身。
 *
 * Mongo 的 findOneAndUpdate 条件更新在这里对应「UPDATE ... WHERE <判词> RETURNING」，
 * 单条语句内原子，语义与原来一一对应。
 */

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

const challengeRowSchema = z.strictObject({
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["pending", "verifying", "consumed"]),
  attempts: z.number().int().min(0).max(AUTH_MAX_VERIFY_ATTEMPTS),
  payload: encryptedPayloadSchema,
  created_at: z.date(),
  expires_at: z.date(),
});

const sessionRowSchema = z.strictObject({
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  payload: encryptedPayloadSchema,
  created_at: z.date(),
  expires_at: z.date(),
});

export type AuthPhoneIdentity = z.infer<typeof authPhoneIdentitySchema>;
export type PendingAuthPayload = z.infer<typeof pendingAuthPayloadSchema>;
export type AuthSessionPayload = z.infer<typeof authSessionPayloadSchema>;

type EncryptedPayload = z.infer<typeof encryptedPayloadSchema>;

export interface PgAuthStoreOptions {
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

export class PgAuthStore {
  private readonly challengeEncryptionKey: Buffer;
  private readonly sessionEncryptionKey: Buffer;
  private readonly draftHmacKey: Buffer;
  private readonly now: () => number;

  constructor(
    private readonly sql: SqlRunner,
    secret: string,
    options: PgAuthStoreOptions = {},
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
    this.draftHmacKey = deriveKey(secretBytes, "hbti-auth:v1:draft-hmac");
    this.now = options.now ?? Date.now;
  }

  async createChallenge(
    payload: PendingAuthPayload,
  ): Promise<CreatedAuthChallenge> {
    const parsedPayload = pendingAuthPayloadSchema.parse(payload);
    const token = randomToken();
    const createdAt = validNow(this.now());
    const expiresAt = new Date(createdAt.getTime() + AUTH_CHALLENGE_TTL_MS);
    const encrypted = encryptPayload(
      parsedPayload,
      this.challengeEncryptionKey,
    );
    await this.sql`
      INSERT INTO hbti_auth_challenge (token_hash, state, attempts, payload, created_at, expires_at)
      VALUES (${tokenHash(token)}, 'pending', 0, ${this.sql.json(encrypted)},
              ${createdAt}, ${expiresAt})
    `;
    return { token, expiresAt };
  }

  async beginAttempt(token: string): Promise<AuthChallengeAttempt | null> {
    if (!isRawToken(token)) {
      return null;
    }
    const now = validNow(this.now());
    // 单条语句里同时占用 pending 态并自增 attempts —— 对应 Mongo 的 findOneAndUpdate。
    // 拆成先读后写会让两个并发请求各拿一次尝试次数，把 5 次上限变成实际无上限。
    const rows = await this.sql`
      UPDATE hbti_auth_challenge
         SET state = 'verifying', attempts = attempts + 1
       WHERE token_hash = ${tokenHash(token)}
         AND state = 'pending'
         AND attempts < ${AUTH_MAX_VERIFY_ATTEMPTS}
         AND expires_at > ${now}
      RETURNING token_hash, state, attempts, payload, created_at, expires_at
    `;
    const parsed = challengeRowSchema.safeParse(rows[0]);
    if (
      !parsed.success ||
      parsed.data.token_hash !== tokenHash(token) ||
      parsed.data.state !== "verifying" ||
      parsed.data.expires_at <= now
    ) {
      return null;
    }
    const payload = decryptAndValidate(
      parsed.data.payload,
      this.challengeEncryptionKey,
      pendingAuthPayloadSchema,
    );
    if (!payload) {
      return null;
    }
    return {
      payload,
      attempts: parsed.data.attempts,
      expiresAt: parsed.data.expires_at,
    };
  }

  async releaseAttempt(token: string): Promise<boolean> {
    if (!isRawToken(token)) {
      return false;
    }
    const result = await this.sql`
      UPDATE hbti_auth_challenge SET state = 'pending'
       WHERE token_hash = ${tokenHash(token)}
         AND state = 'verifying'
         AND attempts < ${AUTH_MAX_VERIFY_ATTEMPTS}
         AND expires_at > ${validNow(this.now())}
    `;
    return result.count === 1;
  }

  async markConflict(token: string, code: string): Promise<boolean> {
    if (!isRawToken(token) || !/^\d{6}$/.test(code)) {
      return false;
    }
    const now = validNow(this.now());
    const expectedHash = tokenHash(token);
    const rows = await this.sql`
      SELECT token_hash, state, attempts, payload, created_at, expires_at
        FROM hbti_auth_challenge
       WHERE token_hash = ${expectedHash} AND state = 'verifying' AND expires_at > ${now}
    `;
    const parsed = challengeRowSchema.safeParse(rows[0]);
    if (
      !parsed.success ||
      parsed.data.token_hash !== expectedHash ||
      parsed.data.state !== "verifying" ||
      parsed.data.expires_at <= now
    ) {
      return false;
    }
    const payload = decryptAndValidate(
      parsed.data.payload,
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
    // 比对旧密文是乐观锁：读到写之间若有别的请求改过这条挑战，这次就不该覆盖它。
    const result = await this.sql`
      UPDATE hbti_auth_challenge
         SET state = 'pending', payload = ${this.sql.json(encrypted)}
       WHERE token_hash = ${expectedHash}
         AND state = 'verifying'
         AND expires_at > ${now}
         AND payload->>'ciphertext' = ${parsed.data.payload.ciphertext}
    `;
    return result.count === 1;
  }

  async consumeChallenge(token: string): Promise<boolean> {
    if (!isRawToken(token)) {
      return false;
    }
    const result = await this.sql`
      UPDATE hbti_auth_challenge SET state = 'consumed'
       WHERE token_hash = ${tokenHash(token)}
         AND state = 'verifying'
         AND expires_at > ${validNow(this.now())}
    `;
    return result.count === 1;
  }

  async createSession(
    payload: AuthSessionPayload,
  ): Promise<CreatedAuthSession> {
    const parsedPayload = authSessionPayloadSchema.parse(payload);
    const token = randomToken();
    const createdAt = validNow(this.now());
    const expiresAt = new Date(createdAt.getTime() + AUTH_SESSION_TTL_MS);
    const encrypted = encryptPayload(parsedPayload, this.sessionEncryptionKey);
    await this.sql`
      INSERT INTO hbti_auth_session (token_hash, payload, created_at, expires_at)
      VALUES (${tokenHash(token)}, ${this.sql.json(encrypted)}, ${createdAt}, ${expiresAt})
    `;
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
    const expectedHash = tokenHash(token);
    const rows = await this.sql`
      SELECT token_hash, payload, created_at, expires_at
        FROM hbti_auth_session WHERE token_hash = ${expectedHash}
    `;
    const parsed = sessionRowSchema.safeParse(rows[0]);
    if (
      !parsed.success ||
      parsed.data.token_hash !== expectedHash ||
      parsed.data.expires_at <= now ||
      parsed.data.created_at >= parsed.data.expires_at
    ) {
      return null;
    }
    const payload = decryptAndValidate(
      parsed.data.payload,
      this.sessionEncryptionKey,
      authSessionPayloadSchema,
    );
    if (!payload) {
      return null;
    }
    return {
      payload,
      expiresAt: parsed.data.expires_at,
      draftKey: deriveDraftKey(payload.memberId, this.draftHmacKey),
    };
  }

  async deleteSession(token: string): Promise<boolean> {
    if (!isRawToken(token)) {
      return false;
    }
    const result = await this.sql`
      DELETE FROM hbti_auth_session WHERE token_hash = ${tokenHash(token)}
    `;
    return result.count === 1;
  }
}

export async function createAuthStoreFromEnv(): Promise<PgAuthStore> {
  const secret = process.env.HBTI_AUTH_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("HBTI_AUTH_SECRET must contain at least 32 bytes.");
  }
  return new PgAuthStore(getDb(), secret);
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
    throw new Error("Invalid clock reading.");
  }
  return new Date(now);
}
