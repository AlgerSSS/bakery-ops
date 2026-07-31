import { afterEach, describe, expect, it, vi } from "vitest";

import { isAuthorizedCronRequest } from "@/app/api/cron/reconcile/route";
import { reconcilePendingCompletions } from "@/lib/completion/reconcile-pending";
import type {
  CompletionAcquisition,
  CompletionRecord,
  CompletionStore,
  CompletionStoreKey,
  IssuedCompletionRecord,
  PreparedCompletionRecord,
  ReviewCompletionRecord,
} from "@/lib/store/completion-store";

const key: CompletionStoreKey = {
  campaignVersion: "2026-08-pistachio-v1",
  memberId: "2083088506766532613",
};
const prepared: PreparedCompletionRecord = {
  status: "processing",
  phase: "prepared",
  attemptId: "00000000-0000-4000-8000-000000000010",
  startedAt: "2026-07-30T08:00:00.000Z",
  preparedAt: "2026-07-30T08:00:01.000Z",
  completion: {
    code: "ISBA",
    visitTime: "night",
    category: "drink",
    color: "pistachio",
  },
  baselineCouponIds: ["coupon-1"],
  rewardContext: {
    memberId: "member-1",
    templateId: "template-1",
    templateName: "Pistachio Green Jewel",
  },
};

class PendingStore implements CompletionStore {
  record: CompletionRecord = prepared;
  touchCount = 0;
  touchAttempts = 0;

  async listPreparedBefore() {
    return this.record.status === "processing" &&
      this.record.phase === "prepared"
      ? [{ key, record: this.record }]
      : [];
  }

  async get(): Promise<CompletionRecord | null> {
    return this.record;
  }

  async acquireProcessing(): Promise<CompletionAcquisition> {
    return { acquired: false, record: this.record };
  }

  async markPrepared(
    _key: CompletionStoreKey,
    _attemptId: string,
    record: PreparedCompletionRecord,
  ): Promise<void> {
    this.record = record;
  }

  async markIssued(
    _key: CompletionStoreKey,
    attemptId: string,
    record: IssuedCompletionRecord,
  ): Promise<void> {
    if (
      this.record.status !== "processing" ||
      this.record.attemptId !== attemptId
    ) {
      throw new Error("owner changed");
    }
    this.record = record;
  }

  async markReview(
    _key: CompletionStoreKey,
    attemptId: string,
    record: ReviewCompletionRecord,
  ): Promise<void> {
    if (
      this.record.status !== "processing" ||
      this.record.attemptId !== attemptId
    ) {
      throw new Error("owner changed");
    }
    this.record = record;
  }

  async clearLocked(): Promise<boolean> {
    return false;
  }

  async touchPrepared(
    _key: CompletionStoreKey,
    attemptId: string,
    reconciledAt: string,
  ): Promise<void> {
    this.touchAttempts += 1;
    if (
      this.record.status === "processing" &&
      this.record.phase === "prepared" &&
      this.record.attemptId === attemptId
    ) {
      this.record = { ...this.record, lastReconciledAt: reconciledAt };
      this.touchCount += 1;
    }
  }
}

class FailingReviewStore extends PendingStore {
  override async markReview(): Promise<void> {
    throw new Error("simulated review write failure");
  }
}

class RotatingPendingStore implements CompletionStore {
  readonly records = new Map<string, PreparedCompletionRecord>();
  readonly touchedKeys = new Set<string>();

  constructor(count: number) {
    for (let index = 0; index < count; index += 1) {
      const memberId = `90000000000000${String(10000 + index).slice(-5)}`;
      this.records.set(memberId, {
        ...prepared,
        attemptId: `00000000-0000-4000-8000-${index
          .toString()
          .padStart(12, "0")}`,
        rewardContext: {
          ...prepared.rewardContext,
          memberId: `member-${index}`,
        },
      });
    }
  }

  async listPreparedBefore(preparedBefore: string, limit: number) {
    return [...this.records.entries()]
      .filter(([, record]) => record.preparedAt <= preparedBefore)
      .sort(([, left], [, right]) => {
        const leftReconciled = left.lastReconciledAt ?? "";
        const rightReconciled = right.lastReconciledAt ?? "";
        return (
          leftReconciled.localeCompare(rightReconciled) ||
          left.preparedAt.localeCompare(right.preparedAt)
        );
      })
      .slice(0, limit)
      .map(([memberId, record]) => ({
        key: { ...key, memberId },
        record,
      }));
  }

  async get(keyToRead: CompletionStoreKey): Promise<CompletionRecord | null> {
    return this.records.get(keyToRead.memberId) ?? null;
  }

  async acquireProcessing(): Promise<CompletionAcquisition> {
    throw new Error("not used");
  }

  async markPrepared(): Promise<void> {
    throw new Error("not used");
  }

  async markIssued(
    keyToWrite: CompletionStoreKey,
  ): Promise<void> {
    this.records.delete(keyToWrite.memberId);
  }

  async markReview(): Promise<void> {
    throw new Error("read-only reconciliation must not finalize review");
  }

  async clearLocked(): Promise<boolean> {
    return false;
  }

  async touchPrepared(
    keyToTouch: CompletionStoreKey,
    attemptId: string,
    reconciledAt: string,
  ): Promise<void> {
    const current = this.records.get(keyToTouch.memberId);
    if (current?.attemptId === attemptId) {
      this.records.set(keyToTouch.memberId, {
        ...current,
        lastReconciledAt: reconciledAt,
      });
      this.touchedKeys.add(keyToTouch.memberId);
    }
  }
}

describe("pending completion reconciliation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("persists a delayed zero-read as review and never rescans it", async () => {
    const store = new PendingStore();
    const res = {
      listUsableMatchingCoupons: async () => [{ id: "coupon-1" }],
    };
    const now = () => new Date("2026-07-30T08:03:00.000Z");

    await expect(
      reconcilePendingCompletions({ store, res, now }),
    ).resolves.toEqual({
      scanned: 1,
      issued: 0,
      processing: 0,
      review: 1,
      errors: 0,
    });
    expect(store.record).toMatchObject({
      status: "review",
      reason: "stale_reconciliation",
    });
    expect(store.touchCount).toBe(0);
    expect(store.touchAttempts).toBe(0);

    await expect(
      reconcilePendingCompletions({ store, res, now }),
    ).resolves.toEqual({
      scanned: 0,
      issued: 0,
      processing: 0,
      review: 0,
      errors: 0,
    });
    expect(store.touchCount).toBe(0);
    expect(store.touchAttempts).toBe(0);
  });

  it("does not touch a record that reconciles directly to issued", async () => {
    const store = new PendingStore();
    const res = {
      listUsableMatchingCoupons: async () => [
        { id: "coupon-1" },
        { id: "coupon-2" },
      ],
    };

    await expect(
      reconcilePendingCompletions({
        store,
        res,
        now: () => new Date("2026-07-30T08:03:00.000Z"),
      }),
    ).resolves.toEqual({
      scanned: 1,
      issued: 1,
      processing: 0,
      review: 0,
      errors: 0,
    });
    expect(store.record).toMatchObject({
      status: "issued",
      reward: { newCouponId: "coupon-2" },
    });
    expect(store.touchCount).toBe(0);
    expect(store.touchAttempts).toBe(0);
  });

  it("touches only a still-processing record so backlog rotation can advance", async () => {
    const store = new PendingStore();
    const res = {
      listUsableMatchingCoupons: async () => [{ id: "coupon-1" }],
    };

    await expect(
      reconcilePendingCompletions({
        store,
        res,
        now: () => new Date("2026-07-30T08:00:30.000Z"),
      }),
    ).resolves.toEqual({
      scanned: 1,
      issued: 0,
      processing: 1,
      review: 0,
      errors: 0,
    });
    expect(store.record).toMatchObject({
      status: "processing",
      phase: "prepared",
      lastReconciledAt: "2026-07-30T08:00:30.000Z",
    });
    expect(store.touchCount).toBe(1);
    expect(store.touchAttempts).toBe(1);
  });

  it("touches an errored record after a failed durable review write", async () => {
    const store = new FailingReviewStore();
    const res = {
      listUsableMatchingCoupons: async () => [{ id: "coupon-1" }],
    };

    await expect(
      reconcilePendingCompletions({
        store,
        res,
        now: () => new Date("2026-07-30T08:03:00.000Z"),
      }),
    ).resolves.toEqual({
      scanned: 1,
      issued: 0,
      processing: 0,
      review: 0,
      errors: 1,
    });
    expect(store.record).toMatchObject({
      status: "processing",
      phase: "prepared",
      lastReconciledAt: "2026-07-30T08:03:00.000Z",
    });
    expect(store.touchCount).toBe(1);
    expect(store.touchAttempts).toBe(1);
  });

  it("fails the cron route closed unless a long secret matches", () => {
    vi.stubEnv("CRON_SECRET", "c".repeat(48));

    expect(
      isAuthorizedCronRequest(
        new Request("https://hbti-test.hotcrush.net/api/cron/reconcile"),
      ),
    ).toBe(false);
    expect(
      isAuthorizedCronRequest(
        new Request("https://hbti-test.hotcrush.net/api/cron/reconcile", {
          headers: { Authorization: `Bearer ${"c".repeat(48)}` },
        }),
      ),
    ).toBe(true);
  });

  it("rotates a backlog so records beyond one batch are not starved", async () => {
    const store = new RotatingPendingStore(22);
    const res = {
      listUsableMatchingCoupons: async () => [{ id: "coupon-1" }],
    };

    await reconcilePendingCompletions({
      store,
      res,
      now: () => new Date("2026-07-30T08:01:00.000Z"),
    });
    expect(store.touchedKeys.size).toBe(20);

    await reconcilePendingCompletions({
      store,
      res,
      now: () => new Date("2026-07-30T08:01:01.000Z"),
    });
    expect(store.touchedKeys.size).toBe(22);
  });
});
