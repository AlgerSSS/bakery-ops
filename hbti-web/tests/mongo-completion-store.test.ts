import { MongoServerError } from "mongodb";
import { describe, expect, it } from "vitest";

import { MongoCompletionStore } from "@/lib/store/mongo-completion-store";
import type {
  CompletionRecord,
  CompletionStoreKey,
  ProcessingCompletionRecord,
} from "@/lib/store/completion-store";

type FakeDocument = CompletionRecord & { _id: string; expiresAt: Date };

class FakeCollection {
  readonly values = new Map<string, FakeDocument>();

  async findOne(filter: { _id: string }): Promise<FakeDocument | null> {
    return this.values.get(filter._id) ?? null;
  }

  async insertOne(document: FakeDocument) {
    if (this.values.has(document._id)) {
      const error = new MongoServerError({ message: "duplicate" });
      error.code = 11000;
      throw error;
    }
    this.values.set(document._id, structuredClone(document));
    return { acknowledged: true };
  }

  find(filter: {
    status: string;
    phase: string;
    preparedAt: { $lte: string };
  }) {
    let matches = [...this.values.values()].filter(
      (document) =>
        document.status === "processing" &&
        document.phase === "prepared" &&
        document.preparedAt <= filter.preparedAt.$lte,
    );
    return {
      sort() {
        matches = matches.sort((left, right) => {
          if (
            left.status !== "processing" ||
            left.phase !== "prepared" ||
            right.status !== "processing" ||
            right.phase !== "prepared"
          ) {
            return 0;
          }
          return (
            (left.lastReconciledAt ?? "").localeCompare(
              right.lastReconciledAt ?? "",
            ) || left.preparedAt.localeCompare(right.preparedAt)
          );
        });
        return this;
      },
      limit(limit: number) {
        matches = matches.slice(0, limit);
        return this;
      },
      async toArray() {
        return structuredClone(matches);
      },
    };
  }

  async updateOne(
    filter: {
      _id: string;
      status: string;
      phase: string;
      attemptId: string;
    },
    update: { $set: { lastReconciledAt: string } },
  ) {
    const current = this.values.get(filter._id);
    if (
      filter.status === "processing" &&
      filter.phase === "prepared" &&
      current?.status === "processing" &&
      current.phase === "prepared" &&
      current.attemptId === filter.attemptId
    ) {
      this.values.set(filter._id, {
        ...current,
        lastReconciledAt: update.$set.lastReconciledAt,
      });
      return { matchedCount: 1 };
    }
    return { matchedCount: 0 };
  }

  async replaceOne(
    filter: {
      _id: string;
      status: string;
      phase?: string;
      attemptId?: string;
    },
    replacement: CompletionRecord & { expiresAt: Date },
  ) {
    const current = this.values.get(filter._id);
    if (
      !current ||
      current.status !== filter.status ||
      (filter.phase !== undefined &&
        (current.status !== "processing" ||
          current.phase !== filter.phase)) ||
      (filter.attemptId !== undefined &&
        (current.status !== "processing" ||
          current.attemptId !== filter.attemptId))
    ) {
      return { matchedCount: 0 };
    }
    this.values.set(
      filter._id,
      structuredClone({ _id: filter._id, ...replacement }),
    );
    return { matchedCount: 1 };
  }

  async deleteOne(filter: {
    _id: string;
    status: string;
    phase: string;
    attemptId: string;
  }) {
    const current = this.values.get(filter._id);
    if (
      current?.status === filter.status &&
      current.status === "processing" &&
      current.phase === filter.phase &&
      current.attemptId === filter.attemptId
    ) {
      this.values.delete(filter._id);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }
}

const key: CompletionStoreKey = {
  campaignVersion: "2026-08-pistachio-v1",
  memberHash: "a".repeat(64),
};
const processing: ProcessingCompletionRecord = {
  status: "processing",
  phase: "locked",
  attemptId: "00000000-0000-4000-8000-000000000001",
  startedAt: "2026-07-30T08:00:00.000Z",
  completion: {
    code: "ISBA",
    visitTime: "night",
    category: "drink",
    color: "pistachio",
  },
};

function createStore() {
  const collection = new FakeCollection();
  return {
    collection,
    store: new MongoCompletionStore(collection as never),
  };
}

describe("MongoCompletionStore", () => {
  it("atomically acquires a campaign/member once", async () => {
    const { store } = createStore();

    await expect(store.acquireProcessing(key, processing)).resolves.toEqual({
      acquired: true,
    });
    await expect(store.acquireProcessing(key, processing)).resolves.toEqual({
      acquired: false,
      record: processing,
    });
  });

  it("keeps an issued record durable and refuses to overwrite it", async () => {
    const { store } = createStore();
    await store.acquireProcessing(key, processing);
    const issued = {
      status: "issued",
      completion: processing.completion,
      reward: {
        couponTemplateName: "Pistachio Green Jewel",
        newCouponId: "coupon-2",
        usableCouponCountBefore: 1,
        usableCouponCountAfter: 2,
        confirmedAt: "2026-07-30T08:00:05.000Z",
      },
    } as const;
    await store.markIssued(key, processing.attemptId, issued);

    await store.clearLocked(key, processing.attemptId);

    await expect(store.get(key)).resolves.toEqual(issued);
    await expect(
      store.markIssued(key, processing.attemptId, issued),
    ).rejects.toThrow(
      "Completion was not in the processing state.",
    );
  });

  it("records the pre-give coupon baseline under the same lock owner", async () => {
    const { store } = createStore();
    await store.acquireProcessing(key, processing);
    const prepared = {
      ...processing,
      phase: "prepared",
      preparedAt: "2026-07-30T08:00:01.000Z",
      baselineCouponIds: ["coupon-1"],
      rewardContext: {
        memberId: "member-1",
        templateId: "template-1",
        templateName: "Pistachio Green Jewel",
      },
    } as const;

    await store.markPrepared(key, processing.attemptId, prepared);

    await expect(store.get(key)).resolves.toEqual(prepared);
    await expect(
      store.markPrepared(
        key,
        "00000000-0000-4000-8000-000000000999",
        prepared,
      ),
    ).rejects.toThrow("Completion lock ownership changed.");
  });

  it("clears only a processing record after a safe pre-mutation failure", async () => {
    const { store } = createStore();
    await store.acquireProcessing(key, processing);

    await store.clearLocked(key, processing.attemptId);

    await expect(store.get(key)).resolves.toBeNull();
  });

  it("never clears a lock that concurrently advanced to prepared", async () => {
    const { store } = createStore();
    await store.acquireProcessing(key, processing);
    const prepared = {
      ...processing,
      phase: "prepared",
      preparedAt: "2026-07-30T08:00:01.000Z",
      baselineCouponIds: ["coupon-1"],
      rewardContext: {
        memberId: "member-1",
        templateId: "template-1",
        templateName: "Pistachio Green Jewel",
      },
    } as const;
    await store.markPrepared(key, processing.attemptId, prepared);

    await expect(
      store.clearLocked(key, processing.attemptId),
    ).resolves.toBe(false);
    await expect(store.get(key)).resolves.toEqual(prepared);
  });

  it("lists only prepared records old enough for read-only reconciliation", async () => {
    const { store } = createStore();
    await store.acquireProcessing(key, processing);
    const prepared = {
      ...processing,
      phase: "prepared",
      preparedAt: "2026-07-30T08:00:01.000Z",
      baselineCouponIds: ["coupon-1"],
      rewardContext: {
        memberId: "member-1",
        templateId: "template-1",
        templateName: "Pistachio Green Jewel",
      },
    } as const;
    await store.markPrepared(key, processing.attemptId, prepared);

    await expect(
      store.listPreparedBefore("2026-07-30T08:00:10.000Z", 10),
    ).resolves.toEqual([{ key, record: prepared }]);
    await expect(
      store.listPreparedBefore("2026-07-30T08:00:00.000Z", 10),
    ).resolves.toEqual([]);
  });

  it("moves a reconciled prepared record behind untouched records", async () => {
    const { store } = createStore();
    const secondKey: CompletionStoreKey = {
      ...key,
      memberHash: "b".repeat(64),
    };
    const firstPrepared = {
      ...processing,
      phase: "prepared",
      preparedAt: "2026-07-30T08:00:01.000Z",
      baselineCouponIds: ["coupon-1"],
      rewardContext: {
        memberId: "member-1",
        templateId: "template-1",
        templateName: "Pistachio Green Jewel",
      },
    } as const;
    const secondProcessing = {
      ...processing,
      attemptId: "00000000-0000-4000-8000-000000000002",
    } as const;
    const secondPrepared = {
      ...firstPrepared,
      attemptId: secondProcessing.attemptId,
      rewardContext: {
        ...firstPrepared.rewardContext,
        memberId: "member-2",
      },
    } as const;

    await store.acquireProcessing(key, processing);
    await store.markPrepared(key, processing.attemptId, firstPrepared);
    await store.acquireProcessing(secondKey, secondProcessing);
    await store.markPrepared(
      secondKey,
      secondProcessing.attemptId,
      secondPrepared,
    );
    await store.touchPrepared(
      key,
      processing.attemptId,
      "2026-07-30T08:01:00.000Z",
    );

    await expect(
      store.listPreparedBefore("2026-07-30T08:02:00.000Z", 1),
    ).resolves.toEqual([{ key: secondKey, record: secondPrepared }]);
  });
});
