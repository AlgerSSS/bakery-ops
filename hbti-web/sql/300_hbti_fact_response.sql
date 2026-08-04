-- 300: HBTI 题目级作答事实表
--
-- 号段：hbti-web 300-399（本次新领。财务站 001-099 / bakery-ops 100-199 / res_api 200-299）
-- ⚠️ 财务站 001-099 里的 077/078 已被本仓库历史上越界烧掉，财务站下一个号从 080 起。
--
-- 【为什么必须建】13 题答案的完整生命周期：
--   route.ts:25 收 answers → 传入 completeHbti
--   → complete-hbti.ts:155 scoreHbti(answers)   ← answers 最后一次出现
--   → :156-163 只留 code/visitTime/category/color/gender/age 六项
--   → completionSnapshotSchema 是 z.strictObject，多一个字段直接 parse 失败
-- 12 道计分题三票多数决只产生 4 个维度，从 code 反推不出题目级答案。
-- 唯一存过 answers 的地方是浏览器 localStorage 草稿，发券成功即删。
-- 活动每跑一天，永久丢一天。

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.fact_hbti_response (
  store            text        NOT NULL,
  member_id        text        NOT NULL,
  campaign_version text        NOT NULL,
  answered_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempt_id       text        NOT NULL,
  answers          jsonb       NOT NULL,
  hbti_code        text        NOT NULL,
  visit_time       text,
  category         text,
  color            text,
  gender           text,
  age              text,

  -- 主键用 attempt_id 不用 answered_at：
  -- ① now() 在一个事务里是常量（事务开始时间），同事务两次写入会撞主键；
  -- ② 语义上一行 = 一次作答尝试，attempt_id 就是那次尝试的身份，比时间戳稳。
  CONSTRAINT pk_fact_hbti_response
    PRIMARY KEY (store, member_id, campaign_version, attempt_id),
  -- 13 题必须齐全。缺题的记录进来等于把「精度更低的结果」伪装成完整作答。
  CONSTRAINT ck_fact_hbti_answers_complete CHECK (
    jsonb_typeof(answers) = 'object'
    AND answers ?& array['q1','q2','q3','q4','q5','q6','q7','q8','q9','q10','q11','q12','q13']
  )
);

ALTER TABLE public.fact_hbti_response ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS fact_hbti_response_campaign_idx
  ON public.fact_hbti_response (campaign_version, answered_at DESC);
CREATE INDEX IF NOT EXISTS fact_hbti_response_code_idx
  ON public.fact_hbti_response (hbti_code);

COMMENT ON TABLE public.fact_hbti_response IS
  '所有权=hbti-web。HBTI 13 题的题目级原始作答，抢锁成功那一刻写一次。'
  '写入点 src/lib/store/pg-completion-store.ts recordAnswers()，与 pos_member.hbti_completed_at 同时刻。'
  '★永久事实，不带 TTL —— 绝不可加进 purgeExpired 的 EXPIRING 列表（它也没有 expires_at 列，加了会 42703）。';
COMMENT ON COLUMN public.fact_hbti_response.answers IS
  '13 题原始作答。q1-q12 计分、q13 打包偏好。CHECK 保证 13 键齐全。';
COMMENT ON COLUMN public.fact_hbti_response.attempt_id IS
  '与 pos_member.hbti_attempt_id 同源，用于把答案与那一次发券尝试对上。也是主键的一部分。';
COMMENT ON COLUMN public.fact_hbti_response.answered_at IS
  '用 clock_timestamp() 不用 now()：后者在一个事务里是常量，批量/重试路径会撞。';

INSERT INTO schema_migrations (version, name)
VALUES (300, 'hbti_fact_response') ON CONFLICT DO NOTHING;

COMMIT;

-- 回滚：DROP TABLE public.fact_hbti_response; DELETE FROM schema_migrations WHERE version=300;
