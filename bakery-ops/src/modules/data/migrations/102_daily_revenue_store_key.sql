-- 102: daily_revenue 补门店键 —— 第一阶段：加约束，不删旧的
--
-- 【为什么】daily_revenue 的唯一键只有 date，承不了第二家店。
-- 财务站为了绕开这一点，另建了 finance_revenue_daily（sql/039 的注释自己承认了：
-- 「POS 写者还依赖 uk_daily_revenue_date 和 ON CONFLICT (date)，所以保持旧契约不动、
-- 把模板行隔离到这里」）。那张表的全部存在理由，是没人愿意改另外两个仓库里的
-- 两条 ON CONFLICT 子句 —— 不是架构决策，是跨仓库协调成本的化石。
--
-- 【为什么这一版不删旧约束】
-- daily_revenue 有三个写者，分散在三个独立部署的仓库：
--   res_api        sync-to-db.js:156        每晚 KL 23:00（Contabo cron）
--   bakery-ops     daily-review.repository  店长在复盘页手填
--   财务站          import-batch.js:635,664  Excel 上传
-- 直接把 uk_daily_revenue_date 换掉，三边任何一个还没发新代码，
-- 它的 `ON CONFLICT ON CONSTRAINT uk_daily_revenue_date` 就找不到约束而报错。
-- 而唯一会喊的告警 freshness-check.ts:19-26 是 `catch { logger.warn; return; }`,
-- 42P01 会被原地吞掉 —— 当晚同步失败，次日早简报不发，没人知道为什么。
--
-- 所以拆成三步：本迁移只加不删（老代码照常跑）→ 三仓库各自独立发新代码
-- → 全部确认后由 103 单独 DROP 旧约束。到那一步才真正支持多门店。
--
-- 【为什么不顺手把 date 改成 date 类型】
-- 实测：ALTER COLUMN date TYPE date 之后，bakery-ops 的
-- forecast-calc.repository.ts:217 `current_date >= to_char(...)` 直接 ERROR 42883；
-- 且驱动返回值从 string 变成 Date，而 daily-review.repository.ts:61 显式声明返回 string，
-- 那个值直接进 Lark 周报文案。本次不动类型。

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ── ① 回填 store ────────────────────────────────────────────────────────
-- 实测 238/238 行 store 全为 NULL。取值与 pos_member / finance_* 一致，
-- 也与 106 补的 ops_store.pos_store_name 对得上。
--
-- ⚠ 这个回填只在单店期间无歧义。第二家店开业后，store IS NULL 的历史行
-- 归属谁将永远说不清 —— 这扇窗会关，且不会再开。
UPDATE daily_revenue SET store = '吉隆坡Pavilion门店' WHERE store IS NULL;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM daily_revenue WHERE store IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '仍有 % 行 store 为空', n; END IF;

  SELECT count(*) INTO n FROM (
    SELECT date, store FROM daily_revenue GROUP BY 1,2 HAVING count(*) > 1) t;
  IF n > 0 THEN RAISE EXCEPTION '(date, store) 有 % 组重复，建不了唯一约束', n; END IF;
END $$;

ALTER TABLE daily_revenue ALTER COLUMN store SET NOT NULL;
ALTER TABLE daily_revenue ALTER COLUMN store SET DEFAULT '吉隆坡Pavilion门店';

-- ── ② 新约束与旧约束并存 ────────────────────────────────────────────────
-- 单店期间两条都成立，互不冲突：uk_daily_revenue_date 更严（一天只能一行），
-- 它就是 103 要删的那一条 —— 删掉之前，多门店写入会被它挡住，这是预期行为。
ALTER TABLE daily_revenue
  ADD CONSTRAINT uk_daily_revenue_date_store UNIQUE (date, store);

COMMENT ON COLUMN daily_revenue.store IS
  '门店名，取值与 pos_member.store / finance_*.store 一致（经 ops_store.pos_store_name 与 store_code 对应）。'
  '102 回填，此前 238 行全为 NULL。';

-- ── ③ 对账视图：两个口径的重叠改为一行差异，而不是 409 冲突 ──────────────
CREATE OR REPLACE VIEW public.v_revenue_reconciliation
  WITH (security_invoker = true) AS
SELECT dr.date,
       dr.store,
       dr.import_source,
       dr.revenue                          AS reported_revenue,
       h.hourly_revenue,
       round((dr.revenue - h.hourly_revenue)::numeric, 2) AS revenue_diff,
       dr.transaction_count,
       h.hourly_bills,
       dr.transaction_count - h.hourly_bills               AS bill_diff
FROM daily_revenue dr
LEFT JOIN (
  SELECT date::text AS d, SUM(net_sales) AS hourly_revenue, SUM(bill_count) AS hourly_bills
  FROM hourly_sales_summary GROUP BY 1
) h ON h.d = dr.date;

COMMENT ON VIEW public.v_revenue_reconciliation IS
  'daily_revenue 与 hourly_sales_summary 的逐日对账。'
  '实测 214/214 天营收完全相等、213/214 天单量相等；唯一不符的 2026-04-12 差 25 单，'
  '是「无小时归属订单」，不是错误（sync-to-db.js:141-150 的注释写明了这个口径差）。'
  'revenue_diff 或 bill_diff 突然变大，说明抓取链路出了问题。';

-- ── ④ 后置校验 ─────────────────────────────────────────────────────────
DO $$
DECLARE n int; bad int;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid='public.daily_revenue'::regclass
     AND conname IN ('uk_daily_revenue_date','uk_daily_revenue_date_store');
  IF n <> 2 THEN RAISE EXCEPTION '预期新旧两条唯一约束并存，实得 %', n; END IF;

  -- 桥要能通：106 补的 ops_store.pos_store_name 必须能连上 daily_revenue.store
  SELECT count(*) INTO bad FROM ops_store st
   WHERE st.active AND NOT EXISTS (SELECT 1 FROM daily_revenue d WHERE d.store = st.pos_store_name);
  IF bad > 0 THEN
    RAISE WARNING '有 % 个启用门店的 pos_store_name 在 daily_revenue 里没有对应行', bad;
  END IF;

  RAISE NOTICE '102: store 已回填并加 NOT NULL，新旧约束并存。三仓库发完新代码后由 103 删旧约束';
END $$;

INSERT INTO schema_migrations (version, name)
VALUES (102, 'daily_revenue_store_key') ON CONFLICT DO NOTHING;

COMMIT;

-- ── 回滚 ───────────────────────────────────────────────────────────────
-- BEGIN;
--   DROP VIEW IF EXISTS public.v_revenue_reconciliation;
--   ALTER TABLE daily_revenue DROP CONSTRAINT uk_daily_revenue_date_store;
--   ALTER TABLE daily_revenue ALTER COLUMN store DROP NOT NULL,
--                             ALTER COLUMN store DROP DEFAULT;
--   -- store 的值保留：回填本身无害，且第二家店开业后就再也回填不了
--   DELETE FROM schema_migrations WHERE version = 102;
-- COMMIT;
