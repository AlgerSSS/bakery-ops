import fcntl
import json
import stat
from pathlib import Path
from typing import Any

import pytest

from hotcrush_data_platform.manifest import auto_reconcile_manifest


def _write(root: Path, relative_path: str, content: bytes) -> None:
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def test_auto_reconcile_dry_run_reports_new_files_without_writing_state(
    tmp_path: Path,
) -> None:
    brain = tmp_path / "brain"
    state_file = tmp_path / "state" / "auto-state.json"
    _write(brain, "General/知识库/opening-sop.pdf", b"safe")
    _write(brain, "HR/CV/candidate-resume.pdf", b"private")
    _write(brain, "Finance/invoice.pdf", b"finance")

    result = auto_reconcile_manifest(
        brain,
        state_file,
        apply=False,
        settings=None,
        upload_fn=lambda *_args, **_kwargs: pytest.fail("dry-run uploaded a file"),
    )

    assert result["mode"] == "DRY_RUN"
    assert result["delta"] == {"new": 3, "changed": 0, "removed": 0}
    assert result["manifest_summary"]["auto_upload"] == 1
    assert result["attention_required"] == 2
    assert result["batch"]["selected"] == 1
    assert not state_file.parent.exists()


def test_auto_reconcile_apply_uploads_only_c1_and_persists_private_state(
    tmp_path: Path,
) -> None:
    brain = tmp_path / "brain"
    state_file = tmp_path / "state" / "auto-state.json"
    _write(brain, "General/知识库/opening-sop.pdf", b"safe")
    _write(brain, "HR/制度与手册/employee-policy.pdf", b"review")
    calls: list[tuple[str, str]] = []

    def upload(
        path: Path,
        _settings: object,
        *,
        classification: Any,
    ) -> dict[str, Any]:
        calls.append((path.name, classification.data_class))
        return {"path": str(path), "uploaded": True, "document_status": "QUEUED"}

    result = auto_reconcile_manifest(
        brain,
        state_file,
        apply=True,
        settings=object(),
        upload_fn=upload,
    )

    assert calls == [("opening-sop.pdf", "C1")]
    assert result["mode"] == "APPLY"
    assert result["batch"]["succeeded"] == 1
    assert state_file.exists()
    assert stat.S_IMODE(state_file.parent.stat().st_mode) == 0o700
    assert stat.S_IMODE(state_file.stat().st_mode) == 0o600
    state = json.loads(state_file.read_text(encoding="utf-8"))
    assert state["schema_version"] == "hotcrush-brain-auto-state-v1"
    assert state["manifest"]["manifest_sha256"] == result["manifest_sha256"]

    calls.clear()
    second = auto_reconcile_manifest(
        brain,
        state_file,
        apply=True,
        settings=object(),
        upload_fn=upload,
    )
    assert calls == []
    assert second["mode"] == "NO_CHANGES"
    assert second["delta"] == {"new": 0, "changed": 0, "removed": 0}

    _write(brain, "General/知识库/closing-sop.pdf", b"new safe content")
    third = auto_reconcile_manifest(
        brain,
        state_file,
        apply=True,
        settings=object(),
        upload_fn=upload,
    )
    assert calls == [("closing-sop.pdf", "C1")]
    assert third["delta"] == {"new": 1, "changed": 0, "removed": 0}
    assert third["batch"]["selected"] == 1


def test_auto_reconcile_failure_does_not_advance_last_successful_manifest(
    tmp_path: Path,
) -> None:
    brain = tmp_path / "brain"
    state_file = tmp_path / "state" / "auto-state.json"
    _write(brain, "General/知识库/opening-sop.pdf", b"first")

    auto_reconcile_manifest(
        brain,
        state_file,
        apply=True,
        settings=object(),
        upload_fn=lambda path, _settings, classification: {
            "path": str(path),
            "uploaded": True,
        },
    )
    before = state_file.read_bytes()
    _write(brain, "General/知识库/closing-sop.pdf", b"second")

    def fail_upload(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise RuntimeError("simulated upload failure")

    with pytest.raises(RuntimeError, match="simulated upload failure"):
        auto_reconcile_manifest(
            brain,
            state_file,
            apply=True,
            settings=object(),
            upload_fn=fail_upload,
        )

    assert state_file.read_bytes() == before


def test_auto_reconcile_discovers_uppercase_pdf_extensions(tmp_path: Path) -> None:
    brain = tmp_path / "brain"
    _write(brain, "General/知识库/opening-sop.PDF", b"safe")

    result = auto_reconcile_manifest(
        brain,
        tmp_path / "state.json",
        apply=False,
        settings=None,
        upload_fn=lambda *_args, **_kwargs: pytest.fail("dry-run uploaded a file"),
    )

    assert result["manifest_summary"]["total"] == 1
    assert result["batch"]["selected"] == 1


@pytest.mark.parametrize("mutation", ["change", "remove"])
def test_auto_reconcile_stops_on_changed_or_removed_sources(
    tmp_path: Path,
    mutation: str,
) -> None:
    brain = tmp_path / "brain"
    source = brain / "General/知识库/opening-sop.pdf"
    _write(brain, "General/知识库/opening-sop.pdf", b"first")
    state_file = tmp_path / "state" / "auto-state.json"
    auto_reconcile_manifest(
        brain,
        state_file,
        apply=True,
        settings=object(),
        upload_fn=lambda path, _settings, classification: {"path": str(path)},
    )
    before = state_file.read_bytes()
    if mutation == "change":
        source.write_bytes(b"changed")
    else:
        source.unlink()

    with pytest.raises(ValueError, match="changed or removed"):
        auto_reconcile_manifest(
            brain,
            state_file,
            apply=True,
            settings=object(),
            upload_fn=lambda *_args, **_kwargs: pytest.fail("unsafe source was uploaded"),
        )

    assert state_file.read_bytes() == before


def test_auto_reconcile_rejects_concurrent_runs(tmp_path: Path) -> None:
    brain = tmp_path / "brain"
    state_file = tmp_path / "state" / "auto-state.json"
    _write(brain, "General/知识库/opening-sop.pdf", b"safe")
    state_file.parent.mkdir()
    lock_file = state_file.with_suffix(".json.lock")

    with lock_file.open("a", encoding="utf-8") as lock_handle:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(RuntimeError, match="another Brain auto-ingest run"):
            auto_reconcile_manifest(
                brain,
                state_file,
                apply=True,
                settings=object(),
                upload_fn=lambda *_args, **_kwargs: {},
            )
