import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

import {
  campaignVersionSchema,
  memberLinkPayloadSchema,
  memberLinkSecretSchema,
  memberLinkTokenSchema,
  normalizeMemberPhone,
  type MemberLinkPayload,
} from "./schema";

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const TOKEN_CONTEXT = Buffer.from("hbti-member-link:v1", "utf8");

export type MemberLinkErrorCode =
  | "INVALID_TOKEN"
  | "EXPIRED"
  | "CAMPAIGN_MISMATCH"
  | "INVALID_SECRET"
  | "INVALID_INPUT";

export class MemberLinkError extends Error {
  readonly code: MemberLinkErrorCode;

  constructor(code: MemberLinkErrorCode, message: string) {
    super(message);
    this.name = "MemberLinkError";
    this.code = code;
  }
}

const createMemberLinkTokenInputSchema = z.object({
  phone: z.string(),
  campaignVersion: campaignVersionSchema,
  expiresAt: z.number().int().positive(),
  secret: memberLinkSecretSchema,
});

const verifyMemberLinkTokenInputSchema = z.object({
  token: memberLinkTokenSchema,
  secret: memberLinkSecretSchema,
  expectedCampaignVersion: campaignVersionSchema,
  now: z.number().int().nonnegative().optional(),
});

export type CreateMemberLinkTokenInput = z.input<
  typeof createMemberLinkTokenInputSchema
>;

export type VerifyMemberLinkTokenInput = z.input<
  typeof verifyMemberLinkTokenInputSchema
>;

function parseStrongSecret(value: unknown): string {
  const result = memberLinkSecretSchema.safeParse(value);
  if (!result.success) {
    throw new MemberLinkError(
      "INVALID_SECRET",
      "HBTI_LINK_SECRET must contain at least 32 bytes",
    );
  }
  return result.data;
}

function parseCreateInput(
  input: CreateMemberLinkTokenInput,
): z.output<typeof createMemberLinkTokenInputSchema> {
  if (typeof input !== "object" || input === null) {
    throw new MemberLinkError("INVALID_INPUT", "Invalid member-link input");
  }
  parseStrongSecret(input.secret);

  const result = createMemberLinkTokenInputSchema.safeParse(input);
  if (!result.success) {
    throw new MemberLinkError("INVALID_INPUT", "Invalid member-link input");
  }

  try {
    return {
      ...result.data,
      phone: normalizeMemberPhone(result.data.phone),
    };
  } catch {
    throw new MemberLinkError("INVALID_INPUT", "Invalid member-link input");
  }
}

function parseVerifyInput(
  input: VerifyMemberLinkTokenInput,
): z.output<typeof verifyMemberLinkTokenInputSchema> {
  if (typeof input !== "object" || input === null) {
    throw new MemberLinkError("INVALID_INPUT", "Invalid member-link input");
  }
  parseStrongSecret(input.secret);

  const result = verifyMemberLinkTokenInputSchema.safeParse(input);
  if (!result.success) {
    const tokenIsInvalid = result.error.issues.some(
      (issue) => issue.path[0] === "token",
    );
    throw new MemberLinkError(
      tokenIsInvalid ? "INVALID_TOKEN" : "INVALID_INPUT",
      tokenIsInvalid ? "Invalid member link" : "Invalid member-link input",
    );
  }
  return result.data;
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function createMemberLinkToken(
  input: CreateMemberLinkTokenInput,
): string {
  const parsed = parseCreateInput(input);
  const payload = memberLinkPayloadSchema.parse({
    version: 1,
    phone: parsed.phone,
    campaignVersion: parsed.campaignVersion,
    expiresAt: parsed.expiresAt,
    jti: randomBytes(16).toString("base64url"),
  });

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(parsed.secret), iv);
  cipher.setAAD(TOKEN_CONTEXT);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}

export function verifyMemberLinkToken(
  input: VerifyMemberLinkTokenInput,
): MemberLinkPayload {
  const parsed = parseVerifyInput(input);

  try {
    const envelope = Buffer.from(parsed.token, "base64url");

    if (
      envelope.byteLength <= IV_BYTES + AUTH_TAG_BYTES ||
      envelope.toString("base64url") !== parsed.token
    ) {
      throw new MemberLinkError("INVALID_TOKEN", "Invalid member link");
    }

    const iv = envelope.subarray(0, IV_BYTES);
    const authTag = envelope.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = envelope.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(parsed.secret),
      iv,
    );
    decipher.setAAD(TOKEN_CONTEXT);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    const payload = memberLinkPayloadSchema.parse(JSON.parse(plaintext));

    if (payload.campaignVersion !== parsed.expectedCampaignVersion) {
      throw new MemberLinkError(
        "CAMPAIGN_MISMATCH",
        "Member link is for a different campaign",
      );
    }

    const now = parsed.now ?? Math.floor(Date.now() / 1_000);

    if (payload.expiresAt <= now) {
      throw new MemberLinkError("EXPIRED", "Member link has expired");
    }

    return payload;
  } catch (error) {
    if (error instanceof MemberLinkError) {
      throw error;
    }
    throw new MemberLinkError("INVALID_TOKEN", "Invalid member link");
  }
}
