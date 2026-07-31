import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AUTH_CHALLENGE_TTL_MS,
  AUTH_SESSION_TTL_MS,
  MongoAuthStore,
  type AuthPhoneIdentity,
} from "@/lib/auth/mongo-auth-store";

type StoredDocument = Record<string, unknown> & { _id: string };

class FakeCollection {
  readonly values = new Map<string, StoredDocument>();

  async insertOne(document: StoredDocument) {
    this.values.set(document._id, structuredClone(document));
    return { acknowledged: true };
  }

  async findOne(filter: { _id: string }): Promise<StoredDocument | null> {
    const document = this.values.get(filter._id);
    return document ? structuredClone(document) : null;
  }

  async findOneAndUpdate(
    filter: {
      _id: string;
      state: string;
      attempts: { $lt: number };
      expiresAt: { $gt: Date };
    },
    update: {
      $set: { state: string };
      $inc: { attempts: number };
    },
  ): Promise<StoredDocument | null> {
    const current = this.values.get(filter._id);
    if (
      !current ||
      current.state !== filter.state ||
      typeof current.attempts !== "number" ||
      current.attempts >= filter.attempts.$lt ||
      !(current.expiresAt instanceof Date) ||
      current.expiresAt <= filter.expiresAt.$gt
    ) {
      return null;
    }
    const next = {
      ...current,
      ...update.$set,
      attempts: current.attempts + update.$inc.attempts,
    };
    this.values.set(filter._id, structuredClone(next));
    return structuredClone(next);
  }

  async updateOne(
    filter: {
      _id: string;
      state: string;
      attempts?: { $lt: number };
      expiresAt: { $gt: Date };
    },
    update: { $set: { state: string } },
  ) {
    const current = this.values.get(filter._id);
    if (
      !current ||
      current.state !== filter.state ||
      (filter.attempts &&
        (typeof current.attempts !== "number" ||
          current.attempts >= filter.attempts.$lt)) ||
      !(current.expiresAt instanceof Date) ||
      current.expiresAt <= filter.expiresAt.$gt
    ) {
      return { matchedCount: 0, modifiedCount: 0 };
    }
    this.values.set(
      filter._id,
      structuredClone({ ...current, ...update.$set }),
    );
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async deleteOne(filter: { _id: string }) {
    return { deletedCount: this.values.delete(filter._id) ? 1 : 0 };
  }
}

const identity: AuthPhoneIdentity = {
  countryCode: "86",
  isoCode: "CN",
  phone: "13912345678",
  e164: "+8613912345678",
};

const secret = "auth-secret-".repeat(4);
const now = Date.parse("2026-07-30T10:00:00.000Z");

function tamperBase64Url(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expected an encoded value to tamper with.");
  }
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

function createStore(clock: () => number = () => now) {
  const challenges = new FakeCollection();
  const sessions = new FakeCollection();
  return {
    challenges,
    sessions,
    store: new MongoAuthStore(
      challenges as never,
      sessions as never,
      secret,
      { now: clock },
    ),
  };
}

describe("MongoAuthStore", () => {
  it("creates an encrypted challenge under a hash of a random token", async () => {
    const { challenges, store } = createStore();
    const payload = {
      guestToken: "res-guest-token",
      deviceId: "res-device-id",
      identity,
    };

    const created = await store.createChallenge(payload);

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.expiresAt).toEqual(
      new Date(now + AUTH_CHALLENGE_TTL_MS),
    );
    const [document] = [...challenges.values.values()];
    expect(document._id).toBe(
      createHash("sha256").update(created.token).digest("hex"),
    );
    expect(document._id).not.toBe(created.token);
    expect(document).toMatchObject({
      state: "pending",
      attempts: 0,
      expiresAt: created.expiresAt,
    });
    const stored = JSON.stringify(document);
    for (const plaintext of [
      payload.guestToken,
      payload.deviceId,
      identity.phone,
      identity.e164,
    ]) {
      expect(stored).not.toContain(plaintext);
    }
    expect(Object.keys(document)).not.toEqual(
      expect.arrayContaining([
        "guestToken",
        "deviceId",
        "identity",
        "countryCode",
        "isoCode",
        "phone",
        "e164",
      ]),
    );
  });

  it("atomically begins verification and decrypts the pending payload", async () => {
    const { store } = createStore();
    const payload = {
      guestToken: "res-guest-token",
      deviceId: "res-device-id",
      identity,
    };
    const created = await store.createChallenge(payload);

    await expect(store.beginAttempt(created.token)).resolves.toEqual({
      payload,
      attempts: 1,
      expiresAt: created.expiresAt,
    });
  });

  it("allows only one concurrent verifier to acquire a challenge", async () => {
    const { store } = createStore();
    const created = await store.createChallenge({
      guestToken: "res-guest-token",
      deviceId: "res-device-id",
      identity,
    });

    const attempts = await Promise.all([
      store.beginAttempt(created.token),
      store.beginAttempt(created.token),
    ]);

    expect(attempts.filter((attempt) => attempt !== null)).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt === null)).toHaveLength(1);
  });

  it("persists a verified conflict continuation only inside the encrypted payload", async () => {
    const { challenges, store } = createStore();
    const created = await store.createChallenge({
      guestToken: "res-guest-token",
      deviceId: "res-device-id",
      identity,
    });

    await expect(
      store.markConflict(created.token, "123456"),
    ).resolves.toBe(false);
    await store.beginAttempt(created.token);
    await expect(
      store.markConflict(created.token, "123456"),
    ).resolves.toBe(true);

    const document = challenges.values.get(
      createHash("sha256").update(created.token).digest("hex"),
    );
    expect(document).toBeDefined();
    expect(document?.state).toBe("pending");
    expect(JSON.stringify(document)).not.toContain("123456");
    expect(Object.keys(document ?? {})).not.toContain("verifiedCode");

    await expect(store.beginAttempt(created.token)).resolves.toEqual({
      payload: {
        guestToken: "res-guest-token",
        deviceId: "res-device-id",
        identity,
        verifiedCode: "123456",
      },
      attempts: 2,
      expiresAt: created.expiresAt,
    });
  });

  it("releases failed attempts only while retries remain", async () => {
    const { store } = createStore();
    const created = await store.createChallenge({
      guestToken: "res-guest-token",
      deviceId: "res-device-id",
      identity,
    });

    for (let attempt = 1; attempt < 5; attempt += 1) {
      await expect(store.beginAttempt(created.token)).resolves.toMatchObject({
        attempts: attempt,
      });
      await expect(store.releaseAttempt(created.token)).resolves.toBe(true);
    }
    await expect(store.beginAttempt(created.token)).resolves.toMatchObject({
      attempts: 5,
    });
    await expect(store.releaseAttempt(created.token)).resolves.toBe(false);
    await expect(store.beginAttempt(created.token)).resolves.toBeNull();
  });

  it("consumes a verifying challenge once and prevents replay", async () => {
    const { store } = createStore();
    const created = await store.createChallenge({
      guestToken: "res-guest-token",
      deviceId: "res-device-id",
      identity,
    });
    await store.beginAttempt(created.token);

    await expect(store.consumeChallenge(created.token)).resolves.toBe(true);
    await expect(store.consumeChallenge(created.token)).resolves.toBe(false);
    await expect(store.beginAttempt(created.token)).resolves.toBeNull();
  });

  it("rejects expired, unknown, and malformed challenge tokens", async () => {
    let currentTime = now;
    const { store } = createStore(() => currentTime);
    const created = await store.createChallenge({
      guestToken: "res-guest-token",
      deviceId: "res-device-id",
      identity,
    });
    currentTime = created.expiresAt.getTime();

    await expect(store.beginAttempt(created.token)).resolves.toBeNull();
    await expect(store.beginAttempt("x".repeat(43))).resolves.toBeNull();
    await expect(store.beginAttempt("not-a-token")).resolves.toBeNull();
  });

  it("creates, reads, and deletes an encrypted two-hour session", async () => {
    const { sessions, store } = createStore();
    const payload = {
      resToken: "sensitive-res-member-token",
      memberId: "member-123456",
      identity,
    };

    const created = await store.createSession(payload);

    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.expiresAt).toEqual(new Date(now + AUTH_SESSION_TTL_MS));
    expect(created.draftKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [document] = [...sessions.values.values()];
    expect(document._id).toBe(
      createHash("sha256").update(created.token).digest("hex"),
    );
    const stored = JSON.stringify(document);
    for (const plaintext of [
      payload.resToken,
      payload.memberId,
      identity.phone,
      identity.e164,
    ]) {
      expect(stored).not.toContain(plaintext);
    }
    expect(Object.keys(document)).not.toEqual(
      expect.arrayContaining([
        "resToken",
        "memberId",
        "identity",
        "countryCode",
        "isoCode",
        "phone",
        "e164",
      ]),
    );

    await expect(store.getSession(created.token)).resolves.toEqual({
      payload,
      expiresAt: created.expiresAt,
      draftKey: created.draftKey,
    });
    await expect(store.deleteSession(created.token)).resolves.toBe(true);
    await expect(store.getSession(created.token)).resolves.toBeNull();
    await expect(store.deleteSession(created.token)).resolves.toBe(false);
  });

  it("uses distinct bearer tokens while keeping draft keys stable per member", async () => {
    const { store } = createStore();
    const challengePayload = {
      guestToken: "res-guest-token",
      deviceId: "res-device-id",
      identity,
    };
    const sessionPayload = {
      resToken: "sensitive-res-member-token",
      memberId: "member-123456",
      identity,
    };

    const [firstChallenge, secondChallenge] = await Promise.all([
      store.createChallenge(challengePayload),
      store.createChallenge(challengePayload),
    ]);
    const [firstSession, secondSession] = await Promise.all([
      store.createSession(sessionPayload),
      store.createSession(sessionPayload),
    ]);
    const anotherMember = await store.createSession({
      ...sessionPayload,
      memberId: "member-654321",
    });

    expect(firstChallenge.token).not.toBe(secondChallenge.token);
    expect(firstSession.token).not.toBe(secondSession.token);
    expect(firstSession.draftKey).toBe(secondSession.draftKey);
    expect(firstSession.draftKey).not.toBe(anotherMember.draftKey);
  });

  it("fails closed when a challenge ciphertext is tampered with", async () => {
    const { challenges, store } = createStore();
    const created = await store.createChallenge({
      guestToken: "res-guest-token",
      deviceId: "res-device-id",
      identity,
    });
    const id = createHash("sha256").update(created.token).digest("hex");
    const document = challenges.values.get(id);
    if (!document) {
      throw new Error("Expected challenge document.");
    }
    document.ciphertext = tamperBase64Url(document.ciphertext);

    await expect(store.beginAttempt(created.token)).resolves.toBeNull();
    await expect(store.beginAttempt(created.token)).resolves.toBeNull();
  });

  it("rejects expired, malformed, and tampered sessions", async () => {
    let currentTime = now;
    const { sessions, store } = createStore(() => currentTime);
    const payload = {
      resToken: "sensitive-res-member-token",
      memberId: "member-123456",
      identity,
    };
    const expired = await store.createSession(payload);
    const tampered = await store.createSession(payload);
    const malformed = await store.createSession(payload);

    const tamperedDocument = sessions.values.get(
      createHash("sha256").update(tampered.token).digest("hex"),
    );
    const malformedDocument = sessions.values.get(
      createHash("sha256").update(malformed.token).digest("hex"),
    );
    if (!tamperedDocument || !malformedDocument) {
      throw new Error("Expected session documents.");
    }
    tamperedDocument.tag = tamperBase64Url(tamperedDocument.tag);
    malformedDocument.expiresAt = "not-a-date";

    await expect(store.getSession(tampered.token)).resolves.toBeNull();
    await expect(store.getSession(malformed.token)).resolves.toBeNull();
    currentTime = expired.expiresAt.getTime();
    await expect(store.getSession(expired.token)).resolves.toBeNull();
  });

  it("refuses an auth secret shorter than 32 bytes", () => {
    expect(
      () =>
        new MongoAuthStore(
          new FakeCollection() as never,
          new FakeCollection() as never,
          "too-short",
        ),
    ).toThrow("HBTI_AUTH_SECRET must contain at least 32 bytes.");
  });
});
