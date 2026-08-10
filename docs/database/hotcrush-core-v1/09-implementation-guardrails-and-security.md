# 09 实施约束、安全与现有门禁承接

逐项登记现库索引、约束、触发器和RLS去向，并为每张目标表声明实施门禁；本文件不是执行授权。

> 状态：**方案 C 评审稿，不是迁移脚本，不授权修改生产数据库。**
> 模型版本：`HOTCRUSH-CORE-V1-REVIEW-R6-2026-08-10`；生产结构快照：`2026-08-09T09:56:05.204Z`；代码静态扫描：`2026-08-09T10:30:31.506548+00:00`。

## 结论

现库共登记 467 个门禁对象：约束 230、索引 198、触发器 13、RLS策略 26；全部在 `current-guardrail-to-target-matrix.csv` 恰好出现一次。
目标 137 张物理表全部在 `target-table-implementation-guardrails.csv` 声明主键/唯一键、每个FK的索引候选、行级访问边界、写入冻结、删除策略和特殊约束。

**这只证明设计对象没有被静默遗漏，不证明已经实施或与生产运行等价。** 任何迁移必须逐项把 DESIGN_MAPPED_NOT_EXECUTED 转为实测证据；未获用户批准前不得执行这些DDL。

**视图实施边界：** 41 个 Phase1 视图只是设计候选；其中 10 个 PASS_SELECT_SPEC 仅表示 SELECT 规格足够，不表示已经创建或运行验证；当前已创建并验证的 SQL view = 0。
准备度分布：PASS_SELECT_SPEC=10；FIX_MODEL_CONTRACT=9；BLOCK_MISSING_FACT_OR_RULE=22；DEFER_EXTENSION=13；DEFER_SOURCE=5。

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

## 实施前硬门禁

1. 每个现有约束/索引/触发器/RLS策略必须得到 RETAIN、REPLACE 或 RETIRE 三选一批准，并附失败用例；仅同名不算语义等价。
2. 所有业务FK默认 RESTRICT/NO ACTION；CASCADE 只能用于明确的同生命周期技术子记录，并需单独批准。
3. 所有当前生效FK（含复合FK）都进入索引候选；延期FK只在相应扩展包共同启用时建约束和索引。Phase1有 224 个未被PK/UQ左前缀覆盖的支持索引候选；实际建索引前用真实查询与写入负载验证列顺序，禁止把 420 个潜在连接机械地建成同数量单列索引。
4. 地点级表必须验证 location scope 的允许与拒绝样例；PII/秘密字段必须走受限列路径，普通分析不得读取密文或原始敏感证据。
5. 发布/发送/终态版本、奖励扣减、消息领取和收货跨版本一致性必须由数据库事务或约束触发器保护，不能只靠前端约定。
6. 当前只有生产库；先生成迁移文件、离线审查、回填核对、双轨、切换与回滚证据，禁止本评审生成器直接执行。

## 特殊数据库门禁

- `app_audit_event`：APPEND_ONLY_GUARD: deny UPDATE and DELETE to application roles
- `app_user`：SUBSCRIPTION_VALIDATION: sole preference-update function normalizes notification_subscription_codes, rejects unknown or duplicate codes against the deployed message-type registry, writes app_audit_event, and revokes direct array updates
- `cost_card_recipe_version`：FREEZE_TRIGGER: published/archived/rejected version and child components are immutable
- `mkt_campaign_version`：FREEZE_TRIGGER: published/archived/rejected version, questions and options are immutable
- `mkt_reward_claim`：COMPOSITE_FK_REQUIRED: (reward_stock_id,reward_id) REFERENCES mkt_reward_stock(reward_stock_id,reward_id) MATCH SIMPLE; trigger is not an acceptable substitute | ATOMIC_WRITE_FUNCTION: stock-backed idempotent claim insert and reward_stock counter change in one transaction; stockless external fulfillment does not mutate stock
- `msg_outbound_message`：CLAIM_FUNCTION: idempotency key conflict returns existing message; queue lease transitions are atomic
- `ops_production_plan_version`：FREEZE_TRIGGER: published/rejected/cancelled/superseded version and child rows are immutable
- `ops_shift_assignment`：CONSTRAINT_TRIGGER: no employment time overlap and critical role eligibility must be valid at shift start
- `ops_shift_plan_version`：FREEZE_TRIGGER: published/rejected/cancelled/superseded version and child rows are immutable
- `pos_member_card_transaction`：CONSTRAINT_TRIGGER: when member_card_id is present, the referenced card must belong to member_id when member_id is also present; resolved stable IDs must agree with source IDs in the same source-system namespace
- `scm_goods_receipt_line`：DEFERRABLE_CONSTRAINT_TRIGGER: referenced PO line must belong to receipt header purchase_order_revision_id; material must match supplier item mapping
- `scm_purchase_order_revision`：FREEZE_TRIGGER: sent/confirmed/rejected/cancelled/superseded revision and lines are immutable
- `ai_call`：SCHEMA_VALIDATION: terminal-write function validates parsed_output against the referenced ai_prompt_template.output_schema; validation_status=VALID is impossible on mismatch and direct terminal updates are revoked
- `ai_prompt_segment`：SCHEMA_VALIDATION: approval function validates variable_schema as the approved JSON-Schema subset and rejects unsupported keywords before status can become APPROVED or ACTIVE
- `ai_prompt_template`：SCHEMA_VALIDATION: approval function validates output_schema as the approved JSON-Schema subset and rejects unsupported keywords before status can become APPROVED or ACTIVE
- `cost_card_recipe_component`：SCHEMA_VALIDATION: recipe component write function requires condition_rule and condition_schema_version together only when is_optional=true, validates allowed variant keys/types, rejects unknown keys, and revokes direct component INSERT/UPDATE from application roles
- `hr_employee_event`：SCHEMA_VALIDATION: sole append function validates event_data by event_type + event_schema_version; unknown keys and unsupported versions are rejected; application roles cannot insert directly
- `hr_offer`：SCHEMA_VALIDATION: sole offer draft-write and send functions validate compensation_summary by compensation_schema_version, require currency and typed nonnegative pay items, reject unknown keys, and revoke direct compensation writes from application roles
- `hr_screening_rule`：SCHEMA_VALIDATION: sole screening-rule draft-write and approval functions validate rule_definition by rule_type + rule_schema_version, reject unknown keys and protected discrimination inputs, and revoke direct rule_definition writes from application roles
- `mkt_campaign_version`：SCHEMA_VALIDATION: sole campaign draft-write and publish functions validate audience_rule, participation_rule and reward_rule by campaign_type + rule_schema_version; unknown keys or unsupported versions are rejected, and application roles have no direct rule-column UPDATE grant
- `mkt_survey_question`：SCHEMA_VALIDATION: campaign question write function validates validation_rule by question_type + validation_schema_version; unknown keys or unsupported versions are rejected and published questions cannot be updated directly
- `msg_conversation_state`：SCHEMA_VALIDATION: controlled workflow transition function validates collected_data and pending_action by workflow_code + workflow_version; unknown keys are rejected and direct state-table writes are revoked
- `msg_outbound_message`：SCHEMA_VALIDATION: atomic enqueue function validates payload by template_code + template_version before claiming idempotency_key; unknown keys/templates are rejected and direct queue INSERT is revoked
- `ops_business_rule`：SCHEMA_VALIDATION: BEFORE INSERT/UPDATE validator dispatches by rule_code + schema_version, validates rule_value types/ranges/allowed keys, and rejects unknown keys or unsupported versions before approval
- `ops_daily_review`：SCHEMA_VALIDATION: sole SECURITY DEFINER draft-write function validates manager_input against manager_input_schema_version and review_summary against review_summary_schema_version; unknown keys and unsupported versions are rejected; application roles have no direct INSERT/UPDATE grant

## 可复算的生成幂等性

- `tools/hash-review-package.py` 只读计算声明式模型、生成器、冻结证据输入、生成文本契约和 Draw.io 源文件的逐文件及聚合 SHA-256；连续两次重跑生成器后聚合值必须一致。
- PNG、PDF 和网页交互版由第三方导出器生成，可能包含墙钟元数据，因此不混入确定性哈希；它们另行接受页数、对象覆盖、分辨率和人工可读性验收。
- Claude 审计结果和最终验收记录在设计冻结后追加，也不混入设计核心哈希。哈希相同只证明声明范围逐字节一致，不证明生产库新鲜度、迁移安全或业务语义正确。

```bash
python3 docs/database/hotcrush-core-v1/tools/hash-review-package.py
```

## 待运行时验证

- 当前快照只证明对象在采集时存在；无法证明四个部署目标的动态SQL、连接角色和生产代码与本地静态扫描完全一致。
- 索引是否保留必须结合 EXPLAIN、表大小、写入频率和唯一性语义；本稿只保证候选不遗漏。
- RLS 必须用真实 Supabase 角色和 JWT claims 做允许/拒绝测试；静态 policy 文本不是授权正确性的充分证据。
