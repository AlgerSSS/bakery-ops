-- 020: schema_migrations 版本追踪表（IMPROVEMENT-PLAN.md C5）
-- 纯新增，安全。记录已应用到库的迁移版本；已应用版本按线上探测结果手工回填。
-- 配套只读对账脚本：scripts/check-migrations.ts（只报告差集，绝不执行 SQL 文件）。
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);
