from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .classification import Classification, classify_path
from .config import Settings
from .pdf_pipeline import DeterministicTestEmbedder, OpenRouterEmbedder
from .supabase_client import SupabasePlatformClient


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inventory(root: Path, include_hash: bool = False) -> list[dict[str, Any]]:
    if not root.is_dir():
        raise ValueError(f"not a directory: {root}")
    entries: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*.pdf")):
        classification = classify_path(path.relative_to(root))
        entry: dict[str, Any] = {
            "relative_path": str(path.relative_to(root)),
            "size_bytes": path.stat().st_size,
            **classification.to_dict(),
            "sha256": None,
            "inventory_status": "METADATA_ONLY",
        }
        if include_hash:
            try:
                entry["sha256"] = sha256_file(path)
                entry["inventory_status"] = "HASHED"
            except OSError as exc:
                entry["inventory_status"] = "UNAVAILABLE"
                entry["error"] = type(exc).__name__
        entries.append(entry)
    return entries


def _safe_title(path: Path, classification: Classification, sha256: str) -> str:
    if classification.data_class in ("C1", "C2"):
        return path.stem[:160]
    return f"{classification.document_type} {sha256[:10]}"


def upload_one(
    path: Path,
    settings: Settings,
    *,
    classification: Classification | None = None,
) -> dict[str, Any]:
    if not path.is_file() or path.suffix.casefold() != ".pdf":
        raise ValueError(f"not a PDF file: {path}")
    classification = classification or classify_path(path)
    content = path.read_bytes()
    sha256 = hashlib.sha256(content).hexdigest()
    document_key = sha256[:32]
    object_path = f"{classification.space_id}/{document_key}/1/original.pdf"
    mime_type = mimetypes.guess_type(path.name)[0] or "application/pdf"
    source_batch_key = f"brain:{sha256}"

    with SupabasePlatformClient(
        settings.supabase_url,
        settings.supabase_service_key,
        settings.request_timeout_seconds,
    ) as client:
        batch = client.one(
            client.rpc(
                "ops_register_raw_batch",
                {
                    "p_source_system": "BRAIN_PDF",
                    "p_source_batch_key": source_batch_key,
                    "p_schema_version": "brain-pdf-v1",
                    "p_writer_id": "brainctl",
                    "p_store_id": None,
                    "p_expected_count": 1,
                    "p_metadata": {
                        "classification_reason": classification.reason,
                        "source_modified_at": datetime.fromtimestamp(
                            path.stat().st_mtime, tz=UTC
                        ).isoformat(),
                    },
                },
            )
        )
        if not batch:
            raise RuntimeError("batch registration returned no row")

        uploaded = client.upload_object(
            classification.bucket_id,
            object_path,
            content,
            mime_type,
        )
        raw_object = client.one(
            client.rpc(
                "ops_register_raw_object",
                {
                    "p_batch_id": batch["batch_id"],
                    "p_bucket_id": classification.bucket_id,
                    "p_object_path": object_path,
                    "p_sha256": sha256,
                    "p_size_bytes": len(content),
                    "p_mime_type": mime_type,
                    "p_data_class": classification.data_class,
                    "p_source_record_key": document_key,
                    "p_source_version": "1",
                },
            )
        )
        if not raw_object:
            raise RuntimeError("raw object registration returned no row")

        client.rpc(
            "ops_complete_raw_batch",
            {
                "p_batch_id": batch["batch_id"],
                "p_accepted_count": 1,
                "p_rejected_count": 0,
                "p_pipeline_keys": [],
                "p_pipeline_version": settings.pipeline_version,
            },
        )
        document = client.one(
            client.rpc(
                "ai_finalize_document_upload",
                {
                    "p_raw_object_id": raw_object["raw_object_id"],
                    "p_space_id": classification.space_id,
                    "p_document_key": document_key,
                    "p_version_no": 1,
                    "p_title": _safe_title(path, classification, sha256),
                    "p_document_type": classification.document_type,
                    "p_pipeline_version": settings.pipeline_version,
                    "p_embedding_model": settings.embedding_model,
                },
            )
        )
        if not document:
            raise RuntimeError("document finalization returned no row")

    return {
        "path": str(path),
        "sha256": sha256,
        "uploaded": uploaded,
        "batch_id": batch["batch_id"],
        "raw_object_id": raw_object["raw_object_id"],
        "document_id": document["document_id"],
        "document_status": document["status"],
        "rag_eligibility": document["rag_eligibility"],
        "classification": asdict(classification),
    }


def search_knowledge(
    query: str,
    settings: Settings,
    *,
    space_ids: list[str],
    limit: int,
) -> list[dict[str, Any]]:
    if not query.strip():
        raise ValueError("search query cannot be blank")
    if not space_ids:
        raise ValueError("at least one explicit knowledge-space ID is required")

    if settings.embedding_mode == "deterministic":
        embedder = DeterministicTestEmbedder()
    else:
        embedder = OpenRouterEmbedder(
            settings.openrouter_api_key,
            settings.openrouter_base_url,
            settings.embedding_model,
        )
    query_embedding = embedder.embed([query])[0]

    with SupabasePlatformClient(
        settings.supabase_url,
        settings.supabase_service_key,
        settings.request_timeout_seconds,
    ) as client:
        result = client.rpc(
            "ai_search_knowledge",
            {
                "p_query": query,
                "p_query_embedding": query_embedding,
                "p_limit": limit,
                "p_space_ids": space_ids,
                "p_model_version": settings.embedding_model,
            },
        )
    if not isinstance(result, list):
        raise TypeError("knowledge search did not return a row list")
    return result


def _write_json(value: Any, output: Path | None) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=2)
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


def main() -> None:
    parser = argparse.ArgumentParser(description="Inventory and ingest the Hot Crush Brain PDF store")
    subparsers = parser.add_subparsers(dest="command", required=True)

    inventory_parser = subparsers.add_parser("inventory", help="classify PDFs without uploading")
    inventory_parser.add_argument("root", type=Path)
    inventory_parser.add_argument("--hash", action="store_true", help="read every file and calculate SHA-256")
    inventory_parser.add_argument("--output", type=Path)

    upload_parser = subparsers.add_parser("upload", help="upload and finalize exactly one PDF")
    upload_parser.add_argument("pdf", type=Path)
    upload_parser.add_argument(
        "--allow-review-required",
        action="store_true",
        help="store C2/C3/C4 originals; they remain blocked from automatic RAG",
    )

    search_parser = subparsers.add_parser("search", help="run a scoped hybrid RAG search")
    search_parser.add_argument("query")
    search_parser.add_argument(
        "--space-id",
        action="append",
        required=True,
        help="explicit authorized knowledge-space UUID; repeat to search more than one space",
    )
    search_parser.add_argument("--limit", type=int, default=5)

    args = parser.parse_args()
    try:
        if args.command == "inventory":
            _write_json(inventory(args.root, include_hash=args.hash), args.output)
            return

        settings = Settings.from_env()
        if args.command == "search":
            _write_json(
                search_knowledge(
                    args.query,
                    settings,
                    space_ids=args.space_id,
                    limit=args.limit,
                ),
                None,
            )
            return

        classification = classify_path(args.pdf)
        if classification.rag_action != "AUTO" and not args.allow_review_required:
            raise ValueError(
                f"classification is {classification.data_class}/{classification.rag_action}; "
                "review before upload or pass --allow-review-required to store without auto-RAG"
            )
        _write_json(upload_one(args.pdf, settings, classification=classification), None)
    except Exception as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
