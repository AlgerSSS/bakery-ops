"""Shared review content for documents and diagrams.

This file contains business-facing statements that cannot be derived from
column metadata alone. Keeping the content here ensures the Markdown report,
HTML review package, and Draw.io pages describe the same fifteen chains.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Chain:
    number: int
    name: str
    question: str
    nodes: tuple[str, ...]
    joins: tuple[str, ...]
    control: str


PROJECTS = (
    {
        "code": "bakery_ops",
        "name": "BakeryOps",
        "root": "/Users/weiliangshao/hot/bakery-ops",
        "target_write_domains": "已启用的 ops_*、hr_*、scm_*、msg_*、ai_*；app_job_run。质量结论由只读核对视图派生，不写跨域多态质量表。",
        "target_read_domains": "全部受治理视图及本项目负责的业务表",
        "boundary": "不得直接写 finance_*、cost_card_*、pos_* 的来源事实。人工运营动作写 ops_*，不要覆盖 POS 或财务来源事实。",
    },
    {
        "code": "res_api",
        "name": "RES/POS 抓取与同步",
        "root": "/Users/weiliangshao/hot/res_api",
        "target_write_domains": "pos_ingest_batch、pos_product_listing、pos_sales_*、pos_item_*、pos_member_*",
        "target_read_domains": "app_source_system、地点来源映射、数据质量结果",
        "boundary": "只忠实记录来源，不自行创造 product_id；企业产品映射必须走 pos_product_mapping 的确认流程。",
    },
    {
        "code": "finance_web",
        "name": "财务网站",
        "root": "/Users/weiliangshao/Library/Mobile Documents/iCloud~md~obsidian/Documents/Brain/raw/General/雅楠需求/门店财务AI分析系统",
        "target_write_domains": "finance_*、cost_card_*、app_user / app_role / app_audit_event",
        "target_read_domains": "POS、供应链、人员工时及成本治理视图",
        "boundary": "财务导入事实不得反写覆盖 POS；成本卡采用价与供应商原始报价分开；所有地点和产品使用稳定 ID。",
    },
    {
        "code": "hbti_web",
        "name": "HBTI 活动网站",
        "root": "/Users/weiliangshao/hot/hbti-web",
        "target_write_domains": "mkt_campaign_*、mkt_survey_*、mkt_reward_*；受控一次性令牌",
        "target_read_domains": "最小化会员身份、活动配置和奖励库存",
        "boundary": "不得再把活动当前状态写回 pos_member；不得复制会员手机号到营销事实表。",
    },
)


END_TO_END_CHAINS = (
    Chain(
        1,
        "POS 抓取到三层销售核对",
        "同一天的日销售、小时销售和商品销售是否完整且一致？",
        ("app_source_system", "pos_ingest_batch", "pos_sales_day", "pos_sales_hour", "pos_item_sales_hour", "v_pos_revenue_reconciliation"),
        (
            "app_source_system.source_system_id = pos_ingest_batch.source_system_id",
            "三类事实均通过 pos_ingest_batch_id 追溯同一抓取批次",
            "按 location_id + business_date 对账；NULL 与 0 不混用",
        ),
        "批次状态不是 SUCCEEDED 或核对超阈值时，不允许作为最终经营事实静默下游消费。",
    ),
    Chain(
        2,
        "POS 商品到企业产品身份",
        "来源商品如何连接预测、排产、成本和销售，而不依赖名称？",
        ("pos_product_listing", "pos_product_mapping", "ops_product", "v_product_identity", "v_pos_item_sales_day"),
        (
            "销售事实永远先连 listing_id",
            "listing_id 在销售发生时点落入 mapping 的 [valid_from, valid_to)",
            "只有 status = CONFIRMED 的映射提供 product_id",
        ),
        "无法确认时保留 listing 和销售金额，product_id 为空并进入审核；禁止按名称猜填。",
    ),
    Chain(
        3,
        "节假日与需求因子到预测准确率",
        "节假日、天气或事件如何影响预测，之后如何验证影响是否真实？",
        ("app_job_run", "ops_calendar_event", "v_pos_item_sales_day", "v_ops_holiday_factor", "ops_forecast_run", "ops_forecast_line", "v_ops_forecast_accuracy"),
        (
            "event 通过 job_run_id 保留 API 抓取运行和输入清单证据",
            "factor 由 event、location_id、可选 product_id/category_code 和历史销售窗口即时计算，并输出 algorithm_version、窗口、样本量和质量",
            "forecast_line 与实际销售按 location_id + business_date + product_id 连接",
        ),
        "API 日历事实需要保存；可由日历、历史销售和版本化规则重算的因子不再落表。低样本或兜底因子必须显式标记。",
    ),
    Chain(
        4,
        "突发情况到明日调整动作",
        "当日突发事件为何导致明日某产品计划增减，谁批准了？",
        ("ops_operational_event", "ops_operational_event_product", "ops_production_plan_version", "ops_production_plan_line", "ops_review_action", "app_audit_event"),
        (
            "事件通过 location_id + 时间范围定位影响地点",
            "受影响产品使用 product_id；新计划行通过 based_on_plan_line_id 指向调整前行，并保存 reason、AI建议和人工确认主体",
            "review_action 和 audit_event 保留提出、批准、执行主体",
        ),
        "调整必须形成新计划版本；delta 由新旧计划行派生，不再为同一调整另建一张物理表，也不覆盖原预测。",
    ),
    Chain(
        5,
        "预测到排产工作量与班表需求",
        "明日预计销量怎样变成分时生产量、工作分钟和关键岗位人数？",
        ("ops_forecast_run", "ops_production_plan_version", "ops_production_plan_line", "ops_production_plan_slot", "ops_workload_run", "ops_workload_line", "ops_shift_requirement"),
        (
            "计划版本记录 forecast_run_id，但允许人工计划独立存在",
            "计划行和分时槽均使用 product_id；workload_line 回指 plan_line_id",
            "shift_requirement 通过 workload_run_id + role_id + station_id 说明关键岗位需求",
        ),
        "预测、批准计划、工作量计算和排班需求是四种不同事实，不能压在一张表的一行里。",
    ),
    Chain(
        6,
        "排产到原料毛需求",
        "计划生产多少产品，为什么需要订多少某种原料？",
        ("ops_production_plan_line", "cost_card_recipe_version", "cost_card_recipe_component", "scm_material_requirement_run", "scm_material_requirement_component", "v_scm_material_requirement_line"),
        (
            "plan_line 选择发生日有效且已批准的 recipe_version_id",
            "每个配方组件用 material_id + input_quantity + input_unit_id + 已冻结单位换算展开；base_unit_quantity 由此派生",
            "requirement_component 同时保留 run_id、plan_line_id、recipe_component_id、material_id 和质量状态；按 run_id + material_id 派生汇总需求",
        ),
        "必须能从一克原料需求反查到哪张计划、哪个产品和哪个配方版本；单位不明则阻断。",
    ),
    Chain(
        7,
        "原料需求到建议订货、采购单和收货",
        "未来订货量为何增减，最终批准、下单和收到多少？",
        ("v_scm_material_requirement_line", "scm_replenishment_run", "scm_replenishment_line", "scm_supplier_item", "scm_purchase_order_revision", "scm_purchase_order_line", "scm_goods_receipt_line", "scm_inventory_movement_line"),
        (
            "补货建议以 material_id + destination_location_id + need_by_date 连接需求",
            "建议量和批准量分字段保留；差异量由视图计算，调整原因保留为人工决定事实",
            "正式补货和PO锁定有效期供应商商品版本 supplier_item_id，避免供应商改包装后重解释历史",
            "PO 行通过 replenishment_line_id 追建议；收货行通过 purchase_order_line_id 追订单",
        ),
        "在途、现存、安全量、MOQ 和订货倍数均为计算输入；人工改量必须写理由，不能覆盖 suggested_quantity。",
    ),
    Chain(
        8,
        "收货实价到成本采用价",
        "市场采购价波动如何进入配方成本，采用了哪一个价格？",
        ("app_unit", "scm_material_unit_conversion", "scm_supplier_item", "scm_goods_receipt_line", "scm_supplier_price_observation", "cost_card_material_price", "v_cost_card_product_cost_component", "v_cost_card_product_cost_snapshot"),
        (
            "收货行提供 actual_unit_price 和单位证据",
            "供应商商品版本自身保留 supplier_id + supplier_sku + material_id + 包装换算 + 有效期；价格观察锁定该 supplier_item_id",
            "material_price 只引用经批准 observation_id；成本组件视图按营业日选择 recipe_version_id 和 material_price_id",
            "收货模块启用前，现有 cost_card_item_price 以 MIGRATED_MANUAL 启动价迁移并保留旧 price_id 与核验证据",
        ),
        "市场报价、实际收货价和成本采用价是三层事实；没有单位换算证据的价格不得进入正式成本。",
    ),
    Chain(
        9,
        "当日产品毛利与覆盖率",
        "今天每个产品赚了多少，结论覆盖了多少销售？",
        ("v_pos_item_sales_day", "v_cost_card_product_cost_snapshot", "v_cost_card_product_daily_margin", "v_cost_card_daily_margin", "v_app_data_quality_summary"),
        (
            "按 location_id + business_date + product_id 连接销售和目标日成本快照",
            "数量 × unit_total_cost 得到估算成本，净销售减估算成本得到毛利",
            "缺产品映射、缺配方或缺价格的销售额进入 coverage 缺口",
            "POS更正批次或配方、价格、规则变化都会改变修订键；毛利输出同时保留pos_ingest_batch_id、cost_revision_key和margin_revision_key",
        ),
        "毛利率必须与成本范围、总销售覆盖率和可信成本覆盖率一起展示；没有批准间接成本规则时只能称材料贡献毛利。质量问题工作流是可选扩展，不影响视图暴露质量状态。",
    ),
    Chain(
        10,
        "计划到生产、配送、销售与复盘",
        "计划是否生产、配送并卖出，报废或断货发生在哪里？",
        ("ops_production_plan_line", "ops_production_run_line", "ops_dispatch_line", "v_pos_item_sales_day", "v_pos_item_waste_mapped", "ops_stockout_event", "v_ops_item_daily_pulse", "ops_daily_review"),
        (
            "全部产品事实用 product_id，来源 POS 仍保留 listing_id",
            "生产回指 plan_line_id，配送回指 production_run_line_id",
            "按 location_id + business_date + product_id 汇总 planned/produced/dispatched/sold/waste/stockout",
        ),
        "各事实不可互相推定：生产完成不等于已配送，配送不等于已售，零销量不自动等于断货。",
    ),
    Chain(
        11,
        "招聘需求到正式雇佣",
        "一个招聘需求如何经过申请、评估、试工、Offer 变成员工？",
        ("hr_job_requisition", "hr_person", "hr_application", "hr_application_stage_event", "v_hr_application_current_stage", "hr_appointment", "hr_assessment", "v_hr_assessment_summary", "hr_offer", "hr_employment", "hr_employment_source_identity", "hr_employment_mapping_review"),
        (
            "application 用 person_id + requisition_id 连接人和岗位需求",
            "阶段变化只追加 hr_application_stage_event；当前阶段由视图派生，不覆盖申请主档",
            "预约和试工执行共用 appointment；评估和 offer 回指 application_id，评估总分由逐项评分派生",
            "录用后 hr_employment.origin_application_id = hr_application.application_id，单向追溯来源申请",
            "Lark/工资表外部员工ID必须先进入 source_identity；重名、再入职或多候选进入 mapping_review",
        ),
        "person 是自然人，employment 是一段雇佣关系，app_user 是系统账号；三者不得混为一个 ID。",
    ),
    Chain(
        12,
        "培训资格到关键岗位班表与实际工时",
        "关键岗位是否安排了具备有效培训资格的人，实际上班多久？",
        ("ops_role_training_requirement", "hr_training_assignment", "hr_training_result", "ops_shift_requirement", "ops_shift_assignment", "hr_timesheet_entry", "v_hr_timesheet_entry_current", "v_ops_shift_publish_readiness", "v_ops_labor_productivity"),
        (
            "岗位要求使用 role_id + course_version_id + 有效期",
            "班表使用 employment_id + role_id + station_id，关键岗不得只写自由文本",
            "原始工时先按 source_system_id + source_entry_id 由 v_hr_timesheet_entry_current 选出当前有效版本，再通过 employment_id + location_id + 时间重叠与班表核对",
        ),
        "计划工时和实际工时分开；过期、失败或缺失培训结果时关键岗指派必须形成明确告警。",
    ),
    Chain(
        13,
        "会员关联商品到 HBTI 问卷和奖励",
        "会员账号关联过哪些订单商品、口径是否唯一，又参加哪一版活动并获得什么奖励？",
        ("pos_member", "pos_member_card_transaction", "pos_order", "pos_order_item", "v_pos_order_member_attribution", "v_pos_member_order_item", "mkt_campaign_version", "mkt_campaign_member", "mkt_survey_response", "mkt_survey_result", "mkt_reward_claim", "mkt_reward_stock", "v_mkt_reward_stock_reconciliation"),
        (
            "订单商品使用 batch_id + order_id + listing_id；同批重复来源行 SUM 并保留 source_row_count，不做 DISTINCT",
            "会员卡流水通过 source_system_id + location_id + source_order_id 解析 order_id；恰好一个不同 member_id 才标 UNIQUE",
            "v_pos_member_order_item 只做派生连接，保留 AMBIGUOUS/UNMATCHED、产品映射状态和 MEMBER_FLAGGED_ONLY 覆盖口径",
            "campaign_member 使用 member_id + campaign_version_id",
            "survey_result 使用 survey_response_id + result_type + algorithm_version，现有 hbti_code 迁 result_code；campaign_version 明确钉住正式算法版本",
            "reward_claim 以 reward_id 记录直接奖励身份；有库存支撑时通过 (reward_stock_id,reward_id) 复合外键锁定同一奖励库存并原子更新 reward_stock，外部无库存履约则以 source_system_id + source_fulfillment_id 保真且不碰库存；核对视图只聚合 reward_stock_id 非空的 claim 并独立复算缓存计数",
        ),
        "POS 会员主档不保存商品偏好或某次活动当前结果；个性化文案只能说账号关联订单中记录了什么，不能把共享卡、团购或多人订单推断成本人亲自消费。",
    ),
    Chain(
        14,
        "财务导入到独立核对口径",
        "财务模板与 POS、采购和工时不一致时，如何保留双方事实并查出差异？",
        ("finance_import_batch", "finance_sales_daily", "finance_monthly_cost_line", "finance_monthly_metric", "finance_target", "v_finance_sales_reconciliation", "v_finance_margin_reconciliation"),
        (
            "所有财务事实先回指 import_batch_id，并使用 location_id + 日期/月 + currency",
            "import_batch 明确 source_layer、recognition_status 与 supersedes；raw、management report 和 posted ledger 分层读取",
            "与 POS、供应链、工时只在治理视图核对，不覆盖来源表",
            "target 是版本化目标；metric 保留来源口径代码",
        ),
        "差异是一条需要解释的事实，不以最后写入者为准；来源缺失不得补 0。",
    ),
    Chain(
        15,
        "消息、AI 建议、动作和审计闭环",
        "一条自动或人工建议如何触发消息，是否送达，是否产生业务动作？",
        ("ai_prompt_template", "ai_call", "msg_outbound_message", "msg_delivery_attempt", "msg_delivery_event", "v_msg_delivery_current", "ops_review_action", "app_job_run", "app_audit_event"),
        (
            "ai_prompt_template 每行就是一个不可变版本；ai_call 锁定具体 prompt_template_id 和调用业务对象",
            "outbound_message 对 job_run、review_action、ai_call、appointment 和 campaign_member 使用明确外键；扩展文本来源不进入关键分析",
            "delivery_attempt 回指 outbound_message；渠道回执只追加到 delivery_event，v_msg_delivery_current 按事件顺序计算当前送达状态",
            "执行动作由 review_action 和 audit_event 证明；消息已读不等于业务动作已完成",
        ),
        "AI 输出、消息送达和业务执行是三件事；没有执行事实时不能把“已发送”解释为“已完成”。",
    ),
)


IDENTITY_SPINE = (
    ("location_id", "ops_location.location_id", "门店、厨房、仓库、办公室或混合地点的统一身份"),
    ("product_id", "ops_product.product_id", "企业层产品身份；POS listing 需经有效映射才能连接"),
    ("person_id", "hr_person.person_id", "自然人身份；不代表某段雇佣或系统账号"),
    ("employment_id", "hr_employment.employment_id", "一段雇佣关系；班表、培训和工时的人员键"),
    ("material_id", "scm_material.material_id", "统一原料、包材、半成品或耗材身份"),
    ("supplier_item_id", "scm_supplier_item.supplier_item_id", "供应商SKU、统一物料与包装换算在特定有效期内的版本身份"),
    ("business_date", "各事实的 business_date", "以地点营业日口径连接，而不是从 created_at 截日期"),
    ("source_system_id", "app_source_system.source_system_id", "来源系统责任和外部标识命名空间"),
    ("batch/run/version", "各域批次、运行和版本 ID", "说明哪次采集、计算或批准产生该行"),
    ("effective period", "valid_from / valid_to 或 effective_from / effective_to", "按发生时点选择身份映射、配方、价格或规则"),
)


DESIGN_GATES = (
    "单企业模型：不引入 tenant_id；所有多地点事实必须显式带 location_id。",
    "一行一种粒度：每张表必须声明一行代表什么；订单身份、订单商品、支付、退款、会员归属和聚合指标不得混成一行。",
    "基础事实优先：能从稳定基础事实重算的排行、画像、占比、比率、差值和文案放在只读视图/查询；只有来源原值、稳定身份、人工决定、业务副作用、并发事务状态或需复现的冻结运行结果才存表。",
    "连接图完整：除迁移台账和不可逆限流桶这两个明确技术/隐私例外外，每张业务表必须通过强外键进入统一身份图；不能用多态文本ID逃避外键。",
    "来源优先：先存 POS listing、外部员工号、供应商商品号，再经受控映射连接统一身份。",
    "名称不是连接键：名称只用于展示、搜索或提出候选，不能自动成为跨域事实关系。",
    "空值语义显式化：含可空列的唯一约束必须声明 NULLS DISTINCT 或 NULLS NOT DISTINCT，不能依赖默认行为。",
    "有效期不可重叠：正式身份映射、授权、规则、课程、配方、单位换算与采用价统一使用左闭右开区间并由排斥约束防重叠。",
    "计划与事实分离：预测、批准计划、生产、配送、销售、工时、财务导入分别保真。",
    "版本不可变：配方、计划、班表、Prompt、规则和目标发布后不原地重写。",
    "时间语义明确：created_at 是入库时间，business_date 是营业日，effective period 是生效区间。",
    "单位和币种不可省略：数量必须有基准单位或换算证据，金额必须有币种。",
    "数据质量不填假值：映射缺失、来源部分失败或覆盖不足必须保留 NULL 和质量状态。",
    "隐私最小化：手机号、联系方式、认证令牌和自由文本分表、加密/哈希、最小权限、限定保留期。",
    "派生结果只读：跨域分析通过 v_* 视图输出，任何项目不得向视图写业务事实。",
    "生命周期分层：CORE_MIGRATION 承接现状；PLANNED_MODULE 不因画进蓝图就视为已具备；SOURCE_CONDITIONAL 必须先证明外部来源能力。",
)
