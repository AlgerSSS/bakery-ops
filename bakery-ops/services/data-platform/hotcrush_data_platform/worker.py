from __future__ import annotations

import argparse
import json
import logging
import time
from dataclasses import asdict
from typing import Any

from .config import Settings
from .pdf_pipeline import (
    DeterministicTestEmbedder,
    OpenRouterEmbedder,
    chunk_pages,
    extract_pdf_pages,
)
from .supabase_client import SupabasePlatformClient

LOGGER = logging.getLogger("hotcrush-rag-worker")


def _embedder(settings: Settings) -> DeterministicTestEmbedder | OpenRouterEmbedder:
    if settings.embedding_mode == "deterministic":
        return DeterministicTestEmbedder()
    return OpenRouterEmbedder(
        settings.openrouter_api_key,
        settings.openrouter_base_url,
        settings.embedding_model,
    )


def process_one(settings: Settings) -> bool:
    with SupabasePlatformClient(
        settings.supabase_url,
        settings.supabase_service_key,
        settings.request_timeout_seconds,
    ) as client:
        claim = client.one(
            client.rpc(
                "ai_claim_ingest_run",
                {"p_worker_id": settings.worker_id, "p_lease_seconds": 1800},
            )
        )
        if not claim:
            return False

        run_id = int(claim["ingest_run_id"])
        try:
            pdf_bytes = client.download_object(claim["bucket_id"], claim["object_path"])
            client.rpc(
                "ai_heartbeat_ingest_run",
                {
                    "p_ingest_run_id": run_id,
                    "p_worker_id": settings.worker_id,
                    "p_stage": "OCR",
                    "p_lease_seconds": 1800,
                    "p_metrics": {"download_bytes": len(pdf_bytes)},
                },
            )
            pages = extract_pdf_pages(pdf_bytes)
            chunks = chunk_pages(
                pages,
                is_redacted=claim["rag_eligibility"] == "REDACTED_ONLY",
            )
            client.rpc(
                "ai_heartbeat_ingest_run",
                {
                    "p_ingest_run_id": run_id,
                    "p_worker_id": settings.worker_id,
                    "p_stage": "EMBED",
                    "p_lease_seconds": 1800,
                    "p_metrics": {
                        "page_count": len(pages),
                        "ocr_page_count": sum(page.used_ocr for page in pages),
                    },
                },
            )

            embedder = _embedder(settings)
            embeddings: list[list[float]] = []
            for offset in range(0, len(chunks), 64):
                embeddings.extend(embedder.embed([chunk.content for chunk in chunks[offset : offset + 64]]))

            for offset in range(0, len(chunks), 50):
                batch: list[dict[str, Any]] = []
                for chunk, embedding in zip(
                    chunks[offset : offset + 50],
                    embeddings[offset : offset + 50],
                    strict=True,
                ):
                    payload = asdict(chunk)
                    payload["metadata"] = {"extractor": "pymupdf+tesseract"}
                    payload["embedding"] = embedding
                    batch.append(payload)
                client.rpc(
                    "ai_stage_ingest_batch",
                    {
                        "p_ingest_run_id": run_id,
                        "p_worker_id": settings.worker_id,
                        "p_chunks": batch,
                        "p_reset_existing": offset == 0,
                    },
                )

            client.rpc(
                "ai_publish_ingest_run",
                {
                    "p_ingest_run_id": run_id,
                    "p_worker_id": settings.worker_id,
                    "p_page_count": len(pages),
                    "p_expected_chunk_count": len(chunks),
                    "p_expected_embedding_count": len(embeddings),
                    "p_metrics": {
                        "embedding_mode": settings.embedding_mode,
                        "embedding_model": embedder.model,
                    },
                },
            )
            LOGGER.info("published ingest_run=%s pages=%s chunks=%s", run_id, len(pages), len(chunks))
            return True
        except Exception as exc:
            LOGGER.exception("ingest_run=%s failed", run_id)
            try:
                client.rpc(
                    "ai_fail_ingest_run",
                    {
                        "p_ingest_run_id": run_id,
                        "p_worker_id": settings.worker_id,
                        "p_error_code": type(exc).__name__.upper()[:120],
                        "p_error_summary": str(exc)[:2000],
                        "p_retryable": True,
                        "p_retry_delay_seconds": 120,
                        "p_max_attempts": 5,
                        "p_metrics": {},
                    },
                )
            except Exception:
                LOGGER.exception("failed to persist failure for ingest_run=%s", run_id)
            raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Hot Crush Supabase PDF/RAG worker")
    parser.add_argument("--loop", action="store_true", help="poll continuously instead of once")
    parser.add_argument("--poll-seconds", type=float, default=10)
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()
    logging.basicConfig(level=getattr(logging, args.log_level.upper()), format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    settings = Settings.from_env()

    while True:
        processed = process_one(settings)
        if not args.loop:
            print(json.dumps({"processed": processed}))
            return
        if not processed:
            time.sleep(max(1, args.poll_seconds))


if __name__ == "__main__":
    main()
