-- Migration 010: Consolidate missing repository tables into the single target DB (additive only)
-- Run in Supabase SQL Editor / via the migration runner. Pure CREATE TABLE/INDEX IF NOT EXISTS —
-- no changes to existing tables, no data loss, safe to re-run. Created in the PUBLIC schema
-- (migration 005 schema-separation has NOT been applied; all repositories use unqualified table
-- names — see 007/008 headers).
--
-- WHY: nine repositories under src/modules/data/repositories still target a now-deleted Supabase
-- project. These tables back them so they work against the single consolidated forecast DB. The
-- DDL is reconciled to what each REPO actually reads/writes (the runtime contract), which for the
-- supply-chain tables DIFFERS from the obsolete 003 schema (003 used SERIAL + supplier_name; the
-- repos use UUID + store_id/order_id/created_by/synced_to_inventory — see SCHEMA-OPTIMIZATION.md
-- "supply-chain column-set defect" and the guarded indexes in 007). Repo contract wins.
--
-- ID / TIMESTAMP CONTRACT: every repo calls .insert(...).select().single() WITHOUT supplying id,
-- created_at, or updated_at, then reads them back. So each table needs a generated UUID PK and
-- NOW() defaults on timestamps. Repos consume id as a string -> UUID columns. Repos that mutate
-- rows set updated_at themselves, so that column must exist where used.
--
-- FOREIGN KEYS: added only where the owning repo guarantees the parent exists at insert time
-- (employee_events.employee_id, kol_collaborations.kol_id — both created with a known parent id,
-- matching 001/002). Skipped where the repo passes a free-form/optional id that may not be
-- persisted (arrival_records.order_id, supply_orders, marketing_chat_samples.kol_id) to avoid
-- breaking inserts. CHECK / NOT NULL constraints are safe because these tables start empty.
--
-- Index names that overlap migration 007 are reused verbatim so the two migrations are
-- order-independent no-ops for each other.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ============================================
-- employees — recruitment candidates + active staff (employee.repository.ts)
-- Reads/writes every column below; metadata holds rawData/matchScore/lark_record_id (updateMetadata,
-- updateLarkRecordId). status defaults to 'candidate'; skills/languages are TEXT[]. Drops the
-- resume_embedding VECTOR column from 001 — the repo never touches it (avoids a pgvector dependency).
-- ============================================
CREATE TABLE IF NOT EXISTS employees (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  phone              TEXT,
  email              TEXT,
  source             TEXT NOT NULL DEFAULT 'manual',
  source_url         TEXT,
  candidate_id       TEXT,
  job_title          TEXT,
  department         TEXT,
  store_id           TEXT,
  status             TEXT NOT NULL DEFAULT 'candidate',
  applied_at         TIMESTAMPTZ,
  interviewed_at     TIMESTAMPTZ,
  hired_at           TIMESTAMPTZ,
  resigned_at        TIMESTAMPTZ,
  skills             TEXT[] NOT NULL DEFAULT '{}',
  languages          TEXT[] NOT NULL DEFAULT '{}',
  education          TEXT,
  experience_summary TEXT,
  location           TEXT,
  resume_file_id     TEXT,
  resume_text        TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees (status);
CREATE INDEX IF NOT EXISTS idx_employees_store ON employees (store_id);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees (name);

-- ============================================
-- employee_events — timeline events per employee (employee-event.repository.ts)
-- create() inserts {employee_id, event_type, summary, raw_message?, reported_by?, data}; reads back
-- id + created_at. data is JSONB. FK to employees (parent guaranteed by caller).
-- ============================================
CREATE TABLE IF NOT EXISTS employee_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  summary     TEXT NOT NULL,
  raw_message TEXT,
  reported_by TEXT,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_employee ON employee_events (employee_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON employee_events (event_type);

-- ============================================
-- screening_rules — recruitment screening heuristics (screening-rule.repository.ts)
-- getActiveRules filters is_active, orders by confidence; job_titles/departments are TEXT[].
-- upsert() inserts every non-id/timestamp field. confidence is REAL, sample_count INT.
-- Drops the rule_embedding VECTOR column from 001 — repo never touches it.
-- ============================================
CREATE TABLE IF NOT EXISTS screening_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type    TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT NOT NULL,
  evidence     TEXT NOT NULL,
  confidence   REAL NOT NULL DEFAULT 0.5,
  sample_count INTEGER NOT NULL DEFAULT 0,
  job_titles   TEXT[] NOT NULL DEFAULT '{}',
  departments  TEXT[] NOT NULL DEFAULT '{}',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_screening_rules_active ON screening_rules (is_active, confidence DESC);

-- ============================================
-- kols — marketing influencers (kol.repository.ts)
-- upsertFromRaw matches on (platform, platform_id); reads contact_info->>phone (getByPhone) and
-- filters niche via .contains() (TEXT[] + GIN). metadata is read back in KOLRow but never written
-- by the repo, so it keeps a default. follower_count INTEGER, engagement_rate REAL.
-- ============================================
CREATE TABLE IF NOT EXISTS kols (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  platform        TEXT NOT NULL,
  platform_handle TEXT NOT NULL,
  platform_id     TEXT NOT NULL,
  follower_count  INTEGER NOT NULL DEFAULT 0,
  engagement_rate REAL,
  avg_views       INTEGER,
  avg_likes       INTEGER,
  niche           TEXT[] NOT NULL DEFAULT '{}',
  location        TEXT,
  bio             TEXT,
  verified        BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url      TEXT,
  contact_info    JSONB NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kols_platform ON kols (platform);
CREATE INDEX IF NOT EXISTS idx_kols_handle ON kols (platform_handle);
CREATE INDEX IF NOT EXISTS idx_kols_niche ON kols USING GIN (niche);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kols_platform_id ON kols (platform, platform_id);

-- ============================================
-- kol_collaborations — outreach / deal records (kol-collaboration.repository.ts)
-- create() sets kol_id, campaign_id?, status (default 'prospected'), dm_sent (default false),
-- dm_sent_at?, dm_template_used?, metadata. KOLCollaborationRow (domain type) also exposes
-- dm_response/dm_responded_at/negotiation_notes/deal_amount/deal_terms/deliverables/scheduled_at/
-- completed_at — selected via "*" so they must exist; updateStatus/markDMSent may write any of them
-- via the `extra` spread. FK to kols (parent guaranteed by caller).
-- ============================================
CREATE TABLE IF NOT EXISTS kol_collaborations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kol_id            UUID NOT NULL REFERENCES kols(id) ON DELETE CASCADE,
  campaign_id       UUID,
  status            TEXT NOT NULL DEFAULT 'prospected',
  dm_sent           BOOLEAN NOT NULL DEFAULT FALSE,
  dm_sent_at        TIMESTAMPTZ,
  dm_template_used  TEXT,
  dm_response       TEXT,
  dm_responded_at   TIMESTAMPTZ,
  negotiation_notes TEXT,
  deal_amount       NUMERIC(10,2),
  deal_terms        TEXT,
  deliverables      TEXT[] NOT NULL DEFAULT '{}',
  scheduled_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collab_kol ON kol_collaborations (kol_id);
CREATE INDEX IF NOT EXISTS idx_collab_status ON kol_collaborations (status);

-- ============================================
-- marketing_chat_samples — AI-learning chat corpus (chat-sample.repository.ts)
-- DATA-LAYER ONLY. create() sets kol_id? + platform + message_content + message_type + chat_context +
-- captured_at (the repo sets captured_at explicitly). kol_id is optional and may reference a KOL that
-- was never persisted, so NO FK (matches 003 ON DELETE SET NULL intent without breaking inserts).
-- ============================================
CREATE TABLE IF NOT EXISTS marketing_chat_samples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kol_id          UUID,
  platform        TEXT NOT NULL,
  message_content TEXT NOT NULL,
  message_type    TEXT NOT NULL CHECK (message_type IN ('dm_sent', 'dm_received', 'comment', 'post')),
  chat_context    JSONB NOT NULL DEFAULT '{}',
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_kol ON marketing_chat_samples (kol_id);
CREATE INDEX IF NOT EXISTS idx_chat_type ON marketing_chat_samples (message_type);

-- ============================================
-- suppliers — supply-chain vendors (supplier.repository.ts)
-- create() sets name + whatsapp_id? + phone? + categories (TEXT[]). getAll/getByCategory filter
-- is_active; getByCategory uses .contains() on categories; getDefaultSupplier matches whatsapp_id.
-- ============================================
CREATE TABLE IF NOT EXISTS suppliers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  whatsapp_id TEXT,
  phone       TEXT,
  categories  TEXT[] NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers (is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_categories ON suppliers USING GIN (categories);
CREATE INDEX IF NOT EXISTS idx_suppliers_whatsapp ON suppliers (whatsapp_id);

-- ============================================
-- supply_orders — daily ordering (supply-order.repository.ts) — REPO schema, NOT 003.
-- create() sets order_date + store_id + status + items (JSONB array) + notes? + created_by?.
-- Reads order_date/store_id; appendItems rewrites items; updateStatus may set sent_at via `extra`.
-- ============================================
CREATE TABLE IF NOT EXISTS supply_orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_date TEXT NOT NULL,
  store_id   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  items      JSONB NOT NULL DEFAULT '[]',
  sent_at    TIMESTAMPTZ,
  notes      TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supply_orders_created_at ON supply_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supply_orders_store_date ON supply_orders (store_id, order_date);

-- ============================================
-- arrival_records — goods-received records (arrival-record.repository.ts) — REPO schema, NOT 003.
-- create() sets order_id + arrival_date + store_id + items (JSONB) + reported_by; synced_to_inventory
-- defaults false and is flipped by markSynced. order_id is a free-form string -> NO FK.
-- ============================================
CREATE TABLE IF NOT EXISTS arrival_records (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             TEXT NOT NULL,
  arrival_date         TEXT NOT NULL,
  store_id             TEXT NOT NULL,
  items                JSONB NOT NULL DEFAULT '[]',
  reported_by          TEXT NOT NULL,
  synced_to_inventory  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arrival_records_store_date ON arrival_records (store_id, arrival_date);
CREATE INDEX IF NOT EXISTS idx_arrival_records_order_id ON arrival_records (order_id);
