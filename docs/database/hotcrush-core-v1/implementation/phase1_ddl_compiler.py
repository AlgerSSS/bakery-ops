#!/usr/bin/env python3
"""Fail-closed compiler for the R6 Phase 1 physical PostgreSQL contract."""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any


COMPILER_VERSION = "R6_PHASE1_COMPILER_V4_P0C_EXECUTOR_OWNER"
PG17_DOCKER_IMAGE = "postgres:17.6-alpine"
PG17_DOCKER_REPO_DIGEST = (
    "sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94"
)
EXPECTED_REVIEW_PACKAGE_SHA256 = (
    "6b863293c5aa3358c45c52468f614583f309ccb8a3ea717f3ad90ad76dfceaa0"
)
EXPECTED_RAW_MODEL_SHA256 = (
    "7bd5a71b010ad89427d918b842a18c4c34e23085cef0543cad14703d097c187b"
)
EXPECTED_CANONICAL_MODEL_SHA256 = (
    "52b1e84ae5cfa16871a058adaca3d1482d91460f7aad6f99186cab5b7e4ed986"
)
EXPECTED_CHECK_CONTRACT_SHA256 = (
    "a93bb73aafef9089223afe975e413758806221974d340be6ecee0e733293dd3c"
)
EXPECTED_FOREIGN_KEY_CONTRACT_SHA256 = (
    "de54225a4a1a9e20a5f3a199ed39f533eb7050aeb1ca4e18010dcc2b4c35446c"
)
EXPECTED_UNIQUE_CONTRACT_SHA256 = (
    "bd480f6589973cc115618d5072d118af716d56878ed3ca52cf6dda39e75e6838"
)

DOMAIN_FILES = {
    "app": "010_app_tables.sql",
    "ops": "011_ops_tables.sql",
    "hr": "012_hr_tables.sql",
    "scm": "013_scm_tables.sql",
    "pos": "014_pos_tables.sql",
    "cost": "015_cost_tables.sql",
    "finance": "016_finance_tables.sql",
    "mkt": "017_mkt_tables.sql",
    "msg": "018_msg_tables.sql",
    "ai": "019_ai_tables.sql",
}

STAGE_SQL_FILES = [
    "000_preflight.sql",
    "001_bootstrap.sql",
    *DOMAIN_FILES.values(),
    "030_fk_indexes.sql",
    "040_foreign_keys_not_valid.sql",
    "041_validate_foreign_keys.sql",
    "080_security.sql",
    "090_comments.sql",
    "099_catalog_acceptance.sql",
]
EXPECTED_SQL_FILES = [*STAGE_SQL_FILES, "phase1.sql"]
EXPECTED_OUTPUT_FILES = sorted([*EXPECTED_SQL_FILES, "phase1-ddl-manifest.json"])

FUTURE_BUSINESS_ROLE_NAMES = (
    "hc_r6_readonly",
    "hc_r6_app_writer",
    "hc_r6_ops_writer",
    "hc_r6_pos_writer",
    "hc_r6_hr_writer",
    "hc_r6_scm_writer",
    "hc_r6_cost_writer",
    "hc_r6_finance_writer",
    "hc_r6_mkt_writer",
    "hc_r6_msg_writer",
    "hc_r6_ai_writer",
)

OWNER_MODE = "EXECUTOR_OWNER"
EXECUTOR_OWNER = "postgres"
FORBIDDEN_OWNER_ROLE = "hc_r6_owner"
CREATED_ROLE_NAMES: tuple[str, ...] = ()

SUPABASE_RUNTIME_ROLES = (
    "anon",
    "authenticated",
    "service_role",
)

DEFAULT_DENY_ROLES = SUPABASE_RUNTIME_ROLES

ALLOWED_TYPES = {
    "bigint",
    "boolean",
    "bytea",
    "char(2)",
    "char(3)",
    "char(64)",
    "date",
    "inet",
    "integer",
    "jsonb",
    "numeric(18,4)",
    "numeric(18,6)",
    "numeric(18,8)",
    "numeric(24,12)",
    "numeric(24,8)",
    "numeric(5,4)",
    "numeric(9,4)",
    "numeric(9,6)",
    "smallint",
    "text",
    "text[]",
    "time",
    "timestamptz",
    "uuid",
    "citext",
}

ALLOWED_VIEW_TYPES = {
    "bigint",
    "boolean",
    "char(3)",
    "char(64)",
    "date",
    "integer",
    "jsonb",
    "numeric(12,6)",
    "numeric(12,8)",
    "numeric(18,10)",
    "numeric(18,4)",
    "numeric(18,6)",
    "numeric(18,8)",
    "numeric(24,8)",
    "numeric(9,6)",
    "text",
    "text[]",
    "time",
    "timestamptz",
    "uuid",
    "uuid[]",
}

TYPE_SQL = {
    "bigint": "pg_catalog.int8",
    "boolean": "pg_catalog.bool",
    "bytea": "pg_catalog.bytea",
    "char(2)": "pg_catalog.bpchar(2)",
    "char(3)": "pg_catalog.bpchar(3)",
    "char(64)": "pg_catalog.bpchar(64)",
    "date": "pg_catalog.date",
    "inet": "pg_catalog.inet",
    "integer": "pg_catalog.int4",
    "jsonb": "pg_catalog.jsonb",
    "numeric(18,4)": "pg_catalog.numeric(18,4)",
    "numeric(18,6)": "pg_catalog.numeric(18,6)",
    "numeric(18,8)": "pg_catalog.numeric(18,8)",
    "numeric(24,12)": "pg_catalog.numeric(24,12)",
    "numeric(24,8)": "pg_catalog.numeric(24,8)",
    "numeric(5,4)": "pg_catalog.numeric(5,4)",
    "numeric(9,4)": "pg_catalog.numeric(9,4)",
    "numeric(9,6)": "pg_catalog.numeric(9,6)",
    "smallint": "pg_catalog.int2",
    "text": "pg_catalog.text",
    "text[]": "pg_catalog.text[]",
    "time": "pg_catalog.time",
    "timestamptz": "pg_catalog.timestamptz",
    "uuid": "pg_catalog.uuid",
    "citext": "extensions.citext",
}

STRING_DEFAULTS = {
    "'04:00:00'",
    "'ACTIVE'",
    "'Asia/Kuala_Lumpur'",
    "'BATCH_MULTIPLE'",
    "'COMPLETE'",
    "'DETECTED'",
    "'DRAFT'",
    "'INVITED'",
    "'MY'",
    "'MYR'",
    "'OPEN'",
    "'PENDING'",
    "'PHONE'",
    "'QUEUED'",
    "'SOURCE_ONLY'",
    "'UNKNOWN'",
    "'campaign-rules-v1'",
    "'daily-review-manager-v1'",
    "'daily-review-summary-v1'",
    "'hr-employee-event-v1'",
    "'hr-screening-rule-v1'",
    "'offer-compensation-v1'",
    "'survey-validation-v1'",
}

EXTENSION_ONLY_STRING_DEFAULTS = {
    "'ASSIGNED'",
    "'NORMAL'",
    "'PASS'",
    "'PLANNED'",
    "'SUGGESTED'",
}

STRING_DEFAULT_TYPES = {
    **{
        value: frozenset({"text", "citext"})
        for value in STRING_DEFAULTS - {"'04:00:00'", "'MY'", "'MYR'"}
    },
    "'04:00:00'": frozenset({"time"}),
    "'MY'": frozenset({"char(2)"}),
    "'MYR'": frozenset({"char(3)"}),
    **{
        value: frozenset({"text", "citext"})
        for value in EXTENSION_ONLY_STRING_DEFAULTS
    },
}
ALLOWED_DEFAULTS = {
    "gen_random_uuid()",
    "now()",
    "CURRENT_DATE",
    "false",
    "true",
    "0",
    "1",
    "3",
    "100",
    "'{}'::jsonb",
    "'{}'::text[]",
    *STRING_DEFAULTS,
    *EXTENSION_ONLY_STRING_DEFAULTS,
}

DEFAULT_SQL = {
    "gen_random_uuid()": "pg_catalog.gen_random_uuid()",
    "now()": "pg_catalog.now()",
    "CURRENT_DATE": "CURRENT_DATE",
    "false": "false",
    "true": "true",
    "0": "0",
    "1": "1",
    "3": "3",
    "100": "100",
    "'{}'::jsonb": "'{}'::pg_catalog.jsonb",
    "'{}'::text[]": "'{}'::pg_catalog.text[]",
    **{value: value for value in STRING_DEFAULTS},
    **{value: value for value in EXTENSION_ONLY_STRING_DEFAULTS},
}

REQUIRED_P0_CHECKS = {
    "app_source_system": [
        "source_system_id <> '00000000-0000-0000-0000-000000000000'",
    ],
    "ops_location": [
        "location_id <> '00000000-0000-0000-0000-000000000000'",
    ],
    "ops_product": [
        "product_id <> '00000000-0000-0000-0000-000000000000'",
    ],
    "ops_location_source_identity": [
        "source_container_id IS NULL OR source_container_id <> ''",
    ],
    "ops_product_alias": [
        "public.app_normalize_alias_v1(alias_text) <> ''",
    ],
    "scm_material_alias": [
        "public.app_normalize_alias_v1(alias_text) <> ''",
    ],
    "finance_period_category_map": [
        "source_sub IS NULL OR source_sub <> '__HOTCRUSH_ALL__'",
    ],
}

NIL_UUID_SQL = "'00000000-0000-0000-0000-000000000000'::pg_catalog.uuid"


@dataclasses.dataclass(frozen=True)
class ExclusionSpec:
    name: str
    elements: tuple[str, ...]
    predicate: str | None = None


EXCLUSION_SPECS: dict[tuple[str, str], ExclusionSpec] = {
    (
        "app_user_role",
        "NO_OVERLAP(user_id, role_id, tstzrange(valid_from, LEAST(COALESCE(valid_to, 'infinity'), COALESCE(revoked_at, 'infinity')), '[)'))",
    ): ExclusionSpec(
        "ex_app_user_role__active_period",
        (
            '"user_id" WITH =',
            '"role_id" WITH =',
            'pg_catalog.tstzrange("valid_from", LEAST(COALESCE("valid_to", \'infinity\'::pg_catalog.timestamptz), COALESCE("revoked_at", \'infinity\'::pg_catalog.timestamptz)), \'[)\') WITH &&',
        ),
    ),
    (
        "app_user_location_scope",
        "NO_OVERLAP(user_role_id, location_id, scope_level, tstzrange(valid_from, LEAST(COALESCE(valid_to, 'infinity'), COALESCE(revoked_at, 'infinity')), '[)'))",
    ): ExclusionSpec(
        "ex_app_user_location_scope__active_period",
        (
            '"user_role_id" WITH =',
            '"location_id" WITH =',
            '"scope_level" WITH =',
            'pg_catalog.tstzrange("valid_from", LEAST(COALESCE("valid_to", \'infinity\'::pg_catalog.timestamptz), COALESCE("revoked_at", \'infinity\'::pg_catalog.timestamptz)), \'[)\') WITH &&',
        ),
    ),
    (
        "ops_location_source_identity",
        "NO_OVERLAP(source_system_id, COALESCE(source_container_id, ''), source_location_id, tstzrange(valid_from, valid_to, '[)')) WHERE mapping_status = 'CONFIRMED'",
    ): ExclusionSpec(
        "ex_ops_location_source_identity__confirmed_period",
        (
            '"source_system_id" WITH =',
            'COALESCE("source_container_id", \'\'::pg_catalog.text) WITH =',
            '"source_location_id" WITH =',
            'pg_catalog.tstzrange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
        '"mapping_status" = \'CONFIRMED\'',
    ),
    (
        "ops_product_alias",
        "NO_OVERLAP(COALESCE(source_system_id, NIL_UUID), NORMALIZE_ALIAS(alias_text), daterange(valid_from, valid_to, '[)')) WHERE status = 'CONFIRMED'",
    ): ExclusionSpec(
        "ex_ops_product_alias__confirmed_period",
        (
            f'COALESCE("source_system_id", {NIL_UUID_SQL}) WITH =',
            'public.app_normalize_alias_v1("alias_text") WITH =',
            'pg_catalog.daterange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
        '"status" = \'CONFIRMED\'',
    ),
    (
        "hr_person_contact",
        "NO_OVERLAP(person_id, contact_type, lookup_hash, tstzrange(valid_from, valid_to, '[)'))",
    ): ExclusionSpec(
        "ex_hr_person_contact__value_period",
        (
            '"person_id" WITH =',
            '"contact_type" WITH =',
            '"lookup_hash" WITH =',
            'pg_catalog.tstzrange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
    ),
    (
        "hr_person_contact",
        "NO_OVERLAP(person_id, contact_type, tstzrange(valid_from, valid_to, '[)')) WHERE is_primary = true",
    ): ExclusionSpec(
        "ex_hr_person_contact__primary_period",
        (
            '"person_id" WITH =',
            '"contact_type" WITH =',
            'pg_catalog.tstzrange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
        '"is_primary" = true',
    ),
    (
        "hr_employment_source_identity",
        "NO_OVERLAP(source_system_id, source_employee_id, tstzrange(valid_from, valid_to, '[)')) WHERE mapping_status = 'CONFIRMED'",
    ): ExclusionSpec(
        "ex_hr_employment_source_identity__confirmed_period",
        (
            '"source_system_id" WITH =',
            '"source_employee_id" WITH =',
            'pg_catalog.tstzrange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
        '"mapping_status" = \'CONFIRMED\'',
    ),
    (
        "scm_material_alias",
        "NO_OVERLAP(COALESCE(source_system_id, NIL_UUID), NORMALIZE_ALIAS(alias_text), daterange(valid_from, valid_to, '[)')) WHERE status = 'CONFIRMED'",
    ): ExclusionSpec(
        "ex_scm_material_alias__confirmed_period",
        (
            f'COALESCE("source_system_id", {NIL_UUID_SQL}) WITH =',
            'public.app_normalize_alias_v1("alias_text") WITH =',
            'pg_catalog.daterange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
        '"status" = \'CONFIRMED\'',
    ),
    (
        "scm_material_source_identity",
        "NO_OVERLAP(source_system_id, source_material_id, tstzrange(valid_from, valid_to, '[)')) WHERE mapping_status = 'CONFIRMED'",
    ): ExclusionSpec(
        "ex_scm_material_source_identity__confirmed_period",
        (
            '"source_system_id" WITH =',
            '"source_material_id" WITH =',
            'pg_catalog.tstzrange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
        '"mapping_status" = \'CONFIRMED\'',
    ),
    (
        "pos_product_mapping",
        "NO_OVERLAP(listing_id, tstzrange(valid_from, valid_to, '[)')) WHERE status = 'CONFIRMED'",
    ): ExclusionSpec(
        "ex_pos_product_mapping__confirmed_period",
        (
            '"listing_id" WITH =',
            'pg_catalog.tstzrange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
        '"status" = \'CONFIRMED\'',
    ),
    (
        "ops_stockout_event",
        "NO_OVERLAP(location_id, listing_id, tstzrange(started_at, ended_at, '[)')) WHERE status IN ('DETECTED','CONFIRMED','CLOSED')",
    ): ExclusionSpec(
        "ex_ops_stockout_event__live_period",
        (
            '"location_id" WITH =',
            '"listing_id" WITH =',
            'pg_catalog.tstzrange("started_at", "ended_at", \'[)\') WITH &&',
        ),
        '"status" IN (\'DETECTED\', \'CONFIRMED\', \'CLOSED\')',
    ),
    (
        "pos_member_contact",
        "NO_OVERLAP(member_id, contact_type, tstzrange(valid_from, valid_to, '[)'))",
    ): ExclusionSpec(
        "ex_pos_member_contact__value_period",
        (
            '"member_id" WITH =',
            '"contact_type" WITH =',
            'pg_catalog.tstzrange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
    ),
    (
        "ops_business_rule",
        "NO_OVERLAP(COALESCE(scope_location_id, NIL_UUID), COALESCE(scope_product_id, NIL_UUID), rule_code, tstzrange(valid_from, valid_to, '[)')) WHERE status = 'ACTIVE'",
    ): ExclusionSpec(
        "ex_ops_business_rule__active_period",
        (
            f'COALESCE("scope_location_id", {NIL_UUID_SQL}) WITH =',
            f'COALESCE("scope_product_id", {NIL_UUID_SQL}) WITH =',
            '"rule_code" WITH =',
            'pg_catalog.tstzrange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
        '"status" = \'ACTIVE\'',
    ),
    (
        "scm_material_unit_conversion",
        "NO_OVERLAP(material_id, from_unit_id, to_unit_id, tstzrange(valid_from, valid_to, '[)')) WHERE status = 'VERIFIED'",
    ): ExclusionSpec(
        "ex_scm_material_unit_conversion__verified_period",
        (
            '"material_id" WITH =',
            '"from_unit_id" WITH =',
            '"to_unit_id" WITH =',
            'pg_catalog.tstzrange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
        '"status" = \'VERIFIED\'',
    ),
    (
        "scm_supplier_item",
        "NO_OVERLAP(supplier_id, supplier_sku, tstzrange(valid_from, valid_to, '[)')) WHERE mapping_status = 'CONFIRMED'",
    ): ExclusionSpec(
        "ex_scm_supplier_item__confirmed_period",
        (
            '"supplier_id" WITH =',
            '"supplier_sku" WITH =',
            'pg_catalog.tstzrange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
        '"mapping_status" = \'CONFIRMED\'',
    ),
    (
        "cost_card_recipe_version",
        "NO_OVERLAP(recipe_code, tstzrange(effective_from, effective_to, '[)')) WHERE status = 'PUBLISHED'",
    ): ExclusionSpec(
        "ex_cost_card_recipe_version__published_period",
        (
            '"recipe_code" WITH =',
            'pg_catalog.tstzrange("effective_from", "effective_to", \'[)\') WITH &&',
        ),
        '"status" = \'PUBLISHED\'',
    ),
    (
        "cost_card_material_price",
        "NO_OVERLAP(material_id, COALESCE(location_id, NIL_UUID), tstzrange(effective_from, effective_to, '[)')) WHERE quality_status IN ('VERIFIED','ESTIMATED','STALE')",
    ): ExclusionSpec(
        "ex_cost_card_material_price__usable_period",
        (
            '"material_id" WITH =',
            f'COALESCE("location_id", {NIL_UUID_SQL}) WITH =',
            'pg_catalog.tstzrange("effective_from", "effective_to", \'[)\') WITH &&',
        ),
        '"quality_status" IN (\'VERIFIED\', \'ESTIMATED\', \'STALE\')',
    ),
    (
        "finance_period_category_map",
        "NO_OVERLAP(source_major, COALESCE(source_sub, WILDCARD), daterange(valid_from, valid_to, '[)')) WHERE status = 'ACTIVE'",
    ): ExclusionSpec(
        "ex_finance_period_category_map__active_period",
        (
            '"source_major" WITH =',
            'COALESCE("source_sub", \'__HOTCRUSH_ALL__\'::pg_catalog.text) WITH =',
            'pg_catalog.daterange("valid_from", "valid_to", \'[)\') WITH &&',
        ),
        '"status" = \'ACTIVE\'',
    ),
    (
        "mkt_campaign_version",
        "NO_OVERLAP(campaign_code, tstzrange(starts_at, ends_at, '[)')) WHERE status = 'PUBLISHED'",
    ): ExclusionSpec(
        "ex_mkt_campaign_version__published_period",
        (
            '"campaign_code" WITH =',
            'pg_catalog.tstzrange("starts_at", "ends_at", \'[)\') WITH &&',
        ),
        '"status" = \'PUBLISHED\'',
    ),
}

IDENTIFIER_RE = re.compile(r"^[a-z][a-z0-9_]*$")
FORBIDDEN_CHECK_FRAGMENTS = (
    ";",
    "--",
    "/*",
    "*/",
    "$$",
    "\\",
)
FORBIDDEN_CHECK_WORDS = {
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "MERGE",
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
    "CALL",
    "DO",
    "GRANT",
    "REVOKE",
    "EXECUTE",
    "PG_SLEEP",
}
CHECK_KEYWORDS = {
    "IS",
    "NOT",
    "NULL",
    "AND",
    "OR",
    "IN",
    "BETWEEN",
    "FROM",
    "DAY",
    "TRUE",
    "FALSE",
    "EXTRACT",
}
CHECK_FUNCTIONS = {
    "btrim": "pg_catalog.btrim",
    "cardinality": "pg_catalog.cardinality",
    "array_position": "pg_catalog.array_position",
    "length": "pg_catalog.length",
    "num_nonnulls": "pg_catalog.num_nonnulls",
}

ROOT_KEYS = frozenset(
    {
        "model_version",
        "generated_from",
        "tables",
        "views",
        "end_to_end_chains",
        "minimum_grain_audits",
        "view_base_tables",
        "view_implementation_tiers",
        "view_readiness_boundary",
        "view_readiness_counts",
        "source_fidelity_contracts",
    }
)
TABLE_KEYS = frozenset(
    {
        "name",
        "zh_name",
        "domain",
        "purpose",
        "grain",
        "writer",
        "readers",
        "source",
        "lifecycle",
        "mutation_policy",
        "fields",
        "foreign_keys",
        "uniques",
        "nulls_not_distinct_uniques",
        "nulls_distinct_uniques",
        "exclusions",
        "checks",
        "retention",
        "notes",
    }
)
TABLE_FOREIGN_KEY_KEYS = frozenset(
    {
        "columns",
        "ref_table",
        "ref_columns",
        "fk_activation",
        "match_type",
    }
)
SOURCE_FIDELITY_KEYS = frozenset(
    {
        "cost_item_source_audit",
        "cost_item_source_ref_probe",
        "cost_recipe_output_audit",
        "hbti_result_only_anchor",
        "reward_source_audit",
        "reward_template_allowlist",
        "reward_template_allowlist_sha256",
    }
)
REWARD_TEMPLATE_KEYS = frozenset(
    {
        "source_system",
        "source_object",
        "source_template",
        "target_reward_stable_anchor",
        "reward_type",
        "evidence_path_lines",
    }
)
FIELD_KEYS = frozenset(
    {
        "name",
        "zh_name",
        "data_type",
        "description",
        "purpose",
        "nullable",
        "default",
        "pk",
        "fk",
        "fk_activation",
        "unique",
        "sensitive",
        "example",
        "checks",
        "notes",
    }
)
VIEW_KEYS = frozenset(
    {
        "name",
        "zh_name",
        "domain",
        "purpose",
        "grain",
        "grain_key",
        "fields",
        "readers",
        "lineage",
        "readiness_status",
        "readiness_blockers",
        "notes",
    }
)
END_TO_END_CHAIN_KEYS = frozenset(
    {"number", "name", "question", "nodes", "joins", "control"}
)
MINIMUM_GRAIN_AUDIT_KEYS = frozenset(
    {
        "table_name",
        "storage_class",
        "minimum_grain_verdict",
        "derivability",
        "physical_reason",
        "derived_fields",
        "action",
        "original_r4_disposition",
        "claude_fable_5_result",
    }
)
VIEW_READINESS_BOUNDARY_KEYS = frozenset(
    {
        "phase1_design_candidates",
        "select_spec_ready",
        "created_and_validated_sql_views",
        "pass_semantics",
    }
)
VIEW_READINESS_COUNT_KEYS = frozenset(
    {
        "PASS_SELECT_SPEC",
        "FIX_MODEL_CONTRACT",
        "BLOCK_MISSING_FACT_OR_RULE",
        "DEFER_EXTENSION",
        "DEFER_SOURCE",
    }
)
ALLOWED_LIFECYCLES = frozenset(
    {"CORE_MIGRATION", "PLANNED_MODULE", "SOURCE_CONDITIONAL"}
)
ALLOWED_MUTATION_POLICIES = frozenset(
    {
        "APPEND_ONLY",
        "CONTROLLED_UPDATE",
        "CONTROLLED_UPDATE_UNTIL_TERMINAL",
        "DRAFT_MUTABLE_THEN_FROZEN",
        "CONTROLLED_WORKFLOW",
        "APPEND_ONLY_DECISION_RECORD",
        "SOURCE_STATE_UNTIL_TERMINAL",
        "CONTROLLED_QUEUE_STATE",
    }
)
ALLOWED_SENSITIVITY = frozenset(
    {"none", "internal", "restricted", "personal", "secret"}
)
ALLOWED_FK_ACTIVATIONS = frozenset(
    {
        "WITH_TABLE",
        "EXTENSION_PACK:SHIFT_AND_WORKFORCE",
        "EXTENSION_PACK:PROCUREMENT_AND_INVENTORY",
        "EXTENSION_PACK:PROCUREMENT_AND_INVENTORY+PRODUCTION_EXECUTION",
    }
)
ALLOWED_VIEW_TIERS = frozenset({"PHASE1", "EXTENSION_PACK", "SOURCE_CONDITIONAL"})
ALLOWED_VIEW_READINESS = VIEW_READINESS_COUNT_KEYS
EXPECTED_DEFERRED_CORE_FKS = frozenset(
    {
        (
            "scm_supplier_price_observation",
            "goods_receipt_line_id",
            "scm_goods_receipt_line.goods_receipt_line_id",
            "EXTENSION_PACK:PROCUREMENT_AND_INVENTORY",
        ),
        (
            "scm_supplier_price_observation",
            "purchase_order_line_id",
            "scm_purchase_order_line.purchase_order_line_id",
            "EXTENSION_PACK:PROCUREMENT_AND_INVENTORY",
        ),
    }
)


class ModelContractError(ValueError):
    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


class GeneratedArtifactDrift(RuntimeError):
    pass


@dataclasses.dataclass(frozen=True)
class Phase1Plan:
    tables: tuple[dict[str, Any], ...]
    views: tuple[dict[str, Any], ...]
    checks: tuple[dict[str, Any], ...]
    foreign_keys: tuple[dict[str, Any], ...]
    foreign_key_indexes: tuple[dict[str, Any], ...]
    counts: dict[str, int]


def _canonical_records_sha256(
    records: list[dict[str, Any]], *, sort_keys: tuple[str, ...]
) -> str:
    ordered = sorted(
        records,
        key=lambda record: tuple(
            tuple(record[key]) if isinstance(record[key], list) else record[key]
            for key in sort_keys
        ),
    )
    encoded = json.dumps(
        ordered,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def check_contract_sha256(plan: Phase1Plan) -> str:
    return _canonical_records_sha256(
        [
            {
                "table": check["table"],
                "scope": check["scope"],
                "ordinal": check["ordinal"],
                "expression": check["expression"],
            }
            for check in plan.checks
        ],
        sort_keys=("table", "scope", "ordinal", "expression"),
    )


def foreign_key_contract_sha256(plan: Phase1Plan) -> str:
    return _canonical_records_sha256(
        [
            {
                "table": edge["table"],
                "columns": list(edge["columns"]),
                "ref_table": edge["ref_table"],
                "ref_columns": list(edge["ref_columns"]),
                "fk_activation": edge["fk_activation"],
                "match_type": edge["match_type"],
            }
            for edge in plan.foreign_keys
        ],
        sort_keys=(
            "table",
            "columns",
            "ref_table",
            "ref_columns",
            "fk_activation",
            "match_type",
        ),
    )


def _unique_contract_sha256_tables(tables: tuple[dict[str, Any], ...]) -> str:
    records: list[dict[str, Any]] = []
    for table in tables:
        nnd = {tuple(group) for group in table["nulls_not_distinct_uniques"]}
        nd = {tuple(group) for group in table["nulls_distinct_uniques"]}
        for group in table["uniques"]:
            key = tuple(group)
            policy = (
                "NULLS_NOT_DISTINCT"
                if key in nnd
                else "NULLS_DISTINCT"
                if key in nd
                else "ORDINARY"
            )
            records.append(
                {"table": table["name"], "columns": list(group), "null_policy": policy}
            )
    return _canonical_records_sha256(
        records,
        sort_keys=("table", "null_policy", "columns"),
    )


def unique_contract_sha256(plan: Phase1Plan) -> str:
    return _unique_contract_sha256_tables(plan.tables)


def _fail(code: str, message: str, **details: Any) -> None:
    raise ModelContractError(code, message, **details)


def _require_exact_keys(value: Any, expected: frozenset[str], *, context: str) -> None:
    if not isinstance(value, dict):
        _fail("invalid_model_shape", f"Expected object at {context}")
    actual = frozenset(value)
    if actual != expected:
        _fail(
            "unknown_model_keys",
            f"Closed model keys differ at {context}",
            context=context,
            missing=sorted(expected - actual),
            unknown=sorted(actual - expected),
        )


def _require_nonblank(value: Any, *, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail("missing_required_metadata", f"Required text is blank at {context}")
    return value


def _require_string_list(value: Any, *, context: str, nonempty: bool = False) -> None:
    if not isinstance(value, list) or (nonempty and not value):
        _fail("invalid_model_shape", f"Expected string list at {context}")
    for index, item in enumerate(value):
        _require_nonblank(item, context=f"{context}[{index}]")


def _validate_field_shape(field: Any, *, context: str, physical: bool) -> None:
    _require_exact_keys(field, FIELD_KEYS, context=context)
    for key in ("name", "zh_name", "data_type", "description", "purpose", "example"):
        _require_nonblank(field[key], context=f"{context}.{key}")
    if not isinstance(field["notes"], str):
        _fail("invalid_model_shape", f"Expected notes string at {context}")
    for key in ("nullable", "pk", "unique"):
        if type(field[key]) is not bool:
            _fail("invalid_model_shape", f"Expected boolean at {context}.{key}")
    if field["default"] is not None and not isinstance(field["default"], str):
        _fail("invalid_model_shape", f"Expected nullable default string at {context}")
    if field["fk"] is not None and not isinstance(field["fk"], str):
        _fail("invalid_model_shape", f"Expected nullable FK string at {context}")
    if field["fk_activation"] not in ALLOWED_FK_ACTIVATIONS:
        _fail("invalid_model_shape", f"Unknown FK activation at {context}")
    if field["sensitive"] not in ALLOWED_SENSITIVITY:
        _fail("invalid_model_shape", f"Unknown sensitivity at {context}")
    _require_string_list(field["checks"], context=f"{context}.checks")
    if physical and field["data_type"] not in ALLOWED_TYPES:
        _fail("unknown_type", f"Unknown physical type at {context}: {field['data_type']!r}")


def _validate_source_fidelity_shape(value: Any) -> None:
    context = "root.source_fidelity_contracts"
    _require_exact_keys(value, SOURCE_FIDELITY_KEYS, context=context)
    section_keys = {
        "cost_item_source_audit": frozenset(
            {
                "provenance",
                "source_object",
                "row_count",
                "route_counts",
                "product_identity_routes",
                "material_routes",
                "base_unit_source_counts",
                "base_unit_approved_map",
                "status_source_counts",
                "source_ref_source_counts",
                "unknown_item_type_policy",
                "unknown_base_unit_policy",
                "name_identity_policy",
                "source_ref_policy",
            }
        ),
        "cost_item_source_ref_probe": frozenset(
            {
                "transaction_mode",
                "source_project_ref",
                "database",
                "server_version_num",
                "transaction_timestamp_utc",
                "transaction_timestamp_myt",
                "txid_current_if_assigned",
                "query",
                "result_group_count",
                "canonicalization",
                "canonical_json_sha256",
                "classified_counts",
                "superseded_incorrect_oral_counts",
            }
        ),
        "cost_recipe_output_audit": frozenset(
            {
                "source_object",
                "version_count",
                "family_count",
                "product_output",
                "semi_finished_output",
            }
        ),
        "hbti_result_only_anchor": frozenset(
            {
                "uuid5_root",
                "prefix",
                "typed_jcs_components",
                "attempt_no",
                "response_status",
                "validation_result",
                "source_observation",
                "result_only_count",
                "full_fact_count",
            }
        ),
        "reward_source_audit": frozenset(
            {
                "provenance",
                "reward_identity_count",
                "stock_row_count",
                "allocated_quantity",
                "reserved_quantity",
                "redeemed_quantity",
                "damaged_quantity",
                "claim_count",
                "stock_claim_count",
                "stockless_external_fulfillment_count",
                "source_fulfillment_id_count",
                "source_fulfillment_id_unique_count",
                "confirmed_at_present_count",
                "heart_stock_claim_count",
                "pistachio_stockless_claim_count",
                "butterfly_redeemed_quantity",
                "butterfly_claim_count",
                "butterfly_reconciliation_status",
            }
        ),
    }
    for section, expected_keys in section_keys.items():
        _require_exact_keys(value[section], expected_keys, context=f"{context}.{section}")
    nested_exact_keys = (
        ("cost_item_source_audit", "route_counts", {"PRODUCT", "INGREDIENT", "SEMI_FINISHED", "PACKAGING"}),
        ("cost_item_source_audit", "product_identity_routes", {"MERGE_VIA_LINK_POS_LISTING_OLD_PRODUCT_ITEM_KEY", "CREATE_SOURCE_KEYED_LEGACY_PRODUCT"}),
        ("cost_item_source_audit", "material_routes", {"INGREDIENT", "SEMI_FINISHED", "PACKAGING"}),
        ("cost_item_source_audit", "base_unit_source_counts", {"g", "ea", "个"}),
        ("cost_item_source_audit", "base_unit_approved_map", {"g", "ea", "个"}),
        ("cost_item_source_audit", "status_source_counts", {"active"}),
        ("cost_item_source_audit", "source_ref_source_counts", {"mysql", "manual", "NULL", "other"}),
        ("cost_item_source_ref_probe", "classified_counts", {"total", "null", "mysql", "manual", "other"}),
        ("cost_recipe_output_audit", "product_output", {"version_count", "family_count"}),
        ("cost_recipe_output_audit", "semi_finished_output", {"version_count", "family_count"}),
    )
    for section, key, expected in nested_exact_keys:
        _require_exact_keys(
            value[section][key],
            frozenset(expected),
            context=f"{context}.{section}.{key}",
        )
    templates = value["reward_template_allowlist"]
    if not isinstance(templates, list) or len(templates) != 10:
        _fail("invalid_model_shape", f"Expected ten reward templates at {context}")
    for index, template in enumerate(templates):
        template_context = f"{context}.reward_template_allowlist[{index}]"
        _require_exact_keys(template, REWARD_TEMPLATE_KEYS, context=template_context)
        for key in REWARD_TEMPLATE_KEYS - {"evidence_path_lines"}:
            _require_nonblank(template[key], context=f"{template_context}.{key}")
        _require_string_list(
            template["evidence_path_lines"],
            context=f"{template_context}.evidence_path_lines",
            nonempty=True,
        )
    digest = value["reward_template_allowlist_sha256"]
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        _fail("invalid_model_shape", f"Invalid reward allowlist SHA-256 at {context}")


def _validate_closed_model_shape(model: Any) -> None:
    _require_exact_keys(model, ROOT_KEYS, context="root")
    if model["model_version"] != "HOTCRUSH-CORE-V1-REVIEW-R6-2026-08-10":
        _fail("wrong_model_version", f"Unexpected model version: {model['model_version']!r}")
    _require_string_list(model["generated_from"], context="root.generated_from", nonempty=True)
    if not isinstance(model["tables"], list) or not isinstance(model["views"], list):
        _fail("invalid_model_shape", "tables and views must be lists")
    for table_index, table in enumerate(model["tables"]):
        context = f"root.tables[{table_index}]"
        _require_exact_keys(table, TABLE_KEYS, context=context)
        for key in (
            "name",
            "zh_name",
            "domain",
            "purpose",
            "grain",
            "writer",
            "source",
            "lifecycle",
            "mutation_policy",
            "retention",
        ):
            _require_nonblank(table[key], context=f"{context}.{key}")
        if table["domain"] not in DOMAIN_FILES:
            _fail("unknown_domain", f"Unknown domain at {context}: {table['domain']!r}")
        if table["lifecycle"] not in ALLOWED_LIFECYCLES:
            _fail("invalid_model_shape", f"Unknown lifecycle at {context}")
        if table["mutation_policy"] not in ALLOWED_MUTATION_POLICIES:
            _fail("invalid_model_shape", f"Unknown mutation policy at {context}")
        if not isinstance(table["notes"], str):
            _fail("invalid_model_shape", f"Expected notes string at {context}")
        _require_string_list(table["readers"], context=f"{context}.readers", nonempty=True)
        if not isinstance(table["fields"], list) or not table["fields"]:
            _fail("invalid_model_shape", f"Expected nonempty fields at {context}")
        for field_index, field in enumerate(table["fields"]):
            _validate_field_shape(
                field,
                context=f"{context}.fields[{field_index}]",
                physical=True,
            )
        if not isinstance(table["foreign_keys"], list):
            _fail("invalid_model_shape", f"Expected list at {context}.foreign_keys")
        for fk_index, foreign_key in enumerate(table["foreign_keys"]):
            fk_context = f"{context}.foreign_keys[{fk_index}]"
            _require_exact_keys(foreign_key, TABLE_FOREIGN_KEY_KEYS, context=fk_context)
            _require_string_list(
                foreign_key["columns"], context=f"{fk_context}.columns", nonempty=True
            )
            _require_nonblank(foreign_key["ref_table"], context=f"{fk_context}.ref_table")
            _require_string_list(
                foreign_key["ref_columns"],
                context=f"{fk_context}.ref_columns",
                nonempty=True,
            )
            if foreign_key["fk_activation"] not in ALLOWED_FK_ACTIVATIONS:
                _fail("invalid_model_shape", f"Unknown FK activation at {fk_context}")
            _require_nonblank(foreign_key["match_type"], context=f"{fk_context}.match_type")
        for key in (
            "uniques",
            "nulls_not_distinct_uniques",
            "nulls_distinct_uniques",
        ):
            if not isinstance(table[key], list):
                _fail("invalid_model_shape", f"Expected list at {context}.{key}")
            for group_index, group in enumerate(table[key]):
                _require_string_list(
                    group,
                    context=f"{context}.{key}[{group_index}]",
                    nonempty=True,
                )
        _require_string_list(table["checks"], context=f"{context}.checks")
        _require_string_list(table["exclusions"], context=f"{context}.exclusions")
    for view_index, view in enumerate(model["views"]):
        context = f"root.views[{view_index}]"
        _require_exact_keys(view, VIEW_KEYS, context=context)
        for key in ("name", "zh_name", "domain", "purpose", "grain", "readiness_status"):
            _require_nonblank(view[key], context=f"{context}.{key}")
        if view["domain"] not in DOMAIN_FILES:
            _fail("unknown_domain", f"Unknown view domain at {context}")
        if view["readiness_status"] not in ALLOWED_VIEW_READINESS:
            _fail("invalid_view_readiness", f"Unknown view readiness at {context}")
        if not isinstance(view["notes"], str):
            _fail("invalid_model_shape", f"Expected notes string at {context}")
        if view["grain_key"] is not None:
            _require_string_list(view["grain_key"], context=f"{context}.grain_key", nonempty=True)
        for key in ("readers", "lineage", "readiness_blockers"):
            _require_string_list(view[key], context=f"{context}.{key}", nonempty=key != "readiness_blockers")
        if not isinstance(view["fields"], list) or not view["fields"]:
            _fail("invalid_model_shape", f"Expected nonempty view fields at {context}")
        for field_index, field in enumerate(view["fields"]):
            _validate_field_shape(
                field,
                context=f"{context}.fields[{field_index}]",
                physical=False,
            )
            if field["data_type"] not in ALLOWED_VIEW_TYPES:
                _fail(
                    "unknown_view_type",
                    f"Unknown view type at {context}.fields[{field_index}]: {field['data_type']!r}",
                )
            if not (
                field["default"] is None
                and field["fk"] is None
                and field["fk_activation"] == "WITH_TABLE"
                and field["pk"] is False
                and field["unique"] is False
                and field["checks"] == []
            ):
                _fail(
                    "invalid_view_field_contract",
                    f"View field carries physical-write semantics at {context}.fields[{field_index}]",
                )
    if not isinstance(model["end_to_end_chains"], list):
        _fail("invalid_model_shape", "end_to_end_chains must be a list")
    for index, chain in enumerate(model["end_to_end_chains"]):
        context = f"root.end_to_end_chains[{index}]"
        _require_exact_keys(chain, END_TO_END_CHAIN_KEYS, context=context)
        if type(chain["number"]) is not int:
            _fail("invalid_model_shape", f"Expected integer at {context}.number")
        for key in ("name", "question", "control"):
            _require_nonblank(chain[key], context=f"{context}.{key}")
        for key in ("nodes", "joins"):
            _require_string_list(chain[key], context=f"{context}.{key}", nonempty=True)
    if not isinstance(model["minimum_grain_audits"], list):
        _fail("invalid_model_shape", "minimum_grain_audits must be a list")
    for index, audit in enumerate(model["minimum_grain_audits"]):
        context = f"root.minimum_grain_audits[{index}]"
        _require_exact_keys(audit, MINIMUM_GRAIN_AUDIT_KEYS, context=context)
        for key in MINIMUM_GRAIN_AUDIT_KEYS - {"derived_fields"}:
            _require_nonblank(audit[key], context=f"{context}.{key}")
        _require_string_list(audit["derived_fields"], context=f"{context}.derived_fields")
    view_names = {view["name"] for view in model["views"]}
    for key in ("view_base_tables", "view_implementation_tiers"):
        value = model[key]
        if not isinstance(value, dict) or set(value) != view_names:
            _fail("invalid_model_shape", f"{key} must cover the exact view set")
    for view_name, bases in model["view_base_tables"].items():
        _require_string_list(bases, context=f"root.view_base_tables.{view_name}", nonempty=True)
    for view_name, tier in model["view_implementation_tiers"].items():
        _require_nonblank(tier, context=f"root.view_implementation_tiers.{view_name}")
        if tier not in ALLOWED_VIEW_TIERS:
            _fail("invalid_view_readiness", f"Unknown implementation tier for {view_name}")
    _require_exact_keys(
        model["view_readiness_boundary"],
        VIEW_READINESS_BOUNDARY_KEYS,
        context="root.view_readiness_boundary",
    )
    for key in VIEW_READINESS_BOUNDARY_KEYS - {"pass_semantics"}:
        if type(model["view_readiness_boundary"][key]) is not int:
            _fail("invalid_model_shape", f"Expected integer at view_readiness_boundary.{key}")
    _require_nonblank(
        model["view_readiness_boundary"]["pass_semantics"],
        context="root.view_readiness_boundary.pass_semantics",
    )
    _require_exact_keys(
        model["view_readiness_counts"],
        VIEW_READINESS_COUNT_KEYS,
        context="root.view_readiness_counts",
    )
    if any(type(value) is not int for value in model["view_readiness_counts"].values()):
        _fail("invalid_model_shape", "view_readiness_counts values must be integers")
    actual_readiness = {
        status: sum(view["readiness_status"] == status for view in model["views"])
        for status in ALLOWED_VIEW_READINESS
    }
    if model["view_readiness_counts"] != actual_readiness:
        _fail(
            "invalid_view_readiness",
            "view_readiness_counts does not match the 59 declared views",
            actual=actual_readiness,
            declared=model["view_readiness_counts"],
        )
    _validate_source_fidelity_shape(model["source_fidelity_contracts"])


def _require_identifier(value: Any, *, context: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER_RE.fullmatch(value):
        _fail("unsafe_identifier", f"Unsafe identifier at {context}: {value!r}")
    if len(value.encode("utf-8")) > 63:
        _fail("unsafe_identifier", f"Identifier exceeds 63 bytes at {context}: {value}")
    return value


def _check_default_compatibility(data_type: str, default: str, context: str) -> None:
    if default == "gen_random_uuid()" and data_type != "uuid":
        _fail("incompatible_default", f"UUID default on {data_type} at {context}")
    if default == "now()" and data_type != "timestamptz":
        _fail("incompatible_default", f"time default on {data_type} at {context}")
    if default == "CURRENT_DATE" and data_type != "date":
        _fail("incompatible_default", f"date default on {data_type} at {context}")
    if default in {"true", "false"} and data_type != "boolean":
        _fail("incompatible_default", f"boolean default on {data_type} at {context}")
    if default == "'{}'::jsonb" and data_type != "jsonb":
        _fail("incompatible_default", f"jsonb default on {data_type} at {context}")
    if default == "'{}'::text[]" and data_type != "text[]":
        _fail("incompatible_default", f"array default on {data_type} at {context}")
    if default in {"0", "1", "3", "100"} and not (
        data_type in {"bigint", "integer", "smallint"} or data_type.startswith("numeric(")
    ):
        _fail("incompatible_default", f"numeric default on {data_type} at {context}")
    if default in STRING_DEFAULT_TYPES and data_type not in STRING_DEFAULT_TYPES[default]:
        allowed = ", ".join(sorted(STRING_DEFAULT_TYPES[default]))
        _fail(
            "incompatible_default",
            f"String default {default} requires {allowed}, not {data_type}, at {context}",
        )


def _tokenize_check(expression: str) -> list[tuple[str, str]]:
    for fragment in FORBIDDEN_CHECK_FRAGMENTS:
        if fragment in expression:
            _fail("unsafe_check", f"Forbidden check fragment {fragment!r}: {expression}")
    tokens: list[tuple[str, str]] = []
    index = 0
    while index < len(expression):
        char = expression[index]
        if char.isspace():
            index += 1
            continue
        if expression.startswith("public.app_normalize_alias_v1", index):
            tokens.append(("UDF", "public.app_normalize_alias_v1"))
            index += len("public.app_normalize_alias_v1")
            continue
        if char == "'":
            end = index + 1
            while end < len(expression):
                if expression[end] == "'":
                    if end + 1 < len(expression) and expression[end + 1] == "'":
                        end += 2
                        continue
                    end += 1
                    break
                end += 1
            else:
                _fail("unsafe_check", f"Unterminated string literal: {expression}")
            tokens.append(("STRING", expression[index:end]))
            index = end
            continue
        two = expression[index : index + 2]
        if two in {"<=", ">=", "<>"}:
            tokens.append(("OP", two))
            index += 2
            continue
        if char in "(),=<>+-*/~":
            tokens.append(("PUNCT", char))
            index += 1
            continue
        if char.isdigit():
            match = re.match(r"\d+(?:\.\d+)?", expression[index:])
            assert match is not None
            tokens.append(("NUMBER", match.group(0)))
            index += len(match.group(0))
            continue
        if char.isalpha() or char == "_":
            match = re.match(r"[A-Za-z_][A-Za-z0-9_]*", expression[index:])
            assert match is not None
            tokens.append(("WORD", match.group(0)))
            index += len(match.group(0))
            continue
        _fail("unsafe_check", f"Unrecognized character {char!r}: {expression}")
    return tokens


def compile_check_expression(expression: str, columns: set[str]) -> str:
    if not isinstance(expression, str) or not expression.strip():
        _fail("unsafe_check", f"Empty or non-string CHECK: {expression!r}")
    tokens = _tokenize_check(expression)
    rendered: list[str] = []
    depth = 0
    for index, (kind, token) in enumerate(tokens):
        if token == "(":
            depth += 1
        elif token == ")":
            depth -= 1
            if depth < 0:
                _fail("unsafe_check", f"Unbalanced CHECK: {expression}")
        if kind == "WORD":
            upper = token.upper()
            if upper in FORBIDDEN_CHECK_WORDS:
                _fail("unsafe_check", f"Forbidden CHECK word {token}: {expression}")
            if token in columns:
                rendered.append(f'"{token}"')
            elif upper in CHECK_KEYWORDS:
                rendered.append(upper)
            elif token in CHECK_FUNCTIONS:
                if index + 1 >= len(tokens) or tokens[index + 1][1] != "(":
                    _fail("unsafe_check", f"Function without call syntax: {expression}")
                rendered.append(CHECK_FUNCTIONS[token])
            else:
                _fail("unsafe_check_identifier", f"Unknown identifier {token!r}: {expression}")
        elif kind == "UDF":
            if index + 1 >= len(tokens) or tokens[index + 1][1] != "(":
                _fail("unsafe_check", f"UDF without call syntax: {expression}")
            rendered.append(token)
        else:
            rendered.append(token)
    if depth != 0:
        _fail("unsafe_check", f"Unbalanced CHECK: {expression}")
    return " ".join(rendered)


def _validate_unique_columns(table: dict[str, Any], columns: set[str]) -> tuple[int, int, int]:
    base = [tuple(item) for item in table["uniques"]]
    nnd = [tuple(item) for item in table["nulls_not_distinct_uniques"]]
    nd = [tuple(item) for item in table["nulls_distinct_uniques"]]
    for label, groups in (("unique", base), ("nnd", nnd), ("nd", nd)):
        if len(groups) != len(set(groups)):
            _fail("duplicate_unique", f"Duplicate {label} on {table['name']}")
        for group in groups:
            if not group or any(column not in columns for column in group):
                _fail("invalid_unique", f"Invalid {label} {group} on {table['name']}")
    if not set(nnd).issubset(base) or not set(nd).issubset(base) or set(nnd) & set(nd):
        _fail("invalid_unique", f"Special NULL uniqueness is inconsistent on {table['name']}")
    ordinary = set(base) - set(nnd) - set(nd)
    return len(ordinary), len(nnd), len(nd)


def _eligible_reference_keys(table: dict[str, Any]) -> set[tuple[str, ...]]:
    primary_key = tuple(field["name"] for field in table["fields"] if field["pk"])
    return {primary_key, *(tuple(group) for group in table["uniques"])}


def _validate_model_semantics(model: dict[str, Any]) -> None:
    if len(model["tables"]) != 137 or len(model["views"]) != 59:
        _fail(
            "wrong_model_object_counts",
            "P0b requires exactly 137 tables and 59 declared views",
        )
    lifecycle_counts = {
        lifecycle: sum(table["lifecycle"] == lifecycle for table in model["tables"])
        for lifecycle in ALLOWED_LIFECYCLES
    }
    if lifecycle_counts != {
        "CORE_MIGRATION": 100,
        "PLANNED_MODULE": 33,
        "SOURCE_CONDITIONAL": 4,
    }:
        _fail("wrong_model_object_counts", "Lifecycle table counts differ from P0b")

    tables: dict[str, dict[str, Any]] = {}
    table_columns: dict[str, dict[str, dict[str, Any]]] = {}
    for table in model["tables"]:
        name = _require_identifier(table["name"], context="model table")
        if name in tables:
            _fail("duplicate_table", f"Duplicate table {name}")
        tables[name] = table
        columns: dict[str, dict[str, Any]] = {}
        for field in table["fields"]:
            field_name = _require_identifier(field["name"], context=name)
            if field_name in columns:
                _fail("duplicate_field", f"Duplicate {name}.{field_name}")
            if field["default"] is not None:
                if field["default"] not in ALLOWED_DEFAULTS:
                    _fail(
                        "unknown_default",
                        f"Unknown model default {field['default']!r} on {name}.{field_name}",
                    )
                _check_default_compatibility(
                    field["data_type"], field["default"], f"{name}.{field_name}"
                )
            columns[field_name] = field
        table_columns[name] = columns

    view_names: set[str] = set()
    for view in model["views"]:
        view_name = _require_identifier(view["name"], context="model view")
        if view_name in view_names or view_name in tables:
            _fail("duplicate_relation", f"Duplicate table/view relation name {view_name}")
        view_names.add(view_name)
        field_names: set[str] = set()
        for field in view["fields"]:
            field_name = _require_identifier(field["name"], context=view_name)
            if field_name in field_names:
                _fail("duplicate_field", f"Duplicate {view_name}.{field_name}")
            field_names.add(field_name)
        if view["grain_key"] is not None and not set(view["grain_key"]).issubset(field_names):
            _fail("invalid_view_lineage", f"Unknown grain key on {view_name}")
        valid_lineage = set(tables) | view_names | {
            candidate["name"] for candidate in model["views"]
        }
        if not set(view["lineage"]).issubset(valid_lineage):
            _fail("invalid_view_lineage", f"Unknown lineage object on {view_name}")

    for view_name, bases in model["view_base_tables"].items():
        if not set(bases).issubset(tables):
            _fail("invalid_view_lineage", f"Unknown base table for {view_name}")

    declared_fks = 0
    deferred_core: set[tuple[str, str, str, str]] = set()
    for table in model["tables"]:
        columns = table_columns[table["name"]]
        pk = [field for field in table["fields"] if field["pk"]]
        if len(pk) != 1:
            _fail("invalid_primary_key", f"Expected one PK on {table['name']}")
        if pk[0]["nullable"]:
            _fail("nullable_primary_key", f"Nullable PK on {table['name']}.{pk[0]['name']}")
        if table["lifecycle"] == "CORE_MIGRATION" and not (
            pk[0]["data_type"] == "uuid"
            and pk[0]["default"] == "gen_random_uuid()"
            and pk[0]["fk"] is None
            and pk[0]["fk_activation"] == "WITH_TABLE"
            and pk[0]["unique"] is False
        ):
            _fail(
                "invalid_primary_key_contract",
                f"Phase 1 PK contract drift on {table['name']}.{pk[0]['name']}",
            )
        for field in table["fields"]:
            if (
                table["lifecycle"] == "CORE_MIGRATION"
                and field["fk"] is not None
                and field["fk_activation"] != "WITH_TABLE"
                and not field["nullable"]
            ):
                _fail(
                    "invalid_deferred_foreign_key",
                    f"Deferred Phase 1 FK must be nullable: {table['name']}.{field['name']}",
                )

        _validate_unique_columns(table, set(columns))
        nnd = {tuple(group) for group in table["nulls_not_distinct_uniques"]}
        nd = {tuple(group) for group in table["nulls_distinct_uniques"]}
        singleton_uniques = {
            group[0] for group in table["uniques"] if len(group) == 1
        }
        for group_list in table["uniques"]:
            group = tuple(group_list)
            contains_nullable = any(columns[column]["nullable"] for column in group)
            classified = group in nnd or group in nd
            if contains_nullable != classified:
                _fail(
                    "invalid_unique_null_policy",
                    f"Nullable UNIQUE null policy is incomplete on {table['name']} {group}",
                )
        for field in table["fields"]:
            if field["unique"] and field["name"] not in singleton_uniques:
                _fail(
                    "invalid_unique",
                    f"field.unique lacks singleton UNIQUE on {table['name']}.{field['name']}",
                )
            if field["fk"] is None:
                if field["fk_activation"] != "WITH_TABLE":
                    _fail(
                        "invalid_fk_activation",
                        f"FK activation without FK on {table['name']}.{field['name']}",
                    )
                continue
            if table["lifecycle"] == "CORE_MIGRATION":
                declared_fks += 1
            parts = field["fk"].split(".")
            if len(parts) != 2:
                _fail("invalid_foreign_key", f"Invalid FK on {table['name']}.{field['name']}")
            ref_table, ref_field = parts
            if ref_table not in table_columns or ref_field not in table_columns[ref_table]:
                _fail("invalid_foreign_key", f"Unknown FK target {field['fk']}")
            target = table_columns[ref_table][ref_field]
            if field["data_type"] != target["data_type"]:
                _fail(
                    "foreign_key_type_mismatch",
                    f"FK type mismatch on {table['name']}.{field['name']}",
                )
            target_table = tables[ref_table]
            eligible = _eligible_reference_keys(target_table)
            if (ref_field,) not in eligible:
                _fail(
                    "ineligible_foreign_key_target",
                    f"FK target is not an exact singleton PK/UNIQUE: {field['fk']}",
                )
            if table["lifecycle"] == "CORE_MIGRATION":
                if field["fk_activation"] == "WITH_TABLE":
                    if target_table["lifecycle"] != "CORE_MIGRATION":
                        _fail(
                            "invalid_fk_activation",
                            f"Active Phase 1 FK targets non-core table: {field['fk']}",
                        )
                else:
                    if not field["nullable"]:
                        _fail(
                            "invalid_deferred_foreign_key",
                            f"Deferred Phase 1 FK must be nullable: {table['name']}.{field['name']}",
                        )
                    deferred_core.add(
                        (
                            table["name"],
                            field["name"],
                            field["fk"],
                            field["fk_activation"],
                        )
                    )
        for table_fk in table["foreign_keys"]:
            local_columns = tuple(table_fk["columns"])
            ref_columns = tuple(table_fk["ref_columns"])
            if (
                table_fk["match_type"] != "SIMPLE"
                or len(local_columns) != len(ref_columns)
                or len(local_columns) < 2
                or len(set(local_columns)) != len(local_columns)
                or len(set(ref_columns)) != len(ref_columns)
            ):
                _fail(
                    "invalid_foreign_key",
                    f"Invalid composite FK shape on {table['name']}: {table_fk!r}",
                )
            if any(column not in columns for column in local_columns):
                _fail("invalid_foreign_key", f"Unknown local composite FK column on {table['name']}")
            ref_table = table_fk["ref_table"]
            if ref_table not in table_columns or any(
                column not in table_columns[ref_table] for column in ref_columns
            ):
                _fail("invalid_foreign_key", f"Unknown composite FK target on {table['name']}")
            for local_column, ref_column in zip(local_columns, ref_columns, strict=True):
                if columns[local_column]["data_type"] != table_columns[ref_table][ref_column]["data_type"]:
                    _fail(
                        "foreign_key_type_mismatch",
                        f"Composite FK type mismatch on {table['name']}.{local_column}",
                    )
            target_table = tables[ref_table]
            if ref_columns not in _eligible_reference_keys(target_table):
                _fail(
                    "ineligible_foreign_key_target",
                    f"Composite FK target is not an exact PK/UNIQUE on {table['name']}",
                )
            if table["lifecycle"] == "CORE_MIGRATION":
                declared_fks += 1
                if table_fk["fk_activation"] != "WITH_TABLE":
                    _fail(
                        "invalid_deferred_foreign_key",
                        f"P0c composite FK must be active on {table['name']}",
                    )
                if target_table["lifecycle"] != "CORE_MIGRATION":
                    _fail(
                        "invalid_fk_activation",
                        f"Active composite FK targets non-core table on {table['name']}",
                    )
    if declared_fks != 291 or deferred_core != EXPECTED_DEFERRED_CORE_FKS:
        _fail(
            "invalid_deferred_foreign_key",
            "Declared/deferred FK set differs from P0c",
            declared_count=declared_fks,
            deferred=sorted(deferred_core),
        )

    audit_names = [audit["table_name"] for audit in model["minimum_grain_audits"]]
    if len(audit_names) != 137 or set(audit_names) != set(tables):
        _fail("invalid_model_shape", "minimum_grain_audits must cover every table once")
    chain_numbers = [chain["number"] for chain in model["end_to_end_chains"]]
    if chain_numbers != list(range(1, 16)):
        _fail("invalid_model_shape", "end_to_end_chains must be ordered 1 through 15")
    known_nodes = set(tables) | view_names
    if any(
        not set(chain["nodes"]).issubset(known_nodes)
        for chain in model["end_to_end_chains"]
    ):
        _fail("invalid_model_shape", "end_to_end_chains contains unknown objects")

    boundary = model["view_readiness_boundary"]
    if not (
        boundary["phase1_design_candidates"] == 41
        and boundary["select_spec_ready"] == 10
        and boundary["created_and_validated_sql_views"] == 0
    ):
        _fail("invalid_view_readiness", "View readiness boundary differs from P0b")


def _canonical_model_sha256(model: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(
            model,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _missing_p0_checks(tables: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    missing: dict[str, list[str]] = {}
    for table_name, expressions in REQUIRED_P0_CHECKS.items():
        absent = [expr for expr in expressions if expr not in tables[table_name]["checks"]]
        if absent:
            missing[table_name] = absent
    return missing


def build_phase1_plan(model: dict[str, Any]) -> Phase1Plan:
    _validate_closed_model_shape(model)
    _validate_model_semantics(model)
    all_names: set[str] = set()
    for raw in model["tables"]:
        name = _require_identifier(raw.get("name"), context="table")
        if name in all_names:
            _fail("duplicate_table", f"Duplicate table {name}")
        all_names.add(name)
    core = tuple(sorted(
        (table for table in model["tables"] if table.get("lifecycle") == "CORE_MIGRATION"),
        key=lambda table: table["name"],
    ))
    if len(core) != 100:
        _fail("wrong_table_count", f"Expected 100 CORE_MIGRATION tables, got {len(core)}")
    tables = {table["name"]: table for table in core}
    raw_check_rows: list[dict[str, Any]] = []
    for table in core:
        raw_check_rows.extend(
            {
                "table": table["name"],
                "scope": "table",
                "ordinal": ordinal,
                "expression": expression,
            }
            for ordinal, expression in enumerate(table["checks"], 1)
        )
        for field in table["fields"]:
            raw_check_rows.extend(
                {
                    "table": table["name"],
                    "scope": f"field:{field['name']}",
                    "ordinal": ordinal,
                    "expression": expression,
                }
                for ordinal, expression in enumerate(field["checks"], 1)
            )
    raw_check_hash = _canonical_records_sha256(
        raw_check_rows,
        sort_keys=("table", "scope", "ordinal", "expression"),
    )
    if raw_check_hash != EXPECTED_CHECK_CONTRACT_SHA256:
        _fail(
            "frozen_check_contract_drift",
            "Phase 1 CHECK edge set differs from the frozen P0c contract",
            actual_sha256=raw_check_hash,
            expected_sha256=EXPECTED_CHECK_CONTRACT_SHA256,
            actual_count=len(raw_check_rows),
            expected_count=332,
        )

    checks: list[dict[str, Any]] = []
    fks: list[dict[str, Any]] = []
    indexes: list[dict[str, Any]] = []
    counts = {
        "tables": len(core),
        "columns": 0,
        "primary_keys": 0,
        "unique_constraints": 0,
        "checks": 0,
        "exclusions": 0,
        "foreign_keys": 0,
        "foreign_key_indexes": 0,
        "table_comments": len(core),
        "column_comments": 0,
        "created_custom_roles": len(CREATED_ROLE_NAMES),
        "internal_owner_roles": 0,
        "roles": len(CREATED_ROLE_NAMES),
        "rls_enabled": len(core),
        "rls_forced": len(core),
        "policies": 0,
        "table_object_grants": 0,
        "schema_usage_grants": 4,
        "schema_create_grants": 0,
        "views": 0,
    }
    ordinary_total = nnd_total = nd_total = 0
    table_columns: dict[str, dict[str, dict[str, Any]]] = {}
    for table in core:
        if table.get("domain") not in DOMAIN_FILES:
            _fail("unknown_domain", f"Unknown Phase 1 domain on {table['name']}")
        fields = table.get("fields")
        if not isinstance(fields, list) or not fields:
            _fail("invalid_fields", f"No fields on {table['name']}")
        field_map: dict[str, dict[str, Any]] = {}
        for field in fields:
            field_name = _require_identifier(field.get("name"), context=table["name"])
            if field_name in field_map:
                _fail("duplicate_field", f"Duplicate {table['name']}.{field_name}")
            data_type = field.get("data_type")
            if data_type not in ALLOWED_TYPES:
                _fail("unknown_type", f"Unknown type {data_type!r} on {table['name']}.{field_name}")
            default = field.get("default")
            if default is not None:
                if default not in ALLOWED_DEFAULTS:
                    _fail("unknown_default", f"Unknown default {default!r} on {table['name']}.{field_name}")
                _check_default_compatibility(data_type, default, f"{table['name']}.{field_name}")
            for required_text in (field.get("zh_name"), field.get("description"), field.get("purpose")):
                if not isinstance(required_text, str) or not required_text.strip():
                    _fail("missing_comment_contract", f"Incomplete comment contract on {table['name']}.{field_name}")
            field_map[field_name] = field
        table_columns[table["name"]] = field_map
        pk = [field["name"] for field in fields if field.get("pk") is True]
        if len(pk) != 1:
            _fail("invalid_primary_key", f"Expected one PK column on {table['name']}, got {pk}")
        if field_map[pk[0]]["nullable"]:
            _fail("nullable_primary_key", f"Primary key is nullable on {table['name']}.{pk[0]}")
        counts["primary_keys"] += 1
        ordinary, nnd, nd = _validate_unique_columns(table, set(field_map))
        ordinary_total += ordinary
        nnd_total += nnd
        nd_total += nd
        counts["unique_constraints"] += ordinary + nnd + nd
        for ordinal, expression in enumerate(table["checks"], 1):
            compiled = compile_check_expression(expression, set(field_map))
            checks.append({"table": table["name"], "scope": "table", "ordinal": ordinal, "expression": expression, "compiled": compiled})
        for field in fields:
            for ordinal, expression in enumerate(field["checks"], 1):
                compiled = compile_check_expression(expression, set(field_map))
                checks.append({"table": table["name"], "scope": f"field:{field['name']}", "ordinal": ordinal, "expression": expression, "compiled": compiled})
        counts["checks"] += len(table["checks"]) + sum(len(field["checks"]) for field in fields)
        counts["exclusions"] += len(table["exclusions"])
        counts["columns"] += len(fields)
        counts["column_comments"] += len(fields)

    if (ordinary_total, nnd_total, nd_total) != (78, 9, 15):
        _fail("wrong_unique_counts", f"Expected UNIQUE 78+9+15, got {ordinary_total}+{nnd_total}+{nd_total}")
    actual_unique_hash = _unique_contract_sha256_tables(core)
    if actual_unique_hash != EXPECTED_UNIQUE_CONTRACT_SHA256:
        _fail(
            "frozen_unique_contract_drift",
            "Phase 1 UNIQUE/null-semantics contract differs from the frozen P0c model",
            actual_sha256=actual_unique_hash,
            expected_sha256=EXPECTED_UNIQUE_CONTRACT_SHA256,
        )

    actual_exclusions = {
        (table["name"], expression)
        for table in core
        for expression in table["exclusions"]
    }
    expected_exclusions = set(EXCLUSION_SPECS)
    if actual_exclusions != expected_exclusions:
        _fail(
            "unknown_exclusion",
            "Symbolic exclusions do not match the approved 19-item closed set",
            missing=sorted(expected_exclusions - actual_exclusions),
            unknown=sorted(actual_exclusions - expected_exclusions),
        )
    exclusion_names = [spec.name for spec in EXCLUSION_SPECS.values()]
    if len(exclusion_names) != len(set(exclusion_names)):
        _fail("duplicate_exclusion_name", "Approved exclusion names are not unique")

    for table in core:
        for field in table["fields"]:
            fk = field.get("fk")
            if not fk or field.get("fk_activation") != "WITH_TABLE":
                continue
            ref_table, ref_field = fk.split(".")
            fks.append(
                {
                    "table": table["name"],
                    "columns": (field["name"],),
                    "ref_table": ref_table,
                    "ref_columns": (ref_field,),
                    "fk_activation": "WITH_TABLE",
                    "match_type": "SIMPLE",
                    "origin": "FIELD",
                }
            )
        for table_fk in table["foreign_keys"]:
            if table_fk["fk_activation"] != "WITH_TABLE":
                continue
            fks.append(
                {
                    "table": table["name"],
                    "columns": tuple(table_fk["columns"]),
                    "ref_table": table_fk["ref_table"],
                    "ref_columns": tuple(table_fk["ref_columns"]),
                    "fk_activation": table_fk["fk_activation"],
                    "match_type": table_fk["match_type"],
                    "origin": "TABLE",
                }
            )
    fks.sort(
        key=lambda edge: (
            edge["table"],
            tuple(edge["columns"]),
            edge["ref_table"],
            tuple(edge["ref_columns"]),
            edge["origin"],
        )
    )
    semantic_edges = {
        (
            edge["table"],
            tuple(edge["columns"]),
            edge["ref_table"],
            tuple(edge["ref_columns"]),
            edge["match_type"],
        )
        for edge in fks
    }
    if len(semantic_edges) != len(fks):
        _fail("duplicate_foreign_key", "Duplicate active Phase 1 FK edge")

    available_btree_prefixes: dict[str, set[tuple[str, ...]]] = {}
    for table in core:
        available_btree_prefixes[table["name"]] = _eligible_reference_keys(table)
    index_candidates = sorted(
        fks,
        key=lambda edge: (
            edge["table"],
            -len(edge["columns"]),
            tuple(edge["columns"]),
            edge["ref_table"],
            tuple(edge["ref_columns"]),
        ),
    )
    for edge in index_candidates:
        columns = tuple(edge["columns"])
        prefixes = available_btree_prefixes[edge["table"]]
        if any(prefix[: len(columns)] == columns for prefix in prefixes):
            continue
        indexes.append({"table": edge["table"], "columns": columns})
        prefixes.add(columns)
    indexes.sort(key=lambda index: (index["table"], tuple(index["columns"])))
    counts["foreign_keys"] = len(fks)
    counts["foreign_key_indexes"] = len(indexes)

    actual_fk_hash = _canonical_records_sha256(
        [
            {
                "table": edge["table"],
                "columns": list(edge["columns"]),
                "ref_table": edge["ref_table"],
                "ref_columns": list(edge["ref_columns"]),
                "fk_activation": edge["fk_activation"],
                "match_type": edge["match_type"],
            }
            for edge in fks
        ],
        sort_keys=(
            "table",
            "columns",
            "ref_table",
            "ref_columns",
            "fk_activation",
            "match_type",
        ),
    )
    if actual_fk_hash != EXPECTED_FOREIGN_KEY_CONTRACT_SHA256:
        _fail(
            "frozen_foreign_key_contract_drift",
            "Phase 1 active FK edge set differs from the frozen P0c contract",
            actual_sha256=actual_fk_hash,
            expected_sha256=EXPECTED_FOREIGN_KEY_CONTRACT_SHA256,
            actual_count=len(fks),
            expected_count=289,
        )

    expected = {
        "tables": 100,
        "columns": 1374,
        "primary_keys": 100,
        "unique_constraints": 102,
        "checks": 332,
        "exclusions": 19,
        "foreign_keys": 289,
        "foreign_key_indexes": 224,
        "table_comments": 100,
        "column_comments": 1374,
        "created_custom_roles": 0,
        "internal_owner_roles": 0,
        "roles": 0,
        "rls_enabled": 100,
        "rls_forced": 100,
        "policies": 0,
        "table_object_grants": 0,
        "schema_usage_grants": 4,
        "schema_create_grants": 0,
        "views": 0,
    }
    if counts != expected:
        _fail("wrong_phase1_counts", f"Phase 1 count mismatch: {counts!r}", actual=counts, expected=expected)
    if len({(item["table"], tuple(item["columns"])) for item in indexes}) != len(indexes):
        _fail("duplicate_fk_index", "Duplicate generated FK index contract")
    views = tuple(model.get("views", ()))
    plan = Phase1Plan(core, views, tuple(checks), tuple(fks), tuple(indexes), counts)
    _validate_generated_name_registry(plan)
    canonical_model_hash = _canonical_model_sha256(model)
    if canonical_model_hash != EXPECTED_CANONICAL_MODEL_SHA256:
        _fail(
            "frozen_model_content_drift",
            "Canonical target-model content differs from the frozen P0c model",
            actual_sha256=canonical_model_hash,
            expected_sha256=EXPECTED_CANONICAL_MODEL_SHA256,
        )
    return plan


def _q(identifier: str) -> str:
    _require_identifier(identifier, context="SQL rendering")
    return f'"{identifier}"'


def _qualified(table_name: str) -> str:
    return f"public.{_q(table_name)}"


def _stable_name(prefix: str, table: str, parts: list[str]) -> str:
    suffix = "__".join(parts)
    raw = f"{prefix}_{table}" + (f"__{suffix}" if suffix else "")
    if len(raw) <= 63:
        return raw
    digest = hashlib.sha256(raw.encode("ascii")).hexdigest()[:10]
    return f"{raw[:52]}_{digest}"


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _single_line(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split())


def _migration_start(stage: str, *, statement_timeout: str = "120s") -> list[str]:
    return [
        f"-- HOT CRUSH Core V1 R6 / {stage}",
        "-- Generated deterministically. Do not hand-edit.",
        "-- The psycopg2 apply runner owns the sole transaction, lock and SET LOCAL state.",
        "",
    ]


def _migration_finish() -> list[str]:
    return []


def _render_preflight(plan: Phase1Plan) -> str:
    target_names = ",\n        ".join(
        _sql_literal(name)
        for name in sorted(
            {*_phase1_relation_names(plan), *(view["name"] for view in plan.views)}
        )
    )
    runtime_roles = ",\n        ".join(
        _sql_literal(role) for role in SUPABASE_RUNTIME_ROLES
    )
    lines = _migration_start("000 preflight", statement_timeout="30s")
    lines.extend(
        [
            "DO $hotcrush_preflight$",
            "DECLARE",
            "  actual_version pg_catalog.int4;",
            "  unavailable_extensions pg_catalog.int4;",
            "  wrong_schema_extensions pg_catalog.int4;",
            "  executor_is_safe pg_catalog.bool;",
            "BEGIN",
            "  actual_version := pg_catalog.current_setting('server_version_num')::pg_catalog.int4;",
            "  IF actual_version <> 170006 THEN",
            "    RAISE EXCEPTION 'HOT CRUSH R6 requires PostgreSQL 17.6 (170006); found %', actual_version;",
            "  END IF;",
            "",
            "  IF CURRENT_USER <> 'postgres' THEN",
            "    RAISE EXCEPTION 'Phase 1 executor must be current_user postgres';",
            "  END IF;",
            "  SELECT role.rolbypassrls",
            "    INTO executor_is_safe",
            "    FROM pg_catalog.pg_roles AS role",
            "   WHERE role.rolname = CURRENT_USER;",
            "  IF executor_is_safe IS DISTINCT FROM true THEN",
            "    RAISE EXCEPTION 'Phase 1 executor requires BYPASSRLS';",
            "  END IF;",
            "",
            "  SELECT 3 - pg_catalog.count(*)::pg_catalog.int4",
            "    INTO unavailable_extensions",
            "    FROM pg_catalog.pg_available_extensions",
            "   WHERE name IN ('pgcrypto', 'citext', 'btree_gist');",
            "  IF unavailable_extensions <> 0 THEN",
            "    RAISE EXCEPTION 'Required extensions are unavailable: pgcrypto, citext, btree_gist';",
            "  END IF;",
            "",
            "  SELECT pg_catalog.count(*)::pg_catalog.int4",
            "    INTO wrong_schema_extensions",
            "    FROM pg_catalog.pg_extension AS extension",
            "    JOIN pg_catalog.pg_namespace AS namespace",
            "      ON namespace.oid = extension.extnamespace",
            "   WHERE extension.extname IN ('pgcrypto', 'citext', 'btree_gist')",
            "     AND namespace.nspname <> 'extensions';",
            "  IF wrong_schema_extensions <> 0 THEN",
            "    RAISE EXCEPTION 'Required extension already exists outside the extensions schema';",
            "  END IF;",
            "",
            "  IF (",
            "    SELECT pg_catalog.count(*)",
            "      FROM pg_catalog.pg_roles",
            "     WHERE rolname = ANY (ARRAY[",
            f"        {runtime_roles}",
            "     ]::pg_catalog.text[])",
            "  ) <> 3 THEN",
            "    RAISE EXCEPTION 'Supabase baseline roles anon/authenticated/service_role are required';",
            "  END IF;",
            "  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname LIKE 'hc\\_r6\\_%' ESCAPE '\\') THEN",
            "    RAISE EXCEPTION 'HOT CRUSH R6 custom roles must not exist before Phase 1';",
            "  END IF;",
            "",
            "  IF EXISTS (",
            "    SELECT 1",
            "      FROM pg_catalog.pg_class AS relation",
            "      JOIN pg_catalog.pg_namespace AS namespace",
            "        ON namespace.oid = relation.relnamespace",
            "     WHERE namespace.nspname = 'public'",
            "       AND relation.relname = ANY (ARRAY[",
            f"        {target_names}",
            "       ]::pg_catalog.text[])",
            "  ) THEN",
            "    RAISE EXCEPTION 'One or more Phase 1 target relations already exist in public';",
            "  END IF;",
            "  IF pg_catalog.to_regprocedure('public.app_normalize_alias_v1(text)') IS NOT NULL THEN",
            "    RAISE EXCEPTION 'Phase 1 helper public.app_normalize_alias_v1(text) already exists';",
            "  END IF;",
            "END",
            "$hotcrush_preflight$;",
        ]
    )
    lines.extend(_migration_finish())
    return "\n".join(lines) + "\n"


def _render_bootstrap() -> str:
    lines = _migration_start("001 extensions and immutable helpers; custom roles deliberately deferred")
    lines.extend(
        [
            "DO $hotcrush_extensions$",
            "BEGIN",
            "  PERFORM 1 FROM pg_catalog.pg_namespace WHERE nspname = 'extensions';",
            "  IF NOT FOUND THEN",
            "    EXECUTE 'CREATE SCHEMA extensions';",
            "  END IF;",
            "  PERFORM 1 FROM pg_catalog.pg_extension WHERE extname = 'pgcrypto';",
            "  IF NOT FOUND THEN",
            "    EXECUTE 'CREATE EXTENSION pgcrypto WITH SCHEMA extensions';",
            "  END IF;",
            "  PERFORM 1 FROM pg_catalog.pg_extension WHERE extname = 'citext';",
            "  IF NOT FOUND THEN",
            "    EXECUTE 'CREATE EXTENSION citext WITH SCHEMA extensions';",
            "  END IF;",
            "  PERFORM 1 FROM pg_catalog.pg_extension WHERE extname = 'btree_gist';",
            "  IF NOT FOUND THEN",
            "    EXECUTE 'CREATE EXTENSION btree_gist WITH SCHEMA extensions';",
            "  END IF;",
            "END",
            "$hotcrush_extensions$;",
            "",
        ]
    )
    denied_grantees = ", ".join(
        ["PUBLIC", *(_q(role) for role in DEFAULT_DENY_ROLES)]
    )
    lines.extend(
        [
            f"REVOKE CREATE ON SCHEMA public FROM {denied_grantees};",
            f"GRANT USAGE ON SCHEMA public TO {denied_grantees};",
            "",
            "CREATE FUNCTION public.app_normalize_alias_v1(pg_catalog.text)",
            "RETURNS pg_catalog.text",
            "LANGUAGE sql",
            "IMMUTABLE",
            "STRICT",
            "PARALLEL SAFE",
            "SET search_path = pg_catalog, public",
            "AS $hotcrush_function$",
            "  SELECT pg_catalog.lower(",
            "    pg_catalog.btrim(",
            "      pg_catalog.regexp_replace(",
            "        pg_catalog.replace($1, pg_catalog.chr(160), ' '),",
            "        '[[:space:]]+',",
            "        ' ',",
            "        'g'",
            "      )",
            "    )",
            "  )",
            "$hotcrush_function$;",
            f"REVOKE EXECUTE ON FUNCTION public.app_normalize_alias_v1(pg_catalog.text) FROM {denied_grantees};",
            "COMMENT ON FUNCTION public.app_normalize_alias_v1(pg_catalog.text) IS 'Immutable v1 alias normalization: replaces NBSP, collapses whitespace, trims and lowercases; not a display-name formatter.';",
        ]
    )
    lines.extend(_migration_finish())
    return "\n".join(lines) + "\n"


def _table_checks(plan: Phase1Plan, table_name: str) -> list[dict[str, Any]]:
    return [check for check in plan.checks if check["table"] == table_name]


def _render_exclusion(table_name: str, symbolic: str) -> str:
    spec = EXCLUSION_SPECS[(table_name, symbolic)]
    elements = ",\n      ".join(spec.elements)
    rendered = (
        f"CONSTRAINT {_q(spec.name)} EXCLUDE USING gist (\n"
        f"      {elements}\n"
        "    )"
    )
    if spec.predicate is not None:
        rendered += f" WHERE ({spec.predicate})"
    rendered += " DEFERRABLE INITIALLY IMMEDIATE"
    return rendered


def _pk_name(table: dict[str, Any]) -> str:
    columns = [field["name"] for field in table["fields"] if field["pk"]]
    return _stable_name("pk", table["name"], columns)


def _unique_name(table: dict[str, Any], group: list[str] | tuple[str, ...]) -> str:
    return _stable_name("uq", table["name"], list(group))


def _check_name(check: dict[str, Any]) -> str:
    scope_part = check["scope"].removeprefix("field:")
    return _stable_name(
        "ck",
        check["table"],
        [scope_part, f"{check['ordinal']:02d}"],
    )


def _render_table(plan: Phase1Plan, table: dict[str, Any]) -> list[str]:
    definitions: list[str] = []
    for field in table["fields"]:
        definition = f"{_q(field['name'])} {TYPE_SQL[field['data_type']]}"
        if field["default"] is not None:
            definition += f" DEFAULT {DEFAULT_SQL[field['default']]}"
        if field["nullable"] is False:
            definition += " NOT NULL"
        definitions.append(definition)

    pk_columns = [field["name"] for field in table["fields"] if field["pk"]]
    pk_name = _pk_name(table)
    definitions.append(
        f"CONSTRAINT {_q(pk_name)} PRIMARY KEY ({', '.join(_q(value) for value in pk_columns)})"
    )

    nnd = {tuple(group) for group in table["nulls_not_distinct_uniques"]}
    nd = {tuple(group) for group in table["nulls_distinct_uniques"]}
    for group_list in table["uniques"]:
        group = tuple(group_list)
        if group in nnd:
            qualifier = " NULLS NOT DISTINCT"
        elif group in nd:
            qualifier = " NULLS DISTINCT"
        else:
            qualifier = ""
        name = _unique_name(table, group)
        definitions.append(
            f"CONSTRAINT {_q(name)} UNIQUE{qualifier} ({', '.join(_q(value) for value in group)})"
        )

    for check in _table_checks(plan, table["name"]):
        name = _check_name(check)
        definitions.append(f"CONSTRAINT {_q(name)} CHECK ({check['compiled']})")
    for symbolic in table["exclusions"]:
        definitions.append(_render_exclusion(table["name"], symbolic))

    body = ",\n  ".join(definitions)
    return [
        f"CREATE TABLE {_qualified(table['name'])} (",
        f"  {body}",
        ");",
    ]


def _render_domain(plan: Phase1Plan, domain: str) -> str:
    lines = _migration_start(f"{domain} physical tables")
    tables = [table for table in plan.tables if table["domain"] == domain]
    for index, table in enumerate(tables):
        if index:
            lines.append("")
        lines.extend(_render_table(plan, table))
    lines.extend(_migration_finish())
    return "\n".join(lines) + "\n"


def _fk_name(contract: dict[str, Any]) -> str:
    return _stable_name(
        "fk", contract["table"], [*contract["columns"], contract["ref_table"]]
    )


def _index_name(contract: dict[str, Any]) -> str:
    return _stable_name("ix", contract["table"], [*contract["columns"], "fk"])


def _phase1_relation_names(plan: Phase1Plan) -> list[str]:
    names = [table["name"] for table in plan.tables]
    for table in plan.tables:
        names.append(_pk_name(table))
        names.extend(_unique_name(table, group) for group in table["uniques"])
        names.extend(
            EXCLUSION_SPECS[(table["name"], symbolic)].name
            for symbolic in table["exclusions"]
        )
    names.extend(_index_name(contract) for contract in plan.foreign_key_indexes)
    return names


def _validate_generated_name_registry(plan: Phase1Plan) -> None:
    relation_names = [
        *_phase1_relation_names(plan),
        *(view["name"] for view in plan.views),
    ]
    duplicates = sorted(
        name for name in set(relation_names) if relation_names.count(name) > 1
    )
    if duplicates:
        _fail(
            "generated_name_collision",
            "Generated public relation/index namespace contains collisions",
            names=duplicates,
        )
    for table in plan.tables:
        constraint_names = [_pk_name(table)]
        constraint_names.extend(_unique_name(table, group) for group in table["uniques"])
        constraint_names.extend(
            _check_name(check) for check in _table_checks(plan, table["name"])
        )
        constraint_names.extend(
            EXCLUSION_SPECS[(table["name"], symbolic)].name
            for symbolic in table["exclusions"]
        )
        constraint_names.extend(
            _fk_name(edge) for edge in plan.foreign_keys if edge["table"] == table["name"]
        )
        duplicates = sorted(
            name for name in set(constraint_names) if constraint_names.count(name) > 1
        )
        if duplicates:
            _fail(
                "generated_name_collision",
                f"Generated constraint names collide on {table['name']}",
                names=duplicates,
            )


def _render_fk_indexes(plan: Phase1Plan) -> str:
    lines = _migration_start("030 supporting btree indexes for uncovered FK columns")
    for contract in plan.foreign_key_indexes:
        columns = ", ".join(_q(column) for column in contract["columns"])
        lines.append(
            f"CREATE INDEX {_q(_index_name(contract))} ON {_qualified(contract['table'])} USING btree ({columns});"
        )
    lines.extend(_migration_finish())
    return "\n".join(lines) + "\n"


def _render_foreign_keys(plan: Phase1Plan) -> str:
    lines = _migration_start("040 foreign keys added NOT VALID")
    lines.append("SET LOCAL row_security = off;")
    lines.append("")
    for contract in plan.foreign_keys:
        child_nonnull = " AND ".join(
            f"child.{_q(column)} IS NOT NULL" for column in contract["columns"]
        )
        join_predicate = " AND ".join(
            f"parent.{_q(ref_column)} = child.{_q(column)}"
            for column, ref_column in zip(
                contract["columns"], contract["ref_columns"], strict=True
            )
        )
        child_columns = ", ".join(_q(column) for column in contract["columns"])
        ref_columns = ", ".join(_q(column) for column in contract["ref_columns"])
        lines.extend(
            [
                "DO $hotcrush_orphan$",
                "BEGIN",
                "  IF EXISTS (",
                "    SELECT 1",
                f"      FROM {_qualified(contract['table'])} AS child",
                f"     WHERE {child_nonnull}",
                "       AND NOT EXISTS (",
                "         SELECT 1",
                f"           FROM {_qualified(contract['ref_table'])} AS parent",
                f"          WHERE {join_predicate}",
                "       )",
                "     LIMIT 1",
                "  ) THEN",
                f"    RAISE EXCEPTION 'orphan rows before FK {_fk_name(contract)}';",
                "  END IF;",
                "END",
                "$hotcrush_orphan$;",
                f"ALTER TABLE {_qualified(contract['table'])}",
                f"  ADD CONSTRAINT {_q(_fk_name(contract))}",
                f"  FOREIGN KEY ({child_columns})",
                f"  REFERENCES {_qualified(contract['ref_table'])} ({ref_columns}) MATCH {contract['match_type']}",
                "  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;",
            ]
        )
    lines.extend(_migration_finish())
    return "\n".join(lines) + "\n"


def _render_validate_foreign_keys(plan: Phase1Plan) -> str:
    lines = _migration_start("041 validate all Phase 1 foreign keys")
    for contract in plan.foreign_keys:
        lines.append(
            f"ALTER TABLE {_qualified(contract['table'])} VALIDATE CONSTRAINT {_q(_fk_name(contract))};"
        )
    lines.extend(_migration_finish())
    return "\n".join(lines) + "\n"


def _render_security(plan: Phase1Plan) -> str:
    lines = _migration_start("080 final default-deny RLS and object privileges")
    denied = ", ".join(["PUBLIC", *(_q(role) for role in DEFAULT_DENY_ROLES)])
    for table in plan.tables:
        lines.extend(
            [
                f"REVOKE ALL PRIVILEGES ON TABLE {_qualified(table['name'])} FROM {denied};",
                f"ALTER TABLE {_qualified(table['name'])} ENABLE ROW LEVEL SECURITY;",
                f"ALTER TABLE {_qualified(table['name'])} FORCE ROW LEVEL SECURITY;",
            ]
        )
    lines.extend(_migration_finish())
    return "\n".join(lines) + "\n"


def _table_comment(table: dict[str, Any]) -> str:
    readers = "、".join(_single_line(value) for value in table["readers"])
    parts = [
        f"{_single_line(table['zh_name'])}。",
        f"用途：{_single_line(table['purpose'])}；",
        f"一行粒度：{_single_line(table['grain'])}；",
        f"写入者：{_single_line(table['writer'])}；",
        f"读取者：{readers}；",
        f"来源：{_single_line(table['source'])}；",
        f"生命周期：{table['lifecycle']}；",
        f"变更策略：{table['mutation_policy']}；",
        f"保留：{_single_line(table['retention'])}。",
    ]
    if _single_line(table.get("notes")):
        parts.append(f"备注：{_single_line(table['notes'])}")
    return "".join(parts)


def _field_comment(table: dict[str, Any], field: dict[str, Any]) -> str:
    default = "无" if field["default"] is None else field["default"]
    relation = "无"
    if field["pk"]:
        relation = "主键"
    elif field["fk"]:
        relation = f"外键->{field['fk']}（{field['fk_activation']}）"
    elif field["unique"]:
        relation = "唯一键"
    parts = [
        f"{_single_line(field['zh_name'])}。",
        f"存放：{_single_line(field['description'])}；",
        f"作用：{_single_line(field['purpose'])}；",
        f"类型：{field['data_type']}；",
        f"允许空：{'是' if field['nullable'] else '否'}；",
        f"默认值：{default}；",
        f"键/连接：{relation}；",
        f"写入来源：{_single_line(table['writer'])} / {_single_line(table['source'])}；",
        f"敏感级别：{field['sensitive']}；",
        f"示例：{_single_line(field['example'])}。",
    ]
    if _single_line(field.get("notes")):
        parts.append(f"误用提示/备注：{_single_line(field['notes'])}")
    return "".join(parts)


def _render_comments(plan: Phase1Plan) -> str:
    lines = _migration_start("090 complete table and column comments")
    for table in plan.tables:
        lines.append(
            f"COMMENT ON TABLE {_qualified(table['name'])} IS {_sql_literal(_table_comment(table))};"
        )
        for field in table["fields"]:
            lines.append(
                f"COMMENT ON COLUMN {_qualified(table['name'])}.{_q(field['name'])} IS {_sql_literal(_field_comment(table, field))};"
            )
        pk_comment = f"Primary key for the declared one-row grain of {table['name']}."
        lines.append(
            f"COMMENT ON CONSTRAINT {_q(_pk_name(table))} ON {_qualified(table['name'])} IS {_sql_literal(pk_comment)};"
        )
        nnd = {tuple(group) for group in table["nulls_not_distinct_uniques"]}
        nd = {tuple(group) for group in table["nulls_distinct_uniques"]}
        for raw_group in table["uniques"]:
            group = tuple(raw_group)
            null_semantics = (
                "NULLS NOT DISTINCT"
                if group in nnd
                else "NULLS DISTINCT"
                if group in nd
                else "ordinary UNIQUE"
            )
            text = (
                f"Declared {null_semantics} business key on {table['name']}"
                f" ({', '.join(group)})."
            )
            lines.append(
                f"COMMENT ON CONSTRAINT {_q(_unique_name(table, group))} ON {_qualified(table['name'])} IS {_sql_literal(text)};"
            )
        for check in _table_checks(plan, table["name"]):
            text = (
                f"Fail-closed model CHECK {check['scope']}#{check['ordinal']}: "
                f"{check['expression']}"
            )
            lines.append(
                f"COMMENT ON CONSTRAINT {_q(_check_name(check))} ON {_qualified(table['name'])} IS {_sql_literal(text)};"
            )
        for symbolic in table["exclusions"]:
            spec = EXCLUSION_SPECS[(table["name"], symbolic)]
            lines.append(
                f"COMMENT ON CONSTRAINT {_q(spec.name)} ON {_qualified(table['name'])} IS {_sql_literal('Approved non-overlap contract: ' + symbolic)};"
            )
    for contract in plan.foreign_keys:
        text = (
            f"Phase 1 relationship {contract['table']}({', '.join(contract['columns'])}) -> "
            f"{contract['ref_table']}({', '.join(contract['ref_columns'])}); "
            f"MATCH {contract['match_type']}, NO ACTION and deferrable."
        )
        lines.append(
            f"COMMENT ON CONSTRAINT {_q(_fk_name(contract))} ON {_qualified(contract['table'])} IS {_sql_literal(text)};"
        )
    for contract in plan.foreign_key_indexes:
        text = (
            f"Btree support index for FK {contract['table']}({', '.join(contract['columns'])}); "
            "not duplicated when an existing PK/UNIQUE left prefix already covers the FK."
        )
        lines.append(
            f"COMMENT ON INDEX public.{_q(_index_name(contract))} IS {_sql_literal(text)};"
        )
    lines.extend(_migration_finish())
    return "\n".join(lines) + "\n"


def _array_sql(values: list[str] | tuple[str, ...], *, indent: str = "      ") -> str:
    return (",\n" + indent).join(_sql_literal(value) for value in values)


def _render_catalog_acceptance(plan: Phase1Plan) -> str:
    table_names = [table["name"] for table in plan.tables]
    view_names = sorted(view["name"] for view in plan.views)
    index_names = [_index_name(contract) for contract in plan.foreign_key_indexes]
    constraint_comment_count = (
        plan.counts["primary_keys"]
        + plan.counts["unique_constraints"]
        + plan.counts["checks"]
        + plan.counts["exclusions"]
        + plan.counts["foreign_keys"]
    )
    lines = _migration_start("099 catalog acceptance; no business data access", statement_timeout="60s")
    lines.extend(
        [
            "DO $hotcrush_acceptance$",
            "DECLARE",
            "  actual pg_catalog.int8;",
            "BEGIN",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_class AS relation",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND relation.relkind = 'r'",
            "     AND relation.relname = ANY (ARRAY[",
            f"      {_array_sql(table_names)}",
            "     ]::pg_catalog.text[]);",
            f"  IF actual <> {plan.counts['tables']} THEN RAISE EXCEPTION 'table count: expected {plan.counts['tables']}, got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_class AS relation",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND relation.relkind = 'r'",
            "     AND pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'",
            "     AND relation.relname = ANY (ARRAY[",
            f"      {_array_sql(table_names)}",
            "     ]::pg_catalog.text[]);",
            f"  IF actual <> {plan.counts['tables']} THEN RAISE EXCEPTION 'table owners: expected {plan.counts['tables']} postgres-owned, got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_attribute AS attribute",
            "    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND relation.relname = ANY (ARRAY[",
            f"      {_array_sql(table_names)}",
            "     ]::pg_catalog.text[])",
            "     AND attribute.attnum > 0 AND NOT attribute.attisdropped;",
            f"  IF actual <> {plan.counts['columns']} THEN RAISE EXCEPTION 'column count: expected {plan.counts['columns']}, got %', actual; END IF;",
            "",
        ]
    )
    constraint_expectations = (
        ("p", "primary key", plan.counts["primary_keys"]),
        ("u", "unique", plan.counts["unique_constraints"]),
        ("c", "check", plan.counts["checks"]),
        ("x", "exclusion", plan.counts["exclusions"]),
        ("f", "foreign key", plan.counts["foreign_keys"]),
    )
    for constraint_type, label, expected in constraint_expectations:
        lines.extend(
            [
                "  SELECT pg_catalog.count(*) INTO actual",
                "    FROM pg_catalog.pg_constraint AS constraint_record",
                "    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid",
                "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
                "   WHERE namespace.nspname = 'public'",
                f"     AND constraint_record.contype = '{constraint_type}'",
                "     AND relation.relname = ANY (ARRAY[",
                f"      {_array_sql(table_names)}",
                "     ]::pg_catalog.text[]);",
                f"  IF actual <> {expected} THEN RAISE EXCEPTION '{label} constraint count: expected {expected}, got %', actual; END IF;",
                "",
            ]
        )
    lines.extend(
        [
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_constraint AS constraint_record",
            "    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND constraint_record.contype = 'f'",
            "     AND constraint_record.convalidated",
            "     AND relation.relname = ANY (ARRAY[",
            f"      {_array_sql(table_names)}",
            "     ]::pg_catalog.text[]);",
            f"  IF actual <> {plan.counts['foreign_keys']} THEN RAISE EXCEPTION 'validated foreign keys: expected {plan.counts['foreign_keys']}, got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_index AS index_record",
            "    JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_record.indexrelid",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND index_record.indisvalid",
            "     AND index_relation.relname = ANY (ARRAY[",
            f"      {_array_sql(index_names)}",
            "     ]::pg_catalog.text[]);",
            f"  IF actual <> {plan.counts['foreign_key_indexes']} THEN RAISE EXCEPTION 'supporting FK indexes: expected {plan.counts['foreign_key_indexes']}, got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_class AS index_relation",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND pg_catalog.pg_get_userbyid(index_relation.relowner) = 'postgres'",
            "     AND index_relation.relname = ANY (ARRAY[",
            f"      {_array_sql(index_names)}",
            "     ]::pg_catalog.text[]);",
            f"  IF actual <> {plan.counts['foreign_key_indexes']} THEN RAISE EXCEPTION 'FK index owners: expected {plan.counts['foreign_key_indexes']} postgres-owned, got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_class AS relation",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND relation.relrowsecurity AND relation.relforcerowsecurity",
            "     AND relation.relname = ANY (ARRAY[",
            f"      {_array_sql(table_names)}",
            "     ]::pg_catalog.text[]);",
            f"  IF actual <> {plan.counts['tables']} THEN RAISE EXCEPTION 'ENABLE+FORCE RLS tables: expected {plan.counts['tables']}, got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_policy AS policy",
            "    JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND relation.relname = ANY (ARRAY[",
            f"      {_array_sql(table_names)}",
            "     ]::pg_catalog.text[]);",
            "  IF actual <> 0 THEN RAISE EXCEPTION 'Phase 1 must start with zero RLS policies; got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_class AS relation",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND relation.relname = ANY (ARRAY[",
            f"      {_array_sql(table_names)}",
            "     ]::pg_catalog.text[])",
            "     AND pg_catalog.obj_description(relation.oid, 'pg_class') IS NOT NULL;",
            f"  IF actual <> {plan.counts['table_comments']} THEN RAISE EXCEPTION 'table comments: expected {plan.counts['table_comments']}, got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_attribute AS attribute",
            "    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND relation.relname = ANY (ARRAY[",
            f"      {_array_sql(table_names)}",
            "     ]::pg_catalog.text[])",
            "     AND attribute.attnum > 0 AND NOT attribute.attisdropped",
            "     AND pg_catalog.col_description(relation.oid, attribute.attnum) IS NOT NULL;",
            f"  IF actual <> {plan.counts['column_comments']} THEN RAISE EXCEPTION 'column comments: expected {plan.counts['column_comments']}, got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_constraint AS constraint_record",
            "    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND relation.relname = ANY (ARRAY[",
            f"      {_array_sql(table_names)}",
            "     ]::pg_catalog.text[])",
            "     AND pg_catalog.obj_description(constraint_record.oid, 'pg_constraint') IS NOT NULL;",
            f"  IF actual <> {constraint_comment_count} THEN RAISE EXCEPTION 'constraint comments: expected {constraint_comment_count}, got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_class AS index_relation",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace",
            "   WHERE namespace.nspname = 'public'",
            "     AND index_relation.relname = ANY (ARRAY[",
            f"      {_array_sql(index_names)}",
            "     ]::pg_catalog.text[])",
            "     AND pg_catalog.obj_description(index_relation.oid, 'pg_class') IS NOT NULL;",
            f"  IF actual <> {plan.counts['foreign_key_indexes']} THEN RAISE EXCEPTION 'FK index comments: expected {plan.counts['foreign_key_indexes']}, got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_roles",
            "   WHERE rolname LIKE 'hc\\_r6\\_%' ESCAPE '\\';",
            "  IF actual <> 0 THEN RAISE EXCEPTION 'Phase 1 must not create HOT CRUSH custom roles; got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM information_schema.table_privileges",
            "   WHERE grantee = ANY (ARRAY[",
            f"      {_array_sql(['PUBLIC', *SUPABASE_RUNTIME_ROLES])}",
            "     ]::pg_catalog.text[])",
            "     AND table_schema = 'public'",
            "     AND table_name = ANY (ARRAY[",
            f"      {_array_sql(table_names)}",
            "     ]::pg_catalog.text[]);",
            "  IF actual <> 0 THEN RAISE EXCEPTION 'Phase 1 runtime roles/PUBLIC must have zero table grants; got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_class AS relation",
            "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
            "    CROSS JOIN pg_catalog.unnest(ARRAY[",
            f"      {_array_sql(list(SUPABASE_RUNTIME_ROLES))}",
            "    ]::pg_catalog.text[]) AS runtime_role(name)",
            "    CROSS JOIN pg_catalog.unnest(",
            "      ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']::pg_catalog.text[]",
            "    ) AS privilege(name)",
            "   WHERE namespace.nspname = 'public'",
            "     AND relation.relname = ANY (ARRAY[",
            f"      {_array_sql(table_names)}",
            "     ]::pg_catalog.text[])",
            "     AND pg_catalog.has_table_privilege(runtime_role.name, relation.oid, privilege.name);",
            "  IF actual <> 0 THEN RAISE EXCEPTION 'runtime roles must have zero effective table privileges; got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.unnest(ARRAY[",
            f"      {_array_sql(list(SUPABASE_RUNTIME_ROLES))}",
            "    ]::pg_catalog.text[]) AS runtime_role(name)",
            "   WHERE pg_catalog.has_schema_privilege(runtime_role.name, 'public', 'USAGE')",
            "     AND NOT pg_catalog.has_schema_privilege(runtime_role.name, 'public', 'CREATE');",
            f"  IF actual <> {len(SUPABASE_RUNTIME_ROLES)} THEN RAISE EXCEPTION 'runtime schema USAGE without CREATE: expected {len(SUPABASE_RUNTIME_ROLES)}, got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_namespace AS namespace",
            "    CROSS JOIN LATERAL pg_catalog.aclexplode(",
            "      COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))",
            "    ) AS acl",
            "   WHERE namespace.nspname = 'public' AND acl.grantee = 0",
            "     AND acl.privilege_type = 'USAGE' AND NOT acl.is_grantable;",
            "  IF actual <> 1 THEN RAISE EXCEPTION 'PUBLIC schema USAGE without CREATE: expected one USAGE ACL, got %', actual; END IF;",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_namespace AS namespace",
            "    CROSS JOIN LATERAL pg_catalog.aclexplode(",
            "      COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))",
            "    ) AS acl",
            "   WHERE namespace.nspname = 'public' AND acl.grantee = 0",
            "     AND acl.privilege_type = 'CREATE';",
            "  IF actual <> 0 THEN RAISE EXCEPTION 'PUBLIC schema CREATE must remain revoked; got %', actual; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_proc",
            "   WHERE oid = pg_catalog.to_regprocedure('public.app_normalize_alias_v1(text)')",
            "     AND pg_catalog.pg_get_userbyid(proowner) = 'postgres'",
            "     AND provolatile = 'i' AND proisstrict AND proparallel = 's' AND NOT prosecdef",
            "     AND 'search_path=pg_catalog, public' = ANY (proconfig);",
            "  IF actual <> 1 THEN RAISE EXCEPTION 'helper owner/behavior contract is missing or unsafe'; END IF;",
            "",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.pg_proc AS procedure",
            "    CROSS JOIN LATERAL pg_catalog.aclexplode(",
            "      COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))",
            "    ) AS acl",
            "   WHERE procedure.oid = pg_catalog.to_regprocedure('public.app_normalize_alias_v1(text)')",
            "     AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE';",
            "  IF actual <> 0 THEN RAISE EXCEPTION 'helper execute privilege must remain revoked from PUBLIC; got %', actual; END IF;",
            "  SELECT pg_catalog.count(*) INTO actual",
            "    FROM pg_catalog.unnest(ARRAY[",
            f"      {_array_sql(list(SUPABASE_RUNTIME_ROLES))}",
            "    ]::pg_catalog.text[]) AS runtime_role(name)",
            "   WHERE pg_catalog.has_function_privilege(",
            "     runtime_role.name, 'public.app_normalize_alias_v1(text)', 'EXECUTE'",
            "   );",
            "  IF actual <> 0 THEN RAISE EXCEPTION 'helper execute privilege must remain revoked from runtime roles; got %', actual; END IF;",
            "",
        ]
    )
    if view_names:
        lines.extend(
            [
                "  SELECT pg_catalog.count(*) INTO actual",
                "    FROM pg_catalog.pg_class AS relation",
                "    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace",
                "   WHERE namespace.nspname = 'public'",
                "     AND relation.relkind IN ('v', 'm')",
                "     AND relation.relname = ANY (ARRAY[",
                f"      {_array_sql(view_names)}",
                "     ]::pg_catalog.text[]);",
                "  IF actual <> 0 THEN RAISE EXCEPTION 'No R6 views are authorized in this physical-only slice; got %', actual; END IF;",
            ]
        )
    lines.extend(["END", "$hotcrush_acceptance$;"])
    lines.extend(_migration_finish())
    return "\n".join(lines) + "\n"


def _manifest(plan: Phase1Plan, model_sha256: str, sql_files: dict[str, str]) -> str:
    phase1_bytes = sql_files["phase1.sql"].encode("utf-8")
    stages: list[dict[str, Any]] = []
    offset = 0
    for name in STAGE_SQL_FILES:
        body = sql_files[name].encode("utf-8")
        stages.append(
            {
                "name": name,
                "offset": offset,
                "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
            }
        )
        offset += len(body)
    if offset != len(phase1_bytes):
        raise AssertionError("stage bytes do not cover phase1.sql")
    payload = {
        "manifest_version": 2,
        "compiler_version": COMPILER_VERSION,
        "model_version": "HOTCRUSH-CORE-V1-REVIEW-R6-2026-08-10",
        "inputs": {
            "raw_model_sha256": EXPECTED_RAW_MODEL_SHA256,
            "canonical_model_sha256": model_sha256,
            "review_package_sha256": EXPECTED_REVIEW_PACKAGE_SHA256,
            "compiler_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        },
        "migration": {
            "repository_code": "hotcrush_core_r6",
            "migration_version": "R6_PHASE1_BASELINE",
            "filename": "phase1.sql",
            "predecessors": [],
        },
        "scope": "PHASE1_CORE_MIGRATION_PHYSICAL_ONLY",
        "no_views_generated": True,
        "validation_runtime": {
            "postgres_image": PG17_DOCKER_IMAGE,
            "repo_digest": PG17_DOCKER_REPO_DIGEST,
        },
        "payload": {
            "filename": "phase1.sql",
            "bytes": len(phase1_bytes),
            "sha256": hashlib.sha256(phase1_bytes).hexdigest(),
        },
        "stages": stages,
        "counts": plan.counts,
        "contract_hashes": {
            "checks_sha256": check_contract_sha256(plan),
            "unique_constraints_sha256": unique_contract_sha256(plan),
            "active_foreign_keys_sha256": foreign_key_contract_sha256(plan),
        },
        "extensions": ["pgcrypto", "citext", "btree_gist"],
        "tables": [
            {
                "name": table["name"],
                "domain": table["domain"],
                "columns": [field["name"] for field in table["fields"]],
            }
            for table in plan.tables
        ],
        "checks": [
            {
                "table": check["table"],
                "scope": check["scope"],
                "ordinal": check["ordinal"],
                "expression": check["expression"],
                "expression_sha256": hashlib.sha256(check["expression"].encode("utf-8")).hexdigest(),
            }
            for check in plan.checks
        ],
        "exclusions": [
            {
                "table": table_name,
                "symbolic": symbolic,
                "constraint_name": spec.name,
                "symbolic_sha256": hashlib.sha256(symbolic.encode("utf-8")).hexdigest(),
            }
            for (table_name, symbolic), spec in sorted(EXCLUSION_SPECS.items())
        ],
        "foreign_keys": [
            {**contract, "constraint_name": _fk_name(contract)}
            for contract in plan.foreign_keys
        ],
        "foreign_key_indexes": [
            {**contract, "index_name": _index_name(contract)}
            for contract in plan.foreign_key_indexes
        ],
        "future_security_registry": {
            "status": "DEFERRED_NOT_EXECUTED",
            "requires_platform_superuser_bootstrap": True,
            "role_names": list(FUTURE_BUSINESS_ROLE_NAMES),
        },
        "owner_mode": OWNER_MODE,
        "expected_owner": EXECUTOR_OWNER,
        "forbidden_owner_role": FORBIDDEN_OWNER_ROLE,
        "forbidden_role_pattern": "^hc_r6_",
        "roles": list(CREATED_ROLE_NAMES),
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def render_phase1_files(plan: Phase1Plan, *, model_sha256: str) -> dict[str, str]:
    if not re.fullmatch(r"[0-9a-f]{64}", model_sha256):
        _fail("invalid_model_hash", f"Invalid model SHA-256: {model_sha256!r}")
    stage_files = {
        "000_preflight.sql": _render_preflight(plan),
        "001_bootstrap.sql": _render_bootstrap(),
        **{
            filename: _render_domain(plan, domain)
            for domain, filename in DOMAIN_FILES.items()
        },
        "030_fk_indexes.sql": _render_fk_indexes(plan),
        "040_foreign_keys_not_valid.sql": _render_foreign_keys(plan),
        "041_validate_foreign_keys.sql": _render_validate_foreign_keys(plan),
        "080_security.sql": _render_security(plan),
        "090_comments.sql": _render_comments(plan),
        "099_catalog_acceptance.sql": _render_catalog_acceptance(plan),
    }
    if list(stage_files) != STAGE_SQL_FILES:
        raise AssertionError("internal stage file order drift")
    phase1 = "".join(stage_files[name] for name in STAGE_SQL_FILES)
    sql_files = {**stage_files, "phase1.sql": phase1}
    if sorted(sql_files) != sorted(EXPECTED_SQL_FILES):
        raise AssertionError("internal output file list drift")
    files = dict(sql_files)
    files["phase1-ddl-manifest.json"] = _manifest(plan, model_sha256, sql_files)
    return files


def generate_from_model(model: dict[str, Any], output: Path) -> None:
    canonical = json.dumps(
        model, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    plan = build_phase1_plan(model)
    files = render_phase1_files(plan, model_sha256=hashlib.sha256(canonical).hexdigest())
    expected_bytes = {name: body.encode("utf-8") for name, body in files.items()}
    if output.exists():
        if not output.is_dir() or output.is_symlink():
            raise GeneratedArtifactDrift("Generated output is not a real directory")
        if any(output.iterdir()):
            _verify_generated_bytes(expected_bytes, output)
            return
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(
        tempfile.mkdtemp(prefix=f".{output.name}.tmp-", dir=output.parent)
    )
    try:
        for name, body in expected_bytes.items():
            (temporary / name).write_bytes(body)
        _verify_generated_bytes(expected_bytes, temporary)
        if output.exists():
            output.rmdir()
        os.replace(temporary, output)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def _verify_generated_bytes(expected: dict[str, bytes], output: Path) -> None:
    if not output.is_dir() or output.is_symlink():
        raise GeneratedArtifactDrift("Generated output is not a real directory")
    entries = list(output.iterdir())
    actual_names = {path.name for path in entries}
    if actual_names != set(expected):
        raise GeneratedArtifactDrift(
            f"Generated file set drift: expected {sorted(expected)}, got {sorted(actual_names)}"
        )
    for path in entries:
        if path.is_symlink() or not path.is_file():
            raise GeneratedArtifactDrift(f"Generated artifact is not a regular file: {path.name}")
        if path.read_bytes() != expected[path.name]:
            raise GeneratedArtifactDrift(f"Generated artifact drift: {path.name}")


def verify_generated_from_model(model: dict[str, Any], output: Path) -> None:
    canonical = json.dumps(
        model, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    plan = build_phase1_plan(model)
    expected = render_phase1_files(plan, model_sha256=hashlib.sha256(canonical).hexdigest())
    _verify_generated_bytes(
        {name: body.encode("utf-8") for name, body in expected.items()},
        output,
    )


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail("duplicate_json_key", f"Duplicate JSON object key: {key}")
        result[key] = value
    return result


def load_model(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    actual_raw_sha256 = hashlib.sha256(raw).hexdigest()
    if actual_raw_sha256 != EXPECTED_RAW_MODEL_SHA256:
        _fail(
            "frozen_raw_model_drift",
            "Target model raw bytes differ from the frozen P0c input",
            actual_sha256=actual_raw_sha256,
            expected_sha256=EXPECTED_RAW_MODEL_SHA256,
        )
    try:
        model = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_json_keys,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        if isinstance(exc, UnicodeDecodeError):
            _fail("invalid_model_json", f"Target model is not UTF-8: {path}")
        _fail(
            "invalid_model_json",
            f"Invalid target model JSON at {path}:{exc.lineno}:{exc.colno}: {exc.msg}",
        )
    if not isinstance(model, dict):
        _fail("invalid_model", f"Target model root must be an object: {path}")
    return model


def _argument_parser() -> argparse.ArgumentParser:
    implementation_dir = Path(__file__).resolve().parent
    default_model = implementation_dir.parent / "target-model.json"
    default_output = implementation_dir / "generated"
    parser = argparse.ArgumentParser(
        description="Compile and verify HOT CRUSH R6 Phase 1 physical DDL."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("generate", "check"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--model", type=Path, default=default_model)
        subparser.add_argument("--output", type=Path, default=default_output)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _argument_parser().parse_args(argv)
    model = load_model(args.model)
    if args.command == "generate":
        generate_from_model(model, args.output)
        action = "generated"
    else:
        verify_generated_from_model(model, args.output)
        action = "verified"
    print(
        f"{action} {len(EXPECTED_OUTPUT_FILES)} immutable artifacts "
        f"from {args.model} in {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
