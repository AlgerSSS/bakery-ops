const amount = (value) => Number(value);

function ruleByType(program, type) {
  return program?.growthEarnRules?.find((rule) => Number(rule?.type) === type);
}

function identity(program) {
  if (!program?.id || !program?.cardProgramId) {
    throw new Error("Level program identity is missing.");
  }
  return {
    id: String(program.id),
    cardProgramId: String(program.cardProgramId),
  };
}

function matchesCommon(program) {
  const purchase = ruleByType(program, 0);
  const order = ruleByType(program, 1);
  const recharge = ruleByType(program, 2);
  const item = ruleByType(program, 3);
  return (
    amount(program?.type) === 1 &&
    amount(program?.growthCalculateType) === 0 &&
    Array.isArray(program?.growthPaymentRuleList) &&
    program.growthPaymentRuleList.length === 0 &&
    program?.degradeForewarning === false &&
    String(program?.scheduledTime) === "0000" &&
    amount(program?.amountOfConsumptionTimes) === 0 &&
    program?.growthEarnRules?.length === 4 &&
    purchase?.enabled === true &&
    amount(purchase?.growth) === 1 &&
    order?.enabled === false &&
    amount(order?.amount) === 1 &&
    recharge?.enabled === false &&
    amount(recharge?.amount) === 0 &&
    item?.enabled === false
  );
}

export function levelProgramMatchesTarget(program) {
  const purchase = ruleByType(program, 0);
  return matchesCommon(program) && amount(purchase?.amount) === 100;
}

export function assertSafeLevelProgramBaseline(
  program,
  { levelProgramId, cardProgramId },
) {
  const ids = identity(program);
  if (
    ids.id !== String(levelProgramId) ||
    ids.cardProgramId !== String(cardProgramId)
  ) {
    throw new Error("Level program identity mismatch; refusing mutation.");
  }
  const purchase = ruleByType(program, 0);
  if (!matchesCommon(program) || amount(purchase?.amount) !== 1) {
    throw new Error("Level program baseline drift; refusing mutation.");
  }
}

function payload(program, purchaseAmount) {
  return {
    id: String(program.id),
    type: 1,
    degradeForewarning: false,
    scheduledTime: "0000",
    growth_2: null,
    growthPaymentRuleList: [],
    amountOfConsumptionTimes: 0,
    growthEarnRules: [
      { type: 0, amount: String(purchaseAmount), growth: 1, enabled: true },
      { type: 1, amount: 1, growth: null, enabled: false },
      { type: 2, amount: 0, growth: null, enabled: false },
      { type: 3, enabled: false },
    ],
  };
}

export function buildLevelProgramTarget(program) {
  identity(program);
  return payload(program, 100);
}

export function buildLevelProgramRollback(program) {
  identity(program);
  return payload(program, 1);
}

export function summarizeLevelProgram(program) {
  const purchase = ruleByType(program, 0);
  return {
    purchaseAmountMyr: amount(purchase?.amount) / 100,
    growthAwarded: amount(purchase?.growth),
    purchaseRuleEnabled: purchase?.enabled === true,
  };
}
