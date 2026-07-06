-- 027_product_cost.sql — 单品食材成本(用于复盘毛利/报废成本损失)。
-- 数据来源：用户本机 MySQL baking_cost_2026.v_product_direct（成品×原料，SUM(amount)=食材成本），
-- 2026-07-06 一次性拉入。表结构在此登记；数据为外部导入，非本迁移生成。
-- 注意：本仓 migrations 无自动 runner，手工应用。

-- 原始导入（按成本表命名 cost_name 键）
CREATE TABLE IF NOT EXISTS product_cost (
  cost_name TEXT PRIMARY KEY,
  material_cost NUMERIC(10,4) NOT NULL,
  project_name TEXT,               -- 自动/人工连上的项目 product.name（可空）
  source TEXT DEFAULT 'baking_cost_2026.v_product_direct',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 解析后按项目产品名(product.name)键的成本，供复盘 JOIN。confidence: exact/high/med/low。
CREATE TABLE IF NOT EXISTS product_material_cost (
  product_name TEXT PRIMARY KEY,
  material_cost NUMERIC(10,4) NOT NULL,
  cost_source TEXT,                -- 对应的 cost_name
  confidence TEXT DEFAULT 'exact',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
