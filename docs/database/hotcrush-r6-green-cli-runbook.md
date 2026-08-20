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

已验证基线：20 个 migrations，7 个 pgTAP 文件、63 项断言。

远端发布与 drift：

```bash
npx supabase db push --linked
npx supabase db lint --linked --schema public,private
npx supabase db diff --linked --schema public,private
npx supabase migration list --linked
```

验收要求：lint 无错误，diff 为 `No schema changes found`，20 个编号两侧一致。

## 3. R6 worker 凭据

worker 只接受独立 R6 变量。secret 文件必须位于仓库外并设置仅当前用户可读权限：

```bash
export R6_SUPABASE_URL="https://tmmkknnkcptunxbfjxqn.supabase.co"
export R6_SUPABASE_SECRET_KEY_FILE="/安全路径/r6-secret"
```

不要复用旧项目的 `SUPABASE_*`，不要把 secret 作为命令参数，不要提交 secret 文件。

## 4. 单日 POS 只读回填

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

## 5. 自动对账

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

当前 `status=degraded` 是预期状态：保留了一个经业务对账判定不完整的半日快照，Raw status 为
`QUARANTINED`。不得为追求绿色状态把它恢复。

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

恢复后必须再次执行第 5 节自动对账。2026-08-20 已在远端实测：隔离已接受 batch 后
`current_days=0`，1 个日版本和 11 个小时版本仍保留；恢复后 `current_days=1`，再次对账 0 差异。

## 8. PDF / RAG

```bash
cd /Users/weiliangshao/hot/bakery-ops/services/data-platform
uv run brainctl inventory "/path/to/Brain/raw"
uv run brainctl upload "/path/to/approved-c1.pdf"
uv run hotcrush-rag-worker
uv run brainctl search "问题" \
  --space-id 10000000-0000-7000-8000-000000000001
```

`inventory` 不上传；只有完成分级并满足 space policy 的文件可进入处理。C3/C4 不得因命令行方便而绕过准入。

## 9. 当前明确不执行

- 不修改旧应用 `.env`、systemd drop-in 或 Vercel variables。
- 不启用 `R6_SHADOW_ENABLED=1`。
- 不把 POS worker 配成常驻服务。
- 不切 BakeryOps 知识查询 backend。
- 不批量上传未分类 Brain PDF。
- 不因旧库 RLS advisory 直接执行 `ENABLE RLS`；先设计 policy 和兼容窗口。
