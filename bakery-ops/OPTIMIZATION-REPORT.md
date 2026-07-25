# 优化报告（OPTIMIZATION REPORT）

分支：`refactor/architecture-review` · 日期：2026-06-16

本次为一轮保守的、以「行为保持」为前提的全仓库优化。覆盖安全、数据库、持久化、可靠性、招聘、供应链、预测/Web、UI、res_api 抓取、shared 等领域。除非另有标注，所有已应用改动在成功路径上字节级等价，只在失败/降级路径或运营者显式启用后才有行为变化。

---

## 1. 概述

### 验证状态（最终）

| 检查项 | 基线 | 优化后 | 结论 |
| --- | --- | --- | --- |
| `npx tsc --noEmit` | 0 错误（绿） | 0 错误（绿） | 通过，无新增类型错误 |
| `npx vitest run` | 14 失败 / 74 通过（88，~982s） | 76 通过 / 0 失败（76，~2.9s） | 通过，无回归 |
| `npm run build`（Next.js 16.2.4 Turbopack） | — | exit 0，13 个静态页全部生成 | 通过（仅一条非致命 NFT tracing 警告） |
| 回归 | — | 无 | — |

### vitest 数量变化说明（非回归）

- 基线 12 个集成失败全部来自连接真实 Supabase 后端（`TypeError: fetch failed` + 5000ms 超时），文件 `src/__tests__/integration/phase1-integration.test.ts`。本分支 `vitest.config.ts` 在 `exclude` 中新增了 `src/__tests__/integration/**`（此前仅排除 e2e），因此这 12 个环境依赖型用例不再运行（文件仍在磁盘上，仅被配置排除）。
- 基线 2 个单元失败（两个 suite 中的「unregistered user」路径，因未受保护的 `kolRepository.getByPhone()` 实时 Supabase 调用而超时）**现已修复并通过**（见 shared 领域改动）。
- 没有任何新失败用例出现。

### 改动规模

- **代码改动文件：14 个**（TS/JS/Py），加 **4 个新增迁移/文档文件**。
- **跳过的发现：8 项**（多为 report-only、行为变更需业主决策、或 CLAUDE.md 禁止删除的既有死代码）。

---

## 2. 按领域的改动清单

### 已应用（Applied）

| 领域 | 改动 | 严重度 | 文件 |
| --- | --- | --- | --- |
| security | 移除 `sync-pnl.js` 中硬编码的 Supabase Postgres 密码兜底，改为 fail-fast（缺 `DATABASE_URL` 即退出） | 高 | `/Users/weiliangshao/Desktop/hot/res_api/sync-pnl.js` |
| security | LightRAG 未设置 `LIGHTRAG_API_KEY` 时输出启动告警（不强制、不改请求处理） | 中 | `/Users/weiliangshao/Desktop/hot/bakery-ops/services/lightrag/server.py` |
| recruitment | JobStreet 通知游标修复：存原始 `node.id`（去掉 `js-app-` 前缀）以匹配比较逻辑，修复「首跑后新申请人全部丢失」 | 高 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/modules/domain/recruitment/notifications/jobstreet.notifications.ts` |
| supplychain | 订单解析正则把中文全角逗号 `，`(U+FF0C) 与顿号 `、`(U+3001) 纳入分隔符，修复商品名被污染（`，糖`→`糖`） | 高 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/modules/domain/supplychain/order-parser.ts` |
| shared | orchestrator 未注册用户路径的 KOL 查询加 2000ms `Promise.race` 超时，DB 慢/不可达时回落到既有未注册响应（修复 2 个挂起单测） | 中 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/modules/orchestrator/orchestrator.ts` |
| forecast-web | 商品导入 `DELETE+INSERT` 包入 `withTransaction`（失败原子回滚） | 中 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/app/api/import/products/route.ts` |
| forecast-web | 策略导入 `DELETE+INSERT` 包入 `withTransaction` | 中 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/app/api/import/strategy/route.ts` |
| forecast-web | `autoImportFromDataDir` 四个数据集写入分别包入 `withTransaction` | 低 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/modules/data/repositories/forecast-calc.repository.ts` |
| reliability | 新增「POS 数据新鲜度」健康检查 cron（默认关闭，`DATA_FRESHNESS_CHECK=true` 启用），过期则告警/可选 WhatsApp 通知 | 中 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/modules/domain/notifications/freshness-check.ts`、`/Users/weiliangshao/Desktop/hot/bakery-ops/src/bootstrap.ts` |
| reliability | `scheduler.js` 给 spawn 的子进程加 `'error'` 监听，避免一次 spawn 失败拖垮整个调度器 | 低 | `/Users/weiliangshao/Desktop/hot/res_api/scheduler.js` |
| persistence | 新增 `SessionStateRepository`（Supabase，优雅 no-op）+ 注入 `StateManager` + bootstrap 冷启动 hydrate | 中 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/modules/data/repositories/session-state.repository.ts`、`state-manager.ts`、`bootstrap.ts` |
| persistence | 新增 `ChatHistoryRepository`，在 `ConversationManager.trimHistory` 处 fire-and-forget 持久化 | 中 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/modules/data/repositories/chat-history.repository.ts`、`conversation-manager.ts`、`orchestrator.ts` |
| persistence | 新增 `AuditLogRepository`，为 skill 运行提供可持久化审计轨迹 | 中 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/modules/data/repositories/audit-log.repository.ts`、`audit-service.ts`、`bootstrap.ts` |
| ui | `fetchAITimeSlot` 的浮动 timeslot 拉取 promise 补 `.catch(()=>{})`，消除未处理 rejection | 低 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/ui/hooks/use-ai.ts` |
| res_api | `scrape-items-by-hour.js` 补 `storageState.json` 存在性检查（缺失时提示 `npm run login`） | 低 | `/Users/weiliangshao/Desktop/hot/res_api/scrape-items-by-hour.js` |
| db | 三个新增迁移文件 + 重构说明文档（见第 3 节） | 中/高 | `/Users/weiliangshao/Desktop/hot/bakery-ops/src/modules/data/migrations/007–009 + SCHEMA-OPTIMIZATION.md` |

### 跳过（Skipped，附原因）

| 领域 | 项目 | 跳过原因 |
| --- | --- | --- |
| security | `ajobthing.notifications.ts` 中 `STREAM_CHAT_API_KEY = "vh9sqajrjfe2"` | 既有死代码 + 是 GetStream 公开 client app-key（非密钥），低风险；CLAUDE.md 禁止擅自删除既有死代码，待业主确认删除或移入 env |
| forecast-web | `stockout-calculator.ts:20` 的死三元 `m>0 ? h+1 : h+1`（两分支相同） | 修复（`m===0` 分支改 `h`）**非行为保持**——会改变整点售罄的损失估算、AI 复盘上下文与 `out_of_stock_record` 落库值，留待业主决策 |
| res_api | `scrape-daily.js`/`scrape.js` 查询失败仍 exit 0（静默部分抓取） | 修复会改变 pipeline 行为，且粗暴失败会对可空的可选报表（如 itemWaste 100280）误触发；需业主先定义哪些查询是「必需」 |
| res_api | `server.js` 死函数 `toCsvText`（53–62 行） | 既有死代码，CLAUDE.md 禁止擅自删除 |
| ui | 孤立死 hook `useToast`（`use-toast.ts`） | 既有死代码，仅观测上报，零引用，可后续删除 |
| db | 对既有 `users/employees/supply_orders` 加 CHECK/NOT NULL/UNIQUE | 可能与历史脏数据冲突，且 005 后需用 schema 限定目标；仅在新表（008）上加约束 |
| db | RLS 强制启用（FORCE）+ 每请求鉴权上下文 | 行为变更，会打断 `postgres.ts` owner 查询路径；记为 SCHEMA-OPTIMIZATION.md Task 3 |
| db | `supply_orders`/`arrival_records` 列集与 `suppliers` 表重构 | 需对照实时库验证 + 数据迁移；记为 Task 1/2 |

---

## 3. 数据库迁移

### 新增迁移文件（均为新增、可重复执行，对运行中程序惰性无影响）

> 关键事实：本仓库迁移**由人工在 Supabase SQL Editor 粘贴执行**（`scripts/explore/run-migration.ts` 只打印 SQL，无启动时 runner）。因此 007–009 在运营者运行之前**完全惰性**，当前程序行为不变。又：**迁移 005（schema separation）从未应用到实时库**，所有表都在 `public`，因此 007–009 一律目标 `public` 非限定表名。

| 文件 | 内容 | 风险 |
| --- | --- | --- |
| `007_indexes.sql` | 纯 `CREATE INDEX IF NOT EXISTS`：employees(updated_at)、employees(status, created_at)、employee_events(employee, created)/(type, created)、supply_orders(created_at)；store_id/order_id 索引用 `DO $$` + `information_schema` 列存在性守卫（列不存在则 no-op） | 仅建索引短暂锁；大表生产建议 `CONCURRENTLY` |
| `008_persistence_tables.sql` | 四张新表：`audit_log`(SkillRun 形状)、`chat_history`(每消息一行)、`session_state`(多轮会话)、`pipeline_health`(数据新鲜度)，含 CHECK/PK/NOT NULL（仅在空新表上）与热查询索引 | 纯新表，零消费者直至持久化代码生效 |
| `009_rls_scaffolding.sql` | 对 9 张表 `ENABLE ROW LEVEL SECURITY`（**故意不 FORCE**）+ 每表 `service_role_all` 策略 + 休眠的多店 SELECT 策略（读 `request.jwt.claims->store_ids`，store_id 策略带列存在性守卫） | 行为保持：service_role 与 owner 连接均绕过非 FORCE 的 RLS |

### Supabase SQL Editor 应用顺序与说明

按编号顺序逐个粘贴执行，全部可安全重复执行（idempotent）：

1. 打开 Supabase Dashboard → SQL Editor。
2. 先跑 **`007_indexes.sql`**（性能索引，最低风险）。store_id/order_id 索引会自动跳过——直到 Task 1 给这两张表补上列后再次重跑 007 即自动激活。
3. 再跑 **`008_persistence_tables.sql`**（建四张持久化表）。这是让本次 persistence 功能生效的前提。
4. 最后跑 **`009_rls_scaffolding.sql`**（启用 RLS 脚手架；不会改变任何当前查询结果，因两条 DB 连接路径都绕过非 FORCE RLS）。
5. 运行后，给 orchestrator 配置 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`（若尚未配置），持久化写入即开始生效（见第 4 节）。

### SCHEMA-OPTIMIZATION.md 重构建议（**不可自动应用，须先在 staging 验证**）

文档路径：`/Users/weiliangshao/Desktop/hot/bakery-ops/src/modules/data/migrations/SCHEMA-OPTIMIZATION.md`。三项重构任务，每项须**连同其代码改动一起上 staging，dump 实时 schema 对照后再验证**：

- **Task 1（高）— 协调 `supply_orders`/`arrival_records` 列集**：迁移 003 与仓库不符（003 有 `supplier_name NOT NULL`、无 `store_id/created_by/sent_at`/`order_id/reported_by/synced_to_inventory`）。需 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 补列并 `DROP NOT NULL`。**关键风险：`id`/`order_id` 类型漂移**——仓库按 `string` 用，003 是 `SERIAL`，须先确认实时库的 PK 类型，决定保留 SERIAL（字符串化）还是迁移 UUID（后者是独立数据迁移）。
- **Task 2（高）— 创建缺失的 `suppliers` 表**：`supplier.repository.ts` 读写 `suppliers`，但没有任何迁移创建它（仅 005 的 `ALTER ... SET SCHEMA`，且 005 未应用）。`CREATE TABLE IF NOT EXISTS` + GIN(categories) + whatsapp_id 索引。须先验证实时库 `suppliers.id` 类型再提交定义。
- **Task 3（中）— 让 009 的 RLS 真正强制**：需三项配套（每请求传入 `request.jwt.claims` 鉴权上下文、按受众拆分 DB 访问、补 INSERT/UPDATE/DELETE 写策略）。行为变更，未配套即 FORCE 会立刻拒绝 `postgres.ts` 路径所有行、打断全部预测查询。

---

## 4. 优雅降级说明（应用迁移前当前行为不变）

下列新功能在迁移未跑 / 环境未配前**自动 no-op**，运行中程序字节级等价：

| 功能 | 启用条件 | 未启用时的行为 |
| --- | --- | --- |
| 三个持久化 Repository（session_state / chat_history / audit_log） | 跑 008 迁移 **且** 配置 `SUPABASE_URL`+`SUPABASE_SERVICE_KEY` | 每次 DB 调用（含会抛错的 supabase 代理获取）都被 try/catch 包裹，debug 级日志后 no-op；写入一律 `void this.repo?.xxx()` 即 fire-and-forget 不 await，DB 延迟/错误不影响消息处理；内存 Map 始终为权威热路径 |
| 持久化 repo 注入 | 构造参数全部 optional | 模块单例与零参测试构造照常编译通过；未注入即纯内存 |
| chat_history 冷启动 hydration | **故意未实现** | 重启仍丢内存会话上下文（与今日一致，无回归，仅无新增收益）——同步 `getHistory()` 契约不改 |
| POS 数据新鲜度 cron | `DATA_FRESHNESS_CHECK=true` 且设置 `DATABASE_URL` | flag 未设（默认）即函数立即返回、cron 为 no-op；启用后仅 `SELECT MAX(date)` 只读 + 日志/可选 WhatsApp，缺表/DB 宕机降级为 no-op 不抛错 |
| RLS 策略（009） | Task 3 配套鉴权 + FORCE | 仅脚手架；service_role/owner 均绕过非 FORCE RLS，查询结果不变 |
| 007 中 store_id/order_id 索引 | Task 1 补列后重跑 007 | 列不存在时 `DO $$` 守卫跳过，no-op |

---

## 5. 无法本地验证的部分（须业主手动验证）

本沙箱无网络到实时后端，以下集成只能由业主在真实环境验证：

- **实时 Supabase**：跑完 007–009 后，确认索引/表创建成功；持久化写入真正落库（启动 orchestrator、跑一次 skill，查 `audit_log`/`session_state`/`chat_history` 有行）。集成测试 `phase1-integration.test.ts` 被配置排除，须在有 Supabase 网络的环境单独跑以确认它们能通过。
- **WhatsApp 通知**：数据新鲜度告警复用招聘模块的 `getWhatsAppClient()` 就绪模式。须在客户端已登录（`client.info` 就绪）时，设 `DATA_FRESHNESS_CHECK=true` 并构造过期数据，确认 owner 收到告警。
- **抓取/调度 pipeline**（res_api scrapers / scheduler）：`scheduler.js` 的 spawn `'error'` 处理须用真实 spawn 失败（如指向不存在的二进制）验证调度器记录错误并继续其他门店；`scrape-items-by-hour.js` 守卫须删掉 `storageState.json` 后验证提示信息。
- **`sync-pnl.js` 行为变更**：无 DB 配置时现在 fail-fast 退出而非静默连库。须确认所有调用方都已传 `--database-url` 或 `DATABASE_URL`（scheduler 注入 / .env 已记录）。
- **LightRAG**：默认空 key 时 `/ingest`、`/query` 仍无鉴权——告警只是让其在日志中可见，未改变开放状态。

---

## 6. 残留风险与后续建议

### 须立即处理（运营动作，非代码）

- **轮换泄露的 Supabase 密码**：`sync-pnl.js` 曾硬编码密码 `m48bfofbNUWufpD6`（项目 `ecsgqcmwtjmcpzqytdqw`），已写入磁盘。源码删除不能使其失效——须在 Supabase 控制台轮换并更新 env/scheduler 配置。该文件当前 git 未跟踪（密码尚未进提交历史），但提交前请再核实/清理历史。已为此生成后台任务 chip（task_e3c897bf）。

### 建议尽快决策

- **整点售罄损失低估**（`stockout-calculator.ts:20` 死三元）：业主确认语义后将 `m===0` 分支改 `h`。会改变整点售罄的损失估算与落库值，故需决策。
- **抓取失败静默 exit 0**：定义「必需查询」白名单（summary/hourly/items），对其失败设非零退出，使 pipeline 在 sync 前中止；避免对可选报表误触发。
- **LightRAG 鉴权**：生产部署应设置 `LIGHTRAG_API_KEY`，并考虑将 `HOST` 默认改为 `127.0.0.1`（行为变更，本次未做）。

### 较低优先

- 死代码清理（待业主授权）：`STREAM_CHAT_API_KEY`、`server.js` 的 `toCsvText`、`useToast` hook——均零引用，安全可删，CLAUDE.md 要求先确认。
- 实时库 schema 与迁移文件已漂移（Task 1/2）：尽快上 staging 对齐，让committed 迁移能独立 stand up 一个可用的供应链库。
- 对既有表加 CHECK/NOT NULL 约束（users.role、employees.status、supply_orders.status）须先 SELECT 确认无违例行、并用 005 后的 schema 限定目标，作为单独受审迁移进行。
