"""R6 minimum-physical-foundation decisions.

This module answers a different question from the R5 per-table grain audit:
which objects must exist physically on day one, which belong to an optional
module, and which proposed R5 tables should be merged, derived, or removed.
It is review metadata only; it does not execute DDL.
"""

from __future__ import annotations

from collections import Counter


MODEL_VERSION = "HOTCRUSH-CORE-V1-REVIEW-R6-2026-08-10"


CORE_PLATFORM_TABLES = {
    "app_schema_migration",
    "app_job_run",
    "app_audit_event",
    "app_user",
    "app_role",
    "app_user_role",
    "app_user_location_scope",
    "app_session",
    "app_one_time_token",
    "app_rate_limit_event",
    "msg_conversation",
    "msg_message",
    "msg_conversation_state",
    "msg_outbound_message",
    "msg_delivery_attempt",
    "ai_prompt_segment",
    "ai_prompt_template",
    "ai_prompt_template_segment",
    "ai_call",
}


CORE_BUSINESS_TABLES = {
    "app_source_system",
    "app_unit",
    "ops_location",
    "ops_location_source_identity",
    "ops_product",
    "ops_product_alias",
    "ops_stockout_event",
    "ops_calendar_event",
    "ops_operational_event",
    "ops_operational_event_product",
    "ops_forecast_run",
    "ops_forecast_line",
    "ops_production_plan_version",
    "ops_production_plan_line",
    "ops_daily_review",
    "ops_review_action",
    "ops_business_rule",
    "ops_role",
    "hr_person",
    "hr_person_contact",
    "hr_employment",
    "hr_employment_source_identity",
    "hr_employment_mapping_review",
    "hr_job_requisition",
    "hr_application",
    "hr_application_stage_event",
    "hr_appointment",
    "hr_assessment",
    "hr_assessment_score",
    "hr_offer",
    "hr_employee_event",
    "hr_screening_rule",
    "pos_ingest_batch",
    "pos_product_listing",
    "pos_product_mapping",
    "pos_product_mapping_review",
    "pos_sales_day",
    "pos_sales_hour",
    "pos_item_sales_hour",
    "pos_daily_breakdown",
    "pos_item_waste",
    "pos_order",
    "pos_order_item",
    "pos_member",
    "pos_member_contact",
    "pos_member_card",
    "pos_member_balance_snapshot",
    "pos_member_card_transaction",
    "pos_member_daily_metric",
    "scm_material",
    "scm_material_alias",
    "scm_material_source_identity",
    "scm_material_unit_conversion",
    "scm_supplier",
    "scm_supplier_item",
    "scm_supplier_price_observation",
    "cost_card_recipe_version",
    "cost_card_recipe_component",
    "cost_card_material_price",
    "finance_import_batch",
    "finance_sales_daily",
    "finance_item_sales_monthly",
    "finance_monthly_cost_line",
    "finance_cashflow_line",
    "finance_order_logistics_line",
    "finance_inventory_snapshot_line",
    "finance_inventory_flow_line",
    "finance_supplier_purchase_monthly",
    "finance_target",
    "finance_monthly_metric",
    "finance_period_category_map",
    "mkt_campaign_version",
    "mkt_campaign_member",
    "mkt_survey_question",
    "mkt_survey_question_option",
    "mkt_survey_response",
    "mkt_survey_answer",
    "mkt_survey_result",
    "mkt_reward",
    "mkt_reward_stock",
    "mkt_reward_claim",
}


EXTENSION_PACKS = {
    "FINE_GRAINED_ACCESS": {
        "app_permission",
        "app_role_permission",
    },
    "SHIFT_AND_WORKFORCE": {
        "ops_shift_plan_version",
        "ops_shift_requirement",
        "ops_shift_assignment",
        "ops_workload_run",
        "ops_workload_line",
        "ops_station",
    },
    "PRODUCTION_EXECUTION": {
        "ops_production_plan_slot",
        "ops_production_run",
        "ops_production_run_line",
        "ops_dispatch",
        "ops_dispatch_line",
    },
    "TRAINING_AND_ONBOARDING": {
        "hr_onboarding_task",
        "hr_training_course",
        "hr_training_course_version",
        "hr_training_assignment",
        "hr_training_result",
        "ops_role_training_requirement",
    },
    "PROCUREMENT_AND_INVENTORY": {
        "scm_supplier_item_mapping_review",
        "scm_inventory_count",
        "scm_inventory_count_line",
        "scm_inventory_movement",
        "scm_inventory_movement_line",
        "scm_material_requirement_run",
        "scm_material_requirement_component",
        "scm_replenishment_run",
        "scm_replenishment_line",
        "scm_purchase_order_revision",
        "scm_purchase_order_line",
        "scm_goods_receipt",
        "scm_goods_receipt_line",
    },
    "CHANNEL_RECEIPTS": {
        "msg_delivery_event",
    },
}


SOURCE_CONDITIONAL_TABLES = {
    "pos_payment",
    "pos_refund",
    "hr_timesheet_sync_batch",
    "hr_timesheet_entry",
}


# R5 objects that no longer remain physical tables in R6.
MERGED_R5_TABLES = {
    "ops_calendar_import_batch": "app_job_run",
    # location_id + plan_business_date already identifies the stable plan;
    # versions carry every non-derivable decision and lifecycle transition.
    "ops_production_plan": "ops_production_plan_version",
    # All consumers require a concrete recipe version; recipe_code groups
    # versions without a separate family row.
    "cost_card_recipe": "cost_card_recipe_version",
    # Product-level reason and AI/human provenance belong on the immutable
    # destination plan line, not on the version header.
    "ops_plan_adjustment": "ops_production_plan_line",
    "hr_trial": "hr_appointment",
    # supplier_item becomes an effective-dated supplier-SKU version row.
    "scm_supplier_item_material_mapping": "scm_supplier_item",
    # template becomes one row per template_code + version_no.
    "ai_prompt_template_version": "ai_prompt_template",
    # All participation and survey facts point to a concrete campaign version;
    # campaign_code groups versions without a separate family row.
    "mkt_campaign": "mkt_campaign_version",
    # location_id + business_date already identifies a shift-plan family.
    "ops_shift_plan": "ops_shift_plan_version",
    # Business and execution idempotency keys live on the queued message;
    # attempts/events determine success without a second confirmation table.
    "msg_push_deduplication": "msg_outbound_message",
    # Every receipt and line must reference the concrete supplier-confirmed
    # revision; purchase_order_code groups revisions without an empty family row.
    "scm_purchase_order": "scm_purchase_order_revision",
}


DERIVED_R5_TABLES = {
    "ops_demand_factor_observation": "v_ops_holiday_factor",
    "scm_material_requirement_line": "v_scm_material_requirement_line",
    "cost_card_product_cost_snapshot": "v_cost_card_product_cost_snapshot",
    "cost_card_product_cost_component": "v_cost_card_product_cost_component",
}


REMOVED_R5_TABLES = {
    "app_data_quality_issue": "跨域 entity_type/entity_id 工单会制造无外键的多态副本；质量状态由各域核对视图统一派生，若未来确需人工工单，应由独立工单系统引用 rule_code 与证据链接，不反向成为事实来源。",
    "cost_card_cost_run": "成本完全由版本化配方、采用价与单位换算确定；刷新运行统一记录到 app_job_run。",
}


CORE_TABLES = CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES
EXTENSION_TABLES = set().union(*EXTENSION_PACKS.values())
PHYSICAL_TABLES = CORE_TABLES | EXTENSION_TABLES | SOURCE_CONDITIONAL_TABLES


# Exact, independently produced Claude Fable 5 dispositions from
# evidence/claude-fable-5-r6-minimal-foundation.md.  This is historical
# provenance, not the final R6 decision.  Keeping it separate prevents a later
# tightening from being falsely attributed to the independent reviewer.
CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS = {
    **{name: "CORE_KEEP" for name in CORE_TABLES},
    **{name: "EXTENSION_LATER" for name in EXTENSION_TABLES},
    **{name: "DEFER_SOURCE" for name in SOURCE_CONDITIONAL_TABLES},
    "app_data_quality_issue": "REMOVE",
    "ops_calendar_import_batch": "CORE_MERGE_INTO:app_job_run",
    "ops_production_plan": "CORE_KEEP",
    "cost_card_recipe": "CORE_KEEP",
    "ops_plan_adjustment": "CORE_MERGE_INTO:ops_production_plan_version",
    "hr_trial": "CORE_MERGE_INTO:hr_appointment",
    "scm_supplier_item_material_mapping": "CORE_MERGE_INTO:scm_supplier_item",
    "ai_prompt_template_version": "CORE_MERGE_INTO:ai_prompt_template",
    "mkt_campaign": "CORE_KEEP",
    "ops_shift_plan": "EXTENSION_LATER",
    "msg_push_deduplication": "CORE_KEEP",
    "scm_purchase_order": "EXTENSION_LATER",
    "ops_demand_factor_observation": "DERIVE_VIEW",
    "scm_material_requirement_line": "EXTENSION_LATER",
    "cost_card_product_cost_snapshot": "DERIVE_VIEW",
    "cost_card_product_cost_component": "DERIVE_VIEW",
    "cost_card_cost_run": "REMOVE",
}

CLAUDE_FABLE_5_EXPECTED_COUNTS = {
    "CORE_KEEP": 104,
    "EXTENSION_LATER": 36,
    "DERIVE_VIEW": 3,
    "CORE_MERGE_INTO": 5,
    "REMOVE": 2,
    "DEFER_SOURCE": 4,
}


TIER_NAMES = {
    "CORE_BUSINESS": "首期业务事实核心",
    "CORE_PLATFORM": "首期运行技术侧车",
    "SOURCE_CONDITIONAL": "来源合同验证后才建",
}
EXTENSION_PACK_NAMES = {
    "FINE_GRAINED_ACCESS": "细粒度权限",
    "SHIFT_AND_WORKFORCE": "班表、工作量与工位",
    "PRODUCTION_EXECUTION": "生产执行与配送",
    "TRAINING_AND_ONBOARDING": "培训与入职",
    "PROCUREMENT_AND_INVENTORY": "采购、库存、订货与收货",
    "CHANNEL_RECEIPTS": "消息渠道回执",
}


def tier_for_table(table_name: str) -> str:
    if table_name in CORE_BUSINESS_TABLES:
        return "CORE_BUSINESS"
    if table_name in CORE_PLATFORM_TABLES:
        return "CORE_PLATFORM"
    if table_name in SOURCE_CONDITIONAL_TABLES:
        return "SOURCE_CONDITIONAL"
    for pack_code, names in EXTENSION_PACKS.items():
        if table_name in names:
            return f"EXTENSION_PACK:{pack_code}"
    raise KeyError(table_name)


def validate_minimal_foundation(active_table_names: set[str]) -> dict[str, int]:
    errors: list[str] = []
    categories = [CORE_BUSINESS_TABLES, CORE_PLATFORM_TABLES, EXTENSION_TABLES, SOURCE_CONDITIONAL_TABLES]
    counts = Counter(name for category in categories for name in category)
    duplicates = sorted(name for name, count in counts.items() if count != 1)
    if duplicates:
        errors.append(f"R6 tier overlap: {duplicates}")
    if PHYSICAL_TABLES != active_table_names:
        errors.append(
            f"R6 physical table mismatch: missing={sorted(PHYSICAL_TABLES-active_table_names)}, "
            f"extra={sorted(active_table_names-PHYSICAL_TABLES)}"
        )
    original_r5 = PHYSICAL_TABLES | set(MERGED_R5_TABLES) | set(DERIVED_R5_TABLES) | set(REMOVED_R5_TABLES)
    if len(original_r5) != 154:
        errors.append(f"R5 disposition coverage must be 154, got {len(original_r5)}")
    if set(CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS) != original_r5:
        errors.append(
            "Claude provenance coverage mismatch: "
            f"missing={sorted(original_r5-set(CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS))}, "
            f"extra={sorted(set(CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS)-original_r5)}"
        )
    claude_counts = Counter(value.split(":", 1)[0] for value in CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS.values())
    if dict(claude_counts) != CLAUDE_FABLE_5_EXPECTED_COUNTS:
        errors.append(
            f"Claude provenance count mismatch: {dict(claude_counts)} != {CLAUDE_FABLE_5_EXPECTED_COUNTS}"
        )
    if errors:
        raise AssertionError("\n".join(errors))
    return {
        "core_business_table_count": len(CORE_BUSINESS_TABLES),
        "core_platform_table_count": len(CORE_PLATFORM_TABLES),
        "phase1_core_table_count": len(CORE_TABLES),
        "extension_table_count": len(EXTENSION_TABLES),
        "source_conditional_table_count": len(SOURCE_CONDITIONAL_TABLES),
        "physical_table_count": len(PHYSICAL_TABLES),
        "merged_r5_table_count": len(MERGED_R5_TABLES),
        "derived_r5_table_count": len(DERIVED_R5_TABLES),
        "removed_r5_table_count": len(REMOVED_R5_TABLES),
        "original_r5_disposition_count": len(original_r5),
    }
