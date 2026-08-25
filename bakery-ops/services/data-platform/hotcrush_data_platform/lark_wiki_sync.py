from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, Self

import httpx

from .config import Settings
from .supabase_client import SupabasePlatformClient

LOGGER = logging.getLogger("hotcrush-lark-wiki-sync")
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def _secret_from_env(name: str) -> str:
    value = os.getenv(name, "")
    if value:
        return value
    file_path = os.getenv(f"{name}_FILE", "")
    if not file_path:
        return ""
    return Path(file_path).read_text(encoding="utf-8").strip()


@dataclass(frozen=True)
class LarkWikiSettings:
    app_id: str
    app_secret: str
    api_base_url: str
    wiki_base_url: str
    request_timeout_seconds: float

    @classmethod
    def from_env(cls) -> LarkWikiSettings:
        settings = cls(
            app_id=_secret_from_env("LARK_APP_ID"),
            app_secret=_secret_from_env("LARK_APP_SECRET"),
            api_base_url=os.getenv("LARK_API_BASE_URL", "https://open.larksuite.com").rstrip("/"),
            wiki_base_url=os.getenv(
                "LARK_WIKI_BASE_URL", "https://fjpks7iroa9l.jp.larksuite.com"
            ).rstrip("/"),
            request_timeout_seconds=float(os.getenv("LARK_HTTP_TIMEOUT", "60")),
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        if not self.app_id or not self.app_secret:
            raise ValueError("LARK_APP_ID and LARK_APP_SECRET are required")
        if not self.api_base_url.startswith("https://") or not self.wiki_base_url.startswith(
            "https://"
        ):
            raise ValueError("Lark API and Wiki base URLs must use HTTPS")
        if self.request_timeout_seconds <= 0:
            raise ValueError("LARK_HTTP_TIMEOUT must be positive")


@dataclass(frozen=True)
class LarkNode:
    node_token: str
    obj_token: str
    obj_type: str
    title: str
    parent_node_token: str
    has_child: bool
    # 节点列表接口本来就返回 obj_edit_time，此前没有取用，导致每轮都要再打
    # get_node + get_docx 才能知道文档有没有变。增量同步靠它判断。
    # 字段放在最后并给默认值，避免打断既有的位置参数构造。
    obj_edit_time: str = ""

    @classmethod
    def from_api(cls, value: dict[str, Any]) -> LarkNode:
        node = cls(
            node_token=str(value.get("node_token", "")),
            obj_token=str(value.get("obj_token", "")),
            obj_type=str(value.get("obj_type", "")),
            title=str(value.get("title", "")),
            parent_node_token=str(value.get("parent_node_token", "")),
            has_child=bool(value.get("has_child", False)),
            obj_edit_time=str(value.get("obj_edit_time", "")),
        )
        if not TOKEN_PATTERN.fullmatch(node.node_token) or not TOKEN_PATTERN.fullmatch(
            node.obj_token
        ):
            raise ValueError("Lark returned an invalid node or object token")
        return node


@dataclass(frozen=True)
class SourcePayload:
    content: bytes
    mime_type: str
    document_type: str
    version_no: int
    source_version: str
    object_filename: str

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.content).hexdigest()


class NodeLister(Protocol):
    def list_nodes(self, space_id: str, parent: str | None = None) -> list[LarkNode]: ...


class LarkApiClient:
    def __init__(self, settings: LarkWikiSettings) -> None:
        self.settings = settings
        self._client = httpx.Client(timeout=settings.request_timeout_seconds)
        self._access_token: str | None = None

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _token(self) -> str:
        if self._access_token:
            return self._access_token
        response = self._client.post(
            f"{self.settings.api_base_url}/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": self.settings.app_id, "app_secret": self.settings.app_secret},
        )
        response.raise_for_status()
        body = response.json()
        if body.get("code") != 0 or not body.get("tenant_access_token"):
            raise RuntimeError(f"Lark tenant token request failed: {body.get('code')} {body.get('msg')}")
        self._access_token = str(body["tenant_access_token"])
        return self._access_token

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        response = self._client.request(
            method,
            f"{self.settings.api_base_url}{path}",
            headers={"authorization": f"Bearer {self._token()}"},
            **kwargs,
        )
        response.raise_for_status()
        return response

    def _json(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        body = self._request(method, path, **kwargs).json()
        if not isinstance(body, dict) or body.get("code") != 0:
            code = body.get("code") if isinstance(body, dict) else "INVALID_JSON"
            message = body.get("msg") if isinstance(body, dict) else "non-object response"
            raise RuntimeError(f"Lark API failed: {code} {message}")
        data = body.get("data", {})
        if not isinstance(data, dict):
            raise TypeError("Lark API returned invalid data")
        return data

    def list_nodes(self, space_id: str, parent: str | None = None) -> list[LarkNode]:
        nodes: list[LarkNode] = []
        page_token = ""
        while True:
            params: dict[str, Any] = {"page_size": 50}
            if parent:
                params["parent_node_token"] = parent
            if page_token:
                params["page_token"] = page_token
            data = self._json(
                "GET", f"/open-apis/wiki/v2/spaces/{space_id}/nodes", params=params
            )
            items = data.get("items", [])
            if not isinstance(items, list):
                raise TypeError("Lark Wiki node list returned invalid items")
            nodes.extend(LarkNode.from_api(item) for item in items)
            if not data.get("has_more"):
                return nodes
            page_token = str(data.get("page_token", ""))
            if not page_token:
                raise RuntimeError("Lark Wiki pagination omitted page_token")

    def get_node(self, node_token: str) -> dict[str, Any]:
        data = self._json(
            "GET", "/open-apis/wiki/v2/spaces/get_node", params={"token": node_token}
        )
        node = data.get("node")
        if not isinstance(node, dict):
            raise TypeError("Lark Wiki node lookup returned no node")
        return node

    def get_docx(self, document_id: str) -> tuple[int, str]:
        document_data = self._json("GET", f"/open-apis/docx/v1/documents/{document_id}")
        document = document_data.get("document")
        if not isinstance(document, dict):
            raise TypeError("Lark Docx metadata returned no document")
        revision_id = int(document.get("revision_id", 0))
        raw_data = self._json(
            "GET", f"/open-apis/docx/v1/documents/{document_id}/raw_content"
        )
        content = raw_data.get("content")
        if revision_id < 1 or not isinstance(content, str) or not content.strip():
            raise RuntimeError("Lark Docx has no usable revision or text content")
        return revision_id, content

    def download_file(self, file_token: str) -> bytes:
        return self._request(
            "GET", f"/open-apis/drive/v1/files/{file_token}/download"
        ).content


@dataclass(frozen=True)
class SyncedNode:
    """上一轮成功入库的节点，用于在内容未变时原样复现 source_item 记录。"""

    obj_edit_time: str
    source_revision: str
    source_sha256: str
    document_id: str | None

    def as_json(self) -> dict[str, Any]:
        return {
            "obj_edit_time": self.obj_edit_time,
            "source_revision": self.source_revision,
            "source_sha256": self.source_sha256,
            "document_id": self.document_id,
        }

    @classmethod
    def from_json(cls, value: Any) -> SyncedNode | None:
        if not isinstance(value, dict):
            return None
        edit = str(value.get("obj_edit_time", ""))
        revision = str(value.get("source_revision", ""))
        sha256 = str(value.get("source_sha256", ""))
        if not edit or not revision or not sha256:
            return None
        document_id = value.get("document_id")
        return cls(
            obj_edit_time=edit,
            source_revision=revision,
            source_sha256=sha256,
            document_id=str(document_id) if document_id else None,
        )


def state_file_path() -> Path:
    """
    增量状态的落盘位置。

    unit 用了 DynamicUser + ProtectSystem=strict，进程只有 StateDirectory=
    指定的目录可写，所以优先用 systemd 注入的 $STATE_DIRECTORY。
    """
    explicit = os.getenv("LARK_WIKI_STATE_FILE", "")
    if explicit:
        return Path(explicit)
    state_dir = os.getenv("STATE_DIRECTORY", "")
    if state_dir:
        return Path(state_dir.split(":")[0]) / "wiki-node-state.json"
    return Path(".lark-wiki-state.json")


def load_sync_state(path: Path) -> dict[str, dict[str, SyncedNode]]:
    """读取增量状态。任何损坏或缺失都退化成全量同步——宁可多打接口，不可漏同步。"""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict) or raw.get("version") != 1:
        return {}
    connectors = raw.get("connectors")
    if not isinstance(connectors, dict):
        return {}
    state: dict[str, dict[str, SyncedNode]] = {}
    for connector_id, nodes in connectors.items():
        if not isinstance(nodes, dict):
            continue
        parsed = {
            str(token): entry
            for token, value in nodes.items()
            if (entry := SyncedNode.from_json(value)) is not None
        }
        if parsed:
            state[str(connector_id)] = parsed
    return state


def save_sync_state(path: Path, state: dict[str, dict[str, SyncedNode]]) -> None:
    """原子写盘。写失败不能影响同步结果，最坏结果只是下一轮退回全量。"""
    payload = {
        "version": 1,
        "connectors": {
            connector_id: {token: node.as_json() for token, node in nodes.items()}
            for connector_id, nodes in state.items()
        },
    }
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        LOGGER.warning("could not persist Lark wiki sync state to %s", path)


def full_resync_requested() -> bool:
    return os.getenv("LARK_WIKI_FULL_RESYNC", "").strip().lower() in {"1", "true", "yes"}


def partition_nodes(
    nodes: list[LarkNode],
    known: dict[str, SyncedNode],
    *,
    force_full: bool = False,
) -> tuple[list[LarkNode], list[tuple[LarkNode, SyncedNode]]]:
    """
    把节点分成"要取内容的"和"可以跳过的"。

    跳过的条件是三者同时成立：不是强制全量、列表接口给出了非空的
    obj_edit_time、且与上一轮成功入库时记下的值一致。obj_edit_time 缺失时
    一律取内容——飞书哪天不返回这个字段，行为就退回改动前，不会漏同步。

    每篇 docx 取内容要打 3 次接口（get_node + documents + raw_content），
    PDF 要 2 次。绝大多数轮次里没有文档被编辑，跳过后这些调用全省掉。
    """
    to_fetch: list[LarkNode] = []
    unchanged: list[tuple[LarkNode, SyncedNode]] = []
    for node in nodes:
        previous = known.get(node.node_token)
        if (
            not force_full
            and previous is not None
            and node.obj_edit_time
            and node.obj_edit_time == previous.obj_edit_time
        ):
            unchanged.append((node, previous))
        else:
            to_fetch.append(node)
    return to_fetch, unchanged


def walk_space_nodes(client: NodeLister, space_id: str) -> list[LarkNode]:
    nodes: list[LarkNode] = []
    seen: set[str] = set()
    pending: list[str | None] = [None]
    while pending:
        parent = pending.pop()
        for node in client.list_nodes(space_id, parent):
            if node.node_token in seen:
                continue
            seen.add(node.node_token)
            nodes.append(node)
            if node.has_child:
                pending.append(node.node_token)
    return nodes


def build_source_payload(
    client: Any,
    space_id: str,
    node: LarkNode,
    max_file_size_bytes: int,
) -> SourcePayload | None:
    if node.obj_type == "docx":
        detail = client.get_node(node.node_token)
        revision_id, content = client.get_docx(node.obj_token)
        raw = json.dumps(
            {
                "content": content,
                "node_token": node.node_token,
                "obj_edit_time": str(detail.get("obj_edit_time", "")),
                "obj_token": node.obj_token,
                "revision_id": revision_id,
                "schema_version": "lark-docx-raw-v1",
                "space_id": space_id,
                "title": node.title,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
        if len(raw) > max_file_size_bytes:
            raise ValueError("Lark Docx payload exceeds connector size limit")
        return SourcePayload(
            content=raw,
            mime_type="application/json",
            document_type="LARK_DOCX",
            version_no=revision_id,
            source_version=f"docx-revision-{revision_id}",
            object_filename="raw.json",
        )

    if node.obj_type == "file" and node.title.casefold().endswith(".pdf"):
        detail = client.get_node(node.node_token)
        version_no = int(detail.get("obj_edit_time", 0))
        if version_no < 1 or version_no > 2_147_483_647:
            raise ValueError("Lark PDF edit time cannot be represented as a document version")
        content = client.download_file(node.obj_token)
        if len(content) > max_file_size_bytes:
            raise ValueError("Lark PDF exceeds connector size limit")
        if not content.startswith(b"%PDF-"):
            raise ValueError("Lark file named PDF does not contain a PDF signature")
        return SourcePayload(
            content=content,
            mime_type="application/pdf",
            document_type="PDF",
            version_no=version_no,
            source_version=f"file-edit-{version_no}",
            object_filename="original.pdf",
        )
    return None


def _safe_title(node: LarkNode, document_type: str, data_class: str, sha256: str) -> str:
    if data_class in ("C1", "C2") and node.title.strip():
        return node.title.strip()[:160]
    return f"{document_type} {sha256[:10]}"


def ingest_source_payload(
    client: SupabasePlatformClient,
    connector: dict[str, Any],
    node: LarkNode,
    payload: SourcePayload,
    settings: Settings,
    *,
    source_uri: str,
) -> dict[str, Any]:
    if not TOKEN_PATTERN.fullmatch(node.node_token):
        raise ValueError("unsafe Lark node token")
    sha256 = payload.sha256
    object_path = (
        f"{connector['knowledge_space_id']}/lark/{node.node_token}/"
        f"{payload.version_no}/{payload.object_filename}"
    )
    uploaded = client.upload_object(
        str(connector["bucket_id"]), object_path, payload.content, payload.mime_type
    )
    raw_object = client.one(
        client.rpc(
            "ops_resolve_raw_object",
            {
                "p_bucket_id": connector["bucket_id"],
                "p_object_path": object_path,
                "p_sha256": sha256,
                "p_size_bytes": len(payload.content),
                "p_mime_type": payload.mime_type,
                "p_data_class": connector["data_class"],
                "p_source_record_key": node.node_token,
                "p_source_version": payload.source_version,
            },
        )
    )
    if raw_object:
        batch = {"batch_id": raw_object["batch_id"]}
    else:
        source_batch_key = hashlib.sha256(
            (
                f"{connector['connector_id']}:{node.node_token}:"
                f"{payload.source_version}:{sha256}"
            ).encode()
        ).hexdigest()
        batch = client.one(
            client.rpc(
                "ops_register_raw_batch",
                {
                    "p_source_system": "LARK_WIKI",
                    "p_source_batch_key": source_batch_key,
                    "p_schema_version": "lark-wiki-v1",
                    "p_writer_id": "hotcrush-lark-wiki-sync",
                    "p_store_id": None,
                    "p_expected_count": 1,
                    "p_metadata": {
                        "connector_id": connector["connector_id"],
                        "external_space_id": connector["external_space_id"],
                        "node_token": node.node_token,
                        "obj_type": node.obj_type,
                        "source_uri": source_uri,
                    },
                },
            )
        )
        if not batch:
            raise RuntimeError("Lark raw batch registration returned no row")
        raw_object = client.one(
            client.rpc(
                "ops_register_raw_object",
                {
                    "p_batch_id": batch["batch_id"],
                    "p_bucket_id": connector["bucket_id"],
                    "p_object_path": object_path,
                    "p_sha256": sha256,
                    "p_size_bytes": len(payload.content),
                    "p_mime_type": payload.mime_type,
                    "p_data_class": connector["data_class"],
                    "p_source_record_key": node.node_token,
                    "p_source_version": payload.source_version,
                },
            )
        )
        if not raw_object:
            raise RuntimeError("Lark raw object registration returned no row")

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
                "p_space_id": connector["knowledge_space_id"],
                "p_document_key": f"lark-{node.node_token}",
                "p_version_no": payload.version_no,
                "p_title": _safe_title(
                    node, payload.document_type, str(connector["data_class"]), sha256
                ),
                "p_document_type": payload.document_type,
                "p_pipeline_version": settings.pipeline_version,
                "p_embedding_model": settings.embedding_model,
            },
        )
    )
    if not document:
        raise RuntimeError("Lark document finalization returned no row")
    return {
        "uploaded": uploaded,
        "sha256": sha256,
        "batch_id": batch["batch_id"],
        "raw_object_id": raw_object["raw_object_id"],
        "document_id": document["document_id"],
        "document_status": document["status"],
        "rag_eligibility": document["rag_eligibility"],
    }


def _record_source_item(
    platform: SupabasePlatformClient,
    *,
    sync_run_id: str,
    node: LarkNode,
    source_uri: str,
    status: str,
    payload: SourcePayload | None = None,
    document_id: str | None = None,
    error_summary: str | None = None,
    source_revision: str | None = None,
    source_sha256: str | None = None,
) -> None:
    # 内容未变而被跳过的节点没有 payload，改由调用方直接传上一轮记下的
    # revision 与 sha256，这样写出的行与全量拉取时完全一致。
    revision = source_revision if source_revision is not None else (
        payload.source_version if payload else None
    )
    sha256 = source_sha256 if source_sha256 is not None else (
        payload.sha256 if payload else None
    )
    platform.rpc(
        "ai_record_source_item",
        {
            "p_sync_run_id": sync_run_id,
            "p_external_node_token": node.node_token,
            "p_external_object_token": node.obj_token,
            "p_object_type": node.obj_type,
            "p_title": node.title[:500],
            "p_source_uri": source_uri,
            "p_source_revision": revision,
            "p_source_sha256": sha256,
            "p_document_id": document_id,
            "p_status": status,
            "p_error_summary": error_summary,
            "p_metadata": {"parent_node_token": node.parent_node_token},
        },
    )


def sync_connector(
    lark: Any,
    platform: SupabasePlatformClient,
    connector: dict[str, Any],
    settings: Settings,
    lark_settings: LarkWikiSettings,
    *,
    known_nodes: dict[str, SyncedNode] | None = None,
    force_full: bool = False,
) -> dict[str, Any]:
    started = platform.one(
        platform.rpc(
            "ai_begin_source_sync",
            {"p_connector_id": connector["connector_id"], "p_worker_id": settings.worker_id},
        )
    )
    if not started:
        raise RuntimeError("source sync did not return a run")
    sync_run_id = str(started["sync_run_id"])
    # 这个字典整体作为 p_counts 传给 ai_finish_source_sync，键不能动。
    # 跳过的节点计入 unchanged（语义正好吻合），另用 skipped 单独统计，
    # 只出现在本函数的返回值里，不进数据库。
    counts = {"discovered": 0, "synced": 0, "unchanged": 0, "unsupported": 0, "failed": 0}
    # 就地更新调用方持有的状态字典：同步结果里不该混进内部状态，
    # 那个 dict 会被 main() 直接 json.dumps 打到 stdout。
    known = known_nodes if known_nodes is not None else {}
    skipped = 0
    try:
        nodes = walk_space_nodes(lark, str(connector["external_space_id"]))
    except Exception as exc:
        platform.rpc(
            "ai_finish_source_sync",
            {
                "p_sync_run_id": sync_run_id,
                "p_status": "FAILED",
                "p_counts": counts,
                "p_error_summary": str(exc)[:2000],
            },
        )
        raise

    to_fetch, unchanged_nodes = partition_nodes(nodes, known, force_full=force_full)

    # 内容未变：不打飞书，直接用上一轮记下的 revision/sha 复现 source_item，
    # 写出的行与全量拉取时一致。
    for node, previous in unchanged_nodes:
        counts["discovered"] += 1
        counts["unchanged"] += 1
        skipped += 1
        _record_source_item(
            platform,
            sync_run_id=sync_run_id,
            node=node,
            source_uri=f"{lark_settings.wiki_base_url}/wiki/{node.node_token}",
            status="SYNCED",
            source_revision=previous.source_revision,
            source_sha256=previous.source_sha256,
            document_id=previous.document_id,
        )

    for node in to_fetch:
        counts["discovered"] += 1
        source_uri = f"{lark_settings.wiki_base_url}/wiki/{node.node_token}"
        try:
            payload = build_source_payload(
                lark,
                str(connector["external_space_id"]),
                node,
                int(connector["max_file_size_bytes"]),
            )
            if payload is None:
                counts["unsupported"] += 1
                known.pop(node.node_token, None)
                _record_source_item(
                    platform,
                    sync_run_id=sync_run_id,
                    node=node,
                    source_uri=source_uri,
                    status="UNSUPPORTED",
                )
                continue
            result = ingest_source_payload(
                platform, connector, node, payload, settings, source_uri=source_uri
            )
            if result["uploaded"]:
                counts["synced"] += 1
            else:
                counts["unchanged"] += 1
            if node.obj_edit_time:
                known[node.node_token] = SyncedNode(
                    obj_edit_time=node.obj_edit_time,
                    source_revision=payload.source_version,
                    source_sha256=payload.sha256,
                    document_id=str(result["document_id"]) if result["document_id"] else None,
                )
            item_status = (
                "REVIEW_REQUIRED"
                if result["document_status"] == "REVIEW_REQUIRED"
                else "SYNCED"
            )
            _record_source_item(
                platform,
                sync_run_id=sync_run_id,
                node=node,
                source_uri=source_uri,
                status=item_status,
                payload=payload,
                document_id=result["document_id"],
            )
        except Exception as exc:
            counts["failed"] += 1
            # 失败的节点必须从状态里剔除，否则下一轮会被当成"未变"而永久跳过。
            known.pop(node.node_token, None)
            LOGGER.exception("Lark node sync failed node=%s", node.node_token)
            _record_source_item(
                platform,
                sync_run_id=sync_run_id,
                node=node,
                source_uri=source_uri,
                status="FAILED",
                error_summary=str(exc)[:2000],
            )

    status = "PARTIAL" if counts["failed"] else "SUCCEEDED"
    platform.rpc(
        "ai_finish_source_sync",
        {
            "p_sync_run_id": sync_run_id,
            "p_status": status,
            "p_counts": counts,
            "p_error_summary": None,
        },
    )
    LOGGER.info(
        "connector=%s fetched=%d skipped_unchanged=%d",
        connector["display_name"],
        len(to_fetch),
        skipped,
    )
    return {
        "connector": connector["display_name"],
        "status": status,
        **counts,
        "skipped_unchanged": skipped,
    }


def run_all_syncs(settings: Settings, lark_settings: LarkWikiSettings) -> list[dict[str, Any]]:
    state_path = state_file_path()
    state = {} if full_resync_requested() else load_sync_state(state_path)
    force_full = full_resync_requested()
    results: list[dict[str, Any]] = []
    with (
        LarkApiClient(lark_settings) as lark,
        SupabasePlatformClient(
            settings.supabase_url,
            settings.supabase_service_key,
            settings.request_timeout_seconds,
        ) as platform,
    ):
        connectors = platform.rpc("ai_list_source_connectors", {})
        if not isinstance(connectors, list):
            raise TypeError("source connector RPC did not return a row list")
        try:
            for row in connectors:
                connector_id = str(row["connector_id"])
                known = state.setdefault(connector_id, {})
                results.append(
                    sync_connector(
                        lark,
                        platform,
                        row,
                        settings,
                        lark_settings,
                        known_nodes=known,
                        force_full=force_full,
                    )
                )
        finally:
            # 某个 connector 抛异常时，前面已经同步成功的进度也要落盘，
            # 否则重试会白白重新拉一遍。
            save_sync_state(state_path, state)
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync allowlisted Lark Wiki spaces into R6 Raw/RAG")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    settings = Settings.from_env(require_embedding=False)
    lark_settings = LarkWikiSettings.from_env()
    print(json.dumps(run_all_syncs(settings, lark_settings), ensure_ascii=False))


if __name__ == "__main__":
    main()
