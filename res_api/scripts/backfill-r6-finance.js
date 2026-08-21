#!/usr/bin/env node
// Export the legacy finance domain into immutable R6 Raw batches.
//
// Reads old production inside an explicitly READ ONLY transaction, so this script cannot
// modify the live finance data even if it is edited carelessly later. Writing the facts is
// not this script's job: it registers Raw batches, and the finance worker loads them under a
// lease through the controlled RPCs.
import 'dotenv/config';

import postgres from 'postgres';

import {
  COST_CARD_TABLES,
  MONTHLY_TABLES,
  registerFinanceRawExport,
} from '../lib/r6-finance-export.js';

function usage() {
  console.log(
    'Usage: node scripts/backfill-r6-finance.js --r6-store=HC001 [--kind=monthly|cost_card|all] [--dry-run]',
  );
}

function parseArgs(argv) {
  const args = Object.fromEntries(argv.map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=');
    return [key, value.join('=') || 'true'];
  }));
  if ('help' in args) return { help: true };
  const kind = args.kind || 'all';
  if (!['monthly', 'cost_card', 'all'].includes(kind)) {
    throw new Error('--kind must be monthly, cost_card or all');
  }
  if (!args['r6-store']?.trim() || args['r6-store'] === 'true') {
    throw new Error('--r6-store is required');
  }
  return { help: false, kind, r6Store: args['r6-store'].trim(), dryRun: args['dry-run'] === 'true' };
}

function projectRefFromDatabaseUrl(value) {
  const ref = new URL(value).username.split('.').at(-1);
  if (!/^[a-z]{20}$/.test(ref || '')) {
    throw new Error('DATABASE_URL does not identify a Supabase project');
  }
  return ref;
}

async function readTables(sql, tableNames) {
  const tables = {};
  for (const name of tableNames) {
    // Table names come from a module-level allowlist, never from argv.
    const rows = await sql`select * from ${sql(name)}`;
    tables[name] = rows.map((row) => ({ ...row }));
  }
  return tables;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(64);
  }
  if (args.help) return usage();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to read legacy finance data');
  const sourceProjectRef = projectRefFromDatabaseUrl(databaseUrl);

  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10, prepare: false });
  const results = [];
  try {
    const kinds = args.kind === 'all' ? ['monthly', 'cost_card'] : [args.kind];
    for (const kind of kinds) {
      const tableNames = kind === 'monthly' ? MONTHLY_TABLES : COST_CARD_TABLES;
      const tables = await sql.begin(async (tx) => {
        await tx`set transaction read only`;
        return readTables(tx, tableNames);
      });

      const counts = Object.fromEntries(
        Object.entries(tables).map(([name, rows]) => [name, rows.length]),
      );
      const exportedAt = new Date().toISOString();
      console.log(JSON.stringify({ event: 'finance-export-read', kind, counts }));

      if (args.dryRun) {
        results.push({ kind, dryRun: true, counts });
        continue;
      }

      const registered = await registerFinanceRawExport({
        kind,
        storeId: args.r6Store,
        sourceProjectRef,
        exportedAt,
        tables,
        // The monthly domain has no single business day; the watermark records the export
        // instant so replays stay ordered without pretending to a business-date grain.
        watermarkFrom: new Date(Date.parse(exportedAt) - 24 * 60 * 60 * 1000).toISOString(),
        watermarkTo: exportedAt,
      });
      console.log(JSON.stringify({ event: 'finance-export-registered', kind, ...registered, counts }));
      results.push({ kind, ...registered, counts });
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log(JSON.stringify({ ok: true, sourceProjectRef, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
