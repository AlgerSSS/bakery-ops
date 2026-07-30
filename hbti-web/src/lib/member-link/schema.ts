import { z } from "zod";

export const normalizedMemberPhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone must be a valid international number");

export const campaignVersionSchema = z.string().trim().min(1).max(128);

export const memberLinkSecretSchema = z
  .string()
  .refine(
    (secret) => new TextEncoder().encode(secret).byteLength >= 32,
    "Member-link secret must contain at least 32 bytes",
  );

export const memberLinkTokenSchema = z
  .string()
  .min(64)
  .max(4_096)
  .regex(/^[A-Za-z0-9_-]+$/, "Token must use base64url characters");

export const memberLinkPayloadSchema = z
  .object({
    version: z.literal(1),
    phone: normalizedMemberPhoneSchema,
    campaignVersion: campaignVersionSchema,
    expiresAt: z.number().int().positive(),
    jti: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

export type MemberLinkPayload = z.infer<typeof memberLinkPayloadSchema>;

export function normalizeMemberPhone(phone: string): string {
  const compact = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .parse(phone)
    .replace(/[\s().-]/g, "");

  return normalizedMemberPhoneSchema.parse(compact);
}
