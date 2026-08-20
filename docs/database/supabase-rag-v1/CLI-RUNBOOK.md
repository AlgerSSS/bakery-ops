# HOT CRUSH Supabase + PDF/RAG CLI 可行性与运行手册

> 状态：本地验证通过的平台能力清单；生产命令只作说明，未执行。
>
> 验证环境：macOS、Docker 28.1.1、PostgreSQL 17 本地 Supabase 栈、Supabase CLI 2.115.0。
>
> 表结构和实施顺序以 `docs/database/hotcrush-supabase-implementation-blueprint-v2.md` 为准；
> 本文只保留已实测 CLI 能力、限制和运行门禁。

## 1. 最终判断

| 环节 | Supabase 官方 CLI 单独完成 | 命令行组合完成 | 本轮验证状态 |
|---|---:|---:|---|
| 初始化本地 Supabase | 是 | 是 | 已通过 |
| 启动 Postgres/Storage/API | 是 | 是 | 已通过隔离端口启动 |
| Auth 登录与完整跨用户 RLS policy | 是 | 是 | 正式 policy 尚未实现/验证 |
| SQL 迁移重放 | 是 | 是 | `db reset --local` 已通过 |
| pgvector 建表与 cosine 查询 | 迁移 + SQL | 是 | 已通过 |
| 全文 GIN 索引 | 迁移 + SQL | 是 | 已通过 |
| RLS 开启 | 迁移 + SQL | 是 | 已通过 |
| 私有 bucket 建立 | SQL 迁移 | 是 | 已通过 |
| PDF 上传/列举 | 是，但 Storage 命令仍要求 `--experimental` | 是 | 已通过本地上传/回读 |
| pgTAP | 是 | 是 | 已通过 |
| PL/pgSQL lint | 是 | 是 | 已通过 |
| Security Advisor | 是 | 是 | 已通过本地检查 |
| TypeScript 类型生成 | 是 | 是 | 已通过 |
| PDF 盘点与 SHA-256 | 否 | 是，自有 `brainctl` | 尚未实现正式 CLI |
| PDF 人工分级 | 否 | 只能由 CLI 辅助，不能取消人工判断 | 规则已设计 |
| OCR / 版面 / 表格解析 | 否 | 是，外部程序/worker | 本机依赖不完整 |
| embedding 生成 | 否 | 是，外部模型或 API worker | 现有 LightRAG 能生成，但未接 Supabase |
| 混合检索 RPC | SQL 迁移 | 是 | 已验证原语，正式函数待实现 |
| 生产迁移 | 是 | 是 | 未执行，必须人工审批 |

因此：“全部通过 CLI 操作”可行；“只安装 Supabase CLI 就完成全部 RAG”不可行。

## 2. 本轮实际验证记录

本轮没有连接或修改生产数据库，使用 `/tmp` 中的隔离项目和 55320–55329 端口完成：

1. `supabase init` 成功。
2. 首次 `db start` 因默认端口 54322 已被另一套本地 Supabase 占用而失败；改用隔离端口后成功。
3. `CREATE EXTENSION vector WITH SCHEMA extensions` 成功。
4. 建立带 `tsvector`、GIN、`vector(3)` 和 RLS 的验证表成功。
5. cosine 相似度查询将员工手册文本排在品牌手册文本之前，证明 vector 运算链路正常。
6. 带 `--schema cli_validation,extensions` 的 `db diff` 因隐藏了 vector 扩展依赖而失败；不加 schema filter 的完整 diff 成功并生成扩展 DDL。
7. 自动生成的迁移经 `db reset --local` 从零重放成功。
8. `db lint --fail-on error`、security advisor、TypeScript 类型生成成功。
9. `supabase test new` 生成的模板只有 `plan(1)`、没有断言，直接运行会失败；加入一条 `has_table` 断言后 pgTAP 通过。
10. 创建 `kb-internal` 私有 bucket 后，`supabase storage cp --experimental --local` 成功上传仓库内非敏感架构 PDF，`storage ls` 与 `storage.objects` 回读一致。

这些结果证明平台原语可行，但不是正式 12 表迁移已经完成。

## 3. 当前环境缺口

已安装：

- Node.js 24.4.1 / npm 11.4.2
- Python 3.14.5 / uv 0.9.5
- Poppler 命令：`pdftotext`、`pdfinfo`、`pdftoppm`
- Tesseract 5.5.2
- Python `supabase` 与 `pytesseract`

尚未安装：

- `ocrmypdf`、Ghostscript、qpdf
- PyMuPDF/pypdf/pdfplumber
- sentence-transformers、torch、transformers
- psycopg 与 Python pgvector adapter

Python 3.14 对部分机器学习依赖可能过新。正式 `brainctl` 应由 `uv` 固定 Python 3.12/3.13 和 lockfile，不复用系统 Python。

## 4. CLI 目录与所有权

建议在仓库根目录建立唯一的 Supabase CLI 工程：

```text
supabase/
  config.toml
  migrations/
  tests/
  functions/
  seed.sql

tools/brainctl/
  pyproject.toml
  uv.lock
  src/brainctl/
  tests/
```

`supabase/.temp/` 不入库；它当前链接到 R6 Green，任何远程命令前都必须核对目标。旧仓库内按整数编号的 SQL 先冻结，不迁移到新目录重复执行。

## 5. 建议的命令接口

### Supabase 平台命令

CLI 版本应固定，示例：

```bash
npx --yes supabase@2.115.0 --version
npx --yes supabase@2.115.0 start
npx --yes supabase@2.115.0 db reset --local
npx --yes supabase@2.115.0 db lint --local --fail-on error
npx --yes supabase@2.115.0 test db --local
npx --yes supabase@2.115.0 db advisors --local --type security --level warn --fail-on warn
npx --yes supabase@2.115.0 gen types --local --lang typescript --schema public
```

生产预览只允许显式 `--linked --dry-run`：

```bash
npx --yes supabase@2.115.0 projects list
npx --yes supabase@2.115.0 migration list --linked
npx --yes supabase@2.115.0 db push --linked --dry-run
```

真正的 `db push --linked` 不放进无人值守脚本；由人核对 project ref、维护窗口和 dry-run 后执行。永远不得对 Source 生产库运行 `db reset --linked`。

### 文档摄取命令

计划实现以下项目 CLI；默认全部只读或 dry-run：

```bash
uv run brainctl inventory --root "/path/to/Brain/raw" --out brain-manifest.jsonl
uv run brainctl classify --manifest brain-manifest.jsonl --out brain-classified.jsonl
uv run brainctl review --manifest brain-classified.jsonl
uv run brainctl plan --manifest brain-approved.jsonl
uv run brainctl upload --manifest brain-approved.jsonl --dry-run
uv run brainctl upload --manifest brain-approved.jsonl --apply
uv run brainctl ingest --space kb-internal --wait
uv run brainctl validate --space kb-internal
uv run brainctl search --as-user <user-id> --query "年假怎么申请"
uv run brainctl report --out brain-import-report.json
```

安全默认值：

- 未经 `review` 的条目不能上传。
- C3/C4 不接受批量 `--yes` 绕过人工确认。
- `upload` 先校验本地 hash、bucket 和对象路径，再写 Storage 和元数据。
- 重跑依据 `space_id + content_sha256 + pipeline_version` 幂等。
- 不把绝对本地路径、姓名或手机号写入 Storage object key。
- 任何外部 embedding/OCR API 必须按分类策略阻止 C3/C4 外发。

## 6. Storage CLI 的限制

Supabase CLI 2.115.0 的 `storage cp/ls/mv/rm` 在实际运行时仍要求全局 `--experimental`。它适合本地验证、一次性复制和灾备操作，但正式 Brain 导入更需要：

- manifest 驱动的分类检查；
- 上传前后 SHA-256 对账；
- 数据库版本行与 Storage 对象的原子补偿；
- 断点续传、重试、幂等和可观测状态；
- 对 C3/C4 的强制阻断。

所以生产导入首选 `brainctl` 调用 Supabase Storage SDK；仍然是 CLI 工作流，但不是直接把整个 Brain 目录交给 `supabase storage cp -r`。

## 7. 迁移门禁

每个 migration 必须依次通过：

```text
SQL 手工复核
  -> 本地 db reset
  -> pgTAP 权限与约束测试
  -> db lint --fail-on error
  -> db advisors security/performance
  -> 类型生成差异
  -> R6 Green 无 PII 重放
  -> db push --dry-run
  -> 人工批准生产窗口
  -> 人执行生产 migration
  -> 只读验收与回滚判断
```

特别规则：

- pgvector 扩展 DDL 手写，不依赖过滤 schema 的 `db diff` 自动生成。
- 每张新表必须有 `COMMENT ON TABLE`。
- 所有外键列建索引；只检索 current/published 的路径用 partial index。
- 生产没有 staging，R6 Green 只能做无真实 PII 的迁移演练，不替代生产备份与人工批准。
- 修改现有表前先确认四个代码库的读写者；有 `ON CONFLICT` 的表改名不能依赖兼容视图。

## 8. 仍需实现才能称为“端到端完成”

1. Source 生产库的 CLI 基线与唯一 migration 账本。
2. v2 蓝图中的 11 张核心表（其中 6 张 `ai_` 表）、RLS、Storage policy、混合检索 RPC 和 pgTAP。
3. `brainctl` 的 inventory/classify/upload/validate。
4. OCR、版面解析、结构化抽取和 embedding worker。
5. 20 份 C1 文档试点与真实检索问题集。
6. BakeryOps 从 LightRAG 切换到 Supabase RPC。

在这些完成前，只能说“架构与平台原语可行”，不能说“整个生产流程已经完成”。
