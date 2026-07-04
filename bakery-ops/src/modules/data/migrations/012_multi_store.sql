-- Migration 012: Canonical multi-store table + Pavilion seed (additive only)
-- Run in Supabase SQL Editor / via the migration runner. Pure CREATE/ALTER IF NOT EXISTS,
-- guarded seeds, and a guarded FK — safe to re-run, no data loss. PUBLIC schema (migration 005
-- schema-separation has NOT been applied; all repositories use unqualified table names — see 007/008/010).
--
-- WHY: the codebase has only ever modeled a single implicit "pavilion" store via free-form
-- employees.store_id TEXT and users.store_ids TEXT[]. The recruitment funnel (013) needs a canonical
-- store registry to FK against. store_code is a human-readable TEXT PK ('pavilion'), NOT a uuid, so it
-- matches the existing string store ids already stored in users.store_ids / employees.store_id and the
-- APPLY-PAVILION-* QR tokens.
--
-- RLS: ENABLE (never FORCE) + service_role_all + stores_store_scope keyed on the
-- request.jwt.claims->'store_ids' JSON array, mirroring 009. See the 009 header for why this is
-- behavior-preserving (service_role / owner connections bypass RLS).

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ============================================
-- stores — canonical store registry. PK is store_code TEXT (NOT uuid): the existing string store ids
-- (users.store_ids, employees.store_id) and the APPLY-PAVILION-* QR tokens key on it directly.
-- interview_windows holds per-store scheduling availability as JSONB. lark_base_token/lark_table_id
-- let each store point at its own 试工流程跟踪 Lark base/table.
-- ============================================
CREATE TABLE IF NOT EXISTS stores (
  store_code         TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  address            TEXT,
  area               TEXT,
  timezone           TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  manager_user_id    TEXT REFERENCES users(user_id),
  head_chef_user_id  TEXT REFERENCES users(user_id),
  interview_windows  JSONB NOT NULL DEFAULT '{}',
  lark_base_token    TEXT,
  lark_table_id      TEXT,
  active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Seed: store-manager (u_leo) + head-chef (u_chef_pavilion) users. The live DB never ran 001's user
-- seed, so u_leo may be absent — INSERT both (not just UPDATE). role kitchen_manager already exists in
-- UserRole (common.types.ts); the chef is modeled as a kitchen_manager per the owner decision. The
-- ON CONFLICT fills a blank phone without clobbering a real one.
-- ============================================
INSERT INTO users (user_id, phone, name, role, permissions, store_ids) VALUES
  ('u_leo', '60175439502', 'Leo', 'store_manager', '{}', '{pavilion}'),
  ('u_chef_pavilion', '8616606376419', 'Pavilion Head Chef', 'kitchen_manager', '{}', '{pavilion}')
ON CONFLICT (user_id) DO UPDATE
  SET phone = CASE WHEN users.phone = '' OR users.phone IS NULL THEN EXCLUDED.phone ELSE users.phone END,
      updated_at = NOW();

-- ============================================
-- Seed: the Pavilion store row, pointed at its 试工流程跟踪 Lark base/table. ON CONFLICT DO NOTHING.
-- ============================================
INSERT INTO stores (store_code, name, address, area, manager_user_id, head_chef_user_id, lark_base_token, lark_table_id, active) VALUES
  (
    'pavilion',
    'Pavilion',
    'Level 3, Lot C3, 02.00, 3, Jln Bukit Bintang, Bukit Bintang, 55100 Kuala Lumpur, Federal Territory of Kuala Lumpur',
    'Bukit Bintang',
    'u_leo',
    'u_chef_pavilion',
    'QkgDblq0qaLpRhsoWCpjHIoqpvb',
    'tblshCH3Mje9Ol4D',
    TRUE
  )
ON CONFLICT (store_code) DO NOTHING;

-- ============================================
-- Seed: register the legacy '海外项目组' store discovered on the live DB (45 employees carry it) so the
-- employees FK below validates without reassigning data. Not a retail store → active = FALSE.
-- ============================================
INSERT INTO stores (store_code, name, area, active) VALUES
  ('海外项目组', '海外项目组 (Overseas Project Group)', 'Overseas', FALSE)
ON CONFLICT (store_code) DO NOTHING;

-- ============================================
-- Backfill + default + FK for employees.store_id so every employee belongs to a canonical store.
-- Backfill legacy NULLs to 'pavilion' (the only store today), then set the column default, then add a
-- guarded FK to stores(store_code). FK is added only after the backfill so existing rows validate.
-- ============================================
UPDATE employees SET store_id = 'pavilion' WHERE store_id IS NULL;

ALTER TABLE employees ALTER COLUMN store_id SET DEFAULT 'pavilion';

DO $$
BEGIN
  IF to_regclass('public.employees') IS NOT NULL
     AND to_regclass('public.stores') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'employees_store_fk' AND conrelid = 'public.employees'::regclass
     ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_store_fk
      FOREIGN KEY (store_id) REFERENCES public.stores(store_code);
  END IF;
END $$;

-- ============================================
-- RLS: ENABLE (never FORCE) + explicit service_role full access + dormant store-scoped SELECT,
-- mirroring 009. stores is keyed on its own store_code against the store_ids claim.
-- ============================================
ALTER TABLE IF EXISTS stores ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stores' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.stores
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='stores' AND policyname='stores_store_scope') THEN
    CREATE POLICY stores_store_scope ON public.stores
      FOR SELECT TO authenticated
      USING (
        store_code = ANY (ARRAY(
          SELECT jsonb_array_elements_text(
            COALESCE(current_setting('request.jwt.claims', true)::jsonb->'store_ids', '[]'::jsonb)
          )
        ))
      );
  END IF;
END $$;
