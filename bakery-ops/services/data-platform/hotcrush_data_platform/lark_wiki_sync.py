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

    @classmethod
    def from_api(cls, value: dict[str, Any]) -> LarkNode:
        node = cls(
            node_token=str(value.get("node_token", "")),
            obj_token=str(value.get("obj_token", "")),
            obj_type=str(value.get("obj_type", "")),
            title=str(value.get("title", "")),
            parent_node_token=str(value.get("parent_node_token", "")),
            has_child=bool(value.get("has_child", False)),
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
) -> None:
    platform.rpc(
        "ai_record_source_item",
        {
            "p_sync_run_id": sync_run_id,
            "p_external_node_token": node.node_token,
            "p_external_object_token": node.obj_token,
            "p_object_type": node.obj_type,
            "p_title": node.title[:500],
            "p_source_uri": source_uri,
            "p_source_revision": payload.source_version if payload else None,
            "p_source_sha256": payload.sha256 if payload else None,
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
    counts = {"discovered": 0, "synced": 0, "unchanged": 0, "unsupported": 0, "failed": 0}
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

    for node in nodes:
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
    return {"connector": connector["display_name"], "status": status, **counts}


def run_all_syncs(settings: Settings, lark_settings: LarkWikiSettings) -> list[dict[str, Any]]:
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
        return [sync_connector(lark, platform, row, settings, lark_settings) for row in connectors]


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
