-- Migration 013: Recruitment funnel — openings, applications, conversations, appointments, trials, offers
-- (additive only). PUBLIC schema. Pure CREATE TYPE/TABLE/INDEX IF NOT EXISTS with DO $$ guards —
-- safe to re-run, no data loss. Depends on 012 (stores) for the store_id FKs.
--
-- WHY: this models the owner's real Lark hiring process (base 试工流程跟踪) inside Postgres so the
-- WhatsApp automation can drive it. The DB application_stage enum maps 1:1 to the Lark 当前阶段 select
-- (see recruitment-vocab.ts STAGE_TO_LARK). Every table is store-scoped (store_id TEXT NOT NULL ->
-- stores(store_code)) so the multi-store RLS model applies uniformly.
--
-- candidate_conversations is the multi-day candidate FSM store (state-manager's session_state is
-- OWNER-scoped + 10-min TTL and MUST NOT be reused for this). One conversation per (store_id, phone).
--
-- RLS: ENABLE (never FORCE) + service_role_all + <table>_store_scope keyed on store_id against the
-- request.jwt.claims->'store_ids' claim, mirroring 009. Behavior-preserving (see 009 header).

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ============================================
-- application_stage enum — mirrors Lark 🟦HR｜当前阶段 plus two automation-only terminals
-- (opted_out = candidate sent STOP; no_show = missed a confirmed appointment). Guarded CREATE TYPE.
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_stage') THEN
    CREATE TYPE application_stage AS ENUM (
      'new',                  -- pre-contact (no Lark stage yet)
      'contacting',           -- ①联系约面
      'first_interview',      -- ②初面
      'trial',                -- ③试工
      'post_trial_interview', -- ④试工后面试
      'feedback',             -- ⑤反馈跟进
      'hired',                -- 已入职
      'rejected',             -- 已淘汰
      'backup_pool',          -- 备选池
      'opted_out',            -- automation terminal: candidate replied STOP
      'no_show'               -- automation terminal: missed confirmed appointment
    );
  END IF;
END $$;

-- ============================================
-- job_openings — a hiring slot, from a JobStreet posting or a printed QR poster. role_area is FOH/BOH;
-- qr_token is the APPLY-<STORE>-<FOH|BOH> value encoded on the poster. Unique partial idx on qr_token
-- (only where present) and on (store_id, external_job_id) (only where present) so QR-only and
-- platform-only openings don't collide on NULLs.
-- ============================================
CREATE TABLE IF NOT EXISTS job_openings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        TEXT NOT NULL REFERENCES stores(store_code),
  source          TEXT NOT NULL CHECK (source IN ('jobstreet', 'qr_poster')),
  external_job_id TEXT,
  role_area       TEXT NOT NULL CHECK (role_area IN ('FOH', 'BOH')),
  title           TEXT,
  qr_token        TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_openings_qr_token
  ON job_openings (qr_token) WHERE qr_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_openings_store_external
  ON job_openings (store_id, external_job_id) WHERE external_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_openings_store ON job_openings (store_id);

-- ============================================
-- applications — one candidate against one opening. employee_id is set ONLY at the hired step (links
-- into the employees table). position_code (the 岗位/站位) is set later by the chef. lark_record_id is
-- the 试工流程跟踪 row id. contact_status gates outbound: 'ready' (we have a usable phone) vs
-- 'needs_manual' (default — JobStreet detail page may not expose a phone; needs a human).
-- Unique partial idx (store_id, phone) where phone present (dedup real candidates) and
-- (store_id, job_opening_id, external_applicant_id) where the external id present (dedup platform rows).
-- ============================================
CREATE TABLE IF NOT EXISTS applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              TEXT NOT NULL REFERENCES stores(store_code),
  job_opening_id        UUID REFERENCES job_openings(id),
  employee_id           UUID REFERENCES employees(id),
  external_applicant_id TEXT,
  name                  TEXT,
  phone                 TEXT,
  contact_status        TEXT NOT NULL DEFAULT 'needs_manual'
                          CHECK (contact_status IN ('ready', 'needs_manual')),
  role_area             TEXT CHECK (role_area IN ('FOH', 'BOH')),
  position_code         TEXT,
  stage                 application_stage NOT NULL DEFAULT 'new',
  source                TEXT,
  lark_record_id        TEXT,
  applied_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_store_phone
  ON applications (store_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_store_opening_external
  ON applications (store_id, job_opening_id, external_applicant_id)
  WHERE external_applicant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_applications_store_stage ON applications (store_id, stage);

-- ============================================
-- candidate_conversations — the multi-day candidate FSM (persisted; NOT state-manager's session_state).
-- state is the FSM node; context is free-form JSONB scratch (pending question, parsed answers, etc.).
-- opted_out mirrors the STOP terminal. One row per (store_id, phone).
-- ============================================
CREATE TABLE IF NOT EXISTS candidate_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        TEXT NOT NULL REFERENCES stores(store_code),
  application_id  UUID REFERENCES applications(id),
  phone           TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'INTAKE'
                    CHECK (state IN (
                      'INTAKE', 'AWAITING_INTERVIEW_CONFIRM', 'INTERVIEW_SCHEDULED',
                      'AWAITING_TRIAL_CONFIRM', 'TRIAL_SCHEDULED', 'POST_TRIAL',
                      'DONE', 'OPTED_OUT'
                    )),
  context         JSONB NOT NULL DEFAULT '{}',
  opted_out       BOOLEAN NOT NULL DEFAULT FALSE,
  last_inbound_at  TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_candidate_conversations_application
  ON candidate_conversations (application_id);

-- ============================================
-- appointments — a scheduled interview or trial for an application. trial_duration maps Lark 试工时长
-- (1小时 / 4小时). scheduled_for is when it happens; confirmed_by_user_id/confirmed_at record the
-- manager/chef confirmation. lark_record_id mirrors the 试工流程跟踪 row.
-- ============================================
CREATE TABLE IF NOT EXISTS appointments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            TEXT NOT NULL REFERENCES stores(store_code),
  application_id      UUID NOT NULL REFERENCES applications(id),
  kind                TEXT NOT NULL CHECK (kind IN ('interview', 'trial')),
  role_area           TEXT CHECK (role_area IN ('FOH', 'BOH')),
  position_code       TEXT,
  scheduled_for       TIMESTAMPTZ,
  trial_duration      TEXT CHECK (trial_duration IN ('1小时', '4小时')),
  status              TEXT NOT NULL DEFAULT 'proposed',
  confirmed_by_user_id TEXT REFERENCES users(user_id),
  confirmed_at        TIMESTAMPTZ,
  lark_record_id      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_store_scheduled
  ON appointments (store_id, scheduled_for);

-- ============================================
-- trials — the chef/store evaluation captured after a trial appointment. recommendation maps Lark
-- 录用建议 (建议录用 / 有条件录用 / 延长试工 / 不建议录用). red_line maps 触犯红线 (无/有 -> FALSE/TRUE).
-- score maps 试工评分, feedback 试工反馈, attitude_summary 工作态度小结, decided_by_user_id 评估负责人.
-- ============================================
CREATE TABLE IF NOT EXISTS trials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          TEXT NOT NULL REFERENCES stores(store_code),
  appointment_id    UUID NOT NULL REFERENCES appointments(id),
  position_code     TEXT,
  score             NUMERIC,
  feedback          TEXT,
  attitude_summary  TEXT,
  red_line          BOOLEAN,
  recommendation    TEXT CHECK (recommendation IN ('建议录用', '有条件录用', '延长试工', '不建议录用')),
  decided_by_user_id TEXT REFERENCES users(user_id),
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trials_appointment ON trials (appointment_id);

-- ============================================
-- offers — an offer for an application. suggested_salary comes from Lark 🟩厨/店｜建议薪资 (text);
-- salary_source is 'lark' (the default, pulled from the field) or 'manual' (overridden by a human).
-- ============================================
CREATE TABLE IF NOT EXISTS offers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          TEXT NOT NULL REFERENCES stores(store_code),
  application_id    UUID NOT NULL REFERENCES applications(id),
  position_code     TEXT,
  suggested_salary  TEXT,
  salary_source     TEXT NOT NULL DEFAULT 'lark' CHECK (salary_source IN ('lark', 'manual')),
  approved_by_user_id TEXT REFERENCES users(user_id),
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'approved', 'sent', 'accepted', 'declined')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offers_application ON offers (application_id);

-- ============================================
-- RLS: ENABLE (never FORCE) + service_role_all + <table>_store_scope keyed on store_id against the
-- request.jwt.claims->'store_ids' claim, mirroring 009. Looped over every new table.
-- ============================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'job_openings', 'applications', 'candidate_conversations',
    'appointments', 'trials', 'offers'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'service_role_all'
      ) THEN
        EXECUTE format(
          'CREATE POLICY service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
          tbl
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = tbl AND policyname = tbl || '_store_scope'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ('
          || 'store_id = ANY (ARRAY('
          || 'SELECT jsonb_array_elements_text('
          || 'COALESCE(current_setting(''request.jwt.claims'', true)::jsonb->''store_ids'', ''[]''::jsonb))))'
          || ')',
          tbl || '_store_scope', tbl
        );
      END IF;
    END IF;
  END LOOP;
END $$;
