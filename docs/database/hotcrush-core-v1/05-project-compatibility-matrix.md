# 05 项目兼容与数据访问矩阵

覆盖 BakeryOps、RES/POS、财务网站和 HBTI；静态扫描线索与已批准目标边界分开。

> 状态：**方案 C 评审稿，不是迁移脚本，不授权修改生产数据库。**
> 模型版本：`HOTCRUSH-CORE-V1-REVIEW-R6-2026-08-10`；生产结构快照：`2026-08-09T09:56:05.204Z`；代码静态扫描：`2026-08-09T10:30:31.506548+00:00`。

## 重要限制

下列“当前访问”来自保守静态文本扫描，可能包含文档、旧脚本或未部署路径，也可能漏掉动态 SQL。它适合制定核查清单，不足以证明运行时兼容。方案 C 的“完美适配”只有在迁移阶段完成部署清单、API/SQL 契约测试、影子核对和回滚演练后才能确认。

## BakeryOps

- **当前代码位置：** `/Users/weiliangshao/hot/bakery-ops`
- **目标写入边界：** 已启用的 ops_*、hr_*、scm_*、msg_*、ai_*；app_job_run。质量结论由只读核对视图派生，不写跨域多态质量表。
- **目标读取边界：** 全部受治理视图及本项目负责的业务表
- **不可越界：** 不得直接写 finance_*、cost_card_*、pos_* 的来源事实。人工运营动作写 ops_*，不要覆盖 POS 或财务来源事实。

| 当前对象 | 静态访问线索 | 主要文件（引用次数） | 新契约 | 切换规则 | 风险 |
|---|---|---|---|---|---|
| `ai_call_log` | WRITE + AMBIGUOUS | `src/modules/shared/ai/openrouter.provider.ts` (2) | `ai_call` | BakeryOps先双写新ai_call；历史回放工具改读受限归档。 | `HIGH` |
| `applications` | READ + AMBIGUOUS | `src/modules/domain/recruitment/jobs/jobstreet.active-jobs.ts` (10); `scripts/explore/test-jobstreet-notifications-discovery.ts` (7); `scripts/explore/test-api-data.ts` (6); `src/modules/domain/recruitment/notifications/jobstreet.notifications.ts` (5); `scripts/explore/jobstreet-applicant-contact-discovery.ts` (4); `scripts/explore/test-gql-requests.ts` (4) | `hr_person`, `hr_application`, `hr_employment_source_identity` | BakeryOps招聘API在双读期返回旧字段适配层。 | `HIGH` |
| `appointments` | AMBIGUOUS | `src/modules/domain/recruitment/digest/interview-digest.service.ts` (2); `src/modules/domain/recruitment/digest/trial-digest.service.ts` (2); `src/modules/domain/recruitment/intake/candidate-fsm.ts` (1); `src/modules/domain/recruitment/recruitment-vocab.ts` (1) | `hr_appointment` | 招聘FSM切换到新appointment_id。 | `MEDIUM` |
| `business_rule` | READ + AMBIGUOUS | `src/modules/domain/forecast/beverage-caliber.ts` (5); `src/modules/domain/forecast/stockout-detector.service.ts` (2); `src/modules/skills/daily-review-chat/daily-review-chat.definition.ts` (2); `src/app/api/ai-correction/route.ts` (1); `src/app/api/ai-product-correction/route.ts` (1) | `ops_business_rule`, `v_ops_holiday_factor` | 设置页创建规则新版本；预测只读取ACTIVE规则和可重算的质量合格因子，禁止直接读取遗留JSON。 | `HIGH` |
| `candidate_conversations` | AMBIGUOUS | `src/modules/domain/recruitment/intake/candidate-fsm.ts` (2); `scripts/clear-queued.ts` (1) | `msg_conversation`, `msg_conversation_state`, `hr_application` | 招聘消息流程双写会话和状态，旧表只读。 | `HIGH` |
| `context_event` | READ + AMBIGUOUS | `src/app/api/ai-correction/route.ts` (1); `src/modules/domain/forecast/daily-review.service.ts` (1); `src/ui/hooks/use-review.ts` (1) | `ops_calendar_event`, `ops_operational_event` | 预测只读批准日历或确认运营事件，不再读取混合表。 | `HIGH` |
| `daily_breakdown` | READ | `src/modules/skills/daily-review-chat/daily-review-chat.definition.ts` (2) | `pos_daily_breakdown`, `v_pos_daily_breakdown_current` | res_api改写新表；财务查询使用治理 current 视图，任何比例必须同时显示分子和分母。 | `HIGH` |
| `daily_push_log` | READ + WRITE + AMBIGUOUS | `src/modules/domain/notifications/push-log.ts` (4); `src/modules/domain/notifications/morning-brief.service.ts` (1); `src/modules/domain/notifications/production-plan-push.service.ts` (1); `src/modules/domain/notifications/restock-advice-push.service.ts` (1); `src/modules/domain/notifications/weekly-report.service.ts` (1); `src/modules/domain/recruitment/appointment-reminder.service.ts` (1) | `msg_outbound_message` | 调度任务按业务自然键恢复或创建同一外发消息，不再维护第二张去重确认表。 | `MEDIUM` |
| `daily_revenue` | READ + AMBIGUOUS | `src/modules/domain/forecast/ops-data-query.ts` (6); `src/modules/domain/notifications/morning-brief.service.ts` (5); `src/modules/domain/notifications/weekly-report.service.ts` (5); `src/modules/domain/forecast/daily-review.service.ts` (2); `src/modules/domain/forecast/data-driven-target.ts` (2); `src/modules/domain/notifications/freshness-check.ts` (2) | `pos_sales_day`, `finance_sales_daily` | 两个写者分别切换；旧daily_revenue只读兼容视图不能接受ON CONFLICT写入。 | `CRITICAL` |
| `daily_review` | READ + WRITE + AMBIGUOUS | `src/modules/skills/daily-review-chat/daily-review-chat.definition.ts` (9); `src/modules/domain/notifications/morning-brief.service.ts` (4); `src/modules/domain/forecast/daily-review.service.ts` (2); `scripts/team-list.mjs` (1); `src/modules/domain/notifications/weekly-report.service.ts` (1); `src/ui/hooks/use-review.ts` (1) | `ops_daily_review`, `ops_review_action` | BakeryOps复盘流程改为草稿保存、提交冻结和新版本更正；旧数值字段继续由结构化列提供。 | `HIGH` |
| `daily_sales_record` | READ + WRITE + AMBIGUOUS | `src/app/api/import/sales/route.ts` (4); `src/modules/domain/forecast/context-builder.ts` (2); `src/modules/skills/forecast-review/forecast-review.definition.ts` (2) | `v_pos_item_sales_day` | 在调用方切换期提供旧列名兼容视图。 | `MEDIUM` |
| `employee_events` | READ + AMBIGUOUS | `src/modules/domain/recruitment/probation-reminder.service.ts` (2) | `hr_employee_event` | 员工管理改用employment_id。 | `MEDIUM` |
| `employees` | READ + AMBIGUOUS | `src/modules/domain/employee/employee-event.parser.ts` (3); `src/modules/domain/recruitment/probation-reminder.service.ts` (2) | `hr_person`, `hr_person_contact`, `hr_application`, `hr_application_stage_event`, `hr_employment`, `hr_employee_event`, `hr_employment_source_identity`, `hr_employment_mapping_review` | BakeryOps员工接口提供旧形状适配，写入改用person/application/employment事务；受限简历字段遵守批准保留期。 | `CRITICAL` |
| `forecast_snapshot` | READ + WRITE + AMBIGUOUS | `src/modules/skills/forecast-review/forecast-review.definition.ts` (3); `src/modules/skills/daily-review-chat/daily-review-chat.definition.ts` (2); `src/modules/domain/forecast/forecast.service.ts` (1) | `ops_forecast_run`, `ops_forecast_line`, `ops_production_plan_version`, `ops_production_plan_line` | BakeryOps预测和预估接口分开读写，不创建空壳计划主单。 | `CRITICAL` |
| `holiday` | READ + AMBIGUOUS | `src/ui/components/pages/settings-page.tsx` (6); `src/ui/hooks/use-settings.ts` (4); `src/app/api/ai-correction/route.ts` (3); `src/modules/domain/forecast/types.ts` (2); `src/modules/domain/forecast/daily-review.service.ts` (1) | `app_job_run`, `ops_calendar_event`, `v_ops_holiday_factor` | 预测改读v_ops_holiday_factor；日历同步统一记录app_job_run。 | `HIGH` |
| `hourly_sales_summary` | READ + AMBIGUOUS | `src/modules/domain/forecast/data-driven-target.ts` (2); `src/modules/domain/forecast/ops-data-query.ts` (2); `src/modules/domain/forecast/sell-through.ts` (2); `src/modules/domain/forecast/engine/timeslot-allocation.ts` (1); `src/modules/domain/forecast/stockout-detector.service.ts` (1); `src/modules/skills/daily-review-chat/daily-review-chat.definition.ts` (1) | `pos_sales_hour`, `v_pos_sales_hour_current` | res_api改写新小时表；分析只读 current 视图，source_guest_count 不得标成进店客流。 | `CRITICAL` |
| `item_hourly_sales` | READ + AMBIGUOUS | `src/modules/domain/forecast/stockout-detector.service.ts` (11); `src/modules/domain/forecast/ops-data-query.ts` (7); `src/modules/skills/daily-review-chat/daily-review-chat.definition.ts` (6); `src/modules/skills/forecast-review/forecast-review.definition.ts` (3); `src/modules/domain/forecast/beverage-caliber.ts` (2); `src/modules/domain/forecast/product-demand.ts` (2) | `pos_ingest_batch`, `pos_product_listing`, `pos_item_sales_hour` | res_api全量与日中同步都必须写listing_id、location_id和幂等批次。 | `CRITICAL` |
| `item_last_sale` | READ + AMBIGUOUS | `src/modules/domain/forecast/stockout-detector.service.ts` (7); `src/ui/components/pages/review-page.tsx` (1) | `ops_stockout_event` | 断货检测改用索引查询和确认事件。 | `MEDIUM` |
| `item_waste` | READ + AMBIGUOUS | `src/modules/skills/daily-review-chat/daily-review-chat.definition.ts` (3); `src/modules/skills/forecast-review/forecast-review.definition.ts` (3); `src/modules/domain/forecast/forecast.service.ts` (2); `src/modules/domain/forecast/sell-through.ts` (2); `src/modules/domain/forecast/stockout-detector.service.ts` (2); `src/modules/domain/notifications/morning-brief.service.ts` (2) | `pos_item_waste`, `v_pos_item_waste_current`, `v_pos_item_waste_mapped` | res_api写新报废表；下游只读 current/mapped 视图并把来源金额与派生成本损失分开展示。 | `HIGH` |
| `offers` | AMBIGUOUS | `src/modules/domain/recruitment/recruitment-vocab.ts` (1) | `hr_offer` | BakeryOps改写hr_offer；不使用可更新兼容视图做ON CONFLICT。 | `HIGH` |
| `out_of_stock_record` | READ + AMBIGUOUS | `src/modules/skills/forecast-review/forecast-review.definition.ts` (2); `src/app/api/ai-product-correction/route.ts` (1); `src/modules/domain/forecast/stockout-detector.service.ts` (1); `src/modules/domain/notifications/morning-brief.service.ts` (1); `src/modules/skills/daily-review-chat/daily-review-chat.definition.ts` (1) | `ops_stockout_event` | 断货服务改写ops域确认状态；POS同步服务不写该表。 | `MEDIUM` |
| `pos_product` | READ + AMBIGUOUS | `src/modules/domain/forecast/beverage-caliber.ts` (2); `src/modules/domain/forecast/ops-data-query.ts` (2); `src/modules/skills/daily-review-chat/daily-review-chat.definition.ts` (2) | `pos_product_listing`, `pos_product_mapping`, `ops_product` | res_api只写 listing 当前目录；产品主数据流程写 mapping；来源成本字段仅用于核对。 | `CRITICAL` |
| `product` | READ + WRITE + AMBIGUOUS | `src/modules/domain/forecast/engine/product-suggestion.ts` (20); `src/modules/domain/forecast/engine/timeslot-allocation.ts` (13); `src/modules/domain/forecast/correction-math.ts` (11); `src/modules/domain/forecast/parsers/excel-parser.ts` (11); `scripts/explore/test-wms-product-order.ts` (8); `src/modules/domain/forecast/engine/sales-baseline.ts` (8) | `ops_product`, `ops_business_rule`, `v_pos_item_sales_day`, `v_ops_timeslot_sales_baseline` | BakeryOps产品API改用 product_id；地点策略按发生时有效的业务规则版本读取，实际销售比例和基线只读视图，规则参考价不能当成交价。 | `CRITICAL` |
| `product_alias` | READ + AMBIGUOUS | `src/modules/skills/forecast-review/forecast-review.definition.ts` (5); `src/modules/domain/forecast/forecast.service.ts` (1) | `ops_product_alias` | 导入匹配只用CONFIRMED别名。 | `MEDIUM` |
| `product_material_cost` | READ | `src/modules/skills/daily-review-chat/daily-review-chat.definition.ts` (2) | `v_cost_card_product_cost_quality` | BakeryOps复盘先适配新字段，再移除兼容视图。 | `MEDIUM` |
| `prompt_segment` | READ | `src/modules/domain/forecast/prompt-engine.ts` (1) | `ai_prompt_segment`, `ai_prompt_template_segment` | 片段内容变化新增 segment version；模板组合变化新增 template version。 | `HIGH` |
| `prompt_template` | READ + AMBIGUOUS | `src/modules/domain/forecast/gemini-client.ts` (1); `src/modules/domain/forecast/prompt-engine.ts` (1) | `ai_prompt_template`, `ai_prompt_template_segment` | AI调用必须记录具体prompt_template_id；创建新版本而不是覆盖旧行。 | `HIGH` |
| `schema_migrations` | READ + AMBIGUOUS | `scripts/check-migrations.ts` (3) | `app_schema_migration` | 四个仓库使用(repository_code,migration_version)唯一键。 | `CRITICAL` |
| `screening_rules` | AMBIGUOUS | `src/modules/domain/employee/rule-extractor.ts` (2) | `hr_screening_rule` | 招聘流程只展示ACTIVE风险提示，不自动拒绝。 | `HIGH` |
| `session_state` | AMBIGUOUS | `src/bootstrap.ts` (1); `src/modules/domain/recruitment/intake/candidate-fsm.ts` (1) | `msg_conversation`, `msg_conversation_state` | 编排器切新状态表。 | `MEDIUM` |
| `staff` | AMBIGUOUS | `src/modules/domain/recruitment/jd-generator.ts` (9); `src/modules/domain/recruitment/jd-parser.ts` (5); `src/bootstrap.ts` (2); `src/modules/domain/lark/lark-org-sync.service.ts` (2); `src/modules/orchestrator/department-resolver.ts` (2); `scripts/explore/test-cookie-crawl.ts` (1) | `hr_person`, `hr_person_contact`, `hr_employment`, `hr_employment_source_identity`, `hr_employment_mapping_review`, `app_user`, `app_user_role`, `app_user_location_scope` | 班表和工时只用employment_id；通知按app_user.notification_subscription_codes，权限按user_role+location_scope；未确认员工映射进入BLOCKER。 | `CRITICAL` |
| `timeslot_sales_record` | READ + AMBIGUOUS | `src/app/api/ai-product-correction/route.ts` (1); `src/app/api/ai-timeslot/route.ts` (1); `src/modules/domain/forecast/stockout-detector.service.ts` (1) | `v_ops_timeslot_sales_baseline` | 预测调用改用稳定ID。 | `MEDIUM` |
| `trials` | AMBIGUOUS | `src/modules/domain/recruitment/digest/trial-digest.service.ts` (15); `src/modules/domain/recruitment/digest/digest-binding.store.ts` (1); `src/modules/domain/recruitment/recruitment-vocab.ts` (1) | `hr_appointment`, `hr_assessment`, `hr_assessment_score` | 招聘流程用appointment承接试工执行，用assessment承接评价，不再维护重复trial主表。 | `MEDIUM` |
| `wa_outbound_queue` | READ + WRITE + AMBIGUOUS | `scripts/clear-queued.ts` (6); `src/modules/channel/whatsapp/outbound.worker.ts` (1) | `msg_outbound_message` | WhatsApp worker切新队列和幂等键。 | `HIGH` |
| `wa_send_log` | AMBIGUOUS | `src/modules/channel/whatsapp/outbound.config.ts` (1); `src/modules/channel/whatsapp/outbound.worker.ts` (1); `src/modules/channel/whatsapp/whatsapp.adapter.ts` (1) | `msg_outbound_message`, `msg_delivery_attempt`, `msg_delivery_event` | 当前送达状态与推送成功去重结论均由治理视图派生；限额由投递尝试汇总，不保留手机号散列之外的冗余。 | `MEDIUM` |

**项目验收：** 每个上表对象必须定位当前生产调用、记录旧请求/响应或 SQL 形状、建立新契约测试，并证明回滚开关。

## RES/POS 抓取与同步

- **当前代码位置：** `/Users/weiliangshao/hot/res_api`
- **目标写入边界：** pos_ingest_batch、pos_product_listing、pos_sales_*、pos_item_*、pos_member_*
- **目标读取边界：** app_source_system、地点来源映射、数据质量结果
- **不可越界：** 只忠实记录来源，不自行创造 product_id；企业产品映射必须走 pos_product_mapping 的确认流程。

| 当前对象 | 静态访问线索 | 主要文件（引用次数） | 新契约 | 切换规则 | 风险 |
|---|---|---|---|---|---|
| `daily_breakdown` | READ + WRITE + AMBIGUOUS | `sync-to-db.js` (15); `sync-member.mjs` (3) | `pos_daily_breakdown`, `v_pos_daily_breakdown_current` | res_api改写新表；财务查询使用治理 current 视图，任何比例必须同时显示分子和分母。 | `HIGH` |
| `daily_revenue` | READ + WRITE + AMBIGUOUS | `sync-to-db.js` (19); `backfill-gross-sales.mjs` (8); `fix-revenue-net.mjs` (4); `lib/daily-revenue-resolver.js` (3); `lib/capture-wait.js` (2); `apply-translations.js` (1) | `pos_sales_day`, `finance_sales_daily` | 两个写者分别切换；旧daily_revenue只读兼容视图不能接受ON CONFLICT写入。 | `CRITICAL` |
| `daily_sales_record` | AMBIGUOUS | `_backfill-item-key.mjs` (2); `sync-to-db.js` (2); `lib/daily-freshness.js` (1); `lib/daily-queries.js` (1); `lib/step-runner.js` (1) | `v_pos_item_sales_day` | 在调用方切换期提供旧列名兼容视图。 | `MEDIUM` |
| `hourly_sales_summary` | WRITE + AMBIGUOUS | `sync-to-db.js` (4); `apply-translations.js` (1); `lib/daily-queries.js` (1); `lib/step-runner.js` (1) | `pos_sales_hour`, `v_pos_sales_hour_current` | res_api改写新小时表；分析只读 current 视图，source_guest_count 不得标成进店客流。 | `CRITICAL` |
| `item_hourly_sales` | READ + WRITE + AMBIGUOUS | `sync-to-db.js` (11); `scrape-intraday.mjs` (6); `_backfill-item-key.mjs` (2); `apply-translations.js` (1); `intraday-refresh.sh` (1); `lib/daily-freshness.js` (1) | `pos_ingest_batch`, `pos_product_listing`, `pos_item_sales_hour` | res_api全量与日中同步都必须写listing_id、location_id和幂等批次。 | `CRITICAL` |
| `item_last_sale` | READ + WRITE + AMBIGUOUS | `sync-to-db.js` (6); `_backfill-item-key.mjs` (1); `run-refresh.mjs` (1) | `ops_stockout_event` | 断货检测改用索引查询和确认事件。 | `MEDIUM` |
| `item_waste` | READ + WRITE + AMBIGUOUS | `sync-to-db.js` (7); `_backfill-item-key.mjs` (1); `lib/daily-queries.js` (1); `lib/step-runner.js` (1); `scrape-item-last-sale.mjs` (1) | `pos_item_waste`, `v_pos_item_waste_current`, `v_pos_item_waste_mapped` | res_api写新报废表；下游只读 current/mapped 视图并把来源金额与派生成本损失分开展示。 | `HIGH` |
| `pos_member` | AMBIGUOUS | `sync-member.mjs` (5); `lib/pii-guard.js` (4); `scrape-member-snapshot.mjs` (2); `lib/member-map.js` (1); `scrape-member-flows.mjs` (1); `sync-to-db.js` (1) | `pos_member`, `pos_member_contact`, `pos_member_card`, `pos_member_balance_snapshot`, `v_pos_member_state_current`, `mkt_campaign_member`, `mkt_survey_response`, `mkt_survey_result`, `mkt_reward_claim` | res_api只写POS会员域，HBTI只写mkt域；6条result-only使用非来源migration anchor，旧状态只作核对证据，不再双写会员主档。 | `CRITICAL` |
| `pos_member_card_txn` | READ + AMBIGUOUS | `sync-member.mjs` (4); `lib/member-map.js` (2); `scrape-member-order-item.mjs` (2); `_probe-order-items.mjs` (1); `scrape-member-flows.mjs` (1) | `pos_member_card_transaction` | res_api写新交易表；UNKNOWN 类型进入质量视图，不拒绝原始事实；会员归属统一由 v_pos_order_member_attribution 派生。total_amount、trade_amount 和商品 net_sales 是三种不同口径。 | `CRITICAL` |
| `pos_member_daily` | READ + AMBIGUOUS | `sync-member.mjs` (5); `lib/member-map.js` (3); `run-refresh.mjs` (1); `scrape-member-flows.mjs` (1); `scrape-member-trends.mjs` (1) | `pos_member_daily_metric`, `v_pos_member_daily_summary` | 会员日报统一读 v_pos_member_daily_summary，并同时展示来源分母比率与 POS 分母比率。 | `CRITICAL` |
| `pos_member_order_item` | WRITE + AMBIGUOUS | `scrape-member-order-item.mjs` (3) | `pos_order`, `pos_order_item`, `v_pos_member_order_item` | RES 改为整批不可变快照写入；旧表依赖 ON CONFLICT，不能用普通兼容视图承接写入，需维护窗口切换。HBTI/报表只读 v_pos_member_order_item。 | `CRITICAL` |
| `pos_product` | READ + WRITE + AMBIGUOUS | `_backfill-item-key.mjs` (4); `sync-catalog.mjs` (3) | `pos_product_listing`, `pos_product_mapping`, `ops_product` | res_api只写 listing 当前目录；产品主数据流程写 mapping；来源成本字段仅用于核对。 | `CRITICAL` |
| `timeslot_sales_record` | AMBIGUOUS | `sync-to-db.js` (2); `lib/daily-freshness.js` (1); `lib/daily-queries.js` (1); `lib/step-runner.js` (1); `sync-member.mjs` (1) | `v_ops_timeslot_sales_baseline` | 预测调用改用稳定ID。 | `MEDIUM` |

**项目验收：** 每个上表对象必须定位当前生产调用、记录旧请求/响应或 SQL 形状、建立新契约测试，并证明回滚开关。

## 财务网站

- **当前代码位置：** `/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统`
- **目标写入边界：** finance_*、cost_card_*、app_user / app_role / app_audit_event
- **目标读取边界：** POS、供应链、人员工时及成本治理视图
- **不可越界：** 财务导入事实不得反写覆盖 POS；成本卡采用价与供应商原始报价分开；所有地点和产品使用稳定 ID。

| 当前对象 | 静态访问线索 | 主要文件（引用次数） | 新契约 | 切换规则 | 风险 |
|---|---|---|---|---|---|
| `app_audit_log` | READ + WRITE + AMBIGUOUS | `api/_lib/import-batch.js` (5); `api/import-history.js` (3); `api/audit.js` (2); `api/cost-cards.js` (2); `api/_lib/auth.js` (1) | `app_audit_event` | 财务网站切换到受控审计函数；object_type/object_id 只作审计定位，不作业务连接；旧表冻结只读。 | `HIGH` |
| `app_role` | READ + AMBIGUOUS | `api/users.js` (3); `api/_lib/auth.js` (2); `scripts/create-admin.js` (1) | `app_role` | 财务网站鉴权先兼容旧role_code，再切新RBAC。 | `MEDIUM` |
| `app_session` | READ + WRITE | `api/_lib/auth.js` (4); `api/users.js` (1) | `app_session` | 切换窗口提前通知，旧会话表短期只用于撤销核查。 | `HIGH` |
| `app_user` | READ + WRITE + AMBIGUOUS | `api/users.js` (14); `api/auth.js` (12); `scripts/create-admin.js` (4); `api/_lib/auth.js` (2); `api/audit.js` (2); `api/_lib/permissions.js` (1) | `app_user`, `app_user_role` | 登录接口支持一次性强制改密，不复制明文或临时密码。 | `HIGH` |
| `app_user_store_scope` | READ | `api/_lib/store-scope.js` (1) | `app_user_role`, `app_user_location_scope` | 财务网站切换后按 user_role_id + location_id 校验范围；旧接口只在已确认的一对一适配层中接受 user_id/store。 | `HIGH` |
| `cost_card_item` | READ + WRITE + AMBIGUOUS | `api/cost-items.js` (17); `api/cost-cards.js` (10); `api/cost-dashboard.js` (3); `js/cost-card.js` (1) | `ops_product`, `ops_product_alias`, `scm_material`, `scm_material_source_identity` | 财务成本卡UI重构为产品与原料两套主数据；旧item id通过迁移清单映到product/material，372条物料另有来源身份；任何未知类型、单位或多路命中都阻断。 | `CRITICAL` |
| `cost_card_item_price` | READ + WRITE | `api/cost-items.js` (4); `api/cost-dashboard.js` (1) | `scm_supplier_price_observation`, `cost_card_material_price` | 成本API先读确定性当前价视图并影子核对；显示MIGRATED_MANUAL/ESTIMATED质量，实际收货价批准后创建新区间。 | `CRITICAL` |
| `cost_card_recipe` | READ + WRITE + AMBIGUOUS | `api/cost-cards.js` (33); `api/cost-items.js` (13); `api/cost-dashboard.js` (1); `js/cost-card.js` (1) | `cost_card_recipe_version` | 财务成本API按recipe_version_id写读，旧recipe字段由兼容视图提供；104/99+185/171=289/270与版本边界必须逐行核对。 | `CRITICAL` |
| `cost_card_recipe_item` | READ + WRITE | `api/cost-cards.js` (20); `api/cost-items.js` (10) | `cost_card_recipe_component` | 成本计算影子运行逐产品核对组件数、单位成本与门禁1527定位/0孤儿/0环。 | `CRITICAL` |
| `daily_revenue` | READ + WRITE + AMBIGUOUS | `api/_lib/import-batch.js` (6); `sql/finance-import-load.js` (6); `api/sales.js` (4); `api/finance.js` (2); `api/upload.js` (1) | `pos_sales_day`, `finance_sales_daily` | 两个写者分别切换；旧daily_revenue只读兼容视图不能接受ON CONFLICT写入。 | `CRITICAL` |
| `finance_cashflow` | READ + WRITE + AMBIGUOUS | `scripts/import-cashflow.js` (5); `sql/finance-import-load.js` (5); `api/finance.js` (1); `api/upload.js` (1) | `finance_import_batch`, `finance_cashflow_line` | 财务页面切新表并保留旧字段适配。 | `MEDIUM` |
| `finance_expense` | READ + WRITE + AMBIGUOUS | `sql/finance-import-load.js` (5); `api/finance.js` (1); `api/upload.js` (1); `js/engine.js` (1) | `finance_import_batch`, `finance_monthly_cost_line` | 财务损益查询只读v_finance_import_batch_current选中的获准批次和认可会计处理。 | `MEDIUM` |
| `finance_expense_raw` | READ + WRITE + AMBIGUOUS | `sql/load2.js` (3); `api/finance.js` (1) | `finance_import_batch`, `finance_monthly_cost_line` | 兼容查询必须显式选择raw、management或posted层；默认利润表不得汇总RAW_SOURCE。 | `HIGH` |
| `finance_item_sales` | READ + WRITE + AMBIGUOUS | `sql/finance-import-load.js` (5); `api/finance.js` (1); `api/upload.js` (1) | `finance_item_sales_monthly` | 财务单品页切换到新表。 | `MEDIUM` |
| `finance_labor` | READ + WRITE + AMBIGUOUS | `sql/finance-import-load.js` (5); `api/finance.js` (1); `api/upload.js` (1); `js/engine.js` (1) | `finance_monthly_cost_line` | 新财务页面默认不读旧口径，仅历史兜底。 | `HIGH` |
| `finance_labor_detail` | READ + WRITE + AMBIGUOUS | `api/_lib/import-batch.js` (3); `sql/load2.js` (3); `scripts/import-labor-v2.js` (2); `api/finance.js` (1); `api/upload.js` (1) | `finance_import_batch`, `finance_monthly_cost_line` | 财务人工成本页面读新月成本行。 | `MEDIUM` |
| `finance_material` | READ + WRITE + AMBIGUOUS | `sql/finance-import-load.js` (5); `api/finance.js` (1); `api/upload.js` (1) | `finance_import_batch`, `finance_monthly_cost_line` | 财务材料成本页面读新月成本行。 | `MEDIUM` |
| `finance_order_base` | READ + WRITE + AMBIGUOUS | `sql/finance-import-load.js` (5); `api/finance.js` (1); `api/upload.js` (1) | `finance_monthly_metric` | 摊销公式改读metric_code。 | `MEDIUM` |
| `finance_orders` | READ + WRITE + AMBIGUOUS | `sql/finance-import-load.js` (5); `api/_lib/import-batch.js` (2); `api/finance.js` (1); `api/upload.js` (1) | `finance_order_logistics_line` | 财务物流页切新历史事实；旧列名兼容查询只从明确目标字段投影。 | `MEDIUM` |
| `finance_period_map` | READ + AMBIGUOUS | `js/engine.js` (13); `js/render.js` (2); `api/finance.js` (1); `js/io.js` (1) | `finance_period_category_map` | 损益计算只读ACTIVE有效规则。 | `MEDIUM` |
| `finance_pl_metrics` | READ + WRITE + AMBIGUOUS | `sql/load2.js` (3); `api/finance.js` (1); `js/engine.js` (1) | `finance_monthly_metric` | 财务利润表改读标准月指标。 | `MEDIUM` |
| `finance_revenue_daily` | READ + WRITE + AMBIGUOUS | `api/_lib/import-batch.js` (4); `api/sales.js` (2); `api/upload.js` (2); `api/finance.js` (1) | `finance_import_batch`, `finance_sales_daily` | 财务销售模板只写finance_sales_daily；比例只从同批原值派生。 | `HIGH` |
| `finance_stock` | READ + WRITE + AMBIGUOUS | `sql/finance-import-load.js` (6); `sql/load2.js` (5); `api/finance.js` (1); `api/upload.js` (1) | `finance_inventory_snapshot_line` | 财务库存页切新表；正式单位换算必须等来源单位确认并建立物料单位换算。 | `MEDIUM` |
| `finance_stock_flow` | READ + WRITE + AMBIGUOUS | `sql/load2.js` (3); `api/finance.js` (1) | `finance_inventory_flow_line` | 财务进销存查询切新表。 | `MEDIUM` |
| `finance_store` | READ | `api/_lib/store-scope.js` (2) | `ops_location`, `ops_location_source_identity` | 财务所有store参数改为location_id；保留显示名。 | `CRITICAL` |
| `finance_supplier_orders` | READ + WRITE + AMBIGUOUS | `sql/load2.js` (3); `api/finance.js` (1) | `finance_supplier_purchase_monthly` | 财务供应商采购页切新表。 | `MEDIUM` |
| `finance_targets` | READ + WRITE + AMBIGUOUS | `sql/finance-import-load.js` (5); `api/_lib/import-batch.js` (3); `api/finance.js` (1); `api/upload.js` (1) | `finance_target` | 财务目标页创建新版本而非覆盖。 | `MEDIUM` |
| `item_hourly_sales` | READ + AMBIGUOUS | `api/sales.js` (4); `sql/alias.js` (1); `sql/load2.js` (1) | `pos_ingest_batch`, `pos_product_listing`, `pos_item_sales_hour` | res_api全量与日中同步都必须写listing_id、location_id和幂等批次。 | `CRITICAL` |
| `item_waste` | READ | `api/finance.js` (2) | `pos_item_waste`, `v_pos_item_waste_current`, `v_pos_item_waste_mapped` | res_api写新报废表；下游只读 current/mapped 视图并把来源金额与派生成本损失分开展示。 | `HIGH` |
| `pos_product` | READ + AMBIGUOUS | `api/sales.js` (5) | `pos_product_listing`, `pos_product_mapping`, `ops_product` | res_api只写 listing 当前目录；产品主数据流程写 mapping；来源成本字段仅用于核对。 | `CRITICAL` |
| `product` | AMBIGUOUS | `js/cost-card.js` (18); `api/_lib/cost-card-policy.js` (5); `api/cost-dashboard.js` (4); `api/cost-items.js` (3); `sql/transform2.js` (3); `api/cost-cards.js` (1) | `ops_product`, `ops_business_rule`, `v_pos_item_sales_day`, `v_ops_timeslot_sales_baseline` | BakeryOps产品API改用 product_id；地点策略按发生时有效的业务规则版本读取，实际销售比例和基线只读视图，规则参考价不能当成交价。 | `CRITICAL` |
| `schema_migrations` | READ + WRITE + AMBIGUOUS | `scripts/apply-migrations.js` (5) | `app_schema_migration` | 四个仓库使用(repository_code,migration_version)唯一键。 | `CRITICAL` |
| `v_cost_card_current_cost` | READ | `api/cost-cards.js` (4); `api/cost-dashboard.js` (4); `api/cost-items.js` (2) | `v_cost_card_product_cost_quality` | 财务成本页面切新视图。 | `MEDIUM` |
| `v_cost_card_data_quality` | READ | `api/cost-cards.js` (1); `api/cost-dashboard.js` (1) | `v_cost_card_product_cost_quality`, `v_app_data_quality_summary` | 旧字段兼容后逐步下线。 | `MEDIUM` |
| `v_cost_card_price_current_normalized` | READ | `api/cost-items.js` (5); `api/cost-cards.js` (3) | `v_cost_card_material_price_current` | 成本计算切新视图。 | `MEDIUM` |

**项目验收：** 每个上表对象必须定位当前生产调用、记录旧请求/响应或 SQL 形状、建立新契约测试，并证明回滚开关。

## HBTI 活动网站

- **当前代码位置：** `/Users/weiliangshao/hot/hbti-web`
- **目标写入边界：** mkt_campaign_*、mkt_survey_*、mkt_reward_*；受控一次性令牌
- **目标读取边界：** 最小化会员身份、活动配置和奖励库存
- **不可越界：** 不得再把活动当前状态写回 pos_member；不得复制会员手机号到营销事实表。

| 当前对象 | 静态访问线索 | 主要文件（引用次数） | 新契约 | 切换规则 | 风险 |
|---|---|---|---|---|---|
| `fact_hbti_response` | READ + WRITE + AMBIGUOUS | `src/lib/store/pg-completion-store.ts` (5); `src/lib/store/completion-store.ts` (1) | `mkt_campaign_version`, `mkt_campaign_member`, `mkt_survey_question`, `mkt_survey_response`, `mkt_survey_answer`, `mkt_survey_result` | HBTI先双写作答与结果，逐次核对1 full + 6 result-only、0个伪造答案、6个非来源migration anchor、result_code和真实答案input_sha256。 | `HIGH` |
| `hbti_auth_token` | READ + WRITE + AMBIGUOUS | `src/lib/auth/pg-auth-store.ts` (11); `src/lib/store/pg-completion-store.ts` (1) | `app_one_time_token` | HBTI链接服务在明确维护窗口切换验证入口；旧表仅短期只读用于撤销核查，过期后按保留策略清理。 | `HIGH` |
| `hbti_gift_stock` | READ + WRITE | `src/lib/store/gift-pool.ts` (4); `src/lib/completion/complete-hbti.ts` (1) | `mkt_reward`, `mkt_reward_stock`, `mkt_reward_claim`, `v_mkt_reward_stock_reconciliation` | HBTI库存扣减改为原子版本锁；库存核对只汇总reward_stock_id非空的claim，stockless外部履约不进入库存核对，REDEEMED只证明发放不证明POS消费。 | `CRITICAL` |
| `hbti_rate_limit` | WRITE + AMBIGUOUS | `src/lib/rate-limit/pg-rate-limit.ts` (3); `src/lib/rate-limit/auth-rate-limit.ts` (1); `src/lib/store/pg-completion-store.ts` (1) | `app_rate_limit_event` | 短期允许旧桶自然过期。 | `LOW` |
| `pos_member` | READ + WRITE + AMBIGUOUS | `src/lib/store/pg-completion-store.ts` (18); `src/lib/store/completion-store.ts` (2); `src/lib/auth/pg-auth-store.ts` (1); `src/lib/completion/complete-hbti.ts` (1); `src/lib/db/postgres.ts` (1) | `pos_member`, `pos_member_contact`, `pos_member_card`, `pos_member_balance_snapshot`, `v_pos_member_state_current`, `mkt_campaign_member`, `mkt_survey_response`, `mkt_survey_result`, `mkt_reward_claim` | res_api只写POS会员域，HBTI只写mkt域；6条result-only使用非来源migration anchor，旧状态只作核对证据，不再双写会员主档。 | `CRITICAL` |
| `product` | AMBIGUOUS | `src/lib/auth/countries.ts` (1) | `ops_product`, `ops_business_rule`, `v_pos_item_sales_day`, `v_ops_timeslot_sales_baseline` | BakeryOps产品API改用 product_id；地点策略按发生时有效的业务规则版本读取，实际销售比例和基线只读视图，规则参考价不能当成交价。 | `CRITICAL` |
| `staff` | AMBIGUOUS | `src/content/ui.ts` (1) | `hr_person`, `hr_person_contact`, `hr_employment`, `hr_employment_source_identity`, `hr_employment_mapping_review`, `app_user`, `app_user_role`, `app_user_location_scope` | 班表和工时只用employment_id；通知按app_user.notification_subscription_codes，权限按user_role+location_scope；未确认员工映射进入BLOCKER。 | `CRITICAL` |

**项目验收：** 每个上表对象必须定位当前生产调用、记录旧请求/响应或 SQL 形状、建立新契约测试，并证明回滚开关。

## 跨项目冲突必须先拆

- `daily_revenue`：POS 与财务来源分开写 `pos_sales_day` / `finance_sales_daily`，只在核对视图比较。
- `pos_member`：RES/POS 写会员域，HBTI 写营销域；手机号在受限联系表，活动状态不回写会员主档。
- 门店：所有项目通过 `location_id`，来源名称保留在 `ops_location_source_identity`，不再各自建门店真相。
- 产品：RES/POS 只负责 listing；运营负责企业产品；映射审批后成本、预测和销售才通过 `product_id` 联动。
- 人员：自然人、雇佣关系、登录账号分开；班表与工时用 `employment_id`。
