-- 104: 店长手填的营业额挪到 daily_review，不再写进 daily_revenue
--
-- 【为什么】daily_revenue 现在有三个写者，其中两个会互相覆盖：
--   · res_api 每晚 KL 23:00 写 POS 实测值
--   · bakery-ops 的复盘页 upsertDailyRevenue()，`revenue = EXCLUDED.revenue`
--     ——**无条件覆盖 POS 实测值**
-- 店长白天填一个数把 POS 的盖掉，当晚 res_api 又反向抹掉店长的修正。
-- 双向静默互相消灭，谁也不知道自己填的数活了多久。
-- 而它上周还在用（daily_review 最新一条 2026-08-01 08:40Z）。
--
-- 两个数本来就是两件事：POS 实测是机器抓的事实，店长填的是人的判断
-- （手工单、跑单、当天特殊情况）。它们该并排存着互相对照，不是互相覆盖。
--
-- 【为什么放 daily_review 而不是新建表】
-- daily_review 已经是「店长当天写下的东西」这件事实的载体（复盘、建议、采纳与否），
-- 手填营业额就是同一粒度、同一来源的另一列。为它单开一张表只会多一次 join。

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.daily_review
  ADD COLUMN IF NOT EXISTS manager_revenue           numeric(12,2),
  ADD COLUMN IF NOT EXISTS manager_transaction_count integer,
  ADD COLUMN IF NOT EXISTS manager_avg_transaction   numeric(10,2),
  ADD COLUMN IF NOT EXISTS manager_revenue_at        timestamptz;

COMMENT ON COLUMN public.daily_review.manager_revenue IS
  '店长在复盘页手填的当日营业额。与 daily_revenue.revenue（POS 实测）是两个口径，'
  '并排存放互相对照，不再互相覆盖 —— 104 之前 bakery-ops 会用它无条件盖掉 POS 值。';
COMMENT ON COLUMN public.daily_review.manager_revenue_at IS
  '手填时刻。为空表示店长当天没填，不代表填了 0。';

-- ── 两个口径的对照视图 ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_revenue_manager_vs_pos
  WITH (security_invoker = true) AS
SELECT r.date,
       r.manager_revenue,
       d.revenue                                              AS pos_revenue,
       round((r.manager_revenue - d.revenue)::numeric, 2)     AS diff,
       CASE WHEN d.revenue IS NULL OR d.revenue = 0 THEN NULL
            ELSE round(100.0 * (r.manager_revenue - d.revenue)::numeric / d.revenue::numeric, 2)
       END                                                    AS diff_pct,
       r.manager_transaction_count,
       d.transaction_count                                    AS pos_transaction_count,
       r.manager_revenue_at
FROM public.daily_review r
LEFT JOIN public.daily_revenue d ON d.date = r.date
WHERE r.manager_revenue IS NOT NULL;

COMMENT ON VIEW public.v_revenue_manager_vs_pos IS
  '店长手填 vs POS 实测。差额持续偏大说明有一侧口径不对（手工单没进 POS，或抓取漏了渠道），'
  '这正是 104 之前被覆盖掉、因而永远看不见的信号。';

DO $$
DECLARE n int;
BEGIN
  -- 只数本迁移新增的四列。daily_review 本来就有 manager_text / manager_insight，
  -- 用 LIKE 'manager_%' 会把它们一起数进来。
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name='daily_review'
     AND column_name IN ('manager_revenue','manager_transaction_count',
                         'manager_avg_transaction','manager_revenue_at');
  IF n <> 4 THEN RAISE EXCEPTION '预期新增 4 列，实得 %', n; END IF;
  RAISE NOTICE '104: daily_review 已加店长录入列；bakery-ops 停写 daily_revenue 后由它承接';
END $$;

INSERT INTO schema_migrations (version, name)
VALUES (104, 'daily_review_manager_revenue') ON CONFLICT DO NOTHING;

COMMIT;

-- 回滚：
-- BEGIN;
--   DROP VIEW IF EXISTS public.v_revenue_manager_vs_pos;
--   ALTER TABLE public.daily_review
--     DROP COLUMN manager_revenue, DROP COLUMN manager_transaction_count,
--     DROP COLUMN manager_avg_transaction, DROP COLUMN manager_revenue_at;
--   DELETE FROM schema_migrations WHERE version = 104;
-- COMMIT;
