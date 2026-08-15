#!/usr/bin/env python3
"""Local-only, fail-closed runner skeleton for the R6A1 amendment.

No release is currently apply-compatible: the exact constraint-trigger
inventory is still unapproved.  The state machine is implemented and unit
tested independently so the eventual sealed bundle cannot weaken lock,
ledger, transaction, or target-routing boundaries.
"""

from __future__ import annotations

import dataclasses
import ipaddress
import json
import os
import re
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Iterable, Mapping, Sequence

import psycopg2
from psycopg2.extensions import parse_dsn

import amendment_bootstrap


compiler = amendment_bootstrap.load_compiler()


SESSION_LOCK_KEY = "hotcrush-core-v1-r6-phase1"
MIGRATION_VERSION = compiler.MIGRATION_VERSION
MIGRATION_FILENAME = compiler.MIGRATION_FILENAME
REPOSITORY_CODE = compiler.REPOSITORY_CODE
SCRATCH_DATABASE = "hotcrush_r6_phase1_scratch"
LOCAL_TEST_DSN = (
    "host=127.0.0.1 port=55432 "
    f"dbname={SCRATCH_DATABASE} user=postgres password=test sslmode=disable"
)
BASELINE_LEDGER_ROW = (
    "R6_PHASE1_BASELINE",
    "phase1.sql",
    compiler.EXPECTED_HASHES["baseline_phase1_payload_sha256"],
)
ALLOWED_DSN_KEYS = frozenset(
    {"host", "port", "dbname", "user", "password", "sslmode"}
)
ROUTING_ENVIRONMENT_KEYS = frozenset(
    {
        "PGHOST",
        "PGHOSTADDR",
        "PGPORT",
        "PGDATABASE",
        "PGUSER",
        "PGSERVICE",
        "PGSERVICEFILE",
        "PGOPTIONS",
        "PGPASSFILE",
        "PGTARGETSESSIONATTRS",
    }
)
IDENTIFIER_RE = re.compile(r"[a-z_][a-z0-9_]*")
SHA256_RE = re.compile(r"[0-9a-f]{64}")


class ApplySafetyError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclasses.dataclass(frozen=True)
class ValidatedTarget:
    host: str
    port: int
    dbname: str
    user: str
    password: str = dataclasses.field(repr=False)
    sslmode: str = dataclasses.field(repr=False)

    def connect_kwargs(self) -> dict[str, Any]:
        return {
            "host": self.host,
            "port": self.port,
            "dbname": self.dbname,
            "user": self.user,
            "password": self.password,
            "sslmode": self.sslmode,
            "connect_timeout": 10,
            "application_name": "hotcrush-r6a1-amendment-runner",
        }


@dataclasses.dataclass(frozen=True)
class VerifiedStage:
    name: str
    body: bytes = dataclasses.field(repr=False)
    sha256: str


@dataclasses.dataclass(frozen=True)
class VerifiedBundle:
    manifest: dict[str, Any]
    payload_sha256: str
    lock_stage: VerifiedStage
    mutation_stages: tuple[VerifiedStage, ...]
    baseline_table_names: tuple[str, ...]
    target_table_names: tuple[str, ...]


@dataclasses.dataclass(frozen=True)
class ApplyResult:
    status: str
    payload_sha256: str
    catalog_fingerprint: str


@dataclasses.dataclass(frozen=True)
class ReleaseByteSnapshot:
    files: Mapping[str, bytes] = dataclasses.field(repr=False)

    def read(self, name: str) -> bytes:
        try:
            return self.files[name]
        except KeyError:
            raise ApplySafetyError(
                "artifact_mismatch", "Release payload was not snapshotted"
            ) from None


def _safe_parse_dsn(raw_dsn: str) -> dict[str, str]:
    if not isinstance(raw_dsn, str) or not raw_dsn:
        raise ApplySafetyError("unsafe_dsn", "Local scratch DSN is missing")
    try:
        parsed = parse_dsn(raw_dsn)
    except Exception:
        raise ApplySafetyError("unsafe_dsn", "Local scratch DSN is invalid") from None
    if set(parsed) - ALLOWED_DSN_KEYS:
        raise ApplySafetyError("unsafe_dsn", "DSN contains forbidden routing options")
    required = {"host", "port", "dbname", "user", "password", "sslmode"}
    if not required.issubset(parsed):
        raise ApplySafetyError("unsafe_dsn", "DSN is missing required local fields")
    if any("," in parsed[key] for key in ("host", "port")):
        raise ApplySafetyError("unsafe_dsn", "Multi-host routing is forbidden")
    return parsed


def validate_dsn(raw_dsn: str, *, local_scratch: bool) -> ValidatedTarget:
    if local_scratch is not True:
        raise ApplySafetyError(
            "remote_execution_forbidden",
            "R6A1 amendment execution is restricted to the fixed local scratch database",
        )
    parsed = _safe_parse_dsn(raw_dsn)
    host = parsed["host"].lower().rstrip(".")
    try:
        address = ipaddress.ip_address(host)
        port = int(parsed["port"])
    except ValueError:
        raise ApplySafetyError("unsafe_local_scratch", "Local address is invalid") from None
    if not address.is_loopback or not (1024 <= port <= 65535):
        raise ApplySafetyError("unsafe_local_scratch", "Target is not a local scratch endpoint")
    if parsed["dbname"] != SCRATCH_DATABASE or parsed["user"] != "postgres":
        raise ApplySafetyError("unsafe_local_scratch", "Local scratch identity is not exact")
    if parsed["sslmode"] != "disable":
        raise ApplySafetyError("unsafe_local_scratch", "Local scratch sslmode must be disable")
    return ValidatedTarget(
        host=host,
        port=port,
        dbname=parsed["dbname"],
        user=parsed["user"],
        password=parsed["password"],
        sslmode=parsed["sslmode"],
    )


def amendment_ledger_row(bundle: VerifiedBundle) -> tuple[str, str, str]:
    if SHA256_RE.fullmatch(bundle.payload_sha256) is None:
        raise ApplySafetyError("artifact_mismatch", "Amendment payload hash is invalid")
    return MIGRATION_VERSION, MIGRATION_FILENAME, bundle.payload_sha256


def classify_ledger(
    rows: Iterable[Sequence[Any]], bundle: VerifiedBundle
) -> str:
    normalized = [tuple(row) for row in rows]
    if normalized == [BASELINE_LEDGER_ROW]:
        return "APPLY"
    if normalized == [BASELINE_LEDGER_ROW, amendment_ledger_row(bundle)]:
        return "NOOP"
    raise ApplySafetyError(
        "ledger_gap",
        "Migration ledger is neither the exact R6 baseline nor exact R6 plus R6A1",
    )


def _read_ledger(cursor: Any, bundle: VerifiedBundle) -> str:
    cursor.execute(
        """
        SELECT migration_version, filename, checksum_sha256::pg_catalog.text
          FROM public.app_schema_migration
         WHERE repository_code = %s
         ORDER BY applied_at, migration_version
        """,
        (REPOSITORY_CODE,),
    )
    return classify_ledger(cursor.fetchall(), bundle)


def _render_lock(table_names: Sequence[str]) -> str:
    names = tuple(table_names)
    if not names or names != tuple(sorted(names)) or len(names) != len(set(names)):
        raise ApplySafetyError("artifact_mismatch", "Lock table inventory is not closed and sorted")
    if any(IDENTIFIER_RE.fullmatch(name) is None for name in names):
        raise ApplySafetyError("artifact_mismatch", "Lock table inventory contains an unsafe name")
    qualified = ", ".join(f'public."{name}"' for name in names)
    return f"LOCK TABLE {qualified} IN ACCESS EXCLUSIVE MODE NOWAIT"


def _validate_runtime(cursor: Any, target: ValidatedTarget) -> None:
    cursor.execute(
        """
        SELECT current_setting('server_version_num')::pg_catalog.int4,
               CURRENT_USER,
               pg_catalog.current_database(),
               pg_catalog.pg_is_in_recovery(),
               current_setting('transaction_read_only')::pg_catalog.bool,
               role.rolsuper,
               role.rolcreaterole,
               role.rolbypassrls
          FROM pg_catalog.pg_roles AS role
         WHERE role.rolname = CURRENT_USER
        """
    )
    row = cursor.fetchone()
    if row != (
        170006,
        "postgres",
        target.dbname,
        False,
        False,
        True,
        True,
        True,
    ):
        raise ApplySafetyError(
            "unsafe_database_runtime",
            "Local PostgreSQL runtime does not match the pinned PG17.6 executor contract",
        )


def capture_release_bytes(
    bundle_dir: Path, expected_names: Sequence[str]
) -> ReleaseByteSnapshot:
    """Capture a closed release directory once through a no-follow dirfd."""

    names = tuple(expected_names)
    if (
        not names
        or names != tuple(sorted(names))
        or len(names) != len(set(names))
        or any(compiler._validate_publish_name(name) != name for name in names)
    ):
        raise ApplySafetyError(
            "artifact_mismatch", "Release payload inventory is not closed and sorted"
        )
    try:
        descriptor = compiler._open_directory_no_follow(Path(bundle_dir))
    except compiler.CompilerContractError:
        raise ApplySafetyError(
            "unsafe_release_path", "Release directory is missing or unsafe"
        ) from None
    try:
        actual_names = tuple(sorted(os.listdir(descriptor)))
        if actual_names != names:
            raise ApplySafetyError(
                "artifact_mismatch", "Release directory file set differs"
            )
        try:
            files = {
                name: compiler._read_regular_file_at(descriptor, name)
                for name in names
            }
        except compiler.CompilerContractError:
            raise ApplySafetyError(
                "artifact_mismatch", "Release payload is not a safe regular file"
            ) from None
    finally:
        os.close(descriptor)
    return ReleaseByteSnapshot(MappingProxyType(files))


def verify_release_bundle(bundle_dir: Path) -> VerifiedBundle:
    """Load a future sealed release; currently fail because triggers are blocked."""

    del bundle_dir
    if compiler.TRIGGER_CONTRACT_STATUS != "APPROVED_EXACT":
        raise ApplySafetyError(
            "release_unsealed",
            "R6A1 release is unsealed while the exact trigger contract is unapproved",
        )
    raise ApplySafetyError("release_unsealed", "R6A1 release seal is not implemented")


def verify_baseline_catalog(cursor: Any, bundle: VerifiedBundle) -> str:
    del cursor, bundle
    raise ApplySafetyError("catalog_verifier_not_compiled", "Baseline catalog verifier is not compiled")


def verify_target_catalog(cursor: Any, bundle: VerifiedBundle) -> str:
    del cursor, bundle
    raise ApplySafetyError("catalog_verifier_not_compiled", "Target catalog verifier is not compiled")


def verify_empty_green(cursor: Any, bundle: VerifiedBundle, state: str) -> None:
    del cursor, bundle, state
    raise ApplySafetyError("empty_green_verifier_not_compiled", "Empty-Green verifier is not compiled")


def _write_ledger(cursor: Any, bundle: VerifiedBundle, applied_by: str) -> None:
    cursor.execute(
        """
        INSERT INTO public.app_schema_migration
          (repository_code, migration_version, migration_name, filename,
           checksum_sha256, applied_by, execution_ms)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING migration_version
        """,
        (
            REPOSITORY_CODE,
            MIGRATION_VERSION,
            "HOT CRUSH Core R6A1 FX and signed POS amendment",
            MIGRATION_FILENAME,
            bundle.payload_sha256,
            applied_by,
            None,
        ),
    )
    if cursor.fetchone() != (MIGRATION_VERSION,):
        raise ApplySafetyError("ledger_write_failed", "Amendment ledger row did not round-trip")


def _best_effort_rollback(connection: Any) -> None:
    try:
        connection.rollback()
    except Exception:
        pass


def apply_amendment(
    *,
    dsn: str,
    bundle_dir: Path,
    applied_by: str,
    local_scratch: bool,
    connect: Callable[..., Any] = psycopg2.connect,
) -> ApplyResult:
    bundle = verify_release_bundle(bundle_dir)
    target = validate_dsn(dsn, local_scratch=local_scratch)
    if not isinstance(applied_by, str) or not applied_by.strip() or len(applied_by) > 200:
        raise ApplySafetyError("invalid_applied_by", "applied_by must be a short audit identity")
    if any(os.environ.get(key) for key in ROUTING_ENVIRONMENT_KEYS):
        raise ApplySafetyError("unsafe_environment", "libpq routing environment is forbidden")
    try:
        connection = connect(**target.connect_kwargs())
    except Exception:
        raise ApplySafetyError("database_connect_failed", "Local scratch connection failed") from None

    cursor = None
    commit_started = False
    primary_failure = False
    try:
        connection.autocommit = True
        cursor = connection.cursor()
        cursor.execute("SET transaction_timeout = 0")
        cursor.execute("SET lock_timeout = 0")
        cursor.execute("SET statement_timeout = 0")
        cursor.execute(
            "SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended(%s, 0))",
            (SESSION_LOCK_KEY,),
        )
        preclassified = _read_ledger(cursor, bundle)

        connection.autocommit = False
        cursor.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        cursor.execute("SET LOCAL lock_timeout = '5s'")
        cursor.execute("SET LOCAL statement_timeout = '15min'")
        cursor.execute("SET LOCAL idle_in_transaction_session_timeout = '16min'")
        cursor.execute("SET LOCAL search_path = pg_catalog, public, extensions")
        cursor.execute("SET LOCAL TIME ZONE 'UTC'")
        cursor.execute("SET LOCAL DateStyle = 'ISO, YMD'")
        cursor.execute("SET LOCAL quote_all_identifiers = off")

        if preclassified == "APPLY":
            expected_lock = _render_lock(bundle.baseline_table_names)
            if bundle.lock_stage.body.decode("utf-8").strip().rstrip(";") != expected_lock:
                raise ApplySafetyError("artifact_mismatch", "Baseline lock stage is not exact")
            cursor.execute(bundle.lock_stage.body.decode("utf-8"))
        _validate_runtime(cursor, target)
        repeated = _read_ledger(cursor, bundle)
        if repeated != preclassified:
            raise ApplySafetyError("ledger_changed", "Ledger changed after the table lock barrier")

        if repeated == "NOOP":
            fingerprint = verify_target_catalog(cursor, bundle)
            _best_effort_rollback(connection)
            return ApplyResult("NOOP", bundle.payload_sha256, fingerprint)

        verify_baseline_catalog(cursor, bundle)
        verify_empty_green(cursor, bundle, "BASELINE")
        for stage in bundle.mutation_stages:
            cursor.execute(stage.body.decode("utf-8"))
        _write_ledger(cursor, bundle, applied_by.strip())
        fingerprint = verify_target_catalog(cursor, bundle)
        verify_empty_green(cursor, bundle, "TARGET_PRECOMMIT")

        commit_started = True
        try:
            connection.commit()
        except BaseException:
            raise ApplySafetyError(
                "commit_outcome_unknown",
                "Commit outcome is unknown; rerun the same sealed bundle to reconcile",
            ) from None
        return ApplyResult("APPLIED", bundle.payload_sha256, fingerprint)
    except ApplySafetyError:
        primary_failure = True
        if not commit_started:
            _best_effort_rollback(connection)
        raise
    except BaseException:
        primary_failure = True
        if not commit_started:
            _best_effort_rollback(connection)
        raise ApplySafetyError("apply_failed", "R6A1 amendment transaction failed") from None
    finally:
        try:
            if cursor is not None:
                try:
                    cursor.close()
                except Exception:
                    pass
        finally:
            try:
                connection.close()
            except Exception:
                if not primary_failure:
                    raise ApplySafetyError(
                        "session_cleanup_outcome_unknown",
                        "Database outcome is known but session-lock cleanup is unknown; "
                        "rerun the same sealed bundle to reconcile",
                    ) from None


def test_bundle() -> VerifiedBundle:
    """Return a synthetic in-memory bundle used only by unit tests."""

    baseline_names = ("app_schema_migration", "app_user")
    target_names = ("app_currency", "app_schema_migration", "app_user")
    lock_body = (_render_lock(baseline_names) + ";\n").encode("utf-8")
    mutation_body = b"-- R6A1 TEST MUTATION STAGE\nSELECT 1;\n"
    import hashlib

    return VerifiedBundle(
        manifest={
            "artifact_kind": "SYNTHETIC_UNIT_TEST_ONLY",
            "migration": {
                "repository_code": REPOSITORY_CODE,
                "migration_version": MIGRATION_VERSION,
                "filename": MIGRATION_FILENAME,
            },
        },
        payload_sha256="a" * 64,
        lock_stage=VerifiedStage(
            "000_lock_baseline.sql", lock_body, hashlib.sha256(lock_body).hexdigest()
        ),
        mutation_stages=(
            VerifiedStage(
                "010_test_mutation.sql",
                mutation_body,
                hashlib.sha256(mutation_body).hexdigest(),
            ),
        ),
        baseline_table_names=baseline_names,
        target_table_names=target_names,
    )
