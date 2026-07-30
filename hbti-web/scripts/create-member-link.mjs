#!/usr/bin/env node

import {
  createCipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { z } from "zod";

const DEFAULT_BASE_URL = "https://hbti-test.hotcrush.net";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_CONTEXT = Buffer.from("hbti-member-link:v1", "utf8");

const normalizedPhoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/);

const environmentSchema = z.object({
  HBTI_TEST_PHONE: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .transform((phone) => phone.replace(/[\s().-]/g, ""))
    .pipe(normalizedPhoneSchema),
  HBTI_LINK_SECRET: z
    .string()
    .refine(
      (secret) => new TextEncoder().encode(secret).byteLength >= 32,
    ),
  HBTI_CAMPAIGN_VERSION: z.string().trim().min(1).max(128),
  HBTI_LINK_BASE_URL: z
    .url()
    .refine((value) => new URL(value).protocol === "https:")
    .default(DEFAULT_BASE_URL),
  HBTI_LINK_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_TTL_SECONDS),
});

function createToken({ phone, secret, campaignVersion, expiresAt }) {
  const payload = {
    version: 1,
    phone,
    campaignVersion,
    expiresAt,
    jti: randomBytes(16).toString("base64url"),
  };
  const key = createHash("sha256").update(secret, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(TOKEN_CONTEXT);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}

try {
  const environment = environmentSchema.parse(process.env);
  const token = createToken({
    phone: environment.HBTI_TEST_PHONE,
    secret: environment.HBTI_LINK_SECRET,
    campaignVersion: environment.HBTI_CAMPAIGN_VERSION,
    expiresAt:
      Math.floor(Date.now() / 1_000) + environment.HBTI_LINK_TTL_SECONDS,
  });
  const url = new URL(
    `/t/${token}`,
    environment.HBTI_LINK_BASE_URL,
  ).toString();

  process.stdout.write(`${url}\n`);
} catch {
  process.stderr.write(
    "Unable to create member link. Check the HBTI environment variables.\n",
  );
  process.exitCode = 1;
}
