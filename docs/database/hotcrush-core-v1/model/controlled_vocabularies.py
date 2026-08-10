"""Compile explicitly declared text vocabularies into database checks.

Descriptions are documentation, never parser input.  A text field receives a
generated CHECK only when its ``(table, field)`` key is registered below as a
closed or open governed vocabulary.  Every other text field is ordinary text
(``NONE``) even when its prose contains uppercase terms such as RES, POS, API,
or URL.
"""

from __future__ import annotations

import re
from dataclasses import replace


# Closed vocabularies whose source field declarations do not already carry a
# local CHECK.  Values are deliberately repeated here instead of inferred from
# prose: changing a finite business vocabulary must be an explicit model diff.
EXPLICIT_CLOSED_VOCABULARIES = {
    ("pos_ingest_batch", "coverage_scope"): ("ALL_ORDER_ITEMS", "MEMBER_FLAGGED_ONLY"),
    ("ops_calendar_event", "event_type"): ("PUBLIC_HOLIDAY", "SCHOOL_HOLIDAY", "EVENT", "CLOSURE"),
    ("ops_calendar_event", "status"): ("ACTIVE", "CANCELLED", "SUPERSEDED"),
    ("ops_operational_event", "event_type"): (
        "POWER_OUTAGE", "EQUIPMENT_FAILURE", "PROMOTION", "FOOTFALL_SURGE", "STAFF_SHORTAGE", "OTHER",
    ),
    ("ops_operational_event", "impact_direction"): ("INCREASE", "DECREASE", "MIXED", "UNKNOWN"),
    ("ops_operational_event", "status"): ("OPEN", "CONFIRMED", "RESOLVED", "REJECTED"),
    ("ops_operational_event_product", "impact_direction"): (
        "INCREASE", "DECREASE", "UNAVAILABLE", "UNKNOWN",
    ),
    ("ops_forecast_run", "status"): ("RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "REJECTED"),
    ("ops_forecast_line", "quality_status"): ("COMPLETE", "LOW_HISTORY", "UNMAPPED_INPUT", "REJECTED"),
    ("ops_production_plan_version", "status"): (
        "DRAFT", "SUBMITTED", "APPROVED", "PUBLISHED", "SUPERSEDED", "REJECTED", "CANCELLED",
    ),
    ("ops_workload_run", "status"): ("RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "REJECTED"),
    ("ops_workload_line", "workload_unit"): ("PRODUCT_EA", "ORDER", "CUSTOMER", "OPEN_HOUR", "MANUAL"),
    ("ops_production_run", "status"): ("IN_PROGRESS", "COMPLETED", "CANCELLED", "REJECTED"),
    ("ops_dispatch", "status"): ("PLANNED", "DISPATCHED", "RECEIVED", "PARTIAL", "CANCELLED"),
    ("ops_daily_review", "status"): ("DRAFT", "SUBMITTED", "APPROVED", "SUPERSEDED"),
    ("ops_review_action", "action_type"): (
        "PLAN_ADJUSTMENT", "TRAINING", "MAINTENANCE", "SUPPLY", "STAFFING", "OTHER",
    ),
    ("ops_review_action", "status"): ("OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED", "REJECTED"),
    ("ops_business_rule", "status"): ("DRAFT", "APPROVED", "ACTIVE", "RETIRED"),
    ("hr_job_requisition", "employment_type"): ("FULL_TIME", "PART_TIME", "CONTRACTOR", "INTERN", "CASUAL"),
    ("hr_job_requisition", "status"): ("DRAFT", "APPROVED", "OPEN", "ON_HOLD", "FILLED", "CANCELLED"),
    ("hr_application_stage_event", "to_stage"): (
        "NEW", "CONTACTING", "INTERVIEW", "TRIAL", "OFFER", "HIRED", "REJECTED", "WITHDRAWN", "TALENT_POOL",
    ),
    ("hr_appointment", "appointment_type"): ("INTERVIEW", "TRIAL", "DOCUMENT", "OTHER"),
    ("hr_appointment", "status"): (
        "PROPOSED", "CONFIRMED", "COMPLETED", "NO_SHOW", "STOPPED", "CANCELLED", "RESCHEDULED",
    ),
    ("hr_appointment", "trial_outcome"): ("PASS", "CONDITIONAL_PASS", "FAIL", "INCOMPLETE"),
    ("hr_assessment", "assessment_type"): ("SCREENING", "INTERVIEW", "TRIAL", "KPA", "OTHER"),
    ("hr_assessment", "recommendation"): ("STRONG_HIRE", "HIRE", "HOLD", "NO_HIRE", "INCOMPLETE"),
    ("hr_offer", "status"): ("DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN", "SUPERSEDED"),
    ("hr_onboarding_task", "status"): ("PENDING", "IN_PROGRESS", "COMPLETED", "WAIVED", "CANCELLED"),
    ("hr_employee_event", "event_type"): (
        "CONFIRMATION", "TRANSFER", "PROMOTION", "DISCIPLINE", "SUSPENSION", "RESIGNATION", "TERMINATION", "OTHER",
    ),
    ("hr_screening_rule", "rule_type"): ("ELIGIBILITY", "RISK_SIGNAL", "QUESTION_PROMPT"),
    ("hr_screening_rule", "status"): ("DRAFT", "APPROVED", "ACTIVE", "RETIRED"),
    ("hr_training_course", "course_type"): ("MANDATORY", "ROLE_SKILL", "LEADERSHIP", "OTHER"),
    ("hr_training_course", "status"): ("DRAFT", "ACTIVE", "RETIRED"),
    ("hr_training_course_version", "status"): ("DRAFT", "PUBLISHED", "RETIRED"),
    ("hr_training_assignment", "assignment_reason"): (
        "ONBOARDING", "ROLE_REQUIREMENT", "RENEWAL", "REMEDIAL", "MANUAL",
    ),
    ("hr_training_assignment", "status"): (
        "ASSIGNED", "IN_PROGRESS", "COMPLETED", "WAIVED", "EXPIRED", "CANCELLED",
    ),
    ("hr_training_result", "result"): ("PASS", "FAIL", "INCOMPLETE", "WAIVED"),
    ("ops_role", "role_family"): ("KITCHEN", "FRONT", "LOGISTICS", "MANAGEMENT", "SUPPORT"),
    ("ops_role", "status"): ("ACTIVE", "RETIRED"),
    ("ops_station", "station_type"): ("PRODUCTION", "SERVICE", "CASHIER", "CLEANING", "LOGISTICS", "OTHER"),
    ("ops_station", "status"): ("ACTIVE", "MAINTENANCE", "RETIRED"),
    ("ops_shift_plan_version", "status"): (
        "DRAFT", "VALIDATING", "APPROVED", "PUBLISHED", "SUPERSEDED", "REJECTED", "CANCELLED",
    ),
    ("ops_shift_assignment", "eligibility_status"): (
        "ELIGIBLE", "MISSING_TRAINING", "EXPIRED_TRAINING", "INACTIVE_EMPLOYMENT", "OVERRIDDEN",
    ),
    ("ops_shift_assignment", "status"): ("PLANNED", "CONFIRMED", "CANCELLED", "NO_SHOW", "COMPLETED"),
    ("hr_timesheet_sync_batch", "status"): ("RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "REJECTED"),
    ("hr_timesheet_entry", "quality_status"): (
        "COMPLETE", "MISSING_IDENTITY", "MISSING_CLOCK", "OVERLAP", "MANUAL_OVERRIDE",
    ),
    ("scm_supplier", "status"): ("PENDING", "ACTIVE", "SUSPENDED", "RETIRED"),
    ("scm_supplier_item_mapping_review", "reason_code"): (
        "NO_CANDIDATE", "MULTIPLE_CANDIDATES", "UNIT_CONFLICT", "SPEC_CONFLICT",
    ),
    ("scm_supplier_item_mapping_review", "status"): ("OPEN", "APPROVED", "REJECTED", "DEFERRED"),
    ("scm_inventory_count", "count_type"): ("FULL", "CYCLE", "SPOT", "IMPORTED_MONTH_END"),
    ("scm_inventory_count", "status"): ("DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "SUPERSEDED"),
    ("scm_inventory_count_line", "quality_status"): (
        "COMPLETE", "UNIT_UNMAPPED", "MATERIAL_UNMAPPED", "REJECTED",
    ),
    ("scm_inventory_movement", "movement_type"): (
        "RECEIPT", "TRANSFER", "PRODUCTION_CONSUMPTION", "ADJUSTMENT", "WASTE", "RETURN",
    ),
    ("scm_inventory_movement", "status"): ("DRAFT", "POSTED", "REVERSED", "REJECTED"),
    ("scm_material_requirement_run", "status"): ("RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "REJECTED"),
    ("scm_material_requirement_component", "quality_status"): (
        "COMPLETE", "MISSING_RECIPE", "MISSING_MAPPING", "UNIT_ERROR", "REJECTED",
    ),
    ("scm_replenishment_run", "status"): ("RUNNING", "SUCCEEDED", "PARTIAL", "FAILED", "REJECTED"),
    ("scm_replenishment_line", "adjustment_reason_code"): (
        "MOQ", "SUPPLIER_CAPACITY", "MARKET_PRICE", "STORAGE_LIMIT", "JUDGEMENT", "OTHER",
    ),
    ("scm_replenishment_line", "status"): ("SUGGESTED", "APPROVED", "REJECTED", "ORDERED"),
    ("scm_purchase_order_revision", "status"): (
        "DRAFT", "SUBMITTED", "APPROVED", "SENT", "CONFIRMED", "SUPERSEDED", "REJECTED", "CANCELLED",
    ),
    ("scm_goods_receipt", "status"): ("DRAFT", "POSTED", "PARTIAL", "REJECTED", "REVERSED"),
    ("scm_supplier_price_observation", "observation_type"): (
        "QUOTE", "PO_CONFIRMED", "RECEIPT_ACTUAL", "MANUAL_MARKET_CHECK",
    ),
    ("scm_supplier_price_observation", "quality_status"): (
        "VERIFIED", "UNVERIFIED", "UNIT_ERROR", "FX_MISSING", "REJECTED",
    ),
    ("cost_card_recipe_version", "status"): ("DRAFT", "PUBLISHED", "ARCHIVED", "REJECTED"),
    ("cost_card_material_price", "quality_status"): ("VERIFIED", "ESTIMATED", "STALE", "UNIT_ERROR", "REJECTED"),
    ("finance_import_batch", "dataset_code"): (
        "SALES_DAILY", "ITEM_SALES_MONTHLY", "MONTHLY_COST", "CASHFLOW", "ORDER_LOGISTICS",
        "INVENTORY_SNAPSHOT", "INVENTORY_FLOW", "SUPPLIER_PURCHASE_MONTHLY", "MONTHLY_METRIC",
    ),
    ("finance_import_batch", "status"): ("UPLOADED", "VALIDATED", "APPROVED", "LOADED", "REJECTED", "FAILED"),
    ("finance_sales_daily", "quality_status"): ("COMPLETE", "PARTIAL", "UNMAPPED_LOCATION", "REJECTED"),
    ("finance_item_sales_monthly", "quality_status"): ("COMPLETE", "UNMAPPED_PRODUCT", "PARTIAL", "REJECTED"),
    ("finance_monthly_cost_line", "cost_domain"): ("MATERIAL", "LABOR", "LOGISTICS", "OPERATING_EXPENSE", "OTHER"),
    ("finance_monthly_cost_line", "quality_status"): ("COMPLETE", "UNCLASSIFIED", "PARTIAL", "REJECTED"),
    ("finance_cashflow_line", "cashflow_code"): (
        "OPENING_BALANCE", "CASH_IN", "CASH_OUT", "REFUND", "BANK_DEPOSIT", "CLOSING_BALANCE",
    ),
    ("finance_order_logistics_line", "quality_status"): (
        "COMPLETE", "UNMAPPED_SUPPLIER", "UNMAPPED_MATERIAL", "PARTIAL", "REJECTED",
    ),
    ("finance_inventory_snapshot_line", "purchase_type"): ("LOCAL", "IMPORT", "UNKNOWN"),
    ("finance_inventory_snapshot_line", "quality_status"): (
        "COMPLETE", "UNMAPPED_MATERIAL", "UNIT_UNMAPPED", "PARTIAL", "REJECTED",
    ),
    ("finance_inventory_flow_line", "warehouse_type"): ("AMBIENT", "FROZEN", "CHILLED", "OTHER"),
    ("finance_inventory_flow_line", "quality_status"): (
        "COMPLETE", "BALANCE_MISMATCH", "UNMAPPED_MATERIAL", "REJECTED",
    ),
    ("finance_supplier_purchase_monthly", "quality_status"): (
        "COMPLETE", "UNMAPPED_SUPPLIER", "UNMAPPED_MATERIAL", "PARTIAL", "REJECTED",
    ),
    ("finance_target", "status"): ("DRAFT", "APPROVED", "ACTIVE", "SUPERSEDED"),
    ("finance_monthly_metric", "quality_status"): ("COMPLETE", "UNCLASSIFIED", "PARTIAL", "REJECTED"),
    ("finance_period_category_map", "target_category"): (
        "SELLING", "ADMINISTRATIVE", "FINANCE", "R_AND_D", "EXCLUDED",
    ),
    ("finance_period_category_map", "status"): ("DRAFT", "ACTIVE", "RETIRED"),
    ("mkt_campaign_version", "campaign_type"): ("SURVEY", "PROMOTION", "LOYALTY", "COUPON", "OTHER"),
    ("mkt_campaign_version", "status"): (
        "DRAFT", "APPROVED", "PUBLISHED", "PAUSED", "COMPLETED", "ARCHIVED", "SUPERSEDED", "CANCELLED",
    ),
    ("mkt_campaign_member", "eligibility_status"): ("ELIGIBLE", "INELIGIBLE", "PENDING", "OVERRIDDEN"),
    ("mkt_campaign_member", "status"): ("INVITED", "STARTED", "COMPLETED", "EXPIRED", "CANCELLED", "BLOCKED"),
    ("mkt_survey_question", "question_type"): ("SINGLE_CHOICE", "MULTIPLE_CHOICE", "RATING", "TEXT", "BOOLEAN"),
    ("mkt_survey_response", "status"): ("IN_PROGRESS", "SUBMITTED", "VALIDATED", "REJECTED", "ABANDONED"),
    ("mkt_reward", "reward_type"): ("PHYSICAL_GIFT", "COUPON", "POINTS", "BENEFIT"),
    ("mkt_reward", "status"): ("ACTIVE", "SUSPENDED", "RETIRED"),
    ("mkt_reward_claim", "status"): ("RESERVED", "REDEEMED", "EXPIRED", "CANCELLED", "REJECTED"),
    ("msg_conversation", "channel_code"): ("WHATSAPP", "WEB_CHAT", "LARK", "OTHER"),
    ("msg_conversation", "status"): ("OPEN", "WAITING_USER", "WAITING_AGENT", "CLOSED", "OPTED_OUT", "BLOCKED"),
    ("msg_message", "direction"): ("INBOUND", "OUTBOUND", "SYSTEM"),
    ("msg_message", "sender_type"): ("PERSON", "MEMBER", "APP_USER", "SERVICE", "CHANNEL"),
    ("msg_message", "content_type"): ("TEXT", "IMAGE", "FILE", "AUDIO", "TEMPLATE", "EVENT"),
    ("msg_message", "acceptance_status"): ("RECEIVED", "QUEUED", "SENT", "FAILED", "REJECTED"),
    ("msg_conversation_state", "status"): ("ACTIVE", "COMPLETED", "EXPIRED", "CANCELLED", "ERROR"),
    ("msg_outbound_message", "channel_code"): ("WHATSAPP", "LARK", "EMAIL", "OTHER"),
    ("msg_outbound_message", "status"): ("QUEUED", "PROCESSING", "SENT", "FAILED", "CANCELLED", "EXPIRED"),
    ("msg_delivery_attempt", "result"): ("SENT", "RETRYABLE_FAILURE", "PERMANENT_FAILURE", "UNKNOWN"),
    ("msg_delivery_event", "event_type"): ("SENT", "DELIVERED", "READ", "FAILED", "REJECTED", "UNKNOWN"),
    ("ai_prompt_segment", "segment_category"): ("ROLE", "RULE", "KNOWLEDGE", "CONTEXT", "FORMAT"),
    ("ai_prompt_segment", "status"): ("DRAFT", "APPROVED", "ACTIVE", "RETIRED", "REJECTED"),
    ("ai_prompt_template", "status"): ("DRAFT", "APPROVED", "ACTIVE", "RETIRED", "REJECTED"),
    ("ai_prompt_template_segment", "role"): ("SYSTEM", "DEVELOPER", "USER", "CONTEXT"),
    ("ai_call", "validation_status"): (
        "VALID", "INVALID_SCHEMA", "SAFETY_BLOCKED", "INCOMPLETE", "NOT_APPLICABLE",
    ),
    ("ai_call", "status"): ("RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED"),
}


# These codes are deliberately extensible.  Their descriptions give examples,
# not a complete enum.  A release that introduces a new code must document its
# owner and semantics, but does not require a physical dictionary table.
OPEN_GOVERNED_CODE_CHECKS = {
    ("ops_product", "category_code"): "category_code ~ '^[A-Z][A-Z0-9_]{1,63}$'",
    ("pos_daily_breakdown", "dimension_type"): "dimension_type ~ '^[A-Z][A-Z0-9_]{1,63}$'",
    ("pos_daily_breakdown", "quantity_unit"): "quantity_unit IS NULL OR quantity_unit ~ '^[A-Z][A-Z0-9_]{1,63}$'",
    ("scm_inventory_movement", "manual_reason_code"): "manual_reason_code IS NULL OR manual_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'",
    ("finance_target", "metric_code"): "metric_code ~ '^[A-Z][A-Z0-9_]{1,63}$'",
    ("finance_target", "unit"): "unit ~ '^[A-Z][A-Z0-9_]{1,31}$'",
    ("finance_monthly_metric", "unit"): "unit ~ '^[A-Z][A-Z0-9_]{1,31}$'",
    ("msg_conversation_state", "workflow_code"): "workflow_code ~ '^[A-Z][A-Z0-9_]{1,63}$'",
    ("msg_outbound_message", "push_kind"): "push_kind IS NULL OR push_kind ~ '^[A-Z][A-Z0-9_]{1,63}$'",
    ("ai_prompt_template", "model_provider"): "model_provider ~ '^[A-Z][A-Z0-9_]{1,31}$'",
}


# Regression contract for the exact source-prose fields that exposed the old
# uppercase-token heuristic.  These are source values, not RES/POS enums.
POS_PRODUCT_LISTING_ORDINARY_TEXT_FIELDS = frozenset({
    "source_menu_item_code",
    "source_name_en",
    "source_name_zh",
    "source_category_id",
    "source_category_en",
    "source_category_zh",
    "source_specification",
})

TEXT_VOCABULARY_TYPES = frozenset({"text", "citext", "char(3)"})
_SQL_TEXT_LITERAL = re.compile(r"^'((?:''|[^'])*)'$" )


def vocabulary_kind(table_name: str, field_name: str) -> str:
    """Return the explicit vocabulary policy: CLOSED, OPEN, or NONE."""
    key = (table_name, field_name)
    if key in EXPLICIT_CLOSED_VOCABULARIES:
        return "CLOSED"
    if key in OPEN_GOVERNED_CODE_CHECKS:
        return "OPEN"
    return "NONE"


def _closed_check(field_name: str, values: tuple[str, ...], nullable: bool) -> str:
    literal = ",".join(f"'{value}'" for value in values)
    predicate = f"{field_name} IN ({literal})"
    return f"{field_name} IS NULL OR {predicate}" if nullable else predicate


def closed_vocabulary_accepts(table_name: str, field_name: str, value: str) -> bool:
    """Model-level membership predicate used by the package validator."""
    values = EXPLICIT_CLOSED_VOCABULARIES[(table_name, field_name)]
    return value in values


def apply_controlled_vocabulary_checks(tables):
    """Return tables with only explicitly registered vocabulary checks."""
    result = []
    for table in tables:
        fields = []
        for field in table.fields:
            key = (table.name, field.name)
            if field.fk or field.checks or field.data_type not in TEXT_VOCABULARY_TYPES:
                fields.append(field)
                continue
            kind = vocabulary_kind(*key)
            if kind == "CLOSED":
                values = EXPLICIT_CLOSED_VOCABULARIES[key]
                fields.append(replace(field, checks=(_closed_check(field.name, values, field.nullable),)))
            elif kind == "OPEN":
                fields.append(replace(field, checks=(OPEN_GOVERNED_CODE_CHECKS[key],)))
            else:
                fields.append(field)
        result.append(replace(table, fields=tuple(fields)))
    return tuple(result)


def _sql_text_literal(value: str | None) -> str | None:
    if value is None:
        return None
    match = _SQL_TEXT_LITERAL.fullmatch(value)
    return match.group(1).replace("''", "'") if match else None


def validate_controlled_vocabulary_contracts(tables) -> dict[str, int]:
    """Validate compiler classification, examples/defaults, and regressions."""
    errors: list[str] = []
    fields = {
        (table.name, field.name): field
        for table in tables
        for field in table.fields
    }

    overlap = set(EXPLICIT_CLOSED_VOCABULARIES) & set(OPEN_GOVERNED_CODE_CHECKS)
    if overlap:
        errors.append(f"closed/open vocabulary registrations overlap: {sorted(overlap)}")

    defaults_checked = 0
    examples_checked = 0
    allowed_values_checked = 0
    illegal_values_rejected = 0
    for key, values in EXPLICIT_CLOSED_VOCABULARIES.items():
        field = fields.get(key)
        label = ".".join(key)
        if field is None:
            errors.append(f"closed vocabulary references unknown field: {label}")
            continue
        if field.data_type not in TEXT_VOCABULARY_TYPES or field.fk:
            errors.append(f"closed vocabulary field is not unconstrained text: {label}")
            continue
        if not values or len(values) != len(set(values)):
            errors.append(f"closed vocabulary is empty or contains duplicates: {label}")
        expected_check = _closed_check(field.name, values, field.nullable)
        if field.checks != (expected_check,):
            errors.append(f"closed vocabulary CHECK mismatch: {label}")
        for value in values:
            allowed_values_checked += 1
            if not closed_vocabulary_accepts(*key, value):
                errors.append(f"closed vocabulary rejects declared value: {label}={value}")
        illegal_value = f"__ILLEGAL_{field.name.upper()}__"
        illegal_values_rejected += 1
        if closed_vocabulary_accepts(*key, illegal_value):
            errors.append(f"closed vocabulary accepts illegal value: {label}={illegal_value}")
        default_value = _sql_text_literal(field.default)
        if default_value is not None:
            defaults_checked += 1
            if not closed_vocabulary_accepts(*key, default_value):
                errors.append(f"closed vocabulary default is not declared: {label}={default_value}")
        examples_checked += 1
        if not closed_vocabulary_accepts(*key, field.example):
            errors.append(f"closed vocabulary example is not declared: {label}={field.example}")

    for key, expected_check in OPEN_GOVERNED_CODE_CHECKS.items():
        field = fields.get(key)
        label = ".".join(key)
        if field is None:
            errors.append(f"open vocabulary references unknown field: {label}")
        elif field.checks != (expected_check,):
            errors.append(f"open vocabulary CHECK mismatch: {label}")

    listing_fields = {
        key[1]: field
        for key, field in fields.items()
        if key[0] == "pos_product_listing" and key[1] in POS_PRODUCT_LISTING_ORDINARY_TEXT_FIELDS
    }
    if set(listing_fields) != set(POS_PRODUCT_LISTING_ORDINARY_TEXT_FIELDS):
        missing = sorted(POS_PRODUCT_LISTING_ORDINARY_TEXT_FIELDS - set(listing_fields))
        errors.append(f"pos_product_listing ordinary-text regression fields missing: {missing}")
    for field_name, field in listing_fields.items():
        if vocabulary_kind("pos_product_listing", field_name) != "NONE" or field.checks:
            errors.append(f"uppercase source prose inferred a vocabulary: pos_product_listing.{field_name}")

    # Synthetic coverage makes the intended boundary explicit even if the
    # seven production descriptions are later reworded.
    listing_table = next((table for table in tables if table.name == "pos_product_listing"), None)
    if listing_table is not None and listing_fields:
        sample = next(iter(listing_fields.values()))
        synthetic_field = replace(
            sample,
            name="uppercase_prose_regression",
            description="RES/POS API URL source prose must remain ordinary text.",
            checks=(),
        )
        synthetic_table = replace(
            listing_table,
            name="__uppercase_prose_regression__",
            fields=(synthetic_field,),
        )
        compiled = apply_controlled_vocabulary_checks((synthetic_table,))[0].fields[0]
        if compiled.checks or vocabulary_kind(synthetic_table.name, synthetic_field.name) != "NONE":
            errors.append("RES/POS/API/URL prose inferred a controlled vocabulary")

    if errors:
        raise AssertionError("\n".join(errors))
    return {
        "explicit_closed_vocabulary_count": len(EXPLICIT_CLOSED_VOCABULARIES),
        "explicit_closed_value_count": sum(len(values) for values in EXPLICIT_CLOSED_VOCABULARIES.values()),
        "explicit_open_vocabulary_count": len(OPEN_GOVERNED_CODE_CHECKS),
        "ordinary_text_regression_field_count": len(POS_PRODUCT_LISTING_ORDINARY_TEXT_FIELDS),
        "closed_defaults_checked": defaults_checked,
        "closed_examples_checked": examples_checked,
        "closed_allowed_values_checked": allowed_values_checked,
        "closed_illegal_values_rejected": illegal_values_rejected,
    }
