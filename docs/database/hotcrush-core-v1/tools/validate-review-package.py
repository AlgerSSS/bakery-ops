#!/usr/bin/env python3
"""Fail closed if the R6 review package is incomplete or internally inconsistent."""

from __future__ import annotations

import csv
import dataclasses
import json
from collections import Counter
from pathlib import Path
import re
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[2]
sys.path.insert(0, str(ROOT))

from model.minimal_foundation import (  # noqa: E402
    CLAUDE_FABLE_5_EXPECTED_COUNTS,
    CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS,
    CORE_BUSINESS_TABLES,
    CORE_PLATFORM_TABLES,
    DERIVED_R5_TABLES,
    EXTENSION_TABLES,
    MERGED_R5_TABLES,
    REMOVED_R5_TABLES,
    SOURCE_CONDITIONAL_TABLES,
)
from model.current_to_target import (  # noqa: E402
    COST_ITEM_SOURCE_AUDIT,
    COST_ITEM_SOURCE_REF_PROBE,
    COST_RECIPE_OUTPUT_AUDIT,
    HBTI_RESULT_ONLY_ANCHOR_CONTRACT,
    MAPPINGS,
    REWARD_SOURCE_AUDIT,
    REWARD_TEMPLATE_ALLOWLIST_PAYLOAD,
    REWARD_TEMPLATE_ALLOWLIST_SHA256,
    validate_source_fidelity_contracts,
)
from model.storage_audit import validate_storage_audit  # noqa: E402
from model.schema_validation import (  # noqa: E402
    NON_BEHAVIOR_JSON_FIELDS,
    SCHEMA_VALIDATED_FIELDS,
    SCHEMA_VALIDATED_JSON_FIELDS,
    SCHEMA_VALIDATION_GUARDS,
)
from model.target_model import (  # noqa: E402
    EXTENSION_VIEWS,
    PHASE1_VIEWS,
    SOURCE_CONDITIONAL_VIEWS,
    TABLES,
    TABLE_BY_NAME,
    VIEWS,
    VIEW_BASE_TABLES,
    VIEW_BY_NAME,
    VIEW_READINESS_GOLDEN_COUNTS,
    required_fk_index_columns,
    validate_model,
    view_implementation_tier,
)


DIAGRAM_STEM = "HOTCRUSH-Core-V1-R6-最小物理基座蓝图"
DIAGRAM_DIR = ROOT / "diagrams"
READINESS_MARKERS = (
    "41 个 Phase1 视图只是设计候选",
    "10 个 PASS_SELECT_SPEC 仅表示 SELECT 规格足够",
    "当前已创建并验证的 SQL view = 0",
    "不表示已经创建或运行验证",
)


def read_csv(name: str) -> list[dict[str, str]]:
    with (ROOT / name).open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def require_nonempty(rows: list[dict[str, str]], columns: tuple[str, ...], label: str) -> None:
    errors = []
    for index, row in enumerate(rows, 2):
        missing = [column for column in columns if row.get(column, "").strip() == ""]
        if missing:
            errors.append(f"{label} row {index} missing {missing}")
    if errors:
        raise AssertionError("\n".join(errors[:50]))


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:24]
    if len(data) != 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"invalid PNG: {path}")
    return struct.unpack(">II", data[16:24])


def validate_csv_contracts() -> dict[str, int]:
    tables = read_csv("target-table-catalog.csv")
    if len(tables) != len(TABLES) or len({row["table_name"] for row in tables}) != len(TABLES):
        raise AssertionError("target table catalog must contain every physical contract exactly once")
    require_nonempty(
        tables,
        (
            "table_name", "chinese_name", "purpose", "row_grain", "writer", "readers",
            "source", "foundation_tier", "mutation_policy", "storage_class",
            "minimum_grain_verdict", "derivability", "audit_action",
            "why_stored_not_view", "retention", "primary_key",
        ),
        "table catalog",
    )
    table_catalog_by_name = {row["table_name"]: row for row in tables}
    if "mkt_reward_claim(reward_stock_id+reward_id)" not in table_catalog_by_name["mkt_reward_stock"]["incoming_references"]:
        raise AssertionError("target table catalog lacks reward stock composite incoming reference")
    if "(reward_stock_id + reward_id) → mkt_reward_stock(reward_stock_id + reward_id) MATCH SIMPLE" not in table_catalog_by_name["mkt_reward_claim"]["outgoing_foreign_keys"]:
        raise AssertionError("target table catalog lacks reward claim composite outgoing FK")

    views = read_csv("target-view-catalog.csv")
    if len(views) != len(VIEWS) or len({row["view_name"] for row in views}) != len(VIEWS):
        raise AssertionError("target view catalog must contain every derived view exactly once")
    require_nonempty(
        views,
        (
            "view_name", "chinese_name", "domain", "purpose", "row_grain",
            "implementation_tier", "readiness_status", "readiness_blockers", "grain_key",
            "direct_lineage", "physical_base_tables",
            "readers", "field_count", "notes",
        ),
        "view catalog",
    )
    for row in views:
        expected_tier = view_implementation_tier(row["view_name"])
        if row["implementation_tier"] != expected_tier:
            raise AssertionError(f"incorrect view tier for {row['view_name']}")
        view = VIEW_BY_NAME[row["view_name"]]
        expected_blockers = "NONE" if not view.readiness_blockers else " | ".join(view.readiness_blockers)
        expected_grain = "UNDEFINED" if view.grain_key is None else " + ".join(view.grain_key)
        if (
            row["readiness_status"] != view.readiness_status
            or row["readiness_blockers"] != expected_blockers
            or row["grain_key"] != expected_grain
        ):
            raise AssertionError(f"incorrect readiness/grain contract for {row['view_name']}")
        expected_base = " | ".join(sorted(VIEW_BASE_TABLES[row["view_name"]]))
        if row["physical_base_tables"] != expected_base:
            raise AssertionError(f"incorrect view base-table closure for {row['view_name']}")

    fields = read_csv("target-field-dictionary.csv")
    expected_field_count = sum(len(table.fields) for table in TABLES) + sum(len(view.fields) for view in VIEWS)
    keys = [(row["object_type"], row["table_name"], row["field_name"]) for row in fields]
    if len(fields) != expected_field_count or len(set(keys)) != expected_field_count:
        raise AssertionError("field dictionary row count/uniqueness mismatch")
    require_nonempty(
        fields,
        (
            "object_type", "domain", "table_name", "table_chinese_name", "table_purpose",
            "row_grain", "field_name", "field_chinese_name", "data_type", "nullable",
            "default", "stored_data", "business_purpose", "source_system", "writer",
            "foundation_tier", "view_readiness_status", "view_readiness_blockers", "view_grain_key",
            "key_and_constraints", "time_semantics",
            "history_version_semantics", "sensitivity", "example", "misuse_warning",
            "lifecycle", "mutation_policy", "minimum_grain_verdict", "storage_class",
            "derivability", "why_stored_not_view",
        ),
        "field dictionary",
    )
    expected_keys = {
        ("TABLE", table.name, field.name)
        for table in TABLES for field in table.fields
    } | {
        ("VIEW", view.name, field.name)
        for view in VIEWS for field in view.fields
    }
    if set(keys) != expected_keys:
        raise AssertionError("field dictionary does not exactly match declarative model")
    field_by_key = {
        (row["object_type"], row["table_name"], row["field_name"]): row
        for row in fields
    }
    for field_name in ("reward_stock_id", "reward_id"):
        row = field_by_key[("TABLE", "mkt_reward_claim", field_name)]
        if "TABLE FK (reward_stock_id + reward_id) → mkt_reward_stock(reward_stock_id + reward_id) MATCH SIMPLE" not in row["key_and_constraints"]:
            raise AssertionError(f"field dictionary lacks composite FK marker: mkt_reward_claim.{field_name}")
    for row in fields:
        if row["object_type"] == "TABLE":
            expected = ("NOT_APPLICABLE", "NOT_APPLICABLE", "NOT_APPLICABLE")
        else:
            view = VIEW_BY_NAME[row["table_name"]]
            expected = (
                view.readiness_status,
                "NONE" if not view.readiness_blockers else " | ".join(view.readiness_blockers),
                "UNDEFINED" if view.grain_key is None else " + ".join(view.grain_key),
            )
        actual = (
            row["view_readiness_status"],
            row["view_readiness_blockers"],
            row["view_grain_key"],
        )
        if actual != expected:
            raise AssertionError(f"field dictionary readiness mismatch: {row['table_name']}.{row['field_name']}")

    current_fields = read_csv("current-field-dictionary.csv")
    field_mappings = read_csv("current-field-to-target-matrix.csv")
    expected_current_keys = {
        (row["object_type"], row["object_name"], row["column_name"])
        for row in current_fields
    }
    mapped_current_keys = {
        (row["current_object_type"], row["current_object"], row["current_field"])
        for row in field_mappings
    }
    if len(field_mappings) != len(expected_current_keys) or mapped_current_keys != expected_current_keys:
        raise AssertionError("current field migration matrix must cover every production column exactly once")
    require_nonempty(
        field_mappings,
        (
            "current_object_type", "current_object", "ordinal_position", "current_field",
            "current_data_type", "current_nullable", "current_meaning", "meaning_evidence_status",
            "field_disposition", "target_field_or_disposition", "mapping_basis",
            "field_migration_rule", "object_migration_rule", "compatibility_rule", "risk",
            "implementation_status",
        ),
        "current field migration mapping",
    )
    forbidden_dispositions = {"UNMAPPED", "TBD", "SILENT_DROP", "UNKNOWN"}
    for row in field_mappings:
        if row["field_disposition"] in forbidden_dispositions:
            raise AssertionError(
                f"unresolved current field disposition: {row['current_object']}.{row['current_field']}"
            )
        if row["implementation_status"] != "DESIGN_EXPLICIT_NOT_EXECUTED":
            raise AssertionError("current field mapping must not claim production execution")
    critical = {
        mapping.current_object
        for mapping in MAPPINGS
        if mapping.object_type == "table" and mapping.risk == "CRITICAL"
    } | {
        "app_user_store_scope",
        "daily_breakdown",
        "finance_orders",
        "finance_revenue_daily",
        "finance_stock",
        "fact_hbti_response",
        "hbti_auth_token",
        "item_waste",
    }
    weak_critical = [
        f"{row['current_object']}.{row['current_field']}"
        for row in field_mappings
        if row["current_object"] in critical
        and (
            row["mapping_basis"] != "MANUAL_EXPLICIT_FIELD"
            or "OBJECT_TARGETS:" in row["target_field_or_disposition"]
            or len(row["field_migration_rule"].strip()) < 60
        )
    ]
    if weak_critical:
        raise AssertionError(f"high-risk current fields lack explicit field mapping: {weak_critical}")
    mapping_by_key = {
        (row["current_object"], row["current_field"]): row
        for row in field_mappings
    }
    target_fields = {
        table.name: {field.name for field in table.fields}
        for table in TABLES
    }
    target_fields.update({
        view.name: {field.name for field in view.fields}
        for view in VIEWS
    })
    invalid_target_references = []
    for row in field_mappings:
        if row["mapping_basis"] != "MANUAL_EXPLICIT_FIELD":
            continue
        for token in row["target_field_or_disposition"].split(" | "):
            token = token.strip()
            if token.startswith(("NO_TARGET:", "DERIVE:", "MIGRATION_MANIFEST:")):
                continue
            if not re.fullmatch(r"[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*", token):
                invalid_target_references.append(
                    f"{row['current_object']}.{row['current_field']} -> malformed {token}"
                )
                continue
            object_name, field_name = token.split(".", 1)
            if object_name not in target_fields or field_name not in target_fields[object_name]:
                invalid_target_references.append(
                    f"{row['current_object']}.{row['current_field']} -> missing {token}"
                )
    if invalid_target_references:
        raise AssertionError(
            "explicit current-field mappings contain invalid target references:\n"
            + "\n".join(invalid_target_references[:100])
        )
    required_lossless_destinations = {
        ("pos_member_card_txn", "trade_amount"): "pos_member_card_transaction.trade_amount",
        ("pos_member_card_txn", "txn_type"): "pos_member_card_transaction.source_transaction_type_code",
        ("pos_member_card_txn", "pos_order_no"): "pos_member_card_transaction.source_pos_order_no",
        ("pos_member_card_txn", "source_code"): "pos_member_card_transaction.source_code",
        ("pos_member", "point_balance"): "pos_member_balance_snapshot.point_balance",
        ("pos_member", "level_name"): "pos_member_balance_snapshot.level_name",
        ("item_waste", "amount"): "pos_item_waste.source_waste_amount",
        ("hourly_sales_summary", "num_of_guests"): "pos_sales_hour.source_guest_count",
        ("hourly_sales_summary", "total_discount"): "pos_sales_hour.discount_amount",
        ("product", "price"): "ops_business_rule.rule_value",
        ("product", "positioning"): "ops_business_rule.rule_value",
        ("product", "time_slots"): "ops_business_rule.rule_value",
        ("pos_product", "res_total_cost"): "pos_product_listing.source_total_cost",
        ("pos_product", "res_theoretical_cost"): "pos_product_listing.source_theoretical_cost",
        ("ops_store", "lark_base_token"): "ops_location_source_identity.source_container_id",
        ("ops_store", "lark_table_id"): "ops_location_source_identity.source_location_id",
        ("finance_orders", "spec"): "finance_order_logistics_line.source_specification",
        ("finance_orders", "volume"): "finance_order_logistics_line.source_volume",
        ("finance_stock", "category"): "finance_inventory_snapshot_line.source_category",
        ("finance_stock", "unit_volume"): "finance_inventory_snapshot_line.source_unit_volume",
        ("app_user_store_scope", "user_id"): "app_user_location_scope.user_role_id",
        ("daily_revenue", "date"): "pos_sales_day.business_date",
        ("daily_revenue", "revenue"): "pos_sales_day.net_sales",
        ("daily_revenue", "transaction_count"): "pos_sales_day.order_count",
        ("daily_revenue", "avg_transaction_value"): "pos_sales_day.source_average_order_value",
        ("daily_revenue", "gross_sales"): "pos_sales_day.gross_sales",
        ("daily_revenue", "total_discount"): "pos_sales_day.discount_amount",
        ("daily_revenue", "discount_rate"): "DERIVE:discount_amount / NULLIF(gross_sales,0)",
        ("daily_revenue", "member_sales_ratio"): "v_pos_member_daily_summary.source_card_payment_ratio",
        ("daily_revenue", "store"): "finance_sales_daily.location_id",
        ("daily_revenue", "import_source"): "finance_import_batch.source_layer",
    }
    for key, target in required_lossless_destinations.items():
        if target not in mapping_by_key[key]["target_field_or_disposition"]:
            raise AssertionError(f"lossless field mapping mismatch: {key} -> {target}")
    for field_name in (
        "date", "revenue", "transaction_count", "avg_transaction_value", "gross_sales",
        "total_discount", "discount_rate", "member_sales_ratio", "store", "import_source",
    ):
        row = mapping_by_key[("daily_revenue", field_name)]
        if row["mapping_basis"] != "MANUAL_EXPLICIT_FIELD" or "OBJECT_TARGETS:" in row["target_field_or_disposition"]:
            raise AssertionError(f"daily_revenue field lacks exact writer-aware disposition: {field_name}")
        if len(row["field_migration_rule"].strip()) < 40:
            raise AssertionError(f"daily_revenue field rule is not implementation-grade: {field_name}")
    product_policy_fields = {
        "price", "display_full_quantity", "positioning", "sales_ratio", "target_tc",
        "audience", "break_stock_time", "sort_order", "time_slots",
    }
    product_policy_destinations = {
        "ops_business_rule.scope_location_id",
        "ops_business_rule.scope_product_id",
        "ops_business_rule.rule_value",
        "ops_business_rule.schema_version",
    }
    for field_name in product_policy_fields:
        row = mapping_by_key[("product", field_name)]
        destinations = set(row["target_field_or_disposition"].split(" | "))
        if not row["field_disposition"].startswith("VERSION_SCOPED_POLICY") or destinations != product_policy_destinations:
            raise AssertionError(f"location-sensitive product policy is not explicitly versioned/scoped: {field_name}")
    for field_name in ("token_hash", "kind", "state", "attempts", "payload", "created_at", "expires_at"):
        row = mapping_by_key[("hbti_auth_token", field_name)]
        if row["field_disposition"] != "REISSUE_NOT_MIGRATE" or not row["target_field_or_disposition"].startswith("NO_TARGET:"):
            raise AssertionError(f"legacy HBTI token field must expire, not migrate: {field_name}")

    exact_field_contracts = {
        ("cost_card_item", "id"): (
            "ROUTE_EXACT_TYPE_AND_PRESERVE_SOURCE_ID",
            "ops_product.product_id | scm_material.material_id | scm_material_source_identity.source_material_id | MIGRATION_MANIFEST:source_cost_item_id",
        ),
        ("cost_card_item", "name"): (
            "PRESERVE_NAME_WITHOUT_IDENTITY_MERGE",
            "ops_product.product_name | ops_product_alias.alias_text | scm_material.material_name | MIGRATION_MANIFEST:source_alias_evidence",
        ),
        ("cost_card_item", "item_type"): (
            "ROUTE_EXACT_FOUR_VALUE_TYPE_OR_BLOCK",
            "ops_product.product_type | scm_material.material_type",
        ),
        ("cost_card_item", "base_unit"): (
            "MAP_EXACT_APPROVED_UNIT_OR_BLOCK",
            "ops_product.base_unit_id | scm_material.base_unit_id | app_unit.unit_code",
        ),
        ("cost_card_item", "status"): (
            "MAP_EXACT_ACTIVE_STATUS",
            "ops_product.status | scm_material.status",
        ),
        ("cost_card_item", "source_ref"): (
            "PRESERVE_INDEPENDENT_EVIDENCE_NULL_SAFE",
            "scm_material_source_identity.evidence | MIGRATION_MANIFEST:source_ref_evidence",
        ),
        ("cost_card_item", "created_at"): (
            "PRESERVE_NEW_MASTER_TIME_OR_EXISTING_ALIAS_EVIDENCE",
            "ops_product.created_at | scm_material.created_at | MIGRATION_MANIFEST:source_alias_created_at",
        ),
        ("cost_card_item", "updated_at"): (
            "PRESERVE_NEW_MASTER_TIME_OR_EXISTING_ALIAS_EVIDENCE",
            "ops_product.updated_at | scm_material.updated_at | MIGRATION_MANIFEST:source_alias_updated_at",
        ),
        ("cost_card_recipe", "id"): (
            "REKEY_DETERMINISTIC_VERSION_ID_PRESERVE_SOURCE",
            "cost_card_recipe_version.recipe_version_id | MIGRATION_MANIFEST:source_recipe_id",
        ),
        ("cost_card_recipe", "item_id"): (
            "GROUP_RECIPE_FAMILY_AND_RESOLVE_EXACT_OUTPUT",
            "cost_card_recipe_version.recipe_code | cost_card_recipe_version.output_product_id | cost_card_recipe_version.output_material_id",
        ),
        ("cost_card_recipe", "effective_from"): (
            "PRESERVE_NULL_ONLY_FOR_DRAFT",
            "cost_card_recipe_version.effective_from",
        ),
        ("cost_card_recipe", "sale_price"): (
            "PRESERVE_MYR_REFERENCE_PRICE",
            "cost_card_recipe_version.reference_sale_price | cost_card_recipe_version.currency",
        ),
        ("cost_card_recipe_item", "id"): (
            "REKEY_DETERMINISTIC_COMPONENT_ID_PRESERVE_SOURCE",
            "cost_card_recipe_component.recipe_component_id | MIGRATION_MANIFEST:source_recipe_item_id",
        ),
        ("pos_member", "hbti_visit_time"): (
            "PRESERVE_RESULT_ONLY_Q5_DIMENSION",
            "mkt_survey_result.result_dimensions",
        ),
        ("pos_member", "hbti_category"): (
            "PRESERVE_RESULT_ONLY_Q6_DIMENSION",
            "mkt_survey_result.result_dimensions",
        ),
        ("pos_member", "hbti_gender"): (
            "ARCHIVE_RESTRICTED_NO_ACTIVE_TARGET",
            "NO_TARGET:restricted migration archive",
        ),
        ("pos_member", "hbti_age"): (
            "ARCHIVE_RESTRICTED_NO_ACTIVE_TARGET",
            "NO_TARGET:restricted migration archive",
        ),
        ("pos_member", "hbti_status"): (
            "PRESERVE_REWARD_VALIDATION_EVIDENCE_ONLY",
            "mkt_survey_response.validation_result | mkt_reward_claim.status | NO_TARGET:no direct campaign_member/response status mapping",
        ),
        ("pos_member", "hbti_attempt_id"): (
            "PRESERVE_REAL_ATTEMPT_OR_BUILD_MIGRATION_ANCHOR",
            "mkt_survey_response.source_response_id | MIGRATION_MANIFEST:result_only_anchor_formula_and_hash",
        ),
        ("fact_hbti_response", "visit_time"): (
            "PRESERVE_Q5_RESULT_DIMENSION_ONLY",
            "mkt_survey_result.result_dimensions",
        ),
        ("fact_hbti_response", "category"): (
            "PRESERVE_Q6_RESULT_DIMENSION_ONLY",
            "mkt_survey_result.result_dimensions",
        ),
    }
    for key, (expected_action, expected_target) in exact_field_contracts.items():
        row = mapping_by_key[key]
        actual = (row["field_disposition"], row["target_field_or_disposition"])
        if actual != (expected_action, expected_target):
            raise AssertionError(f"exact source mapping drifted: {key} {actual}")

    required_rule_markers = {
        ("cost_card_item", "id"): ("471", "32", "67", "372", "不得把名称"),
        ("cost_card_item", "name"): ("32", "alias", "绝不覆盖", "禁止用于身份合并"),
        ("cost_card_item", "item_type"): ("product", "ingredient", "semi_finished", "packaging", "BLOCK"),
        ("cost_card_item", "base_unit"): ("g共372", "ea共94", "个共5", "G", "EACH", "BLOCK"),
        ("cost_card_item", "status"): ("471", "active", "ACTIVE", "BLOCK"),
        ("cost_card_item", "source_ref"): ("mysql451", "manual14", "NULL6", "other0", "旧row id"),
        ("cost_card_item", "created_at"): ("67", "372", "32", "绝不覆盖"),
        ("cost_card_item", "updated_at"): ("67", "372", "32", "绝不覆盖"),
        ("cost_card_recipe", "id"): ("public.cost_card_recipe:<id>", "绝不能写成 recipe_code"),
        ("cost_card_recipe", "item_id"): ("LEGACY-COST-ITEM-<item_id>",),
        ("cost_card_recipe", "effective_from"): ("Asia/Kuala_Lumpur", "唯一 DRAFT NULL"),
        ("cost_card_recipe", "effective_to"): ("下一日 00:00", "半开区间"),
        ("cost_card_recipe_item", "id"): ("public.cost_card_recipe_item:<id>",),
        ("cost_card_recipe_item", "recipe_id"): ("迁移清单",),
        ("cost_card_recipe_item", "component_item_id"): ("cost_card_item 来源 id", "scm_material.material_id"),
        ("cost_card_recipe_item", "unit"): ("来源 g", "受控单位 G"),
        ("fact_hbti_response", "answered_at"): ("绝不能映射", "response.started_at"),
        ("fact_hbti_response", "answers"): ("真实存在的答案", "NULL hash", "INCOMPLETE_INPUT"),
        ("fact_hbti_response", "visit_time"): ("不得单独生成", "fact.answers", "result_dimensions.visit_time"),
        ("fact_hbti_response", "category"): ("不得单独生成", "fact.answers", "result_dimensions.category"),
        ("pos_member", "hbti_attempt_id"): ("attempt_no=NULL", "migration-only:", "7ab6debe-4d90-50e2-ab29-9873d96e848d", "非来源观察"),
        ("pos_member", "hbti_status"): ("processing/issued/review/unrewarded", "禁止直映", "固定SUBMITTED"),
    }
    for key, markers in required_rule_markers.items():
        rule = mapping_by_key[key]["field_migration_rule"]
        if not all(marker in rule for marker in markers):
            raise AssertionError(f"source field rule lacks audited contract: {key} missing {markers}")

    for key in (
        ("pos_member", "hbti_visit_time"),
        ("pos_member", "hbti_category"),
        ("fact_hbti_response", "visit_time"),
        ("fact_hbti_response", "category"),
    ):
        target = mapping_by_key[key]["target_field_or_disposition"]
        if "started_at" in target or "result_label" in target or "mkt_survey_answer" in target:
            raise AssertionError(f"legacy result dimension mapped to false HBTI fact: {key}")
    hbti_status_target = mapping_by_key[("pos_member", "hbti_status")]["target_field_or_disposition"]
    if "mkt_campaign_member.status" in hbti_status_target or "mkt_survey_response.status" in hbti_status_target:
        raise AssertionError("pos_member.hbti_status must not drive campaign/response status")
    for key in (("pos_member", "hbti_gender"), ("pos_member", "hbti_age")):
        if "client_context" in mapping_by_key[key]["target_field_or_disposition"]:
            raise AssertionError(f"restricted HBTI field leaked into active client_context: {key}")

    object_gate_markers = {
        "cost_card_item": ("471", "99", "372", "32", "67", "190", "171", "11", "g372", "ea94", "个5", "mysql451", "manual14", "NULL6", "LEGACY-COST-ITEM-<id>", "LEGACY_COST_CARD_UNCLASSIFIED"),
        "cost_card_product_link": ("37", "63", "36", "61", "item 67", "CONFLICT/OPEN"),
        "cost_card_recipe": ("104 versions/99", "185 versions/171", "289", "270", "public.cost_card_recipe:<id>", "半开区间"),
        "cost_card_recipe_item": ("1527", "孤儿=0", "环=0"),
        "fact_hbti_response": ("1条完整作答", "6条result-only", "0 answers", "attempt_no=NULL", "migration-only:", "INCOMPLETE_INPUT", "LEGACY_UNPERSISTED", "SOURCE_ANSWERS_UNAVAILABLE", "活跃迁移为0"),
        "hbti_gift_stock": ("10项", "PHYSICAL_GIFT", "COUPON", "1376", "issued合计2", "Heart", "Pistachio", "Butterfly", "DRIFT", "source_fulfillment_id"),
    }
    for object_name, markers in object_gate_markers.items():
        rule = next(row["object_migration_rule"] for row in field_mappings if row["current_object"] == object_name)
        if not all(marker in rule for marker in markers):
            raise AssertionError(f"object migration gate is incomplete: {object_name} missing {markers}")

    dispositions = read_csv("r5-to-r6-disposition.csv")
    if len(dispositions) != 154 or len({row["r5_object"] for row in dispositions}) != 154:
        raise AssertionError("R5 disposition CSV must contain 154 unique objects")
    expected_counts = {
        "PHASE1_CORE_BUSINESS": len(CORE_BUSINESS_TABLES),
        "PHASE1_PLATFORM_SIDECAR": len(CORE_PLATFORM_TABLES),
        "EXTENSION_LATER": len(EXTENSION_TABLES),
        "DEFER_SOURCE": len(SOURCE_CONDITIONAL_TABLES),
        "MERGE_INTO": len(MERGED_R5_TABLES),
        "DERIVE_VIEW": len(DERIVED_R5_TABLES),
        "REMOVE": len(REMOVED_R5_TABLES),
    }
    actual_counts = Counter(row["r6_disposition"] for row in dispositions)
    if dict(actual_counts) != expected_counts:
        raise AssertionError(f"R5 disposition counts mismatch: {dict(actual_counts)} != {expected_counts}")
    require_nonempty(
        dispositions,
        ("r5_object", "r6_disposition", "r6_target", "phase1_physical", "full_catalog_physical_contract", "reason", "claude_fable_5", "final_override"),
        "R5 disposition",
    )
    actual_claude = {row["r5_object"]: row["claude_fable_5"] for row in dispositions}
    if actual_claude != CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS:
        mismatches = sorted(
            name for name in set(actual_claude) | set(CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS)
            if actual_claude.get(name) != CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS.get(name)
        )
        raise AssertionError(f"Claude provenance differs from declared independent result: {mismatches}")
    claude_counts = Counter(value.split(":", 1)[0] for value in actual_claude.values())
    if dict(claude_counts) != CLAUDE_FABLE_5_EXPECTED_COUNTS:
        raise AssertionError(f"Claude provenance counts mismatch: {dict(claude_counts)}")

    evidence_text = (ROOT / "evidence" / "claude-fable-5-r6-minimal-foundation.md").read_text(encoding="utf-8")
    evidence_pairs = re.findall(
        r"^([a-z][a-z0-9_]*) \| (CORE_KEEP|EXTENSION_LATER|DERIVE_VIEW|DEFER_SOURCE|REMOVE|CORE_MERGE_INTO:[a-z0-9_]+) \|",
        evidence_text,
        flags=re.MULTILINE,
    )
    evidence_map = dict(evidence_pairs)
    if len(evidence_pairs) != 154 or len(evidence_map) != 154:
        raise AssertionError("Claude evidence must contain 154 unique machine-readable dispositions")
    if evidence_map != CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS:
        mismatches = sorted(
            name for name in set(evidence_map) | set(CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS)
            if evidence_map.get(name) != CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS.get(name)
        )
        raise AssertionError(f"Claude evidence/declarative provenance mismatch: {mismatches}")

    for row in dispositions:
        if row["r6_disposition"] in {"PHASE1_CORE_BUSINESS", "PHASE1_PLATFORM_SIDECAR"}:
            final_judgment = "CORE_KEEP"
        elif row["r6_disposition"] == "MERGE_INTO":
            final_judgment = f"CORE_MERGE_INTO:{row['r6_target']}"
        elif row["r6_disposition"] == "DERIVE_VIEW":
            final_judgment = "DERIVE_VIEW"
        else:
            final_judgment = row["r6_disposition"]
        expected_override = (
            "NONE" if row["claude_fable_5"] == final_judgment
            else (
                f"FINAL_OVERRIDE:DERIVE_VIEW:{row['r6_target']}"
                if row["r6_disposition"] == "DERIVE_VIEW"
                else f"FINAL_OVERRIDE:{final_judgment}"
            )
        )
        if row["final_override"] != expected_override:
            raise AssertionError(
                f"incorrect final override for {row['r5_object']}: "
                f"{row['final_override']} != {expected_override}"
            )
    return {
        "table_catalog_rows": len(tables),
        "view_catalog_rows": len(views),
        "field_dictionary_rows": len(fields),
        "current_field_mapping_rows": len(field_mappings),
        "r5_disposition_rows": len(dispositions),
    }


def validate_json_and_html() -> dict[str, int]:
    payload = json.loads((ROOT / "target-model.json").read_text(encoding="utf-8"))
    if len(payload["tables"]) != len(TABLES) or len(payload["views"]) != len(VIEWS):
        raise AssertionError("target-model.json object count mismatch")
    expected_tables = json.loads(json.dumps(
        [dataclasses.asdict(table) for table in TABLES],
        ensure_ascii=False,
    ))
    if payload["tables"] != expected_tables:
        raise AssertionError("target-model.json physical table/composite-FK contract mismatch")
    expected_view_tiers = {view.name: view_implementation_tier(view.name) for view in VIEWS}
    if payload.get("view_implementation_tiers") != expected_view_tiers:
        raise AssertionError("target-model.json view implementation tiers mismatch")
    expected_view_bases = {view.name: sorted(VIEW_BASE_TABLES[view.name]) for view in VIEWS}
    if payload.get("view_base_tables") != expected_view_bases:
        raise AssertionError("target-model.json view base-table closure mismatch")
    expected_readiness_boundary = {
        "phase1_design_candidates": 41,
        "select_spec_ready": 10,
        "created_and_validated_sql_views": 0,
        "pass_semantics": "SELECT specification sufficient only; not created and not runtime-validated",
    }
    if payload.get("view_readiness_boundary") != expected_readiness_boundary:
        raise AssertionError("target-model.json readiness boundary mismatch")
    if payload.get("view_readiness_counts") != VIEW_READINESS_GOLDEN_COUNTS:
        raise AssertionError("target-model.json explicit view_readiness_counts mismatch")
    expected_source_fidelity = json.loads(json.dumps({
        "cost_item_source_audit": COST_ITEM_SOURCE_AUDIT,
        "cost_item_source_ref_probe": COST_ITEM_SOURCE_REF_PROBE,
        "cost_recipe_output_audit": COST_RECIPE_OUTPUT_AUDIT,
        "hbti_result_only_anchor": HBTI_RESULT_ONLY_ANCHOR_CONTRACT,
        "reward_template_allowlist": REWARD_TEMPLATE_ALLOWLIST_PAYLOAD,
        "reward_template_allowlist_sha256": REWARD_TEMPLATE_ALLOWLIST_SHA256,
        "reward_source_audit": REWARD_SOURCE_AUDIT,
    }, ensure_ascii=False))
    if payload.get("source_fidelity_contracts") != expected_source_fidelity:
        raise AssertionError("target-model.json P0c source-fidelity/allowlist contract mismatch")
    payload_views = {row["name"]: row for row in payload["views"]}
    for view in VIEWS:
        row = payload_views[view.name]
        if (
            row.get("readiness_status") != view.readiness_status
            or tuple(row.get("readiness_blockers", ())) != view.readiness_blockers
            or (None if row.get("grain_key") is None else tuple(row["grain_key"])) != view.grain_key
        ):
            raise AssertionError(f"target-model.json view readiness/grain mismatch: {view.name}")
    physical_names = {row["name"] for row in payload["tables"]}
    forbidden = set(MERGED_R5_TABLES) | set(DERIVED_R5_TABLES) | set(REMOVED_R5_TABLES)
    if physical_names & forbidden:
        raise AssertionError(f"nonphysical R5 objects leaked into JSON tables: {sorted(physical_names & forbidden)}")

    review_html_path = ROOT / "HOTCRUSH-Core-V1-R6-最小物理基座评审稿.html"
    review_html = review_html_path.read_text(encoding="utf-8")
    missing_html_tables = [table.name for table in TABLES if table.name not in review_html]
    missing_html_fields = [
        f"{table.name}.{field.name}" for table in TABLES for field in table.fields
        if field.name not in review_html
    ]
    if missing_html_tables or missing_html_fields:
        raise AssertionError(
            f"review HTML missing tables={missing_html_tables[:10]} fields={missing_html_fields[:10]}"
        )
    phase1_count = len(CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES)
    if f"首期只实施{phase1_count}张物理表" not in review_html or "R5 的154/154通过结论作废" not in review_html:
        raise AssertionError("review HTML does not expose the corrected R6 headline")
    for marker in READINESS_MARKERS:
        if marker not in review_html:
            raise AssertionError(f"review HTML lacks readiness boundary: {marker}")
    for view in VIEWS:
        entry_marker = f"<summary><code>{view.name}</code>"
        if entry_marker not in review_html:
            raise AssertionError(f"review HTML lacks view entry: {view.name}")
        entry = review_html.split(entry_marker, 1)[1].split("</details>", 1)[0]
        if view.readiness_status not in entry or view_implementation_tier(view.name) not in entry:
            raise AssertionError(f"review HTML lacks coupled tier/readiness: {view.name}")
    return {
        "json_tables": len(payload["tables"]),
        "json_views": len(payload["views"]),
        "phase1_views": len(PHASE1_VIEWS),
        "extension_views": len(EXTENSION_VIEWS),
        "source_conditional_views": len(SOURCE_CONDITIONAL_VIEWS),
    }


def validate_view_readiness_artifacts() -> dict[str, int]:
    required_documents = (
        "02-target-database-blueprint.md",
        "03-table-and-field-dictionary.md",
        "08-r6-minimal-physical-foundation.md",
        "09-implementation-guardrails-and-security.md",
        "README.md",
    )
    for name in required_documents:
        content = (ROOT / name).read_text(encoding="utf-8")
        for marker in READINESS_MARKERS:
            if marker not in content:
                raise AssertionError(f"{name} lacks explicit readiness boundary: {marker}")
    evidence_path = ROOT / "evidence" / "p0b-view-readiness-2026-08-10.md"
    evidence = evidence_path.read_text(encoding="utf-8")
    if "不是历史独立复审记录" not in evidence:
        raise AssertionError("superseding readiness evidence misstates its provenance")
    for marker in READINESS_MARKERS:
        if marker not in evidence:
            raise AssertionError(f"readiness evidence lacks boundary marker: {marker}")
    for view in VIEWS:
        expected_line_start = f"| `{view.name}` | `{view_implementation_tier(view.name)}` | `{view.readiness_status}` |"
        if evidence.count(expected_line_start) != 1:
            raise AssertionError(f"readiness evidence must list view exactly once: {view.name}")
    actual_counts = Counter(view.readiness_status for view in VIEWS)
    if actual_counts != Counter(VIEW_READINESS_GOLDEN_COUNTS):
        raise AssertionError(f"readiness model counts mismatch: {dict(actual_counts)}")
    if len(PHASE1_VIEWS) != 41 or VIEW_READINESS_GOLDEN_COUNTS["PASS_SELECT_SPEC"] != 10:
        raise AssertionError("phase1/select-ready golden counts drifted")
    return {
        "documents_with_readiness_boundary": len(required_documents),
        "views_with_explicit_readiness": len(VIEWS),
        "phase1_design_candidates": len(PHASE1_VIEWS),
        "select_spec_ready": VIEW_READINESS_GOLDEN_COUNTS["PASS_SELECT_SPEC"],
        "created_and_validated_sql_views": 0,
    }


def validate_p0c_source_fidelity_artifacts() -> dict[str, int | str]:
    summary = validate_source_fidelity_contracts()
    current_link = "evidence/p0c-source-fidelity-and-reward-2026-08-10.md"
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    if current_link not in readme:
        raise AssertionError("README does not point to the current P0c superseding evidence")
    historical = (ROOT / "evidence" / "final-acceptance-2026-08-10.md").read_text(encoding="utf-8")
    if not historical.startswith("# SUPERSEDED") or "p0c-source-fidelity-and-reward-2026-08-10.md" not in historical[:600]:
        raise AssertionError("historical final acceptance lacks the mandatory SUPERSEDED banner/current link")
    evidence = (ROOT / current_link).read_text(encoding="utf-8")
    required_markers = (
        "不是独立复审报告",
        COST_ITEM_SOURCE_REF_PROBE["query"],
        COST_ITEM_SOURCE_REF_PROBE["canonical_json_sha256"],
        "mysql=451、manual=14、NULL=6、other=0",
        "旧口述 `465/5/6` 明确错误并作废",
        "471=99 product+372 material",
        "104 versions/99 product families",
        HBTI_RESULT_ONLY_ANCHOR_CONTRACT["uuid5_root"],
        REWARD_TEMPLATE_ALLOWLIST_SHA256,
        "Butterfly库存issued=1但0 claim",
        "Phase1 supporting FK indexes=224",
        "已创建并验证SQL view=0",
    )
    missing = [marker for marker in required_markers if marker not in evidence]
    if missing:
        raise AssertionError(f"P0c superseding evidence lacks required markers: {missing}")
    for route in REWARD_TEMPLATE_ALLOWLIST_PAYLOAD:
        for evidence_location in route["evidence_path_lines"]:
            relative_path, line_text = evidence_location.rsplit(":", 1)
            path = REPO_ROOT / relative_path
            if not path.is_file():
                raise AssertionError(f"reward allowlist evidence file missing: {relative_path}")
            line_number = int(line_text)
            lines = path.read_text(encoding="utf-8").splitlines()
            if line_number < 1 or line_number > len(lines) or not lines[line_number - 1].strip():
                raise AssertionError(f"reward allowlist evidence line invalid: {evidence_location}")
    return summary


def validate_comment_contract() -> dict[str, int]:
    path = ROOT / "target-comments-contract.sql"
    content = path.read_text(encoding="utf-8")
    if "DESIGN-ONLY" not in content or "do not execute standalone" not in content:
        raise AssertionError("comment contract must state that it is design-only")
    if " IS '';" in content:
        raise AssertionError("comment contract contains an empty comment")

    object_statements = []
    column_statements = []
    for table in TABLES:
        statement = f'COMMENT ON TABLE "{table.name}" IS '
        if content.count(statement) != 1:
            raise AssertionError(f"table comment coverage mismatch: {table.name}")
        object_statements.append(statement)
        for field in table.fields:
            statement = f'COMMENT ON COLUMN "{table.name}"."{field.name}" IS '
            if content.count(statement) != 1:
                raise AssertionError(f"column comment coverage mismatch: {table.name}.{field.name}")
            column_statements.append(statement)
    for view in VIEWS:
        statement = f'COMMENT ON VIEW "{view.name}" IS '
        if content.count(statement) != 1:
            raise AssertionError(f"view comment coverage mismatch: {view.name}")
        object_statements.append(statement)
        for field in view.fields:
            statement = f'COMMENT ON COLUMN "{view.name}"."{field.name}" IS '
            if content.count(statement) != 1:
                raise AssertionError(f"view column comment coverage mismatch: {view.name}.{field.name}")
            column_statements.append(statement)

    actual_object_count = content.count("COMMENT ON TABLE ") + content.count("COMMENT ON VIEW ")
    actual_column_count = content.count("COMMENT ON COLUMN ")
    if actual_object_count != len(object_statements) or actual_column_count != len(column_statements):
        raise AssertionError("comment contract contains unknown or duplicate object/column comments")
    if actual_object_count != 196 or actual_column_count != 2455:
        raise AssertionError(
            f"comment golden count mismatch: objects={actual_object_count}, columns={actual_column_count}"
        )
    for view in VIEWS:
        view_fragment = content.split(f'COMMENT ON VIEW "{view.name}" IS ', 1)[1].split(";\n", 1)[0]
        expected_grain = "UNDEFINED" if view.grain_key is None else " + ".join(view.grain_key)
        for marker in (view_implementation_tier(view.name), view.readiness_status, expected_grain):
            if marker not in view_fragment:
                raise AssertionError(f"view comment lacks tier/readiness/grain: {view.name} {marker}")
    required_legacy_comment_markers = {
        '"ops_product"."category_code"': ("LEGACY_COST_CARD_UNCLASSIFIED", "开放治理"),
        '"cost_card_recipe_version"."effective_from"': ("DRAFT", "可为空"),
        '"mkt_campaign_version"."starts_at"': ("历史归档", "可为空"),
        '"mkt_survey_response"."started_at"': ("历史终态", "可为空"),
        '"mkt_survey_result"."input_sha256"': ("历史来源没有答案", "为空"),
    }
    for identity, markers in required_legacy_comment_markers.items():
        fragment = content.split(f"COMMENT ON COLUMN {identity} IS ", 1)[1].split(";\n", 1)[0]
        if not all(marker in fragment for marker in markers):
            raise AssertionError(f"legacy field comment lacks honest semantics: {identity}")
    for identity in ('"mkt_reward_claim"."reward_stock_id"', '"mkt_reward_claim"."reward_id"'):
        fragment = content.split(f"COMMENT ON COLUMN {identity} IS ", 1)[1].split(";\n", 1)[0]
        for marker in ("TABLE FK", "reward_stock_id + reward_id", "mkt_reward_stock", "MATCH SIMPLE"):
            if marker not in fragment:
                raise AssertionError(f"reward composite FK absent from field comment: {identity} {marker}")
    return {
        "commented_objects": actual_object_count,
        "commented_columns": actual_column_count,
        "commented_total": actual_object_count + actual_column_count,
    }


def validate_implementation_guardrails() -> dict[str, int]:
    target_rows = read_csv("target-table-implementation-guardrails.csv")
    if len(target_rows) != len(TABLES) or len({row["table_name"] for row in target_rows}) != len(TABLES):
        raise AssertionError("target implementation guardrails must cover every physical table exactly once")
    require_nonempty(
        target_rows,
        (
            "table_name", "foundation_tier", "lifecycle", "writer", "mutation_policy",
            "primary_key", "unique_constraints", "required_fk_indexes", "deferred_fk_constraints", "row_access_contract",
            "write_and_freeze_contract", "delete_contract", "special_constraint_guards",
            "implementation_status",
        ),
        "target implementation guardrail",
    )
    table_by_name = {table.name: table for table in TABLES}
    schema_claim_tables = {
        table.name
        for table in TABLES
        for field in table.fields
        if field.data_type == "jsonb"
        and "schema" in " ".join((field.description, field.purpose, field.notes)).lower()
    }
    if not schema_claim_tables <= set(SCHEMA_VALIDATION_GUARDS):
        raise AssertionError(
            f"JSON schema claims lack enforcement guards: {sorted(schema_claim_tables - set(SCHEMA_VALIDATION_GUARDS))}"
        )
    all_json_fields = {
        (table.name, field.name)
        for table in TABLES
        for field in table.fields
        if field.data_type == "jsonb"
    }
    behavior_json_fields = {
        (table_name, field_name)
        for table_name, field_names in SCHEMA_VALIDATED_JSON_FIELDS.items()
        for field_name in field_names
    }
    if behavior_json_fields & NON_BEHAVIOR_JSON_FIELDS:
        raise AssertionError("JSON contract classifies the same field as both behavior-driving and evidence-only")
    classified_json_fields = behavior_json_fields | NON_BEHAVIOR_JSON_FIELDS
    if all_json_fields != classified_json_fields:
        missing = sorted(all_json_fields - classified_json_fields)
        stale = sorted(classified_json_fields - all_json_fields)
        raise AssertionError(f"every jsonb field needs an explicit behavior/evidence classification: missing={missing}, stale={stale}")
    if set(SCHEMA_VALIDATED_JSON_FIELDS) != set(SCHEMA_VALIDATION_GUARDS):
        raise AssertionError("behavior-driving JSON tables must exactly match schema validation guards")
    for table_name, required_fields in SCHEMA_VALIDATED_FIELDS.items():
        actual_fields = {field.name for field in table_by_name[table_name].fields}
        missing = sorted(set(required_fields) - actual_fields)
        if missing:
            raise AssertionError(f"schema validation contract references missing fields: {table_name} {missing}")
    for table_name, field_names in SCHEMA_VALIDATED_JSON_FIELDS.items():
        actual_types = {field.name: field.data_type for field in table_by_name[table_name].fields}
        invalid = [field_name for field_name in field_names if actual_types.get(field_name) != "jsonb"]
        if invalid:
            raise AssertionError(f"schema-validated behavior fields must be jsonb: {table_name} {invalid}")

    nullable_source_observations = {
        "pos_sales_day": {
            "gross_sales", "discount_amount", "refund_amount", "order_count",
            "source_average_order_value", "source_guest_count",
        },
        "pos_item_sales_hour": {"discount_amount"},
        "finance_sales_daily": {"gross_sales", "discount_amount", "net_sales", "order_count"},
        "hr_timesheet_entry": {"break_minutes"},
    }
    for table_name, field_names in nullable_source_observations.items():
        fields = {field.name: field for field in table_by_name[table_name].fields}
        for field_name in field_names:
            field = fields[field_name]
            if not field.nullable or field.default is not None:
                raise AssertionError(
                    f"optional source observation must preserve missing as NULL: {table_name}.{field_name}"
                )
            if field.data_type.startswith(("numeric", "integer")) and not any(
                "IS NULL OR" in check for check in field.checks
            ):
                raise AssertionError(
                    f"nullable source number lacks NULL-safe range check: {table_name}.{field_name}"
                )
    if "guest_count" in {field.name for field in table_by_name["pos_sales_day"].fields}:
        raise AssertionError("ambiguous pos_sales_day.guest_count must use source_guest_count")

    subscription = {
        field.name: field for field in table_by_name["app_user"].fields
    }["notification_subscription_codes"]
    if (
        subscription.data_type != "text[]"
        or subscription.nullable
        or subscription.default != "'{}'::text[]"
        or "cardinality(notification_subscription_codes) <= 64" not in subscription.checks
        or "array_position(notification_subscription_codes, NULL) IS NULL" not in subscription.checks
    ):
        raise AssertionError("app_user notification subscriptions lack the governed preference contract")

    target_row_by_name = {row["table_name"]: row for row in target_rows}
    for table_name, required_guard in SCHEMA_VALIDATION_GUARDS.items():
        actual_guard = target_row_by_name[table_name]["special_constraint_guards"]
        if required_guard not in actual_guard or "SCHEMA_VALIDATION:" not in actual_guard:
            raise AssertionError(f"schema validation enforcement missing from guardrail CSV: {table_name}")
    for row in target_rows:
        table = table_by_name[row["table_name"]]
        expected_fk_indexes = " | ".join(sorted(
            " + ".join(columns) for columns in required_fk_index_columns(table)
        )) or "NONE"
        if row["required_fk_indexes"] != expected_fk_indexes:
            raise AssertionError(f"FK index candidate coverage mismatch for {table.name}")
        deferred = sorted(
            f"{field.name} -> {field.fk} @ {field.fk_activation}"
            for field in table.fields
            if field.fk and field.fk_activation != "WITH_TABLE"
        )
        deferred.extend(sorted(
            f"{'+'.join(table_fk.columns)} -> {table_fk.ref_table}({'+'.join(table_fk.ref_columns)}) "
            f"MATCH {table_fk.match_type} @ {table_fk.fk_activation}"
            for table_fk in table.foreign_keys
            if table_fk.fk_activation != "WITH_TABLE"
        ))
        expected_deferred = " | ".join(deferred) or "NONE"
        if row["deferred_fk_constraints"] != expected_deferred:
            raise AssertionError(f"deferred FK coverage mismatch for {table.name}")
        if row["implementation_status"] != "DESIGN_ONLY_NOT_EXECUTED":
            raise AssertionError(f"target guardrail must remain design-only: {table.name}")

    phase1_names = CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES
    phase1_supporting_fk_index_count = sum(
        len(required_fk_index_columns(table))
        for table in TABLES
        if table.name in phase1_names
    )
    if phase1_supporting_fk_index_count != 224:
        raise AssertionError(
            f"Phase1 supporting FK index golden drifted: {phase1_supporting_fk_index_count}"
        )
    reward_guard = target_row_by_name["mkt_reward_claim"]
    if "reward_stock_id + reward_id" not in reward_guard["required_fk_indexes"]:
        raise AssertionError("reward claim composite FK supporting index is missing")
    for marker in (
        "COMPOSITE_FK_REQUIRED",
        "(reward_stock_id,reward_id) REFERENCES mkt_reward_stock(reward_stock_id,reward_id) MATCH SIMPLE",
        "trigger is not an acceptable substitute",
    ):
        if marker not in reward_guard["special_constraint_guards"]:
            raise AssertionError(f"reward claim composite FK guard lacks {marker}")

    current = json.loads((ROOT / "evidence" / "current-schema-snapshot.json").read_text(encoding="utf-8"))
    current_rows = read_csv("current-guardrail-to-target-matrix.csv")
    expected_count = sum(len(current[key]) for key in ("constraints", "indexes", "triggers", "policies"))
    if len(current_rows) != expected_count:
        raise AssertionError(f"current guardrail matrix count mismatch: {len(current_rows)} != {expected_count}")
    keys = [(row["guardrail_type"], row["current_object"], row["guardrail_name"]) for row in current_rows]
    if len(set(keys)) != len(keys):
        raise AssertionError("current guardrail matrix contains duplicate identities")
    require_nonempty(
        current_rows,
        (
            "guardrail_type", "current_object", "guardrail_name", "current_definition",
            "current_enabled_or_valid", "current_object_disposition", "target_objects",
            "required_action", "verification_gate", "implementation_status",
        ),
        "current guardrail mapping",
    )
    mapping_by_current = {item.current_object: item for item in MAPPINGS}
    for row in current_rows:
        mapping = mapping_by_current.get(row["current_object"])
        if mapping is None:
            raise AssertionError(f"current guardrail object lacks object mapping: {row['current_object']}")
        expected_targets = " | ".join(mapping.target_objects) or "NONE"
        if row["target_objects"] != expected_targets:
            raise AssertionError(f"current guardrail target mismatch: {row['current_object']}")
        if row["implementation_status"] != "DESIGN_MAPPED_NOT_EXECUTED":
            raise AssertionError("current guardrail mapping must not claim execution")
    md = (ROOT / "09-implementation-guardrails-and-security.md").read_text(encoding="utf-8")
    if (
        "不是执行授权" not in md
        or str(expected_count) not in md
        or str(len(TABLES)) not in md
        or "hash-review-package.py" not in md
        or "PNG、PDF 和网页交互版" not in md
    ):
        raise AssertionError("implementation guardrail review does not expose design-only boundary/counts")
    return {
        "target_table_guardrails": len(target_rows),
        "current_guardrails_mapped": len(current_rows),
        "phase1_supporting_fk_indexes": phase1_supporting_fk_index_count,
    }


def validate_diagrams() -> dict[str, int]:
    drawio = DIAGRAM_DIR / f"{DIAGRAM_STEM}.drawio"
    root = ET.parse(drawio).getroot()
    pages = root.findall("diagram")
    if len(pages) != 61:
        raise AssertionError(f"drawio page count must be 61, got {len(pages)}")
    xml_text = drawio.read_text(encoding="utf-8")
    missing_tables = [table.name for table in TABLES if table.name not in xml_text]
    missing_views = [view.name for view in VIEWS if view.name not in xml_text]
    if missing_tables or missing_views:
        raise AssertionError(f"drawio coverage missing tables={missing_tables} views={missing_views}")
    diagram_objects = [item.attrib for item in root.iter("object")]
    for view in VIEWS:
        labels = [
            item.get("label", "")
            for item in diagram_objects
            if f"<b>{view.name}</b>" in item.get("label", "")
        ]
        if not labels or not any(
            view.readiness_status in label and view_implementation_tier(view.name) in label
            for label in labels
        ):
            raise AssertionError(f"drawio lacks explicit tier/readiness on view node: {view.name}")
    for marker in ("41个Phase1视图仅为设计候选", "10个SELECT规格ready", "当前创建并验证SQL view=0"):
        if marker not in xml_text:
            raise AssertionError(f"drawio lacks readiness boundary marker: {marker}")
    if "420条外键" not in xml_text:
        raise AssertionError("drawio lacks the unified 420-FK relationship count")
    composite_marker = "(reward_stock_id+reward_id) → (reward_stock_id+reward_id) MATCH SIMPLE"
    if composite_marker not in xml_text:
        raise AssertionError("drawio lacks the reward claim composite FK edge")

    pdf = DIAGRAM_DIR / f"{DIAGRAM_STEM}-完整61页.pdf"
    info = subprocess.run(["pdfinfo", str(pdf)], text=True, capture_output=True, check=True).stdout
    page_line = next((line for line in info.splitlines() if line.startswith("Pages:")), "")
    pdf_pages = int(page_line.split(":", 1)[1].strip()) if page_line else 0
    if pdf_pages != 61:
        raise AssertionError(f"PDF page count must be 61, got {pdf_pages}")

    png_names = ("总览", "会员订单", "采购订单", "派生成本")
    dimensions = {}
    for name in png_names:
        path = DIAGRAM_DIR / f"{DIAGRAM_STEM}-{name}.png"
        width, height = png_dimensions(path)
        if max(width, height) < 4000 or min(width, height) < 900:
            raise AssertionError(f"diagram PNG is not a clear export: {path} {width}x{height}")
        dimensions[name] = f"{width}x{height}"
    html_path = DIAGRAM_DIR / f"{DIAGRAM_STEM}-网页交互版.html"
    if html_path.stat().st_size < 100_000:
        raise AssertionError("interactive diagram HTML is unexpectedly small")
    return {
        "drawio_pages": len(pages),
        "pdf_pages": pdf_pages,
        "clear_png_count": len(dimensions),
        "foreign_key_relationships": validate_model()["foreign_key_count"],
    }


def validate_deprecated_terms() -> dict[str, int]:
    """Block vocabulary and duplicate artifacts superseded by the R6 contract."""
    text_paths = (
        ROOT / "model" / "current_to_target.py",
        ROOT / "04-current-to-target-matrix.md",
        ROOT / "current-to-target-matrix.csv",
        ROOT / "HOTCRUSH-Core-V1-R6-最小物理基座评审稿.html",
    )
    forbidden = ("LISTING_PENDING", "coverage_scope=MEMBER_ORDER_ITEM")
    failures = []
    for path in text_paths:
        content = path.read_text(encoding="utf-8")
        for term in forbidden:
            if term in content:
                failures.append(f"{path.relative_to(ROOT)} contains deprecated term {term}")
    if (ROOT / "07-minimum-grain-and-derivation-audit.md").exists():
        failures.append("superseded 07-minimum-grain-and-derivation-audit.md still exists")
    stale_diagrams = sorted(DIAGRAM_DIR.glob("HOTCRUSH-Core-V1-方案C数据库蓝图*"))
    if stale_diagrams:
        failures.append(f"stale R5 diagram assets remain in active diagram directory: {[p.name for p in stale_diagrams]}")
    archive_readme = ROOT / "archive" / "r5-diagrams" / "README.md"
    if not archive_readme.exists() or "不得用于批准或实施" not in archive_readme.read_text(encoding="utf-8"):
        failures.append("R5 diagram archive lacks an explicit superseded warning")
    legacy_html = ROOT / "HOTCRUSH-Core-V1-方案C数据库评审稿.html"
    canonical_html = ROOT / "HOTCRUSH-Core-V1-R6-最小物理基座评审稿.html"
    if legacy_html.read_bytes() != canonical_html.read_bytes():
        failures.append("legacy review HTML alias differs from canonical R6 review")
    if failures:
        raise AssertionError("\n".join(failures))
    return {"checked_text_artifacts": len(text_paths), "forbidden_terms": len(forbidden), "archived_r5_diagrams": len(list((ROOT / 'archive' / 'r5-diagrams').glob('HOTCRUSH-Core-V1-方案C数据库蓝图*')))}


def validate_reproducible_hash() -> dict[str, object]:
    command = [sys.executable, str(ROOT / "tools" / "hash-review-package.py")]
    first = subprocess.run(command, text=True, capture_output=True, check=True).stdout
    second = subprocess.run(command, text=True, capture_output=True, check=True).stdout
    if first != second:
        raise AssertionError("review package hash manifest is not byte-for-byte reproducible")
    manifest = json.loads(first)
    files = manifest.get("files", [])
    if (
        manifest.get("algorithm") != "SHA-256"
        or not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get("aggregate_sha256", "")))
        or manifest.get("file_count") != len(files)
        or len(files) < 40
        or len({row["path"] for row in files}) != len(files)
    ):
        raise AssertionError("review package hash manifest has an invalid scope or digest contract")
    excluded = " | ".join(manifest.get("excluded_outputs", []))
    if "*.png" not in excluded or "*.pdf" not in excluded or "网页交互版" not in excluded:
        raise AssertionError("review package hash manifest does not disclose visual export exclusions")
    return {
        "file_count": manifest["file_count"],
        "aggregate_sha256": manifest["aggregate_sha256"],
        "visual_exports_excluded_and_separately_validated": True,
    }


def main() -> None:
    result = {
        "model": validate_model(),
        "storage": validate_storage_audit(),
        "csv": validate_csv_contracts(),
        "artifacts": validate_json_and_html(),
        "view_readiness": validate_view_readiness_artifacts(),
        "p0c_source_fidelity": validate_p0c_source_fidelity_artifacts(),
        "comments": validate_comment_contract(),
        "implementation_guardrails": validate_implementation_guardrails(),
        "diagrams": validate_diagrams(),
        "deprecated_terms": validate_deprecated_terms(),
        "reproducible_hash": validate_reproducible_hash(),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
