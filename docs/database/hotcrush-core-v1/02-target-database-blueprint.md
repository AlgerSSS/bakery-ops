# 02 R6 完整目标数据库蓝图

先确定最小物理基座，再用视图派生；完整目录与首期实施清单严格分开。

> 状态：**方案 C 评审稿，不是迁移脚本，不授权修改生产数据库。**
> 模型版本：`HOTCRUSH-CORE-V1-REVIEW-R6-2026-08-10`；生产结构快照：`2026-08-09T09:56:05.204Z`；代码静态扫描：`2026-08-09T10:30:31.506548+00:00`。

## 方案 C 的准确含义

方案 C 是**新建一套 HOT CRUSH Core V1 PostgreSQL/Supabase 数据库，在旧库旁边完成回填、影子核对和按项目切换**。它不是在唯一生产库里直接重命名 76 张表。现阶段只产出评审资产，不产生迁移 SQL，也不修改任何上层代码。

**首期物理基座只有 100 张表：81 张业务事实/主数据 + 19 张运行治理侧车。** 完整设计目录共有 137 张潜在物理契约和 59 个只读治理视图，其中另含 33 张按需扩展、4 张来源待验证。视图同样分期：首期 41、扩展 13、来源条件 5。表字段 1812 个、视图字段 643 个、外键 420 个。

**视图准备度边界：** 41 个 Phase1 视图只是设计候选；其中 10 个 PASS_SELECT_SPEC 仅表示 SELECT 规格足够，不表示已经创建或运行验证；当前已创建并验证的 SQL view = 0。

原 R5 的 154/154 通过结论已作废：最小行粒度不等于最小物理表集合。R6 对原 154 个对象逐项处置为 100 张首期、33 张扩展、4 张来源条件、11 张合并、4 张派生和 2 张删除；完整去向见 `r5-to-r6-disposition.csv`。

## 最小颗粒 → 多种派生的全库规则

- **最小不是无限原子化。** 最小颗粒是仍能完整表达一个来源事件、业务决定或状态变化的最低粒度；继续拆分会丢掉同一性或导致无法重建，就必须停在该粒度。
- **基础事实只存一次。** 订单商品、会员卡交易、人工计划决定和财务导入各自保真；会员画像、排行、占比、成本组件/快照、节假日倍率、毛利、人效和预测准确率通过 `v_*` 视图派生。生产、配送、库存与工时只有对应扩展模块启用或来源获证后才建表。
- **没有万能连接字段。** `location_id`、`product_id`、`employment_id`、`material_id`、`member_id`、`order_id` 分别表达不同对象；跨模块沿真实业务关系逐跳连接，来源编号先经 `source_system_id` 和映射表进入企业身份。
- **派生必须可追溯。** 每个结果都能回到来源批次、运行/版本、有效期和质量状态；若无法重建当时决定，才把计算输出冻结为带版本快照表。

## 实施层级、证据成熟度与写入策略

- `CORE_BUSINESS`：首期业务事实、稳定身份、人工决定或发布版本，共 81 张。
- `CORE_PLATFORM`：首期权限、幂等、审计、安全与恢复侧车，共 19 张；不得混入经营指标。
- `EXTENSION_PACK:*`：模块有真实写入者和业务副作用后才实施，共 33 张。
- `SOURCE_CONDITIONAL`：外部来源身份、粒度、权限和重跑契约获证后才实施，共 4 张。

- `CORE_MIGRATION`：承接现有数据/契约或作为无损迁移必需治理底座
- `PLANNED_MODULE`：目标结构已设计，但当前未确认生产写入者；模块获批时才实施
- `SOURCE_CONDITIONAL`：只有外部来源身份、权限、粒度和重跑稳定性被验证后才实施

- `APPEND_ONLY`：写入后不可修改；更正追加新事实或冲销事件
- `APPEND_ONLY_DECISION_RECORD`：人工/系统决策只追加，原决定和差异永久可追溯
- `CONTROLLED_UPDATE`：主数据允许受权限、审计和并发控制的更新
- `CONTROLLED_UPDATE_UNTIL_TERMINAL`：运行或同步进入终态前可更新，终态后冻结并以新运行重算
- `CONTROLLED_WORKFLOW`：只允许批准的状态机迁移并记录操作者和时间
- `CONTROLLED_QUEUE_STATE`：只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生
- `DRAFT_MUTABLE_THEN_FROZEN`：草稿可编辑；发布、发送或生效后冻结并新建版本
- `SOURCE_STATE_UNTIL_TERMINAL`：忠实跟随来源系统的业务状态至终态，终态后不擅自改写

## 视图实施层级与准备度

| 视图 | 实施层级 | 准备度 | 粒度键 | 阻断码 |
|---|---|---|---|---|
| `v_identity_mapping_gap` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `UNDEFINED` | `UNDEFINED_GRAIN_KEY | AFFECTED_FACT_UNIVERSE_UNDEFINED | GAP_REASON_RULE_UNDEFINED` |
| `v_product_identity` | `PHASE1` | `FIX_MODEL_CONTRACT` | `listing_id` | `MAPPING_AS_OF_SEMANTICS_UNRESOLVED` |
| `v_pos_sales_day_current` | `PHASE1` | `PASS_SELECT_SPEC` | `location_id + business_date` | `NONE` |
| `v_pos_sales_hour_current` | `PHASE1` | `PASS_SELECT_SPEC` | `location_id + business_date + hour_started_at` | `NONE` |
| `v_pos_item_sales_hour_current` | `PHASE1` | `PASS_SELECT_SPEC` | `location_id + business_date + hour_started_at + listing_id` | `NONE` |
| `v_pos_daily_breakdown_current` | `PHASE1` | `PASS_SELECT_SPEC` | `location_id + business_date + dimension_type + dimension_value` | `NONE` |
| `v_pos_item_sales_day` | `PHASE1` | `PASS_SELECT_SPEC` | `location_id + business_date + listing_id` | `NONE` |
| `v_pos_revenue_reconciliation` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + business_date` | `RECONCILIATION_THRESHOLD_UNDEFINED | MISSING_SIDE_STATUS_PRECEDENCE_UNDEFINED` |
| `v_pos_member_state_current` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `member_id` | `MEMBER_PROFILE_BATCH_COVERAGE_UNPROVEN | STALE_THRESHOLD_UNDEFINED` |
| `v_pos_member_daily_metric_current` | `PHASE1` | `PASS_SELECT_SPEC` | `location_id + business_date` | `NONE` |
| `v_pos_member_daily_summary` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + business_date` | `CARD_PAYMENT_BREAKDOWN_MAPPING_UNDEFINED | STORED_VALUE_FORMULA_UNDEFINED | PARTIAL_STATUS_RULE_UNDEFINED` |
| `v_pos_order_item_current` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + business_date + order_id + listing_id` | `FULL_ORDER_ITEM_SOURCE_NOT_PROVEN | COVERAGE_PRIORITY_SELECTION_REQUIRES_SOURCE_EVIDENCE` |
| `v_pos_order_member_attribution` | `PHASE1` | `PASS_SELECT_SPEC` | `order_id` | `NONE` |
| `v_pos_member_order_item` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + business_date + order_id + listing_id` | `MAPPING_OCCURRENCE_TIMESTAMP_MISSING` |
| `v_ops_forecast_accuracy` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `forecast_run_id + product_id` | `ERROR_RATE_DENOMINATOR_UNDEFINED | FORECAST_ACTUAL_MATCH_RULE_UNDEFINED` |
| `v_ops_item_daily_pulse` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `location_id + business_date + product_id` | `EXTENSION_PACK_NOT_ACTIVATED:PRODUCTION_EXECUTION` |
| `v_ops_plan_vs_production` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `location_id + business_date + product_id` | `EXTENSION_PACK_NOT_ACTIVATED:PRODUCTION_EXECUTION` |
| `v_ops_production_vs_dispatch` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `from_location_id + to_location_id + business_date + product_id` | `EXTENSION_PACK_NOT_ACTIVATED:PRODUCTION_EXECUTION` |
| `v_ops_product_mix_daily` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + business_date + product_id` | `SHARE_DENOMINATOR_UNDEFINED | PRIOR_PERIOD_SELECTION_UNDEFINED` |
| `v_hr_application_current_stage` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `application_id` | `STAGE_SEQUENCE_VALIDATION_UNDEFINED | STAGE_QUALITY_STATUS_PRECEDENCE_UNDEFINED` |
| `v_hr_assessment_summary` | `PHASE1` | `FIX_MODEL_CONTRACT` | `assessment_id` | `ASSESSMENT_QUALITY_STATUS_PRECEDENCE_UNDEFINED` |
| `v_hr_role_eligibility` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `employment_id + role_id` | `EXTENSION_PACK_NOT_ACTIVATED:TRAINING_AND_ONBOARDING` |
| `v_ops_shift_publish_readiness` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `shift_plan_version_id` | `EXTENSION_PACK_NOT_ACTIVATED:SHIFT_AND_WORKFORCE | EXTENSION_PACK_NOT_ACTIVATED:TRAINING_AND_ONBOARDING` |
| `v_hr_timesheet_entry_current` | `SOURCE_CONDITIONAL` | `DEFER_SOURCE` | `source_system_id + source_entry_id` | `SOURCE_CONTRACT_NOT_VERIFIED:HR_TIMESHEET_ENTRY` |
| `v_ops_labor_productivity` | `SOURCE_CONDITIONAL` | `DEFER_SOURCE` | `location_id + business_date` | `SOURCE_CONTRACT_NOT_VERIFIED:HR_TIMESHEET_ENTRY | EXTENSION_PACK_NOT_ACTIVATED:SHIFT_AND_WORKFORCE` |
| `v_scm_material_requirement_line` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `material_requirement_key` | `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY` |
| `v_scm_material_requirement_trace` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `material_requirement_component_id` | `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY` |
| `v_scm_material_requirement_reconciliation` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `material_requirement_key + replenishment_line_id` | `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY` |
| `v_scm_replenishment_trace` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `replenishment_line_id` | `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY` |
| `v_scm_inventory_balance` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `location_id + material_id + lot_code + expiry_date` | `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY` |
| `v_scm_purchase_order_reconciliation` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `purchase_order_revision_id` | `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY` |
| `v_scm_supplier_item_current_mapping` | `PHASE1` | `FIX_MODEL_CONTRACT` | `supplier_id + supplier_sku` | `AS_OF_SEMANTICS_UNRESOLVED` |
| `v_scm_supplier_price_current` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `supplier_item_id` | `AS_OF_SEMANTICS_UNRESOLVED | NORMALIZED_PRICE_FORMULA_INPUTS_INCOMPLETE` |
| `v_cost_card_recipe_current` | `PHASE1` | `FIX_MODEL_CONTRACT` | `output_product_id + output_material_id` | `AS_OF_SEMANTICS_UNRESOLVED` |
| `v_cost_card_product_cost_component` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + business_date + product_id + recipe_version_id + path_component_ids + material_id` | `BLOCKED_RECIPE_EXPANSION_DEPENDENCY | PRODUCT_DATE_UNIVERSE_UNDEFINED | COST_COMPONENT_FORMULA_UNDEFINED | LOCATION_PRICE_FALLBACK_RULE_UNDEFINED` |
| `v_cost_card_product_cost_snapshot` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + business_date + product_id` | `BLOCKED_COST_COMPONENT_DEPENDENCY | COST_SCOPE_RULE_UNDEFINED | QUALITY_STATUS_PRECEDENCE_UNDEFINED` |
| `v_cost_card_product_cost_quality` | `PHASE1` | `FIX_MODEL_CONTRACT` | `location_id + business_date + product_id` | `QUALITY_PROJECTION_SOURCE_CONTRACT_UNVERIFIED` |
| `v_cost_card_product_daily_margin` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + business_date + product_id` | `BLOCKED_COST_SNAPSHOT_DEPENDENCY | MARGIN_QUALITY_RULE_UNDEFINED` |
| `v_finance_sales_reconciliation` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + business_date` | `RECONCILIATION_THRESHOLD_UNDEFINED | CURRENCY_MATCH_RULE_UNDEFINED | RECONCILIATION_STATUS_PRECEDENCE_UNDEFINED` |
| `v_finance_purchase_reconciliation` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `location_id + business_month + supplier_id + material_id` | `EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY` |
| `v_finance_labor_reconciliation` | `SOURCE_CONDITIONAL` | `DEFER_SOURCE` | `location_id + business_month` | `SOURCE_CONTRACT_NOT_VERIFIED:HR_TIMESHEET_ENTRY` |
| `v_finance_margin_reconciliation` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + business_month` | `BLOCKED_DAILY_MARGIN_DEPENDENCY | FINANCE_MARGIN_SOURCE_MAPPING_UNDEFINED | RECONCILIATION_THRESHOLD_UNDEFINED` |
| `v_mkt_campaign_performance` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `campaign_version_id + location_id` | `CAMPAIGN_LOCATION_ATTRIBUTION_UNDEFINED | RATE_DENOMINATOR_UNDEFINED | CAMPAIGN_QUALITY_STATUS_RULE_UNDEFINED` |
| `v_mkt_reward_stock_reconciliation` | `PHASE1` | `PASS_SELECT_SPEC` | `campaign_version_id + location_id + reward_id` | `NONE` |
| `v_msg_delivery_current` | `EXTENSION_PACK` | `DEFER_EXTENSION` | `outbound_message_id` | `EXTENSION_PACK_NOT_ACTIVATED:CHANNEL_RECEIPTS` |
| `v_app_data_quality_summary` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `source_view_name + domain_code + rule_code + severity + quality_status` | `BLOCKED_QUALITY_VIEW_DEPENDENCY | QUALITY_RULE_MAPPING_UNDEFINED | SEVERITY_MAPPING_UNDEFINED` |
| `v_business_timeline` | `SOURCE_CONDITIONAL` | `DEFER_SOURCE` | `event_domain + event_type + event_id` | `SOURCE_CONTRACT_NOT_VERIFIED:HR_TIMESHEET_ENTRY | EXTENSION_PACK_NOT_ACTIVATED:PROCUREMENT_AND_INVENTORY | EXTENSION_PACK_NOT_ACTIVATED:PRODUCTION_EXECUTION | EXTENSION_PACK_NOT_ACTIVATED:SHIFT_AND_WORKFORCE` |
| `v_ops_timeslot_sales_baseline` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + product_id + day_type + slot_start + slot_end` | `DAY_TYPE_RULE_UNDEFINED | TIMESLOT_BOUNDARY_RULE_UNDEFINED | BASELINE_WINDOW_RULE_UNDEFINED | MINIMUM_SAMPLE_RULE_UNDEFINED` |
| `v_cost_card_daily_margin` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `location_id + business_date` | `BLOCKED_PRODUCT_MARGIN_DEPENDENCY | COVERAGE_STATUS_THRESHOLD_UNDEFINED` |
| `v_ops_holiday_factor` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `calendar_event_id + location_id + product_id + category_code` | `LOCATION_EVENT_APPLICABILITY_UNDEFINED | BASELINE_WINDOW_RULE_UNDEFINED | MINIMUM_SAMPLE_RULE_UNDEFINED | FACTOR_FALLBACK_RULE_UNDEFINED` |
| `v_pos_item_waste_current` | `PHASE1` | `PASS_SELECT_SPEC` | `waste_id` | `NONE` |
| `v_pos_item_waste_mapped` | `PHASE1` | `PASS_SELECT_SPEC` | `waste_id` | `NONE` |
| `v_ops_manager_sales_reconciliation` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `daily_review_id` | `RECONCILIATION_THRESHOLD_UNDEFINED | RECONCILIATION_STATUS_PRECEDENCE_UNDEFINED` |
| `v_ops_shift_by_role` | `SOURCE_CONDITIONAL` | `DEFER_SOURCE` | `location_id + business_date + role_id` | `SOURCE_CONTRACT_NOT_VERIFIED:HR_TIMESHEET_ENTRY | EXTENSION_PACK_NOT_ACTIVATED:SHIFT_AND_WORKFORCE` |
| `v_cost_card_material_price_current` | `PHASE1` | `FIX_MODEL_CONTRACT` | `location_id + material_id` | `AS_OF_SEMANTICS_UNRESOLVED` |
| `v_cost_card_recipe_expanded` | `PHASE1` | `BLOCK_MISSING_FACT_OR_RULE` | `root_recipe_version_id + path_component_ids + material_id` | `RECIPE_RECURSION_RULE_UNDEFINED | UNIT_CONVERSION_PATH_RULE_UNDEFINED` |
| `v_ops_daily_review_current` | `PHASE1` | `FIX_MODEL_CONTRACT` | `location_id + business_date` | `NULL_APPROVAL_TIMESTAMP_SELECTION_UNDEFINED | APPROVED_VERSION_CONFLICT_OUTPUT_MISSING` |
| `v_finance_import_batch_current` | `PHASE1` | `FIX_MODEL_CONTRACT` | `source_system_id + dataset_code + scope_location_id + period_start + period_end + source_layer` | `NULL_APPROVAL_TIMESTAMP_SELECTION_UNDEFINED` |
| `v_finance_target_current` | `PHASE1` | `FIX_MODEL_CONTRACT` | `location_id + business_month + metric_code` | `NULL_APPROVAL_TIMESTAMP_SELECTION_UNDEFINED | ACTIVE_VERSION_CONFLICT_OUTPUT_MISSING` |

## 第一性原则门禁

1. 单企业模型：不引入 tenant_id；所有多地点事实必须显式带 location_id。
2. 一行一种粒度：每张表必须声明一行代表什么；订单身份、订单商品、支付、退款、会员归属和聚合指标不得混成一行。
3. 基础事实优先：能从稳定基础事实重算的排行、画像、占比、比率、差值和文案放在只读视图/查询；只有来源原值、稳定身份、人工决定、业务副作用、并发事务状态或需复现的冻结运行结果才存表。
4. 连接图完整：除迁移台账和不可逆限流桶这两个明确技术/隐私例外外，每张业务表必须通过强外键进入统一身份图；不能用多态文本ID逃避外键。
5. 来源优先：先存 POS listing、外部员工号、供应商商品号，再经受控映射连接统一身份。
6. 名称不是连接键：名称只用于展示、搜索或提出候选，不能自动成为跨域事实关系。
7. 空值语义显式化：含可空列的唯一约束必须声明 NULLS DISTINCT 或 NULLS NOT DISTINCT，不能依赖默认行为。
8. 有效期不可重叠：正式身份映射、授权、规则、课程、配方、单位换算与采用价统一使用左闭右开区间并由排斥约束防重叠。
9. 计划与事实分离：预测、批准计划、生产、配送、销售、工时、财务导入分别保真。
10. 版本不可变：配方、计划、班表、Prompt、规则和目标发布后不原地重写。
11. 时间语义明确：created_at 是入库时间，business_date 是营业日，effective period 是生效区间。
12. 单位和币种不可省略：数量必须有基准单位或换算证据，金额必须有币种。
13. 数据质量不填假值：映射缺失、来源部分失败或覆盖不足必须保留 NULL 和质量状态。
14. 隐私最小化：手机号、联系方式、认证令牌和自由文本分表、加密/哈希、最小权限、限定保留期。
15. 派生结果只读：跨域分析通过 v_* 视图输出，任何项目不得向视图写业务事实。
16. 生命周期分层：CORE_MIGRATION 承接现状；PLANNED_MODULE 不因画进蓝图就视为已具备；SOURCE_CONDITIONAL 必须先证明外部来源能力。

## 统一连接脊柱

| 连接键 | 权威来源 | 作用 |
|---|---|---|
| `location_id` | `ops_location.location_id` | 门店、厨房、仓库、办公室或混合地点的统一身份 |
| `product_id` | `ops_product.product_id` | 企业层产品身份；POS listing 需经有效映射才能连接 |
| `person_id` | `hr_person.person_id` | 自然人身份；不代表某段雇佣或系统账号 |
| `employment_id` | `hr_employment.employment_id` | 一段雇佣关系；班表、培训和工时的人员键 |
| `material_id` | `scm_material.material_id` | 统一原料、包材、半成品或耗材身份 |
| `supplier_item_id` | `scm_supplier_item.supplier_item_id` | 供应商SKU、统一物料与包装换算在特定有效期内的版本身份 |
| `business_date` | `各事实的 business_date` | 以地点营业日口径连接，而不是从 created_at 截日期 |
| `source_system_id` | `app_source_system.source_system_id` | 来源系统责任和外部标识命名空间 |
| `batch/run/version` | `各域批次、运行和版本 ID` | 说明哪次采集、计算或批准产生该行 |
| `effective period` | `valid_from / valid_to 或 effective_from / effective_to` | 按发生时点选择身份映射、配方、价格或规则 |

## 业务域与写入边界

| 前缀 | 板块 | 表数 | 视图数 | 主要写入责任 |
|---|---|---:|---:|---|
| `app_` | 治理、权限与质量 | 14 | 3 | 受控迁移执行器；平台管理员；数据治理管理员；任务调度平台；数据库受控审计函数；身份管理服务；令牌服务；API 网关或限流服务 |
| `ops_` | 地点、产品、预测、计划、执行与班表 | 28 | 12 | BakeryOps 主数据管理；BakeryOps 主数据审核；BakeryOps 产品主数据管理；BakeryOps 断货检测；人工可确认；BakeryOps 日历任务；门店或区域运营；BakeryOps 预测任务；BakeryOps；审批人改变状态；BakeryOps；BakeryOps 工作量任务；门店/厨房执行流程；配送执行流程；BakeryOps 复盘流程；BakeryOps 设置流程；BakeryOps 运营主数据；运营与HR共同维护；BakeryOps 排班流程 |
| `pos_` | POS目录、销售与会员 | 19 | 15 | RES/POS 同步服务；产品身份审核流程；RES/POS 同步服务的受限写入路径 |
| `hr_` | 人员、招聘、培训与工时 | 21 | 4 | HR 主数据流程；HR 身份审核；HR 招聘流程；HR 招聘流程或渠道同步；HR或业务面试官；HR 入职流程；HR 人事流程；HR规则审核流程；HR培训管理；HR或门店培训负责人；培训系统或负责人；BakeryOps 工时同步任务 |
| `scm_` | 原料、库存、补货、采购与收货 | 20 | 8 | 供应链主数据流程；供应链主数据审核；仓库或门店库存流程；供应链库存服务；BakeryOps供应链任务；BakeryOps计算；采购人员批准；采购流程；审批人改变状态；采购流程；仓库或门店收货流程；采购或收货流程 |
| `cost_` | 配方、采购价、成本快照与毛利 | 3 | 8 | 财务成本卡网站 |
| `finance_` | 财务来源事实与核对 | 12 | 6 | 财务网站 |
| `mkt_` | 营销、HBTI问卷与奖励 | 10 | 2 | 营销/HBTI后台；HBTI应用；HBTI结果计算服务；营销后台；HBTI/营销库存服务 |
| `msg_` | 消息、会话与投递 | 6 | 1 | BakeryOps消息服务；BakeryOps编排器；BakeryOps消息worker；BakeryOps消息回执服务 |
| `ai_` | Prompt版本与AI调用 | 4 | 0 | BakeryOps AI配置；BakeryOps AI服务 |

## 四个项目的责任边界

### BakeryOps

- 目标写入：已启用的 ops_*、hr_*、scm_*、msg_*、ai_*；app_job_run。质量结论由只读核对视图派生，不写跨域多态质量表。
- 目标读取：全部受治理视图及本项目负责的业务表
- 边界：不得直接写 finance_*、cost_card_*、pos_* 的来源事实。人工运营动作写 ops_*，不要覆盖 POS 或财务来源事实。

### RES/POS 抓取与同步

- 目标写入：pos_ingest_batch、pos_product_listing、pos_sales_*、pos_item_*、pos_member_*
- 目标读取：app_source_system、地点来源映射、数据质量结果
- 边界：只忠实记录来源，不自行创造 product_id；企业产品映射必须走 pos_product_mapping 的确认流程。

### 财务网站

- 目标写入：finance_*、cost_card_*、app_user / app_role / app_audit_event
- 目标读取：POS、供应链、人员工时及成本治理视图
- 边界：财务导入事实不得反写覆盖 POS；成本卡采用价与供应商原始报价分开；所有地点和产品使用稳定 ID。

### HBTI 活动网站

- 目标写入：mkt_campaign_*、mkt_survey_*、mkt_reward_*；受控一次性令牌
- 目标读取：最小化会员身份、活动配置和奖励库存
- 边界：不得再把活动当前状态写回 pos_member；不得复制会员手机号到营销事实表。

## 15 条端到端关系

### 01 POS 抓取到三层销售核对

**要回答的问题：** 同一天的日销售、小时销售和商品销售是否完整且一致？

**链路：** `app_source_system` → `pos_ingest_batch` → `pos_sales_day` → `pos_sales_hour` → `pos_item_sales_hour` → `v_pos_revenue_reconciliation`

**连接规则：**

- app_source_system.source_system_id = pos_ingest_batch.source_system_id
- 三类事实均通过 pos_ingest_batch_id 追溯同一抓取批次
- 按 location_id + business_date 对账；NULL 与 0 不混用

**门禁：** 批次状态不是 SUCCEEDED 或核对超阈值时，不允许作为最终经营事实静默下游消费。

### 02 POS 商品到企业产品身份

**要回答的问题：** 来源商品如何连接预测、排产、成本和销售，而不依赖名称？

**链路：** `pos_product_listing` → `pos_product_mapping` → `ops_product` → `v_product_identity` → `v_pos_item_sales_day`

**连接规则：**

- 销售事实永远先连 listing_id
- listing_id 在销售发生时点落入 mapping 的 [valid_from, valid_to)
- 只有 status = CONFIRMED 的映射提供 product_id

**门禁：** 无法确认时保留 listing 和销售金额，product_id 为空并进入审核；禁止按名称猜填。

### 03 节假日与需求因子到预测准确率

**要回答的问题：** 节假日、天气或事件如何影响预测，之后如何验证影响是否真实？

**链路：** `app_job_run` → `ops_calendar_event` → `v_pos_item_sales_day` → `v_ops_holiday_factor` → `ops_forecast_run` → `ops_forecast_line` → `v_ops_forecast_accuracy`

**连接规则：**

- event 通过 job_run_id 保留 API 抓取运行和输入清单证据
- factor 由 event、location_id、可选 product_id/category_code 和历史销售窗口即时计算，并输出 algorithm_version、窗口、样本量和质量
- forecast_line 与实际销售按 location_id + business_date + product_id 连接

**门禁：** API 日历事实需要保存；可由日历、历史销售和版本化规则重算的因子不再落表。低样本或兜底因子必须显式标记。

### 04 突发情况到明日调整动作

**要回答的问题：** 当日突发事件为何导致明日某产品计划增减，谁批准了？

**链路：** `ops_operational_event` → `ops_operational_event_product` → `ops_production_plan_version` → `ops_production_plan_line` → `ops_review_action` → `app_audit_event`

**连接规则：**

- 事件通过 location_id + 时间范围定位影响地点
- 受影响产品使用 product_id；新计划行通过 based_on_plan_line_id 指向调整前行，并保存 reason、AI建议和人工确认主体
- review_action 和 audit_event 保留提出、批准、执行主体

**门禁：** 调整必须形成新计划版本；delta 由新旧计划行派生，不再为同一调整另建一张物理表，也不覆盖原预测。

### 05 预测到排产工作量与班表需求

**要回答的问题：** 明日预计销量怎样变成分时生产量、工作分钟和关键岗位人数？

**链路：** `ops_forecast_run` → `ops_production_plan_version` → `ops_production_plan_line` → `ops_production_plan_slot` → `ops_workload_run` → `ops_workload_line` → `ops_shift_requirement`

**连接规则：**

- 计划版本记录 forecast_run_id，但允许人工计划独立存在
- 计划行和分时槽均使用 product_id；workload_line 回指 plan_line_id
- shift_requirement 通过 workload_run_id + role_id + station_id 说明关键岗位需求

**门禁：** 预测、批准计划、工作量计算和排班需求是四种不同事实，不能压在一张表的一行里。

### 06 排产到原料毛需求

**要回答的问题：** 计划生产多少产品，为什么需要订多少某种原料？

**链路：** `ops_production_plan_line` → `cost_card_recipe_version` → `cost_card_recipe_component` → `scm_material_requirement_run` → `scm_material_requirement_component` → `v_scm_material_requirement_line`

**连接规则：**

- plan_line 选择发生日有效且已批准的 recipe_version_id
- 每个配方组件用 material_id + input_quantity + input_unit_id + 已冻结单位换算展开；base_unit_quantity 由此派生
- requirement_component 同时保留 run_id、plan_line_id、recipe_component_id、material_id 和质量状态；按 run_id + material_id 派生汇总需求

**门禁：** 必须能从一克原料需求反查到哪张计划、哪个产品和哪个配方版本；单位不明则阻断。

### 07 原料需求到建议订货、采购单和收货

**要回答的问题：** 未来订货量为何增减，最终批准、下单和收到多少？

**链路：** `v_scm_material_requirement_line` → `scm_replenishment_run` → `scm_replenishment_line` → `scm_supplier_item` → `scm_purchase_order_revision` → `scm_purchase_order_line` → `scm_goods_receipt_line` → `scm_inventory_movement_line`

**连接规则：**

- 补货建议以 material_id + destination_location_id + need_by_date 连接需求
- 建议量和批准量分字段保留；差异量由视图计算，调整原因保留为人工决定事实
- 正式补货和PO锁定有效期供应商商品版本 supplier_item_id，避免供应商改包装后重解释历史
- PO 行通过 replenishment_line_id 追建议；收货行通过 purchase_order_line_id 追订单

**门禁：** 在途、现存、安全量、MOQ 和订货倍数均为计算输入；人工改量必须写理由，不能覆盖 suggested_quantity。

### 08 收货实价到成本采用价

**要回答的问题：** 市场采购价波动如何进入配方成本，采用了哪一个价格？

**链路：** `app_unit` → `scm_material_unit_conversion` → `scm_supplier_item` → `scm_goods_receipt_line` → `scm_supplier_price_observation` → `cost_card_material_price` → `v_cost_card_product_cost_component` → `v_cost_card_product_cost_snapshot`

**连接规则：**

- 收货行提供 actual_unit_price 和单位证据
- 供应商商品版本自身保留 supplier_id + supplier_sku + material_id + 包装换算 + 有效期；价格观察锁定该 supplier_item_id
- material_price 只引用经批准 observation_id；成本组件视图按营业日选择 recipe_version_id 和 material_price_id
- 收货模块启用前，现有 cost_card_item_price 以 MIGRATED_MANUAL 启动价迁移并保留旧 price_id 与核验证据

**门禁：** 市场报价、实际收货价和成本采用价是三层事实；没有单位换算证据的价格不得进入正式成本。

### 09 当日产品毛利与覆盖率

**要回答的问题：** 今天每个产品赚了多少，结论覆盖了多少销售？

**链路：** `v_pos_item_sales_day` → `v_cost_card_product_cost_snapshot` → `v_cost_card_product_daily_margin` → `v_cost_card_daily_margin` → `v_app_data_quality_summary`

**连接规则：**

- 按 location_id + business_date + product_id 连接销售和目标日成本快照
- 数量 × unit_total_cost 得到估算成本，净销售减估算成本得到毛利
- 缺产品映射、缺配方或缺价格的销售额进入 coverage 缺口
- POS更正批次或配方、价格、规则变化都会改变修订键；毛利输出同时保留pos_ingest_batch_id、cost_revision_key和margin_revision_key

**门禁：** 毛利率必须与成本范围、总销售覆盖率和可信成本覆盖率一起展示；没有批准间接成本规则时只能称材料贡献毛利。质量问题工作流是可选扩展，不影响视图暴露质量状态。

### 10 计划到生产、配送、销售与复盘

**要回答的问题：** 计划是否生产、配送并卖出，报废或断货发生在哪里？

**链路：** `ops_production_plan_line` → `ops_production_run_line` → `ops_dispatch_line` → `v_pos_item_sales_day` → `v_pos_item_waste_mapped` → `ops_stockout_event` → `v_ops_item_daily_pulse` → `ops_daily_review`

**连接规则：**

- 全部产品事实用 product_id，来源 POS 仍保留 listing_id
- 生产回指 plan_line_id，配送回指 production_run_line_id
- 按 location_id + business_date + product_id 汇总 planned/produced/dispatched/sold/waste/stockout

**门禁：** 各事实不可互相推定：生产完成不等于已配送，配送不等于已售，零销量不自动等于断货。

### 11 招聘需求到正式雇佣

**要回答的问题：** 一个招聘需求如何经过申请、评估、试工、Offer 变成员工？

**链路：** `hr_job_requisition` → `hr_person` → `hr_application` → `hr_application_stage_event` → `v_hr_application_current_stage` → `hr_appointment` → `hr_assessment` → `v_hr_assessment_summary` → `hr_offer` → `hr_employment` → `hr_employment_source_identity` → `hr_employment_mapping_review`

**连接规则：**

- application 用 person_id + requisition_id 连接人和岗位需求
- 阶段变化只追加 hr_application_stage_event；当前阶段由视图派生，不覆盖申请主档
- 预约和试工执行共用 appointment；评估和 offer 回指 application_id，评估总分由逐项评分派生
- 录用后 hr_employment.origin_application_id = hr_application.application_id，单向追溯来源申请
- Lark/工资表外部员工ID必须先进入 source_identity；重名、再入职或多候选进入 mapping_review

**门禁：** person 是自然人，employment 是一段雇佣关系，app_user 是系统账号；三者不得混为一个 ID。

### 12 培训资格到关键岗位班表与实际工时

**要回答的问题：** 关键岗位是否安排了具备有效培训资格的人，实际上班多久？

**链路：** `ops_role_training_requirement` → `hr_training_assignment` → `hr_training_result` → `ops_shift_requirement` → `ops_shift_assignment` → `hr_timesheet_entry` → `v_hr_timesheet_entry_current` → `v_ops_shift_publish_readiness` → `v_ops_labor_productivity`

**连接规则：**

- 岗位要求使用 role_id + course_version_id + 有效期
- 班表使用 employment_id + role_id + station_id，关键岗不得只写自由文本
- 原始工时先按 source_system_id + source_entry_id 由 v_hr_timesheet_entry_current 选出当前有效版本，再通过 employment_id + location_id + 时间重叠与班表核对

**门禁：** 计划工时和实际工时分开；过期、失败或缺失培训结果时关键岗指派必须形成明确告警。

### 13 会员关联商品到 HBTI 问卷和奖励

**要回答的问题：** 会员账号关联过哪些订单商品、口径是否唯一，又参加哪一版活动并获得什么奖励？

**链路：** `pos_member` → `pos_member_card_transaction` → `pos_order` → `pos_order_item` → `v_pos_order_member_attribution` → `v_pos_member_order_item` → `mkt_campaign_version` → `mkt_campaign_member` → `mkt_survey_response` → `mkt_survey_result` → `mkt_reward_claim` → `mkt_reward_stock` → `v_mkt_reward_stock_reconciliation`

**连接规则：**

- 订单商品使用 batch_id + order_id + listing_id；同批重复来源行 SUM 并保留 source_row_count，不做 DISTINCT
- 会员卡流水通过 source_system_id + location_id + source_order_id 解析 order_id；恰好一个不同 member_id 才标 UNIQUE
- v_pos_member_order_item 只做派生连接，保留 AMBIGUOUS/UNMATCHED、产品映射状态和 MEMBER_FLAGGED_ONLY 覆盖口径
- campaign_member 使用 member_id + campaign_version_id
- survey_result 使用 survey_response_id + result_type + algorithm_version，现有 hbti_code 迁 result_code；campaign_version 明确钉住正式算法版本
- reward_claim 以 reward_id 记录直接奖励身份；有库存支撑时通过 (reward_stock_id,reward_id) 复合外键锁定同一奖励库存并原子更新 reward_stock，外部无库存履约则以 source_system_id + source_fulfillment_id 保真且不碰库存；核对视图只聚合 reward_stock_id 非空的 claim 并独立复算缓存计数

**门禁：** POS 会员主档不保存商品偏好或某次活动当前结果；个性化文案只能说账号关联订单中记录了什么，不能把共享卡、团购或多人订单推断成本人亲自消费。

### 14 财务导入到独立核对口径

**要回答的问题：** 财务模板与 POS、采购和工时不一致时，如何保留双方事实并查出差异？

**链路：** `finance_import_batch` → `finance_sales_daily` → `finance_monthly_cost_line` → `finance_monthly_metric` → `finance_target` → `v_finance_sales_reconciliation` → `v_finance_margin_reconciliation`

**连接规则：**

- 所有财务事实先回指 import_batch_id，并使用 location_id + 日期/月 + currency
- import_batch 明确 source_layer、recognition_status 与 supersedes；raw、management report 和 posted ledger 分层读取
- 与 POS、供应链、工时只在治理视图核对，不覆盖来源表
- target 是版本化目标；metric 保留来源口径代码

**门禁：** 差异是一条需要解释的事实，不以最后写入者为准；来源缺失不得补 0。

### 15 消息、AI 建议、动作和审计闭环

**要回答的问题：** 一条自动或人工建议如何触发消息，是否送达，是否产生业务动作？

**链路：** `ai_prompt_template` → `ai_call` → `msg_outbound_message` → `msg_delivery_attempt` → `msg_delivery_event` → `v_msg_delivery_current` → `ops_review_action` → `app_job_run` → `app_audit_event`

**连接规则：**

- ai_prompt_template 每行就是一个不可变版本；ai_call 锁定具体 prompt_template_id 和调用业务对象
- outbound_message 对 job_run、review_action、ai_call、appointment 和 campaign_member 使用明确外键；扩展文本来源不进入关键分析
- delivery_attempt 回指 outbound_message；渠道回执只追加到 delivery_event，v_msg_delivery_current 按事件顺序计算当前送达状态
- 执行动作由 review_action 和 audit_event 证明；消息已读不等于业务动作已完成

**门禁：** AI 输出、消息送达和业务执行是三件事；没有执行事实时不能把“已发送”解释为“已完成”。

## 为什么这比旧图更适合扩展

- 新门店、厨房或仓库只新增 `ops_location` 和来源映射，不复制一套业务表。
- 新 POS、Lark、供应商或节假日 API 先注册 `app_source_system`，再加来源身份映射，不污染稳定业务 ID。
- 新功能优先复用稳定身份、批次、版本和只读治理视图；只有出现新的业务事实粒度时才新增表。
- 分析可以从任何事实回到来源批次、版本和有效期，结论不依赖“最后谁覆盖了那一行”。
- 普通唯一约束的空值语义和有效期是否可重叠已进入机器校验；迁移实现应分别使用 PostgreSQL `UNIQUE NULLS NOT DISTINCT` 与 `EXCLUDE USING gist`（必要时启用 `btree_gist`）。

## 当前仍不能批准实施的项目

- 逐人、逐门店、逐产品和逐原料的身份映射样本尚未完成业务确认。
- 所有金额/数量字段与四个项目的请求响应契约尚未做运行时测试。
- 生产权限角色、密钥、保留期和切换时段尚未批准。
- 因此本蓝图可以进入业务评审，但还不能作为执行授权。
