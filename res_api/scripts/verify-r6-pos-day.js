#!/usr/bin/env node
import 'dotenv/config';

import { readFileSync } from 'node:fs';

import postgres from 'postgres';

import { compareLegacyPosWithR6 } from '../lib/r6-shadow.js';

function usage() {
  console.log(
    'Usage: node scripts/verify-r6-pos-day.js ' +
      '--date=YYYY-MM-DD --old-store="source store" --r6-store=HC001',
  );
}

function parseArgs(argv) {
  const args = Object.fromEntries(argv.map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.join('=')];
  }));
  if ('help' in args) return { help: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date || '')) throw new Error('--date must be YYYY-MM-DD');
  if (!args['old-store']?.trim()) throw new Error('--old-store is required');
  if (!args['r6-store']?.trim()) throw new Error('--r6-store is required');
  return {
    help: false,
    businessDate: args.date,
    oldStore: args['old-store'].trim(),
    r6Store: args['r6-store'].trim(),
  };
}

function sourceProjectRef(value) {
  const ref = new URL(value).username.split('.').at(-1);
  if (!/^[a-z]{20}$/.test(ref || '')) throw new Error('DATABASE_URL does not identify Supabase');
  return ref;
}

function targetProjectRef(value) {
  const ref = new URL(value).hostname.split('.')[0];
  if (!/^[a-z]{20}$/.test(ref || '')) throw new Error('R6_SUPABASE_URL does not identify Supabase');
  return ref;
}

function r6Secret() {
  if (process.env.R6_SUPABASE_SECRET_KEY) return process.env.R6_SUPABASE_SECRET_KEY;
  if (process.env.R6_SUPABASE_SECRET_KEY_FILE) {
    return readFileSync(process.env.R6_SUPABASE_SECRET_KEY_FILE, 'utf8').trim();
  }
  throw new Error('R6_SUPABASE_SECRET_KEY(_FILE) is required');
}

async function readSourceSnapshot(source, args) {
  return source.begin(async (tx) => {
    await tx.unsafe('set transaction read only');
    const dailyRows = await tx`
      select date::text as date, store, revenue, transaction_count, gross_sales,
             total_discount, import_source
      from public.daily_revenue
      where date = ${args.businessDate} and store = ${args.oldStore}
    `;
    const hourlyRows = await tx`
      select date::text as date, hour, bill_count, num_of_guests, net_sales,
             gross_sales, total_discount, synced_at
      from public.hourly_sales_summary
      where date = ${args.businessDate}
      order by hour
    `;
    if (dailyRows.length !== 1) throw new Error(`expected one source daily row, got ${dailyRows.length}`);
    if (hourlyRows.length < 1 || hourlyRows.length > 24) {
      throw new Error(`expected 1 to 24 source hourly rows, got ${hourlyRows.length}`);
    }
    return { daily: dailyRows[0], hourly: hourlyRows };
  });
}

async function readR6(args, key) {
  const response = await fetch(`${process.env.R6_SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/ops_get_pos_day_for_reconcile`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_business_date: args.businessDate, p_store_id: args.r6Store }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`R6 reconciliation RPC HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!process.env.DATABASE_URL || !process.env.R6_SUPABASE_URL) {
    throw new Error('DATABASE_URL and R6_SUPABASE_URL are required');
  }
  const sourceRef = sourceProjectRef(process.env.DATABASE_URL);
  const targetRef = targetProjectRef(process.env.R6_SUPABASE_URL);
  if (sourceRef === targetRef) throw new Error('source and target Supabase projects must differ');

  const source = postgres(process.env.DATABASE_URL, {
    max: 1, prepare: false, connect_timeout: 15, idle_timeout: 5,
  });
  try {
    const snapshot = await readSourceSnapshot(source, args);
    const syncTimes = snapshot.hourly.map((row) => new Date(row.synced_at).getTime());
    if (!syncTimes.every(Number.isFinite)) throw new Error('source synced_at timestamp is invalid');
    const exportedAt = new Date(Math.max(...syncTimes)).toISOString();
    const r6 = await readR6(args, r6Secret());
    const comparison = compareLegacyPosWithR6({
      businessDate: args.businessDate,
      storeId: args.r6Store,
      sourceProjectRef: sourceRef,
      exportedAt,
      ...snapshot,
      r6,
    });
    console.log(JSON.stringify({
      ...comparison,
      sourceProjectRef: sourceRef,
      targetProjectRef: targetRef,
      businessDate: args.businessDate,
      sourceHourlyRows: snapshot.hourly.length,
      r6HourlyRows: r6.hourly?.length || 0,
      r6BatchId: r6.daily?.source_batch_id || null,
    }));
    if (!comparison.ok) process.exitCode = 1;
  } finally {
    await source.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(`[r6-pos-verify] ${error.message}`);
  process.exitCode = 1;
});
