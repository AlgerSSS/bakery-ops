import test from "node:test";
import assert from "node:assert/strict";

import {
  assessBenefitReadiness,
  nativeBenefitGaps,
} from "../lib/benefit-readiness.js";

test("native fit reports every confirmed rule RES cannot represent exactly", () => {
  assert.deepEqual(
    nativeBenefitGaps().map((gap) => gap.code),
    [
      "member_day_fractional_multiplier_unsupported",
      "principal_same_day_zero_percent_unsupported",
      "gift_balance_expiry_unsupported",
      "gift_first_consumption_unsupported",
      "open_ended_top_up_program_unsupported",
    ],
  );
});

test("fractional member-day multiplier is accepted only when capability precision supports it", () => {
  const gaps = nativeBenefitGaps({
    memberDayPointsMultiplier: { min: 1, max: 9, precision: 1 },
    storedValue: {
      principalSameDayAvailablePercent: { min: 0, max: 100 },
      perGrantGiftBalanceExpiry: true,
      configurableBalanceConsumptionPriority: true,
      requiresFiniteEndDate: false,
    },
  });

  assert.equal(
    gaps.some((gap) => gap.code === "member_day_fractional_multiplier_unsupported"),
    false,
  );
});

test("live readiness distinguishes missing configuration from native gaps", () => {
  const result = assessBenefitReadiness({
    nowDate: "2026-08-20",
    memberRights: [],
    campaigns: [],
    topUpPrograms: [],
    processManagementAccessible: false,
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.configured, {
    memberDay: false,
    birthdayGift: false,
    levelingGift: false,
    topUp100Plus20: false,
    smsProcessManagement: false,
  });
  assert.ok(result.blockers.some((item) => item.code === "live_memberDay_missing"));
  assert.ok(result.blockers.some((item) => item.code === "gift_balance_expiry_unsupported"));
});

test("a matching live setup still remains blocked by unsupported semantics", () => {
  const result = assessBenefitReadiness({
    nowDate: "2026-08-30",
    memberRights: [{ type: 7, status: 1 }],
    campaigns: [
      { type: 1003, status: 1, validStatus: 1 },
      { type: 1002, status: 1, validStatus: 1 },
    ],
    topUpPrograms: [{
      status: 1,
      startDate: "2026-08-29",
      endDate: "2027-08-29",
      rules: [{ storedAmount: "10000", returnAmount: "2000" }],
    }],
    processManagementAccessible: true,
  });

  assert.deepEqual(result.configured, {
    memberDay: true,
    birthdayGift: true,
    levelingGift: true,
    topUp100Plus20: true,
    smsProcessManagement: true,
  });
  assert.equal(result.blockers.length, result.nativeGaps.length);
  assert.equal(result.ready, false);
});

test("invalid readiness dates fail closed", () => {
  assert.throws(
    () => assessBenefitReadiness({ nowDate: "20-08-2026" }),
    /YYYY-MM-DD/,
  );
});
