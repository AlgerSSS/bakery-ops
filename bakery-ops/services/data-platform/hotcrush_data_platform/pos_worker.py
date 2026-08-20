from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import logging
import time
from collections.abc import Callable
from typing import Any

from .config import PosWorkerSettings
from .pos_pipeline import (
    PosDataValidationError,
    parse_legacy_pos_export,
    parse_pos_daily_artifacts,
)
from .supabase_client import SupabasePlatformClient

LOGGER = logging.getLogger("hotcrush-pos-worker")
SOURCE_ARTIFACTS = {
    "RES_POS_DAILY": {"daily.json", "sales_by_business_date.csv"},
    "LEGACY_POS_EXPORT": {"legacy_pos_export.json"},
}
ClientFactory = Callable[[str, str, float], SupabasePlatformClient]


def _download_verified_artifacts(
    client: SupabasePlatformClient,
    manifest: list[dict[str, Any]],
    required_artifacts: set[str],
) -> dict[str, bytes]:
    by_key: dict[str, dict[str, Any]] = {}
    for item in manifest:
        key = str(item.get("source_record_key") or "")
        if key not in required_artifacts:
            continue
        if key in by_key:
            raise PosDataValidationError(f"duplicate Raw object registration for {key}")
        by_key[key] = item
    missing = required_artifacts.difference(by_key)
    if missing:
        raise PosDataValidationError(f"required POS artifacts are missing: {sorted(missing)}")

    artifacts: dict[str, bytes] = {}
    for key in sorted(required_artifacts):
        item = by_key[key]
        content = client.download_object(str(item["bucket_id"]), str(item["object_path"]))
        if len(content) != int(item["size_bytes"]):
            raise PosDataValidationError(f"size mismatch for {key}")
        actual_sha256 = hashlib.sha256(content).hexdigest()
        if not hmac.compare_digest(actual_sha256, str(item["sha256"])):
            raise PosDataValidationError(f"sha256 mismatch for {key}")
        artifacts[key] = content
    return artifacts


def process_one(
    settings: PosWorkerSettings,
    *,
    client_factory: ClientFactory = SupabasePlatformClient,
) -> bool:
    with client_factory(
        settings.supabase_url,
        settings.supabase_service_key,
        settings.request_timeout_seconds,
    ) as client:
        claim = client.one(
            client.rpc(
                "ops_claim_processing_run_for_pipeline",
                {
                    "p_worker_id": settings.worker_id,
                    "p_pipeline_keys": ["pos_daily_sales"],
                    "p_lease_seconds": 300,
                },
            )
        )
        if not claim or claim.get("processing_run_id") is None:
            return False

        run_id = int(claim["processing_run_id"])
        try:
            processing_input = client.one(
                client.rpc(
                    "ops_get_processing_input",
                    {
                        "p_processing_run_id": run_id,
                        "p_worker_id": settings.worker_id,
                    },
                )
            )
            if not processing_input or processing_input.get("pipeline_key") != "pos_daily_sales":
                raise PosDataValidationError("claimed run is not a pos_daily_sales run")
            source_system = str(processing_input.get("source_system") or "")
            required_artifacts = SOURCE_ARTIFACTS.get(source_system)
            if required_artifacts is None:
                raise PosDataValidationError(f"unsupported POS source system {source_system}")
            artifacts = _download_verified_artifacts(
                client, processing_input.get("objects") or [], required_artifacts
            )
            store_id = str(processing_input.get("store_id") or "")
            projection = (
                parse_legacy_pos_export(artifacts["legacy_pos_export.json"], store_id=store_id)
                if source_system == "LEGACY_POS_EXPORT"
                else parse_pos_daily_artifacts(artifacts, store_id=store_id)
            )
            client.rpc(
                "ops_load_pos_daily_sales",
                {
                    "p_processing_run_id": run_id,
                    "p_worker_id": settings.worker_id,
                    "p_daily_rows": projection.daily_rows,
                    "p_hourly_rows": projection.hourly_rows,
                },
            )
            LOGGER.info(
                "published processing_run=%s daily_rows=%s hourly_rows=%s target=%s",
                run_id,
                len(projection.daily_rows),
                len(projection.hourly_rows),
                projection.target_business_date,
            )
            return True
        except Exception as exc:
            LOGGER.exception("processing_run=%s failed", run_id)
            try:
                client.rpc(
                    "ops_fail_processing_run",
                    {
                        "p_processing_run_id": run_id,
                        "p_worker_id": settings.worker_id,
                        "p_error_code": type(exc).__name__.upper()[:120],
                        "p_error_summary": str(exc)[:2000],
                        "p_retryable": not isinstance(exc, PosDataValidationError),
                        "p_retry_delay_seconds": 120,
                        "p_max_attempts": 5,
                    },
                )
            except Exception:
                LOGGER.exception("failed to persist failure for processing_run=%s", run_id)
            raise


def drain_available(
    settings: PosWorkerSettings,
    *,
    max_runs: int,
    process: Callable[[PosWorkerSettings], bool] = process_one,
) -> int:
    if max_runs < 1 or max_runs > 10_000:
        raise ValueError("max_runs must be between 1 and 10000")
    processed = 0
    while processed < max_runs and process(settings):
        processed += 1
    return processed


def main() -> None:
    parser = argparse.ArgumentParser(description="Hot Crush Supabase structured POS worker")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--loop", action="store_true", help="poll continuously instead of once")
    mode.add_argument("--drain", action="store_true", help="process available work then exit")
    parser.add_argument("--max-runs", type=int, default=100)
    parser.add_argument("--poll-seconds", type=float, default=10)
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    settings = PosWorkerSettings.from_env()

    if args.drain:
        processed = drain_available(settings, max_runs=args.max_runs)
        print(json.dumps({"processed": processed, "drained": processed < args.max_runs}))
        return

    while True:
        processed = process_one(settings)
        if not args.loop:
            print(json.dumps({"processed": processed}))
            return
        if not processed:
            time.sleep(max(1, args.poll_seconds))


if __name__ == "__main__":
    main()
