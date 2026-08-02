-- 078: pos_member.hbti_status 增加 'unrewarded'
--
-- 背景：周边总共 1,376 件，发完之后仍然会有人来答题。此前这种情况会抛错，顾客答完
-- 13 道题只看到一个通用错误页，连自己的面包人格都丢了。现在改成「照常出结果，只是
-- 没有周边券」——这需要一个新的终态。
--
-- 为什么必须改这条 CHECK：ck_pos_member_hbti_status 是一份白名单，写入 'unrewarded'
-- 会被数据库直接拒绝。这个约束在代码里看不出来（063 的迁移文件已不在仓库中），
-- 只能从活库读出来。
--
-- 同时要满足的另外两条既有约束（无需修改，这里说明为什么天然成立）：
--   ck_pos_member_hbti_attempt_shape —— 非 processing 状态必须 hbti_attempt_id IS NULL，
--     PgCompletionStore.write() 对所有终态都写 null，成立。
--   ck_pos_member_hbti_record_shape —— hbti_record->>'status' 必须等于 hbti_status，
--     两者来自同一个 record 对象，成立。

BEGIN;

ALTER TABLE pos_member DROP CONSTRAINT IF EXISTS ck_pos_member_hbti_status;

ALTER TABLE pos_member ADD CONSTRAINT ck_pos_member_hbti_status CHECK (
  hbti_status IS NULL
  OR hbti_status = ANY (ARRAY['processing', 'issued', 'review', 'unrewarded'])
);

COMMENT ON COLUMN pos_member.hbti_status IS
  'HBTI 完成状态：processing=进行中（此时 hbti_attempt_id 非空）；issued=已发券；review=待人工核对；unrewarded=答题完成但周边已发完，不发券。后三者都是终态，会挡住同一会员在本期活动内的第二次参与。';

INSERT INTO schema_migrations (version, name)
VALUES (78, '078_hbti_unrewarded_status')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- 回滚（如需）：先把已有的 unrewarded 行处理掉，否则加不回旧约束。
--   UPDATE pos_member SET hbti_status = NULL, hbti_record = NULL, hbti_expires_at = NULL
--    WHERE hbti_status = 'unrewarded';
--   ALTER TABLE pos_member DROP CONSTRAINT ck_pos_member_hbti_status;
--   ALTER TABLE pos_member ADD CONSTRAINT ck_pos_member_hbti_status CHECK (
--     hbti_status IS NULL OR hbti_status = ANY (ARRAY['processing','issued','review']));
--   DELETE FROM schema_migrations WHERE version = 78;
