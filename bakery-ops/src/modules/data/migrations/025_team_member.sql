-- 025: team_member — Lark 组织架构 + 权限/推送配置（用户 2026-07-04：权限进数据库）。
-- syncLarkOrg() 从 Lark 组织架构 upsert：ON CONFLICT(open_id) 只更新 name/部门/active/synced_at，
-- 绝不覆盖用户配的 role/subscriptions/alias。新人自动进（role 按部门默认），离职标 active=false。
-- 消费端（今日复盘收件人、功能权限）= 查本表，不再实时遍历 Lark API。
-- role: gm(总经办·全部) / ops / supply / hr / marketing / finance / everyone(默认，仅 help+状态)。
-- subscriptions: 自动推送开关，如 {daily_review}。
CREATE TABLE IF NOT EXISTS team_member (
  open_id         TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  lark_department TEXT,
  alias           TEXT NOT NULL DEFAULT '',
  role            TEXT NOT NULL DEFAULT 'everyone',
  subscriptions   TEXT[] NOT NULL DEFAULT '{}',
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at       TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_member_active ON team_member (active);
CREATE INDEX IF NOT EXISTS idx_team_member_subs ON team_member USING GIN (subscriptions);
