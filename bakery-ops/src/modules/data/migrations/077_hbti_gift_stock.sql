-- 077: HBTI 完成礼的周边库存池
--
-- 背景：完成 HBTI 后发的不再是写死的一张券，而是从 9 种周边里按剩余库存加权抽一张。
-- 券模板已在 RES 后台建好（type 2301 Physical Gift Coupon），这里只管「还剩多少能发」。
--
-- 为什么存已发数而不是剩余数：
--   剩余数是个会被并发写坏的可变量；已发数是只增不减的账，配上 initial_stock 就能算出剩余，
--   而且随时能回答「这个月发了多少支红铅笔」——运营真正会问的是这个问题。
--
-- not_oversold 这条 CHECK 是最后一道防线：抽取逻辑再怎么错，库里也发不出第 1377 份。
-- 没有它的话，一次并发竞态就能让门店欠顾客一件实物。

BEGIN;

CREATE TABLE IF NOT EXISTS hbti_gift_stock (
  template_name  TEXT PRIMARY KEY,
  display_name   TEXT        NOT NULL,
  initial_stock  INT         NOT NULL CHECK (initial_stock >= 0),
  issued_count   INT         NOT NULL DEFAULT 0 CHECK (issued_count >= 0),
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT hbti_gift_stock_not_oversold CHECK (issued_count <= initial_stock)
);

COMMENT ON TABLE  hbti_gift_stock IS 'HBTI 完成礼的周边库存池；template_name 必须与 RES 券模板名逐字一致';
COMMENT ON COLUMN hbti_gift_stock.template_name IS 'RES 券模板名，代码按此字符串精确匹配';
COMMENT ON COLUMN hbti_gift_stock.issued_count  IS '已发数量；抽中即 +1，是唯一的可变量';
COMMENT ON COLUMN hbti_gift_stock.is_active     IS '设为 false 可临时把某个品项移出抽奖池，无需改库存';

-- 初始库存来自 2026-08-02 的实物盘点，合计 1,376 件。
-- ON CONFLICT DO NOTHING：重复执行本迁移不会把已发数清零。
INSERT INTO hbti_gift_stock (template_name, display_name, initial_stock) VALUES
  ('HBTI Gift · White Pencil',          '白色铅笔',     100),
  ('HBTI Gift · Red Pencil',            '红色铅笔',     184),
  ('HBTI Gift · Black Pencil',          '黑色铅笔',     190),
  ('HBTI Gift · Heart Scent Card',      '爱心纸香卡',    86),
  ('HBTI Gift · Rose Scent Card',       '玫瑰纸香卡',   231),
  ('HBTI Gift · Butterfly Scent Card',  '蝴蝶纸香卡',   427),
  ('HBTI Gift · Rose Fridge Magnet',    '玫瑰冰箱贴',     6),
  ('HBTI Gift · KL Fridge Magnet',      '吉隆坡冰箱贴',  16),
  ('HBTI Gift · Bow Fridge Magnet',     '蝴蝶结冰箱贴', 136)
ON CONFLICT (template_name) DO NOTHING;

INSERT INTO schema_migrations (version, name)
VALUES (77, '077_hbti_gift_stock')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- 回滚（如需）：
--   DROP TABLE hbti_gift_stock;
--   DELETE FROM schema_migrations WHERE version = 77;
-- 注意：删表会丢掉「已经发出去多少件」的账。活动期间要停发某个品项，
-- 应当 UPDATE ... SET is_active = FALSE，而不是删表或改 initial_stock。

-- 补货时：UPDATE hbti_gift_stock SET initial_stock = initial_stock + <新增件数> WHERE template_name = '...';
-- 不要去动 issued_count——它是已发出去的账，改它等于篡改历史。
