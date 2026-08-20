import assert from 'node:assert/strict';
import test from 'node:test';

import { registerPosRawShadow } from '../lib/r6-shadow.js';

function response(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof value === 'string' ? value : JSON.stringify(value)),
  };
}

test('POS Raw shadow uploads immutable artifacts and completes one idempotent batch', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/rpc/ops_register_raw_batch')) return response(200, [{ batch_id: 'batch-1' }]);
    if (url.includes('/storage/v1/object/')) return response(200, { Key: 'stored' });
    if (url.endsWith('/rpc/ops_register_raw_object')) return response(200, [{ raw_object_id: 'object-1' }]);
    if (url.endsWith('/rpc/ops_complete_raw_batch')) return response(200, [{ status: 'READY' }]);
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await registerPosRawShadow({
    businessDate: '2026-08-20',
    artifacts: [
      { logicalName: 'daily.json', mimeType: 'application/json', content: Buffer.from('{"ok":true}') },
      { logicalName: 'sales.csv', mimeType: 'text/csv', content: Buffer.from('date,sales\n2026-08-20,1\n') },
    ],
    env: { R6_SUPABASE_URL: 'https://r6.example', R6_SUPABASE_SECRET_KEY: 'secret', R6_STORE_ID: 'HC001' },
    fetchImpl,
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.artifactCount, 2);
  assert.equal(result.uploadedCount, 2);
  assert.equal(calls.filter((call) => call.url.includes('/storage/v1/object/')).length, 2);
  const batchPayload = JSON.parse(calls[0].options.body);
  assert.equal(batchPayload.p_source_system, 'RES_POS_DAILY');
  assert.equal(batchPayload.p_expected_count, 2);
  assert.match(batchPayload.p_source_batch_key, /^pos-daily:2026-08-20:[a-f0-9]{20}$/);
  const completeCall = calls.find((call) => call.url.endsWith('/rpc/ops_complete_raw_batch'));
  const completePayload = JSON.parse(completeCall.options.body);
  assert.deepEqual(completePayload.p_pipeline_keys, ['pos_daily_sales']);
  assert.equal(completePayload.p_pipeline_version, 'pos-v1');
  assert.ok(calls.every((call) => !call.url.includes('secret')));
});

test('duplicate Storage objects are treated as an idempotent replay', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/rpc/ops_register_raw_batch')) return response(200, [{ batch_id: 'batch-1' }]);
    if (url.includes('/storage/v1/object/')) return response(409, 'The resource already exists');
    if (url.endsWith('/rpc/ops_register_raw_object')) return response(200, [{ raw_object_id: 'object-1' }]);
    if (url.endsWith('/rpc/ops_complete_raw_batch')) return response(200, [{ status: 'READY' }]);
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await registerPosRawShadow({
    businessDate: '2026-08-20',
    artifacts: [{ logicalName: 'daily.json', mimeType: 'application/json', content: Buffer.from('{}') }],
    env: { R6_SUPABASE_URL: 'https://r6.example', R6_SUPABASE_SECRET_KEY: 'secret' },
    fetchImpl,
  });

  assert.equal(result.uploadedCount, 0);
  assert.equal(result.status, 'READY');
});
