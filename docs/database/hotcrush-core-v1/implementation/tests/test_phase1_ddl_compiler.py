from __future__ import annotations

import copy
import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path


IMPLEMENTATION_DIR = Path(__file__).resolve().parents[1]
BLUEPRINT_DIR = IMPLEMENTATION_DIR.parent
MODEL_PATH = BLUEPRINT_DIR / "target-model.json"
sys.path.insert(0, str(IMPLEMENTATION_DIR))

import phase1_ddl_compiler as compiler  # noqa: E402


def load_repository_model() -> dict:
    return json.loads(MODEL_PATH.read_text(encoding="utf-8"))


def model_with_approved_p0_checks() -> dict:
    return copy.deepcopy(load_repository_model())


class Phase1DDLCompilerTests(unittest.TestCase):
    def test_repository_model_state_is_explicit(self) -> None:
        plan = compiler.build_phase1_plan(load_repository_model())
        self.assertEqual(plan.counts["columns"], 1374)
        self.assertEqual(plan.counts["checks"], 332)

    def test_compiles_exact_phase1_contract_after_model_gate_is_closed(self) -> None:
        plan = compiler.build_phase1_plan(model_with_approved_p0_checks())
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
        self.assertEqual(len(plan.tables), 100)
        self.assertTrue(all(t["lifecycle"] == "CORE_MIGRATION" for t in plan.tables))
        self.assertEqual(plan.counts["views"], 0)

    def test_unknown_type_default_check_and_exclusion_fail_closed(self) -> None:
        mutations = (
            ("data_type", lambda m: m["tables"][0]["fields"][0].__setitem__("data_type", "xml")),
            ("default", lambda m: m["tables"][0]["fields"][0].__setitem__("default", "uuid_generate_v4()")),
            ("check", lambda m: m["tables"][0]["checks"].append("pg_sleep(1) = 0")),
            ("exclusion", lambda m: m["tables"][0]["exclusions"].append("NO_OVERLAP(unknown)")),
        )
        for label, mutate in mutations:
            with self.subTest(label=label):
                model = model_with_approved_p0_checks()
                mutate(model)
                with self.assertRaises(compiler.ModelContractError):
                    compiler.build_phase1_plan(model)

    def test_string_defaults_are_compatible_with_exact_types_only(self) -> None:
        cases = (
            ("app_source_system", "status", "time"),
            ("ops_location", "country_code", "char(64)"),
            ("ops_location", "default_currency", "char(2)"),
        )
        for table_name, field_name, wrong_type in cases:
            with self.subTest(table=table_name, field=field_name, wrong_type=wrong_type):
                model = model_with_approved_p0_checks()
                table = next(t for t in model["tables"] if t["name"] == table_name)
                field = next(f for f in table["fields"] if f["name"] == field_name)
                field["data_type"] = wrong_type
                with self.assertRaisesRegex(
                    compiler.ModelContractError, "default|Default|type"
                ):
                    compiler.build_phase1_plan(model)

    def test_generation_is_byte_deterministic(self) -> None:
        model = model_with_approved_p0_checks()
        model_bytes = json.dumps(
            model, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        model_sha256 = hashlib.sha256(model_bytes).hexdigest()
        plan = compiler.build_phase1_plan(model)
        first = compiler.render_phase1_files(plan, model_sha256=model_sha256)
        second = compiler.render_phase1_files(plan, model_sha256=model_sha256)
        self.assertEqual(first, second)
        self.assertNotIn("020_views.sql", first)
        self.assertEqual(sorted(first), compiler.EXPECTED_OUTPUT_FILES)
        for path, body in first.items():
            self.assertTrue(body.endswith("\n"), path)

    def test_frozen_fk_security_naming_and_comment_contracts(self) -> None:
        model = model_with_approved_p0_checks()
        plan = compiler.build_phase1_plan(model)
        model_sha = hashlib.sha256(
            json.dumps(model, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        files = compiler.render_phase1_files(plan, model_sha256=model_sha)
        fk_sql = files["040_foreign_keys_not_valid.sql"]
        self.assertEqual(
            fk_sql.count(
                "ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE NOT VALID;"
            ),
            289,
        )
        self.assertNotIn("ON DELETE RESTRICT", fk_sql)
        self.assertEqual(fk_sql.count("orphan rows before FK"), 289)
        self.assertIn('"fk_app_unit__canonical_unit_id__app_unit"', fk_sql)
        self.assertIn(
            'FOREIGN KEY ("reward_stock_id", "reward_id")',
            fk_sql,
        )
        self.assertIn(
            'REFERENCES public."mkt_reward_stock" ("reward_stock_id", "reward_id") MATCH SIMPLE',
            fk_sql,
        )
        self.assertIn(
            '"fk_mkt_reward_claim__reward_stock_id__reward_id__mkt_0f44d1b776"',
            fk_sql,
        )

        index_sql = files["030_fk_indexes.sql"]
        self.assertEqual(index_sql.count("CREATE INDEX"), 224)
        self.assertIn('"ix_app_unit__created_by_user_id__fk"', index_sql)
        self.assertIn(
            '"ix_mkt_reward_claim__reward_stock_id__reward_id__fk"',
            index_sql,
        )

        table_sql = "\n".join(files[name] for name in compiler.DOMAIN_FILES.values())
        self.assertNotIn("uqnnd", table_sql)
        self.assertNotIn("uqnd", table_sql)
        self.assertEqual(table_sql.count("UNIQUE NULLS NOT DISTINCT"), 9)
        self.assertEqual(table_sql.count("UNIQUE NULLS DISTINCT"), 15)
        denied_grantees = ", ".join(
            [
                "PUBLIC",
                *(compiler._q(role) for role in compiler.DEFAULT_DENY_ROLES),
            ]
        )
        security = files["080_security.sql"]
        table_revoke_lines = [
            line
            for line in security.splitlines()
            if line.startswith("REVOKE ALL PRIVILEGES ON TABLE")
        ]
        self.assertEqual(len(table_revoke_lines), 100)
        self.assertTrue(
            all(line.endswith(f"FROM {denied_grantees};") for line in table_revoke_lines)
        )

        bootstrap = files["001_bootstrap.sql"]
        self.assertIn("SET search_path = pg_catalog, public", bootstrap)
        self.assertNotIn("CREATE ROLE", bootstrap)
        self.assertNotIn("GRANT \"hc_r6_", bootstrap)
        self.assertNotIn("hc_r6_", files["phase1.sql"])
        self.assertNotIn("SET LOCAL ROLE", files["phase1.sql"])
        self.assertNotIn("ALTER DEFAULT PRIVILEGES", files["phase1.sql"])
        self.assertIn(
            "REVOKE EXECUTE ON FUNCTION public.app_normalize_alias_v1(pg_catalog.text) "
            f"FROM {denied_grantees};",
            bootstrap,
        )
        self.assertIn("COMMENT ON FUNCTION public.app_normalize_alias_v1(pg_catalog.text)", bootstrap)
        self.assertIn(
            f"REVOKE CREATE ON SCHEMA public FROM {denied_grantees};",
            bootstrap,
        )
        self.assertIn(
            f"GRANT USAGE ON SCHEMA public TO {denied_grantees};",
            bootstrap,
        )

        preflight = files["000_preflight.sql"]
        self.assertIn("role.rolbypassrls", preflight)
        self.assertNotIn("role.rolcreaterole", preflight)

        acceptance = files["099_catalog_acceptance.sql"]
        self.assertIn("table owners: expected 100", acceptance)
        self.assertIn("FK index owners: expected 224", acceptance)
        self.assertIn("helper owner/behavior contract is missing or unsafe", acceptance)
        self.assertIn("runtime schema USAGE without CREATE", acceptance)
        self.assertIn("PUBLIC schema USAGE without CREATE", acceptance)
        self.assertIn("helper execute privilege must remain revoked", acceptance)
        self.assertIn("runtime roles must have zero effective table privileges", acceptance)
        self.assertIn("must not create HOT CRUSH custom roles", acceptance)

        manifest = json.loads(files["phase1-ddl-manifest.json"])
        self.assertEqual(manifest["roles"], [])
        self.assertEqual(manifest["forbidden_role_pattern"], "^hc_r6_")
        self.assertEqual(
            manifest["validation_runtime"],
            {
                "postgres_image": "postgres:17.6-alpine",
                "repo_digest": "sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94",
            },
        )
        self.assertEqual(
            manifest["compiler_version"],
            "R6_PHASE1_COMPILER_V4_P0C_EXECUTOR_OWNER",
        )
        self.assertEqual(
            manifest["future_security_registry"],
            {
                "status": "DEFERRED_NOT_EXECUTED",
                "requires_platform_superuser_bootstrap": True,
                "role_names": list(compiler.FUTURE_BUSINESS_ROLE_NAMES),
            },
        )

        comments = files["090_comments.sql"]
        self.assertEqual(comments.count("COMMENT ON CONSTRAINT"), 842)
        self.assertEqual(comments.count("COMMENT ON INDEX"), 224)

    def test_write_then_check_detects_drift_without_database_access(self) -> None:
        model = model_with_approved_p0_checks()
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            compiler.generate_from_model(model, output)
            compiler.verify_generated_from_model(model, output)
            drifted = output / "030_fk_indexes.sql"
            drifted.write_text(
                drifted.read_text(encoding="utf-8") + "-- drift\n",
                encoding="utf-8",
            )
            with self.assertRaises(compiler.GeneratedArtifactDrift):
                compiler.verify_generated_from_model(model, output)

    def test_generation_refuses_existing_manifest_drift_without_overwrite(self) -> None:
        model = model_with_approved_p0_checks()
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "generated"
            compiler.generate_from_model(model, output)
            manifest = output / "phase1-ddl-manifest.json"
            manifest.write_text(
                manifest.read_text(encoding="utf-8") + " ",
                encoding="utf-8",
            )
            before = {path.name: path.read_bytes() for path in output.iterdir()}
            with self.assertRaises(compiler.GeneratedArtifactDrift):
                compiler.generate_from_model(model, output)
            after = {path.name: path.read_bytes() for path in output.iterdir()}
            self.assertEqual(before, after)

    def test_cli_generate_and_check_are_repeatable(self) -> None:
        model = model_with_approved_p0_checks()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model_path = root / "target-model.json"
            output = root / "generated"
            model_path.write_text(
                json.dumps(model, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                self.assertEqual(
                    compiler.main(
                        [
                            "generate",
                            "--model",
                            str(model_path),
                            "--output",
                            str(output),
                        ]
                    ),
                    0,
                )
                first = {
                    path.name: path.read_bytes()
                    for path in output.iterdir()
                    if path.is_file()
                }
                self.assertEqual(
                    compiler.main(
                        [
                            "generate",
                            "--model",
                            str(model_path),
                            "--output",
                            str(output),
                        ]
                    ),
                    0,
                )
                second = {
                    path.name: path.read_bytes()
                    for path in output.iterdir()
                    if path.is_file()
                }
                self.assertEqual(first, second)
                self.assertEqual(
                    compiler.main(
                        [
                            "check",
                            "--model",
                            str(model_path),
                            "--output",
                            str(output),
                        ]
                    ),
                    0,
                )
            self.assertIn(
                f"generated {len(compiler.EXPECTED_OUTPUT_FILES)} immutable artifacts",
                stdout.getvalue(),
            )
            self.assertIn(
                f"verified {len(compiler.EXPECTED_OUTPUT_FILES)} immutable artifacts",
                stdout.getvalue(),
            )


if __name__ == "__main__":
    unittest.main()
