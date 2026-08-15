# HOT CRUSH Core V1 R6 最终独立复核（修复后）

你是独立数据库架构审计者。请对 `/Users/weiliangshao/hot/docs/database/hotcrush-core-v1` 做只读终审。不得修改任何文件，不得执行 DDL/DML、迁移、部署、提交，也不得因为生成器或本地验证器显示 PASS 就默认方案正确。

## 审计目标与判定原则

HOT CRUSH 只服务一个企业，但支持多门店、厨房、仓库及未来模块。目标不是让表数看起来少，也不是让字段数看起来多，而是：

1. 只物理保存不能从其他稳定事实确定性重建的最小事实、稳定身份、来源映射、人工决定、观察值、版本、外部副作用与必要运行状态；
2. 当前值、汇总、余额、比率、差值、排名、画像、成本、毛利与质量摘要优先由只读视图派生；
3. 模块通过稳定 UUID、来源身份、营业日、批次、版本和有效期连接，不依赖名称、任意 JSON、关系 ID 数组或无约束多态文本；
4. 字段迁移必须保真：来源字段不能静默丢失、猜值、用抓取时间冒充业务时间，或把不同财务口径强行对账；
5. 只有明确 `PASS` 才允许作为“等待老板批准的设计评审包”交付。`PASS_WITH_CHANGES` 或 `FAIL` 都表示交付前必须继续修改。

## 上一次 FAIL 与声称完成的修复

上一次复核原文是：

- `evidence/claude-fable-5-r6-postfix-review-fail.md`

不要相信下面的修复声明；必须逐项从当前文件反证：

### B1 会员卡交易保真

- `pos_member_card_transaction` 声称保留来源 member/card、原始交易类型 code/label、规范化类型（含 UNKNOWN）、trade amount、POS order number/source order id/source code、交易前后余额、积分变化；目标 member/card 可空，不猜关联。
- 唯一键声称包含来源系统、门店和来源交易 ID。
- 金额空值不再默认 0；业务时间空值不再用抓取时间替代。
- `pos_ingest_batch` 声称有受控 `dataset_code` 与 `parser_version`。
- 当前 `pos_member_card_txn` 每个来源字段声称都有明确去向。

### B2 会员状态历史

- 等级、成长值、积分、累计金额等动态状态声称移到 `pos_member_balance_snapshot`，而 `pos_member` 只保留稳定身份/治理状态。
- 快照声称还保留 profile presence、首卡日期、最近充值/交易时间。
- 声称新增 `v_pos_member_state_current`，且 MEMBER_PROFILE 批次覆盖 profile 与 card-list 并集，包括 `profile_present=false`。

### B3 POS 当前版本入口

- 声称补齐 hour/item-hour/daily-breakdown/waste/member-daily/member-state 的 current selector。
- 声称所有下游视图只从正确 dataset 的 current selector 读取，并暴露批次或 revision lineage，避免更正批次重复累计。

### B4 跨层外键闭包

- 声称模型显式标记 ACTIVE 与 DEFERRED cross-tier FK；扩展包未启用时不生成悬空 FK；校验器会拒绝未声明的跨层 FK；图中用 `FK LATER` 表示。

### N1-N5 与其他修复

- 物理 `app_data_quality_issue` 声称删除，质量摘要改为域质量视图的只读聚合；`app_audit_event` 的多态元数据被约束且明确不是业务关系。
- 声称新增受控词表编译：真正闭集生成 CHECK，开放治理 code 用格式约束而非伪枚举。
- 会员 card 与 member snapshot 的说明不再伪造 card-level 快照。
- 文档的 FK 数等统计声称动态生成。
- 旧 R5 蓝图已移到 `archive/r5-diagrams/`，不得与 R6 并列作为当前批准材料；兼容 HTML 必须与当前 R6 HTML 字节一致。
- HBTI/问卷响应声称保留来源系统和来源 response/attempt 身份。
- 声称新增 `current-field-to-target-matrix.csv`，覆盖当前数据库快照 939 个字段且每个恰好一次；关键会员三表不允许用模糊对象级规则掩盖丢字段。

## 当前生成器声明（必须独立重算）

下面都只是待核对声明：

- 137 张潜在物理表：首期 100（81 业务 + 19 平台侧车）、扩展包 33、来源条件 4；
- 59 个派生视图：首期 41、扩展 13、来源条件 5；
- 1757 个物理字段、627 个视图字段，共 2384 个逐字段注释；
- 196 个对象（137 表 + 59 视图）都有表/视图用途注释；
- 416 个 FK 字段；
- 原 154 个候选对象去向：100 首期物理 + 33 扩展物理 + 4 来源条件物理 + 11 合并 + 4 派生 + 2 删除 = 154；
- 当前 939 个来源字段在 `current-field-to-target-matrix.csv` 中各有一个去向；
- 当前 Draw.io/PDF 声称 61 页。

注意：137 是全部潜在物理契约，不是立即建表数；154 是旧候选的处置总数，不是物理表数。

## 必读证据

至少交叉核对：

- `00-review-entry.md`
- `03-table-and-field-dictionary.md`
- `06-first-principles-decision-review.md`
- `07-minimum-grain-and-derivation-audit.md`
- `08-r6-minimal-physical-foundation.md`
- `09-implementation-and-compatibility-guardrails.md`
- `target-model.json`
- `target-table-catalog.csv`
- `target-field-dictionary.csv`
- `target-comments-contract.sql`
- `target-storage-necessity-audit.csv`
- `current-to-target-matrix.csv`
- `current-field-to-target-matrix.csv`
- `r5-to-r6-disposition.csv`
- `implementation-guardrail-matrix.csv`
- `project-compatibility-matrix.csv`
- `evidence/current-schema-snapshot.json`
- `evidence/code-access-snapshot.json`
- `evidence/pos-member-order-item-audit.json`
- `evidence/claude-fable-5-r6-postfix-review-fail.md`
- `model/` 和 `tools/` 中实际生成与校验逻辑
- `diagrams/` 里的当前 R6 源文件与导出物，以及 `archive/r5-diagrams/`

## 必须执行的审计

1. **逐项关闭上次 FAIL**：对 B1-B4、N1-N5 分别给 CLOSED / OPEN / PARTIAL，引用当前文件与行号；任何一个 OPEN/PARTIAL 都不得 PASS。
2. **137 表逐表最小性**：对每张潜在物理表给 `KEEP / MERGE_INTO:<table> / DERIVE_VIEW / REMOVE / EXTENSION_ONLY / DEFER_SOURCE`。如果建议减少，必须说明原表独有不可重建事实去哪里；不能为了表少混合粒度。特别挑战 100 张首期表和 19 张平台侧车是否真有首期必要性。
3. **全部物理字段可派生性与保真扫描**：检查 1757 个物理字段，而非抽样。列出所有仍可确定性派生、缓存、重复状态、重复币种/单位、来源字段丢失、默认值篡改、名称键、自由多态、任意 JSON、时间/版本不清等命中。
4. **939 个当前字段迁移去向**：验证快照字段集合与矩阵一一相等；检查 `TRANSFORM_BY_OBJECT_RULE` 等对象级映射是否足以指导无损迁移。若任一字段无法确定精确目标/派生/保留来源/明确弃用理由，必须列出并至少判为 `PASS_WITH_CHANGES`。重点逐字段核对 `pos_member`、`pos_member_daily`、`pos_member_card_txn`、POS 事实、工时、成本和 HBTI。
5. **粒度、键、版本和幂等**：检查每表一行代表什么，PK、唯一约束、可空唯一的 NULL 语义、来源身份、批次/版本、营业日和有效期；检查重跑同批、来源更正批次、计划发布、采购修订、收货、卡交易和问卷尝试是否会重复或覆盖历史。
6. **current selector 完整性**：列出所有追加/更正型 POS 表，确认均有唯一当前读取入口；确认下游视图不会跨错误 dataset 选批次，不会重复累计，并暴露 lineage。
7. **逐表逐字段注释**：机器核对对象注释和字段注释一一覆盖，并人工检查充分性。每个字段说明至少应明确：中文名称、存放什么、作用、类型、可空、默认、键/约束、来源/写入者、时间/历史、敏感性、示例和误用风险。模板化但无法指导实施或会误导的也算问题。
8. **关系闭包**：检查关键 `_id` 是否真实 FK 或有明确延迟原因；跨层外键只在依赖表同层可用时激活；稳定关系不能依赖名称、自由文本或无约束多态引用。
9. **词表、单位与币种**：核对有限状态是否有真实 CHECK/FK；开放 code 不得用虚假封闭枚举；检查配方、采购、收货、库存、销售和成本的数量单位、包装换算、金额与币种继承。
10. **图、文档与统计一致性**：独立重算表、视图、字段、FK、分期、154 去向、939 映射、注释、约束门禁和 61 页；检查旧术语、旧数字、旧图是否仍可能被误批准。
11. **实施边界**：确认这是设计评审包而非已部署 DDL；明确哪些兼容性只来自静态扫描，哪些必须在真实生产来源合同、数据剖析、回填、双写、对账和回滚演练中验证。
12. **主动找反例**：尝试用更少首期物理表完成同样目标；也要反向检查是否为了减少表而丢失独立来源事实。不要为了附和用户的“表少”而错误合并。

## 输出要求

第一行只能是：`最终结论：PASS`、`最终结论：PASS_WITH_CHANGES` 或 `最终结论：FAIL`。

随后依次给出：

1. 阻断项；
2. 非阻断但交付前应修项；
3. B1-B4、N1-N5 逐项关闭表；
4. 独立精确计数；
5. 137 张物理表的完整逐表判定（不可遗漏/重复）；
6. 全字段扫描所有真实命中；
7. 939 字段迁移矩阵审计，尤其对象级规则是否足够；
8. 注释充分性、关系闭包、current selector、单位/币种、迁移/安全门禁和图文一致性；
9. 已确认事实、合理推测、暂无法验证；
10. 是否允许作为“等待老板批准的设计评审包”交付，以及仍不能声称什么。

请给出文件和行号证据，不要输出隐性逐字思维链。不要请求许可，不要只给计划；现在完成完整只读审计。
