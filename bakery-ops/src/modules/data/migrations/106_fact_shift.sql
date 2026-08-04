-- 106: 排班事实表 fact_shift
--
-- 【来源】门店每天填的两张 Excel（后厨 / 前场），结构见 docs/templates/排班表.xlsx。
-- 列与 Excel 一一对应：Name / Post / 岗位 / on / off / notes / duration。
--
-- 【为什么 duration 是存的不是算的】
-- 门店手填。实测两张表的餐休口径不同：后厨「在岗 >9 小时扣 2 小时」、前场「一律扣 1 小时」，
-- 同样上 11 小时后厨记 9 小时、前场记 10 小时。这是业务现实不是数据错误，
-- 由公式反推会与门店的账对不上，所以按填的存。
--
-- 【为什么不存 turnover / total_hours / output_value】
-- Excel 表头那三行全部可推：营业额在 daily_revenue、总工时是 SUM(duration_h)、
-- 人效是两者相除。存进来就是三份重复事实。见 v_labor_productivity。
--
-- 【取代原方案的 fact_labor_hours】
-- 排班表本身就带工时，不需要再单独建一张工时表。一张 fact_shift 同时回答
-- 「谁上什么班什么岗」和「上了多少小时」。

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── ⓪ 先补门店身份的桥 ────────────────────────────────────────────────
-- 实测：库里有两套互不相通的门店标识
--   ops_store.store_code  = 'pavilion'            ← 人事招聘域 8 条外键挂它
--   daily_revenue.store / pos_member.store
--   / finance_*.store     = '吉隆坡Pavilion门店'   ← 销售/会员/财务域用它，无外键
-- 两者之间没有任何映射。fact_shift 需要同时接住两边（外键挂 ops_store，
-- 人效要 join daily_revenue），不补这一列，v_labor_productivity 会永远静默返回 NULL。
ALTER TABLE public.ops_store ADD COLUMN IF NOT EXISTS pos_store_name text;

UPDATE public.ops_store SET pos_store_name = '吉隆坡Pavilion门店'
 WHERE store_code = 'pavilion' AND pos_store_name IS NULL;

COMMENT ON COLUMN public.ops_store.pos_store_name IS
  '本门店在 POS / 财务侧的名字（daily_revenue.store、pos_member.store、finance_*.store 用的值）。'
  '库里两套门店标识的唯一桥梁：store_code 供人事招聘域外键，pos_store_name 供销售财务域按值连接。';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ops_store WHERE active AND pos_store_name IS NOT NULL) THEN
    RAISE EXCEPTION '没有任何启用门店填了 pos_store_name，人效视图会连不上 daily_revenue';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.fact_shift (
  work_date   date        NOT NULL,
  store_id    text        NOT NULL,
  area        text        NOT NULL,          -- 后厨 / 前场
  staff_name  text        NOT NULL,          -- Excel 的 Name。暂不挂 staff 外键：Excel 用小名，
                                             -- 与 staff.name 实测匹配不上，先按名字存，后续再补对照
  post        text        NOT NULL,          -- Excel 的 Post。'OFF' = 当天休息
  station     text,                          -- Excel 的「岗位」。可能是斜杠组合（陈列/考核/外送），
                                             -- 原样存，统计时取第一段作主岗
  on_time     time,
  off_time    time,                          -- 早于 on_time 表示跨夜（Ong 12:00→0:00）
  duration_h  numeric(4,2),                  -- 门店手填，不派生
  notes       text,
  source_file text,                          -- 导入的 Excel 文件名，用于追溯
  imported_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_fact_shift PRIMARY KEY (work_date, store_id, staff_name),
  CONSTRAINT ck_fact_shift_area  CHECK (area IN ('后厨','前场')),
  CONSTRAINT ck_fact_shift_off   CHECK (
    -- 休息的人不该有工时；上班的人必须有工时
    (post = 'OFF'  AND duration_h IS NULL AND on_time IS NULL AND off_time IS NULL)
 OR (post <> 'OFF' AND duration_h IS NOT NULL AND duration_h > 0)),
  CONSTRAINT ck_fact_shift_hours CHECK (duration_h IS NULL OR duration_h <= 16),
  CONSTRAINT fk_fact_shift_store FOREIGN KEY (store_id)
    REFERENCES public.ops_store(store_code) ON UPDATE CASCADE ON DELETE RESTRICT
);

ALTER TABLE public.fact_shift ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS fact_shift_date_area_idx ON public.fact_shift (work_date DESC, area);
CREATE INDEX IF NOT EXISTS fact_shift_post_idx      ON public.fact_shift (post) WHERE post <> 'OFF';

COMMENT ON TABLE public.fact_shift IS
  '排班事实。一行 = 一天 × 一个人。由门店每天填的 Excel 导入（docs/templates/排班表.xlsx）。'
  '★最小事实：只存 duration_h，总工时与人效一律由 v_labor_productivity 现算，不落表。'
  'post=''OFF'' 表示当天休息，保留在表里是为了让这张表同时是当日全员花名册。';
COMMENT ON COLUMN public.fact_shift.duration_h IS
  '门店手填的工时。后厨与前场的餐休口径不同（后厨 >9h 扣 2、前场一律扣 1），故不由 on/off 派生。';
COMMENT ON COLUMN public.fact_shift.station IS
  '岗位原文，可能是斜杠组合。主岗 = split_part(station,''/'',1)。';

-- ── 人效视图：Excel 表头那三行的等价物，全部现算 ──────────────────────
CREATE OR REPLACE VIEW public.v_labor_productivity
  WITH (security_invoker = true) AS
SELECT s.work_date,
       s.store_id,
       s.area,
       count(*) FILTER (WHERE s.post <> 'OFF')            AS on_duty,
       count(*) FILTER (WHERE s.post =  'OFF')            AS off_duty,
       SUM(s.duration_h)                                   AS total_hours,
       dr.revenue                                          AS turnover,
       round((dr.revenue / NULLIF(SUM(s.duration_h), 0))::numeric, 1) AS output_value
FROM public.fact_shift s
JOIN      public.ops_store     st ON st.store_code = s.store_id
LEFT JOIN public.daily_revenue dr ON dr.date  = s.work_date::text
                                 AND dr.store = st.pos_store_name   -- ← 经 ⓪ 补的桥
GROUP BY s.work_date, s.store_id, s.area, dr.revenue;

COMMENT ON VIEW public.v_labor_productivity IS
  '人效。output_value = 当日营业额 ÷ 当日总工时，等同门店 Excel 表头的 Output value。'
  '⚠ 待确认：门店两张 Excel 在同一天填了不同的 turnover（后厨 51000 / 前场 55000），'
  '本视图统一取 daily_revenue。若两个区域确实要用不同分母，需要业务方给出口径定义。';

-- ── 按岗位看工时去向 ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_shift_by_post
  WITH (security_invoker = true) AS
SELECT work_date, store_id, area, post,
       split_part(station, '/', 1)  AS main_station,
       count(*)                     AS headcount,
       SUM(duration_h)              AS hours
FROM public.fact_shift
WHERE post <> 'OFF'
GROUP BY 1,2,3,4,5;

INSERT INTO schema_migrations (version, name)
VALUES (106, 'fact_shift') ON CONFLICT DO NOTHING;

COMMIT;

-- ── 回滚（本库无 down 机制）───────────────────────────────────────────
-- BEGIN;
--   DROP VIEW IF EXISTS public.v_shift_by_post;
--   DROP VIEW IF EXISTS public.v_labor_productivity;
--   DROP TABLE IF EXISTS public.fact_shift;
--   DELETE FROM schema_migrations WHERE version = 106;
-- COMMIT;

-- ── 待办 ───────────────────────────────────────────────────────────────
-- 1. staff_name 暂未挂 staff 表外键：Excel 用的是小名（豪哥 / jie ee（兼职）/ 阿正），
--    与 staff.name 25 行实测匹配不上。需要一张小名 ↔ staff.user_id 的对照，
--    与成本卡那次同类问题一样，只能人工对一次。
-- 2. 两张 Excel 的 turnover 在同一天不同（51000 / 55000），口径待业务方确认。
-- 3. 前场 ali 一行的 duration 与 notes 的 break 2hour 对不上（填 10.0，按 11:00-22:30
--    扣 2 小时应为 9.5，而当日合计 144.5 是按 10.5 加出来的）。导入前请门店核一格。
