-- 108: 修 107 的身份桥 —— 我把「排产主数据」当成了「全量商品主数据」
--
-- 【107 错在哪】
-- v_product_identity 建在 product 上。但 product 只有 54 行，它是**排产**主数据：
-- 只收要计划生产的烘焙品，带 avg_monday_to_thursday / time_slots / pack_multiple 这些排产属性。
-- 门店实际在卖 107 个品项（含饮料、周边），POS 目录 pos_product 有 211 行。
--
-- 实测覆盖率：销售里出现过的 107 个 item_key，pos_product 认得 107 个，product 只认得 46 个。
--
-- 后果（本迁移执行前实测）：
--   · v_item_daily_pulse 里 name_zh IS NULL 的行有 4,288 行、销售额 RM1,306,707。
--     任何人按 107 注释的用法查「哪个单品最贵」，最前面就是这一堆无名行。
--   · 报废被静默丢掉：视图里 RM642,677，源表 RM656,292，差 RM13,615
--     （482 行 / 27 个品项的 item_key 不在身份桥里，被 LEFT JOIN 丢掉了）。
--
-- 【第二个错：NULL item_key 的销售行被聚成一个桶】
-- item_hourly_sales 有 2,297 行 item_key 为空（43 个品项、RM301,698），
-- 而且不是历史遗留 —— 8 月还在新增 99 行，同一个品（如 Hot Crush Egg Tart）
-- 既有带键的行也有不带键的行，是同步漏了键。
-- 107 里 COALESCE(f.item_key, a.item_key) 会把同一天所有 NULL 键的行聚成一行。
-- 实测这些品项的 item_name 有 73/74 能经 pos_product.name_en 找回 item_key，
-- 所以先按名字补键，再聚合。
--
-- 【为什么不去修同步、而是在视图里补】
-- 补键是只读的、可回滚的，今天就能让数字正确；改同步要动 res_api 并重跑历史。
-- 视图里补完，同步侧的漏键会在 v_identity_gap 里持续可见，修不修都不再影响数字。

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── ⓪ 先删后建 ─────────────────────────────────────────────────────────
-- CREATE OR REPLACE VIEW 不允许改列的顺序或名字（42P16）：107 的 v_product_identity
-- 首列是 product_id，而这里首列是 item_key。所以必须按依赖倒序先删。
-- 整个迁移在一个事务里，中途不会出现「视图不存在」的可见窗口。
DROP VIEW IF EXISTS public.v_item_daily_pulse;
DROP VIEW IF EXISTS public.v_forecast_accuracy;
DROP VIEW IF EXISTS public.v_item_sales_keyed;
DROP VIEW IF EXISTS public.v_item_waste_keyed;
DROP VIEW IF EXISTS public.v_identity_gap;
DROP VIEW IF EXISTS public.v_pos_item_by_name;
DROP VIEW IF EXISTS public.v_product_identity;

-- ── ① 身份桥：以 POS 目录为全集，排产属性从 product 补上 ────────────────
-- FULL JOIN 而不是从 pos_product 单向 LEFT：product 里可能有 pos_product 尚未同步到的
-- 品项（实测 47 个带 item_key 的 product 行里，46 个能在销售中找到），
-- 单向 join 会让它们从桥上掉下去，而预估恰恰是按 product.name 进来的。
CREATE OR REPLACE VIEW public.v_product_identity
  WITH (security_invoker = true) AS
SELECT COALESCE(pp.item_key, pr.item_key)        AS item_key,
       COALESCE(pr.name, pp.name_zh, pp.name_en) AS name_zh,
       COALESCE(pp.name_en, pr.name_en)          AS name_en,
       COALESCE(pr.category, pp.category_zh)     AS category,
       -- 排产属性只有 product 有；饮料/周边为空是正常的，它们本来就不排产。
       pr.positioning,
       pr.pack_multiple,
       pr.break_stock_time,
       pr.time_slots,
       (pr.id IS NOT NULL)                       AS is_planned,
       pr.id                                     AS product_id,
       pp.sales_price
FROM public.pos_product pp
FULL JOIN public.product pr ON pr.item_key = pp.item_key
WHERE COALESCE(pp.item_key, pr.item_key) IS NOT NULL;

COMMENT ON VIEW public.v_product_identity IS
  '商品身份桥，以 POS 目录 pos_product 为全集（211 行），排产属性从 product 补。'
  'is_planned = 该品项是否进入每日排产（product 里有行）—— 饮料与周边为 false，它们不排产，'
  '所以「没有预估」对它们不是缺陷。'
  '108 之前这里只建在 product 上（54 行），导致 4,288 行销售无名、RM130.7 万落进空桶。';

-- ── ② 按名字补键，一个名字只能对一个键 ────────────────────────────────
--
-- ⚠ pos_product 里 item_key = {org_id}-{org_type}-{item_id}，而同一个商品在**两个 org**
-- 下各有一条：1990716608733069315-1-…（73,201 行销售 / RM9,217,186）与
-- 1991027325256417283-7-…（6,296 行 / RM552,501），两个 org 都活到 2026-08-04。
-- 211 行目录只有 123 个不同的 item_id，120 个不同的 name_en。
-- 直接 `pp.name_en = s.item_name` 会让一行销售/报废乘成 2–4 行 ——
-- 实测这么写之后视图报废总额 RM667,236 反而**超过**源表 RM656,292（虚增 1.67%）。
--
-- 所以按名字查必须先收敛成一行。优先级：哪个 key 在销售里真出现过就用哪个
-- （自适应，不把 org_id 写死在 SQL 里），再按 item_key 排序保证确定性。
CREATE OR REPLACE VIEW public.v_pos_item_by_name
  WITH (security_invoker = true) AS
SELECT DISTINCT ON (pp.name_en) pp.name_en, pp.item_key
FROM public.pos_product pp
LEFT JOIN (
  SELECT item_key, count(*) AS n FROM public.item_hourly_sales
  WHERE item_key IS NOT NULL GROUP BY 1
) s ON s.item_key = pp.item_key
ORDER BY pp.name_en, COALESCE(s.n, 0) DESC, pp.item_key;

COMMENT ON VIEW public.v_pos_item_by_name IS
  '英文品名 → 单一 item_key。pos_product 同名多行（同一商品跨两个 org），'
  '这里按「在销售里出现得更多」收敛到一行，供缺键回补使用。'
  '注意：裸 item_id（item_key 第三段）才是与 org 无关的商品身份 —— '
  'cost_card_product_link.pos_item_id 存的就是它。';

CREATE OR REPLACE VIEW public.v_item_sales_keyed
  WITH (security_invoker = true) AS
SELECT s.date,
       COALESCE(s.item_key, pp.item_key) AS item_key,
       s.item_name,
       s.qty,
       s.net_sales,
       (s.item_key IS NULL)              AS key_recovered_by_name
FROM public.item_hourly_sales s
LEFT JOIN public.v_pos_item_by_name pp
       ON s.item_key IS NULL AND pp.name_en = s.item_name;

COMMENT ON VIEW public.v_item_sales_keyed IS
  'item_hourly_sales 补齐 item_key。实测 2,297 行原本为空（43 个品项 / RM301,698），'
  '其中 73/74 个品名能经 pos_product.name_en 找回。'
  'key_recovered_by_name = true 表示这一行的键是补出来的，同步侧漏键的规模可由它统计。';

CREATE OR REPLACE VIEW public.v_item_waste_keyed
  WITH (security_invoker = true) AS
SELECT w.date,
       COALESCE(w.item_key, pp.item_key) AS item_key,
       w.item_name,
       w.qty,
       w.amount,
       w.waste_reason,
       (w.item_key IS NULL)              AS key_recovered_by_name
FROM public.item_waste w
LEFT JOIN public.v_pos_item_by_name pp
       ON w.item_key IS NULL AND pp.name_en = w.item_name;

-- ── ③ 预估准确度：不变的语义，换成补完键的来源 ──────────────────────────
CREATE OR REPLACE VIEW public.v_forecast_accuracy
  WITH (security_invoker = true) AS
WITH forecast AS (
  -- 预估只覆盖排产品项，按中文名进来（forecast_snapshot.product_name = product.name）
  SELECT s.date::date AS d, i.item_key, sum(s.suggested_qty) AS suggested_qty
  FROM public.forecast_snapshot s
  JOIN public.v_product_identity i ON i.name_zh = s.product_name AND i.is_planned
  GROUP BY 1, 2
),
actual AS (
  SELECT date AS d, item_key, sum(qty) AS sold_qty, sum(net_sales) AS net_sales
  FROM public.v_item_sales_keyed
  WHERE item_key IS NOT NULL
  GROUP BY 1, 2
)
SELECT COALESCE(f.d, a.d)                       AS date,
       COALESCE(f.item_key, a.item_key)         AS item_key,
       i.name_zh,
       i.category,
       i.positioning,
       i.is_planned,
       f.suggested_qty,
       a.sold_qty,
       a.net_sales,
       f.suggested_qty - a.sold_qty             AS deviation,
       CASE
         WHEN f.suggested_qty IS NULL           THEN '无预估'
         WHEN a.sold_qty IS NULL                THEN '预估了但当日无销量'
         WHEN f.suggested_qty > a.sold_qty      THEN '高估'
         WHEN f.suggested_qty < a.sold_qty      THEN '低估'
         ELSE '持平'
       END                                      AS direction,
       CASE WHEN a.sold_qty IS NULL OR a.sold_qty = 0 THEN NULL
            ELSE round(100.0 * abs(f.suggested_qty - a.sold_qty)::numeric / a.sold_qty, 1)
       END                                      AS error_pct
FROM forecast f
FULL JOIN actual a ON a.d = f.d AND a.item_key = f.item_key
LEFT JOIN public.v_product_identity i
       ON i.item_key = COALESCE(f.item_key, a.item_key);

COMMENT ON VIEW public.v_forecast_accuracy IS
  '预估 vs 实卖，逐日逐品，走 item_key。direction 同时保留高估与低估。'
  '按 is_planned 过滤才是「排产准不准」的口径：饮料与周边不排产，它们的「无预估」是正常的。'
  '近30天基线（107 建视图时实测）：736 对配对、平均绝对误差 30.1、误差率 43.5%、高估占比 67%。';

-- ── ④ 单品每日全景 ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_item_daily_pulse
  WITH (security_invoker = true) AS
WITH waste AS (
  SELECT date AS d, item_key, sum(qty) AS waste_qty, sum(amount) AS waste_amount,
         sum(amount) FILTER (WHERE waste_reason = 'scheduling') AS scheduling_waste_amount,
         sum(amount) FILTER (WHERE waste_reason = 'tasting')    AS tasting_amount
  FROM public.v_item_waste_keyed
  WHERE item_key IS NOT NULL
  GROUP BY 1, 2
),
oos AS (
  SELECT o.date::date AS d, i.item_key,
         count(*)                        AS oos_events,
         min(o.soldout_time)             AS first_soldout_time,
         sum(o.estimated_loss_qty)       AS oos_loss_qty,
         sum(o.estimated_loss_amount)    AS oos_loss_amount
  FROM public.out_of_stock_record o
  JOIN public.v_product_identity i
    ON i.name_zh = o.product_name OR i.name_en = o.product_name
  GROUP BY 1, 2
)
SELECT fa.date, fa.item_key, fa.name_zh, fa.category, fa.is_planned,
       fa.suggested_qty, fa.sold_qty, fa.net_sales, fa.deviation, fa.direction,
       w.waste_qty, w.waste_amount, w.scheduling_waste_amount, w.tasting_amount,
       o.oos_events, o.first_soldout_time, o.oos_loss_amount,
       -- ⚠ 只算「可改善」的损失：试吃是有意的营销投入（business_rule.tastingWasteRate=0.06），
       -- 把它算进损失会让每个热销品看起来都在亏钱。实测近30天试吃 RM66,682，
       -- 与排产报废 RM67,166 几乎等量，混在一起会让损失虚高一倍。
       COALESCE(w.scheduling_waste_amount, 0) + COALESCE(o.oos_loss_amount, 0) AS total_loss_amount,
       CASE
         WHEN w.scheduling_waste_amount > 0 AND o.oos_events > 0 THEN '又多做又断货（时段分配问题）'
         WHEN w.scheduling_waste_amount > 0                      THEN '做多了'
         WHEN o.oos_events > 0                                   THEN '做少了'
         ELSE '正常'
       END AS loss_pattern
FROM public.v_forecast_accuracy fa
LEFT JOIN waste w ON w.d = fa.date AND w.item_key = fa.item_key
LEFT JOIN oos   o ON o.d = fa.date AND o.item_key = fa.item_key;

COMMENT ON VIEW public.v_item_daily_pulse IS
  '单品每日全景：预估 / 实卖 / 报废 / 断货 在同一行。'
  'total_loss_amount 只含排产报废 + 断货估损，**不含试吃** —— 试吃是营销投入不是损失。'
  'loss_pattern = ''又多做又断货'' 是最贵的一类：总量对了但时段错了，加减总产量修不好，'
  '要动 product.break_stock_time 与 time_slots。';

-- ── ⑤ 缺口视图：让「谁还没对上」持续可见，而不是静默丢掉 ────────────────
CREATE OR REPLACE VIEW public.v_identity_gap
  WITH (security_invoker = true) AS
SELECT '销售缺 item_key（同步漏键）' AS gap_type, item_name AS name,
       count(*)::bigint AS rows, round(sum(net_sales)::numeric, 0) AS amount, max(date) AS last_seen
FROM public.v_item_sales_keyed WHERE key_recovered_by_name AND item_key IS NULL GROUP BY 1, 2
UNION ALL
SELECT '断货名对不上商品目录', o.product_name,
       count(*)::bigint, round(sum(o.estimated_loss_amount)::numeric, 0), max(o.date::date)
FROM public.out_of_stock_record o
WHERE NOT EXISTS (SELECT 1 FROM public.v_product_identity i
                   WHERE i.name_zh = o.product_name OR i.name_en = o.product_name)
GROUP BY 1, 2;

COMMENT ON VIEW public.v_identity_gap IS
  '还没对上商品目录的东西。为空是好事；不为空说明有钱正在从统计里漏掉。'
  '107 之前这些缺口是静默的 —— 视图直接把它们 LEFT JOIN 掉，数字看起来完整实际少了一截。';

-- ── ⑥ 后置校验：金额必须对得上，不能再有静默丢失 ────────────────────────
DO $$
DECLARE
  v_waste numeric; src_waste numeric; ghost bigint; ident bigint; pairs bigint;
BEGIN
  SELECT count(*) INTO ident FROM public.v_product_identity;
  IF ident < 150 THEN RAISE EXCEPTION '身份桥只有 % 行，没接上 POS 目录', ident; END IF;

  -- 无名行必须清零：这是 107 最刺眼的症状
  SELECT count(*) INTO ghost FROM public.v_item_daily_pulse WHERE name_zh IS NULL;
  IF ghost > 0 THEN RAISE EXCEPTION '仍有 % 行无名商品', ghost; END IF;

  -- 报废总额必须与源表一致（补键后应当全部归位）
  SELECT COALESCE(sum(waste_amount), 0) INTO v_waste FROM public.v_item_daily_pulse;
  SELECT COALESCE(sum(amount), 0)       INTO src_waste FROM public.item_waste;
  IF abs(v_waste - src_waste) > 0.01 * src_waste THEN
    RAISE EXCEPTION '视图报废 % 与源表 % 相差超过 1%%，仍在丢数据', v_waste, src_waste;
  END IF;

  SELECT count(*) INTO pairs FROM public.v_forecast_accuracy
   WHERE date > current_date - 30 AND suggested_qty IS NOT NULL AND sold_qty IS NOT NULL;
  IF pairs < 100 THEN RAISE EXCEPTION '近30天预估配对只剩 % 对', pairs; END IF;

  RAISE NOTICE '108: 身份桥 % 行；无名行 0；报废视图 % / 源表 %；近30天配对 % 对',
    ident, round(v_waste), round(src_waste), pairs;
END $$;

INSERT INTO schema_migrations (version, name)
VALUES (108, 'identity_bridge_full_catalog') ON CONFLICT DO NOTHING;

COMMIT;

-- 回滚：把 107 的三个视图定义重新执行一遍即可（108 只 CREATE OR REPLACE，未删任何对象）；
-- 另需 DROP VIEW v_item_sales_keyed, v_item_waste_keyed, v_identity_gap
-- 与 DELETE FROM schema_migrations WHERE version = 108。
