# Schema Optimization — Restructuring Tasks (NOT auto-applied)

This document collects schema changes that **restructure existing tables** or require a
**paired code change**, and therefore must NOT be dropped into the auto-applied,
additive migrations (007–009). The live Supabase database cannot be reached from the
build environment, so these changes cannot be verified here. Each task below is written
to be **applied on staging together with its code change, then verified**, before going
to production.

Additive, behavior-preserving changes that *were* shipped as runnable migrations:

- `007_indexes.sql` — performance indexes (guarded for missing columns).
- `008_persistence_tables.sql` — new tables `audit_log`, `chat_history`, `session_state`, `pipeline_health`.
- `009_rls_scaffolding.sql` — RLS enabled (never FORCE) + dormant multi-store policies.

---

## Context: the live schema diverges from the committed migrations

Two facts were established by reading the repositories and DB access layers:

1. **Migration 005 (schema separation) has NOT been applied to the live DB.**
   Every repository uses unqualified table names — `supabase.from("employees")`,
   `query("... FROM product")` — and neither `supabase.ts` (default schema) nor
   `postgres.ts` sets a non-`public` search path. Migration 006 also runs an unqualified
   `ALTER TABLE employees`. So **all tables live in `public`**, not in the
   `recruitment`/`supplychain`/`forecast` schemas that 005 would have created.
   → All migrations and tasks here target `public`.

2. **The committed supply-chain schema (003) is stale** — it does not match the
   repositories that read/write those tables (Tasks 1 and 2 below).

> **Before applying any task below, dump the live schema first**
> (`\d+ public.supply_orders`, `\d+ public.arrival_records`, `\d+ public.suppliers`)
> and reconcile these statements to reality. The running app implies the live DB already
> has the columns the repos use, so several `ADD COLUMN IF NOT EXISTS` statements may be
> no-ops — that is expected and safe. The risk is **column-type drift** (especially the
> `id` PK type), which the additive guards cannot detect.

---

## Task 1 — Reconcile `supply_orders` / `arrival_records` columns with the repositories

**Severity: high. Restructure + verify against live DB.**

### Problem

`003_supply_chain_tables.sql` defines:

- `supply_orders(id SERIAL, supplier_name VARCHAR NOT NULL, order_date, items, status, notes, …)`
- `arrival_records(id SERIAL, supplier_name VARCHAR NOT NULL, arrival_date, items, notes, …)`

But the repositories (`supply-order.repository.ts`, `arrival-record.repository.ts`) and the
domain types (`domain/supplychain/types.ts`) use a different column set:

- `supply_orders` reads/writes `store_id`, `created_by`, `sent_at`; **never** writes
  `supplier_name` (which is `NOT NULL` in 003). `SupplyOrderRow.id` is typed `string`,
  not the integer a `SERIAL` produces.
- `arrival_records` reads/writes `order_id`, `store_id`, `reported_by`,
  `synced_to_inventory`; **never** writes `supplier_name`. `ArrivalRecordRow.id` and
  `order_id` are typed `string`.

Because the app runs, the **live DB must already have a hand-edited schema** that matches
the repos. The committed 003 is therefore stale documentation. The fix is to make the
committed schema match reality — but `id`/`order_id` types must be confirmed against the
live DB before committing (the repos assume string/UUID ids).

### Migration SQL (apply on staging, after verifying live schema)

```sql
-- 010_supply_chain_fix.sql  (DO NOT auto-apply)
-- Reconcile supply_orders / arrival_records to the columns the repositories use.
-- Verify column TYPES against the live DB first — esp. the id / order_id PK type.

-- supply_orders
ALTER TABLE public.supply_orders ADD COLUMN IF NOT EXISTS store_id   TEXT;
ALTER TABLE public.supply_orders ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE public.supply_orders ADD COLUMN IF NOT EXISTS sent_at    TIMESTAMPTZ;
-- supplier_name is never written by the repo:
ALTER TABLE public.supply_orders ALTER COLUMN supplier_name DROP NOT NULL;

-- arrival_records
ALTER TABLE public.arrival_records ADD COLUMN IF NOT EXISTS order_id            TEXT;
ALTER TABLE public.arrival_records ADD COLUMN IF NOT EXISTS store_id            TEXT;
ALTER TABLE public.arrival_records ADD COLUMN IF NOT EXISTS reported_by         TEXT;
ALTER TABLE public.arrival_records ADD COLUMN IF NOT EXISTS synced_to_inventory BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.arrival_records ALTER COLUMN supplier_name DROP NOT NULL;
```

> **id / order_id type:** `SupplyOrderRow.id`, `ArrivalRecordRow.id`, and
> `arrival_records.order_id` are typed `string` in the repos, while 003 declares
> `id SERIAL` (integer). If the live DB still has integer `id`s, the string typing only
> works by coercion and is fragile. **Decide on staging** whether to keep `SERIAL`
> (integer ids that the repo stringifies) or migrate to UUID. If migrating to UUID, that
> is a separate data migration (add `uuid` column, backfill, swap PK, repoint FKs) — do
> not bundle it with the column adds above.

### Data-migration step

- For any existing rows where `supplier_name` was `NOT NULL` and now becomes nullable: no
  backfill needed (the column is simply no longer required).
- `synced_to_inventory` backfills to `FALSE` via the column default — confirm that matches
  the desired meaning for historical arrivals (they were never synced).
- If `store_id` is newly added on a live DB that had data without it, backfill from the
  known single store: `UPDATE public.supply_orders SET store_id = 'pavilion' WHERE store_id IS NULL;`
  (and the same for `arrival_records`) — only if the live data is single-store.

### Paired repository code changes

None required if the live DB already matches the repos (most likely). The repos already
read/write the reconciled columns. The only code-side follow-up:

- After this migration, re-enable the guarded indexes in `007_indexes.sql`
  (`idx_supply_orders_store_date`, `idx_arrival_records_store_date`,
  `idx_arrival_records_order_id`) — they auto-activate on the next run of 007 once
  `store_id` / `order_id` exist (the guards detect the columns). No code change.
- Re-run `009_rls_scaffolding.sql` so the guarded `supply_orders_store_scope` /
  `arrival_records_store_scope` policies get created.

**Apply on staging together, then verify:** create an order via the supply-order skill,
confirm `store_id`/`created_by` persist; record an arrival, confirm `order_id`/`reported_by`/
`synced_to_inventory` persist and `markSynced` flips the flag.

---

## Task 2 — Create the missing `suppliers` table

**Severity: high. The committed migrations cannot stand up a working supply-chain DB.**

### Problem

`supplier.repository.ts` reads/writes a `suppliers` table
(`create`, `getAll`, `getByCategory`, `getById`, `getDefaultSupplier`). **No migration
creates it** — the only reference is `005`'s `ALTER TABLE IF EXISTS suppliers SET SCHEMA
supplychain` (and 005 was never applied). The table must have been created out-of-band on
the live DB. Add the definition so the committed migrations are self-sufficient.

`SupplierRow` columns: `id` (string), `name`, `whatsapp_id?`, `phone?`,
`categories: string[]`, `is_active: boolean`, `created_at`, `updated_at`.

### Migration SQL (apply on staging, after verifying live schema)

```sql
-- 010_supply_chain_fix.sql (continued) — DO NOT auto-apply
CREATE TABLE IF NOT EXISTS public.suppliers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  whatsapp_id TEXT,
  phone       TEXT,
  categories  TEXT[] NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- getByCategory uses .contains("categories", [...]) -> GIN
CREATE INDEX IF NOT EXISTS idx_suppliers_categories ON public.suppliers USING GIN (categories);
-- getDefaultSupplier filters whatsapp_id
CREATE INDEX IF NOT EXISTS idx_suppliers_whatsapp ON public.suppliers (whatsapp_id);
```

> **Verify the live `suppliers.id` type before committing.** `getById` /
> `getDefaultSupplier` use `.single()` and pass string ids; if the live `id` is not UUID,
> align this definition to the live type rather than blindly using UUID.

### Data-migration step

`CREATE TABLE IF NOT EXISTS` is a safe no-op against the existing live table. The two
indexes are additive. No row backfill.

### Paired repository code changes

None. `supplier.repository.ts` already matches `SupplierRow`. If RLS is later enforced for
authenticated users, add a `service_role_all` policy + a store/category policy here too.

---

## Task 3 — Make the RLS policies in `009` actually enforce (auth-context wiring)

**Severity: medium. Multi-step, behavior-changing. Out of scope for additive migrations.**

### Problem

`009_rls_scaffolding.sql` enables RLS (never FORCE) and creates **dormant** multi-store
policies. They are dormant because the app connects only as `service_role` (BYPASSRLS) and
the table-owner (bypasses non-FORCE RLS). Nothing today passes a per-user/per-store auth
context into the DB session, so the `authenticated`-role policies never apply.

To make RLS *enforce* (so a store manager can only see their store's rows), three paired
changes are required — all behavior-changing, hence staged + verified together:

### Steps

1. **Propagate a per-request auth context into the DB session.** Either:
   - issue per-user Supabase JWTs (with a `store_ids` claim) and run user-facing reads via
     an `authenticated`-role client instead of the service-role client; or
   - for the `postgres.ts` path, `SET LOCAL request.jwt.claims = '{"user_id":...,"store_ids":[...]}'`
     at the start of each per-user transaction (the policies already read
     `current_setting('request.jwt.claims', true)`).
2. **Split the app's DB access by audience.** Keep service-role/owner access for
   background jobs and imports (forecast pipeline, Lark sync). Route user-facing,
   store-scoped reads through the authenticated path so policies apply.
3. **Add the missing write (INSERT/UPDATE/DELETE) policies.** `009` ships SELECT policies
   only; enforcing writes needs `FOR INSERT/UPDATE/DELETE` policies with matching
   `WITH CHECK` predicates per table.

### Why not now

Enabling enforcement without steps 1–2 would either be a silent no-op (service role) or,
if `FORCE` were used, immediately deny all rows on the `postgres.ts` path and break every
forecast query. `009` is deliberately limited to the safe, dormant scaffolding.

**Verify on staging:** with a store-scoped JWT, confirm a user sees only their
`store_ids` rows in `users`/`employees`/`supply_orders`/`arrival_records`, while the
service-role background paths (imports, sync) still see everything.

---

## Shipped follow-ups: `015` / `016`

These two migration files now carry the schema-drift fixes described above, written so they
are safe against a live DB that diverges from the committed migrations.

- **`015_supply_chain_fix.sql`** — idempotent reconciliation of the supply-chain schema (Tasks
  1 and 2 above). Adds `store_id`/`created_by`/`sent_at` to `supply_orders`, adds
  `order_id`/`store_id`/`reported_by`/`synced_to_inventory` to `arrival_records`, drops the stale
  `supplier_name NOT NULL` on both (only where the column exists), and creates the `suppliers`
  table (UUID id, `name`, `whatsapp_id`, `phone`, `categories TEXT[]`, `is_active`, timestamps)
  with a GIN index on `categories` and a btree index on `whatsapp_id`. Every statement is guarded
  (`to_regclass` table guards, `information_schema.columns` column guards, `IF NOT EXISTS`), so it
  is a no-op whether the live DB is in the 003-stale shape, the reconciled 010 shape, or
  hand-edited. **Note:** `010_consolidate_missing_tables.sql` already creates these tables in their
  reconciled form for a fresh DB; `015` exists to repair a live DB provisioned from the stale 003.
  **Verify the `id`/`order_id` PK TYPE against the live DB before applying** — the additive guards
  cannot detect column-type drift, and a SERIAL→UUID change is a separate data migration.

- **`016_drop_recruitment_runs.sql`** — `DROP TABLE IF EXISTS public.recruitment_runs;`.
  Superseded by 013's `applications`/`job_openings` funnel; the old AJobThing crawl/score flow that
  used it has been removed and no repository references it. **DESTRUCTIVE — NOT auto-applied; the
  owner runs it manually** after confirming the table holds no needed rows.
