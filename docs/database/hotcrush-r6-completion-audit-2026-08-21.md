# Hot Crush R6 完成度审计（2026-08-21）

> 审计对象：独立 Supabase Project `hotcrush-core-r6-green`
> (`tmmkknnkcptunxbfjxqn`)；旧生产 `ecsgqcmwtjmcpzqytdqw` 只读且继续承载现网。

## 结论

数据库平台主体已经落地并有本地、远端和运行时证据，但完整长期目标**尚不能标为完成**。
尚缺的不是另一批表，而是两个外部运行条件：

1. Mac LaunchAgent 在后台读取 iCloud Brain `raw` 目录时被 macOS TCC 拒绝；相同 R6-only 专用 App
   在交互会话读取 165 个 PDF 并完成 `NO_CHANGES`。现已增加 20 秒全量读取探针、专用 ad-hoc 签名 App
   wrapper、首跑退出码门禁和失败自动 bootout：真实后台试验在约 21 秒返回 `77: EX_NOPERM`，agent、plist
   和子进程均无残留。用户只给专用 App 授予 Full Disk Access 并重新安装、观察一次退出 0 之前，不能
   声称“新 PDF 无人值守自动发现”已生产可用。
2. 旧生产数据库连接串曾被输出到任务日志。旧库仍可用且配置未改，但密码必须视为已暴露。轮换需要
   同步四个既有消费者，属于用户明确禁止本轮修改的旧生产配置；完成协调轮换前，“不破坏旧生产”的
   功能条件成立，凭据安全闭环不成立。

持续 POS shadow、应用切库和生产读流量切换不是遗漏：用户最后明确要求旧生产继续运行且不得改旧配置，
所以本阶段只证明独立 R6 能接管，不执行切换。C3/C4 没有真实脱敏能力，也被正确阻断而非伪装完成。

## 要求—证据矩阵

| 原目标要求 | 权威证据 | 判定 |
|---|---|---|
| 独立新 Supabase Project | linked ref、远端 migration ledger 均为 `tmmkknnkcptunxbfjxqn` | 已证明 |
| 数据库物理结构 | 25 个 migration 可从空库重放；15 张平台表、2 个 current view、40 个受控函数 | 已证明 |
| Storage | 7 个 private bucket；Raw object 与 Storage 双向 lineage 缺口为 0 | 已证明 |
| RLS / RPC | 109 个 pgTAP 覆盖默认封闭、空间成员、worker capability、受控写入；review 底表直读 403 | 已证明 |
| Cron | 6/6 active；覆盖 lease recovery、health rollup、lineage reconcile、failed staging cleanup | 已证明 |
| 结构化处理 | POS Raw→lease→SHA/业务对账→版本事实→current view 的 worker 与回滚均实跑 | 已证明 |
| PDF/RAG worker | tokyo-01 `hotcrush-rag-worker` enabled/active；6 文档、108 页、113 chunks/vectors | 已证明 |
| 新 PDF 自动发现 | 首次 165 文件/3 C1 成功、二次 `NO_CHANGES`；专用签名 App 交互式通过，LaunchAgent 返回 77 后自动回滚 | **部分完成** |
| 应用接入 | BakeryOps `SupabaseKnowledgeClient` 在不改现网 backend 时，C1/C2 三空间返回预期标题与页码 | 已证明 |
| 数据迁移演练 | 2025-12-03..2026-08-19：260 日、229 current、31 quarantine、2699 小时、九窗 mismatch 0 | 已证明 |
| 端到端测试 | local：109 pgTAP、56 Python、143+22 RES、463 BakeryOps、Next build；remote acceptance 退出 0 | 已证明 |
| 监控 | `ops_get_platform_health`、`pipeline_health`、Cron、租约/失败/Storage/RAG 审计不变量 | 已证明 |
| 回滚 | POS quarantine/restore；C1/C2 RAG unpublish/search-zero/restore/original-page | 已证明 |
| 可复现 CLI | reset/test/lint/push/diff、backfill/verifier、brainctl/worker、`accept-r6-platform.sh` | 已证明 |
| 不破坏旧生产 | 两个旧 `.env` 未改且仍指向旧 ref；旧库导出事务只读；未启用 POS shadow/切读 | 功能已证明；凭据轮换待完成 |

## 新 PDF 自动链的实际边界

```text
Brain/raw
  → brainctl auto 每 30 分钟重新 hash/classify
  → 新 C1：上传 private Storage + Raw 注册 + 文档 finalize
  → tokyo-01 RAG worker：OCR/切块/embedding/原子发布
  → C2：只进入本机 manifest，必须显式 review
  → C3/C4：拒绝进入 RAG

源路径内容改变或删除
  → auto 立即失败，不推进成功 state
  → 人工决定新版本或 unpublish
```

已实现的防线：

- 只读取 Keychain 中独立 R6 凭据，不读取旧库连接或改旧 `.env`；
- dry-run 不写状态；apply 状态目录 700、文件与 lock 600；
- 只有 `AUTO_UPLOAD` C1 会传给上传函数；
- 完全相同目录二次执行为 `NO_CHANGES`，0 次上传；
- 中途上传失败、源内容改变或删除均不推进最后成功 manifest；
- runner 先以 20 秒探针逐个打开所有 PDF，再读取 Keychain；auto 有 300 秒硬超时；
- LaunchAgent 只启动专用签名 App，不要求给共享 shell/Python 放权；首跑非零或超时会自动卸载；
- 安装/卸载不会删除专用 App、R6 数据或本机审阅状态。

## 解除剩余阻塞后的验收

1. 在 macOS「隐私与安全性 → 完全磁盘访问权限」中只添加并开启
   `/Users/weiliangshao/Applications/HotCrush R6 Brain Ingest.app`。不要给共享的 `/bin/bash`、Terminal、
   Codex 或 Python 放权。这是系统 UI 的用户同意，CLI 不能静默绕过。
2. 执行：

   ```bash
   cd /Users/weiliangshao/hot/bakery-ops/services/data-platform
   ./install-brain-auto-ingest.sh install
   ```

3. installer 会等待首次运行；它必须打印 `first background run exited 0`，否则自动回滚。随后验收：

   ```bash
   launchctl print gui/$(id -u)/com.hotcrush.r6-brain-ingest
   tail -n 40 ~/Library/Logs/hotcrush-r6-brain-ingest.out.log
   tail -n 40 ~/Library/Logs/hotcrush-r6-brain-ingest.err.log
   ```

   `state=not running`、`last exit code=0`、stdout 为 `NO_CHANGES` 或一次成功 C1 apply、stderr 为空。

4. 在单独维护窗口轮换旧 Supabase 数据库密码，同步所有既有消费者，再运行完整 R6 remote acceptance
   和旧应用 smoke test。不能只改一个 `.env` 后撤销旧凭据。

这两项完成并留存退出 0/应用 smoke 证据后，才有充分依据把长期目标标为完成。
