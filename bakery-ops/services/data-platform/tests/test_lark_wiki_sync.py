import hashlib
import json
from pathlib import Path
from typing import Any

from hotcrush_data_platform.config import Settings
from hotcrush_data_platform.lark_wiki_sync import (
    LarkNode,
    SyncedNode,
    build_source_payload,
    ingest_source_payload,
    load_sync_state,
    partition_nodes,
    save_sync_state,
    state_file_path,
    walk_space_nodes,
)


def _settings() -> Settings:
    return Settings(
        supabase_url="https://r6.example",
        supabase_service_key="r6-key",
        openrouter_api_key="",
        openrouter_base_url="https://openrouter.example",
        embedding_model="openai/text-embedding-3-small",
        pipeline_version="rag-v1",
        worker_id="test-worker",
        embedding_mode="openrouter",
        allow_test_embeddings=False,
        request_timeout_seconds=10,
    )


def test_walk_space_nodes_recurses_without_revisiting_nodes() -> None:
    root = LarkNode("root", "doc-root", "docx", "Root", "", True)
    child = LarkNode("child", "doc-child", "docx", "Child", "root", False)

    class FakeLark:
        def list_nodes(self, _space_id: str, parent: str | None = None) -> list[LarkNode]:
            if parent is None:
                return [root]
            if parent == "root":
                return [child, root]
            return []

    assert walk_space_nodes(FakeLark(), "space-1") == [root, child]


def test_docx_payload_is_canonical_and_preserves_source_revision() -> None:
    node = LarkNode("node-1", "doc-1", "docx", "Opening SOP", "", False)

    class FakeLark:
        def get_node(self, _node_token: str) -> dict[str, Any]:
            return {"obj_edit_time": "1786764959"}

        def get_docx(self, _document_id: str) -> tuple[int, str]:
            return 35, "Line one\nLine two"

    payload = build_source_payload(FakeLark(), "7657000000000000000", node, 1_000_000)

    assert payload is not None
    assert payload.document_type == "LARK_DOCX"
    assert payload.mime_type == "application/json"
    assert payload.version_no == 35
    assert payload.source_version == "docx-revision-35"
    assert payload.object_filename == "raw.json"
    body = json.loads(payload.content)
    assert body == {
        "content": "Line one\nLine two",
        "node_token": "node-1",
        "obj_edit_time": "1786764959",
        "obj_token": "doc-1",
        "revision_id": 35,
        "schema_version": "lark-docx-raw-v1",
        "space_id": "7657000000000000000",
        "title": "Opening SOP",
    }
    assert payload.sha256 == hashlib.sha256(payload.content).hexdigest()


def test_only_uploaded_pdf_files_are_treated_as_pdf_sources() -> None:
    pdf = LarkNode("pdf-node", "pdf-file", "file", "Manual.PDF", "", False)
    sheet = LarkNode("sheet-node", "sheet-file", "file", "Budget.xlsx", "", False)

    class FakeLark:
        def get_node(self, _node_token: str) -> dict[str, Any]:
            return {"obj_edit_time": "1786764999"}

        def download_file(self, _file_token: str) -> bytes:
            return b"%PDF-1.7 source bytes"

    payload = build_source_payload(FakeLark(), "space-1", pdf, 1_000_000)

    assert payload is not None
    assert payload.document_type == "PDF"
    assert payload.mime_type == "application/pdf"
    assert payload.version_no == 1786764999
    assert build_source_payload(FakeLark(), "space-1", sheet, 1_000_000) is None


def test_ingest_uses_connector_classification_and_controlled_rpcs() -> None:
    node = LarkNode("node-1", "doc-1", "docx", "Finance title", "", False)
    payload_content = b'{"content":"restricted"}'
    payload = type(
        "Payload",
        (),
        {
            "content": payload_content,
            "sha256": hashlib.sha256(payload_content).hexdigest(),
            "mime_type": "application/json",
            "document_type": "LARK_DOCX",
            "version_no": 7,
            "source_version": "docx-revision-7",
            "object_filename": "raw.json",
        },
    )()
    connector = {
        "connector_id": "20000000-0000-7000-8000-000000000006",
        "external_space_id": "7657071455368154647",
        "knowledge_space_id": "10000000-0000-7000-8000-000000000004",
        "bucket_id": "finance-private",
        "data_class": "C3",
    }
    calls: list[tuple[str, dict[str, Any]]] = []

    class FakeClient:
        def upload_object(self, bucket: str, path: str, content: bytes, mime: str) -> bool:
            assert bucket == "finance-private"
            assert path.endswith("/node-1/7/raw.json")
            assert content == payload_content
            assert mime == "application/json"
            return True

        @staticmethod
        def one(value: Any) -> dict[str, Any] | None:
            return value[0] if isinstance(value, list) and value else value

        def rpc(self, name: str, data: dict[str, Any]) -> Any:
            calls.append((name, data))
            if name == "ops_resolve_raw_object":
                return []
            if name == "ops_register_raw_batch":
                return [{"batch_id": "batch-1"}]
            if name == "ops_register_raw_object":
                return [{"raw_object_id": "raw-1", "batch_id": "batch-1"}]
            if name == "ops_complete_raw_batch":
                return {"batch_id": "batch-1"}
            if name == "ai_finalize_document_upload":
                return [
                    {
                        "document_id": "document-1",
                        "status": "REVIEW_REQUIRED",
                        "rag_eligibility": "REDACTED_ONLY",
                    }
                ]
            raise AssertionError(f"unexpected RPC: {name}")

    result = ingest_source_payload(
        FakeClient(), connector, node, payload, _settings(), source_uri="https://example/wiki/node-1"
    )

    raw_call = next(data for name, data in calls if name == "ops_register_raw_object")
    assert raw_call["p_data_class"] == "C3"
    assert raw_call["p_source_record_key"] == "node-1"
    finalize_call = next(data for name, data in calls if name == "ai_finalize_document_upload")
    assert finalize_call["p_document_key"] == "lark-node-1"
    assert finalize_call["p_version_no"] == 7
    assert finalize_call["p_title"].startswith("LARK_DOCX ")
    assert result["rag_eligibility"] == "REDACTED_ONLY"


def test_unchanged_nodes_are_skipped_without_fetching_content() -> None:
    # 回归：此前每轮都对每篇文档打 3 次接口（get_node + documents + raw_content），
    # 无论内容有没有变。这是把租户飞书月度配额打满的主因。
    changed = LarkNode("n1", "d1", "docx", "改过的", "", False, "1787600000")
    same = LarkNode("n2", "d2", "docx", "没动的", "", False, "1787500000")
    known = {
        "n1": SyncedNode("1787000000", "docx-revision-3", "aaa", "doc-1"),
        "n2": SyncedNode("1787500000", "docx-revision-9", "bbb", "doc-2"),
    }

    to_fetch, unchanged = partition_nodes([changed, same], known)

    assert [n.node_token for n in to_fetch] == ["n1"]
    assert [(n.node_token, prev.source_revision) for n, prev in unchanged] == [
        ("n2", "docx-revision-9")
    ]


def test_nodes_without_edit_time_are_always_fetched() -> None:
    # 飞书哪天不再返回 obj_edit_time，行为要退回改动前的全量拉取，绝不能漏同步。
    node = LarkNode("n1", "d1", "docx", "无编辑时间", "", False, "")
    known = {"n1": SyncedNode("", "docx-revision-3", "aaa", "doc-1")}

    to_fetch, unchanged = partition_nodes([node], known)

    assert [n.node_token for n in to_fetch] == ["n1"]
    assert unchanged == []


def test_unknown_nodes_and_forced_resync_fetch_everything() -> None:
    node = LarkNode("n1", "d1", "docx", "新节点", "", False, "1787500000")
    known = {"n1": SyncedNode("1787500000", "docx-revision-9", "bbb", "doc-2")}

    assert partition_nodes([node], {})[0] == [node]
    assert partition_nodes([node], known, force_full=True)[0] == [node]


def test_sync_state_round_trips_and_rejects_corrupt_files(tmp_path: Any) -> None:
    path = tmp_path / "wiki-node-state.json"
    state = {"conn-1": {"n1": SyncedNode("1787500000", "docx-revision-9", "bbb", "doc-2")}}

    save_sync_state(path, state)
    assert load_sync_state(path) == state

    # 损坏、版本不符、字段缺失都必须退化成全量同步，而不是静默漏掉节点。
    path.write_text("{ not json", encoding="utf-8")
    assert load_sync_state(path) == {}
    path.write_text(json.dumps({"version": 99, "connectors": {}}), encoding="utf-8")
    assert load_sync_state(path) == {}
    path.write_text(
        json.dumps({"version": 1, "connectors": {"c": {"n": {"obj_edit_time": "1"}}}}),
        encoding="utf-8",
    )
    assert load_sync_state(path) == {}
    assert load_sync_state(tmp_path / "does-not-exist.json") == {}


def test_state_file_path_prefers_systemd_state_directory(monkeypatch: Any) -> None:
    # unit 用了 DynamicUser + ProtectSystem=strict，只有 StateDirectory 可写。
    monkeypatch.delenv("LARK_WIKI_STATE_FILE", raising=False)
    monkeypatch.setenv("STATE_DIRECTORY", "/var/lib/hotcrush-lark-wiki-sync")
    assert state_file_path() == Path("/var/lib/hotcrush-lark-wiki-sync/wiki-node-state.json")

    monkeypatch.setenv("LARK_WIKI_STATE_FILE", "/tmp/custom.json")
    assert state_file_path() == Path("/tmp/custom.json")
