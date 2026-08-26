-- 116: HBTI 会员邮箱资料
--
-- 邮箱由顾客在通过手机号验证后主动填写。它不属于 RES/POS 同步事实，不能放进
-- pos_member，否则下一次爬虫同步可能把活动侧资料覆盖掉。营销邮件授权与邮箱收集
-- 是两件事：本表默认没有营销授权，未来只有经过独立同意流程才能更新 opt-in 字段。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.mkt_member_contact (
  store                         text        NOT NULL,
  member_id                     text        NOT NULL,
  email                         text        NOT NULL,
  source                        text        NOT NULL DEFAULT 'hbti',
  email_marketing_opt_in        boolean     NOT NULL DEFAULT false,
  email_marketing_opt_in_at     timestamptz,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mkt_member_contact_pkey PRIMARY KEY (store, member_id),
  CONSTRAINT ck_mkt_member_contact_email
    CHECK (
      email = btrim(email)
      AND length(email) BETWEEN 3 AND 254
      AND email LIKE '%@%'
      AND email !~ '[[:space:]]'
    ),
  CONSTRAINT ck_mkt_member_contact_marketing_opt_in
    CHECK (
      (email_marketing_opt_in AND email_marketing_opt_in_at IS NOT NULL)
      OR (NOT email_marketing_opt_in AND email_marketing_opt_in_at IS NULL)
    )
);

COMMENT ON TABLE public.mkt_member_contact IS
  'HBTI/会员活动收集的会员联系资料；一行是一门店会员，写者为 hbti-web。'
  '与 pos_member 的区别：pos_member 是 RES 爬虫同步事实，本表是顾客主动填写且由营销应用维护。';
COMMENT ON COLUMN public.mkt_member_contact.email IS
  '顾客主动提供的邮箱；不是会员身份主键，不设唯一约束，家庭成员可以共用邮箱。';
COMMENT ON COLUMN public.mkt_member_contact.email_marketing_opt_in IS
  '是否已通过独立流程同意营销邮件；仅收集邮箱不构成同意，默认 false；更换邮箱时应用必须重置。';

ALTER TABLE public.mkt_member_contact ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mkt_member_contact FROM anon, authenticated;

INSERT INTO public.schema_migrations (version, name)
VALUES (116, 'hbti_member_contact')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- 回滚只允许在表内没有正式会员资料时执行：
-- BEGIN;
--   DROP TABLE IF EXISTS public.mkt_member_contact;
--   DELETE FROM public.schema_migrations WHERE version = 116;
-- COMMIT;
