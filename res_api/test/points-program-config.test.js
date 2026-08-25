import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  assertSafePointsBaseline,
  buildPointsProgramRollback,
  buildPointsProgramTarget,
  pointsProgramMatchesTarget,
  summarizePointsProgram,
} from "../lib/points-program-config.js";

const baseline = {
  id: "points-1",
  cardProgramId: "card-program-1",
  memberProgramId: null,
  earnEnabled: true,
  earnMaximumEnabled: false,
  applyCardScope: 0,
  earnRuleList: [
    { levelId: "0", levelName: "", consumeAmount: "100", earnPoints: 1 },
  ],
  amountType: 1,
  applyPaymentType: 1,
  applyPaymentList: [],
  paymentRuleList: [],
  exchangeEnabled: false,
  exchangeAmount: "0",
  exchangePoints: 100,
  exchangeMinimumEnabled: false,
  exchangeMaximumEnabled: false,
  exchangeChannel: ["offline"],
  clearingEnabled: true,
  clearingType: 1,
  clearingYears: 1,
  clearingDate: "0101",
  clearingCycle: 12,
  clearingCycleType: 0,
  clearingNoticeEnabled: false,
  clearingNoticeDays: [],
  description: "",
  applyItem: null,
  promotionItemEarnEnabled: true,
  activityTime: {
    dayValidTimeValueList: [],
    weekValidTimeValueList: null,
    monthValidTimeValueList: null,
    periodType: 1,
    availableTimeIntervalType: 0,
    validDate: null,
    exceptRangeList: null,
  },
};

test("baseline guard accepts only the audited live configuration", () => {
  assert.doesNotThrow(() =>
    assertSafePointsBaseline(baseline, {
      pointsProgramId: "points-1",
      cardProgramId: "card-program-1",
    }),
  );
  assert.throws(
    () =>
      assertSafePointsBaseline(
        { ...baseline, clearingCycle: 6 },
        { pointsProgramId: "points-1", cardProgramId: "card-program-1" },
      ),
    /baseline drift/i,
  );
  assert.throws(
    () =>
      assertSafePointsBaseline(baseline, {
        pointsProgramId: "other",
        cardProgramId: "card-program-1",
      }),
    /identity mismatch/i,
  );
});

test("target changes only the confirmed points semantics", () => {
  const target = buildPointsProgramTarget(baseline);
  assert.deepEqual(
    {
      earnEnabled: target.earnEnabled,
      earnRuleList: target.earnRuleList,
      amountType: target.amountType,
      exchangeEnabled: target.exchangeEnabled,
      exchangeAmount: target.exchangeAmount,
      exchangePoints: target.exchangePoints,
      exchangeChannel: target.exchangeChannel,
      clearingEnabled: target.clearingEnabled,
    },
    {
      earnEnabled: true,
      earnRuleList: [{ consumeAmount: "100", earnPoints: 1 }],
      amountType: 2,
      exchangeEnabled: true,
      exchangeAmount: "1000",
      exchangePoints: 100,
      exchangeChannel: ["offline"],
      clearingEnabled: false,
    },
  );
  assert.equal(target.promotionItemEarnEnabled, true);
  assert.equal(target.earnMaximumEnabled, false);
  assert.equal(target.applyPaymentType, 1);
});

test("rollback payload reconstructs the audited current state", () => {
  const rollback = buildPointsProgramRollback(baseline);
  assert.equal(rollback.amountType, 1);
  assert.equal(rollback.exchangeEnabled, false);
  assert.equal(rollback.clearingEnabled, true);
  assert.equal(rollback.clearingType, 1);
  assert.equal(rollback.clearingCycle, 12);
  assert.deepEqual(rollback.earnRuleList, [
    { consumeAmount: "100", earnPoints: 1 },
  ]);
});

test("readback matcher and summary distinguish baseline from target", () => {
  const target = buildPointsProgramTarget(baseline);
  assert.equal(pointsProgramMatchesTarget(baseline), false);
  assert.equal(pointsProgramMatchesTarget(target), true);
  assert.deepEqual(summarizePointsProgram(target), {
    earn: "RM1 actual paid = 1 point",
    amountBasis: "member_actual_paid",
    cashRedemption: "100 points = RM10 (POS)",
    expiry: "no_automatic_clearing",
  });
});

test("configuration script is preview-first and apply requires guarded rollback", () => {
  const source = fs.readFileSync(
    new URL("../scripts/configure-points-program.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /read-only-preview/);
  assert.match(source, /--apply/);
  assert.match(source, /SEE_YOU_OFTEN_POINTS_V1/);
  assert.match(source, /rollback points program/);
  assert.match(source, /changed concurrently/);
});
