-- 101: 给 hbti_gift_stock 补 RLS
--
-- 背景：这个 Supabase 库是四个代码库共用的。财务站在它的迁移 059 里立了一条不变量
-- ——public 下每张普通表都必须启用行级安全。本仓库 077 建 hbti_gift_stock 时没跟上，
-- 于是财务站的 db-integration --all 门禁 tables_without_rls 变红，
-- 是它先替我们发现了这张漏网的表。
--
-- 为什么补这一下安全、也不需要写策略：
--   * 同为本项目所建的 hbti_auth_token、hbti_rate_limit 都是 rls=true 且零策略，一直正常；
--   * 各项目都以 postgres 身份连库，该角色 rolbypassrls=true，RLS 对它不生效；
--   * anon / authenticated 在这张表上本来就没有任何授权（059 已清零并收回默认权限）。
--   RLS 在这里是「关掉默认敞开」的兜底，不是运行时访问控制，发券路径不受影响。
--
-- 【为什么是 101 而不是 079】
-- 100_beverage_caliber.sql 划定了号段：财务站 001-099、bakery-ops 100-199、res_api 200-299。
-- 077/078 当时越进了财务站号段（已应用，不追改）；本迁移回到本仓库自己的段内，
-- 避免下一次两边再撞号。
--
-- 共用库的规矩：本项目在 public 下新建表时请一并 ENABLE ROW LEVEL SECURITY，
-- 否则下次仍会由对方的门禁来发现。

BEGIN;

ALTER TABLE hbti_gift_stock ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF bad > 0 THEN
    RAISE EXCEPTION 'public 下仍有 % 张表未启用 RLS', bad;
  END IF;
  RAISE NOTICE '101: hbti_gift_stock 已启用 RLS；public 下所有普通表均已覆盖';
END $$;

INSERT INTO schema_migrations (version, name)
VALUES (101, '101_hbti_gift_stock_rls')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- 回滚（如需）：
--   ALTER TABLE hbti_gift_stock DISABLE ROW LEVEL SECURITY;
--   DELETE FROM schema_migrations WHERE version = 101;
-- 回滚会让财务站门禁重新变红。
