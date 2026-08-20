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
) -> dict[str, Any]:
    entries = _validate_manifest(manifest)
    if max_files is not None and not 1 <= max_files <= 1000:
        raise ValueError("max_files must be between 1 and 1000")
    selected = [entry for entry in entries if entry.get("disposition") == "AUTO_UPLOAD"]
    if max_files is not None:
        selected = selected[:max_files]

    verified: list[tuple[Path, Classification]] = []
    for entry in selected:
        relative_path = entry.get("relative_path")
        if not isinstance(relative_path, str):
            raise TypeError("manifest relative_path must be a string")
        path = _resolve_manifest_path(root, relative_path)
        classification = _classification_from_entry(entry)
        current_classification = classify_path(Path(relative_path))
        if classification != current_classification or classification.rag_action != "AUTO":
            raise ValueError(f"classification changed since manifest: {relative_path}")
        if path.stat().st_size != entry.get("size_bytes") or _sha256_file(path) != entry.get(
            "sha256"
        ):
            raise ValueError(f"file changed since manifest: {relative_path}")
        verified.append((path, classification))

    if not apply:
        return {
            "mode": "DRY_RUN",
            "manifest_sha256": manifest["manifest_sha256"],
            "selected": len(verified),
            "results": [],
        }
    if settings is None:
        raise ValueError("R6 settings are required in apply mode")

    results = [
        upload_fn(path, settings, classification=classification)
        for path, classification in verified
    ]
    return {
        "mode": "APPLY",
        "manifest_sha256": manifest["manifest_sha256"],
        "selected": len(verified),
        "succeeded": len(results),
        "results": results,
    }
