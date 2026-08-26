-- 115: 生日礼年度二选一、积分扣退与店员履约闭环
--
-- 最新五等级规则：L1 仅贺卡；L2+ 每年一份生日礼；L3+ 可在免费巴斯克与
-- 450 积分定制蛋糕中二选一；L4/L5 的积分蛋糕可带姓名插牌/现场祝贺。
-- points_status 把 RES 外部扣分的不确定窗口显式记录，禁止失败后盲目重试。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.mkt_birthday_reservation
  DROP CONSTRAINT IF EXISTS mkt_birthday_reservation_status_check;

ALTER TABLE public.mkt_birthday_reservation
  ADD CONSTRAINT mkt_birthday_reservation_status_check
  CHECK (status IN ('processing','reserved','fulfilled','cancelled','ambiguous'));

ALTER TABLE public.mkt_birthday_reservation
  ADD COLUMN IF NOT EXISTS points_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS points_adjustment_ref text,
  ADD COLUMN IF NOT EXISTS points_before integer,
  ADD COLUMN IF NOT EXISTS points_after integer,
  ADD COLUMN IF NOT EXISTS points_refund_ref text,
  ADD COLUMN IF NOT EXISTS refund_points_before integer,
  ADD COLUMN IF NOT EXISTS refund_points_after integer,
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfilled_by text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS staff_note text;

-- 115 之前的积分蛋糕只登记预约、没有在线扣分凭据。不能把历史行伪装成 deducted；
-- 明确标为 ambiguous，交由门店核对 RES/POS 后再决定 fulfilled 或 cancelled。
UPDATE public.mkt_birthday_reservation
   SET points_status = 'ambiguous', updated_at = now()
 WHERE gift_type = 'points_450'
   AND points_status = 'not_applicable';

ALTER TABLE public.mkt_birthday_reservation
  ADD CONSTRAINT ck_mkt_birthday_points_status
  CHECK (points_status IN (
    'not_applicable','claiming','deducted','refund_claimed','refunded','failed','ambiguous'
  )),
  ADD CONSTRAINT ck_mkt_birthday_points_kind
  CHECK (
    (gift_type = 'free_basque' AND points_status = 'not_applicable')
    OR (gift_type = 'points_450' AND points_status <> 'not_applicable')
  ),
  ADD CONSTRAINT ck_mkt_birthday_fulfilled
  CHECK (
    (status = 'fulfilled' AND fulfilled_at IS NOT NULL AND fulfilled_by IS NOT NULL)
    OR (status <> 'fulfilled' AND fulfilled_at IS NULL AND fulfilled_by IS NULL)
  ),
  ADD CONSTRAINT ck_mkt_birthday_cancelled
  CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
    OR (status <> 'cancelled' AND cancelled_at IS NULL)
  ),
  ADD CONSTRAINT ck_mkt_birthday_points_readback
  CHECK (
    points_before IS NULL OR points_after IS NULL
    OR points_before - points_after = 450
  ),
  ADD CONSTRAINT ck_mkt_birthday_points_refund_readback
  CHECK (
    refund_points_before IS NULL OR refund_points_after IS NULL
    OR refund_points_after - refund_points_before = 450
  );

DROP INDEX IF EXISTS public.uk_mkt_birthday_free_basque;

CREATE UNIQUE INDEX IF NOT EXISTS uk_mkt_birthday_annual_gift
  ON public.mkt_birthday_reservation (member_id, campaign_year)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS ix_mkt_birthday_fulfillment_queue
  ON public.mkt_birthday_reservation (pickup_date, slot, status);

ALTER TABLE public.mkt_birthday_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mkt_birthday_reservation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mkt_birthday_profile FROM anon, authenticated;
REVOKE ALL ON TABLE public.mkt_birthday_reservation FROM anon, authenticated;

COMMENT ON COLUMN public.mkt_birthday_reservation.points_status IS
  '积分蛋糕 RES 扣退状态；ambiguous 表示无法证明最终积分余额，必须回读/人工核对后再推进。';
COMMENT ON COLUMN public.mkt_birthday_reservation.points_adjustment_ref IS
  'RES 积分调整备注中的非 PII 幂等参考；不把该字段误当作 RES 原生幂等键。';
COMMENT ON COLUMN public.mkt_birthday_reservation.points_refund_ref IS
  '取消积分蛋糕时的 RES 加回积分参考；只有回读余额增加 450 后才可置 refunded。';
COMMENT ON COLUMN public.mkt_birthday_reservation.fulfilled_by IS
  '店员履约身份标识，不存口令；由店员 H5 的认证会话写入。';

INSERT INTO public.schema_migrations (version, name)
VALUES (115, 'birthday_fulfillment')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- 回滚：若已产生 points_status/fulfilled/cancelled 正式事实，不允许降回 110 的弱模型。
