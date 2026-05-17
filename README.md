# Hot Crush Bakery Ops

Hot Crush 连锁烘焙店的统一运营平台。单进程 Node.js monolith，WhatsApp AI Agent + Web 仪表盘共享同一套业务逻辑。

架构详见 [structure.md](./structure.md)。

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Next.js 16 + Node.js |
| 消息通道 | whatsapp-web.js |
| 数据库 | Supabase (PostgreSQL + pgvector) |
| AI | OpenRouter (GPT-4.1) |
| 知识图谱 | LightRAG (Python FastAPI 微服务) |
| 爬虫 | Playwright |
| 协同 | 飞书多维表格（Lark Base）双向同步 |
| 供应链 | 金山文档 AirScript + WMS (dex-i) |
| 测试 | Vitest |
| 语言 | TypeScript 5 |

## 业务模块

| 模块 | 功能 |
|------|------|
| recruitment | 招聘搜索（JobStreet / AJobThing / Indeed）、候选人触达、职位发布、简历解析、通知监控 |
| employee | 员工入职/离职/事件管理、飞书多维表格同步 |
| supplychain | 订货消息解析、汇总合并、金山文档写入、WMS 下单、到货核验 |
| marketing | KOL 发现（TikTok / Instagram）、评分、触达 |
| forecast | 月度营收目标 → 日拆分 → 单品出货建议 → 分时段排产（Web UI + WhatsApp） |
| production-plan | 后厨生产计划自动排程（基于预估单 + 工位分配） |
| knowledge | LightRAG 知识图谱查询 |
| lark | 飞书多维表格员工档案双向同步 |

## WhatsApp Skills（14 个）

| Skill | 说明 |
|-------|------|
| recruitment | 搜索候选人 |
| candidate-outreach | 向候选人发送邀约 |
| job-posting | 发布职位到招聘平台 |
| active-jobs | 查看在线职位状态 |
| resume-upload | 上传简历并解析入库 |
| employee-management | 员工入职/离职/事件记录 |
| forecast-order | 生成预估单 |
| kitchen-production-plan | 生成后厨排产计划 |
| supply-order | 解析订货消息 |
| supply-send | 发送订货单给供应商 |
| arrival-check | 到货核验 |
| kol-discovery | KOL 搜索与评分 |
| kol-outreach | KOL 合作触达 |
| knowledge-query | 知识库问答 |

## 项目结构

```
bakery-ops/
├── server.ts                # 入口（Next.js + WhatsApp 同进程）
├── bot-only.ts              # 纯 Bot 模式（无 Web UI）
├── src/
│   ├── bootstrap.ts         # 注册 Skill、启动 WhatsApp、定时任务
│   ├── modules/
│   │   ├── channel/         # WhatsApp 适配器（client / adapter / sender / formatter）
│   │   ├── orchestrator/    # 意图路由、状态管理、权限、审计、Skill 注册
│   │   ├── domain/          # 业务逻辑
│   │   │   ├── ai/         # OpenRouter AI Provider
│   │   │   ├── recruitment/ # 招聘（connectors / outreach / posting / notifications）
│   │   │   ├── employee/    # 员工管理 + 规则提炼
│   │   │   ├── resume/      # 简历解析
│   │   │   ├── supplychain/ # 订货（parser / consolidator / excel / KDocs / WMS）
│   │   │   ├── forecast/    # 预估引擎（engine / excel / prompt / gemini）
│   │   │   ├── production-plan/ # 后厨排产
│   │   │   ├── marketing/   # KOL（TikTok / Instagram connectors）
│   │   │   ├── knowledge/   # LightRAG client
│   │   │   ├── lark/        # 飞书同步
│   │   │   └── files/       # 文件服务
│   │   ├── skills/          # 14 个 WhatsApp Skill Handler
│   │   ├── data/            # Repository + 6 个 migrations
│   │   └── shared/          # logger / db / types / errors
│   ├── app/                 # Next.js App Router
│   │   ├── (forecast)/      # 预估单 Web UI（多页面 SPA）
│   │   └── api/             # AI 修正、趋势、导入、日复盘等 API
│   └── ui/                  # React 组件 + Hooks
│       ├── components/      # pages / domain / shared / providers / nav
│       ├── hooks/           # use-forecast / use-ai / use-export 等
│       └── constants/
├── config/                  # 业务规则 JSON（月系数、时段排产、产品别名）
├── services/lightrag/       # LightRAG Python 微服务
└── uploads/                 # 上传文件暂存
```

## Web UI 页面

| 页面 | 功能 |
|------|------|
| Overview | 日营收总览、日复盘采纳 |
| Timeslots | 分时段出货建议 + AI 修正 |
| Production | 后厨排产计划 |
| Trends | Prophet 趋势图表 |
| Calendar | 活动/节假日日历管理 |
| Review | 日复盘 |
| Empowerment | 赋能复盘 |
| Settings | 业务规则配置 |

## 快速开始

### 环境要求

- Node.js >= 18
- Python >= 3.11 + [uv](https://docs.astral.sh/uv/)（LightRAG 微服务）
- Supabase 项目
- OpenRouter API Key
- WhatsApp 账号

### 安装

```bash
cd bakery-ops
npm install
```

### 环境变量

复制 `.env.example` 并填写：

```env
# WhatsApp
WHATSAPP_SESSION_DATA_PATH=./whatsapp-session
WHATSAPP_PUPPETEER_HEADLESS=true

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...

# PostgreSQL（forecast 模块直连）
DATABASE_URL=postgresql://user:password@host:port/database

# AI
OPENROUTER_API_KEY=sk-or-v1-xxx
AI_CHAT_MODEL=openai/gpt-4.1
AI_EMBEDDING_MODEL=openai/text-embedding-3-small

# 招聘平台
JOBSTREET_EMAIL=xxx
JOBSTREET_PASSWORD=xxx
AJOBTHING_SESSION_DIR=./ajobthing-session

# 供应链
KDOCS_AIRSCRIPT_TOKEN=xxx
KDOCS_WEBHOOK_URL=https://www.kdocs.cn/api/v3/ide/file/xxx/script/xxx/sync_task
WMS_URL=https://wms.dex-i.net/
WMS_EMAIL=xxx
WMS_PASSWORD=xxx

# 飞书
LARK_APP_ID=xxx
LARK_APP_SECRET=xxx
LARK_BASE_APP_TOKEN=xxx
LARK_TABLE_ID=xxx

# 微服务
LIGHTRAG_URL=http://localhost:8020

# Owner WhatsApp（不带+号和空格）
OWNER_PHONE=60123456789
```

### 初始化数据库

在 Supabase SQL Editor 中依次执行 `src/modules/data/migrations/` 下的迁移文件：

```
001_core_tables.sql        # 用户、员工、候选人
002_kol_tables.sql         # KOL 与合作记录
003_supply_chain_tables.sql # 供应商、订单
004_forecast_tables.sql    # 预估单、销售基线、产品
005_schema_separation.sql  # Schema 分离
006_lark_sync.sql          # 飞书同步字段
```

### 启动

```bash
# 开发模式（WhatsApp + Web UI 同进程）
npm run dev

# 纯 Bot 模式（无 Web UI，轻量）
npm run dev:bot

# LightRAG 微服务（可选）
cd services/lightrag && uv run python server.py
```

首次启动显示 WhatsApp QR 码，扫码登录。Web UI 访问 `http://localhost:3000`。

### 测试

```bash
npx vitest run              # 全部测试
npm run build               # 构建验证
npx tsc --noEmit            # 类型检查
```

## 定时任务

| 周期 | 任务 |
|------|------|
| 每分钟 | 清理过期会话 |
| 每 15 分钟 | 检查招聘平台通知（JobStreet / AJobThing） |
| 每周日 03:00 | 员工管理规则自动提炼 |

## 权限体系

| 角色 | 权限 |
|------|------|
| owner / admin | 全部功能 |
| hr_manager | 招聘、员工管理 |
| store_manager | 招聘、员工管理、预估单、后厨计划、订货 |
| kitchen_manager | 预估单、后厨计划、订货 |
| marketing_manager | KOL 营销、招聘、员工管理 |
| staff | 预估单导出、订货 |
| kol | KOL 营销 |

用户通过 WhatsApp 手机号识别，存储在 Supabase `users` 表。支持 LID（WhatsApp Linked ID）映射。
