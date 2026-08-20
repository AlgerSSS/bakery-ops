import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLegacyPosMigrationPlan,
  compareLegacyPosMigrationPlan,
  enumerateBusinessDates,
} from '../lib/r6-pos-migration.js';
import { buildLegacyPosExport } from '../lib/r6-shadow.js';
import { parsePosRangeArgs } from '../lib/r6-pos-migration-cli.js';

function daily(date, overrides = {}) {
  return {
    date,
    store: 'Pavilion',
    revenue: 100,
    transaction_count: 2,
    gross_sales: 120,
    total_discount: 20,
    import_source: 'restosuite',
    ...overrides,
  };
}

function hours(date, overrides = {}) {
  return [
    {
      date,
      hour: 12,
      bill_count: 1,
      num_of_guests: 1,
      gross_sales: 50,
      net_sales: 40,
      total_discount: 10,
      synced_at: `${date}T15:00:00.000Z`,
    },
    {
      date,
      hour: 13,
      bill_count: 1,
      num_of_guests: 2,
      gross_sales: 70,
      net_sales: 60,
      total_discount: 10,
      synced_at: `${date}T16:00:00.000Z`,
      ...overrides,
    },
  ];
}

test('business-date ranges are inclusive and hard-limited to 31 days', () => {
  assert.deepEqual(
    enumerateBusinessDates('2026-01-30', '2026-02-02'),
    ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'],
  );
  assert.throws(
    () => enumerateBusinessDates('2026-01-01', '2026-02-01'),
    /cannot exceed 31 days/,
  );
  assert.throws(
    () => enumerateBusinessDates('2026-02-02', '2026-02-01'),
    /from date must not be after to date/,
  );
});

test('range CLI is dry-run by default and rejects unknown flags', () => {
  assert.deepEqual(
    parsePosRangeArgs([
      '--from=2026-01-01', '--to=2026-01-02', '--old-store=Pavilion', '--r6-store=HC001',
    ]),
    {
      help: false,
      apply: false,
      fromDate: '2026-01-01',
      toDate: '2026-01-02',
      oldStore: 'Pavilion',
      r6Store: 'HC001',
    },
  );
  assert.equal(parsePosRangeArgs([
    '--from=2026-01-01', '--to=2026-01-02', '--old-store=Pavilion',
    '--r6-store=HC001', '--apply',
  ]).apply, true);
  assert.throws(
    () => parsePosRangeArgs([
      '--from=2026-01-01', '--to=2026-01-02', '--old-store=Pavilion',
      '--r6-store=HC001', '--force',
    ]),
    /unknown option --force/,
  );
  assert.throws(
    () => parsePosRangeArgs([
      '--from=2026-01-01', '--to=2026-01-02', '--old-store=Pavilion',
      '--r6-store=HC001', '--apply=false',
    ]),
    /--apply does not accept a value/,
  );
});

test('migration plan accepts reconciled days and quarantines every missing or inconsistent day', () => {
  const plan = buildLegacyPosMigrationPlan({
    fromDate: '2026-01-01',
    toDate: '2026-01-04',
    oldStore: 'Pavilion',
    storeId: 'HC001',
    sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    dailyRows: [
      daily('2026-01-01'),
      daily('2026-01-02'),
      daily('2026-01-03'),
    ],
    hourlyRows: [
      ...hours('2026-01-01'),
      ...hours('2026-01-03', { net_sales: 59 }),
    ],
  });

  assert.deepEqual(
    plan.entries.map(({ businessDate, disposition, reasonCode }) => ({
      businessDate,
      disposition,
      reasonCode: reasonCode || null,
    })),
    [
      { businessDate: '2026-01-01', disposition: 'PROCESS', reasonCode: null },
      { businessDate: '2026-01-02', disposition: 'QUARANTINE', reasonCode: 'NO_HOURLY_SOURCE' },
      { businessDate: '2026-01-03', disposition: 'QUARANTINE', reasonCode: 'SOURCE_RECONCILIATION_FAILED' },
      { businessDate: '2026-01-04', disposition: 'QUARANTINE', reasonCode: 'MISSING_DAILY_SOURCE' },
    ],
  );
  assert.deepEqual(plan.summary, {
    requestedDays: 4,
    processDays: 1,
    quarantineDays: 3,
  });
  assert.equal(plan.entries[0].exportedAt, '2026-01-01T16:00:00.000Z');
  assert.match(plan.entries[2].reasonSummary, /net_sales mismatch/);
});

test('migration plan rejects source rows for a different store instead of silently remapping them', () => {
  assert.throws(
    () => buildLegacyPosMigrationPlan({
      fromDate: '2026-01-01',
      toDate: '2026-01-01',
      oldStore: 'Pavilion',
      storeId: 'HC001',
      sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
      dailyRows: [daily('2026-01-01', { store: 'Wrong Store' })],
      hourlyRows: hours('2026-01-01'),
    }),
    /unexpected source store/,
  );
});

test('range reconciliation proves processed facts and quarantined anomaly evidence together', () => {
  const dailyRows = [daily('2026-01-01'), daily('2026-01-02')];
  const hourlyRows = hours('2026-01-01');
  const plan = buildLegacyPosMigrationPlan({
    fromDate: '2026-01-01',
    toDate: '2026-01-02',
    oldStore: 'Pavilion',
    storeId: 'HC001',
    sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    dailyRows,
    hourlyRows,
  });
  const expected = JSON.parse(buildLegacyPosExport({
    businessDate: '2026-01-01',
    storeId: 'HC001',
    sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    exportedAt: '2026-01-01T16:00:00.000Z',
    daily: dailyRows[0],
    hourly: hourlyRows,
  }));
  const window = {
    daily: [{ business_date: expected.business_date, store_id: expected.store_id, ...expected.daily }],
    hourly: expected.hourly.map((row) => ({
      business_date: expected.business_date,
      store_id: expected.store_id,
      ...row,
    })),
    legacy_batches: [
      {
        business_date: '2026-01-01', source_system: 'LEGACY_POS_EXPORT',
        status: 'READY', processing_status: 'SUCCEEDED', reason_code: null,
      },
      {
        business_date: '2026-01-02', source_system: 'LEGACY_POS_ANOMALY',
        status: 'QUARANTINED', processing_status: null, reason_code: 'NO_HOURLY_SOURCE',
      },
    ],
  };

  const accepted = compareLegacyPosMigrationPlan({
    plan,
    storeId: 'HC001',
    sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    window,
  });
  assert.deepEqual(accepted, {
    ok: true,
    mismatchCount: 0,
    mismatches: [],
    processDays: 1,
    quarantineDays: 1,
  });

  window.hourly.pop();
  const rejected = compareLegacyPosMigrationPlan({
    plan,
    storeId: 'HC001',
    sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    window,
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.mismatches.join('\n'), /hourly row count/);
});
