# HOT CRUSH R6 最终独立审计：最小物理数据基座、逐字段契约与可派生性

你是独立数据库架构审计者。只读审计，不得编辑任何文件，不得执行 DDL、DML、部署、迁移、提交或联网写入。

**本次必须立即执行并在本次回复中交付完整审计报告。不要返回计划，不要请求批准，不要写计划文件，不要说“批准后执行”。如果工作量很大，仍须在当前调用中完成；可以使用只读工具核对文件。**

## 审计目标

当前候选模型不是“表越多越完整”，而是：只持久化未来无法从其他稳定事实可靠重建的数据，以稳定 UUID 外键、来源身份、批次、版本和有效期串联模块；确定性汇总、当前状态、差值、毛利、余额和覆盖率尽量由视图派生。

当前生成器报告：

- 138 张潜在物理表，其中首期 100（81 张业务 + 19 张平台侧车）、按需扩展 34、来源条件 4；
- 53 个派生视图；
- 1733 个物理表字段、511 个视图字段；
- 419 个外键；
- 原 R5 的 154 个对象：138 个仍为物理契约、11 个合并、4 个派生、1 个删除；
- 这些数字只是待验证声明，不是事实。你必须反证，而不是替方案背书。

## 必读材料

请读取并交叉核对：

- `docs/database/hotcrush-core-v1/08-r6-minimal-physical-foundation.md`
- `docs/database/hotcrush-core-v1/06-first-principles-decision-review.md`
- `docs/database/hotcrush-core-v1/07-minimum-grain-and-derivation-audit.md`
- `docs/database/hotcrush-core-v1/target-table-catalog.csv`
- `docs/database/hotcrush-core-v1/target-storage-necessity-audit.csv`
- `docs/database/hotcrush-core-v1/target-field-dictionary.csv`
- `docs/database/hotcrush-core-v1/target-comments-contract.sql`
- `docs/database/hotcrush-core-v1/target-model.json`
- `docs/database/hotcrush-core-v1/r5-to-r6-disposition.csv`
- `docs/database/hotcrush-core-v1/current-to-target-matrix.csv`
- `docs/database/hotcrush-core-v1/project-compatibility-matrix.csv`
- `docs/database/hotcrush-core-v1/evidence/current-schema-snapshot.json`
- `docs/database/hotcrush-core-v1/evidence/code-access-snapshot.json`
- `docs/database/hotcrush-core-v1/evidence/pos-member-order-item-audit.json`

必要时只读查看 `docs/database/hotcrush-core-v1/model/` 与 `tools/`，核对生成逻辑与验证门槛。

## 第一性判定

对每一张物理表问：删掉它，是否会丢失无法从其余事实、主数据、版本或事件可靠重建的信息？

允许物理保存的主要理由只有：

1. 不可变来源事实或更正版本；
2. 企业稳定身份、必要的来源映射或多对多关系；
3. 不可重建的人工决定、审批、发布版本或观察值；
4. 有真实运行约束的安全、权限、幂等、队列、审计或并发状态；
5. 当前虽属扩展，但模块启用时仍确实需要的不可重建事实。扩展不能冒充首期核心。

默认应派生而非物理保存：当前状态、最新版本、汇总、余额、平均值、比率、delta、毛利、覆盖率、可从事件/明细确定性恢复的尝试次数或错误摘要。不能用 EAV、任意 JSON、`entity_type + entity_id`、关系 ID 数组或自由文本来伪装“表少”。

## 必查问题

1. **逐表必要性**：对 138 张物理表逐一给出 `KEEP / MERGE_INTO:<table> / DERIVE_VIEW / REMOVE / DEFER_SOURCE / EXTENSION_ONLY`。每张只能有一种结论，名称不得遗漏或重复。`KEEP` 必须一句话说明删表会丢失的不可重建事实。
2. **最小行粒度**：检查每表粒度、主键、唯一约束、可空唯一的 NULL 语义、有效期非重叠约束、来源身份与幂等键。指出任何把两种事实塞在同一行或把同一事实重复保存的地方。
3. **逐字段可派生性**：扫描全部 1733 个物理字段，列出仍可由同表/他表确定性派生、属于缓存、重复币种/单位/身份/状态、或语义不清的字段。没有问题也必须说明核对方法，不能只抽样后声称全部通过。
4. **逐字段注释**：核对 138 张表、53 个视图及其 2244 个字段在 `target-comments-contract.sql` 是否一一有且只有一个非空注释；注释是否说明“存什么、作用、类型、可空、默认、键/约束、时间/历史、敏感性、示例、误用风险”。区分“语法覆盖”与“业务解释充分”。
5. **关系完整性**：检查所有关键 `_id` 是否为真实 FK；关键业务连接是否依靠稳定 ID 而不是名称/自由文本/多态字段；53 个视图的 lineage 是否明确。
6. **历史与重跑**：特别检查 POS 订单商品、会员归属、工时同步、更正批次、计划版本、班表版本、采购单版本、收货、奖励扣减和消息投递的幂等与历史选版。
7. **单位与币种**：检查所有数量的单位语义、供应商包装换算、配方/采购/收货/销售金额的币种继承是否无歧义。
8. **重点反证**：
   - `scm_purchase_order_revision` 是否已足够承载采购单身份，是否仍需要被删除的空壳主单；收货是否必须钉住具体 revision；
   - `scm_material_requirement_component` 是否只保存算法输出与追溯证据，汇总行是否确实派生；
   - `hr_timesheet_entry` 的来源更正是否会重复计算，`v_hr_timesheet_entry_current` 是否正确成为分析入口；
   - `pos_member_daily_metric`、`pos_member_balance_snapshot` 是独立来源报告值还是可由订单/卡流水派生；若来源证据不足，应如何降级；
   - `ops_daily_review.manager_*` 是独立人工报告事实还是重复指标；
   - 19 张平台侧车是否真是共享数据库基座，还是应该留在应用私有存储；
   - 34 张扩展表是否被文档误导为立即建表。
9. **统计一致性**：机器核对 138/53/1733/511/419、154 个原对象唯一去向，以及 `100 + 34 + 4 = 138`、`138 + 11 + 4 + 1 = 154`。任何口径不一致都列为阻断项。
10. **事实边界**：明确区分已由静态文件确认的事实、合理推测、待运行时/来源合同验证的信息。静态代码扫描不能冒充生产运行证据。

## 输出格式

中文，先给结论，直接且不迎合。

必须包含：

- `最终结论：PASS / PASS_WITH_CHANGES / FAIL`；
- 阻断项（如有）；
- 138 张物理表的完整逐表判定，格式 `table_name | disposition | reason`；
- 所有可疑物理字段的完整清单，格式 `table.field | issue | recommendation`；
- 注释覆盖与充分性核对结果；
- 精确统计核对；
- 已确认事实 / 合理推测 / 待验证信息；
- 最小修改顺序。

不要展示隐性逐字思维链；给出足以复核的证据和反例。若建议继续减少表或字段，必须说明不会损失什么、如何派生以及会引入什么风险。
