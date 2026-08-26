import assert from "node:assert/strict";
import test from "node:test";

import {
  entitlementsForLevel,
  levelKeyFromResName,
  periodKeyForEntitlement,
} from "../lib/level-entitlements.js";

test("the five live RES names map to their level keys", () => {
  assert.equal(levelKeyFromResName("Lv1 软绵会员 Fluffy Crush"), "L1");
  assert.equal(levelKeyFromResName("Lv5 挚爱会员 Diamond Crush"), "L5");
  assert.equal(levelKeyFromResName("VIP1"), null);
});

test("level rights are cumulative and L5 includes operational priority rights", () => {
  assert.deepEqual(entitlementsForLevel("L1"), ["birthday_card"]);
  const l5 = entitlementsForLevel("L5");
  assert.ok(l5.includes("birthday_basque"));
  assert.ok(l5.includes("new_product_preview"));
  assert.ok(l5.includes("new_product_tasting_box"));
  assert.ok(l5.includes("store_fast_lane"));
});

test("quarterly rights use a quarter period while annual rights use a year", () => {
  const now = new Date("2026-08-26T08:00:00Z");
  assert.equal(periodKeyForEntitlement("birthday_card", now), "2026");
  assert.equal(periodKeyForEntitlement("quarterly_tasting", now), "2026-Q3");
});
