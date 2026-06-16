-- Migration 009: Row-Level Security scaffolding + multi-store policies (additive)
-- Run in Supabase SQL Editor. Safe to re-run (guarded policy creation).
--
-- ┌─ WHY THIS IS BEHAVIOR-PRESERVING FOR THE RUNNING APP ───────────────────────┐
-- │ The app reaches Postgres in exactly two privileged ways, BOTH of which       │
-- │ bypass RLS, so enabling RLS here does NOT change any current query result:   │
-- │   1. supabase.ts  -> SUPABASE_SERVICE_KEY = the `service_role` Postgres role, │
-- │      which has the BYPASSRLS attribute. All repository reads/writes keep      │
-- │      working unchanged.                                                       │
-- │   2. postgres.ts  -> DATABASE_URL = the table owner / `postgres` superuser.   │
-- │      Table owners and superusers bypass RLS UNLESS the table is set to        │
-- │      FORCE ROW LEVEL SECURITY. We deliberately use ENABLE (never FORCE), so   │
-- │      the forecast query path is unaffected.                                   │
-- │                                                                               │
-- │ ⚠ DO NOT add `ALTER TABLE ... FORCE ROW LEVEL SECURITY` to any of these       │
-- │   tables: it would apply RLS to the owner connection and immediately deny     │
-- │   every row to postgres.ts (breaking all forecast reads).                     │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- The store-scoped policies below are SCAFFOLDING: they only take effect for a
-- per-user/per-store authenticated role (the `authenticated` Supabase role), which
-- the app does NOT use today. They become enforcing only after a future restructuring
-- step propagates a per-request auth context into the DB session (documented as a
-- restructuring task in SCHEMA-OPTIMIZATION.md). Until then they are dormant.
--
-- Targets the PUBLIC schema (migration 005 not applied; see 007 header).
-- The store predicate uses request.jwt.claims->'store_ids' (a JSON array of store ids
-- the authenticated user may access), matching the multi-store model
-- (users.store_ids TEXT[], employees.store_id, supply_orders.store_id, arrival_records.store_id).

-- ============================================
-- 1. Enable RLS (NOT FORCE) on multi-store + persistence tables.
--    No-op for service_role / owner connections.
-- ============================================
ALTER TABLE IF EXISTS users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS employees        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS employee_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS supply_orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS arrival_records  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS chat_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS session_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pipeline_health  ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. Explicit service_role full-access policy on every RLS-enabled table.
--    Redundant with BYPASSRLS, but makes the intent explicit and protects against
--    a future role that lacks BYPASSRLS but is granted `service_role`.
-- ============================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users', 'employees', 'employee_events', 'supply_orders', 'arrival_records',
    'audit_log', 'chat_history', 'session_state', 'pipeline_health'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = tbl) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'service_role_all'
      ) THEN
        EXECUTE format(
          'CREATE POLICY service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
          tbl
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- ============================================
-- 3. Multi-store SELECT policies for the `authenticated` role (dormant until per-user
--    auth context is wired). store_ids claim is a JSON array of accessible store ids.
-- ============================================

-- users: a user may read their own row, or rows for stores they can access.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='users' AND policyname='users_store_scope') THEN
    CREATE POLICY users_store_scope ON public.users
      FOR SELECT TO authenticated
      USING (
        user_id = current_setting('request.jwt.claims', true)::jsonb->>'user_id'
        OR store_ids && ARRAY(
          SELECT jsonb_array_elements_text(
            COALESCE(current_setting('request.jwt.claims', true)::jsonb->'store_ids', '[]'::jsonb)
          )
        )
      );
  END IF;
END $$;

-- employees: scoped by employees.store_id (NULL store_id is owner/HR-only — excluded for authenticated).
-- Table-guarded: skip when the recruitment tables are absent (e.g. forecast/POS database).
DO $$
BEGIN
  IF to_regclass('public.employees') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='employees' AND policyname='employees_store_scope') THEN
    CREATE POLICY employees_store_scope ON public.employees
      FOR SELECT TO authenticated
      USING (
        store_id = ANY (ARRAY(
          SELECT jsonb_array_elements_text(
            COALESCE(current_setting('request.jwt.claims', true)::jsonb->'store_ids', '[]'::jsonb)
          )
        ))
      );
  END IF;
END $$;

-- employee_events: scoped via the parent employee's store_id.
-- Table-guarded: skip when the recruitment tables are absent.
DO $$
BEGIN
  IF to_regclass('public.employee_events') IS NOT NULL
     AND to_regclass('public.employees') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='employee_events' AND policyname='employee_events_store_scope') THEN
    CREATE POLICY employee_events_store_scope ON public.employee_events
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.employees e
          WHERE e.id = employee_events.employee_id
            AND e.store_id = ANY (ARRAY(
              SELECT jsonb_array_elements_text(
                COALESCE(current_setting('request.jwt.claims', true)::jsonb->'store_ids', '[]'::jsonb)
              )
            ))
        )
      );
  END IF;
END $$;

-- supply_orders: scoped by store_id. Guarded — the store_id column is added by the
-- supply-chain restructuring migration (see SCHEMA-OPTIMIZATION.md); skip until present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='supply_orders' AND column_name='store_id')
     AND NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE schemaname='public' AND tablename='supply_orders' AND policyname='supply_orders_store_scope') THEN
    CREATE POLICY supply_orders_store_scope ON public.supply_orders
      FOR SELECT TO authenticated
      USING (
        store_id = ANY (ARRAY(
          SELECT jsonb_array_elements_text(
            COALESCE(current_setting('request.jwt.claims', true)::jsonb->'store_ids', '[]'::jsonb)
          )
        ))
      );
  END IF;
END $$;

-- arrival_records: scoped by store_id. Guarded for the same reason as supply_orders.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='arrival_records' AND column_name='store_id')
     AND NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE schemaname='public' AND tablename='arrival_records' AND policyname='arrival_records_store_scope') THEN
    CREATE POLICY arrival_records_store_scope ON public.arrival_records
      FOR SELECT TO authenticated
      USING (
        store_id = ANY (ARRAY(
          SELECT jsonb_array_elements_text(
            COALESCE(current_setting('request.jwt.claims', true)::jsonb->'store_ids', '[]'::jsonb)
          )
        ))
      );
  END IF;
END $$;
