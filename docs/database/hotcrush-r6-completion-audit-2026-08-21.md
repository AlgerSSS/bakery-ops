# Hot Crush R6 完成度审计（2026-08-21）

> 审计对象：独立 Supabase Project `hotcrush-core-r6-green`
> (`tmmkknnkcptunxbfjxqn`)；旧生产 `ecsgqcmwtjmcpzqytdqw` 只读且继续承载现网。

## 结论

R6 数据平台在当前授权边界内已经形成可重建、可运行、可监控、可回滚的闭环。此前把 Mac Brain 目录
当成权威入口，因此 macOS TCC 被列为完成阻塞；用户随后纠正了错误前提：权威入口是 Lark 团队知识库。
现在入口已改为 tokyo-01 每 30 分钟遍历 8 个 allowlist Wiki 空间，Mac LaunchAgent 已退出主流程，
Full Disk Access 不再是完成条件。

这不代表现网已经切到 R6。用户明确要求旧生产继续运行且不得改旧应用配置，因此持续 POS 增量、
`DATABASE_URL`、Vercel variables、BakeryOps 默认 knowledge backend 和业务读写切换均不在本阶段实施。
正确表述是“独立 R6 平台实施完成，生产切换尚未授权”，不能写成“旧生产整库迁移完成”。

另有一项独立安全事项：旧生产数据库连接串曾被输出到任务日志，密码应在单独维护窗口协调四个消费者
后轮换。本轮不得为了消除审计项而单独修改某一个 `.env`，否则会直接破坏仍在运行的旧生产消费者。

## 要求—证据矩阵

| 当前阶段要求 | 权威证据 | 判定 |
|---|---|---|
| 独立新 Supabase Project | linked ref、远端 migration ledger 均为 `tmmkknnkcptunxbfjxqn` | 已证明 |
| 数据库物理结构 | 28 个 migration 可从空库重放；18 张平台表、2 个 current view、47 个受控函数 | 已证明 |
| Storage | 7 个 private bucket；Raw object 与 Storage 双向 lineage 缺口为 0 | 已证明 |
| RLS / RPC | 13 个 pgTAP 文件、135 项断言覆盖默认封闭、空间成员、worker capability、受控写入、Lark source contract 和外键索引 | 已证明 |
| Cron / 定时服务 | 6/6 pg_cron active；tokyo-01 Lark timer active/enabled；RAG worker active | 已证明 |
| Lark 自动入口 | 8 个团队空间；首轮 24 节点成功，完成态复跑 24 unchanged，0 failed | 已证明 |
| 数据分级 | 8 个 C1 自动发布；16 个 C2/C3 保持审阅或阻止状态；C3/C4 无自动越权发布 | 已证明 |
| RAG | 历史 PDF 6 文档/108 页/113 vectors；Lark C1 8 文档/8 vectors；总计 14 current 文档/121 vectors | 已证明 |
| 引用 | PDF 返回真实页码；Lark Docx 的 `page_from/page_to` 为 null，返回原始 Wiki URI | 已证明 |
| 结构化处理 | POS Raw→lease→SHA/业务对账→版本事实→current view 的 worker 与回滚均实跑 | 已证明 |
| 应用接入 | BakeryOps `SupabaseKnowledgeClient` 调用 citation-aware v2 RPC；显式 R6 opt-in，不改现网 backend | 已证明 |
| 数据迁移演练 | 2025-12-03..2026-08-19：260 日、229 current、31 quarantine、2699 小时、九窗 mismatch 0 | 已证明 |
| 端到端测试 | 数据库 135/135；Python 65/65 + Ruff；RES 143+22；BakeryOps 464 + TypeScript + Next build | 已证明 |
| 监控 | `ops_get_platform_health` 包含 Lark freshness/failure/missing；当前 8 connector fresh、0 failed/missing | 已证明 |
| 回滚 | POS quarantine/restore；C1/C2 RAG unpublish/search-zero/restore/original-page | 已证明 |
| 可复现 CLI | reset/test/lint/push/diff、POS verifier、Lark sync、RAG worker、`accept-r6-platform.sh` | 已证明 |
| 不破坏旧生产 | 两个旧 `.env` 未改且仍指向旧 ref；旧库导出事务只读；未启用 POS shadow/切读 | 已证明 |

## Lark 自动链的实际边界

```text
Lark 8 个 allowlist 团队空间
  → tokyo-01 systemd timer 每 30 分钟完整遍历
  → Docx：保存 canonical raw JSON；PDF：保存精确原文件 bytes
  → Private Storage + ops_raw_batch/object + ai_source_item 血缘
  → C1：自动建立 ingest run
      → RAG worker 解析/OCR、分块、embedding、原子发布
      → Docx 返回 Lark URI；PDF 返回页码
  → C2：保存 Raw，保持 REVIEW_REQUIRED
  → C3/C4：保存到受限 bucket，没有真实脱敏就不自动发布

节点连续两次完整扫描缺失
  → 标记 MISSING
  → 可逆 unpublish 当前 RAG 文档
失败或不完整扫描
  → 不推进 missing reconciliation
```

已实现的防线：

- Worker 只能从受控 RPC 读取 8 个 allowlist connector，不能自行选择任意 Wiki 空间；
- knowledge space 决定 bucket、C1–C4 和 RAG policy，Worker 自报分类无效；
- Raw object 绑定来源节点、revision、SHA-256 和不可变路径；相同完成态复跑不重复上传；
- source inventory 表对 `service_role` 也不开放直读，只提供聚合健康和受控 Worker RPC；
- Lark 与 R6 凭据通过 systemd encrypted credentials 注入，不写 unit 或仓库配置；
- 在线文档不伪造页码；引用 URI 只来自 HTTPS constraint 下的 source item；
- RAG 发布前核对 chunk/vector 数量；失败 run、过期 lease 和 Storage lineage 均纳入健康门禁。

## 当前统一验收

```bash
cd /Users/weiliangshao/hot
./scripts/accept-r6-platform.sh local

# 使用仓库外 R6 / embedding secret file
./scripts/accept-r6-platform.sh remote
```

`local` 从空库重放 28 个 migrations，执行 135 项 pgTAP、Python/Node 测试与 BakeryOps build。
`remote` 核验 migration/lint、Lark freshness、历史 PDF 稳定基线、动态 Lark current/chunk/vector/citation
不变量、东京 timer/worker、全历史 POS 九窗对账，以及三个 PDF 页码问题和一个 Lark URI 问题。

## 不属于本阶段“未完成代码”的事项

- 现网应用和旧生产仍未切到 R6：这是用户明确要求，不是漏改配置。
- POS 只有历史日/小时事实；产品、报废、会员、交易等域尚未迁移，需逐域定义粒度和对账后另行批准。
- C3/C4 没有可证明的脱敏流水线，因此保持阻止是正确结果，不应伪造完成。
- 旧生产密码轮换需要四个消费者的协调维护窗口，不能在本次 R6 提交中单边执行。
- 完整业务黄金问题集仍应随着 Agent 用例扩展；当前验证证明检索管道和引用合同，不等于证明所有回答质量。
