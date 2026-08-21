#!/usr/bin/env node
// Reconcile the migrated finance domain in R6 against legacy production.
//
// Row counts alone would pass even if every amount were zero, so this compares both the row
// count and the summed amount per domain, plus the four cost-card levels. Old production is
// read inside an explicitly READ ONLY transaction; R6 is read through the aggregate summary
// and the current views, never by writing anything.
import 'dotenv/config';

import postgres from 'postgres';

function secretFromEnv(env) {
  return env.R6_SUPABASE_SECRET_KEY || env.R6_SUPABASE_SERVICE_KEY || '';
}

async function r6Rpc(baseUrl, key, name, payload = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

// Legacy query per R6 (domain, scope). 全部 is the group-target scope; every other legacy
// table is single-store today.
const DOMAIN_QUERIES = [
  ['PL_METRIC', 'STORE', 'select count(*)::int n, coalesce(sum(amount),0) s from finance_pl_metrics'],
  ['EXPENSE', 'STORE', 'select count(*)::int n, coalesce(sum(amount),0) s from finance_expense'],
  ['LABOR', 'STORE', 'select count(*)::int n, coalesce(sum(amount),0) s from finance_labor_detail'],
  ['MATERIAL', 'STORE', 'select count(*)::int n, coalesce(sum(amount),0) s from finance_material'],
  ['CASHFLOW', 'STORE', 'select count(*)::int n, coalesce(sum(amount),0) s from finance_cashflow'],
  ['TARGET', 'GROUP', "select count(*)::int n, coalesce(sum(amount),0) s from finance_targets where store = '全部'"],
  ['TARGET', 'STORE', "select count(*)::int n, coalesce(sum(amount),0) s from finance_targets where store <> '全部'"],
];

const COST_CARD_QUERIES = [
  ['items', 'select count(*)::int n from cost_card_item'],
  ['prices', 'select count(*)::int n from cost_card_item_price'],
  ['recipes', 'select count(*)::int n from cost_card_recipe'],
  ['recipe_items', 'select count(*)::int n from cost_card_recipe_item'],
];

function money(value) {
  return Number(Number(value).toFixed(2));
}

async function main() {
  const baseUrl = (process.env.R6_SUPABASE_URL || '').replace(/\/$/, '');
  const key = secretFromEnv(process.env);
  if (!baseUrl || !key) throw new Error('R6_SUPABASE_URL and R6_SUPABASE_SECRET_KEY are required');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to read legacy finance data');

  const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 10, prepare: false });
  const mismatches = [];
  const checked = [];

  try {
    const legacy = await sql.begin(async (tx) => {
      await tx`set transaction read only`;
      const domains = {};
      for (const [domain, scope, query] of DOMAIN_QUERIES) {
        const [row] = await tx.unsafe(query);
        domains[`${domain}|${scope}`] = { rows: Number(row.n), amount: money(row.s) };
      }
      const costCards = {};
      for (const [name, query] of COST_CARD_QUERIES) {
        const [row] = await tx.unsafe(query);
        costCards[name] = Number(row.n);
      }
      return { domains, costCards };
    });

    const r6Domains = await r6Rpc(baseUrl, key, 'ops_get_finance_domain_totals');
    const summary = await r6Rpc(baseUrl, key, 'ops_get_finance_summary');

    const actual = Object.fromEntries(
      (r6Domains || []).map((row) => [
        `${row.domain}|${row.store_scope}`,
        { rows: Number(row.rows), amount: money(row.amount) },
      ]),
    );

    for (const [key_, expected] of Object.entries(legacy.domains)) {
      const got = actual[key_];
      checked.push(key_);
      if (!got) {
        mismatches.push(`${key_}: missing in R6 (expected ${expected.rows} rows)`);
        continue;
      }
      if (got.rows !== expected.rows) {
        mismatches.push(`${key_} rows: legacy=${expected.rows} r6=${got.rows}`);
      }
      if (Math.abs(got.amount - expected.amount) > 0.01) {
        mismatches.push(`${key_} amount: legacy=${expected.amount} r6=${got.amount}`);
      }
    }
    for (const key_ of Object.keys(actual)) {
      if (!(key_ in legacy.domains)) mismatches.push(`${key_}: present in R6 but not in legacy`);
    }

    for (const [name, expected] of Object.entries(legacy.costCards)) {
      const got = Number(summary?.cost_cards?.[name] ?? -1);
      checked.push(`cost_cards.${name}`);
      if (got !== expected) mismatches.push(`cost_cards.${name}: legacy=${expected} r6=${got}`);
    }

    for (const [name, count] of Object.entries(summary?.orphans || {})) {
      checked.push(`orphans.${name}`);
      if (Number(count) !== 0) mismatches.push(`orphans.${name}=${count}`);
    }

    const ok = mismatches.length === 0;
    console.log(JSON.stringify({ ok, checked: checked.length, mismatches, legacy, r6: { domains: actual, summary } }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
