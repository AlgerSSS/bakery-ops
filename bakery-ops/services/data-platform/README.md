# Hot Crush data-platform worker

This service is the external compute half of the Supabase blueprint. Supabase owns source
metadata, leases, RLS, publication and retrieval; this process owns PDF download, OCR,
chunking and embedding. Lark Wiki is the authoritative document entry point; the local Brain
commands remain available only for reviewed historical imports. It supersedes LightRAG as the
write path after remote acceptance.

Commands:

```bash
export R6_SUPABASE_URL="https://tmmkknnkcptunxbfjxqn.supabase.co"
export R6_SUPABASE_SERVICE_KEY_FILE="/path/to/r6-secret"
uv sync --dev
uv run brainctl inventory "/path/to/Brain/raw"
uv run brainctl plan "/path/to/Brain/raw" --output /secure/path/brain-manifest.json
uv run brainctl review /secure/path/brain-manifest.json /secure/path/brain-review.json \
  --path "relative/path.pdf" --decision APPROVE_RAG --reviewer reviewer-id \
  --reason "rendered-page review evidence"
uv run brainctl batch "/path/to/Brain/raw" /secure/path/brain-manifest.json
uv run brainctl batch "/path/to/Brain/raw" /secure/path/brain-manifest.json \
  --review-manifest /secure/path/brain-review.json --apply
uv run brainctl auto "/path/to/Brain/raw" \
  --state-file /secure/path/auto-state.json
uv run brainctl auto "/path/to/Brain/raw" \
  --state-file /secure/path/auto-state.json --apply
uv run brainctl probe "/path/to/Brain/raw"
uv run brainctl upload "/path/to/approved-c1.pdf"
uv run brainctl search "opening checklist" --space-id 10000000-0000-7000-8000-000000000001
uv run brainctl status --document-id DOCUMENT_UUID
uv run brainctl unpublish DOCUMENT_UUID --reason "rollback rehearsal" --actor operator
uv run brainctl restore DOCUMENT_UUID --reason "rollback passed" --actor operator --apply
uv run hotcrush-lark-wiki-sync
uv run hotcrush-rag-worker
uv run hotcrush-rag-worker --drain --max-runs 100
uv run hotcrush-rag-worker --loop
uv run hotcrush-pos-worker
uv run hotcrush-pos-worker --drain --max-runs 31
uv run hotcrush-pos-worker --loop
uv run pytest
uv run ruff check .
```

RAG and POS commands reject the generic `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`
variables even when the parent BakeryOps `.env` contains them. Every R6 command must receive
the isolated `R6_SUPABASE_*` credentials explicitly.

Only C1 documents classified as `AUTO` upload without an explicit review ledger. HR-domain
files are C2 review-required even when their names contain handbook/SOP keywords. An approved
C1/C2 review is bound to the source manifest and file SHA-256 and queued through the controlled
`ai_approve_document_review` RPC. C3/C4 stay blocked because the current worker does not perform
real PII redaction; setting `is_redacted` is not proof of redaction. Searches require at least one
explicit knowledge-space UUID. Deterministic test embeddings require both localhost Supabase and
`ALLOW_TEST_EMBEDDINGS=1`; they are rejected for hosted projects.

`brainctl plan` hashes all PDFs and writes a tamper-evident manifest. Deduplication is scoped
to one knowledge-space boundary; identical bytes in different security spaces never share a
Raw object. `brainctl batch` is dry-run unless `--apply` is present and uploads only
`AUTO_UPLOAD` plus explicitly approved C1/C2 review entries. RAG unpublish/restore commands are
also dry-run unless `--apply` is explicit; they retain the original, review, chunks and vectors.

`hotcrush-lark-wiki-sync` is the unattended entry point. It lists only the eight connectors
allowlisted by `ai_list_source_connectors`, traverses each Wiki space, stores exact PDF bytes or a
canonical Docx raw JSON payload, and records source revision/SHA/Lark URI. Database-owned space
classification decides whether the document is C1 auto-RAG, C2 review-required, or C3/C4 blocked.
The Tokyo systemd timer runs it every 30 minutes; online Docx chunks have null page numbers and use
the original Lark URI as their citation.

`brainctl auto` was the earlier local unattended C1 entry point. It never consumes a review ledger, so C2/C3/C4
cannot cross the automatic boundary. The last successful manifest is written atomically with 0600
permissions under a 0700 directory. Identical scans do zero uploads; an upload failure does not
advance state. A changed or removed source path fails closed because automatic code cannot infer
whether to create a new logical version or unpublish the old document.

This Mac path is retained for historical reproduction, not as the current source of truth. On this Mac,
`run-brain-auto-ingest.sh` first runs a 20-second full PDF read probe, then reads only
the R6 service credential already stored in Keychain and runs auto-ingest with a 300-second hard
timeout. `build-brain-ingest-app.sh` wraps the runner in the dedicated, ad-hoc signed
`~/Applications/HotCrush R6 Brain Ingest.app`; the LaunchAgent targets that app instead of granting
broad Full Disk Access to `/bin/bash` or Python. `install-brain-auto-ingest.sh install` installs the
30-minute agent, waits for the first run, and retains it only after exit 0. Any probe/run failure or
timeout automatically unloads the agent and moves its plist to Trash while retaining the app,
state, logs and R6 data. Grant iCloud/Full Disk Access only to the dedicated app, then rerun the
installer. The 2026-08-21 background trial correctly returned `77/EX_NOPERM` and self-removed. Do
not reinstall it or request Full Disk Access merely to make this obsolete path green.

BakeryOps 已有只读 R6 适配代码，但现网不配置、不启用，仍使用旧生产库与旧
LightRAG。未来切换时必须使用独立的 `R6_SUPABASE_*` 变量，不能复用历史
`SUPABASE_*`，避免两个 Project 的凭据互相覆盖。

`knowledgeClient.ingest()` 不是 R6 文档入库通道：R6 后端始终拒绝该调用。现网
LightRAG 暂保持旧行为；未来切换之前，再单独批准将
`KNOWLEDGE_UNCLASSIFIED_INGEST_ENABLED=false` 作为过渡闸门。PDF 进 R6 必须使用
Lark 同步或经过审阅的 `brainctl upload`，并由 worker 完成分级流水线。

`hotcrush-pos-worker` 只领取 `pos_daily_sales` 队列，逐个下载并校验 Raw object 的
size/SHA-256，再交叉核对日销售 CSV 与 `daily.json.hourlyByDate` 后，原子发布到
`pos_sales_day` / `pos_sales_hour`。它在现网没有 service unit、不会自动运行；迁移
演练应以 `--drain` 一次性排空有界队列，确认范围对账和回滚以后才能申请常驻。
