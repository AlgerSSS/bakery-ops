# Hot Crush R6 Green CLI 验收与回滚 Runbook

> 目标：用命令行重建、迁移、处理、对账、监控和回滚 R6，同时保持旧生产库
> `ecsgqcmwtjmcpzqytdqw` 为现网唯一真源。
>
> 禁止：修改 BakeryOps / `res_api` 的 `DATABASE_URL`，或把 R6 secret 写进仓库 `.env`。

## 1. 目标确认

```bash
cd /Users/weiliangshao/hot
test "$(cat supabase/.temp/project-ref)" = "tmmkknnkcptunxbfjxqn"
npx supabase migration list --linked
```

若 project ref 不等于 R6，立即停止。旧生产 ref 是 `ecsgqcmwtjmcpzqytdqw`。

## 2. 从零重放数据库

```bash
npx supabase db reset
npx supabase test db
npx supabase db lint --local --schema public,private
```

已验证基线：25 个 migrations，11 个 pgTAP 文件、109 项断言。

远端发布与 drift：

```bash
npx supabase db push --linked
npx supabase db lint --linked --schema public,private
npx supabase db diff --linked --schema public,private
npx supabase migration list --linked
```

验收要求：lint 无错误，diff 为 `No schema changes found`，25 个编号两侧一致。

完整门禁已收敛成一个可重放命令。`local` 只重建本地测试库；`remote` 只检查已链接 R6、健康和
应用检索；`all` 依次执行两者：

```bash
cd /Users/weiliangshao/hot
./scripts/accept-r6-platform.sh local

# 仅通过进程或仓库外 secret file 注入，不改旧应用 .env
export R6_SUPABASE_URL="https://tmmkknnkcptunxbfjxqn.supabase.co"
export R6_SUPABASE_SERVICE_KEY_FILE="/安全路径/r6-secret"
export AI_EMBED_API_KEY_FILE="/安全路径/openrouter-secret"
./scripts/accept-r6-platform.sh remote
```

脚本先验证链接 ref 是 R6、BakeryOps 与 `res_api` 两份旧 `.env` 都仍含旧生产 ref 且没有 R6 ref，
再执行门禁。远端门禁包含完整九窗 POS 历史对账，不只检查数据库“有行”；`R6_ACCEPTANCE_DEEP=1`
会额外执行耗时较长的远端 shadow schema diff。

## 3. R6 worker 凭据

worker 只接受独立 R6 变量。secret 文件必须位于仓库外并设置仅当前用户可读权限：

```bash
export R6_SUPABASE_URL="https://tmmkknnkcptunxbfjxqn.supabase.co"
export R6_SUPABASE_SECRET_KEY_FILE="/安全路径/r6-secret"
export R6_SUPABASE_SERVICE_KEY_FILE="/安全路径/r6-secret"
```

当前 Python/TypeScript 客户端会同时发送 `apikey` 和 `Authorization: Bearer`，因此这里的文件应存
R6 legacy `service_role` JWT；2026-08-21 实测把新版 `sb_secret_...` 直接放入同一变量会返回 401。
不要复用旧项目的 `SUPABASE_*`，不要把 secret 作为命令参数，不要提交 secret 文件。

## 4. POS 历史与范围回填（主路径）

### 4.1 全历史正式命令

全历史 CLI 自动切成最多 31 天的窗口。它固定要求旧源 ref 为 `ecsgqcmwtjmcpzqytdqw`、目标 ref 为
`tmmkknnkcptunxbfjxqn`；默认只读生成计划。显式 `--apply` 后，每窗严格按“登记 Raw → 有界 Worker
drain → 独立范围 verify”串行执行，任何子进程或对账失败立即停止。TLS/网络瞬断只在当前 drain 内最多
重试 3 次，数据、SHA 或解析错误不重试：

```bash
cd /Users/weiliangshao/hot/res_api
npm run backfill:r6-pos-history -- \
  --from=2025-12-03 \
  --to=2026-08-19 \
  '--old-store=吉隆坡Pavilion门店' \
  --r6-store=HC001

# 人工确认计划后才加 --apply
npm run backfill:r6-pos-history -- \
  --from=2025-12-03 \
  --to=2026-08-19 \
  '--old-store=吉隆坡Pavilion门店' \
  --r6-store=HC001 \
  --apply

# 完全独立地重新读取旧库与 R6，验证九个窗口
npm run verify:r6-pos-history -- \
  --from=2025-12-03 \
  --to=2026-08-19 \
  '--old-store=吉隆坡Pavilion门店' \
  --r6-store=HC001
```

中断时可把 `--from` 改为最后一个未完成窗口的起点；Raw 内容哈希和 batch key 保证原样重跑可复用。
完成态 12 日窗口复跑已验证所有对象 `uploaded=false`、Worker `processed=0`、对账仍为 0。

2026-08-21 复核结果：2025-12-03 至 2026-08-19 共 260 日，229 日进入 current、31 日只保留隔离
证据；R6 为 229 条 current 日事实、2699 条 current 小时事实、260 个 legacy batch。31 个异常由 22 日
无小时来源、7 日缺日汇总、2 日交叉对账失败组成；九窗独立 verify 的 `mismatchCount=0`。
2026-08-21 对 2026-08-20 做了只读 dry-run，旧源已有 1 个可处理日；本次故意未写 R6，
因此上述数字是“截至 08-19 的固定历史快照”，不是持续同步高水位。

### 4.2 单个 1–31 日窗口

每次最多 31 个自然日。默认只生成计划，不写 R6；计划会把每一天明确分成 `PROCESS` 或
`QUARANTINE`，不会把缺少小时来源、缺少日来源或交叉对账失败的数据伪装成可信事实：

```bash
cd /Users/weiliangshao/hot/res_api
npm run backfill:r6-pos-range -- \
  --from=2026-04-09 \
  --to=2026-04-14 \
  '--old-store=吉隆坡Pavilion门店' \
  --r6-store=HC001
```

人工检查计划后，显式增加 `--apply`。旧库只读事务会在任何 R6 写入发生前结束：

```bash
npm run backfill:r6-pos-range -- \
  --from=2026-04-09 \
  --to=2026-04-14 \
  '--old-store=吉隆坡Pavilion门店' \
  --r6-store=HC001 \
  --apply
```

命令逐日登记不可变 Raw；中途失败可原样重跑，已完成日必须返回同一 `batchId` 且
`uploaded=false`。接着一次性排空当前 POS 队列，不安装常驻服务：

```bash
cd /Users/weiliangshao/hot/bakery-ops/services/data-platform
POS_WORKER_ID="manual-range-$(date +%Y%m%d)" \
  uv run hotcrush-pos-worker --drain --max-runs 31
```

范围自动对账同时证明可信日事实和异常 Raw 证据：

```bash
cd /Users/weiliangshao/hot/res_api
npm run verify:r6-pos-range -- \
  --from=2026-04-09 \
  --to=2026-04-14 \
  '--old-store=吉隆坡Pavilion门店' \
  --r6-store=HC001
```

唯一通过条件是退出 0、`ok=true`、`mismatchCount=0`。2026-08-20 远端实测：6 个自然日中
5 日进入 current（5 条日事实、57 条小时事实），2026-04-12 因来源账单数不一致只保留
`LEGACY_POS_ANOMALY / QUARANTINED`；69 条旧库小时来源全部被处理或保存在异常证据中。

该 6 日命令保留为诊断示例；全历史已由上面的正式命令完成，不再是仅 dry-run 的计划。

## 5. 单日 POS 诊断回填

以下脚本从 `res_api/.env` 读取旧 `DATABASE_URL`，在事务第一条语句设置
`SET TRANSACTION READ ONLY`；它只把导出物写入 R6：

```bash
cd /Users/weiliangshao/hot/res_api
npm run backfill:r6-pos-day -- \
  --date=2026-07-26 \
  '--old-store=吉隆坡Pavilion门店' \
  --r6-store=HC001
```

输出必须包含新的 `batchId`、`status=READY`、一个 Raw object SHA-256，且旧库查询失败时不得注册 batch。

一次性领取并处理：

```bash
cd /Users/weiliangshao/hot/bakery-ops/services/data-platform
POS_WORKER_ID="manual-backfill-$(date +%Y%m%d)" uv run hotcrush-pos-worker
```

worker 只领取 `pos_daily_sales`，校验 Storage size/SHA-256、日/小时账单与金额，再原子发布事实。

单日自动对账：

```bash
cd /Users/weiliangshao/hot/res_api
npm run verify:r6-pos-day -- \
  --date=2026-07-26 \
  '--old-store=吉隆坡Pavilion门店' \
  --r6-store=HC001
```

唯一通过条件：进程退出 0，`ok=true`、`mismatchCount=0`，旧库和 R6 小时行数一致。
“processing run SUCCEEDED”本身不是业务验收。

2026-08-20 实际证据：1 个日事实、11 个小时事实，逐字段 0 差异；batch
`0471f653-0035-49cc-9621-cb80be43d5f2`。

## 6. 健康与 lineage

```bash
cd /Users/weiliangshao/hot
npx supabase db query --linked \
  "select public.ops_get_platform_health() as health;" \
  --output json
```

检查：

- `processing/rag/agents.failed_or_dead = 0`
- `expired_leases = 0`
- `storage.registered_missing_object = 0`
- `storage.object_missing_registration = 0`
- `cron.active_jobs = 6`
- `raw.acknowledged_source_quality` 单独统计已确认的历史源异常
- 只有 `raw.quarantined_unacknowledged` 会把未解决隔离计为平台故障

当前 `status=degraded` 是预期状态：32 个 quarantined batch 中，31 个是已确认的历史源质量异常，
不触发平台故障；另一个是不完整的半日快照，仍是 `quarantined_unacknowledged=1`。不得为追求绿色状态
把它恢复。

## 7. 回滚与恢复

回滚不会删除 Raw、Storage object 或版本化 fact，只让 current view 回退：

```bash
npx supabase db query --linked \
  "select public.ops_quarantine_raw_batch(
    '<batch-uuid>', '对账失败原因', '操作者标识'
  );"
```

验证 current 与历史仍在：

```bash
npx supabase db query --linked \
  "select public.ops_get_pos_processed_summary();"
```

只有重新对账通过后才恢复：

```bash
npx supabase db query --linked \
  "select public.ops_restore_raw_batch(
    '<batch-uuid>', '重新对账通过的证据', '操作者标识'
  );"
```

恢复后必须再次执行单日或范围自动对账。2026-08-20 已在远端实测：隔离已接受 batch 后
`current_days=0`，1 个日版本和 11 个小时版本仍保留；恢复后 `current_days=1`，再次对账 0 差异。
全历史完成后又抽样 2026-02-15：隔离时全库 `current_days` 从 229 降为 228，`daily_versions=259`、
`hourly_versions=2742` 保持不变；恢复后 current 回到 229，单日 verify 再次 0 差异。直接读取版本底表
返回 403 是预期权限边界，运维验证应使用受控 RPC，不应扩大 service role 表权限。

## 8. PDF / RAG

```bash
cd /Users/weiliangshao/hot/bakery-ops/services/data-platform
uv run brainctl inventory "/path/to/Brain/raw"
uv run brainctl plan "/path/to/Brain/raw" --output /secure/path/brain-manifest.json
uv run brainctl batch "/path/to/Brain/raw" /secure/path/brain-manifest.json

# REVIEW_REQUIRED 必须逐文件追加决定；review ledger 必须放仓库外并 chmod 600
uv run brainctl review \
  /secure/path/brain-manifest.json \
  /secure/path/brain-review.json \
  --path 'relative/path/to/document.pdf' \
  --decision APPROVE_RAG \
  --reviewer 'reviewer-id' \
  --reason '逐页检查后的具体批准理由'

uv run brainctl batch \
  "/path/to/Brain/raw" \
  /secure/path/brain-manifest.json \
  --review-manifest /secure/path/brain-review.json \
  --apply
uv run hotcrush-rag-worker --drain --max-runs 100
uv run brainctl status --document-id '<document-uuid>'
uv run brainctl search "问题" \
  --space-id 10000000-0000-7000-8000-000000000001
```

`plan` 会读取 SHA-256、按知识空间边界去重并生成带摘要的 manifest；`batch` 默认 dry-run，显式
`--apply` 后只处理 `AUTO_UPLOAD` 和审阅账本中明确 `APPROVE_RAG` 的 C1/C2。源 manifest、review ledger、
文件哈希、大小、分类或 disposition 任何一个被修改都会拒绝。批准 RPC 会再次把 review manifest SHA、
源文件 SHA、reviewer、reason、pipeline 和 embedding model 一起写入不可变数据库证据，并原子建队列。
相同批准可幂等重放，内容冲突的重放会失败。同一 PDF 跨权限空间不共用 Raw 对象。

当前 worker **没有真正的 PII 脱敏实现**，不能把 `is_redacted=true` 当作脱敏证据。数据库因此强制
`ai_approve_document_review` 只接受 C1/C2；C3/C4 即使写入 review ledger，也不能进入 RAG。

真实 Brain 盘点结果：165 份均完成哈希；manifest 中 3 份 `AUTO_UPLOAD`、70 份
`REVIEW_REQUIRED`、45 份 `DENIED`、47 份同空间重复跳过。70 份待审项已记录 3 个
`APPROVE_RAG` 与 67 个 `DENY_RAG`；所有 35 份 C3 因缺少真实脱敏能力而拒绝。R6 当前发布
3 份 C1 + 3 份 C2，共 108 页、113 chunks / 113 embeddings、6 个成功 ingest run。数据库有 3 条
manifest/source SHA 绑定的批准证据，C2 current 文档审计缺口为 0。C1 招聘价格表、C2 会员方案、
C2 HR 制度的应用级精确查询分别命中第 1、2、11 页。远端 Worker 已安装 Tesseract 英文/简体中文语言包，启动前会 fail-fast
检查可执行文件，避免缺依赖时先消耗数据库重试次数。

本次完整账本不提交 Git，保存在本机权限 700 的目录：
`/Users/weiliangshao/Library/Application Support/HotCrush/r6-rag/brain-review-2026-08-21/`。
其中 manifest 内部摘要为 `9a30e2b7...a7c8049`，review ledger 内部摘要为
`8ee45bff...aec3de`；两个 JSON 文件权限均为 600。数据库只保存真正上传的 3 条批准证据，67 条拒绝
继续留在受限 review ledger，避免为“记录拒绝”而把敏感文件路径或原件上传数据库。

RAG publication 的回滚同样默认 dry-run：

```bash
uv run brainctl unpublish '<document-uuid>' \
  --reason '检索验收失败' --actor 'operator'
uv run brainctl unpublish '<document-uuid>' \
  --reason '检索验收失败' --actor 'operator' --apply
uv run brainctl restore '<document-uuid>' \
  --reason '重新验收通过' --actor 'operator' --apply
```

unpublish 只从检索中移除 current publication；Storage 原件、review、chunks、vectors 和成功 run 保留。
远端已分别实测 C1 价格表与人工批准 C2 会员方案：unpublish 后查询消失，restore 后相同
`document_id` / `ingest_run_id` 与原页结果恢复。

应用侧验收不要求切换现网配置：

```bash
cd /Users/weiliangshao/hot/bakery-ops
npm run verify:r6-knowledge
```

统一远端验收脚本会用显式 R6 凭据和空间 ID 调用 BakeryOps 的 `SupabaseKnowledgeClient`，必须返回
C1 价格表第 1 页、C2 会员方案第 2 页和 C2 HR 制度第 11 页；同时断言 6 文档、108 页、113
chunks/vectors、3 条批准证据、0 个 C2 审计缺口。外部 embedding 请求最多重试 3 次，数据库或内容不变量
失败不重试。
现网 `KNOWLEDGE_BACKEND` 默认仍是 `lightrag`，没有修改。

## 9. 当前明确不执行

- 不修改旧应用 `.env`、systemd drop-in 或 Vercel variables。
- 不启用 `R6_SHADOW_ENABLED=1`。
- 不把 POS worker 配成常驻服务。
- 不切 BakeryOps 知识查询 backend。
- 不上传 review ledger 中 `DENY_RAG`、manifest 中 `DENIED` 或任何 C3/C4 Brain PDF。
- 不因旧库 RLS advisory 直接执行 `ENABLE RLS`；先设计 policy 和兼容窗口。
