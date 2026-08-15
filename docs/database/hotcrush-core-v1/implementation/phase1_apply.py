#!/usr/bin/env python3
"""Fail-closed, single-transaction apply runner for HOT CRUSH R6 Phase 1."""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import ipaddress
import json
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any, Callable

import psycopg2
from psycopg2.extensions import parse_dsn

import phase1_ddl_compiler as compiler
import phase1_release as release
from phase1_catalog import (
    CatalogContractError,
    parse_catalog_contract_bytes,
    verify_catalog_contract,
)


GREEN_PROJECT_REF = "tmmkknnkcptunxbfjxqn"
SOURCE_PROJECT_REF = "ecsgqcmwtjmcpzqytdqw"
GREEN_DIRECT_HOST = f"db.{GREEN_PROJECT_REF}.supabase.co"
GREEN_SESSION_POOLER_HOST = "aws-0-us-east-1.pooler.supabase.com"
SCRATCH_DATABASE = "hotcrush_r6_phase1_scratch"
CATALOG_CONTRACT_FILENAME = "phase1-catalog-contract.json"
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_BUNDLE_BYTES = 128 * 1024 * 1024
ALLOWED_DSN_KEYS = frozenset(
    {"host", "port", "dbname", "user", "password", "sslmode", "sslrootcert"}
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
TRANSACTION_CONTROL_RE = re.compile(
    rb"(?mi)^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|PREPARE\s+TRANSACTION)\s*;"
)
SHA256_RE = re.compile(r"[0-9a-f]{64}")
PRE_LEDGER_LAST_STAGE = "041_validate_foreign_keys.sql"
SESSION_LOCK_KEY = "hotcrush-core-v1-r6-phase1"


class ApplySafetyError(RuntimeError):
    def __init__(self, code: str, safe_message: str) -> None:
        super().__init__(safe_message)
        self.code = code


@dataclasses.dataclass(frozen=True)
class ValidatedTarget:
    mode: str
    project_ref: str | None
    host: str
    port: int
    dbname: str
    user: str
    password: str = dataclasses.field(repr=False)
    sslmode: str = dataclasses.field(repr=False)
    sslrootcert: str | None = dataclasses.field(default=None, repr=False)

    def connect_kwargs(self) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "host": self.host,
            "port": self.port,
            "dbname": self.dbname,
            "user": self.user,
            "password": self.password,
            "sslmode": self.sslmode,
            "connect_timeout": 10,
            "application_name": "hotcrush-r6-phase1-runner",
        }
        if self.sslrootcert is not None:
            kwargs["sslrootcert"] = self.sslrootcert
        return kwargs


@dataclasses.dataclass(frozen=True)
class VerifiedStage:
    name: str
    offset: int
    body: bytes = dataclasses.field(repr=False)
    sha256: str


@dataclasses.dataclass(frozen=True)
class VerifiedBundle:
    manifest: dict[str, Any]
    payload: bytes = dataclasses.field(repr=False)
    payload_sha256: str
    stages: tuple[VerifiedStage, ...]
    catalog_contract: dict[str, Any] = dataclasses.field(repr=False)
    catalog_contract_sha256: str


@dataclasses.dataclass(frozen=True)
class ApplyResult:
    status: str
    payload_sha256: str
    catalog_fingerprint: str


def _safe_parse_dsn(raw_dsn: str) -> dict[str, str]:
    if not isinstance(raw_dsn, str) or not raw_dsn:
        raise ApplySafetyError("unsafe_dsn", "Database connection configuration is missing")
    try:
        parsed = parse_dsn(raw_dsn)
    except Exception:
        raise ApplySafetyError("unsafe_dsn", "Database connection configuration is invalid") from None
    if set(parsed) - ALLOWED_DSN_KEYS:
        raise ApplySafetyError("unsafe_dsn", "Database connection contains forbidden routing options")
    required = {"host", "port", "dbname", "user", "password", "sslmode"}
    if not required.issubset(parsed):
        raise ApplySafetyError("unsafe_dsn", "Database connection is missing required fields")
    if any("," in parsed[key] for key in ("host", "port")):
        raise ApplySafetyError("unsafe_dsn", "Multi-host database routing is forbidden")
    return parsed


def validate_dsn(raw_dsn: str, *, local_scratch: bool) -> ValidatedTarget:
    parsed = _safe_parse_dsn(raw_dsn)
    host = parsed["host"].lower().rstrip(".")
    user = parsed["user"]
    if SOURCE_PROJECT_REF in host or SOURCE_PROJECT_REF in user:
        raise ApplySafetyError(
            "forbidden_source_project",
            "The production source project is never an allowed migration target",
        )
    try:
        port = int(parsed["port"])
    except ValueError:
        raise ApplySafetyError("unsafe_dsn", "Database port is invalid") from None

    if local_scratch:
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            raise ApplySafetyError(
                "unsafe_local_scratch", "Local scratch host must be a numeric loopback address"
            ) from None
        if not address.is_loopback:
            raise ApplySafetyError("unsafe_local_scratch", "Local scratch host is not loopback")
        if not (1024 <= port <= 65535):
            raise ApplySafetyError("unsafe_local_scratch", "Local scratch port is outside the allowed range")
        if parsed["dbname"] != SCRATCH_DATABASE or user != "postgres":
            raise ApplySafetyError("unsafe_local_scratch", "Local scratch identity is not the fixed test database")
        if parsed["sslmode"] != "disable" or "sslrootcert" in parsed:
            raise ApplySafetyError("unsafe_local_scratch", "Local scratch TLS mode must be explicit disable")
        return ValidatedTarget(
            mode="local_scratch",
            project_ref=None,
            host=host,
            port=port,
            dbname=parsed["dbname"],
            user=user,
            password=parsed["password"],
            sslmode=parsed["sslmode"],
        )

    direct = (
        host == GREEN_DIRECT_HOST
        and port == 5432
        and user == "postgres"
        and parsed["dbname"] == "postgres"
    )
    pooler = (
        host == GREEN_SESSION_POOLER_HOST
        and port == 5432
        and user == f"postgres.{GREEN_PROJECT_REF}"
        and parsed["dbname"] == "postgres"
    )
    if not (direct or pooler):
        raise ApplySafetyError("unapproved_target", "Database target is not the approved green project")
    root_cert = parsed.get("sslrootcert")
    if parsed["sslmode"] != "verify-full" or not root_cert:
        raise ApplySafetyError("unsafe_tls", "Remote target requires verify-full and an approved CA file")
    cert_path = Path(root_cert)
    if cert_path.is_symlink() or not cert_path.is_file():
        raise ApplySafetyError("unsafe_tls", "Remote CA file is missing or unsafe")
    return ValidatedTarget(
        mode="remote_direct" if direct else "remote_session_pooler",
        project_ref=GREEN_PROJECT_REF,
        host=host,
        port=port,
        dbname=parsed["dbname"],
        user=user,
        password=parsed["password"],
        sslmode=parsed["sslmode"],
        sslrootcert=str(cert_path),
    )


def _duplicate_key_guard(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ApplySafetyError("artifact_mismatch", "Artifact JSON contains duplicate keys")
        result[key] = value
    return result


def _validate_release_seal() -> dict[str, release.ArtifactPin]:
    expected_names = {
        "phase1-ddl-manifest.json",
        "phase1.sql",
        CATALOG_CONTRACT_FILENAME,
    }
    pins = release.ARTIFACT_PINS
    if release.RELEASE_VERSION != 1 or set(pins) != expected_names:
        raise ApplySafetyError("release_unsealed", "Phase 1 release seal is incomplete")
    for name in sorted(expected_names):
        pin = pins[name]
        if (
            not isinstance(pin, release.ArtifactPin)
            or pin.filename != name
            or not isinstance(pin.bytes, int)
            or pin.bytes <= 0
            or not isinstance(pin.sha256, str)
            or SHA256_RE.fullmatch(pin.sha256) is None
        ):
            raise ApplySafetyError("release_unsealed", "Phase 1 release seal is incomplete")
    return pins


def _metadata_signature(metadata: os.stat_result) -> tuple[int, int, int, int, int, int]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def _read_open_file(descriptor: int, before: os.stat_result) -> bytes:
    if not stat.S_ISREG(before.st_mode) or before.st_size < 0 or before.st_size > MAX_ARTIFACT_BYTES:
        raise ApplySafetyError("artifact_mismatch", "Artifact is not a bounded regular file")
    chunks: list[bytes] = []
    remaining = before.st_size
    while remaining:
        chunk = os.read(descriptor, min(1024 * 1024, remaining))
        if not chunk:
            raise ApplySafetyError("artifact_mismatch", "Artifact changed while being read")
        chunks.append(chunk)
        remaining -= len(chunk)
    if os.read(descriptor, 1):
        raise ApplySafetyError("artifact_mismatch", "Artifact grew while being read")
    after = os.fstat(descriptor)
    if _metadata_signature(before) != _metadata_signature(after):
        raise ApplySafetyError("artifact_mismatch", "Artifact metadata changed while being read")
    return b"".join(chunks)


def _snapshot_bundle(bundle_dir: Path) -> dict[str, bytes]:
    expected_names = {
        "phase1-ddl-manifest.json",
        "phase1.sql",
        *compiler.STAGE_SQL_FILES,
    }
    directory_flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        directory_flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        directory_flags |= os.O_NOFOLLOW
    try:
        directory_fd = os.open(bundle_dir, directory_flags)
    except OSError:
        raise ApplySafetyError("artifact_mismatch", "Artifact bundle is missing or unsafe") from None
    descriptors: dict[str, tuple[int, os.stat_result]] = {}
    try:
        if set(os.listdir(directory_fd)) != expected_names:
            raise ApplySafetyError("artifact_mismatch", "Artifact bundle file set is not exact")
        total = 0
        for name in sorted(expected_names):
            flags = os.O_RDONLY
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            try:
                descriptor = os.open(name, flags, dir_fd=directory_fd)
            except OSError:
                raise ApplySafetyError("artifact_mismatch", "Artifact is missing or unsafe") from None
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode):
                os.close(descriptor)
                raise ApplySafetyError("artifact_mismatch", "Artifact is not a regular file")
            total += metadata.st_size
            if metadata.st_size > MAX_ARTIFACT_BYTES or total > MAX_BUNDLE_BYTES:
                os.close(descriptor)
                raise ApplySafetyError("artifact_mismatch", "Artifact bundle exceeds the size limit")
            descriptors[name] = (descriptor, metadata)
        snapshot: dict[str, bytes] = {}
        for name in sorted(expected_names):
            descriptor, before = descriptors[name]
            snapshot[name] = _read_open_file(descriptor, before)
            try:
                path_metadata = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            except OSError:
                raise ApplySafetyError("artifact_mismatch", "Artifact path changed during snapshot") from None
            if _metadata_signature(before) != _metadata_signature(path_metadata):
                raise ApplySafetyError("artifact_mismatch", "Artifact path changed during snapshot")
        return snapshot
    finally:
        for descriptor, _ in descriptors.values():
            os.close(descriptor)
        os.close(directory_fd)


def _snapshot_external_file(path: Path) -> bytes:
    if path.name != CATALOG_CONTRACT_FILENAME:
        raise ApplySafetyError("artifact_mismatch", "Catalog contract filename is not approved")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError:
        raise ApplySafetyError("artifact_mismatch", "Catalog contract is missing or unsafe") from None
    try:
        return _read_open_file(descriptor, os.fstat(descriptor))
    finally:
        os.close(descriptor)


def _verify_pin(name: str, data: bytes, pin: release.ArtifactPin) -> None:
    if len(data) != pin.bytes or hashlib.sha256(data).hexdigest() != pin.sha256:
        raise ApplySafetyError("artifact_mismatch", f"Sealed artifact {name} does not match its release pin")


def _parse_manifest(raw: bytes) -> dict[str, Any]:
    try:
        manifest = json.loads(raw.decode("utf-8"), object_pairs_hook=_duplicate_key_guard)
    except ApplySafetyError:
        raise
    except Exception:
        raise ApplySafetyError("artifact_mismatch", "Manifest JSON is invalid") from None
    if not isinstance(manifest, dict) or manifest.get("manifest_version") != 2:
        raise ApplySafetyError("artifact_mismatch", "Manifest version is not approved")
    if manifest.get("compiler_version") != compiler.COMPILER_VERSION:
        raise ApplySafetyError("artifact_mismatch", "Manifest compiler version is not approved")
    inputs = manifest.get("inputs")
    if not isinstance(inputs, dict) or (
        inputs.get("raw_model_sha256") != compiler.EXPECTED_RAW_MODEL_SHA256
        or inputs.get("canonical_model_sha256") != compiler.EXPECTED_CANONICAL_MODEL_SHA256
        or inputs.get("review_package_sha256") != compiler.EXPECTED_REVIEW_PACKAGE_SHA256
        or SHA256_RE.fullmatch(str(inputs.get("compiler_sha256", ""))) is None
    ):
        raise ApplySafetyError("artifact_mismatch", "Manifest input provenance is not approved")
    if manifest.get("roles") != [] or manifest.get("forbidden_role_pattern") != "^hc_r6_":
        raise ApplySafetyError("artifact_mismatch", "Manifest custom-role contract is not approved")
    if manifest.get("future_security_registry") != {
        "status": "DEFERRED_NOT_EXECUTED",
        "requires_platform_superuser_bootstrap": True,
        "role_names": list(compiler.FUTURE_BUSINESS_ROLE_NAMES),
    }:
        raise ApplySafetyError("artifact_mismatch", "Manifest deferred security registry is not approved")
    if manifest.get("owner_mode") != "EXECUTOR_OWNER" or manifest.get("expected_owner") != "postgres":
        raise ApplySafetyError("artifact_mismatch", "Manifest owner contract is not approved")
    if manifest.get("validation_runtime") != {
        "postgres_image": compiler.PG17_DOCKER_IMAGE,
        "repo_digest": compiler.PG17_DOCKER_REPO_DIGEST,
    }:
        raise ApplySafetyError("artifact_mismatch", "Manifest validation runtime is not approved")
    if manifest.get("counts") != compiler.build_phase1_plan(
        compiler.load_model(Path(compiler.__file__).resolve().parent.parent / "target-model.json")
    ).counts:
        raise ApplySafetyError("artifact_mismatch", "Manifest object counts are not approved")
    return manifest


def verify_artifact_bundle(bundle_dir: Path, catalog_contract_path: Path) -> VerifiedBundle:
    pins = _validate_release_seal()
    snapshot = _snapshot_bundle(bundle_dir)
    contract_raw = _snapshot_external_file(catalog_contract_path)
    for name in ("phase1-ddl-manifest.json", "phase1.sql"):
        _verify_pin(name, snapshot[name], pins[name])
    _verify_pin(CATALOG_CONTRACT_FILENAME, contract_raw, pins[CATALOG_CONTRACT_FILENAME])

    manifest = _parse_manifest(snapshot["phase1-ddl-manifest.json"])
    stages = manifest.get("stages")
    payload_contract = manifest.get("payload")
    if not isinstance(stages, list) or not isinstance(payload_contract, dict):
        raise ApplySafetyError("artifact_mismatch", "Manifest stage contract is incomplete")
    if [stage.get("name") for stage in stages] != compiler.STAGE_SQL_FILES:
        raise ApplySafetyError("artifact_mismatch", "Manifest stage order differs from the approved order")
    payload = snapshot["phase1.sql"]
    if TRANSACTION_CONTROL_RE.search(payload):
        raise ApplySafetyError("artifact_mismatch", "Payload contains forbidden transaction control")
    if payload_contract != {
        "filename": "phase1.sql",
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }:
        raise ApplySafetyError("artifact_mismatch", "Payload bytes do not match the manifest")
    cursor = 0
    verified_stages: list[VerifiedStage] = []
    for stage in stages:
        if set(stage) != {"name", "offset", "bytes", "sha256"}:
            raise ApplySafetyError("artifact_mismatch", "Stage contract contains unknown fields")
        name = stage["name"]
        body = snapshot[name]
        expected = {
            "name": name,
            "offset": cursor,
            "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
        }
        if stage != expected or payload[cursor : cursor + len(body)] != body:
            raise ApplySafetyError("artifact_mismatch", "Stage bytes/order do not match phase1.sql")
        if TRANSACTION_CONTROL_RE.search(body):
            raise ApplySafetyError("artifact_mismatch", "Stage contains forbidden transaction control")
        verified_stages.append(VerifiedStage(name, cursor, body, expected["sha256"]))
        cursor += len(body)
    if cursor != len(payload):
        raise ApplySafetyError("artifact_mismatch", "Stages do not exactly cover phase1.sql")
    try:
        catalog_contract = parse_catalog_contract_bytes(contract_raw, manifest)
    except CatalogContractError:
        raise ApplySafetyError("artifact_mismatch", "Detached catalog contract is invalid") from None
    return VerifiedBundle(
        manifest=manifest,
        payload=payload,
        payload_sha256=payload_contract["sha256"],
        stages=tuple(verified_stages),
        catalog_contract=catalog_contract,
        catalog_contract_sha256=hashlib.sha256(contract_raw).hexdigest(),
    )


def _validate_runtime(cursor: Any, target: ValidatedTarget) -> None:
    cursor.execute(
        """
        SELECT current_setting('server_version_num')::pg_catalog.int4,
               CURRENT_USER,
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
    common = row is not None and row[:4] == (170006, "postgres", False, False)
    if target.mode == "local_scratch":
        safe = common and row[6] is True
    else:
        safe = common and row[4:] == (False, True, True)
    if not safe:
        raise ApplySafetyError("unsafe_database_runtime", "Database runtime does not match the pinned executor contract")


def _classify_ledger(cursor: Any, bundle: VerifiedBundle) -> str:
    cursor.execute("SELECT pg_catalog.to_regclass('public.app_schema_migration')::pg_catalog.text")
    if cursor.fetchone()[0] is None:
        return "FRESH"
    migration = bundle.manifest["migration"]
    cursor.execute(
        """
        SELECT migration_version, filename, checksum_sha256::pg_catalog.text
          FROM public.app_schema_migration
         WHERE repository_code = %s
         ORDER BY applied_at, migration_version
        """,
        (migration["repository_code"],),
    )
    rows = cursor.fetchall()
    if len(rows) != 1 or rows[0][0] != migration["migration_version"]:
        raise ApplySafetyError("ledger_gap", "Migration ledger is not the exact baseline history")
    _, filename, checksum = rows[0]
    if filename != migration["filename"] or checksum != bundle.payload_sha256:
        raise ApplySafetyError("ledger_checksum_mismatch", "Migration version has a different immutable checksum")
    return "NOOP"


def _guard_ledger_before_security(cursor: Any, bundle: VerifiedBundle) -> None:
    cursor.execute(
        """
        SELECT relation.relkind,
               pg_catalog.pg_get_userbyid(relation.relowner),
               relation.relrowsecurity,
               relation.relforcerowsecurity
          FROM pg_catalog.pg_class AS relation
          JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public' AND relation.relname = 'app_schema_migration'
        """
    )
    if cursor.fetchone() != ("r", "postgres", False, False):
        raise ApplySafetyError("ledger_guard_failed", "Migration ledger is not writable before final security")
    migration = bundle.manifest["migration"]
    cursor.execute(
        """
        SELECT pg_catalog.count(*)
          FROM public.app_schema_migration
         WHERE repository_code = %s OR migration_version = %s
        """,
        (migration["repository_code"], migration["migration_version"]),
    )
    if cursor.fetchone() != (0,):
        raise ApplySafetyError("ledger_guard_failed", "Migration ledger baseline already exists")


def _write_ledger(cursor: Any, bundle: VerifiedBundle, applied_by: str) -> None:
    migration = bundle.manifest["migration"]
    cursor.execute(
        """
        INSERT INTO public.app_schema_migration
          (repository_code, migration_version, migration_name, filename,
           checksum_sha256, applied_by, execution_ms)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING migration_version
        """,
        (
            migration["repository_code"],
            migration["migration_version"],
            "HOT CRUSH Core R6 Phase 1 physical baseline",
            migration["filename"],
            bundle.payload_sha256,
            applied_by,
            None,
        ),
    )
    if cursor.fetchone() != (migration["migration_version"],):
        raise ApplySafetyError("ledger_write_failed", "Migration ledger write did not round-trip")


def _best_effort_rollback(connection: Any) -> None:
    try:
        connection.rollback()
    except Exception:
        pass


def apply_phase1(
    *,
    dsn: str,
    bundle_dir: Path,
    catalog_contract_path: Path,
    applied_by: str,
    local_scratch: bool,
    connect: Callable[..., Any] = psycopg2.connect,
) -> ApplyResult:
    bundle = verify_artifact_bundle(bundle_dir, catalog_contract_path)
    target = validate_dsn(dsn, local_scratch=local_scratch)
    if not isinstance(applied_by, str) or not applied_by.strip() or len(applied_by) > 200:
        raise ApplySafetyError("invalid_applied_by", "applied_by must be a short nonblank audit identity")
    if any(os.environ.get(key) for key in ROUTING_ENVIRONMENT_KEYS):
        raise ApplySafetyError("unsafe_environment", "libpq routing environment variables are forbidden")
    try:
        connection = connect(**target.connect_kwargs())
    except Exception:
        raise ApplySafetyError("database_connect_failed", "Database connection failed") from None
    cursor = None
    commit_started = False
    try:
        connection.autocommit = True
        cursor = connection.cursor()
        cursor.execute("SET transaction_timeout = 0")
        cursor.execute("SET lock_timeout = 0")
        cursor.execute("SET statement_timeout = 0")
        cursor.execute(
            "SELECT pg_catalog.pg_advisory_lock("
            "pg_catalog.hashtextextended(%s, 0))",
            (SESSION_LOCK_KEY,),
        )
        connection.autocommit = False
        cursor.execute("BEGIN ISOLATION LEVEL SERIALIZABLE")
        cursor.execute("SET LOCAL lock_timeout = '5s'")
        cursor.execute("SET LOCAL statement_timeout = '15min'")
        cursor.execute("SET LOCAL idle_in_transaction_session_timeout = '16min'")
        cursor.execute("SET LOCAL search_path = pg_catalog, public, extensions")
        cursor.execute("SET LOCAL TIME ZONE 'UTC'")
        cursor.execute("SET LOCAL DateStyle = 'ISO, YMD'")
        cursor.execute("SET LOCAL quote_all_identifiers = off")
        _validate_runtime(cursor, target)
        ledger_state = _classify_ledger(cursor, bundle)
        if ledger_state == "NOOP":
            try:
                fingerprint = verify_catalog_contract(cursor, bundle.catalog_contract)
            except CatalogContractError:
                raise ApplySafetyError("catalog_mismatch", "Database catalog differs from the sealed contract") from None
            _best_effort_rollback(connection)
            return ApplyResult("NOOP", bundle.payload_sha256, fingerprint)

        boundary = next(
            index for index, stage in enumerate(bundle.stages) if stage.name == PRE_LEDGER_LAST_STAGE
        )
        for stage in bundle.stages[: boundary + 1]:
            cursor.execute(stage.body.decode("utf-8"))
        _guard_ledger_before_security(cursor, bundle)
        _write_ledger(cursor, bundle, applied_by.strip())
        for stage in bundle.stages[boundary + 1 :]:
            cursor.execute(stage.body.decode("utf-8"))
        try:
            fingerprint = verify_catalog_contract(cursor, bundle.catalog_contract)
        except CatalogContractError:
            raise ApplySafetyError("catalog_mismatch", "Database catalog differs from the sealed contract") from None

        commit_started = True
        try:
            connection.commit()
        except BaseException:
            raise ApplySafetyError(
                "commit_outcome_unknown",
                "Commit outcome is unknown; rerun the same sealed release to reconcile safely",
            ) from None
        return ApplyResult("APPLIED", bundle.payload_sha256, fingerprint)
    except ApplySafetyError:
        if not commit_started:
            _best_effort_rollback(connection)
        raise
    except BaseException:
        if not commit_started:
            _best_effort_rollback(connection)
        raise ApplySafetyError("apply_failed", "Phase 1 transaction failed") from None
    finally:
        try:
            if cursor is not None:
                try:
                    cursor.close()
                except Exception:
                    pass
        finally:
            connection.close()


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Apply HOT CRUSH R6 Phase 1 safely")
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--catalog-contract", type=Path, required=True)
    parser.add_argument("--applied-by", required=True)
    parser.add_argument("--dsn-env", default="HOTCRUSH_PHASE1_DSN")
    parser.add_argument("--local-scratch", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _argument_parser().parse_args(argv)
    dsn = os.environ.get(args.dsn_env)
    if not dsn:
        print("ERROR missing_dsn: configured DSN environment variable is absent", file=sys.stderr)
        return 2
    try:
        result = apply_phase1(
            dsn=dsn,
            bundle_dir=args.bundle,
            catalog_contract_path=args.catalog_contract,
            applied_by=args.applied_by,
            local_scratch=args.local_scratch,
        )
    except ApplySafetyError as exc:
        print(f"ERROR {exc.code}: {exc}", file=sys.stderr)
        return 2
    print(
        f"{result.status} phase1.sql sha256={result.payload_sha256} "
        f"catalog={result.catalog_fingerprint}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
