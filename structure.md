# Bakery Ops — 架构设计与重构方案

> 基于 2026-05-16 代码实际状态编写，替代旧版 structure.md。

---

## 一、现状诊断

### 顶层目录

```
hot/
├── whatsapp-agent/      ← 主项目（monolith：WhatsApp Bot + Web UI + 6 个业务模块）
├── production-forecast/ ← 已废弃，代码已迁入 whatsapp-agent，仅 import 路径不同
├── tiktok/              ← 一次性 Python 爬虫脚本，功能已被 marketing 模块替代
├── marketing/           ← 空目录
└── structure.md         ← 本文件
```

### 核心问题

| # | 问题 | 影响 |
|---|------|------|
| 1 | `production-forecast/` 是完整副本，未删除 | 认知负担，可能误改错项目 |
| 2 | `tiktok/venv/` 提交到项目中 | 占用空间，不应版本控制 |
| 3 | Orchestrator 内嵌 260 行 LLM prompt 做路由，与 SkillRouter 三层路由并存 | 职责重叠，维护两套逻辑 |
| 4 | `forecast.repository.ts` 807 行，覆盖 10+ 张表 | 违反单一职责 |
| 5 | `postgres.ts` 用 `db.unsafe()` + 手动占位符替换 | SQL 注入风险 |
| 6 | `bootstrap.ts` 14 个 skill 手动注册，纯重复代码 | 新增 skill 需改 3 处 |
| 7 | 定时任务用 `setInterval` + 手动时区偏移 | 进程重启丢失，时区计算脆弱 |
| 8 | `components/`、`hooks/` 在项目根目录，业务逻辑在 `src/` | import 路径不一致 |
| 9 | `scripts/explore/` 64 个探索脚本 | 不是测试，增加噪音 |
| 10 | 项目名仍为 `whatsapp-agent`，已不能代表全貌 | 新人困惑 |

---

## 二、目标架构

### 重命名：`whatsapp-agent` → `bakery-ops`

单进程 Node.js monolith，两个对外通道 + 7 个业务模块：

```
单进程 Node.js (server.ts)
├── Channel: WhatsApp（对话式 AI Agent）
├── Channel: Web UI（Next.js App Router，预估单仪表盘）
├── Orchestrator（意图路由 + 多轮对话状态）
├── 14 个 Skills（薄 Handler，无业务逻辑）
└── 7 个 Domain Modules（业务逻辑唯一归属）
    ├── forecast       — 预估单计算
    ├── production-plan — 后厨生产计划
    ├── recruitment     — 招聘（搜索/发布/联络/通知）
    ├── supplychain     — 供应链（订货/到货/发送）
    ├── marketing       — KOL 发现与联络
    ├── employee        — 员工事件管理
    └── lark            — 飞书同步
```

### 目标目录结构

```
bakery-ops/
├── server.ts                          # 入口：bootstrap + Next.js HTTP
├── package.json
├── next.config.ts
├── tsconfig.json
├── vitest.config.ts
├── .env.example
│
├── src/
│   ├── bootstrap.ts                   # 组合根：自动注册 Skill、启动 WhatsApp、定时任务
│   ├── instrumentation.ts
│   │
│   ├── modules/
│   │   ├── channel/
│   │   │   └── whatsapp/              # adapter / client / sender / formatter
│   │   │
│   │   ├── orchestrator/              # 统一意图路由 + 多轮状态 + 权限 + 审计
│   │   │   ├── orchestrator.ts        # 消息入口，调用 router 决策
│   │   │   ├── intent-router.ts       # 合并后的单一路由（关键词→LLM，去掉 embedding 层）
│   │   │   ├── state-manager.ts       # 多轮对话状态
│   │   │   ├── permission-service.ts
│   │   │   └── audit-service.ts
│   │   │
│   │   ├── shared/
│   │   │   ├── ai/                    # 统一 AI Provider 接口
│   │   │   │   ├── ai-provider.interface.ts
│   │   │   │   ├── openrouter.provider.ts   # OpenRouter（路由/评分/JD）
│   │   │   │   └── gemini.provider.ts       # Gemini（forecast AI 修正）
│   │   │   ├── db/
│   │   │   │   └── postgres.ts        # 改用 tagged template，消除 unsafe()
│   │   │   ├── types/
│   │   │   ├── logger/
│   │   │   └── errors/
│   │   │
│   │   ├── domain/                    # ===== 7 个业务模块 =====
│   │   │   ├── forecast/              # 预估单
│   │   │   │   ├── forecast-engine.ts  # 纯计算（656 行，可拆为 monthly/daily/product/timeslot）
│   │   │   │   ├── forecast.service.ts # 编排层
│   │   │   │   ├── prompt-engine.ts
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── production-plan/       # 后厨计划
│   │   │   │   ├── plan-generator.ts
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── recruitment/           # 招聘（结构良好，保持不变）
│   │   │   │   ├── recruitment.service.ts
│   │   │   │   ├── connectors/        # JobStreet / AJobThing / Indeed
│   │   │   │   ├── outreach/
│   │   │   │   ├── posting/
│   │   │   │   ├── notifications/
│   │   │   │   ├── jobs/
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── supplychain/           # 供应链
│   │   │   │   ├── order-parser.ts
│   │   │   │   ├── order-consolidator.ts
│   │   │   │   ├── supplier-messenger.ts
│   │   │   │   ├── excel-filler.ts
│   │   │   │   ├── connectors/        # KDocs / WMS
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── marketing/             # KOL
│   │   │   │   ├── kol-discovery.service.ts
│   │   │   │   ├── connectors/        # TikTok / Instagram
│   │   │   │   └── types.ts
│   │   │   │
│   │   │   ├── employee/              # 员工管理
│   │   │   │   ├── employee.service.ts
│   │   │   │   ├── employee-event.parser.ts
│   │   │   │   └── rule-extractor.ts
│   │   │   │
│   │   │   ├── lark/                  # 飞书同步
│   │   │   │   ├── lark-base.service.ts
│   │   │   │   ├── lark-cli.client.ts
│   │   │   │   └── lark-sync.service.ts
│   │   │   │
│   │   │   ├── knowledge/             # LightRAG
│   │   │   │   └── lightrag-client.ts
│   │   │   │
│   │   │   ├── files/                 # 文件服务（PDF 生成等）
│   │   │   │   └── file-service.ts
│   │   │   │
│   │   │   └── resume/                # 简历解析
│   │   │       ├── resume-parser.ts
│   │   │       └── types.ts
│   │   │
│   │   ├── skills/                    # 14 个 WhatsApp Skill（每个一个目录）
│   │   │   ├── index.ts               # NEW: 自动导出所有 skill，供 bootstrap 遍历注册
│   │   │   ├── recruitment/
│   │   │   ├── candidate-outreach/
│   │   │   ├── job-posting/
│   │   │   ├── active-jobs/
│   │   │   ├── employee-management/
│   │   │   ├── knowledge-query/
│   │   │   ├── supply-order/
│   │   │   ├── supply-send/
│   │   │   ├── arrival-check/
│   │   │   ├── kol-discovery/
│   │   │   ├── kol-outreach/
│   │   │   ├── forecast-order/
│   │   │   ├── kitchen-production-plan/
│   │   │   └── resume-upload/
│   │   │
│   │   └── data/                      # 数据层
│   │       ├── repositories/
│   │       │   ├── user.repository.ts
│   │       │   ├── employee.repository.ts
│   │       │   ├── employee-event.repository.ts
│   │       │   ├── screening-rule.repository.ts
│   │       │   ├── supply-order.repository.ts
│   │       │   ├── supplier.repository.ts
│   │       │   ├── arrival-record.repository.ts
│   │       │   ├── kol.repository.ts
│   │       │   ├── kol-collaboration.repository.ts
│   │       │   ├── chat-sample.repository.ts
│   │       │   ├── product.repository.ts          # 从 forecast.repository 拆出
│   │       │   ├── sales-baseline.repository.ts   # 从 forecast.repository 拆出
│   │       │   ├── holiday.repository.ts          # 从 forecast.repository 拆出
│   │       │   ├── prompt.repository.ts           # 从 forecast.repository 拆出
│   │       │   ├── daily-review.repository.ts     # 从 forecast.repository 拆出
│   │       │   └── forecast-calc.repository.ts    # forecast 剩余查询（日营收、时段等）
│   │       └── migrations/
│   │           ├── 001_core_tables.sql
│   │           ├── 002_kol_tables.sql
│   │           ├── 003_supply_chain_tables.sql
│   │           ├── 004_forecast_tables.sql
│   │           ├── 005_schema_separation.sql
│   │           └── 006_lark_sync.sql
│   │
│   ├── app/                           # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   ├── (forecast)/               # 预估单 Web UI
│   │   │   ├── page.tsx
│   │   │   └── actions.ts            # Server Actions 薄层
│   │   └── api/
│   │       ├── ai-correction/route.ts
│   │       ├── ai-product-correction/route.ts
│   │       ├── ai-timeslot/route.ts
│   │       ├── daily-review/route.ts
│   │       ├── empowerment-review/route.ts
│   │       ├── prophet-trend/route.ts
│   │       └── import/
│   │           ├── products/route.ts
│   │           ├── sales/route.ts
│   │           └── strategy/route.ts
│   │
│   └── __tests__/
│       ├── unit/
│       └── integration/
│
├── components/                        # React 组件（迁入 src/ 后删除此层）
│   ├── providers/
│   ├── pages/
│   ├── domain/
│   ├── nav/
│   └── shared/
│
├── hooks/                             # React Hooks（迁入 src/ 后删除此层）
│
├── constants/
│
├── config/                            # 静态 JSON 配置
│   ├── business-rules.json
│   ├── planning-rules.json
│   └── product-aliases.json
│
├── prophet-service/                   # Python sidecar（Prophet 趋势预测）
│   ├── main.py
│   ├── models/trend_predictor.py
│   └── requirements.txt
│
├── scripts/
│   └── explore/                       # 开发探索脚本（不进入 vitest）
│
├── data/                              # Excel 源数据
└── public/
```

---

## 三、依赖方向（严格单向）

```
Channel (WhatsApp / Web UI / API Routes)
        ↓
Orchestrator (仅 WhatsApp 通道使用)
        ↓
Skills (薄 Handler，无业务逻辑)
        ↓
Domain Services (业务逻辑唯一归属)
        ↓
Repositories (SQL 唯一归属)
        ↓
Database Client (postgres.ts)
```

### 模块间通信规则

| 规则 | 说明 |
|------|------|
| Domain 模块之间不互相 import | 如需跨模块数据，通过 Repository 或 Service 方法 |
| 唯一例外：production-plan → forecast | 后厨计划消费预估单输出 |
| Skill Handler 只调 Domain Service | 不直接操作 Repository |
| Web UI Server Actions 只调 Domain Service | 与 Skill 同级 |
| Repository 只做 CRUD | 不含业务逻辑 |
| Shared 只提供基础设施 | AI provider / DB / logger / types / errors |

---

## 四、关键重构项

### 4.1 合并 Orchestrator 与 SkillRouter

**现状：** `orchestrator.ts` 的 `llmDecide()` 是一个 260 行的巨型 prompt，硬编码了 14 条路由规则。`skill-router.ts` 是三层路由（关键词→Embedding→LLM）。两者并存但 orchestrator 实际绕过了 router。

**方案：** 合并为单一 `intent-router.ts`，采用两层策略：

```
Layer 1: 关键词匹配（triggerKeywords 来自 SkillDefinition，零延迟）
Layer 2: LLM JSON 分类（精简 prompt，只列 skill 名称+描述，不硬编码规则）
```

去掉 Embedding 层（每次请求要算 14 个 embedding，延迟高，收益低）。Orchestrator 只负责多轮状态管理和 skill 执行，不再包含路由逻辑。

### 4.2 拆分 forecast.repository.ts（807 行 → 6 个文件）

| 新文件 | 职责 | 预估行数 |
|--------|------|----------|
| `product.repository.ts` | product / product_strategy / product_config 表 CRUD | ~150 |
| `sales-baseline.repository.ts` | product_sales_baseline / daily_sales_record / timeslot_sales_record | ~120 |
| `holiday.repository.ts` | holiday / context_event / empowerment_event | ~100 |
| `prompt.repository.ts` | prompt_segment / prompt_template | ~80 |
| `daily-review.repository.ts` | daily_review / daily_revenue | ~80 |
| `forecast-calc.repository.ts` | 聚合查询（趋势、汇总、缺货记录、出货时间表） | ~150 |

### 4.3 修复 postgres.ts 安全问题

**现状：**
```typescript
// 危险：手动替换占位符 + db.unsafe()
const pgSql = sqlStr.replace(/\?/g, () => `$${++idx}`);
const result = await db.unsafe(pgSql, params);
```

**方案：** 改用 `postgres` 库的 tagged template literal：
```typescript
// 安全：参数化查询，库自动处理转义
const result = await sql`SELECT * FROM product WHERE id = ${id}`;
```

Repository 层直接使用 tagged template，不再经过 `query()` / `execute()` 包装函数。这需要逐步迁移每个 repository。

### 4.4 统一 AI Provider

**现状：** AI 调用分散在 3 处：
- `src/modules/domain/ai/ai-provider.ts` — OpenRouter（orchestrator 用）
- `src/modules/domain/forecast/gemini-client.ts` — Gemini（forecast AI 修正）
- 各 skill handler 内可能直接调用

**方案：** 统一到 `src/modules/shared/ai/`：
```
shared/ai/
├── ai-provider.interface.ts    # 统一接口：chat / embedding
├── openrouter.provider.ts      # OpenRouter 实现
└── gemini.provider.ts          # Gemini 实现（保留重试降级逻辑）
```

Domain service 通过接口调用，不直接依赖具体 provider。

### 4.5 Skill 自动注册

**现状：** `bootstrap.ts` 中 14 个 skill 手动 import + new + register，70 行重复代码。

**方案：** 每个 skill 目录 export 标准结构：
```typescript
// skills/recruitment/index.ts
export const definition = recruitmentSkillDefinition;
export const Handler = RecruitmentSkillHandler;
```

```typescript
// skills/index.ts — 自动收集
export const allSkills = [
  require("./recruitment"),
  require("./candidate-outreach"),
  // ...
];
```

```typescript
// bootstrap.ts — 一行注册
for (const { definition, Handler } of allSkills) {
  definition.handler = new Handler();
  skillRegistry.register(definition);
}
```

### 4.6 定时任务改用 node-cron

**现状：**
```typescript
// 每小时检查是否是周日 3 点（手动 UTC+8 偏移）
setInterval(async () => {
  const myTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  if (day === 0 && hour === 3) { ... }
}, 60 * 60 * 1000);
```

**方案：**
```typescript
import cron from "node-cron";
cron.schedule("0 3 * * 0", () => extractRules(), { timezone: "Asia/Kuala_Lumpur" });
cron.schedule("*/15 * * * *", () => checkAndNotify(), { timezone: "Asia/Kuala_Lumpur" });
```

### 4.7 前端目录迁入 src/

**现状：** `components/`、`hooks/`、`constants/` 在项目根目录。

**方案：** 移到 `src/ui/`：
```
src/ui/
├── components/
│   ├── providers/
│   ├── pages/
│   ├── domain/
│   ├── nav/
│   └── shared/
├── hooks/
└── constants/
```

tsconfig paths 更新：`"@/ui/*": ["src/ui/*"]`

---

## 五、数据库设计

### 单实例 PostgreSQL（Supabase）

所有表在同一个 Supabase PostgreSQL 实例中。当前全部在 `public` schema，未来按模块分 schema。

```
┌─────────────────────────────────────────────────────┐
│              Supabase PostgreSQL                      │
│                                                      │
│  public（共享）                                      │
│  ├── users                                           │
│  ├── business_rule                                   │
│  └── audit_log                                       │
│                                                      │
│  recruitment（招聘）                                  │
│  ├── employees / employee_events                     │
│  ├── screening_rules                                 │
│  └── recruitment_runs                                │
│                                                      │
│  supplychain（供应链）                                │
│  ├── supply_orders / arrival_records                 │
│  └── suppliers                                       │
│                                                      │
│  marketing（市场）                                    │
│  ├── kols / kol_collaborations                       │
│  └── marketing_chat_samples                          │
│                                                      │
│  forecast（预估）                                     │
│  ├── product / product_strategy / product_config     │
│  ├── product_sales_baseline / product_alias          │
│  ├── daily_sales_record / timeslot_sales_record      │
│  ├── fixed_shipment_schedule / out_of_stock_record   │
│  ├── daily_revenue / daily_review                    │
│  ├── context_event / holiday / empowerment_event     │
│  └── prompt_segment / prompt_template                │
│                                                      │
│  kitchen（后厨，Phase 2）                             │
│  ├── production_plans / plan_items                   │
│  └── plan_templates                                  │
└─────────────────────────────────────────────────────┘
```

### Schema 迁移策略

当前所有表在 `public` schema，用命名前缀区分。Schema 分离（`ALTER TABLE SET SCHEMA`）作为最后一步执行，前提是所有功能验证通过。Repository 层通过常量定义 schema 前缀，切换时只改一处。

---

## 六、分阶段执行计划

### Phase 1：清理死代码（1 天）

| 步骤 | 操作 | 验证 |
|------|------|------|
| 1.1 | 删除 `production-forecast/` 目录 | `npm run build` 在 whatsapp-agent 中通过 |
| 1.2 | 删除 `marketing/` 空目录 | — |
| 1.3 | 将 `tiktok/kl_influencers.py` 移到 `whatsapp-agent/scripts/explore/` | — |
| 1.4 | 删除 `tiktok/` 目录（含 venv） | — |
| 1.5 | 清理 `scripts/explore/`：删除明确无用的探索脚本，保留有参考价值的 | 文件数从 64 降到 <15 |
| 1.6 | 添加 `.gitignore` 规则：`venv/`、`.DS_Store`、`*.json`（数据文件） | — |

### Phase 2：安全与基础设施（3 天）

| 步骤 | 操作 | 验证 |
|------|------|------|
| 2.1 | 重写 `postgres.ts`：移除 `unsafe()` + `?` 替换，改用 tagged template | 所有 repository 查询正常 |
| 2.2 | 逐个迁移 repository 到 tagged template 写法 | `npx vitest run` 通过 |
| 2.3 | 统一 AI Provider 到 `shared/ai/` | orchestrator + forecast 调用正常 |
| 2.4 | 替换 `setInterval` 为 `node-cron` | 定时任务按时触发 |

### Phase 3：架构整理（3 天）

| 步骤 | 操作 | 验证 |
|------|------|------|
| 3.1 | 合并 Orchestrator + SkillRouter 为两层路由 | WhatsApp 消息路由正确 |
| 3.2 | 拆分 `forecast.repository.ts` 为 6 个文件 | 所有 forecast 功能正常 |
| 3.3 | 实现 skill 自动注册（`skills/index.ts`） | bootstrap 正常启动 |
| 3.4 | 移动 `components/`、`hooks/`、`constants/` 到 `src/ui/` | Web UI 正常渲染 |
| 3.5 | 更新 tsconfig paths | `npm run build` 通过 |

### Phase 4：重命名与收尾（1 天）

| 步骤 | 操作 | 验证 |
|------|------|------|
| 4.1 | 重命名项目目录 `whatsapp-agent` → `bakery-ops` | — |
| 4.2 | 更新 `package.json` name 字段 | — |
| 4.3 | 全量回归测试 | `npm run build` + `npx vitest run` + 手动测试 WhatsApp + Web UI |

### Phase 5：Schema 分离（独立运维任务）

| 步骤 | 操作 | 验证 |
|------|------|------|
| 5.1 | `pg_dump` 备份 | — |
| 5.2 | 执行 `005_schema_separation.sql` | 表迁移成功 |
| 5.3 | 更新 Repository 中的表名为 schema 限定 | 查询正常 |
| 5.4 | 全量回归 | 所有功能正常 |

---

## 七、测试策略

```
src/__tests__/
├── unit/                          # 纯函数，无 DB，无网络
│   ├── forecast-engine.test.ts
│   ├── order-parser.test.ts
│   ├── plan-generator.test.ts
│   └── intent-router.test.ts     # 关键词匹配 + mock LLM
│
├── integration/                   # 需要 DB
│   ├── forecast-flow.test.ts
│   ├── recruitment-flow.test.ts
│   ├── supply-flow.test.ts
│   └── repository.test.ts
│
└── e2e/                           # 需要完整服务
    └── whatsapp-smoke.test.ts
```

Vitest 配置：
```typescript
export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["src/__tests__/e2e/**", "scripts/**"],
  },
});
```

---

## 八、关键架构决策

| 决策 | 理由 |
|------|------|
| 单进程 monolith | 当前规模（14 skill、7 模块）不需要微服务，部署简单 |
| 去掉 Embedding 路由层 | 每次请求算 14 个 embedding 延迟 200-500ms，关键词+LLM 已够用 |
| 保留两个 AI Provider | OpenRouter 便宜适合路由/评分，Gemini 适合长文本 forecast 修正 |
| Prophet 保持 Python sidecar | 依赖 Prophet 库，不适合移入 Node.js |
| Repository 用 tagged template | 消除 SQL 注入风险，代码更简洁 |
| 前端移入 src/ui/ | 统一 import 路径，消除根目录与 src/ 的割裂 |
| 不引入事件总线 | 当前模块间通信简单，直接函数调用足够 |
| Schema 分离放最后 | 先确保功能正确，再做物理隔离 |

---

## 九、风险与注意事项

1. **postgres.ts 迁移是最大工作量**：所有 repository 都依赖 `query()` / `execute()`，需要逐文件改写
2. **WhatsApp 会话不能中断**：重构期间保持 `whatsapp-session/` 目录不变
3. **Orchestrator 合并需要充分测试**：路由逻辑变更直接影响所有 WhatsApp 交互
4. **环境变量**：合并后只有一个 `.env`，注意 key 不冲突
5. **数据库迁移需要备份**：Schema 分离前务必 `pg_dump`
6. **`forecast-engine.ts`（656 行）**：当前可接受，但如果继续增长建议拆为 `monthly-calc.ts` / `daily-calc.ts` / `product-calc.ts` / `timeslot-calc.ts`

---

## 十、当前已完成状态（截至 2026-05-16）

### 已完成的迁移

- 预估引擎、Prompt 引擎、Gemini 客户端迁入 `src/modules/domain/forecast/`
- Postgres 客户端迁入 `src/modules/shared/db/`
- Forecast Repository 创建（从 production-forecast 的 actions.ts 提取）
- Web UI 组件/hooks 迁入项目根目录
- API Routes 迁入 `src/app/api/`
- Server Actions 薄层 `src/app/(forecast)/actions.ts`
- 后厨生产计划模块 `production-plan/`
- 数据导入 API（FormData 上传）
- BullMQ 死依赖已移除
- 测试目录整理（探索脚本移至 `scripts/explore/`）
- Migrations 001-006

### 待执行

- [ ] 删除 `production-forecast/` 目录
- [ ] 修复 `postgres.ts` 安全问题
- [ ] 拆分 `forecast.repository.ts`
- [ ] 合并 Orchestrator/SkillRouter
- [ ] 统一 AI Provider
- [ ] Skill 自动注册
- [ ] 定时任务改 node-cron
- [ ] 前端目录迁入 `src/ui/`
- [ ] 项目重命名
- [ ] Schema 分离

---

## 十一、重构后全功能验证清单

> 每个 Phase 完成后必须通过对应的验证项。Phase 4 结束后执行全量回归。

### 11.1 构建与类型检查（每个 Phase 后必跑）

```bash
# TypeScript 编译，零错误
npx tsc --noEmit

# Next.js 生产构建
npm run build

# 单元测试全通过
npx vitest run
```

**通过标准：** 零 error，零 test failure。warning 可接受但应逐步清理。

---

### 11.2 预估单模块（forecast）

#### 单元测试

```bash
npx vitest run src/__tests__/unit/forecast-engine.test.ts
```

覆盖点：
- `calculateMonthlyTargets` — 输入年目标 + 月系数，输出 12 个月目标金额
- `calculateDailyTargets` — 输入月目标 + 日期范围，输出每日权重分配
- `calculateProductSuggestions` — 输入日目标 + 基线 + 策略，输出单品建议数量
- `calculateTimeSlotSuggestions` — 输入单品建议 + 时段比例，输出分时段出货量
- `calculateSalesBaselines` — 输入历史销售数据，输出按日类型的均值基线
- 边界：空数据、单日、跨月、节假日系数覆盖

#### 集成测试

```bash
npx vitest run src/__tests__/integration/forecast-flow.test.ts
```

覆盖点：
- `forecast.service.generateFullForecast(date)` — 完整链路：DB 读取 → 引擎计算 → 返回结构化结果
- `forecast.service.getProductForecast(date)` — WhatsApp skill 调用入口
- Repository CRUD：product / strategy / baseline / holiday / prompt 的增删改查

#### Web UI 手动验证

| 页面 | 验证操作 | 预期结果 |
|------|----------|----------|
| 总览页 | 选择日期，查看预估数据 | 显示日目标、单品建议、时段分配 |
| 生产页 | 点击"生成预估单" | 表格正确渲染，数据与总览页一致 |
| 时段页 | 切换日期 | 时段表格更新，合计数与单品建议一致 |
| 趋势页 | 选择产品 | 折线图渲染，数据点与 DB 一致 |
| 日历页 | 点击日期 | 显示该日预估摘要 |
| 复盘页 | 查看昨日复盘 | 显示 AI 生成的 summary / highlights / painPoints |
| 赋能页 | 添加赋能事件 | 事件保存成功，月目标重新计算 |
| 设置页 | 上传 Excel 文件 | 导入成功，产品/策略/基线数据更新 |

#### API Routes 验证

```bash
# AI 修正（Gemini 调用）
curl -X POST http://localhost:3000/api/ai-correction \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-17","products":[...]}'
# 预期：返回 AI 修正后的数量建议

# Prophet 趋势
curl http://localhost:3000/api/prophet-trend?product=牛角包&days=30
# 预期：返回趋势预测数组

# 日复盘
curl -X POST http://localhost:3000/api/daily-review \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-16"}'
# 预期：返回 AI 生成的复盘内容

# 数据导入
curl -X POST http://localhost:3000/api/import/products \
  -F "file=@data/产品价格信息与倍数.xlsx"
# 预期：返回 { success: true, imported: N }
```

---

### 11.3 后厨生产计划模块（production-plan）

#### 单元测试

```bash
npx vitest run src/__tests__/unit/plan-generator.test.ts
```

覆盖点：
- 时间倒推计算（出货时间 → 开始制作时间）
- 批次分配（大量产品拆分为多批次）
- 工位分配（冷品→cold-prep，热品→oven-1/oven-2 轮换）
- 边界：零数量产品、超大批次、全冷品/全热品

#### WhatsApp 验证

```
用户发送: "明天后厨计划"
预期回复: 分时段生产计划（含工位、批次、开始时间）
```

---

### 11.4 招聘模块（recruitment）

#### 集成测试

```bash
npx vitest run src/__tests__/integration/recruitment-flow.test.ts
```

覆盖点：
- JD 解析（自然语言 → 结构化 JobDescription）
- 候选人搜索（mock connector 返回候选人列表）
- 候选人评分（scorer 按 JD 匹配度排序）
- 去重（同一候选人来自多平台）
- PDF 简历生成

#### WhatsApp 验证

| 用户消息 | 预期行为 |
|----------|----------|
| "帮我招一个前场店员，要会中文" | 触发 recruitment_sourcing，返回候选人列表 |
| "联系前三个" | 触发 candidate_outreach，发送消息给前 3 名 |
| "发布一个收银员岗位" | 触发 job_posting，生成 JD 并发布到 JobStreet/AJobThing |
| "看看在招岗位" | 触发 active_jobs，返回两个平台的岗位列表 |

---

### 11.5 供应链模块（supplychain）

#### 单元测试

```bash
npx vitest run src/__tests__/unit/order-parser.test.ts
```

覆盖点：
- 标准格式解析："面粉:50kg, 糖:20kg"
- 中文冒号："面粉：50kg"
- 混合单位："鸡蛋：200个，牛奶：10升"
- 无效输入：空字符串、无数量、无单位

#### WhatsApp 验证

| 用户消息 | 预期行为 |
|----------|----------|
| "订货: 面粉:50kg, 糖:20kg" | 触发 supply_order，解析并保存订单 |
| "到货: 面粉:48kg, 糖:20kg" | 触发 arrival_check，记录到货并对比差异 |
| "发给供应商" | 触发 supply_send，汇总订单并通过 WhatsApp 发送 |
| "汇总今天的订货" | 触发 supply_order，返回当日汇总 |

---

### 11.6 市场/KOL 模块（marketing）

#### WhatsApp 验证

| 用户消息 | 预期行为 |
|----------|----------|
| "帮我找KL美食博主，TikTok，粉丝5万以上" | 触发 kol_discovery，返回 KOL 列表 |
| "联系前3个KOL" | 触发 kol_outreach，发送合作邀请 DM |

#### 验证要点
- TikTok connector 能正常登录并搜索（依赖 playwright，需要有效 cookie）
- Instagram connector 能正常搜索（同上）
- KOL 数据正确写入 `kols` 表

---

### 11.7 员工管理模块（employee）

#### WhatsApp 验证

| 用户消息 | 预期行为 |
|----------|----------|
| "Mikhail 今天面试表现不错，沟通能力强" | 触发 employee_management，记录面试事件 |
| "Ahmad 下周一入职" | 记录入职事件 |
| "什么样的人容易留下来" | 触发 knowledge_query，返回分析结果 |

#### 定时任务验证
- 每周日 3:00 AM (MYT) 自动触发 `extractRules()`
- 验证方式：检查 `screening_rules` 表是否有新规则生成

---

### 11.8 飞书同步模块（lark）

#### 验证要点
- `lark-sync.service.ts` 能正确读取飞书多维表格数据
- 数据写入对应的 PostgreSQL 表
- 验证命令：手动触发同步，检查 DB 数据更新

---

### 11.9 Orchestrator 路由验证

> 重构 Orchestrator 后最关键的验证项。路由错误 = 所有 WhatsApp 功能失效。

#### 单元测试

```bash
npx vitest run src/__tests__/unit/intent-router.test.ts
```

覆盖点：

| 输入消息 | 预期路由 | 层级 |
|----------|----------|------|
| "招人" | recruitment_sourcing | Layer 1 (关键词) |
| "订货: 面粉:50kg" | supply_order | Layer 1 |
| "帮我找KOL" | kol_discovery | Layer 1 |
| "明天预估单" | forecast_order | Layer 1 |
| "帮我找一个会做面包的师傅，最好在吉隆坡" | recruitment_sourcing | Layer 2 (LLM) |
| "跟 Mikhail 联系一下" | candidate_outreach | Layer 2 (LLM) |
| "你好" | chat（不触发 skill） | — |
| "今天天气怎么样" | chat（不触发 skill） | — |

#### 多轮对话验证

```
用户: "帮我招人"
助手: "好的，请描述一下岗位要求..."（进入 waiting_for_info 状态）
用户: "前场店员，要会中文，吉隆坡"
助手: 触发 recruitment_sourcing，返回结果
```

```
用户: "发布一个岗位"
助手: 生成 JD 预览，进入 waiting_for_confirm 状态
用户: "确认" / "修改标题为xxx"
助手: 执行发布 / 修改后重新预览
```

---

### 11.10 定时任务验证

| 任务 | 触发条件 | 验证方式 |
|------|----------|----------|
| 规则提炼 | 每周日 3:00 AM MYT | 检查日志 "Weekly rule extraction triggered" |
| 招聘通知 | 每 15 分钟 | 检查日志 "Notification check"；有新投递时 WhatsApp 收到通知 |
| 会话清理 | 每 60 秒 | 过期会话从 StateManager 中移除 |

---

### 11.11 全量回归脚本

在 Phase 4 结束后执行：

```bash
#!/bin/bash
set -e

echo "=== 1. TypeScript 类型检查 ==="
npx tsc --noEmit

echo "=== 2. 生产构建 ==="
npm run build

echo "=== 3. 单元测试 ==="
npx vitest run src/__tests__/unit/

echo "=== 4. 集成测试（需要 DB 连接）==="
npx vitest run src/__tests__/integration/

echo "=== 5. 启动服务（后台）==="
npm run dev &
DEV_PID=$!
sleep 10

echo "=== 6. API 健康检查 ==="
curl -sf http://localhost:3000 > /dev/null || { echo "FAIL: 首页不可访问"; kill $DEV_PID; exit 1; }
curl -sf http://localhost:3000/api/prophet-trend?product=test > /dev/null || echo "WARN: prophet-trend 需要 Python sidecar"

echo "=== 7. 清理 ==="
kill $DEV_PID

echo "=== 全部通过 ==="
```

---

### 11.12 手动验收清单（最终上线前）

- [ ] WhatsApp 扫码连接成功，QR 码正常显示
- [ ] 发送"你好"收到自然语言回复（非报错）
- [ ] 发送"帮我招一个店员"触发招聘流程
- [ ] 发送"订货: 面粉:50kg"触发供应链流程
- [ ] 发送"明天预估单"返回预估数据
- [ ] 发送"明天后厨计划"返回生产计划
- [ ] 发送"帮我找KOL"触发 KOL 搜索
- [ ] Web UI http://localhost:3000 正常加载
- [ ] Web UI 选择日期后预估数据正确渲染
- [ ] Web UI "AI 修正"按钮调用 Gemini 成功
- [ ] Web UI 设置页上传 Excel 导入成功
- [ ] Prophet sidecar `python prophet-service/main.py` 启动正常
- [ ] 趋势页调用 Prophet API 返回预测数据
- [ ] 15 分钟后日志出现 "Notification check" 记录
- [ ] 进程 Ctrl+C 后干净退出，无僵尸进程
