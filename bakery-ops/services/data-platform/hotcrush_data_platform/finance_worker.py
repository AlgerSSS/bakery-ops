"""Worker that turns immutable finance Raw batches into R6 finance facts.

Kept separate from the POS worker on purpose: the database gives finance and POS distinct
capabilities, and a single worker holding both would undo that separation in process.
"""

from __future__ import annotations

import argparse
import logging
import time
from collections.abc import Callable
from typing import Any

from .config import PosWorkerSettings
from .finance_pipeline import (
    FinanceDataValidationError,
    parse_finance_cost_card_export,
    parse_finance_monthly_export,
)
from .raw_artifacts import download_verified_artifacts
from .supabase_client import SupabasePlatformClient

LOGGER = logging.getLogger("hotcrush-finance-worker")

PIPELINES = {
    "finance_monthly": {
        "source_system": "FINANCE_MONTHLY",
        "artifact": "finance_monthly_export.json",
        "rpc": "ops_load_finance_monthly",
    },
    "finance_cost_card": {
        "source_system": "FINANCE_COST_CARD",
        "artifact": "finance_cost_card_export.json",
        "rpc": "ops_load_finance_cost_cards",
    },
}

ClientFactory = Callable[[str, str, float], SupabasePlatformClient]


def _payload_for(pipeline_key: str, content: bytes, store_id: str) -> dict[str, Any]:
    if pipeline_key == "finance_monthly":
        projection = parse_finance_monthly_export(content, store_id=store_id)
        return {
            "p_month_rows": projection.month_rows,
            "p_revenue_rows": projection.revenue_rows,
        }
    projection = parse_finance_cost_card_export(content)
    return {
        "p_items": projection.items,
        "p_prices": projection.prices,
        "p_recipes": projection.recipes,
        "p_recipe_items": projection.recipe_items,
    }


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
                    "p_pipeline_keys": sorted(PIPELINES),
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
                    {"p_processing_run_id": run_id, "p_worker_id": settings.worker_id},
                )
            )
            if not processing_input:
                raise FinanceDataValidationError("claimed run has no resolvable Raw manifest")

            pipeline_key = str(processing_input.get("pipeline_key") or "")
            spec = PIPELINES.get(pipeline_key)
            if spec is None:
                raise FinanceDataValidationError(
                    f"claimed run is not a finance pipeline: {pipeline_key or '(none)'}"
                )

            source_system = str(processing_input.get("source_system") or "")
            if source_system != spec["source_system"]:
                raise FinanceDataValidationError(
                    f"{pipeline_key} run is backed by {source_system or '(none)'}, "
                    f"expected {spec['source_system']}"
                )

            artifacts = download_verified_artifacts(
                client,
                processing_input.get("objects") or [],
                {spec["artifact"]},
                error_type=FinanceDataValidationError,
            )
            payload = _payload_for(
                pipeline_key,
                artifacts[spec["artifact"]],
                str(processing_input.get("store_id") or ""),
            )
            result = client.rpc(
                spec["rpc"],
                {
                    "p_processing_run_id": run_id,
                    "p_worker_id": settings.worker_id,
                    **payload,
                },
            )
            LOGGER.info("published processing_run=%s pipeline=%s result=%s", run_id, pipeline_key, result)
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
                        # A malformed export will fail identically on every retry; only
                        # transport-level problems are worth retrying.
                        "p_retryable": not isinstance(exc, FinanceDataValidationError),
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
    max_runs: int = 25,
    client_factory: ClientFactory = SupabasePlatformClient,
) -> int:
    processed = 0
    while processed < max_runs:
        if not process_one(settings, client_factory=client_factory):
            break
        processed += 1
    return processed


def main() -> None:
    parser = argparse.ArgumentParser(description="Drain pending finance processing runs")
    parser.add_argument("--max-runs", type=int, default=25)
    parser.add_argument("--loop-seconds", type=int, default=0)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = PosWorkerSettings.from_env()
    while True:
        processed = drain_available(settings, max_runs=args.max_runs)
        LOGGER.info("drained %s finance runs", processed)
        if args.loop_seconds <= 0:
            return
        time.sleep(args.loop_seconds)


if __name__ == "__main__":
    main()
