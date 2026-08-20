import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  assertCardMatchesPlanBaseline,
  buildCardReconciliationPlan,
  buildGrowthAdjustmentPayload,
  buildLevelChangePayload,
  cardPlanHasRestorableLevel,
  cardMatchesReconciliationTarget,
  createReferenceIdFactory,
  growthForSpend,
  summarizeCardReconciliation,
} from "../lib/loyalty-reconciliation.js";

const card = (overrides = {}) => ({
  id: "card-1",
  customerId: "member-1",
  corporationId: "corp-1",
  cardProgramId: "program-1",
  status: 10,
  levelId: "1998685858403844100",
  levelAccount: { levelId: "1998685858403844100", growth: 0 },
  noExpiration: true,
  ...overrides,
});

test("growth mirrors whole RM of rounded qualifying spend", () => {
  assert.equal(growthForSpend(249.999999), 250);
  assert.equal(growthForSpend(249.99), 249);
  assert.equal(growthForSpend(0), 0);
  assert.equal(growthForSpend(-18.5), 0);
});

test("RES reference IDs are 18 digits and collision-free within a second", () => {
  const referenceId = createReferenceIdFactory({
    clock: () => new Date("2026-08-20T11:12:13.000Z"),
  });
  assert.equal(referenceId(), "202608201912131000");
  assert.equal(referenceId(), "202608201912131001");
});

test("card plans align growth and RES level IDs with rolling spend", () => {
  const plans = buildCardReconciliationPlan(
    [card(), card({ id: "card-2", customerId: "member-2" })],
    new Map([
      ["member-1", 250.4],
      ["member-2", 0],
    ]),
  );
  assert.deepEqual(plans[0], {
    cardId: "card-1",
    memberId: "member-1",
    currentLevelId: "1998685858403844100",
    targetLevelId: "2090027041029333000",
    currentGrowth: 0,
    targetGrowth: 250,
    growthDelta: 250,
    levelChangeNeeded: true,
  });
  assert.deepEqual(summarizeCardReconciliation(plans), {
    cards: 2,
    cardsNeedingAnyChange: 1,
    cardsNeedingGrowthIncrease: 1,
    cardsNeedingGrowthDecrease: 0,
    cardsNeedingLevelChange: 1,
    cardsWithUnrestorableLevelBaseline: 0,
    totalGrowthIncrease: 250,
    totalGrowthDecrease: 0,
  });
});

test("unassigned legacy levels are reported and blocked from reversible apply", () => {
  const [plan] = buildCardReconciliationPlan(
    [card({ levelId: "0", levelAccount: { levelId: "", growth: 0 } })],
    new Map(),
  );
  assert.equal(cardPlanHasRestorableLevel(plan), false);
  assert.equal(
    summarizeCardReconciliation([plan]).cardsWithUnrestorableLevelBaseline,
    1,
  );
  assert.throws(
    () => assertCardMatchesPlanBaseline(card(), plan, "program-1"),
    /cannot be restored safely/i,
  );
});

test("baseline guard catches purchase or concurrent level drift", () => {
  const [plan] = buildCardReconciliationPlan(
    [card()],
    new Map([["member-1", 250]]),
  );
  assert.doesNotThrow(() =>
    assertCardMatchesPlanBaseline(card(), plan, "program-1"),
  );
  assert.throws(
    () =>
      assertCardMatchesPlanBaseline(
        card({ levelAccount: { levelId: card().levelId, growth: 1 } }),
        plan,
        "program-1",
      ),
    /changed after/i,
  );
});

test("growth adjustment payload matches the intercepted RES contract", () => {
  assert.deepEqual(
    buildGrowthAdjustmentPayload(card(), -120, {
      shopId: "shop-1",
      orgPath: "/corp/shop",
      referenceId: "202608201911233324",
      remark: "rolling 12-month reconciliation",
    }),
    {
      shopId: "shop-1",
      adjustType: "2",
      growth: 120,
      remark: "rolling 12-month reconciliation",
      cardId: "card-1",
      sourceType: 2010,
      corporationId: "corp-1",
      orgPath: "/corp/shop",
      changeType: "1202",
      referenceId: "202608201911233324",
    },
  );
});

test("level change payload preserves expiry and enterprise assignment", () => {
  const payload = buildLevelChangePayload(
    card({
      noExpiration: false,
      expirationTime: "2027-08-20T00:00:00Z",
      virtualOrg: { groupId: "group-1" },
    }),
    "level-2",
    {
      ownerOrgId: "org-1",
      ownerOrgType: 7,
      orgPath: "/corp/shop",
    },
  );
  assert.deepEqual(payload, {
    levelId: "level-2",
    expirationTime: "2027-08-20T00:00:00Z",
    cardId: "card-1",
    ownerOrgId: "org-1",
    ownerOrgType: "7",
    sourceType: 2010,
    orgPath: "/corp/shop",
    changeTypeList: ["2"],
    virtualOrg: { type: 1001, groupId: "group-1" },
  });
});

test("target matcher requires both growth and level to agree", () => {
  const [plan] = buildCardReconciliationPlan(
    [card()],
    new Map([["member-1", 250]]),
  );
  const target = card({
    levelId: plan.targetLevelId,
    levelAccount: { levelId: plan.targetLevelId, growth: 250 },
  });
  assert.equal(cardMatchesReconciliationTarget(target, plan), true);
  assert.equal(
    cardMatchesReconciliationTarget(
      { ...target, levelAccount: { ...target.levelAccount, growth: 249 } },
      plan,
    ),
    false,
  );
});

test("reconciliation CLI is preview-first with guarded apply and rollback", () => {
  const source = [
    "../scripts/preview-loyalty-levels.mjs",
    "../lib/loyalty-reconciliation.js",
  ]
    .map((path) => fs.readFileSync(new URL(path, import.meta.url), "utf8"))
    .join("\n");
  assert.match(source, /SEE_YOU_OFTEN_LEVELS_V1/);
  assert.match(source, /if \(args\.apply\)/);
  assert.match(source, /changed after the reconciliation snapshot/);
  assert.match(source, /restoreCard/);
  assert.match(source, /rollback could not be verified/);
});
