from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


IMPLEMENTATION_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(IMPLEMENTATION_DIR))

import amendment_apply as apply  # noqa: E402


class RecordingCursor:
    def __init__(
        self,
        ledger_state: str,
        fail_on: str | None = None,
        *,
        close_error: bool = False,
        database_name: str = "hotcrush_r6_phase1_scratch",
    ) -> None:
        self.ledger_state = ledger_state
        self.fail_on = fail_on
        self.executed: list[tuple[str, object]] = []
        self._result: object = None
        self.close_error = close_error
        self.close_attempted = False
        self.database_name = database_name

    def execute(self, sql: object, params: object = None) -> None:
        statement = sql.decode("utf-8") if isinstance(sql, bytes) else str(sql)
        self.executed.append((statement, params))
        if self.fail_on and self.fail_on in statement:
            raise RuntimeError("injected cursor failure")
        if "pg_advisory_lock" in statement:
            self._result = (None,)
        elif "server_version_num" in statement:
            self._result = (
                170006,
                "postgres",
                self.database_name,
                False,
                False,
                True,
                True,
                True,
            )
        elif "FROM public.app_schema_migration" in statement and "ORDER BY" in statement:
            if self.ledger_state == "BASELINE":
                self._result = [apply.BASELINE_LEDGER_ROW]
            elif self.ledger_state == "TARGET":
                self._result = [
                    apply.BASELINE_LEDGER_ROW,
                    apply.amendment_ledger_row(apply.test_bundle()),
                ]
            else:
                self._result = []
        elif "INSERT INTO public.app_schema_migration" in statement:
            self._result = (apply.MIGRATION_VERSION,)

    def fetchone(self):
        if isinstance(self._result, list):
            return self._result[0]
        return self._result

    def fetchall(self):
        return self._result

    def close(self) -> None:
        self.close_attempted = True
        if self.close_error:
            raise RuntimeError("injected cursor close failure")


class RecordingConnection:
    def __init__(
        self,
        ledger_state: str,
        *,
        fail_on: str | None = None,
        commit_error: bool = False,
        cursor_close_error: bool = False,
        connection_close_error: bool = False,
        database_name: str = "hotcrush_r6_phase1_scratch",
    ) -> None:
        self.autocommit = False
        self.cursor_value = RecordingCursor(
            ledger_state,
            fail_on,
            close_error=cursor_close_error,
            database_name=database_name,
        )
        self.commit_error = commit_error
        self.connection_close_error = connection_close_error
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def cursor(self) -> RecordingCursor:
        return self.cursor_value

    def commit(self) -> None:
        self.commits += 1
        if self.commit_error:
            raise RuntimeError("injected commit failure")

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        self.closed = True
        if self.connection_close_error:
            raise RuntimeError("injected connection close failure")


class AmendmentRunnerStateMachineTests(unittest.TestCase):
    def test_amendment_reuses_the_exact_sealed_phase1_scratch_identity(self) -> None:
        self.assertEqual(apply.SCRATCH_DATABASE, "hotcrush_r6_phase1_scratch")
        target = apply.validate_dsn(apply.LOCAL_TEST_DSN, local_scratch=True)
        self.assertEqual(target.dbname, "hotcrush_r6_phase1_scratch")
        with self.assertRaises(apply.ApplySafetyError) as caught:
            apply.validate_dsn(
                "host=127.0.0.1 port=55432 "
                "dbname=hotcrush_r6a1_amendment_scratch "
                "user=postgres password=test sslmode=disable",
                local_scratch=True,
            )
        self.assertEqual(caught.exception.code, "unsafe_local_scratch")

    def test_session_lock_precedes_serializable_and_access_exclusive_lock_is_first(self) -> None:
        connection = RecordingConnection("BASELINE")
        bundle = apply.test_bundle()
        with (
            mock.patch.object(apply, "verify_release_bundle", return_value=bundle),
            mock.patch.object(apply, "verify_baseline_catalog"),
            mock.patch.object(apply, "verify_target_catalog", return_value="target-fingerprint"),
            mock.patch.object(apply, "verify_empty_green"),
        ):
            result = apply.apply_amendment(
                dsn=apply.LOCAL_TEST_DSN,
                bundle_dir=IMPLEMENTATION_DIR / "generated",
                applied_by="unit-test",
                local_scratch=True,
                connect=lambda **_kwargs: connection,
            )
        self.assertEqual(result.status, "APPLIED")
        statements = [statement for statement, _ in connection.cursor_value.executed]
        advisory = next(i for i, sql in enumerate(statements) if "pg_advisory_lock" in sql)
        begin = next(i for i, sql in enumerate(statements) if "BEGIN ISOLATION LEVEL SERIALIZABLE" in sql)
        lock = next(i for i, sql in enumerate(statements) if "ACCESS EXCLUSIVE MODE NOWAIT" in sql)
        first_ledger = next(i for i, sql in enumerate(statements) if "ORDER BY applied_at" in sql)
        self.assertLess(advisory, begin)
        self.assertLess(first_ledger, begin)
        self.assertLess(begin, lock)
        self.assertTrue(
            all(sql.lstrip().startswith("SET LOCAL") for sql in statements[begin + 1 : lock])
        )
        self.assertFalse(any("SELECT" in sql.upper() for sql in statements[begin + 1 : lock]))
        self.assertFalse(any("pg_advisory_xact_lock" in sql for sql in statements))
        self.assertIn(apply.SESSION_LOCK_KEY, repr(connection.cursor_value.executed[advisory]))
        self.assertTrue(connection.closed)

    def test_exact_baseline_applies_and_exact_target_is_noop(self) -> None:
        bundle = apply.test_bundle()
        amendment = apply.amendment_ledger_row(bundle)
        self.assertEqual(apply.classify_ledger([apply.BASELINE_LEDGER_ROW], bundle), "APPLY")
        self.assertEqual(
            apply.classify_ledger([apply.BASELINE_LEDGER_ROW, amendment], bundle),
            "NOOP",
        )

    def test_any_other_ledger_history_fails_closed(self) -> None:
        bundle = apply.test_bundle()
        amendment = apply.amendment_ledger_row(bundle)
        mutations = [
            [],
            [amendment],
            [(*apply.BASELINE_LEDGER_ROW[:-1], "0" * 64)],
            [apply.BASELINE_LEDGER_ROW, amendment, ("x", "x", "x")],
        ]
        for rows in mutations:
            with self.subTest(rows=rows), self.assertRaises(apply.ApplySafetyError):
                apply.classify_ledger(rows, bundle)

    def test_noop_executes_zero_amendment_stages_and_writes_zero_ledger_rows(self) -> None:
        connection = RecordingConnection("TARGET")
        with (
            mock.patch.object(apply, "verify_release_bundle", return_value=apply.test_bundle()),
            mock.patch.object(apply, "verify_baseline_catalog") as baseline_catalog,
            mock.patch.object(
                apply, "verify_target_catalog", return_value="target-fingerprint"
            ) as target_catalog,
            mock.patch.object(apply, "verify_empty_green") as empty_green,
        ):
            result = apply.apply_amendment(
                dsn=apply.LOCAL_TEST_DSN,
                bundle_dir=IMPLEMENTATION_DIR / "generated",
                applied_by="unit-test",
                local_scratch=True,
                connect=lambda **_kwargs: connection,
            )
        sql = "\n".join(statement for statement, _ in connection.cursor_value.executed)
        self.assertEqual(result.status, "NOOP")
        self.assertNotIn("R6A1 TEST MUTATION STAGE", sql)
        self.assertNotIn("INSERT INTO public.app_schema_migration", sql)
        self.assertNotIn("LOCK TABLE", sql)
        self.assertNotIn("ACCESS EXCLUSIVE", sql)
        baseline_catalog.assert_not_called()
        empty_green.assert_not_called()
        target_catalog.assert_called_once()
        self.assertEqual(connection.commits, 0)
        self.assertEqual(connection.rollbacks, 1)

    def test_remote_targets_and_routing_environment_are_rejected(self) -> None:
        with self.assertRaises(apply.ApplySafetyError):
            apply.validate_dsn(
                "host=example.com port=5432 dbname=postgres user=postgres password=x sslmode=require",
                local_scratch=True,
            )

    def test_routing_environment_fails_before_connect(self) -> None:
        connector = mock.Mock()
        with (
            mock.patch.object(apply, "verify_release_bundle", return_value=apply.test_bundle()),
            mock.patch.dict("os.environ", {"PGHOST": "127.0.0.1"}, clear=False),
            self.assertRaises(apply.ApplySafetyError) as caught,
        ):
            apply.apply_amendment(
                dsn=apply.LOCAL_TEST_DSN,
                bundle_dir=IMPLEMENTATION_DIR / "generated",
                applied_by="unit-test",
                local_scratch=True,
                connect=connector,
            )
        self.assertEqual(caught.exception.code, "unsafe_environment")
        connector.assert_not_called()

    def test_runtime_rejects_a_database_other_than_the_validated_scratch(self) -> None:
        connection = RecordingConnection(
            "BASELINE", database_name="wrong_database"
        )
        with (
            mock.patch.object(
                apply, "verify_release_bundle", return_value=apply.test_bundle()
            ),
            self.assertRaises(apply.ApplySafetyError) as caught,
        ):
            apply.apply_amendment(
                dsn=apply.LOCAL_TEST_DSN,
                bundle_dir=IMPLEMENTATION_DIR / "generated",
                applied_by="unit-test",
                local_scratch=True,
                connect=lambda **_kwargs: connection,
            )
        self.assertEqual(caught.exception.code, "unsafe_database_runtime")
        sql = "\n".join(
            statement for statement, _ in connection.cursor_value.executed
        )
        self.assertNotIn("R6A1 TEST MUTATION STAGE", sql)

    def test_precommit_gate_failure_rolls_back_and_never_executes_mutation(self) -> None:
        connection = RecordingConnection("BASELINE")
        with (
            mock.patch.object(apply, "verify_release_bundle", return_value=apply.test_bundle()),
            mock.patch.object(
                apply,
                "verify_baseline_catalog",
                side_effect=apply.ApplySafetyError("catalog_mismatch", "injected"),
            ),
            self.assertRaises(apply.ApplySafetyError) as caught,
        ):
            apply.apply_amendment(
                dsn=apply.LOCAL_TEST_DSN,
                bundle_dir=IMPLEMENTATION_DIR / "generated",
                applied_by="unit-test",
                local_scratch=True,
                connect=lambda **_kwargs: connection,
            )
        sql = "\n".join(statement for statement, _ in connection.cursor_value.executed)
        self.assertEqual(caught.exception.code, "catalog_mismatch")
        self.assertNotIn("R6A1 TEST MUTATION STAGE", sql)
        self.assertEqual(connection.rollbacks, 1)
        self.assertEqual(connection.commits, 0)
        self.assertTrue(connection.closed)

    def test_commit_failure_is_reported_as_outcome_unknown_without_rollback(self) -> None:
        connection = RecordingConnection("BASELINE", commit_error=True)
        with (
            mock.patch.object(apply, "verify_release_bundle", return_value=apply.test_bundle()),
            mock.patch.object(apply, "verify_baseline_catalog"),
            mock.patch.object(apply, "verify_empty_green"),
            mock.patch.object(
                apply, "verify_target_catalog", return_value="target-fingerprint"
            ),
            self.assertRaises(apply.ApplySafetyError) as caught,
        ):
            apply.apply_amendment(
                dsn=apply.LOCAL_TEST_DSN,
                bundle_dir=IMPLEMENTATION_DIR / "generated",
                applied_by="unit-test",
                local_scratch=True,
                connect=lambda **_kwargs: connection,
            )
        self.assertEqual(caught.exception.code, "commit_outcome_unknown")
        self.assertEqual(connection.commits, 1)
        self.assertEqual(connection.rollbacks, 0)
        self.assertTrue(connection.closed)

    def test_apply_rechecks_target_business_tables_empty_before_commit(self) -> None:
        connection = RecordingConnection("BASELINE")
        with (
            mock.patch.object(apply, "verify_release_bundle", return_value=apply.test_bundle()),
            mock.patch.object(apply, "verify_baseline_catalog"),
            mock.patch.object(apply, "verify_empty_green") as empty_green,
            mock.patch.object(
                apply, "verify_target_catalog", return_value="target-fingerprint"
            ),
        ):
            result = apply.apply_amendment(
                dsn=apply.LOCAL_TEST_DSN,
                bundle_dir=IMPLEMENTATION_DIR / "generated",
                applied_by="unit-test",
                local_scratch=True,
                connect=lambda **_kwargs: connection,
            )
        self.assertEqual(result.status, "APPLIED")
        self.assertEqual(
            [call.args[2] for call in empty_green.call_args_list],
            ["BASELINE", "TARGET_PRECOMMIT"],
        )

    def test_cleanup_failures_do_not_mask_primary_safety_error(self) -> None:
        connection = RecordingConnection(
            "BASELINE", cursor_close_error=True, connection_close_error=True
        )
        with (
            mock.patch.object(apply, "verify_release_bundle", return_value=apply.test_bundle()),
            mock.patch.object(
                apply,
                "verify_baseline_catalog",
                side_effect=apply.ApplySafetyError("catalog_mismatch", "primary"),
            ),
            self.assertRaises(apply.ApplySafetyError) as caught,
        ):
            apply.apply_amendment(
                dsn=apply.LOCAL_TEST_DSN,
                bundle_dir=IMPLEMENTATION_DIR / "generated",
                applied_by="unit-test",
                local_scratch=True,
                connect=lambda **_kwargs: connection,
            )
        self.assertEqual(caught.exception.code, "catalog_mismatch")
        self.assertTrue(connection.cursor_value.close_attempted)
        self.assertTrue(connection.closed)

    def test_cleanup_failures_do_not_mask_commit_outcome_unknown(self) -> None:
        connection = RecordingConnection(
            "BASELINE",
            commit_error=True,
            cursor_close_error=True,
            connection_close_error=True,
        )
        with (
            mock.patch.object(apply, "verify_release_bundle", return_value=apply.test_bundle()),
            mock.patch.object(apply, "verify_baseline_catalog"),
            mock.patch.object(apply, "verify_empty_green"),
            mock.patch.object(
                apply, "verify_target_catalog", return_value="target-fingerprint"
            ),
            self.assertRaises(apply.ApplySafetyError) as caught,
        ):
            apply.apply_amendment(
                dsn=apply.LOCAL_TEST_DSN,
                bundle_dir=IMPLEMENTATION_DIR / "generated",
                applied_by="unit-test",
                local_scratch=True,
                connect=lambda **_kwargs: connection,
            )
        self.assertEqual(caught.exception.code, "commit_outcome_unknown")
        self.assertTrue(connection.cursor_value.close_attempted)
        self.assertTrue(connection.closed)

    def test_connection_close_failure_on_success_is_cleanup_outcome_unknown(self) -> None:
        for ledger_state in ("BASELINE", "TARGET"):
            connection = RecordingConnection(
                ledger_state,
                connection_close_error=True,
            )
            with (
                self.subTest(ledger_state=ledger_state),
                mock.patch.object(
                    apply, "verify_release_bundle", return_value=apply.test_bundle()
                ),
                mock.patch.object(apply, "verify_baseline_catalog"),
                mock.patch.object(apply, "verify_empty_green"),
                mock.patch.object(
                    apply, "verify_target_catalog", return_value="target-fingerprint"
                ),
                self.assertRaises(apply.ApplySafetyError) as caught,
            ):
                apply.apply_amendment(
                    dsn=apply.LOCAL_TEST_DSN,
                    bundle_dir=IMPLEMENTATION_DIR / "generated",
                    applied_by="unit-test",
                    local_scratch=True,
                    connect=lambda **_kwargs: connection,
                )
            self.assertEqual(caught.exception.code, "session_cleanup_outcome_unknown")
            self.assertTrue(connection.closed)

    def test_real_release_verification_remains_blocked_while_trigger_contract_is_unapproved(self) -> None:
        with self.assertRaises(apply.ApplySafetyError) as caught:
            apply.verify_release_bundle(IMPLEMENTATION_DIR / "generated")
        self.assertEqual(caught.exception.code, "release_unsealed")

    def test_release_files_are_captured_once_from_a_closed_no_follow_directory(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            base = Path(raw_directory).resolve()
            bundle_dir = base / "bundle"
            bundle_dir.mkdir()
            (bundle_dir / "a.sql").write_bytes(b"one\n")
            (bundle_dir / "manifest.json").write_bytes(b"{}\n")
            snapshot = apply.capture_release_bytes(
                bundle_dir, ("a.sql", "manifest.json")
            )
            (bundle_dir / "a.sql").write_bytes(b"later\n")
            self.assertEqual(snapshot.read("a.sql"), b"one\n")
            with self.assertRaises(TypeError):
                snapshot.files["a.sql"] = b"forged\n"  # type: ignore[index]
            linked = base / "linked"
            linked.symlink_to(bundle_dir, target_is_directory=True)
            with self.assertRaises(apply.ApplySafetyError) as caught:
                apply.capture_release_bytes(linked, ("a.sql", "manifest.json"))
            self.assertEqual(caught.exception.code, "unsafe_release_path")


if __name__ == "__main__":
    unittest.main()
