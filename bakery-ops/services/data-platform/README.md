# Hot Crush data-platform worker

This service is the external compute half of the Supabase blueprint. Supabase owns source
metadata, leases, RLS, publication and retrieval; this process owns PDF download, OCR,
chunking and embedding. It supersedes LightRAG as the write path after remote acceptance.

Commands:

```bash
uv sync --dev
uv run brainctl inventory "/path/to/Brain/raw"
uv run brainctl upload "/path/to/approved-c1.pdf"
uv run brainctl search "opening checklist" --space-id 10000000-0000-7000-8000-000000000001
uv run hotcrush-rag-worker
uv run hotcrush-rag-worker --loop
uv run pytest
uv run ruff check .
```

Only C1 documents classified as `AUTO` upload without an explicit review flag. HR-domain
files are C2 review-required even when their names contain handbook/SOP keywords. C2/C3/C4
can be stored with `--allow-review-required`, but database policy keeps them out of automatic
RAG. Searches require at least one explicit knowledge-space UUID. Deterministic test embeddings require both localhost Supabase and
`ALLOW_TEST_EMBEDDINGS=1`; they are rejected for hosted projects.

BakeryOps 已有只读 R6 适配代码，但现网不配置、不启用，仍使用旧生产库与旧
LightRAG。未来切换时必须使用独立的 `R6_SUPABASE_*` 变量，不能复用历史
`SUPABASE_*`，避免两个 Project 的凭据互相覆盖。

`knowledgeClient.ingest()` 不是 R6 文档入库通道：R6 后端始终拒绝该调用。现网
LightRAG 暂保持旧行为；未来切换之前，再单独批准将
`KNOWLEDGE_UNCLASSIFIED_INGEST_ENABLED=false` 作为过渡闸门。PDF 进 R6 必须使用
`brainctl upload` 及 worker 的分级流水线。
