"""R6 physical-persistence audit for the reduced HOT CRUSH foundation.

This module deliberately audits two different questions:

1. Is one row atomic inside its table?
2. Is the table itself necessary as physical state?

R5 answered only the first question and therefore incorrectly allowed all 154
proposed tables to pass.  R6 classifies the surviving physical contracts
as phase-1 business/platform state, optional extension state, or
source-conditional state.  The eleven merged, four derived and two removed R5
objects are tracked in ``minimal_foundation.py`` and must not reappear here.
"""

from __future__ import annotations

from dataclasses import dataclass

from .minimal_foundation import (
    CORE_BUSINESS_TABLES,
    CORE_PLATFORM_TABLES,
    DERIVED_R5_TABLES,
    EXTENSION_TABLES,
    MERGED_R5_TABLES,
    REMOVED_R5_TABLES,
    SOURCE_CONDITIONAL_TABLES,
    validate_minimal_foundation,
)
from .target_model import TABLES, TABLE_BY_NAME


@dataclass(frozen=True)
class StorageAudit:
    table_name: str
    storage_class: str
    minimum_grain_verdict: str
    derivability: str
    physical_reason: str
    derived_fields: tuple[str, ...]
    action: str
    original_r4_disposition: str
    claude_fable_5_result: str


# Historical compatibility export only.  R6 generation no longer interprets
# these as newly approved physical tables.
NEW_R5: set[str] = set()


CORE_MASTER_TABLES = {
    "app_source_system", "app_unit",
    "ops_location", "ops_location_source_identity", "ops_product", "ops_product_alias",
    "ops_business_rule", "ops_role", "ops_station", "ops_role_training_requirement",
    "pos_product_listing", "pos_product_mapping", "pos_member", "pos_member_contact",
    "pos_member_card",
    "hr_person", "hr_person_contact", "hr_employment", "hr_employment_source_identity",
    "hr_screening_rule", "hr_training_course", "hr_training_course_version",
    "scm_material", "scm_material_alias", "scm_material_source_identity",
    "scm_material_unit_conversion", "scm_supplier", "scm_supplier_item",
    "cost_card_recipe_version", "cost_card_recipe_component",
    "cost_card_material_price",
    "finance_target", "finance_period_category_map",
    "mkt_campaign_version", "mkt_survey_question",
    "mkt_survey_question_option", "mkt_reward",
    "ai_prompt_segment", "ai_prompt_template", "ai_prompt_template_segment",
} & CORE_BUSINESS_TABLES


# These values are mathematically derivable at calculation time, but the
# historical output became a proposal, approval input, promise, or entitlement.
# Saving the versioned decision is therefore an irreducible historical fact;
# current summaries and deltas remain views.
CORE_DECISION_OUTPUT_TABLES = {
    "ops_forecast_run", "ops_forecast_line",
    "ops_production_plan_version", "ops_production_plan_line",
    "ops_production_plan_slot", "ops_workload_run", "ops_workload_line",
    "scm_material_requirement_run",
    "scm_material_requirement_component", "scm_replenishment_run",
    "scm_replenishment_line", "mkt_survey_result",
} & CORE_BUSINESS_TABLES


CORE_WORKFLOW_TABLES = {
    table.name
    for table in TABLES
    if table.name in CORE_BUSINESS_TABLES
    and table.mutation_policy in {
        "APPEND_ONLY_DECISION_RECORD", "CONTROLLED_WORKFLOW",
        "CONTROLLED_QUEUE_STATE", "DRAFT_MUTABLE_THEN_FROZEN",
    }
} - CORE_MASTER_TABLES - CORE_DECISION_OUTPUT_TABLES


CORE_BASE_FACT_TABLES = (
    CORE_BUSINESS_TABLES
    - CORE_MASTER_TABLES
    - CORE_DECISION_OUTPUT_TABLES
    - CORE_WORKFLOW_TABLES
)


CLASSIFICATIONS = {
    "CORE_MASTER_IDENTITY": CORE_MASTER_TABLES,
    "CORE_BASE_FACT": CORE_BASE_FACT_TABLES,
    "CORE_DECISION_OUTPUT": CORE_DECISION_OUTPUT_TABLES,
    "CORE_WORKFLOW_FACT": CORE_WORKFLOW_TABLES,
    "CORE_PLATFORM_STATE": CORE_PLATFORM_TABLES,
    "EXTENSION_PACK": EXTENSION_TABLES,
    "SOURCE_CONDITIONAL": SOURCE_CONDITIONAL_TABLES,
}


DERIVED_FIELDS = {
    "pos_sales_day": ("average_order_value -> v_pos_sales_day_current",),
    "pos_member_balance_snapshot": (
        "partial flag and missing fields -> nullable balances + pos_ingest_batch status",
    ),
    "pos_member": (
        "has_card -> EXISTS(pos_member_card)",
        "has_profile/last_snapshot_date/level/growth/points/lifetime amounts/current balances -> v_pos_member_state_current from append-only snapshots",
    ),
    "pos_member_daily_metric": (
        "source/POS member-sales ratios -> v_pos_member_daily_summary",
        "card payment net and source/POS ratios -> v_pos_member_daily_summary",
        "topup total and stored-value face net -> v_pos_member_daily_summary",
        "partial flag and missing fields -> nullable measures + pos_ingest_batch status",
    ),
    "ops_production_plan_line": (
        "adjustment_delta -> compare quantity with based_on_plan_line_id",
    ),
    "ops_product_alias": ("normalized_alias -> NORMALIZE_ALIAS(alias_text)",),
    "scm_material_alias": ("normalized_alias -> NORMALIZE_ALIAS(alias_text)",),
    "scm_supplier_item": ("base_unit_quantity -> material unit conversion",),
    "scm_supplier_price_observation": (
        "normalized_price_myr -> raw price × FX rate ÷ unit conversion",
    ),
    "cost_card_recipe_component": (
        "base_unit_quantity -> input quantity × unit conversion",
    ),
    "ops_forecast_line": ("accuracy/error -> v_ops_forecast_accuracy",),
    "hr_assessment": ("total_score -> v_hr_assessment_summary",),
    "scm_material_requirement_component": (
        "planned product quantity -> immutable ops_production_plan_line",
        "material total/base unit/quality summary -> v_scm_material_requirement_line",
    ),
    "scm_replenishment_line": (
        "approved minus suggested delta -> v_scm_replenishment_trace",
    ),
    "scm_purchase_order_line": (
        "base unit quantity -> order quantity × unit conversion",
        "line currency -> referenced purchase-order revision",
    ),
    "scm_purchase_order_revision": (
        "header/line reconciliation -> v_scm_purchase_order_reconciliation",
    ),
    "mkt_reward_stock": (
        "available quantity and counter reconciliation -> v_mkt_reward_stock_reconciliation",
    ),
    "msg_conversation": ("last message display -> ordered msg_message",),
    "msg_outbound_message": (
        "attempt count and last error -> ordered msg_delivery_attempt",
        "successful daily-push deduplication -> queue natural key + delivery facts",
    ),
    "ai_prompt_template_segment": (
        "content/hash/variable schema -> referenced ai_prompt_segment version",
    ),
}


CLASS_REASON = {
    "CORE_MASTER_IDENTITY": "稳定身份、有效期映射、单位换算或已发布定义无法从交易结果可靠反推",
    "CORE_BASE_FACT": "这是来源原值或最小业务事件，是多种派生分析的不可替代输入",
    "CORE_DECISION_OUTPUT": "虽然数值可计算，但该版本曾被提出、批准或用于触发行动，历史决定本身不可从当前输入反推",
    "CORE_WORKFLOW_FACT": "人工决定、批准、状态转换或业务副作用本身就是事实，不能从最终结果倒推",
    "CORE_PLATFORM_STATE": "身份权限、幂等、安全、任务恢复、审计或投递恢复需要持久技术状态；它不是业务分析表",
    "EXTENSION_PACK": "只有对应模块启用并出现真实写入者、业务副作用或处理历史时才物理实施，首期不建",
    "SOURCE_CONDITIONAL": "外部来源身份、粒度、权限和重跑契约尚未验证，当前只保留目标契约，不建正式表",
}


ACTION_OVERRIDES = {
    "ops_production_plan_line": "R6_MERGE_INTO: absorb ops_plan_adjustment reason and provenance into a new plan-version line; derive delta",
    "ops_production_plan_version": "R6_MERGE_INTO: absorb ops_production_plan; location + business date is the stable plan identity",
    "ops_shift_plan_version": "R6_MERGE_INTO: absorb ops_shift_plan; location + business date is the stable shift-plan identity",
    "hr_appointment": "R6_MERGE_INTO: absorb hr_trial execution timestamps, outcome and safety incident",
    "scm_supplier_item": "R6_MERGE_INTO: each row is an effective-dated supplier SKU/material/package version; no separate mapping table",
    "cost_card_recipe_version": "R6_MERGE_INTO: absorb cost_card_recipe; recipe_code groups immutable versions",
    "mkt_campaign_version": "R6_MERGE_INTO: absorb mkt_campaign; campaign_code groups immutable versions",
    "ai_prompt_template": "R6_MERGE_INTO: each row is one immutable template version; no separate template-version table",
    "app_job_run": "R6_MERGE_INTO: calendar imports and cost refreshes use the generic job-run ledger",
    "msg_outbound_message": "R6_MERGE_INTO: absorb msg_push_deduplication; queue natural key plus delivery facts determines success",
    "scm_purchase_order_revision": "R6_MERGE_INTO: absorb scm_purchase_order; purchase_order_code groups immutable supplier-confirmed revisions",
}


def _validate_classifications() -> None:
    expected = set(TABLE_BY_NAME)
    seen: set[str] = set()
    overlaps: set[str] = set()
    for names in CLASSIFICATIONS.values():
        overlaps |= seen & names
        seen |= names
    missing = expected - seen
    unknown = seen - expected
    if overlaps or missing or unknown:
        raise AssertionError(
            f"R6 storage audit coverage invalid: overlaps={sorted(overlaps)}, "
            f"missing={sorted(missing)}, unknown={sorted(unknown)}"
        )


def _claude_result(table_name: str, storage_class: str) -> str:
    if table_name == "ops_production_plan_line":
        return "CLAUDE_CORE_KEEP; PLAN_ADJUSTMENT_MERGE_TARGET_CORRECTED_TO_LINE"
    if table_name in {
        "ops_production_plan_version",
        "cost_card_recipe_version", "mkt_campaign_version", "msg_outbound_message",
    }:
        return "CLAUDE_CORE_KEEP; CODEX_FURTHER_MERGED_REDUNDANT_CORE_SHELL"
    if table_name == "ops_shift_plan_version":
        return "CLAUDE_EXTENSION_LATER; CODEX_FURTHER_MERGED_REDUNDANT_EXTENSION_SHELL"
    if table_name == "scm_purchase_order_revision":
        return "CLAUDE_EXTENSION_LATER; CODEX_FURTHER_MERGED_REDUNDANT_EXTENSION_SHELL"
    if table_name in {"hr_appointment", "scm_supplier_item", "ai_prompt_template", "app_job_run"}:
        return "CLAUDE_KEEP_PLUS_MERGED_R5_OBJECT"
    if storage_class == "EXTENSION_PACK":
        return "CLAUDE_EXTENSION_LATER"
    if storage_class == "SOURCE_CONDITIONAL":
        return "CLAUDE_DEFER_SOURCE"
    return "CLAUDE_CORE_KEEP"


def build_storage_audits() -> tuple[StorageAudit, ...]:
    _validate_classifications()
    class_by_table = {
        name: storage_class
        for storage_class, names in CLASSIFICATIONS.items()
        for name in names
    }
    rows: list[StorageAudit] = []
    for table in TABLES:
        storage_class = class_by_table[table.name]
        if storage_class == "EXTENSION_PACK":
            verdict = "NOT_PHASE1_EXTENSION_ONLY"
            derivability = "NOT_APPLICABLE_UNTIL_MODULE_ENABLED"
        elif storage_class == "SOURCE_CONDITIONAL":
            verdict = "NOT_PHASE1_SOURCE_UNVERIFIED"
            derivability = "UNKNOWN_UNTIL_SOURCE_VERIFIED"
        elif storage_class == "CORE_DECISION_OUTPUT":
            verdict = "PASS_HISTORICAL_DECISION_FACT"
            derivability = "CALCULABLE_BUT_CURRENT_INPUTS_CANNOT_RECREATE_PAST_DECISION"
        elif storage_class == "CORE_PLATFORM_STATE":
            verdict = "PASS_PLATFORM_SIDECAR_NOT_BUSINESS_FACT"
            derivability = "NOT_DERIVABLE_FOR_RECOVERY_OR_SECURITY"
        else:
            verdict = "PASS_MINIMUM_PHYSICAL_FOUNDATION"
            derivability = "NO" if not DERIVED_FIELDS.get(table.name) else "PARTIAL_FIELDS_DERIVED_IN_VIEW"

        action = ACTION_OVERRIDES.get(
            table.name,
            "KEEP_IN_PHASE1" if storage_class.startswith("CORE_") else (
                "DESIGN_ONLY_DO_NOT_CREATE" if storage_class == "EXTENSION_PACK" else "DEFER_UNTIL_SOURCE_PROVEN"
            ),
        )
        if storage_class == "EXTENSION_PACK" and "DESIGN_ONLY_DO_NOT_CREATE" not in action:
            action = f"DESIGN_ONLY_DO_NOT_CREATE; {action}"
        rows.append(
            StorageAudit(
                table_name=table.name,
                storage_class=storage_class,
                minimum_grain_verdict=verdict,
                derivability=derivability,
                physical_reason=f"{table.purpose}；{CLASS_REASON[storage_class]}。",
                derived_fields=DERIVED_FIELDS.get(table.name, ()),
                action=action,
                original_r4_disposition="R5_PHYSICAL_CANDIDATE_REAUDITED_IN_R6",
                claude_fable_5_result=_claude_result(table.name, storage_class),
            )
        )
    return tuple(rows)


AUDITS = build_storage_audits()
AUDIT_BY_TABLE = {row.table_name: row for row in AUDITS}


def validate_storage_audit() -> dict[str, int]:
    _validate_classifications()
    foundation = validate_minimal_foundation(set(TABLE_BY_NAME))
    if len(AUDITS) != len(TABLES) or len(AUDIT_BY_TABLE) != len(TABLES):
        raise AssertionError("R6 storage audit row count does not match physical target catalog")
    if set(MERGED_R5_TABLES) & set(TABLE_BY_NAME):
        raise AssertionError("merged R5 objects reappeared as physical tables")
    if set(DERIVED_R5_TABLES) & set(TABLE_BY_NAME):
        raise AssertionError("derived R5 objects reappeared as physical tables")
    if set(REMOVED_R5_TABLES) & set(TABLE_BY_NAME):
        raise AssertionError("removed R5 objects reappeared as physical tables")
    return {
        "audited_physical_table_count": len(AUDITS),
        "phase1_core_table_count": len(CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES),
        "phase1_business_table_count": len(CORE_BUSINESS_TABLES),
        "phase1_platform_table_count": len(CORE_PLATFORM_TABLES),
        "extension_table_count": len(EXTENSION_TABLES),
        "source_conditional_table_count": len(SOURCE_CONDITIONAL_TABLES),
        "original_r5_disposition_count": foundation["original_r5_disposition_count"],
        **{
            storage_class.lower(): sum(row.storage_class == storage_class for row in AUDITS)
            for storage_class in CLASSIFICATIONS
        },
    }


if __name__ == "__main__":
    print(validate_storage_audit())
