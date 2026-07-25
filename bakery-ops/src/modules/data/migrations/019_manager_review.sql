-- 019: 店长复盘原文落库（IMPROVEMENT-PLAN.md B7）
-- 背景：daily-review-chat 此前 INSERT INTO daily_review (content...) 双重必败——
-- 004 建的 daily_review 没有 content 列，005 又把该表移进 forecast schema；
-- 异常被空 catch 吞掉，复盘原文只活在 LightRAG（且服务停机时彻底丢失）。
-- 本表是店长人工复盘的真相源，与 forecast.daily_review（机器生成的复盘报告）语义分离。
CREATE TABLE IF NOT EXISTS manager_review (
  id SERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL UNIQUE,
  content TEXT NOT NULL,
  insight TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_manager_review_date ON manager_review (date);
