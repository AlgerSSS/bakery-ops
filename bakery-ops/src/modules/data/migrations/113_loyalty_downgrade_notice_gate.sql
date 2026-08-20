-- 113: See You Often 降级前 7 天 RES SMS 送达门禁
--
-- 已确认规则：降级前 7 天由会员系统提醒并给出保级差额；正式触达只能走 RES SMS。
-- 迁移 112 已解决“同月最多降一级”的幂等，但不能证明会员收到过预警。此迁移新增送达事实表，
-- 并让每条降级 ledger 强制引用一条等级变化匹配、由应用确认 delivered 的通知记录。
-- 预警日在 10/25，只能看到截至 10/24 的消费；11/1 降级会看到截至 10/31 的消费，因此两者
-- 的滚动窗口刻意不做外键相等。若最后 7 天消费已保级，系统自然不产生 downgrade plan；若等级
-- 变化方向与预警不一致，from/target 外键会拒绝。
--
-- 当前 112 ledger 正式行数为 0，因此可以安全增加 NOT NULL notice_id。若其他环境已有 ledger
-- 行，本迁移应明确失败，先逐条补送达凭据，不允许用 NULL 绕过业务门禁。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mkt_loyalty_downgrade_notice (
  notice_id            bigint      GENERATED ALWAYS AS IDENTITY,
  card_id              text        NOT NULL,
  recalculation_date   date        NOT NULL,
  notice_date          date        NOT NULL,
  action               text        NOT NULL DEFAULT 'downgrade',
  window_from          date        NOT NULL,
  window_to            date        NOT NULL,
  from_level_id        text        NOT NULL,
  target_level_id      text        NOT NULL,
  keep_level_gap       numeric(14,2) NOT NULL,
  delivery_channel     text        NOT NULL DEFAULT 'res_sms',
  status               text        NOT NULL DEFAULT 'planned',
  claim_token          uuid        NOT NULL,
  attempt_count        integer     NOT NULL DEFAULT 1,
  provider_message_id  text,
  last_error           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  delivered_at         timestamptz,
  CONSTRAINT mkt_loyalty_downgrade_notice_pkey PRIMARY KEY (notice_id),
  CONSTRAINT uk_mkt_loyalty_downgrade_notice_month
    UNIQUE (card_id, recalculation_date, delivery_channel),
  CONSTRAINT uk_mkt_loyalty_downgrade_notice_ledger_facts
    UNIQUE (
      notice_id,
      card_id,
      recalculation_date,
      action,
      from_level_id,
      target_level_id
    ),
  CONSTRAINT ck_mkt_loyalty_downgrade_notice_action
    CHECK (action = 'downgrade'),
  CONSTRAINT ck_mkt_loyalty_downgrade_notice_channel
    CHECK (delivery_channel = 'res_sms'),
  CONSTRAINT ck_mkt_loyalty_downgrade_notice_status
    CHECK (status IN ('planned', 'sending', 'delivered', 'failed', 'ambiguous')),
  CONSTRAINT ck_mkt_loyalty_downgrade_notice_month_start
    CHECK (extract(day FROM recalculation_date) = 1),
  CONSTRAINT ck_mkt_loyalty_downgrade_notice_exact_date
    CHECK (notice_date = recalculation_date - 7),
  CONSTRAINT ck_mkt_loyalty_downgrade_notice_window
    CHECK (window_from <= window_to),
  CONSTRAINT ck_mkt_loyalty_downgrade_notice_levels
    CHECK (from_level_id <> target_level_id),
  CONSTRAINT ck_mkt_loyalty_downgrade_notice_gap
    CHECK (keep_level_gap >= 0),
  CONSTRAINT ck_mkt_loyalty_downgrade_notice_attempts
    CHECK (attempt_count >= 1),
  CONSTRAINT ck_mkt_loyalty_downgrade_notice_delivery
    CHECK (
      (
        status = 'delivered'
        AND delivered_at IS NOT NULL
        AND provider_message_id IS NOT NULL
        AND (delivered_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date = notice_date
      )
      OR (
        status <> 'delivered'
        AND delivered_at IS NULL
        AND provider_message_id IS NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS ix_mkt_loyalty_downgrade_notice_status
  ON public.mkt_loyalty_downgrade_notice (notice_date, status);

COMMENT ON TABLE public.mkt_loyalty_downgrade_notice IS
  'See You Often 降级前 7 天 RES SMS 预警送达事实。没有同卡、同月、同等级变化的 delivered 行，'
  'mkt_loyalty_level_change_ledger 就不能 claim。预警与最终降级窗口不同是正常的：中间有 7 天。';
COMMENT ON COLUMN public.mkt_loyalty_downgrade_notice.keep_level_gap IS
  '发送时写入短信的保级差额（RM 实付口径，保留两位小数）。';
COMMENT ON COLUMN public.mkt_loyalty_downgrade_notice.provider_message_id IS
  'RES SMS 返回的非 PII 消息标识；delivered 状态必须有该标识。';

ALTER TABLE public.mkt_loyalty_level_change_ledger
  ADD COLUMN notice_id bigint;

ALTER TABLE public.mkt_loyalty_level_change_ledger
  ALTER COLUMN notice_id SET NOT NULL;

ALTER TABLE public.mkt_loyalty_level_change_ledger
  ADD CONSTRAINT fk_mkt_loyalty_level_change_notice
  FOREIGN KEY (
    notice_id,
    card_id,
    recalculation_date,
    action,
    from_level_id,
    target_level_id
  )
  REFERENCES public.mkt_loyalty_downgrade_notice (
    notice_id,
    card_id,
    recalculation_date,
    action,
    from_level_id,
    target_level_id
  )
  ON UPDATE RESTRICT
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.guard_loyalty_downgrade_notice_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.mkt_loyalty_level_change_ledger ledger
    WHERE ledger.notice_id = OLD.notice_id
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'cannot delete a downgrade notice referenced by the level ledger';
    END IF;
    IF NEW.status <> 'delivered'
       OR NEW.card_id <> OLD.card_id
       OR NEW.recalculation_date <> OLD.recalculation_date
       OR NEW.action <> OLD.action
       OR NEW.window_from <> OLD.window_from
       OR NEW.window_to <> OLD.window_to
       OR NEW.from_level_id <> OLD.from_level_id
       OR NEW.target_level_id <> OLD.target_level_id
       OR NEW.delivery_channel <> OLD.delivery_channel
       OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at
       OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id THEN
      RAISE EXCEPTION 'cannot weaken or rewrite a delivered notice referenced by the level ledger';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_loyalty_downgrade_notice_delivery
  ON public.mkt_loyalty_downgrade_notice;
CREATE TRIGGER trg_guard_loyalty_downgrade_notice_delivery
BEFORE UPDATE OR DELETE ON public.mkt_loyalty_downgrade_notice
FOR EACH ROW EXECUTE FUNCTION public.guard_loyalty_downgrade_notice_delivery();

REVOKE ALL ON TABLE public.mkt_loyalty_downgrade_notice FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.mkt_loyalty_downgrade_notice_notice_id_seq
  FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_loyalty_downgrade_notice_delivery()
  FROM PUBLIC, anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES (113, 'loyalty_downgrade_notice_gate')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- 回滚只允许 112 ledger 与本表均为空时执行；一旦有正式送达/降级事实就禁止删除审计链。
-- BEGIN;
--   ALTER TABLE public.mkt_loyalty_level_change_ledger
--     DROP CONSTRAINT fk_mkt_loyalty_level_change_notice,
--     DROP COLUMN notice_id;
--   DROP TRIGGER trg_guard_loyalty_downgrade_notice_delivery
--     ON public.mkt_loyalty_downgrade_notice;
--   DROP FUNCTION public.guard_loyalty_downgrade_notice_delivery();
--   DROP TABLE public.mkt_loyalty_downgrade_notice;
--   DELETE FROM public.schema_migrations WHERE version = 113;
-- COMMIT;
