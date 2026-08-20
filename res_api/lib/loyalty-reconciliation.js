import { LOYALTY_LEVELS, tierForSpend } from "./loyalty-levels.js";

const ACTIVE_CARD_STATUS = 10;
export const FIRST_ROLLING_DOWNGRADE_DATE = "2026-11-01";
export const DEFAULT_LOYALTY_HISTORY_START_DATE = "2025-11-19";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const levelIndexById = new Map(
  LOYALTY_LEVELS.map((level, index) => [level.resLevelId, index]),
);
const levelIndexByName = new Map(
  LOYALTY_LEVELS.flatMap((level, index) => [
    [level.resName, index],
    [level.name, index],
  ]),
);

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} is not finite.`);
  return number;
}

function plainDate(value, label) {
  const text = String(value ?? "");
  if (!DATE_RE.test(text)) throw new TypeError(`${label} must use YYYY-MM-DD.`);
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`${label} is not a valid calendar date.`);
  }
  return date;
}

function formatPlainDate(date) {
  return date.toISOString().slice(0, 10);
}

function shiftNaturalMonths(value, months) {
  const source = plainDate(value, "Date");
  const targetMonthIndex = source.getUTCMonth() + months;
  const targetYear = source.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(targetYear, targetMonth, Math.min(source.getUTCDate(), lastDay)),
  );
}

function shiftPlainDays(value, days) {
  const date = plainDate(value, "Date");
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function rollingWindowForDate(
  asOfDate,
  { historyStartDate = DEFAULT_LOYALTY_HISTORY_START_DATE } = {},
) {
  const asOf = plainDate(asOfDate, "asOfDate");
  const historyStart = plainDate(historyStartDate, "historyStartDate");
  const naturalStart = shiftNaturalMonths(asOfDate, -12);
  const from = naturalStart > historyStart ? naturalStart : historyStart;
  const to = new Date(asOf);
  to.setUTCDate(to.getUTCDate() - 1);
  if (from > to) {
    throw new Error("The rolling loyalty window has no completed business day.");
  }
  return { from: formatPlainDate(from), to: formatPlainDate(to) };
}

export function birthdayMonthFromValue(value) {
  const text = String(value ?? "").trim();
  const match = /^(?:\d{4})-(\d{2})-(?:\d{2})/.exec(text);
  if (!match) return null;
  const month = Number(match[1]);
  return month >= 1 && month <= 12 ? month : null;
}

export function downgradeRecalculationDateForNotice(
  asOfDate,
  { noticeDays = 7 } = {},
) {
  if (!Number.isInteger(noticeDays) || noticeDays < 1) {
    throw new TypeError("noticeDays must be a positive integer.");
  }
  const target = shiftPlainDays(asOfDate, noticeDays);
  const targetText = formatPlainDate(target);
  if (
    target.getUTCDate() !== 1 ||
    targetText < FIRST_ROLLING_DOWNGRADE_DATE
  ) {
    return null;
  }
  return targetText;
}

export function assertManualDowngradeLevelConfiguration(levels) {
  const levelById = new Map(
    levels.map((level) => [String(level?.id ?? ""), level]),
  );
  for (const [index, configured] of LOYALTY_LEVELS.entries()) {
    const live = levelById.get(configured.resLevelId);
    if (!live) {
      throw new Error(`RES ${configured.key} configuration is missing.`);
    }
    if (live.degradeEnabled !== false) {
      throw new Error(
        `RES ${configured.key} native downgrade must stay disabled for the rolling policy.`,
      );
    }
    const expectedUpgradeEnabled = index > 0;
    if (
      live.upgradeEnabled !== expectedUpgradeEnabled ||
      Number(live.upgradeGrowth ?? 0) !== configured.threshold
    ) {
      throw new Error(
        `RES ${configured.key} upgrade threshold drifted from the audited rolling policy.`,
      );
    }
  }
}

function effectiveLevelPolicy({
  currentLevelId,
  spendTargetLevelId,
  asOfDate,
  birthdayMonth,
  alreadyDowngradedThisMonth,
}) {
  const asOf = plainDate(asOfDate, "asOfDate");
  const currentIndex = levelIndexById.get(String(currentLevelId));
  const spendTargetIndex = levelIndexById.get(String(spendTargetLevelId));
  if (currentIndex === undefined || spendTargetIndex === undefined) {
    return {
      targetLevelId: String(currentLevelId),
      policyAction: "hold_unknown_level",
    };
  }
  if (spendTargetIndex > currentIndex) {
    return {
      targetLevelId: LOYALTY_LEVELS[spendTargetIndex].resLevelId,
      policyAction: "upgrade",
    };
  }
  if (spendTargetIndex === currentIndex) {
    return {
      targetLevelId: LOYALTY_LEVELS[currentIndex].resLevelId,
      policyAction: "aligned",
    };
  }

  const hold = (policyAction) => ({
    targetLevelId: LOYALTY_LEVELS[currentIndex].resLevelId,
    policyAction,
  });
  const asOfText = formatPlainDate(asOf);
  if (asOfText < FIRST_ROLLING_DOWNGRADE_DATE) {
    return hold("hold_before_first_downgrade");
  }
  if (asOf.getUTCDate() !== 1) {
    return hold("hold_outside_monthly_recalculation");
  }
  if (!Number.isInteger(birthdayMonth)) {
    return hold("hold_missing_birthday");
  }
  if (birthdayMonth === asOf.getUTCMonth() + 1) {
    return hold("hold_birthday_month");
  }
  if (alreadyDowngradedThisMonth) {
    return hold("hold_already_downgraded_this_month");
  }
  return {
    targetLevelId:
      LOYALTY_LEVELS[Math.max(spendTargetIndex, currentIndex - 1)].resLevelId,
    policyAction: "downgrade_one_level",
  };
}

function levelIndexFromOperationName(value) {
  const name = String(value ?? "").trim();
  if (levelIndexByName.has(name)) return levelIndexByName.get(name);
  return LOYALTY_LEVELS.findIndex(
    (level) => name.includes(level.key) && name.includes(level.name),
  );
}

export function levelOperationDirection(record) {
  if (Number(record?.operationType) !== 2) return "not_level_change";
  const before = levelIndexFromOperationName(
    record?.operationContent?.levelNameBefore,
  );
  const after = levelIndexFromOperationName(
    record?.operationContent?.levelNameAfter,
  );
  if (before < 0 || after < 0) return "unknown";
  if (after < before) return "downgrade";
  if (after > before) return "upgrade";
  return "same";
}

export function growthForSpend(value) {
  const spend = finiteNumber(value, "Qualifying spend");
  const cents = Math.round(spend * 100);
  return Math.max(0, Math.floor(cents / 100));
}

export function createReferenceIdFactory({
  clock = () => new Date(),
  timeZone = "Asia/Kuala_Lumpur",
} = {}) {
  const counters = new Map();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  return () => {
    const values = Object.fromEntries(
      formatter
        .formatToParts(clock())
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    const timestamp = [
      values.year,
      values.month,
      values.day,
      values.hour,
      values.minute,
      values.second,
    ].join("");
    if (!/^\d{14}$/.test(timestamp)) {
      throw new Error("Could not construct a 14-digit RES reference timestamp.");
    }
    const sequence = counters.get(timestamp) ?? 1000;
    if (sequence > 9999) {
      throw new Error("RES reference ID capacity exceeded for one second.");
    }
    counters.set(timestamp, sequence + 1);
    return `${timestamp}${sequence}`;
  };
}

export function buildCardReconciliationPlan(
  activeCards,
  spendByMember,
  {
    asOfDate,
    birthdayMonthByMember = new Map(),
    downgradedCardNosThisMonth = new Set(),
  } = {},
) {
  plainDate(asOfDate, "asOfDate");
  return activeCards.map((card) => {
    const cardId = String(card?.id ?? "").trim();
    const cardNo = String(card?.cardNo ?? "").trim();
    const memberId = String(card?.customerId ?? "").trim();
    const currentLevelId = String(
      card?.levelId ?? card?.levelAccount?.levelId ?? "",
    );
    if (!cardId || !cardNo || !memberId) {
      throw new Error(
        "An active card is missing its card number, card ID, or member ID.",
      );
    }
    const qualifyingSpend = spendByMember.get(memberId) || 0;
    const spendTarget = tierForSpend(qualifyingSpend);
    const policy = effectiveLevelPolicy({
      currentLevelId,
      spendTargetLevelId: spendTarget.resLevelId,
      asOfDate,
      birthdayMonth: birthdayMonthByMember.get(memberId) ?? null,
      alreadyDowngradedThisMonth: downgradedCardNosThisMonth.has(cardNo),
    });
    const currentGrowth = finiteNumber(
      card?.levelAccount?.growth ?? 0,
      "Current growth",
    );
    const targetGrowth = growthForSpend(qualifyingSpend);
    const currentLevelIndex = levelIndexById.get(currentLevelId);
    const spendTargetLevelIndex = levelIndexById.get(spendTarget.resLevelId);
    const spendDirection =
      currentLevelIndex === undefined || spendTargetLevelIndex === undefined
        ? "unknown"
        : spendTargetLevelIndex > currentLevelIndex
          ? "upgrade"
          : spendTargetLevelIndex < currentLevelIndex
            ? "downgrade"
            : "aligned";
    return {
      cardId,
      cardNo,
      memberId,
      currentLevelId,
      spendTargetLevelId: spendTarget.resLevelId,
      spendDirection,
      targetLevelId: policy.targetLevelId,
      policyAction: policy.policyAction,
      keepLevelGap:
        currentLevelIndex === undefined
          ? null
          : Math.max(
              0,
              LOYALTY_LEVELS[currentLevelIndex].threshold - qualifyingSpend,
            ),
      currentGrowth,
      targetGrowth,
      growthDelta: targetGrowth - currentGrowth,
      levelChangeNeeded: currentLevelId !== policy.targetLevelId,
    };
  });
}

export function summarizeCardReconciliation(plans) {
  const summary = {
    cards: plans.length,
    cardsNeedingAnyChange: 0,
    cardsNeedingGrowthIncrease: 0,
    cardsNeedingGrowthDecrease: 0,
    cardsNeedingLevelChange: 0,
    cardsEligibleForUpgrade: 0,
    cardsEligibleForOneLevelDowngrade: 0,
    cardsWithHeldDowngrade: 0,
    cardsWithUnrestorableLevelBaseline: 0,
    totalGrowthIncrease: 0,
    totalGrowthDecrease: 0,
  };
  for (const plan of plans) {
    if (plan.growthDelta !== 0 || plan.levelChangeNeeded) {
      summary.cardsNeedingAnyChange += 1;
    }
    if (plan.growthDelta > 0) {
      summary.cardsNeedingGrowthIncrease += 1;
      summary.totalGrowthIncrease += plan.growthDelta;
    } else if (plan.growthDelta < 0) {
      summary.cardsNeedingGrowthDecrease += 1;
      summary.totalGrowthDecrease += Math.abs(plan.growthDelta);
    }
    if (plan.levelChangeNeeded) summary.cardsNeedingLevelChange += 1;
    if (plan.policyAction === "upgrade") summary.cardsEligibleForUpgrade += 1;
    if (plan.policyAction === "downgrade_one_level") {
      summary.cardsEligibleForOneLevelDowngrade += 1;
    }
    if (
      plan.spendDirection === "downgrade" &&
      String(plan.policyAction).startsWith("hold_")
    ) {
      summary.cardsWithHeldDowngrade += 1;
    }
    if (!cardPlanHasRestorableLevel(plan)) {
      summary.cardsWithUnrestorableLevelBaseline += 1;
    }
  }
  return summary;
}

export function cardPlanHasRestorableLevel(plan) {
  return LOYALTY_LEVELS.some(
    (level) => level.resLevelId === String(plan.currentLevelId),
  );
}

function isUnassignedLevelId(value) {
  const levelId = String(value ?? "").trim();
  return levelId === "" || levelId === "0";
}

export function isSafeUnassignedL1AssignmentPlan(plan) {
  return (
    isUnassignedLevelId(plan?.currentLevelId) &&
    String(plan?.spendTargetLevelId ?? "") === LOYALTY_LEVELS[0].resLevelId &&
    plan?.policyAction === "hold_unknown_level" &&
    Number(plan?.targetGrowth) >= 0 &&
    Number(plan?.targetGrowth) < LOYALTY_LEVELS[1].threshold
  );
}

export function assertUnassignedL1AssignmentBaseline(
  card,
  plan,
  cardProgramId,
) {
  if (!isSafeUnassignedL1AssignmentPlan(plan)) {
    throw new Error(
      "Only an unassigned card whose rolling-spend target is L1 may use the one-way L1 assignment action.",
    );
  }
  const current = {
    cardId: String(card?.id ?? ""),
    cardNo: String(card?.cardNo ?? ""),
    memberId: String(card?.customerId ?? ""),
    cardProgramId: String(card?.cardProgramId ?? ""),
    status: Number(card?.status),
    unassignedLevel:
      isUnassignedLevelId(card?.levelId) &&
      isUnassignedLevelId(card?.levelAccount?.levelId),
    growth: finiteNumber(card?.levelAccount?.growth ?? 0, "Current growth"),
  };
  const expected = {
    cardId: String(plan.cardId),
    cardNo: String(plan.cardNo),
    memberId: String(plan.memberId),
    cardProgramId: String(cardProgramId),
    status: ACTIVE_CARD_STATUS,
    unassignedLevel: true,
    growth: Number(plan.currentGrowth),
  };
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error(
      "Unassigned card changed after the reconciliation snapshot; refusing mutation.",
    );
  }
}

export function assertCardMatchesPlanBaseline(card, plan, cardProgramId) {
  if (!cardPlanHasRestorableLevel(plan)) {
    throw new Error(
      "Card level baseline cannot be restored safely; refusing mutation.",
    );
  }
  const current = {
    cardId: String(card?.id ?? ""),
    memberId: String(card?.customerId ?? ""),
    cardProgramId: String(card?.cardProgramId ?? ""),
    status: Number(card?.status),
    levelId: String(card?.levelId ?? card?.levelAccount?.levelId ?? ""),
    growth: finiteNumber(card?.levelAccount?.growth ?? 0, "Current growth"),
  };
  const expected = {
    cardId: String(plan.cardId),
    memberId: String(plan.memberId),
    cardProgramId: String(cardProgramId),
    status: ACTIVE_CARD_STATUS,
    levelId: String(plan.currentLevelId),
    growth: Number(plan.currentGrowth),
  };
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error("Card changed after the reconciliation snapshot; refusing mutation.");
  }
}

export function cardMatchesReconciliationTarget(card, plan) {
  return (
    String(card?.id ?? "") === String(plan.cardId) &&
    String(card?.customerId ?? "") === String(plan.memberId) &&
    Number(card?.status) === ACTIVE_CARD_STATUS &&
    String(card?.levelId ?? card?.levelAccount?.levelId ?? "") ===
      String(plan.targetLevelId) &&
    finiteNumber(card?.levelAccount?.growth ?? 0, "Current growth") ===
      Number(plan.targetGrowth)
  );
}

export function buildGrowthAdjustmentPayload(
  card,
  delta,
  { shopId, orgPath, referenceId, remark },
) {
  const value = finiteNumber(delta, "Growth delta");
  if (!Number.isInteger(value) || value === 0) {
    throw new Error("Growth delta must be a non-zero integer.");
  }
  const increase = value > 0;
  return {
    shopId: String(shopId),
    adjustType: increase ? "1" : "2",
    growth: Math.abs(value),
    remark,
    cardId: String(card.id),
    sourceType: 2010,
    corporationId: String(card.corporationId),
    orgPath,
    changeType: increase ? "1201" : "1202",
    referenceId,
  };
}

export function buildLevelChangePayload(
  card,
  targetLevelId,
  { ownerOrgId, ownerOrgType, orgPath },
) {
  const payload = {
    levelId: String(targetLevelId),
    expirationTime: card?.noExpiration ? "" : card?.expirationTime || "",
    cardId: String(card.id),
    ownerOrgId: String(ownerOrgId),
    ownerOrgType: String(ownerOrgType),
    sourceType: 2010,
    orgPath,
    changeTypeList: ["2"],
    virtualOrg: { type: 1001 },
  };
  if (card?.virtualOrg?.groupId) {
    payload.virtualOrg.groupId = String(card.virtualOrg.groupId);
  }
  return payload;
}
