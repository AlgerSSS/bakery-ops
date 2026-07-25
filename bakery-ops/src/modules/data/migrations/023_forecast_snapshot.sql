-- 023: 预测快照表（IMPROVEMENT-PLAN.md F6-①）
-- 纯新增，安全。getProductForecast 生成建议后 fire-and-forget 写入（ON CONFLICT 覆盖当日最后一版）。
-- 必须在生成时落快照而非事后重算——product_sales_baseline 每晚滚动更新，重算 ≠ 当天实际发出的建议。
CREATE TABLE IF NOT EXISTS forecast_snapshot (
  id SERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  suggested_qty INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, product_name)
);
