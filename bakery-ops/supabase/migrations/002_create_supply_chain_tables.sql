-- 供应链订货模块表结构

-- 订货单
CREATE TABLE IF NOT EXISTS supply_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  store_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'sent', 'partial', 'completed')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  sent_at TIMESTAMPTZ,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 到货记录
CREATE TABLE IF NOT EXISTS arrival_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES supply_orders(id),
  arrival_date DATE NOT NULL DEFAULT CURRENT_DATE,
  store_id TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  reported_by TEXT NOT NULL,
  synced_to_inventory BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 供应商
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  whatsapp_id TEXT,
  phone TEXT,
  categories TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_supply_orders_date_store ON supply_orders(order_date, store_id);
CREATE INDEX IF NOT EXISTS idx_supply_orders_status ON supply_orders(status);
CREATE INDEX IF NOT EXISTS idx_arrival_records_order ON arrival_records(order_id);
CREATE INDEX IF NOT EXISTS idx_arrival_records_date ON arrival_records(arrival_date, store_id);
