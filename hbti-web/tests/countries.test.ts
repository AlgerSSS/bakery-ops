import { describe, expect, it } from "vitest";

import {
  findSupportedCountry,
  isSupportedCountryPair,
  normalizeNationalNumber,
  supportedCountries,
} from "@/lib/auth/countries";

const country = (isoCode: string) => {
  const match = findSupportedCountry(isoCode);
  if (!match) {
    throw new Error(`Test setup: ${isoCode} is not in the table.`);
  }
  return match;
};

describe("supported country table", () => {
  it("keeps Malaysia first so the home market is the default selection", () => {
    expect(supportedCountries[0]?.isoCode).toBe("MY");
  });

  it("holds no duplicate ISO codes", () => {
    const isoCodes = supportedCountries.map((entry) => entry.isoCode);
    expect(new Set(isoCodes).size).toBe(isoCodes.length);
  });

  it("pairs a dial code with exactly one country", () => {
    expect(isSupportedCountryPair("MY", "60")).toBe(true);
    expect(isSupportedCountryPair("SG", "65")).toBe(true);
    // The pair, not the two fields independently — this is what stops an OTP
    // being routed to the wrong network.
    expect(isSupportedCountryPair("CN", "60")).toBe(false);
    expect(isSupportedCountryPair("SG", "852")).toBe(false);
    expect(isSupportedCountryPair("GB", "44")).toBe(false);
  });

  it("accepts a sample number for every country it offers", () => {
    for (const entry of supportedCountries) {
      const sample = entry.placeholder.replace(/\D/g, "");
      expect(
        entry.pattern.test(sample),
        `${entry.isoCode} placeholder "${entry.placeholder}" must be a valid national number`,
      ).toBe(true);
    }
  });
});

describe("normalizeNationalNumber", () => {
  it("strips separators", () => {
    expect(normalizeNationalNumber("12 345 6789", country("MY"))).toBe(
      "123456789",
    );
  });

  it("strips a trunk prefix only where the country uses one", () => {
    expect(normalizeNationalNumber("0123456789", country("MY"))).toBe(
      "123456789",
    );
    // Singapore has no trunk prefix, so a leading 0 is simply not a valid
    // number rather than something to quietly remove.
    expect(normalizeNationalNumber("081234567", country("SG"))).toBe(
      "081234567",
    );
  });

  it("strips the dial code when the customer types it", () => {
    expect(normalizeNationalNumber("+60 12 345 6789", country("MY"))).toBe(
      "123456789",
    );
    expect(normalizeNationalNumber("6281234567890", country("ID"))).toBe(
      "81234567890",
    );
  });

  it("keeps digits that only look like a dial code", () => {
    // A Thai mobile can legitimately begin with 66. Slicing the dial code off
    // unconditionally would eat the first two digits and send the OTP to a
    // different subscriber.
    expect(normalizeNationalNumber("661234567", country("TH"))).toBe(
      "661234567",
    );
    // Same trap for Indonesia, whose mobiles start with 8 and whose dial code
    // is 62 — "628…" is ambiguous, and only one reading validates.
    expect(normalizeNationalNumber("81234567", country("ID"))).toBe(
      "81234567",
    );
  });

  it("returns the typed digits unchanged when nothing validates", () => {
    // The caller shows its own "invalid number" message; normalisation must not
    // invent a number that happens to pass.
    expect(normalizeNationalNumber("999", country("MY"))).toBe("999");
  });
});
