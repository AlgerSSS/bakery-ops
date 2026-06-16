# 单库整合报告（SINGLE-DATABASE CONSOLIDATION REPORT）

分支：`refactor/architecture-review` · 日期：2026-06-16

本次将应用从「两个数据库 + 一个已废弃的 Supabase 项目」收敛为**单一目标库**。所有仓库（repository）现在统一经由 `DATABASE_URL` 通过 `src/modules/shared/db/postgres.ts` 直连 Postgres。除新增的 schema（迁移 010）外，所有改动以「行为保持」为前提：仓库的公开方法签名、返回对象形状（camelCase 字段、类型、null 处理）均字节级保留。

---

## 1. 改了什么、为什么

- **两库 → 一库。** 历史上数据分散在多个目标，且存在一个独立的、已不可达的 Supabase「sup」项目。本次将运行时真正需要的全部表收敛到单一目标库（即 forecast 库，`public` schema）。
- **废弃 sup 项目。** sup 项目已不可达，不再作为任何运行路径的依赖。
- **统一连接。** 全部仓库改为经 `DATABASE_URL` 走 `postgres.ts` 直连；不再有第二套连接或 Supabase JS 客户端参与运行时。
- **schema 分离迁移 005 未在线上应用**，故本次整合在 `public` schema 内完成，与线上现状一致。

---

## 2. 新增迁移 010 与新建表

文件：`/Users/weiliangshao/Desktop/hot/bakery-ops/src/modules/data/migrations/010_consolidate_missing_tables.sql`

特性：完全**增量、幂等**（`CREATE TABLE/INDEX IF NOT EXISTS`），位于 `public` schema，新增 `CREATE EXTENSION pgcrypto`（用于 `gen_random_uuid()`）。DDL 由「各仓库运行时契约」与历史迁移 001/002/003/006 对账推导；**冲突时以仓库（REPO）为准**。静态校验通过：括号配平（61/61）、9 个 `CREATE TABLE`、21 个索引、共 31 条语句。

迁移执行结果：`node /tmp/dbrun.mjs --file 010_consolidate_missing_tables.sql` 一次跑通，仅输出 `NOTICE: extension "pgcrypto" already exists, skipping` 后 `OK`，无语句失败。

新建 9 张表（执行前均不存在，全部成功创建）：

| 表 | 列数 | 说明 |
| --- | --- | --- |
| `employees` | 25 | UUID PK；`metadata` JSONB；`skills`/`languages` TEXT[]。按迁移头部说明刻意丢弃 `resume_embedding`（无仓库引用，避免 pgvector 依赖）。 |
| `employee_events` | 8 | UUID PK；`employee_id` UUID FK → employees。 |
| `kols` | 18 | UUID PK；`niche` TEXT[]（GIN 索引）；`contact_info`/`metadata` JSONB。 |
| `kol_collaborations` | 19 | UUID PK；`kol_id` UUID FK → kols；含全部 `dm_*`/`deal_*`/`negotiation_notes`/`deliverables` 域字段（仓库 `select '*'` 并 spread 任意额外列）。 |
| `screening_rules` | 12 | UUID PK；`confidence` REAL；`job_titles`/`departments` TEXT[]。刻意丢弃 `rule_embedding`。 |
| `suppliers` | 8 | UUID PK；`categories` TEXT[]（GIN 索引）。 |
| `supply_orders` | 10 | UUID PK；采用**仓库 schema**（`order_date`/`store_id` TEXT、`items` JSONB、`created_by`），**而非**已废弃的 003 SERIAL+`supplier_name` schema。 |
| `arrival_records` | 8 | UUID PK；`order_id` TEXT（自由字符串，无 FK）；`synced_to_inventory` BOOLEAN。 |
| `marketing_chat_samples` | 8 | UUID PK；`kol_id` UUID 可空（无 FK）；`message_type` CHECK 约束。仅作数据层处理。 |

关键对账决策：

1. 所有仓库均以 `.insert().select().single()` 写入且不提供 `id`/`created_at`/`updated_at` 再读回，故 9 表统一用 `UUID PRIMARY KEY DEFAULT gen_random_uuid()` + `NOW()` 时间戳默认值；仓库把 `id` 当字符串消费，与 UUID 一致。
2. `supply_orders`/`arrival_records` 采用仓库 schema（即已被迁移 007 的守卫索引预判的「供应链列集缺陷」修复方向），不沿用过时的 003 schema。
3. FK 仅在「写入时父行必然存在」处添加（`employee_events.employee_id`、`kol_collaborations.kol_id`）；`arrival_records.order_id`、`supply_orders`、`marketing_chat_samples.kol_id` 不加 FK，避免破坏插入。
4. 数组字段用 TEXT[]，`.contains()` 处加 GIN 索引（`kols.niche`、`suppliers.categories`）；对象字段用 JSONB。
5. 与迁移 007 重叠的索引名**逐字复用**，使两迁移顺序无关、互为 no-op。

---

## 3. 仓库转换（Supabase → postgres.ts）

13 个仓库由 Supabase 客户端改为 `postgres.ts` 的直连辅助函数（`query`/`execute`，`"?"` 占位符），移除 `import { supabase }`。每个仓库的公开契约（方法签名、返回对象形状、错误分支日志与返回值）均保持不变；无方法用到事务的仓库不引入 `withTransaction`。

| 仓库文件 | 表 | smoke 测试 | 返回形状保持 | 残留 smoke 行 |
| --- | --- | --- | --- | --- |
| `repositories/user.repository.ts` | users | 通过 | 是 | 无 |
| `repositories/employee.repository.ts` | employees | 通过 | 是 | 无 |
| `repositories/employee-event.repository.ts` | employee_events | 通过 | 是 | 无 |
| `repositories/kol.repository.ts` | kols | 通过 | 是 | 无 |
| `repositories/kol-collaboration.repository.ts` | kol_collaborations | 通过 | 是 | 无 |
| `repositories/screening-rule.repository.ts` | screening_rules | 通过 | 是 | 无 |
| `repositories/supplier.repository.ts` | suppliers | 通过 | 是 | 无 |
| `repositories/supply-order.repository.ts` | supply_orders | 通过 | 是 | 无 |
| `repositories/arrival-record.repository.ts` | arrival_records | 通过 | 是 | 无 |
| `repositories/chat-sample.repository.ts` | marketing_chat_samples | 通过 | 是 | 无 |
| `repositories/session-state.repository.ts` | session_state | 通过 | 是 | 无 |
| `repositories/chat-history.repository.ts` | chat_history | 通过 | 是 | 无 |
| `repositories/audit-log.repository.ts` | audit_log | 通过 | 是 | 无 |

转换中两处「契约保持」适配（因 postgres.js `.unsafe()` 不运行类型解析器，不同于 Supabase 客户端）：(1) timestamptz 列在 SELECT/RETURNING 中以 `::text` 转出，使时间字段以字符串返回，与原行为一致；(2) `updateStatus` 等动态 SET 仅白名单列，避免键注入。`upsertFromCandidate` 既有路径仍返回原来的 `{id} as EmployeeRow` 形状。

smoke 验证一致采用「写入 SMOKE_ 行 → 读回 → 业务路径校验 → 清理删除」流程；并经真实 `postgres.ts` 走应用路径，确认 TEXT[]、JSONB、lid 等字段往返正确。`employees` 列结构与仓库期望一致，**无需任何 ALTER**。

---

## 4. Supabase 客户端退役 + 配置/.env 变更

- **唯一一处非仓库的 Supabase 用法已转换：** `src/modules/domain/lark/lark-sync.service.ts` 移除 `import { supabase }`，`saveLarkRecordId` 改为调用既有的 postgres 后端方法 `employeeRepository.updateLarkRecordId(...)`。行为完全一致（同样的 `getById` 守卫、`{ ...existing.metadata, lark_record_id }` 合并、`updated_at = now()` 写入），已对真实 DB 验证。无文件/存储模块依赖 Supabase Storage（`.storage`/`.upload`/`getPublicUrl` 命中为 0）。
- **客户端模块已删除：** `git rm src/modules/data/supabase.ts`；无运行时或测试代码再 import 它（已确认磁盘上 `src` 下不存在任何 `supabase.ts`）。
- **`.env.example` 更新：** `DATABASE_URL` 标注为应用使用的**唯一**连接（经 `postgres.ts`）；`SUPABASE_URL`/`SUPABASE_SERVICE_KEY` 注明「NO LONGER USED」并注释保留，仅供参考。

---

## 5. 验证状态（最终，全绿，未再改动任何文件）

| 检查项 | 结论 |
| --- | --- |
| `npx tsc --noEmit` | exit 0，零错误（与基线一致） |
| `npx vitest run` | 5 文件、80 测试全部通过（与基线 80 完全一致，无回归） |
| `npm run build`（Next.js Turbopack） | 编译成功，13 个页面全部生成；唯一警告为 recruitment ajobthing-login 连接链引发的非致命 NFT tracing 提示 |
| `src` 下运行时 Supabase import | 0（`@supabase/supabase-js`、`../supabase`、`getSupabase` 等均无命中） |
| 线上 DB sanity | `public` 共 37 张表，9 张新表全部就位；9 张转换表均为 UUID `id` PK，`SMOKE_%` 行全 0，无需 DELETE |

残留的 "supabase" 字符串均为非运行时项：迁移 SQL 注释（001/004/007/008/009/010）、`SCHEMA-OPTIMIZATION.md` 文档、`permission-service.ts` 第 54 行一条中文注释——均不 import 或调用 Supabase JS 客户端。

---

## 6. 重要提示：sup 项目数据未迁移

被废弃的 sup 项目**不可达**，因此其历史数据**未做迁移**。迁移 010 仅创建表结构（DDL），新建的 9 张模块表上线时**为空**。这些模块（招聘 employees/employee_events/screening_rules、KOL kols/kol_collaborations/marketing_chat_samples、供应链 suppliers/supply_orders/arrival_records）将从零数据开始累积。若 sup 项目后续恢复可达且确有需要保留的历史数据，需另行规划一次性数据回填。

---

## 7. 延后的合并建议（仅建议，未执行）

已巡检全部线上现存表。结论：9 张新表彼此之间、以及与现存表之间，**均无逐行重复**（9 张新表上线前并不存在）；现存表间也未发现真正的行级重复。最接近的仅为 schema 层面的重叠（如 003 过时的供应链 schema 与仓库 schema），已在迁移 010 中以「仓库为准」一次性处理，无需运行时合并动作。本项为 recommend-only，未对任何数据执行合并。

---

## 8. 残留风险 / 业主仍需线上确认

1. **模块表为空（见 §6）。** 招聘、KOL、供应链相关功能在上线初期没有历史数据，依赖历史数据的报表/筛选会暂时为空。
2. **timestamptz 以字符串返回。** 转换后时间字段经 `::text` 转出，与原 Supabase 行为一致；若有下游消费方此前依赖 Date 对象，请抽样确认。
3. **无 FK 的字符串外键。** `arrival_records.order_id`、`marketing_chat_samples.kol_id`、`supply_orders` 不设 FK，引用完整性由应用层保证；建议线上抽查是否存在悬挂引用。
4. **build 的 NFT tracing 警告**（recruitment ajobthing-login 连接链）为追踪级提示而非编译错误，但建议在生产构建中确认动态 require 的连接器可被正确打包。
5. **schema 分离迁移 005 未应用。** 当前整合假定运行在 `public` schema；若未来要落地 005 的 schema 分离，需重新评估 010 的表位置与索引命名。
6. **`SUPABASE_*` 环境变量仍被注释保留。** 确认无任何外部工具/脚本仍读取它们后，可彻底删除。
