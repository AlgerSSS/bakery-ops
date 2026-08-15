#!/usr/bin/env python3
"""Exact PostgreSQL 17 catalog capture and comparison for HOT CRUSH Phase 1."""

from __future__ import annotations

import hashlib
import json
from typing import Any


CATALOG_CONTRACT_VERSION = 1
EXPECTED_OWNER = "postgres"
FORBIDDEN_OWNER_ROLE = "hc_r6_owner"
DENIED_GRANTEES = (
    "anon",
    "authenticated",
    "service_role",
)


class CatalogContractError(RuntimeError):
    def __init__(self, path: str, expected: Any, actual: Any) -> None:
        super().__init__(f"Catalog differs at {path}")
        self.path = path
        self.expected = expected
        self.actual = actual


def canonical_catalog_bytes(contract: dict[str, Any]) -> bytes:
    return json.dumps(
        contract,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def catalog_fingerprint(contract: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_catalog_bytes(contract)).hexdigest()


def _duplicate_key_guard(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise CatalogContractError(f"$.duplicate_key.{key}", "unique JSON key", key)
        value[key] = item
    return value


def parse_catalog_contract_bytes(raw: bytes, manifest: dict[str, Any]) -> dict[str, Any]:
    try:
        contract = json.loads(raw.decode("utf-8"), object_pairs_hook=_duplicate_key_guard)
    except CatalogContractError:
        raise
    except Exception:
        raise CatalogContractError("$.json", "canonical UTF-8 JSON", "invalid") from None
    if not isinstance(contract, dict):
        raise CatalogContractError("$", "object", type(contract).__name__)
    if raw != canonical_catalog_bytes(contract):
        raise CatalogContractError("$.canonical_bytes", "canonical JSON bytes", "noncanonical")
    validate_catalog_contract_document(contract, manifest)
    return contract


def _rows(cursor: Any, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    cursor.execute(sql, params)
    names = [column.name if hasattr(column, "name") else column[0] for column in cursor.description]
    return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def _first_difference(expected: Any, actual: Any, path: str = "$") -> tuple[str, Any, Any] | None:
    if type(expected) is not type(actual):
        return path, expected, actual
    if isinstance(expected, dict):
        if set(expected) != set(actual):
            return f"{path}.__keys__", sorted(expected), sorted(actual)
        for key in sorted(expected):
            difference = _first_difference(expected[key], actual[key], f"{path}.{key}")
            if difference:
                return difference
        return None
    if isinstance(expected, list):
        if len(expected) != len(actual):
            return f"{path}.__length__", len(expected), len(actual)
        for index, (expected_item, actual_item) in enumerate(zip(expected, actual, strict=True)):
            difference = _first_difference(expected_item, actual_item, f"{path}[{index}]")
            if difference:
                return difference
        return None
    if expected != actual:
        return path, expected, actual
    return None


def _require_exact_keys(value: Any, expected: set[str], path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CatalogContractError(path, "object", type(value).__name__)
    actual = set(value)
    if actual != expected:
        raise CatalogContractError(f"{path}.__keys__", sorted(expected), sorted(actual))
    return value


def _require_row_keys(rows: Any, expected: set[str], path: str) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        raise CatalogContractError(path, "array", type(rows).__name__)
    for index, row in enumerate(rows):
        _require_exact_keys(row, expected, f"{path}[{index}]")
    return rows


def validate_catalog_contract_document(
    contract: dict[str, Any], manifest: dict[str, Any]
) -> None:
    """Validate the detached contract before any database connection is opened."""

    root = _require_exact_keys(
        contract,
        {
            "contract_version",
            "artifact_binding",
            "catalog_family",
            "server",
            "scope",
            "counts",
            "extensions",
            "tables",
            "columns",
            "constraints",
            "indexes",
            "policies",
            "user_triggers",
            "rules",
            "helper",
            "helper_acl",
            "roles",
            "memberships",
            "acl",
        },
        "$",
    )
    if root["contract_version"] != CATALOG_CONTRACT_VERSION:
        raise CatalogContractError(
            "$.contract_version", CATALOG_CONTRACT_VERSION, root["contract_version"]
        )
    if root["catalog_family"] != "postgresql-17":
        raise CatalogContractError("$.catalog_family", "postgresql-17", root["catalog_family"])

    binding = _require_exact_keys(
        root["artifact_binding"],
        {"migration_version", "payload_sha256", "canonical_model_sha256"},
        "$.artifact_binding",
    )
    expected_binding = {
        "migration_version": manifest["migration"]["migration_version"],
        "payload_sha256": manifest["payload"]["sha256"],
        "canonical_model_sha256": manifest["inputs"]["canonical_model_sha256"],
    }
    if binding != expected_binding:
        difference = _first_difference(expected_binding, binding, "$.artifact_binding")
        assert difference is not None
        raise CatalogContractError(*difference)

    server = _require_exact_keys(root["server"], {"server_version_num"}, "$.server")
    if server["server_version_num"] != 170006:
        raise CatalogContractError("$.server.server_version_num", 170006, server["server_version_num"])

    scope = _require_exact_keys(
        root["scope"],
        {
            "schema",
            "owner_mode",
            "expected_owner",
            "forbidden_owner_role",
            "forbidden_role_pattern",
            "table_names",
            "managed_roles",
            "denied_grantees",
            "helper_identity",
        },
        "$.scope",
    )
    table_names = sorted(table["name"] for table in manifest["tables"])
    expected_scope = {
        "schema": "public",
        "owner_mode": "EXECUTOR_OWNER",
        "expected_owner": EXPECTED_OWNER,
        "forbidden_owner_role": FORBIDDEN_OWNER_ROLE,
        "forbidden_role_pattern": "^hc_r6_",
        "table_names": table_names,
        "managed_roles": [],
        "denied_grantees": list(DENIED_GRANTEES),
        "helper_identity": "public.app_normalize_alias_v1(pg_catalog.text)",
    }
    if scope != expected_scope:
        difference = _first_difference(expected_scope, scope, "$.scope")
        assert difference is not None
        raise CatalogContractError(*difference)

    counts = _require_exact_keys(
        root["counts"],
        {
            "tables",
            "columns",
            "constraints",
            "constraints_by_type",
            "indexes",
            "policies",
            "user_triggers",
            "rules",
            "roles",
        },
        "$.counts",
    )
    constraints_by_type = _require_exact_keys(
        counts["constraints_by_type"], {"p", "u", "c", "x", "f"}, "$.counts.constraints_by_type"
    )
    manifest_counts = manifest["counts"]
    expected_constraint_counts = {
        "p": manifest_counts["primary_keys"],
        "u": manifest_counts["unique_constraints"],
        "c": manifest_counts["checks"],
        "x": manifest_counts["exclusions"],
        "f": manifest_counts["foreign_keys"],
    }
    expected_counts = {
        "tables": manifest_counts["tables"],
        "columns": manifest_counts["columns"],
        "constraints": sum(expected_constraint_counts.values()),
        "constraints_by_type": expected_constraint_counts,
        "indexes": (
            manifest_counts["primary_keys"]
            + manifest_counts["unique_constraints"]
            + manifest_counts["exclusions"]
            + manifest_counts["foreign_key_indexes"]
        ),
        "policies": 0,
        "user_triggers": 0,
        "rules": 0,
        "roles": 0,
    }
    if counts != expected_counts or constraints_by_type != expected_constraint_counts:
        difference = _first_difference(expected_counts, counts, "$.counts")
        assert difference is not None
        raise CatalogContractError(*difference)

    extensions = _require_row_keys(root["extensions"], {"name", "schema"}, "$.extensions")
    expected_extensions = [
        {"name": name, "schema": "extensions"} for name in sorted(manifest["extensions"])
    ]
    if extensions != expected_extensions:
        raise CatalogContractError("$.extensions", expected_extensions, extensions)

    tables = _require_row_keys(
        root["tables"],
        {
            "schema",
            "name",
            "kind",
            "persistence",
            "owner",
            "rls_enabled",
            "rls_forced",
            "options",
            "comment",
        },
        "$.tables",
    )
    if [row["name"] for row in tables] != table_names:
        raise CatalogContractError("$.tables[*].name", table_names, [row["name"] for row in tables])
    for index, row in enumerate(tables):
        if (
            row["schema"] != "public"
            or row["kind"] != "r"
            or row["persistence"] != "p"
            or row["owner"] != EXPECTED_OWNER
            or row["rls_enabled"] is not True
            or row["rls_forced"] is not True
            or row["options"] is not None
            or not isinstance(row["comment"], str)
            or not row["comment"]
        ):
            raise CatalogContractError(f"$.tables[{index}]", "managed postgres-owned FORCE RLS table", row)

    row_schemas = {
        "columns": {
            "table_name", "ordinal", "name", "type_schema", "type_name", "type_modifier",
            "array_dimensions", "formatted_type", "not_null", "has_default", "default_expression",
            "identity_kind", "generated_kind", "collation", "comment",
        },
        "constraints": {
            "table_name", "name", "type", "definition", "validated", "deferrable",
            "initially_deferred", "match_type", "update_action", "delete_action", "columns",
            "referenced_table", "referenced_columns", "backing_index", "comment",
        },
        "indexes": {
            "table_name", "name", "owner", "method", "definition", "is_unique", "is_primary",
            "is_exclusion", "nulls_not_distinct", "immediate", "valid", "ready", "live",
            "check_xmin", "clustered", "replica_identity", "key_attribute_count",
            "total_attribute_count", "constraint_name", "comment",
        },
        "policies": {"table_name", "name", "command", "permissive", "roles", "using_expression", "check_expression"},
        "user_triggers": {"table_name", "name", "definition"},
        "rules": {"table_name", "name", "definition"},
        "helper": {
            "schema", "name", "identity_arguments", "result", "owner", "language", "kind",
            "definition", "volatility", "strict", "security_definer", "leakproof", "parallel",
            "returns_set", "config", "comment",
        },
        "helper_acl": {"grantor", "grantee", "privilege", "is_grantable"},
        "roles": {
            "name", "superuser", "inherit", "create_role", "create_database", "login",
            "replication", "bypass_rls", "connection_limit", "valid_until", "config",
        },
        "memberships": {
            "granted_role", "member_role", "grantor", "admin_option", "inherit_option", "set_option",
        },
    }
    for key, keys in row_schemas.items():
        _require_row_keys(root[key], keys, f"$.{key}")
    if len(root["columns"]) != expected_counts["columns"]:
        raise CatalogContractError("$.columns.__length__", expected_counts["columns"], len(root["columns"]))
    if len(root["constraints"]) != expected_counts["constraints"]:
        raise CatalogContractError("$.constraints.__length__", expected_counts["constraints"], len(root["constraints"]))
    if len(root["indexes"]) != expected_counts["indexes"]:
        raise CatalogContractError("$.indexes.__length__", expected_counts["indexes"], len(root["indexes"]))
    if root["policies"] or root["user_triggers"] or root["rules"] or root["roles"] or root["memberships"]:
        raise CatalogContractError("$.managed_zero_sets", [], "one or more forbidden rows")
    if len(root["helper"]) != 1 or root["helper"][0]["owner"] != EXPECTED_OWNER:
        raise CatalogContractError("$.helper", "one postgres-owned helper", root["helper"])
    if any(row["owner"] != EXPECTED_OWNER for row in root["indexes"]):
        raise CatalogContractError("$.indexes[*].owner", EXPECTED_OWNER, "non-postgres owner")
    if any(not isinstance(row["comment"], str) or not row["comment"] for row in root["columns"]):
        raise CatalogContractError("$.columns[*].comment", "nonblank", "missing comment")
    if any(not isinstance(row["comment"], str) or not row["comment"] for row in root["constraints"]):
        raise CatalogContractError("$.constraints[*].comment", "nonblank", "missing comment")

    acl = _require_exact_keys(
        root["acl"],
        {
            "direct_schema_nonowner", "direct_relation_nonowner", "direct_column",
            "schema_privileges", "forbidden_effective_table", "forbidden_effective_column",
            "forbidden_effective_helper", "managed_default_acl_headers", "managed_default_acl_entries",
        },
        "$.acl",
    )
    acl_schemas = {
        "direct_schema_nonowner": {"grantee", "privilege", "is_grantable"},
        "direct_relation_nonowner": {"object_name", "grantee", "grantor", "privilege", "is_grantable"},
        "direct_column": {"table_name", "column_name", "grantee", "grantor", "privilege", "is_grantable"},
        "schema_privileges": {"grantee", "usage", "create"},
        "forbidden_effective_table": {"table_name", "grantee", "privilege"},
        "forbidden_effective_column": {"table_name", "column_name", "grantee", "privilege"},
        "forbidden_effective_helper": {"grantee", "privilege"},
        "managed_default_acl_headers": {"owner", "schema", "object_type"},
        "managed_default_acl_entries": {"owner", "schema", "object_type", "grantee", "grantor", "privilege", "is_grantable"},
    }
    for key, keys in acl_schemas.items():
        _require_row_keys(acl[key], keys, f"$.acl.{key}")
    expected_schema_acl = [
        {"grantee": grantee, "privilege": "USAGE", "is_grantable": False}
        for grantee in sorted(("PUBLIC", *DENIED_GRANTEES))
    ]
    if acl["direct_schema_nonowner"] != expected_schema_acl:
        raise CatalogContractError(
            "$.acl.direct_schema_nonowner", expected_schema_acl, acl["direct_schema_nonowner"]
        )
    expected_schema_privileges = [
        {"grantee": grantee, "usage": True, "create": False}
        for grantee in sorted(DENIED_GRANTEES)
    ]
    if acl["schema_privileges"] != expected_schema_privileges:
        raise CatalogContractError(
            "$.acl.schema_privileges", expected_schema_privileges, acl["schema_privileges"]
        )
    for zero_key in (
        "direct_relation_nonowner", "direct_column", "forbidden_effective_table",
        "forbidden_effective_column", "forbidden_effective_helper",
        "managed_default_acl_headers", "managed_default_acl_entries",
    ):
        if acl[zero_key]:
            raise CatalogContractError(f"$.acl.{zero_key}", [], acl[zero_key])
    forbidden_helper_grantees = {"PUBLIC", *DENIED_GRANTEES}
    if any(row["grantee"] in forbidden_helper_grantees for row in root["helper_acl"]):
        raise CatalogContractError("$.helper_acl", "no denied grantee", root["helper_acl"])


def capture_catalog(cursor: Any, manifest: dict[str, Any]) -> dict[str, Any]:
    table_names = [table["name"] for table in manifest["tables"]]
    role_names = list(manifest["roles"])
    table_param = (table_names,)
    controlled_schema_roles = [*role_names, *DENIED_GRANTEES]

    cursor.execute("SET LOCAL search_path = pg_catalog, public, extensions")
    cursor.execute("SET LOCAL TIME ZONE 'UTC'")
    cursor.execute("SET LOCAL DateStyle = 'ISO, YMD'")
    cursor.execute("SET LOCAL quote_all_identifiers = off")

    server = _rows(
        cursor,
        """
        SELECT current_setting('server_version_num')::pg_catalog.int4 AS server_version_num
        """,
    )[0]
    extensions = _rows(
        cursor,
        """
        SELECT extension.extname AS name,
               namespace.nspname AS schema
          FROM pg_catalog.pg_extension AS extension
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = extension.extnamespace
         WHERE extension.extname = ANY(%s)
         ORDER BY extension.extname
        """,
        (list(manifest["extensions"]),),
    )
    table_rows = _rows(
        cursor,
        """
        SELECT namespace.nspname AS schema,
               relation.relname AS name,
               relation.relkind AS kind,
               relation.relpersistence AS persistence,
               pg_catalog.pg_get_userbyid(relation.relowner) AS owner,
               relation.relrowsecurity AS rls_enabled,
               relation.relforcerowsecurity AS rls_forced,
               relation.reloptions AS options,
               pg_catalog.obj_description(relation.oid, 'pg_class') AS comment
          FROM pg_catalog.pg_class AS relation
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname = ANY(%s)
         ORDER BY namespace.nspname, relation.relname
        """,
        table_param,
    )
    column_rows = _rows(
        cursor,
        """
        SELECT relation.relname AS table_name,
               attribute.attnum AS ordinal,
               attribute.attname AS name,
               type_namespace.nspname AS type_schema,
               type_record.typname AS type_name,
               attribute.atttypmod AS type_modifier,
               attribute.attndims AS array_dimensions,
               pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS formatted_type,
               attribute.attnotnull AS not_null,
               attribute.atthasdef AS has_default,
               CASE WHEN default_record.oid IS NULL THEN NULL
                    ELSE pg_catalog.pg_get_expr(default_record.adbin, default_record.adrelid, false)
                END AS default_expression,
               attribute.attidentity AS identity_kind,
               attribute.attgenerated AS generated_kind,
               CASE WHEN attribute.attcollation = 0 THEN NULL
                    ELSE collation_namespace.nspname || '.' || collation_record.collname
                END AS collation,
               pg_catalog.col_description(relation.oid, attribute.attnum) AS comment
          FROM pg_catalog.pg_attribute AS attribute
          JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
          JOIN pg_catalog.pg_namespace AS relation_namespace
            ON relation_namespace.oid = relation.relnamespace
          JOIN pg_catalog.pg_type AS type_record ON type_record.oid = attribute.atttypid
          JOIN pg_catalog.pg_namespace AS type_namespace
            ON type_namespace.oid = type_record.typnamespace
          LEFT JOIN pg_catalog.pg_attrdef AS default_record
            ON default_record.adrelid = attribute.attrelid
           AND default_record.adnum = attribute.attnum
          LEFT JOIN pg_catalog.pg_collation AS collation_record
            ON collation_record.oid = attribute.attcollation
          LEFT JOIN pg_catalog.pg_namespace AS collation_namespace
            ON collation_namespace.oid = collation_record.collnamespace
         WHERE relation_namespace.nspname = 'public'
           AND relation.relname = ANY(%s)
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
         ORDER BY relation.relname, attribute.attnum
        """,
        table_param,
    )
    constraint_rows = _rows(
        cursor,
        """
        SELECT relation.relname AS table_name,
               constraint_record.conname AS name,
               constraint_record.contype AS type,
               pg_catalog.pg_get_constraintdef(constraint_record.oid, false) AS definition,
               constraint_record.convalidated AS validated,
               constraint_record.condeferrable AS deferrable,
               constraint_record.condeferred AS initially_deferred,
               constraint_record.confmatchtype AS match_type,
               constraint_record.confupdtype AS update_action,
               constraint_record.confdeltype AS delete_action,
               ARRAY(
                 SELECT attribute.attname
                   FROM pg_catalog.unnest(constraint_record.conkey) WITH ORDINALITY AS key(attnum, ordinal)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = constraint_record.conrelid
                    AND attribute.attnum = key.attnum
                  ORDER BY key.ordinal
               ) AS columns,
               referenced.relname AS referenced_table,
               ARRAY(
                 SELECT attribute.attname
                   FROM pg_catalog.unnest(constraint_record.confkey) WITH ORDINALITY AS key(attnum, ordinal)
                   JOIN pg_catalog.pg_attribute AS attribute
                     ON attribute.attrelid = constraint_record.confrelid
                    AND attribute.attnum = key.attnum
                  ORDER BY key.ordinal
               ) AS referenced_columns,
               backing_index.relname AS backing_index,
               pg_catalog.obj_description(constraint_record.oid, 'pg_constraint') AS comment
          FROM pg_catalog.pg_constraint AS constraint_record
          JOIN pg_catalog.pg_class AS relation
            ON relation.oid = constraint_record.conrelid
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          LEFT JOIN pg_catalog.pg_class AS referenced
            ON referenced.oid = constraint_record.confrelid
          LEFT JOIN pg_catalog.pg_class AS backing_index
            ON backing_index.oid = constraint_record.conindid
         WHERE namespace.nspname = 'public'
           AND relation.relname = ANY(%s)
         ORDER BY relation.relname, constraint_record.conname
        """,
        table_param,
    )
    index_rows = _rows(
        cursor,
        """
        SELECT table_relation.relname AS table_name,
               index_relation.relname AS name,
               pg_catalog.pg_get_userbyid(index_relation.relowner) AS owner,
               access_method.amname AS method,
               pg_catalog.pg_get_indexdef(index_relation.oid, 0, false) AS definition,
               index_record.indisunique AS is_unique,
               index_record.indisprimary AS is_primary,
               index_record.indisexclusion AS is_exclusion,
               index_record.indnullsnotdistinct AS nulls_not_distinct,
               index_record.indimmediate AS immediate,
               index_record.indisvalid AS valid,
               index_record.indisready AS ready,
               index_record.indislive AS live,
               index_record.indcheckxmin AS check_xmin,
               index_record.indisclustered AS clustered,
               index_record.indisreplident AS replica_identity,
               index_record.indnkeyatts AS key_attribute_count,
               index_record.indnatts AS total_attribute_count,
               constraint_record.conname AS constraint_name,
               pg_catalog.obj_description(index_relation.oid, 'pg_class') AS comment
          FROM pg_catalog.pg_index AS index_record
          JOIN pg_catalog.pg_class AS index_relation
            ON index_relation.oid = index_record.indexrelid
          JOIN pg_catalog.pg_class AS table_relation
            ON table_relation.oid = index_record.indrelid
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = table_relation.relnamespace
          JOIN pg_catalog.pg_am AS access_method
            ON access_method.oid = index_relation.relam
          LEFT JOIN pg_catalog.pg_constraint AS constraint_record
            ON constraint_record.conindid = index_relation.oid
           AND constraint_record.conrelid = table_relation.oid
           AND constraint_record.contype IN ('p', 'u', 'x')
         WHERE namespace.nspname = 'public'
           AND table_relation.relname = ANY(%s)
         ORDER BY table_relation.relname, index_relation.relname
        """,
        table_param,
    )
    policies = _rows(
        cursor,
        """
        SELECT relation.relname AS table_name,
               policy.polname AS name,
               policy.polcmd AS command,
               policy.polpermissive AS permissive,
               ARRAY(
                 SELECT role.rolname
                   FROM pg_catalog.unnest(policy.polroles) AS member(role_oid)
                   LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = member.role_oid
                  ORDER BY role.rolname
               ) AS roles,
               pg_catalog.pg_get_expr(policy.polqual, policy.polrelid, false) AS using_expression,
               pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid, false) AS check_expression
          FROM pg_catalog.pg_policy AS policy
          JOIN pg_catalog.pg_class AS relation ON relation.oid = policy.polrelid
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname = ANY(%s)
         ORDER BY relation.relname, policy.polname
        """,
        table_param,
    )
    user_triggers = _rows(
        cursor,
        """
        SELECT relation.relname AS table_name,
               trigger_record.tgname AS name,
               pg_catalog.pg_get_triggerdef(trigger_record.oid, false) AS definition
          FROM pg_catalog.pg_trigger AS trigger_record
          JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_record.tgrelid
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname = ANY(%s)
           AND NOT trigger_record.tgisinternal
         ORDER BY relation.relname, trigger_record.tgname
        """,
        table_param,
    )
    rules = _rows(
        cursor,
        """
        SELECT relation.relname AS table_name,
               rewrite.rulename AS name,
               pg_catalog.pg_get_ruledef(rewrite.oid, false) AS definition
          FROM pg_catalog.pg_rewrite AS rewrite
          JOIN pg_catalog.pg_class AS relation ON relation.oid = rewrite.ev_class
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname = ANY(%s)
           AND rewrite.rulename <> '_RETURN'
         ORDER BY relation.relname, rewrite.rulename
        """,
        table_param,
    )
    helper = _rows(
        cursor,
        """
        SELECT namespace.nspname AS schema,
               procedure.proname AS name,
               pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS identity_arguments,
               pg_catalog.pg_get_function_result(procedure.oid) AS result,
               pg_catalog.pg_get_userbyid(procedure.proowner) AS owner,
               language.lanname AS language,
               procedure.prokind AS kind,
               pg_catalog.pg_get_functiondef(procedure.oid) AS definition,
               procedure.provolatile AS volatility,
               procedure.proisstrict AS strict,
               procedure.prosecdef AS security_definer,
               procedure.proleakproof AS leakproof,
               procedure.proparallel AS parallel,
               procedure.proretset AS returns_set,
               procedure.proconfig AS config,
               pg_catalog.obj_description(procedure.oid, 'pg_proc') AS comment
          FROM pg_catalog.pg_proc AS procedure
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
          JOIN pg_catalog.pg_language AS language ON language.oid = procedure.prolang
         WHERE procedure.oid = pg_catalog.to_regprocedure('public.app_normalize_alias_v1(text)')
        """,
    )
    helper_acl = _rows(
        cursor,
        """
        SELECT pg_catalog.pg_get_userbyid(acl.grantor) AS grantor,
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
               acl.privilege_type AS privilege,
               acl.is_grantable
          FROM pg_catalog.pg_proc AS procedure
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
          ) AS acl
         WHERE procedure.oid = pg_catalog.to_regprocedure('public.app_normalize_alias_v1(text)')
         ORDER BY grantee, privilege, grantor
        """,
    )
    roles = _rows(
        cursor,
        """
        SELECT rolname AS name,
               rolsuper AS superuser,
               rolinherit AS inherit,
               rolcreaterole AS create_role,
               rolcreatedb AS create_database,
               rolcanlogin AS login,
               rolreplication AS replication,
               rolbypassrls AS bypass_rls,
               rolconnlimit AS connection_limit,
               rolvaliduntil::pg_catalog.text AS valid_until,
               rolconfig AS config
          FROM pg_catalog.pg_roles
         WHERE rolname ~ '^hc_r6_'
         ORDER BY rolname
        """,
    )
    memberships = _rows(
        cursor,
        """
        SELECT granted.rolname AS granted_role,
               member.rolname AS member_role,
               pg_catalog.pg_get_userbyid(membership.grantor) AS grantor,
               membership.admin_option,
               membership.inherit_option,
               membership.set_option
          FROM pg_catalog.pg_auth_members AS membership
          JOIN pg_catalog.pg_roles AS granted ON granted.oid = membership.roleid
          JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
         WHERE granted.rolname ~ '^hc_r6_'
            OR member.rolname ~ '^hc_r6_'
         ORDER BY granted.rolname, member.rolname, grantor,
                  membership.admin_option, membership.inherit_option,
                  membership.set_option
        """,
    )
    direct_relation_acl = _rows(
        cursor,
        """
        SELECT relation.relname AS object_name,
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
               pg_catalog.pg_get_userbyid(acl.grantor) AS grantor,
               acl.privilege_type AS privilege,
               acl.is_grantable
          FROM pg_catalog.pg_class AS relation
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
          ) AS acl
         WHERE namespace.nspname = 'public'
           AND relation.relname = ANY(%s)
           AND acl.grantee <> relation.relowner
         ORDER BY relation.relname, grantee, privilege, grantor
        """,
        table_param,
    )
    direct_column_acl = _rows(
        cursor,
        """
        SELECT relation.relname AS table_name,
               attribute.attname AS column_name,
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
               pg_catalog.pg_get_userbyid(acl.grantor) AS grantor,
               acl.privilege_type AS privilege,
               acl.is_grantable
          FROM pg_catalog.pg_attribute AS attribute
          JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
         WHERE namespace.nspname = 'public'
           AND relation.relname = ANY(%s)
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
         ORDER BY relation.relname, attribute.attname, grantee, privilege, grantor
        """,
        table_param,
    )
    direct_schema_acl = _rows(
        cursor,
        """
        SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
               acl.privilege_type AS privilege,
               acl.is_grantable
          FROM pg_catalog.pg_namespace AS namespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
          ) AS acl
         WHERE namespace.nspname = 'public'
           AND acl.grantee <> namespace.nspowner
           AND (
             acl.grantee = 0
             OR pg_catalog.pg_get_userbyid(acl.grantee) = ANY(%s)
           )
         ORDER BY (
           CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                ELSE pg_catalog.pg_get_userbyid(acl.grantee) END
         ) COLLATE "C", privilege, acl.is_grantable
        """,
        (controlled_schema_roles,),
    )
    schema_privileges = _rows(
        cursor,
        """
        SELECT grantee.name AS grantee,
               pg_catalog.has_schema_privilege(grantee.name, 'public', 'USAGE') AS usage,
               pg_catalog.has_schema_privilege(grantee.name, 'public', 'CREATE') AS create
          FROM pg_catalog.unnest(%s::pg_catalog.text[]) AS grantee(name)
         ORDER BY grantee.name
        """,
        (controlled_schema_roles,),
    )
    effective_table_acl = _rows(
        cursor,
        """
        SELECT relation.relname AS table_name,
               grantee.name AS grantee,
               privilege.name AS privilege
          FROM pg_catalog.pg_class AS relation
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          CROSS JOIN pg_catalog.unnest(%s::pg_catalog.text[]) AS grantee(name)
          CROSS JOIN pg_catalog.unnest(
            ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']::pg_catalog.text[]
          ) AS privilege(name)
         WHERE namespace.nspname = 'public'
           AND relation.relname = ANY(%s)
           AND pg_catalog.has_table_privilege(grantee.name, relation.oid, privilege.name)
         ORDER BY relation.relname, grantee.name, privilege.name
        """,
        (list(DENIED_GRANTEES), table_names),
    )
    effective_column_acl = _rows(
        cursor,
        """
        SELECT relation.relname AS table_name,
               attribute.attname AS column_name,
               grantee.name AS grantee,
               privilege.name AS privilege
          FROM pg_catalog.pg_attribute AS attribute
          JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          CROSS JOIN pg_catalog.unnest(%s::pg_catalog.text[]) AS grantee(name)
          CROSS JOIN pg_catalog.unnest(
            ARRAY['SELECT','INSERT','UPDATE','REFERENCES']::pg_catalog.text[]
          ) AS privilege(name)
         WHERE namespace.nspname = 'public'
           AND relation.relname = ANY(%s)
           AND attribute.attnum > 0
           AND NOT attribute.attisdropped
           AND pg_catalog.has_column_privilege(
                 grantee.name, relation.oid, attribute.attnum, privilege.name
               )
         ORDER BY relation.relname, attribute.attname, grantee.name, privilege.name
        """,
        (list(DENIED_GRANTEES), table_names),
    )
    effective_helper_acl = _rows(
        cursor,
        """
        SELECT grantee.name AS grantee, 'EXECUTE'::pg_catalog.text AS privilege
          FROM pg_catalog.unnest(%s::pg_catalog.text[]) AS grantee(name)
         WHERE pg_catalog.has_function_privilege(
                 grantee.name,
                 'public.app_normalize_alias_v1(text)',
                 'EXECUTE'
               )
         ORDER BY grantee.name
        """,
        (list(DENIED_GRANTEES),),
    )
    default_acl_headers = _rows(
        cursor,
        """
        SELECT owner.rolname AS owner,
               CASE WHEN default_acl.defaclnamespace = 0
                    THEN NULL ELSE namespace.nspname END AS schema,
               default_acl.defaclobjtype AS object_type
          FROM pg_catalog.pg_default_acl AS default_acl
          JOIN pg_catalog.pg_roles AS owner ON owner.oid = default_acl.defaclrole
          LEFT JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = default_acl.defaclnamespace
         WHERE owner.rolname = ANY(%s)
           AND (default_acl.defaclnamespace = 0 OR namespace.nspname = 'public')
           AND default_acl.defaclobjtype IN ('r', 'S', 'f')
         ORDER BY owner.rolname, schema NULLS FIRST, default_acl.defaclobjtype
        """,
        (role_names,),
    )
    default_acl_entries = _rows(
        cursor,
        """
        SELECT owner.rolname AS owner,
               namespace.nspname AS schema,
               default_acl.defaclobjtype AS object_type,
               CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee) END AS grantee,
               pg_catalog.pg_get_userbyid(acl.grantor) AS grantor,
               acl.privilege_type AS privilege,
               acl.is_grantable
          FROM pg_catalog.pg_default_acl AS default_acl
          JOIN pg_catalog.pg_roles AS owner ON owner.oid = default_acl.defaclrole
          LEFT JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = default_acl.defaclnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS acl
         WHERE owner.rolname = ANY(%s)
           AND (default_acl.defaclnamespace = 0 OR namespace.nspname = 'public')
           AND default_acl.defaclobjtype IN ('r', 'S', 'f')
         ORDER BY schema NULLS FIRST, object_type, grantee, privilege, grantor
        """,
        (role_names,),
    )

    constraints_by_type: dict[str, int] = {}
    for row in constraint_rows:
        constraints_by_type[row["type"]] = constraints_by_type.get(row["type"], 0) + 1
    return {
        "contract_version": CATALOG_CONTRACT_VERSION,
        "artifact_binding": {
            "migration_version": manifest["migration"]["migration_version"],
            "payload_sha256": manifest["payload"]["sha256"],
            "canonical_model_sha256": manifest["inputs"]["canonical_model_sha256"],
        },
        "catalog_family": "postgresql-17",
        "server": server,
        "scope": {
            "schema": "public",
            "owner_mode": "EXECUTOR_OWNER",
            "expected_owner": EXPECTED_OWNER,
            "forbidden_owner_role": FORBIDDEN_OWNER_ROLE,
            "forbidden_role_pattern": "^hc_r6_",
            "table_names": table_names,
            "managed_roles": role_names,
            "denied_grantees": list(DENIED_GRANTEES),
            "helper_identity": "public.app_normalize_alias_v1(pg_catalog.text)",
        },
        "counts": {
            "tables": len(table_rows),
            "columns": len(column_rows),
            "constraints": len(constraint_rows),
            "constraints_by_type": constraints_by_type,
            "indexes": len(index_rows),
            "policies": len(policies),
            "user_triggers": len(user_triggers),
            "rules": len(rules),
            "roles": len(roles),
        },
        "extensions": extensions,
        "tables": table_rows,
        "columns": column_rows,
        "constraints": constraint_rows,
        "indexes": index_rows,
        "policies": policies,
        "user_triggers": user_triggers,
        "rules": rules,
        "helper": helper,
        "helper_acl": helper_acl,
        "roles": roles,
        "memberships": memberships,
        "acl": {
            "direct_schema_nonowner": direct_schema_acl,
            "direct_relation_nonowner": direct_relation_acl,
            "direct_column": direct_column_acl,
            "schema_privileges": schema_privileges,
            "forbidden_effective_table": effective_table_acl,
            "forbidden_effective_column": effective_column_acl,
            "forbidden_effective_helper": effective_helper_acl,
            "managed_default_acl_headers": default_acl_headers,
            "managed_default_acl_entries": default_acl_entries,
        },
    }


def verify_catalog_contract(cursor: Any, expected: dict[str, Any]) -> str:
    if not isinstance(expected, dict) or expected.get("contract_version") != CATALOG_CONTRACT_VERSION:
        raise CatalogContractError("$.contract_version", CATALOG_CONTRACT_VERSION, None)
    synthetic_manifest = {
        "tables": [{"name": name} for name in expected.get("scope", {}).get("table_names", [])],
        "roles": expected.get("scope", {}).get("managed_roles", []),
        "extensions": [extension["name"] for extension in expected.get("extensions", [])],
        "migration": {
            "migration_version": expected.get("artifact_binding", {}).get("migration_version")
        },
        "payload": {"sha256": expected.get("artifact_binding", {}).get("payload_sha256")},
        "inputs": {
            "canonical_model_sha256": expected.get("artifact_binding", {}).get(
                "canonical_model_sha256"
            )
        },
        "counts": {
            "tables": expected.get("counts", {}).get("tables"),
            "columns": expected.get("counts", {}).get("columns"),
            "primary_keys": expected.get("counts", {}).get("constraints_by_type", {}).get("p"),
            "unique_constraints": expected.get("counts", {}).get("constraints_by_type", {}).get("u"),
            "checks": expected.get("counts", {}).get("constraints_by_type", {}).get("c"),
            "exclusions": expected.get("counts", {}).get("constraints_by_type", {}).get("x"),
            "foreign_keys": expected.get("counts", {}).get("constraints_by_type", {}).get("f"),
            "foreign_key_indexes": (
                expected.get("counts", {}).get("indexes", 0)
                - sum(
                    expected.get("counts", {}).get("constraints_by_type", {}).get(key, 0)
                    for key in ("p", "u", "x")
                )
            ),
        },
    }
    validate_catalog_contract_document(expected, synthetic_manifest)
    actual = capture_catalog(
        cursor,
        synthetic_manifest,
    )
    difference = _first_difference(expected, actual)
    if difference:
        raise CatalogContractError(*difference)
    return catalog_fingerprint(actual)
