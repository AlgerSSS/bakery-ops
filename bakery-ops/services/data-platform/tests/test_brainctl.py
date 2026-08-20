from pathlib import Path
from typing import Any, Self

import pytest

from hotcrush_data_platform import brainctl
from hotcrush_data_platform.classification import BUCKETS, SPACE_IDS, Classification
from hotcrush_data_platform.config import Settings


def _settings() -> Settings:
    return Settings(
        supabase_url="https://r6.example",
        supabase_service_key="r6-key",
        openrouter_api_key="openrouter-key",
        openrouter_base_url="https://openrouter.example",
        embedding_model="openai/text-embedding-3-small",
        pipeline_version="rag-v1",
        worker_id="test-worker",
        embedding_mode="openrouter",
        allow_test_embeddings=False,
        request_timeout_seconds=10,
    )


def test_upload_reuses_existing_immutable_raw_object_across_batch_key_upgrade(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    path = tmp_path / "opening-sop.pdf"
    path.write_bytes(b"%PDF-existing")
    classification = Classification(
        "C1",
        BUCKETS["kb-internal"],
        SPACE_IDS["kb-internal"],
        "SOP",
        "AUTO",
        "test",
    )
    calls: list[str] = []

    class FakeClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            pass

        @staticmethod
        def one(value: Any) -> dict[str, Any] | None:
            if isinstance(value, list):
                return value[0] if value else None
            return value

        def upload_object(self, *_args: Any) -> bool:
            calls.append("upload_object")
            return False

        def rpc(self, name: str, payload: dict[str, Any]) -> Any:
            calls.append(name)
            if name == "ops_resolve_raw_object":
                return [{"raw_object_id": "raw-existing", "batch_id": "batch-legacy"}]
            if name == "ops_complete_raw_batch":
                assert payload["p_batch_id"] == "batch-legacy"
                return {"batch_id": "batch-legacy"}
            if name == "ai_finalize_document_upload":
                assert payload["p_raw_object_id"] == "raw-existing"
                return {
                    "document_id": "document-existing",
                    "status": "READY",
                    "rag_eligibility": "ALLOWED",
                }
            raise AssertionError(f"unexpected RPC: {name}")

    monkeypatch.setattr(brainctl, "SupabasePlatformClient", FakeClient)

    result = brainctl.upload_one(path, _settings(), classification=classification)

    assert "ops_register_raw_batch" not in calls
    assert "ops_register_raw_object" not in calls
    assert result["batch_id"] == "batch-legacy"
    assert result["raw_object_id"] == "raw-existing"
    assert result["uploaded"] is False


def test_publication_state_change_is_dry_run_without_explicit_apply() -> None:
    result = brainctl.change_document_state(
        "58856e6d-c102-4dcc-b6f5-d50026fb0afa",
        "unpublish",
        reason="rollback rehearsal",
        actor="operator",
        apply=False,
        settings=None,
    )

    assert result == {
        "mode": "DRY_RUN",
        "action": "unpublish",
        "document_id": "58856e6d-c102-4dcc-b6f5-d50026fb0afa",
        "reason": "rollback rehearsal",
        "actor": "operator",
    }


def test_document_status_requires_a_bounded_explicit_id_list() -> None:
    with pytest.raises(ValueError, match="between 1 and 100"):
        brainctl.get_document_status([], _settings())
