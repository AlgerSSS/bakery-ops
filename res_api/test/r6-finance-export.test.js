import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COST_CARD_TABLES,
  MONTHLY_TABLES,
  buildFinanceExport,
  financeBatchSpec,
  registerFinanceRawExport,
} from '../lib/r6-finance-export.js';

const REF = 'ecsgqcmwtjmcpzqytdqw';

function monthlyTables(overrides = {}) {
  const tables = Object.fromEntries(MONTHLY_TABLES.map((name) => [name, []]));
  return { ...tables, ...overrides };
}

function costCardTables(overrides = {}) {
  const tables = Object.fromEntries(COST_CARD_TABLES.map((name) => [name, []]));
  return { ...tables, ...overrides };
}

test('monthly export is deterministic for identical source data', () => {
  const rows = { finance_targets: [{ month: '2026-03', store: 'S', item: 'x', amount: '1' }] };
  const args = {
    kind: 'monthly',
    sourceProjectRef: REF,
    exportedAt: '2026-08-21T00:00:00.000Z',
    storeId: 'HC001',
    tables: monthlyTables(rows),
  };
  assert.equal(buildFinanceExport(args), buildFinanceExport(args));
});

test('table order does not change the serialized export', () => {
  const rows = { finance_targets: [{ month: '2026-03', store: 'S', item: 'x', amount: '1' }] };
  const forward = monthlyTables(rows);
  const reversed = Object.fromEntries(Object.entries(forward).reverse());
  const base = {
    kind: 'monthly', sourceProjectRef: REF, exportedAt: '2026-08-21T00:00:00.000Z', storeId: 'HC001',
  };
  assert.equal(
    buildFinanceExport({ ...base, tables: forward }),
    buildFinanceExport({ ...base, tables: reversed }),
  );
});

test('both duplicate expense entries survive serialization', () => {
  const tables = monthlyTables({
    finance_expense: [
      { id: 232, month: '2026-03', major: '物料费', sub: '日常物料', source: '银行账户采买', amount: '1507.50' },
      { id: 233, month: '2026-03', major: '物料费', sub: '日常物料', source: '银行账户采买', amount: '472.22' },
    ],
  });
  const parsed = JSON.parse(buildFinanceExport({
    kind: 'monthly', sourceProjectRef: REF, exportedAt: '2026-08-21T00:00:00.000Z',
    storeId: 'HC001', tables,
  }));
  assert.equal(parsed.tables.finance_expense.length, 2);
  assert.deepEqual(parsed.tables.finance_expense.map((row) => row.id), [232, 233]);
});

test('an empty finance_revenue_daily is exported as an empty list, not omitted', () => {
  const parsed = JSON.parse(buildFinanceExport({
    kind: 'monthly', sourceProjectRef: REF, exportedAt: '2026-08-21T00:00:00.000Z',
    storeId: 'HC001', tables: monthlyTables(),
  }));
  assert.deepEqual(parsed.tables.finance_revenue_daily, []);
});

test('a missing table is rejected rather than exported as absent', () => {
  const tables = monthlyTables();
  delete tables.finance_cashflow;
  assert.throws(() => buildFinanceExport({
    kind: 'monthly', sourceProjectRef: REF, exportedAt: '2026-08-21T00:00:00.000Z',
    storeId: 'HC001', tables,
  }), /missing tables in monthly export: finance_cashflow/);
});

test('a cost-card table inside a monthly export is rejected', () => {
  assert.throws(() => buildFinanceExport({
    kind: 'monthly', sourceProjectRef: REF, exportedAt: '2026-08-21T00:00:00.000Z',
    storeId: 'HC001', tables: monthlyTables({ cost_card_item: [] }),
  }), /unexpected tables in monthly export: cost_card_item/);
});

test('an invalid source project ref is rejected', () => {
  assert.throws(() => buildFinanceExport({
    kind: 'monthly', sourceProjectRef: 'nope', exportedAt: '2026-08-21T00:00:00.000Z',
    storeId: 'HC001', tables: monthlyTables(),
  }), /sourceProjectRef is invalid/);
});

test('the two kinds map to distinct source systems and pipelines', () => {
  assert.equal(financeBatchSpec('monthly').sourceSystem, 'FINANCE_MONTHLY');
  assert.equal(financeBatchSpec('monthly').pipelineKey, 'finance_monthly');
  assert.equal(financeBatchSpec('cost_card').sourceSystem, 'FINANCE_COST_CARD');
  assert.equal(financeBatchSpec('cost_card').pipelineKey, 'finance_cost_card');
});

test('registration registers, uploads, then completes with the finance pipeline only', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: url.replace('https://r6.example', ''), body: options.body });
    if (url.includes('/rpc/ops_register_raw_batch')) {
      return new Response(JSON.stringify([{ batch_id: 'b-1' }]), { status: 200 });
    }
    if (url.includes('/rpc/ops_complete_raw_batch')) {
      return new Response(JSON.stringify([{ status: 'READY' }]), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };

  const result = await registerFinanceRawExport({
    kind: 'cost_card',
    storeId: 'HC001',
    sourceProjectRef: REF,
    exportedAt: '2026-08-21T00:00:00.000Z',
    watermarkFrom: '2026-08-20T16:00:00.000Z',
    watermarkTo: '2026-08-21T16:00:00.000Z',
    tables: costCardTables({ cost_card_item: [{ id: 1, name: 'x' }] }),
    env: { R6_SUPABASE_URL: 'https://r6.example', R6_SUPABASE_SECRET_KEY: 'k' },
    fetchImpl,
  });

  assert.equal(result.status, 'READY');
  assert.match(result.objectPath, /^finance_cost_card\/2026\/08\/21\/b-1\/[0-9a-f]{64}\.json$/);
  assert.equal(result.sourceBatchKey, `finance_cost_card:HC001:${result.contentSha256.slice(0, 20)}`);

  const order = calls.map((call) => call.url);
  assert.deepEqual(order, [
    '/rest/v1/rpc/ops_register_raw_batch',
    `/storage/v1/object/raw-business-private/${result.objectPath.split('/').map(encodeURIComponent).join('/')}`,
    '/rest/v1/rpc/ops_register_raw_object',
    '/rest/v1/rpc/ops_complete_raw_batch',
  ]);

  const completion = JSON.parse(calls.at(-1).body);
  assert.deepEqual(completion.p_pipeline_keys, ['finance_cost_card']);

  const registration = JSON.parse(calls[0].body);
  assert.equal(registration.p_source_system, 'FINANCE_COST_CARD');
  assert.deepEqual(registration.p_metadata.row_counts.cost_card_item, 1);

  const objectRegistration = JSON.parse(calls[2].body);
  assert.equal(objectRegistration.p_data_class, 'C2');
});

test('registration refuses to run without R6 credentials', async () => {
  await assert.rejects(registerFinanceRawExport({
    kind: 'monthly', storeId: 'HC001', sourceProjectRef: REF,
    exportedAt: '2026-08-21T00:00:00.000Z',
    watermarkFrom: '2026-08-20T16:00:00.000Z', watermarkTo: '2026-08-21T16:00:00.000Z',
    tables: monthlyTables(), env: {},
  }), /R6_SUPABASE_URL and R6_SUPABASE_SECRET_KEY/);
});
