import { LOYALTY_LEVELS, tierForSpend } from "./loyalty-levels.js";

const ACTIVE_CARD_STATUS = 10;

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} is not finite.`);
  return number;
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

export function buildCardReconciliationPlan(activeCards, spendByMember) {
  return activeCards.map((card) => {
    const cardId = String(card?.id ?? "").trim();
    const memberId = String(card?.customerId ?? "").trim();
    const currentLevelId = String(
      card?.levelId ?? card?.levelAccount?.levelId ?? "",
    );
    if (!cardId || !memberId) {
      throw new Error("An active card is missing its card or member ID.");
    }
    const target = tierForSpend(spendByMember.get(memberId) || 0);
    const currentGrowth = finiteNumber(
      card?.levelAccount?.growth ?? 0,
      "Current growth",
    );
    const targetGrowth = growthForSpend(spendByMember.get(memberId) || 0);
    return {
      cardId,
      memberId,
      currentLevelId,
      targetLevelId: target.resLevelId,
      currentGrowth,
      targetGrowth,
      growthDelta: targetGrowth - currentGrowth,
      levelChangeNeeded: currentLevelId !== target.resLevelId,
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
