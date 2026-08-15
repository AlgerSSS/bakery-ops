#!/usr/bin/env python3
"""Deterministic R6A1 amendment planner and DDL compiler.

The compiler consumes only the byte-pinned R6 Phase 1 predecessor and the
sealed R6A1 resolved-model package.  It never connects to PostgreSQL.  The
physical catalog seal is deliberately absent until two independent local
PostgreSQL 17.6 candidates produce identical captures.
"""

from __future__ import annotations

import argparse
import ctypes
import dataclasses
import errno
import hashlib
import json
import os
import re
import secrets
import stat
import sys
from pathlib import Path
from types import MappingProxyType
from typing import Any, Iterable, Mapping, Sequence


IMPLEMENTATION_DIR = Path(__file__).resolve().parent
REVISION_DIR = IMPLEMENTATION_DIR.parent
CORE_ROOT = REVISION_DIR.parent.parent
BASELINE_IMPLEMENTATION_DIR = CORE_ROOT / "implementation"
BASELINE_MODEL_PATH = CORE_ROOT / "target-model.json"
BASELINE_PAYLOAD_PATH = BASELINE_IMPLEMENTATION_DIR / "generated" / "phase1.sql"
BASELINE_MANIFEST_PATH = (
    BASELINE_IMPLEMENTATION_DIR / "generated" / "phase1-ddl-manifest.json"
)
BASELINE_CATALOG_PATH = BASELINE_IMPLEMENTATION_DIR / "phase1-catalog-contract.json"
REVISION_GENERATED_DIR = REVISION_DIR / "generated"
REVISION_MANIFEST_PATH = REVISION_GENERATED_DIR / "manifest.json"
RESOLVED_MODEL_PATH = REVISION_GENERATED_DIR / "resolved-target-model.json"
DESIGN_CATALOG_PATH = (
    REVISION_GENERATED_DIR / "resolved-phase1-catalog-contract.json"
)
OVERLAY_PATH = REVISION_DIR / "model-overlay.json"
TRIGGER_CONTRACT_PATH = IMPLEMENTATION_DIR / "trigger-contract.json"
TRIGGER_CONTRACT_SIDECAR_PATH = IMPLEMENTATION_DIR / "trigger-contract.json.sha256"
APPLY_SOURCE_PATH = IMPLEMENTATION_DIR / "amendment_apply.py"
CATALOG_SOURCE_PATH = IMPLEMENTATION_DIR / "amendment_catalog.py"
BOOTSTRAP_SOURCE_PATH = IMPLEMENTATION_DIR / "amendment_bootstrap.py"
BOUND_COMPILER_SOURCE_BYTES = globals().get(
    "_BOOTSTRAP_BOUND_COMPILER_SOURCE_BYTES"
)

COMPILER_VERSION = "R6A1_AMENDMENT_COMPILER_V1"
PG17_DOCKER_IMAGE = "postgres:17.6-alpine"
PG17_DOCKER_REPO_DIGEST = (
    "sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94"
)
MIGRATION_VERSION = "R6A1_FX_SIGNED_POS_AMENDMENT"
MIGRATION_FILENAME = "r6a1-amendment.sql"
REPOSITORY_CODE = "hotcrush_core_r6"
SESSION_LOCK_KEY = "hotcrush-core-v1-r6-phase1"

EXPECTED_HASHES = {
    "baseline_raw_model_sha256": (
        "7bd5a71b010ad89427d918b842a18c4c34e23085cef0543cad14703d097c187b"
    ),
    "baseline_canonical_model_sha256": (
        "52b1e84ae5cfa16871a058adaca3d1482d91460f7aad6f99186cab5b7e4ed986"
    ),
    "baseline_manifest_sha256": (
        "f03ebd6d66462d8720f85a59642769d4655cd6597343401dcf5f4dc62dd0dc66"
    ),
    "baseline_phase1_payload_sha256": (
        "0cdb26dbf255022997c3e167a28f12709b4c73c4ad75d364ed312ff37843176d"
    ),
    "baseline_catalog_sha256": (
        "a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea"
    ),
    "revision_manifest_sha256": (
        "6247fa07473fc28fc286f6263d2aea4376b3abcf52cc6536ad20026aa4d08f86"
    ),
    "revision_package_aggregate_sha256": (
        "44d05f25a515b8e9be73ed85eb6b4252d7419e2e74b01fb8f8ff51df46ad0a51"
    ),
    "resolved_model_sha256": (
        "72c68f5961cbf2c6456cf61d39d3b3e8188f458de90c88ef7c1afaac4be80a7f"
    ),
    "design_catalog_sha256": (
        "626baf196e9b4877131637313209953a1b337194ad04caccdc0ba3a30bc56fc8"
    ),
    "overlay_sha256": (
        "3e7f954a3d42579c6dd7e6eaf32172af9d74198fb98dd59f713b557dfd64aa84"
    ),
}

BASELINE_COMPILER_SHA256 = (
    "2ffa1e7d938c56d7acad8c158d7182601c650d3e754f19475ba3fdcd6fa67490"
)
BASELINE_REVIEW_PACKAGE_SHA256 = (
    "6b863293c5aa3358c45c52468f614583f309ccb8a3ea717f3ad90ad76dfceaa0"
)
BASELINE_PAYLOAD_BYTES = 1_485_438

EXPECTED_TARGET_COUNTS = {
    "tables": 105,
    "columns": 1470,
    "primary_keys": 105,
    "unique_constraints": 113,
    "checks": 404,
    "exclusions": 21,
    "foreign_keys": 332,
    "foreign_key_indexes": 266,
    "catalog_total_indexes": 505,
    "table_comments": 105,
    "column_comments": 1470,
    "constraint_comments": 975,
    "index_comments": 266,
    "sql_views": 0,
}
EXPECTED_UNIQUE_SUBTYPES = {
    "ordinary": 87,
    "nulls_distinct": 16,
    "nulls_not_distinct": 10,
}
EXPECTED_AFFECTED_TABLES = 32
SEMANTIC_REBUILDS = (
    "cost_card_material_cost_selection",
    "pos_order_item",
    "scm_material_price_observation",
)
SURGICAL_ALTERS = ("app_audit_event", "cost_card_recipe_version", "ops_location")
APPROVED_COLUMN_RENAMES = {
    "scm_supplier": {"default_currency": "default_quote_currency_code"},
}

STAGE_DAG = {
    "000_lock_baseline.sql": (),
    "010_new_and_semantic_rebuild.sql": ("000_lock_baseline.sql",),
    "020_surgical_alters.sql": ("010_new_and_semantic_rebuild.sql",),
    "030_constraints.sql": ("020_surgical_alters.sql",),
    "040_fk_indexes.sql": ("030_constraints.sql",),
    "050_foreign_keys_not_valid.sql": ("040_fk_indexes.sql",),
    "051_validate_foreign_keys.sql": ("050_foreign_keys_not_valid.sql",),
    "060_trigger_functions.sql": ("051_validate_foreign_keys.sql",),
    "061_constraint_triggers.sql": ("060_trigger_functions.sql",),
    "070_security.sql": ("061_constraint_triggers.sql",),
    "080_comments.sql": ("070_security.sql",),
    "090_catalog_acceptance.sql": ("080_comments.sql",),
    "099_physical_catalog_seal.sql": ("090_catalog_acceptance.sql",),
}
STAGE_SQL_FILES = tuple(STAGE_DAG)
BLOCKED_STAGE_REASONS = {
    "060_trigger_functions.sql": "EXECUTABLE_ROUTINE_BODIES_NOT_COMPILED",
    "061_constraint_triggers.sql": "EXECUTABLE_ROUTINE_BODIES_NOT_COMPILED",
    "090_catalog_acceptance.sql": "TARGET_PG_CATALOG_NOT_CAPTURED",
    "099_physical_catalog_seal.sql": "TARGET_PG_CATALOG_NOT_CAPTURED",
}
CANDIDATE_PAYLOAD_NAMES = (
    *STAGE_SQL_FILES,
    MIGRATION_FILENAME,
    "amendment-ddl-manifest.json",
    "trigger-contract.json",
)
PREVIEW_MANIFEST_NAME = "amendment-preview-manifest.json"
NONTRIGGER_PREVIEW_STAGE_NAMES = tuple(
    name for name in STAGE_DAG if name not in BLOCKED_STAGE_REASONS
)

TRIGGER_CONTRACT_STATUS = "APPROVED_CANDIDATE_AFTER_MODEL_RESEAL"
TRIGGER_CONTRACT: tuple[dict[str, Any], ...] = ()
TRIGGER_CONTRACT_RAW_SHA256 = (
    "8e402a9fc101ba31a9dd373573db77a492ff1329b204af5b0dcc18b03d6cfb2d"
)
TRIGGER_CONTRACT_BYTES = 91_074
TRIGGER_CONTRACT_COMPACT_SHA256 = (
    "c75ca10bf9391e9157b5ac3fa52bd47f1fab5c2edd6266f3359f4733b97c25fa"
)
TRIGGER_CONTRACT_SIDECAR_SHA256 = (
    "ec79b7b6e3713023d3eeb1f53f697bf268aa48a64e042a79206d9f9f679f19e1"
)
TRIGGER_CONTRACT_ROOT_KEYS = frozenset(
    {
        "artifact_kind",
        "schema_version",
        "revision_id",
        "decision_status",
        "model_binding_status",
        "catalog_status",
        "activation_status",
        "postgresql_contract",
        "resolved_model_sha256",
        "inventory",
        "model_delta",
        "routine_contracts",
        "trigger_contracts",
        "action_registry",
        "transaction_contract",
        "idempotency_contract",
        "audit_json_contract",
        "typed_hash_contract",
        "family_invariants",
        "dispatcher_contracts",
        "writer_contracts",
        "restore_contract",
        "conservation_contract",
        "catalog_acceptance",
        "behavior_acceptance",
        "release_blockers",
        "hash_contract",
    }
)
TRIGGER_CONTRACT_ACTION_CODES = (
    "R6A1_FX_RATE_OBSERVATION_WRITE",
    "R6A1_MATERIAL_PRICE_OBSERVATION_INSERT",
    "R6A1_MATERIAL_PRICE_OBSERVATION_VERIFY",
    "R6A1_MATERIAL_COST_SELECTION_WRITE",
    "R6A1_MATERIAL_PRICE_OBSERVATION_RESTORE",
)
TRIGGER_CONTRACT_DISPATCHER_TABLES = (
    "finance_accounting_entity",
    "finance_currency_assignment",
    "finance_currency_policy",
    "finance_fx_rate_observation",
    "scm_material_price_observation",
    "cost_card_material_cost_selection",
    "ops_location",
    "app_currency",
    "app_source_system",
    "app_job_run",
    "scm_supplier_item",
    "scm_material_unit_conversion",
    "scm_material",
    "app_unit",
    "app_audit_event",
)
TRIGGER_CONTRACT_EXACT15 = tuple(
    f"public.ct_r6a1_{table}_v1" for table in TRIGGER_CONTRACT_DISPATCHER_TABLES
)
TRIGGER_CONTRACT_ROUTINE_IDENTITIES = frozenset(
    {
        "public.r6a1_assert_accounting_entity_v1(pg_catalog.uuid)",
        "public.r6a1_assert_currency_assignment_v1(pg_catalog.uuid)",
        "public.r6a1_assert_currency_policy_v1(pg_catalog.uuid)",
        "public.r6a1_assert_fx_rate_observation_v1(pg_catalog.uuid)",
        "public.r6a1_assert_material_price_observation_v1(pg_catalog.uuid)",
        "public.r6a1_assert_material_cost_selection_v1(pg_catalog.uuid)",
        "public.r6a1_assert_all_invariants_v1()",
        *(f"public.r6a1_ct_{table}_v1()" for table in TRIGGER_CONTRACT_DISPATCHER_TABLES),
        "public.r6a1_block_governed_truncate_v1()",
        "public.r6a1_write_fx_rate_observation_v1(pg_catalog.text,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.int4,pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.numeric,pg_catalog.text,pg_catalog.text,pg_catalog.timestamptz,pg_catalog.timestamptz,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.uuid)",
        "public.r6a1_insert_material_price_observation_v1(pg_catalog.text,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.text,pg_catalog.timestamptz,pg_catalog.numeric,pg_catalog.numeric,pg_catalog.text,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.text,pg_catalog.text,pg_catalog.jsonb)",
        "public.r6a1_verify_material_price_observation_v1(pg_catalog.text,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.timestamptz,pg_catalog.uuid,pg_catalog.text,pg_catalog.jsonb)",
        "public.r6a1_write_material_cost_selection_v1(pg_catalog.text,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.timestamptz,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.timestamptz,pg_catalog.timestamptz,pg_catalog.text,pg_catalog.jsonb)",
    }
)
TRIGGER_CONTRACT_TRIGGER_NAMES = frozenset(
    {
        *(f"ct_r6a1_{table}_v1" for table in TRIGGER_CONTRACT_DISPATCHER_TABLES),
        *(
            f"bt_r6a1_block_truncate_{table}_v1"
            for table in (
                "finance_accounting_entity",
                "finance_currency_assignment",
                "finance_currency_policy",
                "finance_fx_rate_observation",
                "scm_material_price_observation",
                "cost_card_material_cost_selection",
                "app_audit_event",
            )
        ),
    }
)

SHA256_RE = re.compile(r"[0-9a-f]{64}")
IDENTIFIER_RE = re.compile(r"[a-z_][a-z0-9_]*")
MAX_INPUT_BYTES = 64 * 1024 * 1024

TYPE_SQL = {
    "bigint": "pg_catalog.int8",
    "boolean": "pg_catalog.bool",
    "bytea": "pg_catalog.bytea",
    "char(2)": "pg_catalog.bpchar(2)",
    "char(3)": "pg_catalog.bpchar(3)",
    "char(64)": "pg_catalog.bpchar(64)",
    "citext": "extensions.citext",
    "date": "pg_catalog.date",
    "inet": "pg_catalog.inet",
    "integer": "pg_catalog.int4",
    "jsonb": "pg_catalog.jsonb",
    "numeric(18,4)": "pg_catalog.numeric(18,4)",
    "numeric(18,6)": "pg_catalog.numeric(18,6)",
    "numeric(18,8)": "pg_catalog.numeric(18,8)",
    "numeric(24,12)": "pg_catalog.numeric(24,12)",
    "numeric(24,8)": "pg_catalog.numeric(24,8)",
    "numeric(38,18)": "pg_catalog.numeric(38,18)",
    "numeric(5,4)": "pg_catalog.numeric(5,4)",
    "numeric(9,4)": "pg_catalog.numeric(9,4)",
    "numeric(9,6)": "pg_catalog.numeric(9,6)",
    "smallint": "pg_catalog.int2",
    "text": "pg_catalog.text",
    "text[]": "pg_catalog.text[]",
    "time": "pg_catalog.time",
    "timestamptz": "pg_catalog.timestamptz",
    "uuid": "pg_catalog.uuid",
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
    "'ACTIVE'": "'ACTIVE'",
    "'BATCH_MULTIPLE'": "'BATCH_MULTIPLE'",
    "'COMPLETE'": "'COMPLETE'",
    "'DETECTED'": "'DETECTED'",
    "'DRAFT'": "'DRAFT'",
    "'INVITED'": "'INVITED'",
    "'OPEN'": "'OPEN'",
    "'PENDING'": "'PENDING'",
    "'PHONE'": "'PHONE'",
    "'QUEUED'": "'QUEUED'",
    "'SOURCE_ONLY'": "'SOURCE_ONLY'",
    "'UNKNOWN'": "'UNKNOWN'",
    "'campaign-rules-v1'": "'campaign-rules-v1'",
    "'daily-review-manager-v1'": "'daily-review-manager-v1'",
    "'daily-review-summary-v1'": "'daily-review-summary-v1'",
    "'hr-employee-event-v1'": "'hr-employee-event-v1'",
    "'hr-screening-rule-v1'": "'hr-screening-rule-v1'",
    "'offer-compensation-v1'": "'offer-compensation-v1'",
    "'survey-validation-v1'": "'survey-validation-v1'",
}
FORBIDDEN_CHECK_FRAGMENTS = (";", "--", "/*", "*/", "$$", "\\")
FORBIDDEN_CHECK_WORDS = {
    "SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "CREATE", "ALTER",
    "DROP", "TRUNCATE", "CALL", "DO", "GRANT", "REVOKE", "EXECUTE",
    "PG_SLEEP",
}
CHECK_KEYWORDS = {
    "IS", "NOT", "NULL", "AND", "OR", "IN", "BETWEEN", "FROM", "DAY",
    "TRUE", "FALSE", "EXTRACT",
}
CHECK_FUNCTIONS = {
    "btrim": "pg_catalog.btrim",
    "cardinality": "pg_catalog.cardinality",
    "array_position": "pg_catalog.array_position",
    "length": "pg_catalog.length",
    "num_nonnulls": "pg_catalog.num_nonnulls",
    "jsonb_typeof": "pg_catalog.jsonb_typeof",
}
NIL_UUID_SQL = "'00000000-0000-0000-0000-000000000000'::pg_catalog.uuid"
NEW_EXCLUSION_SPECS = {
    "cost_card_material_cost_selection": {
        "name": "ex_cost_card_material_cost_selection__verified_period",
        "elements": (
            '"material_id" WITH =',
            '"target_currency_assignment_id" WITH =',
            'pg_catalog.tstzrange("effective_from", "effective_to", \'[)\') WITH &&',
        ),
        "predicate": '"quality_status" = \'VERIFIED\'',
    },
    "finance_currency_assignment": {
        "name": "ex_finance_currency_assignment__approved_period",
        "elements": (
            '"scope_type" WITH =',
            f'COALESCE("location_id", {NIL_UUID_SQL}) WITH =',
            f'COALESCE("accounting_entity_id", {NIL_UUID_SQL}) WITH =',
            '"currency_role" WITH =',
            'pg_catalog.tstzrange("effective_from", "effective_to", \'[)\') WITH &&',
        ),
        "predicate": '"status" IN (\'APPROVED\', \'RETIRED\')',
    },
    "finance_currency_policy": {
        "name": "ex_finance_currency_policy__approved_period",
        "elements": (
            '"target_currency_assignment_id" WITH =',
            '"source_currency_code" WITH =',
            '"conversion_purpose" WITH =',
            'pg_catalog.tstzrange("effective_from", "effective_to", \'[)\') WITH &&',
        ),
        "predicate": '"status" IN (\'APPROVED\', \'RETIRED\')',
    },
}


class CompilerContractError(RuntimeError):
    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


@dataclasses.dataclass(frozen=True)
class TableDelta:
    object_name: str
    baseline_object_name: str | None
    operation: str
    baseline_table_sha256: str | None
    target_table_sha256: str
    added_fields: tuple[str, ...]
    removed_fields: tuple[str, ...]
    changed_fields: tuple[str, ...]


@dataclasses.dataclass(frozen=True)
class AmendmentPlan:
    baseline_tables: tuple[dict[str, Any], ...]
    target_tables: tuple[dict[str, Any], ...]
    affected_tables: tuple[dict[str, Any], ...]
    table_deltas: tuple[TableDelta, ...]
    new_tables: tuple[str, ...]
    semantic_rebuilds: tuple[str, ...]
    surgical_alters: tuple[str, ...]
    target_foreign_keys: tuple[dict[str, Any], ...]
    added_foreign_keys: tuple[dict[str, Any], ...]
    removed_foreign_keys: tuple[dict[str, Any], ...]
    target_support_indexes: tuple[dict[str, Any], ...]
    added_support_indexes: tuple[dict[str, Any], ...]
    removed_support_indexes: tuple[dict[str, Any], ...]
    target_counts: dict[str, int]
    unique_subtypes: dict[str, int]

    @property
    def foreign_key_net_delta(self) -> int:
        return len(self.added_foreign_keys) - len(self.removed_foreign_keys)

    @property
    def support_index_net_delta(self) -> int:
        return len(self.added_support_indexes) - len(self.removed_support_indexes)


@dataclasses.dataclass(frozen=True)
class InputByteSnapshot:
    files: Mapping[Path, bytes]

    def read(self, path: Path) -> bytes:
        normalized = _normalized_path(path)
        try:
            return self.files[normalized]
        except KeyError:
            _fail("input_not_snapshotted", f"Input was not captured: {normalized.name}")


def _fail(code: str, message: str, **details: Any) -> None:
    raise CompilerContractError(code, message, **details)


def _duplicate_key_guard(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail("duplicate_json_key", f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _metadata_signature(metadata: os.stat_result) -> tuple[int, int, int, int, int, int]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def _normalized_path(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _read_regular_file(path: Path) -> bytes:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError:
        _fail("unsafe_input", f"Pinned input is missing or unsafe: {path.name}")
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_size < 0
            or before.st_size > MAX_INPUT_BYTES
        ):
            _fail("unsafe_input", f"Pinned input is not a bounded regular file: {path.name}")
        chunks: list[bytes] = []
        remaining = before.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                _fail("input_changed", f"Pinned input changed while read: {path.name}")
            chunks.append(chunk)
            remaining -= len(chunk)
        if os.read(descriptor, 1):
            _fail("input_changed", f"Pinned input grew while read: {path.name}")
        after = os.fstat(descriptor)
        if _metadata_signature(before) != _metadata_signature(after):
            _fail("input_changed", f"Pinned input metadata changed: {path.name}")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def capture_input_bytes() -> InputByteSnapshot:
    """Capture every compiler input once for a single deterministic operation."""

    if not isinstance(BOUND_COMPILER_SOURCE_BYTES, bytes):
        _fail(
            "unbound_compiler_source",
            "Compiler operations require amendment_bootstrap.py byte binding",
        )

    try:
        entries = sorted(os.scandir(REVISION_GENERATED_DIR), key=lambda entry: entry.name)
    except OSError:
        _fail("unsafe_input", "Frozen revision generated directory is unavailable")
    if len(entries) != 26 or any(
        not entry.is_file(follow_symlinks=False) for entry in entries
    ):
        _fail("frozen_package_drift", "Frozen revision package is not exactly 26 regular files")
    paths = {
        _normalized_path(BASELINE_MODEL_PATH),
        _normalized_path(BASELINE_PAYLOAD_PATH),
        _normalized_path(BASELINE_MANIFEST_PATH),
        _normalized_path(BASELINE_CATALOG_PATH),
        _normalized_path(OVERLAY_PATH),
        _normalized_path(TRIGGER_CONTRACT_PATH),
        _normalized_path(TRIGGER_CONTRACT_SIDECAR_PATH),
        _normalized_path(APPLY_SOURCE_PATH),
        _normalized_path(CATALOG_SOURCE_PATH),
        _normalized_path(BOOTSTRAP_SOURCE_PATH),
        *(_normalized_path(Path(entry.path)) for entry in entries),
    }
    files = {path: _read_regular_file(path) for path in sorted(paths, key=str)}
    files[_normalized_path(Path(__file__))] = BOUND_COMPILER_SOURCE_BYTES
    return InputByteSnapshot(MappingProxyType(files))


def _parse_json(raw: bytes, *, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_duplicate_key_guard)
    except CompilerContractError:
        raise
    except Exception:
        _fail("invalid_json", f"Pinned JSON is invalid: {label}")
    if not isinstance(value, dict):
        _fail("invalid_json", f"Pinned JSON root is not an object: {label}")
    return value


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _strict_json_equal(actual: Any, expected: Any) -> bool:
    return _canonical_json_bytes(actual) == _canonical_json_bytes(expected)


def _revision_package_aggregate(inputs: InputByteSnapshot) -> str:
    files = sorted(
        path
        for path in inputs.files
        if path.parent == _normalized_path(REVISION_GENERATED_DIR)
    )
    if len(files) != 26:
        _fail("frozen_package_drift", "Frozen revision generated file count is not 26")
    digest = hashlib.sha256()
    for path in files:
        raw = inputs.read(path)
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(_sha256(raw).encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def frozen_input_snapshot(inputs: InputByteSnapshot | None = None) -> dict[str, str]:
    if inputs is None:
        inputs = capture_input_bytes()
    snapshot = {
        "baseline_raw_model_sha256": _sha256(inputs.read(BASELINE_MODEL_PATH)),
        "baseline_canonical_model_sha256": _sha256(
            _canonical_json_bytes(
                _parse_json(inputs.read(BASELINE_MODEL_PATH), label="baseline model")
            )
        ),
        "baseline_manifest_sha256": _sha256(inputs.read(BASELINE_MANIFEST_PATH)),
        "baseline_phase1_payload_sha256": _sha256(inputs.read(BASELINE_PAYLOAD_PATH)),
        "baseline_catalog_sha256": _sha256(inputs.read(BASELINE_CATALOG_PATH)),
        "revision_manifest_sha256": _sha256(inputs.read(REVISION_MANIFEST_PATH)),
        "revision_package_aggregate_sha256": _revision_package_aggregate(inputs),
        "resolved_model_sha256": _sha256(inputs.read(RESOLVED_MODEL_PATH)),
        "design_catalog_sha256": _sha256(inputs.read(DESIGN_CATALOG_PATH)),
        "overlay_sha256": _sha256(inputs.read(OVERLAY_PATH)),
    }
    return snapshot


def verify_frozen_inputs(inputs: InputByteSnapshot | None = None) -> dict[str, str]:
    if inputs is None:
        inputs = capture_input_bytes()
    snapshot = frozen_input_snapshot(inputs)
    if snapshot != EXPECTED_HASHES:
        _fail(
            "frozen_input_drift",
            "One or more R6/R6A1 frozen inputs changed",
            expected=EXPECTED_HASHES,
            actual=snapshot,
        )
    revision_manifest = _parse_json(
        inputs.read(REVISION_MANIFEST_PATH), label="revision manifest"
    )
    if (
        revision_manifest.get("revision_id") != "R6A1-FX-SIGNED-POS"
        or revision_manifest.get("release_status") != "DESIGN_ONLY_NOT_COMPILED"
        or revision_manifest.get("apply_compatibility") != "NOT_APPLY_COMPATIBLE"
    ):
        _fail("frozen_input_drift", "Frozen revision manifest boundary is not exact")
    baseline_manifest = _parse_json(
        inputs.read(BASELINE_MANIFEST_PATH), label="baseline manifest"
    )
    validate_baseline_predecessor_bindings(baseline_manifest, inputs)
    return snapshot


def validate_baseline_predecessor_bindings(
    manifest: Mapping[str, Any], inputs: InputByteSnapshot
) -> None:
    baseline_model = _parse_json(inputs.read(BASELINE_MODEL_PATH), label="baseline model")
    raw_model_sha = _sha256(inputs.read(BASELINE_MODEL_PATH))
    canonical_model_sha = _sha256(_canonical_json_bytes(baseline_model))
    payload = inputs.read(BASELINE_PAYLOAD_PATH)
    payload_sha = _sha256(payload)
    expected_inputs = {
        "canonical_model_sha256": canonical_model_sha,
        "compiler_sha256": BASELINE_COMPILER_SHA256,
        "raw_model_sha256": raw_model_sha,
        "review_package_sha256": BASELINE_REVIEW_PACKAGE_SHA256,
    }
    expected_payload = {
        "bytes": BASELINE_PAYLOAD_BYTES,
        "filename": "phase1.sql",
        "sha256": payload_sha,
    }
    expected_migration = {
        "filename": "phase1.sql",
        "migration_version": "R6_PHASE1_BASELINE",
        "predecessors": [],
        "repository_code": REPOSITORY_CODE,
    }
    expected_runtime = {
        "postgres_image": PG17_DOCKER_IMAGE,
        "repo_digest": PG17_DOCKER_REPO_DIGEST,
    }
    projections = (
        (manifest.get("inputs"), expected_inputs),
        (manifest.get("payload"), expected_payload),
        (manifest.get("migration"), expected_migration),
        (manifest.get("validation_runtime"), expected_runtime),
        (manifest.get("manifest_version"), 2),
        (manifest.get("model_version"), "HOTCRUSH-CORE-V1-REVIEW-R6-2026-08-10"),
        (manifest.get("compiler_version"), "R6_PHASE1_COMPILER_V4_P0C_EXECUTOR_OWNER"),
        (manifest.get("scope"), "PHASE1_CORE_MIGRATION_PHYSICAL_ONLY"),
        (manifest.get("expected_owner"), "postgres"),
    )
    if any(not _strict_json_equal(actual, expected) for actual, expected in projections):
        _fail(
            "baseline_predecessor_binding_drift",
            "Baseline Phase 1 manifest internal bindings differ",
        )
    baseline_catalog = _parse_json(
        inputs.read(BASELINE_CATALOG_PATH), label="baseline catalog"
    )
    expected_catalog_binding = {
        "canonical_model_sha256": canonical_model_sha,
        "migration_version": "R6_PHASE1_BASELINE",
        "payload_sha256": payload_sha,
    }
    if not _strict_json_equal(
        baseline_catalog.get("artifact_binding"), expected_catalog_binding
    ):
        _fail(
            "baseline_predecessor_binding_drift",
            "Baseline catalog artifact binding differs",
        )


def validate_trigger_contract_bytes(raw: bytes) -> dict[str, Any]:
    """Validate the exact body-free v2 contract without treating it as executable."""

    if type(raw) is not bytes:
        _fail("invalid_trigger_contract", "Trigger contract source must be exact bytes")
    contract = _parse_json(raw, label="trigger contract")
    canonical_source = (
        json.dumps(contract, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    if raw != canonical_source:
        _fail("invalid_trigger_contract", "Trigger contract source is not canonical")
    if set(contract) != TRIGGER_CONTRACT_ROOT_KEYS:
        _fail("invalid_trigger_contract", "Trigger contract root is not closed")
    scalar_expectations = {
        "artifact_kind": "R6A1_TRIGGER_CONTRACT",
        "schema_version": 2,
        "revision_id": "R6A1-FX-SIGNED-POS",
        "decision_status": TRIGGER_CONTRACT_STATUS,
        "model_binding_status": "MODEL_RESEALED_AND_BOUND",
        "catalog_status": "NOT_COMPILED",
        "activation_status": "NOT_ACTIVATED",
        "postgresql_contract": "17.6",
        "resolved_model_sha256": EXPECTED_HASHES["resolved_model_sha256"],
    }
    if any(contract.get(key) != value for key, value in scalar_expectations.items()):
        _fail("invalid_trigger_contract", "Trigger contract identity/status drifted")
    if contract["release_blockers"] != [
        "CATALOG_CAPTURE_REQUIRED",
        "ACTIVATION_MIGRATION_REQUIRED",
        "DEDICATED_CONNECTOR_REQUIRED",
        "LATEST_SIGNED_S0_CONSERVATION_REQUIRED",
    ]:
        _fail("invalid_trigger_contract", "Trigger release blockers drifted")

    inventory = contract["inventory"]
    expected_inventory = {
        "assert_all_routine_count": 1,
        "assert_routine_count": 6,
        "baseline_helper_identity": "public.app_normalize_alias_v1(pg_catalog.text)",
        "constraint_trigger_count": 15,
        "dispatcher_routine_count": 15,
        "governed_direct_dml_grant_count": 0,
        "managed_routine_count": 28,
        "new_routine_count": 27,
        "runtime_nonowner_execute_grant_count": 0,
        "trigger_count": 22,
        "trigger_type_mask_histogram": {"17": 8, "29": 7, "34": 7},
        "truncate_routine_count": 1,
        "truncate_trigger_count": 7,
        "writer_routine_count": 4,
    }
    if not _strict_json_equal(inventory, expected_inventory):
        _fail("invalid_trigger_contract", "Trigger inventory summary drifted")

    forbidden_keys = {"body", "definition", "prosrc", "sql", "ddl"}

    def reject_executable_payload(value: Any) -> None:
        if isinstance(value, dict):
            if not forbidden_keys.isdisjoint(value):
                _fail("invalid_trigger_contract", "Executable body material is forbidden")
            for nested in value.values():
                reject_executable_payload(nested)
        elif isinstance(value, list):
            for nested in value:
                reject_executable_payload(nested)

    reject_executable_payload(contract)

    routines = contract["routine_contracts"]
    routine_keys = {
        "argument_modes",
        "argument_names",
        "argument_types",
        "comment_requirement",
        "configuration",
        "default_argument_count",
        "executable_body_status",
        "execute_grantees",
        "identity",
        "kind",
        "leakproof",
        "name",
        "owner",
        "parallel",
        "returns",
        "security",
        "signature",
        "strict",
        "volatility",
    }
    if not isinstance(routines, list) or len(routines) != 27:
        _fail("invalid_trigger_contract", "Routine inventory cardinality drifted")
    identities: list[str] = []
    kind_counts: dict[str, int] = {}
    for row in routines:
        if not isinstance(row, dict) or set(row) != routine_keys:
            _fail("invalid_trigger_contract", "Routine row schema is not closed")
        identities.append(row["identity"])
        kind_counts[row["kind"]] = kind_counts.get(row["kind"], 0) + 1
        if (
            row["owner"] != "postgres"
            or row["volatility"] != "VOLATILE"
            or row["parallel"] != "UNSAFE"
            or row["strict"] is not False
            or row["leakproof"] is not False
            or row["default_argument_count"] != 0
            or row["execute_grantees"] != []
            or row["executable_body_status"] != "NOT_COMPILED"
            or row["comment_requirement"] != "NONEMPTY_PHYSICAL_COMMENT_REQUIRED"
            or row["argument_modes"] != ["IN"] * len(row["argument_names"])
            or len(row["argument_names"]) != len(row["argument_types"])
        ):
            _fail("invalid_trigger_contract", "Routine attributes drifted")
        if row["kind"] == "TRUNCATE_BLOCKER":
            if row["security"] != "INVOKER" or row["configuration"] != [
                "search_path=pg_catalog, pg_temp",
                "TimeZone=UTC",
            ]:
                _fail("invalid_trigger_contract", "Truncate routine attributes drifted")
        elif row["security"] != "DEFINER" or row["configuration"] != [
            "search_path=pg_catalog, pg_temp",
            "row_security=off",
            "TimeZone=UTC",
        ]:
            _fail("invalid_trigger_contract", "Definer routine attributes drifted")
    if len(identities) != len(set(identities)) or set(identities) != set(
        TRIGGER_CONTRACT_ROUTINE_IDENTITIES
    ):
        _fail("invalid_trigger_contract", "Routine identity inventory drifted")
    if kind_counts != {
        "SINGLE_FAMILY_ASSERT": 6,
        "FULL_ASSERT": 1,
        "TRIGGER_DISPATCHER": 15,
        "TRUNCATE_BLOCKER": 1,
        "CONTROLLED_WRITER": 4,
    }:
        _fail("invalid_trigger_contract", "Routine family inventory drifted")

    triggers = contract["trigger_contracts"]
    trigger_keys = {
        "comment_requirement",
        "constraint_name",
        "definition_status",
        "deferrable",
        "enabled",
        "events",
        "function_identity",
        "initially_deferred",
        "is_constraint",
        "level",
        "name",
        "schema",
        "table",
        "timing",
        "type_mask",
    }
    if not isinstance(triggers, list) or len(triggers) != 22:
        _fail("invalid_trigger_contract", "Trigger inventory cardinality drifted")
    trigger_names: list[str] = []
    histogram: dict[str, int] = {}
    for row in triggers:
        if not isinstance(row, dict) or set(row) != trigger_keys:
            _fail("invalid_trigger_contract", "Trigger row schema is not closed")
        trigger_names.append(row["name"])
        mask = str(row["type_mask"])
        histogram[mask] = histogram.get(mask, 0) + 1
        if (
            row["schema"] != "public"
            or row["enabled"] != "ALWAYS"
            or row["definition_status"] != "NOT_COMPILED"
            or row["comment_requirement"] != "NONEMPTY_PHYSICAL_COMMENT_REQUIRED"
        ):
            _fail("invalid_trigger_contract", "Trigger row attributes drifted")
        if row["is_constraint"]:
            if (
                not row["deferrable"]
                or row["initially_deferred"]
                or row["timing"] != "AFTER"
                or row["level"] != "ROW"
                or row["constraint_name"] != row["name"]
            ):
                _fail("invalid_trigger_contract", "Constraint trigger attributes drifted")
        elif (
            row["deferrable"]
            or row["initially_deferred"]
            or row["timing"] != "BEFORE"
            or row["level"] != "STATEMENT"
            or row["events"] != ["TRUNCATE"]
            or row["constraint_name"] is not None
        ):
            _fail("invalid_trigger_contract", "Truncate trigger attributes drifted")
    if len(trigger_names) != len(set(trigger_names)) or set(trigger_names) != set(
        TRIGGER_CONTRACT_TRIGGER_NAMES
    ):
        _fail("invalid_trigger_contract", "Trigger name inventory drifted")
    if histogram != {"17": 8, "29": 7, "34": 7}:
        _fail("invalid_trigger_contract", "Trigger type-mask inventory drifted")

    actions = contract["action_registry"]
    action_keys = {
        "action_code",
        "business_rowcount_by_outcome",
        "maintenance_only",
        "object_type",
        "online_writer_identity",
        "outcomes",
        "replay_audit_rowcount",
        "replay_business_rowcount",
    }
    if (
        not isinstance(actions, list)
        or any(not isinstance(row, dict) or set(row) != action_keys for row in actions)
        or tuple(row["action_code"] for row in actions) != TRIGGER_CONTRACT_ACTION_CODES
        or any(
            row["replay_audit_rowcount"] != 0
            or row["replay_business_rowcount"] != 0
            for row in actions
        )
    ):
        _fail("invalid_trigger_contract", "Action registry drifted")
    if contract["transaction_contract"]["constraint_mode"]["names"] != list(
        TRIGGER_CONTRACT_EXACT15
    ):
        _fail("invalid_trigger_contract", "Exact15 constraint order drifted")
    if contract["catalog_acceptance"]["target_pg_catalog_sha256"] is not None:
        _fail("invalid_trigger_contract", "Physical catalog cannot be pre-sealed")
    if contract["catalog_acceptance"]["new_routine_execute_grant_count"] != 0:
        _fail("invalid_trigger_contract", "Runtime EXECUTE grants must remain zero")

    compact_sha = _sha256(_canonical_json_bytes(contract))
    if (
        len(raw) != TRIGGER_CONTRACT_BYTES
        or _sha256(raw) != TRIGGER_CONTRACT_RAW_SHA256
        or compact_sha != TRIGGER_CONTRACT_COMPACT_SHA256
    ):
        _fail("invalid_trigger_contract", "Trigger contract digest binding drifted")
    return contract


def load_trigger_contract(inputs: InputByteSnapshot | None = None) -> dict[str, Any]:
    if inputs is None:
        inputs = capture_input_bytes()
    raw = inputs.read(TRIGGER_CONTRACT_PATH)
    contract = validate_trigger_contract_bytes(raw)
    expected_sidecar = (
        f"{TRIGGER_CONTRACT_RAW_SHA256}  trigger-contract.json\n"
    ).encode("ascii")
    sidecar = inputs.read(TRIGGER_CONTRACT_SIDECAR_PATH)
    if (
        sidecar != expected_sidecar
        or _sha256(sidecar) != TRIGGER_CONTRACT_SIDECAR_SHA256
    ):
        _fail("invalid_trigger_contract", "Trigger contract sidecar drifted")
    resolved_raw = inputs.read(RESOLVED_MODEL_PATH)
    if _sha256(resolved_raw) != contract["resolved_model_sha256"]:
        _fail("invalid_trigger_contract", "Resolved-model binding drifted")
    resolved = _parse_json(resolved_raw, label="resolved model")
    by_name = {row["name"]: row for row in resolved["tables"]}
    audit = by_name["app_audit_event"]
    delta = contract["model_delta"]["app_audit_event"]
    if (
        audit["fields"][8] != delta["column"]
        or delta["field_index_zero_based"] != 8
        or delta["physical_column_ordinal_one_based"] != 9
        or audit["checks"] != [delta["check_expression"]]
        or audit["uniques"] != [delta["unique_constraint"]["columns"]]
        or audit["nulls_distinct_uniques"]
        != [delta["unique_constraint"]["columns"]]
        or audit["nulls_not_distinct_uniques"] != []
    ):
        _fail("invalid_trigger_contract", "Typed operation model delta drifted")
    notes = contract["model_delta"]["notes_replacements"]
    if any(by_name[name]["notes"] != value for name, value in notes.items()):
        _fail("invalid_trigger_contract", "Resealed model notes drifted")
    return contract


def _core_tables(model: Mapping[str, Any]) -> tuple[dict[str, Any], ...]:
    raw = model.get("tables")
    if not isinstance(raw, list):
        _fail("invalid_model", "Resolved model tables are missing")
    tables = tuple(
        sorted(
            (table for table in raw if table.get("lifecycle") == "CORE_MIGRATION"),
            key=lambda table: table["name"],
        )
    )
    names = [table.get("name") for table in tables]
    if any(not isinstance(name, str) or not IDENTIFIER_RE.fullmatch(name) for name in names):
        _fail("invalid_model", "Resolved model contains an unsafe table name")
    if len(names) != len(set(names)):
        _fail("invalid_model", "Resolved model contains duplicate core table names")
    return tables


def _table_map(tables: Iterable[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {table["name"]: table for table in tables}


def _active_foreign_keys(tables: Sequence[dict[str, Any]]) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    core_names = {table["name"] for table in tables}
    for table in tables:
        for field in table["fields"]:
            fk = field.get("fk")
            if not fk or field.get("fk_activation") != "WITH_TABLE":
                continue
            ref_table, ref_column = fk.split(".", 1)
            if ref_table not in core_names:
                _fail("invalid_model", f"Active FK targets non-core table: {table['name']}.{field['name']}")
            rows.append(
                {
                    "table": table["name"],
                    "columns": [field["name"]],
                    "ref_table": ref_table,
                    "ref_columns": [ref_column],
                    "match_type": "SIMPLE",
                    "origin": "FIELD",
                }
            )
        for fk in table["foreign_keys"]:
            if fk["fk_activation"] != "WITH_TABLE":
                continue
            rows.append(
                {
                    "table": table["name"],
                    "columns": list(fk["columns"]),
                    "ref_table": fk["ref_table"],
                    "ref_columns": list(fk["ref_columns"]),
                    "match_type": fk["match_type"],
                    "origin": "TABLE",
                }
            )
    rows.sort(key=_foreign_key_sort_key)
    if len({_foreign_key_key(row) for row in rows}) != len(rows):
        _fail("duplicate_foreign_key", "Resolved model contains duplicate active FK edges")
    return tuple(rows)


def _foreign_key_key(row: Mapping[str, Any]) -> tuple[Any, ...]:
    return (
        row["table"],
        tuple(row["columns"]),
        row["ref_table"],
        tuple(row["ref_columns"]),
        row["match_type"],
        row["origin"],
    )


def _foreign_key_sort_key(row: Mapping[str, Any]) -> tuple[Any, ...]:
    return _foreign_key_key(row)


def _index_key(row: Mapping[str, Any]) -> tuple[Any, ...]:
    return row["table"], tuple(row["columns"])


def _eligible_reference_keys(table: Mapping[str, Any]) -> set[tuple[str, ...]]:
    primary = tuple(field["name"] for field in table["fields"] if field["pk"])
    return {primary, *(tuple(group) for group in table["uniques"])}


def _support_indexes(
    tables: Sequence[dict[str, Any]], foreign_keys: Sequence[dict[str, Any]]
) -> tuple[dict[str, Any], ...]:
    prefixes = {
        table["name"]: _eligible_reference_keys(table)
        for table in tables
    }
    rows: list[dict[str, Any]] = []
    for edge in sorted(
        foreign_keys,
        key=lambda row: (
            row["table"],
            -len(row["columns"]),
            tuple(row["columns"]),
            row["ref_table"],
            tuple(row["ref_columns"]),
        ),
    ):
        columns = tuple(edge["columns"])
        available = prefixes[edge["table"]]
        if any(prefix[: len(columns)] == columns for prefix in available):
            continue
        rows.append({"table": edge["table"], "columns": list(columns)})
        available.add(columns)
    rows.sort(key=_index_key)
    return tuple(rows)


def _unique_subtypes(tables: Sequence[dict[str, Any]]) -> dict[str, int]:
    counts = {"ordinary": 0, "nulls_distinct": 0, "nulls_not_distinct": 0}
    for table in tables:
        nnd = {tuple(group) for group in table["nulls_not_distinct_uniques"]}
        nd = {tuple(group) for group in table["nulls_distinct_uniques"]}
        for raw_group in table["uniques"]:
            group = tuple(raw_group)
            if group in nnd:
                counts["nulls_not_distinct"] += 1
            elif group in nd:
                counts["nulls_distinct"] += 1
            else:
                counts["ordinary"] += 1
    return counts


def _target_counts(
    tables: Sequence[dict[str, Any]],
    foreign_keys: Sequence[dict[str, Any]],
    indexes: Sequence[dict[str, Any]],
) -> dict[str, int]:
    columns = sum(len(table["fields"]) for table in tables)
    primary_keys = sum(
        sum(field["pk"] is True for field in table["fields"]) for table in tables
    )
    uniques = sum(len(table["uniques"]) for table in tables)
    checks = sum(
        len(table["checks"])
        + sum(len(field["checks"]) for field in table["fields"])
        for table in tables
    )
    exclusions = sum(len(table["exclusions"]) for table in tables)
    business_constraints = primary_keys + uniques + checks + exclusions + len(foreign_keys)
    return {
        "tables": len(tables),
        "columns": columns,
        "primary_keys": primary_keys,
        "unique_constraints": uniques,
        "checks": checks,
        "exclusions": exclusions,
        "foreign_keys": len(foreign_keys),
        "foreign_key_indexes": len(indexes),
        "catalog_total_indexes": primary_keys + uniques + exclusions + len(indexes),
        "table_comments": len(tables),
        "column_comments": columns,
        "constraint_comments": business_constraints,
        "index_comments": len(indexes),
        "sql_views": 0,
    }


def _canonical_object_sha256(value: Any) -> str:
    return _sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    )


def _q(identifier: str) -> str:
    if not isinstance(identifier, str) or IDENTIFIER_RE.fullmatch(identifier) is None:
        _fail("unsafe_identifier", f"Unsafe SQL identifier: {identifier!r}")
    if len(identifier.encode("utf-8")) > 63:
        _fail("unsafe_identifier", f"SQL identifier exceeds 63 bytes: {identifier}")
    return f'"{identifier}"'


def _qualified(table_name: str) -> str:
    return f"public.{_q(table_name)}"


def _stable_name(prefix: str, table: str, parts: Sequence[str]) -> str:
    if IDENTIFIER_RE.fullmatch(prefix) is None or IDENTIFIER_RE.fullmatch(table) is None:
        _fail("unsafe_identifier", "Unsafe generated-name prefix or table")
    if any(re.fullmatch(r"[a-z0-9_]+", value) is None for value in parts):
        _fail("unsafe_identifier", "Unsafe generated-name part")
    suffix = "__".join(parts)
    raw = f"{prefix}_{table}" + (f"__{suffix}" if suffix else "")
    if len(raw) <= 63:
        return raw
    digest = hashlib.sha256(raw.encode("ascii")).hexdigest()[:10]
    return f"{raw[:52]}_{digest}"


def _sql_literal(value: str) -> str:
    if "\x00" in value:
        _fail("unsafe_sql_literal", "SQL literal contains NUL")
    return "'" + value.replace("'", "''") + "'"


def _tokenize_check(expression: str) -> list[tuple[str, str]]:
    for fragment in FORBIDDEN_CHECK_FRAGMENTS:
        if fragment in expression:
            _fail("unsafe_check", f"Forbidden CHECK fragment {fragment!r}")
    tokens: list[tuple[str, str]] = []
    index = 0
    while index < len(expression):
        char = expression[index]
        if char.isspace():
            index += 1
            continue
        if expression.startswith("public.app_normalize_alias_v1", index):
            token = "public.app_normalize_alias_v1"
            tokens.append(("UDF", token))
            index += len(token)
            continue
        if expression.startswith("::jsonb", index):
            tokens.append(("CAST", "::pg_catalog.jsonb"))
            index += len("::jsonb")
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
                _fail("unsafe_check", "Unterminated CHECK string literal")
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
        _fail("unsafe_check", f"Unrecognized CHECK character: {char!r}")
    return tokens


def _compile_check_expression(expression: str, columns: set[str]) -> str:
    if not isinstance(expression, str) or not expression.strip():
        _fail("unsafe_check", "CHECK expression is empty")
    tokens = _tokenize_check(expression)
    rendered: list[str] = []
    depth = 0
    for index, (kind, token) in enumerate(tokens):
        if token == "(":
            depth += 1
        elif token == ")":
            depth -= 1
            if depth < 0:
                _fail("unsafe_check", "CHECK parentheses are unbalanced")
        if kind == "WORD":
            upper = token.upper()
            if upper in FORBIDDEN_CHECK_WORDS:
                _fail("unsafe_check", f"Forbidden CHECK word: {token}")
            if token in columns:
                rendered.append(_q(token))
            elif upper in CHECK_KEYWORDS:
                rendered.append(upper)
            elif token in CHECK_FUNCTIONS:
                if index + 1 >= len(tokens) or tokens[index + 1][1] != "(":
                    _fail("unsafe_check", "CHECK function lacks call syntax")
                rendered.append(CHECK_FUNCTIONS[token])
            else:
                _fail("unsafe_check_identifier", f"Unknown CHECK identifier: {token}")
        elif kind == "UDF":
            if index + 1 >= len(tokens) or tokens[index + 1][1] != "(":
                _fail("unsafe_check", "CHECK UDF lacks call syntax")
            rendered.append(token)
        else:
            rendered.append(token)
    if depth != 0:
        _fail("unsafe_check", "CHECK parentheses are unbalanced")
    return " ".join(rendered)


def _column_definition(field: Mapping[str, Any]) -> str:
    data_type = TYPE_SQL.get(field["data_type"])
    if data_type is None:
        _fail("unknown_type", f"Unknown SQL type: {field['data_type']}")
    definition = f"{_q(field['name'])} {data_type}"
    default = field["default"]
    if default is not None:
        default_sql = DEFAULT_SQL.get(default)
        if default_sql is None:
            _fail("unknown_default", f"Unknown SQL default: {default}")
        definition += f" DEFAULT {default_sql}"
    if field["nullable"] is False:
        definition += " NOT NULL"
    return definition


def _pk_name(table: Mapping[str, Any]) -> str:
    return _stable_name(
        "pk", table["name"],
        [field["name"] for field in table["fields"] if field["pk"]],
    )


def _unique_name(table: Mapping[str, Any], columns: Sequence[str]) -> str:
    return _stable_name("uq", table["name"], columns)


def _check_name(table: str, scope: str, ordinal: int) -> str:
    return _stable_name("ck", table, [scope.removeprefix("field:"), f"{ordinal:02d}"])


def _fk_name(edge: Mapping[str, Any]) -> str:
    return _stable_name(
        "fk", edge["table"], [*edge["columns"], edge["ref_table"]]
    )


def _support_index_name(row: Mapping[str, Any]) -> str:
    return _stable_name("ix", row["table"], [*row["columns"], "fk"])


def _baseline_exclusion_names(inputs: InputByteSnapshot) -> dict[tuple[str, str], str]:
    manifest = _parse_json(inputs.read(BASELINE_MANIFEST_PATH), label="baseline manifest")
    rows = manifest.get("exclusions")
    if not isinstance(rows, list):
        _fail("baseline_predecessor_binding_drift", "Baseline exclusions are absent")
    result: dict[tuple[str, str], str] = {}
    for row in rows:
        key = (row.get("table"), row.get("symbolic"))
        name = row.get("constraint_name")
        if (
            not all(isinstance(value, str) for value in key)
            or not isinstance(name, str)
            or key in result
        ):
            _fail("baseline_predecessor_binding_drift", "Baseline exclusion row differs")
        result[key] = name
    return result


def _exclusion_name(
    table: str, symbolic: str, baseline_names: Mapping[tuple[str, str], str]
) -> str:
    existing = baseline_names.get((table, symbolic))
    if existing is not None:
        return existing
    spec = NEW_EXCLUSION_SPECS.get(table)
    if spec is None:
        _fail("unknown_exclusion", f"No approved physical exclusion for {table}")
    return str(spec["name"])


def _constraint_rows(
    tables: Sequence[dict[str, Any]],
    inputs: InputByteSnapshot,
    foreign_keys: Sequence[dict[str, Any]] = (),
) -> tuple[dict[str, Any], ...]:
    baseline_names = _baseline_exclusion_names(inputs)
    rows: list[dict[str, Any]] = []
    for table in tables:
        columns = {field["name"] for field in table["fields"]}
        pk_columns = [field["name"] for field in table["fields"] if field["pk"]]
        rows.append(
            {
                "table": table["name"], "name": _pk_name(table), "type": "p",
                "columns": pk_columns, "definition": "PRIMARY_KEY",
                "null_policy": None, "expression": None,
            }
        )
        nnd = {tuple(group) for group in table["nulls_not_distinct_uniques"]}
        nd = {tuple(group) for group in table["nulls_distinct_uniques"]}
        for group in table["uniques"]:
            key = tuple(group)
            rows.append(
                {
                    "table": table["name"], "name": _unique_name(table, group),
                    "type": "u", "columns": list(group), "definition": "UNIQUE",
                    "null_policy": (
                        "NULLS_NOT_DISTINCT" if key in nnd else
                        "NULLS_DISTINCT" if key in nd else "ORDINARY"
                    ),
                    "expression": None,
                }
            )
        for ordinal, expression in enumerate(table["checks"], start=1):
            rows.append(
                {
                    "table": table["name"],
                    "name": _check_name(table["name"], "table", ordinal),
                    "type": "c", "columns": [], "definition": expression,
                    "null_policy": None,
                    "expression": _compile_check_expression(expression, columns),
                }
            )
        for field in table["fields"]:
            for ordinal, expression in enumerate(field["checks"], start=1):
                rows.append(
                    {
                        "table": table["name"],
                        "name": _check_name(
                            table["name"], f"field:{field['name']}", ordinal
                        ),
                        "type": "c", "columns": [field["name"]],
                        "definition": expression, "null_policy": None,
                        "expression": _compile_check_expression(expression, columns),
                    }
                )
        for symbolic in table["exclusions"]:
            rows.append(
                {
                    "table": table["name"],
                    "name": _exclusion_name(table["name"], symbolic, baseline_names),
                    "type": "x", "columns": [], "definition": symbolic,
                    "null_policy": None, "expression": None,
                }
            )
    for edge in foreign_keys:
        rows.append(
            {
                "table": edge["table"], "name": _fk_name(edge), "type": "f",
                "columns": list(edge["columns"]),
                "definition": f"MATCH_{edge['match_type']}_DEFERRABLE",
                "null_policy": None, "expression": None,
                "ref_table": edge["ref_table"],
                "ref_columns": list(edge["ref_columns"]),
            }
        )
    rows.sort(key=lambda row: (row["table"], row["type"], row["name"]))
    return tuple(rows)


def _render_constraint(row: Mapping[str, Any]) -> str:
    name = _q(row["name"])
    columns = ", ".join(_q(column) for column in row["columns"])
    if row["type"] == "p":
        return f"CONSTRAINT {name} PRIMARY KEY ({columns})"
    if row["type"] == "u":
        qualifier = {
            "ORDINARY": "",
            "NULLS_DISTINCT": " NULLS DISTINCT",
            "NULLS_NOT_DISTINCT": " NULLS NOT DISTINCT",
        }[row["null_policy"]]
        return f"CONSTRAINT {name} UNIQUE{qualifier} ({columns})"
    if row["type"] == "c":
        return f"CONSTRAINT {name} CHECK ({row['expression']})"
    if row["type"] == "x":
        spec = NEW_EXCLUSION_SPECS.get(row["table"])
        if spec is None or spec["name"] != row["name"]:
            _fail("unknown_exclusion", f"Cannot render changed exclusion {row['name']}")
        elements = ", ".join(spec["elements"])
        return (
            f"CONSTRAINT {name} EXCLUDE USING gist ({elements}) "
            f"WHERE ({spec['predicate']}) DEFERRABLE INITIALLY IMMEDIATE"
        )
    _fail("invalid_constraint", f"Unsupported constraint type: {row['type']}")


def _strip_sql_literals_and_comments(sql: str) -> str:
    result: list[str] = []
    index = 0
    while index < len(sql):
        if sql.startswith("--", index):
            end = sql.find("\n", index)
            if end < 0:
                break
            result.append("\n")
            index = end + 1
            continue
        if sql[index] == "'":
            result.append("''")
            index += 1
            while index < len(sql):
                if sql[index] == "'":
                    if index + 1 < len(sql) and sql[index + 1] == "'":
                        index += 2
                        continue
                    index += 1
                    break
                index += 1
            else:
                _fail("unsafe_stage_sql", "Unterminated SQL string literal")
            continue
        result.append(sql[index])
        index += 1
    return "".join(result)


def _normalized_sql_statements(sql: str) -> tuple[str, ...]:
    executable = _strip_sql_literals_and_comments(sql)
    pieces = executable.split(";")
    if pieces[-1].strip():
        _fail("unsafe_stage_sql", "Stage SQL has an unterminated statement")
    statements = tuple(" ".join(piece.split()) for piece in pieces[:-1] if piece.strip())
    if not statements:
        _fail("unsafe_stage_sql", "Stage SQL has no executable statements")
    return statements


_IDENTIFIER_TOKEN = r'"[a-z_][a-z0-9_]*"'
_QUALIFIED_TOKEN = rf'public\.{_IDENTIFIER_TOKEN}'
_STAGE_STATEMENT_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    "000_lock_baseline.sql": (
        re.compile(
            rf"LOCK TABLE {_QUALIFIED_TOKEN}(?:, {_QUALIFIED_TOKEN})* "
            r"IN ACCESS EXCLUSIVE MODE NOWAIT",
            re.IGNORECASE,
        ),
    ),
    "010_new_and_semantic_rebuild.sql": (
        re.compile(rf"DROP TABLE {_QUALIFIED_TOKEN}", re.IGNORECASE),
        re.compile(
            rf"CREATE TABLE {_QUALIFIED_TOKEN} \(.+\)",
            re.IGNORECASE | re.DOTALL,
        ),
    ),
    "020_surgical_alters.sql": (
        re.compile(
            rf"ALTER TABLE {_QUALIFIED_TOKEN} RENAME COLUMN {_IDENTIFIER_TOKEN} "
            rf"TO {_IDENTIFIER_TOKEN}",
            re.IGNORECASE,
        ),
        re.compile(
            rf"ALTER TABLE {_QUALIFIED_TOKEN} DROP COLUMN {_IDENTIFIER_TOKEN}",
            re.IGNORECASE,
        ),
        re.compile(
            rf"ALTER TABLE {_QUALIFIED_TOKEN} ADD COLUMN {_IDENTIFIER_TOKEN} .+",
            re.IGNORECASE | re.DOTALL,
        ),
        re.compile(
            rf"ALTER TABLE {_QUALIFIED_TOKEN} ALTER COLUMN {_IDENTIFIER_TOKEN} "
            r"(?:TYPE .+ USING .+|DROP DEFAULT|SET DEFAULT .+|DROP NOT NULL|SET NOT NULL)",
            re.IGNORECASE | re.DOTALL,
        ),
    ),
    "030_constraints.sql": (
        re.compile(
            rf"ALTER TABLE {_QUALIFIED_TOKEN} DROP CONSTRAINT {_IDENTIFIER_TOKEN}",
            re.IGNORECASE,
        ),
        re.compile(
            rf"ALTER TABLE {_QUALIFIED_TOKEN} ADD CONSTRAINT {_IDENTIFIER_TOKEN} "
            r"(?:PRIMARY KEY|UNIQUE|CHECK|EXCLUDE USING gist).+",
            re.IGNORECASE | re.DOTALL,
        ),
    ),
    "040_fk_indexes.sql": (
        re.compile(
            rf"CREATE INDEX {_IDENTIFIER_TOKEN} ON {_QUALIFIED_TOKEN} USING btree "
            rf"\({_IDENTIFIER_TOKEN}(?:, {_IDENTIFIER_TOKEN})*\)",
            re.IGNORECASE,
        ),
    ),
    "050_foreign_keys_not_valid.sql": (
        re.compile(
            rf"ALTER TABLE {_QUALIFIED_TOKEN} ADD CONSTRAINT {_IDENTIFIER_TOKEN} "
            rf"FOREIGN KEY \({_IDENTIFIER_TOKEN}(?:, {_IDENTIFIER_TOKEN})*\) "
            rf"REFERENCES {_QUALIFIED_TOKEN} "
            rf"\({_IDENTIFIER_TOKEN}(?:, {_IDENTIFIER_TOKEN})*\) "
            r"MATCH (?:SIMPLE|FULL) ON UPDATE NO ACTION ON DELETE NO ACTION "
            r"DEFERRABLE INITIALLY IMMEDIATE NOT VALID",
            re.IGNORECASE,
        ),
    ),
    "051_validate_foreign_keys.sql": (
        re.compile(
            rf"ALTER TABLE {_QUALIFIED_TOKEN} VALIDATE CONSTRAINT {_IDENTIFIER_TOKEN}",
            re.IGNORECASE,
        ),
    ),
    "070_security.sql": (
        re.compile(
            rf"REVOKE ALL PRIVILEGES ON TABLE {_QUALIFIED_TOKEN} FROM "
            r'PUBLIC, "anon", "authenticated", "service_role"',
            re.IGNORECASE,
        ),
        re.compile(
            rf"ALTER TABLE {_QUALIFIED_TOKEN} (?:ENABLE|FORCE) ROW LEVEL SECURITY",
            re.IGNORECASE,
        ),
    ),
    "080_comments.sql": (
        re.compile(rf"COMMENT ON TABLE {_QUALIFIED_TOKEN} IS ''", re.IGNORECASE),
        re.compile(
            rf"COMMENT ON COLUMN {_QUALIFIED_TOKEN}\.{_IDENTIFIER_TOKEN} IS ''",
            re.IGNORECASE,
        ),
        re.compile(
            rf"COMMENT ON CONSTRAINT {_IDENTIFIER_TOKEN} ON {_QUALIFIED_TOKEN} IS ''",
            re.IGNORECASE,
        ),
        re.compile(
            rf"COMMENT ON INDEX public\.{_IDENTIFIER_TOKEN} IS ''", re.IGNORECASE
        ),
    ),
}


def validate_stage_sql(
    stage_name: str,
    body: bytes,
    *,
    exact_rerender: bytes | None = None,
) -> None:
    if stage_name not in STAGE_DAG or not isinstance(body, bytes):
        _fail("unsafe_stage_sql", "Stage name/body is not closed")
    try:
        sql = body.decode("utf-8")
    except UnicodeDecodeError:
        _fail("unsafe_stage_sql", "Stage SQL is not UTF-8")
    if not sql or not sql.endswith("\n") or "\x00" in sql:
        _fail("unsafe_stage_sql", "Stage SQL bytes are not canonical text")
    if exact_rerender is not None and body != exact_rerender:
        _fail("unsafe_stage_sql", f"Stage bytes differ from exact rerender: {stage_name}")
    patterns = _STAGE_STATEMENT_PATTERNS.get(stage_name)
    if patterns is None:
        _fail("unsafe_stage_sql", f"Stage is blocked or has no approved statement grammar: {stage_name}")
    statements = _normalized_sql_statements(sql)
    for statement in statements:
        if not any(pattern.fullmatch(statement) for pattern in patterns):
            _fail("unsafe_stage_sql", f"Statement is outside the {stage_name} allowlist")
    if stage_name == "000_lock_baseline.sql" and len(statements) != 1:
        _fail("unsafe_stage_sql", "000 must contain exactly one table lock")


def _stage_header(stage: str) -> list[str]:
    return [
        f"-- HOT CRUSH Core V1 R6A1 / {stage}",
        "-- Deterministic non-trigger preview; the apply runner owns the transaction.",
        "",
    ]


def _render_lock_stage(plan: AmendmentPlan) -> bytes:
    names = [table["name"] for table in plan.baseline_tables]
    if names != sorted(names) or len(names) != 100:
        _fail("lock_inventory_drift", "Baseline lock inventory is not exact 100")
    qualified = ", ".join(_qualified(name) for name in names)
    return f"LOCK TABLE {qualified} IN ACCESS EXCLUSIVE MODE NOWAIT;\n".encode()


def _created_target_names(plan: AmendmentPlan) -> tuple[str, ...]:
    return tuple(sorted({*plan.new_tables, *plan.semantic_rebuilds}))


def _render_create_and_rebuild(plan: AmendmentPlan) -> bytes:
    target = _table_map(plan.target_tables)
    lines = _stage_header("010 new tables and empty-Green semantic rebuilds")
    # Drop the dependent cost-selection table before its old price parent.
    for name in (
        "cost_card_material_price",
        "scm_supplier_price_observation",
        "pos_order_item",
    ):
        lines.append(f"DROP TABLE {_qualified(name)};")
    lines.append("")
    for table_name in _created_target_names(plan):
        definitions = ",\n  ".join(
            _column_definition(field) for field in target[table_name]["fields"]
        )
        lines.extend(
            [
                f"CREATE TABLE {_qualified(table_name)} (",
                f"  {definitions}",
                ");",
                "",
            ]
        )
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def _render_surgical_alters(plan: AmendmentPlan) -> bytes:
    baseline = _table_map(plan.baseline_tables)
    target = _table_map(plan.target_tables)
    lines = _stage_header("020 exact existing-table column amendments")
    created = set(_created_target_names(plan))
    for delta in plan.table_deltas:
        if delta.object_name in created or delta.baseline_object_name is None:
            continue
        table_name = delta.object_name
        baseline_table = baseline[delta.baseline_object_name]
        target_table = target[table_name]
        baseline_fields = {field["name"]: field for field in baseline_table["fields"]}
        target_fields = {field["name"]: field for field in target_table["fields"]}
        rename_map = APPROVED_COLUMN_RENAMES.get(table_name, {})
        for old_name, new_name in sorted(rename_map.items()):
            if old_name not in baseline_fields or new_name not in target_fields:
                _fail("column_delta_drift", f"Approved rename drifted on {table_name}")
            lines.append(
                f"ALTER TABLE {_qualified(table_name)} RENAME COLUMN "
                f"{_q(old_name)} TO {_q(new_name)};"
            )
        renamed_old = set(rename_map)
        renamed_new = set(rename_map.values())
        for field_name in sorted(set(baseline_fields) - set(target_fields) - renamed_old):
            lines.append(
                f"ALTER TABLE {_qualified(table_name)} DROP COLUMN {_q(field_name)};"
            )
        for field_name in sorted(set(target_fields) - set(baseline_fields) - renamed_new):
            lines.append(
                f"ALTER TABLE {_qualified(table_name)} ADD COLUMN "
                f"{_column_definition(target_fields[field_name])};"
            )
        comparable: list[tuple[str, Mapping[str, Any], Mapping[str, Any]]] = []
        for field_name in sorted(set(baseline_fields) & set(target_fields)):
            comparable.append((field_name, baseline_fields[field_name], target_fields[field_name]))
        for old_name, new_name in sorted(rename_map.items()):
            comparable.append((new_name, baseline_fields[old_name], target_fields[new_name]))
        for field_name, before, after in comparable:
            if before["data_type"] != after["data_type"]:
                target_type = TYPE_SQL.get(after["data_type"])
                if target_type is None:
                    _fail("unknown_type", f"Unknown target type on {table_name}.{field_name}")
                lines.append(
                    f"ALTER TABLE {_qualified(table_name)} ALTER COLUMN {_q(field_name)} "
                    f"TYPE {target_type} USING {_q(field_name)}::{target_type};"
                )
            if before["default"] != after["default"]:
                if after["default"] is None:
                    clause = "DROP DEFAULT"
                else:
                    rendered = DEFAULT_SQL.get(after["default"])
                    if rendered is None:
                        _fail("unknown_default", f"Unknown target default on {table_name}.{field_name}")
                    clause = f"SET DEFAULT {rendered}"
                lines.append(
                    f"ALTER TABLE {_qualified(table_name)} ALTER COLUMN {_q(field_name)} {clause};"
                )
            if before["nullable"] != after["nullable"]:
                clause = "DROP NOT NULL" if after["nullable"] else "SET NOT NULL"
                lines.append(
                    f"ALTER TABLE {_qualified(table_name)} ALTER COLUMN {_q(field_name)} {clause};"
                )
        if lines[-1] != "":
            lines.append("")
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def _row_identity(row: Mapping[str, Any]) -> bytes:
    return _canonical_json_bytes(dict(row))


def _render_constraint_delta(plan: AmendmentPlan, inputs: InputByteSnapshot) -> bytes:
    created = set(_created_target_names(plan))
    baseline_rows = _constraint_rows(plan.baseline_tables, inputs)
    target_rows = _constraint_rows(plan.target_tables, inputs)
    baseline_map = {(row["table"], row["name"]): row for row in baseline_rows}
    target_map = {(row["table"], row["name"]): row for row in target_rows}
    lines = _stage_header("030 primary, unique, check and exclusion constraints")
    drop_rows: list[dict[str, Any]] = []
    add_rows: list[dict[str, Any]] = []
    affected_existing = {
        row.object_name for row in plan.table_deltas if row.object_name not in created
    }
    removed_columns = {
        row.object_name: set(row.removed_fields)
        - set(APPROVED_COLUMN_RENAMES.get(row.object_name, {}))
        for row in plan.table_deltas
    }
    for key, before in baseline_map.items():
        table, _name = key
        if table not in affected_existing:
            continue
        after = target_map.get(key)
        if after is None or _row_identity(before) != _row_identity(after):
            # PostgreSQL removes same-table constraints that depend on a column
            # as part of DROP COLUMN.  Issuing a second DROP CONSTRAINT would
            # hide an operational dependency error behind a nonexistent name.
            if set(before["columns"]) & removed_columns.get(table, set()):
                continue
            drop_rows.append(before)
    for key, after in target_map.items():
        table, _name = key
        if table in created:
            add_rows.append(after)
            continue
        if table not in affected_existing:
            continue
        before = baseline_map.get(key)
        if before is None or _row_identity(before) != _row_identity(after):
            add_rows.append(after)
    for row in sorted(drop_rows, key=lambda value: (value["table"], value["name"])):
        lines.append(
            f"ALTER TABLE {_qualified(row['table'])} DROP CONSTRAINT {_q(row['name'])};"
        )
    if drop_rows:
        lines.append("")
    for row in sorted(add_rows, key=lambda value: (value["table"], value["type"], value["name"])):
        lines.append(
            f"ALTER TABLE {_qualified(row['table'])} ADD {_render_constraint(row)};"
        )
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def _operational_support_indexes(plan: AmendmentPlan) -> tuple[dict[str, Any], ...]:
    created = set(_created_target_names(plan))
    added = {_index_key(row): row for row in plan.added_support_indexes}
    for row in plan.target_support_indexes:
        if row["table"] in created:
            added[_index_key(row)] = row
    return tuple(added[key] for key in sorted(added))


def _render_fk_indexes(plan: AmendmentPlan) -> bytes:
    lines = _stage_header("040 operational FK support indexes")
    rows = _operational_support_indexes(plan)
    for row in rows:
        columns = ", ".join(_q(column) for column in row["columns"])
        lines.append(
            f"CREATE INDEX {_q(_support_index_name(row))} ON "
            f"{_qualified(row['table'])} USING btree ({columns});"
        )
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def _operational_foreign_keys(plan: AmendmentPlan) -> tuple[dict[str, Any], ...]:
    created = set(_created_target_names(plan))
    added = {_foreign_key_key(row): row for row in plan.added_foreign_keys}
    for row in plan.target_foreign_keys:
        if row["table"] in created:
            added[_foreign_key_key(row)] = row
    return tuple(added[key] for key in sorted(added))


def _render_foreign_keys(plan: AmendmentPlan) -> bytes:
    lines = _stage_header("050 operational foreign keys NOT VALID")
    for edge in _operational_foreign_keys(plan):
        columns = ", ".join(_q(value) for value in edge["columns"])
        ref_columns = ", ".join(_q(value) for value in edge["ref_columns"])
        lines.extend(
            [
                f"ALTER TABLE {_qualified(edge['table'])}",
                f"  ADD CONSTRAINT {_q(_fk_name(edge))}",
                f"  FOREIGN KEY ({columns})",
                f"  REFERENCES {_qualified(edge['ref_table'])} ({ref_columns}) "
                f"MATCH {edge['match_type']}",
                "  ON UPDATE NO ACTION ON DELETE NO ACTION "
                "DEFERRABLE INITIALLY IMMEDIATE NOT VALID;",
            ]
        )
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def _render_validate_foreign_keys(plan: AmendmentPlan) -> bytes:
    lines = _stage_header("051 validate operational foreign keys")
    for edge in _operational_foreign_keys(plan):
        lines.append(
            f"ALTER TABLE {_qualified(edge['table'])} VALIDATE CONSTRAINT "
            f"{_q(_fk_name(edge))};"
        )
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def _render_security(plan: AmendmentPlan) -> bytes:
    lines = _stage_header("070 default-deny security for newly materialized tables")
    denied = 'PUBLIC, "anon", "authenticated", "service_role"'
    for table_name in _created_target_names(plan):
        lines.extend(
            [
                f"REVOKE ALL PRIVILEGES ON TABLE {_qualified(table_name)} FROM {denied};",
                f"ALTER TABLE {_qualified(table_name)} ENABLE ROW LEVEL SECURITY;",
                f"ALTER TABLE {_qualified(table_name)} FORCE ROW LEVEL SECURITY;",
            ]
        )
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def _single_line(value: Any) -> str:
    return " ".join(str(value).split())


def _table_comment(table: Mapping[str, Any]) -> str:
    return (
        f"{_single_line(table['zh_name'])}。用途：{_single_line(table['purpose'])}；"
        f"粒度：{_single_line(table['grain'])}；写入者：{_single_line(table['writer'])}；"
        f"来源：{_single_line(table['source'])}。"
    )


def _field_comment(table: Mapping[str, Any], field: Mapping[str, Any]) -> str:
    return (
        f"{_single_line(field['zh_name'])}。{_single_line(field['description'])}；"
        f"用途：{_single_line(field['purpose'])}；类型：{field['data_type']}；"
        f"示例：{_single_line(field['example'])}。"
    )


def _render_comments(plan: AmendmentPlan, inputs: InputByteSnapshot) -> bytes:
    constraints = _constraint_rows(plan.target_tables, inputs, plan.target_foreign_keys)
    if len(constraints) != 973:
        _fail("comment_inventory_drift", "Target constraint comments are not 973")
    lines = _stage_header("080 complete R6A1 table, column, constraint and FK-index comments")
    for table in plan.target_tables:
        lines.append(
            f"COMMENT ON TABLE {_qualified(table['name'])} IS "
            f"{_sql_literal(_table_comment(table))};"
        )
        for field in table["fields"]:
            lines.append(
                f"COMMENT ON COLUMN {_qualified(table['name'])}.{_q(field['name'])} IS "
                f"{_sql_literal(_field_comment(table, field))};"
            )
    for row in constraints:
        text = f"R6A1 model-derived {row['type']} constraint: {row['definition']}"
        lines.append(
            f"COMMENT ON CONSTRAINT {_q(row['name'])} ON {_qualified(row['table'])} IS "
            f"{_sql_literal(text)};"
        )
    for row in plan.target_support_indexes:
        text = "Btree support index for active FK columns " + ", ".join(row["columns"]) + "."
        lines.append(
            f"COMMENT ON INDEX public.{_q(_support_index_name(row))} IS {_sql_literal(text)};"
        )
    if len(lines) - len(_stage_header("x")) != 2813:
        _fail("comment_inventory_drift", "Target comment statements are not 2813")
    return ("\n".join(lines).rstrip() + "\n").encode("utf-8")


def render_nontrigger_stage_preview(
    inputs: InputByteSnapshot | None = None,
) -> dict[str, bytes]:
    """Render deterministic SQL that does not depend on unapproved trigger/catalog facts.

    This is an in-memory review surface only.  It is intentionally not a sealed
    bundle and cannot be published or accepted by the apply runner.
    """

    if inputs is None:
        inputs = capture_input_bytes()
    plan = build_amendment_plan(inputs)
    payloads = {
        "000_lock_baseline.sql": _render_lock_stage(plan),
        "010_new_and_semantic_rebuild.sql": _render_create_and_rebuild(plan),
        "020_surgical_alters.sql": _render_surgical_alters(plan),
        "030_constraints.sql": _render_constraint_delta(plan, inputs),
        "040_fk_indexes.sql": _render_fk_indexes(plan),
        "050_foreign_keys_not_valid.sql": _render_foreign_keys(plan),
        "051_validate_foreign_keys.sql": _render_validate_foreign_keys(plan),
        "070_security.sql": _render_security(plan),
        "080_comments.sql": _render_comments(plan, inputs),
    }
    expected = set(STAGE_DAG) - set(BLOCKED_STAGE_REASONS)
    if set(payloads) != expected:
        _fail("stage_inventory_drift", "Non-trigger preview stage set differs")
    for name, body in payloads.items():
        validate_stage_sql(name, body, exact_rerender=payloads[name])
    return payloads


def _pretty_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    ).encode("utf-8")


def _detached_sha256_bytes(name: str, content: bytes) -> bytes:
    return f"{_sha256(content)}  {name}\n".encode("ascii")


def _build_blocked_review_bundle(inputs: InputByteSnapshot) -> dict[str, bytes]:
    stages = render_nontrigger_stage_preview(inputs)
    if tuple(stages) != NONTRIGGER_PREVIEW_STAGE_NAMES:
        _fail("stage_inventory_drift", "Preview stage order differs")
    payload_rows = [
        {"name": name, "bytes": len(stages[name]), "sha256": _sha256(stages[name])}
        for name in NONTRIGGER_PREVIEW_STAGE_NAMES
    ]
    manifest = {
        "manifest_version": 1,
        "artifact_kind": "R6A1_NONTRIGGER_REVIEW_BUNDLE_NOT_RELEASE",
        "compiler_version": COMPILER_VERSION,
        "migration_version": MIGRATION_VERSION,
        "release_status": "BLOCKED_TRIGGER_CONTRACT_NOT_APPROVED",
        "apply_compatibility": "NOT_APPLY_COMPATIBLE",
        "integrity_seal_status": "REVIEW_BYTES_SEALED_NOT_RELEASE",
        "target_pg_catalog_sha256": None,
        "inputs": build_input_manifest(inputs),
        "stage_dag": [
            {
                "name": name,
                "predecessors": list(predecessors),
                "status": (
                    "BLOCKED_" + BLOCKED_STAGE_REASONS[name]
                    if name in BLOCKED_STAGE_REASONS
                    else "RENDERED_REVIEW_ONLY"
                ),
            }
            for name, predecessors in STAGE_DAG.items()
        ],
        "payloads": payload_rows,
        "blocked_stages": dict(BLOCKED_STAGE_REASONS),
    }
    bundle = dict(stages)
    for name, body in stages.items():
        bundle[f"{name}.sha256"] = _detached_sha256_bytes(name, body)
    manifest_bytes = _pretty_json_bytes(manifest)
    bundle[PREVIEW_MANIFEST_NAME] = manifest_bytes
    bundle[f"{PREVIEW_MANIFEST_NAME}.sha256"] = _detached_sha256_bytes(
        PREVIEW_MANIFEST_NAME, manifest_bytes
    )
    return bundle


def build_blocked_review_bundle(
    inputs: InputByteSnapshot | None = None,
) -> dict[str, bytes]:
    """Build an integrity-sealed review bundle that is explicitly not publishable."""

    if inputs is None:
        inputs = capture_input_bytes()
    return _build_blocked_review_bundle(inputs)


def validate_blocked_review_bundle(
    bundle: Mapping[str, bytes], inputs: InputByteSnapshot | None = None
) -> None:
    if inputs is None:
        inputs = capture_input_bytes()
    expected = _build_blocked_review_bundle(inputs)
    if set(bundle) != set(expected):
        _fail("review_bundle_drift", "Review bundle file set is not closed")
    drifted = sorted(name for name in expected if bundle[name] != expected[name])
    if drifted:
        _fail("review_bundle_drift", f"Review bundle bytes differ: {drifted}")


def publish_candidate_bundle(
    bundle: Mapping[str, bytes], destination: Path
) -> str:
    """Fail before filesystem mutation until an apply-compatible release exists."""

    del bundle, destination
    _fail(
        "release_blocked",
        "The R6A1 candidate is not publishable before triggers and PG catalog seal",
    )


def _validate_publish_name(name: str) -> str:
    if (
        not isinstance(name, str)
        or not name
        or name in {".", ".."}
        or "/" in name
        or "\x00" in name
    ):
        _fail("unsafe_publish_name", "Publish name is unsafe")
    return name


def _directory_identity(metadata: os.stat_result) -> tuple[int, int]:
    return metadata.st_dev, metadata.st_ino


def _open_directory_no_follow(path: Path) -> int:
    flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0)
    )
    components = path.parts
    if path.is_absolute():
        descriptor = os.open(os.sep, flags)
        components = components[1:]
    else:
        descriptor = os.open(".", flags)
    try:
        for component in components:
            if component in {"", ".", ".."}:
                _fail("unsafe_publish_parent", str(path))
            next_descriptor = os.open(component, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = next_descriptor
        return descriptor
    except CompilerContractError:
        os.close(descriptor)
        raise
    except FileNotFoundError:
        os.close(descriptor)
        _fail("missing_publish_parent", str(path))
    except OSError as exc:
        os.close(descriptor)
        _fail("unsafe_publish_parent", f"{path}: {exc.errno}")
    except BaseException:
        os.close(descriptor)
        raise


def _verify_directory_path_identity(path: Path, identity: tuple[int, int]) -> None:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        _fail("publish_parent_identity_drift", str(path))
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or path.is_symlink()
        or _directory_identity(metadata) != identity
    ):
        _fail("publish_parent_identity_drift", str(path))


def _read_regular_file_at(directory_descriptor: int, name: str) -> bytes:
    _validate_publish_name(name)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=directory_descriptor)
    except OSError as exc:
        _fail("publish_destination_drift", f"{name}: {exc.errno}")
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_INPUT_BYTES:
            _fail("publish_destination_drift", name)
        chunks: list[bytes] = []
        remaining = metadata.st_size
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                _fail("publish_destination_drift", name)
            chunks.append(chunk)
            remaining -= len(chunk)
        if os.read(descriptor, 1):
            _fail("publish_destination_drift", name)
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def _compare_published_bundle_at(
    bundle: Mapping[str, bytes], parent_descriptor: int, target_name: str
) -> str:
    _validate_publish_name(target_name)
    try:
        before = os.stat(target_name, dir_fd=parent_descriptor, follow_symlinks=False)
    except FileNotFoundError:
        return "MISSING"
    if not stat.S_ISDIR(before.st_mode):
        _fail("unsafe_publish_destination", target_name)
    flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        target_descriptor = os.open(target_name, flags, dir_fd=parent_descriptor)
    except OSError as exc:
        _fail("unsafe_publish_destination", f"{target_name}: {exc.errno}")
    try:
        identity = _directory_identity(os.fstat(target_descriptor))
        if identity != _directory_identity(before):
            _fail("publish_destination_identity_drift", target_name)
        names = sorted(os.listdir(target_descriptor))
        actual = {
            name: _read_regular_file_at(target_descriptor, name) for name in names
        }
        after = os.stat(target_name, dir_fd=parent_descriptor, follow_symlinks=False)
        if not stat.S_ISDIR(after.st_mode) or _directory_identity(after) != identity:
            _fail("publish_destination_identity_drift", target_name)
    finally:
        os.close(target_descriptor)
    if actual != dict(bundle):
        _fail("publish_destination_drift", target_name)
    return "NOOP"


def _atomic_rename_no_replace(
    parent_descriptor: int, source_name: str, target_name: str
) -> None:
    source = _validate_publish_name(source_name)
    target = _validate_publish_name(target_name)
    library = ctypes.CDLL(None, use_errno=True)
    if sys.platform == "darwin":
        function = getattr(library, "renameatx_np", None)
        flag = 0x00000004
    elif sys.platform.startswith("linux"):
        function = getattr(library, "renameat2", None)
        flag = 0x00000001
    else:
        function = None
        flag = 0
    if function is None:
        _fail("atomic_no_replace_unsupported", sys.platform)
    function.argtypes = [
        ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint
    ]
    function.restype = ctypes.c_int
    ctypes.set_errno(0)
    result = function(
        parent_descriptor,
        os.fsencode(source),
        parent_descriptor,
        os.fsencode(target),
        flag,
    )
    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number in {errno.EEXIST, errno.ENOTEMPTY}:
        raise FileExistsError(error_number, os.strerror(error_number), target)
    if error_number in {
        getattr(errno, "ENOSYS", 78), getattr(errno, "ENOTSUP", 45)
    }:
        _fail("atomic_no_replace_unsupported", f"{sys.platform}:{error_number}")
    _fail("atomic_publish_rename_failed", f"{target}:{error_number}")


def _create_publish_temporary(
    parent_descriptor: int,
) -> tuple[str, int, tuple[int, int]]:
    flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    for _ in range(256):
        name = f".r6a1-amendment-publish-{secrets.token_hex(16)}"
        try:
            os.mkdir(name, 0o700, dir_fd=parent_descriptor)
        except FileExistsError:
            continue
        try:
            descriptor = os.open(name, flags, dir_fd=parent_descriptor)
        except OSError as exc:
            _fail("unsafe_publish_temporary", f"{name}:{exc.errno}")
        return name, descriptor, _directory_identity(os.fstat(descriptor))
    _fail("publish_temporary_exhausted", "No temporary name remains")


def _verify_named_directory_identity(
    parent_descriptor: int,
    name: str,
    identity: tuple[int, int],
    *,
    error_code: str,
) -> None:
    try:
        metadata = os.stat(name, dir_fd=parent_descriptor, follow_symlinks=False)
    except OSError as exc:
        _fail(error_code, f"{name}:{exc.errno}")
    if not stat.S_ISDIR(metadata.st_mode) or _directory_identity(metadata) != identity:
        _fail(error_code, name)


def _verify_open_directory_bundle(
    bundle: Mapping[str, bytes],
    directory_descriptor: int,
    identity: tuple[int, int],
    *,
    error_code: str,
) -> None:
    before = os.fstat(directory_descriptor)
    if not stat.S_ISDIR(before.st_mode) or _directory_identity(before) != identity:
        _fail(error_code, "open directory identity drifted")
    try:
        names = sorted(os.listdir(directory_descriptor))
        actual = {
            name: _read_regular_file_at(directory_descriptor, name) for name in names
        }
    except CompilerContractError:
        _fail(error_code, "open directory payload is unsafe")
    after = os.fstat(directory_descriptor)
    if _directory_identity(after) != identity or actual != dict(bundle):
        _fail(error_code, "open directory payload differs")


def _write_publish_file(directory_descriptor: int, name: str, body: bytes) -> None:
    _validate_publish_name(name)
    if not isinstance(body, bytes) or len(body) > MAX_INPUT_BYTES:
        _fail("publish_write_failed", name)
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(name, flags, 0o600, dir_fd=directory_descriptor)
    except OSError as exc:
        _fail("publish_temporary_collision", f"{name}:{exc.errno}")
    try:
        view = memoryview(body)
        written = 0
        while written < len(view):
            count = os.write(descriptor, view[written:])
            if count <= 0:
                _fail("publish_write_failed", name)
            written += count
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _cleanup_publish_temporary(
    parent_descriptor: int, name: str, identity: tuple[int, int]
) -> None:
    flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(name, flags, dir_fd=parent_descriptor)
    except OSError as exc:
        _fail("publish_temporary_identity_drift", f"{name}:{exc.errno}")
    try:
        if _directory_identity(os.fstat(descriptor)) != identity:
            _fail("publish_temporary_identity_drift", name)
        for child in sorted(os.listdir(descriptor)):
            metadata = os.stat(child, dir_fd=descriptor, follow_symlinks=False)
            if not stat.S_ISREG(metadata.st_mode):
                _fail("publish_temporary_identity_drift", child)
            os.unlink(child, dir_fd=descriptor)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    current = os.stat(name, dir_fd=parent_descriptor, follow_symlinks=False)
    if not stat.S_ISDIR(current.st_mode) or _directory_identity(current) != identity:
        _fail("publish_temporary_identity_drift", name)
    try:
        os.rmdir(name, dir_fd=parent_descriptor)
    except OSError as exc:
        _fail("publish_temporary_cleanup_failed", f"{name}:{exc.errno}")


def _atomic_publish_exact_directory(
    bundle: Mapping[str, bytes], destination: Path
) -> str:
    """Filesystem primitive; callers must prove release semantics first."""

    if not bundle or any(_validate_publish_name(name) != name for name in bundle):
        _fail("unsafe_publish_name", "Bundle file set is empty or unsafe")
    target = Path(destination)
    target_name = _validate_publish_name(target.name)
    parent_descriptor = _open_directory_no_follow(target.parent)
    parent_identity = _directory_identity(os.fstat(parent_descriptor))
    temporary_name: str | None = None
    temporary_descriptor: int | None = None
    temporary_identity: tuple[int, int] | None = None
    try:
        _verify_directory_path_identity(target.parent, parent_identity)
        existing = _compare_published_bundle_at(bundle, parent_descriptor, target_name)
        if existing == "NOOP":
            _verify_directory_path_identity(target.parent, parent_identity)
            return "NOOP"
        temporary_name, temporary_descriptor, temporary_identity = (
            _create_publish_temporary(parent_descriptor)
        )
        for name in sorted(bundle):
            _write_publish_file(temporary_descriptor, name, bundle[name])
        os.fsync(temporary_descriptor)
        _verify_named_directory_identity(
            parent_descriptor,
            temporary_name,
            temporary_identity,
            error_code="publish_temporary_identity_drift",
        )
        _verify_open_directory_bundle(
            bundle,
            temporary_descriptor,
            temporary_identity,
            error_code="publish_temporary_content_drift",
        )
        _verify_directory_path_identity(target.parent, parent_identity)
        try:
            _atomic_rename_no_replace(
                parent_descriptor, temporary_name, target_name
            )
        except FileExistsError:
            if _compare_published_bundle_at(bundle, parent_descriptor, target_name) != "NOOP":
                _fail("publish_race_target_missing", str(target))
            return "NOOP"
        temporary_name = None
        _verify_named_directory_identity(
            parent_descriptor,
            target_name,
            temporary_identity,
            error_code="publish_destination_identity_drift",
        )
        _verify_open_directory_bundle(
            bundle,
            temporary_descriptor,
            temporary_identity,
            error_code="publish_destination_drift",
        )
        if _compare_published_bundle_at(bundle, parent_descriptor, target_name) != "NOOP":
            _fail("publish_destination_drift", str(target))
        _verify_named_directory_identity(
            parent_descriptor,
            target_name,
            temporary_identity,
            error_code="publish_destination_identity_drift",
        )
        os.close(temporary_descriptor)
        temporary_descriptor = None
        temporary_identity = None
        os.fsync(parent_descriptor)
        _verify_directory_path_identity(target.parent, parent_identity)
        return "PUBLISHED"
    finally:
        if temporary_descriptor is not None:
            os.close(temporary_descriptor)
        if temporary_name is not None and temporary_identity is not None:
            _cleanup_publish_temporary(
                parent_descriptor, temporary_name, temporary_identity
            )
        os.close(parent_descriptor)


def build_amendment_plan(inputs: InputByteSnapshot | None = None) -> AmendmentPlan:
    if inputs is None:
        inputs = capture_input_bytes()
    verify_frozen_inputs(inputs)
    baseline_model = _parse_json(inputs.read(BASELINE_MODEL_PATH), label="baseline model")
    target_model = _parse_json(inputs.read(RESOLVED_MODEL_PATH), label="resolved model")
    overlay = _parse_json(inputs.read(OVERLAY_PATH), label="model overlay")
    design_catalog = _parse_json(
        inputs.read(DESIGN_CATALOG_PATH), label="resolved design catalog"
    )

    baseline_tables = _core_tables(baseline_model)
    target_tables = _core_tables(target_model)
    baseline_by_name = _table_map(baseline_tables)
    target_by_name = _table_map(target_tables)
    if len(baseline_tables) != 100 or len(target_tables) != 105:
        _fail("wrong_table_count", "Baseline/target core table count is not 100/105")

    affected = overlay.get("affected_table_contracts")
    if not isinstance(affected, list) or len(affected) != EXPECTED_AFFECTED_TABLES:
        _fail("invalid_affected_contract", "Overlay does not contain exact 31 affected contracts")
    affected_names: list[str] = []
    table_deltas: list[TableDelta] = []
    for row in affected:
        if (
            not isinstance(row, dict)
            or row.get("exact_schema_status") != "APPROVED_DDL_LEVEL_CONTRACT"
        ):
            _fail("invalid_affected_contract", "Affected table contract is not exact-approved")
        name = row.get("object_name")
        if not isinstance(name, str) or name not in target_by_name:
            _fail("invalid_affected_contract", "Affected table name is invalid")
        if row.get("contract") != target_by_name[name]:
            _fail("invalid_affected_contract", f"Affected contract differs from resolved table: {name}")
        if row.get("requested_field_count") != len(target_by_name[name]["fields"]):
            _fail("invalid_affected_contract", f"Affected field count differs: {name}")
        baseline_name = row.get("baseline_object_name")
        baseline_sha = row.get("baseline_table_canonical_sha256")
        if baseline_name is None:
            if row.get("operation") != "ADD_TABLE" or baseline_sha is not None:
                _fail("invalid_affected_contract", f"New table boundary differs: {name}")
        else:
            if baseline_name not in baseline_by_name:
                _fail("invalid_affected_contract", f"Baseline table is absent: {baseline_name}")
            if _canonical_object_sha256(baseline_by_name[baseline_name]) != baseline_sha:
                _fail("invalid_affected_contract", f"Baseline table pin differs: {baseline_name}")
        operation = row.get("operation")
        if operation not in {"ADD_TABLE", "REPLACE_TABLE", "RENAME_AND_REPLACE_TABLE"}:
            _fail("invalid_affected_contract", f"Affected operation is invalid: {name}")
        baseline_fields = (
            {}
            if baseline_name is None
            else {
                field["name"]: field
                for field in baseline_by_name[baseline_name]["fields"]
            }
        )
        target_fields = {
            field["name"]: field for field in target_by_name[name]["fields"]
        }
        table_deltas.append(
            TableDelta(
                object_name=name,
                baseline_object_name=baseline_name,
                operation=operation,
                baseline_table_sha256=baseline_sha,
                target_table_sha256=_canonical_object_sha256(target_by_name[name]),
                added_fields=tuple(sorted(target_fields.keys() - baseline_fields.keys())),
                removed_fields=tuple(sorted(baseline_fields.keys() - target_fields.keys())),
                changed_fields=tuple(
                    sorted(
                        field_name
                        for field_name in baseline_fields.keys() & target_fields.keys()
                        if baseline_fields[field_name] != target_fields[field_name]
                    )
                ),
            )
        )
        affected_names.append(name)
    if len(affected_names) != len(set(affected_names)):
        _fail("invalid_affected_contract", "Affected table names are not unique")

    target_fks = _active_foreign_keys(target_tables)
    baseline_fks = _active_foreign_keys(baseline_tables)
    signed_target_fks = tuple(design_catalog.get("active_foreign_keys", ()))
    if target_fks != signed_target_fks:
        _fail("design_catalog_drift", "Recomputed target FK set differs from signed design catalog")
    target_fk_map = {_foreign_key_key(row): row for row in target_fks}
    baseline_fk_map = {_foreign_key_key(row): row for row in baseline_fks}
    added_fks = tuple(target_fk_map[key] for key in sorted(target_fk_map.keys() - baseline_fk_map.keys()))
    removed_fks = tuple(baseline_fk_map[key] for key in sorted(baseline_fk_map.keys() - target_fk_map.keys()))

    target_indexes = _support_indexes(target_tables, target_fks)
    signed_target_indexes = tuple(design_catalog.get("foreign_key_support_indexes", ()))
    if target_indexes != signed_target_indexes:
        _fail("design_catalog_drift", "Recomputed target support index set differs from signed catalog")
    baseline_indexes = _support_indexes(baseline_tables, baseline_fks)
    target_index_map = {_index_key(row): row for row in target_indexes}
    baseline_index_map = {_index_key(row): row for row in baseline_indexes}
    added_indexes = tuple(
        target_index_map[key] for key in sorted(target_index_map.keys() - baseline_index_map.keys())
    )
    removed_indexes = tuple(
        baseline_index_map[key] for key in sorted(baseline_index_map.keys() - target_index_map.keys())
    )

    counts = _target_counts(target_tables, target_fks, target_indexes)
    subtypes = _unique_subtypes(target_tables)
    if counts != EXPECTED_TARGET_COUNTS:
        _fail("target_count_drift", "Target counts differ from approved assertions", actual=counts)
    if subtypes != EXPECTED_UNIQUE_SUBTYPES:
        _fail("target_unique_drift", "Target unique subtypes differ", actual=subtypes)
    signed_count_projection = {
        "tables": counts["tables"],
        "columns": counts["columns"],
        "primary_keys": counts["primary_keys"],
        "unique_constraints": counts["unique_constraints"],
        "check_constraints": counts["checks"],
        "exclusion_constraints": counts["exclusions"],
        "active_foreign_keys": counts["foreign_keys"],
        "foreign_key_support_indexes": counts["foreign_key_indexes"],
        "catalog_total_indexes": counts["catalog_total_indexes"],
        "table_comments": counts["table_comments"],
        "column_comments": counts["column_comments"],
        "constraint_comments": counts["constraint_comments"],
        "index_comments": counts["index_comments"],
        "sql_views": counts["sql_views"],
    }
    if design_catalog.get("counts") != signed_count_projection:
        _fail("design_catalog_drift", "Signed design counts differ from recomputation")
    if design_catalog.get("unique_constraint_subtypes") != subtypes:
        _fail("design_catalog_drift", "Signed unique subtypes differ from recomputation")

    if (len(added_fks), len(removed_fks)) != (53, 10):
        _fail("foreign_key_delta_drift", "FK diff is not target-only 53 / baseline-only 10")
    if (len(added_indexes), len(removed_indexes)) != (50, 8):
        _fail("support_index_delta_drift", "Support-index diff is not 50 / 8")

    new_tables = tuple(
        sorted(
            row["object_name"]
            for row in affected
            if row["operation"] == "ADD_TABLE"
        )
    )
    if len(new_tables) != 5:
        _fail("new_table_drift", "Target does not add exactly five core tables")
    physical_name_additions = set(target_by_name) - set(baseline_by_name)
    physical_name_removals = set(baseline_by_name) - set(target_by_name)
    if physical_name_additions != set(new_tables) | {
        "cost_card_material_cost_selection",
        "scm_material_price_observation",
    } or physical_name_removals != {
        "cost_card_material_price",
        "scm_supplier_price_observation",
    }:
        _fail("rename_boundary_drift", "Target table add/remove boundary is not exact")
    return AmendmentPlan(
        baseline_tables=baseline_tables,
        target_tables=target_tables,
        affected_tables=tuple(target_by_name[name] for name in sorted(affected_names)),
        table_deltas=tuple(sorted(table_deltas, key=lambda row: row.object_name)),
        new_tables=new_tables,
        semantic_rebuilds=SEMANTIC_REBUILDS,
        surgical_alters=SURGICAL_ALTERS,
        target_foreign_keys=target_fks,
        added_foreign_keys=added_fks,
        removed_foreign_keys=removed_fks,
        target_support_indexes=target_indexes,
        added_support_indexes=added_indexes,
        removed_support_indexes=removed_indexes,
        target_counts=counts,
        unique_subtypes=subtypes,
    )


def build_input_manifest(inputs: InputByteSnapshot | None = None) -> dict[str, Any]:
    if inputs is None:
        inputs = capture_input_bytes()
    pins = verify_frozen_inputs(inputs)
    return {
        **pins,
        "compiler_sha256": _sha256(inputs.read(Path(__file__))),
        "bootstrap_sha256": _sha256(inputs.read(BOOTSTRAP_SOURCE_PATH)),
        "compiler_execution_binding": "BOOTSTRAP_COMPILE_EXEC_EXACT_BYTES",
        "bootstrap_trust_boundary": "LOCAL_SERIALIZED_WRITER_TRUST_ROOT",
        "apply_runner_sha256": _sha256(inputs.read(APPLY_SOURCE_PATH)),
        "catalog_compiler_sha256": _sha256(inputs.read(CATALOG_SOURCE_PATH)),
        "trigger_contract_sha256": _sha256(inputs.read(TRIGGER_CONTRACT_PATH)),
    }


def build_candidate_manifest_skeleton(
    inputs: InputByteSnapshot | None = None,
) -> dict[str, Any]:
    """Return a closed, explicitly unsealed candidate boundary."""

    if inputs is None:
        inputs = capture_input_bytes()
    plan = build_amendment_plan(inputs)
    trigger_contract = load_trigger_contract(inputs)
    return {
        "manifest_version": 1,
        "artifact_kind": "R6A1_AMENDMENT_CANDIDATE_MANIFEST_SKELETON",
        "compiler_version": COMPILER_VERSION,
        "migration": {
            "repository_code": REPOSITORY_CODE,
            "migration_version": MIGRATION_VERSION,
            "filename": MIGRATION_FILENAME,
            "predecessor_payload_sha256": EXPECTED_HASHES[
                "baseline_phase1_payload_sha256"
            ],
        },
        "release_status": "BLOCKED_TRIGGER_CONTRACT_NOT_APPROVED",
        "apply_compatibility": "NOT_APPLY_COMPATIBLE",
        "trigger_contract_status": trigger_contract["exact_inventory_status"],
        "target_pg_catalog_sha256": None,
        "design_catalog_sha256": EXPECTED_HASHES["design_catalog_sha256"],
        "inputs": build_input_manifest(inputs),
        "target_counts": dict(plan.target_counts),
        "unique_constraint_subtypes": dict(plan.unique_subtypes),
        "foreign_key_contract": {
            "full_target_count": len(plan.target_foreign_keys),
            "target_only_count": len(plan.added_foreign_keys),
            "baseline_only_count": len(plan.removed_foreign_keys),
            "net_delta": plan.foreign_key_net_delta,
        },
        "support_index_contract": {
            "full_target_count": len(plan.target_support_indexes),
            "target_only_count": len(plan.added_support_indexes),
            "baseline_only_count": len(plan.removed_support_indexes),
            "net_delta": plan.support_index_net_delta,
        },
        "payloads": [],
    }


def build_candidate_bundle(
    inputs: InputByteSnapshot | None = None,
) -> dict[str, bytes]:
    if inputs is None:
        inputs = capture_input_bytes()
    build_amendment_plan(inputs)
    trigger_contract = load_trigger_contract(inputs)
    if (
        trigger_contract["exact_inventory_status"] != "APPROVED_EXACT"
        or not trigger_contract["trigger_rows"]
        or not trigger_contract["functions"]
    ):
        _fail(
            "trigger_contract_not_approved",
            "Constraint-trigger row inventory is not approved; candidate DDL remains blocked",
        )
    _fail("compiler_incomplete", "DDL rendering is not implemented yet")


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Compile the local-only R6A1 amendment")
    parser.add_argument("action", choices=("check", "generate"))
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _argument_parser().parse_args(argv)
    try:
        if not isinstance(BOUND_COMPILER_SOURCE_BYTES, bytes):
            _fail(
                "unbound_compiler_source",
                "Run amendment_bootstrap.py so executed compiler bytes are bound",
            )
        inputs = capture_input_bytes()
        build_amendment_plan(inputs)
        build_candidate_bundle(inputs)
    except CompilerContractError as exc:
        print(f"ERROR {exc.code}: {exc}", file=sys.stderr)
        return 2
    print(f"{args.action.upper()} amendment candidate")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
