#!/usr/bin/env python3
"""Destructive-to-scratch acceptance for the sealed Phase 1 release.

This harness only starts disposable loopback Docker databases.  It never accepts
or constructs a remote Supabase DSN.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

import psycopg2
from psycopg2.extras import register_uuid


IMPLEMENTATION_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(IMPLEMENTATION_DIR))

import phase1_apply as apply  # noqa: E402
import phase1_catalog as catalog  # noqa: E402


IMAGE = "postgres:17.6-alpine"
IMAGE_DIGEST = "sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94"
PASSWORD = "localonly"
BUNDLE = IMPLEMENTATION_DIR / "generated"
CONTRACT = IMPLEMENTATION_DIR / apply.CATALOG_CONTRACT_FILENAME

register_uuid()


def _run(*args: str) -> str:
    completed = subprocess.run(args, check=True, text=True, capture_output=True)
    return completed.stdout.strip()


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def _dsn(port: int) -> str:
    return (
        f"host=127.0.0.1 port={port} dbname={apply.SCRATCH_DATABASE} "
        f"user=postgres password={PASSWORD} sslmode=disable"
    )


def _connect(port: int):
    return psycopg2.connect(
        host="127.0.0.1",
        port=port,
        dbname=apply.SCRATCH_DATABASE,
        user="postgres",
        password=PASSWORD,
        connect_timeout=5,
    )


@contextmanager
def scratch_cluster(label: str):
    port = _free_port()
    name = f"hotcrush-r6-{label}-{uuid.uuid4().hex[:8]}"
    _run(
        "docker",
        "run",
        "--rm",
        "-d",
        "--name",
        name,
        "-p",
        f"127.0.0.1:{port}:5432",
        "-e",
        f"POSTGRES_PASSWORD={PASSWORD}",
        "-e",
        f"POSTGRES_DB={apply.SCRATCH_DATABASE}",
        IMAGE,
    )
    try:
        deadline = time.monotonic() + 30
        while True:
            try:
                connection = _connect(port)
                connection.autocommit = True
                cursor = connection.cursor()
                cursor.execute("CREATE ROLE anon NOLOGIN")
                cursor.execute("CREATE ROLE authenticated NOLOGIN")
                cursor.execute("CREATE ROLE service_role NOLOGIN")
                cursor.execute("CREATE SCHEMA extensions")
                cursor.execute("CREATE EXTENSION pgcrypto WITH SCHEMA extensions")
                cursor.close()
                connection.close()
                break
            except psycopg2.OperationalError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.25)
        yield port
    finally:
        subprocess.run(
            ["docker", "stop", name],
            check=False,
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def _apply(port: int, applied_by: str) -> apply.ApplyResult:
    return apply.apply_phase1(
        dsn=_dsn(port),
        bundle_dir=BUNDLE,
        catalog_contract_path=CONTRACT,
        applied_by=applied_by,
        local_scratch=True,
    )


def _assert_concurrent_apply(port: int) -> apply.ApplyResult:
    role_admin = _connect(port)
    role_admin.autocommit = True
    role_admin_cursor = role_admin.cursor()
    role_admin_cursor.execute("ALTER ROLE postgres SET transaction_timeout = '250ms'")
    timeout_injected = True
    blocker = _connect(port)
    blocker.autocommit = True
    blocker_cursor = blocker.cursor()
    lock_held = False
    executor = ThreadPoolExecutor(max_workers=2)
    futures = []
    try:
        blocker_cursor.execute(
            "SELECT pg_catalog.pg_advisory_lock("
            "pg_catalog.hashtextextended(%s, 0))",
            (apply.SESSION_LOCK_KEY,),
        )
        lock_held = True
        futures = [
            executor.submit(_apply, port, "pg17-concurrent-a"),
            executor.submit(_apply, port, "pg17-concurrent-b"),
        ]

        monitor = _connect(port)
        monitor.autocommit = True
        monitor_cursor = monitor.cursor()
        try:
            deadline = time.monotonic() + 30
            while True:
                monitor_cursor.execute(
                    """
                    SELECT pg_catalog.count(DISTINCT lock.pid)
                      FROM pg_catalog.pg_locks AS lock
                      JOIN pg_catalog.pg_stat_activity AS activity
                        ON activity.pid = lock.pid
                     WHERE lock.locktype = 'advisory'
                       AND lock.database = (
                             SELECT oid
                               FROM pg_catalog.pg_database
                              WHERE datname = pg_catalog.current_database()
                           )
                       AND NOT lock.granted
                       AND activity.application_name = 'hotcrush-r6-phase1-runner'
                    """
                )
                if monitor_cursor.fetchone() == (2,):
                    time.sleep(0.5)
                    if any(future.done() for future in futures):
                        raise AssertionError(
                            "an inherited transaction_timeout interrupted a waiting runner"
                        )
                    break
                if any(future.done() for future in futures):
                    raise AssertionError("runner completed before the forced lock contention")
                if time.monotonic() >= deadline:
                    raise AssertionError("both concurrent runners did not reach the session lock")
                time.sleep(0.05)
        finally:
            monitor_cursor.close()
            monitor.close()

        blocker_cursor.execute(
            "SELECT pg_catalog.pg_advisory_unlock("
            "pg_catalog.hashtextextended(%s, 0))",
            (apply.SESSION_LOCK_KEY,),
        )
        assert blocker_cursor.fetchone() == (True,)
        lock_held = False

        results = [future.result(timeout=60) for future in futures]
        assert sorted(result.status for result in results) == ["APPLIED", "NOOP"]
        assert len({result.payload_sha256 for result in results}) == 1
        assert len({result.catalog_fingerprint for result in results}) == 1

        role_admin_cursor.execute("ALTER ROLE postgres RESET transaction_timeout")
        timeout_injected = False

        verification = _connect(port)
        try:
            cursor = verification.cursor()
            cursor.execute("SELECT pg_catalog.count(*) FROM public.app_schema_migration")
            assert cursor.fetchone() == (1,)
            cursor.execute(
                """
                SELECT pg_catalog.count(*)
                  FROM pg_catalog.pg_locks
                 WHERE locktype = 'advisory'
                   AND database = (
                         SELECT oid
                           FROM pg_catalog.pg_database
                          WHERE datname = pg_catalog.current_database()
                       )
                """
            )
            assert cursor.fetchone() == (0,)
        finally:
            verification.rollback()
            verification.close()
        return next(result for result in results if result.status == "APPLIED")
    finally:
        if lock_held:
            blocker_cursor.execute(
                "SELECT pg_catalog.pg_advisory_unlock("
                "pg_catalog.hashtextextended(%s, 0))",
                (apply.SESSION_LOCK_KEY,),
            )
        blocker_cursor.close()
        blocker.close()
        executor.shutdown(wait=True, cancel_futures=True)
        if timeout_injected:
            role_admin_cursor.execute("ALTER ROLE postgres RESET transaction_timeout")
        role_admin_cursor.close()
        role_admin.close()


def _assert_sqlstate(cursor, sql: str, expected: str, params: tuple[object, ...] = ()) -> None:
    savepoint = f"expected_{uuid.uuid4().hex[:12]}"
    cursor.execute(f"SAVEPOINT {savepoint}")
    try:
        cursor.execute(sql, params)
    except psycopg2.Error as exc:
        if exc.pgcode != expected:
            raise AssertionError(f"expected SQLSTATE {expected}, got {exc.pgcode}") from exc
        cursor.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
        cursor.execute(f"RELEASE SAVEPOINT {savepoint}")
        return
    raise AssertionError(f"statement unexpectedly succeeded; expected SQLSTATE {expected}")


def _assert_catalog_and_ledger(port: int, expected_fingerprint: str) -> bytes:
    manifest = json.loads((BUNDLE / "phase1-ddl-manifest.json").read_text(encoding="utf-8"))
    connection = _connect(port)
    try:
        cursor = connection.cursor()
        captured = catalog.capture_catalog(cursor, manifest)
        catalog.validate_catalog_contract_document(captured, manifest)
        canonical = catalog.canonical_catalog_bytes(captured)
        assert catalog.catalog_fingerprint(captured) == expected_fingerprint
        cursor.execute(
            """
            SELECT repository_code, migration_version, filename,
                   checksum_sha256::pg_catalog.text, execution_ms
              FROM public.app_schema_migration
            """
        )
        assert cursor.fetchall() == [
            (
                "hotcrush_core_r6",
                "R6_PHASE1_BASELINE",
                "phase1.sql",
                manifest["payload"]["sha256"],
                None,
            )
        ]
        return canonical
    finally:
        connection.rollback()
        connection.close()


def _assert_failed_catalog_rolls_back_to_empty(port: int) -> None:
    failure = catalog.CatalogContractError("$.forced_failure", "secret-a", "secret-b")
    with mock.patch.object(apply, "verify_catalog_contract", side_effect=failure):
        try:
            _apply(port, "rollback-proof")
        except apply.ApplySafetyError as exc:
            assert exc.code == "catalog_mismatch"
            assert "secret-a" not in str(exc) and "secret-b" not in str(exc)
        else:
            raise AssertionError("forced catalog mismatch unexpectedly committed")
    manifest = json.loads((BUNDLE / "phase1-ddl-manifest.json").read_text(encoding="utf-8"))
    connection = _connect(port)
    try:
        cursor = connection.cursor()
        cursor.execute(
            """
            SELECT pg_catalog.count(*)
              FROM pg_catalog.pg_class AS relation
              JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
             WHERE namespace.nspname = 'public' AND relation.relname = ANY(%s)
            """,
            ([table["name"] for table in manifest["tables"]],),
        )
        assert cursor.fetchone() == (0,)
        cursor.execute("SELECT pg_catalog.to_regprocedure('public.app_normalize_alias_v1(text)')")
        assert cursor.fetchone() == (None,)
        cursor.execute("SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles WHERE rolname ~ '^hc_r6_'")
        assert cursor.fetchone() == (0,)
    finally:
        connection.rollback()
        connection.close()


def _assert_check_exclusion_fk_and_rls(port: int) -> None:
    connection = _connect(port)
    try:
        cursor = connection.cursor()

        _assert_sqlstate(
            cursor,
            """
            INSERT INTO public.app_source_system
              (source_system_id, source_code, source_name, source_type, owner_project, authoritative_scope)
            VALUES ('00000000-0000-0000-0000-000000000000', 'nil', 'nil', 'TEST', 'test', 'test')
            """,
            "23514",
        )

        user_id = uuid.uuid4()
        grantor_id = uuid.uuid4()
        role_id = uuid.uuid4()
        cursor.execute(
            "INSERT INTO public.app_user (user_id, username, display_name, account_type) VALUES (%s,%s,%s,%s),(%s,%s,%s,%s)",
            (user_id, f"u-{user_id}", "user", "HUMAN", grantor_id, f"u-{grantor_id}", "grantor", "HUMAN"),
        )
        cursor.execute(
            "INSERT INTO public.app_role (role_id, role_code, role_name, description) VALUES (%s,%s,%s,%s)",
            (role_id, f"r-{role_id}", "role", "test"),
        )
        cursor.execute(
            """
            INSERT INTO public.app_user_role (user_id, role_id, valid_from, valid_to, granted_by_user_id)
            VALUES (%s,%s,'2026-01-01T00:00:00Z','2026-02-01T00:00:00Z',%s),
                   (%s,%s,'2026-02-01T00:00:00Z','2026-03-01T00:00:00Z',%s)
            """,
            (user_id, role_id, grantor_id, user_id, role_id, grantor_id),
        )
        _assert_sqlstate(
            cursor,
            """
            INSERT INTO public.app_user_role (user_id, role_id, valid_from, valid_to, granted_by_user_id)
            VALUES (%s,%s,'2026-01-15T00:00:00Z','2026-02-15T00:00:00Z',%s)
            """,
            "23P01",
            (user_id, role_id, grantor_id),
        )

        source_id = uuid.uuid4()
        unit_id = uuid.uuid4()
        product_id = uuid.uuid4()
        cursor.execute(
            "INSERT INTO public.app_source_system (source_system_id,source_code,source_name,source_type,owner_project,authoritative_scope) VALUES (%s,%s,%s,%s,%s,%s)",
            (source_id, f"s-{source_id}", "source", "MANUAL", "test", "test"),
        )
        cursor.execute(
            "INSERT INTO public.app_unit (unit_id,unit_code,unit_name,dimension_code) VALUES (%s,%s,%s,%s)",
            (unit_id, f"u-{unit_id}", "unit", "COUNT"),
        )
        cursor.execute(
            "INSERT INTO public.ops_product (product_id,product_code,product_name,product_type,category_code,base_unit_id) VALUES (%s,%s,%s,%s,%s,%s)",
            (product_id, f"p-{product_id}", "product", "SELLABLE", "TEST", unit_id),
        )
        cursor.execute(
            """
            INSERT INTO public.ops_product_alias
              (product_id,source_system_id,alias_text,valid_from,valid_to,status)
            VALUES (%s,%s,'same alias','2026-01-01','2026-03-01','PENDING'),
                   (%s,%s,' same   alias ','2026-02-01','2026-04-01','PENDING'),
                   (%s,%s,'same alias','2026-04-01','2026-06-01','CONFIRMED')
            """,
            (product_id, source_id, product_id, source_id, product_id, source_id),
        )
        _assert_sqlstate(
            cursor,
            """
            INSERT INTO public.ops_product_alias
              (product_id,source_system_id,alias_text,valid_from,valid_to,status)
            VALUES (%s,%s,' same alias ','2026-05-01','2026-07-01','CONFIRMED')
            """,
            "23P01",
            (product_id, source_id),
        )

        reward_id = uuid.uuid4()
        campaign_version_id = uuid.uuid4()
        member_id = uuid.uuid4()
        campaign_member_id = uuid.uuid4()
        stock_id = uuid.uuid4()
        cursor.execute(
            "INSERT INTO public.mkt_reward (reward_id,reward_code,reward_name,reward_type) VALUES (%s,%s,%s,%s)",
            (reward_id, f"reward-{reward_id}", "reward", "PHYSICAL_GIFT"),
        )
        cursor.execute(
            """
            INSERT INTO public.mkt_campaign_version
              (campaign_version_id,campaign_code,campaign_name,campaign_type,version_no,status)
            VALUES (%s,%s,%s,%s,1,'ARCHIVED')
            """,
            (campaign_version_id, f"campaign-{campaign_version_id}", "campaign", "SURVEY"),
        )
        cursor.execute(
            "INSERT INTO public.pos_member (member_id,source_system_id,source_member_id) VALUES (%s,%s,%s)",
            (member_id, source_id, f"member-{member_id}"),
        )
        cursor.execute(
            """
            INSERT INTO public.mkt_campaign_member
              (campaign_member_id,campaign_version_id,member_id,eligibility_status)
            VALUES (%s,%s,%s,'ELIGIBLE')
            """,
            (campaign_member_id, campaign_version_id, member_id),
        )
        cursor.execute(
            """
            INSERT INTO public.mkt_reward_stock
              (reward_stock_id,campaign_version_id,reward_id,allocated_quantity)
            VALUES (%s,%s,%s,10)
            """,
            (stock_id, campaign_version_id, reward_id),
        )
        cursor.execute(
            """
            INSERT INTO public.mkt_reward_claim
              (campaign_member_id,reward_stock_id,reward_id,idempotency_key,status,source_system_id,source_fulfillment_id)
            VALUES (%s,NULL,%s,%s,'RESERVED',%s,'external-1')
            """,
            (campaign_member_id, reward_id, uuid.uuid4().hex * 2, source_id),
        )
        _assert_sqlstate(
            cursor,
            """
            INSERT INTO public.mkt_reward_claim
              (campaign_member_id,reward_stock_id,reward_id,idempotency_key,status)
            VALUES (%s,%s,%s,%s,'RESERVED')
            """,
            "23503",
            (campaign_member_id, uuid.uuid4(), reward_id, uuid.uuid4().hex * 2),
        )

        deferred_stock = uuid.uuid4()
        deferred_campaign_version = uuid.uuid4()
        cursor.execute(
            """
            INSERT INTO public.mkt_campaign_version
              (campaign_version_id,campaign_code,campaign_name,campaign_type,version_no,status)
            VALUES (%s,%s,%s,'SURVEY',1,'ARCHIVED')
            """,
            (
                deferred_campaign_version,
                f"campaign-{deferred_campaign_version}",
                "deferred campaign",
            ),
        )
        composite_name = "fk_mkt_reward_claim__reward_stock_id__reward_id__mkt_0f44d1b776"
        cursor.execute(f'SET CONSTRAINTS "{composite_name}" DEFERRED')
        cursor.execute(
            """
            INSERT INTO public.mkt_reward_claim
              (campaign_member_id,reward_stock_id,reward_id,idempotency_key,status)
            VALUES (%s,%s,%s,%s,'RESERVED')
            """,
            (campaign_member_id, deferred_stock, reward_id, uuid.uuid4().hex * 2),
        )
        cursor.execute(
            """
            INSERT INTO public.mkt_reward_stock
              (reward_stock_id,campaign_version_id,reward_id,allocated_quantity)
            VALUES (%s,%s,%s,10)
            """,
            (deferred_stock, deferred_campaign_version, reward_id),
        )
        cursor.execute(f'SET CONSTRAINTS "{composite_name}" IMMEDIATE')
        cursor.execute(
            """
            INSERT INTO public.mkt_reward_claim
              (campaign_member_id,reward_stock_id,reward_id,idempotency_key,status)
            VALUES (%s,%s,%s,%s,'RESERVED')
            """,
            (campaign_member_id, stock_id, reward_id, uuid.uuid4().hex * 2),
        )
        _assert_sqlstate(
            cursor,
            "DELETE FROM public.mkt_reward_stock WHERE reward_stock_id=%s",
            "23503",
            (stock_id,),
        )
        connection.rollback()

        cursor = connection.cursor()
        cursor.execute("SET LOCAL ROLE anon")
        _assert_sqlstate(cursor, "SELECT * FROM public.app_source_system", "42501")
        connection.rollback()

        cursor = connection.cursor()
        cursor.execute("GRANT SELECT, INSERT ON public.app_source_system TO anon")
        cursor.execute("SET LOCAL ROLE anon")
        cursor.execute("SELECT pg_catalog.count(*) FROM public.app_source_system")
        assert cursor.fetchone() == (0,)
        _assert_sqlstate(
            cursor,
            """
            INSERT INTO public.app_source_system
              (source_code,source_name,source_type,owner_project,authoritative_scope)
            VALUES ('rls','rls','TEST','test','test')
            """,
            "42501",
        )
        connection.rollback()
    finally:
        connection.close()


def main() -> int:
    digest = _run("docker", "image", "inspect", IMAGE, "--format", "{{index .RepoDigests 0}}")
    if not digest.endswith(IMAGE_DIGEST):
        raise AssertionError(f"unexpected Docker image digest: {digest}")
    routing = {key: os.environ.pop(key) for key in apply.ROUTING_ENVIRONMENT_KEYS if key in os.environ}
    try:
        with scratch_cluster("a") as port_a, scratch_cluster("b") as port_b:
            first_a = _assert_concurrent_apply(port_a)
            assert first_a.status == "APPLIED"
            assert _apply(port_a, "pg17-acceptance-a-rerun").status == "NOOP"
            _assert_check_exclusion_fk_and_rls(port_a)
            bytes_a = _assert_catalog_and_ledger(port_a, first_a.catalog_fingerprint)

            _assert_failed_catalog_rolls_back_to_empty(port_b)
            first_b = _apply(port_b, "pg17-acceptance-b")
            assert first_b.status == "APPLIED"
            assert _apply(port_b, "pg17-acceptance-b-rerun").status == "NOOP"
            bytes_b = _assert_catalog_and_ledger(port_b, first_b.catalog_fingerprint)

            assert first_a.catalog_fingerprint == first_b.catalog_fingerprint
            assert bytes_a == bytes_b
            print(
                json.dumps(
                    {
                        "status": "PASS",
                        "image_digest": IMAGE_DIGEST,
                        "phase1_sha256": first_a.payload_sha256,
                        "catalog_fingerprint": first_a.catalog_fingerprint,
                        "clusters": 2,
                        "concurrent_statuses": ["APPLIED", "NOOP"],
                        "rerun_status": "NOOP",
                    },
                    sort_keys=True,
                )
            )
            return 0
    finally:
        os.environ.update(routing)


if __name__ == "__main__":
    raise SystemExit(main())
