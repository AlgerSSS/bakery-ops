-- 109: 当日毛利率 + 节假日系数回填
--
-- 老板提的七条里，这两条是**今天就能出数**的；采购价波动与配方波动的数据不够（见文末）。
--
-- ═══ 一、当日毛利率 ═══
-- 成本卡 × 销售第一次接得上：cost_card_product_link.pos_item_id 存的是**裸 item_id**
-- （item_key 的第三段），这是唯一与 org 无关的商品身份 ——
-- item_key = {org_id}-{org_type}-{item_id}，而同一商品在两个 org 下各有一条。
--
-- ⚠ 成本卡本身有错（店主 2026-08-05 确认，后续会更新）。实测按销售额分布：
--     看起来合理        26 品项  RM1,011,456  67%
--     毛利率<25%（可疑） 4 品项  RM  282,419  19%   ← 招牌惠灵顿在这组，17.1%
--     无成本卡          30 品项  RM  178,516  12%
--     毛利率>80%（可疑） 2 品项  RM   41,057   3%
-- 所以视图**必须两种口径都报**：all-in 会被那 19% 拖低，trusted-only 才能看趋势。
-- 只报一个数、还是被污染的那个，比不报更糟 —— 它会让人对着错的成本做定价决策。
--
-- ═══ 二、节假日系数 ═══
-- holiday 表 18 行（2026 全年公共假期，2026-04-05 一次性录入），coefficient 全部为 NULL。
-- 预估引擎从来不知道有节假日这回事：engine/monthly-target.ts 用的是 business_rule
-- 的 monthlyCoefficients（**月**系数），daily-review.service.ts:30 只取 name/type/note
-- 喂给 AI 当叙述背景，不参与计算。
-- 后果实测：开斋节第二天卖平日的 2.10 倍，预估按平日算。
--
-- 系数不需要去网上抓 API —— 12 个已过去的假期都有完整销售，直接回归即可。
-- 「当日 ÷ 前后 14 天工作日均值」这个口径的取舍：
--   · 排除周末，因为周末本身已由 business_rule.weekdayWeights 处理（周六日 1.55），
--     不排除的话节假日系数会把周末效应重复计一次；
--   · ±14 天而不是整月，是为了贴近当时的营业水平（本店营业额逐月在长）。

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── ① 回填已发生假期的实测系数 ──────────────────────────────────────────
UPDATE holiday h
   SET coefficient = m.factor,
       updated_at  = now()
  FROM (
    SELECT h2.id,
           round((d.net / NULLIF(base.avg_net, 0))::numeric, 3) AS factor
    FROM holiday h2
    JOIN LATERAL (
      SELECT sum(net_sales) AS net FROM hourly_sales_summary WHERE date = h2.date::date
    ) d ON d.net IS NOT NULL
    JOIN LATERAL (
      SELECT avg(s) AS avg_net FROM (
        SELECT date, sum(net_sales) AS s FROM hourly_sales_summary
         WHERE date BETWEEN h2.date::date - 14 AND h2.date::date + 14
           AND date <> h2.date::date
           AND extract(dow FROM date) NOT IN (0, 6)   -- 周末效应已由 weekdayWeights 承担
         GROUP BY 1
      ) x
    ) base ON base.avg_net > 0
    WHERE h2.date::date < current_date
  ) m
 WHERE h.id = m.id;

COMMENT ON COLUMN holiday.coefficient IS
  '实测销售倍数 = 当日营业额 ÷ 前后14天工作日均值。109 从历史回填（不需要外部 API）。'
  '仅已发生的假期有值；未来假期用 v_holiday_factor 按同类型均值兜底。'
  '⚠ 预估引擎目前**不读这一列** —— 回填只是把数据准备好，engine 侧仍需接入。';

-- ── ② 未来假期没有实测值，按同类型均值兜底 ──────────────────────────────
CREATE OR REPLACE VIEW public.v_holiday_factor
  WITH (security_invoker = true) AS
WITH measured AS (
  SELECT type, avg(coefficient) AS type_avg, count(*) AS n
  FROM holiday WHERE coefficient IS NOT NULL GROUP BY 1
)
SELECT h.date,
       h.name,
       h.type,
       h.coefficient                                        AS measured_factor,
       COALESCE(h.coefficient, m.type_avg, 1.0)             AS factor,
       CASE WHEN h.coefficient IS NOT NULL THEN '实测'
            WHEN m.type_avg IS NOT NULL     THEN '同类型均值(' || m.n || '个样本)'
            ELSE '无依据，按 1.0'
       END                                                  AS factor_source
FROM holiday h
LEFT JOIN measured m ON m.type = h.type;

COMMENT ON VIEW public.v_holiday_factor IS
  '每个假期该乘多少。factor_source 说明这个数是实测的还是猜的 —— '
  '预估引擎接入时应当把「猜的」和「实测的」区别对待，别让 1.0 兜底伪装成有依据。';

-- ── ③ 单品成本可信度 ────────────────────────────────────────────────────
-- 成本卡在修之前，任何毛利数字都必须带着它的可信度一起流动。
CREATE OR REPLACE VIEW public.v_item_cost_quality
  WITH (security_invoker = true) AS
WITH recent AS (
  SELECT split_part(item_key, '-', 3) AS pos_item_id,
         sum(net_sales) AS sales_30d,
         sum(qty)       AS qty_30d
  FROM public.v_item_sales_keyed
  WHERE date > current_date - 30 AND item_key IS NOT NULL
  GROUP BY 1
)
SELECT r.pos_item_id,
       i.name_zh,
       r.sales_30d,
       r.qty_30d,
       r.sales_30d / NULLIF(r.qty_30d, 0)                       AS realized_price,
       c.unit_cost,
       c.missing_price_count,
       CASE WHEN c.unit_cost IS NULL OR r.qty_30d = 0 THEN NULL
            ELSE round((1 - c.unit_cost / (r.sales_30d / r.qty_30d))::numeric, 4)
       END                                                      AS margin_rate,
       CASE
         WHEN c.unit_cost IS NULL                            THEN 'no_cost_card'
         WHEN c.missing_price_count > 0                      THEN 'missing_material_price'
         WHEN r.qty_30d = 0                                  THEN 'no_sales'
         WHEN c.unit_cost >= r.sales_30d / r.qty_30d         THEN 'cost_exceeds_price'
         WHEN (1 - c.unit_cost / (r.sales_30d / r.qty_30d)) < 0.25 THEN 'margin_too_low'
         WHEN (1 - c.unit_cost / (r.sales_30d / r.qty_30d)) > 0.80 THEN 'margin_too_high'
         ELSE 'ok'
       END                                                      AS quality,
       (c.unit_cost IS NOT NULL
        AND c.missing_price_count = 0
        AND r.qty_30d > 0
        AND c.unit_cost < r.sales_30d / r.qty_30d
        AND (1 - c.unit_cost / (r.sales_30d / r.qty_30d)) BETWEEN 0.25 AND 0.80) AS cost_trusted
FROM recent r
LEFT JOIN public.cost_card_product_link l ON l.pos_item_id = r.pos_item_id
LEFT JOIN public.v_cost_card_current_cost c ON c.item_id = l.item_id
-- ⚠ 必须先收敛到一行：同一个 pos_item_id 在两个 org 下有两个 item_key、
-- 因而在 v_product_identity 里有两行（名字还可能不同，如「黑松露牛排惠灵顿」
-- 与「招牌黑松露牛排惠灵顿」）。直接 join 会让每个品在工作单里出现两次。
-- 优先取排产主数据里的那条（is_planned），它的中文名是店里实际在用的叫法。
LEFT JOIN LATERAL (
  SELECT name_zh FROM public.v_product_identity i2
   WHERE split_part(i2.item_key, '-', 3) = r.pos_item_id AND i2.name_zh IS NOT NULL
   ORDER BY i2.is_planned DESC, i2.item_key
   LIMIT 1
) i ON true;

COMMENT ON VIEW public.v_item_cost_quality IS
  '单品成本卡可信度。cost_trusted=false 的品，它的毛利数字不能用来做定价决策。'
  '25%/80% 这两条线是经验阈值，不是真理 —— 它们的作用是把「需要人看一眼」的品挑出来，'
  '而不是断言那些成本一定是错的。店主 2026-08-05 已确认成本卡有错、后续会更新。';

-- ── ④ 当日毛利率 ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_daily_margin
  WITH (security_invoker = true) AS
WITH s AS (
  SELECT v.date,
         split_part(v.item_key, '-', 3) AS pos_item_id,
         sum(v.qty)       AS qty,
         sum(v.net_sales) AS net_sales
  FROM public.v_item_sales_keyed v
  WHERE v.item_key IS NOT NULL
  GROUP BY 1, 2
)
SELECT s.date,
       sum(s.net_sales)                                                    AS net_sales,
       sum(s.net_sales) FILTER (WHERE c.unit_cost IS NOT NULL)             AS costed_sales,
       sum(s.qty * c.unit_cost)                                            AS cogs,
       sum(s.net_sales) FILTER (WHERE c.unit_cost IS NOT NULL)
         - sum(s.qty * c.unit_cost)                                        AS gross_profit,
       round((100.0 * (sum(s.net_sales) FILTER (WHERE c.unit_cost IS NOT NULL)
              - sum(s.qty * c.unit_cost))
              / NULLIF(sum(s.net_sales) FILTER (WHERE c.unit_cost IS NOT NULL), 0))::numeric, 1)
                                                                           AS margin_pct,
       -- 只用可信成本卡算的那一版：成本卡修好之前，看趋势要看这个
       round((100.0 * (sum(s.net_sales) FILTER (WHERE q.cost_trusted)
              - sum(s.qty * c.unit_cost) FILTER (WHERE q.cost_trusted))
              / NULLIF(sum(s.net_sales) FILTER (WHERE q.cost_trusted), 0))::numeric, 1)
                                                                           AS margin_pct_trusted,
       round((100.0 * sum(s.net_sales) FILTER (WHERE c.unit_cost IS NOT NULL)
              / NULLIF(sum(s.net_sales), 0))::numeric, 1)                  AS cost_coverage_pct,
       round((100.0 * sum(s.net_sales) FILTER (WHERE q.cost_trusted)
              / NULLIF(sum(s.net_sales), 0))::numeric, 1)                  AS trusted_coverage_pct
FROM s
LEFT JOIN public.cost_card_product_link l ON l.pos_item_id = s.pos_item_id
LEFT JOIN public.v_cost_card_current_cost c ON c.item_id = l.item_id
LEFT JOIN public.v_item_cost_quality q ON q.pos_item_id = s.pos_item_id
GROUP BY 1;

COMMENT ON VIEW public.v_daily_margin IS
  '当日毛利率。两个口径同时给：margin_pct 是全部有成本卡的品，'
  'margin_pct_trusted 只用通过质量检查的品。'
  '⚠ 成本卡有错的期间，只看 margin_pct 会被低毛利的错误成本卡拖低 —— '
  '实测 19% 的销售额（含最大单品招牌惠灵顿）落在「毛利率<25%」这一档。'
  'cost_coverage_pct / trusted_coverage_pct 是这两个数各自的可信底座，必须一起看。';

-- ── ⑤ 后置校验 ─────────────────────────────────────────────────────────
DO $$
DECLARE n_holiday int; n_cov numeric; n_days int;
BEGIN
  SELECT count(*) INTO n_holiday FROM holiday WHERE coefficient IS NOT NULL;
  IF n_holiday < 8 THEN
    RAISE EXCEPTION '只回填了 % 个假期系数，历史销售应当覆盖更多', n_holiday;
  END IF;

  SELECT count(*) INTO n_days FROM public.v_daily_margin WHERE date > current_date - 30;
  IF n_days < 20 THEN RAISE EXCEPTION '近30天只有 % 天能算毛利', n_days; END IF;

  SELECT avg(cost_coverage_pct) INTO n_cov FROM public.v_daily_margin WHERE date > current_date - 30;
  IF n_cov < 80 THEN RAISE EXCEPTION '成本覆盖率只有 %%%，接不上', round(n_cov); END IF;

  RAISE NOTICE '109: 回填 % 个假期系数；近30天 % 天可算毛利，平均成本覆盖 %%%',
    n_holiday, n_days, round(n_cov, 1);
END $$;

INSERT INTO schema_migrations (version, name)
VALUES (109, 'margin_and_holiday_factor') ON CONFLICT DO NOTHING;

COMMIT;

-- ═══ 还缺什么数据（老板另外几条建议做不了的原因）═══
--
-- 【采购价随市场波动】做不了。
--   cost_card_item_price 344 行 / 344 个物料 / **每个物料只有 1 个价格版本**，
--   effective_from 全部落在 2026-07-14 ~ 07-27，是一次性快照不是时间序列。
--   需要：每次采购价变动时新增一条（保留旧行、给旧行填 effective_to），
--         或者把历史采购单价从 finance_supplier_orders 补进来。
--
-- 【成本随配方波动】数据太薄。
--   cost_card_recipe 289 行覆盖 270 个成品，其中 254 个只有 1 个版本，
--   13 个 2 版、3 个 3 版，且全部集中在 2026-07-14 ~ 07-30 两周内。
--   需要：至少几个月的配方版本历史才谈得上「波动」。
--
-- 【订货表接进来】键对不上。
--   finance_supplier_orders 是月度供应商台账（month/supplier/item/spec/qty/price/amount），
--   115 个物料名里只有 18 个（15.7%）能精确匹配 cost_card_item.name。
--   需要：给订货物料建一张与 cost_card_item 的映射表（同 080 那 37 对成本卡映射的做法），
--         否则「订货量 ↔ 配方用量」这条链接不上。
--
-- 【人事打分 / 入职培训】库里一行都没有。
--   trials.score 这一列存在但 trials 表 0 行；employee_events / offers 同样 0 行；
--   fact_shift 0 行。这几件不是接口问题，是从来没开始录。
--
-- 回滚：
-- BEGIN;
--   DROP VIEW IF EXISTS public.v_daily_margin;
--   DROP VIEW IF EXISTS public.v_item_cost_quality;
--   DROP VIEW IF EXISTS public.v_holiday_factor;
--   UPDATE holiday SET coefficient = NULL;
--   DELETE FROM schema_migrations WHERE version = 109;
-- COMMIT;
