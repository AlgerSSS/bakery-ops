export const LEVEL_PROGRAM_ID = "1998685858366095366";

export const LEVEL_CATALOG_V2 = Object.freeze([
  Object.freeze({
    key: "L1",
    id: "1998685858403844100",
    oldName: "Lv1 初见会员 First Crush",
    targetName: "Lv1 软绵会员 Fluffy Crush",
    threshold: 0,
  }),
  Object.freeze({
    key: "L2",
    id: "2090027041029333000",
    oldName: "Lv2 心动会员 Sweet Crush",
    targetName: "Lv2 暖香会员 Toasty Crush",
    threshold: 250,
  }),
  Object.freeze({
    key: "L3",
    id: "2090027043797577737",
    oldName: "Lv3 热爱会员 Hot Crush",
    targetName: "Lv3 流心会员 Gooey Crush",
    threshold: 750,
  }),
  Object.freeze({
    key: "L4",
    id: "2090027045185888261",
    oldName: "Lv4 挚爱会员 Forever Crush",
    targetName: "Lv4 黄金会员 Golden Crush",
    threshold: 1500,
  }),
  Object.freeze({
    key: "L5",
    id: "2092524707546116100",
    oldName: null,
    targetName: "Lv5 挚爱会员 Diamond Crush",
    threshold: 3000,
  }),
]);

const number = (value) => Number(value) || 0;

export function assertExistingLevelBaseline(level, configured) {
  if (
    String(level?.id ?? "") !== configured.id ||
    String(level?.levelProgramId ?? "") !== LEVEL_PROGRAM_ID
  ) {
    throw new Error(`${configured.key} identity mismatch.`);
  }
  if (![configured.oldName, configured.targetName].includes(level.name)) {
    throw new Error(`${configured.key} name drifted from the approved catalog.`);
  }
  const expectedUpgrade = configured.threshold > 0;
  if (
    level.upgradeEnabled !== expectedUpgrade ||
    number(level.upgradeGrowth) !== configured.threshold ||
    level.degradeEnabled !== false
  ) {
    throw new Error(`${configured.key} threshold or automation baseline drifted.`);
  }
}

export function buildLevelModifyPayload(level, name) {
  return {
    id: String(level.id),
    levelProgramId: String(level.levelProgramId),
    name,
    type: 1,
    ranking: number(level.ranking),
    backgroundImg: level.backgroundImg || "",
    color: level.color || "",
    verificationType: number(level.verificationType),
    accumulateTimeType: number(level.accumulateTimeType),
    growthKeepLevelDay: number(level.growthKeepLevelDay),
    degradeType: number(level.degradeType),
    conditionList: Array.isArray(level.conditionList) ? level.conditionList : [],
    rightsIdList: Array.isArray(level.rightsIdList) ? level.rightsIdList : [],
    flag: number(level.flag),
    upgradeEnabled: level.upgradeEnabled === true,
    upgradeGrowth: number(level.upgradeGrowth),
    degradeEnabled: level.degradeEnabled === true,
  };
}

export function buildL5CreatePayload(l4) {
  if (!l4?.backgroundImg) {
    throw new Error("L4 has no card background to reuse for L5.");
  }
  return {
    levelProgramId: LEVEL_PROGRAM_ID,
    type: 1,
    ranking: Math.max(5, number(l4.ranking) + 1),
    name: LEVEL_CATALOG_V2[4].targetName,
    backgroundImg: l4.backgroundImg,
    color: "#6A1C13",
    verificationType: 0,
    upgradeEnabled: true,
    accumulateTimeType: 0,
    accumulateDays: 0,
    upgradeConditionRelationType: 0,
    degradeEnabled: false,
    growthKeepLevelDay: 0,
    degradeConditionRelationType: 0,
    degradeJudgeType: 0,
    degradeTimeType: 2,
    degradeType: 3,
    degradeLevelId: "0",
    conditionList: [],
    rightsIdList: [],
    upgradeGrowth: LEVEL_CATALOG_V2[4].threshold,
    flag: 0,
  };
}

export function l5MatchesTarget(level) {
  const target = LEVEL_CATALOG_V2[4];
  return (
    String(level?.levelProgramId ?? "") === LEVEL_PROGRAM_ID &&
    level?.name === target.targetName &&
    level?.upgradeEnabled === true &&
    number(level?.upgradeGrowth) === target.threshold &&
    level?.degradeEnabled === false &&
    number(level?.ranking) === 5
  );
}
