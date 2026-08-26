import { describe, expect, it } from "vitest";

import {
  isValidMemberEmail,
  normalizeMemberEmail,
} from "@/lib/member/email-address";

describe("member email validation", () => {
  it("accepts a normal address and trims accidental surrounding spaces", () => {
    expect(normalizeMemberEmail("  hello@example.com  ")).toBe(
      "hello@example.com",
    );
    expect(isValidMemberEmail("  hello@example.com  ")).toBe(true);
  });

  it.each([
    "",
    "not-an-email",
    "missing-domain@",
    "missing-tld@example",
    "two words@example.com",
    `${"a".repeat(245)}@example.com`,
  ])("rejects invalid address %s", (email) => {
    expect(isValidMemberEmail(email)).toBe(false);
  });
});
