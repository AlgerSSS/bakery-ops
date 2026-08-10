# P0b 视图准备度覆盖证据（取代旧的模糊‘首期可建’表述）

> 生成于声明式目标模型；不是历史独立复审记录，也不是数据库实施证据。

- 模型版本：`HOTCRUSH-CORE-V1-REVIEW-R6-2026-08-10`
- 41 个 Phase1 视图只是设计候选；其中 10 个 PASS_SELECT_SPEC 仅表示 SELECT 规格足够，不表示已经创建或运行验证；当前已创建并验证的 SQL view = 0。
- `PASS_SELECT_SPEC` 仅允许 blockers 为空；其他状态必须给出稳定机器码。
- 唯一未定义粒度键的是 `v_identity_mapping_gap`，它必须保持 BLOCK 并包含 `UNDEFINED_GRAIN_KEY`。

## 固定计数

- `PASS_SELECT_SPEC`：10
- `FIX_MODEL_CONTRACT`：9
- `BLOCK_MISSING_FACT_OR_RULE`：22
- `DEFER_EXTENSION`：13
- `DEFER_SOURCE`：5

## 59/59 显式契约

| 视图 | 实施层级 | 准备度 | 粒度键 | 稳定阻断码 |
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

## 当前实施事实

- 由本评审生成器创建的目标视图 SQL：0。
- 已在新 Supabase/PostgreSQL 数据库创建并运行验证的目标视图：0。
- 后续只有在独立 SQL 编译、数据库创建、样例与反例测试、权限测试完成后，才能把某个视图标记为已实施。
