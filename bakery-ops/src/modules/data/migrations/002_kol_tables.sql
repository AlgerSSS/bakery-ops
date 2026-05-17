-- 003: Marketing KOL tables
-- 市场营销 KOL 管理 — 4 张新表

-- 1. KOL 博主表
CREATE TABLE IF NOT EXISTS kols (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram')),
  platform_handle TEXT NOT NULL,
  platform_id     TEXT NOT NULL,
  follower_count  INTEGER DEFAULT 0,
  engagement_rate REAL,
  avg_views       INTEGER,
  avg_likes       INTEGER,
  niche           TEXT[] DEFAULT '{}',
  location        TEXT,
  bio             TEXT,
  verified        BOOLEAN DEFAULT FALSE,
  avatar_url      TEXT,
  contact_info    JSONB DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kols_platform ON kols(platform);
CREATE INDEX IF NOT EXISTS idx_kols_handle ON kols(platform_handle);
CREATE INDEX IF NOT EXISTS idx_kols_niche ON kols USING GIN(niche);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kols_platform_id ON kols(platform, platform_id);

-- 2. 合作/触达记录表
CREATE TABLE IF NOT EXISTS kol_collaborations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kol_id              UUID NOT NULL REFERENCES kols(id) ON DELETE CASCADE,
  campaign_id         UUID,
  status              TEXT NOT NULL DEFAULT 'prospected'
                      CHECK (status IN ('prospected','contacted','negotiating','confirmed','completed','declined')),
  dm_sent             BOOLEAN DEFAULT FALSE,
  dm_sent_at          TIMESTAMPTZ,
  dm_template_used    TEXT,
  dm_response         TEXT,
  dm_responded_at     TIMESTAMPTZ,
  negotiation_notes   TEXT,
  deal_amount         NUMERIC(10,2),
  deal_terms          TEXT,
  deliverables        TEXT[] DEFAULT '{}',
  scheduled_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  metadata            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collab_kol ON kol_collaborations(kol_id);
CREATE INDEX IF NOT EXISTS idx_collab_status ON kol_collaborations(status);

-- 3. 聊天样本表（AI 学习用）
CREATE TABLE IF NOT EXISTS marketing_chat_samples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kol_id          UUID REFERENCES kols(id) ON DELETE SET NULL,
  platform        TEXT NOT NULL,
  message_content TEXT NOT NULL,
  message_type    TEXT NOT NULL CHECK (message_type IN ('dm_sent', 'dm_received', 'comment', 'post')),
  chat_context    JSONB DEFAULT '{}',
  captured_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_kol ON marketing_chat_samples(kol_id);
CREATE INDEX IF NOT EXISTS idx_chat_type ON marketing_chat_samples(message_type);

-- 4. 营销活动表
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  goals       TEXT,
  budget      NUMERIC(10,2),
  kol_ids     UUID[] DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'active', 'paused', 'completed')),
  start_date  DATE,
  end_date    DATE,
  metrics     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
