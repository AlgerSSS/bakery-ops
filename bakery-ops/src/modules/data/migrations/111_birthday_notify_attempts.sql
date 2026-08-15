-- 111: 生日礼预约通知的发送尝试计数（供 tokyo-01 通知 relay 使用）
--
-- 【背景】门店通知从 Vercel 函数迁到 tokyo-01 服务器（scripts/birthday-notify.mjs，
-- 每 15 分钟轮询）：预约落库时 notify_status=pending，relay 发到 Lark 群后置 sent。
-- 发送失败需要重试上限，避免坏行永久占用轮询：
--   notify_attempts < 3 时继续重试；达到 3 置 failed，停止打扰。
-- 表当前为空（0 行），加列零成本。

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.mkt_birthday_reservation
  ADD COLUMN IF NOT EXISTS notify_attempts smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.mkt_birthday_reservation.notify_attempts IS
  '发送尝试次数：tokyo-01 生日通知 relay 维护。pending 且 <3 才会重试，达到 3 置 failed。';

INSERT INTO public.schema_migrations (version, name)
VALUES (111, 'birthday_notify_attempts')
ON CONFLICT (version) DO NOTHING;

COMMIT;