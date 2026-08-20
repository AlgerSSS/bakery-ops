export const LOYALTY_LEVELS = Object.freeze([
  Object.freeze({ key: "L1", name: "First Crush", threshold: 0 }),
  Object.freeze({ key: "L2", name: "Sweet Crush", threshold: 250 }),
  Object.freeze({ key: "L3", name: "Hot Crush", threshold: 750 }),
  Object.freeze({ key: "L4", name: "Forever Crush", threshold: 1500 }),
]);

const ACTIVE_CARD_STATUS = 10;

export function isActiveProgramCard(card, programId) {
  return (
    String(card?.cardProgramId ?? "") === String(programId) &&
    Number(card?.status) === ACTIVE_CARD_STATUS
  );
}

function finiteAmount(value, label) {
  if (value === null || value === undefined || value === "") {
    throw new TypeError(`${label} is missing.`);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new TypeError(`${label} is not finite.`);
  return amount;
}

/**
 * RES `Total Sales` is already the member's actual-paid amount after order and
 * payment discounts. Stored-value gift balance is exposed separately as a
 * payment discount, so subtracting it here would double-deduct it.
 */
export function qualifyingActualPaid(row) {
  return finiteAmount(
    row?.M_Order_SUM_totalSales_MultiTaxSys,
    "RES Total Sales",
  );
}

export function tierForSpend(value) {
  const spend = finiteAmount(value, "Qualifying spend");
  for (let index = LOYALTY_LEVELS.length - 1; index >= 0; index -= 1) {
    if (spend >= LOYALTY_LEVELS[index].threshold) return LOYALTY_LEVELS[index];
  }
  return LOYALTY_LEVELS[0];
}

function uniqueActiveMember(index, key, activeMembers) {
  if (!key) return null;
  const candidates = index.get(key);
  if (!candidates || candidates.size !== 1) return null;
  const [candidate] = candidates;
  return activeMembers.has(candidate) ? candidate : null;
}

export function resolveOrderMember({
  cardNo,
  orderId,
  reversalOrderId,
  activeMembers,
  currentCardMembers,
  historicalCardMembers,
  orderMembers,
  attributedMemberByOrder,
}) {
  const current = uniqueActiveMember(currentCardMembers, cardNo, activeMembers);
  if (current) return { memberId: current, method: "current_card" };

  const byOrder = uniqueActiveMember(orderMembers, orderId, activeMembers);
  if (byOrder) return { memberId: byOrder, method: "order_history" };

  const historical = uniqueActiveMember(
    historicalCardMembers,
    cardNo,
    activeMembers,
  );
  if (historical) return { memberId: historical, method: "card_history" };

  const reversal = reversalOrderId
    ? attributedMemberByOrder.get(reversalOrderId)
    : null;
  if (reversal && activeMembers.has(reversal)) {
    return { memberId: reversal, method: "reversal_link" };
  }

  return { memberId: null, method: "unresolved" };
}

export function buildTierPreview(activeMembers, spendByMember) {
  const counts = new Map(LOYALTY_LEVELS.map((level) => [level.key, 0]));
  for (const memberId of activeMembers) {
    const tier = tierForSpend(spendByMember.get(memberId) || 0);
    counts.set(tier.key, counts.get(tier.key) + 1);
  }
  return LOYALTY_LEVELS.map((level) => ({
    tier: `${level.key} ${level.name}`,
    memberCount: counts.get(level.key),
  }));
}
