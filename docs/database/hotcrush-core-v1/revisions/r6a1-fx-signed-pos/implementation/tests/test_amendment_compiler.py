from __future__ import annotations

import sys
import tempfile
import unittest
import copy
import hashlib
import json
import os
import subprocess
from pathlib import Path
from unittest import mock


IMPLEMENTATION_DIR = Path(__file__).resolve().parents[1]
REVISION_DIR = IMPLEMENTATION_DIR.parent
sys.path.insert(0, str(IMPLEMENTATION_DIR))

import amendment_bootstrap  # noqa: E402


compiler = amendment_bootstrap.load_compiler()


class AmendmentCompilerContractTests(unittest.TestCase):
    def test_stage_dag_and_blocked_boundaries_are_closed(self) -> None:
        self.assertEqual(
            tuple(compiler.STAGE_DAG),
            (
                "000_lock_baseline.sql",
                "010_new_and_semantic_rebuild.sql",
                "020_surgical_alters.sql",
                "030_constraints.sql",
                "040_fk_indexes.sql",
                "050_foreign_keys_not_valid.sql",
                "051_validate_foreign_keys.sql",
                "060_trigger_functions.sql",
                "061_constraint_triggers.sql",
                "070_security.sql",
                "080_comments.sql",
                "090_catalog_acceptance.sql",
                "099_physical_catalog_seal.sql",
            ),
        )
        self.assertEqual(
            compiler.BLOCKED_STAGE_REASONS,
            {
                "060_trigger_functions.sql": "TRIGGER_CONTRACT_NOT_APPROVED",
                "061_constraint_triggers.sql": "TRIGGER_CONTRACT_NOT_APPROVED",
                "090_catalog_acceptance.sql": "TARGET_PG_CATALOG_NOT_CAPTURED",
                "099_physical_catalog_seal.sql": "TARGET_PG_CATALOG_NOT_CAPTURED",
            },
        )
        for stage, predecessors in compiler.STAGE_DAG.items():
            self.assertEqual(tuple(predecessors), tuple(dict.fromkeys(predecessors)))
            self.assertTrue(all(name in compiler.STAGE_DAG for name in predecessors))
            self.assertTrue(all(list(compiler.STAGE_DAG).index(name) < list(compiler.STAGE_DAG).index(stage) for name in predecessors))

    def test_nontrigger_stages_render_deterministically_without_unblocking_release(self) -> None:
        first = compiler.render_nontrigger_stage_preview()
        second = compiler.render_nontrigger_stage_preview()
        self.assertEqual(first, second)
        self.assertEqual(
            set(first),
            {
                "000_lock_baseline.sql",
                "010_new_and_semantic_rebuild.sql",
                "020_surgical_alters.sql",
                "030_constraints.sql",
                "040_fk_indexes.sql",
                "050_foreign_keys_not_valid.sql",
                "051_validate_foreign_keys.sql",
                "070_security.sql",
                "080_comments.sql",
            },
        )
        for name, body in first.items():
            self.assertIsInstance(body, bytes)
            self.assertTrue(body.endswith(b"\n"), name)
            compiler.validate_stage_sql(name, body)
        manifest = compiler.build_candidate_manifest_skeleton()
        self.assertEqual(manifest["release_status"], "BLOCKED_TRIGGER_CONTRACT_NOT_APPROVED")
        self.assertEqual(manifest["payloads"], [])

    def test_nontrigger_stage_semantics_are_exact_and_complete(self) -> None:
        stages = {
            name: body.decode("utf-8")
            for name, body in compiler.render_nontrigger_stage_preview().items()
        }
        lock = stages["000_lock_baseline.sql"]
        self.assertEqual(lock.count('public."'), 100)
        self.assertEqual(lock.count("LOCK TABLE"), 1)
        rebuild = stages["010_new_and_semantic_rebuild.sql"]
        self.assertEqual(rebuild.count("DROP TABLE"), 3)
        self.assertEqual(rebuild.count("CREATE TABLE"), 8)
        self.assertNotIn("CASCADE", rebuild)
        alters = stages["020_surgical_alters.sql"]
        self.assertIn(
            'ALTER TABLE public."cost_card_recipe_version" DROP COLUMN "currency";',
            alters,
        )
        self.assertIn(
            'ALTER TABLE public."scm_supplier" RENAME COLUMN "default_currency" '
            'TO "default_quote_currency_code";',
            alters,
        )
        self.assertNotIn("SET DEFAULT 'MYR'", alters)
        constraints = stages["030_constraints.sql"]
        self.assertNotIn(
            'DROP CONSTRAINT "ck_cost_card_recipe_version__reference_sale_price__01"',
            constraints,
        )
        self.assertIn("NULLS NOT DISTINCT", constraints)
        indexes = stages["040_fk_indexes.sql"]
        self.assertEqual(indexes.count("CREATE INDEX"), 52)
        foreign_keys = stages["050_foreign_keys_not_valid.sql"]
        self.assertEqual(foreign_keys.count("ADD CONSTRAINT"), 56)
        self.assertEqual(foreign_keys.count("INITIALLY IMMEDIATE NOT VALID;"), 56)
        validates = stages["051_validate_foreign_keys.sql"]
        self.assertEqual(validates.count("VALIDATE CONSTRAINT"), 56)
        security = stages["070_security.sql"]
        self.assertEqual(security.count("REVOKE ALL PRIVILEGES ON TABLE"), 8)
        self.assertEqual(security.count("ENABLE ROW LEVEL SECURITY"), 8)
        self.assertEqual(security.count("FORCE ROW LEVEL SECURITY"), 8)
        comments = stages["080_comments.sql"]
        self.assertEqual(comments.count("COMMENT ON TABLE"), 105)
        self.assertEqual(comments.count("COMMENT ON COLUMN"), 1469)
        self.assertEqual(comments.count("COMMENT ON CONSTRAINT"), 973)
        self.assertEqual(comments.count("COMMENT ON INDEX"), 266)
        self.assertNotIn("COMMENT ON VIEW", comments)

    def test_compiler_manifest_hashes_the_bootstrap_injected_executed_bytes(self) -> None:
        inputs = compiler.capture_input_bytes()
        self.assertEqual(
            inputs.read(Path(compiler.__file__)),
            compiler.BOUND_COMPILER_SOURCE_BYTES,
        )
        manifest = compiler.build_input_manifest(inputs)
        self.assertEqual(
            manifest["compiler_sha256"],
            compiler._sha256(compiler.BOUND_COMPILER_SOURCE_BYTES),
        )
        self.assertEqual(
            manifest["compiler_execution_binding"],
            "BOOTSTRAP_COMPILE_EXEC_EXACT_BYTES",
        )

    def test_blocked_review_bundle_is_closed_deterministic_and_not_publishable(self) -> None:
        first = compiler.build_blocked_review_bundle()
        second = compiler.build_blocked_review_bundle()
        self.assertEqual(first, second)
        self.assertEqual(len(first), 20)
        compiler.validate_blocked_review_bundle(first)
        manifest = compiler._parse_json(
            first[compiler.PREVIEW_MANIFEST_NAME], label="preview manifest"
        )
        self.assertEqual(
            manifest["release_status"], "BLOCKED_TRIGGER_CONTRACT_NOT_APPROVED"
        )
        self.assertEqual(manifest["apply_compatibility"], "NOT_APPLY_COMPATIBLE")
        self.assertIsNone(manifest["target_pg_catalog_sha256"])
        self.assertEqual(len(manifest["payloads"]), 9)
        mutated = dict(first)
        name = "010_new_and_semantic_rebuild.sql"
        mutated[name] += b"-- forged\n"
        with self.assertRaises(compiler.CompilerContractError) as caught:
            compiler.validate_blocked_review_bundle(mutated)
        self.assertEqual(caught.exception.code, "review_bundle_drift")
        with tempfile.TemporaryDirectory() as raw_directory:
            destination = Path(raw_directory) / "generated"
            with self.assertRaises(compiler.CompilerContractError) as caught:
                compiler.publish_candidate_bundle(first, destination)
            self.assertEqual(caught.exception.code, "release_blocked")
            self.assertFalse(destination.exists())

    def test_atomic_publish_primitive_is_no_overwrite_and_symlink_safe(self) -> None:
        bundle = {"a.txt": b"one\n", "b.txt": b"two\n"}
        with tempfile.TemporaryDirectory() as raw_directory:
            base = Path(raw_directory).resolve()
            parent = base / "parent"
            parent.mkdir()
            destination = parent / "candidate"
            self.assertEqual(
                compiler._atomic_publish_exact_directory(bundle, destination),
                "PUBLISHED",
            )
            self.assertEqual(
                compiler._atomic_publish_exact_directory(bundle, destination),
                "NOOP",
            )
            with self.assertRaises(compiler.CompilerContractError) as caught:
                compiler._atomic_publish_exact_directory(
                    {**bundle, "a.txt": b"drift\n"}, destination
                )
            self.assertEqual(caught.exception.code, "publish_destination_drift")
            self.assertEqual((destination / "a.txt").read_bytes(), b"one\n")
            self.assertEqual(
                list(parent.glob(".r6a1-amendment-publish-*")), []
            )
            real_parent = base / "real"
            real_parent.mkdir()
            linked_parent = base / "linked"
            linked_parent.symlink_to(real_parent, target_is_directory=True)
            with self.assertRaises(compiler.CompilerContractError) as caught:
                compiler._atomic_publish_exact_directory(
                    bundle, linked_parent / "candidate"
                )
            self.assertEqual(caught.exception.code, "unsafe_publish_parent")
            self.assertFalse((real_parent / "candidate").exists())

    def test_atomic_publish_rejects_same_uid_temporary_path_substitution(self) -> None:
        bundle = {"a.txt": b"one\n", "b.txt": b"two\n"}
        real_rename = compiler._atomic_rename_no_replace

        def substitute_source(
            parent_descriptor: int, source_name: str, target_name: str
        ) -> None:
            stolen_name = f"{source_name}.stolen"
            os.rename(
                source_name,
                stolen_name,
                src_dir_fd=parent_descriptor,
                dst_dir_fd=parent_descriptor,
            )
            os.mkdir(source_name, 0o700, dir_fd=parent_descriptor)
            replacement = os.open(
                source_name,
                os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
                dir_fd=parent_descriptor,
            )
            try:
                evil = os.open(
                    "evil.txt",
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o600,
                    dir_fd=replacement,
                )
                try:
                    os.write(evil, b"evil\n")
                finally:
                    os.close(evil)
            finally:
                os.close(replacement)
            real_rename(parent_descriptor, source_name, target_name)

        with tempfile.TemporaryDirectory() as raw_directory:
            destination = Path(raw_directory).resolve() / "candidate"
            with (
                mock.patch.object(
                    compiler,
                    "_atomic_rename_no_replace",
                    side_effect=substitute_source,
                ),
                self.assertRaises(compiler.CompilerContractError) as caught,
            ):
                compiler._atomic_publish_exact_directory(bundle, destination)
            self.assertEqual(caught.exception.code, "publish_destination_identity_drift")

    def test_atomic_publish_rejects_in_place_payload_mutation_during_rename(self) -> None:
        bundle = {"a.txt": b"one\n", "b.txt": b"two\n"}
        real_rename = compiler._atomic_rename_no_replace

        def mutate_source(
            parent_descriptor: int, source_name: str, target_name: str
        ) -> None:
            source_descriptor = os.open(
                source_name,
                os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
                dir_fd=parent_descriptor,
            )
            try:
                payload = os.open(
                    "a.txt", os.O_WRONLY | os.O_TRUNC, dir_fd=source_descriptor
                )
                try:
                    os.write(payload, b"evil\n")
                finally:
                    os.close(payload)
            finally:
                os.close(source_descriptor)
            real_rename(parent_descriptor, source_name, target_name)

        with tempfile.TemporaryDirectory() as raw_directory:
            destination = Path(raw_directory).resolve() / "candidate"
            with (
                mock.patch.object(
                    compiler,
                    "_atomic_rename_no_replace",
                    side_effect=mutate_source,
                ),
                self.assertRaises(compiler.CompilerContractError) as caught,
            ):
                compiler._atomic_publish_exact_directory(bundle, destination)
            self.assertEqual(caught.exception.code, "publish_destination_drift")

    def test_stage_sql_red_lines_fail_closed(self) -> None:
        forbidden = (
            b"BEGIN;\n",
            b"COMMIT;\n",
            b"ALTER TABLE public.x DROP COLUMN y CASCADE;\n",
            b"CREATE INDEX CONCURRENTLY x ON public.y (z);\n",
            b"CREATE VIEW public.x AS SELECT 1;\n",
            b"TRUNCATE public.x;\n",
            b'WITH doomed AS (DELETE FROM public."x" RETURNING *) SELECT * FROM doomed;\n',
            b'COPY public."x" FROM PROGRAM \'id\';\n',
            b"ALTER SYSTEM SET search_path = 'public';\n",
            b"DROP SCHEMA public;\n",
            b'GRANT ALL ON TABLE public."x" TO PUBLIC;\n',
            b'CREATE TABLE public."x" AS SELECT 1;\n',
            b'SELECT 1 INTO public."x";\n',
        )
        for body in forbidden:
            with self.subTest(body=body):
                with self.assertRaises(compiler.CompilerContractError) as caught:
                    compiler.validate_stage_sql(
                        "010_new_and_semantic_rebuild.sql", body
                    )
                self.assertEqual(caught.exception.code, "unsafe_stage_sql")

    def test_stage_sql_exact_rerender_closes_the_target_inventory(self) -> None:
        approved = compiler.render_nontrigger_stage_preview()[
            "010_new_and_semantic_rebuild.sql"
        ]
        mutated = approved.replace(
            b'public."cost_card_material_price"',
            b'public."unknown_but_grammar_valid"',
            1,
        )
        self.assertNotEqual(mutated, approved)
        with self.assertRaises(compiler.CompilerContractError) as caught:
            compiler.validate_stage_sql(
                "010_new_and_semantic_rebuild.sql",
                mutated,
                exact_rerender=approved,
            )
        self.assertEqual(caught.exception.code, "unsafe_stage_sql")

    def test_direct_cli_requires_byte_carrying_bootstrap(self) -> None:
        direct = subprocess.run(
            [sys.executable, str(IMPLEMENTATION_DIR / "amendment_compiler.py"), "check"],
            cwd=IMPLEMENTATION_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        self.assertEqual(direct.returncode, 2)
        self.assertIn("unbound_compiler_source", direct.stderr)
        bootstrapped = subprocess.run(
            [sys.executable, str(IMPLEMENTATION_DIR / "amendment_bootstrap.py"), "check"],
            cwd=IMPLEMENTATION_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        self.assertEqual(bootstrapped.returncode, 2)
        self.assertIn("trigger_contract_not_approved", bootstrapped.stderr)
    def test_frozen_inputs_are_exact(self) -> None:
        pins = compiler.verify_frozen_inputs()
        self.assertEqual(
            pins["baseline_phase1_payload_sha256"],
            "0cdb26dbf255022997c3e167a28f12709b4c73c4ad75d364ed312ff37843176d",
        )
        self.assertEqual(
            pins["baseline_catalog_sha256"],
            "a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea",
        )
        self.assertEqual(
            pins["revision_manifest_sha256"],
            "3cda29b9025c40b6dabd1febb70cc3bd280c661ece23a88de5abe47746d1a296",
        )
        self.assertEqual(
            pins["resolved_model_sha256"],
            "bec984e2658401d7344191f2c0d9bd3eb4423fc592ae518c0fe83bf0b1964847",
        )
        self.assertEqual(
            pins["design_catalog_sha256"],
            "09ecdb9697d4e43296051c89dd3e8b568c07e8d189a38fd8cc8036ea04fdee91",
        )
        self.assertEqual(
            pins["baseline_raw_model_sha256"],
            "7bd5a71b010ad89427d918b842a18c4c34e23085cef0543cad14703d097c187b",
        )
        self.assertEqual(
            pins["baseline_canonical_model_sha256"],
            "52b1e84ae5cfa16871a058adaca3d1482d91460f7aad6f99186cab5b7e4ed986",
        )
        self.assertEqual(
            pins["baseline_manifest_sha256"],
            "f03ebd6d66462d8720f85a59642769d4655cd6597343401dcf5f4dc62dd0dc66",
        )

    def test_baseline_manifest_internal_bindings_are_closed_and_type_sensitive(self) -> None:
        inputs = compiler.capture_input_bytes()
        manifest = compiler._parse_json(
            inputs.read(compiler.BASELINE_MANIFEST_PATH), label="baseline manifest"
        )
        compiler.validate_baseline_predecessor_bindings(manifest, inputs)
        mutations = [
            ("inputs", "raw_model_sha256", "0" * 64),
            ("inputs", "canonical_model_sha256", "0" * 64),
            ("inputs", "compiler_sha256", "0" * 64),
            ("inputs", "review_package_sha256", "0" * 64),
            ("payload", "sha256", "0" * 64),
            ("payload", "bytes", False),
            ("migration", "migration_version", "WRONG"),
            ("migration", "predecessors", ["WRONG"]),
            ("validation_runtime", "postgres_image", "postgres:latest"),
            ("validation_runtime", "repo_digest", "sha256:" + "0" * 64),
        ]
        for section, key, value in mutations:
            mutated = copy.deepcopy(manifest)
            mutated[section][key] = value
            with self.subTest(section=section, key=key), self.assertRaises(
                compiler.CompilerContractError
            ) as caught:
                compiler.validate_baseline_predecessor_bindings(mutated, inputs)
            self.assertEqual(caught.exception.code, "baseline_predecessor_binding_drift")

    def test_one_immutable_byte_snapshot_drives_all_plan_validation(self) -> None:
        inputs = compiler.capture_input_bytes()
        with self.assertRaises(TypeError):
            inputs.files[compiler.OVERLAY_PATH.resolve()] = b"{}"  # type: ignore[index]
        with mock.patch.object(
            compiler,
            "_read_regular_file",
            side_effect=AssertionError("later disk read"),
        ):
            plan = compiler.build_amendment_plan(inputs)
            manifest_inputs = compiler.build_input_manifest(inputs)
        self.assertEqual(plan.target_counts["tables"], 105)
        self.assertEqual(
            manifest_inputs["resolved_model_sha256"],
            "bec984e2658401d7344191f2c0d9bd3eb4423fc592ae518c0fe83bf0b1964847",
        )

    def test_pinned_reader_rejects_symlink_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            regular = directory / "regular.json"
            link = directory / "link.json"
            regular.write_bytes(b"{}")
            link.symlink_to(regular)
            with self.assertRaises(compiler.CompilerContractError) as caught:
                compiler._read_regular_file(link)
        self.assertEqual(caught.exception.code, "unsafe_input")

    def test_candidate_manifest_is_closed_and_explicitly_unsealed(self) -> None:
        manifest = compiler.build_candidate_manifest_skeleton()
        self.assertEqual(
            manifest["release_status"], "BLOCKED_TRIGGER_CONTRACT_NOT_APPROVED"
        )
        self.assertEqual(manifest["apply_compatibility"], "NOT_APPLY_COMPATIBLE")
        self.assertEqual(manifest["trigger_contract_status"], "NOT_APPROVED")
        self.assertIsNone(manifest["target_pg_catalog_sha256"])
        self.assertEqual(manifest["payloads"], [])
        self.assertEqual(
            manifest["foreign_key_contract"],
            {
                "full_target_count": 332,
                "target_only_count": 53,
                "baseline_only_count": 10,
                "net_delta": 43,
            },
        )
        self.assertEqual(
            manifest["support_index_contract"],
            {
                "full_target_count": 266,
                "target_only_count": 50,
                "baseline_only_count": 8,
                "net_delta": 42,
            },
        )

    def test_trigger_contract_v2_is_closed_body_free_and_bound_to_resealed_model(self) -> None:
        contract = compiler.load_trigger_contract()
        raw = compiler.TRIGGER_CONTRACT_PATH.read_bytes()
        self.assertEqual(contract["schema_version"], 2)
        self.assertEqual(contract["artifact_kind"], "R6A1_TRIGGER_CONTRACT")
        self.assertEqual(
            contract["decision_status"], "APPROVED_CANDIDATE_AFTER_MODEL_RESEAL"
        )
        self.assertEqual(
            contract["model_binding_status"], "MODEL_RESEALED_AND_BOUND"
        )
        self.assertEqual(contract["catalog_status"], "NOT_COMPILED")
        self.assertEqual(contract["activation_status"], "NOT_ACTIVATED")
        self.assertEqual(
            contract["resolved_model_sha256"],
            "72c68f5961cbf2c6456cf61d39d3b3e8188f458de90c88ef7c1afaac4be80a7f",
        )
        self.assertEqual(len(contract["routine_contracts"]), 27)
        self.assertEqual(len(contract["trigger_contracts"]), 22)
        self.assertEqual(len(contract["action_registry"]), 5)
        self.assertEqual(contract["inventory"]["runtime_nonowner_execute_grant_count"], 0)
        self.assertEqual(
            contract["release_blockers"],
            [
                "CATALOG_CAPTURE_REQUIRED",
                "ACTIVATION_MIGRATION_REQUIRED",
                "DEDICATED_CONNECTOR_REQUIRED",
                "LATEST_SIGNED_S0_CONSERVATION_REQUIRED",
            ],
        )
        self.assertEqual(hashlib.sha256(raw).hexdigest(), compiler.TRIGGER_CONTRACT_RAW_SHA256)
        self.assertEqual(len(raw), compiler.TRIGGER_CONTRACT_BYTES)
        self.assertEqual(
            hashlib.sha256(
                json.dumps(
                    contract, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                ).encode("utf-8")
            ).hexdigest(),
            compiler.TRIGGER_CONTRACT_COMPACT_SHA256,
        )
        self.assertEqual(
            compiler.TRIGGER_CONTRACT_SIDECAR_PATH.read_bytes(),
            f"{compiler.TRIGGER_CONTRACT_RAW_SHA256}  trigger-contract.json\n".encode(
                "ascii"
            ),
        )

        forbidden_keys = {"body", "definition", "prosrc", "sql", "ddl"}

        def walk(value):
            if isinstance(value, dict):
                self.assertTrue(forbidden_keys.isdisjoint(value))
                for nested in value.values():
                    walk(nested)
            elif isinstance(value, list):
                for nested in value:
                    walk(nested)

        walk(contract)
        identities = {row["identity"] for row in contract["routine_contracts"]}
        self.assertNotIn("public.r6a1_dispatch_app_currency_trigger()", identities)
        self.assertIn(
            "public.r6a1_verify_material_price_observation_v1(pg_catalog.text,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.timestamptz,pg_catalog.uuid,pg_catalog.text,pg_catalog.jsonb)",
            identities,
        )

        forged = copy.deepcopy(contract)
        forged["routine_contracts"][0]["identity"] = (
            "public.r6a1_dispatch_finance_accounting_entity_trigger()"
        )
        forged_bytes = (
            json.dumps(forged, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        with self.assertRaises(compiler.CompilerContractError) as alias:
            compiler.validate_trigger_contract_bytes(forged_bytes)
        self.assertEqual(alias.exception.code, "invalid_trigger_contract")

        noncanonical = json.dumps(contract, ensure_ascii=False).encode("utf-8")
        with self.assertRaises(compiler.CompilerContractError) as canonical:
            compiler.validate_trigger_contract_bytes(noncanonical)
        self.assertEqual(canonical.exception.code, "invalid_trigger_contract")

    def test_plan_is_derived_from_exact_31_table_contracts(self) -> None:
        plan = compiler.build_amendment_plan()
        self.assertEqual(len(plan.affected_tables), 31)
        self.assertEqual(len(plan.new_tables), 5)
        self.assertEqual(
            set(plan.semantic_rebuilds),
            {
                "cost_card_material_cost_selection",
                "pos_order_item",
                "scm_material_price_observation",
            },
        )
        self.assertEqual(
            set(plan.surgical_alters),
            {"cost_card_recipe_version", "ops_location"},
        )
        self.assertEqual(len(plan.added_foreign_keys), 53)
        self.assertEqual(len(plan.removed_foreign_keys), 10)
        self.assertEqual(plan.foreign_key_net_delta, 43)
        self.assertEqual(len(plan.added_support_indexes), 50)
        self.assertEqual(len(plan.removed_support_indexes), 8)
        self.assertEqual(plan.support_index_net_delta, 42)
        self.assertEqual(
            set(plan.new_tables),
            {
                "app_currency",
                "finance_accounting_entity",
                "finance_currency_assignment",
                "finance_currency_policy",
                "finance_fx_rate_observation",
            },
        )

    def test_target_counts_and_unique_subtypes_are_independently_recomputed(self) -> None:
        plan = compiler.build_amendment_plan()
        self.assertEqual(
            plan.target_counts,
            {
                "tables": 105,
                "columns": 1469,
                "primary_keys": 105,
                "unique_constraints": 112,
                "checks": 403,
                "exclusions": 21,
                "foreign_keys": 332,
                "foreign_key_indexes": 266,
                "catalog_total_indexes": 504,
                "table_comments": 105,
                "column_comments": 1469,
                "constraint_comments": 973,
                "index_comments": 266,
                "sql_views": 0,
            },
        )
        self.assertEqual(
            plan.unique_subtypes,
            {"ordinary": 87, "nulls_distinct": 15, "nulls_not_distinct": 10},
        )

    def test_model_delta_planner_preserves_exact_rebuild_and_surgical_boundaries(self) -> None:
        plan = compiler.build_amendment_plan()
        deltas = {row.object_name: row for row in plan.table_deltas}
        self.assertEqual(set(deltas), {table["name"] for table in plan.affected_tables})
        self.assertEqual(
            deltas["cost_card_material_cost_selection"].operation,
            "RENAME_AND_REPLACE_TABLE",
        )
        self.assertEqual(
            deltas["scm_material_price_observation"].baseline_object_name,
            "scm_supplier_price_observation",
        )
        self.assertEqual(
            deltas["cost_card_recipe_version"].removed_fields,
            ("currency", "reference_sale_price"),
        )
        self.assertEqual(
            deltas["ops_location"].removed_fields,
            ("default_currency",),
        )
        self.assertEqual(
            deltas["scm_supplier"].removed_fields,
            ("default_currency",),
        )
        self.assertEqual(
            deltas["scm_supplier"].added_fields,
            ("default_quote_currency_code",),
        )
        self.assertEqual(
            deltas["pos_order_item"].removed_fields,
            ("quantity", "source_row_count"),
        )

    def test_rendering_is_blocked_until_exact_trigger_inventory_is_approved(self) -> None:
        with self.assertRaises(compiler.CompilerContractError) as caught:
            compiler.build_candidate_bundle()
        self.assertEqual(caught.exception.code, "trigger_contract_not_approved")

    def test_amendment_does_not_modify_frozen_predecessors(self) -> None:
        before = compiler.frozen_input_snapshot()
        with self.assertRaises(compiler.CompilerContractError) as caught:
            compiler.build_candidate_bundle()
        self.assertEqual(caught.exception.code, "trigger_contract_not_approved")
        self.assertEqual(compiler.frozen_input_snapshot(), before)


if __name__ == "__main__":
    unittest.main()
