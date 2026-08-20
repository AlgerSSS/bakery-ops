import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLevelTransitionPreview,
  buildTierPreview,
  effectiveCardLevelId,
  isActiveProgramCard,
  qualifyingActualPaid,
  resolveOrderMember,
  tierForSpend,
} from "../lib/loyalty-levels.js";

test("only active cards in the configured RES program enter the level population", () => {
  assert.equal(
    isActiveProgramCard(
      { cardProgramId: "program-a", status: 10 },
      "program-a",
    ),
    true,
  );
  assert.equal(
    isActiveProgramCard(
      { cardProgramId: "program-a", status: 40 },
      "program-a",
    ),
    false,
  );
  assert.equal(
    isActiveProgramCard(
      { cardProgramId: "program-b", status: 10 },
      "program-a",
    ),
    false,
  );
});

test("qualifying actual paid uses RES Total Sales without double-deducting payment discounts", () => {
  assert.equal(
    qualifyingActualPaid({
      M_Order_SUM_totalSales_MultiTaxSys: "100.00",
      M_Order_SUM_paymentPromotionAmount: "20.00",
    }),
    100,
  );
});

test("qualifying actual paid preserves refunds", () => {
  assert.equal(
    qualifyingActualPaid({ M_Order_SUM_totalSales_MultiTaxSys: "-18.50" }),
    -18.5,
  );
});

test("level thresholds are inclusive and match See You Often", () => {
  assert.equal(tierForSpend(0).key, "L1");
  assert.equal(tierForSpend(249.99).key, "L1");
  assert.equal(tierForSpend(250).key, "L2");
  assert.equal(tierForSpend(749.99).key, "L2");
  assert.equal(tierForSpend(750).key, "L3");
  assert.equal(tierForSpend(1499.99).key, "L3");
  assert.equal(tierForSpend(1500).key, "L4");
});

test("blank or zero RES default-level projections resolve to L1", () => {
  assert.equal(
    effectiveCardLevelId({ levelId: "0", levelAccount: { levelId: "" } }),
    "1998685858403844100",
  );
  assert.equal(
    effectiveCardLevelId({
      levelId: "",
      levelAccount: { levelId: "2090027041029333000" },
    }),
    "2090027041029333000",
  );
  assert.equal(
    effectiveCardLevelId({ levelId: "legacy", levelAccount: { levelId: "x" } }),
    "legacy|x",
  );
});

test("order attribution prefers the current card map", () => {
  const result = resolveOrderMember({
    cardNo: "card-a",
    orderId: "order-a",
    reversalOrderId: "",
    activeMembers: new Set(["member-a"]),
    currentCardMembers: new Map([["card-a", new Set(["member-a"])]]),
    historicalCardMembers: new Map(),
    orderMembers: new Map(),
    attributedMemberByOrder: new Map(),
  });
  assert.deepEqual(result, { memberId: "member-a", method: "current_card" });
});

test("order attribution safely falls back through history and reversal links", () => {
  const base = {
    cardNo: "retired-card",
    orderId: "refund-order",
    reversalOrderId: "original-order",
    activeMembers: new Set(["member-a"]),
    currentCardMembers: new Map(),
    historicalCardMembers: new Map([["retired-card", new Set(["member-a"])]]),
    orderMembers: new Map(),
    attributedMemberByOrder: new Map([["original-order", "member-a"]]),
  };

  assert.deepEqual(resolveOrderMember(base), {
    memberId: "member-a",
    method: "card_history",
  });
  assert.deepEqual(
    resolveOrderMember({
      ...base,
      historicalCardMembers: new Map(),
    }),
    { memberId: "member-a", method: "reversal_link" },
  );
});

test("ambiguous cards remain unresolved instead of guessing", () => {
  const result = resolveOrderMember({
    cardNo: "duplicate-card",
    orderId: "order-a",
    reversalOrderId: "",
    activeMembers: new Set(["member-a", "member-b"]),
    currentCardMembers: new Map([
      ["duplicate-card", new Set(["member-a", "member-b"])],
    ]),
    historicalCardMembers: new Map(),
    orderMembers: new Map(),
    attributedMemberByOrder: new Map(),
  });
  assert.deepEqual(result, { memberId: null, method: "unresolved" });
});

test("tier preview includes active members without spend", () => {
  const preview = buildTierPreview(
    new Set(["a", "b", "c", "d", "e"]),
    new Map([
      ["b", 250],
      ["c", 750],
      ["d", 1500],
      ["e", 1500.01],
    ]),
  );
  assert.deepEqual(preview, [
    { tier: "L1 First Crush", memberCount: 1 },
    { tier: "L2 Sweet Crush", memberCount: 1 },
    { tier: "L3 Hot Crush", memberCount: 1 },
    { tier: "L4 Forever Crush", memberCount: 2 },
  ]);
});

test("transition preview compares every active card with its member target", () => {
  const preview = buildLevelTransitionPreview(
    [
      {
        customerId: "a",
        levelId: "1998685858403844100",
        levelName: "VIP1",
      },
      {
        customerId: "a",
        levelId: "2090027041029333000",
        levelName: "Lv2 心动会员 Sweet Crush",
      },
      {
        customerId: "b",
        levelId: "2090027043797577737",
        levelName: "Lv3 热爱会员 Hot Crush",
      },
      {
        customerId: "c",
        levelId: "unexpected",
        levelName: "Legacy",
      },
      {
        customerId: "d",
        levelId: "0",
        levelAccount: { levelId: "" },
      },
    ],
    new Map([
      ["a", 250],
      ["b", 750],
      ["c", 1500],
    ]),
  );

  assert.deepEqual(
    {
      changedCards: preview.changedCards,
      unchangedCards: preview.unchangedCards,
      changedMembers: preview.changedMembers,
      unchangedMembers: preview.unchangedMembers,
      unknownCurrentLevelCards: preview.unknownCurrentLevelCards,
      membersWithMultipleActiveCards: preview.membersWithMultipleActiveCards,
      membersWithConflictingCurrentLevels:
        preview.membersWithConflictingCurrentLevels,
    },
    {
      changedCards: 2,
      unchangedCards: 3,
      changedMembers: 2,
      unchangedMembers: 2,
      unknownCurrentLevelCards: 1,
      membersWithMultipleActiveCards: 1,
      membersWithConflictingCurrentLevels: 1,
    },
  );
  assert.deepEqual(preview.matrix, [
    { from: "L1 First Crush", to: "L1 First Crush", cardCount: 1 },
    { from: "L1 First Crush", to: "L2 Sweet Crush", cardCount: 1 },
    { from: "L2 Sweet Crush", to: "L2 Sweet Crush", cardCount: 1 },
    { from: "L3 Hot Crush", to: "L3 Hot Crush", cardCount: 1 },
    { from: "unknown:Legacy", to: "L4 Forever Crush", cardCount: 1 },
  ]);
});
