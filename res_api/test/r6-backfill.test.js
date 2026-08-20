import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLegacyPosAnomaly,
  buildLegacyPosExport,
  compareLegacyPosWithR6,
  registerLegacyPosAnomaly,
  registerLegacyPosRawBackfill,
} from '../lib/r6-shadow.js';

function sourceRows({ dailyNetSales = 100 } = {}) {
  return {
    daily: {
      date: '2026-07-26',
      store: 'Pavilion',
      revenue: dailyNetSales,
      transaction_count: 2,
      gross_sales: 120,
      total_discount: 20,
      import_source: 'restosuite',
    },
    hourly: [
      {
        date: '2026-07-26', hour: 12, bill_count: 1, num_of_guests: 1,
        gross_sales: 50, net_sales: 40, total_discount: 10,
      },
      {
        date: '2026-07-26', hour: 13, bill_count: 1, num_of_guests: 2,
        gross_sales: 70, net_sales: 60, total_discount: 10,
      },
    ],
  };
}

function response(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof value === 'string' ? value : JSON.stringify(value)),
  };
}

test('legacy export keeps source rows and derives only the missing daily guest total', () => {
  const rows = sourceRows();
  const artifact = buildLegacyPosExport({
    businessDate: '2026-07-26',
    storeId: 'HC001',
    sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    exportedAt: '2026-07-26T16:00:00.000Z',
    ...rows,
  });
  const payload = JSON.parse(artifact);

  assert.equal(payload.schema_version, 'legacy-pos-export-v1');
  assert.equal(payload.daily.guest_count, 3);
  assert.equal(payload.daily.raw_record.guest_count_source, 'hourly_sales_summary_sum');
  assert.deepEqual(payload.daily.raw_record.row, rows.daily);
  assert.deepEqual(payload.hourly[0].raw_record.row, rows.hourly[0]);
});

test('legacy export rejects a final daily/hourly money mismatch', () => {
  assert.throws(
    () => buildLegacyPosExport({
      businessDate: '2026-07-26',
      storeId: 'HC001',
      sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
      exportedAt: '2026-07-26T16:00:00.000Z',
      ...sourceRows({ dailyNetSales: 90 }),
    }),
    /net_sales mismatch/,
  );
});

test('legacy anomaly preserves source evidence without pretending it is an accepted fact', () => {
  const rows = sourceRows({ dailyNetSales: 90 });
  const payload = JSON.parse(buildLegacyPosAnomaly({
    businessDate: '2026-07-26',
    storeId: 'HC001',
    sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    exportedAt: '2026-07-26T16:00:00.000Z',
    dailyRows: [rows.daily],
    hourly: rows.hourly,
    reasonCode: 'SOURCE_RECONCILIATION_FAILED',
    reasonSummary: 'net_sales mismatch',
  }));

  assert.equal(payload.schema_version, 'legacy-pos-anomaly-v1');
  assert.equal(payload.reason_code, 'SOURCE_RECONCILIATION_FAILED');
  assert.equal(payload.daily_rows[0].revenue, 90);
  assert.equal(payload.hourly_rows.length, 2);
});

test('legacy backfill registers one immutable Raw object and queues POS processing', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/rpc/ops_register_raw_batch')) return response(200, [{ batch_id: 'batch-legacy' }]);
    if (url.includes('/storage/v1/object/')) return response(200, { Key: 'stored' });
    if (url.endsWith('/rpc/ops_register_raw_object')) return response(200, [{ raw_object_id: 'object-legacy' }]);
    if (url.endsWith('/rpc/ops_complete_raw_batch')) return response(200, [{ status: 'READY' }]);
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await registerLegacyPosRawBackfill({
    businessDate: '2026-07-26',
    storeId: 'HC001',
    sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    exportedAt: '2026-07-26T16:00:00.000Z',
    ...sourceRows(),
    env: { R6_SUPABASE_URL: 'https://r6.example', R6_SUPABASE_SECRET_KEY: 'secret' },
    fetchImpl,
  });

  assert.equal(result.batchId, 'batch-legacy');
  const registerPayload = JSON.parse(calls[0].options.body);
  assert.equal(registerPayload.p_source_system, 'LEGACY_POS_EXPORT');
  assert.equal(registerPayload.p_schema_version, 'legacy-pos-export-v1');
  const completeCall = calls.find((call) => call.url.endsWith('/rpc/ops_complete_raw_batch'));
  const completePayload = JSON.parse(completeCall.options.body);
  assert.deepEqual(completePayload.p_pipeline_keys, ['pos_daily_sales']);
  assert.equal(completePayload.p_pipeline_version, 'pos-backfill-v1');
});

test('legacy anomaly becomes a quarantined Raw batch with no processing run', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/rpc/ops_register_raw_batch')) {
      return response(200, [{ batch_id: 'batch-anomaly', status: 'RECEIVING' }]);
    }
    if (url.includes('/storage/v1/object/')) return response(200, { Key: 'stored' });
    if (url.endsWith('/rpc/ops_register_raw_object')) return response(200, [{ raw_object_id: 'object-anomaly' }]);
    if (url.endsWith('/rpc/ops_complete_raw_batch')) return response(200, [{ status: 'QUARANTINED' }]);
    throw new Error(`unexpected request: ${url}`);
  };
  const rows = sourceRows({ dailyNetSales: 90 });

  const result = await registerLegacyPosAnomaly({
    businessDate: '2026-07-26',
    storeId: 'HC001',
    sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    exportedAt: '2026-07-26T16:00:00.000Z',
    dailyRows: [rows.daily],
    hourly: rows.hourly,
    reasonCode: 'SOURCE_RECONCILIATION_FAILED',
    reasonSummary: 'net_sales mismatch',
    env: { R6_SUPABASE_URL: 'https://r6.example', R6_SUPABASE_SECRET_KEY: 'secret' },
    fetchImpl,
  });

  assert.equal(result.status, 'QUARANTINED');
  const registerPayload = JSON.parse(calls[0].options.body);
  assert.equal(registerPayload.p_source_system, 'LEGACY_POS_ANOMALY');
  assert.equal(
    registerPayload.p_metadata.health_impact,
    'acknowledged_source_quality',
  );
  const completeCall = calls.find((call) => call.url.endsWith('/rpc/ops_complete_raw_batch'));
  const completePayload = JSON.parse(completeCall.options.body);
  assert.equal(completePayload.p_accepted_count, 0);
  assert.equal(completePayload.p_rejected_count, 1);
  assert.deepEqual(completePayload.p_pipeline_keys, []);
  assert.equal(completePayload.p_error_summary, 'SOURCE_RECONCILIATION_FAILED: net_sales mismatch');
});

test('replaying an existing quarantined anomaly does not try to complete it again', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/rpc/ops_register_raw_batch')) {
      return response(200, [{ batch_id: 'batch-anomaly', status: 'QUARANTINED' }]);
    }
    if (url.includes('/storage/v1/object/')) return response(409, 'already exists');
    if (url.endsWith('/rpc/ops_register_raw_object')) return response(200, [{ raw_object_id: 'object-anomaly' }]);
    throw new Error(`unexpected request: ${url}`);
  };
  const rows = sourceRows({ dailyNetSales: 90 });

  const result = await registerLegacyPosAnomaly({
    businessDate: '2026-07-26',
    storeId: 'HC001',
    sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    exportedAt: '2026-07-26T16:00:00.000Z',
    dailyRows: [rows.daily],
    hourly: rows.hourly,
    reasonCode: 'SOURCE_RECONCILIATION_FAILED',
    reasonSummary: 'net_sales mismatch',
    env: { R6_SUPABASE_URL: 'https://r6.example', R6_SUPABASE_SECRET_KEY: 'secret' },
    fetchImpl,
  });

  assert.equal(result.status, 'QUARANTINED');
  assert.equal(calls.some((call) => call.url.endsWith('/rpc/ops_complete_raw_batch')), false);
});

test('reconciliation compares every accepted daily and hourly fact', () => {
  const rows = sourceRows();
  const expected = JSON.parse(buildLegacyPosExport({
    businessDate: '2026-07-26',
    storeId: 'HC001',
    sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    exportedAt: '2026-07-26T16:00:00.000Z',
    ...rows,
  }));
  const r6 = {
    daily: {
      business_date: expected.business_date,
      store_id: expected.store_id,
      ...expected.daily,
    },
    hourly: expected.hourly.map((row) => ({
      business_date: expected.business_date,
      store_id: expected.store_id,
      ...row,
    })),
  };

  const accepted = compareLegacyPosWithR6({
    businessDate: '2026-07-26', storeId: 'HC001', sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    exportedAt: '2026-07-26T16:00:00.000Z', ...rows, r6,
  });
  assert.deepEqual(accepted, { ok: true, mismatchCount: 0, mismatches: [] });

  r6.hourly[0].net_sales = 39;
  const rejected = compareLegacyPosWithR6({
    businessDate: '2026-07-26', storeId: 'HC001', sourceProjectRef: 'ecsgqcmwtjmcpzqytdqw',
    exportedAt: '2026-07-26T16:00:00.000Z', ...rows, r6,
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.mismatches[0], /hour 12 net_sales/);
});
