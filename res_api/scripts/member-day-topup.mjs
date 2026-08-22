#!/usr/bin/env node
//
// 会员日 1.5 倍积分补差。默认只读预演；正式补分需要三重闸门同时满足。
//
//   npm run memberday:preview                      # 只读，算出该补多少，不写
//   npm run memberday:preview -- --business-date=2026-08-26
//   MEMBER_DAY_LIVE_ENABLED=1 MEMBER_DAY_CONFIRM='<确认短语>' node scripts/member-day-topup.mjs --apply
//
// RES 的会员日权益只支持 2–9 的整数倍，1.5 倍配不出来，所以周三 RES 只给 1 倍，
// 这里在次日把差额补上。补分走 /crm/memberPoints/web/points/adjust，
// 该接口"只改资产、不生成累计数据记录"，因此不会污染成长值与等级计算。

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import { exitCodeFor, fetchReportRowsByDateChunks, openAuthedPage } from "../lib/report-client.js";
import {
  MEMBER_DAY,
  POINT_ADJUST_TYPE,
  adjustmentRemark,
  assertBusinessDate,
  assertMemberDay,
  buildTopUpPlan,
  decideCard,
  ledgerKey,
} from "../lib/member-day-points.js";

const CONFIRM_PHRASE = "GRANT MEMBER DAY BONUS POINTS";
const LEDGER_DIR = process.env.MEMBER_DAY_LEDGER_DIR || "/var/lib/hotcrush-member-day";
const ADJUST_PATH = "/crm/memberPoints/web/points/adjust";

function args() {
  const out = { apply: false, businessDate: null };
  for (const raw of process.argv.slice(2)) {
    if (raw === "--apply") { out.apply = true; continue; }
    if (raw === "--help") { out.help = true; continue; }
    const m = /^--business-date=(.+)$/.exec(raw);
    if (m) { out.businessDate = m[1]; continue; }
    throw new Error(`Unknown argument: ${raw}`);
  }
  return out;
}

/** 默认取"昨天"（吉隆坡时区）。cron 在周四凌晨跑，昨天就是周三。 */
function yesterdayInKL() {
  const now = new Date();
  const kl = new Date(now.getTime() + 8 * 3600 * 1000);
  kl.setUTCDate(kl.getUTCDate() - 1);
  return kl.toISOString().slice(0, 10);
}

function ledgerPath(businessDate) {
  return path.join(LEDGER_DIR, `${businessDate.slice(0, 7)}.json`);
}

function readLedger(businessDate) {
  const file = ledgerPath(businessDate);
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("ledger is not an object");
    }
    return parsed;
  } catch (error) {
    // 账本损坏时绝不当成"没记录"继续发分——那等于全量重发。
    throw new Error(`Ledger ${file} is unreadable (${error.message}); refusing to run.`);
  }
}

/** 原子写：先写临时文件再 rename，避免半截 JSON 让下次运行以为没发过。 */
function writeLedger(businessDate, ledger) {
  fs.mkdirSync(LEDGER_DIR, { recursive: true });
  const file = ledgerPath(businessDate);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(ledger, null, 1)}\n`);
  fs.renameSync(tmp, file);
}

async function fetchMemberOrders(session, businessDate, shopId) {
  const result = await fetchReportRowsByDateChunks(session.call, {
    from: businessDate,
    to: businessDate,
    chunkDays: 1,
    buildFilters: (range) => [
      { fieldName: "D_businessDate", filterType: "RANGE", filterValue: range },
      { fieldName: "D_currency", filterType: "EQ", filterValue: ["MYR"] },
      { fieldName: "D_shopId", filterType: "IN", filterValue: [shopId] },
      { fieldName: "D_isMemberConsume", filterType: "IN", filterValue: ["true"] },
    ],
    reportId: "888002",
    selectFields: [
      "D_businessDate", "D_orderId", "D_memberCardNo",
      "M_Order_SUM_totalSales_MultiTaxSys",
    ],
    orderBy: [{ D_orderId: "ASC" }],
    pageSize: 2000,
    label: "member day orders",
    log: () => {},
  });
  const paged = result.chunks.find((chunk) => chunk.pages !== 1);
  if (paged) throw new Error("Order report needed deep pagination; refusing to trust a possibly truncated day.");
  return result.rows.map((row) => ({
    orderId: row.D_orderId,
    cardNo: row.D_memberCardNo,
    actualPaid: row.M_Order_SUM_totalSales_MultiTaxSys,
  }));
}

async function main() {
  const opts = args();
  if (opts.help) {
    console.log("Usage: node scripts/member-day-topup.mjs [--business-date=YYYY-MM-DD] [--apply]");
    return;
  }
  const businessDate = assertMemberDay(assertBusinessDate(opts.businessDate || yesterdayInKL()));
  const live = opts.apply;

  if (live) {
    if (process.env.MEMBER_DAY_LIVE_ENABLED !== "1") {
      throw new Error("Live top-up requires MEMBER_DAY_LIVE_ENABLED=1.");
    }
    if (process.env.MEMBER_DAY_CONFIRM !== CONFIRM_PHRASE) {
      throw new Error(`Live top-up requires MEMBER_DAY_CONFIRM='${CONFIRM_PHRASE}'.`);
    }
  }

  const corporationId = process.env.CRM_CORPORATION_ID || "450020844";
  const shopId = process.env.SHOP_ID || "406994127";

  const session = await openAuthedPage({
    storageState: process.env.RES_STORAGE_STATE || "storageState.json",
    warmupPath: "/card-operation",
    log: () => {},
  });

  let plan;
  try {
    const orders = await fetchMemberOrders(session, businessDate, shopId);
    plan = buildTopUpPlan(orders);

    console.log(`[member-day] business date ${businessDate} (Wednesday), multiplier ${MEMBER_DAY.multiplier}x`);
    console.log(`[member-day] orders=${plan.orderCount} cards=${plan.cardCount} bonus points=${plan.totalPoints}`);
    console.log(`[member-day] skipped: no card=${plan.skippedNoCard}, zero bonus=${plan.skippedZero}`);
    if (plan.overCap.length) {
      console.log(`[member-day] ⚠ ${plan.overCap.length} card(s) exceed the per-card sanity cap:`,
        JSON.stringify(plan.overCap.slice(0, 5)));
    }

    if (!live) {
      console.log("[member-day] preview only — nothing was written to RES.");
      for (const card of plan.cards.slice(0, 10)) {
        console.log(`   ${card.cardNo}  +${card.points} pts  (${card.orders.length} order(s))`);
      }
      if (plan.cards.length > 10) console.log(`   … ${plan.cards.length - 10} more`);
      return;
    }

    if (plan.overCap.length) {
      throw new Error("Refusing live top-up while any card exceeds the per-card cap; review the plan first.");
    }

    const ledger = readLedger(businessDate);
    const halted = [];
    for (const card of plan.cards) {
      const decision = decideCard(ledger[ledgerKey(businessDate, card.cardNo)]);
      if (decision.action === "halt") halted.push({ cardNo: card.cardNo, reason: decision.reason });
    }
    if (halted.length) {
      console.error(`[member-day] ${halted.length} card(s) have unresolved prior claims; refusing to run:`);
      for (const h of halted.slice(0, 10)) console.error(`   ${h.cardNo} -> ${h.reason}`);
      throw new Error("Unresolved ledger claims require manual reconciliation.");
    }

    let applied = 0, skipped = 0, failed = 0;
    for (const card of plan.cards) {
      const key = ledgerKey(businessDate, card.cardNo);
      const decision = decideCard(ledger[key]);
      if (decision.action === "skip") { skipped += 1; continue; }

      // 先记 claimed 再调用：调用成功但进程挂掉时，账本停在 claimed，
      // 下一次运行会 halt 要求人工核对，而不是重复送分。
      ledger[key] = { state: "claimed", points: card.points, orders: card.orders.length, at: new Date().toISOString() };
      writeLedger(businessDate, ledger);

      const res = await session.call(ADJUST_PATH, {
        cardNo: card.cardNo,
        points: card.points,
        type: POINT_ADJUST_TYPE.increase,
        corporationId,
        shopId,
        remark: adjustmentRemark(businessDate, card.orders.length),
      });
      if (res?.body?.code === "000") {
        ledger[key] = { ...ledger[key], state: "applied", at: new Date().toISOString() };
        applied += 1;
      } else {
        ledger[key] = { ...ledger[key], state: "failed", error: `${res?.body?.code} ${res?.body?.msg}`.slice(0, 200), at: new Date().toISOString() };
        failed += 1;
      }
      writeLedger(businessDate, ledger);
    }
    console.log(`[member-day] applied=${applied} skipped=${skipped} failed=${failed}`);
    if (failed) process.exitCode = 4;
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error(`[member-day] ${error.message}`);
  process.exitCode = exitCodeFor(error) || 1;
});
