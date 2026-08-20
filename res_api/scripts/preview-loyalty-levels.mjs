#!/usr/bin/env node

import "dotenv/config";
import postgres from "postgres";

import {
  assertOk,
  exitCodeFor,
  fetchCrmList,
  fetchReportRowsByDateChunks,
  openAuthedPage,
} from "../lib/report-client.js";
import {
  buildLevelTransitionPreview,
  buildTierPreview,
  isActiveProgramCard,
  LOYALTY_LEVELS,
  qualifyingActualPaid,
  resolveOrderMember,
} from "../lib/loyalty-levels.js";
import {
  assertCardMatchesPlanBaseline,
  assertManualDowngradeLevelConfiguration,
  assertUnassignedL1AssignmentBaseline,
  buildCardReconciliationPlan,
  buildGrowthAdjustmentPayload,
  buildLevelChangePayload,
  birthdayMonthFromValue,
  cardPlanHasRestorableLevel,
  cardMatchesReconciliationTarget,
  createReferenceIdFactory,
  downgradeRecalculationDateForNotice,
  isSafeUnassignedL1AssignmentPlan,
  levelOperationDirection,
  rollingWindowForDate,
  summarizeCardReconciliation,
} from "../lib/loyalty-reconciliation.js";

const DEFAULT_CORPORATION_ID = "450020844";
const DEFAULT_ORG_PATH = "/1000833/1000835/900846";
const DEFAULT_SHOP_ID = "406994127";
const DEFAULT_CARD_PROGRAM_ID = "1991044916737863680";
const DEFAULT_OWNER_ORG_ID = "1991027325256417283";
const DEFAULT_OWNER_ORG_TYPE = "7";
const DEFAULT_MEMBER_STORE = "吉隆坡Pavilion门店";
const CONFIRMATION = "SEE_YOU_OFTEN_LEVELS_V1";
const ASSIGN_L1_CONFIRMATION = "SEE_YOU_OFTEN_ASSIGN_L1_V1";
const CARD_DETAILS_PATH = "/crm/datamanage/card/details";
const ADJUST_GROWTH_PATH = "/crm/memberCard/web/card/adjustGrowth";
const MODIFY_CARD_PATH = "/crm/memberCard/web/card/modifyCard";
const CARD_OPERATION_LOG_PATH = "/crm/datamanage/card/queryCardOperationLog";
const LEVEL_DETAILS_PATH = "/crm/memberSystem/web/levelProgram/level/details";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const APPLY_ACTIONS = new Set([
  "aligned-growth",
  "upgrade",
  "held-downgrade-growth",
  "downgrade",
  "assign-l1",
]);

function usage() {
  return [
    "Usage:",
    "  npm run loyalty:preview -- --as-of=YYYY-MM-DD",
    `  npm run loyalty:reconcile -- --as-of=YYYY-MM-DD --apply --action=aligned-growth --limit=1 --confirm=${CONFIRMATION}`,
    `  npm run loyalty:reconcile -- --as-of=YYYY-MM-DD --apply --action=assign-l1 --limit=1 --confirm=${ASSIGN_L1_CONFIRMATION}`,
    "",
    "Default mode is read-only. Apply mode requires the exact confirmation",
    "phrase. --as-of calculates the completed rolling window ending the day",
    "before that date. Upgrades are immediate; downgrades are monthly, one level",
    "at a time, never during the member birthday month, and start in 2026-11.",
  ].join("\n");
}

function parseArgs(argv) {
  const known = new Set([
    "from",
    "to",
    "as-of",
    "apply",
    "confirm",
    "limit",
    "action",
    "help",
  ]);
  const args = Object.fromEntries(
    argv.map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value ?? true];
    }),
  );
  const unknown = Object.keys(args).find((key) => !known.has(key));
  if (unknown) throw new Error(`Unknown argument: --${unknown}`);
  if (args.help) return { help: true };
  if (!DATE_RE.test(String(args["as-of"] || ""))) {
    throw new Error("--as-of must use YYYY-MM-DD.");
  }
  const rollingWindow = rollingWindowForDate(args["as-of"], {
    historyStartDate:
      process.env.LOYALTY_HISTORY_START_DATE || "2025-11-19",
  });
  const explicitWindow = args.from !== undefined || args.to !== undefined;
  if (explicitWindow) {
    if (!DATE_RE.test(String(args.from || "")) || !DATE_RE.test(String(args.to || ""))) {
      throw new Error("Both --from and --to must use YYYY-MM-DD.");
    }
    if (args.from > args.to) throw new Error("--from must not be after --to.");
  }
  const from = explicitWindow ? args.from : rollingWindow.from;
  const to = explicitWindow ? args.to : rollingWindow.to;
  const apply = args.apply === true;
  if (apply && args.action === undefined) {
    throw new Error("Apply mode requires an explicit --action.");
  }
  if (
    apply &&
    (from !== rollingWindow.from || to !== rollingWindow.to)
  ) {
    throw new Error("Apply mode requires the exact rolling window for --as-of.");
  }
  const limit = args.limit === undefined ? null : Number(args.limit);
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }
  const action = apply ? String(args.action) : "preview-only";
  if (apply && !APPLY_ACTIONS.has(action)) {
    throw new Error(`--action must be one of: ${[...APPLY_ACTIONS].join(", ")}.`);
  }
  const expectedConfirmation =
    action === "assign-l1" ? ASSIGN_L1_CONFIRMATION : CONFIRMATION;
  if (apply && args.confirm !== expectedConfirmation) {
    throw new Error("Apply mode requires the exact confirmation phrase.");
  }
  return {
    from,
    to,
    asOfDate: args["as-of"],
    rollingWindow,
    explicitWindow,
    apply,
    limit,
    action,
    help: false,
  };
}

function addSet(index, key, value) {
  if (!key || !value) return;
  const values = index.get(key) || new Set();
  values.add(value);
  index.set(key, values);
}

const number = (value) => Number(value) || 0;
const round = (value) => Math.round(value * 100) / 100;

const referenceId = createReferenceIdFactory();

async function fetchCardDetails(session, cardId, corporationId) {
  return assertOk(
    await session.call(CARD_DETAILS_PATH, { corporationId, cardId }),
    "card details",
  ).data;
}

async function queryLevelOperationLogs(session, cardNo, context) {
  const records = [];
  const pageSize = 200;
  for (let pageNo = 1; pageNo <= 50; pageNo += 1) {
    const data = assertOk(
      await session.call(CARD_OPERATION_LOG_PATH, {
        page: { pageNo, pageSize },
        ownerOrgType: String(context.ownerOrgType),
        ownerOrgId: String(context.ownerOrgId),
        operationTypeList: [2],
        orgPath: context.orgPath,
      }),
      "card level operation log",
    ).data;
    const pageRecords = data?.list || [];
    records.push(
      ...pageRecords.filter(
        (record) => String(record?.cardNo ?? "") === String(cardNo),
      ),
    );
    const total = Number(data?.page?.total ?? pageRecords.length);
    if (pageNo * pageSize >= total || pageRecords.length === 0) return records;
  }
  throw new Error(
    "RES level operation log exceeds 10,000 rows; refusing an incomplete idempotency check.",
  );
}

async function fetchLevelAutomationConfiguration(session) {
  const levels = [];
  for (const configured of LOYALTY_LEVELS) {
    levels.push(
      assertOk(
        await session.call(LEVEL_DETAILS_PATH, { id: configured.resLevelId }),
        `${configured.key} level details`,
      ).data,
    );
  }
  return levels;
}

function operationLogBlocksMonthlyDowngrade(record, asOfDate) {
  if (String(record?.createTime ?? "").slice(0, 7) !== asOfDate.slice(0, 7)) {
    return false;
  }
  const direction = levelOperationDirection(record);
  return direction === "downgrade" || direction === "unknown";
}

async function alreadyDowngradedThisMonth(session, plan, context) {
  const records = await queryLevelOperationLogs(session, plan.cardNo, context);
  return records.some((record) =>
    operationLogBlocksMonthlyDowngrade(record, context.asOfDate),
  );
}

function planMatchesApplyAction(plan, action) {
  if (action === "assign-l1") {
    return isSafeUnassignedL1AssignmentPlan(plan);
  }
  if (action === "aligned-growth") {
    return plan.policyAction === "aligned" && plan.growthDelta !== 0;
  }
  if (action === "upgrade") return plan.policyAction === "upgrade";
  if (action === "held-downgrade-growth") {
    return (
      String(plan.policyAction).startsWith("hold_") && plan.growthDelta !== 0
    );
  }
  return plan.policyAction === "downgrade_one_level";
}

async function readbackCard(session, cardId, corporationId, predicate) {
  let latest;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    latest = await fetchCardDetails(session, cardId, corporationId);
    if (predicate(latest)) return latest;
    await session.page.waitForTimeout(500);
  }
  return latest;
}

function cardMatchesOriginal(card, original) {
  return (
    String(card?.id ?? "") === String(original.id) &&
    String(card?.customerId ?? "") === String(original.customerId) &&
    Number(card?.status) === Number(original.status) &&
    String(card?.levelId ?? card?.levelAccount?.levelId ?? "") ===
      String(original.levelId ?? original.levelAccount?.levelId ?? "") &&
    Number(card?.levelAccount?.growth ?? 0) ===
      Number(original.levelAccount?.growth ?? 0)
  );
}

async function adjustGrowth(session, card, delta, context, remark) {
  if (!delta) return;
  assertOk(
    await session.call(
      ADJUST_GROWTH_PATH,
      buildGrowthAdjustmentPayload(card, delta, {
        shopId: context.shopId,
        orgPath: context.orgPath,
        referenceId: referenceId(),
        remark,
      }),
    ),
    "adjust card growth",
  );
}

async function changeLevel(session, card, targetLevelId, context) {
  assertOk(
    await session.call(
      MODIFY_CARD_PATH,
      buildLevelChangePayload(card, targetLevelId, {
        ownerOrgId: context.ownerOrgId,
        ownerOrgType: context.ownerOrgType,
        orgPath: context.orgPath,
      }),
    ),
    "change card level",
  );
}

async function restoreCard(session, original, context, remark) {
  let latest = await fetchCardDetails(
    session,
    original.id,
    original.corporationId,
  );
  const growthDelta =
    Number(original.levelAccount?.growth ?? 0) -
    Number(latest.levelAccount?.growth ?? 0);
  if (growthDelta) {
    await adjustGrowth(
      session,
      latest,
      growthDelta,
      context,
      `${remark} rollback`,
    );
    latest = await readbackCard(
      session,
      original.id,
      original.corporationId,
      (card) =>
        Number(card?.levelAccount?.growth ?? 0) ===
        Number(original.levelAccount?.growth ?? 0),
    );
  }

  const originalLevelId = String(
    original.levelId ?? original.levelAccount?.levelId ?? "",
  );
  const latestLevelId = String(
    latest?.levelId ?? latest?.levelAccount?.levelId ?? "",
  );
  if (latestLevelId !== originalLevelId) {
    const knownLevel = LOYALTY_LEVELS.some(
      (level) => level.resLevelId === originalLevelId,
    );
    if (!knownLevel) {
      throw new Error("The original card level cannot be restored safely.");
    }
    await changeLevel(session, latest, originalLevelId, context);
  }

  const restored = await readbackCard(
    session,
    original.id,
    original.corporationId,
    (card) => cardMatchesOriginal(card, original),
  );
  if (!cardMatchesOriginal(restored, original)) {
    throw new Error("Card rollback could not be verified.");
  }
}

async function applyReconciliation(plans, context) {
  const actionable = plans.filter(
    (plan) =>
      (context.action === "assign-l1" ||
        plan.growthDelta !== 0 ||
        plan.levelChangeNeeded) &&
      planMatchesApplyAction(plan, context.action),
  );
  const oneWayL1Assignment = context.action === "assign-l1";
  const skippedUnknownLevelCards = oneWayL1Assignment
    ? 0
    : actionable.filter((plan) => !cardPlanHasRestorableLevel(plan)).length;
  const selected = actionable
    .filter((plan) =>
      oneWayL1Assignment
        ? isSafeUnassignedL1AssignmentPlan(plan)
        : cardPlanHasRestorableLevel(plan),
    )
    .sort(
      (a, b) =>
        Number(a.levelChangeNeeded) - Number(b.levelChangeNeeded) ||
        Math.abs(a.growthDelta) - Math.abs(b.growthDelta),
    );
  const batch =
    context.limit === null ? selected : selected.slice(0, context.limit);
  const session = await openAuthedPage({
    storageState: context.storageState,
    warmupPath: "/card-management",
    log: () => {},
  });
  let completed = 0;
  let growthAdjustments = 0;
  let directLevelChanges = 0;
  let monthlyDowngradesPrevented = 0;
  try {
    const levelConfiguration = await fetchLevelAutomationConfiguration(session);
    assertManualDowngradeLevelConfiguration(levelConfiguration);
    for (const plan of batch) {
      const original = await fetchCardDetails(
        session,
        plan.cardId,
        context.corporationId,
      );
      if (oneWayL1Assignment) {
        assertUnassignedL1AssignmentBaseline(
          original,
          plan,
          context.cardProgramId,
        );
      } else {
        assertCardMatchesPlanBaseline(original, plan, context.cardProgramId);
      }
      const downgradeAlreadyApplied =
        plan.policyAction === "downgrade_one_level" &&
        (await alreadyDowngradedThisMonth(session, plan, context));
      const effectivePlan = oneWayL1Assignment
        ? {
            ...plan,
            targetLevelId: LOYALTY_LEVELS[0].resLevelId,
            levelChangeNeeded: true,
            policyAction: "assign_unassigned_l1",
          }
        : downgradeAlreadyApplied
          ? {
            ...plan,
            targetLevelId: plan.currentLevelId,
            levelChangeNeeded: false,
            policyAction: "hold_already_downgraded_this_month",
          }
          : plan;
      if (downgradeAlreadyApplied) monthlyDowngradesPrevented += 1;
      let mutated = false;
      try {
        let latest = original;
        if (oneWayL1Assignment) {
          await changeLevel(
            session,
            original,
            effectivePlan.targetLevelId,
            context,
          );
          mutated = true;
          directLevelChanges += 1;
          latest = await readbackCard(
            session,
            plan.cardId,
            context.corporationId,
            (card) =>
              String(card?.levelId ?? card?.levelAccount?.levelId ?? "") ===
              effectivePlan.targetLevelId,
          );
          if (
            String(latest?.levelId ?? latest?.levelAccount?.levelId ?? "") !==
            effectivePlan.targetLevelId
          ) {
            throw new Error("One-way L1 assignment readback did not match L1.");
          }
        }
        if (effectivePlan.growthDelta) {
          await adjustGrowth(
            session,
            latest,
            effectivePlan.growthDelta,
            context,
            context.remark,
          );
          mutated = true;
          growthAdjustments += 1;
        }
        latest = await readbackCard(
          session,
          plan.cardId,
          context.corporationId,
          (card) =>
            Number(card?.levelAccount?.growth ?? 0) ===
            effectivePlan.targetGrowth,
        );
        if (
          Number(latest?.levelAccount?.growth ?? 0) !==
          effectivePlan.targetGrowth
        ) {
          throw new Error("Growth adjustment readback did not match the target.");
        }
        const latestLevelId = String(
          latest?.levelId ?? latest?.levelAccount?.levelId ?? "",
        );
        if (!oneWayL1Assignment && latestLevelId !== effectivePlan.targetLevelId) {
          await changeLevel(
            session,
            latest,
            effectivePlan.targetLevelId,
            context,
          );
          mutated = true;
          directLevelChanges += 1;
        }
        const finalCard = await readbackCard(
          session,
          plan.cardId,
          context.corporationId,
          (card) => cardMatchesReconciliationTarget(card, effectivePlan),
        );
        if (!cardMatchesReconciliationTarget(finalCard, effectivePlan)) {
          throw new Error("Card reconciliation readback did not match the target.");
        }
        completed += 1;
      } catch (error) {
        if (mutated && oneWayL1Assignment) {
          throw new Error(
            `One-way L1 assignment failed after mutation; the card was not reverted to an unassigned state: ${error.message}`,
          );
        }
        if (mutated) {
          try {
            await restoreCard(session, original, context, context.remark);
          } catch (rollbackError) {
            throw new Error(
              `Card reconciliation failed and rollback could not be verified: ${rollbackError.message}`,
            );
          }
        }
        throw error;
      }
    }
  } finally {
    await session.close();
  }
  return {
    selectedCards: batch.length,
    completedCards: completed,
    growthAdjustments,
    directLevelChanges,
    monthlyDowngradesPrevented,
    remainingCards: selected.length - batch.length,
    partial: batch.length !== selected.length,
    skippedUnknownLevelCards,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

  const corporationId = process.env.CRM_CORPORATION_ID || DEFAULT_CORPORATION_ID;
  const orgPath = process.env.CRM_ORG_PATH || DEFAULT_ORG_PATH;
  const shopId = process.env.SHOP_ID || DEFAULT_SHOP_ID;
  const cardProgramId =
    process.env.LOYALTY_CARD_PROGRAM_ID || DEFAULT_CARD_PROGRAM_ID;
  const storageState = process.env.RES_STORAGE_STATE || "storageState.json";
  const ownerOrgId = process.env.CRM_OWNER_ORG_ID || DEFAULT_OWNER_ORG_ID;
  const ownerOrgType =
    process.env.CRM_OWNER_ORG_TYPE || DEFAULT_OWNER_ORG_TYPE;
  const memberStore = process.env.MEMBER_STORE || DEFAULT_MEMBER_STORE;

  const session = await openAuthedPage({
    storageState,
    warmupPath: "/report/report-sales-orders",
    log: () => {},
  });

  let orderResult;
  let cardResult;
  try {
    orderResult = await fetchReportRowsByDateChunks(session.call, {
      from: args.from,
      to: args.to,
      chunkDays: 14,
      buildFilters: (range) => [
        {
          fieldName: "D_businessDate",
          filterType: "RANGE",
          filterValue: range,
        },
        { fieldName: "D_currency", filterType: "EQ", filterValue: ["MYR"] },
        { fieldName: "D_shopId", filterType: "IN", filterValue: [shopId] },
        {
          fieldName: "D_isMemberConsume",
          filterType: "IN",
          filterValue: ["true"],
        },
      ],
      reportId: "888002",
      selectFields: [
        "D_businessDate",
        "D_orderId",
        "D_relationReversalOrderId",
        "D_memberCardNo",
        "D_isMemberConsume",
        "M_Order_SUM_totalSales_MultiTaxSys",
        "M_Order_SUM_totalPromotionAmount",
        "M_Order_SUM_paymentPromotionAmount",
      ],
      orderBy: [{ D_businessDate: "ASC" }, { D_orderId: "ASC" }],
      pageSize: 2000,
      label: "loyalty member orders",
      log: (message) => console.error(message),
    });
    const pagedChunk = orderResult.chunks.find((chunk) => chunk.pages !== 1);
    if (pagedChunk) {
      throw new Error(
        `A loyalty report chunk required deep pagination (${pagedChunk.range.join("..")}): reduce the chunk size before trusting the preview.`,
      );
    }

    cardResult = await fetchCrmList(
      session.call,
      "/crm/datamanage/card/page",
      { corporationId, orgPath },
      {
        pageSize: 500,
        maxPages: 60,
        label: "loyalty card population",
        log: (message) => console.error(message),
      },
    );
  } finally {
    await session.close();
  }

  const activeCards = cardResult.items.filter((card) =>
    isActiveProgramCard(card, cardProgramId),
  );
  const activeMembers = new Set();
  const currentCardMembers = new Map();
  let malformedActiveCards = 0;
  for (const card of activeCards) {
    const cardNo = String(card.cardNo ?? "").trim();
    const memberId = String(card.customerId ?? "").trim();
    if (!cardNo || !memberId) {
      malformedActiveCards += 1;
      continue;
    }
    activeMembers.add(memberId);
    addSet(currentCardMembers, cardNo, memberId);
  }
  if (malformedActiveCards) {
    throw new Error(`${malformedActiveCards} active RES cards lack a card or member ID.`);
  }

  const walletByOrder = new Map();
  const historicalCardMembers = new Map();
  const orderMembers = new Map();
  const seenOrders = new Map();
  const attributedMemberByOrder = new Map();
  const spendByMember = new Map();
  const attributionMethods = new Map();
  const pending = [];
  let totalActualPaid = 0;
  let totalOrderDiscount = 0;
  let totalNonActualPayment = 0;
  let negativeOrders = 0;

  const recordAttribution = (orderId, memberId, method, actualPaid) => {
    attributedMemberByOrder.set(orderId, memberId);
    spendByMember.set(memberId, (spendByMember.get(memberId) || 0) + actualPaid);
    attributionMethods.set(method, (attributionMethods.get(method) || 0) + 1);
  };

  for (const row of orderResult.rows) {
    const orderId = String(row.D_orderId ?? "").trim();
    const cardNo = String(row.D_memberCardNo ?? "").trim();
    const reversalOrderId = String(row.D_relationReversalOrderId ?? "").trim();
    const actualPaid = qualifyingActualPaid(row);
    const signature = JSON.stringify([
      String(row.D_businessDate ?? "").slice(0, 10),
      cardNo,
      reversalOrderId,
      actualPaid,
      number(row.M_Order_SUM_totalPromotionAmount),
      number(row.M_Order_SUM_paymentPromotionAmount),
    ]);
    if (!orderId) throw new Error("A RES member order has a blank order ID.");
    if (seenOrders.has(orderId)) {
      const conflict = seenOrders.get(orderId) !== signature;
      throw new Error(
        `RES returned a duplicate order while previewing levels${conflict ? " with conflicting values" : ""}.`,
      );
    }
    seenOrders.set(orderId, signature);

    totalActualPaid += actualPaid;
    totalOrderDiscount += number(row.M_Order_SUM_totalPromotionAmount);
    totalNonActualPayment += number(row.M_Order_SUM_paymentPromotionAmount);
    if (actualPaid < -0.01) negativeOrders += 1;

    const attribution = resolveOrderMember({
      cardNo,
      orderId,
      reversalOrderId,
      activeMembers,
      currentCardMembers,
      historicalCardMembers,
      orderMembers,
      attributedMemberByOrder,
    });
    if (attribution.memberId) {
      recordAttribution(
        orderId,
        attribution.memberId,
        attribution.method,
        actualPaid,
      );
    } else {
      pending.push({ orderId, cardNo, reversalOrderId, actualPaid });
    }
  }

  const pendingOrderIds = [...new Set(pending.map((order) => order.orderId))];
  const pendingCardNos = [
    ...new Set(pending.map((order) => order.cardNo).filter(Boolean)),
  ];
  console.error(
    `[loyalty-preview] ${pending.length} orders require historical wallet attribution`,
  );
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: "require",
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  });
  let walletRows = [];
  let walletAggregate;
  try {
    ({ walletRows, walletAggregate } = await sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      await tx`SET LOCAL statement_timeout = '120s'`;
      const [aggregate] = await tx`
        SELECT
          count(DISTINCT order_id)::integer AS wallet_orders,
          COALESCE(sum(money_amount), 0)::double precision AS money,
          COALESCE(sum(gift_amount), 0)::double precision AS gift,
          COALESCE(sum(total_amount), 0)::double precision AS total
        FROM public.pos_member_card_txn
        WHERE store = ${memberStore}
          AND business_date BETWEEN ${args.from}::date AND ${args.to}::date
          AND txn_type IN (20, 40)
          AND order_id IS NOT NULL
      `;
      let rows = [];
      if (pendingOrderIds.length && pendingCardNos.length) {
        rows = await tx`
          SELECT order_id, card_no, member_id, money_amount, gift_amount, total_amount
          FROM public.pos_member_card_txn
          WHERE store = ${memberStore}
            AND business_date BETWEEN ${args.from}::date AND ${args.to}::date
            AND txn_type IN (20, 40)
            AND order_id IS NOT NULL
            AND (
              order_id IN ${tx(pendingOrderIds)}
              OR card_no IN ${tx(pendingCardNos)}
            )
        `;
      } else if (pendingOrderIds.length) {
        rows = await tx`
          SELECT order_id, card_no, member_id, money_amount, gift_amount, total_amount
          FROM public.pos_member_card_txn
          WHERE store = ${memberStore}
            AND business_date BETWEEN ${args.from}::date AND ${args.to}::date
            AND txn_type IN (20, 40)
            AND order_id IN ${tx(pendingOrderIds)}
        `;
      }
      return { walletRows: rows, walletAggregate: aggregate };
    }));
  } finally {
    await sql.end({ timeout: 5 });
  }

  for (const row of walletRows) {
    const orderId = String(row.order_id);
    const wallet = walletByOrder.get(orderId) || {
      money: 0,
      gift: 0,
      total: 0,
    };
    wallet.money += number(row.money_amount);
    wallet.gift += number(row.gift_amount);
    wallet.total += number(row.total_amount);
    walletByOrder.set(orderId, wallet);
    addSet(
      historicalCardMembers,
      String(row.card_no ?? "").trim(),
      String(row.member_id ?? "").trim(),
    );
    addSet(orderMembers, orderId, String(row.member_id ?? "").trim());
  }

  const unresolved = [];
  for (const order of pending) {
    const attribution = resolveOrderMember({
      ...order,
      activeMembers,
      currentCardMembers,
      historicalCardMembers,
      orderMembers,
      attributedMemberByOrder,
    });
    if (attribution.memberId) {
      recordAttribution(
        order.orderId,
        attribution.memberId,
        attribution.method,
        order.actualPaid,
      );
    } else {
      unresolved.push(order);
    }
  }

  const unresolvedActualPaid = unresolved.reduce(
    (sum, order) => sum + order.actualPaid,
    0,
  );
  if (Math.abs(unresolvedActualPaid) > 0.01) {
    throw new Error(
      `${unresolved.length} orders with RM ${round(unresolvedActualPaid)} actual paid cannot be uniquely attributed; refusing to produce a level preview.`,
    );
  }

  let commonWalletOrders = 0;
  let commonWalletMoney = 0;
  let commonWalletGift = 0;
  let commonWalletTotal = 0;
  let commonReportActualPaid = 0;
  let commonReportNonActual = 0;
  let walletOnlyOrders = 0;
  let walletOnlyTotal = 0;
  for (const [orderId, wallet] of walletByOrder) {
    const signature = seenOrders.get(orderId);
    if (!signature) {
      walletOnlyOrders += 1;
      walletOnlyTotal += wallet.total;
      continue;
    }
    const [, , , actualPaid, , nonActual] = JSON.parse(signature);
    commonWalletOrders += 1;
    commonWalletMoney += wallet.money;
    commonWalletGift += wallet.gift;
    commonWalletTotal += wallet.total;
    commonReportActualPaid += actualPaid;
    commonReportNonActual += nonActual;
  }
  if (commonReportNonActual + 0.01 < commonWalletGift) {
    throw new Error(
      "RES payment-discount totals do not cover stored-value gift consumption; the actual-paid interpretation is unsafe.",
    );
  }
  if (totalNonActualPayment + 0.01 < number(walletAggregate?.gift)) {
    throw new Error(
      "Full-window RES payment discounts do not cover stored-value gift consumption; the actual-paid interpretation is unsafe.",
    );
  }

  const noticeRecalculationDate = downgradeRecalculationDateForNotice(
    args.asOfDate,
  );
  const preliminaryPlans = buildCardReconciliationPlan(
    activeCards,
    spendByMember,
    { asOfDate: args.asOfDate },
  );
  const monthlyDowngradeCandidates = preliminaryPlans.filter(
    (plan) => plan.policyAction === "hold_missing_birthday",
  );
  const preliminaryNoticePlans = noticeRecalculationDate
    ? buildCardReconciliationPlan(activeCards, spendByMember, {
        asOfDate: noticeRecalculationDate,
      })
    : [];
  const noticeCandidates = preliminaryNoticePlans.filter(
    (plan) => plan.policyAction === "hold_missing_birthday",
  );
  const policyDetailCandidates = new Map(
    [...monthlyDowngradeCandidates, ...noticeCandidates].map((plan) => [
      plan.cardId,
      plan,
    ]),
  );
  const birthdayMonthByMember = new Map();
  const downgradedCardNosThisMonth = new Set();
  if (policyDetailCandidates.size) {
    const policySession = await openAuthedPage({
      storageState,
      warmupPath: "/card-management",
      log: () => {},
    });
    try {
      for (const plan of policyDetailCandidates.values()) {
        if (!birthdayMonthByMember.has(plan.memberId)) {
          const detail = await fetchCardDetails(
            policySession,
            plan.cardId,
            corporationId,
          );
          birthdayMonthByMember.set(
            plan.memberId,
            birthdayMonthFromValue(detail?.customer?.birthday),
          );
        }
        if (
          monthlyDowngradeCandidates.some(
            (candidate) => candidate.cardId === plan.cardId,
          ) &&
          (await alreadyDowngradedThisMonth(policySession, plan, {
            ownerOrgId,
            ownerOrgType,
            orgPath,
            asOfDate: args.asOfDate,
          }))
        ) {
          downgradedCardNosThisMonth.add(plan.cardNo);
        }
      }
    } finally {
      await policySession.close();
    }
  }
  const reconciliationPlans = buildCardReconciliationPlan(
    activeCards,
    spendByMember,
    {
      asOfDate: args.asOfDate,
      birthdayMonthByMember,
      downgradedCardNosThisMonth,
    },
  );
  const downgradeNoticePlans = noticeRecalculationDate
    ? buildCardReconciliationPlan(activeCards, spendByMember, {
        asOfDate: noticeRecalculationDate,
        birthdayMonthByMember,
      })
    : [];
  const downgradeNoticePreview = noticeRecalculationDate
    ? summarizeCardReconciliation(downgradeNoticePlans)
    : null;
  const preview = {
    mode: args.apply ? "apply" : "read-only",
    policyAsOfDate: args.asOfDate,
    window: {
      from: args.from,
      to: args.to,
      exactRollingWindow: args.rollingWindow,
      isExactRollingWindow:
        args.from === args.rollingWindow.from &&
        args.to === args.rollingWindow.to,
    },
    source: {
      reportChunks: orderResult.chunks.length,
      memberOrders: orderResult.rows.length,
      distinctOrders: seenOrders.size,
      cardsReturned: cardResult.items.length,
      activeProgramCards: activeCards.length,
      activeMembers: activeMembers.size,
      ambiguousCurrentCardNumbers: [...currentCardMembers.values()].filter(
        (members) => members.size !== 1,
      ).length,
    },
    attribution: {
      membersWithSpend: spendByMember.size,
      methods: Object.fromEntries(
        [...attributionMethods.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
      unresolvedZeroValueOrders: unresolved.length,
      unresolvedActualPaid: round(unresolvedActualPaid),
    },
    totals: {
      qualifyingActualPaid: round(totalActualPaid),
      orderDiscount: round(totalOrderDiscount),
      nonActualPayment: round(totalNonActualPayment),
      negativeOrders,
    },
    walletCrossCheck: {
      walletOrders: Number(walletAggregate?.wallet_orders ?? 0),
      attributionRowsQueried: walletRows.length,
      attributionWalletOrders: walletByOrder.size,
      commonWalletOrders,
      walletOnlyOrders,
      walletOnlyTotal: round(walletOnlyTotal),
      fullWalletMoney: round(number(walletAggregate?.money)),
      fullWalletGift: round(number(walletAggregate?.gift)),
      fullWalletTotal: round(number(walletAggregate?.total)),
      queriedCommonWalletMoney: round(commonWalletMoney),
      queriedCommonWalletGift: round(commonWalletGift),
      queriedCommonWalletTotal: round(commonWalletTotal),
      commonReportActualPaid: round(commonReportActualPaid),
      commonReportNonActualPayment: round(commonReportNonActual),
    },
    tierPreview: buildTierPreview(activeMembers, spendByMember),
    spendTargetTransitionPreview: buildLevelTransitionPreview(
      activeCards,
      spendByMember,
    ),
    reconciliationPreview: summarizeCardReconciliation(
      reconciliationPlans,
    ),
    downgradeNoticePreview: {
      noticeDue: Boolean(noticeRecalculationDate),
      targetRecalculationDate: noticeRecalculationDate,
      delivery: "preview-only; RES SMS launch remains separately gated",
      eligibleCards:
        downgradeNoticePreview?.cardsEligibleForOneLevelDowngrade ?? 0,
      birthdayMonthHolds:
        downgradeNoticePlans.filter(
          (plan) => plan.policyAction === "hold_birthday_month",
        ).length,
      missingBirthdayHolds:
        downgradeNoticePlans.filter(
          (plan) => plan.policyAction === "hold_missing_birthday",
        ).length,
    },
  };

  if (args.apply) {
    preview.applyResult = await applyReconciliation(reconciliationPlans, {
      corporationId,
      cardProgramId,
      shopId,
      orgPath,
      ownerOrgId,
      ownerOrgType,
      storageState,
      limit: args.limit,
      action: args.action,
      asOfDate: args.asOfDate,
      remark: `See You Often rolling 12m ${args.from}..${args.to}`,
    });
  }

  console.log(JSON.stringify(preview, null, 2));
}

main().catch((error) => {
  console.error(`[loyalty-preview] ${error.message || error.constructor?.name || error}`);
  process.exitCode = exitCodeFor(error);
});
