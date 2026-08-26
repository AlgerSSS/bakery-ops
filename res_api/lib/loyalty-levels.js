export const LOYALTY_LEVELS = Object.freeze([
  Object.freeze({
    key: "L1",
    name: "Fluffy Crush",
    resName: "Lv1 软绵会员 Fluffy Crush",
    resLevelId: "1998685858403844100",
    threshold: 0,
  }),
  Object.freeze({
    key: "L2",
    name: "Toasty Crush",
    resName: "Lv2 暖香会员 Toasty Crush",
    resLevelId: "2090027041029333000",
    threshold: 250,
  }),
  Object.freeze({
    key: "L3",
    name: "Gooey Crush",
    resName: "Lv3 流心会员 Gooey Crush",
    resLevelId: "2090027043797577737",
    threshold: 750,
  }),
  Object.freeze({
    key: "L4",
    name: "Golden Crush",
    resName: "Lv4 黄金会员 Golden Crush",
    resLevelId: "2090027045185888261",
    threshold: 1500,
  }),
  Object.freeze({
    key: "L5",
    name: "Diamond Crush",
    resName: "Lv5 挚爱会员 Diamond Crush",
    resLevelId: "2092524707546116100",
    threshold: 3000,
  }),
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

const levelById = new Map(
  LOYALTY_LEVELS.map((level) => [level.resLevelId, level]),
);

function isUnassignedLevelId(value) {
  const levelId = String(value ?? "").trim();
  return levelId === "" || levelId === "0";
}

export function effectiveCardLevelId(card) {
  const candidates = [card?.levelId, card?.levelAccount?.levelId].map((value) =>
    String(value ?? "").trim(),
  );
  const meaningful = candidates.filter((value) => !isUnassignedLevelId(value));
  if (meaningful.length === 0) return LOYALTY_LEVELS[0].resLevelId;
  if (meaningful.every((value) => value === meaningful[0])) return meaningful[0];
  return meaningful.join("|");
}

function currentLevelLabel(card) {
  const levelId = effectiveCardLevelId(card);
  const configured = levelById.get(levelId);
  if (configured) return `${configured.key} ${configured.name}`;
  const rawName = String(card?.levelName ?? card?.levelAccount?.levelName ?? "").trim();
  return rawName ? `unknown:${rawName}` : "unknown:<blank>";
}

export function buildLevelTransitionPreview(activeCards, spendByMember) {
  const transitions = new Map();
  const memberCards = new Map();
  let changedCards = 0;
  let unknownCurrentLevelCards = 0;

  for (const card of activeCards) {
    const memberId = String(card?.customerId ?? "").trim();
    if (!memberId) throw new Error("An active card is missing its member ID.");
    const currentLevelId = effectiveCardLevelId(card);
    const current = currentLevelLabel(card);
    const target = tierForSpend(spendByMember.get(memberId) || 0);
    const targetLabel = `${target.key} ${target.name}`;
    const key = JSON.stringify([current, targetLabel]);
    transitions.set(key, (transitions.get(key) || 0) + 1);
    if (!levelById.has(currentLevelId)) unknownCurrentLevelCards += 1;
    if (currentLevelId !== target.resLevelId) changedCards += 1;

    const cards = memberCards.get(memberId) || [];
    cards.push({ currentLevelId, targetLevelId: target.resLevelId });
    memberCards.set(memberId, cards);
  }

  let changedMembers = 0;
  let membersWithMultipleActiveCards = 0;
  let membersWithConflictingCurrentLevels = 0;
  for (const cards of memberCards.values()) {
    if (cards.length > 1) membersWithMultipleActiveCards += 1;
    if (new Set(cards.map((card) => card.currentLevelId)).size > 1) {
      membersWithConflictingCurrentLevels += 1;
    }
    if (cards.some((card) => card.currentLevelId !== card.targetLevelId)) {
      changedMembers += 1;
    }
  }

  return {
    changedCards,
    unchangedCards: activeCards.length - changedCards,
    changedMembers,
    unchangedMembers: memberCards.size - changedMembers,
    unknownCurrentLevelCards,
    membersWithMultipleActiveCards,
    membersWithConflictingCurrentLevels,
    matrix: [...transitions.entries()]
      .map(([key, cardCount]) => {
        const [from, to] = JSON.parse(key);
        return { from, to, cardCount };
      })
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  };
}
