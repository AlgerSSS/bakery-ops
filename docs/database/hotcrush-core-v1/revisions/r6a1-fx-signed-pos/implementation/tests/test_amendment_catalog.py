from __future__ import annotations

import sys
import unittest
import copy
import json
from pathlib import Path


IMPLEMENTATION_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(IMPLEMENTATION_DIR))

import amendment_catalog as catalog  # noqa: E402


class AmendmentCatalogContractTests(unittest.TestCase):
    def test_all_physical_catalog_sections_are_closed(self) -> None:
        contract = catalog.build_capture_schema()
        self.assertEqual(
            set(contract["sections"]),
            {
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
            },
        )
        self.assertEqual(len(contract["sections"]["tables"]), 105)
        self.assertEqual(len(contract["sections"]["columns"]), 1469)
        self.assertEqual(len(contract["sections"]["constraints"]), 973)
        self.assertEqual(len(contract["sections"]["indexes"]), 504)
        self.assertEqual(len(contract["foreign_key_support_indexes"]), 266)
        self.assertEqual(len(contract["sections"]["routines"]), 1)
        self.assertEqual(contract["sections"]["triggers"], [])
        self.assertEqual(
            set(contract["section_schema_contract"]), set(contract["sections"])
        )
        catalog.validate_capture_schema(contract)

    def test_canonical_json_is_order_stable_and_rejects_noncanonical_or_duplicate_keys(self) -> None:
        contract = catalog.build_capture_schema()
        canonical = catalog.canonical_capture_bytes(contract)
        self.assertEqual(
            catalog.parse_canonical_capture_bytes(canonical),
            catalog.canonicalize_capture_schema(contract),
        )
        reordered = copy.deepcopy(contract)
        reordered["sections"]["tables"].reverse()
        reordered["sections"]["columns"].reverse()
        self.assertEqual(catalog.canonical_capture_bytes(reordered), canonical)
        with self.assertRaises(catalog.CatalogContractError) as caught:
            catalog.parse_canonical_capture_bytes(
                json.dumps(contract, ensure_ascii=False, indent=2).encode("utf-8")
            )
        self.assertEqual(caught.exception.code, "noncanonical_catalog_json")
        with self.assertRaises(catalog.CatalogContractError) as caught:
            catalog.parse_canonical_capture_bytes(b'{"a":1,"a":2}')
        self.assertEqual(caught.exception.code, "duplicate_json_key")

    def test_roles_acl_and_effective_rows_use_explicit_closed_c_sort_keys(self) -> None:
        value = {
            "sections": {
                "roles": [{"name": "z"}, {"name": "a"}],
                "role_memberships": [
                    {
                        "granted_role": "z",
                        "member_role": "a",
                        "grantor": "postgres",
                        "admin_option": False,
                        "inherit_option": True,
                        "set_option": True,
                    },
                    {
                        "granted_role": "a",
                        "member_role": "z",
                        "grantor": "postgres",
                        "admin_option": False,
                        "inherit_option": True,
                        "set_option": True,
                    },
                ],
                "default_acl": {
                    "headers": [
                        {"owner": "postgres", "schema": "public", "object_type": "r"},
                        {"owner": "postgres", "schema": None, "object_type": "r"},
                    ],
                    "entries": [
                        {
                            "owner": "postgres",
                            "schema": "public",
                            "object_type": "r",
                            "grantee": "z",
                            "grantor": "postgres",
                            "privilege": "SELECT",
                            "is_grantable": False,
                        },
                        {
                            "owner": "postgres",
                            "schema": None,
                            "object_type": "r",
                            "grantee": "a",
                            "grantor": "postgres",
                            "privilege": "SELECT",
                            "is_grantable": False,
                        },
                    ],
                },
                "effective_privileges": {
                    "schema_privileges": [
                        {"grantee": "z", "usage": True, "create": False},
                        {"grantee": "a", "usage": True, "create": False},
                    ],
                    "forbidden_table": [
                        {"table_name": "z", "grantee": "a", "privilege": "SELECT"},
                        {"table_name": "a", "grantee": "z", "privilege": "SELECT"},
                    ],
                    "forbidden_column": [
                        {
                            "table_name": "z",
                            "column_name": "a",
                            "grantee": "a",
                            "privilege": "SELECT",
                        },
                        {
                            "table_name": "a",
                            "column_name": "z",
                            "grantee": "z",
                            "privilege": "SELECT",
                        },
                    ],
                    "routine_execute": [
                        {
                            "function_identity": "z()",
                            "grantee": "a",
                            "privilege": "EXECUTE",
                        },
                        {
                            "function_identity": "a()",
                            "grantee": "z",
                            "privilege": "EXECUTE",
                        },
                    ],
                },
            }
        }
        sections = catalog.canonicalize_capture_schema(value)["sections"]
        self.assertEqual([row["name"] for row in sections["roles"]], ["a", "z"])
        self.assertEqual(
            [row["granted_role"] for row in sections["role_memberships"]],
            ["a", "z"],
        )
        self.assertEqual(
            [row["schema"] for row in sections["default_acl"]["headers"]],
            [None, "public"],
        )
        self.assertEqual(
            [row["schema"] for row in sections["default_acl"]["entries"]],
            [None, "public"],
        )
        self.assertEqual(
            [row["grantee"] for row in sections["effective_privileges"]["schema_privileges"]],
            ["a", "z"],
        )
        self.assertEqual(
            [row["table_name"] for row in sections["effective_privileges"]["forbidden_table"]],
            ["a", "z"],
        )
        self.assertEqual(
            [row["table_name"] for row in sections["effective_privileges"]["forbidden_column"]],
            ["a", "z"],
        )
        self.assertEqual(
            [row["function_identity"] for row in sections["effective_privileges"]["routine_execute"]],
            ["a()", "z()"],
        )

    def test_nonsealing_future_shape_and_forged_hash_never_unlock_readiness(self) -> None:
        contract = catalog.build_capture_schema()
        self.assertEqual(
            contract["expected_future_counts"],
            {
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
        )
        self.assertEqual(contract["sections"]["triggers"], [])
        self.assertEqual(len(contract["sections"]["routines"]), 1)
        forged = copy.deepcopy(contract)
        forged["target_pg_catalog_sha256"] = "a" * 64
        forged["physical_capture_seal"] = {
            "status": "SEALED",
            "candidate_a": {"forged": True},
            "candidate_b": {"forged": True},
            "agreed_catalog_sha256": "a" * 64,
        }
        with self.assertRaises(catalog.CatalogContractError) as caught:
            catalog.require_physical_capture_ready(forged)
        self.assertEqual(caught.exception.code, "catalog_contract_drift")

    def test_fully_self_consistent_forged_ready_contract_is_rejected(self) -> None:
        forged = catalog.build_capture_schema()
        forged["trigger_contract_status"] = "APPROVED_EXACT"
        forged["constraint_triggers"] = [{"forged": True}]
        forged["functions"] = [{"forged": True}]
        forged["physical_capture_status"] = "SEALED"
        forged["unapproved_trigger_slots"]["status"] = "APPROVED_EXACT"
        forged["known_pre_capture_unknowns"] = []
        forged["resolved_model_binding"] = {
            "current_frozen_resolved_model_sha256": "a" * 64,
            "sealable_resolved_model_sha256": "a" * 64,
            "status": "SEALED",
            "blocker": None,
        }
        for row in forged["sections"]["schema_acl"]:
            row["grantor"] = "postgres"
        forged["release_boundary"]["amendment_payload_sha256"] = "b" * 64
        receipt_binding = {
            "postgres_image": catalog.compiler.PG17_DOCKER_IMAGE,
            "repo_digest": catalog.compiler.PG17_DOCKER_REPO_DIGEST,
            "server_version_num": 170006,
            "resolved_model_sha256": "a" * 64,
            "amendment_payload_sha256": "b" * 64,
            "trigger_contract_sha256": forged["release_boundary"]["inputs"][
                "trigger_contract_sha256"
            ],
            "catalog_schema_version": catalog.CAPTURE_SCHEMA_VERSION,
        }
        forged["physical_fingerprint_binding"] = copy.deepcopy(receipt_binding)
        fingerprint = catalog.catalog_fingerprint_sha256(forged)
        candidate_a = {
            "candidate_label": "A",
            "candidate_system_identifier": "1",
            **receipt_binding,
            "catalog_sha256": fingerprint,
        }
        candidate_b = {
            **candidate_a,
            "candidate_label": "B",
            "candidate_system_identifier": "2",
        }
        forged["physical_capture_seal"] = {
            "status": "SEALED",
            "candidate_a": candidate_a,
            "candidate_b": candidate_b,
            "agreed_catalog_sha256": fingerprint,
        }
        forged["target_pg_catalog_sha256"] = fingerprint

        with self.assertRaises(catalog.CatalogContractError) as caught:
            catalog.require_physical_capture_ready(forged)
        self.assertIn(
            caught.exception.code,
            {"catalog_section_drift", "catalog_contract_drift"},
        )

    def test_fingerprint_payload_omits_seal_envelope_but_binds_sections_and_inputs(self) -> None:
        contract = catalog.build_capture_schema()
        original = catalog.catalog_fingerprint_sha256(contract)
        seal_only = copy.deepcopy(contract)
        seal_only["physical_capture_seal"]["status"] = "FORGED_METADATA"
        seal_only["target_pg_catalog_sha256"] = "f" * 64
        self.assertEqual(catalog.catalog_fingerprint_sha256(seal_only), original)
        nonsealing_metadata = copy.deepcopy(contract)
        nonsealing_metadata["expected_future_counts"]["triggers"] = 999
        nonsealing_metadata["known_pre_capture_unknowns"].append("metadata only")
        self.assertEqual(
            catalog.catalog_fingerprint_sha256(nonsealing_metadata), original
        )
        section_drift = copy.deepcopy(contract)
        section_drift["sections"]["tables"][0]["comment"] += " forged"
        self.assertNotEqual(
            catalog.catalog_fingerprint_sha256(section_drift), original
        )
        binding_drift = copy.deepcopy(contract)
        binding_drift["physical_fingerprint_binding"][
            "resolved_model_sha256"
        ] = "0" * 64
        self.assertNotEqual(
            catalog.catalog_fingerprint_sha256(binding_drift), original
        )

    def test_public_object_capture_and_independent_candidate_receipts_are_closed(self) -> None:
        contract = catalog.build_capture_schema()
        self.assertEqual(
            contract["public_object_capture_contract"],
            {
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
            },
        )
        self.assertEqual(
            contract["capture_transaction_contract"],
            {
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
            },
        )
        self.assertIn(
            "candidate_system_identifier",
            contract["physical_capture_receipt_contract"],
        )
        base = {
            field: "value" for field in catalog.PHYSICAL_CAPTURE_RECEIPT_FIELDS
        }
        candidate_a = {**base, "candidate_label": "A", "candidate_system_identifier": "1"}
        candidate_b = {**base, "candidate_label": "B", "candidate_system_identifier": "1"}
        with self.assertRaises(catalog.CatalogContractError) as caught:
            catalog.validate_physical_capture_receipt_pair(candidate_a, candidate_b)
        self.assertEqual(caught.exception.code, "physical_catalog_unsealed")
        candidate_b["candidate_system_identifier"] = "2"
        catalog.validate_physical_capture_receipt_pair(candidate_a, candidate_b)

    def test_baseline_physical_domains_are_carried_forward_not_invented_empty(self) -> None:
        sections = catalog.build_capture_schema()["sections"]
        self.assertEqual(sections["server"], {"server_version_num": 170006})
        self.assertEqual(
            sections["extensions"],
            [
                {"name": "btree_gist", "schema": "extensions"},
                {"name": "citext", "schema": "extensions"},
                {"name": "pgcrypto", "schema": "extensions"},
            ],
        )
        self.assertEqual(sections["roles"], [])
        self.assertEqual(sections["role_memberships"], [])
        self.assertEqual(len(sections["routines"]), 1)
        helper = sections["routines"][0]
        self.assertEqual(helper["origin"], "BASELINE")
        self.assertEqual(
            helper["identity"],
            "public.app_normalize_alias_v1(pg_catalog.text)",
        )
        self.assertIn("CREATE OR REPLACE FUNCTION", helper["definition"])
        self.assertEqual(
            sections["function_acl"],
            [
                {
                    "function_identity": "public.app_normalize_alias_v1(pg_catalog.text)",
                    "grantee": "postgres",
                    "grantor": "postgres",
                    "is_grantable": False,
                    "privilege": "EXECUTE",
                }
            ],
        )
        self.assertEqual(len(sections["schema_acl"]), 4)
        self.assertEqual(
            sections["default_acl"], {"headers": [], "entries": []}
        )
        self.assertEqual(
            catalog.build_capture_schema()["managed_public_object_scope"][
                "default_acl_owner_scope"
            ],
            ["postgres"],
        )
        self.assertEqual(
            catalog.build_capture_schema()["acl_capture_contract"],
            {
                "schema_acl_requires_grantor": True,
                "default_acl_owner_scope": ["postgres"],
                "default_acl_namespace_scope": [None, "public"],
                "default_acl_object_types": ["S", "f", "r"],
                "fresh_postgres_owner_capture_required": True,
                "baseline_default_acl_rows_are_physical_evidence": False,
                "preserve_headers_without_entries": True,
                "explode_entries": True,
            },
        )
        self.assertTrue(
            all("grantor" in row for row in sections["schema_acl"])
        )

    def test_every_physical_row_carries_the_required_pg_catalog_properties(self) -> None:
        contract = catalog.build_capture_schema()
        required = contract["physical_property_contract"]
        representatives = {
            "tables": contract["sections"]["tables"][0],
            "columns": contract["sections"]["columns"][0],
            "constraints": contract["sections"]["constraints"][0],
            "indexes": contract["sections"]["indexes"][0],
            "routines": contract["sections"]["routines"][0],
        }
        for section, row in representatives.items():
            with self.subTest(section=section):
                self.assertEqual(set(row), set(required[section]))

        for section, row in representatives.items():
            for property_name in required[section]:
                mutated = copy.deepcopy(contract)
                original_value = row[property_name]
                mutated["sections"][section][0][property_name] = (
                    "__FORGED__"
                    if original_value != "__FORGED__"
                    else "__OTHER__"
                )
                with self.subTest(section=section, property=property_name), self.assertRaises(
                    catalog.CatalogContractError
                ) as caught:
                    catalog.validate_capture_schema(mutated)
                self.assertIn(
                    caught.exception.code,
                    {"catalog_section_drift", "unknown_public_object"},
                )

    def test_unknown_public_objects_fail_before_catalog_seal(self) -> None:
        contract = catalog.build_capture_schema()
        contract["sections"]["tables"].append(
            {
                **contract["sections"]["tables"][0],
                "name": "unknown_public_table",
            }
        )
        with self.assertRaises(catalog.CatalogContractError) as caught:
            catalog.validate_capture_schema(contract)
        self.assertEqual(caught.exception.code, "unknown_public_object")

    def test_business_constraints_and_constraint_triggers_are_separate(self) -> None:
        contract = catalog.build_capture_schema()
        self.assertEqual(contract["counts"]["business_constraints"], 973)
        self.assertEqual(
            contract["counts"]["business_constraints_by_type"],
            {"p": 105, "u": 112, "c": 403, "x": 21, "f": 332},
        )
        self.assertNotIn("t", contract["counts"]["business_constraints_by_type"])
        self.assertIsNone(contract["counts"]["constraint_triggers"])
        self.assertEqual(contract["counts"]["sql_views"], 0)
        self.assertEqual(contract["trigger_contract_status"], "NOT_APPROVED")
        self.assertEqual(contract["constraint_triggers"], [])

    def test_catalog_is_full_not_delta_only(self) -> None:
        contract = catalog.build_capture_schema()
        self.assertEqual(len(contract["tables"]), 105)
        self.assertEqual(len(contract["columns"]), 1469)
        self.assertEqual(contract["counts"]["indexes"], 504)
        self.assertEqual(contract["counts"]["business_constraints"], 973)
        self.assertEqual(len(contract["foreign_key_support_indexes"]), 266)
        self.assertEqual(contract["target_pg_catalog_sha256"], None)
        self.assertEqual(contract["physical_capture_status"], "BLOCKED_TRIGGER_CONTRACT_NOT_APPROVED")

    def test_trigger_inventory_is_an_explicit_hard_gate_not_an_inferred_placeholder(self) -> None:
        contract = catalog.build_capture_schema()
        self.assertEqual(contract["trigger_invariant_families"], [])
        self.assertEqual(len(contract["source_invariant_summaries"]), 6)
        self.assertEqual(contract["functions"], [])
        with self.assertRaises(catalog.CatalogContractError) as caught:
            catalog.require_physical_capture_ready(contract)
        self.assertEqual(caught.exception.code, "trigger_contract_not_approved")

    def test_design_catalog_hash_is_never_labeled_as_physical_catalog_hash(self) -> None:
        contract = catalog.build_capture_schema()
        self.assertEqual(
            contract["design_catalog_sha256"],
            "09ecdb9697d4e43296051c89dd3e8b568c07e8d189a38fd8cc8036ea04fdee91",
        )
        self.assertNotEqual(
            contract["design_catalog_sha256"], contract["target_pg_catalog_sha256"]
        )

    def test_any_resealed_catalog_section_drift_is_rejected(self) -> None:
        original = catalog.build_capture_schema()
        for section in catalog.REQUIRED_CATALOG_SECTIONS:
            mutated = copy.deepcopy(original)
            rows = mutated["sections"][section]
            if isinstance(rows, list) and rows:
                rows[0] = {"forged": True}
            elif isinstance(rows, list):
                rows.append({"forged": True})
            elif rows:
                first_key = next(iter(rows))
                rows[first_key] = {"forged": True}
            else:
                rows["forged"] = True
            with self.subTest(section=section), self.assertRaises(
                catalog.CatalogContractError
            ) as caught:
                catalog.validate_capture_schema(mutated)
            self.assertEqual(caught.exception.code, "catalog_section_drift")


if __name__ == "__main__":
    unittest.main()
