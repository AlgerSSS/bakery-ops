-- sql/pos_member_order_item.sql
-- 会员订单商品行：全库最细的一层「谁 · 哪天 · 买了什么」。
--
-- 写者 = ~/hot/res_api 的 scrape-member-order-item.mjs。
-- **独立表**，刻意不挂财务仓库那条带 checksum 的迁移链——数据控制者的安排是
-- 先单独存，等数据库重构时再统一编排。重构前不要有别的写者接进来。
--
--
-- ============================ 一、这张表补的是哪个洞 ============================
--
-- 在它之前，全库**没有任何一张表同时含会员与商品**：
--   pos_member_card_txn  有 member_id、金额、order_id，但没有任何商品信息；
--   daily_sales_record   有商品，但是全店口径、不分人。
-- 于是「这位会员今年最常点什么」这类问题一句都答不了（策划书 9.x 记的
-- 「会员消费无法关联到任何具体商品」就是这件事）。
--
-- 桥是 order_id：RES 商品报表(reportId=211) 的 D_orderId 与 pos_member_card_txn.order_id
-- 是同一 ID 空间。实测 2026-08-08 全量翻页对账，18/18 会员订单 100% 命中。
--
--
-- ============================ 二、为什么主键是 (order_id, item_key) 且必须 SUM ============================
--
-- ⚠ 这是这张表最容易做错的地方，做错会让每个会员的数字**少算约 25%**。
--
-- 报表对同一 (订单, 商品) 会返回**多条完全相同的行**（数量、金额一字不差）。
-- 实测 2026-08-08：3,369 个组合里 963 个有重复行。看着像脏数据，但它们是真的——
-- 那是同一单里分两行点的同一样东西（两个人各点一杯，收银分行计）。
--
-- 拿当日总额裁决过，对得上账的是「原样求和」而不是「去重」：
--     原样求和   净额 RM78,761.75   件数 5,209
--     去重后     净额 RM59,277.68   件数 3,930
--     实际口径   净额 RM78,456.19（hourly_sales_summary）
--                件数 5,234        （daily_sales_record）
--
-- 所以同步侧对重复行一律 **SUM 合并**，绝不 DISTINCT。主键取 (order_id, item_key)，
-- 合并后天然唯一；单行明细不保留——年度报告只需要每样东西的合计。
--
--
-- ============================ 三、member_id 为什么可空 ============================
--
-- member_id 由 order_id 反查 pos_member_card_txn 得到，是为省掉每次 join 的冗余列。
-- 极少数订单会对应两笔会员卡交易；若这两笔属于**不同**会员，则该订单归属不明，
-- 此时写 NULL 并在同步日志里告警——**不猜、不取第一个**（与仓库「不得用 0 或猜测
-- 填补缺失事实」同一条原则）。
--
--
-- ============================ 四、口径边界 ============================
--
-- * 只收 D_isMemberConsume=true 的行（会员消费）。非会员订单不入本表。
-- * net_sales 为净额（RES 的 M_Item_SUM_netSales），与 pos_member_card_txn.total_amount
--   不是同一口径：后者是储值卡核销金额，一单可能只有部分走卡。**两者不应相互对账。**
-- * 商品名不落本表，用 item_key 关联 pos_product（有 name_zh / name_en / category）。
--   落名字会在改名时产生历史漂移，且是重复存储。

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ---------- 0. 闸门：059 安全迁移必须已执行 ----------
-- 与 060/063 第 0 节同理：默认权限没收回时新建表会立刻带上 anon 权限。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = 59) THEN
    RAISE EXCEPTION
      'pos_member_order_item 依赖 059_secure_public_schema：未收回默认权限时建表会自动带上 anon 权限，拒绝执行。';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.pos_member_order_item (
  order_id      text          NOT NULL,
  item_key      text          NOT NULL,
  business_date date          NOT NULL,
  member_id     text,
  qty           numeric(12,3) NOT NULL,
  net_sales     numeric(14,2) NOT NULL,
  synced_at     timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, item_key),
  CONSTRAINT ck_pmoi_qty       CHECK (qty > 0),
  CONSTRAINT ck_pmoi_member_id CHECK (member_id IS NULL OR member_id ~ '^[0-9]{1,32}$')
);

-- 年度报告主路径：某会员某段时间买过什么
CREATE INDEX IF NOT EXISTS ix_pmoi_member_date
  ON public.pos_member_order_item (member_id, business_date)
  WHERE member_id IS NOT NULL;

-- 增量同步与回填按日重跑
CREATE INDEX IF NOT EXISTS ix_pmoi_date
  ON public.pos_member_order_item (business_date);

-- 单品维度：谁买过这个 / 这个卖给了多少会员
CREATE INDEX IF NOT EXISTS ix_pmoi_item
  ON public.pos_member_order_item (item_key);

COMMENT ON TABLE public.pos_member_order_item IS
  '一行 = 一个会员订单里的一样商品（同单同品的多行已 SUM 合并）。全库唯一能把会员与具体商品关联起来的表。'
  '数据源 = RES 商品报表 reportId=211，过滤 D_isMemberConsume=true；写者 = ~/hot/res_api/scrape-member-order-item.mjs。'
  '★ 重复行必须 SUM 不得 DISTINCT：报表对同一(订单,商品)会返回多条完全相同的行，那是同单分行点的同一样东西，'
  '去重会导致金额与件数少算约 25%（2026-08-08 实测：原样 RM78,761.75/5,209 件 对得上 hourly_sales_summary 的 RM78,456.19 与 daily_sales_record 的 5,234 件；去重只剩 RM59,277.68/3,930 件）。'
  '★ 独立表，未挂财务仓库的迁移链，待数据库重构时统一编排。';
COMMENT ON COLUMN public.pos_member_order_item.order_id IS
  'RES 订单号，与 pos_member_card_txn.order_id 同一 ID 空间（实测 2026-08-08 全量 18/18 命中）。';
COMMENT ON COLUMN public.pos_member_order_item.item_key IS
  '商品键，关联 pos_product.item_key 取 name_zh / name_en / category。刻意不在本表落商品名，避免改名造成历史漂移。';
COMMENT ON COLUMN public.pos_member_order_item.member_id IS
  '由 order_id 反查 pos_member_card_txn 得到的冗余列。一单对应多个不同会员时写 NULL 并告警，不猜不取第一个。';
COMMENT ON COLUMN public.pos_member_order_item.net_sales IS
  'RES 的 M_Item_SUM_netSales（净额）。与 pos_member_card_txn.total_amount 口径不同（后者是储值卡核销额，一单可能只部分走卡），两者不应相互对账。';

-- ---------- 权限：REVOKE 挡现在，RLS 挡将来误 GRANT ----------
-- 与 060/063 第 5 节同一套，两个都要，失败模式不一样。
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.pos_member_order_item FROM %I', r);
    END IF;
  END LOOP;
  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.pos_member_order_item FROM PUBLIC';
  EXECUTE 'ALTER TABLE public.pos_member_order_item ENABLE ROW LEVEL SECURITY';
END
$$;
