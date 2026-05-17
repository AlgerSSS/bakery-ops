-- 001: Core tables for skill evolution system
-- Run this in Supabase SQL Editor

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- 用户表：替代 users.json
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT UNIQUE NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  lid         TEXT,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff',
  permissions TEXT[] DEFAULT '{}',
  store_ids   TEXT[] DEFAULT '{}',
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_lid ON users(lid);

-- ============================================
-- 员工表：候选人 + 在职员工档案
-- ============================================
CREATE TABLE IF NOT EXISTS employees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  source            TEXT NOT NULL DEFAULT 'jobstreet',
  source_url        TEXT,
  candidate_id      TEXT,
  job_title         TEXT,
  department        TEXT,
  store_id          TEXT,
  status            TEXT NOT NULL DEFAULT 'candidate',
  applied_at        TIMESTAMPTZ,
  interviewed_at    TIMESTAMPTZ,
  hired_at          TIMESTAMPTZ,
  resigned_at       TIMESTAMPTZ,
  skills            TEXT[] DEFAULT '{}',
  languages         TEXT[] DEFAULT '{}',
  education         TEXT,
  experience_summary TEXT,
  location          TEXT,
  resume_file_id    TEXT,
  resume_text       TEXT,
  resume_embedding  VECTOR(1536),
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_store ON employees(store_id);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name);

-- ============================================
-- 员工事件表
-- ============================================
CREATE TABLE IF NOT EXISTS employee_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  summary      TEXT NOT NULL,
  raw_message  TEXT,
  reported_by  TEXT,
  data         JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_employee ON employee_events(employee_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON employee_events(event_type);

-- ============================================
-- 筛选规则表
-- ============================================
CREATE TABLE IF NOT EXISTS screening_rules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type      TEXT NOT NULL,
  category       TEXT NOT NULL,
  description    TEXT NOT NULL,
  evidence       TEXT NOT NULL,
  confidence     REAL DEFAULT 0.5,
  sample_count   INT DEFAULT 0,
  job_titles     TEXT[] DEFAULT '{}',
  departments    TEXT[] DEFAULT '{}',
  is_active      BOOLEAN DEFAULT TRUE,
  rule_embedding VECTOR(1536),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 招聘记录表
-- ============================================
CREATE TABLE IF NOT EXISTS recruitment_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jd_text        TEXT NOT NULL,
  parsed_jd      JSONB NOT NULL,
  total_crawled  INT DEFAULT 0,
  total_scored   INT DEFAULT 0,
  rules_applied  UUID[] DEFAULT '{}',
  candidates     JSONB DEFAULT '[]',
  status         TEXT DEFAULT 'running',
  requested_by   TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

-- ============================================
-- Seed: 初始用户数据（从 users.json 迁移）
-- ============================================
INSERT INTO users (user_id, phone, lid, name, role, permissions, store_ids) VALUES
  ('u_owner', '61431029692', NULL, 'Owner', 'owner', '{}', '{pavilion}'),
  ('u_mengshan', '', NULL, 'Mengshan', 'admin', '{}', '{pavilion}'),
  ('u_leo', '', NULL, 'Leo', 'store_manager', '{}', '{pavilion}'),
  ('Zachary', '60175437858', '179839575322865', 'Zachary', 'store_manager', '{}', '{pavilion}')
ON CONFLICT (user_id) DO NOTHING;
