#!/usr/bin/env node
import 'dotenv/config';

import postgres from 'postgres';

import { registerLegacyPosRawBackfill } from '../lib/r6-shadow.js';

function usage() {
  console.log(
    'Usage: node scripts/backfill-r6-pos-day.js ' +
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

function projectRefFromDatabaseUrl(value) {
  const username = new URL(value).username;
  const ref = username.split('.').at(-1);
  if (!/^[a-z]{20}$/.test(ref || '')) throw new Error('DATABASE_URL does not identify a Supabase project');
  return ref;
}

function projectRefFromApiUrl(value) {
  const ref = new URL(value).hostname.split('.')[0];
  if (!/^[a-z]{20}$/.test(ref || '')) throw new Error('R6_SUPABASE_URL does not identify a Supabase project');
  return ref;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the read-only source');
  if (!process.env.R6_SUPABASE_URL) throw new Error('R6_SUPABASE_URL is required');
  const sourceProjectRef = projectRefFromDatabaseUrl(process.env.DATABASE_URL);
  const targetProjectRef = projectRefFromApiUrl(process.env.R6_SUPABASE_URL);
  if (sourceProjectRef === targetProjectRef) {
    throw new Error('source and target Supabase projects must be different');
  }

  const source = postgres(process.env.DATABASE_URL, {
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 5,
  });
  try {
    const snapshot = await source.begin(async (tx) => {
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
      if (dailyRows.length !== 1) {
        throw new Error(`expected one daily_revenue row, received ${dailyRows.length}`);
      }
      if (hourlyRows.length < 1 || hourlyRows.length > 24) {
        throw new Error(`expected 1 to 24 hourly rows, received ${hourlyRows.length}`);
      }
      return { daily: dailyRows[0], hourly: hourlyRows };
    });
    const syncTimes = snapshot.hourly
      .map((row) => new Date(row.synced_at).getTime())
      .filter(Number.isFinite);
    if (syncTimes.length !== snapshot.hourly.length) {
      throw new Error('hourly source rows contain an invalid synced_at timestamp');
    }
    const exportedAt = new Date(Math.max(...syncTimes)).toISOString();
    const result = await registerLegacyPosRawBackfill({
      businessDate: args.businessDate,
      storeId: args.r6Store,
      sourceProjectRef,
      exportedAt,
      daily: snapshot.daily,
      hourly: snapshot.hourly,
    });
    console.log(JSON.stringify({
      sourceProjectRef,
      targetProjectRef,
      businessDate: args.businessDate,
      batchId: result.batchId,
      status: result.status,
      uploaded: result.uploaded,
      dailyRows: result.dailyRows,
      hourlyRows: result.hourlyRows,
      contentSha256: result.contentSha256,
    }));
  } finally {
    await source.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(`[r6-pos-backfill] ${error.message}`);
  process.exitCode = 1;
});
