# 01 当前数据库审计

把已确认事实、合理推测和待验证信息分开；没有证据的地方不猜。

> 状态：**方案 C 评审稿，不是迁移脚本，不授权修改生产数据库。**
> 模型版本：`HOTCRUSH-CORE-V1-REVIEW-R6-2026-08-10`；生产结构快照：`2026-08-09T09:56:05.204Z`；代码静态扫描：`2026-08-09T10:30:31.506548+00:00`。

## 结论先行

当前库能支撑既有单店流程，但**不适合作为多门店、中央厨房、仓库和跨模块分析的直接地基继续扩建**。主要问题不是表少，而是地点、产品、人员、原料和版本身份没有贯穿所有事实；多个项目还会写同一张表。方案 C 因此选择新库建模、按项目逐条迁移契约，而不是在唯一生产库中边拆边修。

“完美适配所有项目”目前无法确认为事实：静态扫描能证明代码文本中存在访问线索，但动态 SQL、生产部署版本、定时任务和外部客户端仍需在迁移阶段用日志与契约测试确认。

## 已确认事实

- 生产 `public` schema 有 **76 张表、21 个普通视图、0 个物化视图、939 个列定义**。
- 结构约束共 230 个：主键 69、外键 38、唯一约束 26、检查约束 97。
- 76/76 张表启用了 RLS；快照连接身份为 `postgres`。启用 RLS 本身不等于每个应用已经被最小权限隔离。
- 当前表总占用约 76.6 MiB；精确行数已逐表记录在目录。
- 没有主键的 7 张表：`app_user_role_pre083`, `cost_card_product_link_pre080`, `daily_revenue`, `finance_revenue_daily`, `pos_member`, `pos_member_card_txn`, `pos_member_daily`。
- 76 张表和 21 个视图均在兼容矩阵中恰好出现一次；没有遗漏，也没有重复去向。

## 已确认的关键结构风险

1. `daily_revenue` 同时有 `UNIQUE(date)` 和 `UNIQUE(date, store)`；前者会阻止同一天第二家门店写入，后者因此无法真正提供多店能力。
2. `item_hourly_sales` 仍以 `date + hour + item_name` 唯一，现有 `store` 不是可靠地点键；名称变化、同名商品和第二门店都会冲突或混淆。
3. `forecast_snapshot` 以日期与产品名称组织，没有稳定 `location_id + product_id + run/version`，无法可靠区分算法预测、人工预估和最终批准计划。
4. `ops_store` 与 `finance_store` 没有统一外键映射；门店名称只能当证据，不能当企业级连接键。
5. `product`、`pos_product` 与成本卡产品对象并非同一身份；已有名称/来源键路径不能自动证明同一产品。
6. `staff` 与 `employees` 分别表达人员数据；班表 `fact_shift` 使用姓名文本且当前无可靠实际工时关系，无法保证人员对账。
7. `pos_member` 同时承载 POS 会员快照与 HBTI 活动状态，形成跨项目双写和活动历史丢失风险。
8. `schema_migrations` 没有强制仓库命名空间；多个代码库共享一张迁移账本时，版本号或文件归属可能碰撞。
9. `pos_member_order_item` 已形成有价值的订单 × 商品粒度，但没有 `source_system_id`、`location_id`、抓取批次、外键和批次完整性清单；当前 `(order_id, item_key)` upsert 只能维护最新汇总，无法保存来源修订历史，也不能在来源删除一行时自动移除旧行。该表已启用 RLS 但当前没有表级 policy，且其注释明确说未挂统一迁移链；这两点都不能被‘脚本跑通’替代。
10. 该表当前有 43,997 行、12,760 个订单；其中 46 行净额为负、9,574 行净额为零。基础事实应保留这些行，但任何‘消费金额/喝了多少’派生指标必须明确纳入规则。

## 合理推测（尚未视为生产运行事实）

- 静态扫描在四个项目中发现 5070 条文本引用，其中 1097 条位于运行源码或脚本层；测试、迁移、文档、JSON/YAML 数据已分层排除出运行时契约证据。这些仍只是定位线索，不证明当前部署一定执行。
- 表注释、文件名和 SQL 动词可以帮助判断写入者，但动态拼接、旧脚本和未部署代码可能产生假阳性或假阴性。
- 某些无字段注释的现有列可从名称推测含义；此类解释在 `current-field-dictionary.csv` 中明确标为“合理推测”或“待验证”，不会当作迁移真值。

## 迁移前仍待验证

- 四个部署目标当前实际版本、连接角色、定时任务和所有动态 SQL。
- 每个金额字段的含税/未税、折扣、退款、币种和舍入口径；每个数量字段的单位和换算方式。
- `staff` 与 `employees` 的逐人对账；`ops_store` 与 `finance_store` 的逐地点证据映射。
- 已确认 reportId=211 在当前单店样本提供可重跑的订单 ID 和订单商品粒度，因此 `pos_order`、`pos_order_item` 已进入迁移核心；仍需验证其他门店的来源命名空间、整批完整性与更正语义。独立支付和退款来源尚未验证，`pos_payment`、`pos_refund` 继续保持 `SOURCE_CONDITIONAL`。
- Lark 工时是否能稳定提供员工来源 ID、修改/撤销语义和重跑幂等键；未确认前 `hr_timesheet_sync_batch` 与 `hr_timesheet_entry` 保持 `SOURCE_CONDITIONAL`。
- 数据保留期限、马来西亚个人资料合规要求、手机号加密密钥和受限访问审批流程。
- 切换窗口内是否仍有 Excel、手工 SQL 或外部客户端直接写当前表。

## 当前对象目录（76 表 + 21 视图）

字段说明：读写者来自静态扫描，必须在迁移前做运行时验证；粒度证据来自数据库注释或结构约束。

| 类型 | 当前对象 | 精确行数 | 一行/一份数据代表什么 | 粒度证据 | PK | FK数 | 唯一约束 | 静态写者 | 静态读者 | 方案C去向 | 风险 |
|---|---|---:|---|---|---|---:|---|---|---|---|---|
| 表 | `ai_call_log` | 131 | AI 调用流水，一行一次 LLM 调用：调用方 caller（chatCompletion / chatCompletionMessages / jsonCompletion）、模型名、完整 prompt 与 response 全文、token 数、耗时毫秒 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | bakery_ops | 未由静态扫描确认 | SPLIT_REDACT → ai_call | HIGH |
| 表 | `ai_daily_correction` | 0 | 空表（0 行）：设计用于存放店长在前端点「采纳 AI 修正」后落库的整日排产系数修正，一天一行（date 唯一），带 coefficient、原因和采纳人/采纳时间审计 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | UNIQUE (date) | 未由静态扫描确认 | 未由静态扫描确认 | MERGE → ops_production_plan_line, ai_call | MEDIUM |
| 表 | `app_audit_log` | 331 | 财务分析网站的增删改审计流水，一行一次操作（登录/登出/改密、成本卡新建改归档、原料价格回填、AI 洞察调用），带 before_data / after_data 变更前后快照 | 已确认：生产库表注释 | PRIMARY KEY (id) | 1 | — | finance_web | finance_web | MIGRATE → app_audit_event | HIGH |
| 表 | `app_role` | 3 | 财务分析网站的角色字典，一行一个角色，当前仅 viewer/editor/admin 三行，由 sql/030_app_auth_rbac.sql 种子写入，日常不变 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | UNIQUE (code) | 未由静态扫描确认 | finance_web | MIGRATE → app_role | MEDIUM |
| 表 | `app_session` | 70 | 财务分析网站的登录会话表，一行一个会话（uuid + 会话令牌的 sha256 哈希，约 12 小时过期，登出写 revoked_at） | 已确认：生产库表注释 | PRIMARY KEY (id) | 1 | UNIQUE (token_hash) | finance_web | finance_web | REISSUE_NOT_MIGRATE → app_session | HIGH |
| 表 | `app_user` | 2 | 财务分析网站的登录账号表，一行一个账号（bigint 主键 + username + password_hash + 锁定/强制改密状态），由财务站 api/_lib/auth.js 与 api/users.js 读写 | 已确认：生产库表注释 | PRIMARY KEY (id) | 1 | — | finance_web | finance_web | MIGRATE → app_user, app_user_role | HIGH |
| 表 | `app_user_role_pre083` | 2 | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | ARCHIVE_DROP → 归档/退役 | LOW |
| 表 | `app_user_store_scope` | 0 | 财务站账号的门店可见范围授权，一行一条“账号-门店”授权（store 外键指向 finance_store） | 已确认：生产库表注释 | PRIMARY KEY (user_id, store) | 3 | — | 未由静态扫描确认 | finance_web | MIGRATE_REKEY → app_user_role, app_user_location_scope | HIGH |
| 表 | `applications` | 125 | 候选人投递记录，一行一个候选人对一个岗位（job_openings），stage 为招聘阶段枚举 application_stage（new/contacting/first_interview/trial/…/hired/rejected/backup_pool），由 bakery-ops 的 JobStreet 每日 12:00 拉取与 WhatsApp 招聘 FSM 写入 | 已确认：生产库表注释 | PRIMARY KEY (id) | 3 | — | 未由静态扫描确认 | bakery_ops | MIGRATE_REKEY → hr_person, hr_application, hr_employment_source_identity | HIGH |
| 表 | `appointments` | 1 | 面试或试工预约，一行一次预约（kind = interview / trial），挂在 applications 下，由 bakery-ops 招聘 FSM 与面试/试工日报写入 | 已确认：生产库表注释 | PRIMARY KEY (id) | 3 | — | 未由静态扫描确认 | 未由静态扫描确认 | MIGRATE → hr_appointment | MEDIUM |
| 表 | `business_rule` | 16 | 结构上由 PRIMARY KEY (id) 唯一标识；业务粒度仍需由写入方确认 | 合理推测：结构约束 | PRIMARY KEY (id) | 0 | UNIQUE (rule_key) | 未由静态扫描确认 | bakery_ops | CLASSIFY_VERSION → ops_business_rule, v_ops_holiday_factor | HIGH |
| 表 | `candidate_conversations` | 42 | 候选人 WhatsApp 跨天对话状态机，一行一个（门店, 手机号），state 是 FSM 节点、context 是 JSONB 暂存、opted_out 标记候选人回复 STOP，由 bakery-ops 招聘 FSM 写入 | 已确认：生产库表注释 | PRIMARY KEY (id) | 2 | UNIQUE (store_id, phone) | 未由静态扫描确认 | 未由静态扫描确认 | SPLIT → msg_conversation, msg_conversation_state, hr_application | HIGH |
| 表 | `chat_history` | 12 | 多轮对话的最近上下文窗口，一行一条消息（会话 id + user/assistant 角色 + 正文） | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | RETENTION_FILTER → msg_conversation, msg_message | MEDIUM |
| 表 | `context_event` | 14 | 按日期的上下文事件，一行一条（同一天可多条）：天气、促销等，运行时拼进 AI prompt 以影响次日排产系数 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | 未由静态扫描确认 | bakery_ops | CLASSIFY_SPLIT → ops_calendar_event, ops_operational_event | HIGH |
| 表 | `cost_card_item` | 471 | 成本卡物料主数据，一行一个物料，item_type 区分 product 94 / semi_finished 162 / ingredient 184 / packaging 11（共451，全部 active） | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | finance_web | finance_web | TYPE_SPLIT → ops_product, ops_product_alias, scm_material, scm_material_source_identity | CRITICAL |
| 表 | `cost_card_item_name_lock` | 464 | 结构上由 PRIMARY KEY (name_key) 唯一标识；业务粒度仍需由写入方确认 | 合理推测：结构约束 | PRIMARY KEY (name_key) | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | RETIRE → 归档/退役 | LOW |
| 表 | `cost_card_item_price` | 344 | 成本卡物料采购价历史，一行一条带生效区间的价格 | 已确认：生产库表注释 | PRIMARY KEY (id) | 2 | — | finance_web | finance_web | MIGRATE_REKEY → scm_supplier_price_observation, cost_card_material_price | CRITICAL |
| 表 | `cost_card_product_link` | 37 | 结构上由 PRIMARY KEY (pos_item_id) 唯一标识；业务粒度仍需由写入方确认 | 合理推测：结构约束 | PRIMARY KEY (pos_item_id) | 1 | — | 未由静态扫描确认 | 未由静态扫描确认 | REMODEL → pos_product_mapping, pos_product_mapping_review, cost_card_recipe_version | CRITICAL |
| 表 | `cost_card_product_link_pre080` | 94 | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | ARCHIVE_DROP → 归档/退役 | LOW |
| 表 | `cost_card_recipe` | 289 | 成本卡配方头表，一行一个物料的一个配方版本（item_id+version 唯一，status 为 draft/published/archived，带 batch_yield 批产量与 sale_price 售价、生效区间） | 已确认：生产库表注释 | PRIMARY KEY (id) | 3 | UNIQUE (item_id, version) | finance_web | finance_web | VERSION_IN_PLACE → cost_card_recipe_version | CRITICAL |
| 表 | `cost_card_recipe_item` | 1527 | 成本卡配方明细行，一行一条用料（recipe_id 指向配方版本，component_item_id 指向 cost_card_item，含用量/单位/出成率 net_yield/损耗率 loss_rate/排序 seq） | 已确认：生产库表注释 | PRIMARY KEY (id) | 2 | UNIQUE (recipe_id, seq) | finance_web | finance_web | MIGRATE_REKEY → cost_card_recipe_component | CRITICAL |
| 表 | `daily_breakdown` | 760 | 结构上由 PRIMARY KEY (date, dim_type, dim_value) 唯一标识；业务粒度仍需由写入方确认 | 合理推测：结构约束 | PRIMARY KEY (date, dim_type, dim_value) | 0 | — | res_api | bakery_ops、res_api | MIGRATE → pos_daily_breakdown, v_pos_daily_breakdown_current | HIGH |
| 表 | `daily_push_log` | 161 | 定时推送幂等日志，一行 = 某类推送对某个接收人在某天已成功发出一次，(kind, recipient, date) 唯一，服务重启或重跑靠它避免重复推送 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | UNIQUE (kind, recipient, date) | bakery_ops | bakery_ops | MERGE_QUEUE_NATURAL_KEY → msg_outbound_message | MEDIUM |
| 表 | `daily_revenue` | 242 | 按天一行的门店营收事实表（date 唯一、text 类型，含流水 gross_sales、折扣、实收 revenue、单量、客单价），2025-12-03 起每晚 KL 23:00 由 res_api/sync-to-db.js 从 Restosuite POS 写入，财务站日报导入的旧客户端路径也能写同一行 | 已确认：生产库表注释 | — | 0 | UNIQUE (date); UNIQUE (date, store) | finance_web、res_api | bakery_ops、finance_web、res_api | SPLIT_BY_WRITER → pos_sales_day, finance_sales_daily | CRITICAL |
| 表 | `daily_review` | 16 | AI 生成的每日复盘报告，一天一行（date 唯一）：review_json 是复盘结论、suggestions_json 是次日排产调整建议、adopted 标记是否被采纳 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | UNIQUE (date) | bakery_ops | bakery_ops | MIGRATE → ops_daily_review, ops_review_action | HIGH |
| 表 | `employee_events` | 0 | 员工事件流水（转正、奖惩、离职等），一行一个事件，外键挂 employees.id，由 bakery-ops 员工管理/试用期提醒链路写入 | 已确认：生产库表注释 | PRIMARY KEY (id) | 1 | — | 未由静态扫描确认 | bakery_ops | MIGRATE_REKEY → hr_employee_event | MEDIUM |
| 表 | `employees` | 129 | 员工与候选人主档，一行一人（status: active 在职 / resigned 离职），由 bakery-ops 的员工管理、简历上传与招聘 FSM 写入 | 已确认：生产库表注释 | PRIMARY KEY (id) | 1 | — | 未由静态扫描确认 | bakery_ops | SPLIT_IDENTITY → hr_person, hr_person_contact, hr_application, hr_application_stage_event, hr_employment, hr_employee_event, hr_employment_source_identity, hr_employment_mapping_review | CRITICAL |
| 表 | `fact_hbti_response` | 1 | 结构上由 PRIMARY KEY (store, member_id, campaign_version, attempt_id) 唯一标识；业务粒度仍需由写入方确认 | 合理推测：结构约束 | PRIMARY KEY (store, member_id, campaign_version, attempt_id) | 0 | — | hbti_web | hbti_web | NORMALIZE → mkt_campaign_version, mkt_campaign_member, mkt_survey_question, mkt_survey_response, mkt_survey_answer, mkt_survey_result | HIGH |
| 表 | `fact_shift` | 0 | 一行 = 一天 × 一个人 | 已确认：生产库表注释 | PRIMARY KEY (work_date, store_id, staff_name) | 1 | — | 未由静态扫描确认 | 未由静态扫描确认 | REMODEL → app_job_run, ops_shift_plan_version, ops_role, ops_station, ops_shift_requirement, ops_shift_assignment, hr_employment_mapping_review | CRITICAL |
| 表 | `finance_cashflow` | 42 | 门店现金流月表，一行 = 月×门店×项目(期初/现金收入/现金支出/现金退款/现金存入/现金余额)，覆盖 2025-12 至 2026-06 | 已确认：生产库表注释 | PRIMARY KEY (month, store, item) | 0 | — | finance_web | finance_web | MIGRATE → finance_import_batch, finance_cashflow_line | MEDIUM |
| 表 | `finance_expense` | 103 | 门店月度费用归口汇总，一行 = 月×门店×费用大类(major：仓储费/运输费/物料费/其他费用)×子类(sub)×资金来源(source) | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | finance_web | finance_web | MERGE_TYPED → finance_import_batch, finance_monthly_cost_line | MEDIUM |
| 表 | `finance_expense_raw` | 90 | 门店费用原始拆分明细，一行 = 月×门店×分类×二次分类×支付渠道(银行流水/备用金/报销/现金/收银折扣/仓库订货)的一笔金额，覆盖 2025-12 至 2026-05 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | finance_web | finance_web | MERGE_TYPED → finance_import_batch, finance_monthly_cost_line | HIGH |
| 表 | `finance_item_sales` | 76 | 单品销售的月度汇总，一行 = 月×门店×单品(数量+金额)，目前只有 2025-12 一个月 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | finance_web | finance_web | MIGRATE_REKEY → finance_item_sales_monthly | MEDIUM |
| 表 | `finance_labor` | 6 | 旧版四维人工成本月表，一行 = 月×门店，只有国内/马来/外包/福利四列合计 | 已确认：生产库表注释 | PRIMARY KEY (month, store) | 0 | — | finance_web | finance_web | ARCHIVE_COMPAT → finance_monthly_cost_line | HIGH |
| 表 | `finance_labor_detail` | 148 | 现行人工成本明细，一行 = 月×门店×类别(工资/宿舍/福利/挂账/调整/马来明细/国内工资分摊)×子项×组织 | 已确认：生产库表注释 | PRIMARY KEY (month, store, category, item, org) | 0 | — | finance_web | finance_web | MERGE_TYPED → finance_import_batch, finance_monthly_cost_line | MEDIUM |
| 表 | `finance_material` | 48 | 月度原料成本汇总，一行 = 月×门店×类别(食材/包材)×来源 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | finance_web | finance_web | MERGE_TYPED → finance_import_batch, finance_monthly_cost_line | MEDIUM |
| 表 | `finance_order_base` | 7 | 月度订货基数，一行 = 月×门店一个金额(MYR，当月仓库订货总额)，用作仓储费按3%、运输费按8%摊销的计算分母 | 已确认：生产库表注释 | PRIMARY KEY (month, store) | 0 | — | finance_web | finance_web | MERGE_METRIC → finance_monthly_metric | MEDIUM |
| 表 | `finance_orders` | 19 | 物流订货台账，一行 = 一张订货单中的一个商品行，带订货/付款/发货/到港/交付/入库六个日期，按 d_order 日期归月，现有 2026-06 与 2026-07 数据 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | finance_web | finance_web | MIGRATE → finance_order_logistics_line | MEDIUM |
| 表 | `finance_period_map` | 29 | 期间费用归类配置，一行 = 费用大类(major)×子类(sub) → 销售/管理/财务/研发费用 | 已确认：生产库表注释 | PRIMARY KEY (major, sub) | 0 | — | 未由静态扫描确认 | finance_web | VERSION → finance_period_category_map | MEDIUM |
| 表 | `finance_pl_metrics` | 66 | 财务利润表关键指标月表，一行 = 月×门店×指标名(当期/摊销运输费、当期/摊销仓储费、达人优惠券、实际收入、储值净额、市场费用(固定)、营业利润、利润总额、净利润(含储值))，覆盖 2025-12 至 2026-05，由一次性脚本 sql/load2.js 从利润表模板导入 | 已确认：生产库表注释 | PRIMARY KEY (month, store, metric) | 0 | — | finance_web | finance_web | MIGRATE → finance_monthly_metric | MEDIUM |
| 表 | `finance_revenue_daily` | 0 | 财务模板口径的按天营业额，一行 = 日期×门店，记流水/实收/折扣/折扣率，import_source 恒为 finance_template | 已确认：生产库表注释 | — | 0 | UNIQUE (date, store) | finance_web | finance_web | MIGRATE → finance_import_batch, finance_sales_daily | HIGH |
| 表 | `finance_stock` | 482 | 月度库存盘点快照，一行 = 月×门店×物料(名称+规格)，记现存量/在途量/当月用量/单件体积与采购类型(国内/本地)，覆盖 2026-04 至 2026-07 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | finance_web | finance_web | MIGRATE_REKEY → finance_inventory_snapshot_line | MEDIUM |
| 表 | `finance_stock_flow` | 491 | 月度进销存流水，一行 = 月×门店×仓别(常温/冷冻)×物料，记期初/入库/领用/期末四个量，覆盖 2026-04 至 2026-07 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | finance_web | finance_web | MIGRATE_REKEY → finance_inventory_flow_line | MEDIUM |
| 表 | `finance_store` | 1 | 财务站门店注册表，一行一家门店，含显示名、启用状态与有效月份区间(active_from_month/active_to_month)，配合 app_user_store_scope 做门店级数据权限 | 已确认：生产库表注释 | PRIMARY KEY (store) | 0 | — | 未由静态扫描确认 | finance_web | MERGE_IDENTITY → ops_location, ops_location_source_identity | CRITICAL |
| 表 | `finance_supplier_orders` | 274 | 供应商采购明细的月度聚合，一行 = 月×门店×供应商×物料×规格，含数量/单价/金额，来自进销存逐日流水按月汇总并配供应价格单，覆盖 2026-04 至 2026-07 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | finance_web | finance_web | MIGRATE_REKEY → finance_supplier_purchase_monthly | MEDIUM |
| 表 | `finance_targets` | 138 | 月度经营目标值，一行 = 月×门店×目标项(总流水/实收金额/折扣费用/食材成本/包材成本/原料成本/人工成本/仓储费/运输费/物料费/其他费用)，覆盖 2026-01 至 2026-07 | 已确认：生产库表注释 | PRIMARY KEY (month, store, item) | 0 | — | finance_web | finance_web | VERSION → finance_target | MEDIUM |
| 表 | `forecast_snapshot` | 1946 | 排产建议快照，一行 = 某天某商品当时实际发出的建议出货量，(date, product_name) 唯一、当天重算即覆盖 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | UNIQUE (date, product_name) | bakery_ops | bakery_ops | REMODEL → ops_forecast_run, ops_forecast_line, ops_production_plan_version, ops_production_plan_line | CRITICAL |
| 表 | `hbti_auth_token` | 0 | HBTI 的不透明认证令牌，一行一个令牌（主键是令牌的 sha256，不是令牌本身） | 已确认：生产库表注释 | PRIMARY KEY (token_hash) | 0 | — | hbti_web | hbti_web | REISSUE_NOT_MIGRATE → app_one_time_token | HIGH |
| 表 | `hbti_gift_stock` | 9 | 结构上由 PRIMARY KEY (template_name) 唯一标识；业务粒度仍需由写入方确认 | 合理推测：结构约束 | PRIMARY KEY (template_name) | 0 | — | hbti_web | hbti_web | MIGRATE_REKEY → mkt_reward, mkt_reward_stock, mkt_reward_claim, v_mkt_reward_stock_reconciliation | CRITICAL |
| 表 | `hbti_rate_limit` | 0 | HBTI 的固定窗口限流计数器，一行 = 一个 (scope, 窗口起点, 主体哈希) 桶 | 已确认：生产库表注释 | PRIMARY KEY (bucket) | 0 | — | hbti_web | 未由静态扫描确认 | EXPIRE_NOT_MIGRATE → app_rate_limit_event | LOW |
| 表 | `holiday` | 18 | 马来西亚公共假期与特殊日期字典，一行一个日期（date 为字符串 YYYY-MM-DD，唯一），coefficient 是该日排产系数（目前 18 条全为空，实际系数走 business_rule） | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | UNIQUE (date) | 未由静态扫描确认 | bakery_ops | SPLIT_EVIDENCE → app_job_run, ops_calendar_event, v_ops_holiday_factor | HIGH |
| 表 | `hourly_sales_summary` | 2594 | 按天 × 小时一行的整店逐时汇总（账单数、客数、净销/流水、平均单价、折扣，date+hour 唯一），2026-01-01 起每晚由 res_api/sync-to-db.js 从 POS 写入，逐时真值无口径问题 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | UNIQUE (date, hour) | res_api | bakery_ops | MIGRATE → pos_sales_hour, v_pos_sales_hour_current | CRITICAL |
| 表 | `item_hourly_sales` | 83109 | 按天 × 小时 × 单品一行的 POS 逐时销量事实表（qty、净销、流水），2026-01-01 起，是本库最细的销售事实来源，daily_sales_record 与 timeslot_sales_record 都由它派生 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | UNIQUE (date, hour, item_name) | res_api | bakery_ops、finance_web、res_api | MIGRATE_SOURCE_FIRST → pos_ingest_batch, pos_product_listing, pos_item_sales_hour | CRITICAL |
| 表 | `item_last_sale` | 1585 | 按天 × 单品一行的「当天最后成交时刻」（last_sale_time 为分钟精度的 KL 本地时间）与当日总量，专供 bakery-ops 精确断货检测，2026-07-02 起每晚由 res_api/sync-to-db.js 写入（数据源 res_api/scrape-item-last-sale.mjs） | 已确认：生产库表注释 | PRIMARY KEY (date, item_name) | 0 | — | res_api | bakery_ops、res_api | RETIRE_DERIVED → ops_stockout_event | MEDIUM |
| 表 | `item_waste` | 3727 | 按天 × 单品 × 报废原因一行的报废明细（qty 数量、amount 金额），2026-01-02 起每晚由 res_api/sync-to-db.js 从 POS 写入，财务站报废分析与 bakery-ops 复盘/预测都读它 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | UNIQUE (date, item_name, waste_reason) | res_api | bakery_ops、finance_web、res_api | MIGRATE → pos_item_waste, v_pos_item_waste_current, v_pos_item_waste_mapped | HIGH |
| 表 | `job_openings` | 1 | 在招岗位，一行一个招聘位，来源是 JobStreet 职位（external_job_id）或门店二维码海报（qr_token），applications 通过 job_opening_id 挂在它下面，由 bakery-ops 招聘模块写入 | 已确认：生产库表注释 | PRIMARY KEY (id) | 1 | — | 未由静态扫描确认 | 未由静态扫描确认 | MIGRATE → hr_job_requisition | MEDIUM |
| 表 | `offers` | 0 | 录用 offer 记录，一行一个 application 的 offer，建议薪资默认取自飞书试工流程跟踪表（salary_source=lark）或人工覆盖，由 bakery-ops 招聘流程写入 | 已确认：生产库表注释 | PRIMARY KEY (id) | 3 | — | 未由静态扫描确认 | 未由静态扫描确认 | VERSION → hr_offer | HIGH |
| 表 | `ops_audit_log` | 2037 | bakery-ops 的 skill 执行流水（原名 audit_log），一行一次技能运行：run_id、skill_id、发起人、渠道、状态、入参与出参 JSONB、耗时 | 已确认：生产库表注释 | PRIMARY KEY (run_id) | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | CLASSIFY_SPLIT → app_job_run, app_audit_event | HIGH |
| 表 | `ops_store` | 2 | 门店注册表（原名 stores），一行一个门店，主键 store_code 是人可读文本（pavilion / 海外项目组），带面试与试工时间窗、店长与厨师长 user_id、飞书 base 配置，由 bakery-ops 写入并被招聘全链路外键引用 | 已确认：生产库表注释 | PRIMARY KEY (store_code) | 2 | — | 未由静态扫描确认 | 未由静态扫描确认 | MERGE_IDENTITY → ops_location, ops_location_source_identity, ops_business_rule, app_user, app_user_role, app_user_location_scope | CRITICAL |
| 表 | `out_of_stock_record` | 598 | 断货记录，一行 = 某天某商品的一次断货：售罄时刻与所属时段、受影响的后续时段、估算损失数量与金额，用于测算理想营业额和排产补货建议 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | 未由静态扫描确认 | bakery_ops | MIGRATE → ops_stockout_event | MEDIUM |
| 表 | `pos_member` | 4845 | 一行一个 POS 会员（store + member_id）的当前状态快照，不留历史 | 已确认：生产库表注释 | — | 0 | UNIQUE (store, member_id) | hbti_web | hbti_web | SPLIT_PRIVACY → pos_member, pos_member_contact, pos_member_card, pos_member_balance_snapshot, v_pos_member_state_current, mkt_campaign_member, mkt_survey_response, mkt_survey_result, mkt_reward_claim | CRITICAL |
| 表 | `pos_member_card_txn` | 14741 | 一行一笔会员卡交易事件，全量约 14,386 行（2025-11 至今），近月约 1,000~1,200 行/月 | 已确认：生产库表注释 | — | 0 | UNIQUE (store, txn_id) | 未由静态扫描确认 | res_api | MIGRATE_LOSSLESS → pos_member_card_transaction | CRITICAL |
| 表 | `pos_member_daily` | 951 | 一行一天 × 一门店的会员日汇总 | 已确认：生产库表注释 | — | 0 | UNIQUE (date, store) | 未由静态扫描确认 | res_api | SPLIT → pos_member_daily_metric, v_pos_member_daily_summary | CRITICAL |
| 表 | `pos_member_order_item` | 43997 | 一行 = 一个会员订单里的一样商品（同单同品的多行已 SUM 合并） | 已确认：生产库表注释 | PRIMARY KEY (order_id, item_key) | 0 | — | res_api | 未由静态扫描确认 | MIGRATE_LATEST_SNAPSHOT → pos_order, pos_order_item, v_pos_member_order_item | CRITICAL |
| 表 | `pos_product` | 211 | 商品主数据，一行一个 RES 商品（主键 item_key = RES 的 menuItemNameKey，形如 {orgId}-{orgType}-{menuItemId}） | 已确认：生产库表注释 | PRIMARY KEY (item_key) | 0 | — | res_api | bakery_ops、finance_web、res_api | MIGRATE_SOURCE → pos_product_listing, pos_product_mapping, ops_product | CRITICAL |
| 表 | `product` | 54 | 排产系统的商品主数据，一行一个商品：中文品名（唯一）、英文名、售价、包装倍数 pack_multiple、整盘展示量 | 已确认：生产库表注释 | PRIMARY KEY (id) | 1 | UNIQUE (name) | bakery_ops | bakery_ops | MIGRATE_MASTER → ops_product, ops_business_rule, v_pos_item_sales_day, v_ops_timeslot_sales_baseline | CRITICAL |
| 表 | `product_alias` | 98 | 商品别名映射，一行一条：把老板或 Excel 里的各种中文写法（alias，唯一）归一到中文标准品名 standard_name，供排产匹配 product.name | 已确认：生产库表注释 | PRIMARY KEY (id) | 1 | UNIQUE (alias) | 未由静态扫描确认 | bakery_ops | MIGRATE → ops_product_alias | MEDIUM |
| 表 | `prompt_segment` | 45 | Prompt 积木块，一行一个可复用片段（segment_key 唯一）：category 分 role / rule / knowledge / context / format 五类，content 里可含 ${变量} 占位，variables 声明占位名，is_active 与 version 控制启用 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | UNIQUE (segment_key) | 未由静态扫描确认 | bakery_ops | VERSION → ai_prompt_segment, ai_prompt_template_segment | HIGH |
| 表 | `prompt_template` | 5 | Prompt 组合模板，一行一个 AI 场景（template_key 唯一：daily_review、timeslot_allocation、empowerment_review、daily_correction、product_correction）：记录使用的 system 角色 key、要拼装的 prompt_segment key 列表、模型名与 temperature/top_p | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | UNIQUE (template_key) | 未由静态扫描确认 | bakery_ops | VERSION → ai_prompt_template, ai_prompt_template_segment | HIGH |
| 表 | `schema_migrations` | 88 | 数据库迁移版本台账，一行一个已应用的迁移 | 已确认：生产库表注释 | PRIMARY KEY (version) | 0 | — | finance_web | bakery_ops、finance_web | REKEY → app_schema_migration | CRITICAL |
| 表 | `screening_rules` | 30 | AI 从在职/离职员工历史中提炼的招聘筛选规则，一行一条规则（含证据、置信度、样本数、适用岗位），由 bakery-ops 的 rule-extractor 在员工离职或周期性分析时写入 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REVIEW_MIGRATE → hr_screening_rule | HIGH |
| 表 | `session_state` | 2 | 多轮对话的未完成收集状态，一行一个会话（conversation_id 主键 + 当前 skill + 待确认动作 + 已收集参数 JSON + 待补参数） | 已确认：生产库表注释 | PRIMARY KEY (conversation_id) | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | MIGRATE_ACTIVE_ONLY → msg_conversation, msg_conversation_state | MEDIUM |
| 表 | `staff` | 25 | 结构上由 PRIMARY KEY (user_id) 唯一标识；业务粒度仍需由写入方确认 | 合理推测：结构约束 | PRIMARY KEY (user_id) | 0 | UNIQUE (lark_open_id) | 未由静态扫描确认 | 未由静态扫描确认 | SPLIT_IDENTITY → hr_person, hr_person_contact, hr_employment, hr_employment_source_identity, hr_employment_mapping_review, app_user, app_user_role, app_user_location_scope | CRITICAL |
| 表 | `trials` | 0 | 试工评估结果，一行一次试工（挂 appointments.id），记录试工评分、反馈、工作态度小结、是否触犯红线与录用建议，由 bakery-ops 招聘流程写入 | 已确认：生产库表注释 | PRIMARY KEY (id) | 3 | — | 未由静态扫描确认 | 未由静态扫描确认 | MERGE_SPLIT → hr_appointment, hr_assessment, hr_assessment_score | MEDIUM |
| 表 | `wa_outbound_queue` | 9 | 结构上由 PRIMARY KEY (id) 唯一标识；业务粒度仍需由写入方确认 | 合理推测：结构约束 | PRIMARY KEY (id) | 2 | UNIQUE (phone) | bakery_ops | bakery_ops | MIGRATE_ACTIVE_ONLY → msg_outbound_message | HIGH |
| 表 | `wa_send_log` | 13 | WhatsApp 发送流水台账，一行一条已发出的消息，只记号码和吉隆坡本地发送日期 sent_on，用于按号码按天做冷发限额计数，由 bakery-ops 外发 worker 追加 | 已确认：生产库表注释 | PRIMARY KEY (id) | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | MIGRATE_SUMMARY → msg_outbound_message, msg_delivery_attempt, msg_delivery_event | MEDIUM |
| 视图 | `daily_sales_record` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | bakery_ops | bakery_ops | REBUILD_VIEW → v_pos_item_sales_day | MEDIUM |
| 视图 | `product_material_cost` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | bakery_ops | REBUILD_VIEW → v_cost_card_product_cost_quality | MEDIUM |
| 视图 | `timeslot_sales_record` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | bakery_ops | REBUILD_VIEW → v_ops_timeslot_sales_baseline | MEDIUM |
| 视图 | `v_cost_card_current_cost` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | finance_web | REBUILD_VIEW → v_cost_card_product_cost_quality | MEDIUM |
| 视图 | `v_cost_card_data_quality` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | finance_web | REBUILD_VIEW → v_cost_card_product_cost_quality, v_app_data_quality_summary | MEDIUM |
| 视图 | `v_cost_card_price_current_normalized` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | finance_web | REBUILD_VIEW → v_cost_card_material_price_current | MEDIUM |
| 视图 | `v_cost_card_recipe_expanded` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_cost_card_recipe_expanded | HIGH |
| 视图 | `v_daily_margin` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_cost_card_daily_margin | MEDIUM |
| 视图 | `v_forecast_accuracy` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_ops_forecast_accuracy | MEDIUM |
| 视图 | `v_holiday_factor` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_ops_holiday_factor | MEDIUM |
| 视图 | `v_identity_gap` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_identity_mapping_gap | MEDIUM |
| 视图 | `v_item_cost_quality` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_cost_card_product_cost_quality | MEDIUM |
| 视图 | `v_item_daily_pulse` | — | 单品每日全景：预估 / 实卖 / 报废 / 断货 在同一行 | 已确认：生产库表注释 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_ops_item_daily_pulse | MEDIUM |
| 视图 | `v_item_sales_keyed` | — | key_recovered_by_name = true 表示这一行的键是补出来的，同步侧漏键的规模可由它统计 | 已确认：生产库表注释 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | RETIRE_NAME_RECOVERY → v_pos_item_sales_day | HIGH |
| 视图 | `v_item_waste_keyed` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_pos_item_waste_mapped | MEDIUM |
| 视图 | `v_labor_productivity` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_ops_labor_productivity | MEDIUM |
| 视图 | `v_pos_item_by_name` | — | pos_product 同名多行（同一商品跨两个 org），这里按「在销售里出现得更多」收敛到一行，供缺键回补使用 | 已确认：生产库表注释 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | RETIRE → 归档/退役 | HIGH |
| 视图 | `v_product_identity` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_product_identity | MEDIUM |
| 视图 | `v_revenue_manager_vs_pos` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_ops_manager_sales_reconciliation | MEDIUM |
| 视图 | `v_revenue_reconciliation` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_pos_revenue_reconciliation | MEDIUM |
| 视图 | `v_shift_by_post` | — | 没有主键或唯一约束足以证明一行的业务含义 | 待验证 | — | 0 | — | 未由静态扫描确认 | 未由静态扫描确认 | REBUILD_VIEW → v_ops_shift_by_role | MEDIUM |

## 配套证据文件

- `current-object-catalog.csv`：每个对象的用途、粒度、约束、读写线索和去向。
- `current-field-dictionary.csv`：生产快照中全部 939 个列定义；无注释列明确标记为推测或待验证。
- `00-review-baseline.md` / `evidence/review-baseline.json`：数据库快照、代码扫描、Git HEAD 与脏工作区的时间边界。
- `evidence/current-schema-snapshot.json`：只读元数据与精确行数证据。
- `evidence/pos-member-order-item-audit.json`：会员订单商品表的无 PII 聚合核验、归属覆盖、异常净额与证据边界。
- `evidence/code-access-snapshot.json`：静态代码访问线索，不能替代运行时证明。
