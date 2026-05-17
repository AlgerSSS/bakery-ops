-- 排产预估系统数据库初始化脚本 (PostgreSQL / Supabase)

-- 产品价格信息
CREATE TABLE IF NOT EXISTS product (
  id SERIAL PRIMARY KEY,
  category VARCHAR(100) NOT NULL DEFAULT '',
  name VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NOT NULL DEFAULT '',
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  pack_multiple INT NOT NULL DEFAULT 1,
  unit_type VARCHAR(20) NOT NULL DEFAULT 'batch',
  display_full_quantity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_product_name UNIQUE (name)
);

-- 产品销售策略
CREATE TABLE IF NOT EXISTS product_strategy (
  id SERIAL PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  positioning VARCHAR(20) NOT NULL DEFAULT '其他',
  category VARCHAR(100) NOT NULL DEFAULT '',
  cold_hot VARCHAR(10) NOT NULL DEFAULT '热',
  sales_ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
  target_tc DOUBLE PRECISION DEFAULT NULL,
  audience VARCHAR(200) NOT NULL DEFAULT '',
  break_stock_time VARCHAR(20) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 999,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_strategy_product_name UNIQUE (product_name)
);

-- 每日销售记录
CREATE TABLE IF NOT EXISTS daily_sales_record (
  id SERIAL PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  standard_name VARCHAR(200) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  date VARCHAR(10) NOT NULL,
  day_of_week INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dsr_standard_name ON daily_sales_record (standard_name);
CREATE INDEX IF NOT EXISTS idx_dsr_date ON daily_sales_record (date);

-- 产品销售基线（计算结果缓存）
CREATE TABLE IF NOT EXISTS product_sales_baseline (
  id SERIAL PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  avg_monday_to_thursday DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_friday DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_weekend DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_sales INT NOT NULL DEFAULT 0,
  day_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_baseline_product_name UNIQUE (product_name)
);

-- 产品别名映射
CREATE TABLE IF NOT EXISTS product_alias (
  id SERIAL PRIMARY KEY,
  alias VARCHAR(200) NOT NULL,
  standard_name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_alias UNIQUE (alias)
);
CREATE INDEX IF NOT EXISTS idx_alias_standard_name ON product_alias (standard_name);

-- 业务规则（Key-Value 存储）
CREATE TABLE IF NOT EXISTS business_rule (
  id SERIAL PRIMARY KEY,
  rule_key VARCHAR(100) NOT NULL,
  rule_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_rule_key UNIQUE (rule_key)
);

-- 节假日/特殊日期
CREATE TABLE IF NOT EXISTS holiday (
  id SERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'public_holiday',
  coefficient DOUBLE PRECISION DEFAULT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_holiday_date UNIQUE (date)
);

-- 固定出货时间表
CREATE TABLE IF NOT EXISTS fixed_shipment_schedule (
  id SERIAL PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  time_slots TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_schedule_product_name UNIQUE (product_name)
);

-- 分时段销售记录（按日期类型分类）
CREATE TABLE IF NOT EXISTS timeslot_sales_record (
  id SERIAL PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  day_type VARCHAR(20) NOT NULL,
  time_slot VARCHAR(10) NOT NULL,
  avg_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
  sample_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_product_daytype_slot UNIQUE (product_name, day_type, time_slot)
);
CREATE INDEX IF NOT EXISTS idx_tsr_day_type ON timeslot_sales_record (day_type);

-- 断货记录表（支撑"理想营业额"）
CREATE TABLE IF NOT EXISTS out_of_stock_record (
  id SERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  input_name VARCHAR(200) DEFAULT '',
  soldout_time VARCHAR(10) NOT NULL,
  soldout_slot VARCHAR(10) NOT NULL,
  day_type VARCHAR(20) NOT NULL,
  loss_slots TEXT DEFAULT '',
  estimated_loss_qty DOUBLE PRECISION DEFAULT 0,
  estimated_loss_amount DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oos_date ON out_of_stock_record (date);
CREATE INDEX IF NOT EXISTS idx_oos_product ON out_of_stock_record (product_name);

-- 事件上下文表（运行时动态注入AI prompt）
CREATE TABLE IF NOT EXISTS context_event (
  id SERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  event_tag VARCHAR(100) NOT NULL,
  description TEXT DEFAULT '',
  impact_products TEXT DEFAULT '',
  created_by VARCHAR(50) DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ce_date ON context_event (date);

-- 每日复盘结果表
CREATE TABLE IF NOT EXISTS daily_review (
  id SERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL,
  review_json TEXT NOT NULL,
  suggestions_json TEXT NOT NULL,
  adopted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_review_date UNIQUE (date)
);

-- Prompt片段表（组合式Prompt积木块）
CREATE TABLE IF NOT EXISTS prompt_segment (
  id SERIAL PRIMARY KEY,
  segment_key VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  variables TEXT DEFAULT '',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_segment_key UNIQUE (segment_key)
);

-- Prompt组合模板表
CREATE TABLE IF NOT EXISTS prompt_template (
  id SERIAL PRIMARY KEY,
  template_key VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  system_instruction_key VARCHAR(100) NOT NULL,
  segment_keys TEXT NOT NULL,
  model VARCHAR(50) DEFAULT 'gemini-2.5-flash',
  temperature DOUBLE PRECISION DEFAULT 0.1,
  top_p DOUBLE PRECISION DEFAULT 0.85,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_template_key UNIQUE (template_key)
);

-- 每日营业额（直接录入，优先于销量×单价计算）
CREATE TABLE IF NOT EXISTS daily_revenue (
  date VARCHAR(10) NOT NULL,
  revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
  transaction_count INT,
  avg_transaction_value DOUBLE PRECISION,
  CONSTRAINT uk_daily_revenue_date UNIQUE (date)
);

-- 赋能事件表（市场/营运赋能复盘）
CREATE TABLE IF NOT EXISTS empowerment_event (
  id SERIAL PRIMARY KEY,
  event_name VARCHAR(200) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  start_date VARCHAR(10) NOT NULL,
  end_date VARCHAR(10) NOT NULL,
  target_products TEXT DEFAULT '',
  platform VARCHAR(100) DEFAULT '',
  exposure_count INT DEFAULT 0,
  click_count INT DEFAULT 0,
  cost DOUBLE PRECISION DEFAULT 0,
  operation_type VARCHAR(100) DEFAULT '',
  operation_detail TEXT DEFAULT '',
  review_json TEXT DEFAULT '',
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 自动更新 updated_at 的触发器函数
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为所有需要 updated_at 的表创建触发器
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'product', 'product_strategy', 'product_sales_baseline',
    'product_alias', 'business_rule', 'holiday',
    'fixed_shipment_schedule', 'timeslot_sales_record',
    'prompt_segment', 'prompt_template'
  ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I; CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at();',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END;
$$;

-- 产品属性配置表（覆盖 product 表中的 pack_multiple / unit_type / display_full_quantity）
CREATE TABLE IF NOT EXISTS product_config (
  product_name VARCHAR(200) NOT NULL,
  pack_multiple INT NOT NULL DEFAULT 1,
  unit_type VARCHAR(20) NOT NULL DEFAULT 'batch',
  display_full_quantity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_product_config_name UNIQUE (product_name)
);
