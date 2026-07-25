-- 022: 采纳 AI 修正落库（IMPROVEMENT-PLAN.md G2-②，用户 2026-07-02 批准该行为变更）
-- 纯新增，安全。前端"采纳 AI 修正"写入本表（带 adopted_at/adopted_by 审计线）；
-- forecast.service 仅在 AI_CORRECTION_APPLY=true 时读取当月系数传入 calculateDailyTargets
-- 的 aiCorrections 参数——开关关闭即一键回退到旧行为。
CREATE TABLE IF NOT EXISTS ai_daily_correction (
  id SERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL UNIQUE,
  coefficient DOUBLE PRECISION NOT NULL,
  reason TEXT,
  adopted_at TIMESTAMPTZ DEFAULT NOW(),
  adopted_by VARCHAR(64)
);
