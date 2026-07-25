-- Migration 008: Persistence tables for orchestrator state (additive only)
-- Run in Supabase SQL Editor. All CREATE TABLE IF NOT EXISTS — no changes to existing
-- tables, no data loss, safe to re-run. Created in the PUBLIC schema (migration 005 has
-- not been applied; see 007 header).
--
-- These tables back state currently held only in-memory by the orchestrator. They are
-- INERT until a repository is wired to read/write them. Column types match the in-memory
-- shapes exactly so the persistence implementer can build matching repositories:
--   audit_log    <- AuditService.SkillRun        (orchestrator/audit-service.ts)
--   chat_history <- ConversationManager.ChatHistoryEntry (orchestrator/conversation-manager.ts)
--   session_state<- StateManager.ConversationState      (orchestrator/state-manager.ts)
--   pipeline_health <- data-freshness tracking for the forecast import pipeline (no consumer yet)
-- CHECK / NOT NULL constraints are safe here because these tables start empty.

-- ============================================
-- audit_log — one row per skill run (SkillRun)
-- Reserved in public by migration 005. Maps SkillRun fields:
--   runId->run_id, skillId->skill_id, userId->user_id, channel, status,
--   input(JSONB), output(JSONB), error, startedAt->started_at,
--   finishedAt->finished_at, durationMs->duration_ms
-- ============================================
CREATE TABLE IF NOT EXISTS audit_log (
  run_id      UUID PRIMARY KEY,
  skill_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  channel     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'success', 'error')),
  input       JSONB NOT NULL DEFAULT '{}',
  output      JSONB,
  error       TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_audit_log_skill_started ON audit_log (skill_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log (user_id);

-- ============================================
-- chat_history — multi-turn conversation history (ChatHistoryEntry)
-- role/content match the interface exactly (role union -> CHECK, content -> TEXT).
-- ============================================
CREATE TABLE IF NOT EXISTS chat_history (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_history_conversation
  ON chat_history (conversation_id, created_at);

-- ============================================
-- session_state — in-progress multi-turn skill collection (ConversationState)
-- collectedInputs(Record<string,unknown>)->JSONB; missingInputs(string[])->TEXT[];
-- lastActiveAt(epoch number) stored as TIMESTAMPTZ for TTL/query ergonomics — the repo
-- layer converts. TTL/expiry logic must stay on the in-memory value (see state-manager.ts).
-- ============================================
CREATE TABLE IF NOT EXISTS session_state (
  conversation_id  TEXT PRIMARY KEY,
  user_id          TEXT,
  current_skill_id TEXT,
  pending_action   TEXT,
  collected_inputs JSONB NOT NULL DEFAULT '{}',
  missing_inputs   TEXT[] NOT NULL DEFAULT '{}',
  last_active_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- pipeline_health — data-freshness tracking for the forecast import pipeline.
-- One row per source_key ('product','daily_sales','timeslot_sales','strategy',...).
-- No consumer wired yet; populate later (best-effort upsert from autoImportFromDataDir).
-- ============================================
CREATE TABLE IF NOT EXISTS pipeline_health (
  source_key    TEXT PRIMARY KEY,
  last_run_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'unknown'
                CHECK (status IN ('success', 'error', 'running', 'unknown')),
  rows_imported INTEGER DEFAULT 0,
  error         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
