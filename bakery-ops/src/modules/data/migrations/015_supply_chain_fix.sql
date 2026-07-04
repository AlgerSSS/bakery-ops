-- Migration 015: Supply-chain schema drift fix (idempotent reconciliation)
-- Run in Supabase SQL Editor / via the migration runner. PUBLIC schema. Every statement is
-- guarded (IF NOT EXISTS / DO $$ column + constraint guards) so it is a SAFE NO-OP whether the
-- live DB is in the stale 003 shape, the reconciled 010 shape, or a hand-edited variant.
--
-- WHY: 003_supply_chain_tables.sql is stale documentation — it declares supply_orders /
-- arrival_records with `id SERIAL` + `supplier_name VARCHAR NOT NULL` and none of the columns the
-- repositories actually read/write. 010_consolidate_missing_tables.sql already created these tables
-- (and suppliers) in their reconciled form for a fresh DB, but a live DB provisioned from 003
-- out-of-band can still carry the old column set. This migration reconciles either starting point
-- to the runtime contract used by:
--   - src/modules/data/repositories/supply-order.repository.ts   -> store_id, created_by, sent_at
--   - src/modules/data/repositories/arrival-record.repository.ts -> order_id, store_id, reported_by,
--                                                                    synced_to_inventory
--   - src/modules/data/repositories/supplier.repository.ts       -> suppliers(name, whatsapp_id,
--                                                                    phone, categories, is_active)
-- The repos never write supplier_name, so its NOT NULL constraint is dropped where present.
--
-- VERIFY BEFORE APPLYING (per SCHEMA-OPTIMIZATION.md): dump the live schema first
-- (\d+ public.supply_orders, \d+ public.arrival_records, \d+ public.suppliers) and confirm the
-- id / order_id PK TYPE. SupplyOrderRow.id, ArrivalRecordRow.id and arrival_records.order_id are
-- typed `string` in the repos. If the live DB still has integer (SERIAL) ids, the string typing
-- only works by coercion — migrating to UUID is a SEPARATE data migration (add uuid column, backfill,
-- swap PK, repoint FKs) and is intentionally NOT bundled here. These additive column/constraint
-- guards cannot detect column-TYPE drift.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ============================================
-- supply_orders — add the columns the repo reads/writes; drop the stale supplier_name NOT NULL.
-- Table-guarded so this is a clean no-op on a DB that never created supply_orders.
-- ============================================
DO $$
BEGIN
  IF to_regclass('public.supply_orders') IS NOT NULL THEN
    ALTER TABLE public.supply_orders ADD COLUMN IF NOT EXISTS store_id   TEXT;
    ALTER TABLE public.supply_orders ADD COLUMN IF NOT EXISTS created_by TEXT;
    ALTER TABLE public.supply_orders ADD COLUMN IF NOT EXISTS sent_at    TIMESTAMPTZ;

    -- supplier_name is never written by the repo; drop NOT NULL only if the column exists.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'supply_orders'
        AND column_name = 'supplier_name'
    ) THEN
      ALTER TABLE public.supply_orders ALTER COLUMN supplier_name DROP NOT NULL;
    END IF;
  END IF;
END $$;

-- ============================================
-- arrival_records — add the columns the repo reads/writes; drop the stale supplier_name NOT NULL.
-- synced_to_inventory backfills to FALSE via the column default (historical arrivals were unsynced).
-- ============================================
DO $$
BEGIN
  IF to_regclass('public.arrival_records') IS NOT NULL THEN
    ALTER TABLE public.arrival_records ADD COLUMN IF NOT EXISTS order_id            TEXT;
    ALTER TABLE public.arrival_records ADD COLUMN IF NOT EXISTS store_id            TEXT;
    ALTER TABLE public.arrival_records ADD COLUMN IF NOT EXISTS reported_by         TEXT;
    ALTER TABLE public.arrival_records ADD COLUMN IF NOT EXISTS synced_to_inventory BOOLEAN NOT NULL DEFAULT FALSE;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'arrival_records'
        AND column_name = 'supplier_name'
    ) THEN
      ALTER TABLE public.arrival_records ALTER COLUMN supplier_name DROP NOT NULL;
    END IF;
  END IF;
END $$;

-- ============================================
-- suppliers — supply-chain vendors (supplier.repository.ts). Created idempotently so a DB that never
-- ran 010 gains the table the repo requires. CREATE TABLE IF NOT EXISTS is a safe no-op otherwise.
-- create() sets name + whatsapp_id? + phone? + categories (TEXT[]); getByCategory uses `@>` (GIN);
-- getDefaultSupplier matches whatsapp_id; getAll/getByCategory filter is_active.
--
-- VERIFY the live suppliers.id TYPE before applying — getById/getDefaultSupplier pass string ids via
-- .single(); if the live id is not UUID, align this definition to the live type instead of UUID.
-- ============================================
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

-- getByCategory uses categories @> ARRAY[...] -> GIN; getDefaultSupplier filters whatsapp_id.
-- Index names match 010 verbatim so the two migrations are order-independent no-ops for each other.
CREATE INDEX IF NOT EXISTS idx_suppliers_categories ON public.suppliers USING GIN (categories);
CREATE INDEX IF NOT EXISTS idx_suppliers_whatsapp ON public.suppliers (whatsapp_id);
