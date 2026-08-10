from __future__ import annotations

import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path


IMPLEMENTATION_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = IMPLEMENTATION_DIR.parent / "target-model.json"
sys.path.insert(0, str(IMPLEMENTATION_DIR))

import phase1_ddl_compiler as compiler  # noqa: E402


def load_model() -> dict:
    return json.loads(MODEL_PATH.read_text(encoding="utf-8"))


class FrozenPhase1ContractTests(unittest.TestCase):
    def test_authoritative_p0c_model_is_the_only_accepted_contract(self) -> None:
        plan = compiler.build_phase1_plan(load_model())
        self.assertEqual(
            plan.counts,
            {
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
            },
        )
        self.assertEqual(
            compiler.check_contract_sha256(plan),
            "a93bb73aafef9089223afe975e413758806221974d340be6ecee0e733293dd3c",
        )
        self.assertEqual(
            compiler.foreign_key_contract_sha256(plan),
            "de54225a4a1a9e20a5f3a199ed39f533eb7050aeb1ca4e18010dcc2b4c35446c",
        )
        self.assertEqual(
            compiler.unique_contract_sha256(plan),
            "bd480f6589973cc115618d5072d118af716d56878ed3ca52cf6dda39e75e6838",
        )

    def test_p0c_attempt_and_reward_contract_is_explicit(self) -> None:
        model = load_model()
        survey = next(t for t in model["tables"] if t["name"] == "mkt_survey_response")
        attempt = next(f for f in survey["fields"] if f["name"] == "attempt_no")
        attempt_key = ["campaign_member_id", "attempt_no"]
        self.assertTrue(attempt["nullable"])
        self.assertEqual(attempt["checks"], ["attempt_no IS NULL OR attempt_no > 0"])
        self.assertIn(attempt_key, survey["nulls_not_distinct_uniques"])
        self.assertNotIn(attempt_key, survey["nulls_distinct_uniques"])

        claim = next(t for t in model["tables"] if t["name"] == "mkt_reward_claim")
        self.assertEqual(
            claim["foreign_keys"],
            [
                {
                    "columns": ["reward_stock_id", "reward_id"],
                    "ref_table": "mkt_reward_stock",
                    "ref_columns": ["reward_stock_id", "reward_id"],
                    "fk_activation": "WITH_TABLE",
                    "match_type": "SIMPLE",
                }
            ],
        )
        reward_stock = next(f for f in claim["fields"] if f["name"] == "reward_stock_id")
        reward = next(f for f in claim["fields"] if f["name"] == "reward_id")
        self.assertTrue(reward_stock["nullable"])
        self.assertIsNone(reward_stock["fk"])
        self.assertFalse(reward["nullable"])
        self.assertEqual(reward["fk"], "mkt_reward.reward_id")

    def test_composite_foreign_key_shape_and_referent_fail_closed(self) -> None:
        mutations = (
            (
                "unknown_model_keys",
                lambda fk: fk.__setitem__("surprise", True),
            ),
            (
                "invalid_foreign_key",
                lambda fk: fk.__setitem__("columns", ["reward_stock_id"]),
            ),
            (
                "ineligible_foreign_key_target",
                lambda fk: fk.__setitem__("ref_columns", ["reward_id", "reward_stock_id"]),
            ),
            (
                "invalid_foreign_key",
                lambda fk: fk.__setitem__("match_type", "FULL"),
            ),
        )
        for code, mutate in mutations:
            with self.subTest(code=code):
                model = copy.deepcopy(load_model())
                claim = next(t for t in model["tables"] if t["name"] == "mkt_reward_claim")
                mutate(claim["foreign_keys"][0])
                with self.assertRaises(compiler.ModelContractError) as caught:
                    compiler.build_phase1_plan(model)
                self.assertEqual(caught.exception.code, code)

    def test_any_check_edge_mutation_fails_closed(self) -> None:
        cases = (
            "migration_id migration_id",
            "location_id ~ 1",
            "()",
        )
        for expression in cases:
            with self.subTest(expression=expression):
                model = copy.deepcopy(load_model())
                table = next(t for t in model["tables"] if t["name"] == "app_schema_migration")
                table["checks"][0] = expression
                with self.assertRaises(compiler.ModelContractError) as caught:
                    compiler.build_phase1_plan(model)
                self.assertEqual(caught.exception.code, "frozen_check_contract_drift")

    def test_fk_must_reference_an_exact_eligible_primary_or_unique_key(self) -> None:
        model = copy.deepcopy(load_model())
        table = next(t for t in model["tables"] if t["name"] == "app_unit")
        field = next(f for f in table["fields"] if f["name"] == "created_by_user_id")
        field["fk"] = "app_user.person_id"
        with self.assertRaises(compiler.ModelContractError) as caught:
            compiler.build_phase1_plan(model)
        self.assertEqual(caught.exception.code, "ineligible_foreign_key_target")

    def test_closed_json_shapes_reject_unknown_keys(self) -> None:
        mutations = (
            lambda model: model.__setitem__("surprise", True),
            lambda model: model["tables"][0].__setitem__("surprise", True),
            lambda model: model["tables"][0]["fields"][0].__setitem__("surprise", True),
            lambda model: model["views"][0].__setitem__("surprise", True),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                model = copy.deepcopy(load_model())
                mutate(model)
                with self.assertRaises(compiler.ModelContractError) as caught:
                    compiler.build_phase1_plan(model)
                self.assertEqual(caught.exception.code, "unknown_model_keys")

    def test_pk_is_nonnullable_and_required_metadata_is_nonblank(self) -> None:
        model = copy.deepcopy(load_model())
        model["tables"][0]["fields"][0]["nullable"] = True
        with self.assertRaises(compiler.ModelContractError) as caught:
            compiler.build_phase1_plan(model)
        self.assertEqual(caught.exception.code, "nullable_primary_key")

        model = copy.deepcopy(load_model())
        model["tables"][0]["purpose"] = "  "
        with self.assertRaises(compiler.ModelContractError) as caught:
            compiler.build_phase1_plan(model)
        self.assertEqual(caught.exception.code, "missing_required_metadata")

    def test_deferred_and_null_foreign_key_contracts_are_validated(self) -> None:
        model = copy.deepcopy(load_model())
        table = next(
            t for t in model["tables"] if t["name"] == "scm_supplier_price_observation"
        )
        field = next(f for f in table["fields"] if f["name"] == "goods_receipt_line_id")
        field["fk"] = "does_not_exist.nope"
        with self.assertRaises(compiler.ModelContractError) as caught:
            compiler.build_phase1_plan(model)
        self.assertEqual(caught.exception.code, "invalid_foreign_key")

        model = copy.deepcopy(load_model())
        table = next(
            t for t in model["tables"] if t["name"] == "scm_supplier_price_observation"
        )
        field = next(f for f in table["fields"] if f["name"] == "goods_receipt_line_id")
        field["nullable"] = False
        with self.assertRaises(compiler.ModelContractError) as caught:
            compiler.build_phase1_plan(model)
        self.assertEqual(caught.exception.code, "invalid_deferred_foreign_key")

        model = copy.deepcopy(load_model())
        table = next(t for t in model["tables"] if t["name"] == "app_source_system")
        field = next(f for f in table["fields"] if f["name"] == "status")
        field["fk"] = None
        field["fk_activation"] = "EXTENSION_PACK:SHIFT_AND_WORKFORCE"
        with self.assertRaises(compiler.ModelContractError) as caught:
            compiler.build_phase1_plan(model)
        self.assertEqual(caught.exception.code, "invalid_fk_activation")

    def test_pk_unique_and_field_unique_semantics_are_frozen(self) -> None:
        model = copy.deepcopy(load_model())
        pk = model["tables"][0]["fields"][0]
        pk["data_type"] = "text"
        pk["default"] = None
        with self.assertRaises(compiler.ModelContractError) as caught:
            compiler.build_phase1_plan(model)
        self.assertEqual(caught.exception.code, "invalid_primary_key_contract")

        model = copy.deepcopy(load_model())
        nnd_table = next(t for t in model["tables"] if t["name"] == "ops_location_source_identity")
        nd_table = next(t for t in model["tables"] if t["name"] == "hr_person")
        nnd_group = nnd_table["nulls_not_distinct_uniques"].pop()
        nd_group = nd_table["nulls_distinct_uniques"].pop()
        nnd_table["nulls_distinct_uniques"].append(nnd_group)
        nd_table["nulls_not_distinct_uniques"].append(nd_group)
        with self.assertRaises(compiler.ModelContractError) as caught:
            compiler.build_phase1_plan(model)
        self.assertEqual(caught.exception.code, "frozen_unique_contract_drift")

        model = copy.deepcopy(load_model())
        table = next(t for t in model["tables"] if t["name"] == "app_schema_migration")
        field = next(f for f in table["fields"] if f["name"] == "repository_code")
        field["unique"] = True
        with self.assertRaises(compiler.ModelContractError) as caught:
            compiler.build_phase1_plan(model)
        self.assertEqual(caught.exception.code, "invalid_unique")

    def test_view_contract_and_readiness_metadata_fail_closed(self) -> None:
        mutations = (
            ("unknown_view_type", lambda model: model["views"][0]["fields"][0].__setitem__("data_type", "xml")),
            ("invalid_view_readiness", lambda model: model["views"][0].__setitem__("readiness_status", "BOGUS")),
            ("invalid_view_readiness", lambda model: model["view_readiness_counts"].__setitem__("PASS_SELECT_SPEC", 999)),
        )
        for code, mutate in mutations:
            with self.subTest(code=code):
                model = copy.deepcopy(load_model())
                mutate(model)
                with self.assertRaises(compiler.ModelContractError) as caught:
                    compiler.build_phase1_plan(model)
                self.assertEqual(caught.exception.code, code)

    def test_single_authoritative_payload_has_no_internal_transaction_boundary(self) -> None:
        model = load_model()
        canonical = json.dumps(
            model, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        files = compiler.render_phase1_files(
            compiler.build_phase1_plan(model),
            model_sha256=hashlib.sha256(canonical).hexdigest(),
        )
        self.assertIn("phase1.sql", files)
        payload = files["phase1.sql"]
        self.assertNotRegex(payload, r"(?mi)^\s*(BEGIN|COMMIT|ROLLBACK)\s*;")
        for name in compiler.STAGE_SQL_FILES:
            self.assertNotRegex(files[name], r"(?mi)^\s*(BEGIN|COMMIT|ROLLBACK)\s*;")
        table_sql = "\n".join(files[name] for name in compiler.DOMAIN_FILES.values())
        self.assertNotIn("ENABLE ROW LEVEL SECURITY", table_sql)
        self.assertNotIn("FORCE ROW LEVEL SECURITY", table_sql)
        security = files["080_security.sql"]
        self.assertEqual(security.count("ENABLE ROW LEVEL SECURITY"), 100)
        self.assertEqual(security.count("FORCE ROW LEVEL SECURITY"), 100)
        self.assertLess(payload.index("VALIDATE CONSTRAINT"), payload.index("ENABLE ROW LEVEL SECURITY"))

    def test_manifest_freezes_stage_byte_order_and_payload_checksum(self) -> None:
        model = load_model()
        canonical = json.dumps(
            model, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        files = compiler.render_phase1_files(
            compiler.build_phase1_plan(model),
            model_sha256=hashlib.sha256(canonical).hexdigest(),
        )
        manifest = json.loads(files["phase1-ddl-manifest.json"])
        self.assertEqual(manifest["manifest_version"], 2)
        self.assertEqual(
            [stage["name"] for stage in manifest["stages"]],
            compiler.STAGE_SQL_FILES,
        )
        payload = files["phase1.sql"].encode("utf-8")
        cursor = 0
        for stage in manifest["stages"]:
            self.assertEqual(stage["offset"], cursor)
            body = files[stage["name"]].encode("utf-8")
            self.assertEqual(stage["bytes"], len(body))
            self.assertEqual(stage["sha256"], hashlib.sha256(body).hexdigest())
            self.assertEqual(payload[cursor : cursor + len(body)], body)
            cursor += len(body)
        self.assertEqual(cursor, len(payload))
        self.assertEqual(manifest["payload"]["filename"], "phase1.sql")
        self.assertEqual(manifest["payload"]["bytes"], len(payload))
        self.assertEqual(
            manifest["payload"]["sha256"], hashlib.sha256(payload).hexdigest()
        )
        self.assertEqual(
            manifest["migration"],
            {
                "repository_code": "hotcrush_core_r6",
                "migration_version": "R6_PHASE1_BASELINE",
                "filename": "phase1.sql",
                "predecessors": [],
            },
        )


if __name__ == "__main__":
    unittest.main()
