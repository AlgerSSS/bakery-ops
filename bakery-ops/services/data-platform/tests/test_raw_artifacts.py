"""Coverage for the shared Raw-object integrity check.

This helper used to live inside pos_worker with no direct test. It is the boundary where a
truncated or swapped Storage object would otherwise reach a fact table, so it is tested here
now that both the POS and finance workers depend on it.
"""

from __future__ import annotations

import hashlib

import pytest

from hotcrush_data_platform.raw_artifacts import download_verified_artifacts


class Boom(Exception):
    pass


class FakeClient:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self._objects = objects
        self.calls: list[tuple[str, str]] = []

    def download_object(self, bucket: str, object_path: str) -> bytes:
        self.calls.append((bucket, object_path))
        return self._objects[(bucket, object_path)]


def entry(key: str, content: bytes, *, path: str = "p/x.json", bucket: str = "b"):
    return {
        "source_record_key": key,
        "bucket_id": bucket,
        "object_path": path,
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def test_returns_content_when_size_and_digest_match():
    content = b'{"ok":true}'
    client = FakeClient({("b", "p/x.json"): content})
    artifacts = download_verified_artifacts(
        client, [entry("a.json", content)], {"a.json"}, error_type=Boom
    )
    assert artifacts == {"a.json": content}


def test_unrelated_manifest_entries_are_ignored():
    content = b"x"
    client = FakeClient({("b", "p/x.json"): content})
    manifest = [entry("a.json", content), entry("ignored.json", b"other", path="p/y.json")]
    artifacts = download_verified_artifacts(client, manifest, {"a.json"}, error_type=Boom)
    assert set(artifacts) == {"a.json"}
    assert client.calls == [("b", "p/x.json")]


def test_missing_artifact_is_reported():
    client = FakeClient({})
    with pytest.raises(Boom, match="required artifacts are missing"):
        download_verified_artifacts(client, [], {"a.json"}, error_type=Boom)


def test_duplicate_registration_is_rejected():
    content = b"x"
    manifest = [entry("a.json", content), entry("a.json", content, path="p/dupe.json")]
    client = FakeClient({("b", "p/x.json"): content})
    with pytest.raises(Boom, match="duplicate Raw object registration"):
        download_verified_artifacts(client, manifest, {"a.json"}, error_type=Boom)


def test_truncated_object_is_rejected_on_size():
    content = b"full content"
    client = FakeClient({("b", "p/x.json"): b"short"})
    with pytest.raises(Boom, match="size mismatch"):
        download_verified_artifacts(client, [entry("a.json", content)], {"a.json"}, error_type=Boom)


def test_swapped_object_of_equal_length_is_rejected_on_digest():
    """Same byte length, different bytes: only the digest catches this."""
    content = b"aaaa"
    client = FakeClient({("b", "p/x.json"): b"bbbb"})
    with pytest.raises(Boom, match="sha256 mismatch"):
        download_verified_artifacts(client, [entry("a.json", content)], {"a.json"}, error_type=Boom)


def test_error_type_is_honored_so_each_domain_classifies_its_own_failures():
    class DomainError(Exception):
        pass

    client = FakeClient({})
    with pytest.raises(DomainError):
        download_verified_artifacts(client, [], {"a.json"}, error_type=DomainError)
