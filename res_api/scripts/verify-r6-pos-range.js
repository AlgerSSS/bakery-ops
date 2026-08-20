#!/usr/bin/env node
import 'dotenv/config';

import postgres from 'postgres';

import {
  fetchR6MigrationWindow,
  parsePosRangeArgs,
  r6Secret,
  readLegacyPosRange,
  sourceProjectRef,
  targetProjectRef,
} from '../lib/r6-pos-migration-cli.js';
import {
  buildLegacyPosMigrationPlan,
  compareLegacyPosMigrationPlan,
} from '../lib/r6-pos-migration.js';

function usage() {
  console.log(
    'Usage: node scripts/verify-r6-pos-range.js ' +
      '--from=YYYY-MM-DD --to=YYYY-MM-DD --old-store="source store" --r6-store=HC001',
  );
}

async function main() {
  const args = parsePosRangeArgs(process.argv.slice(2), { allowApply: false });
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
  const key = r6Secret();

  const source = postgres(process.env.DATABASE_URL, {
    max: 1, prepare: false, connect_timeout: 15, idle_timeout: 5,
  });
  let snapshot;
  try {
    snapshot = await readLegacyPosRange(source, args);
  } finally {
    await source.end({ timeout: 5 });
  }
  const plan = buildLegacyPosMigrationPlan({
    fromDate: args.fromDate,
    toDate: args.toDate,
    oldStore: args.oldStore,
    storeId: args.r6Store,
    sourceProjectRef: sourceRef,
    ...snapshot,
  });
  const window = await fetchR6MigrationWindow({ args, key });
  const comparison = compareLegacyPosMigrationPlan({
    plan,
    storeId: args.r6Store,
    sourceProjectRef: sourceRef,
    window,
  });
  console.log(JSON.stringify({
    ...comparison,
    sourceProjectRef: sourceRef,
    targetProjectRef: targetRef,
    fromDate: args.fromDate,
    toDate: args.toDate,
    sourceDailyRows: snapshot.dailyRows.length,
    sourceHourlyRows: snapshot.hourlyRows.length,
    r6DailyRows: window.daily.length,
    r6HourlyRows: window.hourly.length,
    r6LegacyBatches: window.legacy_batches.length,
  }));
  if (!comparison.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[r6-pos-range-verify] ${error.message}`);
  process.exitCode = 1;
});
