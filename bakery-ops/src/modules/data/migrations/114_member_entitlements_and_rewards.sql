-- 114: See You Often 统一权益、发奖账本与好友同行储值组
--
-- 粒度纪律：
--   mkt_member_entitlement  一行 = 一会员 × 一权益 × 一业务周期；
--   mkt_reward_grant        一行 = 一次必须幂等的外部 RES 发奖动作；
--   mkt_friend_topup_group  一行 = 店员明确确认的一组同行储值；
--   mkt_friend_topup_participant 一行 = 一组中的一会员与一笔真实储值交易。
--
-- 不从“时间接近”自动推断好友。participant 必须引用 pos_member_card_txn 的 txn_id 文本，
-- 由应用在登记时校验 txn_type=10、RM100+、同店、同一短窗口且未被其他组使用。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mkt_member_entitlement (
  entitlement_id  bigint      GENERATED ALWAYS AS IDENTITY,
  member_id       text        NOT NULL,
  benefit_code    text        NOT NULL,
  period_key      text        NOT NULL,
  source_level    text        NOT NULL CHECK (source_level IN ('L1','L2','L3','L4','L5')),
  eligible_from   timestamptz NOT NULL,
  eligible_until  timestamptz,
  status          text        NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','reserved','consumed','expired','cancelled')),
  source_ref      text,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  consumed_at     timestamptz,
  CONSTRAINT mkt_member_entitlement_pkey PRIMARY KEY (entitlement_id),
  CONSTRAINT uk_mkt_member_entitlement_period
    UNIQUE (member_id, benefit_code, period_key),
  CONSTRAINT ck_mkt_member_entitlement_window
    CHECK (eligible_until IS NULL OR eligible_until >= eligible_from),
  CONSTRAINT ck_mkt_member_entitlement_consumed
    CHECK (
      (status = 'consumed' AND consumed_at IS NOT NULL)
      OR (status <> 'consumed' AND consumed_at IS NULL)
    )
);

COMMENT ON TABLE public.mkt_member_entitlement IS
  'See You Often 会员权益资格账本；一行是一会员×一权益×一业务周期，由营销权益同步任务写。'
  '它是生日礼、新品体验、季度品鉴、快速通道等资格与核销的权威记录，不以 RES rightsList 代替。';

CREATE INDEX IF NOT EXISTS ix_mkt_member_entitlement_member_status
  ON public.mkt_member_entitlement (member_id, status, eligible_until);
CREATE INDEX IF NOT EXISTS ix_mkt_member_entitlement_active_benefit
  ON public.mkt_member_entitlement (benefit_code, eligible_until)
  WHERE status IN ('active','reserved');

CREATE TABLE IF NOT EXISTS public.mkt_reward_grant (
  grant_id          bigint      GENERATED ALWAYS AS IDENTITY,
  idempotency_key   text        NOT NULL,
  member_id         text        NOT NULL,
  benefit_code      text        NOT NULL,
  period_key        text        NOT NULL,
  source_type       text        NOT NULL
                    CHECK (source_type IN ('hbti','friend_topup','birthday','level','manual')),
  source_id         text,
  entitlement_id    bigint,
  res_template_id   text,
  res_template_name text,
  status            text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','claimed','issued','ambiguous','failed','cancelled')),
  claim_token       uuid,
  attempt_count     integer     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  res_coupon_id     text,
  last_error        text,
  context           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  claimed_at        timestamptz,
  issued_at         timestamptz,
  CONSTRAINT mkt_reward_grant_pkey PRIMARY KEY (grant_id),
  CONSTRAINT uk_mkt_reward_grant_idempotency UNIQUE (idempotency_key),
  CONSTRAINT uk_mkt_reward_grant_member_period
    UNIQUE (member_id, benefit_code, period_key),
  CONSTRAINT fk_mkt_reward_grant_entitlement
    FOREIGN KEY (entitlement_id)
    REFERENCES public.mkt_member_entitlement (entitlement_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT ck_mkt_reward_grant_claim
    CHECK (
      (status = 'claimed' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL)
      OR status <> 'claimed'
    ),
  CONSTRAINT ck_mkt_reward_grant_issued
    CHECK (
      (status = 'issued' AND issued_at IS NOT NULL)
      OR (status <> 'issued' AND issued_at IS NULL)
    )
);

COMMENT ON TABLE public.mkt_reward_grant IS
  '统一 RES 发券幂等账本；一行是一次外部发奖动作，worker 先短事务 claim、事务外调用 RES、回读后再 CAS 落终态。';

CREATE INDEX IF NOT EXISTS ix_mkt_reward_grant_entitlement
  ON public.mkt_reward_grant (entitlement_id)
  WHERE entitlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mkt_reward_grant_pending
  ON public.mkt_reward_grant (created_at, grant_id)
  WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS ix_mkt_reward_grant_member_status
  ON public.mkt_reward_grant (member_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mkt_friend_topup_group (
  group_id       uuid        NOT NULL DEFAULT gen_random_uuid(),
  store          text        NOT NULL,
  status         text        NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','completed','cancelled')),
  created_by     text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  cancelled_at   timestamptz,
  CONSTRAINT mkt_friend_topup_group_pkey PRIMARY KEY (group_id),
  CONSTRAINT ck_mkt_friend_topup_group_terminal
    CHECK (
      (status = 'completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
      OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND completed_at IS NULL)
      OR (status = 'open' AND completed_at IS NULL AND cancelled_at IS NULL)
    )
);

COMMENT ON TABLE public.mkt_friend_topup_group IS
  '好友同行储值的店员确认组；一行是一批真实同行顾客，不使用相邻交易时间自动猜测关系。写者为会员活动店员 H5。';

CREATE INDEX IF NOT EXISTS ix_mkt_friend_topup_group_open
  ON public.mkt_friend_topup_group (store, created_at)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.mkt_friend_topup_participant (
  participant_id bigint      GENERATED ALWAYS AS IDENTITY,
  group_id       uuid        NOT NULL,
  member_id      text        NOT NULL,
  topup_txn_id   text        NOT NULL,
  topup_amount   numeric(14,2) NOT NULL CHECK (topup_amount >= 100),
  reward_grant_id bigint,
  status         text        NOT NULL DEFAULT 'joined'
                 CHECK (status IN ('joined','reward_pending','rewarded','failed','cancelled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mkt_friend_topup_participant_pkey PRIMARY KEY (participant_id),
  CONSTRAINT fk_mkt_friend_topup_participant_group
    FOREIGN KEY (group_id)
    REFERENCES public.mkt_friend_topup_group (group_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_mkt_friend_topup_participant_grant
    FOREIGN KEY (reward_grant_id)
    REFERENCES public.mkt_reward_grant (grant_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT uk_mkt_friend_topup_member UNIQUE (group_id, member_id),
  CONSTRAINT uk_mkt_friend_topup_txn UNIQUE (topup_txn_id),
  CONSTRAINT uk_mkt_friend_topup_grant UNIQUE (reward_grant_id)
);

COMMENT ON TABLE public.mkt_friend_topup_participant IS
  '同行储值组参与者；一行绑定一个会员与一笔已校验的 RES 储值交易，唯一 txn_id 防止同一储值重复领 RM10。';

CREATE INDEX IF NOT EXISTS ix_mkt_friend_topup_participant_group
  ON public.mkt_friend_topup_participant (group_id, status);
CREATE INDEX IF NOT EXISTS ix_mkt_friend_topup_participant_member
  ON public.mkt_friend_topup_participant (member_id, created_at DESC);

ALTER TABLE public.mkt_member_entitlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mkt_reward_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mkt_friend_topup_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mkt_friend_topup_participant ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mkt_member_entitlement FROM anon, authenticated;
REVOKE ALL ON TABLE public.mkt_reward_grant FROM anon, authenticated;
REVOKE ALL ON TABLE public.mkt_friend_topup_group FROM anon, authenticated;
REVOKE ALL ON TABLE public.mkt_friend_topup_participant FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.mkt_member_entitlement_entitlement_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.mkt_reward_grant_grant_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.mkt_friend_topup_participant_participant_id_seq FROM anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES (114, 'member_entitlements_and_rewards')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- 回滚仅允许四张表均为空时执行；存在正式权益/发奖事实后禁止删除审计链。

