import assert from "node:assert/strict";
import test from "node:test";

import {
  LEVEL_CATALOG_V2,
  LEVEL_PROGRAM_ID,
  assertExistingLevelBaseline,
  buildL5CreatePayload,
  buildLevelModifyPayload,
  l5MatchesTarget,
} from "../lib/level-catalog-v2.js";

const existing = (configured) => ({
  id: configured.id,
  levelProgramId: LEVEL_PROGRAM_ID,
  name: configured.oldName,
  ranking: Number(configured.key.slice(1)) || 0,
  backgroundImg: "https://example.com/card.png",
  color: "#123456",
  verificationType: 0,
  accumulateTimeType: 0,
  growthKeepLevelDay: 0,
  degradeType: 3,
  conditionList: [],
  rightsIdList: ["right-1"],
  flag: configured.key === "L1" ? 1 : 0,
  upgradeEnabled: configured.threshold > 0,
  upgradeGrowth: configured.threshold,
  degradeEnabled: false,
});

test("the approved catalog has five ordered thresholds", () => {
  assert.deepEqual(LEVEL_CATALOG_V2.map((level) => level.threshold), [0, 250, 750, 1500, 3000]);
  assert.deepEqual(LEVEL_CATALOG_V2.map((level) => level.key), ["L1", "L2", "L3", "L4", "L5"]);
});

test("renaming preserves the operational fields and rights", () => {
  const configured = LEVEL_CATALOG_V2[2];
  const level = existing(configured);
  assert.doesNotThrow(() => assertExistingLevelBaseline(level, configured));
  const payload = buildLevelModifyPayload(level, configured.targetName);
  assert.equal(payload.name, "Lv3 流心会员 Gooey Crush");
  assert.equal(payload.upgradeGrowth, 750);
  assert.deepEqual(payload.rightsIdList, ["right-1"]);
  assert.equal(payload.degradeEnabled, false);
});

test("L5 inherits a valid card background and uses the RM3000 threshold", () => {
  const payload = buildL5CreatePayload(existing(LEVEL_CATALOG_V2[3]));
  assert.equal(payload.name, "Lv5 挚爱会员 Diamond Crush");
  assert.equal(payload.upgradeGrowth, 3000);
  assert.equal(payload.ranking, 5);
  assert.equal(l5MatchesTarget({ id: "new", ...payload }), true);
});
