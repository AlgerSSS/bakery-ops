const ACQUISITION_KEYS = [
  "point.acquisition",
  "point.allLevelEarn",
  "point.partProductApply",
  "point.earnMaximumEnabledNoLimit",
];

const TARGET_RULE_KEYS = [
  ...ACQUISITION_KEYS,
  "point.exchange",
  "point.exchangeAmountNeedPoint",
];

const BASELINE_RULE_KEYS = [
  ...ACQUISITION_KEYS,
  "point.clearing",
  "point.clearingDaily",
];

const targetRuleTemplate =
  '<div><div class="points-rules-title">${point.acquisition}</div>' +
  '<div class="points-rules-des">1. ${point.allLevelEarn}</div>' +
  '<div class="points-rules-des">2. ${point.partProductApply}</div>' +
  '<div class="points-rules-des">3. ${point.earnMaximumEnabledNoLimit}</div>' +
  '<div class="points-rules-title">${point.exchange}</div>' +
  '<div class="points-rules-des">1. ${point.exchangeAmountNeedPoint}</div></div>';

const baselineRuleTemplate =
  '<div><div class="points-rules-title">${point.acquisition}</div>' +
  '<div class="points-rules-des">1. ${point.allLevelEarn}</div>' +
  '<div class="points-rules-des">2. ${point.partProductApply}</div>' +
  '<div class="points-rules-des">3. ${point.earnMaximumEnabledNoLimit}</div>' +
  '<div class="points-rules-title">${point.clearing}</div>' +
  '<div class="points-rules-des">1. ${point.clearingDaily}</div></div>';

const amount = (value) => Number(value);
const singleEarnRule = (program) =>
  Array.isArray(program?.earnRuleList) &&
  program.earnRuleList.length === 1 &&
  amount(program.earnRuleList[0]?.consumeAmount) === 100 &&
  amount(program.earnRuleList[0]?.earnPoints) === 1;

function identity(program) {
  if (!program?.id || !program?.cardProgramId) {
    throw new Error("Points program identity is missing.");
  }
  return {
    id: String(program.id),
    cardProgramId: String(program.cardProgramId),
    memberProgramId: program.memberProgramId ?? null,
  };
}

export function assertSafePointsBaseline(
  program,
  { pointsProgramId, cardProgramId },
) {
  const ids = identity(program);
  if (
    ids.id !== String(pointsProgramId) ||
    ids.cardProgramId !== String(cardProgramId)
  ) {
    throw new Error("Points program identity mismatch; refusing mutation.");
  }

  const expected =
    program.earnEnabled === true &&
    singleEarnRule(program) &&
    amount(program.amountType) === 1 &&
    program.exchangeEnabled === false &&
    program.clearingEnabled === true &&
    amount(program.clearingType) === 1 &&
    amount(program.clearingCycle) === 12 &&
    amount(program.clearingCycleType) === 0 &&
    amount(program.applyCardScope) === 0 &&
    amount(program.applyPaymentType) === 1;
  if (!expected) {
    throw new Error("Points program baseline drift; refusing mutation.");
  }
}

function commonPayload(program) {
  return {
    earnEnabled: true,
    description: program.description || "",
    applyCardScope: 0,
    applyItem: program.applyItem ?? null,
    earnMaximumEnabled: false,
    promotionItemEarnEnabled: true,
    applyPaymentType: 1,
    paymentRuleList: [],
    applyPaymentList: [],
    ...identity(program),
    earnRuleList: [{ consumeAmount: "100", earnPoints: 1 }],
    clearingNoticeDays: [],
  };
}

export function buildPointsProgramTarget(program) {
  return {
    ...commonPayload(program),
    exchangeEnabled: true,
    clearingEnabled: false,
    amountType: 2,
    exchangeAmount: "1000",
    exchangePoints: 100,
    exchangeMinimumEnabled: false,
    exchangeMaximumEnabled: false,
    activityTime: {
      dayValidTimeValueList: [],
      weekValidTimeValueList: null,
      monthValidTimeValueList: null,
      periodType: 1,
      availableTimeIntervalType: 0,
      validDate: null,
      exceptRangeList: null,
    },
    exchangeChannel: ["offline"],
    ruleTemplateKeys: { multiLanguageKeys: TARGET_RULE_KEYS },
    ruleTemplate: targetRuleTemplate,
  };
}

export function buildPointsProgramRollback(program) {
  return {
    ...commonPayload(program),
    exchangeEnabled: false,
    clearingEnabled: true,
    amountType: 1,
    clearingType: 1,
    clearingCycle: 12,
    clearingCycleType: 0,
    clearingYears: 1,
    clearingDate: "0101",
    clearingNoticeEnabled: false,
    exchangeAmount: 0,
    activityTime: {
      availableTimeIntervalType: 0,
      dayValidTimeValueList: [],
      periodType: 1,
      hasEmpty: false,
    },
    exchangeMinimumEnabled: false,
    exchangeMaximumEnabled: false,
    ruleTemplateKeys: { multiLanguageKeys: BASELINE_RULE_KEYS },
    ruleTemplate: baselineRuleTemplate,
  };
}

export function pointsProgramMatchesTarget(program) {
  return (
    program?.earnEnabled === true &&
    singleEarnRule(program) &&
    amount(program.amountType) === 2 &&
    program.exchangeEnabled === true &&
    amount(program.exchangeAmount) === 1000 &&
    amount(program.exchangePoints) === 100 &&
    Array.isArray(program.exchangeChannel) &&
    program.exchangeChannel.length === 1 &&
    program.exchangeChannel[0] === "offline" &&
    program.clearingEnabled === false &&
    program.earnMaximumEnabled === false &&
    program.promotionItemEarnEnabled === true &&
    amount(program.applyCardScope) === 0 &&
    amount(program.applyPaymentType) === 1
  );
}

export function summarizePointsProgram(program) {
  const earn = singleEarnRule(program)
    ? "RM1 actual paid = 1 point"
    : "other";
  const amountBasis =
    amount(program?.amountType) === 2
      ? "member_actual_paid"
      : "merchant_actual_receipt";
  const cashRedemption = program?.exchangeEnabled
    ? `${amount(program.exchangePoints)} points = RM${(
        amount(program.exchangeAmount) / 100
      ).toFixed(0)} (${program.exchangeChannel?.includes("offline") ? "POS" : "other"})`
    : "disabled";
  const expiry = program?.clearingEnabled
    ? `rolling_${amount(program.clearingCycle)}_months`
    : "no_automatic_clearing";
  return { earn, amountBasis, cashRedemption, expiry };
}
