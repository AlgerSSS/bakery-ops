"""Version-locked JSON validation contracts for behavior-driving payloads.

These are design guardrails, not executable DDL.  They make every field that
claims schema validation name both its discriminator and its enforcement path.
"""

SCHEMA_VALIDATED_FIELDS = {
    "ops_daily_review": (
        "manager_input",
        "manager_input_schema_version",
        "review_summary",
        "review_summary_schema_version",
    ),
    "ops_business_rule": ("rule_code", "rule_value", "schema_version"),
    "hr_employee_event": ("event_type", "event_data", "event_schema_version"),
    "msg_conversation_state": ("workflow_code", "workflow_version", "collected_data", "pending_action"),
    "msg_outbound_message": ("template_code", "template_version", "payload"),
    "ai_prompt_segment": ("segment_code", "version_no", "variable_schema"),
    "ai_prompt_template": ("template_code", "version_no", "output_schema"),
    "ai_call": ("prompt_template_id", "parsed_output", "validation_status"),
    "mkt_campaign_version": (
        "campaign_type",
        "rule_schema_version",
        "audience_rule",
        "participation_rule",
        "reward_rule",
    ),
    "hr_screening_rule": ("rule_type", "rule_schema_version", "rule_definition"),
    "mkt_survey_question": ("question_type", "validation_schema_version", "validation_rule"),
    "cost_card_recipe_component": ("is_optional", "condition_schema_version", "condition_rule"),
    "hr_offer": ("compensation_schema_version", "compensation_summary"),
}


# Every jsonb field must be classified here.  This is deliberately exhaustive:
# adding a jsonb column without deciding whether it can drive behavior makes the
# package validator fail instead of silently treating it as harmless evidence.
SCHEMA_VALIDATED_JSON_FIELDS = {
    "ops_daily_review": ("manager_input", "review_summary"),
    "ops_business_rule": ("rule_value",),
    "hr_employee_event": ("event_data",),
    "msg_conversation_state": ("collected_data", "pending_action"),
    "msg_outbound_message": ("payload",),
    "ai_prompt_segment": ("variable_schema",),
    "ai_prompt_template": ("output_schema",),
    "ai_call": ("parsed_output",),
    "mkt_campaign_version": ("audience_rule", "participation_rule", "reward_rule"),
    "hr_screening_rule": ("rule_definition",),
    "mkt_survey_question": ("validation_rule",),
    "cost_card_recipe_component": ("condition_rule",),
    "hr_offer": ("compensation_summary",),
}


NON_BEHAVIOR_JSON_FIELDS = frozenset({
    ("app_job_run", "input_manifest"),
    ("app_audit_event", "before_data"),
    ("app_audit_event", "after_data"),
    ("app_one_time_token", "metadata"),
    ("ops_location_source_identity", "evidence"),
    ("hr_employment_source_identity", "evidence"),
    ("hr_employment_mapping_review", "evidence"),
    ("scm_material_source_identity", "evidence"),
    ("pos_product_mapping", "evidence"),
    ("pos_product_mapping_review", "evidence"),
    ("ops_stockout_event", "evidence"),
    ("ops_operational_event", "evidence"),
    ("ops_forecast_run", "input_manifest"),
    ("ops_forecast_line", "model_explanation"),
    ("ops_workload_run", "input_manifest"),
    ("ops_workload_line", "explanation"),
    ("ops_review_action", "completion_evidence"),
    ("hr_application_stage_event", "evidence"),
    ("hr_onboarding_task", "evidence"),
    ("hr_training_result", "evidence"),
    ("ops_shift_plan_version", "validation_summary"),
    ("scm_material_unit_conversion", "evidence"),
    ("scm_supplier", "contact_data"),
    ("scm_supplier_item", "evidence"),
    ("scm_supplier_item_mapping_review", "evidence"),
    ("scm_material_requirement_run", "input_manifest"),
    ("scm_material_requirement_component", "warning_detail"),
    ("scm_material_requirement_component", "calculation_detail"),
    ("scm_replenishment_run", "input_manifest"),
    ("scm_supplier_price_observation", "normalization_detail"),
    ("cost_card_material_price", "evidence"),
    ("finance_import_batch", "validation_result"),
    ("mkt_campaign_member", "eligibility_evidence"),
    ("mkt_survey_response", "validation_result"),
    ("mkt_survey_response", "client_context"),
    ("mkt_survey_result", "result_dimensions"),
    ("msg_message", "metadata"),
    ("ai_call", "input_manifest"),
})


SCHEMA_VALIDATION_GUARDS = {
    "ops_daily_review": (
        "SCHEMA_VALIDATION: sole SECURITY DEFINER draft-write function validates manager_input against "
        "manager_input_schema_version and review_summary against review_summary_schema_version; unknown keys "
        "and unsupported versions are rejected; application roles have no direct INSERT/UPDATE grant"
    ),
    "ops_business_rule": (
        "SCHEMA_VALIDATION: BEFORE INSERT/UPDATE validator dispatches by rule_code + schema_version, validates "
        "rule_value types/ranges/allowed keys, and rejects unknown keys or unsupported versions before approval"
    ),
    "hr_employee_event": (
        "SCHEMA_VALIDATION: sole append function validates event_data by event_type + event_schema_version; "
        "unknown keys and unsupported versions are rejected; application roles cannot insert directly"
    ),
    "msg_conversation_state": (
        "SCHEMA_VALIDATION: controlled workflow transition function validates collected_data and pending_action "
        "by workflow_code + workflow_version; unknown keys are rejected and direct state-table writes are revoked"
    ),
    "msg_outbound_message": (
        "SCHEMA_VALIDATION: atomic enqueue function validates payload by template_code + template_version before "
        "claiming idempotency_key; unknown keys/templates are rejected and direct queue INSERT is revoked"
    ),
    "ai_prompt_segment": (
        "SCHEMA_VALIDATION: approval function validates variable_schema as the approved JSON-Schema subset and "
        "rejects unsupported keywords before status can become APPROVED or ACTIVE"
    ),
    "ai_prompt_template": (
        "SCHEMA_VALIDATION: approval function validates output_schema as the approved JSON-Schema subset and "
        "rejects unsupported keywords before status can become APPROVED or ACTIVE"
    ),
    "ai_call": (
        "SCHEMA_VALIDATION: terminal-write function validates parsed_output against the referenced "
        "ai_prompt_template.output_schema; validation_status=VALID is impossible on mismatch and direct terminal "
        "updates are revoked"
    ),
    "mkt_campaign_version": (
        "SCHEMA_VALIDATION: sole campaign draft-write and publish functions validate audience_rule, "
        "participation_rule and reward_rule by campaign_type + rule_schema_version; unknown keys or unsupported "
        "versions are rejected, and application roles have no direct rule-column UPDATE grant"
    ),
    "hr_screening_rule": (
        "SCHEMA_VALIDATION: sole screening-rule draft-write and approval functions validate rule_definition by "
        "rule_type + rule_schema_version, reject unknown keys and protected discrimination inputs, and revoke "
        "direct rule_definition writes from application roles"
    ),
    "mkt_survey_question": (
        "SCHEMA_VALIDATION: campaign question write function validates validation_rule by question_type + "
        "validation_schema_version; unknown keys or unsupported versions are rejected and published questions "
        "cannot be updated directly"
    ),
    "cost_card_recipe_component": (
        "SCHEMA_VALIDATION: recipe component write function requires condition_rule and condition_schema_version "
        "together only when is_optional=true, validates allowed variant keys/types, rejects unknown keys, and "
        "revokes direct component INSERT/UPDATE from application roles"
    ),
    "hr_offer": (
        "SCHEMA_VALIDATION: sole offer draft-write and send functions validate compensation_summary by "
        "compensation_schema_version, require currency and typed nonnegative pay items, reject unknown keys, and "
        "revoke direct compensation writes from application roles"
    ),
}


if set(SCHEMA_VALIDATED_FIELDS) != set(SCHEMA_VALIDATION_GUARDS):
    raise AssertionError("schema validation fields and enforcement guards must cover the same tables")

if set(SCHEMA_VALIDATED_JSON_FIELDS) != set(SCHEMA_VALIDATION_GUARDS):
    raise AssertionError("behavior-driving JSON fields and enforcement guards must cover the same tables")
