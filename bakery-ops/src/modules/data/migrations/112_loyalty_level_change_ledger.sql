-- 112: See You Often 滚动等级变更账本
--
-- RES 的自动升级不会写等级 operation log；直接降级是否写日志也尚未得到生产实证。
-- “每月 1 日、每次最多降一级”因此不能依赖 RES 日志做幂等。此表由 tokyo-01 上唯一的
-- res_api 滚动等级任务写入：先 claim，再调用 RES，回读成功后置 applied。即使进程在
-- RES 成功后、数据库确认前崩溃，下一轮也能用账本目标等级和 RES 当前等级收敛，而不会
-- 在同月再降一级。
--
-- 只保存不可逆写入所需的非展示型 ID 与等级/窗口事实；不保存姓名、手机号、生日或卡号。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mkt_loyalty_level_change_ledger (
  ledger_id           bigint      GENERATED ALWAYS AS IDENTITY,
  card_id             text        NOT NULL,
  recalculation_date  date        NOT NULL,
  action              text        NOT NULL DEFAULT 'downgrade',
  window_from         date        NOT NULL,
  window_to           date        NOT NULL,
  from_level_id       text        NOT NULL,
  target_level_id     text        NOT NULL,
  status              text        NOT NULL DEFAULT 'claimed',
  claim_token         uuid        NOT NULL,
  attempt_count       integer     NOT NULL DEFAULT 1,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  applied_at          timestamptz,
  CONSTRAINT mkt_loyalty_level_change_ledger_pkey PRIMARY KEY (ledger_id),
  CONSTRAINT uk_mkt_loyalty_level_change_month
    UNIQUE (card_id, recalculation_date, action),
  CONSTRAINT ck_mkt_loyalty_level_change_action
    CHECK (action = 'downgrade'),
  CONSTRAINT ck_mkt_loyalty_level_change_status
    CHECK (status IN ('claimed', 'applied', 'failed', 'ambiguous')),
  CONSTRAINT ck_mkt_loyalty_level_change_month_start
    CHECK (extract(day FROM recalculation_date) = 1),
  CONSTRAINT ck_mkt_loyalty_level_change_window
    CHECK (window_from <= window_to),
  CONSTRAINT ck_mkt_loyalty_level_change_levels
    CHECK (from_level_id <> target_level_id),
  CONSTRAINT ck_mkt_loyalty_level_change_attempts
    CHECK (attempt_count >= 1),
  CONSTRAINT ck_mkt_loyalty_level_change_applied_at
    CHECK (
      (status = 'applied' AND applied_at IS NOT NULL)
      OR (status <> 'applied' AND applied_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_mkt_loyalty_level_change_status
  ON public.mkt_loyalty_level_change_ledger (recalculation_date, status);

COMMENT ON TABLE public.mkt_loyalty_level_change_ledger IS
  'See You Often 每月滚动等级变更幂等账本。res_api 先 claim、再写 RES、回读后置 applied；'
  '唯一键保证同一卡同月最多一个 downgrade 业务操作。';

COMMENT ON COLUMN public.mkt_loyalty_level_change_ledger.card_id IS
  'RES 会员卡内部 ID；不保存卡号、姓名、手机号或生日。';
COMMENT ON COLUMN public.mkt_loyalty_level_change_ledger.status IS
  'claimed=已占位待写 RES；applied=RES 回读已到目标；failed=确认未生效/已恢复；'
  'ambiguous=无法证明 RES 最终状态，必须人工核对且禁止同月再降。';
COMMENT ON COLUMN public.mkt_loyalty_level_change_ledger.claim_token IS
  '单次执行所有权 token；状态推进使用 CAS，防止第二写者抢占新鲜 claim。';

REVOKE ALL ON TABLE public.mkt_loyalty_level_change_ledger FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.mkt_loyalty_level_change_ledger_ledger_id_seq
  FROM anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES (112, 'loyalty_level_change_ledger')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- 回滚（只允许在未产生任何账本行时执行）：
-- BEGIN;
--   DO $$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM public.mkt_loyalty_level_change_ledger LIMIT 1) THEN
--       RAISE EXCEPTION 'refusing to drop a non-empty loyalty level ledger';
--     END IF;
--   END $$;
--   DROP TABLE public.mkt_loyalty_level_change_ledger;
--   DELETE FROM public.schema_migrations WHERE version = 112;
-- COMMIT;
