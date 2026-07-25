-- 024: AI 调用日志表（IMPROVEMENT-PLAN.md G3d）
-- 纯新增，安全。openrouter.provider 成功返回后 fire-and-forget 落库（写失败只 logger.warn，
-- 绝不影响主流程）；用于离线回放复盘"AI 建议明显不对"，后续可基于此建 golden eval。
CREATE TABLE IF NOT EXISTS ai_call_log (
  id SERIAL PRIMARY KEY,
  caller VARCHAR(80),
  model VARCHAR(80),
  prompt TEXT,
  response TEXT,
  prompt_tokens INT,
  completion_tokens INT,
  latency_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
