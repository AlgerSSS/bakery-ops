-- 026_item_last_sale.sql — 每个产品当天「最后成交(分钟)」，供精确断货检测。
-- 数据源：res_api reportId=211 + D_time(分钟) 维度，per (date, item) 取最后成交分钟。
-- item_name 与 item_hourly_sales / item_waste 同口径(translations.json D_itemName 映射后的可读名)。
-- 无自动 runner，手工应用（与 025 相同）。

CREATE TABLE IF NOT EXISTS item_last_sale (
  date            DATE        NOT NULL,
  item_name       TEXT        NOT NULL,
  last_sale_time  TIME        NOT NULL,          -- 分钟精度，KL 本地时间
  day_qty         INTEGER     NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, item_name)
);

CREATE INDEX IF NOT EXISTS idx_item_last_sale_date ON item_last_sale (date);
