-- 021: 每日推送幂等日志（IMPROVEMENT-PLAN.md F1/F2）
-- 纯新增，安全。记录已成功发送的定时推送 (kind, recipient, date)，重启/重跑不重发。
CREATE TABLE IF NOT EXISTS daily_push_log (
  id SERIAL PRIMARY KEY,
  kind VARCHAR(40) NOT NULL,
  recipient VARCHAR(64) NOT NULL,
  date VARCHAR(10) NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (kind, recipient, date)
);
