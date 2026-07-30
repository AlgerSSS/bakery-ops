import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createMemberLinkToken,
  MemberLinkError,
  verifyMemberLinkToken,
} from "../src/lib/member-link/crypto";

const SECRET = "test-only-member-link-secret-with-at-least-32-bytes";
const CAMPAIGN_VERSION = "2026-08-pistachio-v1";
const NOW = 1_786_000_000;

describe("member link tokens", () => {
  it("round-trips a normalized member identity without exposing it", () => {
    const token = createMemberLinkToken({
      phone: "+1 202 555 0123",
      campaignVersion: CAMPAIGN_VERSION,
      expiresAt: NOW + 3_600,
      secret: SECRET,
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("2025550123");

    expect(
      verifyMemberLinkToken({
        token,
        secret: SECRET,
        expectedCampaignVersion: CAMPAIGN_VERSION,
        now: NOW,
      }),
    ).toMatchObject({
      version: 1,
      phone: "+12025550123",
      campaignVersion: CAMPAIGN_VERSION,
      expiresAt: NOW + 3_600,
    });
  });

  it("uses a fresh random token identifier for every link", () => {
    const create = () =>
      createMemberLinkToken({
        phone: "+1 202 555 0123",
        campaignVersion: CAMPAIGN_VERSION,
        expiresAt: NOW + 3_600,
        secret: SECRET,
      });
    const verify = (token: string) =>
      verifyMemberLinkToken({
        token,
        secret: SECRET,
        expectedCampaignVersion: CAMPAIGN_VERSION,
        now: NOW,
      });

    const firstToken = create();
    const secondToken = create();
    const first = verify(firstToken);
    const second = verify(secondToken);

    expect(firstToken).not.toBe(secondToken);
    expect(first.jti).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(second.jti).not.toBe(first.jti);
  });

  it("rejects a token whose authenticated ciphertext was changed", () => {
    const token = createMemberLinkToken({
      phone: "+1 202 555 0123",
      campaignVersion: CAMPAIGN_VERSION,
      expiresAt: NOW + 3_600,
      secret: SECRET,
    });
    const tampered = Buffer.from(token, "base64url");
    tampered[tampered.length - 1] ^= 1;

    try {
      verifyMemberLinkToken({
        token: tampered.toString("base64url"),
        secret: SECRET,
        expectedCampaignVersion: CAMPAIGN_VERSION,
        now: NOW,
      });
      expect.fail("tampered token should be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(MemberLinkError);
      expect(error).toMatchObject({
        code: "INVALID_TOKEN",
        message: "Invalid member link",
      });
    }
  });

  it("rejects a token at or after its expiry", () => {
    const token = createMemberLinkToken({
      phone: "+1 202 555 0123",
      campaignVersion: CAMPAIGN_VERSION,
      expiresAt: NOW,
      secret: SECRET,
    });

    try {
      verifyMemberLinkToken({
        token,
        secret: SECRET,
        expectedCampaignVersion: CAMPAIGN_VERSION,
        now: NOW,
      });
      expect.fail("expired token should be rejected");
    } catch (error) {
      expect(error).toMatchObject({
        code: "EXPIRED",
        message: "Member link has expired",
      });
    }
  });

  it("rejects a token issued for another campaign", () => {
    const token = createMemberLinkToken({
      phone: "+1 202 555 0123",
      campaignVersion: CAMPAIGN_VERSION,
      expiresAt: NOW + 3_600,
      secret: SECRET,
    });

    try {
      verifyMemberLinkToken({
        token,
        secret: SECRET,
        expectedCampaignVersion: "2026-09-another-campaign",
        now: NOW,
      });
      expect.fail("wrong-campaign token should be rejected");
    } catch (error) {
      expect(error).toMatchObject({
        code: "CAMPAIGN_MISMATCH",
        message: "Member link is for a different campaign",
      });
    }
  });

  it("refuses a member-link secret shorter than 32 bytes", () => {
    try {
      createMemberLinkToken({
        phone: "+1 202 555 0123",
        campaignVersion: CAMPAIGN_VERSION,
        expiresAt: NOW + 3_600,
        secret: "too-short",
      });
      expect.fail("weak secret should be rejected");
    } catch (error) {
      expect(error).toMatchObject({
        code: "INVALID_SECRET",
        message: "HBTI_LINK_SECRET must contain at least 32 bytes",
      });
    }
  });

  it("reports an invalid phone through the public error contract", () => {
    try {
      createMemberLinkToken({
        phone: "2025550123",
        campaignVersion: CAMPAIGN_VERSION,
        expiresAt: NOW + 3_600,
        secret: SECRET,
      });
      expect.fail("ambiguous phone should be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(MemberLinkError);
      expect(error).toMatchObject({
        code: "INVALID_INPUT",
        message: "Invalid member-link input",
      });
    }
  });

  it("creates one safe URL line from environment variables", () => {
    const scriptPath = resolve("scripts/create-member-link.mjs");
    const before = Math.floor(Date.now() / 1_000);
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HBTI_TEST_PHONE: "+1 202 555 0123",
        HBTI_LINK_SECRET: SECRET,
        HBTI_CAMPAIGN_VERSION: CAMPAIGN_VERSION,
        HBTI_LINK_BASE_URL: "https://hbti.example.test",
        HBTI_LINK_TTL_SECONDS: "120",
      },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("2025550123");

    const output = result.stdout.trim();
    const url = new URL(output);
    expect(result.stdout).toBe(`${url.toString()}\n`);
    expect(url.origin).toBe("https://hbti.example.test");
    expect(url.pathname).toMatch(/^\/t\/[A-Za-z0-9_-]+$/);

    const payload = verifyMemberLinkToken({
      token: url.pathname.slice("/t/".length),
      secret: SECRET,
      expectedCampaignVersion: CAMPAIGN_VERSION,
      now: before,
    });
    expect(payload.phone).toBe("+12025550123");
    expect(payload.expiresAt).toBeGreaterThanOrEqual(before + 120);
    expect(payload.expiresAt).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1_000) + 120,
    );
  });

  it("refuses to put a bearer token on a plaintext HTTP URL", () => {
    const scriptPath = resolve("scripts/create-member-link.mjs");
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HBTI_TEST_PHONE: "+1 202 555 0123",
        HBTI_LINK_SECRET: SECRET,
        HBTI_CAMPAIGN_VERSION: CAMPAIGN_VERSION,
        HBTI_LINK_BASE_URL: "http://hbti.example.test",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Unable to create member link. Check the HBTI environment variables.\n",
    );
    expect(result.stderr).not.toContain("2025550123");
  });
});
