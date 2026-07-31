import { describe, expect, it } from "vitest";

import {
  MongoAuthRateLimiter,
  readClientIp,
} from "@/lib/rate-limit/auth-rate-limit";

interface StoredCounter {
  _id: string;
  count: number;
  expiresAt: Date;
}

class FakeCounterCollection {
  readonly values = new Map<string, StoredCounter>();

  async findOneAndUpdate(
    filter: { _id: string },
    update: {
      $inc: { count: number };
      $setOnInsert: { expiresAt: Date };
    },
  ): Promise<StoredCounter> {
    const existing = this.values.get(filter._id);
    const next = existing
      ? { ...existing, count: existing.count + update.$inc.count }
      : {
          _id: filter._id,
          count: update.$inc.count,
          expiresAt: update.$setOnInsert.expiresAt,
        };
    this.values.set(filter._id, structuredClone(next));
    return structuredClone(next);
  }
}

const secret = "auth-rate-limit-secret-".repeat(3);
const start = Date.parse("2026-07-30T10:01:00.000Z");

describe("MongoAuthRateLimiter", () => {
  it("allows one SMS per phone per minute, then returns retry timing", async () => {
    const collection = new FakeCounterCollection();
    const limiter = new MongoAuthRateLimiter(collection as never, secret);
    const input = {
      phoneE164: "+8613912345678",
      ipAddress: "203.0.113.10",
      now: start,
    };

    await expect(limiter.consumeOtpRequest(input)).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    const denied = await limiter.consumeOtpRequest({
      ...input,
      now: start + 1_000,
    });

    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("allows at most five SMS requests per phone in one day", async () => {
    const collection = new FakeCounterCollection();
    const limiter = new MongoAuthRateLimiter(collection as never, secret);

    for (let index = 0; index < 5; index += 1) {
      await expect(
        limiter.consumeOtpRequest({
          phoneE164: "+8613912345678",
          ipAddress: `203.0.113.${index + 1}`,
          now: start + index * 61_000,
        }),
      ).resolves.toMatchObject({ allowed: true });
    }
    await expect(
      limiter.consumeOtpRequest({
        phoneE164: "+8613912345678",
        ipAddress: "203.0.113.9",
        now: start + 5 * 61_000,
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("stores only keyed HMAC identities, never phone or IP plaintext", async () => {
    const collection = new FakeCounterCollection();
    const limiter = new MongoAuthRateLimiter(collection as never, secret);

    await limiter.consumeOtpRequest({
      phoneE164: "+8613912345678",
      ipAddress: "203.0.113.10",
      now: start,
    });

    const serialized = JSON.stringify([...collection.values.values()]);
    expect(serialized).not.toContain("+8613912345678");
    expect(serialized).not.toContain("203.0.113.10");
    for (const key of collection.values.keys()) {
      expect(key).toMatch(
        /^(otp-phone-minute|otp-phone-day|otp-ip-ten-minute|otp-ip-day):\d+:[a-f0-9]{64}$/,
      );
    }
  });

  it("extracts a bounded first proxy address without returning headers", () => {
    expect(
      readClientIp(
        new Request("https://hbti-test.hotcrush.net", {
          headers: {
            "X-Forwarded-For": "203.0.113.10, 198.51.100.2",
          },
        }),
      ),
    ).toBe("203.0.113.10");
    expect(
      readClientIp(
        new Request("https://hbti-test.hotcrush.net", {
          headers: { "X-Real-IP": "198.51.100.3" },
        }),
      ),
    ).toBe("198.51.100.3");
    expect(
      readClientIp(new Request("https://hbti-test.hotcrush.net")),
    ).toBe("unknown");
  });
});
