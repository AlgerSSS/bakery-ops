#!/usr/bin/env python3
"""Closed catalog-capture schema for the R6A1 amendment.

This module deliberately does not claim to contain a PostgreSQL catalog
contract.  The frozen R6A1 catalog is model-derived design evidence only.  A
physical contract can be sealed only after the exact constraint-trigger
inventory is approved, compiled, and captured identically from two local
PostgreSQL 17.6 candidates.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from typing import Any, Mapping

import amendment_bootstrap


compiler = amendment_bootstrap.load_compiler()


CAPTURE_SCHEMA_VERSION = "R6A1_PG_CATALOG_CAPTURE_SCHEMA_V1"
PHYSICAL_CAPTURE_STATUS = "BLOCKED_TRIGGER_CONTRACT_NOT_APPROVED"
REQUIRED_CATALOG_SECTIONS = (
    "server",
    "extensions",
    "roles",
    "role_memberships",
    "tables",
    "columns",
    "constraints",
    "indexes",
    "policies",
    "triggers",
    "routines",
    "rules",
    "table_acl",
    "column_acl",
    "schema_acl",
    "default_acl",
    "function_acl",
    "effective_privileges",
)
PHYSICAL_PROPERTY_CONTRACT = {
    "tables": (
        "schema",
        "name",
        "owner",
        "kind",
        "persistence",
        "options",
        "rls_enabled",
        "rls_forced",
        "comment",
    ),
    "columns": (
        "table_name",
        "ordinal",
        "name",
        "type_schema",
        "type_name",
        "formatted_type",
        "type_modifier",
        "array_dimensions",
        "collation",
        "not_null",
        "has_default",
        "default_expression",
        "identity_kind",
        "generated_kind",
        "comment",
    ),
    "constraints": (
        "table_name",
        "name",
        "type",
        "definition",
        "columns",
        "referenced_table",
        "referenced_columns",
        "backing_index",
        "deferrable",
        "initially_deferred",
        "validated",
        "match_type",
        "update_action",
        "delete_action",
        "comment",
        "linked_trigger_name",
    ),
    "indexes": (
        "check_xmin",
        "clustered",
        "comment",
        "constraint_name",
        "definition",
        "immediate",
        "is_exclusion",
        "is_primary",
        "is_unique",
        "key_attribute_count",
        "live",
        "method",
        "name",
        "nulls_not_distinct",
        "owner",
        "ready",
        "replica_identity",
        "table_name",
        "total_attribute_count",
        "valid",
    ),
    "policies": (
        "table_name",
        "name",
        "command",
        "permissive",
        "roles",
        "using_expression",
        "check_expression",
    ),
    "triggers": (
        "schema",
        "table_name",
        "name",
        "function_identity",
        "type_mask",
        "enabled",
        "is_internal",
        "is_constraint",
        "constraint_name",
        "constraint_type",
        "deferrable",
        "initially_deferred",
        "referenced_table",
        "referenced_index",
        "update_columns",
        "when_expression",
        "old_transition_table",
        "new_transition_table",
        "argument_count",
        "definition",
        "comment",
    ),
    "routines": (
        "origin",
        "identity",
        "default_argument_count",
        "argument_types",
        "all_argument_types",
        "argument_names",
        "argument_modes",
        "schema",
        "name",
        "identity_arguments",
        "result",
        "kind",
        "language",
        "volatility",
        "parallel",
        "strict",
        "security_definer",
        "leakproof",
        "returns_set",
        "owner",
        "config",
        "definition",
        "comment",
    ),
    "rules": (
        "schema",
        "table_name",
        "name",
        "event",
        "instead",
        "enabled",
        "definition",
        "comment",
    ),
    "table_acl": (
        "table_name",
        "grantee",
        "grantor",
        "privilege",
        "is_grantable",
    ),
    "column_acl": (
        "table_name",
        "column_name",
        "grantee",
        "grantor",
        "privilege",
        "is_grantable",
    ),
    "schema_acl": (
        "schema_name",
        "grantee",
        "grantor",
        "is_grantable",
        "privilege",
    ),
    "function_acl": (
        "function_identity",
        "grantee",
        "grantor",
        "privilege",
        "is_grantable",
    ),
}
SECTION_SCHEMA_CONTRACT = {
    "server": {"kind": "object", "keys": ("server_version_num",)},
    "extensions": {"kind": "rows", "keys": ("name", "schema")},
    "roles": {
        "kind": "rows",
        "keys": (
            "name",
            "superuser",
            "inherit",
            "create_role",
            "create_database",
            "login",
            "replication",
            "bypass_rls",
            "connection_limit",
            "valid_until",
            "config",
        ),
    },
    "role_memberships": {
        "kind": "rows",
        "keys": (
            "granted_role",
            "member_role",
            "grantor",
            "admin_option",
            "inherit_option",
            "set_option",
        ),
    },
    **{
        name: {"kind": "rows", "keys": keys}
        for name, keys in PHYSICAL_PROPERTY_CONTRACT.items()
    },
    "default_acl": {
        "kind": "nested_rows",
        "keys": {
            "headers": ("owner", "schema", "object_type"),
            "entries": (
                "owner",
                "schema",
                "object_type",
                "grantee",
                "grantor",
                "privilege",
                "is_grantable",
            ),
        },
    },
    "effective_privileges": {
        "kind": "nested_rows",
        "keys": {
            "schema_privileges": ("grantee", "usage", "create"),
            "forbidden_table": ("table_name", "grantee", "privilege"),
            "forbidden_column": (
                "table_name",
                "column_name",
                "grantee",
                "privilege",
            ),
            "routine_execute": ("function_identity", "grantee", "privilege"),
        },
    },
}
SHA256_RE = re.compile(r"[0-9a-f]{64}")
PHYSICAL_CAPTURE_RECEIPT_FIELDS = (
    "candidate_label",
    "candidate_system_identifier",
    "postgres_image",
    "repo_digest",
    "server_version_num",
    "resolved_model_sha256",
    "amendment_payload_sha256",
    "trigger_contract_sha256",
    "catalog_schema_version",
    "catalog_sha256",
)
ACL_CAPTURE_CONTRACT = {
    "schema_acl_requires_grantor": True,
    "default_acl_owner_scope": ["postgres"],
    "default_acl_namespace_scope": [None, "public"],
    "default_acl_object_types": ["S", "f", "r"],
    "fresh_postgres_owner_capture_required": True,
    "baseline_default_acl_rows_are_physical_evidence": False,
    "preserve_headers_without_entries": True,
    "explode_entries": True,
}
PUBLIC_OBJECT_CAPTURE_CONTRACT = {
    "schema": "public",
    "relation_relkinds": ["S", "f", "m", "p", "r", "v"],
    "scan_non_extension_relations": True,
    "scan_non_extension_routines": True,
    "extension_membership": {
        "classid": ["pg_class", "pg_proc"],
        "refclassid": "pg_extension",
        "deptype": "e",
        "objsubid": 0,
    },
    "unknown_extra_policy": "FAIL_CLOSED",
    "expected_managed_extension_owned_policy": "FAIL_CLOSED",
    "managed_table_trigger_policy": "NEVER_EXTENSION_FILTER",
}
CAPTURE_TRANSACTION_CONTRACT = {
    "transaction_mode": "REPEATABLE READ READ ONLY",
    "set_local": {
        "search_path": "pg_catalog, pg_temp",
        "TimeZone": "UTC",
        "DateStyle": "ISO, YMD",
        "IntervalStyle": "postgres",
        "quote_all_identifiers": "off",
        "standard_conforming_strings": "on",
    },
    "public_extension_references": "SCHEMA_QUALIFIED_ONLY",
}
NEW_EXCLUSION_NAMES = {
    "cost_card_material_cost_selection": (
        "ex_cost_card_material_cost_selection__verified_period"
    ),
    "finance_currency_assignment": "ex_finance_currency_assignment__approved_period",
    "finance_currency_policy": "ex_finance_currency_policy__approved_period",
}


class CatalogContractError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _baseline_catalog(inputs: compiler.InputByteSnapshot) -> dict[str, Any]:
    return compiler._parse_json(
        inputs.read(compiler.BASELINE_CATALOG_PATH), label="baseline catalog"
    )


def _physical_type(data_type: str) -> dict[str, Any]:
    if data_type.startswith("numeric("):
        precision, scale = (
            int(value) for value in data_type.removeprefix("numeric(").removesuffix(")").split(",")
        )
        return {
            "type_schema": "pg_catalog",
            "type_name": "numeric",
            "formatted_type": data_type,
            "type_modifier": ((precision << 16) | scale) + 4,
            "array_dimensions": 0,
            "collation": None,
        }
    if data_type.startswith("char("):
        length = int(data_type.removeprefix("char(").removesuffix(")"))
        return {
            "type_schema": "pg_catalog",
            "type_name": "bpchar",
            "formatted_type": f"character({length})",
            "type_modifier": length + 4,
            "array_dimensions": 0,
            "collation": "pg_catalog.default",
        }
    mapping = {
        "bigint": ("pg_catalog", "int8", "bigint", -1, 0, None),
        "boolean": ("pg_catalog", "bool", "boolean", -1, 0, None),
        "bytea": ("pg_catalog", "bytea", "bytea", -1, 0, None),
        "citext": ("extensions", "citext", "citext", -1, 0, "pg_catalog.default"),
        "date": ("pg_catalog", "date", "date", -1, 0, None),
        "inet": ("pg_catalog", "inet", "inet", -1, 0, None),
        "integer": ("pg_catalog", "int4", "integer", -1, 0, None),
        "jsonb": ("pg_catalog", "jsonb", "jsonb", -1, 0, None),
        "smallint": ("pg_catalog", "int2", "smallint", -1, 0, None),
        "text": ("pg_catalog", "text", "text", -1, 0, "pg_catalog.default"),
        "text[]": ("pg_catalog", "_text", "text[]", -1, 1, "pg_catalog.default"),
        "time": ("pg_catalog", "time", "time without time zone", -1, 0, None),
        "timestamptz": (
            "pg_catalog",
            "timestamptz",
            "timestamp with time zone",
            -1,
            0,
            None,
        ),
        "uuid": ("pg_catalog", "uuid", "uuid", -1, 0, None),
    }
    try:
        schema, name, formatted, modifier, dimensions, collation = mapping[data_type]
    except KeyError:
        raise CatalogContractError(
            "catalog_derivation_failed", f"Unknown physical type: {data_type}"
        ) from None
    return {
        "type_schema": schema,
        "type_name": name,
        "formatted_type": formatted,
        "type_modifier": modifier,
        "array_dimensions": dimensions,
        "collation": collation,
    }


def _physical_default(data_type: str, value: Any) -> str | None:
    if value is None:
        return None
    rendered = str(value)
    if rendered.startswith("'") and rendered.endswith("'"):
        if data_type == "text":
            return f"{rendered}::text"
        if data_type.startswith("char("):
            return f"{rendered}::bpchar"
    return rendered


def _column_rows(plan: compiler.AmendmentPlan) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for table in plan.target_tables:
        for ordinal, field in enumerate(table["fields"], start=1):
            data_type = field["data_type"]
            rows.append(
                {
                    "table_name": table["name"],
                    "ordinal": ordinal,
                    "name": field["name"],
                    **_physical_type(data_type),
                    "not_null": not field["nullable"],
                    "has_default": field["default"] is not None,
                    "default_expression": _physical_default(
                        data_type, field["default"]
                    ),
                    "identity_kind": "",
                    "generated_kind": "",
                    "comment": _field_comment(table, field),
                }
            )
    return rows


def _stable_name(prefix: str, table: str, parts: list[str]) -> str:
    suffix = "__".join(parts)
    raw = f"{prefix}_{table}" + (f"__{suffix}" if suffix else "")
    if len(raw) <= 63:
        return raw
    digest = hashlib.sha256(raw.encode("ascii")).hexdigest()[:10]
    return f"{raw[:52]}_{digest}"


def _pk_name(table: Mapping[str, Any]) -> str:
    columns = [field["name"] for field in table["fields"] if field["pk"]]
    return _stable_name("pk", table["name"], columns)


def _unique_name(table: Mapping[str, Any], columns: list[str]) -> str:
    return _stable_name("uq", table["name"], columns)


def _check_name(table: str, scope: str, ordinal: int) -> str:
    return _stable_name("ck", table, [scope.removeprefix("field:"), f"{ordinal:02d}"])


def _fk_name(edge: Mapping[str, Any]) -> str:
    return _stable_name(
        "fk", edge["table"], [*edge["columns"], edge["ref_table"]]
    )


def _support_index_name(row: Mapping[str, Any]) -> str:
    return _stable_name("ix", row["table"], [*row["columns"], "fk"])


def _baseline_exclusion_names(
    inputs: compiler.InputByteSnapshot,
) -> dict[tuple[str, str], str]:
    manifest = compiler._parse_json(
        inputs.read(compiler.BASELINE_MANIFEST_PATH), label="baseline manifest"
    )
    return {
        (row["table"], row["symbolic"]): row["constraint_name"]
        for row in manifest["exclusions"]
    }


def _exclusion_name(
    table: str,
    symbolic: str,
    baseline_names: Mapping[tuple[str, str], str],
) -> str:
    existing = baseline_names.get((table, symbolic))
    if existing is not None:
        return existing
    expected = NEW_EXCLUSION_NAMES.get(table)
    if expected is None:
        raise CatalogContractError(
            "catalog_derivation_failed", f"Unknown target exclusion on {table}"
        )
    return expected


def _business_constraint_rows(
    plan: compiler.AmendmentPlan,
    inputs: compiler.InputByteSnapshot,
) -> list[dict[str, Any]]:
    baseline_exclusions = _baseline_exclusion_names(inputs)
    rows: list[dict[str, Any]] = []
    for table in plan.target_tables:
        pk_columns = [field["name"] for field in table["fields"] if field["pk"]]
        rows.append(
            {
                "table": table["name"],
                "name": _pk_name(table),
                "type": "p",
                "columns": pk_columns,
                "definition": "PRIMARY_KEY",
                "null_policy": None,
                "referenced_table": None,
                "referenced_columns": [],
            }
        )
        nnd = {tuple(group) for group in table["nulls_not_distinct_uniques"]}
        nd = {tuple(group) for group in table["nulls_distinct_uniques"]}
        for columns in table["uniques"]:
            key = tuple(columns)
            null_policy = (
                "NULLS_NOT_DISTINCT"
                if key in nnd
                else "NULLS_DISTINCT"
                if key in nd
                else "ORDINARY"
            )
            rows.append(
                {
                    "table": table["name"],
                    "name": _unique_name(table, columns),
                    "type": "u",
                    "columns": list(columns),
                    "definition": "UNIQUE",
                    "null_policy": null_policy,
                    "referenced_table": None,
                    "referenced_columns": [],
                }
            )
        for ordinal, expression in enumerate(table["checks"], start=1):
            rows.append(
                {
                    "table": table["name"],
                    "name": _check_name(table["name"], "table", ordinal),
                    "type": "c",
                    "columns": [],
                    "definition": expression,
                    "null_policy": None,
                    "referenced_table": None,
                    "referenced_columns": [],
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
                        "type": "c",
                        "columns": [field["name"]],
                        "definition": expression,
                        "null_policy": None,
                        "referenced_table": None,
                        "referenced_columns": [],
                    }
                )
        for symbolic in table["exclusions"]:
            rows.append(
                {
                    "table": table["name"],
                    "name": _exclusion_name(
                        table["name"], symbolic, baseline_exclusions
                    ),
                    "type": "x",
                    "columns": [],
                    "definition": symbolic,
                    "null_policy": None,
                    "referenced_table": None,
                    "referenced_columns": [],
                }
            )
    for edge in plan.target_foreign_keys:
        rows.append(
            {
                "table": edge["table"],
                "name": _fk_name(edge),
                "type": "f",
                "columns": list(edge["columns"]),
                "definition": f"MATCH_{edge['match_type']}_DEFERRABLE",
                "null_policy": None,
                "referenced_table": edge["ref_table"],
                "referenced_columns": list(edge["ref_columns"]),
            }
        )
    if len(rows) != 973:
        raise CatalogContractError(
            "catalog_derivation_failed", "Business constraint inventory is not 973"
        )
    referenced_indexes = {
        (row["table"], tuple(row["columns"])): row["name"]
        for row in rows
        if row["type"] in {"p", "u"}
    }
    physical: list[dict[str, Any]] = []
    for row in rows:
        constraint_type = row["type"]
        backing_index = None
        if constraint_type in {"p", "u", "x"}:
            backing_index = row["name"]
        elif constraint_type == "f":
            backing_index = referenced_indexes.get(
                (row["referenced_table"], tuple(row["referenced_columns"]))
            )
            if backing_index is None:
                raise CatalogContractError(
                    "catalog_derivation_failed",
                    f"Referenced backing index is missing for {row['name']}",
                )
        physical.append(
            {
                "table_name": row["table"],
                "name": row["name"],
                "type": constraint_type,
                "definition": row["definition"],
                "columns": list(row["columns"]),
                "referenced_table": row["referenced_table"],
                "referenced_columns": list(row["referenced_columns"]),
                "backing_index": backing_index,
                "deferrable": constraint_type in {"f", "x"},
                "initially_deferred": False,
                "validated": True,
                "match_type": (
                    str(row["definition"])
                    .removeprefix("MATCH_")
                    .removesuffix("_DEFERRABLE")[:1]
                    .lower()
                    if constraint_type == "f"
                    else " "
                ),
                "update_action": "a" if constraint_type == "f" else " ",
                "delete_action": "a" if constraint_type == "f" else " ",
                "comment": (
                    f"R6A1 model-derived {constraint_type} constraint: "
                    f"{row['definition']}"
                ),
                "linked_trigger_name": None,
            }
        )
    physical.sort(
        key=lambda row: (row["table_name"], row["type"], row["name"])
    )
    return physical


def _index_rows(
    plan: compiler.AmendmentPlan,
    constraints: list[dict[str, Any]],
    inputs: compiler.InputByteSnapshot,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    baseline = _baseline_catalog(inputs)
    baseline_indexes = {
        (row["table_name"], row["name"]): row for row in baseline["indexes"]
    }
    nulls_not_distinct = {
        (table["name"], tuple(group))
        for table in plan.target_tables
        for group in table["nulls_not_distinct_uniques"]
    }
    logical_rows = [
        {
            "table_name": row["table_name"],
            "name": row["name"],
            "type": row["type"],
            "columns": list(row["columns"]),
            "constraint_name": row["name"],
        }
        for row in constraints
        if row["type"] in {"p", "u", "x"}
    ]
    logical_support = [
        {
            "table_name": row["table"],
            "name": _support_index_name(row),
            "type": "support",
            "columns": list(row["columns"]),
            "constraint_name": None,
        }
        for row in plan.target_support_indexes
    ]
    logical_rows.extend(copy.deepcopy(logical_support))
    rows: list[dict[str, Any]] = []
    support_names = {
        (row["table_name"], row["name"]) for row in logical_support
    }
    for logical in logical_rows:
        table_name = logical["table_name"]
        name = logical["name"]
        columns = logical["columns"]
        constraint_type = logical["type"]
        previous = baseline_indexes.get((table_name, name), {})
        is_exclusion = constraint_type == "x"
        is_primary = constraint_type == "p"
        is_unique = constraint_type in {"p", "u"}
        method = "gist" if is_exclusion else "btree"
        nnd = (table_name, tuple(columns)) in nulls_not_distinct
        if previous:
            definition = previous["definition"]
        elif is_exclusion:
            definition = f"R6A1 EXCLUSION BACKING INDEX {name}"
        else:
            unique = "UNIQUE " if is_unique else ""
            rendered_columns = ", ".join(columns)
            definition = (
                f"CREATE {unique}INDEX {name} ON public.{table_name} "
                f"USING btree ({rendered_columns})"
                + (" NULLS NOT DISTINCT" if nnd else "")
            )
        key_count = int(previous.get("key_attribute_count", len(columns)))
        row = {
            "check_xmin": False,
            "clustered": False,
            "comment": (
                "Btree support index for active FK columns "
                + ", ".join(columns)
                + "."
                if (table_name, name) in support_names
                else None
            ),
            "constraint_name": logical["constraint_name"],
            "definition": definition,
            "immediate": True,
            "is_exclusion": is_exclusion,
            "is_primary": is_primary,
            "is_unique": is_unique,
            "key_attribute_count": key_count,
            "live": True,
            "method": method,
            "name": name,
            "nulls_not_distinct": nnd,
            "owner": "postgres",
            "ready": True,
            "replica_identity": False,
            "table_name": table_name,
            "total_attribute_count": int(
                previous.get("total_attribute_count", key_count)
            ),
            "valid": True,
        }
        rows.append(row)
    rows.sort(key=lambda row: (row["table_name"], row["name"]))
    support = [
        copy.deepcopy(row)
        for row in rows
        if (row["table_name"], row["name"]) in support_names
    ]
    if len(rows) != 504 or len(support) != 266:
        raise CatalogContractError(
            "catalog_derivation_failed", "Index inventory is not 504/266"
        )
    return rows, support


def _table_comment(table: Mapping[str, Any]) -> str:
    return (
        f"{table['zh_name']}。用途：{table['purpose']}；粒度：{table['grain']}；"
        f"写入者：{table['writer']}；来源：{table['source']}。"
    )


def _field_comment(table: Mapping[str, Any], field: Mapping[str, Any]) -> str:
    return (
        f"{field['zh_name']}。{field['description']}；用途：{field['purpose']}；"
        f"类型：{field['data_type']}；示例：{field['example']}。"
    )


def _comment_rows(
    plan: compiler.AmendmentPlan,
    constraints: list[dict[str, Any]],
    support_indexes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for table in plan.target_tables:
        rows.append(
            {
                "object_type": "TABLE",
                "table": table["name"],
                "name": table["name"],
                "text": _table_comment(table),
            }
        )
        for field in table["fields"]:
            rows.append(
                {
                    "object_type": "COLUMN",
                    "table": table["name"],
                    "name": field["name"],
                    "text": _field_comment(table, field),
                }
            )
    for row in constraints:
        rows.append(
            {
                "object_type": "CONSTRAINT",
                "table": row["table_name"],
                "name": row["name"],
                "text": row["comment"],
            }
        )
    for row in support_indexes:
        rows.append(
            {
                "object_type": "INDEX",
                "table": row["table_name"],
                "name": row["name"],
                "text": row["comment"],
            }
        )
    rows.sort(key=lambda row: (row["object_type"], row["table"], row["name"]))
    if len(rows) != 2813 or any(not row["text"].strip() for row in rows):
        raise CatalogContractError(
            "catalog_derivation_failed", "Comment inventory is not exact and complete"
        )
    return rows


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


_SECTION_SORT_FIELDS = {
    "extensions": ("name", "schema"),
    "roles": ("name",),
    "role_memberships": (
        "granted_role",
        "member_role",
        "grantor",
        "admin_option",
        "inherit_option",
        "set_option",
    ),
    "tables": ("schema", "name"),
    "columns": ("table_name", "ordinal", "name"),
    "constraints": ("table_name", "name", "type"),
    "indexes": ("table_name", "name"),
    "policies": ("table_name", "name"),
    "triggers": ("table_name", "name"),
    "routines": ("identity",),
    "rules": ("table_name", "name"),
    "table_acl": ("table_name", "grantee", "privilege", "grantor"),
    "column_acl": (
        "table_name",
        "column_name",
        "grantee",
        "privilege",
        "grantor",
    ),
    "schema_acl": ("schema_name", "grantee", "privilege", "grantor"),
    "function_acl": ("function_identity", "grantee", "privilege", "grantor"),
}
_NESTED_SECTION_SORT_FIELDS = {
    ("default_acl", "headers"): ("owner", "schema", "object_type"),
    ("default_acl", "entries"): (
        "owner",
        "schema",
        "object_type",
        "grantee",
        "privilege",
        "grantor",
        "is_grantable",
    ),
    ("effective_privileges", "schema_privileges"): ("grantee",),
    ("effective_privileges", "forbidden_table"): (
        "table_name",
        "grantee",
        "privilege",
    ),
    ("effective_privileges", "forbidden_column"): (
        "table_name",
        "column_name",
        "grantee",
        "privilege",
    ),
    ("effective_privileges", "routine_execute"): (
        "function_identity",
        "grantee",
        "privilege",
    ),
}


def _c_sort_value(value: Any) -> tuple[str, bytes]:
    if isinstance(value, int) and not isinstance(value, bool):
        return "0-int", str(value).zfill(20).encode("ascii")
    return f"1-{type(value).__name__}", str(value).encode("utf-8")


def _row_sort_key(section: str, row: Mapping[str, Any]) -> tuple[Any, ...]:
    fields = _SECTION_SORT_FIELDS.get(section)
    if fields is None:
        return (_canonical_bytes(row),)
    return tuple(_c_sort_value(row.get(field)) for field in fields)


def _nested_row_sort_key(
    section: str, group: str, row: Mapping[str, Any]
) -> tuple[Any, ...]:
    fields = _NESTED_SECTION_SORT_FIELDS[(section, group)]
    return tuple(_c_sort_value(row.get(field)) for field in fields)


def canonicalize_capture_schema(contract: Mapping[str, Any]) -> dict[str, Any]:
    """Return the stable COLLATE-C-equivalent representation used for hashing."""

    canonical = copy.deepcopy(dict(contract))
    sections = canonical.get("sections")
    if isinstance(sections, dict):
        for section, value in sections.items():
            if isinstance(value, list):
                value.sort(key=lambda row: _row_sort_key(section, row))
            elif section in {"default_acl", "effective_privileges"} and isinstance(
                value, dict
            ):
                for group, rows in value.items():
                    if isinstance(rows, list):
                        rows.sort(
                            key=lambda row, section=section, group=group: (
                                _nested_row_sort_key(section, group, row)
                            )
                        )
    for key in (
        "tables",
        "columns",
        "active_foreign_keys",
        "foreign_key_support_indexes",
        "comments",
    ):
        rows = canonical.get(key)
        if isinstance(rows, list):
            rows.sort(key=_canonical_bytes)
    return json.loads(_canonical_bytes(canonical).decode("utf-8"))


def canonical_capture_bytes(contract: Mapping[str, Any]) -> bytes:
    return _canonical_bytes(canonicalize_capture_schema(contract))


_FINGERPRINT_PAYLOAD_KEYS = (
    "schema_version",
    "revision_id",
    "physical_fingerprint_binding",
    "required_catalog_sections",
    "physical_property_contract",
    "section_schema_contract",
    "acl_capture_contract",
    "public_object_capture_contract",
    "capture_transaction_contract",
    "sections",
)


def catalog_fingerprint_payload(contract: Mapping[str, Any]) -> dict[str, Any]:
    """Return the non-self-referential physical catalog fingerprint payload."""

    canonical = canonicalize_capture_schema(contract)
    if any(key not in canonical for key in _FINGERPRINT_PAYLOAD_KEYS):
        raise CatalogContractError(
            "catalog_contract_drift", "Catalog fingerprint binding is incomplete"
        )
    payload = {
        key: copy.deepcopy(canonical[key]) for key in _FINGERPRINT_PAYLOAD_KEYS
    }
    return payload


def catalog_fingerprint_sha256(contract: Mapping[str, Any]) -> str:
    return hashlib.sha256(_canonical_bytes(catalog_fingerprint_payload(contract))).hexdigest()


def parse_canonical_capture_bytes(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(
            raw.decode("utf-8"), object_pairs_hook=compiler._duplicate_key_guard
        )
    except compiler.CompilerContractError as exc:
        raise CatalogContractError("duplicate_json_key", str(exc)) from None
    except Exception:
        raise CatalogContractError("invalid_catalog_json", "Catalog JSON is invalid") from None
    if not isinstance(value, dict):
        raise CatalogContractError("invalid_catalog_json", "Catalog root is not an object")
    canonical = canonicalize_capture_schema(value)
    if raw != _canonical_bytes(canonical):
        raise CatalogContractError(
            "noncanonical_catalog_json", "Catalog JSON bytes are not canonical"
        )
    validate_capture_schema(canonical)
    return canonical


def _build_capture_schema() -> dict[str, Any]:
    inputs = compiler.capture_input_bytes()
    plan = compiler.build_amendment_plan(inputs)
    baseline_catalog = _baseline_catalog(inputs)
    trigger_contract = compiler.load_trigger_contract(inputs)
    release_boundary = compiler.build_candidate_manifest_skeleton(inputs)
    table_rows = [
        {
            "schema": "public",
            "name": table["name"],
            "owner": "postgres",
            "kind": "r",
            "persistence": "p",
            "options": None,
            "rls_enabled": True,
            "rls_forced": True,
            "comment": _table_comment(table),
        }
        for table in plan.target_tables
    ]
    column_rows = _column_rows(plan)
    constraint_rows = _business_constraint_rows(plan, inputs)
    index_rows, support_indexes = _index_rows(plan, constraint_rows, inputs)
    comment_rows = _comment_rows(plan, constraint_rows, support_indexes)
    helper_identity = baseline_catalog["scope"]["helper_identity"]
    baseline_functions = [
        {
            "origin": "BASELINE",
            "identity": helper_identity,
            "default_argument_count": 0,
            "argument_types": ["pg_catalog.text"],
            "all_argument_types": None,
            "argument_names": None,
            "argument_modes": None,
            **copy.deepcopy(row),
        }
        for row in baseline_catalog["helper"]
    ]
    function_acl = [
        {"function_identity": helper_identity, **copy.deepcopy(row)}
        for row in baseline_catalog["helper_acl"]
    ]
    baseline_acl = baseline_catalog["acl"]
    sections = {
        "server": copy.deepcopy(baseline_catalog["server"]),
        "extensions": copy.deepcopy(baseline_catalog["extensions"]),
        "roles": copy.deepcopy(baseline_catalog["roles"]),
        "role_memberships": copy.deepcopy(baseline_catalog["memberships"]),
        "tables": table_rows,
        "columns": column_rows,
        "constraints": constraint_rows,
        "indexes": index_rows,
        "policies": [],
        "triggers": [],
        "routines": baseline_functions,
        "rules": [],
        "table_acl": [
            {
                "table_name": row["object_name"],
                **{
                    key: copy.deepcopy(value)
                    for key, value in row.items()
                    if key != "object_name"
                },
            }
            for row in baseline_acl["direct_relation_nonowner"]
        ],
        "column_acl": copy.deepcopy(baseline_acl["direct_column"]),
        "schema_acl": [
            {
                "schema_name": "public",
                "grantee": row["grantee"],
                "grantor": None,
                "privilege": row["privilege"],
                "is_grantable": row["is_grantable"],
            }
            for row in baseline_acl["direct_schema_nonowner"]
        ],
        "default_acl": {
            "headers": copy.deepcopy(baseline_acl["managed_default_acl_headers"]),
            "entries": copy.deepcopy(baseline_acl["managed_default_acl_entries"]),
        },
        "function_acl": function_acl,
        "effective_privileges": {
            "forbidden_column": copy.deepcopy(
                baseline_acl["forbidden_effective_column"]
            ),
            "forbidden_table": copy.deepcopy(
                baseline_acl["forbidden_effective_table"]
            ),
            "routine_execute": [],
            "schema_privileges": copy.deepcopy(
                baseline_acl["schema_privileges"]
            ),
        },
    }
    counts = {
        "tables": plan.target_counts["tables"],
        "columns": plan.target_counts["columns"],
        "business_constraints": plan.target_counts["constraint_comments"],
        "business_constraints_by_type": {
            "p": plan.target_counts["primary_keys"],
            "u": plan.target_counts["unique_constraints"],
            "c": plan.target_counts["checks"],
            "x": plan.target_counts["exclusions"],
            "f": plan.target_counts["foreign_keys"],
        },
        "constraint_triggers": None,
        "indexes": plan.target_counts["catalog_total_indexes"],
        "foreign_key_support_indexes": plan.target_counts["foreign_key_indexes"],
        "sql_views": 0,
        "baseline_functions": len(baseline_functions),
        "r6a1_functions": None,
        "triggers": None,
        "roles": len(sections["roles"]),
        "role_memberships": len(sections["role_memberships"]),
    }
    property_contract = {
        name: list(properties)
        for name, properties in PHYSICAL_PROPERTY_CONTRACT.items()
    }
    managed_public_object_scope = {
        "tables": [table["name"] for table in plan.target_tables],
        "baseline_function_identities": [helper_identity],
        "r6a1_function_identities": [],
        "default_acl_owner_scope": ["postgres"],
        "unknown_public_object_policy": "FAIL_CLOSED",
    }
    contract = {
        "schema_version": CAPTURE_SCHEMA_VERSION,
        "artifact_kind": "PHYSICAL_PG_CATALOG_CAPTURE_SCHEMA_NOT_CAPTURE",
        "revision_id": "R6A1-FX-SIGNED-POS",
        "design_catalog_sha256": compiler.EXPECTED_HASHES["design_catalog_sha256"],
        "target_pg_catalog_sha256": None,
        "physical_capture_status": PHYSICAL_CAPTURE_STATUS,
        "trigger_contract_status": trigger_contract["exact_inventory_status"],
        "required_catalog_sections": list(REQUIRED_CATALOG_SECTIONS),
        "physical_property_contract": property_contract,
        "section_schema_contract": copy.deepcopy(SECTION_SCHEMA_CONTRACT),
        "managed_public_object_scope": managed_public_object_scope,
        "public_object_capture_contract": copy.deepcopy(
            PUBLIC_OBJECT_CAPTURE_CONTRACT
        ),
        "capture_transaction_contract": copy.deepcopy(
            CAPTURE_TRANSACTION_CONTRACT
        ),
        "resolved_model_binding": {
            "current_frozen_resolved_model_sha256": compiler.EXPECTED_HASHES[
                "resolved_model_sha256"
            ],
            "sealable_resolved_model_sha256": None,
            "status": "MODEL_RESEAL_REQUIRED",
            "blocker": "R6A1_OPERATION_RECEIPT_RELATIONAL_IDENTITY_NOT_IN_FROZEN_MODEL",
        },
        "physical_fingerprint_binding": {
            "postgres_image": compiler.PG17_DOCKER_IMAGE,
            "repo_digest": compiler.PG17_DOCKER_REPO_DIGEST,
            "server_version_num": 170006,
            "resolved_model_sha256": compiler.EXPECTED_HASHES[
                "resolved_model_sha256"
            ],
            "amendment_payload_sha256": None,
            "trigger_contract_sha256": release_boundary["inputs"][
                "trigger_contract_sha256"
            ],
            "catalog_schema_version": CAPTURE_SCHEMA_VERSION,
        },
        "physical_capture_seal": {
            "status": "UNSEALED",
            "candidate_a": None,
            "candidate_b": None,
            "agreed_catalog_sha256": None,
        },
        "physical_capture_receipt_contract": list(
            PHYSICAL_CAPTURE_RECEIPT_FIELDS
        ),
        "acl_capture_contract": copy.deepcopy(ACL_CAPTURE_CONTRACT),
        "known_pre_capture_unknowns": [
            "sections.schema_acl[*].grantor",
            "sections.default_acl requires fresh postgres-owner capture",
            "model-derived constraint/index definitions are not pg_get_* capture rows",
        ],
        "unapproved_trigger_slots": {
            "status": "TRIGGER_CONTRACT_NOT_APPROVED",
            "r6a1_routines": [],
            "triggers": [],
            "constraint_rows": [],
            "expected_r6a1_routine_count": None,
            "expected_trigger_count": None,
            "expected_constraint_row_count": None,
        },
        "expected_future_counts": {
            "artifact_kind": "NON_SEALING_PART1_SHAPE_ONLY",
            "triggers": 22,
            "constraint_triggers": 15,
            "regular_triggers": 7,
            "enable_always_triggers": 22,
            "trigger_type_mask_histogram": {"17": 8, "29": 7, "34": 7},
            "r6a1_routines": 27,
            "baseline_routines": 1,
            "total_routines": 28,
        },
        "release_boundary": {
            "release_status": release_boundary["release_status"],
            "apply_compatibility": release_boundary["apply_compatibility"],
            "trigger_contract_status": release_boundary["trigger_contract_status"],
            "design_catalog_sha256": release_boundary["design_catalog_sha256"],
            "target_pg_catalog_sha256": release_boundary["target_pg_catalog_sha256"],
            "target_counts": release_boundary["target_counts"],
            "inputs": copy.deepcopy(release_boundary["inputs"]),
            "amendment_payload_sha256": None,
        },
        "counts": counts,
        "unique_constraint_subtypes": copy.deepcopy(plan.unique_subtypes),
        "sections": sections,
        "tables": copy.deepcopy(table_rows),
        "columns": copy.deepcopy(column_rows),
        "active_foreign_keys": [copy.deepcopy(row) for row in plan.target_foreign_keys],
        "foreign_key_support_indexes": copy.deepcopy(support_indexes),
        "trigger_invariant_families": [],
        "source_invariant_summaries": copy.deepcopy(
            trigger_contract["source_invariant_summaries"]
        ),
        "constraint_triggers": [],
        "baseline_functions": copy.deepcopy(baseline_functions),
        "functions": [],
        "comments": copy.deepcopy(comment_rows),
    }
    return contract


def build_capture_schema() -> dict[str, Any]:
    """Build the closed pre-capture schema from one frozen model boundary."""

    return canonicalize_capture_schema(_build_capture_schema())


def _validate_physical_row_shapes(contract: Mapping[str, Any]) -> None:
    sections = contract.get("sections")
    properties = contract.get("physical_property_contract")
    section_schemas = contract.get("section_schema_contract")
    if (
        not isinstance(sections, Mapping)
        or not isinstance(properties, Mapping)
        or not isinstance(section_schemas, Mapping)
    ):
        raise CatalogContractError(
            "catalog_contract_drift", "Physical catalog shape is missing"
        )
    if _canonical_bytes(section_schemas) != _canonical_bytes(SECTION_SCHEMA_CONTRACT):
        raise CatalogContractError(
            "catalog_contract_drift", "Catalog section schemas differ"
        )
    if set(section_schemas) != set(REQUIRED_CATALOG_SECTIONS):
        raise CatalogContractError(
            "catalog_contract_drift", "Catalog section schemas are not closed"
        )
    for section, descriptor in SECTION_SCHEMA_CONTRACT.items():
        value = sections.get(section)
        kind = descriptor["kind"]
        if kind == "object":
            if not isinstance(value, Mapping) or set(value) != set(descriptor["keys"]):
                raise CatalogContractError(
                    "catalog_section_drift", f"Catalog object shape differs: {section}"
                )
            continue
        if kind == "rows":
            if not isinstance(value, list):
                raise CatalogContractError(
                    "catalog_section_drift", f"Catalog section is not row-shaped: {section}"
                )
            for row in value:
                if not isinstance(row, Mapping) or set(row) != set(descriptor["keys"]):
                    raise CatalogContractError(
                        "catalog_section_drift",
                        f"Catalog row properties differ: {section}",
                    )
            continue
        if kind != "nested_rows" or not isinstance(value, Mapping):
            raise CatalogContractError(
                "catalog_section_drift", f"Catalog nested shape differs: {section}"
            )
        nested = descriptor["keys"]
        if set(value) != set(nested):
            raise CatalogContractError(
                "catalog_section_drift", f"Catalog nested keys differ: {section}"
            )
        for group, row_keys in nested.items():
            rows = value[group]
            if not isinstance(rows, list) or any(
                not isinstance(row, Mapping) or set(row) != set(row_keys)
                for row in rows
            ):
                raise CatalogContractError(
                    "catalog_section_drift",
                    f"Catalog nested rows differ: {section}.{group}",
                )
    if set(properties) != set(PHYSICAL_PROPERTY_CONTRACT):
        raise CatalogContractError(
            "catalog_contract_drift", "Physical property domains differ"
        )
    for section, expected_properties in PHYSICAL_PROPERTY_CONTRACT.items():
        if properties.get(section) != list(expected_properties):
            raise CatalogContractError(
                "catalog_contract_drift",
                f"Physical property contract differs: {section}",
            )


def _validate_public_object_closure(contract: Mapping[str, Any]) -> None:
    sections = contract["sections"]
    scope = contract.get("managed_public_object_scope")
    if not isinstance(scope, Mapping):
        raise CatalogContractError(
            "catalog_contract_drift", "Managed public object scope is missing"
        )
    allowed_tables = set(scope.get("tables", []))
    observed_tables = {row["name"] for row in sections["tables"]}
    table_bound_sections = (
        "columns",
        "constraints",
        "indexes",
        "policies",
        "triggers",
        "rules",
    )
    for section in table_bound_sections:
        observed_tables.update(row["table_name"] for row in sections[section])
    observed_tables.update(row["table"] for row in contract["comments"])
    if not observed_tables.issubset(allowed_tables):
        raise CatalogContractError(
            "unknown_public_object", "Catalog contains an unknown public relation"
        )
    allowed_functions = set(scope.get("baseline_function_identities", [])) | set(
        scope.get("r6a1_function_identities", [])
    )
    observed_functions = {row["identity"] for row in sections["routines"]}
    observed_functions.update(
        row["function_identity"] for row in sections["function_acl"]
    )
    observed_functions.update(
        row["function_identity"]
        for row in sections["triggers"]
    )
    if not observed_functions.issubset(allowed_functions):
        raise CatalogContractError(
            "unknown_public_object", "Catalog contains an unknown public function"
        )


def validate_capture_schema(contract: Mapping[str, Any]) -> None:
    """Reject drift in any catalog section or release/model boundary."""

    expected = canonicalize_capture_schema(_build_capture_schema())
    if set(contract) != set(expected):
        raise CatalogContractError("catalog_contract_drift", "Catalog root is not closed")
    if contract.get("required_catalog_sections") != list(REQUIRED_CATALOG_SECTIONS):
        raise CatalogContractError("catalog_contract_drift", "Catalog section list differs")
    actual_sections = contract.get("sections")
    if not isinstance(actual_sections, Mapping) or set(actual_sections) != set(
        REQUIRED_CATALOG_SECTIONS
    ):
        raise CatalogContractError("catalog_contract_drift", "Catalog sections are not closed")
    _validate_physical_row_shapes(contract)
    _validate_public_object_closure(contract)
    expected_sections = expected["sections"]
    for name in REQUIRED_CATALOG_SECTIONS:
        if _canonical_bytes(actual_sections[name]) != _canonical_bytes(
            expected_sections[name]
        ):
            raise CatalogContractError(
                "catalog_section_drift", f"Catalog section differs: {name}"
            )
    for key in set(expected) - {"sections"}:
        if _canonical_bytes(contract[key]) != _canonical_bytes(expected[key]):
            raise CatalogContractError(
                "catalog_contract_drift", f"Catalog boundary differs: {key}"
            )


def validate_physical_capture_receipt_pair(
    candidate_a: Mapping[str, Any], candidate_b: Mapping[str, Any]
) -> None:
    """Validate closed A/B receipts and prove distinct PostgreSQL clusters."""

    if any(
        not isinstance(candidate, Mapping)
        or set(candidate) != set(PHYSICAL_CAPTURE_RECEIPT_FIELDS)
        for candidate in (candidate_a, candidate_b)
    ):
        raise CatalogContractError(
            "physical_catalog_unsealed", "A/B capture receipts are not closed"
        )
    if candidate_a["candidate_label"] != "A" or candidate_b["candidate_label"] != "B":
        raise CatalogContractError(
            "physical_catalog_unsealed", "A/B capture labels are not distinct and exact"
        )
    system_identifiers = (
        candidate_a["candidate_system_identifier"],
        candidate_b["candidate_system_identifier"],
    )
    if any(
        not isinstance(identifier, str)
        or re.fullmatch(r"[1-9][0-9]*", identifier) is None
        for identifier in system_identifiers
    ) or system_identifiers[0] == system_identifiers[1]:
        raise CatalogContractError(
            "physical_catalog_unsealed",
            "A/B captures do not prove distinct initialized clusters",
        )
    for field in set(PHYSICAL_CAPTURE_RECEIPT_FIELDS) - {
        "candidate_label",
        "candidate_system_identifier",
    }:
        if candidate_a[field] != candidate_b[field]:
            raise CatalogContractError(
                "physical_catalog_unsealed", f"A/B capture binding differs: {field}"
            )


def require_physical_capture_ready(contract: Mapping[str, Any]) -> None:
    """Reject any attempt to use the schema skeleton as a physical contract."""

    validate_capture_schema(contract)
    if (
        contract.get("trigger_contract_status") != "APPROVED_EXACT"
        or not contract.get("constraint_triggers")
        or not contract.get("functions")
    ):
        raise CatalogContractError(
            "trigger_contract_not_approved",
            "Exact constraint-trigger and function inventories are not approved",
        )
    model_binding = contract.get("resolved_model_binding")
    if (
        not isinstance(model_binding, Mapping)
        or model_binding.get("status") != "SEALED"
        or not isinstance(model_binding.get("sealable_resolved_model_sha256"), str)
        or SHA256_RE.fullmatch(model_binding["sealable_resolved_model_sha256"])
        is None
    ):
        raise CatalogContractError(
            "model_reseal_required",
            "The operation-receipt model has not been resealed",
        )
    if contract.get("physical_capture_receipt_contract") != list(
        PHYSICAL_CAPTURE_RECEIPT_FIELDS
    ):
        raise CatalogContractError(
            "physical_catalog_unsealed", "Physical capture receipt shape differs"
        )
    acl_capture = contract.get("acl_capture_contract")
    if (
        not isinstance(acl_capture, Mapping)
        or _canonical_bytes(acl_capture) != _canonical_bytes(ACL_CAPTURE_CONTRACT)
        or any(
            not isinstance(row.get("grantor"), str) or not row["grantor"]
            for row in contract.get("sections", {}).get("schema_acl", [])
        )
    ):
        raise CatalogContractError(
            "physical_catalog_unsealed", "ACL capture is incomplete"
        )
    seal = contract.get("physical_capture_seal")
    if not isinstance(seal, Mapping) or seal.get("status") != "SEALED":
        raise CatalogContractError(
            "physical_catalog_unsealed", "A/B physical capture is not sealed"
        )
    candidate_a = seal.get("candidate_a")
    candidate_b = seal.get("candidate_b")
    validate_physical_capture_receipt_pair(candidate_a, candidate_b)
    release_boundary = contract.get("release_boundary")
    release_inputs = (
        release_boundary.get("inputs")
        if isinstance(release_boundary, Mapping)
        else None
    )
    amendment_payload_sha256 = (
        release_boundary.get("amendment_payload_sha256")
        if isinstance(release_boundary, Mapping)
        else None
    )
    expected_receipt_binding = {
        "postgres_image": compiler.PG17_DOCKER_IMAGE,
        "repo_digest": compiler.PG17_DOCKER_REPO_DIGEST,
        "server_version_num": 170006,
        "resolved_model_sha256": model_binding["sealable_resolved_model_sha256"],
        "amendment_payload_sha256": amendment_payload_sha256,
        "trigger_contract_sha256": (
            release_inputs.get("trigger_contract_sha256")
            if isinstance(release_inputs, Mapping)
            else None
        ),
        "catalog_schema_version": CAPTURE_SCHEMA_VERSION,
    }
    if (
        not isinstance(amendment_payload_sha256, str)
        or SHA256_RE.fullmatch(amendment_payload_sha256) is None
        or _canonical_bytes(contract.get("physical_fingerprint_binding"))
        != _canonical_bytes(expected_receipt_binding)
        or any(
            candidate_a[field] != expected
            for field, expected in expected_receipt_binding.items()
        )
    ):
        raise CatalogContractError(
            "physical_catalog_unsealed", "A/B capture input binding differs"
        )
    expected_catalog_sha256 = catalog_fingerprint_sha256(contract)
    if (
        candidate_a["catalog_sha256"] != expected_catalog_sha256
        or candidate_b["catalog_sha256"] != expected_catalog_sha256
        or seal.get("agreed_catalog_sha256") != expected_catalog_sha256
    ):
        raise CatalogContractError(
            "physical_catalog_unsealed", "A/B canonical catalog hashes differ"
        )
    fingerprint = contract.get("target_pg_catalog_sha256")
    if not isinstance(fingerprint, str) or SHA256_RE.fullmatch(fingerprint) is None:
        raise CatalogContractError(
            "physical_catalog_unsealed",
            "A physical PostgreSQL catalog fingerprint is not sealed",
        )
    if fingerprint != expected_catalog_sha256:
        raise CatalogContractError(
            "physical_catalog_unsealed", "Target fingerprint differs from A/B seal"
        )
