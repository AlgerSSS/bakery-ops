-- Migration 007: Performance indexes (additive only)
-- Run in Supabase SQL Editor. Pure CREATE INDEX IF NOT EXISTS — no table changes,
-- no data loss, no query-plan correctness change. Safe to re-run.
--
-- Targets the PUBLIC schema: migration 005 (schema separation) has NOT been applied
-- to the live database (all repositories use unqualified table names and the Supabase
-- client uses the default public schema), so every table below lives in public.
--
-- store_id / order_id indexes on supply_orders and arrival_records are wrapped in a
-- column-existence guard because those columns are MISSING from the committed 003 schema
-- (see SCHEMA-OPTIMIZATION.md — the supply-chain column-set defect). The guard makes
-- each statement a no-op until the paired restructuring migration adds the columns,
-- so 007 stays independently runnable in any order.
--
-- NOTE for large tables in production: prefer CREATE INDEX CONCURRENTLY (cannot run
-- inside a transaction block / the SQL Editor's implicit transaction). The plain
-- CREATE INDEX statements below take a brief lock; acceptable for current data sizes.

-- ============================================
-- employees (recruitment) — listRecent orders by updated_at;
-- findRecentCandidates filters status + orders created_at
-- Table-guarded: the recruitment tables are absent in some deployments (e.g. the
-- forecast/POS database), so skip cleanly when the table does not exist.
-- ============================================
DO $$
BEGIN
  IF to_regclass('public.employees') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_employees_updated_at ON employees (updated_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_employees_status_created ON employees (status, created_at DESC)';
  END IF;
END $$;

-- ============================================
-- employee_events — getByEmployee orders by created_at;
-- getByType filters event_type + orders created_at
-- ============================================
DO $$
BEGIN
  IF to_regclass('public.employee_events') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_employee_events_employee_created ON employee_events (employee_id, created_at DESC)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_employee_events_type_created ON employee_events (event_type, created_at DESC)';
  END IF;
END $$;

-- ============================================
-- supply_orders — every read filters store_id (+ order_date), orders created_at/order_date.
-- Table-guarded; store_id may also not exist yet (003 defect) → additionally column-guarded.
-- ============================================
DO $$
BEGIN
  IF to_regclass('public.supply_orders') IS NOT NULL THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_supply_orders_created_at ON supply_orders (created_at DESC)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'supply_orders' AND column_name = 'store_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_supply_orders_store_date
      ON supply_orders (store_id, order_date);
  END IF;
END $$;

-- ============================================
-- arrival_records — getByDate filters store_id + arrival_date; getByOrderId filters order_id.
-- store_id and order_id may not exist yet (003 defect) → guarded.
-- ============================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'arrival_records' AND column_name = 'store_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_arrival_records_store_date
      ON arrival_records (store_id, arrival_date);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'arrival_records' AND column_name = 'order_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_arrival_records_order_id
      ON arrival_records (order_id);
  END IF;
END $$;
