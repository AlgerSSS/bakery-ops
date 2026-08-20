import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  LOYALTY_LEVELS,
} from "../lib/loyalty-levels.js";
import {
  assertCardMatchesPlanBaseline,
  assertManualDowngradeLevelConfiguration,
  birthdayMonthFromValue,
  buildCardReconciliationPlan,
  buildGrowthAdjustmentPayload,
  buildLevelChangePayload,
  cardPlanHasRestorableLevel,
  cardMatchesReconciliationTarget,
  createReferenceIdFactory,
  downgradeRecalculationDateForNotice,
  growthForSpend,
  levelOperationDirection,
  rollingWindowForDate,
  summarizeCardReconciliation,
} from "../lib/loyalty-reconciliation.js";

const card = (overrides = {}) => ({
  id: "card-1",
  cardNo: "number-1",
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

test("rolling window uses 12 natural months and only completed business days", () => {
  assert.deepEqual(rollingWindowForDate("2026-08-20"), {
    from: "2025-11-19",
    to: "2026-08-19",
  });
  assert.deepEqual(rollingWindowForDate("2027-08-20"), {
    from: "2026-08-20",
    to: "2027-08-19",
  });
  assert.deepEqual(
    rollingWindowForDate("2028-02-29", { historyStartDate: "2020-01-01" }),
    { from: "2027-02-28", to: "2028-02-28" },
  );
});

test("birthday parser returns only a valid Gregorian month without retaining PII", () => {
  assert.equal(birthdayMonthFromValue("1990-11-23"), 11);
  assert.equal(birthdayMonthFromValue("1990-99-23"), null);
  assert.equal(birthdayMonthFromValue(""), null);
});

test("downgrade notice is due exactly seven days before an eligible month start", () => {
  assert.equal(
    downgradeRecalculationDateForNotice("2026-10-25"),
    "2026-11-01",
  );
  assert.equal(downgradeRecalculationDateForNotice("2026-10-24"), null);
  assert.equal(downgradeRecalculationDateForNotice("2026-09-24"), null);
});

test("manual rolling downgrade requires native downgrade disabled and audited upgrade thresholds", () => {
  const levels = LOYALTY_LEVELS.map((level, index) => ({
    id: level.resLevelId,
    upgradeEnabled: index > 0,
    upgradeGrowth: level.threshold,
    degradeEnabled: false,
  }));
  assert.doesNotThrow(() =>
    assertManualDowngradeLevelConfiguration(levels),
  );
  assert.throws(
    () =>
      assertManualDowngradeLevelConfiguration(
        levels.map((level, index) =>
          index === 2 ? { ...level, degradeEnabled: true } : level,
        ),
      ),
    /native downgrade must stay disabled/,
  );
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
    { asOfDate: "2026-08-20" },
  );
  assert.deepEqual(plans[0], {
    cardId: "card-1",
    cardNo: "number-1",
    memberId: "member-1",
    currentLevelId: "1998685858403844100",
    spendTargetLevelId: "2090027041029333000",
    spendDirection: "upgrade",
    targetLevelId: "2090027041029333000",
    policyAction: "upgrade",
    keepLevelGap: 0,
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
    cardsEligibleForUpgrade: 1,
    cardsEligibleForOneLevelDowngrade: 0,
    cardsWithHeldDowngrade: 0,
    cardsWithUnrestorableLevelBaseline: 0,
    totalGrowthIncrease: 250,
    totalGrowthDecrease: 0,
  });
});

test("downgrades start in November 2026, run only on the first, and move one level", () => {
  const current = card({
    levelId: "2090027045185888261",
    levelAccount: { levelId: "2090027045185888261", growth: 1500 },
  });
  const beforeStart = buildCardReconciliationPlan([current], new Map(), {
    asOfDate: "2026-08-20",
  })[0];
  assert.equal(beforeStart.policyAction, "hold_before_first_downgrade");
  assert.equal(beforeStart.targetLevelId, "2090027045185888261");

  const outsideFirst = buildCardReconciliationPlan([current], new Map(), {
    asOfDate: "2026-11-02",
    birthdayMonthByMember: new Map([["member-1", 12]]),
  })[0];
  assert.equal(outsideFirst.policyAction, "hold_outside_monthly_recalculation");

  const eligible = buildCardReconciliationPlan([current], new Map(), {
    asOfDate: "2026-11-01",
    birthdayMonthByMember: new Map([["member-1", 12]]),
  })[0];
  assert.equal(eligible.policyAction, "downgrade_one_level");
  assert.equal(eligible.targetLevelId, "2090027043797577737");
  assert.equal(eligible.keepLevelGap, 1500);
});

test("birthday month, missing birthday, and an earlier monthly downgrade all hold level", () => {
  const current = card({
    levelId: "2090027043797577737",
    levelAccount: { levelId: "2090027043797577737", growth: 200 },
  });
  const missing = buildCardReconciliationPlan([current], new Map(), {
    asOfDate: "2026-11-01",
  })[0];
  assert.equal(missing.policyAction, "hold_missing_birthday");

  const birthday = buildCardReconciliationPlan([current], new Map(), {
    asOfDate: "2026-11-01",
    birthdayMonthByMember: new Map([["member-1", 11]]),
  })[0];
  assert.equal(birthday.policyAction, "hold_birthday_month");

  const repeated = buildCardReconciliationPlan([current], new Map(), {
    asOfDate: "2026-11-01",
    birthdayMonthByMember: new Map([["member-1", 12]]),
    downgradedCardNosThisMonth: new Set(["number-1"]),
  })[0];
  assert.equal(repeated.policyAction, "hold_already_downgraded_this_month");
});

test("RES level operation logs distinguish upgrades from downgrades", () => {
  const record = (before, after) => ({
    operationType: 2,
    operationContent: { levelNameBefore: before, levelNameAfter: after },
  });
  assert.equal(
    levelOperationDirection(
      record(
        "Lv3 热爱会员 Hot Crush",
        "Lv2 心动会员 Sweet Crush",
      ),
    ),
    "downgrade",
  );
  assert.equal(
    levelOperationDirection(
      record(
        "Lv1 初见会员 First Crush",
        "Lv2 心动会员 Sweet Crush",
      ),
    ),
    "upgrade",
  );
  assert.equal(levelOperationDirection(record("legacy", "unknown")), "unknown");
});

test("unassigned legacy levels are reported and blocked from reversible apply", () => {
  const [plan] = buildCardReconciliationPlan(
    [card({ levelId: "0", levelAccount: { levelId: "", growth: 0 } })],
    new Map(),
    { asOfDate: "2026-08-20" },
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
    { asOfDate: "2026-08-20" },
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
    { asOfDate: "2026-08-20" },
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
  assert.match(source, /WHERE store = \$\{memberStore\}/);
  assert.match(source, /--as-of/);
  assert.match(source, /hold_already_downgraded_this_month/);
  assert.match(source, /Apply mode requires an explicit --action/);
  assert.match(source, /assertManualDowngradeLevelConfiguration/);
});
