# 08 R6 最小物理基座与派生性终审

同时检查行粒度与整表是否必须物理存在；R5 的 154/154 通过结论在本版明确作废。

> 状态：**方案 C 评审稿，不是迁移脚本，不授权修改生产数据库。**
> 模型版本：`HOTCRUSH-CORE-V1-REVIEW-R6-2026-08-10`；生产结构快照：`2026-08-09T09:56:05.204Z`；代码静态扫描：`2026-08-09T10:30:31.506548+00:00`。

## 结论

**R5 的错误不是某几个字段，而是验收标准错了：它只检查‘一行是否原子’，没有检查‘整张表能否由更基础事实推导’。因此 154/154 通过不代表最小物理基座。**

R6 对原 154 个对象逐一重新处置：首期只实施 **100 张物理表**，其中 **81 张业务事实/主数据**、**19 张运行治理侧车**；另有 **33 张按模块启用的扩展契约**、**4 张来源获证后才实施的条件契约**。原方案中 **11 张并入同粒度表、4 张改为只读派生视图、2 张删除**。完整目录因此是 137 张潜在物理契约，不等于首期建表数。

只读派生层设计目录共有 **59 个视图契约**：Phase1 设计候选 **41**、扩展包候选 **13**、来源条件候选 **5**。41 个 Phase1 视图只是设计候选；其中 10 个 PASS_SELECT_SPEC 仅表示 SELECT 规格足够，不表示已经创建或运行验证；当前已创建并验证的 SQL view = 0。 成本组件、产品成本和节假日因子不再作为物理事实重复落库；未满足准备度与实施门禁的视图不得创建。

### 视图实施层级与准备度不是同一件事

- 实施层级回答依赖哪些表、属于 Phase1/扩展/来源条件中的哪一层；准备度回答是否已具备明确的 SELECT 规格。
- `PASS_SELECT_SPEC` 只表示设计资料足以编写 SELECT；`FIX_MODEL_CONTRACT` 与 `BLOCK_MISSING_FACT_OR_RULE` 仍需修合同或补事实/规则；`DEFER_*` 不属于当前实施范围。
- 当前未生成任何视图 SQL，也未在 PostgreSQL/Supabase 创建或运行验证任何目标视图。

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

## 前提检查

1. **最小行粒度与最小物理表集合是两个不同问题。** 一张表可以每行都原子，但整张表仍可能只是另一组事实的复制或汇总。
2. **表少不是唯一目标。** 稳定身份、来源原值、人工决定、已发生副作用，以及曾真正驱动行动的版本化决策输出不能仅靠当前输入倒推。
3. **完整目录不是实施清单。** 扩展包只是预先审核的契约；未启用模块没有真实写入者时不创建。
4. **运行治理表不等于业务事实表。** 19 张平台侧车负责权限、幂等、审计、安全和恢复，分析口径不得把它们当销售、人员或成本事实。

## 判定规则

- `CORE_MASTER_IDENTITY`：稳定身份、有效期映射、受控单位或已发布定义，不能从交易结果可靠反推。
- `CORE_BASE_FACT`：来源原值或最小业务事件，是多种派生的共同输入。
- `CORE_DECISION_OUTPUT`：值虽可计算，但该版本曾被批准或驱动行动；保存的是历史决定，不是当前汇总缓存。
- `CORE_WORKFLOW_FACT`：人的决定、状态转换和业务副作用本身就是事实。
- `CORE_PLATFORM_STATE`：权限、幂等、安全、任务恢复、审计或消息恢复所需的技术持久状态。
- `EXTENSION_PACK`：对应模块真正启用时才建。
- `SOURCE_CONDITIONAL`：来源身份、权限、粒度和重跑契约获证后才建。
- `DERIVE_VIEW / MERGE_INTO / REMOVE`：不保留独立物理表。

## 数量核对

- 原 R5 对象处置覆盖：154/154，名称唯一，无遗漏。
- R6 完整物理契约审计：137/137，但首期只有 100 张。
- `CORE_MASTER_IDENTITY`：33 张。
- `CORE_BASE_FACT`：33 张。
- `CORE_DECISION_OUTPUT`：5 张。
- `CORE_WORKFLOW_FACT`：10 张。
- `CORE_PLATFORM_STATE`：19 张。
- `EXTENSION_PACK`：33 张。
- `SOURCE_CONDITIONAL`：4 张。

## 不再独立建表的 17 个对象

### 并入同粒度表

- `ops_calendar_import_batch` → `app_job_run`
- `ops_production_plan` → `ops_production_plan_version`
- `cost_card_recipe` → `cost_card_recipe_version`
- `ops_plan_adjustment` → `ops_production_plan_line`
- `hr_trial` → `hr_appointment`
- `scm_supplier_item_material_mapping` → `scm_supplier_item`
- `ai_prompt_template_version` → `ai_prompt_template`
- `mkt_campaign` → `mkt_campaign_version`
- `ops_shift_plan` → `ops_shift_plan_version`
- `msg_push_deduplication` → `msg_outbound_message`
- `scm_purchase_order` → `scm_purchase_order_revision`

### 改为派生视图

- `ops_demand_factor_observation` → `v_ops_holiday_factor`
- `scm_material_requirement_line` → `v_scm_material_requirement_line`
- `cost_card_product_cost_snapshot` → `v_cost_card_product_cost_snapshot`
- `cost_card_product_cost_component` → `v_cost_card_product_cost_component`

### 删除

- `app_data_quality_issue`：跨域 entity_type/entity_id 工单会制造无外键的多态副本；质量状态由各域核对视图统一派生，若未来确需人工工单，应由独立工单系统引用 rule_code 与证据链接，不反向成为事实来源。
- `cost_card_cost_run`：成本完全由版本化配方、采用价与单位换算确定；刷新运行统一记录到 app_job_run。

## Claude Fable 5 独立复核及分歧

- **已确认：** Claude 对原 154 个对象给出 104 CORE_KEEP、36 EXTENSION_LATER、3 DERIVE_VIEW、5 CORE_MERGE_INTO、2 REMOVE、4 DEFER_SOURCE；合计 154。它同样否定 R5 是最小物理基座。完整原始输出保存在 `evidence/claude-fable-5-r6-minimal-foundation.md`。
- **我修正 Claude 的第一处：** 计划调整并入 `ops_production_plan_line`，不是仅并入计划版本头。原因是调整发生在具体产品/时段行，原因、AI建议和人工确认也必须与被调整行同粒度。
- **我采纳 Claude 对质量工单的反例：** 删除 `app_data_quality_issue` 物理表。它的 `entity_type/entity_id` 是无法由数据库保证的多态连接，质量现状由各域核对视图和 `v_app_data_quality_summary` 派生；若以后确有人工受理流程，应由独立工单系统引用稳定规则与证据链接，不能反向成为事实来源。
- **我在逐字段复核后进一步收紧：** 最终不是照抄 Claude 的 104/36/3/5/2/4，而是 100 首期、33 扩展、4 来源条件、11 合并、4 派生、2 删除。额外移除了生产计划、班表、配方、活动、推送去重和采购主单等空壳/副本，并把原料需求汇总改为视图。

## 逐物理契约终审

| # | 表 | 层级 | 一行代表 | 存储类别 | 结论 | 可派生性 | 派生字段/输出 | R6动作 | Claude |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `app_schema_migration` 迁移版本台账 | `CORE_PLATFORM` | 代码仓库 × 迁移版本一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 2 | `app_source_system` 来源系统注册表 | `CORE_BUSINESS` | 每个可区分的数据来源系统一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 3 | `app_unit` 统一计量单位 | `CORE_BUSINESS` | 一个受控计量单位一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 4 | `app_job_run` 自动任务运行记录 | `CORE_PLATFORM` | 某个任务的一次运行一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | R6_MERGE_INTO: calendar imports and cost refreshes use the generic job-run ledger | `CLAUDE_KEEP_PLUS_MERGED_R5_OBJECT` |
| 5 | `app_audit_event` 受控操作审计流水 | `CORE_PLATFORM` | 一次已完成或拒绝的受控操作一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 6 | `app_user` 统一应用账号 | `CORE_PLATFORM` | 每个可登录或可代表服务的账号一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 7 | `app_role` 应用角色 | `CORE_PLATFORM` | 一个角色一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 8 | `app_permission` 应用权限 | `EXTENSION_PACK:FINE_GRAINED_ACCESS` | 一个原子权限一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 9 | `app_user_role` 账号角色分配 | `CORE_PLATFORM` | 账号 × 角色 × 生效区间一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 10 | `app_role_permission` 角色权限关系 | `EXTENSION_PACK:FINE_GRAINED_ACCESS` | 角色 × 权限 × 生效区间一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 11 | `app_user_location_scope` 账号地点范围 | `CORE_PLATFORM` | 账号角色分配 × 地点 × 权限范围一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 12 | `app_session` 登录会话 | `CORE_PLATFORM` | 一个登录会话一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 13 | `app_one_time_token` 一次性访问令牌 | `CORE_PLATFORM` | 一个一次性令牌一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 14 | `app_rate_limit_event` 限流计数事件 | `CORE_PLATFORM` | 限流键 × 时间桶一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 15 | `ops_location` 统一地点主数据 | `CORE_BUSINESS` | 每个真实经营地点一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 16 | `ops_location_source_identity` 地点来源身份映射 | `CORE_BUSINESS` | 来源系统 × 外部地点ID × 有效期一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 17 | `ops_product` 统一产品主数据 | `CORE_BUSINESS` | 每个企业产品一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 18 | `ops_product_alias` 产品别名 | `CORE_BUSINESS` | 来源范围 × 一个别名 × 有效期一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `PARTIAL_FIELDS_DERIVED_IN_VIEW` | normalized_alias -> NORMALIZE_ALIAS(alias_text) | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 19 | `hr_person` 自然人主数据 | `CORE_BUSINESS` | 每个自然人一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 20 | `hr_person_contact` 人员联系方式 | `CORE_BUSINESS` | 人员 × 联系方式类型 × 有效期一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 21 | `hr_employment` 雇佣关系 | `CORE_BUSINESS` | 一个人从一次入职到一次离职的雇佣关系一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 22 | `hr_employment_source_identity` 雇佣来源身份映射 | `CORE_BUSINESS` | 来源系统 × 外部员工ID × 有效期一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 23 | `hr_employment_mapping_review` 雇佣身份映射审核 | `CORE_BUSINESS` | 来源系统 × 外部员工ID × 一次审核尝试一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 24 | `scm_material` 统一原料主数据 | `CORE_BUSINESS` | 每个可采购、库存或作为配方组件的物料一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 25 | `scm_material_alias` 原料别名 | `CORE_BUSINESS` | 来源范围 × 原料别名 × 有效期一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `PARTIAL_FIELDS_DERIVED_IN_VIEW` | normalized_alias -> NORMALIZE_ALIAS(alias_text) | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 26 | `scm_material_source_identity` 原料来源身份映射 | `CORE_BUSINESS` | 来源系统 × 外部原料ID × 有效期一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 27 | `pos_ingest_batch` POS导入批次 | `CORE_BUSINESS` | 某地点 × 某数据集 × 一次抓取或重跑一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 28 | `pos_product_listing` POS商品listing | `CORE_BUSINESS` | 来源系统 × 来源组织 × 外部商品ID一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 29 | `pos_product_mapping` POS商品到统一产品映射 | `CORE_BUSINESS` | POS listing × 有效期一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 30 | `pos_product_mapping_review` POS商品映射审核队列 | `CORE_BUSINESS` | 一个 listing 的一次待审核问题一行 | `CORE_WORKFLOW_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 31 | `pos_sales_day` POS门店日销售事实 | `CORE_BUSINESS` | 地点 × 营业日 × POS批次一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `PARTIAL_FIELDS_DERIVED_IN_VIEW` | average_order_value -> v_pos_sales_day_current | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 32 | `pos_sales_hour` POS门店小时销售事实 | `CORE_BUSINESS` | 地点 × 营业日 × 营业小时 × POS批次一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 33 | `pos_item_sales_hour` POS商品小时销售事实 | `CORE_BUSINESS` | 地点 × 营业小时 × POS listing × POS批次一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 34 | `pos_daily_breakdown` POS日销售维度拆分 | `CORE_BUSINESS` | 地点 × 营业日 × 维度类型 × 维度值 × POS批次一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 35 | `pos_item_waste` POS商品报废事实 | `CORE_BUSINESS` | 地点 × 营业日 × listing × 来源报废记录 × POS批次一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 36 | `ops_stockout_event` 商品断货事件 | `CORE_BUSINESS` | 地点 × listing × 一次连续断货区间一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 37 | `pos_order` POS订单稳定身份 | `CORE_BUSINESS` | 来源系统 × 地点 × 外部订单ID一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 38 | `pos_order_item` POS订单商品最小事实 | `CORE_BUSINESS` | POS批次 × 订单 × listing 一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 39 | `pos_payment` POS支付记录 | `SOURCE_CONDITIONAL` | 每个来源支付记录一行 | `SOURCE_CONDITIONAL` | `NOT_PHASE1_SOURCE_UNVERIFIED` | `UNKNOWN_UNTIL_SOURCE_VERIFIED` | 无额外派生字段 | DEFER_UNTIL_SOURCE_PROVEN | `CLAUDE_DEFER_SOURCE` |
| 40 | `pos_refund` POS退款记录 | `SOURCE_CONDITIONAL` | 每个来源退款记录一行 | `SOURCE_CONDITIONAL` | `NOT_PHASE1_SOURCE_UNVERIFIED` | `UNKNOWN_UNTIL_SOURCE_VERIFIED` | 无额外派生字段 | DEFER_UNTIL_SOURCE_PROVEN | `CLAUDE_DEFER_SOURCE` |
| 41 | `pos_member` POS会员主档 | `CORE_BUSINESS` | 每个企业内可识别的 POS 会员一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `PARTIAL_FIELDS_DERIVED_IN_VIEW` | has_card -> EXISTS(pos_member_card)；has_profile/last_snapshot_date/level/growth/points/lifetime amounts/current balances -> v_pos_member_state_current from append-only snapshots | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 42 | `pos_member_contact` 会员联系方式 | `CORE_BUSINESS` | 会员 × 联系方式类型 × 有效期一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 43 | `pos_member_card` 会员卡 | `CORE_BUSINESS` | 每张来源会员卡一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 44 | `pos_member_balance_snapshot` 会员状态与余额快照 | `CORE_BUSINESS` | 会员 × 快照日期 × POS批次一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `PARTIAL_FIELDS_DERIVED_IN_VIEW` | partial flag and missing fields -> nullable balances + pos_ingest_batch status | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 45 | `pos_member_card_transaction` 会员卡交易流水 | `CORE_BUSINESS` | 每笔来源会员卡交易一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 46 | `pos_member_daily_metric` 会员日指标 | `CORE_BUSINESS` | 地点 × 营业日 × POS批次一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `PARTIAL_FIELDS_DERIVED_IN_VIEW` | source/POS member-sales ratios -> v_pos_member_daily_summary；card payment net and source/POS ratios -> v_pos_member_daily_summary；topup total and stored-value face net -> v_pos_member_daily_summary；partial flag and missing fields -> nullable measures + pos_ingest_batch status | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 47 | `ops_calendar_event` 日历事件 | `CORE_BUSINESS` | 辖区 × 日期 × 事件一行 | `CORE_WORKFLOW_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 48 | `ops_operational_event` 运营突发事件 | `CORE_BUSINESS` | 一个地点的一次连续运营事件一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 49 | `ops_operational_event_product` 运营事件受影响产品 | `CORE_BUSINESS` | 运营事件 × 产品一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 50 | `ops_forecast_run` 需求预测运行 | `CORE_BUSINESS` | 地点 × 目标营业日 × 一次算法运行一行 | `CORE_DECISION_OUTPUT` | `PASS_HISTORICAL_DECISION_FACT` | `CALCULABLE_BUT_CURRENT_INPUTS_CANNOT_RECREATE_PAST_DECISION` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 51 | `ops_forecast_line` 产品预测行 | `CORE_BUSINESS` | 预测运行 × 产品一行 | `CORE_DECISION_OUTPUT` | `PASS_HISTORICAL_DECISION_FACT` | `CALCULABLE_BUT_CURRENT_INPUTS_CANNOT_RECREATE_PAST_DECISION` | accuracy/error -> v_ops_forecast_accuracy | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 52 | `ops_production_plan_version` 生产预估单版本 | `CORE_BUSINESS` | 生产地点 × 计划营业日 × 版本号一行 | `CORE_DECISION_OUTPUT` | `PASS_HISTORICAL_DECISION_FACT` | `CALCULABLE_BUT_CURRENT_INPUTS_CANNOT_RECREATE_PAST_DECISION` | 无额外派生字段 | R6_MERGE_INTO: absorb ops_production_plan; location + business date is the stable plan identity | `CLAUDE_CORE_KEEP; CODEX_FURTHER_MERGED_REDUNDANT_CORE_SHELL` |
| 53 | `ops_production_plan_line` 生产预估单产品行 | `CORE_BUSINESS` | 预估单版本 × 产品一行 | `CORE_DECISION_OUTPUT` | `PASS_HISTORICAL_DECISION_FACT` | `CALCULABLE_BUT_CURRENT_INPUTS_CANNOT_RECREATE_PAST_DECISION` | adjustment_delta -> compare quantity with based_on_plan_line_id | R6_MERGE_INTO: absorb ops_plan_adjustment reason and provenance into a new plan-version line; derive delta | `CLAUDE_CORE_KEEP; PLAN_ADJUSTMENT_MERGE_TARGET_CORRECTED_TO_LINE` |
| 54 | `ops_production_plan_slot` 生产时段计划 | `EXTENSION_PACK:PRODUCTION_EXECUTION` | 计划产品行 × 生产时段一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 55 | `ops_workload_run` 工作量计算运行 | `EXTENSION_PACK:SHIFT_AND_WORKFORCE` | 地点 × 营业日 × 一次工作量计算一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 56 | `ops_workload_line` 岗位工作量行 | `EXTENSION_PACK:SHIFT_AND_WORKFORCE` | 工作量运行 × 岗位 × 工位 × 可选产品一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 57 | `ops_production_run` 实际生产批次 | `EXTENSION_PACK:PRODUCTION_EXECUTION` | 生产地点 × 营业日 × 一次生产批次一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 58 | `ops_production_run_line` 实际生产产品行 | `EXTENSION_PACK:PRODUCTION_EXECUTION` | 生产批次 × 产品一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 59 | `ops_dispatch` 地点间配送 | `EXTENSION_PACK:PRODUCTION_EXECUTION` | 发出地点 × 接收地点 × 一次配送批次一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 60 | `ops_dispatch_line` 配送产品行 | `EXTENSION_PACK:PRODUCTION_EXECUTION` | 配送单 × 产品一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 61 | `ops_daily_review` 每日运营复盘 | `CORE_BUSINESS` | 地点 × 营业日 × 复盘版本一行 | `CORE_WORKFLOW_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 62 | `ops_review_action` 复盘改进行动 | `CORE_BUSINESS` | 复盘 × 一项改进行动一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 63 | `ops_business_rule` 运营业务规则 | `CORE_BUSINESS` | 适用地点/产品组合或企业全局 × 规则代码 × 版本一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 64 | `hr_job_requisition` 招聘需求 | `CORE_BUSINESS` | 一个招聘需求一行 | `CORE_WORKFLOW_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 65 | `hr_application` 候选申请 | `CORE_BUSINESS` | 人员 × 招聘需求 × 一次申请一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 66 | `hr_application_stage_event` 候选申请阶段事件 | `CORE_BUSINESS` | 候选申请 × 一次阶段迁移一行 | `CORE_WORKFLOW_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 67 | `hr_appointment` 面试试工预约 | `CORE_BUSINESS` | 申请 × 一次预约一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | R6_MERGE_INTO: absorb hr_trial execution timestamps, outcome and safety incident | `CLAUDE_KEEP_PLUS_MERGED_R5_OBJECT` |
| 68 | `hr_assessment` 候选人评估 | `CORE_BUSINESS` | 申请 × 评估类型 × 一次评估一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `PARTIAL_FIELDS_DERIVED_IN_VIEW` | total_score -> v_hr_assessment_summary | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 69 | `hr_assessment_score` 评估项目得分 | `CORE_BUSINESS` | 评估 × 评分项目一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 70 | `hr_offer` Offer版本 | `CORE_BUSINESS` | 申请 × Offer版本一行 | `CORE_WORKFLOW_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 71 | `hr_onboarding_task` 入职任务 | `EXTENSION_PACK:TRAINING_AND_ONBOARDING` | 雇佣关系 × 入职任务代码一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 72 | `hr_employee_event` 员工事件 | `CORE_BUSINESS` | 雇佣关系 × 一次事件一行 | `CORE_WORKFLOW_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 73 | `hr_screening_rule` 招聘筛选规则 | `CORE_BUSINESS` | 一个规则版本一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 74 | `hr_training_course` 培训课程 | `EXTENSION_PACK:TRAINING_AND_ONBOARDING` | 一个培训课程一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 75 | `hr_training_course_version` 培训课程版本 | `EXTENSION_PACK:TRAINING_AND_ONBOARDING` | 课程 × 版本号一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 76 | `hr_training_assignment` 培训指派 | `EXTENSION_PACK:TRAINING_AND_ONBOARDING` | 雇佣关系 × 课程版本 × 一次指派一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 77 | `hr_training_result` 培训结果 | `EXTENSION_PACK:TRAINING_AND_ONBOARDING` | 培训指派 × 一次尝试一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 78 | `ops_role` 标准岗位 | `CORE_BUSINESS` | 一个标准岗位一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 79 | `ops_station` 标准工位 | `EXTENSION_PACK:SHIFT_AND_WORKFORCE` | 一个标准工位定义一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 80 | `ops_role_training_requirement` 岗位培训要求 | `EXTENSION_PACK:TRAINING_AND_ONBOARDING` | 岗位 × 课程 × 生效区间一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 81 | `ops_shift_plan_version` 班表版本 | `EXTENSION_PACK:SHIFT_AND_WORKFORCE` | 地点 × 营业日 × 版本号一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE; R6_MERGE_INTO: absorb ops_shift_plan; location + business date is the stable shift-plan identity | `CLAUDE_EXTENSION_LATER; CODEX_FURTHER_MERGED_REDUNDANT_EXTENSION_SHELL` |
| 82 | `ops_shift_requirement` 班次岗位需求 | `EXTENSION_PACK:SHIFT_AND_WORKFORCE` | 班表版本 × 时段 × 岗位 × 工位一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 83 | `ops_shift_assignment` 班次员工指派 | `EXTENSION_PACK:SHIFT_AND_WORKFORCE` | 班次需求 × 雇佣关系 × 一段指派一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 84 | `hr_timesheet_sync_batch` 工时同步批次 | `SOURCE_CONDITIONAL` | 来源 × 时间窗口 × 一次同步一行 | `SOURCE_CONDITIONAL` | `NOT_PHASE1_SOURCE_UNVERIFIED` | `UNKNOWN_UNTIL_SOURCE_VERIFIED` | 无额外派生字段 | DEFER_UNTIL_SOURCE_PROVEN | `CLAUDE_DEFER_SOURCE` |
| 85 | `hr_timesheet_entry` 实际工时事实 | `SOURCE_CONDITIONAL` | 来源工时记录 × 雇佣关系 × 地点 × 工作时段一行 | `SOURCE_CONDITIONAL` | `NOT_PHASE1_SOURCE_UNVERIFIED` | `UNKNOWN_UNTIL_SOURCE_VERIFIED` | 无额外派生字段 | DEFER_UNTIL_SOURCE_PROVEN | `CLAUDE_DEFER_SOURCE` |
| 86 | `scm_material_unit_conversion` 物料单位换算 | `CORE_BUSINESS` | 原料 × 起始单位 × 目标单位 × 生效区间一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 87 | `scm_supplier` 供应商主数据 | `CORE_BUSINESS` | 一个法律或经营供应商一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 88 | `scm_supplier_item` 供应商商品 | `CORE_BUSINESS` | 供应商 × 外部SKU × 生效版本一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `PARTIAL_FIELDS_DERIVED_IN_VIEW` | base_unit_quantity -> material unit conversion | R6_MERGE_INTO: each row is an effective-dated supplier SKU/material/package version; no separate mapping table | `CLAUDE_KEEP_PLUS_MERGED_R5_OBJECT` |
| 89 | `scm_supplier_item_mapping_review` 供应商商品映射审核 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 一个供应商SKU的一次待审核问题一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 90 | `scm_inventory_count` 库存盘点单 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 地点 × 盘点时点 × 一次盘点一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 91 | `scm_inventory_count_line` 库存盘点行 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 盘点单 × 原料 × 可选批号一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 92 | `scm_inventory_movement` 库存移动单 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 一个业务库存事件一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 93 | `scm_inventory_movement_line` 库存移动行 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 库存移动单 × 原料 × 可选批号一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 94 | `scm_material_requirement_run` 原料需求计算运行 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 地点 × 计划营业日 × 一次需求计算一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 95 | `scm_material_requirement_component` 原料需求组成血缘 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 需求运行 × 计划产品行 × 展开序号一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | planned product quantity -> immutable ops_production_plan_line；material total/base unit/quality summary -> v_scm_material_requirement_line | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 96 | `scm_replenishment_run` 补货建议运行 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 地点 × 需求日期 × 一次补货计算一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 97 | `scm_replenishment_line` 补货建议行 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 补货运行 × 原料 × 供应商商品版本候选一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | approved minus suggested delta -> v_scm_replenishment_trace | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 98 | `scm_purchase_order_revision` 采购订单版本 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 采购单号 × 版本号一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | header/line reconciliation -> v_scm_purchase_order_reconciliation | DESIGN_ONLY_DO_NOT_CREATE; R6_MERGE_INTO: absorb scm_purchase_order; purchase_order_code groups immutable supplier-confirmed revisions | `CLAUDE_EXTENSION_LATER; CODEX_FURTHER_MERGED_REDUNDANT_EXTENSION_SHELL` |
| 99 | `scm_purchase_order_line` 采购订单行 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 采购版本 × 供应商商品版本一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | base unit quantity -> order quantity × unit conversion；line currency -> referenced purchase-order revision | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 100 | `scm_goods_receipt` 采购收货单 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 采购版本 × 一次收货一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 101 | `scm_goods_receipt_line` 采购收货行 | `EXTENSION_PACK:PROCUREMENT_AND_INVENTORY` | 收货单 × 采购行 × 可选批号一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 102 | `scm_supplier_price_observation` 供应商市场价观察 | `CORE_BUSINESS` | 供应商商品 × 观察时间 × 来源记录一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `PARTIAL_FIELDS_DERIVED_IN_VIEW` | normalized_price_myr -> raw price × FX rate ÷ unit conversion | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 103 | `cost_card_recipe_version` 配方版本 | `CORE_BUSINESS` | 配方代码 × 版本号一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | R6_MERGE_INTO: absorb cost_card_recipe; recipe_code groups immutable versions | `CLAUDE_CORE_KEEP; CODEX_FURTHER_MERGED_REDUNDANT_CORE_SHELL` |
| 104 | `cost_card_recipe_component` 配方原料组件 | `CORE_BUSINESS` | 配方版本 × 原料 × 序号一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `PARTIAL_FIELDS_DERIVED_IN_VIEW` | base_unit_quantity -> input quantity × unit conversion | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 105 | `cost_card_material_price` 成本采用价 | `CORE_BUSINESS` | 地点或全局 × 原料 × 生效区间一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 106 | `finance_import_batch` 财务导入批次 | `CORE_BUSINESS` | 来源文件或数据集 × 一次导入一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 107 | `finance_sales_daily` 财务日销售事实 | `CORE_BUSINESS` | 财务批次 × 地点 × 日期一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 108 | `finance_item_sales_monthly` 财务单品月销售 | `CORE_BUSINESS` | 财务批次 × 地点 × 月份 × 来源商品一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 109 | `finance_monthly_cost_line` 财务月成本费用行 | `CORE_BUSINESS` | 财务批次 × 地点 × 月份 × 成本域 × 类别 × 子类 × 组织或来源一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 110 | `finance_cashflow_line` 财务现金流行 | `CORE_BUSINESS` | 财务批次 × 地点 × 月份 × 现金流项目一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 111 | `finance_order_logistics_line` 财务物流订货行 | `CORE_BUSINESS` | 财务批次 × 来源订货单 × 来源商品行一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 112 | `finance_inventory_snapshot_line` 财务月库存快照行 | `CORE_BUSINESS` | 财务批次 × 地点 × 月份 × 来源物料一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 113 | `finance_inventory_flow_line` 财务月进销存行 | `CORE_BUSINESS` | 财务批次 × 地点 × 月份 × 仓别 × 来源物料一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 114 | `finance_supplier_purchase_monthly` 财务供应商月采购 | `CORE_BUSINESS` | 财务批次 × 地点 × 月份 × 来源供应商 × 来源物料 × 规格一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 115 | `finance_target` 财务经营目标 | `CORE_BUSINESS` | 地点 × 月份 × 指标代码 × 版本一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 116 | `finance_monthly_metric` 财务月度指标值 | `CORE_BUSINESS` | 财务批次 × 地点 × 月份 × 指标代码一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 117 | `finance_period_category_map` 期间费用归类规则 | `CORE_BUSINESS` | 来源大类 × 来源子类 × 生效区间一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 118 | `mkt_campaign_version` 营销活动版本 | `CORE_BUSINESS` | 活动代码 × 版本号一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | R6_MERGE_INTO: absorb mkt_campaign; campaign_code groups immutable versions | `CLAUDE_CORE_KEEP; CODEX_FURTHER_MERGED_REDUNDANT_CORE_SHELL` |
| 119 | `mkt_campaign_member` 活动会员参与 | `CORE_BUSINESS` | 活动版本 × 会员一行 | `CORE_WORKFLOW_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 120 | `mkt_survey_question` 问卷题目 | `CORE_BUSINESS` | 活动版本 × 题目代码一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 121 | `mkt_survey_question_option` 问卷选项 | `CORE_BUSINESS` | 题目 × 选项代码一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 122 | `mkt_survey_response` 问卷作答 | `CORE_BUSINESS` | 活动会员 × 尝试次数一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 123 | `mkt_survey_answer` 问卷题目答案 | `CORE_BUSINESS` | 作答 × 题目 × 原子答案值一行 | `CORE_BASE_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 124 | `mkt_survey_result` 问卷测评结果 | `CORE_BUSINESS` | 问卷作答 × 结果类型 × 算法版本一行 | `CORE_DECISION_OUTPUT` | `PASS_HISTORICAL_DECISION_FACT` | `CALCULABLE_BUT_CURRENT_INPUTS_CANNOT_RECREATE_PAST_DECISION` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 125 | `mkt_reward` 活动奖励主数据 | `CORE_BUSINESS` | 一个可发放奖励一行 | `CORE_MASTER_IDENTITY` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 126 | `mkt_reward_stock` 活动奖励库存 | `CORE_BUSINESS` | 活动版本 × 地点 × 奖励一行 | `CORE_WORKFLOW_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `PARTIAL_FIELDS_DERIVED_IN_VIEW` | available quantity and counter reconciliation -> v_mkt_reward_stock_reconciliation | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 127 | `mkt_reward_claim` 活动奖励领取 | `CORE_BUSINESS` | 活动会员 × 一次奖励领取一行 | `CORE_WORKFLOW_FACT` | `PASS_MINIMUM_PHYSICAL_FOUNDATION` | `NO` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 128 | `msg_conversation` 消息会话 | `CORE_PLATFORM` | 一个渠道会话一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | last message display -> ordered msg_message | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 129 | `msg_message` 会话消息 | `CORE_PLATFORM` | 会话 × 一条消息一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 130 | `msg_conversation_state` 会话流程状态 | `CORE_PLATFORM` | 会话 × 工作流代码一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 131 | `msg_outbound_message` 外发消息队列 | `CORE_PLATFORM` | 一次计划外发消息一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | attempt count and last error -> ordered msg_delivery_attempt；successful daily-push deduplication -> queue natural key + delivery facts | R6_MERGE_INTO: absorb msg_push_deduplication; queue natural key plus delivery facts determines success | `CLAUDE_CORE_KEEP; CODEX_FURTHER_MERGED_REDUNDANT_CORE_SHELL` |
| 132 | `msg_delivery_attempt` 消息投递尝试 | `CORE_PLATFORM` | 外发消息 × 一次发送尝试一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 133 | `msg_delivery_event` 消息投递状态事件 | `EXTENSION_PACK:CHANNEL_RECEIPTS` | 外发消息 × 一次渠道状态事件一行 | `EXTENSION_PACK` | `NOT_PHASE1_EXTENSION_ONLY` | `NOT_APPLICABLE_UNTIL_MODULE_ENABLED` | 无额外派生字段 | DESIGN_ONLY_DO_NOT_CREATE | `CLAUDE_EXTENSION_LATER` |
| 134 | `ai_prompt_segment` Prompt片段版本 | `CORE_PLATFORM` | Prompt片段代码 × 版本号一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 135 | `ai_prompt_template` Prompt模板版本 | `CORE_PLATFORM` | AI场景代码 × 版本号一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | R6_MERGE_INTO: each row is one immutable template version; no separate template-version table | `CLAUDE_KEEP_PLUS_MERGED_R5_OBJECT` |
| 136 | `ai_prompt_template_segment` 模板片段组合 | `CORE_PLATFORM` | 模板版本 × 顺序一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | content/hash/variable schema -> referenced ai_prompt_segment version | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |
| 137 | `ai_call` AI调用流水 | `CORE_PLATFORM` | 一次模型请求一行 | `CORE_PLATFORM_STATE` | `PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT` | `NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY` | 无额外派生字段 | KEEP_IN_PHASE1 | `CLAUDE_CORE_KEEP` |

## 未确定性与实施边界

- `pos_payment`、`pos_refund` 的来源记录ID、状态变化、删除/更正和整批重跑能力尚未被当前证据证明。
- `hr_timesheet_sync_batch`、`hr_timesheet_entry` 仍需证明 Lark 员工身份、修改/撤销和重跑契约。
- 33 张扩展契约通过的是结构预审，不代表已有写入者、权限、SOP或生产数据。
- 本终审没有执行 DDL、DML、迁移、部署或项目读写改造。

完整逐字段类型、空值、默认值、来源、约束、时间语义、敏感性、示例和误用提醒见 `03-table-and-field-dictionary.md` 与 `target-field-dictionary.csv`；原 154 个对象的机器可核对去向见 `r5-to-r6-disposition.csv`。
