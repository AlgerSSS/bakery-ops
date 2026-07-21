import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

test('apply-translations removes a stale headline when the live replay is empty', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'hotcrush-apply-'));
  const salesDir = path.join(root, 'output', 'sales');
  const headline = path.join(salesDir, 'readable', 'sales_by_business_date.csv');
  const applyScript = new URL('../apply-translations.js', import.meta.url);

  try {
    for (const slug of ['sales-overview', 'sales-summary', 'items-breakdown']) {
      mkdirSync(path.join(salesDir, slug, 'replay-30d'), { recursive: true });
    }
    mkdirSync(path.dirname(headline), { recursive: true });
    writeFileSync(
      path.join(salesDir, 'translations.json'),
      JSON.stringify({ dimOptions: {}, dynamicSubHeads: {}, metricTitles: {}, dimTitles: {} }),
    );
    writeFileSync(headline, 'Business Date\n2026-07-19\n');

    const run = spawnSync(process.execPath, [applyScript.pathname], { cwd: root, encoding: 'utf8' });

    assert.equal(run.status, 0, run.stderr);
    assert.equal(existsSync(headline), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
