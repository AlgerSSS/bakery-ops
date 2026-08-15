# P0c 来源保真与奖励履约证据（当前、取代旧最终验收）

> 本文件由声明式模型与协调方提供的只读源探针结果生成；它不是独立复审报告，也不是数据库迁移或应用切换证明。
> `evidence/final-acceptance-2026-08-10.md` 仅保留为历史记录，已标记 SUPERSEDED。

## 只读源探针

- 事务：`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`；project ref=`ecsgqcmwtjmcpzqytdqw`；database=`postgres`；PostgreSQL=`170006`。
- 快照时刻：`2026-08-10 11:41:20.585094+00`（`2026-08-10 19:41:20.585094+08`）；`txid_current_if_assigned=None`。
- 查询：`SELECT source_ref, count(*)::bigint::text AS row_count FROM public.cost_card_item GROUP BY source_ref ORDER BY source_ref NULLS FIRST`。
- 原始分组：466；规范化：`JSON.stringify array in field order {source_ref,row_count}`；SHA-256=`cf1b064dbc21eb3b7552684a19f4afa68362d5f2b01e16335d0938e479585721`。
- 分类核对：total=471、mysql=451、manual=14、NULL=6、other=0。旧口述 `465/5/6` 明确错误并作废。

## 成本项目与配方门禁

- 471=99 product+372 material；99=32独立身份链合并+67来源键新产品；372=190 ingredient+171 semi_finished+11 packaging。
- 单位实值：g372→G、ea94→EACH、个5→EACH；未知类型/单位 BLOCK；名称仅显示/alias证据，不作身份合并。
- 配方输出：104 versions/99 product families + 185 versions/171 semi-finished families = 289 versions/270 families。

## HBTI 历史锚点

- 1条full fact；6条result-only，attempt_no=NULL、SUBMITTED、SOURCE_ANSWERS_UNAVAILABLE、非来源观察。
- 迁移锚点：`migration-only:` + UUIDv5 root `7ab6debe-4d90-50e2-ab29-9873d96e848d` 的 typed-JCS 输入；公式/hash/非来源标志写迁移清单。
- pos_member 的 visit_time/category 只进 result_dimensions；只有 fact.answers 中真实 Q5/Q6 才建 answer。

## 奖励履约与库存

- 精确模板白名单10项（9 PHYSICAL_GIFT + 1 COUPON），fixture SHA-256=`a63668421add727e53ce259e63cc25c283e7de922e5e3db02fe210654f23b19e`；未知模板 BLOCK，禁止名称模式推断。
- 9库存 allocated=1376、reserved=0、redeemed=2、damaged=0；4个外部履约ID唯一且confirmedAt存在。
- Heart 1条stock-backed claim；Pistachio 3条stockless外部履约；Butterfly库存issued=1但0 claim，库存核对必须输出DRIFT，禁止造claim。
- REDEEMED只证明奖励发放/新券实例创建，不证明POS消费；库存核对只聚合reward_stock_id非空claim。

## 当前模型与验收边界

- 137 tables / 59 view specs；physical fields=1812、view fields=643、total=2455。
- FK=420；CHECK=433（table=115 + field=318）；UNIQUE=134。
- Phase1 supporting FK indexes=224；readiness=10/9/22/13/5；已创建并验证SQL view=0。
- 生成器会先执行 model/storage fail-closed validation；完整 unittest、package validator、连续两次生成和54文件聚合hash由最终验收命令另行核对。聚合hash不写入其自身覆盖的本文件，以避免不可能的自引用hash。
