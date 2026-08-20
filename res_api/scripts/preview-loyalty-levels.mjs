#!/usr/bin/env node

import "dotenv/config";
import postgres from "postgres";

import {
  fetchCrmList,
  fetchReportRowsByDateChunks,
  openAuthedPage,
} from "../lib/report-client.js";
import {
  buildLevelTransitionPreview,
  buildTierPreview,
  isActiveProgramCard,
  qualifyingActualPaid,
  resolveOrderMember,
} from "../lib/loyalty-levels.js";

const DEFAULT_CORPORATION_ID = "450020844";
const DEFAULT_ORG_PATH = "/1000833/1000835/900846";
const DEFAULT_SHOP_ID = "406994127";
const DEFAULT_CARD_PROGRAM_ID = "1991044916737863680";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function usage() {
  return [
    "Usage:",
    "  npm run loyalty:preview -- --from=YYYY-MM-DD --to=YYYY-MM-DD",
    "",
    "Read-only: queries RES and PostgreSQL, prints an aggregate preview, and never updates levels.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = Object.fromEntries(
    argv.map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value ?? true];
    }),
  );
  if (args.help) return { help: true };
  if (!DATE_RE.test(String(args.from || "")) || !DATE_RE.test(String(args.to || ""))) {
    throw new Error("Both --from and --to must use YYYY-MM-DD.");
  }
  if (args.from > args.to) throw new Error("--from must not be after --to.");
  return { from: args.from, to: args.to, help: false };
}

function addSet(index, key, value) {
  if (!key || !value) return;
  const values = index.get(key) || new Set();
  values.add(value);
  index.set(key, values);
}

const number = (value) => Number(value) || 0;
const round = (value) => Math.round(value * 100) / 100;

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

  const sql = postgres(process.env.DATABASE_URL, {
    ssl: "require",
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  });
  let walletRows;
  try {
    walletRows = await sql.begin(async (tx) => {
      await tx`SET TRANSACTION READ ONLY`;
      await tx`SET LOCAL statement_timeout = '45s'`;
      return tx`
        SELECT order_id, card_no, member_id, money_amount, gift_amount, total_amount
        FROM public.pos_member_card_txn
        WHERE business_date BETWEEN ${args.from}::date AND ${args.to}::date
          AND txn_type IN (20, 40)
          AND order_id IS NOT NULL
      `;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }

  const walletByOrder = new Map();
  const historicalCardMembers = new Map();
  const orderMembers = new Map();
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

  const preview = {
    mode: "read-only",
    window: { from: args.from, to: args.to },
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
      walletOrders: walletByOrder.size,
      commonWalletOrders,
      walletOnlyOrders,
      walletOnlyTotal: round(walletOnlyTotal),
      commonWalletMoney: round(commonWalletMoney),
      commonWalletGift: round(commonWalletGift),
      commonWalletTotal: round(commonWalletTotal),
      commonReportActualPaid: round(commonReportActualPaid),
      commonReportNonActualPayment: round(commonReportNonActual),
    },
    tierPreview: buildTierPreview(activeMembers, spendByMember),
    transitionPreview: buildLevelTransitionPreview(activeCards, spendByMember),
  };

  console.log(JSON.stringify(preview, null, 2));
}

main().catch((error) => {
  console.error(`[loyalty-preview] ${error.message || error.constructor?.name || error}`);
  process.exitCode = 1;
});
