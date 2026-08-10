from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


IMPLEMENTATION_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(IMPLEMENTATION_DIR))

import phase1_catalog as catalog  # noqa: E402


class Phase1CatalogContractTests(unittest.TestCase):
    def test_canonical_bytes_and_fingerprint_ignore_dictionary_insertion_order(self) -> None:
        left = {"z": [2, 1], "a": {"b": True, "a": None}}
        right = {"a": {"a": None, "b": True}, "z": [2, 1]}
        self.assertEqual(catalog.canonical_catalog_bytes(left), catalog.canonical_catalog_bytes(right))
        self.assertEqual(catalog.catalog_fingerprint(left), catalog.catalog_fingerprint(right))
        self.assertEqual(json.loads(catalog.canonical_catalog_bytes(left)), left)

    def test_first_difference_reports_exact_nested_path(self) -> None:
        expected = {"tables": [{"columns": [{"default": None}]}]}
        actual = {"tables": [{"columns": [{"default": "0"}]}]}
        self.assertEqual(
            catalog._first_difference(expected, actual),
            ("$.tables[0].columns[0].default", None, "0"),
        )

    def test_first_difference_rejects_key_and_sequence_drift(self) -> None:
        self.assertEqual(
            catalog._first_difference({"a": 1}, {"a": 1, "b": 2}),
            ("$.__keys__", ["a"], ["a", "b"]),
        )
        self.assertEqual(
            catalog._first_difference([1], [1, 2]),
            ("$.__length__", 1, 2),
        )

    def test_verify_rejects_unknown_contract_version_before_query(self) -> None:
        class NeverCursor:
            def execute(self, *args: object, **kwargs: object) -> None:
                self.fail("database must not be queried")

        with self.assertRaises(catalog.CatalogContractError) as caught:
            catalog.verify_catalog_contract(NeverCursor(), {"contract_version": 999})
        self.assertEqual(caught.exception.path, "$.contract_version")

    def test_detached_contract_parser_rejects_noncanonical_and_duplicate_json(self) -> None:
        manifest = {
            "migration": {"migration_version": "R6_PHASE1_BASELINE"},
            "payload": {"sha256": "a" * 64},
            "inputs": {"canonical_model_sha256": "b" * 64},
            "tables": [],
            "roles": [],
            "extensions": [],
            "counts": {
                "tables": 0,
                "columns": 0,
                "primary_keys": 0,
                "unique_constraints": 0,
                "checks": 0,
                "exclusions": 0,
                "foreign_keys": 0,
                "foreign_key_indexes": 0,
            },
        }
        duplicate = b'{"contract_version":1,"contract_version":1}'
        with self.assertRaises(catalog.CatalogContractError):
            catalog.parse_catalog_contract_bytes(duplicate, manifest)

        noncanonical = b'{ "contract_version": 1 }\n'
        with self.assertRaises(catalog.CatalogContractError) as caught:
            catalog.parse_catalog_contract_bytes(noncanonical, manifest)
        self.assertEqual(caught.exception.path, "$.canonical_bytes")

    def test_closed_contract_rejects_unknown_root_key_before_database_access(self) -> None:
        with self.assertRaises(catalog.CatalogContractError) as caught:
            catalog.validate_catalog_contract_document(
                {"contract_version": 1, "unexpected": True},
                {},
            )
        self.assertEqual(caught.exception.path, "$.__keys__")


if __name__ == "__main__":
    unittest.main()
