import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  assertSafeLevelProgramBaseline,
  buildLevelProgramRollback,
  buildLevelProgramTarget,
  levelProgramMatchesTarget,
  summarizeLevelProgram,
} from "../lib/level-program-config.js";

const baseline = {
  id: "level-program-1",
  cardProgramId: "card-program-1",
  type: 1,
  growthCalculateType: 0,
  growthPaymentRuleList: [],
  degradeForewarning: false,
  scheduledTime: "0000",
  amountOfConsumptionTimes: "0",
  growthEarnRules: [
    { type: 0, amount: "1", growth: 1, enabled: true },
    { type: 1, amount: "1", growth: null, enabled: false },
    { type: 2, amount: "0", growth: null, enabled: false },
    { type: 3, enabled: false },
  ],
};

test("baseline guard accepts only the audited RM0.01 live bug", () => {
  assert.doesNotThrow(() =>
    assertSafeLevelProgramBaseline(baseline, {
      levelProgramId: "level-program-1",
      cardProgramId: "card-program-1",
    }),
  );
  assert.throws(
    () =>
      assertSafeLevelProgramBaseline(
        {
          ...baseline,
          growthEarnRules: baseline.growthEarnRules.map((rule) =>
            rule.type === 0 ? { ...rule, amount: "100" } : rule,
          ),
        },
        {
          levelProgramId: "level-program-1",
          cardProgramId: "card-program-1",
        },
      ),
    /baseline drift/i,
  );
});

test("target changes the purchase rule to RM1 for one growth point", () => {
  const target = buildLevelProgramTarget(baseline);
  assert.deepEqual(target.growthEarnRules[0], {
    type: 0,
    amount: "100",
    growth: 1,
    enabled: true,
  });
  const readback = { ...baseline, ...target };
  assert.equal(levelProgramMatchesTarget(readback), true);
  assert.deepEqual(summarizeLevelProgram(readback), {
    purchaseAmountMyr: 1,
    growthAwarded: 1,
    purchaseRuleEnabled: true,
  });
});

test("rollback reconstructs the audited RM0.01 rule", () => {
  const rollback = buildLevelProgramRollback(baseline);
  assert.equal(rollback.growthEarnRules[0].amount, "1");
  assert.deepEqual(summarizeLevelProgram({ ...baseline, ...rollback }), {
    purchaseAmountMyr: 0.01,
    growthAwarded: 1,
    purchaseRuleEnabled: true,
  });
});

test("configuration script is preview-first and guarded", () => {
  const source = fs.readFileSync(
    new URL("../scripts/configure-level-program.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /read-only-preview/);
  assert.match(source, /SEE_YOU_OFTEN_GROWTH_V1/);
  assert.match(source, /changed concurrently/);
  assert.match(source, /rollback level program/);
});
