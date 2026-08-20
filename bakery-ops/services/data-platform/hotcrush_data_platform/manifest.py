from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from .classification import Classification, classify_path

MANIFEST_SCHEMA_VERSION = "hotcrush-brain-manifest-v1"
REVIEW_SCHEMA_VERSION = "hotcrush-brain-review-v1"
REVIEW_DECISIONS = {"APPROVE_RAG", "DENY_RAG"}


def brain_source_batch_key(space_id: str, sha256: str) -> str:
    return f"brain:{space_id}:{sha256}"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _manifest_digest(entries: list[dict[str, Any]]) -> str:
    payload = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "entries": entries,
    }
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


def _review_digest(source_manifest_sha256: str, entries: list[dict[str, Any]]) -> str:
    payload = {
        "schema_version": REVIEW_SCHEMA_VERSION,
        "source_manifest_sha256": source_manifest_sha256,
        "entries": entries,
    }
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


def _disposition(classification: Classification) -> str:
    if classification.rag_action == "AUTO":
        return "AUTO_UPLOAD"
    if classification.rag_action == "DENY":
        return "DENIED"
    return "REVIEW_REQUIRED"


def build_manifest(root: Path) -> dict[str, Any]:
    if not root.is_dir():
        raise ValueError(f"not a directory: {root}")

    entries: list[dict[str, Any]] = []
    canonical_by_boundary: dict[tuple[str, str], str] = {}
    for path in sorted(root.rglob("*.pdf")):
        relative_path = path.relative_to(root)
        classification = classify_path(relative_path)
        sha256 = _sha256_file(path)
        boundary_key = (classification.space_id, sha256)
        duplicate_of = canonical_by_boundary.get(boundary_key)
        disposition = _disposition(classification)
        if duplicate_of is None:
            canonical_by_boundary[boundary_key] = relative_path.as_posix()
        else:
            disposition = "DUPLICATE_SKIP"

        stat = path.stat()
        entries.append(
            {
                "relative_path": relative_path.as_posix(),
                "size_bytes": stat.st_size,
                "modified_at_ns": stat.st_mtime_ns,
                "sha256": sha256,
                "classification": classification.to_dict(),
                "disposition": disposition,
                "duplicate_of": duplicate_of,
            }
        )

    counts = Counter(entry["disposition"] for entry in entries)
    summary = {
        "total": len(entries),
        "auto_upload": counts["AUTO_UPLOAD"],
        "review_required": counts["REVIEW_REQUIRED"],
        "denied": counts["DENIED"],
        "duplicate_skip": counts["DUPLICATE_SKIP"],
    }
    return {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "created_at": datetime.now(tz=UTC).isoformat(),
        "manifest_sha256": _manifest_digest(entries),
        "summary": summary,
        "entries": entries,
    }


def _validate_manifest(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise ValueError("unsupported manifest schema version")
    entries = manifest.get("entries")
    if not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries):
        raise ValueError("manifest entries must be an array of objects")
    if manifest.get("manifest_sha256") != _manifest_digest(entries):
        raise ValueError("manifest digest does not match its entries")
    return entries


def _manifest_entries_by_path(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entries = _validate_manifest(manifest)
    entries_by_path: dict[str, dict[str, Any]] = {}
    for entry in entries:
        relative_path = entry.get("relative_path")
        if not isinstance(relative_path, str):
            raise TypeError("manifest relative_path must be a string")
        if relative_path in entries_by_path:
            raise ValueError(f"duplicate manifest relative_path: {relative_path}")
        entries_by_path[relative_path] = entry
    return entries_by_path


def _validate_review_manifest(
    review_manifest: dict[str, Any],
    manifest: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    if review_manifest.get("schema_version") != REVIEW_SCHEMA_VERSION:
        raise ValueError("unsupported review schema version")
    source_digest = manifest.get("manifest_sha256")
    if review_manifest.get("source_manifest_sha256") != source_digest:
        raise ValueError("review does not belong to this source manifest")
    entries = review_manifest.get("entries")
    if not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries):
        raise ValueError("review entries must be an array of objects")
    if review_manifest.get("review_sha256") != _review_digest(source_digest, entries):
        raise ValueError("review digest does not match its entries")

    source_entries = _manifest_entries_by_path(manifest)
    reviewed_by_path: dict[str, dict[str, Any]] = {}
    for entry in entries:
        relative_path = entry.get("relative_path")
        if not isinstance(relative_path, str):
            raise TypeError("review relative_path must be a string")
        if relative_path in reviewed_by_path:
            raise ValueError(f"duplicate review decision: {relative_path}")
        source_entry = source_entries.get(relative_path)
        if source_entry is None:
            raise ValueError(f"review path is absent from source manifest: {relative_path}")
        if source_entry.get("disposition") != "REVIEW_REQUIRED":
            raise ValueError(f"review path is not REVIEW_REQUIRED: {relative_path}")
        if entry.get("sha256") != source_entry.get("sha256"):
            raise ValueError(f"review SHA-256 differs from source manifest: {relative_path}")
        if entry.get("decision") not in REVIEW_DECISIONS:
            raise ValueError(f"invalid review decision: {relative_path}")
        if not isinstance(entry.get("reviewer"), str) or not entry["reviewer"].strip():
            raise ValueError(f"reviewer is required: {relative_path}")
        if not isinstance(entry.get("reason"), str) or not entry["reason"].strip():
            raise ValueError(f"review reason is required: {relative_path}")
        classification = _classification_from_entry(source_entry)
        if entry["decision"] == "APPROVE_RAG" and classification.data_class not in (
            "C1",
            "C2",
        ):
            raise ValueError("only C1/C2 review entries can be approved for RAG")
        reviewed_by_path[relative_path] = entry
    return reviewed_by_path


def record_manifest_review(
    manifest: dict[str, Any],
    review_manifest: dict[str, Any] | None,
    *,
    relative_path: str,
    decision: str,
    reviewer: str,
    reason: str,
) -> dict[str, Any]:
    source_entries = _manifest_entries_by_path(manifest)
    source_entry = source_entries.get(relative_path)
    if source_entry is None:
        raise ValueError(f"review path is absent from source manifest: {relative_path}")
    if source_entry.get("disposition") != "REVIEW_REQUIRED":
        raise ValueError(f"review path is not REVIEW_REQUIRED: {relative_path}")
    if decision not in REVIEW_DECISIONS:
        raise ValueError(f"invalid review decision: {decision}")
    if not reviewer.strip() or len(reviewer) > 200:
        raise ValueError("reviewer is required and must not exceed 200 characters")
    if not reason.strip() or len(reason) > 1000:
        raise ValueError("review reason is required and must not exceed 1000 characters")
    classification = _classification_from_entry(source_entry)
    if decision == "APPROVE_RAG" and classification.data_class not in ("C1", "C2"):
        raise ValueError("only C1/C2 review entries can be approved for RAG")

    if review_manifest is None:
        entries: list[dict[str, Any]] = []
    else:
        _validate_review_manifest(review_manifest, manifest)
        entries = [dict(entry) for entry in review_manifest["entries"]]
    if any(entry["relative_path"] == relative_path for entry in entries):
        raise ValueError(f"review decision already exists: {relative_path}")

    entries.append(
        {
            "relative_path": relative_path,
            "sha256": source_entry["sha256"],
            "decision": decision,
            "reviewer": reviewer.strip(),
            "reason": reason.strip(),
            "reviewed_at": datetime.now(tz=UTC).isoformat(),
        }
    )
    source_digest = manifest["manifest_sha256"]
    return {
        "schema_version": REVIEW_SCHEMA_VERSION,
        "source_manifest_sha256": source_digest,
        "review_sha256": _review_digest(source_digest, entries),
        "summary": dict(Counter(entry["decision"] for entry in entries)),
        "entries": entries,
    }


def _resolve_manifest_path(root: Path, relative_path: str) -> Path:
    pure_path = PurePosixPath(relative_path)
    if pure_path.is_absolute() or ".." in pure_path.parts or not pure_path.parts:
        raise ValueError(f"unsafe manifest path: {relative_path}")
    root_resolved = root.resolve(strict=True)
    path = (root / Path(*pure_path.parts)).resolve(strict=True)
    try:
        path.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError(f"manifest path escapes root: {relative_path}") from exc
    if not path.is_file() or path.suffix.casefold() != ".pdf":
        raise ValueError(f"manifest path is not a PDF file: {relative_path}")
    return path


def _classification_from_entry(entry: dict[str, Any]) -> Classification:
    value = entry.get("classification")
    if not isinstance(value, dict):
        raise TypeError("manifest classification must be an object")
    try:
        return Classification(**value)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid manifest classification") from exc


def apply_manifest(
    root: Path,
    manifest: dict[str, Any],
    *,
    apply: bool,
    settings: Any,
    max_files: int | None = None,
    upload_fn: Callable[..., dict[str, Any]],
    review_manifest: dict[str, Any] | None = None,
    approve_fn: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    entries = _validate_manifest(manifest)
    reviewed_by_path = (
        _validate_review_manifest(review_manifest, manifest) if review_manifest else {}
    )
    if max_files is not None and not 1 <= max_files <= 1000:
        raise ValueError("max_files must be between 1 and 1000")
    selected = [
        entry
        for entry in entries
        if entry.get("disposition") == "AUTO_UPLOAD"
        or reviewed_by_path.get(entry.get("relative_path"), {}).get("decision")
        == "APPROVE_RAG"
    ]
    if max_files is not None:
        selected = selected[:max_files]

    verified: list[tuple[Path, Classification, dict[str, Any] | None]] = []
    for entry in selected:
        relative_path = entry.get("relative_path")
        if not isinstance(relative_path, str):
            raise TypeError("manifest relative_path must be a string")
        path = _resolve_manifest_path(root, relative_path)
        classification = _classification_from_entry(entry)
        current_classification = classify_path(Path(relative_path))
        review_entry = reviewed_by_path.get(relative_path)
        expected_action = "AUTO" if review_entry is None else "REVIEW_REQUIRED"
        if classification != current_classification or classification.rag_action != expected_action:
            raise ValueError(f"classification changed since manifest: {relative_path}")
        if path.stat().st_size != entry.get("size_bytes") or _sha256_file(path) != entry.get(
            "sha256"
        ):
            raise ValueError(f"file changed since manifest: {relative_path}")
        verified.append((path, classification, review_entry))

    auto_selected = sum(review_entry is None for _, _, review_entry in verified)
    review_approved_selected = len(verified) - auto_selected

    if not apply:
        return {
            "mode": "DRY_RUN",
            "manifest_sha256": manifest["manifest_sha256"],
            "selected": len(verified),
            "auto_selected": auto_selected,
            "review_approved_selected": review_approved_selected,
            "results": [],
        }
    if settings is None:
        raise ValueError("R6 settings are required in apply mode")
    if review_approved_selected and approve_fn is None:
        raise ValueError("review approval function is required for approved entries")

    results: list[dict[str, Any]] = []
    for path, classification, review_entry in verified:
        result = upload_fn(path, settings, classification=classification)
        if review_entry is not None:
            result["review_approval"] = approve_fn(
                result,
                settings,
                review_entry=review_entry,
                manifest_sha256=manifest["manifest_sha256"],
            )
        results.append(result)
    return {
        "mode": "APPLY",
        "manifest_sha256": manifest["manifest_sha256"],
        "selected": len(verified),
        "auto_selected": auto_selected,
        "review_approved_selected": review_approved_selected,
        "succeeded": len(results),
        "results": results,
    }
