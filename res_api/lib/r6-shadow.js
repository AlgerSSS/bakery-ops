import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BUCKET_ID = 'raw-business-private';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function secretFromEnv(env) {
  if (env.R6_SUPABASE_SECRET_KEY) return env.R6_SUPABASE_SECRET_KEY;
  if (!env.R6_SUPABASE_SECRET_KEY_FILE) return '';
  return fs.readFileSync(env.R6_SUPABASE_SECRET_KEY_FILE, 'utf8').trim();
}

function one(value, operation) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') throw new Error(`${operation} returned no row`);
  return row;
}

async function requestJson(fetchImpl, url, key, options, operation) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const body = JSON.parse(text);
      detail = [body.code, body.message, body.hint].filter(Boolean).join(': ');
    } catch {
      // Supabase Storage sometimes returns a plain-text error.
    }
    throw new Error(`${operation} HTTP ${response.status}: ${detail.slice(0, 800)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function rpc(fetchImpl, baseUrl, key, name, payload) {
  return requestJson(
    fetchImpl,
    `${baseUrl}/rest/v1/rpc/${name}`,
    key,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
    name,
  );
}

async function uploadObject(fetchImpl, baseUrl, key, objectPath, artifact) {
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  const response = await fetchImpl(`${baseUrl}/storage/v1/object/${BUCKET_ID}/${encodedPath}`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': artifact.mimeType,
      'x-upsert': 'false',
    },
    body: artifact.content,
  });
  if (response.ok) return true;
  const detail = await response.text();
  if ([400, 409].includes(response.status) && /already exists|duplicate/i.test(detail)) return false;
  throw new Error(`Storage upload HTTP ${response.status}: ${detail.slice(0, 800)}`);
}

export function loadPosRawArtifacts({
  dailyFile = 'output/daily/daily.json',
  readableDir = 'output/sales/readable',
  lastSaleFile = 'output/sales/item-last-sale.json',
} = {}) {
  const candidates = [
    ['daily.json', dailyFile, 'application/json'],
    ['sales_by_business_date.csv', path.join(readableDir, 'sales_by_business_date.csv'), 'text/csv'],
    ['orders_by_dining_option.csv', path.join(readableDir, 'orders_by_dining_option.csv'), 'text/csv'],
    ['item-last-sale.json', lastSaleFile, 'application/json'],
  ];
  return candidates
    .filter(([, filePath]) => fs.existsSync(filePath))
    .map(([logicalName, filePath, mimeType]) => ({
      logicalName,
      mimeType,
      content: fs.readFileSync(filePath),
    }));
}

export async function registerPosRawShadow({
  businessDate,
  artifacts,
  env = process.env,
  fetchImpl = fetch,
}) {
  const baseUrl = (env.R6_SUPABASE_URL || '').replace(/\/$/, '');
  const key = secretFromEnv(env);
  if (!baseUrl || !key) throw new Error('R6_SUPABASE_URL and R6_SUPABASE_SECRET_KEY(_FILE) are required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new Error('businessDate must be YYYY-MM-DD');
  if (!artifacts.length) throw new Error('no POS Raw artifacts are available');

  const inventory = artifacts
    .map((artifact) => ({
      logicalName: artifact.logicalName,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.content.length,
      sha256: sha256(artifact.content),
    }))
    .sort((a, b) => a.logicalName.localeCompare(b.logicalName));
  const manifestSha256 = sha256(Buffer.from(JSON.stringify(inventory)));
  const sourceBatchKey = `pos-daily:${businessDate}:${manifestSha256.slice(0, 20)}`;
  const watermarkFrom = new Date(`${businessDate}T00:00:00+08:00`);
  const watermarkTo = new Date(watermarkFrom.getTime() + 24 * 60 * 60 * 1000);

  const batch = one(await rpc(fetchImpl, baseUrl, key, 'ops_register_raw_batch', {
    p_source_system: 'RES_POS_DAILY',
    p_source_batch_key: sourceBatchKey,
    p_schema_version: 'res-pos-daily-v1',
    p_writer_id: 'res_api:sync-to-db',
    p_store_id: env.R6_STORE_ID || 'HC001',
    p_watermark_from: watermarkFrom.toISOString(),
    p_watermark_to: watermarkTo.toISOString(),
    p_expected_count: inventory.length,
    p_metadata: {
      mode: 'shadow',
      business_date: businessDate,
      manifest_sha256: manifestSha256,
      files: inventory,
    },
  }), 'ops_register_raw_batch');

  let uploadedCount = 0;
  for (const artifact of artifacts) {
    const item = inventory.find((row) => row.logicalName === artifact.logicalName);
    const extension = path.extname(artifact.logicalName).toLowerCase() || '.bin';
    const objectPath = `res_pos_daily/${businessDate.slice(0, 4)}/${businessDate.slice(5, 7)}/${batch.batch_id}/${item.sha256}${extension}`;
    if (await uploadObject(fetchImpl, baseUrl, key, objectPath, artifact)) uploadedCount += 1;
    await rpc(fetchImpl, baseUrl, key, 'ops_register_raw_object', {
      p_batch_id: batch.batch_id,
      p_bucket_id: BUCKET_ID,
      p_object_path: objectPath,
      p_sha256: item.sha256,
      p_size_bytes: item.sizeBytes,
      p_mime_type: item.mimeType,
      p_data_class: 'C1',
      p_source_record_key: artifact.logicalName,
      p_source_version: manifestSha256,
    });
  }

  const completed = one(await rpc(fetchImpl, baseUrl, key, 'ops_complete_raw_batch', {
    p_batch_id: batch.batch_id,
    p_accepted_count: inventory.length,
    p_rejected_count: 0,
    p_pipeline_keys: [],
    p_pipeline_version: 'shadow-v1',
    p_error_summary: null,
  }), 'ops_complete_raw_batch');

  return {
    batchId: batch.batch_id,
    status: completed.status,
    artifactCount: inventory.length,
    uploadedCount,
    manifestSha256,
  };
}

export async function shadowPosRawIfEnabled({ businessDate, env = process.env, fetchImpl = fetch } = {}) {
  if (env.R6_SHADOW_ENABLED !== '1') return null;
  const artifacts = loadPosRawArtifacts();
  return registerPosRawShadow({ businessDate, artifacts, env, fetchImpl });
}
