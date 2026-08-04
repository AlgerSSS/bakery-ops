// 真实 RES customerId 是 19 位纯数字；assertKey 按这个形态校验，假数据必须同形。
const memberId = "2083088506766532613";


import { describe, expect, it, vi } from "vitest";

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
  readonly acquiredAnswers: (Readonly<Record<string, string>> | undefined)[] = [];
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
    answers?: Readonly<Record<string, string>>,
  ): Promise<CompletionAcquisition> {
    this.acquiredKeys.push(key);
    // 记下来是为了钉死透传：acquireProcessing 的 answers 是可选形参，
    // complete-hbti.ts 漏传时 tsc 不会响，只有断言会响。
    this.acquiredAnswers.push(answers);
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

  async markUnrewarded(
    key: CompletionStoreKey,
    attemptId: string,
    record: Extract<CompletionRecord, { status: "unrewarded" }>,
  ): Promise<void> {
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
    return `${key.campaignVersion}:${key.memberId}`;
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
  readonly member: ResMember = { id: "2083088506766532613" };
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
  q7: "iced",
  q8: "strong",
  q9: "strong",
  q10: "bitter",
  q11: "bitter",
  q12: "alone",
  q13: "alone",
} as const;

describe("completeHbti", () => {
  it("issues one coupon only after server scoring and an exact before-plus-one readback", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const phone = "+12025550123";

    const result = await completeHbti(
      {
        phone,
        expectedMemberId: "2083088506766532613",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
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
    // 066 起幂等键是 member_id 本身（完成记录已收进 pos_member）。
    // 手机号仍然不得出现在键或返回体里。
    expect(storeKey.memberId).toBe(memberId);

    // 13 题原始作答必须原样透传到 store（→ fact_hbti_response，迁移 300）。
    // acquireProcessing 的第三个形参是可选的，漏传时 tsc 完全不响 ——
    // 这条断言是唯一会响的地方。答案一旦不落库就永久丢失，从结果 code 反推不出来。
    expect(store.acquiredAnswers[0]).toEqual(validAnswers);
    expect(JSON.stringify({ result, storeKey })).not.toContain(phone);
    expect(JSON.stringify({ result, storeKey })).not.toContain("2025550123");
  });

  it("uses atomic acquisition so concurrent completions issue only once", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const input = {
      phone: "+1 202-555-0123",
      expectedMemberId: "2083088506766532613",
      campaignVersion: "2026-08-pistachio-v1",
      answers: validAnswers,
      color: "pistachio",
    };
    const dependencies = {
      store,
      res,
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
    store.records.set(`${campaignVersion}:${memberId}`, {
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
        expectedMemberId: "2083088506766532613",
        campaignVersion,
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
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
    const serializedKey = `${campaignVersion}:${memberId}`;
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
          memberId: "2083088506766532613",
          templateId: "template-1",
          templateName: "Pistachio Green Jewel",
        },
      });
    };

    const result = await completeHbti(
      {
        phone,
        expectedMemberId: "2083088506766532613",
        campaignVersion,
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
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
    store.records.set(`${campaignVersion}:${memberId}`, {
      status: "processing",
      phase: "prepared",
      attemptId: "00000000-0000-4000-8000-000000000002",
      startedAt: "2026-07-30T08:00:00.000Z",
      preparedAt: "2026-07-30T08:00:01.000Z",
      baselineCouponIds: ["coupon-1", "coupon-2"],
      rewardContext: {
        memberId: "2083088506766532613",
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
        expectedMemberId: "2083088506766532613",
        campaignVersion,
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
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
    store.records.set(`${campaignVersion}:${memberId}`, {
      status: "processing",
      phase: "prepared",
      attemptId: "00000000-0000-4000-8000-000000000004",
      startedAt: "2026-07-30T08:00:00.000Z",
      preparedAt: "2026-07-30T08:00:01.000Z",
      baselineCouponIds: ["coupon-1", "coupon-2"],
      rewardContext: {
        memberId: "2083088506766532613",
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
        expectedMemberId: "2083088506766532613",
        campaignVersion,
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
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
      couponTemplateName: "Pistachio Green Jewel",
      now: () => new Date("2026-07-30T08:00:00.000Z"),
    };

    const first = await completeHbti(
      {
        phone: "+1 202-555-0123",
        expectedMemberId: "2083088506766532613",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      dependencies,
    );
    const retry = await completeHbti(
      {
        phone: "001 (202) 555-0123",
        expectedMemberId: "2083088506766532613",
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
        expectedMemberId: "2083088506766532613",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
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
      expectedMemberId: "2083088506766532613",
      campaignVersion: "2026-08-pistachio-v1",
      answers: validAnswers,
      color: "pistachio",
    };
    let currentTime = "2026-07-30T08:00:00.000Z";
    const dependencies = {
      store,
      res,
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
      expectedMemberId: "2083088506766532613",
      campaignVersion: "2026-08-pistachio-v1",
      answers: validAnswers,
      color: "pistachio",
    };
    const dependencies = {
      store,
      res,
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
        expectedMemberId: "2083088506766532613",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
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
      expectedMemberId: "2083088506766532613",
      campaignVersion: "2026-08-pistachio-v1",
      answers: validAnswers,
      color: "pistachio",
    };
    let currentTime = "2026-07-30T08:00:00.000Z";
    const dependencies = {
      store,
      res,
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
        `${key.campaignVersion}:${key.memberId}`,
        concurrentIssued,
      );
    };

    const result = await completeHbti(
      {
        phone: "+12025550123",
        expectedMemberId: "2083088506766532613",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
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

  it("sends the fallback alert when review persistence and reread both fail", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({ couponsAddedOnGive: 2 });
    const originalGet = store.get.bind(store);
    let failReread = false;
    store.beforeMarkReview = () => {
      failReread = true;
      throw new Error("review write failed");
    };
    store.get = async (key) => {
      if (failReread) throw new Error("review reread failed");
      return originalGet(key);
    };
    vi.stubEnv("ALERT_WEBHOOK", "https://alerts.example/hbti");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(
        completeHbti(
          {
            phone: "+12025550123",
            expectedMemberId: memberId,
            campaignVersion: "2026-08-pistachio-v1",
            answers: validAnswers,
            color: "pistachio",
          },
          {
            store,
            res,
            couponTemplateName: "Pistachio Green Jewel",
          },
        ),
      ).rejects.toMatchObject({
        code: "STORE_UNAVAILABLE",
        retryable: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][1]?.body)).toContain(
        "HBTI 发券进入人工复核",
      );
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("never unlocks a non-success give response for a blind retry", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({
      mutateOnGive: false,
      giveResult: { status: "rejected" },
    });
    const input = {
      phone: "+12025550123",
      expectedMemberId: "2083088506766532613",
      campaignVersion: "2026-08-pistachio-v1",
      answers: validAnswers,
      color: "pistachio",
    };
    const dependencies = {
      store,
      res,
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
        expectedMemberId: "2083088506766532613",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
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
          expectedMemberId: "2083088506766532613",
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
      couponTemplateName: "Pistachio Green Jewel",
      now: () => new Date(currentTime),
    };
    const input = {
      phone: "+12025550123",
      expectedMemberId: "2083088506766532613",
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
          expectedMemberId: "2083088506766532613",
          campaignVersion: "2026-08-pistachio-v1",
          answers: validAnswers,
          color: "pistachio",
        },
        {
          store,
          res,
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

  it("scopes idempotency by both campaign version and member id", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const dependencies = {
      store,
      res,
      couponTemplateName: "Pistachio Green Jewel",
    };
    const baseInput = {
      phone: "+12025550123",
      expectedMemberId: "2083088506766532613",
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
    expect(store.acquiredKeys[0].memberId).toBe(
      store.acquiredKeys[1].memberId,
    );
    expect(store.acquiredKeys.map(({ campaignVersion }) => campaignVersion)).toEqual(
      ["campaign-v1", "campaign-v2"],
    );
  });

  it("keeps an already-issued record authoritative and never gives a second coupon", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const campaignVersion = "2026-08-pistachio-v1";
    store.records.set(`${campaignVersion}:${memberId}`, {
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
        expectedMemberId: "2083088506766532613",
        campaignVersion,
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
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

  it("uses the member id as the sole idempotency key, whatever form the phone arrives in", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();

    await completeHbti(
      {
        phone: "+12025550123",
        expectedMemberId: "2083088506766532613",
        campaignVersion: "2026-08-pistachio-v1",
        answers: validAnswers,
        color: "pistachio",
      },
      {
        store,
        res,
        couponTemplateName: "Pistachio Green Jewel",
      },
    );

    expect(store.acquiredKeys).toHaveLength(1);
    expect(store.acquiredKeys[0].memberId).toBe(memberId);
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

  it("reads back an existing issuance without calling RES again", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const campaignVersion = "2026-08-pistachio-v1";
    store.records.set(`${campaignVersion}:${memberId}`, {
      status: "review",
      completion: {
        code: "ISBA",
        visitTime: "night",
        category: "drink",
        color: "pistachio",
      },
      reason: "readback_mismatch",
      markedAt: "2026-07-30T08:00:00.000Z",
      attemptId: "0d9a1c3e-77f5-4a6b-8c21-5e9f0b3d4a72",
      baselineCouponIds: ["coupon-baseline"],
      rewardContext: {
        memberId,
        templateId: "template-1",
        templateName: "HBTI Gift · Rose Fridge Magnet",
      },
      alert: { status: "pending" },
    });

    await expect(
      getHbtiCompletionStatus(
        {
          phone: "+12025550123",
          expectedMemberId: "2083088506766532613",
          campaignVersion,
        },
        {
          store,
          res,
        },
      ),
    ).resolves.toMatchObject({
      status: "review",
      reason: "readback_mismatch",
    });
    expect(res.giveInputs).toHaveLength(0);
  });
});
