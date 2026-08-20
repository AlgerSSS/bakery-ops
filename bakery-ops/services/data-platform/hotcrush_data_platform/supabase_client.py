from __future__ import annotations

from pathlib import PurePosixPath
from typing import Any, Self
from urllib.parse import quote

import httpx


class SupabasePlatformClient:
    def __init__(self, url: str, service_key: str, timeout_seconds: float = 60) -> None:
        self.url = url.rstrip("/")
        self._client = httpx.Client(
            timeout=timeout_seconds,
            headers={
                "apikey": service_key,
                "authorization": f"Bearer {service_key}",
            },
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if not response.is_error:
            return
        try:
            body = response.json()
            if isinstance(body, dict):
                parts = [body.get("code"), body.get("message"), body.get("hint")]
                detail = ": ".join(str(part) for part in parts if part)
            else:
                detail = str(body)
        except ValueError:
            detail = response.text
        detail = " ".join(detail.split())[:1000] or "no response detail"
        raise RuntimeError(f"Supabase HTTP {response.status_code}: {detail}")

    def rpc(self, name: str, payload: dict[str, Any]) -> Any:
        response = self._client.post(f"{self.url}/rest/v1/rpc/{name}", json=payload)
        self._raise_for_status(response)
        if not response.content:
            return None
        return response.json()

    @staticmethod
    def one(value: Any) -> dict[str, Any] | None:
        if value is None:
            return None
        if isinstance(value, list):
            return value[0] if value else None
        if isinstance(value, dict):
            return value
        raise TypeError(f"expected object or one-row array, got {type(value).__name__}")

    @staticmethod
    def _object_url(base_url: str, route: str, bucket: str, object_path: str) -> str:
        clean_path = str(PurePosixPath(object_path))
        if clean_path.startswith("/") or ".." in PurePosixPath(clean_path).parts:
            raise ValueError("unsafe Storage object path")
        encoded_path = quote(clean_path, safe="/")
        return f"{base_url}/storage/v1/object/{route}/{quote(bucket, safe='')}/{encoded_path}"

    def upload_object(
        self,
        bucket: str,
        object_path: str,
        content: bytes,
        content_type: str,
    ) -> bool:
        url = self._object_url(self.url, "", bucket, object_path).replace("/object//", "/object/")
        response = self._client.post(
            url,
            content=content,
            headers={"content-type": content_type, "x-upsert": "false"},
        )
        if response.status_code in (400, 409) and "already exists" in response.text.lower():
            return False
        self._raise_for_status(response)
        return True

    def download_object(self, bucket: str, object_path: str) -> bytes:
        url = self._object_url(self.url, "authenticated", bucket, object_path)
        response = self._client.get(url)
        self._raise_for_status(response)
        return response.content
