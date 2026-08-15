# HOT CRUSH Core V1 R6 最终独立放行复核 V2

你是独立数据库架构审计者。请对 `/Users/weiliangshao/hot/docs/database/hotcrush-core-v1` 做一次完整、只读、证据优先的终审。不得修改任何文件，不得执行 DDL/DML、迁移、部署或提交，也不得因为本地生成器/验证器显示通过就默认设计正确。

第一行只能是 `最终结论：PASS`、`最终结论：PASS_WITH_CHANGES` 或 `最终结论：FAIL`。只有不存在任何交付前必修项时才能给 `PASS`；`PASS_WITH_CHANGES` 也禁止交付。

## 真实目标

HOT CRUSH 只服务一个企业，但支持多门店、厨房、仓库和未来模块。方案必须：

1. 物理保存不能从其他稳定事实确定性重建的最小事实、稳定身份、来源映射、人工决定、版本、来源观察、外部副作用和必要运行状态；
2. 当前值、汇总、余额、比例、差值、排名、画像、成本、毛利和质量摘要优先派生；
3. 通过稳定 UUID、来源命名空间、营业日、批次、版本和有效期连接；名称只能做来源证据，不能做关系键；
4. 不得为了少表混合粒度，也不得为了“未来扩展”预建没有来源、写入者或独有不可重建事实的物理表；
5. 来源缺失必须保持 `NULL`，不能静默猜值、补零，不能用抓取时间冒充业务时间；真实零值与来源缺失必须可区分。

## 上一轮结论与本轮必须重点反证的三项修复

上一轮结论见 `evidence/claude-fable-5-r6-final-pass-with-changes.md`。不要相信下面的修复声明，必须从当前模型、生成物和验证逻辑独立核对：

### A. 来源缺失与真实零值

- `pos_sales_day.gross_sales/discount_amount/refund_amount/order_count/source_average_order_value/source_guest_count` 已改为来源可缺失字段，允许 `NULL`、无 `DEFAULT 0`，约束为空值安全；`source_guest_count` 明确不是实际进店客流。
- `pos_item_sales_hour.discount_amount` 已改为可空、无 `DEFAULT 0`。
- `finance_sales_daily.gross_sales/discount_amount/net_sales/order_count` 已改为可空、无 `DEFAULT 0`。
- 平均客单价和折扣率仍从同一来源、同一粒度事实派生；只有来源独立报告的平均值才进入 `source_average_order_value`。
- 请扫描全部物理金额、数量、次数、余额字段，确认没有其他“来源缺失却默认 0”或抓取时间补业务时间的问题。

### B. 受 Schema 约束的 JSON 必须有实施门禁

- `model/schema_validation.py` 声称为 8 张含固定 JSON 契约的表定义明确 guard：`ops_daily_review`、`ops_business_rule`、`hr_employee_event`、`msg_conversation_state`、`msg_outbound_message`、`ai_prompt_segment`、`ai_prompt_template`、`ai_call`。
- 每项必须核对：版本/判别字段是否真实存在；在哪一层校验；是否拒绝未知字段；是否阻断绕过应用直写；对应 `SCHEMA_VALIDATION` 是否进入 `target-table-implementation-guardrails.csv` 和文档；字段说明是否没有夸大为数据库已经部署校验。
- 重点核对新增的 `ops_daily_review.review_summary_schema_version`、`hr_employee_event.event_schema_version`、`msg_outbound_message.template_version` 及其成对约束。

### C. `daily_revenue` 十字段必须逐字段明确

- 当前快照中的 `daily_revenue` 10 个字段必须全部是字段级明确映射，不能再由 `OBJECT_TARGETS` 兜底：`date`、`revenue`、`transaction_count`、`avg_transaction_value`、`gross_sales`、`total_discount`、`discount_rate`、`member_sales_ratio`、`store`、`import_source`。
- 每个字段必须明确迁到哪个真实存在的目标字段、从哪些最小事实派生，或为什么明确不迁移；未知写入者必须进入 review，不得按字段值或字段名猜分到 POS/财务口径。
- 检查 `avg_transaction_value` 没有被当作 canonical 事实重复保存；`member_sales_ratio` 必须明确是卡支付覆盖率还是会员销售占比，不能混淆。

## 当前待独立重算的声明

这些只是声明，不是事实，请独立重算：

- 潜在物理表 137：首期 100（81 业务 + 19 平台）、扩展 33、来源条件 4；137 不是立即建表数。
- 派生视图 59：首期 41、扩展 13、来源条件 5。
- 物理字段 1,797，视图字段 642，共 2,439 个字段说明。
- 137 张表 + 59 个视图 = 196 个对象说明；空说明应为 0。
- FK 字段 418；当前数据库快照 939 个字段必须一一有去向。
- 原 154 个候选对象处置：100 首期物理 + 33 扩展物理 + 4 来源条件物理 + 11 合并 + 4 派生 + 2 删除 = 154。154 不是目标表数。
- Draw.io 与 PDF 61 页，另有 4 张高清 PNG。
- 生成器连续两次生成后的整包聚合哈希声明相同：`d369d1b8efee6cbdc323be85acd7eed0457a9fd44d5c1a16554f318b8e059d99`。请核对生成时间等非确定字段不会造成漂移，并检查验证器对此是否 fail-closed。

## 必读当前证据

- `README.md`
- `00-review-baseline.md`
- `01-current-database-audit.md`
- `02-target-database-blueprint.md`
- `03-table-and-field-dictionary.md`
- `04-current-to-target-matrix.md`
- `05-project-compatibility-matrix.md`
- `06-first-principles-decision-review.md`
- `08-r6-minimal-physical-foundation.md`
- `09-implementation-guardrails-and-security.md`
- `target-model.json`
- `target-table-catalog.csv`
- `target-field-dictionary.csv`
- `target-comments-contract.sql`
- `target-storage-necessity-audit.csv`
- `target-table-implementation-guardrails.csv`
- `target-view-catalog.csv`
- `current-to-target-matrix.csv`
- `current-field-to-target-matrix.csv`
- `current-guardrail-to-target-matrix.csv`
- `r5-to-r6-disposition.csv`
- `project-compatibility-matrix.csv`
- `evidence/current-schema-snapshot.json`
- `evidence/code-access-snapshot.json`
- `evidence/pos-member-order-item-audit.json`
- `evidence/claude-fable-5-r6-final-pass-with-changes.md`
- `model/` 与 `tools/` 中的声明模型、生成逻辑、Schema guard 和 fail-closed 校验逻辑
- `diagrams/` 当前 R6 文件及 `archive/r5-diagrams/`

## 必须完成的审计

1. 对上一轮三项交付前必修项分别给 `CLOSED / OPEN / PARTIAL`；任何 `OPEN/PARTIAL` 不得 PASS。
2. 对 137 张潜在物理表逐表给 `KEEP / MERGE_INTO / DERIVE_VIEW / REMOVE / EXTENSION_ONLY / DEFER_SOURCE`，不可遗漏或重复；重点挑战 100 张首期表、19 张平台表和 generic state/config 表是否必要。若建议合并，必须证明不会混合粒度或丢失独有不可重建事实。
3. 扫描全部 1,797 个物理字段，不得只抽样；列出所有仍可确定性派生、重复缓存、默认值篡改、来源事实丢失、名称键、自由多态、任意 JSON、粒度错位、时间/单位/币种/版本不清的真实命中。
4. 验证快照 939 字段与迁移矩阵集合严格一一相等；高风险字段必须逐字段指向真实目标、明确 DERIVE，或有事实依据的 NO_TARGET。重点核对 `daily_revenue`、会员三表、POS 销售、财务销售、工时、成本和 HBTI；不接受 `OBJECT_TARGETS` 掩盖字段设计。
5. 检查每张表的一行粒度、PK、唯一约束、NULL 唯一语义、幂等键、来源更正、版本发布、有效期、current selector 和下游 lineage；重跑同一批或同一天不得重复或覆盖历史。
6. 机器核对每个表/视图及每个字段都有说明；人工检查说明是否足以指导实施，至少覆盖中文名、存放内容、作用、类型、空值、默认、键/约束、来源/写入者、时间/历史、敏感性、示例和误用风险。
7. 检查 `_id` 关系闭包、跨层延迟 FK、单位/币种继承、受控词表、Schema JSON、支付/退款/Lark 工时来源条件门禁，以及旧图/旧数字是否可能被误批准。
8. 独立重算表、视图、字段、FK、分期、154 去向、939 映射、注释、61 页与 PNG；检查生成器和校验器不能通过改期望数字来“自证正确”。
9. 主动尝试用更少的首期物理表完成相同目标，也反向检查是否为了少表错误复用通用表。表少不是目标，独立事实不丢失、粒度不混合才是目标。
10. 明确静态兼容性边界：本包没有执行生产 DDL/DML，不能证明四个部署的动态 SQL、生产 RLS/触发器/索引、来源合同、回填、双写、对账、切换或回滚已经通过。

## 输出要求

第一行给最终结论，随后按顺序给：

1. 阻断项；
2. 交付前必修项；
3. 上一轮三项修复关闭表；
4. 独立精确计数；
5. 137 张表完整判定（可用紧凑、机器可核对的分组清单）；
6. 全字段扫描真实命中；
7. 939 字段迁移矩阵结论，特别是 `daily_revenue` 10/10；
8. 注释充分性、关系闭包、幂等性、current selector、单位/币种、Schema guard、图文与安全结论；
9. 已确认事实、合理推测、暂无法验证；
10. 是否允许作为“等待老板批准的设计评审包”交付，以及仍不能声称什么。

请给文件和行号证据，不输出隐性逐字思维链，不请求许可，不只给计划，现在完成完整只读审计。
