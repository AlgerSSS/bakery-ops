// completionRecordSchema 是完成记录出库时**唯一**的校验，而 get() 把 parse 的结果
// 直接当作 CompletionRecord 返回。这意味着：给 TS 联合加一个新状态、却忘了给 zod 加分支，
// 编译完全通过、全套测试全绿，只有线上会炸——而且因为保留期是 548 天、记录又是终态，
// 那个会员会永久 503，再也看不到自己的面包人格。
//
// 这个文件就是为了让那种疏漏在本地就响。键类型写成 Record<CompletionRecord["status"], …>：
// 加了新状态却不在这里给样本，tsc 先不过；给了样本却没加 zod 分支，往返就失败。

import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { CompletionRecord } from "@/lib/store/completion-store";
import { completionRecordSchema } from "@/lib/store/pg-completion-store";

const snapshot = {
  code: "ILBA",
  visitTime: "morning",
  category: "drink",
  color: "pistachio",
} as const;

const samples: Record<CompletionRecord["status"], CompletionRecord[]> = {
  processing: [
    {
      status: "processing",
      phase: "locked",
      attemptId: randomUUID(),
      startedAt: "2026-08-02T00:00:00.000Z",
      completion: snapshot,
    },
    {
      status: "processing",
      phase: "prepared",
      attemptId: randomUUID(),
      startedAt: "2026-08-02T00:00:00.000Z",
      preparedAt: "2026-08-02T00:00:01.000Z",
      completion: { ...snapshot, gender: "woman", age: "25-34" },
      baselineCouponIds: ["coupon-1"],
      rewardContext: {
        memberId: "2083088506766532613",
        templateId: "2083837321220014083",
        templateName: "HBTI Gift · Rose Fridge Magnet",
      },
    },
  ],
  issued: [
    {
      status: "issued",
      completion: snapshot,
      reward: {
        couponTemplateName: "HBTI Gift · Rose Fridge Magnet",
        newCouponId: "coupon-2",
        usableCouponCountBefore: 1,
        usableCouponCountAfter: 2,
        confirmedAt: "2026-08-02T00:00:02.000Z",
      },
    },
  ],
  review: [
    {
      status: "review",
      completion: snapshot,
      reason: "give_rejected",
      markedAt: "2026-08-02T00:00:02.000Z",
      attemptId: "6f1f6f6a-5b7e-4d2a-9a3f-2f4c8d1e7b90",
      baselineCouponIds: ["coupon-1"],
      rewardContext: {
        memberId: "member-1",
        templateId: "template-1",
        templateName: "HBTI Gift · Rose Fridge Magnet",
      },
      alert: { status: "pending" },
    },
  ],
  unrewarded: [
    {
      status: "unrewarded",
      completion: snapshot,
      markedAt: "2026-08-02T00:00:02.000Z",
    },
  ],
};

describe("completionRecordSchema", () => {
  const cases = Object.entries(samples).flatMap(([status, records]) =>
    records.map(
      (record, index) => [`${status}#${index}`, record] as const,
    ),
  );

  it.each(cases)("%s 经 JSON 往返后仍能原样解析", (_name, record) => {
    // JSON 往返模拟 jsonb 列的出库过程，这正是 get() 走的那条路。
    const fromDatabase = JSON.parse(JSON.stringify(record));
    expect(completionRecordSchema.parse(fromDatabase)).toEqual(record);
  });

  it("每一个状态都至少有一个样本", () => {
    for (const [status, records] of Object.entries(samples)) {
      expect(records.length, `${status} 缺少样本`).toBeGreaterThan(0);
    }
  });

  it("拒绝未知状态，而不是悄悄放行", () => {
    expect(() =>
      completionRecordSchema.parse({
        status: "something_new",
        completion: snapshot,
        markedAt: "2026-08-02T00:00:02.000Z",
      }),
    ).toThrow();
  });

  // 历史 review 行（2026-08 之前写下的四字段形态）必须仍能读出来，
  // 且缺失的处置线索要补成可辨认的哨兵——否则那个会员在 548 天保留期内
  // 每次查状态都会 503。
  it("历史四字段 review 行仍可解析，并补上哨兵线索", () => {
    const legacy = {
      status: "review",
      completion: JSON.parse(JSON.stringify(snapshot)),
      reason: "give_rejected",
      markedAt: "2026-08-01T00:00:02.000Z",
    };
    const parsed = completionRecordSchema.parse(legacy);
    expect(parsed).toMatchObject({
      status: "review",
      reason: "give_rejected",
      baselineCouponIds: [],
      rewardContext: {
        memberId: "legacy-unknown",
        templateId: "legacy-unknown",
        templateName: "legacy-unknown",
      },
      alert: { status: "pending" },
    });
  });
});
