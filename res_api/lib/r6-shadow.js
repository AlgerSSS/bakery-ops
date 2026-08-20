import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BUCKET_ID = 'raw-business-private';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function number(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be finite`);
  return parsed;
}

function count(value, field) {
  const parsed = number(value, field);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${field} must be a non-negative integer`);
  return parsed;
}

function assertMoneyEqual(field, dailyValue, hourlyValue) {
  if (Math.abs(dailyValue - hourlyValue) > 0.02) {
    throw new Error(`${field} mismatch: daily=${dailyValue} hourly=${hourlyValue}`);
  }
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
    p_pipeline_keys: ['pos_daily_sales'],
    p_pipeline_version: 'pos-v1',
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

export function buildLegacyPosExport({
  businessDate,
  storeId,
  sourceProjectRef,
  exportedAt,
  daily,
  hourly,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new Error('businessDate must be YYYY-MM-DD');
  if (!storeId?.trim()) throw new Error('storeId is required');
  if (!/^[a-z]{20}$/.test(sourceProjectRef)) throw new Error('sourceProjectRef is invalid');
  const exportedAtIso = new Date(exportedAt).toISOString();
  if (!daily || daily.date !== businessDate || !daily.store) throw new Error('one final daily source row is required');
  if (!Array.isArray(hourly) || hourly.length < 1 || hourly.length > 24) {
    throw new Error('1 to 24 final hourly source rows are required');
  }

  const seenHours = new Set();
  const normalizedHours = hourly.map((row) => {
    if (row.date !== businessDate) throw new Error('hourly date does not match businessDate');
    const hour = count(row.hour, 'hour');
    if (hour > 23 || seenHours.has(hour)) throw new Error(`invalid or duplicate hour ${hour}`);
    seenHours.add(hour);
    return {
      sales_hour: hour,
      bill_count: count(row.bill_count, 'hourly bill_count'),
      guest_count: count(row.num_of_guests, 'hourly num_of_guests'),
      gross_sales: number(row.gross_sales, 'hourly gross_sales'),
      discount_amount: number(row.total_discount, 'hourly total_discount'),
      net_sales: number(row.net_sales, 'hourly net_sales'),
      raw_record: { source_table: 'hourly_sales_summary', row },
    };
  }).sort((a, b) => a.sales_hour - b.sales_hour);

  const hourlyTotals = normalizedHours.reduce(
    (total, row) => ({
      billCount: total.billCount + row.bill_count,
      guestCount: total.guestCount + row.guest_count,
      grossSales: total.grossSales + row.gross_sales,
      discountAmount: total.discountAmount + row.discount_amount,
      netSales: total.netSales + row.net_sales,
    }),
    { billCount: 0, guestCount: 0, grossSales: 0, discountAmount: 0, netSales: 0 },
  );
  const dailyBillCount = count(daily.transaction_count, 'daily transaction_count');
  if (dailyBillCount !== hourlyTotals.billCount) {
    throw new Error(`bill_count mismatch: daily=${dailyBillCount} hourly=${hourlyTotals.billCount}`);
  }
  const dailyGrossSales = number(daily.gross_sales, 'daily gross_sales');
  const dailyDiscount = number(daily.total_discount, 'daily total_discount');
  const dailyNetSales = number(daily.revenue, 'daily revenue');
  assertMoneyEqual('gross_sales', dailyGrossSales, hourlyTotals.grossSales);
  assertMoneyEqual('discount_amount', dailyDiscount, hourlyTotals.discountAmount);
  assertMoneyEqual('net_sales', dailyNetSales, hourlyTotals.netSales);

  return Buffer.from(JSON.stringify({
    schema_version: 'legacy-pos-export-v1',
    source_project_ref: sourceProjectRef,
    exported_at: exportedAtIso,
    business_date: businessDate,
    store_id: storeId.trim(),
    daily: {
      store_name_source: String(daily.store).trim(),
      bill_count: dailyBillCount,
      guest_count: hourlyTotals.guestCount,
      gross_sales: dailyGrossSales,
      discount_amount: dailyDiscount,
      net_sales: dailyNetSales,
      total_payment_received: null,
      raw_record: {
        source_table: 'daily_revenue',
        guest_count_source: 'hourly_sales_summary_sum',
        row: daily,
      },
    },
    hourly: normalizedHours,
  }));
}

export function buildLegacyPosAnomaly({
  businessDate,
  storeId,
  sourceProjectRef,
  exportedAt,
  dailyRows,
  hourly,
  reasonCode,
  reasonSummary,
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new Error('businessDate must be YYYY-MM-DD');
  if (!storeId?.trim()) throw new Error('storeId is required');
  if (!/^[a-z]{20}$/.test(sourceProjectRef)) throw new Error('sourceProjectRef is invalid');
  if (!/^[A-Z][A-Z0-9_]{2,119}$/.test(reasonCode || '')) throw new Error('reasonCode is invalid');
  if (!reasonSummary?.trim()) throw new Error('reasonSummary is required');
  if (!Array.isArray(dailyRows) || dailyRows.length > 100) throw new Error('dailyRows must contain at most 100 rows');
  if (!Array.isArray(hourly) || hourly.length > 1000) throw new Error('hourly must contain at most 1000 rows');
  for (const row of [...dailyRows, ...hourly]) {
    if (row.date !== businessDate) throw new Error('anomaly source date does not match businessDate');
  }

  return Buffer.from(JSON.stringify({
    schema_version: 'legacy-pos-anomaly-v1',
    source_project_ref: sourceProjectRef,
    exported_at: new Date(exportedAt).toISOString(),
    business_date: businessDate,
    store_id: storeId.trim(),
    reason_code: reasonCode,
    reason_summary: reasonSummary.trim().slice(0, 1900),
    daily_rows: dailyRows,
    hourly_rows: hourly,
  }));
}

export async function registerLegacyPosAnomaly({
  businessDate,
  storeId,
  sourceProjectRef,
  exportedAt,
  dailyRows,
  hourly,
  reasonCode,
  reasonSummary,
  env = process.env,
  fetchImpl = fetch,
}) {
  const baseUrl = (env.R6_SUPABASE_URL || '').replace(/\/$/, '');
  const key = secretFromEnv(env);
  if (!baseUrl || !key) throw new Error('R6_SUPABASE_URL and R6_SUPABASE_SECRET_KEY(_FILE) are required');
  const content = buildLegacyPosAnomaly({
    businessDate,
    storeId,
    sourceProjectRef,
    exportedAt,
    dailyRows,
    hourly,
    reasonCode,
    reasonSummary,
  });
  const contentSha256 = sha256(content);
  const watermarkFrom = new Date(`${businessDate}T00:00:00+08:00`);
  const watermarkTo = new Date(watermarkFrom.getTime() + 24 * 60 * 60 * 1000);
  const sourceBatchKey = `legacy-pos-anomaly:${businessDate}:${storeId}:${contentSha256.slice(0, 20)}`;
  const batch = one(await rpc(fetchImpl, baseUrl, key, 'ops_register_raw_batch', {
    p_source_system: 'LEGACY_POS_ANOMALY',
    p_source_batch_key: sourceBatchKey,
    p_schema_version: 'legacy-pos-anomaly-v1',
    p_writer_id: 'res_api:legacy-pos-backfill',
    p_store_id: storeId,
    p_watermark_from: watermarkFrom.toISOString(),
    p_watermark_to: watermarkTo.toISOString(),
    p_expected_count: 1,
    p_metadata: {
      mode: 'one-shot-backfill-anomaly',
      business_date: businessDate,
      source_project_ref: sourceProjectRef,
      reason_code: reasonCode,
      health_impact: 'acknowledged_source_quality',
      artifact_sha256: contentSha256,
    },
  }), 'ops_register_raw_batch');
  const objectPath = `legacy_pos_anomaly/${businessDate.slice(0, 4)}/${businessDate.slice(5, 7)}/${batch.batch_id}/${contentSha256}.json`;
  const uploaded = await uploadObject(fetchImpl, baseUrl, key, objectPath, {
    mimeType: 'application/json', content,
  });
  await rpc(fetchImpl, baseUrl, key, 'ops_register_raw_object', {
    p_batch_id: batch.batch_id,
    p_bucket_id: BUCKET_ID,
    p_object_path: objectPath,
    p_sha256: contentSha256,
    p_size_bytes: content.length,
    p_mime_type: 'application/json',
    p_data_class: 'C1',
    p_source_record_key: 'legacy_pos_anomaly.json',
    p_source_version: contentSha256,
  });

  let status = batch.status;
  if (status !== 'QUARANTINED') {
    if (status && status !== 'RECEIVING') {
      throw new Error(`legacy anomaly batch has unexpected status ${status}`);
    }
    const completed = one(await rpc(fetchImpl, baseUrl, key, 'ops_complete_raw_batch', {
      p_batch_id: batch.batch_id,
      p_accepted_count: 0,
      p_rejected_count: 1,
      p_pipeline_keys: [],
      p_pipeline_version: 'pos-anomaly-v1',
      p_error_summary: `${reasonCode}: ${reasonSummary.trim()}`.slice(0, 2000),
    }), 'ops_complete_raw_batch');
    status = completed.status;
  }
  return {
    batchId: batch.batch_id,
    status,
    objectPath,
    contentSha256,
    uploaded,
    reasonCode,
  };
}

export async function registerLegacyPosRawBackfill({
  businessDate,
  storeId,
  sourceProjectRef,
  exportedAt,
  daily,
  hourly,
  env = process.env,
  fetchImpl = fetch,
}) {
  const baseUrl = (env.R6_SUPABASE_URL || '').replace(/\/$/, '');
  const key = secretFromEnv(env);
  if (!baseUrl || !key) throw new Error('R6_SUPABASE_URL and R6_SUPABASE_SECRET_KEY(_FILE) are required');
  const content = buildLegacyPosExport({
    businessDate, storeId, sourceProjectRef, exportedAt, daily, hourly,
  });
  const contentSha256 = sha256(content);
  const watermarkFrom = new Date(`${businessDate}T00:00:00+08:00`);
  const watermarkTo = new Date(watermarkFrom.getTime() + 24 * 60 * 60 * 1000);
  const sourceBatchKey = `legacy-pos:${businessDate}:${storeId}:${contentSha256.slice(0, 20)}`;
  const batch = one(await rpc(fetchImpl, baseUrl, key, 'ops_register_raw_batch', {
    p_source_system: 'LEGACY_POS_EXPORT',
    p_source_batch_key: sourceBatchKey,
    p_schema_version: 'legacy-pos-export-v1',
    p_writer_id: 'res_api:legacy-pos-backfill',
    p_store_id: storeId,
    p_watermark_from: watermarkFrom.toISOString(),
    p_watermark_to: watermarkTo.toISOString(),
    p_expected_count: 1,
    p_metadata: {
      mode: 'one-shot-backfill',
      business_date: businessDate,
      source_project_ref: sourceProjectRef,
      artifact_sha256: contentSha256,
    },
  }), 'ops_register_raw_batch');
  const objectPath = `legacy_pos_export/${businessDate.slice(0, 4)}/${businessDate.slice(5, 7)}/${batch.batch_id}/${contentSha256}.json`;
  const uploaded = await uploadObject(fetchImpl, baseUrl, key, objectPath, {
    mimeType: 'application/json', content,
  });
  await rpc(fetchImpl, baseUrl, key, 'ops_register_raw_object', {
    p_batch_id: batch.batch_id,
    p_bucket_id: BUCKET_ID,
    p_object_path: objectPath,
    p_sha256: contentSha256,
    p_size_bytes: content.length,
    p_mime_type: 'application/json',
    p_data_class: 'C1',
    p_source_record_key: 'legacy_pos_export.json',
    p_source_version: contentSha256,
  });
  const completed = one(await rpc(fetchImpl, baseUrl, key, 'ops_complete_raw_batch', {
    p_batch_id: batch.batch_id,
    p_accepted_count: 1,
    p_rejected_count: 0,
    p_pipeline_keys: ['pos_daily_sales'],
    p_pipeline_version: 'pos-backfill-v1',
    p_error_summary: null,
  }), 'ops_complete_raw_batch');
  return {
    batchId: batch.batch_id,
    status: completed.status,
    objectPath,
    contentSha256,
    uploaded,
    dailyRows: 1,
    hourlyRows: hourly.length,
  };
}

export function compareLegacyPosWithR6({
  businessDate,
  storeId,
  sourceProjectRef,
  exportedAt,
  daily,
  hourly,
  r6,
}) {
  const expected = JSON.parse(buildLegacyPosExport({
    businessDate, storeId, sourceProjectRef, exportedAt, daily, hourly,
  }));
  const mismatches = [];
  const actualDaily = r6?.daily;
  if (!actualDaily) {
    mismatches.push('daily row missing');
  } else {
    for (const field of ['business_date', 'store_id', 'store_name_source']) {
      const wanted = field === 'business_date'
        ? expected.business_date
        : field === 'store_id' ? expected.store_id : expected.daily[field];
      if (actualDaily[field] !== wanted) {
        mismatches.push(`daily ${field}: expected=${wanted} actual=${actualDaily[field]}`);
      }
    }
    for (const field of ['bill_count', 'guest_count']) {
      if (Number(actualDaily[field]) !== Number(expected.daily[field])) {
        mismatches.push(`daily ${field}: expected=${expected.daily[field]} actual=${actualDaily[field]}`);
      }
    }
    for (const field of ['gross_sales', 'discount_amount', 'net_sales']) {
      if (Math.abs(Number(actualDaily[field]) - Number(expected.daily[field])) > 0.02) {
        mismatches.push(`daily ${field}: expected=${expected.daily[field]} actual=${actualDaily[field]}`);
      }
    }
    if (actualDaily.total_payment_received !== null) {
      mismatches.push(`daily total_payment_received: expected=null actual=${actualDaily.total_payment_received}`);
    }
  }

  const actualHours = new Map((r6?.hourly || []).map((row) => [Number(row.sales_hour), row]));
  if (actualHours.size !== expected.hourly.length) {
    mismatches.push(`hourly row count: expected=${expected.hourly.length} actual=${actualHours.size}`);
  }
  for (const wanted of expected.hourly) {
    const actual = actualHours.get(wanted.sales_hour);
    if (!actual) {
      mismatches.push(`hour ${wanted.sales_hour} missing`);
      continue;
    }
    for (const field of ['bill_count', 'guest_count']) {
      if (Number(actual[field]) !== Number(wanted[field])) {
        mismatches.push(`hour ${wanted.sales_hour} ${field}: expected=${wanted[field]} actual=${actual[field]}`);
      }
    }
    for (const field of ['gross_sales', 'discount_amount', 'net_sales']) {
      if (Math.abs(Number(actual[field]) - Number(wanted[field])) > 0.02) {
        mismatches.push(`hour ${wanted.sales_hour} ${field}: expected=${wanted[field]} actual=${actual[field]}`);
      }
    }
  }
  return { ok: mismatches.length === 0, mismatchCount: mismatches.length, mismatches };
}
