// 会员日汇总的两个轻量 /crm 只读调用（各一次，一次返回 30~31 天）：
//   ① /crm/memberMpp/analysis/queryCustomerNewTrends
//      -> 每天的 newCustomerCnt / consumedCustomerCnt / rechargedCustomerCnt / getPointsCustomerCnt
//   ② /crm/memberMpp/homePage/queryCustomerConsumeRatio
//      -> 每天的 totalConsumeAmt / memberConsumeAmt / customerConsumeAmt（**整数分，除以 100**）
// -> output/member/trends.json -> pos_member_daily 的会员人数与会员消费额列。
//
// 为什么单独成一个脚本：这两个调用几秒钟就回来，而 scrape-member-snapshot 要翻 ~50 页。
// 分开跑，重量级的快照失败时不连累这几列日汇总。
//
// 【归属日按 batchNo，不按抓取时间推算】这两个接口是 T+1 01:10 的批次产出，
//   KL 23:00 抓到的最新一天可能是当天也可能是前一天。newTrends 用 startBatchNo，
//   consumeRatio 用 batchNo，一律以接口自报的日期为准。
//
// 【memberConsumeAmt 的口径尚未坐实】实测 totalConsumeAmt/100 与 daily_revenue.revenue
//   2026-07-18~25 八天逐日完全相等，所以分母是「当日实收总额」；但分子与卡核销额时大时小，
//   推测是「被识别为会员的订单的实收合计」。上线后先并排看两周再决定敢不敢对外说
//   「会员贡献营业额占比」。这里只如实落数，不做换算也不做勾稽。
//
// 【PII】这两个接口只返回计数与金额，不含任何会员标识。落盘前仍跑一次 assertNoPii 兜底。
//
// 退出码：0 成功 / 2 会话失效 / 3 查询失败 / 1 其它。

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CORPORATION_ID,
  DEFAULT_SHOP_ID,
  PosQueryError,
  assertOk,
  exitCodeFor,
  openAuthedPage,
} from './lib/report-client.js';
import { assertNoPii } from './lib/pii-guard.js';
import { refreshBusinessDate } from './lib/business-date.js';

const CORP = process.env.CRM_CORPORATION_ID || DEFAULT_CORPORATION_ID;
const SHOP_ID = process.env.SHOP_ID || DEFAULT_SHOP_ID;
const OUT_DIR = process.env.MEMBER_OUT_DIR || 'output/member';
const OUT_FILE = path.join(OUT_DIR, 'trends.json');
const BUSINESS_DATE = refreshBusinessDate();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const int = (v) => (v == null || v === '' ? null : Number(v));
/** 整数分 -> MYR 元。 */
const cents = (v) => (v == null || v === '' ? null : Math.round(Number(v)) / 100);

async function main() {
  const started = Date.now();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[member-trends] business date=${BUSINESS_DATE} corp=${CORP} shop=${SHOP_ID}`);

  const session = await openAuthedPage({ warmupPath: '/member-overview' });
  let trendRows;
  let ratioRows;
  try {
    const trendRes = await session.call('/crm/memberMpp/analysis/queryCustomerNewTrends', {
      corporationId: CORP,
      dataDimension: '0', // 0 = 按天
      dateScope: '0', // 0 = 最近 30 天
      shopIds: [SHOP_ID],
    });
    trendRows = assertOk(trendRes, 'queryCustomerNewTrends')?.data || [];

    const ratioRes = await session.call('/crm/memberMpp/homePage/queryCustomerConsumeRatio', {
      corporationId: CORP,
      shopIds: [SHOP_ID],
      dateScope: '0',
      currency: 'MYR',
    });
    ratioRows = assertOk(ratioRes, 'queryCustomerConsumeRatio')?.data || [];
  } finally {
    await session.close();
  }

  if (!Array.isArray(trendRows) || !trendRows.length) {
    throw new PosQueryError('queryCustomerNewTrends 返回 0 行 —— 查询成功但内容为空，拒绝写产物');
  }
  if (!Array.isArray(ratioRows) || !ratioRows.length) {
    throw new PosQueryError('queryCustomerConsumeRatio 返回 0 行 —— 查询成功但内容为空，拒绝写产物');
  }

  const byDate = new Map();
  const ensure = (d) => {
    let row = byDate.get(d);
    if (!row) {
      row = {
        business_date: d,
        new_member_count: null,
        consumed_member_count: null,
        recharged_member_count: null,
        points_member_count: null,
        member_consume_amount: null,
        customer_consume_amount: null,
        total_consume_amount: null,
        currency: 'MYR',
      };
      byDate.set(d, row);
    }
    return row;
  };

  let badBatchNo = 0;
  for (const r of trendRows) {
    const d = String(r.startBatchNo || '').slice(0, 10);
    if (!DATE_RE.test(d)) {
      badBatchNo++;
      continue;
    }
    const row = ensure(d);
    row.new_member_count = int(r.newCustomerCnt);
    row.consumed_member_count = int(r.consumedCustomerCnt);
    row.recharged_member_count = int(r.rechargedCustomerCnt);
    row.points_member_count = int(r.getPointsCustomerCnt);
  }
  for (const r of ratioRows) {
    const d = String(r.batchNo || '').slice(0, 10);
    if (!DATE_RE.test(d)) {
      badBatchNo++;
      continue;
    }
    const row = ensure(d);
    row.member_consume_amount = cents(r.memberConsumeAmt);
    row.customer_consume_amount = cents(r.customerConsumeAmt);
    row.total_consume_amount = cents(r.totalConsumeAmt);
    if (r.currency) row.currency = String(r.currency);
  }

  if (badBatchNo) {
    throw new PosQueryError(
      `${badBatchNo} 行的 batchNo 不是 YYYY-MM-DD —— 接口口径可能变了，拒绝按抓取时间瞎归属`
    );
  }

  const daily = [...byDate.values()].sort((a, b) => a.business_date.localeCompare(b.business_date));
  for (const row of daily) assertNoPii(row, { context: 'trends 行' });

  const dates = daily.map((r) => r.business_date);
  const meta = {
    scrapedAt: new Date().toISOString(),
    businessDate: BUSINESS_DATE,
    source: {
      counts: '/crm/memberMpp/analysis/queryCustomerNewTrends',
      consume: '/crm/memberMpp/homePage/queryCustomerConsumeRatio',
    },
    amountUnit: 'MYR',
    amountNote: '/crm 返回整数分，本脚本已除以 100',
    dateRange: [dates[0], dates[dates.length - 1]],
    dayCount: daily.length,
    trendRows: trendRows.length,
    ratioRows: ratioRows.length,
    // 批次是 T+1 产出的：最新一天等于业务日还是业务日-1，取决于跑的时刻，不做修正。
    latestBatchDate: dates[dates.length - 1],
    latestBatchIsBusinessDate: dates[dates.length - 1] === BUSINESS_DATE,
    daysMissingConsume: daily.filter((r) => r.total_consume_amount == null).length,
    daysMissingCounts: daily.filter((r) => r.new_member_count == null).length,
    complete: true,
    durationMs: Date.now() - started,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify({ meta, daily }, null, 1));
  console.log(
    `[member-trends] ${daily.length} 天（${meta.dateRange.join(' .. ')}）；最新批次=${meta.latestBatchDate}` +
      `${meta.latestBatchIsBusinessDate ? '（= 业务日）' : '（= 业务日前一天，T+1 批次尚未出）'}`
  );
  console.log(`[member-trends] 写入 ${OUT_FILE}（${Math.round(meta.durationMs / 1000)}s）`);
}

try {
  await main();
} catch (e) {
  console.error(`[member-trends] FAILED: ${e.message}`);
  if (!e.exitCode) console.error(e.stack);
  process.exit(exitCodeFor(e));
}
