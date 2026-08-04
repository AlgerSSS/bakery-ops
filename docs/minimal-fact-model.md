# HOT CRUSH 最小事实集与星型模型(全库 84 对象逐个判定 · v2 修订)

> 2026-08-03 · Claude / Kimi / Codex 讨论收敛版。
> 前提由用户拍板:**单库 + 按权限划分使用**,不拆库、不拆 schema。
> **v2 修订**:用户指出 v1 有三处不严谨,已全部核实并更正 —— 详见文末「v1 的错误」。
> 所有判定均为当日生产库实测,不引用推断。

---

## 一、判据

**判据 A · 能不能由别的表算出来?** 能 → 不是事实,是视图。
**判据 B · 丢了能不能重来?** 这条更要紧,而且**有时间窗**。

### 关键更正:「外部系统是权威」≠「本地副本可随时重抓」

`res_api/scrape-daily.js` 的抓取窗口是 **30 天**,而 `item_hourly_sales` 有 **215 天**历史。

> **本地库里 185 天的 POS 历史,RES 那边已经查不回来了。**
> 它名义上是镜像,实质是这个库独有的不可再生资产 —— 而它现在的保护级别等同于一张配置表。

---

## 二、最小事实集合计 **24 张(现有)+ 4 张(缺失)**

v1 说「9 张」是错的 —— 那只是销售/生产那一颗星。全库正确计数:

| 域 | 最小事实数 | 明细 |
|---|---|---|
| 销售与运营 | **6** | 商品时段销售、客流时段、支付构成、报废、排产建议快照、人工复盘 |
| 会员 | **2** | 卡交易、会员日态 |
| **成本卡(供应链)** | **3** | 配方版本、BOM 明细、采购价 |
| **财务** | **11** | 见下表 |
| 人事招聘 | **2** | 候选人投递、FSM 对话 |
| **现有合计** | **24** | (另有 1 张精度旁表 `item_last_sale`) |
| **缺失应建** | **4** | 排产计划、实际出货、实际工时、HBTI 原始答案 |

---

## 三、成本卡 = 供应链(15 个对象,派生图完整)

这是**全库建模最好的一块,应当作为其余部分的范本**:成本一行都不落表,全部现算。

### 4 张基表 → 9 个视图,依赖关系已用 `pg_depend` 证明

```
cost_card_item(451,🔑维度) ──────────────┬─→ v_cost_card_current_cost ─┬─→ v_cost_card_product_cost_compat → product_cost
cost_card_recipe(285,⭐) ──┬→ v_cost_card_recipe_expanded ─┘             └─→ v_cost_card_product_material_cost_compat → product_material_cost
cost_card_recipe_item(1468,⭐) ┘                            │
cost_card_item_price(339,⭐) ─┬→ v_cost_card_price_current  │
                              └→ v_cost_card_price_current_normalized ─┴─→ v_cost_card_data_quality
```

| 对象 | 行数 | 判定 |
|---|---|---|
| `cost_card_recipe` | 285 | **⭐ 最小事实** · 版本化配方,人工录入不可再生 |
| `cost_card_recipe_item` | 1,468 | **⭐ 最小事实** · BOM。粒度是 (配方, **序号**) 不是 (配方, 物料) —— 同一物料可在一个配方里出现多次 |
| `cost_card_item_price` | 339 | **⭐ 最小事实** · 采购价。**⚠ 现在每物料仅一行,成本无法回溯** |
| `cost_card_item` | 451 | 🔑 维度 · 物料主数据(4 种 item_type) |
| `cost_card_product_link` | 94 | 🔑 映射 · **已存在**,来源全部 `mysql:v_product_direct`,扩展而非新建 |
| `cost_card_item_name_lock` | 463 | ⚙️ 支撑 · 只有 (name_key, revision) 两列,名称并发锁 |
| `v_cost_card_recipe_expanded` | 视图 | 🔄 派生 · 递归展开 BOM |
| `v_cost_card_price_current` | 视图 | 🔄 派生 |
| `v_cost_card_price_current_normalized` | 视图 | 🔄 派生 · 单位/汇率归一 |
| `v_cost_card_current_cost` | 视图 | 🔄 派生 · 成本/成本率/毛利率 |
| `v_cost_card_data_quality` | 视图 | 🔄 派生 · 缺价/缺配方告警 |
| `v_cost_card_product_cost_compat` | 视图 | 🔄 派生 · 兼容层 |
| `v_cost_card_product_material_cost_compat` | 视图 | 🔄 派生 · 兼容层 |
| `product_cost` | 视图 | 🔄 派生 · 兼容名 |
| `product_material_cost` | 视图 | 🔄 派生 · 兼容名 |

**注**:历史上的 `suppliers` / `supply_orders` 已被删表,按你的要求不补充。
现存的采购/库存能力全部在 `finance_` 前缀下。

---

## 四、财务 18 张逐个核实(v1 有两处判错)

| 对象 | 行数 | 判定 | 实测依据 |
|---|---|---|---|
| `finance_expense_raw` | 90 | **⭐ 最小事实** | Excel 导入原文,7 个 category(服务费/市场费/物料成本/交通费…) |
| `finance_expense` | 103 | **⭐ 最小事实** ← v1 判错 | **不是 raw 的分类结果**:合计 209,599 vs raw 100,433,4 个 major(其他费用/运输费/仓储费/物料费)。只有「物料费 80,735 = 物料成本 80,735」一项重合,其余是**不同口径的两份数据** |
| `finance_labor_detail` | 148 | **⭐ 最小事实** | 7 类别(马来明细/工资/国内工资分摊/宿舍/福利/挂账/调整) |
| `finance_labor` | 6 | **⭐ 最小事实** ← v1 判错 | **不是 detail 的透视**:合计 124,714 vs detail 672,497,差 5 倍。是另一张 Excel 表 |
| `finance_supplier_orders` | 274 | **⭐ 最小事实** | 采购明细(供应商/物料/规格/数量/单价) |
| `finance_orders` | 19 | **⭐ 最小事实** | 采购生命周期,7 个日期列 = **累积快照事实** |
| `finance_stock_flow` | 491 | **⭐ 最小事实** | 期初/入库/耗用/期末,带 warehouse 维度(2 个仓库) |
| `finance_material` | 48 | **⭐ 最小事实** | 物料成本 |
| `finance_targets` | 138 | **⭐ 最小事实** | 人设目标,不可再生 |
| `finance_cashflow` | 42 | **⭐ 最小事实** | 现金流录入 |
| `finance_item_sales` | 76 | **⭐ 最小事实** | 月结商品销售。与 POS 口径不同,不可互推 |
| `finance_stock` | 482 | **🔄 冗余** | 与 flow 同 4 个月、品项数几乎一致(124/124、122/123、118/122、118/118)。独有的 `in_transit` **全部为 0 从未使用**;`spec/category/ptype` 属物料维度而非事实 |
| `finance_pl_metrics` | 66 | **🔄 派生** | 取值为「营业利润/净利润(含储值)/利润总额/实际收入」等 —— 损益**计算结果** |
| `finance_order_base` | 7 | 🔄 疑似派生 | 仅 (month, store, amount) 三列的汇总 |
| `finance_revenue_daily` | 0 | 💀 死表 | |
| `finance_store` | 0 | 💀 死表 | 与 `ops_store` 两套门店身份 |
| `finance_period_map` | 0 | 💀 死表 | |
| `finance_import_batch_history` | 0 | 💀 死表 | 批次表建了从没填 |

### ⚠ 财务域实测出的两个数据质量问题

1. **`finance_stock_flow` 有 33% 的行对不平**:`closing = opening + inbound - used`
   只在 **327/491 行**成立,164 行不满足恒等式。
2. **`finance_stock.in_stock` 出现负数**(2026-05 起 −40 / −51 / −53)。

---

## 五、其余各域(逐个,不再概括)

### 销售与运营(13)

| 对象 | 行数 | 判定 |
|---|---|---|
| `item_hourly_sales` | 81,069 | **⭐ 核心** · 日×时×商品。**185 天不可再生** |
| `hourly_sales_summary` | 2,453 | **⭐** · 金额可推(2515/2517),但 `bill_count`/`num_of_guests` **推不出** |
| `daily_breakdown` | 732 | **⭐** · 支付方式是账单属性 |
| `item_waste` | 3,582 | **⭐** · 独立事件 |
| `forecast_snapshot` | 1,698 | **⭐** · 「当时发出的建议」是事实。**⚠ 覆盖式,无运行历史** |
| `daily_review` | 5 | **⭐** · 人写的复盘 |
| `item_last_sale` | 1,334 | ⭐ 精度旁表 · 分钟级,非独立事实 |
| `daily_revenue` | 234 | **🔄 派生** · 实测营收 214/214、单量 213/214 全来自 `hourly_sales_summary` |
| `out_of_stock_record` | 478 | **🔄 派生** · 代码算出来的,还存出 14 组重复行 |
| `timeslot_sales_record` / `daily_sales_record` | 视图 | 🔄 已是视图 |
| `daily_push_log` | 106 | ⚙️ 推送幂等 |
| `holiday` | 18 | 🔑 并入日期维度 |

### 会员与 HBTI(6)

| 对象 | 行数 | 判定 |
|---|---|---|
| `pos_member_card_txn` | 14,578 | **⭐** · 每笔卡交易,零孤儿 |
| `pos_member_daily` | 945 | **⭐**(人数列) · 卡交易仅覆盖 237 天 vs 945 天。**店日粒度,不挂 member_id** |
| `pos_member` | 4,843 | 🔑 维度 · **列级双写**(res_api 26 列 / hbti-web 8 列) |
| `hbti_gift_stock` / `hbti_auth_token` / `hbti_rate_limit` | 9/30/75 | ⚙️ 运营支撑 |

### 商品与门店(6)

`pos_product`(211,🔑主维度,`item_key` 是全库唯一商品身份键)、`product`(54,🔑排产维度)、
`product_alias`(98,🔑映射,属 ETL 不进分析)、`ops_store`(2,🔑**混入「海外项目组」需清洗**)、
`finance_store`(0,💀)、`business_rule`(14,⚙️配置)

### 人事招聘(10)

`applications`(125,**⭐**,但 stage 覆盖式无历史)、`candidate_conversations`(42,**⭐**)、
`employees`(129,🔑**冻结快照**)、`staff`(25,🔑**与 employees 按姓名匹配 0 行**)、
`job_openings`/`appointments`(1/1)、`trials`/`offers`/`employee_events`(0,💀)、
`screening_rules`(25,⚙️)

### 平台设施(17,全部 ⚙️ 不进分析)

`app_user`/`app_role`/`app_user_role`/`app_user_store_scope`/`app_session`、
`app_audit_log`(267)/`ops_audit_log`(1,784)、`ai_call_log`(107)/`ai_daily_correction`(0)、
`wa_outbound_queue`(9)/`wa_send_log`(0)、`prompt_segment`(42)/`prompt_template`(0)、
`session_state`(2)/`chat_history`(13)/`context_event`(0)、`schema_migrations`(49)

---

## 六、连接键(五个)

```
                    日期 ─────────────────────────────┐
                     │                                │
F 商品时段销售 ──────┼─── item_key ─── 排产计划 ─ 实际出货
   │                 │        │            │
F 客流  F 支付        │      F 报废    成本卡(配方/BOM/价格)
   │                 │
   └──── store_id ───┴─── F 工时 ─── employment_id
                     │
              F 卡交易 ─── member_id
              F 会员日态(店日粒度,不挂 member_id)
```

**日期 · `item_key` · `store_id` · `employment_id` · `member_id`**

财务域自成一套月粒度事实,靠 **月 + store_id** 与上面连接。

---

## 七、必须物化的派生(「最小数据」的边界)

原则:**「当时算出来的结论」本身就是事实。**

**必须物化**:排产建议、断货判定、发券/发奖结果 —— 事后用新算法重算 ≠ 当时那个数。
**可永远现算**:日营收、逐时汇总、时段基线、日销明细、**全部成本卡视图**、损益指标。

---

## 八、v1 的错误(用户核对时指出,已更正)

| v1 说法 | 实测 | 更正 |
|---|---|---|
| 「9 张最小事实」 | 全库实为 **24 张现有 + 4 张缺失** | 9 只是销售/生产一颗星,财务 11、成本 3、会员 2、人事 2 被塞进脚注 |
| 7 个 `v_cost_card_*` 只写概括 | 未逐个列名,名称比对判定为未覆盖 | 已逐个列出并附 `pg_depend` 证明的派生图 |
| `finance_expense` 是 raw 的分类结果 | 209,599 vs 100,433,口径不同 | **判错,是独立最小事实** |
| `finance_labor` 是 detail 的透视 | 124,714 vs 672,497,差 5 倍 | **判错,是独立最小事实** |
| `finance_stock` 疑似派生(未验证) | 与 flow 高度重叠,`in_transit` 全 0 | 确认为**冗余表** |

---

## 九、最要紧的四件事

1. **185 天不可再生的 POS 历史没有独立备份纪律。**
2. **HBTI 换活动版本会逐行销毁上期记录**,13 题原始答案从不落库 —— 活动正在跑,唯一有时限压力。
3. **24 张最小事实里缺 4 张**(排产计划/实际出货/工时/HBTI 响应)—— 产销率、人效算不出来。
4. **财务库存流水 33% 对不平**,且 `in_stock` 出现负数 —— 建模之前先查这批数据。
