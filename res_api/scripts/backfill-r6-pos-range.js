#!/usr/bin/env node
import 'dotenv/config';

import postgres from 'postgres';

import {
  parsePosRangeArgs,
  r6Secret,
  readLegacyPosRange,
  sourceProjectRef,
  targetProjectRef,
} from '../lib/r6-pos-migration-cli.js';
import { buildLegacyPosMigrationPlan } from '../lib/r6-pos-migration.js';
import {
  registerLegacyPosAnomaly,
  registerLegacyPosRawBackfill,
} from '../lib/r6-shadow.js';

function usage() {
  console.log(
    'Usage: node scripts/backfill-r6-pos-range.js ' +
      '--from=YYYY-MM-DD --to=YYYY-MM-DD --old-store="source store" --r6-store=HC001 [--apply]',
  );
}

async function main() {
  const args = parsePosRangeArgs(process.argv.slice(2));
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
  if (args.apply) r6Secret();

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
  const preview = {
    mode: args.apply ? 'apply' : 'dry-run',
    sourceProjectRef: sourceRef,
    targetProjectRef: targetRef,
    fromDate: args.fromDate,
    toDate: args.toDate,
    ...plan.summary,
    days: plan.entries.map((entry) => ({
      businessDate: entry.businessDate,
      disposition: entry.disposition,
      reasonCode: entry.reasonCode || null,
    })),
  };
  if (!args.apply) {
    console.log(JSON.stringify(preview));
    return;
  }

  const results = [];
  for (const entry of plan.entries) {
    const common = {
      businessDate: entry.businessDate,
      storeId: args.r6Store,
      sourceProjectRef: sourceRef,
      exportedAt: entry.exportedAt,
    };
    const result = entry.disposition === 'PROCESS'
      ? await registerLegacyPosRawBackfill({
        ...common,
        daily: entry.daily,
        hourly: entry.hourly,
      })
      : await registerLegacyPosAnomaly({
        ...common,
        dailyRows: entry.dailyRows,
        hourly: entry.hourly,
        reasonCode: entry.reasonCode,
        reasonSummary: entry.reasonSummary,
      });
    const dayResult = {
      businessDate: entry.businessDate,
      disposition: entry.disposition,
      batchId: result.batchId,
      status: result.status,
      uploaded: result.uploaded,
      reasonCode: entry.reasonCode || null,
    };
    results.push(dayResult);
    console.log(JSON.stringify({ event: 'day-registered', ...dayResult }));
  }
  console.log(JSON.stringify({ event: 'range-registered', ...preview, results }));
}

main().catch((error) => {
  console.error(`[r6-pos-range-backfill] ${error.message}`);
  process.exitCode = 1;
});
