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

已验证基线：22 个 migrations，8 个 pgTAP 文件、74 项断言。

远端发布与 drift：

```bash
npx supabase db push --linked
npx supabase db lint --linked --schema public,private
npx supabase db diff --linked --schema public,private
npx supabase migration list --linked
```

验收要求：lint 无错误，diff 为 `No schema changes found`，22 个编号两侧一致。

## 3. R6 worker 凭据

worker 只接受独立 R6 变量。secret 文件必须位于仓库外并设置仅当前用户可读权限：

```bash
export R6_SUPABASE_URL="https://tmmkknnkcptunxbfjxqn.supabase.co"
export R6_SUPABASE_SECRET_KEY_FILE="/安全路径/r6-secret"
export R6_SUPABASE_SERVICE_KEY_FILE="/安全路径/r6-secret"
```

不要复用旧项目的 `SUPABASE_*`，不要把 secret 作为命令参数，不要提交 secret 文件。

## 4. POS 范围回填（主路径）

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

全历史 dry-run 盘点为 2025-12-03 至 2026-08-19 共 260 日：229 日可处理、31 日须隔离，原因是
22 日无小时来源、7 日缺日汇总、2 日交叉对账失败。该盘点没有批量写入 R6。

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

当前 `status=degraded` 是预期状态：2 个 quarantined batch 中，一个是已确认历史源质量异常，不触发
平台故障；另一个是不完整的半日快照，仍是 `quarantined_unacknowledged=1`。不得为追求绿色状态把它恢复。

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
