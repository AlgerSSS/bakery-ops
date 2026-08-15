# Claude Fable 5 R6 独立审计原始输出

> 证据说明：以下内容原样保存自 `/Users/weiliangshao/.claude/plans/hot-crush-zany-corbato.md`。它是独立审计意见，不等同于最终采纳方案；最终方案对 `ops_plan_adjustment` 的合并粒度和 `app_data_quality_issue` 的去向作了明确修正。
# HOT CRUSH 数据基座二次独立审计:最少物理事实版(R6 建议)

> 只读审计。未改任何仓库文件、未执行 DDL/DML/部署。证据基线沿用 R5:结构快照 2026-08-09T09:56:05Z(76 表/21 视图/939 列),代码静态扫描 2026-08-09T10:30:31Z,HEAD 6368c07。

## 一、结论

**R5 的 154 张表不成立为"最小物理基座"。按第一性标准逐表重判后:最小核心物理表 104 张,可选扩展包 36 张,改为视图 3 张,合并进核心表 5 张,删除 2 张,来源未证实延后 4 张。合计 154,无遗漏无重复。**

- 104 不是目标数字,是判定结果:每张核心表都能回答"删掉会丢失哪种不可重建事实"。
- 收缩没有引入 EAV、万能 JSON 或多态外键;唯一一张多态形状的表(`app_data_quality_issue`,`entity_type + entity_id` 文本引用)恰恰被删除。
- 收缩不破坏历史可复现性:被视图化的三张表,其全部输入(不可变批次、版本化配方、生效区间价格、算法版本)都在核心内,派生是确定性的;需要冻结的决策(预测行、发布计划版本、HBTI 结果)全部保留物理表。
- 收缩不破坏并发与审计:`mkt_reward_stock`(并发扣减)、`msg_conversation_state`(恢复检查点)、`app_audit_event`、`app_session` 等全部保留。

## 二、上一轮 154 的结论错在哪里

1. **答错了问题。** R5 的 07 号文件逐表回答的是"一行是否只有一种事实、表内粒度是否自洽"(154/154 全部 PASS),这是**最小行粒度**审计。用户要的是**最小物理基座**:整个持久化对象集合是否只包含不可重建事实。前者是逐表局部性质,后者是全局集合性质;154 张表可以每张都粒度自洽,而集合仍比必要大 50 张。
2. **规划模块被计入基座。** R5 自己标注了 27 张 `PLANNED_MODULE`(无已确认写入者),却仍把它们算进 154 的单一数字。按用户标准"尚无真实写入者的模块应放扩展包、不计入最小核心",这 27 张一张都不该在核心计数里。
3. **`CORE_MIGRATION` 标签造假象。** 有迁移去向 ≠ 有事实要保。`fact_shift` 现库 0 行、读写者均未被扫描确认,它"迁移"出的 4 张班表表实质是规划模块;`ops_production_plan_slot` 连迁移来源都没有(现库无时段粒度数据);`hr_trial` 迁移自 0 行的 `trials`。R5 把"目标蓝图里的位置"当成了"当下必须存在的物理表"。
4. **冻结派生被过度使用。** 冻结只在"决策消费方需要按当时口径复现,且输入不可全程版本化"时成立。成本快照不满足:配方版本、采用价生效区间、单位换算在 R5 模型里全部版本化,任意历史日成本可确定性重算;真被引用过的数字已冻结在复盘行和财务事实里。节假日因子同理:`ops_forecast_run.input_manifest` 已锁定销售批次、日历批次、规则版本和算法版本,再存一张观察表是同一事实的第二份缓存。
5. **一对一/头尾表惯性拆分。** `hr_trial` 与试工预约 1:1、同写入者同权限;`ops_plan_adjustment` 的 before/after/delta 可由版本行差集派生(唯一不可派生的 reason/AI 归因可放版本行);`ai_prompt_template_version` 复刻的历史冻结职责已由 `ai_call` 全文入参日志承担。
6. **R5 新增的两张,一对一错。** `hr_application_stage_event` 成立(见六-2);`scm_supplier_item_material_mapping` 不成立——它要保护的"SKU→物料规格历史"在现库中根本不存在(344 行价格历史无一条规格变更记录),而引用它的补货/采购行全是规划模块。为不存在的历史建版本表,属于给未上线模块的镀金。

## 三、判定口径(与提问一致,不重复展开)

物理保留仅限:①不可变来源事实(含来源命名空间/批次/幂等定位);②企业稳定身份与必要映射;③不可由事实重建的人工决定与发布版本;④有已证实写入者和运行约束的技术状态。当前状态/汇总/比率/差值一律派生;无写入者的模块入扩展包;来源合同未证实延后;合并要求写入者、生命周期、权限边界、变更频率一致且一对一。

## 四、收缩后的目标结构

### 4.1 最小核心物理表:104 张

按域:app 12,ops 17,hr 14,pos 17,scm 7,cost 4,finance 12,mkt 11,msg 6,ai 4。

- **app(12)**:app_schema_migration, app_source_system, app_unit, app_job_run, app_audit_event, app_user, app_role, app_user_role, app_user_location_scope, app_session, app_one_time_token, app_rate_limit_event
- **ops(17)**:ops_location, ops_location_source_identity, ops_product, ops_product_alias, ops_stockout_event, ops_calendar_event, ops_operational_event, ops_operational_event_product, ops_forecast_run, ops_forecast_line, ops_production_plan, ops_production_plan_version, ops_production_plan_line, ops_daily_review, ops_review_action, ops_business_rule, ops_role
- **hr(14)**:hr_person, hr_person_contact, hr_employment, hr_employment_source_identity, hr_employment_mapping_review, hr_job_requisition, hr_application, hr_application_stage_event, hr_appointment, hr_assessment, hr_assessment_score, hr_offer, hr_employee_event, hr_screening_rule
- **pos(17)**:pos_ingest_batch, pos_product_listing, pos_product_mapping, pos_product_mapping_review, pos_sales_day, pos_sales_hour, pos_item_sales_hour, pos_daily_breakdown, pos_item_waste, pos_order, pos_order_item, pos_member, pos_member_contact, pos_member_card, pos_member_balance_snapshot, pos_member_card_transaction, pos_member_daily_metric
- **scm(7)**:scm_material, scm_material_alias, scm_material_source_identity, scm_material_unit_conversion, scm_supplier, scm_supplier_item, scm_supplier_price_observation
- **cost(4)**:cost_card_recipe, cost_card_recipe_version, cost_card_recipe_component, cost_card_material_price
- **finance(12)**:finance_import_batch, finance_sales_daily, finance_item_sales_monthly, finance_monthly_cost_line, finance_cashflow_line, finance_order_logistics_line, finance_inventory_snapshot_line, finance_inventory_flow_line, finance_supplier_purchase_monthly, finance_target, finance_monthly_metric, finance_period_category_map
- **mkt(11)**:mkt_campaign, mkt_campaign_version, mkt_campaign_member, mkt_survey_question, mkt_survey_question_option, mkt_survey_response, mkt_survey_answer, mkt_survey_result, mkt_reward, mkt_reward_stock, mkt_reward_claim
- **msg(6)**:msg_conversation, msg_message, msg_conversation_state, msg_outbound_message, msg_delivery_attempt, msg_push_deduplication
- **ai(4)**:ai_prompt_segment, ai_prompt_template, ai_prompt_template_segment, ai_call

其中 `app_rate_limit_event`、`ai_call` 属"技术附属层":留在核心仅因有已证实写入者(hbti_web、bakery_ops),治理上应与业务事实分层标注,未来可下沉到应用私有 schema 而不动业务基座。

### 4.2 可选扩展包:36 张(6 个包,各自证实写入者后才建)

| 扩展包 | 表 | 启用门禁 |
|---|---|---|
| 排班与工时(7) | ops_shift_plan, ops_shift_plan_version, ops_shift_requirement, ops_shift_assignment, ops_workload_run, ops_workload_line, ops_station | 班表流程真实上线(现 fact_shift 0 行、写入者未确认) |
| 生产执行与配送(5) | ops_production_run, ops_production_run_line, ops_dispatch, ops_dispatch_line, ops_production_plan_slot | 门店/厨房实际回报生产与配送数据 |
| 采购与库存(16) | scm_inventory_count, scm_inventory_count_line, scm_inventory_movement, scm_inventory_movement_line, scm_material_requirement_run, scm_material_requirement_line, scm_material_requirement_component, scm_replenishment_run, scm_replenishment_line, scm_purchase_order, scm_purchase_order_revision, scm_purchase_order_line, scm_goods_receipt, scm_goods_receipt_line, scm_supplier_item_mapping_review;并在此时把 scm_supplier_item_material_mapping 恢复为独立生效期表 | 采购/库存模块立项且 SKU 规格变更成为真实现象 |
| 培训与入职(6) | hr_training_course, hr_training_course_version, hr_training_assignment, hr_training_result, hr_onboarding_task, ops_role_training_requirement | 培训管理有真实负责人与数据 |
| 细粒度权限(2) | app_permission, app_role_permission | 出现超出三角色(viewer/editor/admin)+地点范围的真实授权需求 |
| 渠道回执(1) | msg_delivery_event | WhatsApp/其他渠道回执(DELIVERED/READ)真的被采集 |

### 4.3 改为视图/物化视图:3 张(并入现有 50 视图层)

- `ops_demand_factor_observation` → `v_ops_holiday_factor`(现库已有 v_holiday_factor 视图,109 迁移声明):由不可变销售批次+日历事件+算法版本确定性重算;预测所用值由 `ops_forecast_run.input_manifest` 冻结;人工认定的因子走 `ops_business_rule` 版本(即现状 business_rule 的归宿)。
- `cost_card_product_cost_snapshot` → 视图(慢则物化):输入(配方版本、采用价区间、单位换算)全部版本化,任意历史日成本可重算;现库本来就用视图(v_cost_card_current_cost、v_daily_margin)。
- `cost_card_product_cost_component` → 同上,成本组成即配方展开 × 区间价。

### 4.4 合并:5 张

| 被合并表 | 并入 | 迁移的不可派生内容 |
|---|---|---|
| ops_calendar_import_batch | app_job_run | 抓取来源与批准状态 → 事件行已有 status(ACTIVE/CANCELLED/SUPERSEDED),行级来源引用 job_run_id |
| ops_plan_adjustment | ops_production_plan_version | before/after/delta 由版本行差集派生;version 行已有 change_summary/actor,补 reason_code、ai_call_id 两列 |
| hr_trial | hr_appointment | 与预约 1:1、同写入者:actual_start/end、status、outcome、safety_incident 上预约行;评分仍在 hr_assessment(type=TRIAL) |
| scm_supplier_item_material_mapping | scm_supplier_item | material_id+规格作列;价格观察已双挂 supplier_item_id;规格历史现库不存在,待采购包启用时再版本化 |
| ai_prompt_template_version | ai_prompt_template | (template_key, version) 行内版本(即现库 prompt_template 的已证实形状);实际调用入参已由 ai_call 全文冻结 |

### 4.5 删除:2 张

- `app_data_quality_issue`:无写入者 + `entity_type/entity_id` 多态文本引用(用户明令禁止的形状);其检测层=质量视图(现库已这么做),其处置层=三张类型化映射审核表,其告警层=alert-relay(Lark)。
- `cost_card_cost_run`:随成本快照视图化而失去用途;物化刷新的运行痕迹归 `app_job_run`。

### 4.6 来源延后:4 张

`pos_payment`、`pos_refund`(支付/退款来源身份、重放契约未证实)、`hr_timesheet_sync_batch`、`hr_timesheet_entry`(Lark 员工 ID、修改/撤销、幂等重跑未证实)。方向保留,不建表。

## 五、完整逐表处置清单(154 行,可机器核对)

格式:`table_name | disposition | reason`。顺序与 07 号文件 #1–#154 一致。

```
app_schema_migration | CORE_KEEP | 删掉丢失各仓库已执行迁移账本,无法从库结构反推执行历史与归属仓库
app_source_system | CORE_KEEP | 删掉丢失来源命名空间主档,所有 source_identity/批次的外键锚点无处挂
app_unit | CORE_KEEP | 删掉后数量单位退回自由文本,CASE/BAG→g 换算失去受控锚点,历史数量不可解释
app_job_run | CORE_KEEP | 删掉丢失任务幂等与运行血缘(何批次由何次运行产生),失败重跑无法定位
app_data_quality_issue | REMOVE | 无写入者且为 entity_type+entity_id 多态形状;检测=视图、处置=类型化审核表、告警=alert-relay 已覆盖
app_audit_event | CORE_KEEP | 删掉丢失受控操作 before/after 审计(现 app_audit_log 331 行、ops_audit_log 有实写),事后不可重建
app_user | CORE_KEEP | 删掉丢失登录账号与凭据哈希(finance_web 实写),认证事实不可由业务数据派生
app_role | CORE_KEEP | 删掉丢失角色字典(现 3 行实用),授权语义失去锚点
app_permission | EXTENSION_LATER | 现权限=代码内角色判断,无原子权限写入者;细粒度 RBAC 属未证实需求
app_user_role | CORE_KEEP | 删掉丢失"谁被授予什么角色"的人工授权决定,不可从任何事实反推
app_role_permission | EXTENSION_LATER | 依赖 app_permission,同为未证实的细粒度授权矩阵
app_user_location_scope | CORE_KEEP | 删掉丢失账号×地点授权决定(现 store-scope.js 实读),多店权限无家
app_session | CORE_KEEP | 删掉丢失会话撤销状态(finance_web 实写 70 行),登出/过期控制失效
app_one_time_token | CORE_KEEP | 删掉丢失一次性令牌哈希与消费状态(hbti pg-auth-store 实写),防重放失效
app_rate_limit_event | CORE_KEEP | hbti 限流实写;窗口计数是执行约束状态,业务上可过期但运行上必须持久;标注技术附属层
ops_location | CORE_KEEP | 删掉丢失企业地点稳定身份,ops_store/finance_store 双套真相无法归一
ops_location_source_identity | CORE_KEEP | 删掉丢失来源系统×外部地点ID映射,POS/财务数据无法安全挂到 location_id
ops_product | CORE_KEEP | 删掉丢失企业产品身份(现 product 54 行实写),预测/成本/销售三方联动断裂
ops_product_alias | CORE_KEEP | 删掉丢失人工确认的别名→产品判定(现 98 行),Excel/口语名匹配不可重建
hr_person | CORE_KEEP | 删掉丢失自然人身份,staff/employees 两套人员无法归一,候选人→员工链断裂
hr_person_contact | CORE_KEEP | 删掉丢失带生效期的联系方式事实(招聘 FSM 以手机号为键),且失去 PII 权限隔离边界
hr_employment | CORE_KEEP | 删掉丢失一段雇佣关系(入职→离职)的事实边界,工时/班表/事件失去挂点
hr_employment_source_identity | CORE_KEEP | 删掉丢失 Lark open_id 等外部员工身份映射(lark-org-sync 实写),对账不可重建
hr_employment_mapping_review | CORE_KEEP | 删掉丢失身份匹配的人工否决/确认记录,同名冲突会被反复重新提出;迁移日一必需
scm_material | CORE_KEEP | 删掉丢失原料稳定身份(cost_card_item 184+11+162 行分型迁入),配方/价格失去主语
scm_material_alias | CORE_KEEP | 删掉丢失人工确认的物料别名判定(名映射 20/54 缺口是实证),匹配决定不可重建
scm_material_source_identity | CORE_KEEP | 删掉丢失外部物料目录ID映射,历史成本行无法安全重挂
pos_ingest_batch | CORE_KEEP | 删掉丢失抓取批次与完整性清单,整批选版/删除安全/重跑幂等全部失效
pos_product_listing | CORE_KEEP | 删掉丢失 RES 商品来源身份(现 pos_product 211 行),销售事实外键断裂
pos_product_mapping | CORE_KEEP | 删掉丢失 listing→企业产品的人工确认映射及生效期,跨域联动失去桥
pos_product_mapping_review | CORE_KEEP | 删掉丢失映射否决记录(同名跨org、2个未挂键是实证),错误候选将无限重现
pos_sales_day | CORE_KEEP | 来源原生日汇总(折扣/实收口径含单品明细没有的信息),删掉无法由明细重建来源口径
pos_sales_hour | CORE_KEEP | 来源原生小时汇总含账单数/客数(明细无此字段,hourly_sales_summary 2594 行实写)
pos_item_sales_hour | CORE_KEEP | 本库最细销售事实(item_hourly_sales 83109 行),一切销售派生的共同输入
pos_daily_breakdown | CORE_KEEP | 来源原生维度拆分(daily_breakdown 760 行实写),维度口径无法由其他事实重建
pos_item_waste | CORE_KEEP | 报废来源事实(item_waste 3727 行实写),不可由销售推出
ops_stockout_event | CORE_KEEP | 分钟级售罄观察+人工确认的唯一物理归宿(目标模型刻意不存订单时间);损失估算列应移视图
pos_order | CORE_KEEP | 来源订单稳定身份(12760 订单已证实可重跑),会员归属/订单行的外键锚
pos_order_item | CORE_KEEP | 订单×商品最小来源事实(43997 行已回填),会员关联/购物篮/HBTI 的共同底座
pos_payment | DEFER_SOURCE | 支付来源记录ID/更正/重放契约未证实,先建即造第二套未受控真相
pos_refund | DEFER_SOURCE | 退款来源身份与批次血缘未证实,同上
pos_member | CORE_KEEP | 会员稳定身份(4845 行),删掉后交易/画像/活动失去主语;活动状态已剥离
pos_member_contact | CORE_KEEP | 会员手机号等受限联系事实,权限边界要求独立于主档,不可并回
pos_member_card | CORE_KEEP | 卡身份独立于会员(卡可共享是已知边界),交易挂卡不挂人,删掉归属判断失真
pos_member_balance_snapshot | CORE_KEEP | 来源观察的余额存量;流水完整性未证实,余额不可由交易和可靠重建
pos_member_card_transaction | CORE_KEEP | 会员卡交易来源事实(14741 行),会员归属视图的判定输入
pos_member_daily_metric | CORE_KEEP | 来源原生会员日指标(储值净额/期末余额等含我方不可重算口径);比率已移视图
ops_calendar_import_batch | CORE_MERGE_INTO:app_job_run | 日历抓取即一次任务运行;批准语义在事件行 status,批次表无独有事实
ops_calendar_event | CORE_KEEP | 外部日历观察事实(holiday 18 行),公报页面事后不可靠,删掉即丢来源
ops_demand_factor_observation | DERIVE_VIEW | 由不可变销售批次+日历+算法版本确定性重算;预测所用值由 forecast_run.input_manifest 冻结;人工因子归 ops_business_rule
ops_operational_event | CORE_KEEP | 人工记录的突发事件(context_event 14 行实存),事后无法重建
ops_operational_event_product | CORE_KEEP | 事件波及产品范围是人工事实本身的一部分(1对多明细,不可并回主行)
ops_forecast_run | CORE_KEEP | 运行身份+input_manifest+算法版本,删掉则预测决策不可复现;是因子视图化的前提
ops_forecast_line | CORE_KEEP | 实际发出的预测建议(forecast_snapshot 1946 行),是历史决策事实,重算会漂移
ops_production_plan | CORE_KEEP | 地点×营业日计划锚点与版本号并发控制点(forecast_snapshot 有实写链路)
ops_production_plan_version | CORE_KEEP | 每版计划的人工调整/审批/发布是决定事实,覆盖式存储正是现状缺陷
ops_production_plan_line | CORE_KEEP | 版本×产品计划量为发布内容本身;行差集是调整派生的输入
ops_production_plan_slot | EXTENSION_LATER | 现库无时段粒度计划数据、无迁移来源,时段计划今日算完即弃;归生产执行包
ops_plan_adjustment | CORE_MERGE_INTO:ops_production_plan_version | 增减量=版本行差集可派生;不可派生的 reason/AI 归因以 reason_code+ai_call_id 列并入版本行
ops_workload_run | EXTENSION_LATER | 规划模块,无写入者;归排班与工时包
ops_workload_line | EXTENSION_LATER | 同上;冻结语义随包启用
ops_production_run | EXTENSION_LATER | 无生产执行回报数据与写入者;归生产执行包
ops_production_run_line | EXTENSION_LATER | 同上
ops_dispatch | EXTENSION_LATER | 无配送执行数据与写入者;归生产执行包
ops_dispatch_line | EXTENSION_LATER | 同上
ops_daily_review | CORE_KEEP | 复盘发布内容(daily_review 16 行实写)是人工+AI 决定事实,含向人汇报过的数字
ops_review_action | CORE_KEEP | 复盘行动与采纳状态为人工决定(suggestions_json 实存待结构化);被 msg_outbound_message 引用
ops_business_rule | CORE_KEEP | 版本化业务规则(business_rule 16 行实写)是人工参数决定,亦是人工因子的归宿
hr_job_requisition | CORE_KEEP | 招聘需求与审批(job_openings 实存)是人工决定;application/offer 的外键锚
hr_application | CORE_KEEP | 候选申请事实(applications 125 行实写),漏斗主对象
hr_application_stage_event | CORE_KEEP | 现状 stage 覆盖式更新已在丢历史;rejected/backup_pool 等迁移无里程碑对象,删掉即永久丢失漏斗
hr_appointment | CORE_KEEP | 面试/试工预约与到场执行事实(appointments 实存);试工执行字段并入本表
hr_assessment | CORE_KEEP | 一次评估的评估人/模板版本/红线结论是人工事实;总分已移视图
hr_assessment_score | CORE_KEEP | 评分项明细是评估的最小输入(1对多),删掉只剩结论无法审计
hr_trial | CORE_MERGE_INTO:hr_appointment | 与 TRIAL 预约 1:1、同写入者同权限;到场/结果/红线上预约行,评分留 hr_assessment
hr_offer | CORE_KEEP | Offer 版本与薪资决定(offers 表实存流程)是人工决定事实
hr_onboarding_task | EXTENSION_LATER | 规划模块,无写入者;归培训与入职包
hr_employee_event | CORE_KEEP | 转正/奖惩/离职事件是发生即不可重建的人事事实(probation-reminder 实读)
hr_screening_rule | CORE_KEEP | AI 提炼+人工批准的筛选规则版本(screening_rules 30 行实写)
hr_training_course | EXTENSION_LATER | 规划模块,无写入者;归培训包
hr_training_course_version | EXTENSION_LATER | 同上
hr_training_assignment | EXTENSION_LATER | 同上
hr_training_result | EXTENSION_LATER | 同上
ops_role | CORE_KEEP | 标准岗位主档被核心招聘链引用(requisition/offer/screening_rule.role_id),文本岗位不可靠
ops_station | EXTENSION_LATER | 仅被班表/工作量/工时(全部延后)引用,当前无核心消费方;归排班包
ops_role_training_requirement | EXTENSION_LATER | 规划模块;归培训包
ops_shift_plan | EXTENSION_LATER | 迁移来源 fact_shift 为 0 行且写入者未确认,班表模块未上线;归排班包
ops_shift_plan_version | EXTENSION_LATER | 同上
ops_shift_requirement | EXTENSION_LATER | 规划模块;同上
ops_shift_assignment | EXTENSION_LATER | 同上;hr_timesheet_entry 对它的引用同为延后对象
hr_timesheet_sync_batch | DEFER_SOURCE | Lark 工时来源ID/修改撤销/重跑契约未证实
hr_timesheet_entry | DEFER_SOURCE | 同上
scm_material_unit_conversion | CORE_KEEP | 物料×单位×生效期换算是人工批准事实,删掉则历史数量换算不可复现(数量级风险)
scm_supplier | CORE_KEEP | 供应商稳定身份(价格历史与财务采购月表的主语),名称不可作键
scm_supplier_item | CORE_KEEP | 供应商 SKU 身份+商业条款,344 行价格历史的稳定主语;物料对应以列并入本表
scm_supplier_item_material_mapping | CORE_MERGE_INTO:scm_supplier_item | 要保护的规格变更历史现库不存在;引用它的采购/补货行全为扩展包;包启用时再恢复为生效期表
scm_supplier_item_mapping_review | EXTENSION_LATER | 服务采购包的映射审核,日一工作量可由 material_alias+人工覆盖;随采购包启用
scm_inventory_count | EXTENSION_LATER | 规划模块,无写入者;归采购与库存包
scm_inventory_count_line | EXTENSION_LATER | 同上
scm_inventory_movement | EXTENSION_LATER | 同上;库存余额届时由移动明细派生视图
scm_inventory_movement_line | EXTENSION_LATER | 同上
scm_material_requirement_run | EXTENSION_LATER | 同上
scm_material_requirement_line | EXTENSION_LATER | 同上
scm_material_requirement_component | EXTENSION_LATER | 同上
scm_replenishment_run | EXTENSION_LATER | 同上(现有"加减货建议"是成品侧推送,非原料补货,不构成写入者)
scm_replenishment_line | EXTENSION_LATER | 同上
scm_purchase_order | EXTENSION_LATER | 同上
scm_purchase_order_revision | EXTENSION_LATER | 同上
scm_purchase_order_line | EXTENSION_LATER | 同上
scm_goods_receipt | EXTENSION_LATER | 同上
scm_goods_receipt_line | EXTENSION_LATER | 同上
scm_supplier_price_observation | CORE_KEEP | 供应商价格观察史(cost_card_item_price 344 行实写)是采用价的证据输入,不可重建
cost_card_recipe | CORE_KEEP | 配方身份主档(cost_card_recipe 289 行实写),版本与产品/物料联动的锚
cost_card_recipe_version | CORE_KEEP | 发布配方版本是人工决定事实(现库 item_id+version 已实存),历史成本解释依赖它
cost_card_recipe_component | CORE_KEEP | 配方用料明细(cost_card_recipe_item 1527 行实写)是成本派生的最小输入
cost_card_material_price | CORE_KEEP | 人工采用价+生效区间是决定事实(区别于观察价),成本确定性重算的输入
cost_card_cost_run | REMOVE | 快照视图化后失去用途;物化刷新痕迹归 app_job_run
cost_card_product_cost_snapshot | DERIVE_VIEW | 输入全版本化(配方版本/采用价区间/换算),任意历史日成本确定性重算;现库即视图方案
cost_card_product_cost_component | DERIVE_VIEW | 同上,成本组成=配方展开×区间价
finance_import_batch | CORE_KEEP | 导入批次+会计认可状态(import-batch.js 实写)承载幂等与"哪批算数"的人工决定
finance_sales_daily | CORE_KEEP | 财务模板口径日销售来源事实(与 POS 口径分写是本方案核心修复)
finance_item_sales_monthly | CORE_KEEP | 财务单品月模板来源事实(finance_item_sales 76 行)
finance_monthly_cost_line | CORE_KEEP | 五张现费用表(expense/raw/labor/labor_detail/material)归一的来源事实,Excel 之外无第二来源
finance_cashflow_line | CORE_KEEP | 现金流模板来源事实(finance_cashflow 42 行)
finance_order_logistics_line | CORE_KEEP | 物流订货台账来源事实(finance_orders 19 行,六日期链路不可重建)
finance_inventory_snapshot_line | CORE_KEEP | 月库存盘点模板来源事实(finance_stock 482 行)
finance_inventory_flow_line | CORE_KEEP | 月进销存模板来源事实(finance_stock_flow 491 行)
finance_supplier_purchase_monthly | CORE_KEEP | 供应商月采购模板事实;其上游逐日流水不在库内,删掉不可重建
finance_target | CORE_KEEP | 管理层批准的经营目标版本(finance_targets 138 行)是人工决定
finance_monthly_metric | CORE_KEEP | 模板过账口径指标(pl_metrics 66 行+order_base 7 行)含摊销与人工调整,非纯派生
finance_period_category_map | CORE_KEEP | 费用归类规则版本(finance_period_map 29 行)是人工口径决定
mkt_campaign | CORE_KEEP | 活动稳定身份(HBTI 实运行),版本与参与的锚
mkt_campaign_version | CORE_KEEP | 版本钉住正式算法与配置,是结果可解释性的前提(fact_hbti_response 主键已含它)
mkt_campaign_member | CORE_KEEP | 会员×活动参与状态(现混在 pos_member hbti_ 八列,即双写事故现场),剥离后必须有家
mkt_survey_question | CORE_KEEP | 答案外键所指题目主档;删掉则 mkt_survey_answer 退化为不可解释代码(现藏在代码里)
mkt_survey_question_option | CORE_KEEP | 选项→维度映射是答案解释的最小主数据
mkt_survey_response | CORE_KEEP | 一次作答提交事件(含尝试次数)是来源事实
mkt_survey_answer | CORE_KEEP | 题目级原始作答是结果重算的最小输入,删掉只剩结论
mkt_survey_result | CORE_KEEP | 已发放给会员并驱动奖励的算法结果版本;重算不得改写历史发放事实
mkt_reward | CORE_KEEP | 奖励主数据(hbti_gift_stock 模板 9 行实写)
mkt_reward_stock | CORE_KEEP | 在线并发预留/扣减的事务控制行(gift-pool 原子扣减实写);计数由领取事实视图核对
mkt_reward_claim | CORE_KEEP | 一次奖励领取/核销是业务副作用事实,库存核对的输入
msg_conversation | CORE_KEEP | 渠道会话身份(candidate_conversations 42 行实写),消息与状态的锚
msg_message | CORE_KEEP | 消息正文不可变事实(chat_history 实写),会话派生状态的输入
msg_conversation_state | CORE_KEEP | FSM 恢复检查点(candidate FSM+session_state 实写);LLM 对话不可确定性重放,检查点即事实
msg_outbound_message | CORE_KEEP | 外发意图+幂等键(wa_outbound_queue 实写),防重发的持久状态
msg_delivery_attempt | CORE_KEEP | 逐次发送尝试(wa_send_log 实写)是冷发限额的计数依据,发生即不可重建
msg_delivery_event | EXTENSION_LATER | 当前无渠道回执采集器(wa_send_log 仅号码+日期);回执落地后随包启用
msg_push_deduplication | CORE_KEEP | 推送幂等记录(daily_push_log 161 行实写),重启防重复的运行约束
ai_prompt_segment | CORE_KEEP | Prompt 片段主档(prompt_segment 45 行实写),模板组合的引用对象
ai_prompt_template | CORE_KEEP | AI 场景配置主档(prompt_template 5 行实写);(key,version) 行内版本即现库已证实形状
ai_prompt_template_version | CORE_MERGE_INTO:ai_prompt_template | 独立版本史无消费方:实际调用入参由 ai_call 全文冻结,配置变更由 app_audit_event 记录
ai_prompt_template_segment | CORE_KEEP | 模板×顺序×片段的组合关系,替代现状 JSON 数组(关系不入 JSON 是本方案红线)
ai_call | CORE_KEEP | 一次模型调用的入参/出参/token/耗时(ai_call_log 131 行实写)是 AI 参与决策的审计事实;须脱敏分层
```

**计数核对**:CORE_KEEP 104;CORE_MERGE_INTO 5;DERIVE_VIEW 3;EXTENSION_LATER 36;DEFER_SOURCE 4;REMOVE 2。合计 154,表名与 R5 目录一一对应,无重复。

## 六、特别复审六问

1. **`scm_supplier_item_material_mapping`**:不必单表。它保护的"SKU→物料/规格随时间变化"在现库零证据(344 行价格史无规格变更),唯一核心引用方 `scm_supplier_price_observation` 已直挂 supplier_item_id;物料对应以列并入 `scm_supplier_item`,采购包启用且规格变更成为事实时再恢复生效期表。不并入单位换算表——换算是物料属性,SKU 对应是商业关系,粒度不同。
2. **`hr_application_stage_event`**:必须保留。反例检验成立:contacting、rejected、backup_pool、重新激活等阶段没有对应里程碑对象(预约/评估/offer 只覆盖部分阶段),现状 `applications.stage` 覆盖式更新正在丢失漏斗历史;里程碑表集合欠定漏斗,事件表是最小事实。R5 此项新增正确。
3. **`pos_member_order_item`**:来源最小事实,但物理形态是 `pos_order` + `pos_order_item`(批次×订单×listing),member_id 不入表——归属由 `pos_member_card_transaction` 经视图判定(43997 行中 5 单多会员歧义、2708 单无卡,缓存 member_id 会把歧义固化成假事实)。`v_pos_member_order_item` 为只读派生(HBTI 慢则物化);现有同名物理表仅作迁移桥,其 (order_id,item_key) upsert 语义不进入新库。
4. **哪些只应派生**:成本快照与组成、毛利(v_daily_margin 现状即视图)、库存余额(移动明细之和,随库存包)、需求因子/节假日倍率(run 冻结输入)、补货 delta、评估总分、客单价、会员比率——全部视图。**保留物理**的派生物仅三类:实际发出的预测行(决策史)、发布的计划版本(人工决定)、已发放的 HBTI 结果(驱动过奖励);工作量/原料需求行随扩展包并沿用冻结规则。会员日指标不是派生——是来源原生观察(储值净额、期末余额含我方无法重算的口径),保留。
5. **技术表分界**:属于数据基座——迁移台账、job_run(血缘+幂等)、audit_event、user/role/user_role/location_scope、session、一次性令牌、push 去重、outbound+attempt、conversation_state(恢复检查点)、reward_stock(并发控制)、ingest/import 批次。属于应用实现细节但因有实证写入者暂留核心并标注分层——rate_limit_event、ai_call(全文需脱敏)。不属于基座——app_data_quality_issue(删)、msg_delivery_event(无采集器,延后)、cost_card_cost_run(删)、独立 prompt 版本表(并回)。
6. **(2 的补充)** `hr_trial` 并入后,试工漏斗仍完整:预约(排期+到场+结果)→评估(评分+红线)→offer→employment,阶段事件表记录迁移。

## 七、事实、合理推测、未经验证、需来源验证

**事实(有快照/目录/审计文件背书)**:154=123 迁移核心+27 规划模块+4 来源条件;现库 76 表 21 视图;fact_shift、trials、offers、employee_events、ai_daily_correction、finance_revenue_daily、app_user_store_scope、hbti_auth_token 均为 0 行;pos_member_order_item 43997 行/12760 单/99 键/归属覆盖 59.4%/5 单歧义/2708 单无卡;v_daily_margin、v_holiday_factor、v_item_cost_quality 同时存在于未跟踪迁移 109 与生产快照(重合证据,非部署证明);pos_order 目标字段刻意不含订单时间;app_data_quality_issue 目标字段为 entity_type+entity_id 文本对;ops_forecast_run 含 input_manifest;ops_calendar_event 含 status。

**合理推测(基于静态线索,非运行时证明)**:班表/培训/采购/库存/生产执行/配送模块当前无真实写入者;WhatsApp 回执未被持久化;HBTI 题目与选项目前版本化在代码而非库;"加减货建议"属成品侧推送,不构成原料补货写入者;各表"实写"表述均指静态扫描+表注释+行数的合成证据。

**未经验证(采纳本审计前无须解决,实施前必须)**:四个生产部署实际运行提交与动态 SQL;res_api 是否每日调度订单商品抓取(影响 pos_order_item 作为持续同步核心的运行成本,不影响其存在性);ops_forecast_run.input_manifest 是否足以复现因子取值(若不足,补 manifest 内容,而不是恢复观察表);多店场景下 211 报表命名空间与整批完整性。

**需来源验证(维持延后)**:支付/退款来源契约(pos_payment/pos_refund);Lark 工时员工 ID、修改/撤销、幂等重跑(hr_timesheet_*)。

## 八、对 R5 生成器(model/ + tools/generate-review-artifacts.py)的最小修改顺序

> 本轮不执行;以下为建议顺序,每步后重新生成并跑现有校验。

1. **先改分层,不动表结构**:在 model/ 为每表增加 `base_tier`(CORE / EXTENSION_PACK:<包名> / SOURCE_CONDITIONAL),按第五节清单打标;生成器停止输出单一"154"总数,分别输出核心/扩展/延后三组数并把包清单写进目录 CSV 与 README。此步不改任何 FK,先让数字诚实。
2. **执行 2 删 5 并**:删除 app_data_quality_issue、cost_card_cost_run;合并 5 张(ops_calendar_event.batch_id→job_run_id;version 行加 reason_code/ai_call_id;hr_appointment 加试工执行五列;scm_supplier_item 加 material_id/规格列并把 price_observation 的 mapping 外键退化为可空迁移注记;ai_call 的模板外键改指 (template_key,version) 行)。重跑外键连通性门禁,预期 458 条外键净减。
3. **表转视图**:把 ops_demand_factor_observation、cost_card_product_cost_snapshot、cost_card_product_cost_component 从表清单移入视图清单(50→53),为两张成本视图标注"可物化+由 app_job_run 记录刷新",并在 07 文件新增"基座最小性"小节替换"152 并非全部可原样批准"的旧结论。
4. **给生成器加机器门禁**:CORE 表必须满足"迁移来源行数>0 或写入者被静态扫描确认"或带显式技术必要性标记,否则生成失败——这条门禁本可在 R5 拦住班表四表与 plan_slot。
5. **最后重生成全部工件**(目录/字典/矩阵/图/HTML),并把 27+9=36 张扩展表从"方案 C 首日建表清单"里移除,写入各包的启用门禁。

## 审计边界

本审计未执行任何 DDL/DML/部署/文件修改;"实写/实读"均为静态扫描+表注释+行数的合成证据,不构成运行时证明;所有行数引自 2026-08-09 快照。

