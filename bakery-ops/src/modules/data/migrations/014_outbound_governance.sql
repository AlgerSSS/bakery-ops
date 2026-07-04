-- Migration 014: WhatsApp cold-send governance — outbound queue + daily send log (additive only).
-- PUBLIC schema. Pure CREATE TABLE/INDEX IF NOT EXISTS with DO $$-guarded RLS — safe to re-run,
-- no data loss. Depends on 012 (stores) and 013 (applications) for FKs.
--
-- WHY: there is ONE dedicated bot WhatsApp number for everything; cold outbound must be governed to
-- protect it (caps / jitter / business-hours / STOP). wa_outbound_queue is the durable send queue a
-- worker drains with rate limiting; wa_send_log is the per-number-per-day cap ledger.
--
-- wa_outbound_queue is keyed UNIQUE(phone): at most one pending outbound per number, so retries and
-- new enqueues collapse onto a single row instead of flooding. earliest_at backs business-hours/jitter
-- scheduling (don't send before this instant). wa_send_log.sent_on is computed in Asia/Kuala_Lumpur so
-- the daily cap rolls over on local midnight, not UTC.
--
-- RLS: ENABLE (never FORCE) + service_role_all + wa_outbound_queue_store_scope (store_id-keyed,
-- mirroring 009). wa_send_log has no store_id — it is a global per-number ledger — so it gets
-- service_role_all only and no store-scoped SELECT policy.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ============================================
-- wa_outbound_queue — durable cold-send queue, one pending row per phone. A worker selects queued rows
-- where earliest_at <= NOW(), flips status sending->sent/failed, and applies caps via wa_send_log.
-- attempts/max_attempts bound retries; last_error captures the last failure.
-- ============================================
CREATE TABLE IF NOT EXISTS wa_outbound_queue (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       TEXT REFERENCES stores(store_code),
  phone          TEXT NOT NULL,
  application_id UUID REFERENCES applications(id),
  body           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  max_attempts   INTEGER NOT NULL DEFAULT 3,
  last_error     TEXT,
  earliest_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_wa_outbound_queue_ready
  ON wa_outbound_queue (status, earliest_at) WHERE status = 'queued';

-- ============================================
-- wa_send_log — append-only ledger of every send, one row per delivered message. sent_on is the local
-- (Asia/Kuala_Lumpur) date the message went out, so daily-cap counting groups on local midnight.
-- ============================================
CREATE TABLE IF NOT EXISTS wa_send_log (
  id         BIGSERIAL PRIMARY KEY,
  phone      TEXT NOT NULL,
  sent_on    DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_send_log_sent_on ON wa_send_log (sent_on);

-- ============================================
-- RLS: ENABLE (never FORCE) + service_role_all on both tables, mirroring 009. wa_outbound_queue also
-- gets a dormant store-scoped SELECT policy; wa_send_log has no store_id so it gets service_role_all only.
-- ============================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['wa_outbound_queue', 'wa_send_log']
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
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.wa_outbound_queue') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='wa_outbound_queue'
                   AND policyname='wa_outbound_queue_store_scope') THEN
    CREATE POLICY wa_outbound_queue_store_scope ON public.wa_outbound_queue
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
