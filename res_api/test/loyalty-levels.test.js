import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTierPreview,
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
