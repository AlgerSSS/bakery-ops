import { z } from "zod";

import { findSupportedCountry } from "@/lib/auth/countries";
import type { AuthPhoneIdentity } from "@/lib/auth/pg-auth-store";
import type { ResH5PhoneIdentity } from "@/lib/res/h5-member-auth";

/**
 * The dial code, the ISO code and the national number are checked together
 * against one row of the country table. Checking them independently would
 * accept a mismatched pair such as {countryCode:"60", isoCode:"CN"} and send
 * the OTP to the wrong network.
 */
export const authPhoneRequestSchema = z
  .strictObject({
    countryCode: z.string(),
    isoCode: z.string(),
    phone: z.string(),
  })
  .superRefine((value, ctx) => {
    const country = findSupportedCountry(value.isoCode);
    if (!country) {
      ctx.addIssue({
        code: "custom",
        path: ["isoCode"],
        message: "Unsupported country.",
      });
      return;
    }
    if (country.countryCode !== value.countryCode) {
      ctx.addIssue({
        code: "custom",
        path: ["countryCode"],
        message: "Country code does not match the country.",
      });
      return;
    }
    if (!country.pattern.test(value.phone)) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Phone number is not valid for this country.",
      });
    }
  });

export type AuthPhoneRequest = z.infer<typeof authPhoneRequestSchema>;

export interface NormalizedAuthPhone {
  identity: AuthPhoneIdentity;
  resPhone: ResH5PhoneIdentity;
  maskedPhone: string;
}

export function normalizeAuthPhone(value: unknown): NormalizedAuthPhone {
  const phone = authPhoneRequestSchema.parse(value);
  const e164 = `+${phone.countryCode}${phone.phone}`;
  return {
    identity: { ...phone, e164 },
    resPhone: phone,
    maskedPhone: maskAuthPhone({ ...phone, e164 }),
  };
}

export function maskAuthPhone(identity: AuthPhoneIdentity): string {
  const startLength = identity.phone.length >= 10 ? 3 : 2;
  const endLength = identity.phone.length >= 10 ? 4 : 2;
  const hiddenLength = Math.max(
    1,
    identity.phone.length - startLength - endLength,
  );
  return `+${identity.countryCode} ${identity.phone.slice(
    0,
    startLength,
  )}${"*".repeat(hiddenLength)}${identity.phone.slice(-endLength)}`;
}
