import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStaffSessionToken,
  readStaffSession,
  verifyStaffAccessCode,
} from "@/lib/staff/session";

beforeEach(() => {
  vi.stubEnv("STAFF_REWARDS_ACCESS_CODE", "store-code-123456");
  vi.stubEnv("STAFF_REWARDS_SESSION_SECRET", "staff-session-secret-that-is-long-enough-123");
});

afterEach(() => vi.unstubAllEnvs());

describe("staff session", () => {
  it("compares the configured access code and rejects a wrong value", () => {
    expect(verifyStaffAccessCode("store-code-123456")).toBe(true);
    expect(verifyStaffAccessCode("store-code-123457")).toBe(false);
  });

  it("signs an eight-hour staff session and verifies its cookie", () => {
    const issued = createStaffSessionToken("Alicia", 1_000);
    const request = new Request("https://staff.test", {
      headers: { cookie: `hbti_staff=${issued.token}` },
    });
    expect(readStaffSession(request, 1_001)).toEqual({
      staffId: "Alicia",
      expiresAt: 29_800,
    });
    expect(readStaffSession(request, 29_800)).toBeNull();
  });

  it("rejects a modified token", () => {
    const issued = createStaffSessionToken("Alicia", 1_000);
    const request = new Request("https://staff.test", {
      headers: { cookie: `hbti_staff=${issued.token}x` },
    });
    expect(readStaffSession(request, 1_001)).toBeNull();
  });
});
