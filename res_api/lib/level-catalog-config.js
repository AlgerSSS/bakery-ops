const number = (value) => Number(value) || 0;

export const L1_LEVEL_ID = "1998685858403844100";
export const LEVEL_PROGRAM_ID = "1998685858366095366";
export const L1_LEGACY_NAME = "VIP1";
export const L1_TARGET_NAME = "Lv1 初见会员 First Crush";

function identity(level) {
  if (!level?.id || !level?.levelProgramId) {
    throw new Error("Level identity is missing.");
  }
  return {
    id: String(level.id),
    levelProgramId: String(level.levelProgramId),
  };
}

export function assertSafeL1RenameBaseline(level) {
  const ids = identity(level);
  if (ids.id !== L1_LEVEL_ID || ids.levelProgramId !== LEVEL_PROGRAM_ID) {
    throw new Error("L1 identity mismatch; refusing mutation.");
  }
  if (
    level.name !== L1_LEGACY_NAME ||
    number(level.ranking) !== 0 ||
    level.flag !== 1 ||
    level.upgradeEnabled !== false ||
    number(level.upgradeGrowth) !== 0 ||
    level.degradeEnabled !== false
  ) {
    throw new Error("L1 rename baseline drift; refusing mutation.");
  }
}

export function stableLevelProjection(level) {
  identity(level);
  return {
    id: String(level.id),
    levelProgramId: String(level.levelProgramId),
    name: String(level.name),
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

export function buildLevelNamePayload(level, name) {
  const current = stableLevelProjection(level);
  return {
    name,
    id: current.id,
    levelProgramId: current.levelProgramId,
    type: 1,
    ranking: current.ranking,
    backgroundImg: current.backgroundImg,
    color: current.color,
    verificationType: current.verificationType,
    accumulateTimeType: current.accumulateTimeType,
    growthKeepLevelDay: current.growthKeepLevelDay,
    degradeType: current.degradeType,
    conditionList: current.conditionList,
    rightsIdList: current.rightsIdList,
    flag: current.flag,
  };
}

export function levelMatchesRenamedTarget(level, baseline) {
  return (
    JSON.stringify(stableLevelProjection(level)) ===
    JSON.stringify({
      ...stableLevelProjection(baseline),
      name: L1_TARGET_NAME,
    })
  );
}
