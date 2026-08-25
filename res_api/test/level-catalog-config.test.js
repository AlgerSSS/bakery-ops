import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  assertSafeL1RenameBaseline,
  buildLevelNamePayload,
  L1_LEGACY_NAME,
  L1_LEVEL_ID,
  L1_TARGET_NAME,
  LEVEL_PROGRAM_ID,
  levelMatchesRenamedTarget,
} from "../lib/level-catalog-config.js";

const baseline = {
  id: L1_LEVEL_ID,
  levelProgramId: LEVEL_PROGRAM_ID,
  name: L1_LEGACY_NAME,
  ranking: 0,
  backgroundImg: "",
  color: "",
  verificationType: 0,
  accumulateTimeType: 0,
  growthKeepLevelDay: 0,
  degradeType: 0,
  conditionList: [],
  rightsIdList: [],
  flag: 1,
  upgradeEnabled: false,
  upgradeGrowth: 0,
  degradeEnabled: false,
};

test("L1 rename accepts only the audited legacy baseline", () => {
  assert.doesNotThrow(() => assertSafeL1RenameBaseline(baseline));
  assert.throws(
    () => assertSafeL1RenameBaseline({ ...baseline, name: "Another name" }),
    /baseline drift/i,
  );
});

test("L1 rename payload changes only the name-bearing API request", () => {
  const payload = buildLevelNamePayload(baseline, L1_TARGET_NAME);
  assert.deepEqual(payload, {
    name: L1_TARGET_NAME,
    id: L1_LEVEL_ID,
    levelProgramId: LEVEL_PROGRAM_ID,
    type: 1,
    ranking: 0,
    backgroundImg: "",
    color: "",
    verificationType: 0,
    accumulateTimeType: 0,
    growthKeepLevelDay: 0,
    degradeType: 0,
    conditionList: [],
    rightsIdList: [],
    flag: 1,
  });
});

test("L1 target matcher rejects collateral field changes", () => {
  const target = { ...baseline, name: L1_TARGET_NAME };
  assert.equal(levelMatchesRenamedTarget(target, baseline), true);
  assert.equal(
    levelMatchesRenamedTarget({ ...target, degradeType: 3 }, baseline),
    false,
  );
});

test("level catalog script is preview-first and reversible", () => {
  const source = fs.readFileSync(
    new URL("../scripts/configure-level-catalog.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /read-only-preview/);
  assert.match(source, /SEE_YOU_OFTEN_LEVEL_NAMES_V1/);
  assert.match(source, /changed concurrently/);
  assert.match(source, /rollback L1 name/);
});
