-- 107: 预估反馈闭环 —— 让「预估准不准」第一次可被计算
--
-- 【为什么需要】
-- forecast_snapshot 从 2026-07-03 起天天在写（1770 行，写到 8/4），但全仓库
-- 没有任何一处回算过它的误差：
--   · grep accuracy / forecastError / 预估准确 / 误差率 → 全仓库 0 命中
--   · 唯一读它并 join 实卖的地方是 daily-review-chat.definition.ts:317，
--     那里走的是 NORM(p.name_en) = NORM(item_name) 文本匹配，不是 item_key；
--     而且带 `a.sold > 0` 和 overPlan（plan-sold >= max(10, plan*0.25)）两道过滤、
--     LIMIT 8、只喂当天的 AI 上下文、不落库。
--     ORDER BY (suggested - sold) DESC 决定了它**结构上只能看见高估**，
--     低估（也就是断货那一半）永远不会出现在结果里。
-- 于是「做多了还是做少了」这个问题，系统从设计上就没打算回答。
--
-- 【第一次算出来的结果（近30天，736 对配对，29 天）】
--   平均建议 128.7 / 平均实卖 122.7 / 平均绝对误差 30.1 / 误差率 43.5% / 高估占比 67%
-- 与实测损失吻合：报废 RM163,238（10.9% 营业额）、烘焙品断货估损 RM165,123（11.0%）。
--
-- 【为什么不新建主数据表】
-- 主数据已经存在：product 54 行同时有 name（中文）、name_en（英文）、item_key（POS 键），
-- 还带 avg_monday_to_thursday / avg_friday / avg_weekend / baseline_* / time_slots /
-- pack_multiple / break_stock_time。缺的从来不是表，是没有代码走这座桥。
-- 所以本迁移一张表都不建，只建视图。
--
-- 【为什么用 item_key 而不是名字】
-- 同一个商品在库里有四套叫法（POS 英文 / 预估中文 / 缺货中英混杂 / 成本卡另一套中文）。
-- item_key 是 POS 的稳定主键（org-type-item 三段式），是唯一不会因为改名而断的锚。
-- 实测：预估的 47 个品项 47/47 都能经 product.name 命中，命中后 item_key 直连销售与报废。

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── ① 商品身份桥：把四套叫法收敛到 item_key ──────────────────────────
-- 单独成视图，是为了让下游不必每次重复 product / product_alias 的 join 细节，
-- 也让「某个名字对不上」这件事有一个统一的排查入口。
CREATE OR REPLACE VIEW public.v_product_identity
  WITH (security_invoker = true) AS
SELECT p.id            AS product_id,
       p.item_key,
       p.name          AS name_zh,
       p.name_en,
       p.category,
       p.positioning,
       p.pack_multiple,
       p.break_stock_time,
       p.time_slots
FROM public.product p
WHERE p.item_key IS NOT NULL;

COMMENT ON VIEW public.v_product_identity IS
  '商品身份桥。product 已经是主数据（中文名/英文名/POS item_key 三者齐全），本视图只是把'
  '「有 item_key 才算可对账」这条规则固定下来。'
  '实测 54 行里 47 行有 item_key；缺的 7 行英文名有手工录入错误（Chololate、双空格、小写 hot），'
  '需要像成本卡那 37 对映射一样人工补，补完自动进入本视图。';

-- ── ② 预估 vs 实卖：双向，不做任何方向性过滤 ──────────────────────────
-- FULL JOIN 而不是 INNER：只 INNER 的话，「预估了但一个没卖出」与
-- 「没预估却卖了」这两种最值得看的情况会同时消失。
CREATE OR REPLACE VIEW public.v_forecast_accuracy
  WITH (security_invoker = true) AS
WITH forecast AS (
  SELECT s.date::date AS d, i.item_key, sum(s.suggested_qty) AS suggested_qty
  FROM public.forecast_snapshot s
  JOIN public.v_product_identity i ON i.name_zh = s.product_name
  GROUP BY 1, 2
),
actual AS (
  SELECT date AS d, item_key, sum(qty) AS sold_qty, sum(net_sales) AS net_sales
  FROM public.item_hourly_sales
  GROUP BY 1, 2
)
SELECT COALESCE(f.d, a.d)                       AS date,
       COALESCE(f.item_key, a.item_key)         AS item_key,
       i.name_zh,
       i.category,
       i.positioning,
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
  '预估 vs 实卖，逐日逐品，走 item_key。'
  'direction 同时保留高估与低估 —— 这正是 daily-review-chat 那处 overPlan 过滤看不见的另一半。'
  '近30天基线（建视图时实测）：736 对配对、平均绝对误差 30.1、误差率 43.5%、高估占比 67%。'
  '这三个数往上走就是预估在退化，是这套系统唯一的自检信号。';

-- ── ③ 单品每日全景：预估 / 实卖 / 报废 / 断货 放在同一行 ───────────────
-- 这四件事此前分散在四张表、四套命名里，从来没有在同一行上出现过。
-- 「又多做又断货」这种最贵的模式（黑松露牛排惠灵顿：平均每天多做 79 个，
-- 同时 13 天断货、估损 RM67,641），只有并排放才看得出来 ——
-- 它说明问题不在总量而在时段分配，对应 product.break_stock_time 那个没人用的字段。
CREATE OR REPLACE VIEW public.v_item_daily_pulse
  WITH (security_invoker = true) AS
WITH waste AS (
  SELECT date AS d, item_key, sum(qty) AS waste_qty, sum(amount) AS waste_amount
  FROM public.item_waste
  GROUP BY 1, 2
),
oos AS (
  -- 断货表没有 item_key，中英混杂，还混进了现制饮品与周边（那些不在 product 里，
  -- 属于误报，见迁移 100 的 beverageItems / stockoutExcludeItems 白名单）。
  -- 经 product 归一后自动只剩烘焙品：实测近30天 286 条烘焙品 / 109 条对不上。
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
SELECT fa.date,
       fa.item_key,
       fa.name_zh,
       fa.category,
       fa.suggested_qty,
       fa.sold_qty,
       fa.net_sales,
       fa.deviation,
       fa.direction,
       w.waste_qty,
       w.waste_amount,
       o.oos_events,
       o.first_soldout_time,
       o.oos_loss_amount,
       -- 一天里「白做的」加上「没做够的」，两个方向的钱合起来
       COALESCE(w.waste_amount, 0) + COALESCE(o.oos_loss_amount, 0) AS total_loss_amount,
       CASE
         WHEN w.waste_qty > 0 AND o.oos_events > 0 THEN '又多做又断货（时段分配问题）'
         WHEN w.waste_qty > 0                      THEN '做多了'
         WHEN o.oos_events > 0                     THEN '做少了'
         ELSE '正常'
       END AS loss_pattern
FROM public.v_forecast_accuracy fa
LEFT JOIN waste w ON w.d = fa.date AND w.item_key = fa.item_key
LEFT JOIN oos   o ON o.d = fa.date AND o.item_key = fa.item_key;

COMMENT ON VIEW public.v_item_daily_pulse IS
  '单品每日全景：预估 / 实卖 / 报废 / 断货 第一次出现在同一行。'
  'loss_pattern = ''又多做又断货'' 是最贵的一类 —— 总量对了但时段错了，'
  '靠加减总产量永远修不好，要动 product.break_stock_time 与 time_slots。'
  'total_loss_amount 是零售口径（实测 item_waste 单价 RM9.00 vs POS 实卖均价 RM8.73，是标价）。';

-- ── ④ 后置校验：视图必须真的能出数，不能建完就是空的 ────────────────
DO $$
DECLARE n_pair int; n_ident int; n_pattern int;
BEGIN
  SELECT count(*) INTO n_ident FROM public.v_product_identity;
  IF n_ident < 30 THEN
    RAISE EXCEPTION '商品身份桥只有 % 行，product.item_key 可能大面积缺失', n_ident;
  END IF;

  SELECT count(*) INTO n_pair FROM public.v_forecast_accuracy
   WHERE date > current_date - 30 AND suggested_qty IS NOT NULL AND sold_qty IS NOT NULL;
  IF n_pair < 100 THEN
    RAISE EXCEPTION '近30天预估与实卖只配上 % 对，桥没通', n_pair;
  END IF;

  SELECT count(*) INTO n_pattern FROM public.v_item_daily_pulse
   WHERE date > current_date - 30 AND loss_pattern = '又多做又断货（时段分配问题）';

  RAISE NOTICE '107: 身份桥 % 行；近30天预估配对 % 对；其中「又多做又断货」% 条',
    n_ident, n_pair, n_pattern;
END $$;

INSERT INTO schema_migrations (version, name)
VALUES (107, 'forecast_feedback_loop') ON CONFLICT DO NOTHING;

COMMIT;

-- 回滚：
-- BEGIN;
--   DROP VIEW IF EXISTS public.v_item_daily_pulse;
--   DROP VIEW IF EXISTS public.v_forecast_accuracy;
--   DROP VIEW IF EXISTS public.v_product_identity;
--   DELETE FROM schema_migrations WHERE version = 107;
-- COMMIT;
