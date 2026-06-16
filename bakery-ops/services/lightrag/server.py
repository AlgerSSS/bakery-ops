"""
LightRAG FastAPI microservice for Hot Crush knowledge graph.
Provides /ingest and /query endpoints for the TypeScript bot.
Run with: cd services/lightrag && uv run python server.py
"""
import os
import sys
import logging
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from openai import AsyncOpenAI

from config import (
    OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL,
    LLM_MODEL,
    EMBEDDING_MODEL,
    WORKING_DIR,
    HOST,
    PORT,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lightrag-server")

LIGHTRAG_API_KEY = os.getenv("LIGHTRAG_API_KEY", "")
if not LIGHTRAG_API_KEY:
    logger.warning("LIGHTRAG_API_KEY is not set — /ingest and /query are UNAUTHENTICATED. Set LIGHTRAG_API_KEY to require Bearer auth.")

# --- OpenRouter client ---
openrouter = AsyncOpenAI(
    api_key=OPENROUTER_API_KEY,
    base_url=OPENROUTER_BASE_URL,
)


async def llm_func(prompt: str, **kwargs) -> str:
    """LLM completion via OpenRouter."""
    res = await openrouter.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
        max_tokens=2000,
    )
    return res.choices[0].message.content or ""


async def embedding_func(texts: list[str]) -> np.ndarray:
    """Embedding via OpenRouter."""
    res = await openrouter.embeddings.create(
        model=EMBEDDING_MODEL,
        input=texts,
    )
    sorted_data = sorted(res.data, key=lambda d: d.index)
    return np.array([d.embedding for d in sorted_data])


# --- LightRAG instance ---
rag = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global rag
    try:
        from lightrag import LightRAG
        from lightrag.utils import EmbeddingFunc

        os.makedirs(WORKING_DIR, exist_ok=True)

        rag = LightRAG(
            working_dir=WORKING_DIR,
            llm_model_func=llm_func,
            embedding_func=EmbeddingFunc(
                embedding_dim=1536,
                func=embedding_func,
                max_token_size=8192,
            ),
        )
        await rag.initialize_storages()
        logger.info("LightRAG initialized, working_dir=%s", WORKING_DIR)
    except Exception as e:
        logger.error("Failed to initialize LightRAG: %s", e, exc_info=True)
        sys.exit(1)
    yield


app = FastAPI(title="LightRAG Service", lifespan=lifespan)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    if LIGHTRAG_API_KEY:
        auth_header = request.headers.get("authorization", "")
        token = auth_header[7:] if auth_header.startswith("Bearer ") else None
        if token != LIGHTRAG_API_KEY:
            return JSONResponse(status_code=status.HTTP_401_UNAUTHORIZED, content={"detail": "Unauthorized"})
    return await call_next(request)


# --- Request/Response models ---
class IngestRequest(BaseModel):
    text: str
    metadata: dict | None = None


class IngestResponse(BaseModel):
    status: str
    chars: int


class QueryRequest(BaseModel):
    question: str
    mode: str = "hybrid"


class QueryResponse(BaseModel):
    answer: str
    mode: str


class HealthResponse(BaseModel):
    status: str
    rag_ready: bool


# --- Endpoints ---
@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(status="ok", rag_ready=rag is not None)


@app.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest):
    if not req.text.strip():
        raise HTTPException(400, "Empty text")
    try:
        await rag.ainsert(req.text)
        logger.info("Ingested %d chars", len(req.text))
        return IngestResponse(status="ok", chars=len(req.text))
    except Exception as e:
        logger.error("Ingest failed: %s", e)
        raise HTTPException(500, f"Ingest failed: {e}")


@app.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest):
    valid_modes = ["naive", "local", "global", "hybrid"]
    mode = req.mode if req.mode in valid_modes else "hybrid"
    try:
        from lightrag import QueryParam
        result = await rag.aquery(req.question, param=QueryParam(mode=mode))
        logger.info("Query mode=%s, question=%s", mode, req.question[:80])
        return QueryResponse(answer=result, mode=mode)
    except Exception as e:
        logger.error("Query failed: %s", e)
        raise HTTPException(500, f"Query failed: {e}")


def main():
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)


if __name__ == "__main__":
    main()

