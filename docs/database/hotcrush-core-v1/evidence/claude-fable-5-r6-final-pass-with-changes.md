# Claude Fable 5 R6 最终放行复核（修订前）

最终结论：PASS_WITH_CHANGES

本轮为只读复核。Claude 独立重算并确认以下内部计数：137 张潜在物理表；首期 100（81 业务 + 19 平台）；扩展 33；来源条件 4；59 个视图；1,792 个物理字段；637 个视图字段；2,429 个字段说明；418 个 FK 字段；939 个现库字段去向；61 页 Draw.io/PDF。137 张物理表的最小性处置本轮没有提出新增、合并或删除。

上一轮 B1–B4、N1–N5 及其后 8 组修复均判定 CLOSED，但仍有 3 个交付前必修项，因此禁止按 PASS 交付：

1. `pos_sales_day.discount_amount`、`pos_sales_day.refund_amount`、`pos_item_sales_hour.discount_amount`、`finance_sales_daily.discount_amount` 仍为 `NOT NULL DEFAULT 0`，与“来源缺失必须保持 NULL”冲突。必须改成可空、无 0 默认，并采用空值安全约束。
2. `ops_business_rule.rule_value`、`msg_outbound_message.payload`、`msg_conversation_state.collected_data`、`ops_daily_review.review_summary` 等字段声称经过固定 schema 校验，但 `target-table-implementation-guardrails.csv` 没有 `SCHEMA_VALIDATION` 落地门禁。必须明确校验键、执行层、拒绝未知字段以及绕过写入的阻断方式。
3. 当前高风险对象 `daily_revenue` 的 10 个字段中只有 `gross_sales` 使用字段级明确映射，其余仍由对象级 `OBJECT_TARGETS` 兜底。必须逐字段说明是保留到哪个存在的目标字段、由哪些最小事实派生，或为什么明确不迁移；不得按字段名猜口径。

Claude 的交付边界：完成以上修订、重新生成、通过幂等与 fail-closed 校验，并再次只读复核得到明确 `PASS` 后，才可作为“等待老板批准的设计评审包”交付。即使最终 PASS，也不能声称生产迁移、RLS、触发器、索引、回填、双轨、切换或回滚已经运行验证。

> 归档说明：这是 Claude Fable 5 原始结论的忠实格式化记录；为便于复核压缩了重复的逐表清单，但没有改变 verdict、计数、必修项或事实边界。
