// 会员卡流水与日汇总：全程走已有权限的报表引擎（比 /crm 私有接口稳）。
//   ① reportId=100150「Customer Transaction Detail」行级流水
//   ② reportId=100242「会员卡值交易变动表」按 D_date 分组的当日净额
//   ③ reportId=100242 **累计区间** [ORIGIN, D] 的期末余额锚点
// -> output/member/flows.json -> pos_member_card_txn + pos_member_daily（写库在 sync-to-db.js）。
//
// 【100242 的 begin/end 是子集口径 —— 最容易踩的坑】
//   按天查出来的 endOfPeriodSubTotal 只覆盖「该区间内有过交易的卡」（2026-07-15 那行只有 7,642.90），
//   不是全量余额；但把区间放成 [2024-01-01, D] 查出来的就是精确的全量期末余额
//   （实测 2026-07-25 endOfPeriodSubTotal=391,572.41 与 /crm queryCustomerSummary 一分不差）。
//   changeOfPeriod（当日净额）在日粒度是**正确**的，只有 begin/end 是子集口径。
//   -> 本脚本只对窗口最新一天做一次累计调用当锚点，更早的日子用恒等式
//      balance_end(D-1) = balance_end(D) - net_face(D) 反推，并对窗口起点再做一次累计调用交叉校验。
//      两者对不上（> 0.01）说明 POS 改了语义，直接 exit 1，不写半截数据。
//
// 【金额单位】报表引擎返回的是带小数点的**元**字符串（"1300.00" = RM 1,300.00），不除 100。
//   （/crm 私有接口才是整数分 —— 见 scrape-member-snapshot.mjs。）
//
// 【交易类型（实机全量只有 6 个码，D_tradeType 与 D_memberTransactionType 恒等）】
//   10 充值 / 20 消费核销 / 30 充值退款 / 40 消费退款 / 50 调增 / 60 调减。没有 transfer、没有 expire。
//   面值净额恒等式（实测精确成立）：+10 +30 +50 +60 −20 −40 = 期末总余额变动。
//
// 【PII】100150 行含 D_customerName / D_customerPhone / D_customerEmail / D_orderRemark / D_operator，
//   一律不 select、并由 pii-guard 的白名单投影 + assertNoPii 双重把关。手机号只从 /crm 进 pos_member。
//
// 用法：
//   node scrape-member-flows.mjs                     滚动窗口（默认 45 天）
//   node scrape-member-flows.mjs --from=2024-01-01   首次上线的全量回填（约 14,386 行）
//
// 退出码：0 成功 / 2 会话失效 / 3 查询失败 / 1 其它（含勾稽不过）。

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SHOP_ID,
  PosQueryError,
  exitCodeFor,
  fetchReportRows,
  fetchReportRowsByDateChunks,
  openAuthedPage,
} from './lib/report-client.js';
import { TXN_FIELD_ALLOWLIST, assertNoPii, project } from './lib/pii-guard.js';
import { businessDateToLocalMidnight, refreshBusinessDate } from './lib/business-date.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

const SHOP_ID = process.env.SHOP_ID || DEFAULT_SHOP_ID;
// D_shopId='0' = 未归店/线上（1111 个只在卡上的持卡人的卡就是这个归属），不能漏。
const SHOP_FILTER = ['0', SHOP_ID];
const ORIGIN = process.env.MEMBER_ORIGIN_DATE || '2024-01-01';
const WINDOW_DAYS = Math.max(1, Number(process.env.MEMBER_FLOW_DAYS || 45));
const OUT_DIR = process.env.MEMBER_OUT_DIR || 'output/member';
const OUT_FILE = path.join(OUT_DIR, 'flows.json');
const TOLERANCE = 0.01;

const BUSINESS_DATE = refreshBusinessDate();
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const endDate = args.to || BUSINESS_DATE;
const defaultStart = (() => {
  const d = businessDateToLocalMidnight(endDate);
  d.setDate(d.getDate() - (WINDOW_DAYS - 1));
  return fmt(d);
})();
const startDate = args.from || defaultStart;
const WINDOW = [startDate, endDate];

const TXN_TYPE_LABELS = {
  10: 'topup',
  20: 'redeem',
  30: 'topup_refund',
  40: 'consume_refund',
  50: 'adjust_increase',
  60: 'adjust_decrease',
};
// 面值净额里的符号：进卡为 +，出卡为 −（实测 10+30+50+60−20−40 = 期末余额变动）。
const FACE_SIGN = { 10: 1, 20: -1, 30: 1, 40: -1, 50: 1, 60: 1 };

const num = (v) => (v == null || v === '' ? 0 : Number(v));
const round2 = (v) => +Number(v).toFixed(2);
const str = (v) => (v == null || v === '' ? null : String(v));

const DAILY_METRICS = [
  'M_StoredConsume_Sum_storedMoneyAmount',
  'M_StoredConsume_Sum_storedGiftAmount',
  'M_StoredConsume_Sum_storedSubTotal',
  'M_StoredConsume_Sum_consumeMoneyAmount',
  'M_StoredConsume_Sum_consumeGiftAmount',
  'M_StoredConsume_Sum_consumeSubTotal',
  'M_StoredConsume_Sum_storedRefundSubTotal',
  'M_StoredConsume_Sum_consumeRefundSubTotal',
  'M_StoredConsume_Sum_increaseAmountSubTotal',
  'M_StoredConsume_Sum_decreaseAmountSubTotal',
  'M_StoredConsume_Sum_changeOfPeriodMoneyAmount',
  'M_StoredConsume_Sum_changeOfPeriodGiftAmount',
  'M_StoredConsume_Sum_changeOfPeriodSubTotal',
];
const ANCHOR_METRICS = [
  'M_StoredConsume_Sum_endOfPeriodMoneyAmount',
  'M_StoredConsume_Sum_endOfPeriodGiftAmount',
  'M_StoredConsume_Sum_endOfPeriodSubTotal',
];

const dateFilter = (range) => [
  { fieldName: 'D_date', filterType: 'RANGE', filterValue: range },
  { fieldName: 'D_shopId', filterType: 'IN', filterValue: SHOP_FILTER },
];

/**
 * 累计区间 [ORIGIN, upto] 的全量期末余额锚点。
 * allowEmpty：只有「这个日期之前本来就没有任何流水」才允许 0 行（首次全量回填时
 * 窗口起点 == ORIGIN，那天门店还没开过卡）。其余情况下 0 行一律当查询坏了处理 ——
 * 把「查不到」默认成「余额为 0」会静默地把 39 万余额抹平。
 */
async function fetchBalanceAnchor(call, upto, { allowEmpty = false } = {}) {
  const { rows } = await fetchReportRows(call, {
    reportId: 100242,
    // 只留一个恒定维度，结果就是一行全量合计（不加维度时引擎会拒绝）。
    selectFields: ['D_corporationId', ...ANCHOR_METRICS],
    filters: dateFilter([ORIGIN, upto]),
    pageSize: 500,
    maxPages: 4,
    label: `100242 累计锚点 [${ORIGIN}..${upto}]`,
  });
  const agg = rows.reduce(
    (a, r) => {
      a.money += num(r.M_StoredConsume_Sum_endOfPeriodMoneyAmount);
      a.gift += num(r.M_StoredConsume_Sum_endOfPeriodGiftAmount);
      a.total += num(r.M_StoredConsume_Sum_endOfPeriodSubTotal);
      return a;
    },
    { money: 0, gift: 0, total: 0 }
  );
  if (!rows.length) {
    if (!allowEmpty) {
      throw new PosQueryError(`100242 累计锚点 [${ORIGIN}..${upto}] 返回 0 行 —— 无法确定期末余额`);
    }
    return { upto, money: 0, gift: 0, total: 0, rows: 0, empty: true };
  }
  return { upto, money: round2(agg.money), gift: round2(agg.gift), total: round2(agg.total), rows: rows.length };
}

async function main() {
  const started = Date.now();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[member-flows] business date=${BUSINESS_DATE}；窗口 ${WINDOW.join(' .. ')}；origin=${ORIGIN}`);

  const session = await openAuthedPage({ warmupPath: '/report/report-sales-breakdown' });
  let rawTxns;
  let dailyRows;
  let anchorEnd;
  let anchorStart;
  try {
    // 按月切块拉：报表引擎深翻页会跨页重复 + 等量漏行（实测 8 页拉 14,414 行里有 13 组重复、
    // 7 天的净额对不上 100242），而单块一页拉完完全稳定。详见 lib/report-client.js 的注释。
    rawTxns = await fetchReportRowsByDateChunks(session.call, {
      from: startDate,
      to: endDate,
      chunkDays: Number(process.env.MEMBER_CHUNK_DAYS || 31),
      buildFilters: dateFilter,
      reportId: 100150,
      selectFields: TXN_FIELD_ALLOWLIST,
      orderBy: [{ D_date: 'ASC' }, { D_transSerialNumber: 'ASC' }],
      pageSize: 2000,
      label: '100150 行级流水',
    });

    const dailyRes = await fetchReportRows(session.call, {
      reportId: 100242,
      selectFields: ['D_date', ...DAILY_METRICS],
      filters: dateFilter(WINDOW),
      orderBy: [{ D_date: 'ASC' }],
      pageSize: 1000,
      maxPages: 10,
      label: '100242 日汇总',
    });
    dailyRows = dailyRes.rows;

    anchorEnd = await fetchBalanceAnchor(session.call, endDate);
    // 首次全量回填时窗口起点就是 ORIGIN，那天之前一笔流水都没有 —— 允许锚点为 0 行（余额 0）。
    const noFlowsAtOrBeforeStart = !rawTxns.rows.some((r) => String(r.D_date || '') <= startDate);
    anchorStart = await fetchBalanceAnchor(session.call, startDate, { allowEmpty: noFlowsAtOrBeforeStart });
  } finally {
    await session.close();
  }

  // ---- 行级流水：白名单投影 + 去重 ----
  const seen = new Set();
  let duplicates = 0;
  const unknownTypes = {};
  const txns = [];
  for (const raw of rawTxns.rows) {
    const r = project(raw, TXN_FIELD_ALLOWLIST);
    assertNoPii(r, { context: '100150 行' });
    const serial = str(r.D_transSerialNumber);
    const key = serial || `${r.D_date}|${r.D_orderId}|${r.D_CustomerTrans_transactionTime}|${r.D_memberCardNo}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    const type = String(r.D_memberTransactionType ?? '');
    const label = TXN_TYPE_LABELS[type] || 'unknown';
    if (label === 'unknown') unknownTypes[type] = (unknownTypes[type] || 0) + 1;
    txns.push({
      business_date: str(r.D_date),
      txn_time: str(r.D_CustomerTrans_transactionTime),
      trans_serial_number: serial,
      order_id: str(r.D_orderId),
      pos_order_id: str(r.D_posOrderId),
      card_no: str(r.D_memberCardNo),
      member_id: str(r.D_Member_customerId),
      txn_type: type ? Number(type) : null,
      txn_type_label: label,
      pos_shop_id: str(r.D_shopId),
      source: str(r.D_source),
      card_level: str(r.D_cardLevel),
      currency: str(r.D_currency) || 'MYR',
      // tradeAmount 按类型换语义：充值行=实收现金，消费行=核销总面值，调整行恒为 0。
      // 只有类型 20/40 的 trade_amount 与 daily_payment_breakdown 的会员卡付款对得上。
      trade_amount: round2(num(r.M_Trade_Sum_tradeAmount)),
      money_amount: round2(num(r.M_Trade_Sum_moneyAmount)),
      gift_amount: round2(num(r.M_Trade_Sum_giftAmount)),
      total_amount: round2(num(r.M_Trade_Sum_countAmount)),
      point: num(r.M_Trade_Sum_point),
      before_money_balance: round2(num(r.M_Trade_Sum_beforeMoneyBalance)),
      after_money_balance: round2(num(r.M_Trade_Sum_afterMoneyBalance)),
      before_gift_balance: round2(num(r.M_Trade_Sum_beforeGiftBalance)),
      after_gift_balance: round2(num(r.M_Trade_Sum_afterGiftBalance)),
    });
  }

  // ---- 按业务日聚合行级流水 ----
  const byDate = new Map();
  const blank = (d) => ({
    business_date: d,
    txn_count: 0,
    topup_face: 0,
    topup_cash: 0,
    topup_gift: 0,
    topup_refund: 0,
    redeem: 0,
    consume_refund: 0,
    adjust_net: 0,
    card_payment_net: 0,
    net_stored_value_face_from_txn: 0,
  });
  for (const t of txns) {
    if (!t.business_date) continue;
    const d = byDate.get(t.business_date) || blank(t.business_date);
    d.txn_count += 1;
    const sign = FACE_SIGN[t.txn_type] ?? 0;
    d.net_stored_value_face_from_txn += sign * t.total_amount;
    if (t.txn_type === 10) {
      d.topup_face += t.total_amount;
      d.topup_cash += t.money_amount;
      d.topup_gift += t.gift_amount;
    } else if (t.txn_type === 20) {
      d.redeem += t.total_amount;
      d.card_payment_net += t.trade_amount;
    } else if (t.txn_type === 30) {
      d.topup_refund += t.total_amount;
    } else if (t.txn_type === 40) {
      d.consume_refund += t.total_amount;
      d.card_payment_net += t.trade_amount;
    } else if (t.txn_type === 50 || t.txn_type === 60) {
      d.adjust_net += t.total_amount;
    }
    byDate.set(t.business_date, d);
  }

  // ---- 100242 日汇总 ----
  const dailyByDate = new Map();
  for (const r of dailyRows) {
    const d = str(r.D_date);
    if (!d) continue;
    const cur = dailyByDate.get(d) || {
      stored_money: 0,
      stored_gift: 0,
      stored_total: 0,
      consume_money: 0,
      consume_gift: 0,
      consume_total: 0,
      stored_refund_total: 0,
      consume_refund_total: 0,
      increase_total: 0,
      decrease_total: 0,
      net_cash: 0,
      net_gift: 0,
      net_face: 0,
    };
    cur.stored_money += num(r.M_StoredConsume_Sum_storedMoneyAmount);
    cur.stored_gift += num(r.M_StoredConsume_Sum_storedGiftAmount);
    cur.stored_total += num(r.M_StoredConsume_Sum_storedSubTotal);
    cur.consume_money += num(r.M_StoredConsume_Sum_consumeMoneyAmount);
    cur.consume_gift += num(r.M_StoredConsume_Sum_consumeGiftAmount);
    cur.consume_total += num(r.M_StoredConsume_Sum_consumeSubTotal);
    cur.stored_refund_total += num(r.M_StoredConsume_Sum_storedRefundSubTotal);
    cur.consume_refund_total += num(r.M_StoredConsume_Sum_consumeRefundSubTotal);
    cur.increase_total += num(r.M_StoredConsume_Sum_increaseAmountSubTotal);
    cur.decrease_total += num(r.M_StoredConsume_Sum_decreaseAmountSubTotal);
    cur.net_cash += num(r.M_StoredConsume_Sum_changeOfPeriodMoneyAmount);
    cur.net_gift += num(r.M_StoredConsume_Sum_changeOfPeriodGiftAmount);
    cur.net_face += num(r.M_StoredConsume_Sum_changeOfPeriodSubTotal);
    dailyByDate.set(d, cur);
  }

  // ---- 期末余额：最新一天用真锚点，更早的日子恒等式反推 ----
  const allDates = [];
  for (let d = businessDateToLocalMidnight(startDate); fmt(d) <= endDate; d.setDate(d.getDate() + 1)) {
    allDates.push(fmt(d));
  }
  const balances = new Map();
  let running = { total: anchorEnd.total, money: anchorEnd.money, gift: anchorEnd.gift };
  for (let i = allDates.length - 1; i >= 0; i--) {
    const d = allDates[i];
    balances.set(d, { ...running, source: d === endDate ? 'anchor' : 'derived' });
    const agg = dailyByDate.get(d);
    if (agg) {
      running = {
        total: round2(running.total - agg.net_face),
        money: round2(running.money - agg.net_cash),
        gift: round2(running.gift - agg.net_gift),
      };
    }
  }
  // 循环结束时 running = 窗口起点前一天的期末余额；加回起点当天的净额就应等于 anchorStart。
  const startAgg = dailyByDate.get(startDate);
  const derivedAtStart = balances.get(startDate);

  // ---- 勾稽 ----
  const checks = [];
  const mismatchedDays = [];
  for (const d of new Set([...byDate.keys(), ...dailyByDate.keys()])) {
    const fromTxn = round2(byDate.get(d)?.net_stored_value_face_from_txn || 0);
    const from242 = round2(dailyByDate.get(d)?.net_face || 0);
    if (Math.abs(fromTxn - from242) > TOLERANCE) {
      mismatchedDays.push({ date: d, fromTxn, from242, diff: round2(fromTxn - from242) });
    }
  }
  checks.push({
    name: '100150 按类型聚合的面值净额 == 100242 changeOfPeriodSubTotal（逐日）',
    ok: mismatchedDays.length === 0,
    detail: mismatchedDays.length ? mismatchedDays.slice(0, 10) : `${allDates.length} 天全部一致`,
  });

  const startDiff = round2((derivedAtStart?.total ?? 0) - anchorStart.total);
  checks.push({
    name: anchorStart.empty
      ? '窗口起点（= 建店前）：恒等式反推的期末余额应为 0'
      : '窗口起点：恒等式反推的期末余额 == 累计区间锚点',
    ok: Math.abs(startDiff) <= TOLERANCE,
    detail: { derived: derivedAtStart?.total ?? null, anchor: anchorStart.total, anchorEmpty: !!anchorStart.empty, diff: startDiff },
  });

  if (Object.keys(unknownTypes).length) {
    checks.push({
      name: '交易类型全部落在已知的 6 个码里',
      ok: false,
      detail: unknownTypes,
    });
  }

  const daily = allDates.map((d) => {
    const t = byDate.get(d) || blank(d);
    const a = dailyByDate.get(d);
    const b = balances.get(d);
    return {
      business_date: d,
      txn_count: t.txn_count,
      topup_face: round2(t.topup_face),
      topup_cash: round2(t.topup_cash),
      topup_gift: round2(t.topup_gift),
      topup_refund: round2(t.topup_refund),
      redeem: round2(t.redeem),
      consume_refund: round2(t.consume_refund),
      adjust_net: round2(t.adjust_net),
      // daily_payment_breakdown 的 'Membership card balance'.net_sales 逐日等于这个数
      // （类型 20 的 tradeAmount + 类型 40 的 tradeAmount，即核销净额），不是 redeem 本身。
      card_payment_net: round2(t.card_payment_net),
      net_stored_value_face: round2(a ? a.net_face : t.net_stored_value_face_from_txn),
      // 现金口径，直接取 100242 的 changeOfPeriodMoneyAmount，不由其它列推导。
      net_stored_value_cash: a ? round2(a.net_cash) : 0,
      net_stored_value_gift: a ? round2(a.net_gift) : 0,
      balance_end_total: b?.total ?? null,
      balance_end_money: b?.money ?? null,
      balance_end_gift: b?.gift ?? null,
      balance_end_source: b?.source ?? null,
      has_report_row: !!a,
    };
  });

  const failed = checks.filter((c) => !c.ok);
  const meta = {
    scrapedAt: new Date().toISOString(),
    businessDate: BUSINESS_DATE,
    window: WINDOW,
    origin: ORIGIN,
    amountUnit: 'MYR',
    amountNote: '报表引擎返回的就是元，未做单位换算',
    txnRowsFetched: rawTxns.rows.length,
    txnReportTotal: rawTxns.total,
    txnChunks: rawTxns.chunks?.length ?? 1,
    txnRowsKept: txns.length,
    duplicateSerials: duplicates,
    dailyRows: daily.length,
    unknownTxnTypes: unknownTypes,
    anchors: { end: anchorEnd, start: anchorStart, startDerived: derivedAtStart?.total ?? null },
    startDayNetFace: startAgg ? round2(startAgg.net_face) : 0,
    checks,
    complete: failed.length === 0,
    durationMs: Date.now() - started,
  };

  console.log(
    `[member-flows] 流水 ${txns.length} 行（接口 total=${rawTxns.total}，去重丢弃 ${duplicates}）；日汇总 ${daily.length} 天`
  );
  console.log(
    `[member-flows] 期末余额锚点 ${endDate}: RM ${anchorEnd.total}（本金 ${anchorEnd.money} / 赠送 ${anchorEnd.gift}）`
  );
  for (const c of checks) console.log(`[member-flows] ${c.ok ? 'OK  ' : 'FAIL'} ${c.name} -> ${JSON.stringify(c.detail)}`);

  if (failed.length) {
    fs.writeFileSync(path.join(OUT_DIR, 'flows.partial.json'), JSON.stringify({ meta, daily, txns }, null, 1));
    throw new Error(
      `勾稽未通过（${failed.map((c) => c.name).join('；')}）—— 已写 flows.partial.json 供排查，不覆盖 flows.json`
    );
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify({ meta, daily, txns }, null, 1));
  fs.rmSync(path.join(OUT_DIR, 'flows.partial.json'), { force: true });
  console.log(`[member-flows] 写入 ${OUT_FILE}（${Math.round(meta.durationMs / 1000)}s）`);
}

try {
  await main();
} catch (e) {
  console.error(`[member-flows] FAILED: ${e.message}`);
  if (!e.exitCode) console.error(e.stack);
  process.exit(exitCodeFor(e));
}
