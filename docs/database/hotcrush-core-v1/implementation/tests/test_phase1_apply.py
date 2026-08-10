from __future__ import annotations

import contextlib
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


IMPLEMENTATION_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = IMPLEMENTATION_DIR.parent / "target-model.json"
sys.path.insert(0, str(IMPLEMENTATION_DIR))

import phase1_apply as apply  # noqa: E402
import phase1_ddl_compiler as compiler  # noqa: E402
from phase1_catalog import CatalogContractError  # noqa: E402


LOCAL_DSN = (
    "host=127.0.0.1 port=55432 dbname=hotcrush_r6_phase1_scratch "
    "user=postgres password=localonly sslmode=disable"
)
CATALOG_SENTINEL = {"contract_version": 1, "sentinel": "detached"}


def build_bundle(root: Path) -> tuple[Path, Path]:
    model = compiler.load_model(MODEL_PATH)
    output = root / "bundle"
    compiler.generate_from_model(model, output)
    contract = root / apply.CATALOG_CONTRACT_FILENAME
    contract.write_bytes(b"{}")
    return output, contract


def release_pins(bundle: Path, contract: Path) -> dict[str, apply.release.ArtifactPin]:
    paths = {
        "phase1-ddl-manifest.json": bundle / "phase1-ddl-manifest.json",
        "phase1.sql": bundle / "phase1.sql",
        apply.CATALOG_CONTRACT_FILENAME: contract,
    }
    return {
        name: apply.release.ArtifactPin(name, path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest())
        for name, path in paths.items()
    }


@contextlib.contextmanager
def sealed_artifacts(bundle: Path, contract: Path):
    with (
        mock.patch.object(apply.release, "ARTIFACT_PINS", release_pins(bundle, contract)),
        mock.patch.object(
            apply,
            "parse_catalog_contract_bytes",
            autospec=True,
            return_value=CATALOG_SENTINEL,
        ) as parser,
    ):
        yield parser


class FakeCursor:
    def __init__(
        self,
        *,
        ledger_exists: bool = False,
        ledger_rows: list[tuple[str, str, str]] | None = None,
        guard_row: tuple[object, ...] = ("r", "postgres", False, False),
        guard_count: tuple[int] = (0,),
        fail_stage: str | None = None,
    ) -> None:
        self.ledger_exists = ledger_exists
        self.ledger_rows = ledger_rows or []
        self.guard_row = guard_row
        self.guard_count = guard_count
        self.fail_stage = fail_stage
        self.executions: list[tuple[str, object]] = []
        self._result: object = None

    def execute(self, sql: str, params: object = None) -> None:
        self.executions.append((sql, params))
        if self.fail_stage and sql.startswith(f"-- HOT CRUSH Core V1 R6 / {self.fail_stage}"):
            raise RuntimeError("secret database failure")
        if "server_version_num" in sql and "rolbypassrls" in sql:
            self._result = (170006, "postgres", False, False, True, True, True)
        elif "to_regclass('public.app_schema_migration')" in sql:
            self._result = ("app_schema_migration" if self.ledger_exists else None,)
        elif "SELECT migration_version, filename" in sql:
            self._result = self.ledger_rows
        elif "relation.relname = 'app_schema_migration'" in sql:
            self._result = self.guard_row
        elif "SELECT pg_catalog.count(*)" in sql and "FROM public.app_schema_migration" in sql:
            self._result = self.guard_count
        elif "RETURNING migration_version" in sql:
            self._result = ("R6_PHASE1_BASELINE",)
        else:
            self._result = None

    def fetchone(self):
        if isinstance(self._result, list):
            return self._result[0] if self._result else None
        return self._result

    def fetchall(self):
        return self._result if isinstance(self._result, list) else []

    def close(self) -> None:
        return None


class FakeConnection:
    def __init__(self, cursor: FakeCursor, *, fail_commit: bool = False) -> None:
        self._cursor = cursor
        self.fail_commit = fail_commit
        self.autocommit = True
        self.commits = 0
        self.rollbacks = 0
        self.closed = 0

    def cursor(self) -> FakeCursor:
        return self._cursor

    def commit(self) -> None:
        self.commits += 1
        if self.fail_commit:
            raise RuntimeError("connection lost during commit")

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        self.closed += 1


class Phase1TargetSafetyTests(unittest.TestCase):
    def test_remote_dsn_allows_only_green_direct_or_session_pooler(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ca = Path(tmp) / "supabase-ca.pem"
            ca.write_text("test ca", encoding="utf-8")
            direct = apply.validate_dsn(
                "host=db.tmmkknnkcptunxbfjxqn.supabase.co port=5432 "
                "dbname=postgres user=postgres password=topsecret "
                f"sslmode=verify-full sslrootcert={ca}",
                local_scratch=False,
            )
            self.assertEqual(direct.project_ref, "tmmkknnkcptunxbfjxqn")
            self.assertNotIn("topsecret", repr(direct))
            pooler = apply.validate_dsn(
                "host=aws-0-us-east-1.pooler.supabase.com port=5432 "
                "dbname=postgres user=postgres.tmmkknnkcptunxbfjxqn password=topsecret "
                f"sslmode=verify-full sslrootcert={ca}",
                local_scratch=False,
            )
            self.assertEqual(pooler.mode, "remote_session_pooler")

    def test_dsn_rejects_source_unknown_transaction_pooler_and_routing_bypass(self) -> None:
        cases = (
            (
                "host=db.ecsgqcmwtjmcpzqytdqw.supabase.co port=5432 dbname=postgres "
                "user=postgres password=x sslmode=verify-full sslrootcert=/tmp/ca",
                "forbidden_source_project",
            ),
            (
                "host=db.aaaaaaaaaaaaaaaaaaaa.supabase.co port=5432 dbname=postgres "
                "user=postgres password=x sslmode=verify-full sslrootcert=/tmp/ca",
                "unapproved_target",
            ),
            (
                "host=aws-0-us-east-1.pooler.supabase.com port=6543 dbname=postgres "
                "user=postgres.tmmkknnkcptunxbfjxqn password=x sslmode=verify-full sslrootcert=/tmp/ca",
                "unapproved_target",
            ),
            (
                "host=127.0.0.1,127.0.0.2 port=5432 dbname=postgres user=postgres password=x sslmode=disable",
                "unsafe_dsn",
            ),
            (
                "host=db.tmmkknnkcptunxbfjxqn.supabase.co hostaddr=127.0.0.1 port=5432 "
                "dbname=postgres user=postgres password=x sslmode=verify-full sslrootcert=/tmp/ca",
                "unsafe_dsn",
            ),
            ("service=hidden", "unsafe_dsn"),
        )
        for dsn, code in cases:
            with self.subTest(code=code):
                with self.assertRaises(apply.ApplySafetyError) as caught:
                    apply.validate_dsn(dsn, local_scratch=False)
                self.assertEqual(caught.exception.code, code)
                self.assertNotIn("password", str(caught.exception).lower())

    def test_local_scratch_requires_flag_numeric_loopback_and_fixed_database(self) -> None:
        target = apply.validate_dsn(LOCAL_DSN, local_scratch=True)
        self.assertEqual(target.mode, "local_scratch")
        for unsafe, flag in (
            (LOCAL_DSN, False),
            (LOCAL_DSN.replace("127.0.0.1", "localhost"), True),
            (LOCAL_DSN.replace("hotcrush_r6_phase1_scratch", "postgres"), True),
        ):
            with self.assertRaises(apply.ApplySafetyError):
                apply.validate_dsn(unsafe, local_scratch=flag)


class Phase1ReleaseSnapshotTests(unittest.TestCase):
    def test_repository_release_seal_matches_all_final_artifacts(self) -> None:
        bundle = IMPLEMENTATION_DIR / "generated"
        contract = IMPLEMENTATION_DIR / apply.CATALOG_CONTRACT_FILENAME
        verified = apply.verify_artifact_bundle(bundle, contract)
        self.assertEqual(
            verified.payload_sha256,
            "0cdb26dbf255022997c3e167a28f12709b4c73c4ad75d364ed312ff37843176d",
        )
        self.assertEqual(
            verified.catalog_contract_sha256,
            "a3308bfe34499d3484f97bed744b101915a9a1c105c919f8c056ee8940d3c2ea",
        )

    def test_unsealed_release_is_rejected_before_connect(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bundle, contract = build_bundle(Path(tmp))
            connect = mock.Mock()
            unsealed = {
                name: apply.release.ArtifactPin(name, 0, "")
                for name in apply.release.ARTIFACT_PINS
            }
            with mock.patch.object(apply.release, "ARTIFACT_PINS", unsealed):
                with self.assertRaises(apply.ApplySafetyError) as caught:
                    apply.apply_phase1(
                        dsn=LOCAL_DSN,
                        bundle_dir=bundle,
                        catalog_contract_path=contract,
                        applied_by="test",
                        local_scratch=True,
                        connect=connect,
                    )
            self.assertEqual(caught.exception.code, "release_unsealed")
            connect.assert_not_called()

    def test_payload_tamper_and_stage_symlink_are_rejected_before_connect(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bundle, contract = build_bundle(Path(tmp))
            pins = release_pins(bundle, contract)
            (bundle / "phase1.sql").write_bytes((bundle / "phase1.sql").read_bytes() + b" ")
            with mock.patch.object(apply.release, "ARTIFACT_PINS", pins):
                with self.assertRaises(apply.ApplySafetyError) as caught:
                    apply.apply_phase1(
                        dsn=LOCAL_DSN,
                        bundle_dir=bundle,
                        catalog_contract_path=contract,
                        applied_by="test",
                        local_scratch=True,
                        connect=mock.Mock(),
                    )
            self.assertEqual(caught.exception.code, "artifact_mismatch")

        with tempfile.TemporaryDirectory() as tmp:
            bundle, contract = build_bundle(Path(tmp))
            target = bundle / "000_preflight.sql"
            original = target.with_suffix(".original")
            target.rename(original)
            target.symlink_to(original)
            with mock.patch.object(apply.release, "ARTIFACT_PINS", release_pins(bundle, contract)):
                with self.assertRaises(apply.ApplySafetyError) as caught:
                    apply.verify_artifact_bundle(bundle, contract)
            self.assertEqual(caught.exception.code, "artifact_mismatch")

    def test_snapshot_bytes_are_used_after_connect_side_effect_mutates_disk(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bundle, contract = build_bundle(Path(tmp))
            manifest = json.loads((bundle / "phase1-ddl-manifest.json").read_text())
            first_stage = (bundle / manifest["stages"][0]["name"]).read_text()
            cursor = FakeCursor()
            connection = FakeConnection(cursor)

            def connect(**kwargs: object) -> FakeConnection:
                (bundle / "phase1.sql").write_text("tampered after snapshot", encoding="utf-8")
                contract.write_text("tampered after snapshot", encoding="utf-8")
                return connection

            with sealed_artifacts(bundle, contract), mock.patch.object(
                apply, "verify_catalog_contract", return_value="catalog-fingerprint"
            ):
                result = apply.apply_phase1(
                    dsn=LOCAL_DSN,
                    bundle_dir=bundle,
                    catalog_contract_path=contract,
                    applied_by="test",
                    local_scratch=True,
                    connect=connect,
                )
            self.assertEqual(result.status, "APPLIED")
            self.assertIn(first_stage, [sql for sql, _ in cursor.executions])
            self.assertNotIn("tampered after snapshot", [sql for sql, _ in cursor.executions])


class Phase1TransactionStateMachineTests(unittest.TestCase):
    def _apply(
        self,
        bundle: Path,
        contract: Path,
        connection: FakeConnection,
        *,
        verifier: object = mock.DEFAULT,
    ):
        verifier_context = (
            mock.patch.object(apply, "verify_catalog_contract", return_value="catalog-fingerprint")
            if verifier is mock.DEFAULT
            else mock.patch.object(apply, "verify_catalog_contract", side_effect=verifier)
        )
        with sealed_artifacts(bundle, contract), verifier_context as verifier_mock:
            result = apply.apply_phase1(
                dsn=LOCAL_DSN,
                bundle_dir=bundle,
                catalog_contract_path=contract,
                applied_by="test:runner",
                local_scratch=True,
                connect=mock.Mock(return_value=connection),
            )
        return result, verifier_mock

    def test_fresh_apply_executes_each_stage_and_writes_ledger_before_security(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bundle, contract = build_bundle(Path(tmp))
            manifest = json.loads((bundle / "phase1-ddl-manifest.json").read_text())
            cursor = FakeCursor()
            connection = FakeConnection(cursor)
            result, verifier = self._apply(bundle, contract, connection)
            self.assertEqual(result.status, "APPLIED")
            self.assertEqual(connection.commits, 1)
            self.assertEqual(connection.rollbacks, 0)
            self.assertEqual(connection.closed, 1)
            sql = [statement for statement, _ in cursor.executions]
            stage_sql = [(bundle / stage["name"]).read_text() for stage in manifest["stages"]]
            self.assertEqual([statement for statement in sql if statement in stage_sql], stage_sql)
            self.assertNotIn((bundle / "phase1.sql").read_text(), sql)
            position_041 = sql.index((bundle / "041_validate_foreign_keys.sql").read_text())
            position_080 = sql.index((bundle / "080_security.sql").read_text())
            position_insert = next(i for i, statement in enumerate(sql) if "INSERT INTO public.app_schema_migration" in statement)
            position_guard = next(i for i, statement in enumerate(sql) if "relation.relname = 'app_schema_migration'" in statement)
            self.assertLess(position_041, position_guard)
            self.assertLess(position_guard, position_insert)
            self.assertLess(position_insert, position_080)
            insert_params = next(params for statement, params in cursor.executions if "INSERT INTO public.app_schema_migration" in statement)
            self.assertEqual(insert_params[-2:], ("test:runner", None))
            self.assertEqual(insert_params[4], manifest["payload"]["sha256"])
            verifier.assert_called_once_with(cursor, CATALOG_SENTINEL)

    def test_failure_and_catalog_mismatch_roll_back_without_leaking_details(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bundle, contract = build_bundle(Path(tmp))
            cursor = FakeCursor(fail_stage="080 final default-deny RLS and object privileges")
            connection = FakeConnection(cursor)
            with self.assertRaises(apply.ApplySafetyError) as caught:
                self._apply(bundle, contract, connection)
            self.assertEqual(caught.exception.code, "apply_failed")
            self.assertEqual(connection.commits, 0)
            self.assertEqual(connection.rollbacks, 1)

        with tempfile.TemporaryDirectory() as tmp:
            bundle, contract = build_bundle(Path(tmp))
            connection = FakeConnection(FakeCursor())
            error = CatalogContractError("$.tables[0]", "SECRET_EXPECTED", "SECRET_ACTUAL")
            with self.assertRaises(apply.ApplySafetyError) as caught:
                self._apply(bundle, contract, connection, verifier=error)
            self.assertEqual(caught.exception.code, "catalog_mismatch")
            self.assertNotIn("SECRET_EXPECTED", str(caught.exception))
            self.assertNotIn("SECRET_ACTUAL", str(caught.exception))
            self.assertEqual(connection.rollbacks, 1)

    def test_same_checksum_is_noop_and_ledger_drift_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bundle, contract = build_bundle(Path(tmp))
            manifest = json.loads((bundle / "phase1-ddl-manifest.json").read_text())
            checksum = manifest["payload"]["sha256"]
            cursor = FakeCursor(
                ledger_exists=True,
                ledger_rows=[("R6_PHASE1_BASELINE", "phase1.sql", checksum)],
            )
            connection = FakeConnection(cursor)
            result, verifier = self._apply(bundle, contract, connection)
            self.assertEqual(result.status, "NOOP")
            self.assertEqual(connection.commits, 0)
            self.assertEqual(connection.rollbacks, 1)
            self.assertFalse(any(sql.startswith("-- HOT CRUSH") for sql, _ in cursor.executions))
            verifier.assert_called_once_with(cursor, CATALOG_SENTINEL)

            for rows, code in (
                ([('R6_PHASE1_BASELINE', 'phase1.sql', '0' * 64)], "ledger_checksum_mismatch"),
                ([], "ledger_gap"),
                ([('OTHER', 'other.sql', checksum)], "ledger_gap"),
                ([('R6_PHASE1_BASELINE', 'phase1.sql', checksum), ('EXTRA', 'x.sql', checksum)], "ledger_gap"),
            ):
                with self.subTest(code=code, rows=len(rows)):
                    drift_connection = FakeConnection(FakeCursor(ledger_exists=True, ledger_rows=rows))
                    with self.assertRaises(apply.ApplySafetyError) as caught:
                        self._apply(bundle, contract, drift_connection)
                    self.assertEqual(caught.exception.code, code)
                    self.assertEqual(drift_connection.rollbacks, 1)

    def test_guard_failure_and_commit_uncertainty_have_distinct_outcomes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            bundle, contract = build_bundle(Path(tmp))
            guard_connection = FakeConnection(FakeCursor(guard_row=("r", "other", False, False)))
            with self.assertRaises(apply.ApplySafetyError) as caught:
                self._apply(bundle, contract, guard_connection)
            self.assertEqual(caught.exception.code, "ledger_guard_failed")
            self.assertEqual(guard_connection.rollbacks, 1)
            self.assertEqual(guard_connection.commits, 0)

            commit_connection = FakeConnection(FakeCursor(), fail_commit=True)
            with self.assertRaises(apply.ApplySafetyError) as caught:
                self._apply(bundle, contract, commit_connection)
            self.assertEqual(caught.exception.code, "commit_outcome_unknown")
            self.assertEqual(commit_connection.commits, 1)
            self.assertEqual(commit_connection.rollbacks, 0)


if __name__ == "__main__":
    unittest.main()
