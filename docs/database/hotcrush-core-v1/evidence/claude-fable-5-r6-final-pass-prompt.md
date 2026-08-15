# HOT CRUSH Core V1 R6 最终独立放行复核

你是独立数据库架构审计者。请对 `/Users/weiliangshao/hot/docs/database/hotcrush-core-v1` 做只读终审。不得修改文件，不得执行 DDL/DML、迁移、部署或提交，也不得因为本地生成器/验证器显示 PASS 就默认方案正确。

第一行只能是 `最终结论：PASS`、`最终结论：PASS_WITH_CHANGES` 或 `最终结论：FAIL`。只有没有任何交付前必修项时才能 PASS；PASS_WITH_CHANGES 也禁止交付。

## 真正目标

HOT CRUSH 只服务一个企业，但支持多门店、中央厨房、仓库及未来模块。设计必须：

1. 只物理保存不能从其他稳定事实确定性重建的最小事实、稳定身份、来源观察、人工决定、版本、外部副作用和必要运行状态；
2. 当前值、汇总、余额、比例、差值、排名、画像、成本、毛利和质量摘要优先派生；
3. 通过稳定 UUID、来源命名空间、营业日、批次、版本和有效期连接，名称只能做证据；
4. 来源字段不能静默丢失、猜值、补零，或把抓取时间冒充业务时间；
5. 多门店策略不能误放进企业全局产品主档；不能为了表少而混合粒度，也不能为了扩展性预建没有写者/来源的表。

## 上一轮结论与必须逐项反证的修复

上一轮结论见 `evidence/claude-fable-5-r6-final-recheck-pass-with-changes.md`。不要相信以下修复声明，必须从当前文件独立核对：

1. `item_waste.amount/item_name` 已明确进入 `pos_item_waste.source_waste_amount/source_name_snapshot`，并在 current/mapped 视图保留；来源金额与派生成本损失分开。
2. `hourly_sales_summary.total_discount/num_of_guests` 已进入 `pos_sales_hour.discount_amount/source_guest_count`；后者明确不是进店客流；平均客单价仍派生。
3. `product` 的地点敏感人工字段不再塞进全局 `ops_product`：price、display_full_quantity、positioning、sales_ratio、target_tc、audience、break_stock_time、sort_order、time_slots 进入现有 `ops_business_rule` 的 `PRODUCT_LOCATION_PLANNING_POLICY` 版本，具有 `scope_location_id + scope_product_id + rule_code + version/effective period`，固定 JSON Schema、最具体范围优先和禁止有效期重叠。请重点挑战：受 schema 约束 JSON 是否在这里合理、是否仍会掩盖字段或多门店范围；旧 product 没有 location 时是否正确阻断而非默认扩散。`avg_*`、`baseline_*` 仍派生。`cold_hot` 和取整方式作为跨地点固有属性保留在产品主档。
4. RES `pos_product` 的 cost-card/spec/has-cost/total-cost/theoretical-cost、目录中英文名/品类/规格/状态和展示覆盖都有 `pos_product_listing.source_*` 去向；来源成本只是外部观察，不覆盖企业成本卡。`source_item_key` 唯一性按来源系统作用域。
5. `ops_store.lark_base_token` 经代码证据确认是 Lark Bitable Base `app_token` 的公开对象 ID，不是认证秘密；它进入 `ops_location_source_identity.source_container_id`，`lark_table_id` 进入同一映射的 `source_location_id`。真实 app_secret/access_token 明确只在密钥管理。`evidence` 不再冒充运行配置。
6. daily breakdown、财务订单/库存弱字段已经逐字段明确；旧 `hbti_auth_token` 七字段全部 `REISSUE_NOT_MIGRATE + NO_TARGET`，不得复制旧授权状态。
7. `app_user_store_scope` 迁到具体 `app_user_role.user_role_id + location_id`，避免一个账号的地点范围扩散到所有角色。
8. README、HTML、CSV 和图中的数字由当前模型动态生成；旧 R5 图只在 archive，且明确不得批准。

## 当前待独立重算的声明

- 潜在物理表 137：首期 100（81 业务 + 19 平台侧车）、扩展 33、来源条件 4；137 不是立即建表数。
- 视图 59：首期 41、扩展 13、来源条件 5。
- 物理字段 1,792，视图字段 637，共 2,429 个逐字段说明；196 个表/视图说明；空说明应为 0。
- FK 字段 418；跨层延迟关系必须显式声明。
- 原 154 个候选对象处置：100 首期 + 33 扩展 + 4 来源条件 + 11 合并 + 4 派生 + 2 删除。154 不是表数。
- 当前生产快照 939 个字段，在 `current-field-to-target-matrix.csv` 中必须一一覆盖、无重复、无模糊兜底掩盖高风险字段。
- Draw.io 与 PDF 61 页；4 张高清 PNG。

## 必读当前文件

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
- `current-to-target-matrix.csv`
- `current-field-to-target-matrix.csv`
- `current-guardrail-to-target-matrix.csv`
- `r5-to-r6-disposition.csv`
- `project-compatibility-matrix.csv`
- `evidence/current-schema-snapshot.json`
- `evidence/code-access-snapshot.json`
- `evidence/pos-member-order-item-audit.json`
- `evidence/claude-fable-5-r6-postfix-review-fail.md`
- `evidence/claude-fable-5-r6-final-recheck-pass-with-changes.md`
- `model/` 和 `tools/` 的声明模型、生成与 fail-closed 校验逻辑
- `diagrams/` 当前 R6 文件及 `archive/r5-diagrams/`

## 必须完成的审计

1. 逐项核对上一轮 B1-B4、N1-N5 和本提示列出的 8 组修复，给 CLOSED/OPEN/PARTIAL；任何 OPEN/PARTIAL 不得 PASS。
2. 对 137 张物理表逐表给 KEEP / MERGE_INTO / DERIVE_VIEW / REMOVE / EXTENSION_ONLY / DEFER_SOURCE，不能遗漏或重复。重点挑战 100 张首期表、19 张平台侧车和所有 generic state/config 表是否真有必要。
3. 扫描全部 1,792 个物理字段，列出所有仍可确定性派生、缓存、重复状态、丢失来源事实、默认值篡改、名称键、自由多态、任意 JSON、粒度错位、时间/单位/币种/版本不清的真实命中。不要只抽样。
4. 验证快照 939 字段与迁移矩阵集合严格一一相等；高风险对象必须逐字段明确到存在的目标字段、明确 DERIVE 或有事实依据的 NO_TARGET，不接受 `OBJECT_TARGETS` 代替字段设计。重点核对 product、pos_product、ops_store、item_waste、hourly_sales_summary、daily_breakdown、finance_orders、finance_stock、会员三表、HBTI token 和账号地点范围。
5. 检查每张表的一行粒度、PK、唯一约束、NULL 唯一语义、幂等键、来源更正、版本发布、有效期和 current selector；检查重跑同批是否会重复或覆盖历史。
6. 机器核对每个表/视图和每个字段均有说明；人工检查说明是否足以指导实施，至少覆盖中文名、存放内容、作用、类型、空值、默认、键/约束、来源/写入者、时间/历史、敏感性、示例和误用风险。
7. 检查所有 `_id` 关系闭包、跨层 FK 激活条件、单位/币种继承、受控词表、受 schema 约束 JSON、支付/退款/Lark 工时的来源条件门禁。
8. 独立重算表、视图、字段、FK、分期、154 去向、939 映射、注释和 61 页；检查旧数字、旧术语或旧图是否仍可能被误批准。
9. 主动尝试用更少的首期物理表完成同样目标；若建议合并，必须证明不会丢失独有事实或混合粒度。也要反向检查当前为了少表是否错误复用通用表。
10. 明确静态兼容性边界：本包没有执行生产 DDL/DML，不能证明四个部署的动态 SQL、生产 RLS/触发器/索引、来源合同、回填、双写、对账、切换或回滚已通过。

## 输出要求

第一行给最终结论，随后按以下顺序：

1. 阻断项；
2. 交付前必修项；
3. 上轮问题与本轮 8 组修复关闭表；
4. 独立精确计数；
5. 137 张表完整判定（可用紧凑机器可核对清单）；
6. 全字段扫描真实命中；
7. 939 字段迁移矩阵结论；
8. 注释、关系、幂等、current selector、单位/币种、图文与安全结论；
9. 已确认事实、合理推测、暂无法验证；
10. 是否允许作为“等待老板批准的设计评审包”交付，以及仍不能声称什么。

请给文件和行号证据，不输出隐性逐字思维链，不请求许可，不只给计划，现在完成完整只读审计。
