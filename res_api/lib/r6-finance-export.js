// One-shot export of the legacy finance domain into immutable R6 Raw batches.
//
// This lives beside the POS shadow helpers because they share the old-production connection
// and the Raw registration contract, not because finance is part of RES. The two source
// systems stay separate all the way down: FINANCE_MONTHLY / FINANCE_COST_CARD batches can
// only schedule finance pipelines, and hc_finance_writer cannot touch a POS fact.
//
// Nothing here corrects the source. finance_expense really does hold two distinct entries
// that share every dimension, and finance_revenue_daily really is empty; both are exported
// as they are so the migration is auditable against production.

import crypto from 'node:crypto';

const BUCKET_ID = 'raw-business-private';

export const MONTHLY_TABLES = [
  'finance_pl_metrics',
  'finance_expense',
  'finance_labor_detail',
  'finance_material',
  'finance_targets',
  'finance_cashflow',
  'finance_revenue_daily',
];

export const COST_CARD_TABLES = [
  'cost_card_item',
  'cost_card_item_price',
  'cost_card_recipe',
  'cost_card_recipe_item',
];

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function secretFromEnv(env) {
  if (env.R6_SUPABASE_SECRET_KEY) return env.R6_SUPABASE_SECRET_KEY;
  return env.R6_SUPABASE_SERVICE_KEY || '';
}

function one(value, operation) {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new Error(`${operation} did not return exactly one row`);
    return value[0];
  }
  if (!value) throw new Error(`${operation} returned no row`);
  return value;
}

async function rpc(fetchImpl, baseUrl, key, name, payload) {
  const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`${name} failed: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function uploadObject(fetchImpl, baseUrl, key, objectPath, content) {
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  const response = await fetchImpl(`${baseUrl}/storage/v1/object/${BUCKET_ID}/${encodedPath}`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'x-upsert': 'true',
    },
    body: content,
  });
  if (!response.ok) {
    throw new Error(`storage upload failed: ${response.status} ${await response.text()}`);
  }
  return true;
}

/**
 * Serialize one finance export deterministically.
 *
 * Determinism matters: the sha256 of this content is the batch identity, so re-running the
 * export against unchanged production must produce the same digest and therefore the same
 * batch, rather than a second batch that silently supersedes the first.
 */
export function buildFinanceExport({ kind, sourceProjectRef, exportedAt, storeId, tables }) {
  if (kind !== 'monthly' && kind !== 'cost_card') {
    throw new Error('kind must be monthly or cost_card');
  }
  if (!/^[a-z]{20}$/.test(sourceProjectRef || '')) {
    throw new Error('sourceProjectRef is invalid');
  }
  if (!storeId?.trim()) throw new Error('storeId is required');
  const expected = kind === 'monthly' ? MONTHLY_TABLES : COST_CARD_TABLES;
  const provided = Object.keys(tables || {});
  const unexpected = provided.filter((name) => !expected.includes(name));
  if (unexpected.length) {
    throw new Error(`unexpected tables in ${kind} export: ${unexpected.join(', ')}`);
  }
  const missing = expected.filter((name) => !provided.includes(name));
  if (missing.length) {
    throw new Error(`missing tables in ${kind} export: ${missing.join(', ')}`);
  }

  const ordered = {};
  for (const name of expected) {
    const rows = tables[name];
    if (!Array.isArray(rows)) throw new Error(`${name} must be an array`);
    ordered[name] = rows;
  }

  return JSON.stringify({
    schema_version: kind === 'monthly' ? 'finance-monthly-v1' : 'finance-cost-card-v1',
    source_project_ref: sourceProjectRef,
    exported_at: new Date(exportedAt).toISOString(),
    store_id: storeId,
    tables: ordered,
  });
}

export function financeBatchSpec(kind) {
  return kind === 'monthly'
    ? {
      sourceSystem: 'FINANCE_MONTHLY',
      schemaVersion: 'finance-monthly-v1',
      pipelineKey: 'finance_monthly',
      recordKey: 'finance_monthly_export.json',
      pathPrefix: 'finance_monthly',
    }
    : {
      sourceSystem: 'FINANCE_COST_CARD',
      schemaVersion: 'finance-cost-card-v1',
      pipelineKey: 'finance_cost_card',
      recordKey: 'finance_cost_card_export.json',
      pathPrefix: 'finance_cost_card',
    };
}

/** Register one finance export as an immutable, completed R6 Raw batch. */
export async function registerFinanceRawExport({
  kind,
  storeId,
  sourceProjectRef,
  exportedAt,
  tables,
  watermarkFrom,
  watermarkTo,
  env = process.env,
  fetchImpl = fetch,
}) {
  const baseUrl = (env.R6_SUPABASE_URL || '').replace(/\/$/, '');
  const key = secretFromEnv(env);
  if (!baseUrl || !key) {
    throw new Error('R6_SUPABASE_URL and R6_SUPABASE_SECRET_KEY(_FILE) are required');
  }
  const spec = financeBatchSpec(kind);
  const content = buildFinanceExport({ kind, sourceProjectRef, exportedAt, storeId, tables });
  const contentSha256 = sha256(content);
  const sourceBatchKey = `${spec.pathPrefix}:${storeId}:${contentSha256.slice(0, 20)}`;

  const batch = one(await rpc(fetchImpl, baseUrl, key, 'ops_register_raw_batch', {
    p_source_system: spec.sourceSystem,
    p_source_batch_key: sourceBatchKey,
    p_schema_version: spec.schemaVersion,
    p_writer_id: 'res_api:finance-migration',
    p_store_id: storeId,
    p_watermark_from: new Date(watermarkFrom).toISOString(),
    p_watermark_to: new Date(watermarkTo).toISOString(),
    p_expected_count: 1,
    p_metadata: {
      mode: 'one-shot-migration',
      source_project_ref: sourceProjectRef,
      artifact_sha256: contentSha256,
      row_counts: Object.fromEntries(
        Object.entries(JSON.parse(content).tables).map(([name, rows]) => [name, rows.length]),
      ),
    },
  }), 'ops_register_raw_batch');

  const stamp = new Date(exportedAt).toISOString().slice(0, 10).replace(/-/g, '/');
  const objectPath = `${spec.pathPrefix}/${stamp}/${batch.batch_id}/${contentSha256}.json`;
  await uploadObject(fetchImpl, baseUrl, key, objectPath, content);

  await rpc(fetchImpl, baseUrl, key, 'ops_register_raw_object', {
    p_batch_id: batch.batch_id,
    p_bucket_id: BUCKET_ID,
    p_object_path: objectPath,
    p_sha256: contentSha256,
    p_size_bytes: Buffer.byteLength(content),
    p_mime_type: 'application/json',
    // Finance amounts are commercially sensitive but not personal data; C2 keeps them out of
    // any automatic publish path while still allowing controlled structured processing.
    p_data_class: 'C2',
    p_source_record_key: spec.recordKey,
    p_source_version: contentSha256,
  });

  const completed = one(await rpc(fetchImpl, baseUrl, key, 'ops_complete_raw_batch', {
    p_batch_id: batch.batch_id,
    p_accepted_count: 1,
    p_rejected_count: 0,
    p_pipeline_keys: [spec.pipelineKey],
    p_pipeline_version: 'finance-migration-v1',
    p_error_summary: null,
  }), 'ops_complete_raw_batch');

  return {
    batchId: batch.batch_id,
    status: completed.status,
    objectPath,
    contentSha256,
    sourceBatchKey,
  };
}
