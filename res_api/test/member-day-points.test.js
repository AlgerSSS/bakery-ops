import assert from "node:assert/strict";
import test from "node:test";

import {
  MEMBER_DAY,
  adjustmentRemark,
  assertBusinessDate,
  assertMemberDay,
  bonusPointsForOrder,
  buildTopUpPlan,
  decideCard,
  isMemberDay,
  ledgerKey,
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
  assert.deepEqual(decideCard({ state: "claimed" }), { action: "halt", reason: "unresolved_claim" });
  assert.deepEqual(decideCard({ state: "applied" }), { action: "skip", reason: "already_applied" });
  assert.deepEqual(decideCard({ state: "failed" }), { action: "grant", reason: "retry_after_failure" });
  assert.deepEqual(decideCard(null), { action: "grant", reason: "no_prior_record" });
  assert.equal(decideCard({ state: "weird" }).action, "halt");
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
