# 复盘系统完整方案

## 系统架构

```
每日凌晨 1:00 MYT (自动)
├── res_api: npm run refresh → 爬取 Restosuite → 写入 DB
└── lark-sync: 读取飞书日损益表 → 写入 DB (待实现)

店长发复盘消息 (WhatsApp)
    ↓
Intent Router → 识别为"复盘"
    ↓
LLM 意图解析 → 提取结构化字段
    ↓
数据库查询 → 当日销售 + 时段 + 单品 + 支付 + 损益
    ↓
RAG 查询 → 历史复盘 + SOP + 规则
    ↓
LLM 生成分析报告
    ↓
多轮对话（追问数据 → 查 DB → 回答）
    ↓
对话结束 → 提炼知识 → 写入 RAG
```

## 复盘输入模板（店长填写）

```
门店：
日期：xxxx年xx月xx日
天气：
店长：
当日早值班：
当日晚值班：

收入国籍占比
当地：
游客：（XX% A国 XX% B国）

当日场地/邻近国家是否有特殊活动或节日
特殊活动/节日：
对于门店的意义：

营业额：
折扣率：

报废：
生产报废：
试吃报废：
排产报废：

前场人效：
后厨人效：
前场每元产出：
后厨每元产出：

今日应做：RMxxxxxx
机会点：
```

## 系统输出模板（Bot 回复）

Bot 结合店长输入 + 数据库数据，生成以下分析：

```
📊 核心指标（系统数据 vs 店长报告）
  营业额: RM{actual} (报告: RM{reported}) | 差异: {diff}
  客单数: {bills} | 客单价: RM{avg}
  折扣率: {rate}% | 会员占比: {member}%
  vs 上周同天: {对比}
  vs 今日应做: {达成率}

⏰ 时段表现
  高峰时段: {peak} — 客单数/客单价/单品
  低谷时段: {low} — 原因分析
  异常时段: {结合特殊事件分析}

🏆 TOP榜分析
  TOP 5 单品 + 销量 + 营收
  断货产品影响评估（断货前后数据对比）
  浪费产品分析（报废 vs 实际需求）

👥 客群分析
  国籍占比意义（结合店长输入）
  支付渠道分布
  堂食/外带比

📈 未来数据预估
  基于同比/环比的趋势分析
  明日预估业绩

🗑️ 报废分析
  报废率 vs 行业标准
  生产/试吃/排产各占比
  改善建议

👔 值班策略调整分析
  结合时段销售数据
  人效分析（前场/后厨）
  调整建议

💡 策略建议
  1. [高优先] {建议}
  2. [中优先] {建议}
  3. [低优先] {建议}

📋 明日调整方向
  - {具体行动项}
```

## 数据来源映射

| 输出板块 | 数据来源 |
|---------|---------|
| 核心指标 | `daily_revenue` |
| 时段表现 | `hourly_sales_summary` + `item_hourly_sales` |
| TOP榜 | `item_hourly_sales` |
| 客群分析 | `daily_payment_breakdown` + `daily_dining_breakdown` + 店长输入 |
| 未来预估 | `daily_revenue` 历史 + time series 计算 |
| 报废分析 | 店长输入 + 飞书日损益表(待接入) |
| 值班策略 | `hourly_sales_summary` + 店长输入的人效数据 |
| 折扣率 | `daily_revenue.discount_rate` |
| 会员占比 | `daily_revenue.member_sales_ratio` |

## 待实现/待确认

### 已完成 ✅
- [x] Restosuite 数据爬取 + 同步 DB（每日凌晨1点）
- [x] 数据库表：daily_revenue, hourly_sales_summary, item_hourly_sales, daily_payment_breakdown, daily_dining_breakdown
- [x] daily-review-chat skill 注册到 WhatsApp Bot
- [x] LLM 意图解析（自然语言输入）
- [x] 数据库查询（时段/单品/支付/对比）
- [x] LightRAG 集成（写入+查询）
- [x] 多轮对话（追问数据问题）
- [x] 对话结束提炼知识写入 RAG
- [x] 定时调度器（scheduler.js）

### 已完成 ✅
- [x] Restosuite 数据爬取 + 同步 DB（每日凌晨1点）
- [x] 数据库表：daily_revenue, hourly_sales_summary, item_hourly_sales, daily_payment_breakdown, daily_dining_breakdown
- [x] daily-review-chat skill 注册到 WhatsApp Bot
- [x] LLM 意图解析（自然语言输入）
- [x] 数据库查询（时段/单品/支付/对比）
- [x] LightRAG 集成（写入+查询）
- [x] 多轮对话（追问数据问题）
- [x] 对话结束提炼知识写入 RAG
- [x] 定时调度器（scheduler.js）
- [x] 日损益表 Excel 同步脚本（sync-pnl.js）
- [x] daily_pnl 数据库表（报废、成本、利润）

### 待实现 🔧
- [ ] 飞书多维表格自动读取日损益表（目前用 Excel 本地导入，后期切换到 Lark Bitable API）
- [ ] Time series 预估模型对接（bakery-ops 已有 Prophet sidecar）
- [ ] 复盘 skill 中集成 daily_pnl 数据（报废分析、成本分析）

### 待补充数据源 📋

| 数据 | 当前状态 | 需要的动作 |
|------|---------|-----------|
| **班表/工时数据** | ❌ 没有 | 需要新建 `daily_schedule` 表，存每天前场/后厨总工时。人效 = 营业额 / 总工时 |
| **国籍占比** | ❌ 没有 | 从店长复盘消息中 LLM 解析提取，存入 `daily_review` 表的 JSON 字段 |
| **前场/后厨分开的工时** | ❌ 没有 | 班表需要区分前场和后厨，才能分别算人效 |
| **日损益表自动同步** | 🔶 半自动 | 目前需要手动跑 `node sync-pnl.js --file=xxx.xlsx`，后期接飞书多维表格 API 自动拉取 |
| **"今日应做"目标** | ❌ 没有 | 需要一个月度目标表，按天拆分每日应做金额（可从损益表月度预算推算） |
| **竞品/周边活动信息** | ❌ 没有 | 纯靠店长输入，LLM 解析后存 RAG |

### 人效计算公式

```
前场人效 = 当日营业额 / 前场总工时（小时）
后厨人效 = 当日营业额 / 后厨总工时（小时）
整体人效 = 当日营业额 / (前场+后厨)总工时

需要的数据库表：
CREATE TABLE daily_schedule (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  store_id TEXT,
  front_hours NUMERIC(6,1),   -- 前场总工时
  kitchen_hours NUMERIC(6,1), -- 后厨总工时
  total_hours NUMERIC(6,1),   -- 总工时
  front_staff INTEGER,        -- 前场人数
  kitchen_staff INTEGER,      -- 后厨人数
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, store_id)
);
```

等你把班表数据放进来后，我会：
1. 创建这个表
2. 在 sync 流程中读取班表
3. 在复盘分析中自动计算并展示人效

## 多轮对话流程

```
店长: [发送复盘内容]
Bot: [生成完整分析报告] + "还有什么想了解的吗？"

店长: "蛋挞14点后还卖了多少？"
Bot: [查 item_hourly_sales WHERE item='Egg Tart' AND hour>=14] → 回答具体数字

店长: "上周一同时段呢？"
Bot: [查上周一数据] → 对比回答

店长: "没了"
Bot: [提炼本次对话知识] → 写入 RAG → "已记录，明天见！"
```

## 文件位置

```
bakery-ops/src/modules/skills/daily-review-chat/
└── daily-review-chat.definition.ts  ← 已实现

res_api/
├── scheduler.js      ← 定时调度（凌晨1点）
├── scrape-daily.js   ← 爬取数据
└── sync-to-db.js     ← 写入数据库
```
