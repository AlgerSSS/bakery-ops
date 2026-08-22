import assert from "node:assert/strict";
import test from "node:test";

import {
  MEMBER_DAY,
  POINT_ADJUST_TYPE,
  adjustmentRemark,
  assertBusinessDate,
  assertMemberDay,
  bonusPointsForOrder,
  buildTopUpPlan,
  decideCard,
  isMemberDay,
  ledgerKey,
  mostRecentMemberDay,
} from "../lib/member-day-points.js";

test("bonus is the gap between 1.5x and what RES already granted", () => {
  // 先乘 0.5 再取整会在这里少给 1 分：floor(1.99*0.5)=0，但 floor(2.985)-floor(1.99)=1。
  assert.equal(bonusPointsForOrder(1.99), 1);
  assert.equal(bonusPointsForOrder(50), 25);
  assert.equal(bonusPointsForOrder(50.5), 25);
  assert.equal(bonusPointsForOrder(1), 0);
  assert.equal(bonusPointsForOrder(2), 1);
});

test("refunds and zero-value orders never subtract points", () => {
  assert.equal(bonusPointsForOrder(0), 0);
  assert.equal(bonusPointsForOrder(-120.5), 0);
});

test("a non-numeric amount is refused rather than treated as zero", () => {
  assert.throws(() => bonusPointsForOrder(null), /missing/i);
  assert.throws(() => bonusPointsForOrder("abc"), /not finite/i);
  assert.throws(() => bonusPointsForOrder(undefined), /missing/i);
  assert.throws(() => bonusPointsForOrder(""), /missing/i);
});

test("only Wednesday business dates are accepted", () => {
  assert.equal(isMemberDay("2026-08-26"), true);
  assert.equal(isMemberDay("2026-08-27"), false);
  assert.equal(assertMemberDay("2026-09-02"), "2026-09-02");
  assert.throws(() => assertMemberDay("2026-08-28"), /not a Wednesday/i);
});

test("malformed or impossible dates are refused", () => {
  assert.throws(() => assertBusinessDate("2026-8-26"), /YYYY-MM-DD/);
  assert.throws(() => assertBusinessDate("2026-02-30"), /not a real calendar date/i);
  assert.throws(() => assertBusinessDate(""), /YYYY-MM-DD/);
});

test("per-order rounding is preserved when aggregating a card", () => {
  // 三笔 RM1.99：逐笔各补 1 分共 3 分。先加总（5.97）再算只得 2 分。
  const plan = buildTopUpPlan([
    { cardNo: "C1", orderId: "o1", actualPaid: 1.99 },
    { cardNo: "C1", orderId: "o2", actualPaid: 1.99 },
    { cardNo: "C1", orderId: "o3", actualPaid: 1.99 },
  ]);
  assert.equal(plan.cardCount, 1);
  assert.equal(plan.cards[0].points, 3);
  assert.equal(plan.totalPoints, 3);
});

test("orders without a card, and zero-bonus orders, are counted not silently dropped", () => {
  const plan = buildTopUpPlan([
    { cardNo: "", orderId: "o1", actualPaid: 100 },
    { cardNo: "C1", orderId: "o2", actualPaid: 1 },
    { cardNo: "C1", orderId: "o3", actualPaid: 40 },
  ]);
  assert.equal(plan.skippedNoCard, 1);
  assert.equal(plan.skippedZero, 1);
  assert.equal(plan.cardCount, 1);
  assert.equal(plan.cards[0].points, 20);
  assert.equal(plan.orderCount, 3);
});

test("an implausibly large per-card total is surfaced, not granted quietly", () => {
  const plan = buildTopUpPlan([{ cardNo: "C1", orderId: "o1", actualPaid: 100_000 }]);
  assert.equal(plan.overCap.length, 1);
  assert.equal(plan.overCap[0].cardNo, "C1");
});

test("an unresolved claim halts instead of retrying", () => {
  // RES 成功但记账前崩溃会停在 claimed。自动重试 = 重复送分，积分收不回来。
  assert.deepEqual(decideCard({ state: "claimed", points: 25 }, 25),
    { action: "halt", points: 0, reason: "unresolved_claim" });
  assert.equal(decideCard({ state: "weird" }, 25).action, "halt");
  assert.deepEqual(decideCard({ state: "failed", points: 0 }, 25),
    { action: "grant", points: 25, reason: "retry_after_failure" });
  assert.deepEqual(decideCard(null, 25),
    { action: "grant", points: 25, reason: "no_prior_record" });
});

test("a rerun grants only the difference when late orders arrive", () => {
  // 周三 23:59 主跑发了 25 分；周四补扫时计划涨到 40，只能再发 15，不能再发 40。
  assert.deepEqual(decideCard({ state: "applied", points: 25 }, 40),
    { action: "grant", points: 15, reason: "late_orders_top_up" });
});

test("a rerun never claws points back", () => {
  // 计划额回落（例如订单被冲正）时跳过，不做负向调整——回收由 RES 自己的冲正流程负责。
  assert.deepEqual(decideCard({ state: "applied", points: 40 }, 25),
    { action: "skip", points: 0, reason: "already_applied" });
  assert.deepEqual(decideCard({ state: "applied", points: 25 }, 25),
    { action: "skip", points: 0, reason: "already_applied" });
});

test("a corrupt applied amount halts rather than guessing", () => {
  assert.equal(decideCard({ state: "applied", points: "oops" }, 25).action, "halt");
  assert.equal(decideCard({ state: "applied", points: -5 }, 25).action, "halt");
});

test("the planned amount itself must be a sane integer", () => {
  assert.throws(() => decideCard(null, -1), /non-negative integer/);
  assert.throws(() => decideCard(null, 1.5), /non-negative integer/);
});

test("the default business date resolves to Wednesday from either run slot", () => {
  // 主跑在周三 23:59（目标=当天），补扫在周四凌晨（目标=昨天），同一函数都要落到同一个周三。
  assert.equal(mostRecentMemberDay("2026-08-26"), "2026-08-26");
  assert.equal(mostRecentMemberDay("2026-08-27"), "2026-08-26");
  assert.equal(mostRecentMemberDay("2026-09-01"), "2026-08-26");
});

test("ledger keys are unique per card per business date", () => {
  assert.equal(ledgerKey("2026-08-26", "C1"), "2026-08-26|C1");
  assert.notEqual(ledgerKey("2026-08-26", "C1"), ledgerKey("2026-09-02", "C1"));
});

test("the remark carries the business date so RES records can be reconciled", () => {
  const remark = adjustmentRemark("2026-08-26", 2);
  assert.match(remark, /2026-08-26/);
  assert.match(remark, /1\.5x/);
  assert.match(remark, /2 order/);
});

test("the multiplier stays 1.5 — changing it silently would change payouts", () => {
  assert.equal(MEMBER_DAY.multiplier, 1.5);
  assert.equal(MEMBER_DAY.weekday, 3);
});

test("point adjustment uses the points enum, not the stored-value one", () => {
  // 用储值调整的 10 打积分接口会被 RES 拒绝（invalid request param: type）。
  // 7 是在真实卡上验证过的"增加积分"，并且不会改动成长值或储值余额。
  assert.equal(POINT_ADJUST_TYPE.increase, 7);
  assert.equal(POINT_ADJUST_TYPE.decrease, 701);
  assert.notEqual(POINT_ADJUST_TYPE.increase, 10);
});
