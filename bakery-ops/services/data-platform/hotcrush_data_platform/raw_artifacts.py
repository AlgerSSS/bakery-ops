"""Shared, integrity-checked download of the Raw objects behind a processing run.

This lives in its own module because both the POS and the finance workers need it and it is
the point where a tampered or truncated Raw object would otherwise slip into a fact table.
Two copies of a size/sha256 check are two chances for one of them to rot, so there is one.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any, Protocol


class _Downloader(Protocol):
    def download_object(self, bucket: str, object_path: str) -> bytes: ...


def download_verified_artifacts(
    client: _Downloader,
    manifest: list[dict[str, Any]],
    required_artifacts: set[str],
    *,
    error_type: type[Exception],
) -> dict[str, bytes]:
    """Download every required artifact and verify its registered size and digest.

    ``error_type`` lets each domain raise its own validation error, so a bad artifact is
    classified as non-retryable by that domain's worker instead of being retried forever.
    """
    by_key: dict[str, dict[str, Any]] = {}
    for item in manifest:
        key = str(item.get("source_record_key") or "")
        if key not in required_artifacts:
            continue
        if key in by_key:
            raise error_type(f"duplicate Raw object registration for {key}")
        by_key[key] = item

    missing = required_artifacts.difference(by_key)
    if missing:
        raise error_type(f"required artifacts are missing: {sorted(missing)}")

    artifacts: dict[str, bytes] = {}
    for key in sorted(required_artifacts):
        item = by_key[key]
        content = client.download_object(str(item["bucket_id"]), str(item["object_path"]))
        if len(content) != int(item["size_bytes"]):
            raise error_type(f"size mismatch for {key}")
        actual_sha256 = hashlib.sha256(content).hexdigest()
        if not hmac.compare_digest(actual_sha256, str(item["sha256"])):
            raise error_type(f"sha256 mismatch for {key}")
        artifacts[key] = content
    return artifacts
