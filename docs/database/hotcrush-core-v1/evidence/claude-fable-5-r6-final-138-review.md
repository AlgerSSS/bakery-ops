# Claude Fable5 R6 最终独立审计（修订前）

> 原始返回。结论为 PASS_WITH_CHANGES；下列有效问题必须在最终包中处理，不能把本文件当成无条件通过证据。

机器扫描与人工反证全部完成，证据链闭合。以下是完整审计报告。

---

# HOT CRUSH R6 最小物理数据基座 · 最终独立审计报告

审计方式：只读。全部数字用独立脚本重新计数（csv/json/sql 三方交叉），未运行包内生成器与验证器；关键反证逐表读原文（引用处给出文件与行号）。未执行任何 DDL/DML/部署/提交。

## 最终结论：**PASS_WITH_CHANGES**

数据建模本体成立：138/53/1733/511/419 与 154 去向全部机器复核为真；第一性判定（只存不可重建事实、汇总差值毛利余额走视图）在逐表、逐字段扫描下没有发现一张应删而未删的表，也没有发现一个未申报的派生缓存字段落库。合并与派生的 16 个对象处置全部经得起反证。

但本包有两类必须修的问题：**一处证据完整性伪标**（机器可读 CSV 把终稿否决冒充成上轮独立审计者的原判，7 个对象）；**一组来源事实的字段级静默丢弃**（积分/等级/交易前后余额/会员日报计数类指标在目标模型无任何去向声明）。二者都不动摇 138 张表的架构，但在修正前，本包不能被引用为"独立审计一致通过"，也不满足其自称的"无损承接来源事实"。

与包自身结论一致：**本审计通过的是评审稿，不是实施批准**。06 号文档列出的 5 条硬门禁（运行时契约、身份对账、单位/财务口径、POS 支付与工时来源、迁移链证明）一条都还没满足。

## 阻断项

**A1（证据完整性）`r5-to-r6-disposition.csv` 的 `claude_fable_5` 列伪造了 7 处归因。** CSV 把全部 11 个合并标为 `CLAUDE_MERGE_INTO`、4 个派生标为 `CLAUDE_DERIVE_VIEW`；对照原始证据 `evidence/claude-fable-5-r6-minimal-foundation.md`，Claude 的原判是：`ops_production_plan`（144 行 CORE_KEEP）、`cost_card_recipe`（202 行 CORE_KEEP）、`mkt_campaign`（43 行 CORE_KEEP 名单）、`msg_push_deduplication`（44 行 CORE_KEEP 名单）、`ops_shift_plan`（176 行 EXTENSION_LATER）、`scm_purchase_order`（196 行 EXTENSION_LATER）、`scm_material_requirement_line`（192 行 EXTENSION_LATER）。这 7 个对象的合并/派生是终稿作者的追加收紧——07/08 文档的表格里披露得很诚实（`CLAUDE_CORE_KEEP; CODEX_FURTHER_MERGED…`），但机器可读 CSV 把它写成了 Claude 本人的意见，且 `validate-review-package.py` 对该列只查非空，无法拦截。CSV 该列分布也无法复现文档三处宣称的 104/36/3/5/2/4。修法：该列改存真实原判，新增 `final_override` 列存终稿动作，验证器与证据文件分布交叉核对。

**A2（事实边界）现库来源事实在目标模型中被静默丢弃，无处置声明。** 用 `evidence/current-schema-snapshot.json` 列集对照目标字段字典（全库 grep，0 命中）确认：

- `pos_member` 的 `point_balance`、`growth`、`level_name`、`lifetime_topup_*`、`lifetime_consume_*`；
- `pos_member_card_txn` 的 `before/after_money_balance`、`before/after_gift_balance`、`point_delta`；
- `pos_member_daily` 的 `new/consumed/recharged/points_member_count`、`topup_cash/gift/face_value/count/refund`、`redeem_*`、`consume_refund`、`adjust_net`、`total_consume_amount`（目标只保留 6 个净额/存量指标）。

其中积分体系（目标模型 2244 字段中"积分/point"零命中）与逐笔前后余额是来源报告值，事后不可重建；这与 06 号文档自己的原则（"必须回填并保留来源 ID、批次、版本和质量状态""不能用一次性重写丢弃"）直接冲突。current-to-target 矩阵的迁移规则对这些列只字未提。修法不必然是加列：可以明文声明"积分体系业务弃用、归档不迁移"，但必须是被记录的决定，不是遗漏。

**A3（实施口径）53 个视图未分期，其中 20 个依赖非首期表。** 递归展开 lineage（含视图套视图，无环、无悬空）：`v_scm_*` 全家、`v_ops_shift_*`、`v_hr_role_eligibility`、`v_hr_timesheet_entry_current`、`v_ops_labor_productivity`、`v_finance_purchase/labor_reconciliation`、`v_msg_delivery_current`（依赖扩展包 `msg_delivery_event`）、`v_app_data_quality_summary`、`v_business_timeline`、`v_identity_mapping_gap`（依赖扩展表 `app_data_quality_issue`）等 20 个，首期实际只能建 33 个。"53 个视图"作为首期口径是不成立的；治理入口 `v_identity_mapping_gap` 还需要去掉扩展表血缘才能首期上线。

## 精确统计核对（全部机器复核）

| 声明 | 复核结果 | 方法 |
|---|---|---|
| 138 张物理契约 | ✅ catalog 138 行、名称唯一；audit CSV 同名集 | csv 计数+去重 |
| 首期 100 = 81 业务 + 19 平台 | ✅ tier：CORE_BUSINESS 81 + CORE_PLATFORM 19；lifecycle CORE_MIGRATION=100 | csv 分组 |
| 扩展 34 / 来源条件 4 | ✅ 7 个扩展包 1+2+5+6+6+13+1=34；SOURCE_CONDITIONAL=4；100+34+4=138 | csv 分组 |
| 53 视图 | ✅ json views=53；字典 distinct=53；注释 53 | 三方一致 |
| 1733 + 511 = 2244 字段 | ✅ 字典 TABLE=1733/VIEW=511；json 逐表求和一致；无重名 | csv+json |
| 419 外键 | ✅ 字典 `FK →` 419；json 非空 fk 419；目标表全部存在 | grep+json 校验 |
| 154 去向唯一 | ✅ 154 行无重复；19+81+34+4+11+4+1=154；138+11+4+1=154 | csv 分组 |
| 存储类别 33/33/5/10/19 | ✅ MASTER 33、BASE_FACT 33、DECISION 5、WORKFLOW 10、PLATFORM 19 | csv 分组 |
| 注释 2435 条 | ✅ 138 表+53 视图+2244 列，唯一、非空、与字典键集完全相等 | 正则解析+集合比对 |
| 现库 97 对象逐一映射 | ✅ 76 表+21 视图在 current-to-target 各出现恰一次，type 无错 | 快照×矩阵集合比对 |
| Claude 原判 104/36/3/5/2/4 | ⚠️ 证据文件成立，但 CSV 归因列不可复现（阻断项 A1） | 证据文件行级核对 |

口径不一致仅一处即 A1；另有小暇：REMOVE 行 `r6_target` 值为 `app_job_run（仅记录刷新任务）`，带中文括注，不是纯对象名。

## 138 张物理表逐表判定

结论与 R6 终稿一致（我主动找了反例，找到的问题全部落在字段与证据层，无一张表需要改判）；KEEP 的理由 = 删表即丢失的不可重建事实。

**app / ai / msg（平台侧车 19 + 扩展 4）**

| 表 | 判定 | 理由 |
|---|---|---|
| app_schema_migration | KEEP | 四仓库迁移执行历史与文件校验和是已发生事实，FK 豁免例外之一 |
| app_source_system | KEEP | 来源责任边界与权威范围是人工登记，不可由交易反推 |
| app_unit | KEEP | 受控单位与全局换算系数是批准定义 |
| app_job_run | KEEP | 运行窗口/游标/输入清单是恢复与幂等所需状态；已吸收日历导入与成本刷新 |
| app_data_quality_issue | EXTENSION_ONLY | 人工受理/豁免历史不可重建，但治理流程未启用；质量标志与汇总均可派生 |
| app_audit_event | KEEP | 受控操作及前后脱敏快照是审计事实 |
| app_user | KEEP | 账号身份与凭据状态 |
| app_role | KEEP | 角色定义 |
| app_permission | EXTENSION_ONLY | 细粒度权限未启用 |
| app_user_role | KEEP | 授权生效区间历史（非重叠排斥约束） |
| app_role_permission | EXTENSION_ONLY | 同上未启用 |
| app_user_location_scope | KEEP | 账号×地点授权区间 |
| app_session | KEEP | 会话撤销状态；共享库现状合理，属"可外置到应用私有存储"候选 |
| app_one_time_token | KEEP | 一次性令牌消费状态（现 hbti_auth_token 的正名） |
| app_rate_limit_event | KEEP | 不可逆限流计数（现 hbti_rate_limit）；第二个 FK 豁免例外 |
| msg_conversation | KEEP | 渠道会话身份；跨项目共用（BakeryOps 写、HBTI 读） |
| msg_message | KEEP | 不可变消息正文 |
| msg_conversation_state | KEEP | 工作流采集状态是流程事实 |
| msg_outbound_message | KEEP | 队列+业务自然键+幂等键；吸收 msg_push_deduplication 成立（尝试数/最后错误由投递事实派生） |
| msg_delivery_attempt | KEEP | 每次渠道调用结果是外部副作用 |
| msg_delivery_event | EXTENSION_ONLY | 渠道回执 webhook 未接入 |
| ai_prompt_segment | KEEP | 片段版本（内容不可变） |
| ai_prompt_template | KEEP | 行内版本化模板；吸收 version 表成立 |
| ai_prompt_template_segment | KEEP | 模板×片段组合，内容由片段版本派生不复制 |
| ai_call | KEEP | 一次模型请求的入参/输出/用量是不可重放的外部事件 |

**ops / pos（首期核心）**

| 表 | 判定 | 理由 |
|---|---|---|
| ops_location | KEEP | 企业地点身份与时区，统一 ops_store/finance_store 双身份的锚 |
| ops_location_source_identity | KEEP | 外部地点 ID→企业地点的有效期映射+人工确认证据 |
| ops_product | KEEP | 企业产品身份 |
| ops_product_alias | KEEP | 人工确认别名及有效期；normalized_alias 不落库（表达式约束派生） |
| hr_person | KEEP | 自然人身份与去重指纹 |
| hr_person_contact | KEEP | 加密联系方式及换号历史（非重叠区间） |
| hr_employment | KEEP | 一段雇佣关系区间事实 |
| hr_employment_source_identity | KEEP | Lark 等外部员工 ID 映射区间 |
| hr_employment_mapping_review | KEEP | 每次人工审核尝试是决定历史 |
| scm_material | KEEP | 统一物料身份与基础单位 |
| scm_material_alias | KEEP | 同产品别名逻辑 |
| scm_material_source_identity | KEEP | 外部物料 ID 映射区间 |
| pos_ingest_batch | KEEP | 抓取窗口/校验值/行数清单/替代链是选版与删除安全的根 |
| pos_product_listing | KEEP | POS 商品来源身份 |
| pos_product_mapping | KEEP | listing→产品的有效期人工映射（CONFIRMED 非重叠） |
| pos_product_mapping_review | KEEP | 映射审核队列历史 |
| pos_sales_day | KEEP | 来源日汇总原值（guest_count 等口径仅日表有）；客单价已外移视图 |
| pos_sales_hour | KEEP | 来源小时原值（见字段清单对 unassigned_order_count 的异议） |
| pos_item_sales_hour | KEEP | 商品×小时来源原值+商品名快照 |
| pos_daily_breakdown | KEEP | 支付/渠道维度拆分是独立来源报表 |
| pos_item_waste | KEEP | 报废原值+批内来源行指纹 |
| ops_stockout_event | KEEP | 断货区间观察与人工确认；分钟级底数不落库故不可重建 |
| pos_order | KEEP | 来源订单稳定身份（不带金额/状态，防未证明字段） |
| pos_order_item | KEEP | 批次×订单×listing 最小商品事实；member_id 不冗余，SUM 前行数留证 |
| pos_payment | DEFER_SOURCE | 来源记录 ID/更正/重跑契约未证明 |
| pos_refund | DEFER_SOURCE | 同上 |
| pos_member | KEEP | 会员来源身份与档案覆盖状态；has_card 已派生（阻断项 A2 的积分/等级去向须补声明） |
| pos_member_contact | KEEP | 加密手机号+换号历史，contact_type 锁死 PHONE |
| pos_member_card | KEEP | 卡级身份，防余额永远聚在会员行 |
| pos_member_balance_snapshot | KEEP | 余额存量观察，流水不完整时不可反推；**卡级粒度是否可得待来源证实** |
| pos_member_card_transaction | KEEP | 卡交易事件原值（A2：前后余额证据弃留须声明） |
| pos_member_daily_metric | KEEP | RES 会员日报独立观察；归属覆盖仅 59.4%，不可由订单/卡流水重建（A2：字段集窄于来源须声明） |
| ops_calendar_event | KEEP | 批准的日历事件（导入批次并入 app_job_run 成立） |
| ops_operational_event | KEEP | 突发事件区间观察+证据 |
| ops_operational_event_product | KEEP | 事件×产品多对多 |
| ops_forecast_run | KEEP | 决策输出：输入清单冻结，当前输入无法重现历史预测 |
| ops_forecast_line | KEEP | 同上；准确率/误差全部在视图 |
| ops_production_plan_version | KEEP | 计划版本是人工决定；吸收空壳主单成立（地点+营业日即身份） |
| ops_production_plan_line | KEEP | 版本×产品计划量+调整原因/AI 归因（吸收 ops_plan_adjustment 且改并到行粒度，比 Claude 原案更正确）；delta 派生 |
| ops_daily_review | KEEP | 复盘版本+店长独立报告数字是人工事实（详见反证 5） |
| ops_review_action | KEEP | 行动指派/完成是业务副作用 |
| ops_business_rule | KEEP | 规则代码×版本、ACTIVE 非重叠 |
| ops_role | KEEP | 标准岗位主数据 |

**hr（招聘核心 + 培训扩展）**

| 表 | 判定 | 理由 |
|---|---|---|
| hr_job_requisition | KEEP | 招聘需求流程事实 |
| hr_application | KEEP | 人×需求×一次申请 |
| hr_application_stage_event | KEEP | 阶段迁移只追加，保漏斗历史 |
| hr_appointment | KEEP | 预约+试工执行/结果/安全事件（吸收 0 行的 hr_trial 成立） |
| hr_assessment | KEEP | 评估事件；total_score 已外移视图 |
| hr_assessment_score | KEEP | 逐项得分+评分项名称快照 |
| hr_offer | KEEP | Offer 版本与响应 |
| hr_employee_event | KEEP | 雇佣事件（转正/调薪…） |
| hr_screening_rule | KEEP | 筛选规则版本 |
| hr_onboarding_task / hr_training_course / hr_training_course_version / hr_training_assignment / hr_training_result / ops_role_training_requirement | EXTENSION_ONLY ×6 | 培训与入职模块无写入者；课程版本 PUBLISHED 非重叠等约束已预审 |
| ops_station / ops_workload_run / ops_workload_line / ops_shift_plan_version / ops_shift_requirement / ops_shift_assignment | EXTENSION_ONLY ×6 | 班表/工作量包：fact_shift 现库 0 行、四项目零运行时引用（兼容矩阵无此对象），"无现役写入者"成立；ops_shift_plan_version 吸收空壳 ops_shift_plan 成立 |
| hr_timesheet_sync_batch | DEFER_SOURCE | Lark 身份/修改/撤销/重跑契约未证；批次带 parser_version，契约获证即可建 |
| hr_timesheet_entry | DEFER_SOURCE | 同上；(批次,来源ID) 唯一+APPEND_ONLY+current 视图选版，更正不会重复计入 |

**scm / cost / finance / mkt**

| 表 | 判定 | 理由 |
|---|---|---|
| scm_material_unit_conversion | KEEP | 物料级包装换算的生效版本（CASE→g 不进全局单位表），VERIFIED 非重叠 |
| scm_supplier | KEEP | 供应商身份与默认币种 |
| scm_supplier_item | KEEP | SKU×物料×包装的生效版本+supersedes 链（吸收一对一映射表成立）；基础量派生不落库 |
| scm_supplier_price_observation | KEEP | 市场价观察事件，收货行/采购行/来源记录三路去重 |
| scm_supplier_item_mapping_review / scm_inventory_count / scm_inventory_count_line / scm_inventory_movement / scm_inventory_movement_line / scm_material_requirement_run / scm_material_requirement_component / scm_replenishment_run / scm_replenishment_line / scm_purchase_order_revision / scm_purchase_order_line / scm_goods_receipt / scm_goods_receipt_line | EXTENSION_ONLY ×13 | 采购/库存包未立项；结构预审全部通过（详见反证 1、2）；scm_purchase_order_revision 吸收空壳主单成立 |
| cost_card_recipe_version | KEEP | 发布配方版本是人工决定（recipe_code 分组，吸收 recipe 主档成立），PUBLISHED 非重叠 |
| cost_card_recipe_component | KEEP | 配方用料明细是成本派生最小输入；基础量派生 |
| cost_card_material_price | KEEP | 成本采用价是批准决定（含 MIGRATED_MANUAL 质量态），非重叠区间 |
| finance_import_batch | KEEP | 财务导入批次+技术状态与会计认可状态分离 |
| finance_sales_daily / finance_item_sales_monthly / finance_monthly_cost_line / finance_cashflow_line / finance_order_logistics_line / finance_inventory_snapshot_line / finance_inventory_flow_line / finance_supplier_purchase_monthly / finance_monthly_metric | KEEP ×9 | 财务模板来源原值，独立于 POS 口径，行定位符保留真实重复 |
| finance_target | KEEP | 目标版本（人工决定） |
| finance_period_category_map | KEEP | 费用归类规则生效期（ACTIVE 非重叠） |
| mkt_campaign_version | KEEP | 活动版本钉住算法与规则（吸收 campaign 主档成立），PUBLISHED 期间非重叠 |
| mkt_campaign_member | KEEP | 参与关系与资格证据 |
| mkt_survey_question / mkt_survey_question_option | KEEP ×2 | 版本化题目/选项定义 |
| mkt_survey_response / mkt_survey_answer | KEEP ×2 | 作答尝试与逐题原子答案（HBTI 13 题迁移落点） |
| mkt_survey_result | KEEP | 算法版本化测评结果；离线重算不回写旧结果 |
| mkt_reward | KEEP | 奖励主数据 |
| mkt_reward_stock | KEEP | 库存计数是并发扣减的运行状态，恒等式由核对视图持续验证 |
| mkt_reward_claim | KEEP | 领取/核销是业务副作用 |

计数自证：KEEP=100（81 业务+19 平台）、EXTENSION_ONLY=34、DEFER_SOURCE=4，合计 138，与终稿零分歧；分歧全部记在下面的字段与证据层。

## 可疑物理字段完整清单

扫描方法见下节；以下是全部存疑条目（含裁定），不是抽样。

| 字段 | 问题 | 建议 |
|---|---|---|
| `pos_sales_hour.unassigned_order_count` | 存的是"日表−小时表"差值，本质是两个来源事实之间的核对结论，与 v_pos_revenue_reconciliation 职责重复，还要靠"专门补差行"承载 | 删除，由核对视图输出；若坚持保留须给出它是来源直接返回字段的证据 |
| `pos_product_listing.current_price` | "当前"缓存语义，CONTROLLED_UPDATE 覆盖即丢历史，且历史无法从其他事实重建 | 可接受为主档属性，但注释须明示无历史；需要价格趋势时再立观察事实 |
| `msg_outbound_message.extension_source_type/_id` | 受约束的多态引用（entity_type+id 模式），有静默变成关键连接的漂移风险 | 保留但写死升格条件；验证器禁止其出现在任何视图 join |
| `app_data_quality_issue.entity_type/_id` | 同类多态；与包自身"不得用 entity_type+entity_id 伪装"原则相抵 | 扩展启用时加按类型的局部校验函数；治理队列场景可豁免 |
| `scm_purchase_order_revision.subtotal_amount/tax_amount/total_amount` | 可由行派生的单据合计物理落库 | "批准单据快照+核对视图"论证成立；补 CHECK total=subtotal+tax |
| `scm_purchase_order_line.line_amount` | qty×价可派生 | 已论证为批准舍入快照并有核对视图，成立，不改 |
| `pos_member_card_transaction.total_amount` | 可由 cash+gift 派生 | 保留为来源原值合理（核对锚点），不改 |
| `ops_daily_review.manager_avg_transaction` | "只存独立报告值、系统算的必须留空"只有约定没有机器门禁 | 写入路径加应用校验；核对视图并列输出派生客单与差异 |
| `hr_timesheet_entry.net_work_minutes` | 规则标准化结果落库 | 成立：parser_version 冻结在批次上，可复现；不改 |
| `app_user.failed_login_count` | 理论可由审计事件派生 | 安全节流状态，成立不改 |
| `pos_order_item.quality_status` 枚举 `LISTING_PENDING` | listing_id 为非空 FK，与"未接上 listing"字面矛盾（实际指产品映射未完成） | 改名 `PRODUCT_MAPPING_PENDING` 或修注释 |
| `v_pos_order_item_current` 说明用词 `MEMBER_ORDER_ITEM` vs 枚举 `MEMBER_FLAGGED_ONLY` | dataset_code 与 coverage_scope 词表不一致 | 统一词表 |
| 目标 `pos_member` 缺积分/等级/成长/终身累计 | 见阻断项 A2 | 补列或明文弃用声明 |
| 目标 `pos_member_card_transaction` 缺前后余额、point_delta | 见阻断项 A2 | 同上 |
| 目标 `pos_member_daily_metric` 缺计数类/充退分项/total_consume_amount | 见阻断项 A2；且 member_sales_ratio 改用 POS 净销售当分母后，与来源自报比率是两个口径 | 同上；视图注释声明分母口径差异 |

## 逐字段可派生性核对方法（1733 全量，非抽样）

对字段字典全部 1733 个物理字段跑六类模式机扫并逐命中裁定：聚合类（total/sum/subtotal/count/avg/ratio/margin/balance/delta/variance，命中 40，其中 24 为假阳性如 inventory_count/checksum）、current/latest/last/first 类（命中 10）、jsonb（56 个，全部是证据/输入清单/低频扩展语义，稳定分析字段无一藏入 JSON，两处配 schema 版本列）、多态（2 组，见上）、名称类（43 个，全部为主档展示名或明示"快照"的来源证据，无事实表以名称做连接键）、币种/单位类（27 张表各恰 1 个 currency，采购行不复制版本头币种，收货行独立币种为发票事实；数量单位一律经 unit FK 或物料换算 FK 冻结解释）。所有真实命中已尽列于上表；其余 1600+ 字段属身份键、外键、来源原值、时间戳、状态机与证据列，与各表声明粒度一致。catalog 的 `derived_fields_or_outputs` 里申报的 14 处"派生进视图"（客单价、会员占比、has_card、评估总分、补货差值、成本组件等）逐一在 53 视图中找到承接者。

## 注释覆盖与充分性

- **语法覆盖 100%**：2435 条 = 138 表 + 53 视图 + 2244 列，与字典键集完全相等、唯一、非空；物理列 11 个槽位（存放/作用/类型/可空/默认/键约束/时间/历史/敏感/示例/误用）全部在位；视图列以「输出」替代「存放」、无默认/键/历史槽，属合理设计而非缺失。文件头带 DESIGN-ONLY 声明。
- **业务解释充分性**：关键业务列（金额、时间语义、NULL 语义、来源证据、版本冻结）解释具体且含反误用句式（如"不能与会员卡核销额对账""不能由 UTC 日期推导营业日"）。弱点是模板复用：721/2244 列的误用提醒是通用句（"按表粒度和字段定义使用…"），706 列示例是同一占位 UUID——对 uuid 键诚实但低信息量。定性：**覆盖满分，充分性达标，样板化为可接受的改进项**，不构成阻断。

## 关系、粒度、历史与单位（必查 2/5/6/7 摘要）

- 419 个 FK 全部指向存在的表；138/138 有主键；53/53 视图 lineage 可解析、无环、无悬空。19 张仅有代理主键无业务唯一键的表（app_job_run、各 *_review、*_run、事件表等）逐一核过：或为运行台账（重跑本应多行）、或为审核尝试历史、或由非重叠排斥约束兜底（ops_stockout_event）；无一张事实表靠"最后写入行"表达当前值。
- 21 张表带 `[from,to)` 非重叠排斥约束，覆盖身份映射、别名、授权、课程、配方、换算、采用价、归类、活动期间；含可空列的唯一键全部显式声明 NULLS DISTINCT / NOT DISTINCT。
- 历史与重跑链条闭合：POS 整批不可变快照+supersedes+`v_pos_order_item_current` 确定性选版（coverage 优先→SUCCEEDED→未被替代→completed_at/created_at/batch_id 破平），删除安全靠新整批而非 upsert；工时 (批次,来源ID) 唯一+新内容新批次+current 视图按 completed_at DESC 选版；复盘/财务批次 current 视图均有三级破平。一处仅靠应用约定：收货行必须同属一个采购版本（03 字典 3815 行自认"受控写入必须确认"）——建议实施时用复合外键 (purchase_order_line_id, purchase_order_revision_id) 上钉。
- 现库有 198 索引/13 触发器/26 RLS policy（review-baseline.json），目标模型完全没有索引/触发器/RLS/FK 动作维度。逻辑契约完备但共享库的行级安全设计缺位，"无损承接"在这些维度未被验证——列入修改顺序。

## 重点反证八项结论

1. **scm_purchase_order_revision**：`purchase_order_code`+`revision_no` 唯一、based_on 链、SENT 后换供应商/币种必须换单号——版本表足以承载单据身份，空壳主单无独有事实，删除正确；收货头 `purchase_order_revision_id` 非空 FK 钉住具体版本，且注释禁止跨版本混单（补复合 FK 更佳）。
2. **scm_material_requirement_component**：只存算法产出的 material_quantity、采用组件与阻断证据；计划量经 production_plan_line_id 读冻结值不复制；CHECK 强制 COMPLETE 行三要素齐备；汇总行确实由 `v_scm_material_requirement_line` 派生且 run_issue_count 按整个运行计数、不伪造 0 需求。成立。
3. **hr_timesheet_entry**：APPEND_ONLY+批次幂等（同输入同 parser_version 命中同 idempotency_key）+更正走新批次，`v_hr_timesheet_entry_current` 以 (来源,外部ID) 分组、completed_at DESC 确定性选版并输出 revision_count——不会重复计算，分析入口正确。DEFER_SOURCE 定位诚实（撤销/删除语义未证）。
4. **pos_member_daily_metric / pos_member_balance_snapshot**：是独立来源报告值，不是订单/卡流水的复制——现库 `pos_member_daily` 就是该日报的既有落地，且订单归属覆盖仅 59.4%、卡交易额≠商品净额，反推不可行。无需降级。但 A2 的字段收窄必须补声明；余额快照的"卡级"粒度尚无来源证据（现库为会员级），若 RES 只给会员级，此表粒度须降级为会员×日期。
5. **ops_daily_review.manager_\***：是独立人工报告事实（与 POS 靠 `v_ops_manager_sales_reconciliation` 对账），manager_avg_transaction 明文只收历史/独立值、派生值必须留空——判定成立，缺的是机器门禁（见字段清单）。
6. **19 张平台侧车**：全部有现库前身（schema_migrations、app_session、hbti_auth_token、hbti_rate_limit、wa_outbound_queue、prompt_*、ai_call_log…）且多为跨项目读写（BakeryOps 写消息、HBTI 读），在"一库四仓库、无 Redis"的现实拓扑下放共享库成立；`app_session`、`app_rate_limit_event` 是仅有的两个可外置候选，不阻断。
7. **34 张扩展表**：audit_action 31 张 `DESIGN_ONLY_DO_NOT_CREATE`+3 张措辞例外（quality_issue、shift_plan_version、purchase_order_revision——tier/lifecycle 仍正确，建议补齐措辞）；"无现役写入者"抽最强反例 fact_shift 验证：现库 0 行、兼容矩阵四项目零运行时引用，成立。文档未误导立即建表，但 A3 的视图血缘会诱导误建。
8. **前后余额与积分**：见 A2——这是本次审计在"来源事实无损"上找到的最重反例。

## 已确认事实 / 合理推测 / 待验证

**已确认（静态文件+机器核对）**：上文全部统计；07 与 08 除标题外逐字节相同（230 行仅第 1 行异）；A1 的 7 处伪标（CSV vs 证据文件行级对照）；现库 76 表/21 视图/939 列/198 索引/13 触发器/26 policy；`pos_member_order_item` 43,997 行、59.4% 归属覆盖、5 歧义/2708 未匹配（evidence JSON 记载）；validator 对计数/唯一/注释/图表 fail-closed，但不校验归因列真实性。

**合理推测**：RES 会员日报接口形状≈现库 `pos_member_daily` 列集；fact_shift/trials 为 0 行历史遗留（引自上轮审计的行数证据，本次未连库复核）；两份评审 HTML 疑似同内容双命名（上轮侦察断言，本次未核 md5）。

**待运行时/来源合同验证**：POS 支付/退款契约；Lark 工时契约；余额快照卡级可得性；积分体系是否业务弃用；四个生产部署与本地代码一致性；静态扫描≠运行证明（包内已自认）。

## 最小修改顺序

1. **修 A1**：disposition CSV 归因列改存真实原判+新增 override 列；validator 增加与证据文件 104/36/3/5/2/4 的分布交叉校验。改动纯文档，无信息损失。
2. **修 A2**：对积分/等级/前后余额/日报计数与分项逐列给出"补列 / 归档不迁 / 弃用"三选一的书面处置，写入 current-to-target 矩阵；若弃用，风险是与 RES 报表的对账口径永久变窄，须业务签字。
3. **修 A3**：发布 53 视图的分期清单（首期 33/随包 20），`v_identity_mapping_gap` 去掉扩展表血缘出首期版；validator 机器化该清单。
4. 文档卫生：07/08 二选一删除；3 张扩展表 audit_action 补 DO_NOT_CREATE 措辞；REMOVE 行 r6_target 拆纯对象名；LISTING_PENDING/coverage_scope 词表统一。
5. `pos_sales_hour.unassigned_order_count` 移入核对视图（或出示来源字段证据）；PO 头补合计 CHECK；收货行补复合 FK。删列不丢信息：差值可由日/小时两事实随时重算，风险仅是查询成本。
6. 补 RLS/索引/触发器承接设计（26 policy 的映射口径），作为实施前新增章节。
7. 以上完成后，按 06 号文档五条硬门禁走实施审批——那是另一场审计。

