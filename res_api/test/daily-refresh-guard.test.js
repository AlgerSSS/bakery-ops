import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  kualaLumpurDate,
  resolveDailyRevenueRecords,
  selectDailyRevenueRecords,
} from '../lib/daily-revenue-resolver.js';
import { resetGeneratedDirectory } from '../lib/generated-output.js';

test('resetGeneratedDirectory removes stale replay files before a refresh', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hotcrush-replay-'));
  const replayDir = path.join(root, 'replay-30d');

  try {
    resetGeneratedDirectory(replayDir);
    writeFileSync(path.join(replayDir, 'old.json'), '{"date":"yesterday"}');

    resetGeneratedDirectory(replayDir);

    assert.deepEqual(readdirSync(replayDir), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('resolveDailyRevenueRecords prefers the expected-date Sales Summary row', () => {
  const result = resolveDailyRevenueRecords({
    expectedDate: '2026-07-20',
    csvRows: [
      {
        'Business Date': '2026-07-20',
        'Net Sales': '900.50',
        'Gross Sales': '1000.00',
        'Bill Count': '20',
        'Avg Order Net Sales': '45.025',
        'Amount Of Discount': '99.50',
        'Total Payment received': '950.00',
        'Payment Subtotal — Membership card pay': '95.00',
      },
    ],
    daily: { hourlyByDate: [] },
  });

  assert.equal(result.fallbackUsed, false);
  assert.equal(result.records[0].date, '2026-07-20');
  assert.equal(result.records[0].revenue, 900.5);
  assert.equal(result.records[0].gross_sales, 1000);
  assert.equal(result.records[0].transaction_count, 20);
  assert.equal(result.records[0].member_sales_ratio, 0.1);
});

test('resolveDailyRevenueRecords aggregates hourly data when Sales Summary is stale', () => {
  const result = resolveDailyRevenueRecords({
    expectedDate: '2026-07-20',
    csvRows: [{ 'Business Date': '2026-07-19', 'Net Sales': '100' }],
    daily: {
      hourlyByDate: [
        { date: '2026-07-20', hour: '11', billCount: 2, netSales: 25.74, grossSales: 30.9, discount: 5.16 },
        { date: '2026-07-20', hour: '12', billCount: 86, netSales: 6454.5, grossSales: 7160, discount: 705.5 },
        { date: '2026-07-19', hour: '12', billCount: 50, netSales: 3000, grossSales: 3200, discount: 200 },
      ],
    },
  });

  const current = result.records.find((record) => record.date === '2026-07-20');
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(current, {
    date: '2026-07-20',
    revenue: 6480.24,
    transaction_count: 88,
    avg_transaction_value: 73.64,
    gross_sales: 7190.9,
    total_discount: 710.66,
    discount_rate: 0.0988,
    member_sales_ratio: null,
  });
});

test('fallbackUsed 为真 <=> CSV 里没有 EXPECTED_DATE，所以只有那一条记录是近似值', () => {
  // 这条不变式是 sync-to-db.js 里 `degraded = fallbackUsed && record.date === EXPECTED_DATE`
  // 的正确性依据：降级时返回的是 [CSV 的 29 天精确记录, 今天的小时聚合记录]，
  // 精确记录必须走 EXCLUDED 覆盖，否则迟到退款/作废单的历史修正永远写不进去。
  const csvRows = [
    { 'Business Date': '2026-07-18', 'Net Sales': '100' },
    { 'Business Date': '2026-07-19', 'Net Sales': '200' },
  ];
  const daily = { hourlyByDate: [{ date: '2026-07-20', hour: '12', billCount: 1, netSales: 10, grossSales: 12, discount: 2 }] };

  const degradedRun = resolveDailyRevenueRecords({ expectedDate: '2026-07-20', csvRows, daily });
  assert.equal(degradedRun.fallbackUsed, true);
  const approximated = degradedRun.records.filter((r) => r.date === '2026-07-20');
  assert.equal(approximated.length, 1, '降级时 EXPECTED_DATE 只可能有一条，且必来自小时聚合');
  // 其余记录仍是 CSV 精确值 —— 若把 degraded 当整轮开关，它们会被 COALESCE 挡住写不进去。
  assert.deepEqual(
    degradedRun.records.filter((r) => r.date !== '2026-07-20').map((r) => r.date),
    ['2026-07-18', '2026-07-19'],
  );

  // 反向：CSV 里有 EXPECTED_DATE 时绝不降级（自锁的第二晚正是这种情况）。
  const preciseRun = resolveDailyRevenueRecords({
    expectedDate: '2026-07-19',
    csvRows,
    daily,
  });
  assert.equal(preciseRun.fallbackUsed, false);
});

test('sync-to-db 的 degraded 开关是 per-record 的，不是整轮的', () => {
  // 源码级防回归：整轮开关会让 29 天精确记录也走 COALESCE，并且自锁
  //（第 N 晚降级写了近似值，第 N+1 晚即使 CSV 已有精确值、只要当晚又降级就仍被保留）。
  const src = readFileSync(new URL('../sync-to-db.js', import.meta.url), 'utf8');
  assert.match(src, /const degraded = fallbackUsed && record\.date === EXPECTED_DATE;/);
  const loopStart = src.indexOf('for (const record of selectedRecords)');
  const degradedAt = src.indexOf('const degraded = fallbackUsed');
  assert.ok(loopStart > 0 && degradedAt > loopStart, 'degraded 必须在 selectedRecords 循环体内计算');
});

test('sync-to-db 的每一步都走 deferredFailures，timeslot 断言不再吞掉后面 4 步', () => {
  // MEDIUM-2：syncTimeslotSalesRecord 的 `days < 14` throw 原本是 main() 第 5 步直接抛，
  // 抛出后第 6/7/8/9 步全不执行，与第 6 步刻意做的 deferred 处理自相矛盾。
  const src = readFileSync(new URL('../sync-to-db.js', import.meta.url), 'utf8');
  const main = src.slice(src.indexOf('async function main()'), src.indexOf('async function finish()'));
  const syncCalls = [...main.matchAll(/await (runStep\(|sync[A-Za-z]+\()/g)].map((m) => m[1]);
  assert.ok(syncCalls.length >= 9, `main() 里应有 9 步，实际 ${syncCalls.length}`);
  assert.deepEqual(
    syncCalls.filter((c) => c !== 'runStep('),
    [],
    'main() 里不允许直接 await sync*()，必须经过 runStep 才能聚合失败',
  );
  // 第 5 步现在多了 `{ requires: 'item_hourly_sales' }`：仍然经过 runStep（聚合失败），
  // 只是第 4 步没成功时不许重建基线。
  assert.match(main, /timeslot_sales_record.*', syncTimeslotSalesRecord, \{ requires: 'item_hourly_sales' \}\)/);
});

test('第 7 步 daily_dining_breakdown 不再吃陈旧 CSV 静默成功（MEDIUM-2）', () => {
  // 它是 daily_dining_breakdown 的唯一来源，而 apply-translations 现在是 delete-first：
  // 文件不存在 = 今晚没重建成功，静默 return 0 会让这张表停在几天前而整链 exit 0。
  const src = readFileSync(new URL('../sync-to-db.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function syncDiningBreakdown()'), src.indexOf('// === 8.'));
  assert.doesNotMatch(fn, /\[skip\] no data/);
  assert.match(fn, /throw new Error\(`daily_dining_breakdown 源缺失/);
  assert.match(fn, /throw new Error\(`daily_dining_breakdown 缺少日期源/);
  assert.match(fn, /没有 \$\{EXPECTED_DATE\} 这一天/);
});

test('resolveDailyRevenueRecords rejects a refresh with no expected-date source', () => {
  assert.throws(
    () => resolveDailyRevenueRecords({
      expectedDate: '2026-07-20',
      csvRows: [{ 'Business Date': '2026-07-19', 'Net Sales': '100' }],
      daily: { hourlyByDate: [{ date: '2026-07-19', netSales: 100 }] },
    }),
    /missing expected business date 2026-07-20/,
  );
});

test('daily-revenue-only recovery selects exactly the expected business date', () => {
  const records = [
    { date: '2026-07-19', revenue: 100 },
    { date: '2026-07-20', revenue: 200 },
  ];

  assert.deepEqual(
    selectDailyRevenueRecords(records, '2026-07-20', true),
    [{ date: '2026-07-20', revenue: 200 }],
  );
  assert.equal(selectDailyRevenueRecords(records, '2026-07-21', true).length, 0);
  assert.equal(selectDailyRevenueRecords(records, '2026-07-20', false), records);
});

test('kualaLumpurDate uses the business timezone rather than the host timezone', () => {
  assert.equal(kualaLumpurDate(new Date('2026-07-20T16:30:00.000Z')), '2026-07-21');
});

const APPLY_SCRIPT = new URL('../apply-translations.js', import.meta.url);

/** Build a minimal output/sales tree that apply-translations.js can run against. */
function makeApplyFixture(replayFiles = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'hotcrush-apply-'));
  const salesDir = path.join(root, 'output', 'sales');
  for (const slug of ['sales-overview', 'sales-summary', 'items-breakdown']) {
    mkdirSync(path.join(salesDir, slug, 'replay-30d'), { recursive: true });
  }
  mkdirSync(path.join(salesDir, 'readable'), { recursive: true });
  writeFileSync(
    path.join(salesDir, 'translations.json'),
    JSON.stringify({ dimOptions: {}, dynamicSubHeads: {}, metricTitles: {}, dimTitles: {} }),
  );
  for (const [rel, payload] of Object.entries(replayFiles)) {
    writeFileSync(path.join(salesDir, rel), JSON.stringify(payload));
  }
  return { root, salesDir };
}

const replay = (reqBody, rows) => ({ reqBody, result: { status: 200, body: { code: '000', data: rows } } });

test('apply-translations removes a stale headline and fails loudly when the live replay is empty', () => {
  const { root, salesDir } = makeApplyFixture();
  const headline = path.join(salesDir, 'readable', 'sales_by_business_date.csv');

  try {
    writeFileSync(headline, 'Business Date\n2026-07-19\n');

    const run = spawnSync(process.execPath, [APPLY_SCRIPT.pathname], { cwd: root, encoding: 'utf8' });

    // The stale file must be gone (it can never be mistaken for today's data)...
    assert.equal(existsSync(headline), false);
    // ...and the run must not report success, or sync-to-db would ingest a hole silently.
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stderr, /sales_by_business_date\.csv/);
    assert.match(run.stderr, /orders_by_dining_option\.csv/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('apply-translations still succeeds when only optional headlines are missing', () => {
  const { root, salesDir } = makeApplyFixture({
    'sales-summary/replay-30d/000.json': replay(
      { reportId: '888001', page: { pageNo: 1, pageSize: 500 }, selectFields: ['D_businessDate', 'M_Order_SUM_netSales'] },
      [{ D_businessDate: '2026-07-25', M_Order_SUM_netSales: 100 }],
    ),
    'sales-overview/replay-30d/000.json': replay(
      { reportId: '123', page: { pageNo: 1, pageSize: 500 }, selectFields: ['M_Order_COUNT_Orders', 'D_diningOption'] },
      [{ D_diningOption: '10', M_Order_COUNT_Orders: 42 }],
    ),
  });

  try {
    const run = spawnSync(process.execPath, [APPLY_SCRIPT.pathname], { cwd: root, encoding: 'utf8' });

    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(existsSync(path.join(salesDir, 'readable', 'sales_by_business_date.csv')), true);
    assert.equal(existsSync(path.join(salesDir, 'readable', 'orders_by_dining_option.csv')), true);
    // items_totals.csv only backs a read-only REST endpoint — missing it must not break ingest.
    assert.equal(existsSync(path.join(salesDir, 'readable', 'items_totals.csv')), false);
    assert.match(run.stderr, /missing, optional/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
