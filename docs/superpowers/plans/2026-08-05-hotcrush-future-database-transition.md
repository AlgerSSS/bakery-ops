# HOT CRUSH Future Database Blueprint Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏唯一一套 Supabase 生产库及四个现有消费者的前提下，把当前按名称关联、事实混用、成本按当前值回算的数据库，迁移为以 `store_id / product_id / employment_id / material_id` 为主轴、可追溯、可版本化、可逐域切换的营运—供应链—人事—成本—财务数据基座。

**Architecture:** 保留一套 PostgreSQL / Supabase `public` schema，以“分域单写、共享稳定身份、追加式事实、有效期版本、派生视图后置”为核心。迁移采用兼容优先的增量路线：先治理迁移账本和身份映射，再建立新事实表；每个写者先双写、再影子读对账、最后切换主读，旧对象只在完成业务周期验证后退休。

**Tech Stack:** PostgreSQL 17-compatible SQL, Supabase PostgreSQL/RLS, Node.js, TypeScript, JavaScript, Next.js, postgres.js, Vitest, Node Test Runner, Docker PostgreSQL, Vercel, Contabo, Lark Sheets/API, RES/POS extractors.

---

## 0. 文档边界与执行原则

本文件是实施总计划，不是已执行的迁移。编写本计划时：

- 没有执行生产 DDL/DML；
- 没有修改 BakeryOps、`res_api`、财务网站或 HBTI 运行时代码；
- 没有部署任何服务；
- 没有把蓝图中的未来表名当成生产库现状；
- 所有生产 DDL/DML 仍必须先成为迁移文件，再由人审核和执行；
- 每一波迁移只允许在 KL 时间 01:00–13:00 之间实施，避开约 23:00 的 POS 抓取窗口；
- 当前工作区存在其他未提交成果，实施者必须先建立干净边界，不能直接运行 `deploy.sh`。

设计输入：

- `docs/diagrams/HOTCRUSH未来数据库蓝图说明.md`
- `docs/diagrams/HOTCRUSH未来数据库蓝图.drawio`
- `docs/star-schema-plan.md`
- `AGENTS.md` 的共享库、命名、迁移和部署约束

### “完美地基”的第一性定义

这里的“完美”不代表表越多越好，也不代表一次性消灭全部历史表。它只在以下条件同时成立时成立：

1. **身份不靠名称猜。** 门店、可售产品、雇佣关系、原料都有稳定主键，并保留各来源系统 ID。
2. **事实不互相冒充。** 预测、发布计划、实际生产、实际发出、POS 售出、报废、排班、实际工时分别存储。
3. **历史不可被今天覆盖。** 配方、采购价、计划、班表、采购单都有版本或有效期。
4. **一张表只有一个业务粒度和一个写者。** 跨域工作流可以一次提交，但事务内分别写入各自粒度的表。
5. **派生数可以重算。** 产品占比、预测准确度、人效、毛利率优先由视图/受控快照生成，不允许人工重复录入。
6. **不知道就是不知道。** 映射冲突、缺成本、来源不完整必须进入审核或隔离状态，不能静默填默认值。
7. **每个数字能追到来源。** 来源批次、文件/URL、外部 ID、抓取窗口、算法/解析器版本、操作人、审批和时间戳都可查询。
8. **数据库能继续演进。** 迁移有全局唯一 ID、checksum、锁、事务、所有者和验收记录，运行时账号不能随意改别的域。

## 1. 路线选择

| 路线 | 优点 | 致命问题 | 决策 |
|---|---|---|---|
| 一次性大改、同晚切四个系统 | 表面工期短 | 只有生产库、没有 staging；任一遗漏会同时打断 POS、BakeryOps、财务站和 HBTI | 拒绝 |
| 只在旧表上套视图 | 改动少 | 补不了稳定身份、来源批次、版本事实和历史成本；视图也不能兼容 `ON CONFLICT` 写入 | 拒绝 |
| **增量兼容迁移：新表 + 双写 + 影子读 + 分域切换** | 每波可验收、可回退读写路径，适合唯一生产库 | 暂时需要维护新旧两套事实并做对账 | **采用** |

最短正确路径不是先建 70 多张空表，而是：

```mermaid
flowchart LR
    A["P0 恢复服务与冻结基线"] --> B["P1 迁移治理"]
    B --> C["P2 稳定门店/产品身份"]
    C --> D["P3 POS 来源与销售事实"]
    C --> E["P5 人员/雇佣身份"]
    D --> F["P4 预测/计划/执行"]
    E --> G["P5 培训/班表/实际工时"]
    F --> H["P6 原料需求/补货/采购/收货"]
    H --> I["P7 价格/成本快照"]
    D --> I
    I --> J["P8 毛利/财务对账/网站切换"]
    G --> J
    J --> K["P9 权限收口与旧链路退休"]
```

P3 与 P5 的身份准备可以并行开发，但生产迁移仍按全局迁移 ID 串行执行。P7 不能早于销售、配方、供应商价格三条链；分析视图永远在规范事实之后。

## 2. 2026-08-05 已核验的当前基线

### 2.1 部署和所有权

| 消费者/写者 | 当前职责 | 目标写权限 |
|---|---|---|
| `res_api` | 抓 RES/POS，写营收、单品、报废、会员等事实 | 只写 `pos_` 及自己的来源批次 |
| `bakery-ops` | 预测、复盘、招聘、消息、部分供应链连接 | 只写 `ops_ / hr_ / scm_ / msg_ / ai_` |
| 财务网站 | 财务报表、成本卡、账号权限、导入 | 只写 `finance_ / cost_card_ / app_` |
| `hbti-web` | HBTI 活动状态、会员奖励相关字段 | 只写明确授权的 `hbti_`/会员列；对运营核心只读 |

数据库只有一套 Supabase 生产库，没有 staging；四个代码库/三个部署目标共享它。

### 2.2 当前结构与数据缺口

| 现状 | 已观察事实 | 对蓝图的影响 |
|---|---:|---|
| `schema_migrations` | 88 行，版本 1–300；25 行没有 `filename/checksum`，107–109 有缺口 | 新业务表之前必须先治理迁移账本，不能继续只抢三位编号 |
| `ops_store` / `finance_store` | 前者 0 行且以 `store_code` 为主键；后者 1 行且门店是文本 | 先建立企业 `store_id` 和来源映射，不能直接给所有旧行硬填一个默认门店 |
| `item_hourly_sales` | 约 81,937 行，全部缺 `store`；约 2,440 行缺 `item_key` | 当前表不能直接成为多门店产品事实 |
| `forecast_snapshot` | 约 1,807 行；按日期+商品名覆盖 | 不能追踪算法运行、输入版本、置信区间和人工修订 |
| 生产计划 | 生成器主要是纯函数，未形成可靠版本化事实 | 预估单、实际生产、实际发出都需落库 |
| `employees / fact_shift` | 两者当前均无有效事实；`fact_shift` 仍以姓名/自由文本岗位关联 | 人事与班表必须先建 person/employment 和岗位资格链 |
| 成本卡 | `cost_card_item/recipe/recipe_item/item_price/product_link` 已存在且配方已版本化 | 不重建配方表；只扩充供应商/门店价格、产品映射、成本快照和追溯明细 |
| `cost_card_item_price` | 约 344 行对应约 344 个原料，基本没有真实历史版本 | 现在无法可靠回答“当日成本”和历史毛利 |
| 成本映射 | 约 37 条产品映射；近 30 日已映射销售覆盖约 93.1%，可算成本约 88.2%，可信约 66.9% | 网站必须显示覆盖率/可信度，不能把未映射产品当零成本 |
| 供应链 | `finance_supplier_orders` 约 274 行，偏月结/名称关联 | 不能用财务月结表代替日常 PO、修订、收货和价格来源 |
| 财务人力 | `finance_labor_detail` 只有月度金额，没有员工/工时 | 实际工时必须独立从 Lark 进入 `hr_timesheet_*`，再与财务金额对账 |
| 财务网站生产接口 | 当前生产 API 已观察到 500，原因指向 `.vercelignore` 把 `api/_lib` 排除 | 这是任何数据库迁移前的 P0 阻断项 |

### 2.3 当前可保留的资产

- 成本卡的 `cost_card_item`、`cost_card_recipe`、`cost_card_recipe_item`、`cost_card_item_price`、`cost_card_product_link` 继续作为成本域核心；
- `applications / appointments / trials` 继续作为招聘来源事实，先补稳定外键，不为了好看立即改名；
- `app_audit_log` 继续作为审计表，不再另造平行审计表；它仍由 `app_` 域拥有，其他运行时只能调用受控的追加函数，不能直接 UPDATE/DELETE；
- `finance_*` 的损益、现金流、资产负债、人工、供应商月结仍保留；新蓝图负责提供对账输入，不取代总账/月结；
- 旧 POS 聚合表在并行期保留，直到新表连续对账通过。

## 3. 对当前蓝图的物理模型修正

实施时必须以本节为准更新图和说明：

1. `cost_card_recipe_version` 与 `cost_card_recipe_version_item` **不新建**。现有 `cost_card_recipe` 已包含 `version/effective_from/effective_to/status`，现有 `cost_card_recipe_item` 继续存配方明细。
2. `ops_shift_plan` 只表示“某店某日的稳定班表身份”；新增 `ops_shift_plan_version` 表示 draft/submitted/approved/published 版本，需求和指派都挂版本。
3. 新增 `scm_supplier`，不能让 `supplier_id` 只存在于明细而没有供应商主数据。
4. 新增 `ops_production_output/_line`。实际烘烤/制作、实际发给前场、POS 实际售出是三个不同检查点。
5. 新增 `pos_order / pos_order_item / pos_payment / pos_refund`，但只有 RES 来源能提供稳定账单/行/支付/退款 ID 时才启用；当前时间桶不能冒充订单。
6. 新增 `hr_offer / hr_onboarding_task`，补齐评分→录用→入职任务→培训→岗位资格→班表链。
7. 新增 `cost_card_product_cost_snapshot_component`，否则只能看到单位成本，无法解释黑巧、草莓等原料各贡献多少。
8. 新增销售、采购、人工、毛利四类财务对账视图；现有 `finance_*` 报表不会被新视图替代。
9. 所有来源批次都必须有 `source_system/source_external_id/source_url_or_file/source_sha256/fetched_at/parser_version/status/error_summary` 中适用的字段。

## 4. 目标对象目录

本计划定义的终态跨域规范核心为 **73 张物理表（含需升级的现有表）+ 16 张关键视图**。这不是共享库最终总表数；既有财务、账号、消息、会员/HBTI 和过渡兼容对象仍会存在。其中 4 张账单级表受 RES 稳定来源 ID 门禁约束：门禁不通过就不创建空壳表，网站继续使用明确标为 aggregate 的销售事实，精确账单折扣/退款能力保持未完成。

### 4.1 73 张规范核心表

| 域 | 数量 | 物理表 |
|---|---:|---|
| 治理与共享身份 | 15 | `schema_migrations`, `app_audit_log`, `ops_store`, `ops_store_source_identity`, `pos_sellable_product`, `pos_product`, `ops_product_mapping_review`, `hr_person`, `hr_employment`, `hr_employment_source_identity`, `hr_identity_mapping_review`, `scm_supplier`, `scm_supplier_item`, `scm_item_mapping_review`, `cost_card_product_link` |
| POS 事实 | 8 | `pos_ingest_batch`, `pos_daily_revenue`, `pos_item_hourly_sales`, `pos_item_waste`, `pos_order`, `pos_order_item`, `pos_payment`, `pos_refund` |
| 营运、预测、计划、执行与班表 | 23 | `ops_calendar_import_batch`, `ops_calendar_event`, `ops_demand_factor_observation`, `ops_operational_event`, `ops_operational_event_product`, `ops_forecast_run`, `ops_forecast_line`, `ops_production_plan`, `ops_production_plan_version`, `ops_production_plan_line`, `ops_production_plan_slot`, `ops_plan_adjustment`, `ops_production_output`, `ops_production_output_line`, `ops_dispatch`, `ops_dispatch_line`, `ops_role`, `ops_station`, `ops_role_training_requirement`, `ops_shift_plan`, `ops_shift_plan_version`, `ops_shift_requirement`, `ops_shift_assignment` |
| 人事 | 10 | `hr_assessment`, `hr_assessment_item_score`, `hr_offer`, `hr_onboarding_task`, `hr_training_course`, `hr_training_course_version`, `hr_training_assignment`, `hr_training_result`, `hr_timesheet_sync_batch`, `hr_timesheet_entry` |
| 供应链 | 11 | `scm_material_requirement_run`, `scm_material_requirement_line`, `scm_inventory_snapshot`, `scm_replenishment_run`, `scm_replenishment_line`, `scm_purchase_order`, `scm_purchase_order_revision`, `scm_purchase_order_line`, `scm_goods_receipt`, `scm_goods_receipt_line`, `scm_supplier_price_observation` |
| 成本卡 | 6 | `cost_card_item`, `cost_card_recipe`, `cost_card_recipe_item`, `cost_card_item_price`, `cost_card_product_cost_snapshot`, `cost_card_product_cost_snapshot_component` |

### 4.2 16 张关键视图

| 视图 | 粒度 | 用途 |
|---|---|---|
| `v_pos_daily_sales` | 门店×营业日 | 营收、单量、客单；优先账单事实，聚合来源作为降级路径 |
| `v_pos_source_reconciliation` | 门店×营业日×来源 | 日报、小时、账单合计对账 |
| `v_hr_role_eligibility` | 雇佣关系×岗位×日期 | 培训通过且未过期的可上岗资格 |
| `v_ops_shift_publish_readiness` | 班表版本 | 关键岗位覆盖、资格和时间冲突检查 |
| `v_ops_plan_vs_output` | 门店×日×产品 | 发布计划与实际生产偏差 |
| `v_ops_output_vs_dispatch` | 门店×日×产品 | 实际生产与实际发出偏差 |
| `v_ops_plan_vs_dispatch` | 门店×日×产品 | 计划到前场执行偏差 |
| `v_ops_product_mix_daily` | 门店×日×产品 | 数量占比、净销售额占比、环比/同比变化 |
| `v_ops_forecast_accuracy` | 预测运行×产品 | 预测、计划、售出、缺货影响后的误差 |
| `v_ops_labor_productivity` | 门店×日×工作区域 | 营收/实际工时、单量/实际工时 |
| `v_ops_daily_product_margin` | 门店×日×产品 | 净收入、当日单位成本、销量成本、毛利额/率、覆盖状态 |
| `v_cost_card_item_cost_quality` | 成本卡成品/产品 | 配方、价格、映射、有效期和零销售安全检查 |
| `v_finance_sales_reconciliation` | 门店×月 | POS 与财务收入差异 |
| `v_finance_purchase_reconciliation` | 门店×供应商×月 | PO/收货与供应商月结差异 |
| `v_finance_labor_reconciliation` | 门店×月 | Lark 实际工时、排班与财务人工金额对账 |
| `v_finance_margin_summary` | 门店×日/月 | 商品毛利、报废成本、成本覆盖率与财务口径桥接 |

### 4.3 当前对象到目标对象的迁移对照

| 当前对象/流程 | 目标对象 | 迁移动作 |
|---|---|---|
| `finance_store` 文本、空的 `ops_store` | `ops_store + ops_store_source_identity` | 逐来源人工确认映射；财务文本仅作来源身份 |
| 旧 `product` 与 `pos_product.item_key` | `pos_sellable_product + pos_product` | 企业产品与 POS listing 分开；保留 item/listing 来源键 |
| `daily_revenue` | `pos_daily_revenue` | 双写、按门店/营业日对账；旧约束在全部写者切换后退休 |
| `item_hourly_sales` | `pos_item_hourly_sales` | 补 store/product/batch；同名不再是唯一键 |
| `item_waste` | `pos_item_waste` | 保留原始原因、标准原因和映射版本 |
| `scrape-order-analysis.mjs` 临时结果 | `pos_order/_item/_payment/_refund` | 先证明稳定外部 ID；证明失败则保持空表与 aggregate 口径 |
| `forecast_snapshot` 覆盖式快照 | `ops_forecast_run/_line` | 每次运行留痕并锁定输入版本 |
| `plan-generator.ts` 内存计划/Excel | `ops_production_plan/_version/_line/_slot` | 上传和自动预测都生成不可变版本 |
| “确认计划”口头代表实际 | `ops_production_output/* + ops_dispatch/*` | 实际制作和实际发出独立录入，不能由发布计划自动生成 |
| `holiday/context_event` | `ops_calendar_import_batch/event + ops_operational_event` | 官方日历、观察因子、突发事实分开 |
| `applications/appointments/trials/employees` | 原表 + `hr_person/hr_employment` FK | 先增量补身份，不做美容式改名 |
| `fact_shift` 姓名/岗位文本 | `ops_shift_plan/_version/_requirement/_assignment` | 计划版本、岗位需求、员工指派分开 |
| Lark 月度实际工时表 | `hr_timesheet_sync_batch/_entry` | 每日单元格为事实，总计仅校验；姓名先过映射队列 |
| `finance_supplier_orders` 月结 | `scm_purchase_order/* + scm_goods_receipt/*` | 新对象负责日常执行，财务表只做月结对账 |
| 现有成本卡五表 | 原表扩充 + `cost_card_product_cost_snapshot/*` | 复用配方版本，新增来源化价格与交易日成本锁定 |
| 当前 `v_daily_margin` | `v_ops_daily_product_margin` | 从“当前成本回算历史”改成“交易日成本快照”，带覆盖状态 |

### 4.4 人工录入与自动产生边界

| 必须人工确认/录入 | 自动抓取或计算 |
|---|---|
| 门店、产品、人员、供应商 SKU 的歧义映射 | RES 销售、报废、订单/支付/退款（来源支持时） |
| 明日增减动作、原因、审批 | 预测 run、产品占比、预测误差 |
| 当日突发事件和证据 | 官方节假日候选抓取、来源文件 checksum |
| 实际生产、实际发出、盘点、收货/拒收 | 发布计划展开原料需求、补货建议、MOQ 取整 |
| 系统建议量的人工改量及理由 | Lark 日工时读取、计划/实际差异、人效 |
| 供应商报价/实际价批准、价格有效期 | 配方×有效价格计算成本快照和当日毛利 |
| 培训结果证据、关键岗位最终排班批准 | 岗位资格与关键岗位覆盖校验 |

原则是“人工只录判断、动作和证据；机器已能取得或重算的数据不重复录”。

### 4.5 网站功能到数据库依赖

| 网站功能 | 必须依赖的规范对象 | 切换后的结果 |
|---|---|---|
| 财务站成本卡新增/修改配方 | `cost_card_item/recipe/recipe_item` | 继续使用现有成熟表，不重建平行配方系统 |
| 财务站原料价格 | `scm_supplier/_item/price_observation` → `cost_card_item_price` | 看得到供应商、门店、采购单位、来源、批准和有效期 |
| 财务站当日毛利 | `pos_*` + `cost_card_product_cost_snapshot/*` + `v_ops_daily_product_margin` | 使用交易日成本，显示覆盖率/估算状态，历史不被当前价改写 |
| 财务站月度报表 | 原 `finance_*` + `v_finance_*_reconciliation` | 保留会计/月结事实，同时看销售、采购、人工和毛利差异 |
| BakeryOps 门店预估单 | `ops_forecast_run/* + ops_production_plan/*` | 一次提交多表、版本不可覆盖、可比较 forecast 与人工调整 |
| BakeryOps 明日动作/当日突发 | `ops_plan_adjustment + ops_operational_event/*` | 能回答发生什么、明天改什么、谁批准、效果如何 |
| BakeryOps 生产复盘 | `ops_production_output/* + ops_dispatch/* + pos_*` | 计划、生产、发出、售出、报废不再混为一个数量 |
| BakeryOps 订货表 | `scm_material_requirement_*`, `scm_inventory_snapshot`, `scm_replenishment_*`, `scm_purchase_order_*`, `scm_goods_receipt_*` | 建议量、批准量、PO 修订和实际到货价全链可追踪 |
| BakeryOps 人事/班表 | `hr_person/employment/assessment/offer/onboarding/training` + `ops_shift_*` | 评分到入职、培训资格、关键岗位发布和人员指派贯通 |
| BakeryOps 人效 | `hr_timesheet_* + v_pos_daily_sales + v_ops_labor_productivity` | 实际工时与计划班表分开，数据口径可解释 |

账单来源门禁未通过时，除“精确到单的折扣/支付/退款”外，上述聚合销售、成本卡和日毛利功能仍可运行，但必须标记 aggregate/estimated，不能向用户展示伪精确度。

## 5. 全局不变量与验收门槛

### 5.1 主键与时间

- 新的跨域业务身份使用 UUID；来源系统字符串 ID 单独存，不拿来源显示名做 PK/FK。现有 bigint/text PK 不为追求整齐强拆，而是先增加唯一 UUID 身份并让跨域 FK 切换，旧键只在兼容期保留。
- 所有业务日使用 `date`，所有事件时间使用 `timestamptz`；营业日按门店时区（默认 `Asia/Kuala_Lumpur`）计算。
- 所有数量、金额、单价、成本使用 `numeric`，不得用浮点数；金额明确币种，默认不能从代码隐含 MYR。
- 版本表发布后不可原地修改；修订生成新版本。
- 有效期采用 `[effective_from, effective_to)` 半开区间；同一范围内不能有两个已批准版本重叠。

### 5.2 映射与质量门槛

- 活跃 RES 门店来源映射 100%；
- 新 POS 事实的来源商品 ID 100%，未能落 `product_id` 的记录进入映射队列并保留原值；
- 毛利网站切换前：销售额成本映射覆盖率至少 99%，Top 20 产品 100%，未覆盖产品必须显式标记而不是按零成本；
- 班表发布前：被指派员工 100% 有有效 `employment_id`；所有关键岗位 100% 覆盖且资格有效；
- PO 发布前：所有采购行 100% 有 `material_id + supplier_item_id`；
- 每个导入/抓取批次有 `started/completed/failed/partial` 状态、期望行数、实际行数和完整性判定。

### 5.3 并行对账门槛

- POS：连续 14 个营业日，新旧每日数量和金额在允许舍入误差 RM 0.01 内一致；
- 计划/执行：连续 14 个营业日所有已发布版本和明细可回读，且没有覆盖历史版本；
- 成本/毛利：连续 30 个自然日快照可重算，单位成本差异不超过 RM 0.0001，销售毛利汇总误差不超过 RM 0.01；
- 人事/工时：至少一个完整工资月；
- 供应链：至少一个完整“建议→批准→PO 修订→收货→财务对账”周期，且不少于 30 日；
- 任一旧对象退休前，生产日志连续 14 日无旧写者/旧读者，并取得对象所有者签字。

## 6. 全局迁移编号和文件归属

迁移文件采用 `YYYYMMDDNN_description.sql` 的全局 ID；例：`2026080531_ops_forecast_and_plan.sql`。编号是全库唯一的作者序号，不代表必须在该日上线。`schema_migrations.version` 迁为 `bigint`。

| ID | 所属仓库/目录 | 域 |
|---:|---|---|
| 2026080501 | 财务站 `sql/` | 迁移治理 |
| 2026080510 | `bakery-ops/src/modules/data/migrations/` | 门店身份 |
| 2026080511 | `res_api/migrations/` | POS 产品身份 |
| 2026080512 | 财务站 `sql/` | 产品到成本卡成品的证据化映射 |
| 2026080513 | `bakery-ops/src/modules/data/migrations/` | 产品映射人工审核队列 |
| 2026080514 | 财务站 `sql/` | 成本卡原料 UUID 身份 |
| 2026080520 | `res_api/migrations/` | POS 聚合来源事实 |
| 2026080521 | `res_api/migrations/` | POS 账单/支付/退款事实 |
| 2026080530 | `bakery-ops/src/modules/data/migrations/` | 日历与突发事件 |
| 2026080531 | 同上 | 预测和生产计划 |
| 2026080532 | 同上 | 实际生产与实际发出 |
| 2026080540 | 同上 | 人员、雇佣、评分 |
| 2026080541 | 同上 | offer、入职、培训 |
| 2026080542 | 同上 | 岗位与版本化班表 |
| 2026080543 | 同上 | Lark 实际工时 |
| 2026080550 | 同上 | 供应商与供应商 SKU |
| 2026080551 | 同上 | 原料需求、库存、补货 |
| 2026080552 | 同上 | PO 修订与收货 |
| 2026080560 | 财务站 `sql/` | 成本卡供应商价格扩展 |
| 2026080561 | 财务站 `sql/` | 日成本快照与组件 |
| 2026080570 | BakeryOps 迁移目录 | 营运分析视图 |
| 2026080571 | 财务站 `sql/` | 财务对账视图 |
| 2026080580 | 财务站 `sql/` | 运行时角色、授权和 RLS 收口 |

旧对象的 DROP/重命名不预先塞进上述迁移；只有 Task 20 的退出证据全部满足后，另行生成带当时全局 ID 的退休迁移并单独审批。

## 7. 分阶段实施任务

### Task 0: 建立干净执行边界并恢复财务网站

**Files:**
- Modify: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/.vercelignore`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/test/vercel-bundle-boundary.test.js`
- Modify: `/Users/weiliangshao/hot/HANDOFF.md`

- [ ] 分别记录 hot 仓库和财务站的 `git status --short --branch`、当前提交、远端和未提交文件归属；不得覆盖现有蓝图和迁移 109。
- [ ] 为本计划实施创建 `codex/database-blueprint-transition` 工作分支；如果同目录有其他 agent 正在修改，先停止而不是切分支。
- [ ] 在测试中断言 Vercel 打包规则不会排除 `api/_lib/**`，先运行并确认当前规则失败。
- [ ] 最小修改 `.vercelignore`，只取消对 `api/_lib` 的误排除；不借机改其他部署规则。
- [ ] 在财务站运行 `npm test`，要求全部通过。
- [ ] 预构建或检查 Vercel bundle，证明 `api/_lib/cost-card-modules.js`、数据库和鉴权依赖进入产物。
- [ ] 经人批准后部署财务站；对 `/api/sales`、`/api/finance`、`/api/cost-dashboard` 做已认证冒烟测试，要求不再 500。
- [ ] 将部署 URL、commit、API 状态和回滚 deployment 写入 `HANDOFF.md`。

**Gate:** 财务 API 未恢复前，Task 1 之后的任何生产迁移禁止执行。

### Task 1: 冻结生产基线与可恢复证据

**Files:**
- Create: `bakery-ops/scripts/audit-database-foundation.ts`
- Create: `bakery-ops/src/__tests__/unit/audit-database-foundation.test.ts`
- Create: `docs/database/current-baseline-2026-08-05.md`
- Create: `docs/database/object-owner-register.csv`

- [ ] 先写纯函数测试：相同目录对象和数据库对象应得出 `matched/missing_file/missing_registry/checksum_missing` 四种状态。
- [ ] 运行 `cd bakery-ops && npx vitest run src/__tests__/unit/audit-database-foundation.test.ts`，确认实现前失败。
- [ ] 实现只读审计脚本，导出表/视图、列、PK/FK/unique/check、RLS、函数、触发器、依赖、估算行数、`schema_migrations` 和四个写者矩阵；脚本必须以 `BEGIN READ ONLY` 开始。
- [ ] 给每个共享对象登记 `owner_repo / writer / readers / grain / retirement_gate`；无法确定的写 `unknown`，不猜。
- [ ] 从生产导出 schema-only 快照和迁移台账；不得导出业务数据或秘密到 Git。
- [ ] 核对 107/108/109 的生产定义与仓库文件。只有字节级/结构级证据一致时才能标为 verified；25 个缺 checksum 的历史行保持 `legacy_unverified`。
- [ ] 在 Supabase 管理侧确认最近可恢复点/备份策略；在本地一次性 PostgreSQL 中演练 schema 恢复并记录命令和结果。
- [ ] 把基线摘要写入 `docs/database/current-baseline-2026-08-05.md`，敏感连接信息不得入库。
- [ ] 运行单测、`npx tsc --noEmit`，提交审计脚本和基线文档。

### Task 2: 先治理迁移账本，再建业务表

**Files:**
- Modify: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/scripts/apply-migrations.js`
- Modify: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/test/migration-chain.test.js`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/sql/2026080501_schema_migration_governance.sql`
- Modify: `bakery-ops/scripts/check-migrations.ts`
- Modify: `bakery-ops/src/__tests__/unit/check-migrations.test.ts`

- [ ] 写失败测试：解析 10 位 ID、重复 ID、同 ID 不同 checksum、旧行缺 checksum、`--file` 单文件执行、owner 前缀不匹配、并发执行锁。
- [ ] 运行财务站 `node --test test/migration-chain.test.js`，确认现有三位解析实现不能通过。
- [ ] 修改 runner：从文件名开头的完整数字 token 解析 `bigint`；支持 `--file <path>`；每个新文件必须含 `-- hotcrush:owner_repo=<repo>` 元数据。
- [ ] 在同一事务中调用全库统一 advisory lock，例如 `pg_advisory_xact_lock(hashtextextended('hotcrush-schema-migrations', 0))`；DDL、registry insert、执行审计必须原子完成。
- [ ] 新迁移必须记录 `filename/checksum/owner_repo/execution_id/applied_by/applied_at/verification_state`；已存在但缺 checksum 的历史行只能标 `legacy_unverified`，绝不伪造 checksum。
- [ ] 由 `app_` 域提供只追加的 `app_record_audit_event(...)` 数据库函数；各运行时只获 EXECUTE，函数校验调用域并写 `app_audit_log`，不授予直接改表权限；若使用 `SECURITY DEFINER`，固定安全 `search_path`、撤销 PUBLIC EXECUTE 并拒绝调用者伪造 actor/domain。
- [ ] 迁移 2026080501 将 `version` 改为 `bigint`，增加上述治理列和约束，并给表写清粒度/写者注释。
- [ ] runner 默认仍识别 027–084 的现有白名单；新跨仓迁移通过 `--file` 精确应用，不扫描用户目录或自动执行未知 SQL。
- [ ] owner 检查至少阻止：BakeryOps 文件创建 `cost_card_`，财务站文件创建 `ops_`，`res_api` 文件创建 `hr_`。
- [ ] 更新 BakeryOps 的只读对账脚本以支持 10 位 ID、owner/checksum/verification_state。
- [ ] 在本地临时 PostgreSQL 并发启动两个相同迁移，验收只应用一次，另一进程报告 already applied。
- [ ] 运行财务站完整 `npm test` 和 BakeryOps 对应 Vitest；提交 runner 与治理迁移，但生产执行需单独审批。

### Task 3: 建立共享 schema 集成门禁

**Files:**
- Create: `database/README.md`
- Create: `database/contracts/object-ownership.json`
- Create: `database/contracts/canonical-objects.json`
- Create: `scripts/verify-shared-database.mjs`
- Create: `scripts/test-shared-migrations.sh`
- Create: `bakery-ops/src/__tests__/unit/shared-database-contract.test.ts`

- [ ] 将第 4 节的 73 表/16 视图和 owner 写成机器可读契约；测试拒绝重复对象、无 owner、新表无 COMMENT、视图缺 `security_invoker`。
- [ ] 本地启动一次性 PostgreSQL 17，按生产已核验顺序灌入现有 schema，再按本计划迁移 ID 灌入新文件。
- [ ] 每个迁移后运行 `pg_dump --schema-only` 并检查无意外 DROP/RENAME、无跨域写权。
- [ ] 集成脚本依次跑：财务站静态 DB 集成、BakeryOps schema contract、`res_api` SQL 列契约、HBTI 权限契约。
- [ ] 失败时保留 schema diff 和失败迁移 ID，不保留生产数据。
- [ ] 文档化一条本地命令完成上述门禁；后续每个 Task 都必须进入该门禁。

### Task 4: 建企业门店身份

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080510_ops_store_and_source_identity.sql`
- Modify: `bakery-ops/src/modules/data/repositories/store.repository.ts`
- Create: `bakery-ops/src/__tests__/unit/store-identity.repository.test.ts`
- Modify: `bakery-ops/src/modules/data/repositories/application.repository.ts`

- [ ] 写失败测试：一个企业门店可映射 RES shop、财务 store 文本、Lark 表；同一来源 ID 不能指向两个门店；停用映射不能用于新事实。
- [ ] 迁移为 `ops_store` 增加 UUID `store_id` 唯一键，保留当前 `store_code` 兼容键；不要直接 drop 当前 PK。
- [ ] 新建 `ops_store_source_identity(store_source_identity_id, store_id, source_system, source_external_id, valid_from, valid_to, status, evidence, created_at)`，约束生效期内来源 ID 唯一。
- [ ] 用当前 RES `shop_id`、财务门店文本和 Lark 来源建立一份人工审核种子清单；必须逐条确认后才写生产。
- [ ] 为能明确归属的现有记录分批回填 `store_id`，每批输出待影响行数和无法归属清单；禁止 `COALESCE(..., pavilion_id)` 式默认填充。
- [ ] 应用/仓储层改为同时返回 `store_id + store_code`；现有 API 暂时继续接受 `store_code`。
- [ ] 所有 FK 与写者切到 UUID 后，在 Task 21 的独立退休迁移中把 `store_id` 提升为 PK、`store_code` 降为业务唯一键；在此之前不提前切 PK。
- [ ] 运行仓储测试、全量 Vitest、类型检查和 shared-schema 门禁。

### Task 5: 建企业产品/原料身份和映射审核

**Files:**
- Create: `res_api/migrations/2026080511_pos_product_identity.sql`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/sql/2026080512_cost_card_product_identity_link.sql`
- Create: `bakery-ops/src/modules/data/migrations/2026080513_ops_product_mapping_review.sql`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/sql/2026080514_cost_card_material_identity.sql`
- Modify: `res_api/sync-catalog.mjs`
- Modify: `res_api/test/sync-to-db.test.js`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/test/cost-card-product-identity-link.test.js`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/test/cost-card-material-identity.test.js`
- Modify: `bakery-ops/src/modules/data/repositories/product.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/product-mapping.repository.ts`
- Create: `bakery-ops/src/__tests__/unit/product-mapping.repository.test.ts`

- [ ] 写失败测试覆盖：同名不同 RES item、同产品不同门店 listing、产品更名、停用 listing、无法确认映射。
- [ ] 新建 `pos_sellable_product(product_id, product_code, canonical_name, category_id, status, created_at, updated_at)`；业务产品一行一个稳定 ID。
- [ ] 扩充现有 `pos_product`，把它定义为来源 listing：新增内部 UUID `listing_id`，保留 `item_key`，增加 `product_id/store_id/source_system/source_listing_id/effective_from/effective_to`；所有读者切换后再把 `listing_id` 提升为 PK。
- [ ] 由 BakeryOps 的 2026080513 新建 `ops_product_mapping_review`，保存来源键、候选 product、置信原因、状态、reviewer、evidence；自动匹配只能生成候选，不能自动批准歧义同名商品。
- [ ] 由财务站的 2026080512 扩充现有 `cost_card_product_link`，增加 `product_id`、mapping evidence、approved_by/at、valid_from/to；保留旧 `pos_item_id` 到读者切换结束。`res_api` 迁移不得改 `cost_card_` 表。
- [ ] 由财务站 2026080514 为现有 `cost_card_item` 增加唯一 UUID `material_id`，保留 bigint `id` 给现有配方/成本卡兼容；所有未来 SCM 跨域 FK 只引用 `material_id`。
- [ ] 用 RES 稳定 item/listing ID 创建产品，不用中文/英文显示名做唯一键。
- [ ] 生成三份报告：POS→product、product→成本卡、无法映射；分别显示产品数和销售额覆盖率。
- [ ] 验收活跃 POS listing 100% 有 `product_id` 或明确 `review_required`，不能静默丢行。

### Task 6: 建 POS 批次、日营收、小时单品和报废规范事实

**Files:**
- Create: `res_api/migrations/2026080520_pos_ingest_and_aggregate_facts.sql`
- Modify: `res_api/sync-to-db.js`
- Modify: `res_api/scrape-intraday.mjs`
- Modify: `res_api/run-refresh.mjs`
- Modify: `res_api/test/sync-to-db.test.js`
- Create: `res_api/test/intraday-product-identity.test.js`
- Create: `res_api/test/ingest-batch-completeness.test.js`

- [ ] 写失败测试：盘中与夜间链都写 `store_id/item_key/product_id/batch_id`；同名商品不合并；不同门店同小时不冲突；partial 批次不替代 complete 批次。
- [ ] 新建 `pos_ingest_batch`，记录门店、数据集、来源窗口、抓取开始/结束、expected/actual rows、checksum、状态和错误摘要。
- [ ] 新建 `pos_daily_revenue`、`pos_item_hourly_sales`、`pos_item_waste`，每张表都引用 `store_id/product_id/source_batch_id`，并保留来源 item/name/reason 原值。
- [ ] 同一 `res_api` 迁移建立 aggregate 版本的 `v_pos_daily_sales` 与 `v_pos_source_reconciliation`；Task 7 的账单来源门禁通过后才由 2026080521 替换为账单优先定义。
- [ ] `pos_item_hourly_sales` 唯一粒度至少为 `store_id + business_date + hour + source_listing_id + source_batch_id`；不要沿用名称唯一。
- [ ] `pos_item_waste` 同时保存 `waste_reason_raw`、标准原因和 `mapping_version`。
- [ ] 修改盘中抓取，补当前缺失的 `item_key` 和门店来源身份；修改夜间链使用相同转换函数。
- [ ] 写者采用一个批次事务或 staging→commit 流程：只有所有分页、行数护栏和写入完成后才把 batch 标成 `completed`。
- [ ] `DATA_MODEL_MODE=legacy|dual_write|shadow_read|canonical`；初始生产只能设 `dual_write`，不能直接切 canonical。
- [ ] 对能由已确认 shop 身份和 item 身份确定的历史数据回填新表；无法确定门店/产品的行进入隔离报告，不猜填。
- [ ] 连续 14 个营业日对账 `qty/net_sales/gross_sales/waste_qty`；达到第 5 节门槛后再把读取切到 shadow。

### Task 7: 验证并建立账单、行、支付和退款事实

**Files before the source gate:**
- Modify: `res_api/scrape-order-analysis.mjs`
- Create: `res_api/test/order-source-contract.test.js`
- Create: `docs/database/res-order-source-evidence.md`

**Files only after the source gate passes:**
- Create: `res_api/migrations/2026080521_pos_order_payment_refund.sql`
- Create: `res_api/test/order-fact-idempotency.test.js`

- [ ] 先用只读探针验证 RES report 211 或替代接口是否提供稳定 `order_id/order_line_id/payment_id/refund_id`；记录分页、取消、折扣、税、退款和跨日语义。
- [ ] 明确拒绝把 `businessDate + openedTime` 时间桶当订单 ID；当前观察到时间桶可包含多单。
- [ ] 若稳定 ID 不存在，记录 source gap并在本 Task 停止：不创建/应用 2026080521 的空壳表，`v_pos_daily_sales` 继续使用聚合事实；不得伪造明细。
- [ ] 若稳定 ID 存在，写失败测试覆盖重复抓取幂等、部分退款、多支付方式、整单取消、行折扣、订单跨午夜。
- [ ] 新建 `pos_order`、`pos_order_item`、`pos_payment`、`pos_refund`，保留来源 JSON checksum/批次外键；PII 不复制到分析事实。
- [ ] 唯一约束使用 `source_system + store_id + source_external_id`，不是显示号或时间。
- [ ] 账单导入先 shadow，与 `pos_daily_revenue` 连续 14 日对账；日净销售、税、折扣、退款差异均需可解释。
- [ ] 由同一 `res_api` 迁移重建 `v_pos_daily_sales/v_pos_source_reconciliation` 为“完整账单批次优先、聚合事实降级”；不能让 BakeryOps 或财务迁移取得 `v_pos_*` 定义权。
- [ ] 只有稳定 ID 和对账同时通过后，`v_pos_daily_sales` 才优先订单事实；否则页面明确标记 aggregate source。

### Task 8: 建官方日历、需求因子和当日突发事实

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080530_ops_calendar_and_events.sql`
- Create: `bakery-ops/src/modules/domain/calendar/official-calendar-import.service.ts`
- Create: `bakery-ops/src/modules/data/repositories/calendar-import.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/operational-event.repository.ts`
- Modify: `bakery-ops/src/modules/data/repositories/holiday.repository.ts`
- Modify: `bakery-ops/src/bootstrap.ts`
- Create: `bakery-ops/src/__tests__/unit/official-calendar-import.test.ts`
- Create: `bakery-ops/src/__tests__/unit/operational-event.repository.test.ts`

- [ ] 写失败测试：同一官方文件重复抓取幂等；联邦/州/直辖区适用范围分开；官方修订产生新批次；人工事件不被抓取覆盖。
- [ ] 新建 `ops_calendar_import_batch`，保存权威来源 URL、文件 SHA-256、fetched_at、parser_version、状态和人工批准信息。
- [ ] 新建 `ops_calendar_event`，粒度为 `jurisdiction + date + event_type + source_batch`，再通过适用范围关联门店。
- [ ] 新建 `ops_demand_factor_observation`；这是事件发生后观察到的影响，不与官方节假日事实混为一列 coefficient。
- [ ] 旧 `holiday.coefficient` 是预测假设，不是假日事实也不是事后观察；不得直接回填到 observation。未来算法采用已验证 observation，单次人工判断进入 `ops_plan_adjustment`，历史 coefficient 只作为 legacy evidence 保留。
- [ ] 新建 `ops_operational_event` 与 `ops_operational_event_product`，记录停电、设备故障、天气、团单、缺货等起止时间、影响、证据、产品范围和处置动作。
- [ ] 权威来源优先使用马来西亚首相署 BKPP 的 [Hari Kelepasan Am](https://www.kabinet.gov.my/hari-kelepasan-am/) 页面和公报/PDF；截至本计划日期，[data.gov.my 数据集目录](https://data.gov.my/data-catalogue/datasets) 未确认专门的公共假日机器 API，因此不得把第三方 API 静默标成 official。
- [ ] 抓取器允许“下载官方文件→解析候选→人工确认→发布”；临时新增假日通过新公报批次修订，不直接覆盖历史。
- [ ] 在现有 BakeryOps 调度器增加每日只读检查和每周完整抓取，全部使用 KL 时区、`wrapCron` 告警与批次幂等；自动任务只生成/更新候选，发布仍需人工批准。
- [ ] 旧 `holiday` 暂时作为兼容读模型；新写入只进 `ops_calendar_*`，shadow 对账通过后再切页面。

### Task 9: 建版本化预测和门店预估单

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080531_ops_forecast_and_production_plan.sql`
- Create: `bakery-ops/src/modules/data/repositories/forecast-run.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/production-plan.repository.ts`
- Modify: `bakery-ops/src/modules/domain/forecast/forecast.service.ts`
- Modify: `bakery-ops/src/modules/domain/forecast/types.ts`
- Modify: `bakery-ops/src/modules/domain/production-plan/plan-generator.ts`
- Modify: `bakery-ops/src/app/(forecast)/forecast-actions.ts`
- Modify: `bakery-ops/src/app/(forecast)/import-actions.ts`
- Modify: `bakery-ops/src/ui/components/pages/production-page.tsx`
- Create: `bakery-ops/src/__tests__/unit/forecast-run.repository.test.ts`
- Create: `bakery-ops/src/__tests__/unit/production-plan-version.test.ts`

- [ ] 写失败测试：同日多次预测不覆盖；计划 draft→submitted→approved→published；发布版本不可修改；Excel 重传生成新版本；调整保存 delta 和理由。
- [ ] 新建 `ops_forecast_run` 与 `ops_forecast_line`，run 保存目标日、store、算法版本、输入 batch/日历/事件版本、运行时间、状态；line 保存 product、预测量、上下界和说明。
- [ ] 新建 `ops_production_plan`，粒度固定 `store_id + business_date`；唯一但不包含版本内容。
- [ ] 新建 `ops_production_plan_version`、`ops_production_plan_line` 与 `ops_production_plan_slot`；版本来源限定 `forecast_auto/excel_upload/manual_adjustment`，状态限定 draft/submitted/approved/published/superseded。Excel 入口强制一份文件只含一个 store/business_date，并在 version 保存 filename、SHA-256、parser_version、uploaded_by；混合门店/日期直接拒绝。
- [ ] 新建 `ops_plan_adjustment`，记录目标 plan、基准版本、product、增减量、原因、当日/明日动作、提交人、审批人和生成的新版本。
- [ ] 把当前 `saveForecastSnapshot()` 的 fire-and-forget 改为显式 await，并在失败时让工作流返回保存失败；不得显示成功但数据库没写。
- [ ] 一次 BakeryOps 提交使用一个事务：创建版本、产品行、时段、调整证据，并通过受控函数追加审计；跨表更快来自一次事务，不来自把所有字段塞进一张宽表。
- [ ] 旧 `forecast_snapshot` 只做兼容输出，不再作为未来 source of truth；shadow 阶段比较旧建议量与新 published plan。
- [ ] UI 显示版本号、来源、状态、提交/批准/发布时间和变更差异；不允许编辑已发布版本。

### Task 10: 分开实际生产、实际发出和销售

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080532_ops_production_output_and_dispatch.sql`
- Create: `bakery-ops/src/modules/data/repositories/production-output.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/dispatch.repository.ts`
- Create: `bakery-ops/src/modules/domain/production-plan/execution.service.ts`
- Modify: `bakery-ops/src/ui/components/pages/production-page.tsx`
- Create: `bakery-ops/src/__tests__/unit/production-execution.test.ts`

- [ ] 写失败测试：发布计划不能自动生成 actual；实际生产可分多批；发出量可小于生产量；售出量来自 POS；三者均可为零且含不同原因。
- [ ] 新建 `ops_production_output` 与 `ops_production_output_line`，记录制作地点、批次时间、product、实际量、报废/留样说明、录入来源和证据。
- [ ] 新建 `ops_dispatch` 与 `ops_dispatch_line`，记录从后厨到前场/门店的一次实际发出，支持批次和接收确认。
- [ ] UI 将“确认计划”“录入实际生产”“确认发出”拆成三个动作；只有业务事实发生时才写相应表。
- [ ] 自动计算 plan→output、output→dispatch、dispatch→sales 差异；这些结果进入视图，不人工录入。
- [ ] 连续 14 个营业日验证每个已发布计划能解释是否有 actual、未执行原因或缺失状态。

### Task 11: 建人员、雇佣和评分事实

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080540_hr_identity_and_assessment.sql`
- Modify: `bakery-ops/src/modules/data/repositories/employee.repository.ts`
- Modify: `bakery-ops/src/modules/data/repositories/application.repository.ts`
- Modify: `bakery-ops/src/modules/data/repositories/appointment.repository.ts`
- Modify: `bakery-ops/src/modules/data/repositories/trial.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/assessment.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/hr-identity-mapping.repository.ts`
- Create: `bakery-ops/src/__tests__/unit/hr-identity-chain.test.ts`

- [ ] 写失败测试：同一自然人多次应聘只有一个 person；一人可有多段 employment；重名不能自动合并；评分项有证据和评分模板版本。
- [ ] 新建 `hr_person`，PII 最小化；电话/邮箱规范化值仅用于受控匹配，不作为公共显示键。
- [ ] 新建 `hr_employment(person_id, store_id, employee_no, source_job_title, start_date, end_date, status)`；班表和工时只引用 employment。Task 13 建好 `ops_role` 后再增加可空 `primary_role_id` FK，不能让自由文本岗位成为跨表键。
- [ ] 新建 `hr_employment_source_identity` 映射 Lark employee/open_id、招聘 application、历史 employee 等来源。
- [ ] 新建 `hr_identity_mapping_review`；重名、缺 employee_no、跨表冲突必须人工确认。
- [ ] 新建 `hr_assessment` 与 `hr_assessment_item_score`，保存评估轮次、评分模板版本、评分项、分值、证据和结论。
- [ ] 为 `applications / appointments / trials` 增加可空 `person_id/employment_id` 外键；先双读，不立刻重命名或删除原表。
- [ ] 人工核对所有即将入班表或实际工时的人员，要求 100% employment 映射后再进入 Task 13。

### Task 12: 补齐 offer、入职任务和培训资格

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080541_hr_onboarding_and_training.sql`
- Modify: `bakery-ops/src/modules/data/repositories/offer.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/onboarding.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/training.repository.ts`
- Create: `bakery-ops/src/modules/domain/employee/role-eligibility.service.ts`
- Create: `bakery-ops/src/__tests__/unit/onboarding-training-eligibility.test.ts`

- [ ] 写失败测试：accepted offer 才能建 employment；入职任务逐项完成；培训版本更新不改历史结果；过期培训失去关键岗位资格。
- [ ] 先全仓复查 `offers` 写法；当前已观察写者是普通 INSERT/UPDATE、未见 `ON CONFLICT`。在同一事务把现有 `offers` 重命名为 `hr_offer`、补 `person_id/store_id` UUID、offer 版本、岗位、薪资口径、发出/接受/拒绝时间和证据，再建立可更新的 `offers` 兼容视图并设置 `security_invoker=true`；敏感字段按现有授权保护。
- [ ] 新建 `hr_onboarding_task`，粒度为 employment×任务，保存 owner、due date、完成证据和状态。
- [ ] 新建 `hr_training_course` 稳定课程身份及 `hr_training_course_version` 内容/及格线/有效期版本。
- [ ] 新建 `hr_training_assignment` 与 `hr_training_result`；result 保存尝试、分数、通过、完成时间、证据和有效至。
- [ ] 角色资格由培训结果、课程版本和有效期自动计算，不让管理者在员工表手填 `qualified=true`。
- [ ] 将当前 offer repository 切到 `hr_offer`，确认无旧读写后再在 Task 21 退休 `offers` 兼容视图；若实施时新增了 `ON CONFLICT`，改名必须与写者发布处于同一维护窗口，不能依赖兼容视图写入。

### Task 13: 建岗位、关键岗位和版本化班表

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080542_ops_role_and_shift_plan.sql`
- Create: `bakery-ops/src/modules/data/repositories/shift-plan.repository.ts`
- Create: `bakery-ops/src/modules/domain/shift/shift-publish.service.ts`
- Create: `bakery-ops/src/app/(operations)/shift/actions.ts`
- Create: `bakery-ops/src/__tests__/unit/shift-plan-version.test.ts`
- Create: `bakery-ops/src/__tests__/unit/critical-role-publish.test.ts`

- [ ] 写失败测试：班表身份与版本分开；同一时间人员不可重叠；关键岗位缺人、人数不足或资格过期都不能发布；普通岗位可显示 warning。
- [ ] 新建 `ops_role/ops_station/ops_role_training_requirement`，岗位和工作站使用受控 ID，不用自由文本。
- [ ] 新建 `ops_shift_plan(store_id, business_date)` 和 `ops_shift_plan_version(shift_plan_id, version_no, status, source, submitted_by, approved_by, published_at)`；Excel 入口同样限制一份文件只含一个 store/business_date，并把 filename、SHA-256、parser_version、uploaded_by 存在 version。
- [ ] 新建 `ops_shift_requirement(plan_version_id, start_at, end_at, role_id, station_id, required_headcount, is_critical)`。
- [ ] 新建 `ops_shift_assignment(requirement_id, employment_id, start_at, end_at)`；岗位和工作站由 requirement 唯一决定，不在 assignment 重复存一份可漂移的值；指派必须属于有效 employment。
- [ ] 建 `v_hr_role_eligibility` 和 `v_ops_shift_publish_readiness`；发布动作只能通过一个受控事务函数/服务完成，禁止客户端直接把 status 改成 published。
- [ ] 一次“同时录入”在事务中写 requirements、assignments 和 audit；表仍保持不同粒度。
- [ ] BakeryOps 页面先展示需求缺口，再展示人员指派；关键岗位必须醒目标注和阻断发布。

### Task 14: 导入 Lark 实际工时，不与计划班表混用

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080543_hr_timesheet.sql`
- Create: `bakery-ops/src/modules/domain/timesheet/lark-timesheet-import.service.ts`
- Create: `bakery-ops/src/modules/data/repositories/timesheet.repository.ts`
- Modify: `bakery-ops/src/bootstrap.ts`
- Create: `bakery-ops/src/__tests__/unit/lark-timesheet-import.test.ts`
- Create: `bakery-ops/src/__tests__/unit/timesheet-identity-review.test.ts`

- [ ] 用脱敏 fixture 写失败测试，覆盖数字、空白、0、OFF/假期、重复姓名、同人跨前场/后厨 sheet、公式合计不可信。
- [ ] 新建 `hr_timesheet_sync_batch`，记录 Lark 文档/token、sheet、月份、读取时间、内容 checksum、解析版本、完整性和错误。
- [ ] 新建 `hr_timesheet_entry`，粒度为 `employment_id + store_id + work_date + work_area + source_stream`，保存来源单元格、reported_hours、原始值和状态。
- [ ] 不假定每日数字是否已扣 1 小时休息：在业务口径确认前，`net_work_minutes` 保持 NULL，`interpretation_status='needs_policy'`；页面不得把 reported hours 标成净工时。
- [ ] 姓名不能直接成为 employee FK；无法映射的单元格进入 `hr_identity_mapping_review`。
- [ ] 月 Total Actual Hours 只作为校验值；日单元格才是事实，公式/手填总计差异必须报告。
- [ ] 在现有 BakeryOps 调度器增加每日 Lark 读取，使用 KL 时区、批次 checksum 和 `wrapCron` 告警；同一内容重读幂等，来源变化产生新批次。
- [ ] 与班表做计划/实际差异，与 `finance_labor_detail` 只做月度金额/小时对账，不声称财务表含员工工时。

### Task 15: 建供应商和供应商 SKU 身份

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080550_scm_supplier_and_items.sql`
- Create: `bakery-ops/src/modules/data/repositories/supplier.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/supplier-item.repository.ts`
- Create: `bakery-ops/src/__tests__/unit/supplier-item-mapping.test.ts`

- [ ] 写失败测试：同名供应商不自动合并；一个 material 可有多个 supplier SKU；包装单位和成本卡单位需要显式换算；未知 SKU 进入审核。
- [ ] 新建 `scm_supplier`，保存稳定 supplier_id、法定/显示名、税号、状态、付款/交付基础信息和来源身份。
- [ ] 新建 `scm_supplier_item`，关联 supplier 和 `cost_card_item.material_id`，保存 supplier SKU、采购单位、包装量、MOQ、lead time、有效期。
- [ ] 新建 `scm_item_mapping_review`，保存供应商原始描述、候选 material、换算证据和审批。
- [ ] 从 `finance_supplier_*`、现有 WMS/KDocs/价格资料生成候选，但财务名称只能作证据，不能自动成为企业 supplier_id。
- [ ] 完成黑巧、草莓及相关包装/原料的人工映射验收，确保采购单位可换算到配方净用量单位。

### Task 16: 从发布计划计算原料需求和补货建议

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080551_scm_requirement_inventory_replenishment.sql`
- Create: `bakery-ops/src/modules/domain/supplychain/material-requirement.service.ts`
- Create: `bakery-ops/src/modules/domain/supplychain/replenishment.service.ts`
- Create: `bakery-ops/src/modules/data/repositories/material-requirement.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/inventory-snapshot.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/replenishment.repository.ts`
- Create: `bakery-ops/src/__tests__/unit/material-requirement.test.ts`
- Create: `bakery-ops/src/__tests__/unit/replenishment.test.ts`

- [ ] 写失败测试：只接受 published plan；按该日有效配方；考虑 yield/loss；库存、在途、安全库存、包装/MOQ；人工批准量与系统建议量分别保留。
- [ ] 新建 `scm_material_requirement_run` 与 `scm_material_requirement_line`，run 锁定输入 plan_version、recipe version set 和算法版本；line 保存 gross/net requirement 与单位转换证据。
- [ ] 新建 `scm_inventory_snapshot`，粒度为 store×material×counted_at×source_batch，区分 on_hand/reserved/available。
- [ ] 新建 `scm_replenishment_run` 与 `scm_replenishment_line`，同时保存 suggested_qty、approved_qty、delta、reason、rounding/MOQ 结果。
- [ ] 不允许用当前配方回算旧计划；输入配方缺失或单位无法换算时 run 标 failed/partial，并列出受影响产品。
- [ ] UI 展示“为什么未来订货增加/减少”：计划变化、配方变化、库存变化、在途、MOQ 和人工调整分别列示。

### Task 17: 建版本化采购单、收货和价格观察

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080552_scm_purchase_order_and_receipt.sql`
- Create: `bakery-ops/src/modules/data/repositories/purchase-order.repository.ts`
- Create: `bakery-ops/src/modules/data/repositories/goods-receipt.repository.ts`
- Create: `bakery-ops/src/modules/domain/supplychain/purchase-order.service.ts`
- Create: `bakery-ops/src/__tests__/unit/purchase-order-version.test.ts`
- Create: `bakery-ops/src/__tests__/unit/goods-receipt-price-observation.test.ts`

- [ ] 写失败测试：PO 修订不覆盖旧版；部分收货/超收/短收；实际价不同于下单价；同一 receipt 重传幂等。
- [ ] 新建 `scm_purchase_order` 稳定身份并固定 supplier_id；`scm_purchase_order_revision` 保存版本、状态、条款和批准；`scm_purchase_order_line` 挂 revision。换供应商必须新建 PO，不能在修订里改变身份。
- [ ] 新建 `scm_goods_receipt` 与 `scm_goods_receipt_line`，记录到货数量、拒收数量、批次/效期、发票/送货单、实际单价和来源。
- [ ] 新建 `scm_supplier_price_observation`，把报价/下单价/到货实价当观察值，保留来源和可信状态；它不能直接覆盖批准后的成本价。
- [ ] `finance_supplier_orders` 只作为月结对账目标，不反向写成 operational PO source of truth。
- [ ] 对黑巧和草莓塔相关原料走完“补货建议→PO v1→修订→部分收货→价格观察”验收。

### Task 18: 扩充成本价格并建立当日成本快照

**Files:**
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/sql/2026080560_cost_card_supplier_price.sql`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/sql/2026080561_cost_card_daily_snapshot.sql`
- Modify: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/api/cost-items.js`
- Modify: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/api/cost-cards.js`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/api/_lib/cost-card-snapshot.js`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/api/cost-snapshot.js`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/vercel.json`
- Modify: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/test/cost-unit-and-date.test.js`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/test/cost-as-of-snapshot.test.js`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/test/cost-snapshot-cron.test.js`

- [ ] 写失败测试：价格有效期不重叠；门店价覆盖企业默认价；未来价不改历史；配方/价格任一变化产生新 snapshot；缺价不按 0。
- [ ] **不创建** `cost_card_recipe_version*`；继续使用现有 versioned `cost_card_recipe` 和 `cost_card_recipe_item`。
- [ ] 扩充 `cost_card_item_price`：supplier_id、supplier_item_id、store_id、currency、purchase_unit、unit_factor、effective_from/to、source_observation_id、approval_status/by/at。
- [ ] 财务成本卡 UI/API 以 `product_id` 管理“可售产品→成本卡成品”映射，展示销售覆盖和映射证据；只有财务站写 `cost_card_product_link`，BakeryOps 的产品审核队列不能越权直接改它。
- [ ] 新建 `cost_card_product_cost_snapshot`，唯一粒度为 product×store×business_date×cost_version；锁定 product link、recipe_id、价格集合、unit_cost、coverage/confidence 和计算版本。
- [ ] 新建 `cost_card_product_cost_snapshot_component`，保存每种 material 的净用量、损耗、采用价、金额贡献和来源价格 ID。
- [ ] 价格候选来自供应商报价、PO、收货和经批准的人工录入；市场公开指数只能作为提示，不自动成为采购成本。专业烘焙黑巧/草莓原料在没有可比 SKU 时不得用普通消费价格替代。
- [ ] 快照按 KL 营业日生成；重跑同一输入幂等，输入发生变化则新建版本而不是覆盖旧版。
- [ ] 将快照计算集中在财务站 `api/_lib/cost-card-snapshot.js`；受保护的 `api/cost-snapshot.js` 只处理前一 KL 营业日，校验 `CRON_SECRET`，用 advisory lock 防并发，并对每个 store/product 记录成功、partial 或 failed。
- [ ] `vercel.json` 配置每日 `30 17 * * *`（UTC；Pro 目标次日 01:30 KL，Hobby 可能落在 01:00–01:59 KL）调用该端点。Vercel Cron 可能重复投递且失败不会自动重试，因此端点必须幂等、持锁、发告警并允许按 business date 人工补跑；规则以 [Vercel Cron 官方文档](https://vercel.com/docs/cron-jobs/manage-cron-jobs) 为准。
- [ ] 在 Vercel 生产环境配置随机 `CRON_SECRET`，只核对变量存在而不打印值；部署后用受控日期跑一次 canary，并从函数日志、snapshot 行和审计三处确认结果。
- [ ] 建/修复 `v_cost_card_item_cost_quality` 的零销售除零，并让所有 API 返回 `cost_status/coverage/confidence/as_of_date`。

### Task 19: 建分析与财务对账视图，切换网站消费者

**Files:**
- Create: `bakery-ops/src/modules/data/migrations/2026080570_ops_analytics_views.sql`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/sql/2026080571_finance_reconciliation_views.sql`
- Modify: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/api/cost-dashboard.js`
- Modify: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/api/sales.js`
- Modify: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/api/finance.js`
- Modify: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/js/cost-card.js`
- Modify: `bakery-ops/src/modules/domain/forecast/daily-review.service.ts`
- Modify: `bakery-ops/src/modules/skills/daily-review-chat/daily-review-chat.definition.ts`
- Create: `bakery-ops/src/__tests__/unit/daily-margin-and-mix.test.ts`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/test/margin-reconciliation.test.js`

- [ ] 先写黄金用例：黑巧产品与草莓塔在两个日期使用不同配方/采购价；产品销量占比一升一降；退款、折扣、报废和缺成本分别得到正确状态。
- [ ] `v_ops_product_mix_daily` 同时提供 qty share 和 net-sales share；变化基准明确为上一可比营业日/上周同日，不输出无标签的“上涨”。
- [ ] `v_ops_daily_product_margin` 使用当日 snapshot：`net_sales - sold_qty * unit_cost`；订单事实可用时净收入包含折扣/退款，聚合来源时明确 `margin_source='aggregate_estimate'`。
- [ ] 报废成本单独列示，不偷偷混入商品销售毛利；财务汇总可以选择“销售毛利”和“扣报废后贡献毛利”两种明确口径。
- [ ] 明确定义 `v_ops_plan_vs_output`、`v_ops_output_vs_dispatch`、`v_ops_plan_vs_dispatch`、`v_ops_forecast_accuracy`、`v_ops_labor_productivity`；连同已定义的 product mix、daily margin 和班表准备视图，全部设置 `security_invoker=true`。
- [ ] 建 `v_finance_sales_reconciliation`、`v_finance_purchase_reconciliation`、`v_finance_labor_reconciliation`、`v_finance_margin_summary`；月度 `finance_*` 保留 source of truth 身份，差异要有状态和阈值。
- [ ] 财务成本 dashboard 显示：当日毛利率、成本日期、可信销售覆盖率、未映射销售额、缺价格原料、Top product mix 变化；不能只显示一个看似精确的毛利率。
- [ ] BakeryOps 日报改读规范视图，并展示“明日调整动作”和“当日突发→影响→实际结果”链。
- [ ] 两个网站先 shadow 比较旧 API 响应和新视图；30 日门槛通过后才切主读。

### Task 20: 收口运行时账号、RLS 和域所有权

**Files:**
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/sql/2026080580_runtime_roles_and_grants.sql`
- Modify: `database/contracts/object-ownership.json`
- Create: `bakery-ops/src/__tests__/integration/database-permissions.test.ts`
- Create: `res_api/test/database-permissions.test.js`
- Create: `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统/test/database-permissions.test.js`
- Create: `hbti-web/tests/database-permissions.test.ts`

- [ ] 先写权限失败测试：`res_api` 不能写 `cost_card_`，BakeryOps 不能写 `finance_`，财务站不能写 `ops_`，HBTI 不能改运营核心，所有 runtime role 不能写 `schema_migrations`。
- [ ] 建/配置 `hotcrush_migrator`、`res_api_writer`、`bakery_ops_writer`、`finance_app_writer`、`hbti_writer`、`hotcrush_readonly`；真实密码/连接串只进秘密管理，不进 Git。
- [ ] 逐表 GRANT：各域写者有必要的 SELECT/INSERT/UPDATE；跨域消费者只读；DDL 仅 migrator。
- [ ] 新表启用 RLS 并添加与应用鉴权/服务角色一致的策略；视图使用 `security_invoker=true`，不绕过基础表策略。
- [ ] 先在本地集成库跑权限测试，再在生产创建角色但不切连接串；逐应用切换并立即冒烟。
- [ ] 切换顺序：只读审计→`res_api`→BakeryOps→财务站→HBTI；任一失败只回退该应用连接串，不回滚已写事实。
- [ ] 切换后查询活动连接与审计，要求 runtime 不再使用 postgres/superuser/bypassrls 身份。

### Task 21: 分域切换、观察和退休旧对象

**Files:**
- Create: `docs/database/cutover-scorecard.md`
- Create: `docs/database/legacy-object-retirement-register.csv`
- Modify: `HANDOFF.md`
- Create after separate approval: 在届时对象所属仓库的迁移目录，按当时迁移登记簿分配新的全局 ID，并命名为 `retire_verified_legacy_objects.sql`；本计划不预占未来 destructive migration ID。

- [ ] 为 POS、Ops、HR、SCM、Cost 分别维护 `legacy → dual_write → shadow_read → canonical` 状态、开始时间、指标、owner、回滚方式。
- [ ] 每日记录新旧行数/金额/数量/空 FK/未映射/partial batch/视图异常；不把“脚本退出 0”当完成。
- [ ] 在真实夜间抓取后次晨核验 POS；在发布计划/班表/PO/成本快照后立即核验业务行为。
- [ ] 达到第 5 节各自周期后，先停止旧写入，保留旧读兼容；再观察 14 日零访问。
- [ ] 全仓搜索表名和 `ON CONFLICT`；只要仍有 writer，就不得把旧表替换成视图。
- [ ] 每个旧对象记录最后写入、最后读取、替代对象、回填证明、保留策略和签字人。
- [ ] 退休 DDL 只在另一次人工批准后生成；同一事务内做需要的 rename+compat view，并保留 `security_invoker`。涉及 `ON CONFLICT` 的对象必须在同一维护窗口同步发布写者。
- [ ] 保留历史事实和 migration/audit/provenance；“退休”优先撤写权限和归档读，不默认删除业务历史。
- [ ] 最终运行四个代码库完整门禁并更新 `HANDOFF.md`，记录真正完成的阶段和仍在观察的对象。

## 8. 每波生产执行模板

每个迁移 ID 都按以下顺序执行，不能省略：

### 标准本地门禁命令

```bash
cd /Users/weiliangshao/hot/bakery-ops
npx vitest run
npx tsc --noEmit
npm run lint
npm run build

cd /Users/weiliangshao/hot/res_api
npm run test:unit

cd "/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统"
npm test

cd /Users/weiliangshao/hot/hbti-web
npm run lint
npm run typecheck
npm test
npm run build

cd /Users/weiliangshao/hot
./scripts/test-shared-migrations.sh
git diff --check
```

预期：所有命令 exit 0，测试零失败，构建成功，shared schema 没有未声明对象/跨域写权，`git diff --check` 无输出。只改一个域的 Task 可以先跑相关子集，但进入生产窗口前必须跑完整门禁。

每个 Task 完成后，在对象所属仓库单独提交该 Task 的文件；先核对 `git status` 和 staged diff，不把现有蓝图、109 迁移或其他人未完成工作混进提交。跨两个仓库的 Task 必须形成两个可独立回退的 commit，并在 `HANDOFF.md` 记录配对关系。

### D-2 至 D-1：开发和本地证明

- [ ] 当前对象所有者、写者、读者和 `ON CONFLICT` 搜索已附在 PR/提交说明；
- [ ] 失败测试先出现，最小实现后通过；
- [ ] 在一次性 PostgreSQL 跑完整 shared-schema chain；
- [ ] schema diff 只包含本迁移声明对象；
- [ ] backfill 有 dry-run、影响行数、歧义清单和可重复执行证明；
- [ ] 应用代码先能兼容“列/表存在但尚未主读”的状态；
- [ ] 精确记录提交、产物、执行人、计划窗口和应用回滚版本。

### D 日 01:00–13:00：人工批准后执行

- [ ] 再次确认无 POS 夜间批次运行、无其他迁移持锁；
- [ ] 只执行一个已审核迁移文件，不运行目录通配；
- [ ] runner 获取 advisory lock，在事务内完成 DDL+registry；
- [ ] 立即查询列、约束、注释、RLS、权限和 registry checksum；
- [ ] 只打开对应域的 `dual_write` 或 `shadow_read`，不同时切多域；
- [ ] 跑该应用冒烟、数据库对账和错误日志检查；
- [ ] 失败时回退应用读取/写入模式；DDL 采用 forward-fix，不在慌乱中 drop 新事实。

### D+1：真实批次验收

- [ ] 核对真实 POS/计划/Lark/PO/成本批次的完整状态和行数；
- [ ] 核对未映射、NULL FK、重复键、金额差异和时区营业日；
- [ ] 验证告警真实可送达；
- [ ] 更新 cutover scorecard 和 HANDOFF；
- [ ] 未达到门槛就保持当前阶段，不以“迁移成功”宣布业务完成。

## 9. 端到端业务验收场景

### 场景 A：明日预估单联动未来订货

1. Pavilion 发布明日预估单 v3；黑巧产品 +20，草莓塔 -8。
2. `ops_plan_adjustment` 保存增减、原因、提交/批准人，发布后形成不可变 plan version。
3. SCM run 锁定该 plan version 和当日生效配方，展开黑巧、草莓、面粉、包装等净需求。
4. 系统结合库存、在途、安全库存、包装/MOQ 生成 suggested qty。
5. 采购员把黑巧批准量从建议 2 箱改为 3 箱，必须保存 delta/reason。
6. PO v1 发出；供应商变更包装/价格后产生 revision v2，不覆盖 v1。
7. 收货保存实收、短收和实际价；价格进入 observation，财务/采购批准后才生成有效成本价。

**通过标准：** 任一订货量都能解释来自哪个计划版本、配方、库存快照、MOQ 和人工动作。

### 场景 B：黑巧和草莓塔的当日毛利

1. 黑巧配方 v2 在 8 月 10 日生效；草莓采购价在 8 月 12 日变更。
2. 每日 snapshot 锁定当天配方和价格，并保存每种原料贡献。
3. POS 提供当天 qty/net sales；账单来源可用时包含折扣/退款，否则标 aggregate estimate。
4. `v_ops_daily_product_margin` 使用当天 snapshot，不用今天成本回算过去。
5. 页面同时显示毛利、成本覆盖率、缺失原料和产品销售占比变化。

**通过标准：** 修改 8 月 15 日价格不会改变 8 月 10 日已锁定毛利；缺成本产品不会显示虚假的高毛利。

### 场景 C：评分到关键岗位班表再到人效

1. 候选人完成面试/试岗评分，接受 offer，建立 employment。
2. 入职任务完成，培训 assignment/result 证明已通过黑巧关键站课程且未过期。
3. 班表 version 写岗位需求，关键岗位 `is_critical=true`；指派 employment。
4. 未培训或过期人员无法让班表发布；合资格员工填满后才发布。
5. Lark 次日同步实际工时，保留来源单元格和解释状态。
6. 人效视图连接实际营收和实际工时；班表只用于计划/实际差异。

**通过标准：** 任一关键岗位能追到员工、有效雇佣、培训证据、班表版本和实际工时；姓名不参与跨表 FK。

### 场景 D：当日突发与明日动作

1. 当日设备故障事件记录起止、影响产品和证据。
2. 视图展示计划→生产→发出→销售偏差，并把缺货/故障影响与预测准确度分开。
3. 经理创建明日 adjustment，保存加减量和理由，生成计划新版本。
4. 后续需求/订货仅使用新 published version。

**通过标准：** “发生了什么、今天影响多少、明天做什么、谁批准、影响了多少原料采购”可沿主键完整回溯。

## 10. 完成定义

只有以下项目全部成立，才能说“从当前状态迁移到蓝图完成”：

- [ ] 第 4 节规范核心对象已建成，现有对象按计划完成升级；
- [ ] 四个系统各自只写所属域，runtime 不再使用超级账号；
- [ ] 所有活跃门店、产品、排班员工和采购 SKU 达到映射门槛；
- [ ] 预测、计划、生产、发出、销售、报废是独立可追溯事实；
- [ ] 人事评分、offer、employment、培训、关键岗位班表、Lark 实际工时链可走通；
- [ ] 发布计划能生成原料需求、补货建议、PO 修订、收货和价格观察；
- [ ] 成本卡按有效期锁定日成本，历史毛利不会被当前价格改写；
- [ ] 财务网站和 BakeryOps 已从规范视图读取，并显示覆盖/可信状态；
- [ ] 所有并行观察周期通过，旧写者已停止，退休对象有证据和独立批准；
- [ ] 每个迁移有全局 ID、owner、checksum、lock、事务、验证和 HANDOFF 记录；
- [ ] 黑巧和草莓塔四个端到端验收场景通过；
- [ ] 生产真实夜间批次、计划发布、Lark 同步和财务页面均已验证，而不只是测试通过。

## 11. 推荐实施节奏

| 周期 | 范围 | 不得混入的工作 |
|---|---|---|
| 第 0 周 | Task 0–3：服务恢复、基线、迁移治理、本地门禁 | 不建业务表 |
| 第 1–2 周 | Task 4–7：门店/产品/POS 身份与事实 | 不切成本/毛利主读 |
| 第 2–3 周 | Task 8–10：日历、预测、计划、实际执行 | 不把计划当 actual |
| 第 3–5 周 | Task 11–14：人事、培训、班表、工时 | 不在姓名映射未完成时发布班表 |
| 第 4–6 周 | Task 15–17：供应商、需求、采购、收货 | 不用财务月结代替 operational PO |
| 第 6–8 周 | Task 18–19：成本快照、毛利、财务对账、消费者切换 | 不对缺成本显示精确毛利 |
| 第 8 周以后 | Task 20–21：权限、观察、按证据退休 | 不一次性 DROP 全部旧对象 |

时间只是资源规划，不是上线承诺。任何阶段的真实数据质量门槛未通过，后续主读切换自动顺延；开发可以并行，生产迁移不能越过依赖。

## Self-Review

- 第一性原则覆盖：稳定身份、事实粒度、来源、版本、有效期、单写者、可重算、未知值隔离均有对应迁移任务。
- 老板建议覆盖：预估单、班表、关键岗位、节假日、明日动作、当日突发、订货增减、采购价波动、配方波动、product ID、产品占比、黑巧/草莓塔、当日毛利均映射到表和验收场景。
- 当前网站覆盖：财务站的成本卡 CRUD、成本 dashboard、销售/财务 API、BakeryOps 的预测/生产页面与日报均有明确切换任务；现有 `finance_*` 不被误删。
- 风险控制：唯一生产库、迁移冲突、视图不能 `ON CONFLICT`、23:00 抓取窗口、工作树部署、权限过宽和生产 API 500 均有前置 gate。
- Scope 控制：本计划不实现业务功能、不执行生产 SQL、不部署，也不预先批准任何 destructive retirement。
