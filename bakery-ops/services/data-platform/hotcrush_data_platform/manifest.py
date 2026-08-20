from __future__ import annotations

import fcntl
import hashlib
import json
import os
import tempfile
from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from .classification import Classification, classify_path

MANIFEST_SCHEMA_VERSION = "hotcrush-brain-manifest-v1"
REVIEW_SCHEMA_VERSION = "hotcrush-brain-review-v1"
REVIEW_DECISIONS = {"APPROVE_RAG", "DENY_RAG"}
AUTO_STATE_SCHEMA_VERSION = "hotcrush-brain-auto-state-v1"


def brain_source_batch_key(space_id: str, sha256: str) -> str:
    return f"brain:{space_id}:{sha256}"


def find_pdf_paths(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.casefold() == ".pdf"
    )


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
    for path in find_pdf_paths(root):
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
    include_paths: set[str] | None = None,
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
        if (
            entry.get("disposition") == "AUTO_UPLOAD"
            or reviewed_by_path.get(entry.get("relative_path"), {}).get("decision")
            == "APPROVE_RAG"
        )
        and (include_paths is None or entry.get("relative_path") in include_paths)
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


def _load_auto_state(state_file: Path) -> dict[str, Any] | None:
    if not state_file.exists():
        return None
    value = json.loads(state_file.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schema_version") != AUTO_STATE_SCHEMA_VERSION:
        raise ValueError("unsupported Brain auto-ingest state")
    manifest = value.get("manifest")
    if not isinstance(manifest, dict):
        raise TypeError("Brain auto-ingest state is missing its manifest")
    _validate_manifest(manifest)
    return value


def _auto_entry_fingerprint(entry: dict[str, Any]) -> str:
    stable_entry = {
        key: value
        for key, value in entry.items()
        if key not in ("relative_path", "modified_at_ns")
    }
    return json.dumps(stable_entry, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _manifest_delta(
    previous_manifest: dict[str, Any] | None,
    current_manifest: dict[str, Any],
) -> tuple[dict[str, int], list[dict[str, Any]]]:
    previous_entries = (
        _manifest_entries_by_path(previous_manifest) if previous_manifest is not None else {}
    )
    current_entries = _manifest_entries_by_path(current_manifest)
    new_or_changed: list[dict[str, Any]] = []
    new_count = 0
    changed_count = 0
    for path, entry in current_entries.items():
        previous = previous_entries.get(path)
        if previous is None:
            new_count += 1
            new_or_changed.append(entry)
        elif _auto_entry_fingerprint(previous) != _auto_entry_fingerprint(entry):
            changed_count += 1
            new_or_changed.append(entry)
    removed_count = len(previous_entries.keys() - current_entries.keys())
    return (
        {"new": new_count, "changed": changed_count, "removed": removed_count},
        new_or_changed,
    )


def _write_private_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.parent.chmod(0o700)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        path.chmod(0o600)
    finally:
        temporary_path.unlink(missing_ok=True)


def _auto_batch_summary(batch: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "mode",
        "manifest_sha256",
        "selected",
        "auto_selected",
        "review_approved_selected",
        "succeeded",
    )
    return {key: batch[key] for key in keys if key in batch}


def auto_reconcile_manifest(
    root: Path,
    state_file: Path,
    *,
    apply: bool,
    settings: Any,
    upload_fn: Callable[..., dict[str, Any]],
) -> dict[str, Any]:
    """Discover PDFs and automatically upload only new C1 content.

    Changed or removed source paths stop the run because automatic publication cannot safely
    infer document versioning or unpublication. Review-required and denied files are inventoried
    but are never passed to the uploader.
    """

    def reconcile() -> tuple[dict[str, Any], dict[str, Any]]:
        previous_state = _load_auto_state(state_file)
        previous_manifest = previous_state["manifest"] if previous_state else None
        current_manifest = build_manifest(root)
        delta, new_or_changed = _manifest_delta(previous_manifest, current_manifest)
        attention_required = sum(
            entry.get("disposition") in ("REVIEW_REQUIRED", "DENIED")
            for entry in new_or_changed
        ) + delta["removed"]

        if apply and previous_manifest is not None and (
            delta["changed"] > 0 or delta["removed"] > 0
        ):
            raise ValueError(
                "changed or removed Brain sources require explicit review; auto-ingest state was not advanced"
            )

        if apply and delta == {"new": 0, "changed": 0, "removed": 0}:
            batch = {
                "mode": "NO_CHANGES",
                "manifest_sha256": current_manifest["manifest_sha256"],
                "selected": 0,
                "auto_selected": 0,
                "review_approved_selected": 0,
                "succeeded": 0,
            }
            mode = "NO_CHANGES"
        else:
            batch = apply_manifest(
                root,
                current_manifest,
                apply=apply,
                settings=settings,
                upload_fn=upload_fn,
                include_paths={entry["relative_path"] for entry in new_or_changed},
            )
            mode = "APPLY" if apply else "DRY_RUN"

        report = {
            "schema_version": "hotcrush-brain-auto-run-v1",
            "mode": mode,
            "manifest_sha256": current_manifest["manifest_sha256"],
            "previous_manifest_sha256": (
                previous_manifest.get("manifest_sha256") if previous_manifest else None
            ),
            "delta": delta,
            "manifest_summary": current_manifest["summary"],
            "attention_required": attention_required,
            "batch": _auto_batch_summary(batch),
        }
        return current_manifest, report

    if not apply:
        _, report = reconcile()
        return report

    state_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    state_file.parent.chmod(0o700)
    lock_file = state_file.with_suffix(f"{state_file.suffix}.lock")
    with lock_file.open("a", encoding="utf-8") as lock_handle:
        lock_file.chmod(0o600)
        try:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("another Brain auto-ingest run is active") from exc
        manifest, report = reconcile()
        state = {
            "schema_version": AUTO_STATE_SCHEMA_VERSION,
            "updated_at": datetime.now(tz=UTC).isoformat(),
            "manifest": manifest,
            "last_result": report,
        }
        _write_private_json_atomic(state_file, state)
        return report
