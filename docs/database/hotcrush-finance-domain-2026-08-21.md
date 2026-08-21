# Hot Crush R6 财务域接入与 POS 权威值定案（2026-08-21）

> 对象：独立 Supabase Project `hotcrush-core-r6-green`（`tmmkknnkcptunxbfjxqn`）。
> 旧生产 `ecsgqcmwtjmcpzqytdqw` 全程只读，未执行任何写入或 DDL。

## 一、2026-04-12 POS 单数差异：已定案

### 结论

**993 是权威值。旧生产 `daily_revenue.transaction_count = 968` 是入库管线的缺陷，不是 POS 的问题。**

### 证据链

R6 迁移时把这天隔离，理由记录为 `SOURCE_RECONCILIATION_FAILED: bill_count mismatch: daily=968 hourly=993`。
R6 Storage 里保留了当时的原始快照（batch `fb485f7f-4d9b-4d86-96a4-2ed3669b5bd8`，
`exported_at` 2026-06-18），证明这是持久差异而非快照时序问题。

直接向 RestoSuite 取 2026-03-14..2026-04-12 的原始报表，其日报汇总与小时报完全一致：

| | 日报汇总 | 小时表合计 |
|---|---:|---:|
| billCount | 23,774 | 23,774 |
| netSales | 1,315,331.94 | 1,315,331.94 |
| grossSales | 1,569,978.5 | 1,569,978.5 |

单独取 2026-04-12：993 单 / net 53,189.00 / gross 60,068.1，与旧库 `hourly_sales_summary` 一字不差。

RestoSuite 的 `avgTicket` 口径经验证为 `netSales / billCount`（1,566,756.6 / 26,790 = 58.48，
与报表字段完全相等）。旧库该日存的 `avg_transaction_value = 57.99` 在这个口径下对应约 917 单，
既不等于 968 也不等于 993 —— 说明该行的 `revenue` 与 `avg_transaction_value` 不是同一时刻写入的。

### 全库范围

232 天（daily 与 hourly 都有数据的日子，2026-01-01..2026-08-20）中：

- 单数不一致：**2 天**
- 金额不一致：**1 天**

即 230/232 天完全勾稽。这是孤立缺陷，不是系统性口径错误。

- **2026-04-12**：差 25 单，金额分毫不差 —— 唯一的真实矛盾。
- **2026-08-19**：差 1 单 / RM 69.00。hourly 在 2026-08-20 15:03 UTC 被重新同步，
  而 R6 在同日 12:38 读取，属于迁移边界日的回补时序差，不是数据错误。

### 尚未做的事

旧库 2026-04-12 的 `daily_revenue` 行**未修改**。修正它是对生产财务事实的写入，
需要单独授权。修正内容应为 `transaction_count` 968 → 993，
`avg_transaction_value` 57.99 → 53.56（53,189 / 993）；`revenue` 与 `gross_sales` 本身正确。

## 二、R6 财务域：已实施

### 表结构

迁移 `20260821002900_finance_core.sql`，6 张事实表 + 6 个 current view：

| 表 | 来源 | 说明 |
|---|---|---|
| `fin_month_fact` | 6 张月度财务表 | 统一为「月 × 门店 × 维度 × 金额」，用 `domain` 区分 |
| `fin_revenue_day` | `finance_revenue_daily` | 财务口径日营收，与 `pos_sales_day` 刻意分开 |
| `fin_cost_item` | `cost_card_item` | 成本卡物料主档 |
| `fin_cost_item_price` | `cost_card_item_price` | 带生效区间的采购价 |
| `fin_cost_recipe` | `cost_card_recipe` | 配方头 |
| `fin_cost_recipe_item` | `cost_card_recipe_item` | 配方组分行 |

### 三个由真实数据逼出来的建模决定

1. **自然键不唯一，必须保留源行 ID。**
   `finance_expense` 真实存在两条 2026-03 物料费/日常物料/银行账户采买
   （1507.50 与 472.22，id 232/233）。按维度元组做键会静默吞掉 472.22。

2. **`finance_targets` 有 `全部` 汇总口径，必须与门店口径分开。**
   该表同时存在 `全部` 和 `吉隆坡Pavilion门店` 两行，金额相同（如 2026-01 总流水各 1,766,000）。
   若都映射成 `HC001`，每个目标都会翻倍。因此引入 `store_scope`（`STORE` / `GROUP`），
   `全部` 映射为 `store_id = 'ALL'`、`scope = 'GROUP'`。
   **这个缺陷是在推送前用真实数据预检时发现的，不是设计时想到的。**

3. **未映射的门店直接报错，不做兜底。**
   将来开二店时必须显式加映射，而不是被静默并进 HC001。

### 不迁移的东西

`app_user` / `app_session` / `app_permission` 等财务站自有鉴权表**不进 R6**。
那是财务站的会话与凭据存储，不是财务事实；复制进来只会多一个凭据边界而没有任何分析价值。

### 数据边界（旧库现状）

| 域 | 行数 | 覆盖区间 |
|---|---:|---|
| 月度事实合计 | 545 | 2025-12 → 2026-07 |
| `finance_revenue_daily` | **0** | 空表 |
| 成本卡物料 / 价格 / 配方 / 组分 | 471 / 344 / 430 / 2453 | — |

`finance_revenue_daily` 为空是事实，不是导出失败。

### 安全边界

- 6 张表全部 `enable row level security` 且**无任何 policy** —— 默认封闭，只能经受控 RPC 读写。
- 新增角色 `hc_finance_writer`，只能注册 Raw 批次，**不能**直接写事实；
  装载仍由 `hc_ops_processor` 在活跃租约下完成。
- `FINANCE_MONTHLY` / `FINANCE_COST_CARD` 只能调度各自的管线，无法调度 POS 管线，反之亦然。
- 三个新函数显式 `revoke all ... from public, anon, authenticated`。
  PostgreSQL 默认把 EXECUTE 授予 PUBLIC；**漏掉这步会让任何角色都能装载财务事实**，
  这是被 pgTAP 断言抓到的，不是事后想起来的。

### 验证

- pgTAP：14 个文件、**157 项断言**（原 135，财务域新增 22）
- Python：**92 项**（原 65）
- RES Node：**153 项**（原 143）
- **端到端实跑**：拿真实生产数据完整跑通「导出 → 注册 Raw → worker 领租约 → 解析 → 装载 → 对账」

端到端对账结果 `ok: true`，14 项检查零 mismatch，每个域的行数与金额都与旧库一致：

| 域 / 口径 | 行数 | 金额 |
|---|---:|---:|
| PL_METRIC / STORE | 66 | 11,201,859.98 |
| EXPENSE / STORE | 103 | 2,504,579.87 |
| LABOR / STORE | 148 | 4,493,182.25 |
| MATERIAL / STORE | 48 | 2,940,991.97 |
| CASHFLOW / STORE | 42 | 2,018,811.50 |
| TARGET / GROUP | 69 | 33,906,375.00 |
| TARGET / STORE | 69 | 33,906,375.00 |

成本卡 471 / 344 / 430 / 2453，三类孤儿引用均为 0。

对账刻意同时比对**行数和金额合计** —— 只比行数的话，一次把所有金额清零的装载也会「通过」。

### 代码位置

- 迁移：`supabase/migrations/20260821002900_finance_core.sql`
- pgTAP：`supabase/tests/014_finance_core.test.sql`
- 解析：`bakery-ops/services/data-platform/hotcrush_data_platform/finance_pipeline.py`
- Worker：`bakery-ops/services/data-platform/hotcrush_data_platform/finance_worker.py`
- 导出：`res_api/lib/r6-finance-export.js`
- 迁移 CLI：`res_api/scripts/backfill-r6-finance.js`
- 对账 CLI：`res_api/scripts/verify-r6-finance.js`
- 共享 Raw 校验：`bakery-ops/services/data-platform/hotcrush_data_platform/raw_artifacts.py`

### 端到端实跑抓到的第二个缺陷

单元测试全绿之后，端到端实跑仍然失败：`permission denied for function ops_load_finance_monthly`。
原因是 worker 以 `service_role` 连接，而我只把执行权授给了 `hc_ops_processor`。
对照 POS 域才发现它的约定是两条：**授 `service_role` 执行 RPC，同时 revoke 掉
`service_role` 对事实表和视图的直读**。两条我都漏了，现在都补上并加了断言。

这个缺陷单元测试抓不到 —— 只有真的跑一遍才会暴露。

### 顺带修掉的一个隐患

Raw 制品的 size / sha256 校验原先只存在于 `pos_worker.py` 内部，且**没有任何直接测试**。
财务 worker 也需要它。复制一份意味着将来修一处、烂另一处，因此抽成
`raw_artifacts.py` 由两边共用，并补了 7 项测试，覆盖截断、等长替换、重复注册等情况。

## 三、尚未完成，需要单独授权

1. **迁移未推送到 R6 线上。** `supabase db push --linked` 被权限拦截。
   在推送之前，R6 线上不存在这 6 张表，数据迁移也无法执行。
2. **数据未装载到 R6 线上。** 整条链路已在本地 Supabase 用真实生产数据跑通并对账通过。
   推送与迁移已合并成一条命令：

   ```
   ./scripts/deploy-r6-finance.sh --dry-run   # 只看不动
   ./scripts/deploy-r6-finance.sh             # 部署 + 迁移 + 对账
   ```

   脚本先做隔离守卫（linked 必须是 R6、两个旧应用 .env 必须仍指向旧库且不含 R6 ref），
   再依次执行迁移推送、Raw 批次注册、租约装载、对账。
   最后一步必须返回 `ok: true`；它同时比对行数和金额，任何一项不符都会以非零码退出。
   旧库全程在显式只读事务内读取。
3. **财务站仍连旧库。** 本轮不改 `DATABASE_URL`、不改 Vercel 变量 —— 与既有约束一致。
4. **2026-04-12 旧库修正未执行**（见第一节）。
