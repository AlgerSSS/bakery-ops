# Hot Crush Bakery Ops — 架构评审与修改意见

> 评审日期：2026-05-22
> 评审范围：bakery-ops（Next.js + TypeScript）、res_api（Node.js 数据采集）、services/lightrag（Python 知识图谱）

---

## 一、当前架构概览

### 整体模式：模块化单体 + 独立数据采集 + Python 微服务

```
┌─────────────────────────────────────────────────────────────┐
│  bakery-ops (Next.js Monolith)                              │
│  ┌──────────┐  ┌────────────┐  ┌────────┐  ┌───────────┐  │
│  │ Channel  │→ │Orchestrator│→ │ Skills │→ │  Domain   │  │
│  │(WhatsApp)│  │(Intent/Perm│  │(15个)  │  │(Forecast/ │  │
│  │          │  │ /Audit/State)│ │        │  │ Recruit/  │  │
│  └──────────┘  └────────────┘  └────────┘  │ Supply/   │  │
│                                             │ Marketing)│  │
│  ┌──────────┐  ┌────────────┐              └─────┬─────┘  │
│  │   UI     │→ │ API Routes │                    │        │
│  │(React SPA)│ │(Server Act)│                    ▼        │
│  └──────────┘  └────────────┘              ┌───────────┐  │
│                                             │   Data    │  │
│                                             │(Supabase) │  │
│                                             └───────────┘  │
└─────────────────────────────────────────────────────────────┘

┌──────────────┐         ┌──────────────────┐
│   res_api    │────────→│  Supabase (PG)   │
│ (Playwright  │         │  共享数据库       │
│  数据采集)   │         └──────────────────┘
└──────────────┘                  ↑
                          ┌───────┴────────┐
                          │ LightRAG (Py)  │
                          │ 知识图谱服务    │
                          └────────────────┘
```

### 架构优势（保持不变）

1. **清晰的单向依赖流**：channel → orchestrator → skills → domain → data → shared
2. **技能系统高度可扩展**：新增业务能力只需一个 definition 文件 + handler
3. **AI 路由渐进式降级**：关键词 → Embedding → LLM 三层，兼顾速度和准确性
4. **渠道解耦**：WhatsApp 只是 adapter，未来可扩展 Telegram/Web
5. **前后端类型共享**：`types.ts` 单一来源，全栈类型安全
6. **配置外置**：业务规则 JSON 化，非开发人员可调整

---

## 二、高优先级修改意见

### 2.1 安全隐患（必须立即修复）

| 问题 | 位置 | 修改建议 |
|------|------|----------|
| 数据库连接字符串硬编码 | `res_api/sync-to-db.js:9` | 迁移到 `.env` 文件，通过 `process.env` 读取 |
| 密码作为命令行参数传递 | `res_api/scheduler.js:36` | 改用环境变量或配置文件，避免 `ps` 泄露 |
| storageState 明文存储 | `res_api/storageState.json` | 加入 `.gitignore`，运行时生成，不入库 |
| API 无速率限制 | `res_api/server.js` | 添加基于 IP 的简单限流（如 express-rate-limit 或手写 token bucket） |
| CORS 完全开放 | `res_api/server.js` | 限制为已知前端域名 |
| LightRAG 无认证 | `services/lightrag/server.py` | 添加 Bearer Token 验证中间件 |
| session cookies 入库 | `*-session/cookies.json` | 确保在 `.gitignore` 中，不提交到版本控制 |

### 2.2 合并重复的路由器

**问题**：`skill-router.ts`（174行）和 `intent-router.ts`（127行）功能高度重叠，但 Orchestrator 只使用 `IntentRouter`，`SkillRouter` 成为死代码。

**建议**：
- 删除 `skill-router.ts`，或将其三层路由（含 Embedding 层）的优势合并到 `IntentRouter`
- 如果 Embedding 层确实有价值，将其作为 `IntentRouter` 的可选中间层

### 2.3 对话历史持久化

**问题**：`Orchestrator` 使用内存 `Map<string, ChatHistoryEntry[]>` 存储对话历史，进程重启全部丢失。`AuditService` 同样纯内存。

**建议**：
- 对话历史写入 Supabase 表（如 `chat_history`），按 `conversation_id` 索引
- 审计日志同步写入 `audit_log` 表
- 保留内存缓存作为热数据层，设置 TTL 后落盘

### 2.4 AiProvider 接口升级

**问题**：当前 `chatCompletion(prompt: string)` 只接受单个字符串，不支持 messages 数组。`IntentRouter` 被迫将对话历史拼接到 system prompt 中，浪费 token 且不符合 Chat API 最佳实践。

**建议**：
```typescript
// 当前
chatCompletion(prompt: string): Promise<string>

// 建议改为
chatCompletion(messages: ChatMessage[], options?: { model?: string }): Promise<string>

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
```

---

## 三、中优先级修改意见

### 3.1 Orchestrator 职责拆分

**问题**：`orchestrator.ts` 同时处理用户识别、KOL 特殊逻辑、对话历史管理、多步流程状态、技能执行、格式化输出，违反单一职责原则。

**建议拆分为**：
- `Orchestrator`：仅负责消息流转编排（接收 → 路由 → 执行 → 返回）
- `UserResolver`：用户识别 + KOL 判断逻辑（移入 `PermissionService`）
- `ConversationManager`：对话历史管理（独立服务）
- `ResponseFormatter`：输出格式化

### 3.2 前端路由重构

**问题**：`app-shell.tsx` 使用 `useState<PageId>` 做客户端 SPA 导航，放弃了 Next.js App Router 的代码分割优势。所有页面组件在首次加载时全部打包。

**建议**：
- 将每个页面迁移为独立的 Next.js 路由（`/forecast`、`/review`、`/production` 等）
- 使用 `next/dynamic` 或 App Router 的 `loading.tsx` 实现按需加载
- 保留 `AppShell` 作为 layout 组件，但路由交给框架管理

### 3.3 Server Actions 拆分

**问题**：`(forecast)/actions.ts` re-export 了约 50 个函数，所有 server actions 共享同一个模块边界，无法按页面做 tree-shaking。

**建议**：
- 按业务域拆分：`forecast-actions.ts`、`review-actions.ts`、`import-actions.ts`
- 每个页面只 import 自己需要的 actions 文件

### 3.4 Reducer 拆分

**问题**：`forecast-provider.tsx` 的 `forecastReducer` 包含 30+ 个 action type，随功能增长难以维护。

**建议**：
- 按关注点拆分为多个 sub-reducer：`coreDataReducer`、`aiStateReducer`、`importReducer`、`dashboardReducer`
- 使用 `combineReducers` 模式组合（或简单的 switch 委托）

### 3.5 API Route 解耦

**问题**：`/api/daily-review/route.ts` 单个函数超过 200 行，数据查询、上下文构建、prompt 组装、AI 调用、结果解析全部耦合。

**建议**：
```
route.ts（薄层，仅做 HTTP 协议转换）
  → daily-review.service.ts（业务编排）
    → context-builder.ts（数据查询 + 上下文组装）
    → prompt-engine.ts（已有，复用）
    → ai-provider（已有，复用）
```

### 3.6 数据导入事务保护

**问题**：`import/sales/route.ts` 使用 `DELETE FROM daily_sales_record` 全表删除后再 INSERT，无事务保护，中途失败会导致数据丢失。

**建议**：
- 包裹在数据库事务中（`BEGIN ... COMMIT`）
- 或改用 UPSERT 策略（`ON CONFLICT DO UPDATE`）

---

## 四、低优先级修改意见（代码质量提升）

### 4.1 统一单例 vs DI 风格

**问题**：部分模块导出单例（`skillRegistry`、`orderConsolidator`、`whatsappAdapter`），部分通过 `bootstrap.ts` 手动注入。风格不一致，测试时难以 mock。

**建议**：
- 统一为构造函数注入模式
- `bootstrap.ts` 作为唯一的组装点（Composition Root）
- 测试时可以传入 mock 实现

### 4.2 res_api 代码重复

**问题**：`server.js` 和 `sync-to-db.js` 各自实现了相同的 CSV 解析器。

**建议**：
- 提取为 `res_api/lib/csv-parser.js` 共享模块
- 同时考虑将 `res_api` 迁移到 TypeScript（与主项目保持一致）

### 4.3 forecast-engine.ts 拆分

**问题**：657 行纯计算逻辑，虽然功能内聚，但职责可以更细分。

**建议拆分为**：
- `monthly-target.ts`：月度目标计算
- `daily-target.ts`：日目标分配
- `product-suggestion.ts`：单品建议
- `timeslot-allocation.ts`：时段分配
- `stockout-calculator.ts`：缺货损失计算
- `forecast-engine.ts`：组合以上模块的入口

### 4.4 错误处理增强

**问题**：
- 前端无全局 Error Boundary
- Server Actions 调用失败无统一重试
- `forecast-provider.tsx` 核心数据加载失败后 UI 仍渲染（空状态）

**建议**：
- 添加 React Error Boundary 组件，捕获渲染错误
- 核心数据加载失败时展示明确的错误状态（而非空白页面）
- 对关键操作添加 1 次自动重试

### 4.5 postgres.ts 的 Proxy 模式

**问题**：使用 Proxy + apply trap 模拟 tagged template literal 调用，类型不安全且增加调试难度。手动 `?` 参数替换存在边界情况风险。

**建议**：
- 直接使用 `postgres` 库的标准 tagged template 语法
- 移除 Proxy 包装，改为简单的懒初始化函数

### 4.6 Python 服务健壮性

**问题**：`LightRAG` 初始化失败时服务仍启动（返回 503），调用方可能困惑。

**建议**：
- 启动时如果 RAG 初始化失败，打印明确错误并退出（fail-fast）
- 或在 `/health` 端点返回 degraded 状态，让调用方知道服务不可用

---

## 五、架构演进路线图（建议优先级）

```
Phase 1（1-2 周）— 安全与稳定性
├── 修复所有硬编码凭据
├── 对话历史 + 审计日志持久化
├── 删除或合并 SkillRouter
└── 数据导入添加事务保护

Phase 2（2-4 周）— 接口升级
├── AiProvider 接口支持 messages 数组
├── Orchestrator 职责拆分
├── API Route 解耦（daily-review 等）
└── Server Actions 按域拆分

Phase 3（4-6 周）— 前端优化
├── 迁移到 Next.js 文件系统路由
├── Reducer 拆分
├── 添加 Error Boundary
└── 按需加载页面组件

Phase 4（持续改进）— 代码质量
├── 统一 DI 风格
├── res_api 迁移 TypeScript
├── forecast-engine 拆分
└── 添加集成测试覆盖
```

---

## 六、命名规范建议（当前已做得好，补充细化）

| 类别 | 当前规范 | 建议补充 |
|------|----------|----------|
| 文件名 | kebab-case ✓ | 保持 |
| 类名 | PascalCase ✓ | 保持 |
| 接口 | 无 `I` 前缀 ✓ | 保持 |
| 技能 ID | snake_case ✓ | 保持 |
| 环境变量 | SCREAMING_SNAKE ✓ | 保持 |
| Repository 方法 | 无统一前缀 | 建议统一：`get*`/`list*`/`create*`/`update*`/`delete*` |
| Hook 返回值 | 混合风格 | 建议统一返回对象 `{ state, actions }` 而非展开所有字段 |
| API Route | `/api/ai-correction` | 建议统一为 `/api/[domain]/[action]` 如 `/api/forecast/correct` |

---

## 七、总结

这是一个功能丰富、架构思路清晰的项目。模块化分层、技能注册表、AI 路由降级等设计体现了良好的工程判断。主要改进方向集中在：

1. **安全加固**（凭据管理、API 防护）
2. **状态持久化**（对话历史、审计日志）
3. **接口一致性**（AI Provider、路由器合并）
4. **前端架构对齐 Next.js 最佳实践**（文件路由、代码分割）

以上修改均可在不影响现有功能的前提下渐进式推进。
