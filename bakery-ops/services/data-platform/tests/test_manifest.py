from pathlib import Path
from typing import Any

import pytest

from hotcrush_data_platform.manifest import (
    apply_manifest,
    brain_source_batch_key,
    build_manifest,
    record_manifest_review,
)


def _write(root: Path, relative_path: str, content: bytes) -> Path:
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def test_manifest_hashes_and_deduplicates_only_inside_one_security_space(
    tmp_path: Path,
) -> None:
    _write(tmp_path, "General/知识库/opening-sop.pdf", b"same")
    _write(tmp_path, "General/知识库/opening-sop-copy.pdf", b"same")
    _write(tmp_path, "HR/制度与手册/employee-handbook.pdf", b"same")

    manifest = build_manifest(tmp_path)
    entries = {entry["relative_path"]: entry for entry in manifest["entries"]}

    assert manifest["schema_version"] == "hotcrush-brain-manifest-v1"
    assert len(manifest["manifest_sha256"]) == 64
    assert entries["General/知识库/opening-sop-copy.pdf"]["disposition"] == "AUTO_UPLOAD"
    assert entries["General/知识库/opening-sop.pdf"]["disposition"] == "DUPLICATE_SKIP"
    assert entries["HR/制度与手册/employee-handbook.pdf"]["disposition"] == "REVIEW_REQUIRED"
    assert manifest["summary"] == {
        "total": 3,
        "auto_upload": 1,
        "review_required": 1,
        "denied": 0,
        "duplicate_skip": 1,
    }


def test_source_batch_key_is_scoped_to_the_security_space() -> None:
    sha256 = "a" * 64
    first = brain_source_batch_key("10000000-0000-7000-8000-000000000001", sha256)
    second = brain_source_batch_key("10000000-0000-7000-8000-000000000002", sha256)

    assert first != second
    assert first.endswith(sha256)


def test_manifest_apply_is_dry_run_by_default(tmp_path: Path) -> None:
    _write(tmp_path, "General/知识库/opening-sop.pdf", b"pdf")
    manifest = build_manifest(tmp_path)
    calls: list[Path] = []

    result = apply_manifest(
        tmp_path,
        manifest,
        apply=False,
        settings=None,
        upload_fn=lambda path, settings, classification: calls.append(path),
    )

    assert calls == []
    assert result["mode"] == "DRY_RUN"
    assert result["selected"] == 1
    assert result["results"] == []


def test_manifest_apply_rejects_a_file_changed_after_review(tmp_path: Path) -> None:
    path = _write(tmp_path, "General/知识库/opening-sop.pdf", b"before")
    manifest = build_manifest(tmp_path)
    path.write_bytes(b"after")

    with pytest.raises(ValueError, match="changed since manifest"):
        apply_manifest(
            tmp_path,
            manifest,
            apply=True,
            settings=object(),
            upload_fn=lambda *_args, **_kwargs: {},
        )


def test_manifest_apply_rejects_tampered_disposition(tmp_path: Path) -> None:
    _write(tmp_path, "HR/CV/candidate-resume.pdf", b"private")
    manifest = build_manifest(tmp_path)
    manifest["entries"][0]["disposition"] = "AUTO_UPLOAD"

    with pytest.raises(ValueError, match="manifest digest"):
        apply_manifest(
            tmp_path,
            manifest,
            apply=False,
            settings=None,
            upload_fn=lambda *_args, **_kwargs: {},
        )


def test_manifest_apply_uploads_only_auto_entries_and_is_bounded(tmp_path: Path) -> None:
    _write(tmp_path, "General/知识库/a-sop.pdf", b"a")
    _write(tmp_path, "General/知识库/b-sop.pdf", b"b")
    _write(tmp_path, "HR/CV/candidate-resume.pdf", b"private")
    manifest = build_manifest(tmp_path)
    calls: list[tuple[str, str]] = []

    def upload(
        path: Path,
        _settings: object,
        *,
        classification: Any,
    ) -> dict[str, Any]:
        calls.append((path.name, classification.data_class))
        return {"path": str(path), "uploaded": True, "document_status": "QUEUED"}

    result = apply_manifest(
        tmp_path,
        manifest,
        apply=True,
        settings=object(),
        max_files=1,
        upload_fn=upload,
    )

    assert len(calls) == 1
    assert calls[0][1] == "C1"
    assert result["mode"] == "APPLY"
    assert result["selected"] == 1
    assert result["succeeded"] == 1


def test_reviewed_c2_entry_is_bound_to_manifest_and_approved_after_upload(
    tmp_path: Path,
) -> None:
    _write(tmp_path, "HR/制度与手册/employee-handbook.pdf", b"reviewed-policy")
    manifest = build_manifest(tmp_path)
    review = record_manifest_review(
        manifest,
        None,
        relative_path="HR/制度与手册/employee-handbook.pdf",
        decision="APPROVE_RAG",
        reviewer="codex-reviewer",
        reason="Rendered every page and found no personal or payroll records.",
    )
    calls: list[tuple[str, str]] = []

    def upload(
        path: Path,
        _settings: object,
        *,
        classification: Any,
    ) -> dict[str, Any]:
        calls.append(("upload", classification.data_class))
        return {"path": str(path), "document_id": "document-reviewed"}

    def approve(
        result: dict[str, Any],
        _settings: object,
        *,
        review_entry: dict[str, Any],
        manifest_sha256: str,
    ) -> dict[str, Any]:
        assert result["document_id"] == "document-reviewed"
        assert review_entry["decision"] == "APPROVE_RAG"
        assert manifest_sha256 == manifest["manifest_sha256"]
        calls.append(("approve", review_entry["reviewer"]))
        return {"status": "QUEUED", "rag_eligibility": "ALLOWED"}

    result = apply_manifest(
        tmp_path,
        manifest,
        review_manifest=review,
        apply=True,
        settings=object(),
        upload_fn=upload,
        approve_fn=approve,
    )

    assert calls == [("upload", "C2"), ("approve", "codex-reviewer")]
    assert result["selected"] == 1
    assert result["auto_selected"] == 0
    assert result["review_approved_selected"] == 1
    assert result["results"][0]["review_approval"]["status"] == "QUEUED"


def test_review_approval_rejects_c3_and_tampering(tmp_path: Path) -> None:
    _write(tmp_path, "HR/CV/candidate-resume.pdf", b"private")
    manifest = build_manifest(tmp_path)

    with pytest.raises(ValueError, match="C1/C2"):
        record_manifest_review(
            manifest,
            None,
            relative_path="HR/CV/candidate-resume.pdf",
            decision="APPROVE_RAG",
            reviewer="reviewer",
            reason="not sufficient",
        )

    review = record_manifest_review(
        manifest,
        None,
        relative_path="HR/CV/candidate-resume.pdf",
        decision="DENY_RAG",
        reviewer="reviewer",
        reason="contains recruiting PII",
    )
    review["entries"][0]["reason"] = "tampered"
    with pytest.raises(ValueError, match="review digest"):
        apply_manifest(
            tmp_path,
            manifest,
            review_manifest=review,
            apply=False,
            settings=None,
            upload_fn=lambda *_args, **_kwargs: {},
            approve_fn=lambda *_args, **_kwargs: {},
        )
