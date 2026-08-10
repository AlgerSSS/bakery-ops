# Claude Fable 5 R6 修订后独立终审（第一次）

> 原始返回。通过 OMP 的 `anthropic/claude-fable-5` 只读入口执行；结论为 `FAIL`。本文件是修订输入，不能当作批准证据。

## 总判定：FAIL

## 1. 阻断项

### B1. 会员卡交易仍会丢失已确认来源事实

现库 `pos_member_card_txn.trade_amount` 是明确保存的 RES 原始字段；其口径随交易类型变化，且只有 `txn_type IN (20,40)` 时才能与会员卡付款拆分对账。证据见 `current-field-dictionary.csv:567-572,578-582`。

目标 `pos_member_card_transaction` 没有 `trade_amount`，也没有原始交易类型码，只保存归一化后的 `transaction_type`。当前来源码是 `smallint` 10/20/30/40/50/60；目标没有冻结映射版本或保留未来未知来源码的通道，也未证明 `trade_amount` 对所有交易类型都能从 cash/gift/total 重建。当前 `pos_order_no`、`order_id` 和 `source_code` 也没有逐字段处置。

必须至少保留原始交易类型码和 `trade_amount`，并明确 `pos_order_no/source_code` 的迁移、归档或批准丢弃。

### B2. point/level/growth/lifetime 被放进可覆盖主档，历史仍会丢失

R6 已补回 `level_name`、`growth`、`point_balance`、`lifetime_topup_amount/count`、`lifetime_consume_amount/count`，但它们位于生命周期为 `CONTROLLED_UPDATE` 的 `pos_member`，只用 `last_snapshot_date` 表示最近观察时点。下一次同步会覆盖旧值，而这些状态无法由卡交易完整重建。

最小修法是把会变化的来源观察并入 member × date × batch 的 `pos_member_balance_snapshot` 追加快照；`pos_member` 只保留稳定身份和可覆盖治理状态，不新增卡级快照或额外物理表。同时缺少 `v_pos_member_balance_current` 确定性入口。

### B3. 多个视图消费每批追加事实，却没有选当前合格批次

`pos_sales_hour`、`pos_daily_breakdown`、`pos_item_waste` 和 `pos_member_daily_metric` 的粒度包含批次，但这些正式视图直接消费原始表，没有统一声明 SUCCEEDED、supersedes 和确定性破平：

- `v_pos_revenue_reconciliation`
- `v_pos_member_daily_summary`
- `v_ops_timeslot_sales_baseline`
- `v_pos_item_waste_mapped`
- `v_ops_item_daily_pulse`
- `v_business_timeline`

部分输出还没有批次 ID 或修订键。同日多个成功批次会造成重复计数，旧批次被替代后仍可能参与分析。必须建立确定性 current selector，或在每个视图完整声明选版规则；正式汇总必须输出批次血缘或修订键。

### B4. 首期100表与独立扩展包不是物理外键闭包

发现五条跨实施层级外键：

1. `scm_supplier_price_observation.goods_receipt_line_id` → 扩展表 `scm_goods_receipt_line`
2. `scm_supplier_price_observation.purchase_order_line_id` → 扩展表 `scm_purchase_order_line`
3. `hr_timesheet_entry.shift_assignment_id` → 扩展表 `ops_shift_assignment`
4. `hr_timesheet_entry.station_id` → 扩展表 `ops_station`
5. `scm_inventory_movement.production_run_id` → 另一扩展包 `ops_production_run`

前两条位于首期 `scm_supplier_price_observation`，导致首期 DDL 无法按当前契约完整创建。必须把可选关联及外键延后到对应扩展迁移、拆成扩展关联表，或明确扩展包依赖关系。

## 2. 非阻断但必须修订

### N1. app_data_quality_issue 的最终覆盖决定不成立

原始 Claude 判定为 REMOVE，理由是没有确认写入者且 `entity_type + entity_id` 是无约束多态。终稿虽在 `final_override` 明示覆盖，但目标仍保留同一多态结构，违反“不能依赖无约束多态文本”。建议恢复 REMOVE；检测保持为视图，未来确认工单写入者后再用类型化目标重设计。完整潜在目录可从 138 降为 137。

`app_audit_event.object_type/object_id` 同形，但作为只追加平台审计元数据可有条件豁免；必须声明不作为业务连接键，并约束允许对象类型和 ID 格式。

### N2. 117 个受控词表字段没有数据库域约束

全量扫描发现 117 个文本字段把允许值写成有限集合，却没有 CHECK 或字典 FK。其中 65 个是明确状态机/质量状态，42 个位于首期；其余 52 个是类型/代码字段。不是所有代码都必须硬编码 CHECK，但必须逐字段选择：封闭词表用 CHECK；可治理扩展用字典 FK；真正开放文本则不能把示例写成穷举。`pos_ingest_batch.dataset_code` 被 current 视图用于精确选版，必须补受控契约。

### N3. 会员卡注释仍暗示不存在的卡级余额关系

`pos_member_card.source_card_id` 的作用写成“与来源系统共同连接交易和余额快照”，但余额快照已经正确降为会员级。应写明卡 ID 只连接卡交易；余额快照是会员名下全部卡合计，禁止按卡连接或分摊。

### N4. 外键数字不一致

独立计数为 418，README 和蓝图也是 418，但 `09-implementation-guardrails-and-security.md` 仍写“禁止盲目生成419个单列索引”。必须统一为 418。

### N5. 旧名图形资产仍在同一包且不是 R6 别名

规范 R6 Draw.io/PDF 是 61 页；旧 `HOTCRUSH-Core-V1-方案C数据库蓝图.drawio` 与 R6 不同，旧 PDF 实际 62 页，其他旧 HTML/PNG/SVG 也不是同一生成结果。应删除、归档或明确标为旧资产，避免审批混用。

## 3. 独立精确计数

| 项目 | 独立计数 |
|---|---:|
| 当前生产快照表 / 视图 / 字段 | 76 / 21 / 939 |
| 目标潜在物理表 / 物理字段 | 138 / 1,762 |
| 目标视图 / 视图字段 | 53 / 522 |
| 全部字段说明 | 2,284 |
| 目标外键 | 418 |
| 表 / 视图 / 字段 COMMENT | 138 / 53 / 2,284 |
| Draw.io / 规范 R6 PDF 页 | 61 / 61 |
| 当前门禁 / 目标表实施门禁 | 467 / 138 |

目标表分期为 81 首期业务 + 19 首期平台 + 34 扩展 + 4 来源条件。视图分期为 34 PHASE1 + 14 EXTENSION_PACK + 5 SOURCE_CONDITIONAL。154 项最终处置为 81 首期业务、19 首期平台、34 扩展、4 来源条件、11 合并、4 派生、1 删除。

## 4. 138表最小性结论

除下列7张外，其余131张的物理必要性、粒度、写入者、生命周期和当前实施层级没有找到新改判依据：

- `app_data_quality_issue`：应恢复 REMOVE 或类型化重设计，完整目录可降为 137。
- `pos_member`：保留，但变化观察不应留在可覆盖主档。
- `pos_member_balance_snapshot`：member × date × batch 正确，应承接变化观察并增加 current 视图。
- `pos_member_card_transaction`：保留，但缺 `trade_amount` 和原始类型证据。
- `scm_supplier_price_observation`：首期必要，但两个扩展 FK 不能作为首期必建约束。
- `hr_timesheet_entry`：来源条件定位合理，但须声明班表包前置或延后可选 FK。
- `scm_inventory_movement`：扩展表合理，但当前依赖生产执行包。

首期业务必要性仍可能是 100 张，但当前 100 表物理契约不能直接实施。完整潜在目录按现有证据应为 137。

## 5. 全字段扫描结果

已确认正确：成本、毛利、节假日因子和原料需求汇总留在视图；余额快照不再虚构卡级粒度；交易前后余额与 `point_delta` 已补回；会员日报分项已补回且比率留在视图；金额币种、JSON用途、名称键和时间语义整体合理。

真实命中为：

1. 会员交易缺 `trade_amount` 和原始类型证据；
2. point/level/growth/lifetime 生命周期错误；
3. 批次事实视图未选版；
4. 五条跨实施层级 FK；
5. 两组无约束多态；
6. 65 个状态字段与另 52 个有限词表字段没有 CHECK/FK 处置；
7. `pos_ingest_batch.dataset_code` 缺受控定义；
8. `pos_member_card.source_card_id` 注释误导；
9. 721/2,284 个误用提醒仍为通用模板，705 个 UUID 示例相同。语法完整，但不能因此声称全部解释充分。

## 6. 上次问题关闭情况

- A1 原始 Claude 归因及 final_override：已关闭。
- A2 会员字段：部分关闭；仍缺 `trade_amount` 且变化观察生命周期错误。
- A3 视图递归分期：结构上已关闭；物理 FK 分期和 POS 批次语义未关闭。
- `unassigned_order_count`、旧词表、消息多态来源字段、店长客单价门禁、PO 合计、收货/PO 版本门禁、467 当前门禁映射、138 目标门禁、07/08 重复文档：已关闭或关闭到设计门禁。
- 图文旧别名卫生：未关闭。

## 7. 注释、迁移安全与图文一致性

138 表、53 视图和 2,284 字段均有非空 SQL 注释，但不能判定全部充分：卡级余额注释明确误导，大量状态字段只有文案枚举没有约束处置。当前还缺 939 个现库字段逐字段去向矩阵；对象级迁移规则不足以防止 `trade_amount` 这类静默遗漏。

467 项现有门禁均有设计去向，138 张目标表均为 `DESIGN_ONLY_NOT_EXECUTED`，没有虚假部署声明；RLS、触发器和索引仍未实施。规范 R6 对象集合和 61 页一致，但旧方案 C 图纸冲突。视觉检查被限流，Claude 无法独立确认像素级排版。

## 8. 事实、不确定性与最终交付结论

已确认：上述计数、`trade_amount` 缺失、会员观察生命周期错误、六个 POS 视图缺完整批次选版、五条跨层 FK、117 个词表约束缺口、规范 R6 61 页与旧方案 C PDF 62 页，以及全部目标仍是设计未执行。

合理推测：按当前血缘实现会在 POS 重跑时重复计数；覆盖 `pos_member` 会丢历史；旧图会造成审批混用。

暂无法验证：RES 交易更正契约、`pos_order_no/source_code` 价值、支付/退款/Lark 来源能力、生产部署版本、RLS/索引/触发器运行效果、全部页面像素级排版和任何生产迁移效果。

**最终结论：不允许作为“等待老板批准的设计评审包”交付。** 至少必须关闭 B1-B4、重设或移除数据质量多态表、处置受控词表、修正注释和数字、清理旧图形资产。即使修订后通过，也只能声称“设计评审包通过独立审计”，不能声称迁移已批准或生产已实施。
