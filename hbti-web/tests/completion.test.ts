import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  completeHbti,
  getHbtiCompletionStatus,
} from "@/lib/completion/complete-hbti";
import type {
  CompletionAcquisition,
  CompletionRecord,
  CompletionStore,
  CompletionStoreKey,
  PreparedCompletionRecord,
  ProcessingCompletionRecord,
} from "@/lib/store/completion-store";
import type {
  GiveCouponInput,
  GiveCouponResult,
  ResCouponAdapter,
  ResCouponTemplate,
  ResMember,
  UsableCoupon,
} from "@/lib/res/contracts";

class FakeCompletionStore implements CompletionStore {
  readonly records = new Map<string, CompletionRecord>();
  readonly acquiredKeys: CompletionStoreKey[] = [];
  beforeClearLocked?: (
    key: CompletionStoreKey,
    attemptId: string,
  ) => void;
  beforeMarkReview?: (
    key: CompletionStoreKey,
    attemptId: string,
    record: Extract<CompletionRecord, { status: "review" }>,
  ) => void;

  async get(key: CompletionStoreKey): Promise<CompletionRecord | null> {
    return this.records.get(this.serialize(key)) ?? null;
  }

  async acquireProcessing(
    key: CompletionStoreKey,
    record: ProcessingCompletionRecord,
  ): Promise<CompletionAcquisition> {
    this.acquiredKeys.push(key);
    const serialized = this.serialize(key);
    const existing = this.records.get(serialized);

    if (existing) {
      return { acquired: false, record: existing };
    }

    this.records.set(serialized, record);
    return { acquired: true };
  }

  async markIssued(
    key: CompletionStoreKey,
    attemptId: string,
    record: Extract<CompletionRecord, { status: "issued" }>,
  ): Promise<void> {
    this.assertOwner(key, attemptId);
    this.records.set(this.serialize(key), record);
  }

  async markPrepared(
    key: CompletionStoreKey,
    attemptId: string,
    record: PreparedCompletionRecord,
  ): Promise<void> {
    this.assertOwner(key, attemptId);
    this.records.set(this.serialize(key), record);
  }

  async markReview(
    key: CompletionStoreKey,
    attemptId: string,
    record: Extract<CompletionRecord, { status: "review" }>,
  ): Promise<void> {
    this.beforeMarkReview?.(key, attemptId, record);
    this.assertOwner(key, attemptId);
    this.records.set(this.serialize(key), record);
  }

  async clearLocked(
    key: CompletionStoreKey,
    attemptId: string,
  ): Promise<boolean> {
    this.beforeClearLocked?.(key, attemptId);
    const serialized = this.serialize(key);
    const current = this.records.get(serialized);
    if (
      current?.status === "processing" &&
      current.phase === "locked" &&
      current.attemptId === attemptId
    ) {
      this.records.delete(serialized);
      return true;
    }
    return false;
  }

  private serialize(key: CompletionStoreKey): string {
    return `${key.campaignVersion}:${key.memberHash}`;
  }

  private assertOwner(key: CompletionStoreKey, attemptId: string): void {
    const current = this.records.get(this.serialize(key));
    if (
      current?.status !== "processing" ||
      current.attemptId !== attemptId
    ) {
      throw new Error("owner changed");
    }
  }
}

class FakeResCouponAdapter implements ResCouponAdapter {
  readonly member: ResMember = { id: "member-1" };
  readonly template: ResCouponTemplate = {
    id: "template-1",
    name: "Pistachio Green Jewel",
  };
  readonly giveInputs: GiveCouponInput[] = [];
  listCalls = 0;
  private couponCount: number;

  constructor(
    private readonly options: {
      initialCouponCount?: number;
      mutateOnGive?: boolean;
      giveResult?: GiveCouponResult;
      throwAfterGive?: boolean;
      throwOnListCall?: number;
      throwOnListCalls?: readonly number[];
      memberLookupError?: string;
      couponsAddedOnGive?: number;
      couponIdsByListCall?: readonly (readonly string[])[];
    } = {},
  ) {
    this.couponCount = options.initialCouponCount ?? 2;
  }

  async resolveMemberByPhone(): Promise<ResMember> {
    if (this.options.memberLookupError) {
      throw new Error(this.options.memberLookupError);
    }
    return this.member;
  }

  async resolveEnabledCouponTemplateByName(): Promise<ResCouponTemplate> {
    return this.template;
  }

  async listUsableMatchingCoupons(): Promise<readonly UsableCoupon[]> {
    this.listCalls += 1;
    if (
      this.listCalls === this.options.throwOnListCall ||
      this.options.throwOnListCalls?.includes(this.listCalls)
    ) {
      throw new Error("wallet readback failed with RES_VULCAN_TOKEN=secret");
    }
    const couponIds =
      this.options.couponIdsByListCall?.[this.listCalls - 1];
    if (couponIds) {
      return couponIds.map((id) => ({ id }));
    }
    return Array.from({ length: this.couponCount }, (_, index) => ({
      id: `coupon-${index + 1}`,
    }));
  }

  async giveCoupon(input: GiveCouponInput) {
    this.giveInputs.push(input);
    if (this.options.mutateOnGive !== false) {
      this.couponCount +=
        this.options.couponsAddedOnGive ?? input.quantity;
    }
    if (this.options.throwAfterGive) {
      throw new Error(`ambiguous response for ${input.phoneE164}`);
    }
    return this.options.giveResult ?? ({ status: "accepted" } as const);
  }
}

const validAnswers = {
  q1: "iced",
  q2: "strong",
  q3: "bitter",
  q4: "alone",
  q5: "night",
  q6: "drink",
} as const;

describe("completeHbti", () => {
  it("issues one coupon only after server scoring and an exact before-plus-one readback", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const phone = "+12025550123";

    const result = await completeHbti(
      {
        phone,
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        memberHashSecret: "completion-test-secret",
        couponTemplateName: "Pistachio Green Jewel",
        now: () => new Date("2026-07-30T08:00:00.000Z"),
      },
    );

    expect(result).toMatchObject({
      status: "issued",
      code: "ISBA",
      reward: {
        couponTemplateName: "Pistachio Green Jewel",
        newCouponId: "coupon-3",
        usableCouponCountBefore: 2,
        usableCouponCountAfter: 3,
      },
    });
    expect(res.listCalls).toBe(2);
    expect(res.giveInputs).toEqual([
      {
        phoneE164: phone,
        member: res.member,
        template: res.template,
        quantity: 1,
      },
    ]);

    const storeKey = store.acquiredKeys[0];
    expect(storeKey.memberHash).toBe(
      createHmac("sha256", "completion-test-secret")
        .update(phone)
        .digest("hex"),
    );
    expect(JSON.stringify({ result, storeKey })).not.toContain(phone);
  });

  it("uses atomic acquisition so concurrent completions issue only once", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const input = {
      phone: "+1 202-555-0123",
      campaignVersion: "2026-08-pistachio-v1",
      answers: validAnswers,
      color: "pistachio",
    };
    const dependencies = {
      store,
      res,
      memberHashSecret: "completion-test-secret",
      couponTemplateName: "Pistachio Green Jewel",
      now: () => new Date("2026-07-30T08:00:00.000Z"),
    };

    const results = await Promise.all([
      completeHbti(input, dependencies),
      completeHbti(input, dependencies),
    ]);

    expect(res.giveInputs).toHaveLength(1);
    expect(results.map(({ status }) => status).sort()).toEqual([
      "issued",
      "processing",
    ]);
  });

  it("safely retries a stale pre-mutation lock", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const phone = "+12025550123";
    const campaignVersion = "2026-08-pistachio-v1";
    const memberHash = createHmac("sha256", "completion-test-secret")
      .update(phone)
      .digest("hex");
    store.records.set(`${campaignVersion}:${memberHash}`, {
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
    });

    const result = await completeHbti(
      {
        phone,
        campaignVersion,
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        memberHashSecret: "completion-test-secret",
        couponTemplateName: "Pistachio Green Jewel",
        now: () => new Date("2026-07-30T08:02:00.000Z"),
      },
    );

    expect(result.status).toBe("issued");
    expect(res.giveInputs).toHaveLength(1);
  });

  it("does not clear or re-give when a stale lock concurrently becomes prepared", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const phone = "+12025550123";
    const campaignVersion = "2026-08-pistachio-v1";
    const memberHash = createHmac("sha256", "completion-test-secret")
      .update(phone)
      .digest("hex");
    const serializedKey = `${campaignVersion}:${memberHash}`;
    const attemptId = "00000000-0000-4000-8000-000000000003";
    const completion = {
      code: "ISBA",
      visitTime: "night",
      category: "drink",
      color: "pistachio",
    } as const;
    store.records.set(serializedKey, {
      status: "processing",
      phase: "locked",
      attemptId,
      startedAt: "2026-07-30T08:00:00.000Z",
      completion,
    });
    store.beforeClearLocked = () => {
      store.records.set(serializedKey, {
        status: "processing",
        phase: "prepared",
        attemptId,
        startedAt: "2026-07-30T08:00:00.000Z",
        preparedAt: "2026-07-30T08:01:59.000Z",
        completion,
        baselineCouponIds: ["coupon-1", "coupon-2"],
        rewardContext: {
          memberId: "member-1",
          templateId: "template-1",
          templateName: "Pistachio Green Jewel",
        },
      });
    };

    const result = await completeHbti(
      {
        phone,
        campaignVersion,
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        memberHashSecret: "completion-test-secret",
        couponTemplateName: "Pistachio Green Jewel",
        now: () => new Date("2026-07-30T08:02:00.000Z"),
      },
    );

    expect(result.status).toBe("processing");
    expect(store.records.get(serializedKey)).toMatchObject({
      phase: "prepared",
    });
    expect(res.giveInputs).toHaveLength(0);
  });

  it("reconciles a stale prepared write by readback without giving again", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({ initialCouponCount: 3 });
    const phone = "+12025550123";
    const campaignVersion = "2026-08-pistachio-v1";
    const memberHash = createHmac("sha256", "completion-test-secret")
      .update(phone)
      .digest("hex");
    store.records.set(`${campaignVersion}:${memberHash}`, {
      status: "processing",
      phase: "prepared",
      attemptId: "00000000-0000-4000-8000-000000000002",
      startedAt: "2026-07-30T08:00:00.000Z",
      preparedAt: "2026-07-30T08:00:01.000Z",
      baselineCouponIds: ["coupon-1", "coupon-2"],
      rewardContext: {
        memberId: "member-1",
        templateId: "template-1",
        templateName: "Pistachio Green Jewel",
      },
      completion: {
        code: "ISBA",
        visitTime: "night",
        category: "drink",
        color: "pistachio",
      },
    });

    const result = await completeHbti(
      {
        phone,
        campaignVersion,
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        memberHashSecret: "completion-test-secret",
        couponTemplateName: "Pistachio Green Jewel",
        now: () => new Date("2026-07-30T08:02:00.000Z"),
      },
    );

    expect(result).toMatchObject({
      status: "issued",
      reward: { newCouponId: "coupon-3" },
    });
    expect(res.giveInputs).toHaveLength(0);
    expect(res.listCalls).toBe(1);
  });

  it("reviews a prepared ID replacement when the wallet count did not increase", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({
      couponIdsByListCall: [["coupon-2", "coupon-3"]],
    });
    const phone = "+12025550123";
    const campaignVersion = "2026-08-pistachio-v1";
    const memberHash = createHmac("sha256", "completion-test-secret")
      .update(phone)
      .digest("hex");
    store.records.set(`${campaignVersion}:${memberHash}`, {
      status: "processing",
      phase: "prepared",
      attemptId: "00000000-0000-4000-8000-000000000004",
      startedAt: "2026-07-30T08:00:00.000Z",
      preparedAt: "2026-07-30T08:00:01.000Z",
      baselineCouponIds: ["coupon-1", "coupon-2"],
      rewardContext: {
        memberId: "member-1",
        templateId: "template-1",
        templateName: "Pistachio Green Jewel",
      },
      completion: {
        code: "ISBA",
        visitTime: "night",
        category: "drink",
        color: "pistachio",
      },
    });

    const result = await completeHbti(
      {
        phone,
        expectedMemberId: "member-1",
        campaignVersion,
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        memberHashSecret: "completion-test-secret",
        couponTemplateName: "Pistachio Green Jewel",
        now: () => new Date("2026-07-30T08:00:07.000Z"),
      },
    );

    expect(result).toMatchObject({
      status: "review",
      reason: "readback_mismatch",
    });
    expect(res.giveInputs).toHaveLength(0);
  });

  it("returns a stored receipt on a normalized-phone retry without calling RES again", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const dependencies = {
      store,
      res,
      memberHashSecret: "completion-test-secret",
      couponTemplateName: "Pistachio Green Jewel",
      now: () => new Date("2026-07-30T08:00:00.000Z"),
    };

    const first = await completeHbti(
      {
        phone: "+1 202-555-0123",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      dependencies,
    );
    const retry = await completeHbti(
      {
        phone: "001 (202) 555-0123",
        campaignVersion: "2026-08-pistachio-v1",
        answers: {
          ...validAnswers,
          q1: "hot",
        },
        color: "flesh-pink",
      },
      dependencies,
    );

    expect(retry).toEqual(first);
    expect(res.giveInputs).toHaveLength(1);
    expect(res.giveInputs[0].phoneE164).toBe("+12025550123");
    expect(res.listCalls).toBe(2);
  });

  it("recovers an ambiguous give error when readback proves exactly one coupon was added", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({ throwAfterGive: true });
    const phone = "+12025550123";

    const result = await completeHbti(
      {
        phone,
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        memberHashSecret: "completion-test-secret",
        couponTemplateName: "Pistachio Green Jewel",
      },
    );

    expect(result.status).toBe("issued");
    expect(res.giveInputs).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(phone);
  });

  it("persists an unproven ambiguous give as review after the reconciliation timeout", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({
      mutateOnGive: false,
      giveResult: { status: "ambiguous" },
    });
    const input = {
      phone: "+12025550123",
      campaignVersion: "2026-08-pistachio-v1",
      answers: validAnswers,
      color: "pistachio",
    };
    let currentTime = "2026-07-30T08:00:00.000Z";
    const dependencies = {
      store,
      res,
      memberHashSecret: "completion-test-secret",
      couponTemplateName: "Pistachio Green Jewel",
      now: () => new Date(currentTime),
    };

    const first = await completeHbti(input, dependencies);
    currentTime = "2026-07-30T08:00:06.000Z";
    const retry = await completeHbti(input, dependencies);
    currentTime = "2026-07-30T08:02:01.000Z";
    const escalated = await completeHbti(input, dependencies);

    expect(first).toMatchObject({
      status: "processing",
      code: "ISBA",
    });
    expect(retry).toEqual(first);
    expect(escalated).toMatchObject({
      status: "review",
      reason: "stale_reconciliation",
    });
    expect([...store.records.values()]).toEqual([
      expect.objectContaining({
        status: "review",
        reason: "stale_reconciliation",
        markedAt: "2026-07-30T08:02:01.000Z",
      }),
    ]);
    const listCallsAtReview = res.listCalls;
    await expect(completeHbti(input, dependencies)).resolves.toEqual(
      escalated,
    );
    expect(res.listCalls).toBe(listCallsAtReview);
    expect(res.giveInputs).toHaveLength(1);
  });

  it("persists a multiple-coupon readback mismatch and never calls RES on retry", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({ couponsAddedOnGive: 2 });
    const input = {
      phone: "+12025550123",
      campaignVersion: "2026-08-pistachio-v1",
      answers: validAnswers,
      color: "pistachio",
    };
    const dependencies = {
      store,
      res,
      memberHashSecret: "completion-test-secret",
      couponTemplateName: "Pistachio Green Jewel",
      now: () => new Date("2026-07-30T08:00:00.000Z"),
    };

    const first = await completeHbti(input, dependencies);
    const listCallsAtReview = res.listCalls;
    const retry = await completeHbti(input, dependencies);

    expect(first).toMatchObject({
      status: "review",
      reason: "readback_mismatch",
    });
    expect([...store.records.values()]).toEqual([
      expect.objectContaining({
        status: "review",
        reason: "readback_mismatch",
      }),
    ]);
    expect(retry).toEqual(first);
    expect(res.giveInputs).toHaveLength(1);
    expect(res.listCalls).toBe(listCallsAtReview);
  });

  it("reviews an ID replacement when the usable wallet count does not increase", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({
      couponIdsByListCall: [
        ["coupon-1", "coupon-2"],
        ["coupon-2", "coupon-3"],
      ],
    });

    const result = await completeHbti(
      {
        phone: "+12025550123",
        expectedMemberId: "member-1",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        memberHashSecret: "completion-test-secret",
        couponTemplateName: "Pistachio Green Jewel",
      },
    );

    expect(result).toMatchObject({
      status: "review",
      reason: "readback_mismatch",
    });
    expect(res.giveInputs).toHaveLength(1);
  });

  it("persists review when stale reconciliation cannot read the wallet", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({
      throwAfterGive: true,
      throwOnListCalls: [2, 3],
    });
    const input = {
      phone: "+12025550123",
      campaignVersion: "2026-08-pistachio-v1",
      answers: validAnswers,
      color: "pistachio",
    };
    let currentTime = "2026-07-30T08:00:00.000Z";
    const dependencies = {
      store,
      res,
      memberHashSecret: "completion-test-secret",
      couponTemplateName: "Pistachio Green Jewel",
      now: () => new Date(currentTime),
    };

    await expect(completeHbti(input, dependencies)).resolves.toMatchObject({
      status: "processing",
    });
    currentTime = "2026-07-30T08:02:01.000Z";
    const escalated = await completeHbti(input, dependencies);
    const listCallsAtReview = res.listCalls;

    expect(escalated).toMatchObject({
      status: "review",
      reason: "readback_unavailable",
    });
    expect([...store.records.values()]).toEqual([
      expect.objectContaining({
        status: "review",
        reason: "readback_unavailable",
      }),
    ]);
    await expect(completeHbti(input, dependencies)).resolves.toEqual(
      escalated,
    );
    expect(res.listCalls).toBe(listCallsAtReview);
    expect(res.giveInputs).toHaveLength(1);
  });

  it("returns a concurrently persisted issued receipt instead of overwriting it with review", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({ couponsAddedOnGive: 2 });
    const concurrentIssued = {
      status: "issued",
      completion: {
        code: "ISBA",
        visitTime: "night",
        category: "drink",
        color: "pistachio",
      },
      reward: {
        couponTemplateName: "Pistachio Green Jewel",
        newCouponId: "coupon-from-concurrent-readback",
        usableCouponCountBefore: 2,
        usableCouponCountAfter: 3,
        confirmedAt: "2026-07-30T08:00:01.000Z",
      },
    } as const;
    store.beforeMarkReview = (key) => {
      store.records.set(
        `${key.campaignVersion}:${key.memberHash}`,
        concurrentIssued,
      );
    };

    const result = await completeHbti(
      {
        phone: "+12025550123",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        memberHashSecret: "completion-test-secret",
        couponTemplateName: "Pistachio Green Jewel",
      },
    );

    expect(result).toMatchObject({
      status: "issued",
      reward: { newCouponId: "coupon-from-concurrent-readback" },
    });
    expect([...store.records.values()]).toEqual([concurrentIssued]);
    expect(res.giveInputs).toHaveLength(1);
  });

  it("never unlocks a non-success give response for a blind retry", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({
      mutateOnGive: false,
      giveResult: { status: "rejected" },
    });
    const input = {
      phone: "+12025550123",
      campaignVersion: "2026-08-pistachio-v1",
      answers: validAnswers,
      color: "pistachio",
    };
    const dependencies = {
      store,
      res,
      memberHashSecret: "completion-test-secret",
      couponTemplateName: "Pistachio Green Jewel",
    };

    const first = await completeHbti(input, dependencies);
    const retry = await completeHbti(input, dependencies);

    expect(first).toMatchObject({
      status: "review",
      reason: "give_rejected",
    });
    expect(retry).toEqual(first);
    expect(res.giveInputs).toHaveLength(1);
  });

  it("does not report success while an accepted give lacks the exact ID increase", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({ mutateOnGive: false });

    const result = await completeHbti(
      {
        phone: "+12025550123",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        memberHashSecret: "completion-test-secret",
        couponTemplateName: "Pistachio Green Jewel",
      },
    );

    expect(result).toMatchObject({
      status: "processing",
    });
    expect(res.giveInputs).toHaveLength(1);
  });

  it("rejects invalid answer payloads before acquiring a lock or calling RES", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();

    await expect(
      completeHbti(
        {
          phone: "+12025550123",
          campaignVersion: "2026-08-pistachio-v1",
          answers: {
            ...validAnswers,
            q1: "room-temperature",
          } as never,
          color: "pistachio",
        },
        {
          store,
          res,
          memberHashSecret: "completion-test-secret",
          couponTemplateName: "Pistachio Green Jewel",
        },
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Invalid completion request.",
      retryable: false,
    });
    expect(store.acquiredKeys).toHaveLength(0);
    expect(res.giveInputs).toHaveLength(0);
    expect(res.listCalls).toBe(0);
  });

  it("recovers a transient post-give readback failure without giving again", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({
      throwAfterGive: true,
      throwOnListCall: 2,
    });
    let currentTime = "2026-07-30T08:00:00.000Z";
    const dependencies = {
      store,
      res,
      memberHashSecret: "completion-test-secret",
      couponTemplateName: "Pistachio Green Jewel",
      now: () => new Date(currentTime),
    };
    const input = {
      phone: "+12025550123",
      campaignVersion: "2026-08-pistachio-v1",
      answers: validAnswers,
      color: "pistachio",
    };

    const first = await completeHbti(input, dependencies);
    currentTime = "2026-07-30T08:00:06.000Z";
    const recovered = await completeHbti(input, dependencies);

    expect(first).toMatchObject({
      status: "processing",
    });
    expect(recovered).toMatchObject({
      status: "issued",
      reward: { newCouponId: "coupon-3" },
    });
    expect(res.giveInputs).toHaveLength(1);
  });

  it("redacts dependency errors and clears the pre-mutation processing record", async () => {
    const store = new FakeCompletionStore();
    const phone = "+12025550123";
    const res = new FakeResCouponAdapter({
      memberLookupError: `lookup failed for ${phone}; token=RES-secret`,
    });

    let thrown: unknown;
    try {
      await completeHbti(
        {
          phone,
          campaignVersion: "2026-08-pistachio-v1",
          answers: validAnswers,
          color: "pistachio",
        },
        {
          store,
          res,
          memberHashSecret: "completion-test-secret",
          couponTemplateName: "Pistachio Green Jewel",
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "RES_UNAVAILABLE",
      message: "Reward service is temporarily unavailable.",
    });
    expect(String(thrown)).not.toContain(phone);
    expect(String(thrown)).not.toContain("RES-secret");
    expect(JSON.stringify(thrown)).not.toContain(phone);
    expect(JSON.stringify(thrown)).not.toContain("RES-secret");
    expect(store.records.size).toBe(0);
    expect(res.giveInputs).toHaveLength(0);
  });

  it("scopes idempotency by both campaign version and member HMAC", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const dependencies = {
      store,
      res,
      memberHashSecret: "completion-test-secret",
      couponTemplateName: "Pistachio Green Jewel",
    };
    const baseInput = {
      phone: "+12025550123",
      answers: validAnswers,
      color: "pistachio",
    };

    await completeHbti(
      { ...baseInput, campaignVersion: "campaign-v1" },
      dependencies,
    );
    await completeHbti(
      { ...baseInput, campaignVersion: "campaign-v2" },
      dependencies,
    );

    expect(res.giveInputs).toHaveLength(2);
    expect(store.acquiredKeys).toHaveLength(2);
    expect(store.acquiredKeys[0].memberHash).toBe(
      store.acquiredKeys[1].memberHash,
    );
    expect(store.acquiredKeys.map(({ campaignVersion }) => campaignVersion)).toEqual(
      ["campaign-v1", "campaign-v2"],
    );
  });

  it("keeps a legacy phone-key issuance authoritative after member-login migration", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const campaignVersion = "2026-08-pistachio-v1";
    const legacyHash = createHmac(
      "sha256",
      "completion-test-secret",
    )
      .update("+12025550123")
      .digest("hex");
    store.records.set(`${campaignVersion}:${legacyHash}`, {
      status: "issued",
      completion: {
        code: "ISBA",
        visitTime: "night",
        category: "drink",
        color: "pistachio",
      },
      reward: {
        couponTemplateName: "Pistachio Green Jewel",
        newCouponId: "legacy-coupon",
        usableCouponCountBefore: 1,
        usableCouponCountAfter: 2,
        confirmedAt: "2026-07-30T08:00:00.000Z",
      },
    });

    const result = await completeHbti(
      {
        phone: "+12025550123",
        expectedMemberId: "member-1",
        campaignVersion,
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        memberHashSecret: "completion-test-secret",
        couponTemplateName: "Pistachio Green Jewel",
      },
    );

    expect(result).toMatchObject({
      status: "issued",
      reward: { newCouponId: "legacy-coupon" },
    });
    expect(store.acquiredKeys).toHaveLength(0);
    expect(res.giveInputs).toHaveLength(0);
  });

  it("keeps the normalized phone HMAC as the sole idempotency key after member login", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();

    await completeHbti(
      {
        phone: "+12025550123",
        expectedMemberId: "member-1",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        memberHashSecret: "completion-test-secret",
        couponTemplateName: "Pistachio Green Jewel",
      },
    );

    expect(store.acquiredKeys).toHaveLength(1);
    expect(store.acquiredKeys[0].memberHash).toBe(
      createHmac("sha256", "completion-test-secret")
        .update("+12025550123")
        .digest("hex"),
    );
  });

  it("refuses a phone lookup that disagrees with the authenticated member", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();

    await expect(
      completeHbti(
        {
          phone: "+12025550123",
          expectedMemberId: "another-member",
          campaignVersion: "2026-08-pistachio-v1",
          answers: validAnswers,
          color: "pistachio",
        },
        {
          store,
          res,
          memberHashSecret: "completion-test-secret",
          couponTemplateName: "Pistachio Green Jewel",
        },
      ),
    ).rejects.toMatchObject({
      code: "MEMBER_IDENTITY_MISMATCH",
      retryable: false,
    });
    expect(store.records.size).toBe(0);
    expect(res.giveInputs).toHaveLength(0);
  });

  it("reads the same legacy-first status without issuing another coupon", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const campaignVersion = "2026-08-pistachio-v1";
    const legacyHash = createHmac(
      "sha256",
      "completion-test-secret",
    )
      .update("+12025550123")
      .digest("hex");
    store.records.set(`${campaignVersion}:${legacyHash}`, {
      status: "review",
      completion: {
        code: "ISBA",
        visitTime: "night",
        category: "drink",
        color: "pistachio",
      },
      reason: "readback_mismatch",
      markedAt: "2026-07-30T08:00:00.000Z",
    });

    await expect(
      getHbtiCompletionStatus(
        {
          phone: "+12025550123",
          expectedMemberId: "member-1",
          campaignVersion,
        },
        {
          store,
          res,
          memberHashSecret: "completion-test-secret",
        },
      ),
    ).resolves.toMatchObject({
      status: "review",
      reason: "readback_mismatch",
    });
    expect(res.giveInputs).toHaveLength(0);
  });
});
