import { readFileSync } from 'node:fs';

import { enumerateBusinessDates } from './r6-pos-migration.js';

const RANGE_OPTIONS = new Set(['from', 'to', 'old-store', 'r6-store', 'apply', 'help']);

export function parsePosRangeArgs(argv, { allowApply = true } = {}) {
  const parsed = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) throw new Error(`unexpected positional argument ${raw}`);
    const [key, ...parts] = raw.slice(2).split('=');
    if (!RANGE_OPTIONS.has(key) || (key === 'apply' && !allowApply)) {
      throw new Error(`unknown option --${key}`);
    }
    if (['apply', 'help'].includes(key) && raw.includes('=')) {
      throw new Error(`--${key} does not accept a value`);
    }
    if (Object.hasOwn(parsed, key)) throw new Error(`duplicate option --${key}`);
    parsed[key] = parts.join('=');
  }
  if (Object.hasOwn(parsed, 'help')) return { help: true };
  if (!parsed.from || !parsed.to) throw new Error('--from and --to are required');
  enumerateBusinessDates(parsed.from, parsed.to);
  if (!parsed['old-store']?.trim()) throw new Error('--old-store is required');
  if (!parsed['r6-store']?.trim()) throw new Error('--r6-store is required');
  return {
    help: false,
    apply: Object.hasOwn(parsed, 'apply'),
    fromDate: parsed.from,
    toDate: parsed.to,
    oldStore: parsed['old-store'].trim(),
    r6Store: parsed['r6-store'].trim(),
  };
}

export function sourceProjectRef(databaseUrl) {
  const ref = new URL(databaseUrl).username.split('.').at(-1);
  if (!/^[a-z]{20}$/.test(ref || '')) throw new Error('DATABASE_URL does not identify Supabase');
  return ref;
}

export function targetProjectRef(apiUrl) {
  const ref = new URL(apiUrl).hostname.split('.')[0];
  if (!/^[a-z]{20}$/.test(ref || '')) throw new Error('R6_SUPABASE_URL does not identify Supabase');
  return ref;
}

export function r6Secret(env = process.env) {
  if (env.R6_SUPABASE_SECRET_KEY) return env.R6_SUPABASE_SECRET_KEY;
  if (env.R6_SUPABASE_SECRET_KEY_FILE) {
    return readFileSync(env.R6_SUPABASE_SECRET_KEY_FILE, 'utf8').trim();
  }
  throw new Error('R6_SUPABASE_SECRET_KEY(_FILE) is required');
}

export async function readLegacyPosRange(source, args) {
  return source.begin(async (tx) => {
    await tx.unsafe('set transaction read only');
    const [coverage] = await tx`
      select count(*)::int as rows, count(distinct store)::int as stores
      from public.daily_revenue
      where date >= ${args.fromDate} and date <= ${args.toDate}
    `;
    if (coverage.stores > 1) {
      throw new Error(
        'hourly_sales_summary has no store column; a multi-store source range cannot be attributed safely',
      );
    }
    const dailyRows = await tx`
      select date::text as date, store, revenue, transaction_count, gross_sales,
             total_discount, import_source
      from public.daily_revenue
      where date >= ${args.fromDate} and date <= ${args.toDate}
        and store = ${args.oldStore}
      order by date
    `;
    if (coverage.rows > 0 && dailyRows.length === 0) {
      throw new Error('requested old store has no daily rows in a populated source range');
    }
    const hourlyRows = await tx`
      select date::text as date, hour, bill_count, num_of_guests, net_sales,
             gross_sales, total_discount, synced_at
      from public.hourly_sales_summary
      where date >= ${args.fromDate} and date <= ${args.toDate}
      order by date, hour
    `;
    return { dailyRows, hourlyRows };
  });
}

export async function fetchR6MigrationWindow({ args, key, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `${process.env.R6_SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/ops_get_pos_migration_window`,
    {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        p_from_date: args.fromDate,
        p_to_date: args.toDate,
        p_store_id: args.r6Store,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(`R6 migration window HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response.json();
}
