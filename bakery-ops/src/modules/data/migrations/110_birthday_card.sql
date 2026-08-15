-- 110: 生日贺卡动态化 —— 会员生日资料收集 + 生日礼预约
--
-- 【业务背景】生日贺卡 H5 从静态烘焙页改为按会员动态生成（2026-08-15 起）。
-- 会员通过专属签名链接（或短信验证码兜底）进入，查看自己的年度消费回顾，
-- 留下「想记住的日期」与过敏原等信息，并预约生日礼（取货日期 + 午/晚时段）。
--
-- 【权益规则（2026-08-15 用户口述）】
--   L1/L2：免费巴斯克蛋糕，每会员每年一份；
--   L3：450 积分兑换生日蛋糕，限自己，不限量；
--   L4：450 积分兑换，可给亲友，不限量。
--   当前全库会员等级只有 VIP1（4829 人），应用侧用可配置映射把 VIP1 桥接到 L1 权益。
--   积分不在 H5 扣减：取货时由门店在 POS 结算，本表只登记预约与资格快照。
--
-- 【为什么放 mkt_ 域】写者是本仓库 hbti-web 应用（生日活动 = 营销域），
-- 与 pos_（爬虫写入的 POS 事实）划清：这两张表是顾客主动填写的运营数据。
--
-- 【为什么不挂在 pos_member 上加列】收集的信息（过敏原、想记住的日期）是
-- 活动过程数据，不是 RES 会员档案事实；pos_member 的唯一写者是爬虫同步。
-- 若后续 RES 档案要吸收这些字段，由数据重构统一编排（同 pos_member_order_item 的安排）。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 会员生日资料（收集型，一会员一行）──────────────────────────────
CREATE TABLE IF NOT EXISTS public.mkt_birthday_profile (
  member_id       text        NOT NULL,
  birthday_month  smallint    CHECK (birthday_month BETWEEN 1 AND 12),
  birthday_day    smallint    CHECK (birthday_day BETWEEN 1 AND 31),
  allergies       text,                          -- 过敏原，顾客自由填写
  preferences     text,                          -- 口味偏好 / 其他想让我们记住的
  source          text        NOT NULL DEFAULT 'h5',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mkt_birthday_profile_pkey PRIMARY KEY (member_id)
);

COMMENT ON TABLE public.mkt_birthday_profile IS
  '会员在生日贺卡 H5 里主动留下的资料：想记住的日期（月/日，不收年份）、过敏原、口味偏好。'
  '写者 = hbti-web 生日贺卡应用（营销域收集型数据）。与 pos_member 的区别：那是爬虫同步的 RES 档案事实，'
  '本表是顾客自填的运营信息，未来可反哺会员档案但不自动回写。';

-- ── 2. 生日礼预约 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mkt_birthday_reservation (
  reservation_id  bigint      GENERATED ALWAYS AS IDENTITY,
  member_id       text        NOT NULL,
  campaign_year   smallint    NOT NULL,          -- 活动年度，年度权益按它计
  gift_type       text        NOT NULL CHECK (gift_type IN ('free_basque', 'points_450')),
  for_whom        text        NOT NULL DEFAULT 'self' CHECK (for_whom IN ('self', 'gift')),
  recipient_note  text,                          -- for_whom='gift' 时填：送给谁
  pickup_date     date        NOT NULL,
  slot            text        NOT NULL CHECK (slot IN ('noon', 'night')),
  member_note     text,                          -- 会员给店里的留言
  level_snapshot  text,                          -- 预约时的会员等级快照（VIP1/L1…）
  points_snapshot integer,                       -- 预约时看到的积分余额快照
  status          text        NOT NULL DEFAULT 'reserved'
                  CHECK (status IN ('reserved', 'fulfilled', 'cancelled')),
  notify_status   text        NOT NULL DEFAULT 'pending'
                  CHECK (notify_status IN ('pending', 'sent', 'skipped', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mkt_birthday_reservation_pkey PRIMARY KEY (reservation_id)
);

COMMENT ON TABLE public.mkt_birthday_reservation IS
  '生日礼预约登记：谁在哪个活动年度、以什么权益（免费巴斯克/450积分兑换）、'
  '预约哪天哪个时段取货。写者 = hbti-web 生日贺卡应用。'
  '积分不在本表扣减（取货时门店 POS 结算），points_snapshot/level_snapshot 只是预约当时的状态留证。'
  '免费巴斯克每会员每年限一份：由 uk_mkt_birthday_free_basque 部分唯一索引保证。';

-- 免费巴斯克每会员每年限一份（取消的不占名额）。
CREATE UNIQUE INDEX IF NOT EXISTS uk_mkt_birthday_free_basque
  ON public.mkt_birthday_reservation (member_id, campaign_year)
  WHERE gift_type = 'free_basque' AND status <> 'cancelled';

-- 门店按取货日看板的常用查询。
CREATE INDEX IF NOT EXISTS ix_mkt_birthday_reservation_pickup
  ON public.mkt_birthday_reservation (pickup_date, slot)
  WHERE status = 'reserved';

INSERT INTO public.schema_migrations (version, name)
VALUES (110, 'birthday_card')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ── 回滚（本库无 down 机制）───────────────────────────────────────────
-- BEGIN;
--   DROP TABLE IF EXISTS public.mkt_birthday_reservation;
--   DROP TABLE IF EXISTS public.mkt_birthday_profile;
--   DELETE FROM schema_migrations WHERE version = 110;
-- COMMIT;

-- ── 待办 ───────────────────────────────────────────────────────────────
-- 1. 预约目前不落门店列：全库只有一家店（吉隆坡Pavilion门店，见 HBTI_MEMBER_STORE
--    默认值与 fact_shift 的门店桥）。多店时补 store 列并接 ops_store。
-- 2. fulfilled/cancelled 的状态推进还没有后台界面，先用 SQL 手工维护；
--    门店看板（按 pickup_date 拉取）是下一个迭代。
