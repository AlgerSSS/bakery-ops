# HOT CRUSH 未来数据库物理 ERD 说明

## 结论

这套图把已经确认的未来蓝图进一步落实为 **73 张核心物理表、16 个关键只读视图、11 个可编辑 Draw.io 页面**。它可以作为后续迁移 SQL、数据访问改造和网站功能扩展的目标结构，但它不是可直接执行的 DDL，也不代表共享生产库最终只剩 73 张表。

现有 `finance_*`、`app_*`、HBTI、来源表、历史表与兼容视图继续存在；图里的 73/16 是未来跨营运、供应链、人事、成本和财务协作所需的核心基座。

## 第一性原则

数据库地基先回答四个问题，再回答“页面怎么做”：

1. **这条记录代表什么事实，粒度是什么？**
2. **它靠哪个稳定 ID 与其他事实连接？**
3. **谁有权写入，来源和版本如何追溯？**
4. **事实不完整时，是阻止发布、进入审核队列，还是明确标记为估算？**

因此本结构明确拆开：

- 预测、预估单版本、实际产出、配送、POS 销售；
- 班表需求、员工指派、实际工时；
- 建议补货、批准订货、PO 版本、实际收货、生效采购价；
- 当日成本快照、计算毛利、财务账面核对。

任何两种事实都不能因为“以后查询方便”而揉进同一张宽表。跨表抓取快不快，最终取决于稳定身份、索引、批次和视图，不取决于把不同业务事实硬塞在一起。

## 四条稳定身份脊柱

| 身份 | 主对象 | 作用 |
|---|---|---|
| `store_id` | `ops_store` | 连接门店计划、POS、库存、PO、班表、工时和财务核对 |
| `product_id` | `pos_sellable_product` | 连接黑巧、草莓塔等可售产品的预测、计划、销售、报废、成本和毛利 |
| `employment_id` | `hr_employment` | 连接人员、培训资格、班表指派、实际工时和人工成本核对 |
| `material_id` | `cost_card_item.material_id` | 连接配方原料、供应商商品、库存、采购、收货价和成本快照 |

来源系统的门店 ID、POS listing、员工编号和供应商文本不能直接充当跨域主键。它们先进入来源身份或映射审核表，确认后再指向稳定 ID。

## 11 页结构

| 页 | 表 | 视图 | 重点 |
|---|---:|---:|---|
| 01 总览与阅读导航 | — | — | 范围、状态、门禁、板块跳转 |
| 02 共享身份与治理 | 11 | — | 迁移账本、审计、门店、商品、人员身份 |
| 03 POS 销售事实 | 8 | 2 | 来源批次、日销售、时段商品、报废、条件订单明细 |
| 04 营运预测与计划 | 12 | — | 节假日、突发事件、预测、预估单版本、明日调整动作 |
| 05 营运执行与复盘 | 4 | 5 | 实际产出、配送、计划差异、产品占比和预测准确率 |
| 06 人事、入职与培训 | 8 | — | 评分、Offer、入职任务、课程版本、培训结果 |
| 07 班表、关键岗位与工时 | 9 | 3 | 岗位资格、班表版本、关键岗位、实际工时、人效 |
| 08 供应链与订货 | 14 | — | 原料需求、库存、补货、PO 版本、收货和市场采购价 |
| 09 成本卡与当日毛利 | 7 | 2 | 配方、价格有效期、成本快照、组成明细、产品毛利 |
| 10 财务核对视图 | — | 4 | 销售、采购、人工、毛利四条财务核对链 |
| 11 端到端与写入边界 | — | — | 黑巧 / 草莓塔示例、人工和自动录入、系统写入责任 |

## 73 张核心表

### 02｜共享身份与治理（11）

- `schema_migrations`
- `app_audit_log`
- `ops_store`
- `ops_store_source_identity`
- `pos_sellable_product`
- `pos_product`
- `ops_product_mapping_review`
- `hr_person`
- `hr_employment`
- `hr_employment_source_identity`
- `hr_identity_mapping_review`

### 03｜POS 销售事实（8）

- `pos_ingest_batch`
- `pos_daily_revenue`
- `pos_item_hourly_sales`
- `pos_item_waste`
- `pos_order`（条件表）
- `pos_order_item`（条件表）
- `pos_payment`（条件表）
- `pos_refund`（条件表）

四张订单级表只有在 RES 能提供跨重跑稳定的订单、订单行、支付和退款来源 ID 时才创建。否则保留日销售、时段商品和报废聚合事实，并把无法从聚合数据精确回答的指标标为估算。

### 04｜营运预测与计划（12）

- `ops_calendar_import_batch`
- `ops_calendar_event`
- `ops_demand_factor_observation`
- `ops_operational_event`
- `ops_operational_event_product`
- `ops_forecast_run`
- `ops_forecast_line`
- `ops_production_plan`
- `ops_production_plan_version`
- `ops_production_plan_line`
- `ops_production_plan_slot`
- `ops_plan_adjustment`

### 05｜营运执行与复盘（4）

- `ops_production_output`
- `ops_production_output_line`
- `ops_dispatch`
- `ops_dispatch_line`

### 06｜人事、入职与培训（8）

- `hr_assessment`
- `hr_assessment_item_score`
- `hr_offer`
- `hr_onboarding_task`
- `hr_training_course`
- `hr_training_course_version`
- `hr_training_assignment`
- `hr_training_result`

### 07｜班表、关键岗位与工时（9）

- `ops_role`
- `ops_station`
- `ops_role_training_requirement`
- `ops_shift_plan`
- `ops_shift_plan_version`
- `ops_shift_requirement`
- `ops_shift_assignment`
- `hr_timesheet_sync_batch`
- `hr_timesheet_entry`

### 08｜供应链与订货（14）

- `scm_supplier`
- `scm_supplier_item`
- `scm_item_mapping_review`
- `scm_material_requirement_run`
- `scm_material_requirement_line`
- `scm_inventory_snapshot`
- `scm_replenishment_run`
- `scm_replenishment_line`
- `scm_purchase_order`
- `scm_purchase_order_revision`
- `scm_purchase_order_line`
- `scm_goods_receipt`
- `scm_goods_receipt_line`
- `scm_supplier_price_observation`

### 09｜成本卡与当日毛利（7）

- `cost_card_item`
- `cost_card_recipe`
- `cost_card_recipe_item`
- `cost_card_item_price`
- `cost_card_product_link`
- `cost_card_product_cost_snapshot`
- `cost_card_product_cost_snapshot_component`

这里复用现有 `cost_card_recipe` 和 `cost_card_recipe_item`，不再新建一套重复的 recipe-version 表。`cost_card_item.id` 的现有 bigint 键保留，同时增加跨域稳定的 `material_id uuid`。

## 16 个关键只读视图

### POS（2）

- `v_pos_daily_sales`
- `v_pos_source_reconciliation`

### 营运执行与销售运营（5）

- `v_ops_plan_vs_output`
- `v_ops_output_vs_dispatch`
- `v_ops_plan_vs_dispatch`
- `v_ops_product_mix_daily`
- `v_ops_forecast_accuracy`

### 人事、班表与人效（3）

- `v_hr_role_eligibility`
- `v_ops_shift_publish_readiness`
- `v_ops_labor_productivity`

### 成本和毛利（2）

- `v_ops_daily_product_margin`
- `v_cost_card_item_cost_quality`

### 财务核对（4）

- `v_finance_sales_reconciliation`
- `v_finance_purchase_reconciliation`
- `v_finance_labor_reconciliation`
- `v_finance_margin_summary`

视图只负责读取、统一口径和暴露质量状态，不作为业务事实写入口。

## 人工录入与自动抓取边界

| 类型 | 应录入 / 抓取内容 | 落点 |
|---|---|---|
| 自动 | RES/POS 批次、日销售、时段商品、报废；有稳定 ID 时再抓订单明细 | `pos_ingest_batch`、`pos_*` 事实表 |
| 自动 | 当日和未来节假日来源、内容哈希、解析版本 | `ops_calendar_import_batch`、`ops_calendar_event` |
| 自动 | 预测运行、配方展开、原料需求、建议补货、成本快照和核对视图 | `ops_forecast_*`、`scm_*_run/line`、`cost_card_*_snapshot*`、`v_*` |
| 自动 | Lark 工时原值、解析版本和同步批次 | `hr_timesheet_sync_batch`、`hr_timesheet_entry` |
| 人工确认 | 当日突发情况、影响商品、证据 | `ops_operational_event*` |
| 人工确认 | 明日计划增减、原因、审批、发布 | `ops_plan_adjustment`、`ops_production_plan_version` |
| 人工确认 | 班表岗位、工位、关键岗位、员工指派和发布 | `ops_shift_requirement`、`ops_shift_assignment`、`ops_shift_plan_version` |
| 人工确认 | 员工评分、Offer、入职任务、培训结果例外 | `hr_assessment*`、`hr_offer`、`hr_onboarding_task`、`hr_training_*` |
| 人工确认 | 供应商、盘点例外、批准订货量、PO 审批、收货异常 | `scm_supplier*`、`scm_inventory_snapshot`、`scm_replenishment_line`、`scm_purchase_order*`、`scm_goods_receipt*` |
| 人工审核 | 无法唯一映射的门店、商品、员工、原料 | `*_mapping_review`；未确认前不得进入正式事实链 |

## 黑巧与草莓塔如何贯穿全链路

1. 黑巧与草莓塔分别拥有稳定 `product_id`，各门店 POS listing 通过 `pos_product` 映射。
2. `ops_production_plan_version` 的商品行保存明日计划量与时段；人工调整必须生成新版本并记录原因。
3. `cost_card_product_link` 把产品连接到生效配方，配方展开成 `material_id` 级原料需求。
4. 原料需求减库存 / 在途并考虑包装、MOQ 和提前期，形成建议与批准订货量。
5. PO 版本、收货数量和实际收货价分开保存，收货实价成为供应商价格观察。
6. 生效采购价与配方版本计算当天产品成本快照，并保留每个原料组成和价格来源。
7. POS 销售数量与当天成本快照连接，得到产品 COGS、毛利额和毛利率；成本覆盖不足时显示 `ESTIMATED`。
8. 销量和计划同时形成班表工作量，关键岗位只能指派培训资格有效的员工；实际工时再与销售和财务人工成本核对。

## 三个硬门禁

1. **身份门禁**：门店、商品、员工或原料不能唯一映射时进入 review queue，不允许按名称猜填。
2. **版本门禁**：预估单和班表没有已发布版本时，不触发物料需求、正式订货或排班下游。
3. **质量门禁**：订单无稳定来源 ID、成本来源缺失、配方覆盖不足或关键岗位资格不满足时，禁止伪装成完整事实；阻止发布或明确标记估算。

## 写入责任

- `res_api`：写 `pos_*`；
- BakeryOps：写 `ops_*`、`hr_*`、`scm_*`；
- 财务网站：写 `finance_*`、`cost_card_*`、`app_*`；
- 跨域协作：使用稳定 FK、只读视图和受控审计函数，不允许一个项目绕过边界直接改另一个域的事实表。

## 如何读图

- `[EXISTING]`：复用现有表；
- `[UPGRADE]`：原位增加稳定键、来源或版本能力；
- `[NEW]`：未来新建；
- `[CONDITIONAL]`：满足来源稳定性前提才创建；
- 实线鸡爪：物理 FK 的多对一方向；
- 虚线关系：可空 FK、来源血缘或视图读取；
- `REF` 卡：完整表 / 视图定义在本页其他分组或另一页，可在 `.drawio` / HTML 中点击跳转。

每张表只在一个主页面完整出现，跨页只放引用，避免同一对象在多页重复后产生版本歧义。图中展示的是关键键、关键业务列、粒度和写入者；完整审计列、索引、检查约束、RLS 和迁移顺序应在后续迁移 SQL 中逐项落实。

## 交付文件

- `HOTCRUSH未来数据库物理ERD.drawio`：11 页、可编辑、页面内可跳转；
- `HOTCRUSH未来数据库物理ERD.html`：单文件交互浏览；
- `HOTCRUSH未来数据库物理ERD.pdf`：11 页可缩放 PDF；
- `未来物理ERD-01-*` 至 `未来物理ERD-11-*`：逐页 PNG / SVG；
- `build_future_physical_erd.py`：73 表 / 16 视图元数据、关系和布局的可审计生成源。

