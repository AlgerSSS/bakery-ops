# R6A1 物理存储必要性重审（"可计算不落库"硬规则）

> 状态：**审核建议，未实施**。本文件只做设计层判定，不改声明模型、生成器、门禁或数据库。
> 触发：2026-08-15 用户裁定——"POS 独立上报值、历史审批结果或曾驱动实际行动的决策快照，可以保存，
> 但必须标明它不是标准事实。**可以计算的都不落库**。"
> 审核对象：`revisions/r6a1-fx-signed-pos/generated/resolved-table-catalog.csv`（105 张 PHASE1 表）
> 及 `resolved-field-dictionary.csv` 字段级契约。

## 1. 审核规则

**硬规则**：凡能从本库**完整、不可变的最小事实**和**版本化规则**中确定性重建的数据，一律不作为
业务字段或事实表落库，只通过普通视图计算。

"可以计算"必须同时满足：输入完整、公式和版本明确、币种/舍入/时区口径固定、任何时候都能重现
历史结果。仅仅"理论上可以算"不算。

**三类例外（可保存，但必须标明不是标准事实）**：

1. POS 独立上报值 → 只能进入隔离的**原始来源审计层**；
2. 历史审批结果 → 审批动作、审批人、审批时间是发生过的事实，落库；可重算的批准金额不重复保存；
3. 曾驱动实际行动的决策快照 / 外部副作用 → 保存执行记录和回执。

**补充约束**：暂不使用物化视图或指标缓存；将来有性能证据再单独审批，缓存永远不能成为数据真相。

## 2. 结论摘要

- R6A1 的字段级纪律**大体已经符合**硬规则：10 张 `PARTIAL_FIELDS_DERIVED_IN_VIEW` 表的派生字段
  （客单价、总分、标准化别名、base_unit_quantity 等）全部已设计为视图派生、不落库；
  `pos_sales_day.source_average_order_value` 已约定"系统自行相除得到的值不写入"；
  `ops_daily_review.manager_avg_transaction` 已约定"系统计算结果必须留空"并强制来源说明。
- **主要问题不在字段，在分层**：15 张来源汇总/快照表和 5 张决策输出表目前与原子事实同挂
  `CORE_BASE_FACT` / `CORE_DECISION_OUTPUT`，目录层没有把它们与标准事实隔离——这正是"客单价
  算不算事实"混淆的根源。
- 因此本轮重审的缩减**不是物理 DROP 表**，而是：把 105 张 PHASE1 表重分为六层，把 22 张移出
  标准事实层，并补齐每表每指标的 `fact_kind` / `value_role` 语义标签。
- 2 张表需要真实的内容收紧：`mkt_survey_result`（新计算行应转视图）、`mkt_reward_stock`
  （计数器应改流水 + 视图）。

重分结果（105 = 59 + 15 + 5 + 2 + 19 + 5）：

| 层 | 表数 | 性质 |
|---|---|---|
| 标准事实层：身份 / 版本化规则 | 33 | 标准事实 |
| 标准事实层：原子事件 / 人工行为 / 状态变化 | 26 | 标准事实 |
| 来源汇总观察层 | 15 | **非标准事实**，reconciliation_only |
| 决策快照层 | 5 | **非标准事实**，需标明 |
| 摄取台账（操作记录） | 2 | 操作流水，非业务事实 |
| 平台侧车 | 19 | 安全/恢复所需，规则不涉及 |
| 结构契约（R6A1 未批准生产使用） | 5 | 冻结待批 |

## 3. 建议的分层标签体系

在表目录和字段字典新增两列（落实 Codex P0-3 建议的载体）：

- `fact_kind`：`identity` / `versioned_rule` / `atomic_event` / `source_observation` /
  `human_action` / `state_change` / `external_execution` / `decision_snapshot` /
  `ingest_ledger` / `platform_state` / `structural_contract`
- `value_role`（字段级）：`standard_fact` / `source_reported` / `derived_view_only`（该值只允许
  出现在视图）/ `decision_snapshot_nonstandard` / `derived_from_source_normalization`

治理硬约束（写进门禁测试）：

1. 来源汇总观察层的表禁止与订单行重算结果相加或互相覆盖，只用于对账；
2. 决策快照层禁止作为指标真源被 BI/AI 直接读取，读取必须经标明快照语义的认证视图；
3. 任何 `derived_view_only` 值出现在物理表字段清单即门禁失败；
4. 来源观察层与标准事实层的同名指标必须使用不同字段名（见 §5.2 客单价拆分）。

## 4. 逐层判定

### 4.1 标准事实层 — 身份 / 版本化规则（33 张，保留不动）

`app_source_system`、`app_unit`、`cost_card_material_cost_selection`、`cost_card_recipe_component`、
`cost_card_recipe_version`、`finance_period_category_map`、`finance_target`、`hr_employment`、
`hr_employment_source_identity`、`hr_person`、`hr_person_contact`、`hr_screening_rule`、
`mkt_campaign_version`、`mkt_reward`、`mkt_survey_question`、`mkt_survey_question_option`、
`ops_business_rule`、`ops_location`、`ops_location_source_identity`、`ops_product`、
`ops_product_alias`、`ops_role`、`pos_member`、`pos_member_card`、`pos_member_contact`、
`pos_product_listing`、`pos_product_mapping`、`scm_material`、`scm_material_alias`、
`scm_material_source_identity`、`scm_material_unit_conversion`、`scm_supplier`、`scm_supplier_item`。

已合规的派生处理：`pos_member` 的等级/积分/余额等 9 个易变值、`ops_product_alias` 与
`scm_material_alias` 的 `normalized_alias`、`scm_supplier_item` 与 `cost_card_recipe_component`
的 `base_unit_quantity` 均已设计为视图派生，物理不存。✔

### 4.2 标准事实层 — 原子事件 / 人工行为 / 状态变化（26 张，保留不动）

`hr_application`、`hr_application_stage_event`、`hr_appointment`、`hr_assessment`、
`hr_assessment_score`、`hr_employee_event`、`hr_employment_mapping_review`、`hr_job_requisition`、
`hr_offer`、`mkt_campaign_member`、`mkt_reward_claim`、`mkt_reward_stock`（见 §5.4 收紧）、
`mkt_survey_answer`、`mkt_survey_response`、`ops_calendar_event`、`ops_daily_review`、
`ops_operational_event`、`ops_operational_event_product`、`ops_review_action`、`ops_stockout_event`、
`pos_item_waste`、`pos_member_card_transaction`、`pos_order`、`pos_order_item`、
`pos_product_mapping_review`、`scm_material_price_observation`。

判定要点：

- `pos_order` / `pos_order_item`：R6A1 已改为 Report211 原始冲销行粒度，全部金额为来源行原值
  （允许负/零/正），无系统计算列。✔
- `hr_assessment.total_score` 已视图派生；`hr_offer` / `finance_target` / `ops_business_rule`
  为审批与规则版本行为。✔
- `ops_stockout_event.lost_*_estimate`：依赖"检测时刻可见的数据"，事后数据补齐会使重算结果
  不同，不满足"任何时候都能重现"，属算法快照，保留但须标 `decision_snapshot_nonstandard`。
- `scm_material_price_observation` 是来源价格观察 + 人工核验行为，属原子观察。✔

**边界情况（需老板/用户拍板）**：行内标准化列——`pos_item_waste.reason_code`（由 `reason_raw`
× `reason_mapping_version` 确定性映射）、`pos_member_card_transaction.transaction_type`（由原始
代码 × parser 版本规范化）、各行 `business_date`（由时间戳 × 地点切点规则归属）——技术上都是
可重算的。但它们属于**摄取标准化层**而非业务指标，删除会迫使所有查询重跑 parser。建议：
物理保留，字段字典标 `value_role = derived_from_source_normalization`，并要求 parser/映射版本
永久可重跑。不按业务派生指标处理。

### 4.3 来源汇总观察层（15 张，移出标准事实层，标明非标准事实、reconciliation_only）

| 表 | 判定依据 |
|---|---|
| `pos_sales_day` | POS 日汇总独立上报；字段已是来源原值语义（来源未返回则空） |
| `pos_sales_hour` | POS 小时汇总独立上报；`source_guest_count` 口径待确认 |
| `pos_item_sales_hour` | POS 商品小时报表，与 Report211 订单行不同来源，不可互算 |
| `pos_daily_breakdown` | POS 日维度拆分（支付/就餐/渠道）；订单行无此维度，不可重算但仍是来源汇总 |
| `pos_member_daily_metric` | RES 会员日报原值；比率与可重算净额已视图派生 ✔ |
| `pos_member_balance_snapshot` | 来源状态快照；流水不完整不可反推，属来源观察而非本库事实 |
| `finance_sales_daily` | 财务模板日销售，独立核对来源 |
| `finance_item_sales_monthly` | 财务模板单品月销，独立核对来源 |
| `finance_supplier_purchase_monthly` | 财务模板月采购，独立核对来源 |
| `finance_inventory_flow_line` | 财务模板月进销存 |
| `finance_inventory_snapshot_line` | 财务模板月末库存快照 |
| `finance_monthly_cost_line` | 财务模板月成本费用 |
| `finance_cashflow_line` | 财务模板现金流 |
| `finance_order_logistics_line` | 财务模板历史物流行 |
| `finance_monthly_metric` | **财务模板算好的指标**——来源上报指标，绝非本库指标真源 |

这些表物理字段基本不用删（设计已是"来源原值、缺则空"），变的是语义归属与访问约束：
禁止与订单行重算结果相加；对 AI/BI 只经标明来源口径的认证视图暴露。

### 4.4 决策快照层（5 张，保留但标明非标准事实）

| 表 | 判定 |
|---|---|
| `ops_forecast_run` | 预测曾驱动生产计划（实际行动），保留快照；准确率一律视图派生 ✔ |
| `ops_forecast_line` | 同上；`model_explanation` 为算法输出快照 ✔ |
| `ops_production_plan_version` | 人工调整 + 审批/发布/取消行为，审批动作/人/时间落库 ✔ |
| `ops_production_plan_line` | 人工判断落库；`adjustment_delta` 已视图派生 ✔ |
| `mkt_survey_result` | **收紧，见 §5.3** |

### 4.5 摄取台账（2 张）与平台侧车（19 张）、结构契约（5 张）

- `pos_ingest_batch`、`finance_import_batch`：摄取/导入行为台账，属操作记录，非业务事实，
  从 `CORE_BASE_FACT` 改标 `ingest_ledger`。
- 平台侧车 19 张（`app_*` 账号权限审计会话、`ai_*` 调用流水、`msg_*` 消息通道）：
  `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY`，硬规则不涉及。✔
- 结构契约 5 张（`app_currency`、`finance_accounting_entity`、`finance_currency_assignment`、
  `finance_currency_policy`、`finance_fx_rate_observation`）：R6A1 自定门禁为未批准生产使用，
  维持冻结；`finance_fx_rate_observation` 启用后属来源原值观察，符合规则。

## 5. 需要真实变更的清单

### 5.1 目录与字典（P0，设计层）

1. 表目录新增 `fact_kind`，字段字典新增 `value_role`，按 §3 体系重标全部 105 表 / 全部字段；
2. `pos_sales_day` 等 15 张表 `storage_class` 从 `CORE_BASE_FACT` 改为来源观察类（新枚举），
   5 张决策表保持独立类但加"非标准事实"警示注释；2 张批次表改标 `ingest_ledger`；
3. 表注释按 AGENTS.md 0.5 补齐"与易混淆兄弟表的区别"（如 `pos_sales_day` vs 订单行重算视图）。

### 5.2 指标语义拆分（P0，落实 Codex 审核）

- 废除笼统 `average_order_value`：
  `net_average_order_value`（实收 ÷ 账单数）、`gross_average_order_value`（折前 ÷ 账单数）为
  视图派生；来源上报值只叫 `source_reported_average_order_value`。
- `source_guest_count` 改名注释为"POS 来源顾客计数（口径待确认）"；日级值由小时来源计数相加
  派生，不单独落库（当前设计日表无此列 ✔，需在指标字典固化）。
- 折扣率 = 折扣金额 ÷ 折前金额、预测准确率、成本/毛利等全部指标在版本化指标字典登记粒度、
  公式、折扣前后口径、币种、空值与除零规则，物理零落库。

### 5.3 `mkt_survey_result` 收紧（P1）

新计算行带 `algorithm_version` + `input_sha256`，答案完整且算法版本冻结 → 满足"可计算"四条件，
按硬规则**不应落库**。建议：

- 历史迁入行（`source_system_id` 非空、无答案）保留，标 `source_observation` + 不可复算；
- 新计算行改为视图 `v_mkt_survey_result_current`（答案 × 算法版本现算）；
- 过渡期保留表但加 `result_origin` 区分，并明确 HBTI 应用只读视图、不再直接写结果表。
  若产品上必须保留"用户看到的展示快照"（`result_label`/`result_color`），把它归入
  `msg_`/外发执行记录而不是测评结果表。

### 5.4 `mkt_reward_stock` 重构（P1）

`reserved_quantity` / `redeemed_quantity` / `damaged_quantity` 是可变计数器——本质是
`mkt_reward_claim` 事件流的派生聚合，且"缓存不能成为数据真相"。建议：

- 保留 `allocated_quantity`、`unit_cost_estimate`（人工分配行为，无其他事实可重算）；
- 计数器列物理移除，当前可用/已发由 `mkt_reward_claim` 事件 + 视图派生；
- 并发发放控制从该表乐观锁改为领取事件的唯一约束/受控函数；
- 若保留计数器作为性能缓存，须单独审批并标"缓存非真相"——本版不建议。

### 5.5 `ops_daily_review.review_summary`（P2）

JSON 内含"结论、指标和证据引用"。指标值若只是复盘时刻快照，须标快照语义、不作指标真源；
证据一律用引用（批次/运行 ID），不复制可重算数值。现有 `manager_avg_transaction` 的
"系统计算必须留空 + 来源必填"约定已是正确范式，推广到整个 review_summary schema。

## 6. 缩减效果

| 口径 | 重审前 | 重审后 |
|---|---|---|
| 标准业务事实层表数 | 33 身份 + 33 基础 + 10 工作流 = 76（含混入的来源汇总与决策表） | 33 身份 + 26 事件/行为 = **59** |
| 来源汇总观察层 | 混入 CORE_BASE_FACT，未隔离 | **15 张隔离**，reconciliation_only |
| 决策快照层 | 5 张，仅注释说明 | 5 张，门禁级"非标准事实"标记；其中 1 张内容收紧 |
| 指标物理落库 | 已无（R6A1 字段级已合规） | 维持 0，字典加门禁防回潮 |
| 视图 | 59 逻辑视图、7 个 SELECT 就绪、0 个物理验证 | 数量不变，但 §5.3/§5.4 各新增 1 个认证视图需求 |

## 7. 与既有 P0 审核的衔接

本重审并入 Codex 2026-08-15 审核（会话结论）的 P0 清单，不另起炉灶：

1. 冻结唯一权威版本（解决 1,469/1,470 字段冲突、模型哈希漂移）——先行；
2. R6A1 门禁测试全绿——本文件 §3 的 4 条治理约束应写成新门禁测试；
3. `fact_kind` / `value_role` 落地——即本文 §3；
4. 客单价/顾客数/订单行语义命名——即本文 §5.2；
5. 核心 POS 视图先实现并运行验证，再允许 AI/BI/运营接入——不变；
6. 轮换已暴露的数据库凭据——不变，仍挂起。

## 8. 执行顺序建议

1. 用户确认本重审的分层判定（尤其 §4.2 标准化列边界、§5.3/§5.4 两处收紧）；
2. 修订声明模型与 R6A1 overlay：新增枚举与两列标签、改 22 张表分类、2 张表内容收紧；
3. 重跑生成器与全部门禁测试（含新增治理测试），解决字段计数冲突后冻结版本；
4. 更新 61 页蓝图与字典导出；
5. 视图实现与运行验证（先于任何数据回填）；
6. 全程不直接执行生产 DDL/DML——迁移文件交用户执行。

## 9. 验收标准

- 每张 PHASE1 表有且只有一个 `fact_kind`，每个字段有且只有一个 `value_role`；
- 门禁自动拒绝：`derived_view_only` 值出现在物理字段、来源观察层表被标准事实视图直接 UNION、
  决策快照层未标非标准事实；
- 客单价/折扣率/准确率/成本毛利等指标只存在于视图与指标字典，全库物理字段零命中；
- 105 表分层计数与本文件 §2 一致，任何偏差需修订记录。
