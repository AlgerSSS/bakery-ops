// 这一层管的是 1,376 件实物周边。测试重点不是「能不能抽中」，而是三件会赔钱或
// 赔口碑的事：重试会不会重抽、中途失败会不会白扣库存、发完了会不会继续发空券。

import { describe, expect, it } from "vitest";

import {
  completeHbti,
  CompleteHbtiError,
  type GiftPoolDependency,
} from "@/lib/completion/complete-hbti";
import { pickWeighted } from "@/lib/store/gift-pool";
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
  ResCouponAdapter,
  ResCouponTemplate,
  ResMember,
  UsableCoupon,
} from "@/lib/res/contracts";

const memberId = "2083088506766532613";

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

const input = {
  phone: "+12025550123",
  expectedMemberId: memberId,
  campaignVersion: "2026-08-pistachio-v1",
  answers: validAnswers,
  color: "pistachio",
} as const;

/** 记录每一次抽取与归还，测试据此断言库存有没有被白扣。 */
class FakeGiftPool implements GiftPoolDependency {
  readonly drawn: string[] = [];
  readonly released: string[] = [];
  drawError?: Error;
  releaseError?: Error;

  constructor(private readonly queue: (string | null)[]) {}

  async draw(): Promise<{ templateName: string } | null> {
    if (this.drawError) {
      throw this.drawError;
    }
    const next = this.queue.shift() ?? null;
    if (next === null) {
      return null;
    }
    this.drawn.push(next);
    return { templateName: next };
  }

  async release(templateName: string): Promise<void> {
    if (this.releaseError) {
      throw this.releaseError;
    }
    this.released.push(templateName);
  }

  /**
   * 抽了但没还的净件数——正常发券后应当是 1，失败回滚后应当是 0。
   *
   * 只看数量是不够的：归还了**另一件**的名字，净数也是 0。所以每个用例都要
   * 另外断言 drawn/released 的具体内容，别只信这个数。
   */
  get netConsumed(): number {
    return this.drawn.length - this.released.length;
  }
}

class FakeCompletionStore implements CompletionStore {
  readonly records = new Map<string, CompletionRecord>();
  failMarkPrepared = false;
  failMarkUnrewarded = false;

  async get(key: CompletionStoreKey): Promise<CompletionRecord | null> {
    return this.records.get(this.serialize(key)) ?? null;
  }

  async acquireProcessing(
    key: CompletionStoreKey,
    record: ProcessingCompletionRecord,
  ): Promise<CompletionAcquisition> {
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
    if (this.failMarkPrepared) {
      throw new Error("store write failed");
    }
    this.assertOwner(key, attemptId);
    this.records.set(this.serialize(key), record);
  }

  async markReview(
    key: CompletionStoreKey,
    attemptId: string,
    record: Extract<CompletionRecord, { status: "review" }>,
  ): Promise<void> {
    this.assertOwner(key, attemptId);
    this.records.set(this.serialize(key), record);
  }

  async markUnrewarded(
    key: CompletionStoreKey,
    attemptId: string,
    record: Extract<CompletionRecord, { status: "unrewarded" }>,
  ): Promise<void> {
    if (this.failMarkUnrewarded) {
      throw new Error("store write failed");
    }
    this.assertOwner(key, attemptId);
    this.records.set(this.serialize(key), record);
  }

  async clearLocked(
    key: CompletionStoreKey,
    attemptId: string,
  ): Promise<boolean> {
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

  /**
   * 模拟 PgCompletionStore.write() 的 CAS 判词 `AND hbti_attempt_id = $attempt`。
   * 少了它，「换了个 attempt 也能覆盖终态」这类改动在测试里察觉不到。
   */
  private assertOwner(key: CompletionStoreKey, attemptId: string): void {
    const current = this.records.get(this.serialize(key));
    if (current?.status !== "processing" || current.attemptId !== attemptId) {
      throw new Error("owner changed");
    }
  }
}

class FakeResCouponAdapter implements ResCouponAdapter {
  readonly member: ResMember = { id: memberId };
  readonly resolvedNames: string[] = [];
  readonly giveInputs: GiveCouponInput[] = [];
  private couponCount = 2;

  constructor(
    private readonly options: {
      memberLookupError?: string;
      throwOnResolveTemplate?: boolean;
    } = {},
  ) {}

  async resolveMemberByPhone(): Promise<ResMember> {
    if (this.options.memberLookupError) {
      throw new Error(this.options.memberLookupError);
    }
    return this.member;
  }

  async resolveEnabledCouponTemplateByName(
    name: string,
  ): Promise<ResCouponTemplate> {
    this.resolvedNames.push(name);
    if (this.options.throwOnResolveTemplate) {
      throw new Error("template lookup failed");
    }
    // 券模板名与抽取结果逐字对应，id 由名字派生便于断言。
    return { id: `template-${name}`, name };
  }

  async listUsableMatchingCoupons(): Promise<readonly UsableCoupon[]> {
    return Array.from({ length: this.couponCount }, (_, index) => ({
      id: `coupon-${index + 1}`,
    }));
  }

  async giveCoupon(input: GiveCouponInput) {
    this.giveInputs.push(input);
    this.couponCount += input.quantity;
    return { status: "accepted" } as const;
  }
}

function dependencies(
  store: CompletionStore,
  res: ResCouponAdapter,
  gifts?: GiftPoolDependency,
) {
  return {
    store,
    res,
    couponTemplateName: "Pistachio Green Jewel",
    ...(gifts ? { gifts } : {}),
    now: () => new Date("2026-08-02T08:00:00.000Z"),
  };
}

describe("pickWeighted", () => {
  const rows = [
    { name: "rare", remaining: 1 },
    { name: "common", remaining: 9 },
  ];

  it("按权重划分 [0,1) 区间：前 10% 落在 rare，其余落在 common", () => {
    expect(pickWeighted(rows, 0).name).toBe("rare");
    expect(pickWeighted(rows, 0.0999).name).toBe("rare");
    expect(pickWeighted(rows, 0.1).name).toBe("common");
    expect(pickWeighted(rows, 0.9999).name).toBe("common");
  });

  it("roll 逼近 1 时仍返回一行，不会因浮点误差漏出 undefined", () => {
    // 1 - Number.EPSILON 是 Math.random() 理论上能取到的最大值。
    expect(pickWeighted(rows, 1 - Number.EPSILON)).toBeDefined();
    expect(pickWeighted(rows, 1)).toBeDefined();
  });

  it("剩余为 0 的品项永远抽不中——已发完的不该再出现在结果里", () => {
    const withSoldOut = [
      { name: "sold-out", remaining: 0 },
      { name: "left", remaining: 5 },
    ];
    for (let i = 0; i < 100; i += 1) {
      expect(pickWeighted(withSoldOut, i / 100).name).toBe("left");
    }
  });

  it("大样本下命中频率贴合库存占比", () => {
    // 用真实库存里最悬殊的一对：蝴蝶纸香卡 427 vs 玫瑰冰箱贴 6。
    const real = [
      { name: "butterfly", remaining: 427 },
      { name: "rose-magnet", remaining: 6 },
    ];
    const trials = 100_000;
    let roseHits = 0;
    for (let i = 0; i < trials; i += 1) {
      if (pickWeighted(real, i / trials).name === "rose-magnet") {
        roseHits += 1;
      }
    }
    const expected = 6 / 433;
    expect(roseHits / trials).toBeCloseTo(expected, 3);
  });
});

describe("completeHbti 接入奖池后", () => {
  it("发的是抽中的周边，不是配置里那张固定券", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const gifts = new FakeGiftPool(["HBTI Gift · Rose Fridge Magnet"]);

    const result = await completeHbti(
      input,
      dependencies(store, res, gifts),
    );

    expect(result).toMatchObject({
      status: "issued",
      reward: { couponTemplateName: "HBTI Gift · Rose Fridge Magnet" },
    });
    // 配置里的 Pistachio Green Jewel 不该被解析，更不该被发出去。
    expect(res.resolvedNames).toEqual(["HBTI Gift · Rose Fridge Magnet"]);
    expect(gifts.netConsumed).toBe(1);
  });

  it("未配置奖池时仍发固定券——旧行为不变", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();

    const result = await completeHbti(input, dependencies(store, res));

    expect(result).toMatchObject({
      status: "issued",
      reward: { couponTemplateName: "Pistachio Green Jewel" },
    });
  });

  it("重复提交拿到同一件周边，不会再抽第二次", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    // 队列里备了第二件；一旦发生重抽，第二次就会拿到 White Pencil。
    const gifts = new FakeGiftPool([
      "HBTI Gift · KL Fridge Magnet",
      "HBTI Gift · White Pencil",
    ]);
    const deps = dependencies(store, res, gifts);

    const first = await completeHbti(input, deps);
    const second = await completeHbti(input, deps);

    expect(first).toMatchObject({
      reward: { couponTemplateName: "HBTI Gift · KL Fridge Magnet" },
    });
    expect(second).toMatchObject({
      reward: { couponTemplateName: "HBTI Gift · KL Fridge Magnet" },
    });
    expect(gifts.drawn).toEqual(["HBTI Gift · KL Fridge Magnet"]);
    expect(gifts.netConsumed).toBe(1);
  });

  it("并发提交只扣一件库存", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const gifts = new FakeGiftPool([
      "HBTI Gift · Black Pencil",
      "HBTI Gift · Red Pencil",
    ]);
    const deps = dependencies(store, res, gifts);

    const results = await Promise.all([
      completeHbti(input, deps),
      completeHbti(input, deps),
    ]);

    // 后到的那个会看到锁记录返回 processing，不该也去抽一件。
    expect(gifts.drawn).toHaveLength(1);
    expect(gifts.netConsumed).toBe(1);
    const issued = results.filter((r) => r.status === "issued");
    expect(issued).toHaveLength(1);
  });

  it("抽中后 RES 查询失败时把库存还回去", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({ throwOnResolveTemplate: true });
    const gifts = new FakeGiftPool(["HBTI Gift · Heart Scent Card"]);

    await expect(
      completeHbti(input, dependencies(store, res, gifts)),
    ).rejects.toMatchObject({ code: "RES_UNAVAILABLE" });

    expect(gifts.drawn).toEqual(["HBTI Gift · Heart Scent Card"]);
    expect(gifts.released).toEqual(["HBTI Gift · Heart Scent Card"]);
    expect(gifts.netConsumed).toBe(0);
  });

  it("抽中后落库失败时把库存还回去", async () => {
    const store = new FakeCompletionStore();
    store.failMarkPrepared = true;
    const res = new FakeResCouponAdapter();
    const gifts = new FakeGiftPool(["HBTI Gift · Rose Scent Card"]);

    await expect(
      completeHbti(input, dependencies(store, res, gifts)),
    ).rejects.toMatchObject({ code: "STORE_UNAVAILABLE" });

    // 归还的必须是**抽中的那一件**。只断言 netConsumed 的话，归还错品项也照样是 0。
    expect(gifts.drawn).toEqual(["HBTI Gift · Rose Scent Card"]);
    expect(gifts.released).toEqual(["HBTI Gift · Rose Scent Card"]);
    expect(gifts.netConsumed).toBe(0);
    // 券还没发出去，绝不能已经调用 giveCoupon。
    expect(res.giveInputs).toEqual([]);
  });

  it("会员校验失败发生在抽奖之前，一件库存都不动", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const gifts = new FakeGiftPool(["HBTI Gift · Butterfly Scent Card"]);

    await expect(
      completeHbti(
        { ...input, expectedMemberId: "2083088506766532614" },
        dependencies(store, res, gifts),
      ),
    ).rejects.toMatchObject({ code: "MEMBER_IDENTITY_MISMATCH" });

    expect(gifts.drawn).toEqual([]);
  });

  it("归还本身失败时不掩盖原始错误", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter({ throwOnResolveTemplate: true });
    const gifts = new FakeGiftPool(["HBTI Gift · White Pencil"]);
    gifts.releaseError = new Error("stock update failed");

    // 顾客看到的仍应是 RES_UNAVAILABLE，而不是 stock update failed。
    await expect(
      completeHbti(input, dependencies(store, res, gifts)),
    ).rejects.toMatchObject({ code: "RES_UNAVAILABLE" });
  });

  it("周边发完时照常出结果，只是不发券", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const gifts = new FakeGiftPool([]);

    const result = await completeHbti(
      input,
      dependencies(store, res, gifts),
    );

    // 最要紧的一条：顾客答完 13 题，人格结果必须还在。
    expect(result).toMatchObject({
      status: "unrewarded",
      code: "ISBA",
      visitTime: "night",
      category: "drink",
      color: "pistachio",
    });
    expect(result).not.toHaveProperty("reward");
    // 发完了就不该再去 RES 发券。
    expect(res.giveInputs).toEqual([]);
    expect(res.resolvedNames).toEqual([]);
  });

  it("周边发完后重复提交仍返回同一个终态，不会再抽也不会补发", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    // 第一次池子是空的；之后就算补了货，这个会员也不该再拿到券。
    const gifts = new FakeGiftPool([null, "HBTI Gift · White Pencil"]);
    const deps = dependencies(store, res, gifts);

    const first = await completeHbti(input, deps);
    const second = await completeHbti(input, deps);

    expect(first).toMatchObject({ status: "unrewarded" });
    expect(second).toMatchObject({ status: "unrewarded" });
    expect(gifts.drawn).toEqual([]);
    expect(res.giveInputs).toEqual([]);
  });

  it("落库失败时不谎报「已发完」，按可重试上报", async () => {
    const store = new FakeCompletionStore();
    store.failMarkUnrewarded = true;
    const res = new FakeResCouponAdapter();
    const gifts = new FakeGiftPool([]);

    const error = await completeHbti(
      input,
      dependencies(store, res, gifts),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CompleteHbtiError);
    expect(error).toMatchObject({
      code: "STORE_UNAVAILABLE",
      retryable: true,
    });
  });

  it("库存表本身查不动时按可重试上报，不误判成已发完", async () => {
    const store = new FakeCompletionStore();
    const res = new FakeResCouponAdapter();
    const gifts = new FakeGiftPool(["HBTI Gift · Black Pencil"]);
    gifts.drawError = new Error("connection terminated");

    await expect(
      completeHbti(input, dependencies(store, res, gifts)),
    ).rejects.toMatchObject({
      code: "STORE_UNAVAILABLE",
      retryable: true,
    });
  });
});
