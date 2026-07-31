#!/usr/bin/env node

import { z } from "zod";

const DEFAULT_BASE_URL = "https://hbti-test.hotcrush.net";

const environmentSchema = z.object({
  HBTI_LINK_BASE_URL: z
    .url()
    .refine((value) => new URL(value).protocol === "https:")
    .default(DEFAULT_BASE_URL),
});

try {
  const environment = environmentSchema.parse(process.env);
  const memberSignInUrl = new URL(
    "/",
    environment.HBTI_LINK_BASE_URL,
  ).toString();
  const demoUrl = new URL(
    "/demo",
    environment.HBTI_LINK_BASE_URL,
  ).toString();

  process.stdout.write(
    [
      `Member sign-in (OTP): ${memberSignInUrl}`,
      `Demo only (no coupon is issued): ${demoUrl}`,
      "",
    ].join("\n"),
  );
} catch {
  process.stderr.write(
    "Unable to print HBTI URLs. Check HBTI_LINK_BASE_URL.\n",
  );
  process.exitCode = 1;
}
