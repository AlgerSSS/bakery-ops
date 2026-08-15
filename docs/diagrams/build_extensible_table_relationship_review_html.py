#!/usr/bin/env python3
"""Build the annotated interactive HTML for the HOT CRUSH table review.

The Draw.io source remains the visual source of truth.  This script first uses
drawiohtml.py to rebuild the self-contained 15-page viewer, then adds a
page-aware Chinese explanation panel.  It does not change the diagram, schema,
or database.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parent
BLUEPRINT_GENERATOR = ROOT / "build_extensible_table_relationship_blueprint.py"
DRAWIO_SOURCE = ROOT / "HOTCRUSH可扩展数据基座与表关系评审稿.drawio"
HTML_OUTPUT = ROOT / "HOTCRUSH可扩展数据基座与表关系评审稿.html"
DRAWIO_HTML = Path("/Users/weiliangshao/.codex/skills/drawio-skill/scripts/drawiohtml.py")


def load_blueprint_module():
    spec = importlib.util.spec_from_file_location("hotcrush_table_review_blueprint", BLUEPRINT_GENERATOR)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {BLUEPRINT_GENERATOR}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


bp = load_blueprint_module()


VIEW_PURPOSES = {
    "v_pos_daily_sales": "按地点、经营日和产品提供统一的 POS 日销售口径",
    "v_pos_source_reconciliation": "核对 POS 抓取批次、来源覆盖和异常状态",
    "v_ops_plan_vs_output": "比较已发布生产计划与实际产出",
    "v_ops_output_vs_dispatch": "比较实际产出与地点间配送数量",
    "v_ops_plan_vs_dispatch": "比较已发布计划与实际配送结果",
    "v_ops_product_mix_daily": "计算各产品每日销售占比及其升降变化",
    "v_ops_forecast_accuracy": "比较预测与实际销售，计算预测误差",
    "v_hr_role_eligibility": "判断员工是否满足岗位所需培训与资格",
    "v_ops_shift_publish_readiness": "检查班表关键岗位、资格和人数是否满足发布门禁",
    "v_ops_labor_productivity": "把班表、实际工时与销售或产出联动计算人效",
    "v_ops_daily_product_margin": "把当日销售与当日成本快照联动计算产品毛利",
    "v_cost_card_item_cost_quality": "展示成本价格覆盖、缺失来源和估算质量状态",
    "v_entity_link_index": "提供跨域对象关系的统一只读导航",
    "v_business_timeline": "按稳定身份、地点和时间汇总业务事件时间线",
    "v_domain_event_stream": "合并各域 Outbox，提供统一只读事件流",
    "v_finance_sales_reconciliation": "比较 POS 销售口径与财务入账销售口径",
    "v_finance_purchase_reconciliation": "比较采购收货口径与财务采购口径",
    "v_finance_labor_reconciliation": "比较排班、实际工时与财务人工成本口径",
    "v_finance_margin_summary": "汇总销售、成本和财务入账后的毛利差异",
}


STATUS_NOTES = {
    "EXISTING": "复用现有对象；仍需核对真实生产结构与调用方。",
    "UPGRADE": "在现有对象上补字段、约束或口径；不是另建一张同义表。",
    "NEW": "目标结构中需要新增；当前生产库不一定已经存在。",
    "CONDITIONAL": "只有来源能提供跨重跑稳定的外部 ID 时才允许建立。",
}


PAGE_NOTES = {
    "hotcrush-foundation-1": {
        "summary": "从外部来源进入批次和身份映射，再通过稳定身份连接各业务域，最后以只读视图和事件服务上层应用。",
        "read": [
            "从上往下读：外部来源 → 来源批次与映射 → 稳定身份 → 分域事实 → 统一读取与事件 → 应用。",
            "同一种颜色表示同一类职责，不代表所有同色框必须放在一张表里。",
            "每个业务域只有一个权威写入者；其他模块通过 FK、只读视图或事件协作。",
        ],
        "confusions": [
            "大号虚线分组框只是阅读分区，不是数据库表，也不代表 schema。",
            "圆柱框表示数据对象或数据域；圆角矩形表示规则、流程、读取面或应用。",
            "图中是目标数据基座，不代表生产库已经全部实施。",
        ],
        "mode": "concept",
    },
    "hotcrush-foundation-2": {
        "summary": "统一的不是所有表的字段，而是记录类型、连接线索、来源证据和写入边界。",
        "read": [
            "先看四类记录：稳定身份、来源/批次、不可变事实、计划/规则版本。",
            "再看五类共同线索：地点、经营日、业务身份、来源批次和因果关系。",
            "最后看关系桥、契约视图、Outbox 与只读索引如何提供跨模块联动。",
        ],
        "confusions": [
            "统一契约不是要求每张表都拥有 location_id 或 business_day_id；只在该事实确实与地点或经营日有关时使用。",
            "JSONB 只适合原始快照、证据和低频扩展，不能代替核心 FK 与高频查询字段。",
            "名称、手机号和自由文本可以展示或搜索，但不能作为跨域关联依据。",
        ],
        "mode": "concept",
    },
    "hotcrush-foundation-3": {
        "summary": "新模块通过九步接入共享身份、来源追溯、只读契约和事件体系，而不是复制一套主数据。",
        "read": [
            "按 1–9 顺序检查：写入所有权、共享锚点、强类型表、来源、关系桥、契约视图、事件、索引、权限验收。",
            "写路径只进入本域表和本域 Outbox；读路径优先使用共享身份与契约视图。",
            "只有需要报表、AI 或自动化时才建立专用 view、materialized view 或 mart。",
        ],
        "confusions": [
            "关系桥只表达真实、可验证的业务关系，不能成为万能 entity-relation 表。",
            "统一索引用于发现和导航，不承担业务事实的写入责任。",
            "新模块接入完成不等于可以直接 UPDATE 其他域的权威事实。",
        ],
        "mode": "concept",
    },
    "foundation-table-map": {
        "summary": "82 张目标核心表按业务域完整列出；本页只画跨域主路径，后续页面逐表展开 PK、FK、粒度和写入者。",
        "read": [
            "先从中间深蓝色身份脊柱识别共同线索，再看每个彩色业务域如何连接。",
            "点击业务域卡片可跳转到对应的表级页面查看真实 FK。",
            "右侧“对象详细备注”包含 82 张表的用途、粒度、字段、状态、写入者和 FK。",
        ],
        "confusions": [
            "本页没有画出全部外键是刻意的；把 82 张表的全部关系放在一页会成为不可读的线团。",
            "business_date 是地点业务事实常用的统一经营日期字段，不代表必须先建立日期维表才能写事实。",
            "Outbox、迁移日志和审计日志故意不以多态 FK 连接所有业务表。",
        ],
        "mode": "detail",
    },
    "foundation-rel-p5-identity": {
        "summary": "先建立地点、产品、人员、雇佣和原料的稳定身份，再把各来源的外部 ID 映射进来。",
        "read": [
            "ops_location 同时覆盖门店、中央厨房、仓库和办公室；location_type 区分地点类型。",
            "企业产品由 ops_product 定义；POS 中的门店商品只保存在 pos_product_listing 并映射到 product_id。",
            "hr_person 表示自然人，hr_employment 表示一次雇佣关系；同一人重新入职可以产生新的 employment_id。",
        ],
        "confusions": [
            "source_identity 表保存外部系统 ID 到稳定 ID 的映射，不是第二套主数据。",
            "mapping_review 表是无法自动唯一匹配时的人工审核队列，不能猜填。",
            "schema_migrations 和 app_audit_log 属于治理记录，不是经营事实。",
        ],
        "mode": "detail",
    },
    "foundation-rel-p6-pos": {
        "summary": "POS 先保留抓取批次，再保存稳定可得的聚合销售事实；订单级表只有稳定来源 ID 时才启用。",
        "read": [
            "pos_ingest_batch 记录一次抓取的来源窗口、校验值、解析版本和状态。",
            "日销售、商品时段销售和报废是不同粒度，不能互相覆盖。",
            "订单、订单行、支付和退款需要可跨重跑识别的来源 ID，否则只保留可靠聚合事实。",
        ],
        "confusions": [
            "CONDITIONAL 不是“以后一定建”，而是先满足稳定来源 ID 门禁。",
            "location_id 必须指向 STORE 类型地点；中央厨房和仓库不能产生 POS 销售事实。",
            "v_pos_* 是只读标准口径，不是新的事实写入口。",
        ],
        "mode": "detail",
    },
    "foundation-rel-p7-ops-plan": {
        "summary": "节假日和突发因素进入预测，预测形成预估单；预估单通过版本和调整动作保留完整决策历史。",
        "read": [
            "节假日 API 自动抓取并记录批次；突发情况及影响范围由人工确认并保留证据。",
            "forecast_run 表示一次预测运行，forecast_line 保存地点、产品、日期等粒度的预测结果。",
            "production_plan 是计划身份，version 是版本头，line 是产品总量，slot 是时段拆分。",
        ],
        "confusions": [
            "预测值不是已批准计划；只有已发布的计划版本才允许驱动排产、班表和订货。",
            "调整不能覆盖旧版本；必须保留增减量、原因、操作者和前后版本。",
            "明日计划中的人工录入主要是判断与调整原因，不是重复手抄节假日或历史销售。",
        ],
        "mode": "detail",
    },
    "foundation-rel-p8-ops-execution": {
        "summary": "实际产出和地点间配送分别记录，再通过只读视图比较计划、产出、配送与销售。",
        "read": [
            "production_output 记录一次生产执行批次，line 保存每种产品的实际数量。",
            "dispatch 记录发出地点、接收地点和配送批次，line 保存产品数量。",
            "复盘视图只计算差异，不把比较结果反写为新的权威事实。",
        ],
        "confusions": [
            "计划、实际产出、配送和销售是四种事实，数量相同也不能合并成同一行。",
            "产品占比升降是从销售事实计算出的观察，不是人工维护的产品属性。",
            "配送的 from_location_id 与 to_location_id 都指向统一地点身份。",
        ],
        "mode": "detail",
    },
    "foundation-rel-p9-hr": {
        "summary": "从申请与招聘评分，经 Offer 和入职任务，连接到培训课程版本、培训指派和培训结果。",
        "read": [
            "hr_application 表示自然人对某个招聘需求的一次申请；它不等于已经入职。",
            "assessment 与 item_score 分开，避免把多个评分项目塞进一列或覆盖历史。",
            "课程主数据、课程版本、培训指派和培训结果各保留自己的粒度。",
        ],
        "confusions": [
            "person_id 是自然人，employment_id 是雇佣关系；班表、工时和培训资格通常连接 employment_id。",
            "Offer、入职任务和培训结果不是员工表上的几个状态字段。",
            "培训结果只能引用当时生效的课程版本，不能被新课程内容追溯覆盖。",
        ],
        "mode": "detail",
    },
    "foundation-rel-p10-shift": {
        "summary": "岗位和工位定义资格要求；班表按版本保存需求与员工指派，实际工时从 Lark 批次同步。",
        "read": [
            "role 表示岗位职责，station 表示实际工位；关键岗位要求写在 shift_requirement。",
            "shift_plan 是班表身份，version 是可审核版本，requirement 是需求，assignment 是员工指派。",
            "timesheet_sync_batch 保留同步证据，timesheet_entry 保存员工每日实际工时。",
        ],
        "confusions": [
            "班表需求不是员工指派：先说明需要什么岗位和人数，再安排具体员工。",
            "员工未满足必修培训或关键岗位缺人时，班表版本不能发布。",
            "计划工时与实际工时必须分开，才能计算缺勤、加班和人效。",
        ],
        "mode": "detail",
    },
    "foundation-rel-p11-scm": {
        "summary": "已发布计划和生效配方形成原料需求，再结合库存与在途形成补货建议、PO、收货和实价。",
        "read": [
            "supplier_item 表示供应商 SKU；必须经 mapping_review 映射到统一 material_id。",
            "requirement_run/line 保存一次需求计算及每种原料数量，replenishment 保存建议量与批准量。",
            "purchase_order、revision、line 与 goods_receipt、line 分开保存下单和收货历史。",
        ],
        "confusions": [
            "建议订货量、批准订货量、PO 数量和实收数量不是同一个字段。",
            "库存快照是某时点观察，不是所有库存变动的完整流水账。",
            "收货实价进入 price_observation 后仍要经过生效期和质量检查，才能用于成本。",
        ],
        "mode": "detail",
    },
    "foundation-rel-p12-cost": {
        "summary": "统一原料通过类型化桥接连接成本卡对象；配方版本和生效采购价共同冻结为当日产品成本快照。",
        "read": [
            "scm_material 是供应链原料身份，cost_card_item 是成本计算对象，两者通过 cost_card_material_link 显式映射。",
            "recipe 与 recipe_item 保存配方版本及原料用量；item_price 保存有效期内的成本价格。",
            "product_cost_snapshot 冻结产品、地点、日期和成本版本，component 保留每个原料组成。",
        ],
        "confusions": [
            "历史配方和历史价格不能被新值覆盖，否则无法重算当日真实成本。",
            "成本快照缺少配方或采购价覆盖时，毛利必须标记为 ESTIMATED 或不完整。",
            "product_id 通过 cost_card_product_link 连接成本卡成品，不能按名称猜关联。",
        ],
        "mode": "detail",
    },
    "foundation-rel-p13-integration": {
        "summary": "每个域把已提交的业务变化写入本域 Outbox；统一索引只读合并关系、时间线和事件。",
        "read": [
            "事实与 Outbox 事件在同一事务提交，避免事实成功但事件丢失。",
            "event_type 说明发生什么，aggregate_id 指向本域对象，causation_id 说明由什么动作触发。",
            "统一关系索引、业务时间线和事件流只用于查询与联动，不成为新的写入口。",
        ],
        "confusions": [
            "Outbox 不是永久业务主表；它是可靠发布变更事件的传输边界。",
            "payload_version 是事件载荷格式版本，不是业务计划版本。",
            "跨域联动通过订阅事件或受控接口完成，不能直接修改其他域表。",
        ],
        "mode": "detail",
    },
    "foundation-rel-p14-finance": {
        "summary": "四条只读核对链分别比较销售、采购、人工和毛利的业务事实与财务入账口径。",
        "read": [
            "销售核对比较 POS 净销售与财务销售；采购核对比较收货与财务采购。",
            "人工核对比较班表、实际工时和财务人工成本；毛利核对汇总销售与成本差异。",
            "每条核对都要输出来源覆盖、差异和状态，不能只给一个看似精确的总数。",
        ],
        "confusions": [
            "核对视图不改变 finance_*、pos_*、scm_* 或 hr_* 的权威写入边界。",
            "差异不一定等于错误，可能来自时间边界、未入账、退款、税费或覆盖不足。",
            "只有来源完整且口径对齐时，毛利率才能被视为已确认值。",
        ],
        "mode": "detail",
    },
    "foundation-rel-p15-e2e": {
        "summary": "以一个产品为例，把预测、预估单、配方、订货、收货价格、成本、销售、班表和财务核对串成完整链路。",
        "read": [
            "沿蓝色箭头读取业务因果流；箭头标签说明传递的是哪个 ID、数量或口径。",
            "自动录入包括 POS、节假日、Lark 工时和算法计算；人工确认集中在判断、审批、异常和原因。",
            "写入边界框说明每个代码库可以写哪些域，其他联动通过 FK、视图和事件完成。",
        ],
        "confusions": [
            "端到端图展示的是连接方法，不表示要建立一张覆盖全部步骤的超级宽表。",
            "身份无法唯一映射、订单缺稳定 ID、成本来源缺失或关键岗位资格不满足时必须进入审核队列。",
            "product_id 和 location_id 是贯穿链路的线索，但每种业务事实仍保留自己的粒度和版本。",
        ],
        "mode": "detail",
    },
}


CONCEPT_COLORS = [
    ("#F3F4F6", "灰色虚线", "外部来源或尚未确定的未来模块；不是本库当前权威事实。"),
    ("#FFEDD5", "橙色", "来源批次、外部身份映射、人工或系统接入步骤。"),
    ("#DBEAFE", "蓝色", "稳定身份、共享锚点和跨模块连接契约。"),
    ("#DCFCE7", "绿色", "POS 事实域；在验收框中也可表示通过或成功状态。"),
    ("#E0F2FE", "浅蓝色", "营运预测、计划或不可变经营事实。"),
    ("#F3E8FF", "紫色", "人事、雇佣、培训与工时域。"),
    ("#FEF3C7", "琥珀色", "供应链、库存、订货和收货域。"),
    ("#FEE2E2", "红色", "成本、财务或需要重点关注的边界。"),
    ("#EDE9FE", "淡紫色", "关系桥、契约视图、统一索引等只读服务层。"),
    ("#FEF9C3", "黄色", "版本、因果关系与 Outbox 事件。"),
    ("#ECFCCB", "黄绿色", "使用数据的应用、报表、AI 或后续能力。"),
    ("#FFF1F2", "粉红色", "禁止事项、发布门禁或必须停下审核的情况。"),
]


DETAIL_COLORS = [
    ("#F5F6F8", "灰色｜治理", "迁移、审计、写入边界和其他治理对象。"),
    ("#EAF2FF", "浅蓝｜共享身份", "地点、产品、人员、雇佣、原料身份及统一读取。"),
    ("#E6F7F6", "青绿｜POS", "销售、商品时段、报废、订单、支付和退款事实。"),
    ("#FFF1E8", "橙色｜营运", "预测、预估单、计划调整、生产执行和配送。"),
    ("#F3EDFA", "紫色｜人事", "招聘、Offer、入职、培训、班表和实际工时。"),
    ("#EAF7EE", "绿色｜供应链", "供应商、原料需求、库存、补货、PO、收货和实价。"),
    ("#FFF7DD", "黄色｜成本卡", "成本对象、配方、价格、成本快照与成本质量。"),
    ("#FDECEC", "红色｜财务", "销售、采购、人工和毛利的财务核对视图。"),
    ("#FFFDF3", "折角便签", "读图规则、范围边界或不能忽略的说明。"),
    ("#F8FAFC", "灰色虚线 REF", "本页只放引用；完整表或视图定义在其他分组或页面。"),
]


SHAPE_NOTES = [
    "大号淡色边框：页面内的阅读分组，不是数据库表，也不表示独立 schema。",
    "方角表框：可写物理表；框内依次显示状态、粒度、字段、类型和写入者。",
    "同域颜色的圆角虚线框：[VIEW] 只读派生视图，不允许作为权威事实写入口。",
    "红色虚线表框：[CONDITIONAL] 条件表，来源没有稳定外部 ID 时不创建。",
    "灰色虚线 REF 框：跨页引用或外部依赖；点击可跳到本图中的完整定义。",
    "深蓝色框：页面标题、稳定身份脊柱或需要优先阅读的共同连接点。",
]


LINE_NOTES = [
    "灰色鸡爪实线：必填 FK；多行事实连接到一个被引用对象。",
    "灰色鸡爪虚线：可空 FK（FK?）；关系尚未确定或业务上允许缺失。",
    "金色虚线箭头：只读视图或外部来源的读取血缘，不表示写入。",
    "蓝色实心箭头：业务流程、因果或数据传递方向，不等同于数据库 FK。",
    "箭头文字：说明用于连接的字段、传递的数量或读取动作。",
]


TERMS = [
    ("PK", "Primary Key，表内每一行的唯一主键。"),
    ("FK / FK?", "Foreign Key，连接另一张表的主键；问号表示该关系允许为空。"),
    ("UQ / UQ?", "唯一约束；问号表示只在值存在时要求唯一。"),
    ("粒度", "一行数据究竟代表什么。不同粒度的事实不能直接揉在一张表里。"),
    ("稳定 ID", "企业内部长期使用的 UUID，不随名称、门店编码或外部系统改名而改变。"),
    ("location_id", "统一地点身份，可指门店、中央厨房、仓库或办公室；location_type 区分类型。"),
    ("product_id", "HOT CRUSH 企业产品身份；各门店 POS 商品通过映射连接到它。"),
    ("person_id", "自然人身份；同一个人跨申请或重新入职时保持可识别。"),
    ("employment_id", "一次雇佣关系身份；班表、工时和岗位资格通常连接它。"),
    ("material_id", "供应商、配方、库存和采购共同使用的统一原料身份。"),
    ("business_date", "按地点时区确定的经营日期，用于事实表的统一查询和组合索引。"),
    ("business_day_id", "地点 × 日期 × 时区边界的经营日身份；需要显式经营日对象时使用。"),
    ("source_system / external_id", "数据来自哪个系统，以及该系统中的原始对象 ID。"),
    ("source_batch_id", "一次抓取、导入或同步批次的身份，用于追溯和安全重跑。"),
    ("checksum / hash", "原始内容摘要，用来判断文件或响应是否变化、是否重复。"),
    ("parser_version", "把外部原始数据解析成结构化字段时使用的解析规则版本。"),
    ("mapping_status / evidence", "身份映射是否确认，以及支持该判断的来源证据。"),
    ("run / batch", "一次计算或执行批次；相同业务日期可以因为重跑产生多个 run。"),
    ("version / revision", "计划、规则、配方或 PO 的历史版本；发布后不原地覆盖。"),
    ("effective period", "记录的生效起止时间；用于选择当时真正有效的价格、配方或映射。"),
    ("occurred_at / recorded_at", "事件实际发生时间与系统记录时间；两者可能不同。"),
    ("causation_id", "说明这条事件或动作由哪个计划、请求或上一事件触发。"),
    ("correction_of_id", "指向被更正的旧事实；通过追加更正保留审计历史。"),
    ("Outbox", "与业务事实同事务写入的待发布事件，确保跨模块通知不丢失。"),
    ("契约视图", "向消费者提供稳定列名、粒度和质量状态的只读接口。"),
    ("lineage / 血缘", "说明一个视图或指标读取了哪些来源表和视图。"),
    ("coverage", "计算所需来源的覆盖比例；不足时结果必须显示估算或不完整。"),
    ("RLS", "Row Level Security，按用户或角色限制可读取和修改的数据行。"),
    ("幂等", "同一批次或同一请求重复执行，不会重复生成业务事实。"),
    ("UUID", "全局唯一标识类型，适合跨系统稳定身份。"),
    ("numeric", "精确十进制数，适合金额、价格、数量和比例，避免浮点误差。"),
    ("timestamptz", "带时区语义的时间点，适合事件发生和记录时间。"),
    ("JSONB", "结构化 JSON；这里只用于原始快照、证据或低频扩展，不承载核心 FK。"),
    ("mart", "面向特定报表或分析的派生数据集，不能反向成为权威事实入口。"),
]


def page_id_for(object_page: str) -> str:
    return bp.p.PAGE_INFO[object_page][0]


def table_note(entity):
    fields = []
    connections = []
    for column in entity.columns:
        fields.append({
            "marker": column.marker or "字段",
            "name": column.name,
            "type": column.data_type,
            "ref": column.ref,
            "optional": bool(column.optional or column.marker.endswith("?")),
        })
        if column.ref:
            requirement = "可空" if column.optional or column.marker.endswith("?") else "必填"
            connections.append(f"{column.name} → {column.ref}（{requirement}）")
    return {
        "kind": "物理表",
        "name": entity.name,
        "group": entity.group,
        "purpose": bp.TABLE_PURPOSES[entity.name],
        "grain": entity.grain,
        "writer": entity.writer,
        "status": entity.status,
        "statusNote": STATUS_NOTES[entity.status],
        "fields": fields,
        "connections": connections,
    }


def view_note(view):
    return {
        "kind": "只读视图",
        "name": view.name,
        "group": view.group,
        "purpose": VIEW_PURPOSES[view.name],
        "grain": view.grain,
        "writer": "只读派生；由来源事实计算，不作为写入口",
        "status": "VIEW",
        "statusNote": "只读口径或核对结果；权威事实仍由来源域保存。",
        "fields": [{"marker": "输出", "name": column, "type": "", "ref": None, "optional": False}
                   for column in view.columns],
        "connections": [f"读取 {name}" for name in view.lineage],
    }


def build_payload() -> dict:
    if set(VIEW_PURPOSES) != set(bp.p.VIEW_BY_NAME):
        missing = sorted(set(bp.p.VIEW_BY_NAME) - set(VIEW_PURPOSES))
        extra = sorted(set(VIEW_PURPOSES) - set(bp.p.VIEW_BY_NAME))
        raise AssertionError(f"view purpose coverage mismatch; missing={missing}, extra={extra}")

    objects: dict[str, list[dict]] = {page_id: [] for page_id in PAGE_NOTES}
    all_tables = []
    for entity in bp.entities:
        note = table_note(entity)
        all_tables.append(note)
        objects[page_id_for(entity.page)].append(note)
    for view in bp.views:
        objects[page_id_for(view.page)].append(view_note(view))
    objects["foundation-table-map"] = sorted(all_tables, key=lambda item: (item["group"], item["name"]))

    diagram_ids = [
        "hotcrush-foundation-1",
        "hotcrush-foundation-2",
        "hotcrush-foundation-3",
        *[bp.p.PAGE_INFO[page][0] for page in ("pt", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "pi", "p10", "p11")],
    ]
    if set(diagram_ids) != set(PAGE_NOTES):
        raise AssertionError("page notes must cover every diagram page exactly once")
    if len(all_tables) != 82 or sum(len(items) for key, items in objects.items() if key != "foundation-table-map") != 101:
        raise AssertionError("expected 82 tables and 19 views across detail pages")

    pages = {}
    for page_id in diagram_ids:
        page = dict(PAGE_NOTES[page_id])
        page["objects"] = sorted(objects[page_id], key=lambda item: (item["group"], item["kind"], item["name"]))
        page["colors"] = CONCEPT_COLORS if page["mode"] == "concept" else DETAIL_COLORS
        pages[page_id] = page
    return {
        "boundary": "这是未来目标数据基座评审稿，不是当前生产数据库实况；备注解释设计语义，不证明对象已经实施。",
        "pages": pages,
        "shapes": SHAPE_NOTES,
        "lines": LINE_NOTES,
        "terms": [{"term": term, "definition": definition} for term, definition in TERMS],
    }


NOTES_CSS = r"""
/* HOTCRUSH_REVIEW_NOTES_CSS_START */
#workspace{flex:1;min-height:0;display:flex;position:relative}
#stage{min-width:0}
#notes-panel{width:min(430px,38vw);min-width:340px;overflow-y:auto;border-left:1px solid #d8dee7;
background:#f8fafc;color:#172033;padding:18px 18px 28px;box-shadow:-8px 0 24px #0f172a10}
.notes-head{display:flex;align-items:flex-start;gap:12px;position:sticky;top:-18px;z-index:3;
background:#f8fafcf2;backdrop-filter:blur(10px);padding:18px 0 12px;border-bottom:1px solid #d8dee7}
.notes-head-main{min-width:0;flex:1}.notes-kicker{font-size:11px;letter-spacing:.12em;color:#64748b;font-weight:700}
#notes-title{font-size:18px;line-height:1.3;margin:4px 0 0}.icon-btn{border:1px solid #cbd5e1;background:#fff;
border-radius:9px;width:32px;height:32px;cursor:pointer;font-size:18px;line-height:1}
.notes-boundary{margin:14px 0;padding:11px 12px;border-left:4px solid #b88916;background:#fff7dd;
color:#5f4b12;border-radius:8px;font-size:12px}.notes-summary{font-size:14px;line-height:1.65;margin:0 0 14px}
#notes-filter{width:100%;border:1px solid #cbd5e1;background:#fff;color:inherit;border-radius:9px;
padding:8px 10px;margin:0 0 12px}.note-section{border:1px solid #dbe2ea;border-radius:10px;background:#fff;margin:10px 0}
.note-section>summary{cursor:pointer;font-weight:700;padding:11px 12px;list-style:none;display:flex;justify-content:space-between;gap:8px}
.note-section>summary::-webkit-details-marker{display:none}.note-section>summary:after{content:'＋';color:#64748b}
.note-section[open]>summary:after{content:'−'}.note-body{padding:0 12px 12px}.note-body ul{margin:0;padding-left:19px}
.note-body li{margin:6px 0;line-height:1.55}.warning-list{color:#7c2d12}.legend-grid{display:grid;grid-template-columns:1fr;gap:7px}
.legend-row{display:grid;grid-template-columns:22px 105px 1fr;gap:8px;align-items:start;font-size:12px;line-height:1.45}
.swatch{width:20px;height:20px;border:1px solid #94a3b8;border-radius:5px}.legend-label{font-weight:700}
.object-card,.term-card{border-top:1px solid #e2e8f0;padding:0}.object-card:first-child,.term-card:first-child{border-top:0}
.object-card>summary,.term-card>summary{cursor:pointer;padding:9px 0;list-style:none}.object-card>summary::-webkit-details-marker,
.term-card>summary::-webkit-details-marker{display:none}.object-title{display:flex;align-items:flex-start;gap:7px;line-height:1.4}
.kind-badge{font-size:10px;font-weight:700;color:#475569;background:#eef2f7;border-radius:999px;padding:2px 6px;white-space:nowrap}
.object-purpose{display:block;color:#475569;font-size:12px;margin-top:3px}.object-detail{padding:0 0 12px 0;font-size:12px;line-height:1.55}
.object-detail p{margin:6px 0}.object-detail code,.term-card code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
font-size:11px;background:#f1f5f9;border-radius:4px;padding:1px 4px}.field-list{margin:5px 0 0!important;padding-left:18px!important}
.field-list li{margin:3px 0}.status-line{padding:7px 8px;background:#f8fafc;border-radius:7px}.empty-note{color:#64748b;font-style:italic}
body.notes-closed #notes-panel{display:none}#notes-toggle.on{border-color:#0d99ff;color:#0d99ff;font-weight:700}
@media(prefers-color-scheme:dark){#notes-panel{background:#191e24;color:#edf2f7;border-color:#39414b}
.notes-head{background:#191e24f2;border-color:#39414b}.icon-btn,#notes-filter,.note-section{background:#222831;border-color:#3c4652}
.notes-boundary{background:#3b3217;color:#f8e6a0}.object-card,.term-card{border-color:#39414b}.object-purpose{color:#b8c4d1}
.kind-badge,.object-detail code,.term-card code,.status-line{background:#2c3440;color:#d8e1ea}}
@media(max-width:900px){#notes-panel{position:absolute;right:0;top:0;bottom:0;z-index:10;width:min(92vw,430px);min-width:0}
body:not(.notes-closed) #stage:after{content:'';position:absolute;inset:0;background:#0f172a2b;pointer-events:none}}
/* HOTCRUSH_REVIEW_NOTES_CSS_END */
"""


NOTES_PANEL = r"""
<!-- HOTCRUSH_REVIEW_NOTES_PANEL_START -->
<aside id="notes-panel" aria-label="数据库蓝图详细说明">
  <div class="notes-head">
    <div class="notes-head-main"><div class="notes-kicker">当前页详细备注</div><h2 id="notes-title"></h2></div>
    <button id="notes-close" class="icon-btn" type="button" aria-label="收起说明">×</button>
  </div>
  <div class="notes-boundary" id="notes-boundary"></div>
  <p class="notes-summary" id="notes-summary"></p>
  <input id="notes-filter" type="search" placeholder="搜索备注、表名、字段或术语">
  <div id="notes-content"></div>
</aside>
<!-- HOTCRUSH_REVIEW_NOTES_PANEL_END -->
"""


NOTES_JS = r"""
// HOTCRUSH_REVIEW_NOTES_JS_START
const REVIEW_NOTES=__PAYLOAD__;
const notesTitle=document.getElementById('notes-title');
const notesSummary=document.getElementById('notes-summary');
const notesBoundary=document.getElementById('notes-boundary');
const notesContent=document.getElementById('notes-content');
const notesFilter=document.getElementById('notes-filter');
const notesToggle=document.getElementById('notes-toggle');
const notesClose=document.getElementById('notes-close');
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function listHtml(items,cls=''){return `<ul class="${cls}">${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;}
function section(title,body,count='',open=true){return `<details class="note-section" ${open?'open':''}><summary><span>${esc(title)}</span><span>${esc(count)}</span></summary><div class="note-body">${body}</div></details>`;}
function legendHtml(items){return `<div class="legend-grid">${items.map(x=>`<div class="legend-row" data-note-search="${esc(x.join(' '))}"><span class="swatch" style="background:${esc(x[0])}"></span><span class="legend-label">${esc(x[1])}</span><span>${esc(x[2])}</span></div>`).join('')}</div>`;}
function objectHtml(item){
  const fields=item.fields.map(f=>`<li><code>${esc(f.marker)}</code> <b>${esc(f.name)}</b>${f.type?`：${esc(f.type)}`:''}${f.ref?` → <code>${esc(f.ref)}</code>`:''}${f.optional?'（可空）':''}</li>`).join('');
  const connections=item.connections.length?listHtml(item.connections):'<p class="empty-note">没有直接业务 FK；它可能是日志、Outbox 或独立治理记录。</p>';
  const search=[item.name,item.group,item.purpose,item.grain,item.writer,item.status,...item.connections,...item.fields.map(f=>`${f.marker} ${f.name} ${f.type} ${f.ref||''}`)].join(' ');
  return `<details class="object-card" data-note-search="${esc(search)}"><summary><span class="object-title"><span class="kind-badge">${esc(item.kind)}</span><span><code>${esc(item.name)}</code><span class="object-purpose">${esc(item.purpose)}</span></span></span></summary><div class="object-detail"><p><b>所在板块：</b>${esc(item.group)}</p><p><b>一行代表：</b>${esc(item.grain)}</p><p><b>写入边界：</b>${esc(item.writer)}</p><p class="status-line"><b>${esc(item.status)}：</b>${esc(item.statusNote)}</p><p><b>字段说明：</b></p><ul class="field-list">${fields}</ul><p><b>连接关系：</b></p>${connections}</div></details>`;
}
function termHtml(item){return `<details class="term-card" data-note-search="${esc(item.term+' '+item.definition)}"><summary><code>${esc(item.term)}</code></summary><div class="object-detail">${esc(item.definition)}</div></details>`;}
function applyNoteFilter(){const t=notesFilter.value.trim().toLowerCase();document.querySelectorAll('#notes-content [data-note-search]').forEach(el=>{el.hidden=!!t&&!el.dataset.noteSearch.toLowerCase().includes(t);});}
function renderNotes(i){
  const meta=META[i],page=REVIEW_NOTES.pages[meta.id];if(!page)return;
  notesTitle.textContent=meta.name;notesBoundary.textContent=REVIEW_NOTES.boundary;notesSummary.textContent=page.summary;notesFilter.value='';
  const objects=page.objects||[];
  notesContent.innerHTML=section('本页怎么读',listHtml(page.read),'',true)
    +section('容易误解的地方',listHtml(page.confusions,'warning-list'),'',true)
    +section('颜色代表什么板块',legendHtml(page.colors),`${page.colors.length} 类`,true)
    +section('框形与边框代表什么',listHtml(REVIEW_NOTES.shapes),`${REVIEW_NOTES.shapes.length} 条`,false)
    +section('箭头与连线怎么读',listHtml(REVIEW_NOTES.lines),`${REVIEW_NOTES.lines.length} 条`,false)
    +(objects.length?section('本页对象详细备注',objects.map(objectHtml).join(''),`${objects.length} 个`,true):'')
    +section('数据库术语词典',REVIEW_NOTES.terms.map(termHtml).join(''),`${REVIEW_NOTES.terms.length} 个`,false);
  applyNoteFilter();
}
function setNotes(open){document.body.classList.toggle('notes-closed',!open);notesToggle.classList.toggle('on',open);notesToggle.setAttribute('aria-expanded',String(open));setTimeout(fit,0);}
notesToggle.onclick=()=>setNotes(document.body.classList.contains('notes-closed'));
notesClose.onclick=()=>setNotes(false);
notesFilter.addEventListener('input',applyNoteFilter);
setNotes(true);
// HOTCRUSH_REVIEW_NOTES_JS_END
"""


def inject_notes(base_html: str, payload: dict) -> str:
    required = ["</style>", '<main id="stage">', "</main>\n<script>", "show(0);\n</script>"]
    missing = [marker for marker in required if marker not in base_html]
    if missing:
        raise RuntimeError(f"drawiohtml template changed; missing markers: {missing}")

    result = base_html.replace('<html lang="en">', '<html lang="zh-CN">', 1)
    result = result.replace("Search nodes… Enter = next", "搜索图中表名或字段，Enter 跳到下一项", 1)
    result = result.replace('<button id="fit">Fit</button>',
                            '<button id="fit">适合窗口</button>\n <button id="notes-toggle" type="button" aria-expanded="true">说明</button>', 1)
    result = result.replace("</style>", NOTES_CSS + "\n</style>", 1)
    result = result.replace('<main id="stage">', '<div id="workspace">\n<main id="stage">', 1)
    result = result.replace("</main>\n<script>", f"</main>\n{NOTES_PANEL}\n</div>\n<script>", 1)
    result = result.replace("  search();}", "  search();renderNotes(i);}", 1)
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    notes_js = NOTES_JS.replace("__PAYLOAD__", payload_json)
    result = result.replace("show(0);\n</script>", notes_js + "\nshow(0);\n</script>", 1)
    return result


def main() -> None:
    if not DRAWIO_SOURCE.exists():
        raise SystemExit(f"missing Draw.io source: {DRAWIO_SOURCE}")
    if not DRAWIO_HTML.exists():
        raise SystemExit(f"missing drawiohtml helper: {DRAWIO_HTML}")

    subprocess.run(
        [sys.executable, str(DRAWIO_HTML), str(DRAWIO_SOURCE), "-o", str(HTML_OUTPUT)],
        check=True,
    )
    payload = build_payload()
    base_html = HTML_OUTPUT.read_text(encoding="utf-8")
    annotated = inject_notes(base_html, payload)
    HTML_OUTPUT.write_text(annotated, encoding="utf-8")
    print(
        f"wrote {HTML_OUTPUT} with {len(payload['pages'])} page notes, "
        f"82 table notes, {len(VIEW_PURPOSES)} view notes, and {len(TERMS)} glossary terms"
    )


if __name__ == "__main__":
    main()
