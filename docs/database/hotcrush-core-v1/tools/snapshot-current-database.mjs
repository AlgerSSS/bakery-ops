#!/usr/bin/env node

/**
 * Capture a metadata-only snapshot of the current HOT CRUSH production schema.
 *
 * Safety properties:
 * - runs SELECT statements only;
 * - never serializes the connection string or sample business/PII values;
 * - records exact row counts plus structural metadata needed by the design audit.
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dotenv = require("../../../../bakery-ops/node_modules/dotenv");
const postgres = require("../../../../bakery-ops/node_modules/postgres");

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
dotenv.config({ path: resolve(repoRoot, "bakery-ops/.env"), quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured in bakery-ops/.env");
}

const outputPath = resolve(here, "../evidence/current-schema-snapshot.json");
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  idle_timeout: 5,
  connect_timeout: 15,
});

async function capture() {
  const [identity] = await sql`
    select
      current_database() as database_name,
      current_user as database_role,
      current_setting('server_version') as server_version,
      now() as captured_at
  `;

  const objects = await sql`
    select
      c.oid::bigint as object_oid,
      n.nspname as schema_name,
      c.relname as object_name,
      case c.relkind
        when 'r' then 'table'
        when 'v' then 'view'
        when 'm' then 'materialized_view'
      end as object_type,
      obj_description(c.oid, 'pg_class') as object_comment,
      c.reltuples::bigint as estimated_rows,
      pg_total_relation_size(c.oid)::bigint as total_bytes,
      c.relrowsecurity as rls_enabled,
      c.relforcerowsecurity as rls_forced
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'v', 'm')
    order by object_type, object_name
  `;

  const columns = await sql`
    select
      c.relname as object_name,
      a.attnum as ordinal_position,
      a.attname as column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
      not a.attnotnull as is_nullable,
      pg_get_expr(ad.adbin, ad.adrelid) as column_default,
      a.attidentity as identity_kind,
      a.attgenerated as generated_kind,
      col_description(a.attrelid, a.attnum) as column_comment
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
    where n.nspname = 'public'
      and c.relkind in ('r', 'v', 'm')
      and a.attnum > 0
      and not a.attisdropped
    order by c.relname, a.attnum
  `;

  const constraints = await sql`
    select
      c.relname as table_name,
      con.conname as constraint_name,
      case con.contype
        when 'p' then 'primary_key'
        when 'f' then 'foreign_key'
        when 'u' then 'unique'
        when 'c' then 'check'
        when 'x' then 'exclusion'
        else con.contype::text
      end as constraint_type,
      pg_get_constraintdef(con.oid, true) as definition,
      rc.relname as referenced_table,
      con.convalidated as is_validated,
      con.condeferrable as is_deferrable,
      con.condeferred as initially_deferred
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_class rc on rc.oid = con.confrelid
    where n.nspname = 'public'
    order by c.relname, constraint_type, con.conname
  `;

  const indexes = await sql`
    select
      t.relname as table_name,
      i.relname as index_name,
      ix.indisprimary as is_primary,
      ix.indisunique as is_unique,
      ix.indisvalid as is_valid,
      pg_get_indexdef(i.oid) as definition
    from pg_index ix
    join pg_class t on t.oid = ix.indrelid
    join pg_class i on i.oid = ix.indexrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
    order by t.relname, i.relname
  `;

  const triggers = await sql`
    select
      c.relname as table_name,
      t.tgname as trigger_name,
      pg_get_triggerdef(t.oid, true) as definition,
      t.tgenabled as enabled_state
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
    order by c.relname, t.tgname
  `;

  const policies = await sql`
    select
      tablename as table_name,
      policyname as policy_name,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    from pg_policies
    where schemaname = 'public'
    order by tablename, policyname
  `;

  const views = await sql`
    select
      c.relname as view_name,
      pg_get_viewdef(c.oid, true) as definition
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')
    order by c.relname
  `;

  const rowCounts = [];
  for (const object of objects.filter((item) => item.object_type === "table")) {
    const quotedTableName = `"${object.object_name.replaceAll('"', '""')}"`;
    const result = await sql.unsafe(
      `select count(*)::bigint as row_count from public.${quotedTableName}`,
    );
    rowCounts.push({ table_name: object.object_name, row_count: result[0].row_count });
  }

  const snapshot = {
    snapshot_version: 1,
    purpose: "Metadata-only evidence for the HOT CRUSH Core V1 design review",
    identity,
    summary: {
      table_count: objects.filter((item) => item.object_type === "table").length,
      view_count: objects.filter((item) => item.object_type === "view").length,
      materialized_view_count: objects.filter((item) => item.object_type === "materialized_view").length,
      column_count: columns.length,
      constraint_count: constraints.length,
      index_count: indexes.length,
      trigger_count: triggers.length,
      policy_count: policies.length,
    },
    objects,
    columns,
    constraints,
    indexes,
    triggers,
    policies,
    views,
    row_counts: rowCounts,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(
    `wrote ${outputPath}: ${snapshot.summary.table_count} tables, ` +
      `${snapshot.summary.view_count} views, ${snapshot.summary.column_count} columns`,
  );
}

try {
  await capture();
} finally {
  await sql.end({ timeout: 5 });
}
