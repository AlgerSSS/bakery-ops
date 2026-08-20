import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildDowngradeLedgerClaim,
  downgradeLedgerDecision,
} from "../lib/loyalty-downgrade-ledger.js";

const TOKEN = "00000000-0000-4000-8000-000000000001";
const plan = (overrides = {}) => ({
  cardId: "card-1",
  currentLevelId: "2090027045185888261",
  targetLevelId: "2090027043797577737",
  policyAction: "downgrade_one_level",
  ...overrides,
});
const context = (overrides = {}) => ({
  asOfDate: "2026-11-01",
  windowFrom: "2025-11-01",
  windowTo: "2026-10-31",
  ...overrides,
});

function claim() {
  return buildDowngradeLedgerClaim(plan(), context(), { claimToken: TOKEN });
}

function entry(overrides = {}) {
  const value = claim();
  return {
    ledger_id: 1,
    card_id: value.cardId,
    recalculation_date: value.recalculationDate,
    action: value.action,
    window_from: value.windowFrom,
    window_to: value.windowTo,
    from_level_id: value.fromLevelId,
    target_level_id: value.targetLevelId,
    status: "claimed",
    claim_token: value.claimToken,
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

test("downgrade claims require month day 1 and exactly one known level step", () => {
  assert.deepEqual(claim(), {
    cardId: "card-1",
    recalculationDate: "2026-11-01",
    action: "downgrade",
    windowFrom: "2025-11-01",
    windowTo: "2026-10-31",
    fromLevelId: "2090027045185888261",
    targetLevelId: "2090027043797577737",
    claimToken: TOKEN,
  });
  assert.throws(
    () =>
      buildDowngradeLedgerClaim(plan(), context({ asOfDate: "2026-11-02" }), {
        claimToken: TOKEN,
      }),
    /month day 1/i,
  );
  assert.throws(
    () =>
      buildDowngradeLedgerClaim(
        plan({ targetLevelId: "2090027041029333000" }),
        context(),
        { claimToken: TOKEN },
      ),
    /exactly one known level step/i,
  );
});

test("a missing ledger row is claimed before any RES downgrade", () => {
  assert.deepEqual(
    downgradeLedgerDecision(null, plan().currentLevelId, claim()),
    { action: "claim" },
  );
});

test("an observed target finalizes an interrupted claim and blocks a second downgrade", () => {
  assert.deepEqual(
    downgradeLedgerDecision(entry(), plan().targetLevelId, claim()),
    { action: "finalize_and_prevent", reason: "target_observed" },
  );
  assert.deepEqual(
    downgradeLedgerDecision(
      entry({ status: "applied", applied_at: "2026-11-01T00:01:00Z" }),
      plan().targetLevelId,
      claim(),
    ),
    { action: "prevent", reason: "already_applied" },
  );
});

test("fresh claims block concurrency while stale or confirmed-failed claims can retry", () => {
  const now = new Date("2026-11-01T00:10:00.000Z");
  assert.deepEqual(
    downgradeLedgerDecision(entry(), plan().currentLevelId, claim(), { now }),
    { action: "prevent", reason: "fresh_claim_in_progress" },
  );
  assert.deepEqual(
    downgradeLedgerDecision(entry(), plan().currentLevelId, claim(), {
      now: new Date("2026-11-01T00:16:00.000Z"),
    }),
    { action: "reclaim", reason: "stale_claim" },
  );
  assert.deepEqual(
    downgradeLedgerDecision(
      entry({ status: "failed" }),
      plan().currentLevelId,
      claim(),
      { now },
    ),
    { action: "reclaim", reason: "retry_failed" },
  );
});

test("ambiguous and contradictory states fail closed", () => {
  assert.deepEqual(
    downgradeLedgerDecision(
      entry({ status: "ambiguous" }),
      plan().currentLevelId,
      claim(),
    ),
    { action: "prevent", reason: "ambiguous_fail_closed" },
  );
  assert.deepEqual(
    downgradeLedgerDecision(entry(), "unexpected-level", claim()),
    { action: "mark_ambiguous", reason: "unexpected_live_level" },
  );
  assert.deepEqual(
    downgradeLedgerDecision(
      entry({ status: "applied", applied_at: "2026-11-01T00:01:00Z" }),
      plan().currentLevelId,
      claim(),
    ),
    { action: "prevent", reason: "applied_ledger_live_level_changed" },
  );
});

test("migration 112 enforces a monthly unique downgrade ledger without direct PII", () => {
  const source = fs.readFileSync(
    new URL(
      "../../bakery-ops/src/modules/data/migrations/112_loyalty_level_change_ledger.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /UNIQUE \(card_id, recalculation_date, action\)/);
  assert.match(source, /status IN \('claimed', 'applied', 'failed', 'ambiguous'\)/);
  assert.match(source, /extract\(day FROM recalculation_date\) = 1/);
  assert.match(source, /VALUES \(112, 'loyalty_level_change_ledger'\)/);
  assert.doesNotMatch(source, /\b(card_no|member_id|phone|birthday)\b/);
});

test("apply path claims before changing RES and reconciles every terminal outcome", () => {
  const source = fs.readFileSync(
    new URL("../scripts/preview-loyalty-levels.mjs", import.meta.url),
    "utf8",
  );
  const applySource = source.slice(source.indexOf("async function applyReconciliation"));
  assert.ok(
    applySource.indexOf("claimDowngradeLedger(") <
      applySource.indexOf("changeLevel("),
  );
  assert.match(applySource, /markDowngradeLedgerApplied/);
  assert.match(applySource, /markDowngradeLedgerFailed/);
  assert.match(applySource, /markDowngradeLedgerAmbiguous/);
  assert.match(applySource, /reconcileObservedDowngradeApplied/);
  assert.match(applySource, /assertDowngradeLedgerSchema/);
});
