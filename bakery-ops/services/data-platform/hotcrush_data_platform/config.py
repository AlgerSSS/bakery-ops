from __future__ import annotations

import os
import socket
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

SERVICE_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = SERVICE_DIR.parent.parent
load_dotenv(PROJECT_DIR / ".env")


def _secret_from_env(name: str) -> str:
    direct = os.getenv(name, "")
    if direct:
        return direct
    file_path = os.getenv(f"{name}_FILE", "")
    if not file_path:
        return ""
    return Path(file_path).read_text(encoding="utf-8").strip()


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_key: str
    openrouter_api_key: str
    openrouter_base_url: str
    embedding_model: str
    pipeline_version: str
    worker_id: str
    embedding_mode: str
    allow_test_embeddings: bool
    request_timeout_seconds: float

    @classmethod
    def from_env(cls, *, require_embedding: bool = True) -> Settings:
        settings = cls(
            supabase_url=os.getenv("R6_SUPABASE_URL", "").rstrip("/"),
            supabase_service_key=_secret_from_env("R6_SUPABASE_SERVICE_KEY"),
            openrouter_api_key=_secret_from_env("OPENROUTER_API_KEY"),
            openrouter_base_url=os.getenv(
                "OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"
            ).rstrip("/"),
            embedding_model=os.getenv(
                "AI_EMBEDDING_MODEL", "openai/text-embedding-3-small"
            ),
            pipeline_version=os.getenv("RAG_PIPELINE_VERSION", "rag-v1"),
            worker_id=os.getenv("RAG_WORKER_ID", f"{socket.gethostname()}:{os.getpid()}"),
            embedding_mode=os.getenv("RAG_EMBEDDING_MODE", "openrouter").lower(),
            allow_test_embeddings=os.getenv("ALLOW_TEST_EMBEDDINGS", "") == "1",
            request_timeout_seconds=float(os.getenv("DATA_PLATFORM_HTTP_TIMEOUT", "60")),
        )
        settings.validate(require_embedding=require_embedding)
        return settings

    def validate(self, *, require_embedding: bool = True) -> None:
        if not self.supabase_url or not self.supabase_service_key:
            raise ValueError(
                "R6_SUPABASE_URL and R6_SUPABASE_SERVICE_KEY are required for RAG"
            )
        if not require_embedding:
            return
        if self.embedding_mode == "deterministic":
            is_local = self.supabase_url.startswith(("http://127.0.0.1", "http://localhost"))
            if not self.allow_test_embeddings or not is_local:
                raise ValueError(
                    "deterministic embeddings require ALLOW_TEST_EMBEDDINGS=1 and localhost Supabase"
                )
        elif self.embedding_mode == "openrouter":
            if not self.openrouter_api_key:
                raise ValueError("OPENROUTER_API_KEY is required for production embeddings")
        else:
            raise ValueError(f"unsupported RAG_EMBEDDING_MODE: {self.embedding_mode}")


@dataclass(frozen=True)
class PosWorkerSettings:
    supabase_url: str
    supabase_service_key: str
    worker_id: str
    request_timeout_seconds: float

    @classmethod
    def from_env(cls) -> PosWorkerSettings:
        settings = cls(
            supabase_url=os.getenv("R6_SUPABASE_URL", "").rstrip("/"),
            supabase_service_key=_secret_from_env("R6_SUPABASE_SERVICE_KEY"),
            worker_id=os.getenv("POS_WORKER_ID", f"{socket.gethostname()}:{os.getpid()}"),
            request_timeout_seconds=float(os.getenv("DATA_PLATFORM_HTTP_TIMEOUT", "60")),
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        if not self.supabase_url or not self.supabase_service_key:
            raise ValueError(
                "R6_SUPABASE_URL and R6_SUPABASE_SERVICE_KEY are required for the POS worker"
            )
        if not self.worker_id.strip():
            raise ValueError("POS_WORKER_ID cannot be empty")
