#!/usr/bin/env python3
"""Build the review-only HOT CRUSH foundation plus table-level ERD.

This generator deliberately does not emit SQL.  It reuses the earlier physical
ERD metadata as a draft inventory, then corrects the cross-domain identity
spine so stores, kitchens, and warehouses share one location identity and SCM
materials are not owned by the cost-card domain.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from html import escape
import importlib.util
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent
CONCEPT_SOURCE = ROOT / "HOTCRUSH可扩展数据基座蓝图.drawio"
PHYSICAL_GENERATOR = ROOT / "build_future_physical_erd.py"
OUTPUT = ROOT / "HOTCRUSH可扩展数据基座与表关系评审稿.drawio"


def load_physical_module():
    spec = importlib.util.spec_from_file_location("hotcrush_physical_draft", PHYSICAL_GENERATOR)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {PHYSICAL_GENERATOR}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


p = load_physical_module()


NAME_MAP = {
    "ops_store": "ops_location",
    "ops_store_source_identity": "ops_location_source_identity",
    "pos_sellable_product": "ops_product",
    "pos_product": "pos_product_listing",
    "applications": "hr_application",
}


def map_name(value: str) -> str:
    return NAME_MAP.get(value, value)


def map_text(value: str) -> str:
    replacements = (
        ("ops_store_source_identity", "ops_location_source_identity"),
        ("pos_sellable_product", "ops_product"),
        ("pos_product", "pos_product_listing"),
        ("ops_store", "ops_location"),
        ("store_id", "location_id"),
        ("store_code", "location_code"),
        ("store_name", "location_name"),
    )
    for old, new in replacements:
        value = value.replace(old, new)
    return value


def transform_column(entity, column):
    name = map_text(column.name)
    ref = map_name(column.ref) if column.ref else None
    data_type = map_text(column.data_type)

    # SCM owns the canonical material identity.  Cost-card items remain
    # costing objects and are connected through an explicit typed bridge.
    if entity.domain == "scm" and column.ref == "cost_card_item" and "material" in column.name:
        ref = "scm_material"
    return p.Column(column.marker, name, data_type, ref, column.optional)


def transform_entity(entity):
    name = map_name(entity.name)
    columns = [transform_column(entity, column) for column in entity.columns]

    if entity.name == "ops_store":
        columns = [
            p.C("PK", "location_id", "uuid"),
            p.C("FK?", "parent_location_id", "uuid", "ops_location", True),
            p.C("UQ", "location_code", "text"),
            p.C("", "location_name", "text"),
            p.C("", "location_type", "text: STORE / KITCHEN / WAREHOUSE / OFFICE"),
            p.C("", "timezone", "text"),
            p.C("", "status", "text"),
        ]
    elif entity.name == "pos_sellable_product":
        columns = [
            p.C("PK", "product_id", "uuid"),
            p.C("UQ", "product_code", "text"),
            p.C("", "canonical_name", "text"),
            p.C("", "product_type", "text: SELLABLE / PRODUCED"),
            p.C("", "category_code", "text"),
            p.C("", "status", "text"),
        ]
    elif entity.name == "cost_card_item":
        columns = [column for column in columns if column.name != "material_id"]
    elif entity.name == "ops_dispatch":
        columns = [column for column in columns if column.name != "location_id"]
        columns.insert(1, p.C("FK", "from_location_id", "uuid", "ops_location"))
        columns.insert(2, p.C("FK", "to_location_id", "uuid", "ops_location"))

    grain = map_text(entity.grain)
    if entity.name == "ops_store":
        grain = "每个门店 / 中央厨房 / 仓库 / 办公地点一行"
    elif entity.name == "ops_dispatch":
        grain = "发出地点 × 接收地点 × 营业日 × 一次配送批次一行"

    return p.Entity(
        name=name,
        page=entity.page,
        group=entity.group,
        domain=entity.domain,
        status=entity.status,
        grain=grain,
        writer=entity.writer,
        columns=tuple(columns),
    )


def transform_view(view):
    lineage = tuple(map_name(item) for item in view.lineage)
    return p.View(
        name=view.name,
        page=view.page,
        group=view.group,
        domain=view.domain,
        grain=map_text(view.grain),
        columns=tuple(map_text(item) for item in view.columns),
        lineage=lineage,
    )


entities = [transform_entity(entity) for entity in p.ENTITIES]
views = [transform_view(view) for view in p.VIEWS]


def entity(name, page, group, domain, status, grain, writer, *columns):
    return p.Entity(name, page, group, domain, status, grain, writer, tuple(columns))


entities.extend(
    [
        entity(
            "scm_material",
            "p2",
            "05 原料身份",
            "scm",
            "NEW",
            "每个跨供应商、配方和库存使用的稳定原料一行",
            "供应链主数据流程",
            p.C("PK", "material_id", "uuid"),
            p.C("UQ", "material_code", "text"),
            p.C("", "canonical_name", "text"),
            p.C("", "base_unit", "text"),
            p.C("", "material_type", "text"),
            p.C("", "status", "text"),
        ),
        entity(
            "scm_material_source_identity",
            "p2",
            "05 原料身份",
            "scm",
            "NEW",
            "来源系统 × 外部原料 ID × 有效期一行",
            "供应链身份映射流程",
            p.C("PK", "material_source_identity_id", "uuid"),
            p.C("FK", "material_id", "uuid", "scm_material"),
            p.C("UQ", "source_system + source_external_id", "text"),
            p.C("", "valid_from / to", "timestamptz"),
            p.C("", "status", "text"),
        ),
        entity(
            "hr_application",
            "p6",
            "00 候选人与申请",
            "hr",
            "NEW",
            "自然人 × 招聘需求 × 一次申请一行",
            "HR / 招聘流程",
            p.C("PK", "application_id", "uuid"),
            p.C("FK?", "person_id", "uuid", "hr_person", True),
            p.C("FK?", "location_id", "uuid", "ops_location", True),
            p.C("", "source_system / source_external_id", "text"),
            p.C("", "status", "text"),
            p.C("", "applied_at", "timestamptz"),
        ),
        entity(
            "cost_card_material_link",
            "p9",
            "01 原料与产品成本身份",
            "cost",
            "NEW",
            "成本卡对象 × 稳定原料 × 有效期一行",
            "财务网站 + 供应链主数据审核",
            p.C("PK", "material_link_id", "uuid"),
            p.C("FK", "cost_card_item_id", "bigint", "cost_card_item"),
            p.C("FK", "material_id", "uuid", "scm_material"),
            p.C("", "valid_from / to", "date"),
            p.C("", "status", "text"),
            p.C("", "evidence", "jsonb"),
        ),
    ]
)


def outbox(domain: str, writer: str):
    return entity(
        f"{domain}_event_outbox",
        "pi",
        f"{domain.upper()} 域事件",
        domain if domain != "cost_card" else "cost",
        "NEW",
        "每次已提交领域变更事件一行",
        writer,
        p.C("PK", "event_id", "uuid"),
        p.C("", "aggregate_type / aggregate_id", "text"),
        p.C("", "event_type / schema_version", "text"),
        p.C("", "occurred_at", "timestamptz"),
        p.C("", "payload", "jsonb"),
        p.C("", "published_at", "timestamptz", optional=True),
    )


entities.extend(
    [
        outbox("pos", "res_api（与 POS 事实同事务）"),
        outbox("ops", "BakeryOps（与 OPS 事实同事务）"),
        outbox("hr", "HR 写入流程（与 HR 事实同事务）"),
        outbox("scm", "供应链流程（与 SCM 事实同事务）"),
        outbox("cost_card", "财务网站（与成本事实同事务）"),
    ]
)


views.extend(
    [
        p.V(
            "v_entity_link_index",
            "pi",
            "统一只读索引",
            "shared",
            "来源身份 × 稳定实体 × 有效期一行",
            ("entity_type, stable_id", "source_system, source_external_id", "valid_from / to, status"),
            (
                "ops_location_source_identity",
                "pos_product_listing",
                "hr_employment_source_identity",
                "scm_material_source_identity",
                "cost_card_product_link",
                "cost_card_material_link",
            ),
        ),
        p.V(
            "v_business_timeline",
            "pi",
            "统一只读索引",
            "shared",
            "location_id × business_date × 业务事件一行",
            ("location_id, business_date", "event_domain, event_type, stable_ids", "occurred_at, source_ref, quality_state"),
            (
                "pos_daily_revenue",
                "ops_operational_event",
                "ops_production_plan_version",
                "ops_production_output",
                "ops_dispatch",
                "ops_shift_plan_version",
                "hr_timesheet_entry",
                "scm_purchase_order_revision",
                "scm_goods_receipt",
                "cost_card_product_cost_snapshot",
            ),
        ),
        p.V(
            "v_domain_event_stream",
            "pi",
            "统一只读索引",
            "shared",
            "领域事件一行",
            ("event_id, domain, event_type", "aggregate_type, aggregate_id", "occurred_at, schema_version, payload"),
            (
                "pos_event_outbox",
                "ops_event_outbox",
                "hr_event_outbox",
                "scm_event_outbox",
                "cost_card_event_outbox",
            ),
        ),
    ]
)


TABLE_PURPOSES = {
    "schema_migrations": "记录并校验数据库迁移版本",
    "app_audit_log": "追踪受控写入和敏感操作",
    "ops_location": "维护门店、厨房、仓库等地点主数据",
    "ops_location_source_identity": "把外部地点 ID 映射到 location_id",
    "ops_product": "维护企业统一产品身份",
    "pos_product_listing": "把各门店 POS 商品映射到 product_id",
    "ops_product_mapping_review": "审核无法自动匹配的商品",
    "hr_person": "维护自然人的稳定身份",
    "hr_employment": "记录人员的每段雇佣关系",
    "hr_employment_source_identity": "把外部员工 ID 映射到 employment_id",
    "hr_identity_mapping_review": "审核无法自动匹配的人员",
    "pos_ingest_batch": "记录每次 POS 抓取或文件导入",
    "pos_daily_revenue": "保存门店每日销售汇总",
    "pos_item_hourly_sales": "保存商品分小时销量和销售额",
    "pos_item_waste": "保存商品报废数量及原因",
    "pos_order": "保存订单头；来源 ID 稳定后启用",
    "pos_order_item": "保存订单中的商品明细",
    "pos_payment": "保存订单支付记录",
    "pos_refund": "保存订单退款记录",
    "ops_calendar_import_batch": "记录每次节假日数据抓取批次",
    "ops_calendar_event": "保存节假日及日历事件",
    "ops_demand_factor_observation": "记录事件对需求影响的观察证据",
    "ops_operational_event": "记录当日突发和运营事件",
    "ops_operational_event_product": "列明运营事件影响的商品",
    "ops_forecast_run": "记录一次需求预测运行",
    "ops_forecast_line": "保存各商品的预测数量",
    "ops_production_plan": "保存地点和日期级生产计划主单",
    "ops_production_plan_version": "保留预估单的版本和发布状态",
    "ops_production_plan_line": "保存预估单中的商品计划数量",
    "ops_production_plan_slot": "拆分商品在各生产时段的数量",
    "ops_plan_adjustment": "记录计划增减、原因和版本变化",
    "ops_production_output": "记录一次实际生产批次",
    "ops_production_output_line": "保存实际产出的商品数量",
    "ops_dispatch": "记录地点之间的一次配送",
    "ops_dispatch_line": "保存配送中的商品数量",
    "hr_assessment": "保存一次候选人评估",
    "hr_assessment_item_score": "保存评估中每个项目的得分",
    "hr_offer": "保存 Offer 版本和状态",
    "hr_onboarding_task": "跟踪员工入职任务完成情况",
    "hr_training_course": "维护培训课程主数据",
    "hr_training_course_version": "保存课程规则和有效版本",
    "hr_training_assignment": "记录员工被指派的培训",
    "hr_training_result": "保存培训考试结果和有效期",
    "ops_role": "维护标准岗位主数据",
    "ops_station": "维护标准工位和工作区域",
    "ops_role_training_requirement": "定义岗位必须完成的课程",
    "ops_shift_plan": "保存地点和日期级班表主单",
    "ops_shift_plan_version": "保留班表版本和发布状态",
    "ops_shift_requirement": "定义时段、岗位、工位和需求人数",
    "ops_shift_assignment": "把合资格员工安排到班次岗位",
    "hr_timesheet_sync_batch": "记录每次 Lark 工时同步批次",
    "hr_timesheet_entry": "保存员工每日实际工时事实",
    "scm_supplier": "维护供应商主数据",
    "scm_supplier_item": "维护供应商 SKU、包装和采购条件",
    "scm_item_mapping_review": "审核供应商商品与原料的映射",
    "scm_material_requirement_run": "记录一次原料需求计算",
    "scm_material_requirement_line": "保存每种原料的需求数量",
    "scm_inventory_snapshot": "保存某时点的原料库存快照",
    "scm_replenishment_run": "记录一次补货建议计算",
    "scm_replenishment_line": "保存建议量、批准量和调整原因",
    "scm_purchase_order": "保存采购订单主单",
    "scm_purchase_order_revision": "保留采购订单的版本和审批状态",
    "scm_purchase_order_line": "保存采购商品、数量和价格",
    "scm_goods_receipt": "记录一次采购收货",
    "scm_goods_receipt_line": "保存实收、拒收和实际价格",
    "scm_supplier_price_observation": "沉淀已确认的市场采购价",
    "cost_card_item": "维护成本卡中的物料和成品对象",
    "cost_card_recipe": "保存成品配方版本",
    "cost_card_recipe_item": "保存配方中的原料组成和用量",
    "cost_card_item_price": "保存原料在有效期内的成本价格",
    "cost_card_product_link": "把企业产品映射到成本卡成品",
    "cost_card_product_cost_snapshot": "冻结产品在某日的单位成本",
    "cost_card_product_cost_snapshot_component": "保存成本快照的原料组成",
    "scm_material": "维护跨供应商、配方和库存的统一原料",
    "scm_material_source_identity": "把外部原料 ID 映射到 material_id",
    "hr_application": "记录候选人对招聘需求的一次申请",
    "cost_card_material_link": "把成本卡对象映射到统一原料",
    "pos_event_outbox": "可靠发布 POS 销售和报废变更事件",
    "ops_event_outbox": "可靠发布营运计划和执行变更事件",
    "hr_event_outbox": "可靠发布人事和培训变更事件",
    "scm_event_outbox": "可靠发布库存、订货和收货变更事件",
    "cost_card_event_outbox": "可靠发布成本和毛利变更事件",
}


p.ENTITIES = entities
p.VIEWS = views
p.TABLE_BY_NAME = {item.name: item for item in entities}
p.VIEW_BY_NAME = {item.name: item for item in views}

p.PAGE_INFO = {
    "pt": ("foundation-table-map", "04｜表级·全部表连接路径总索引", "全部目标表如何沿稳定身份串联"),
    "p2": ("foundation-rel-p5-identity", "05｜表级·稳定身份与治理", "地点、商品、人员与原料身份"),
    "p3": ("foundation-rel-p6-pos", "06｜表级·POS 销售事实", "来源批次、销售粒度与条件明细"),
    "p4": ("foundation-rel-p7-ops-plan", "07｜表级·营运预测与计划", "节假日 / 突发 → 预测 → 预估单版本"),
    "p5": ("foundation-rel-p8-ops-execution", "08｜表级·营运执行与复盘", "实际产出、地点间配送与计划差异"),
    "p6": ("foundation-rel-p9-hr", "09｜表级·人事、入职与培训", "申请 → 评分 → Offer → 入职 → 培训"),
    "p7": ("foundation-rel-p10-shift", "10｜表级·班表、关键岗位与工时", "资格门禁 → 班表版本 → 实际工时"),
    "p8": ("foundation-rel-p11-scm", "11｜表级·供应链与订货", "需求 → 库存 → 补货 → PO → 收货实价"),
    "p9": ("foundation-rel-p12-cost", "12｜表级·成本卡与当日毛利", "类型化映射 → 配方 / 采购价 → 成本快照"),
    "pi": ("foundation-rel-p13-integration", "13｜表级·模块接入与统一读取", "各域 Outbox + 统一只读索引"),
    "p10": ("foundation-rel-p14-finance", "14｜表级·财务核对视图", "销售、采购、人工与毛利四条核对链"),
    "p11": ("foundation-rel-p15-e2e", "15｜表级·端到端关系与写入边界", "目标结构示例与系统责任边界"),
}

p.PAGE_SUBTITLES = {
    "p2": "跨域只认 location_id / product_id / employment_id / material_id；名称只能展示，不能猜连接",
    "p3": "POS 事实只允许 STORE 类型 location_id；订单明细只有来源 ID 稳定时才启用",
    "p4": "计划必须版本化；节假日自动抓取，突发与明日调整由人工确认并留证据",
    "p5": "计划、实际产出、地点间配送、销售是四种不同事实，任何两个都不能互相冒充",
    "p6": "申请、评分、Offer、雇佣、入职任务和培训结果各保留自己的事实粒度",
    "p7": "关键岗位必须写明；未满足培训资格或关键岗位缺人时，班表版本不能发布",
    "p8": "订货量来自计划 × 配方 − 库存 / 在途，并由 PO 版本与实际收货价闭环",
    "p9": "SCM material_id 与 cost-card item 分开；通过类型化桥接后才能计算成本",
    "pi": "每个域只写自己的 Outbox；统一索引和时间线均为只读，不反向成为事实入口",
    "p10": "财务事实保持原写入边界；只通过核对视图比较 POS、SCM、HR 与财务口径",
}

p.PAGE_EXTRA_EDGES = {
    page: tuple(
        (map_name(source), map_name(target), map_text(label), kind)
        for source, target, label, kind in edges
    )
    for page, edges in p.PAGE_EXTRA_EDGES.items()
}


def table_map_graph():
    page_cards = {
        "p2": ("稳定身份与治理", "shared", "拥有 location / product / person / employment / material 身份"),
        "p3": ("POS 销售事实", "pos", "location_id + product_id + batch_id"),
        "p4": ("营运预测与计划", "ops", "location_id + product_id + plan version"),
        "p5": ("营运执行与复盘", "ops", "location_id + product_id + execution batch"),
        "p6": ("人事、入职与培训", "hr", "person_id + employment_id + location_id"),
        "p7": ("班表、关键岗位与工时", "hr", "location_id + employment_id + role / station"),
        "p8": ("供应链与订货", "scm", "location_id + material_id + plan_version_id"),
        "p9": ("成本卡与毛利", "cost", "product_id + material_id + typed cost-card links"),
        "pi": ("模块接入与统一读取", "shared", "stable IDs + domain events + read-only indexes"),
    }
    nodes = [
        p.title_node(
            "pt",
            "82 张目标核心表全部列入目录并附用途；本页看跨域主路径，后续页面看每条 FK",
        ),
        p.node(
            "pt_guide",
            "<b>读图规则</b><br>一张图同时画 82 张表的全部外键必然成为线团，因此本页按域列全表并只画跨域主路径。"
            "<br>后续 10 个分域 ERD 页面展示每张表的 PK、FK、粒度和写入者，没有省略关系。"
            "<br>location_id 覆盖门店 / 厨房 / 仓库；product、employment、material 分属明确主数据域。"
            "<br>schema_migrations、app_audit_log 与各域 Outbox 是治理 / 传输日志，故意不对业务表建立多态 FK。"
            "<br>business_date 是所有地点事实的统一字段与组合索引，不强迫每次写入先依赖日期维表。",
            style=p.NOTE_STYLE,
            width=520,
            height=178,
        ),
        p.node(
            "pt_spine",
            "<b>稳定身份与共同线索脊柱</b><br>location_id · product_id · person_id / employment_id · material_id"
            "<br>business_date · source / batch · version / effective period",
            style=(
                "rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#17324D;strokeColor=#17324D;"
                "fontColor=#FFFFFF;fontSize=13;fontStyle=1;align=center;verticalAlign=middle;strokeWidth=2;"
            ),
            width=520,
            height=94,
        ),
    ]
    for page, (label, domain, relation) in page_cards.items():
        fill, stroke, font = p.DOMAIN_COLORS[domain]
        page_tables = [item for item in entities if item.page == page]
        table_lines = "<br>".join(
            f"• <b>{escape(item.name)}</b> — "
            f"<font color='#475569'>{escape(TABLE_PURPOSES[item.name])}</font>"
            for item in page_tables
        )
        nodes.append(
            p.node(
                f"pt_card_{page}",
                f"<b>{escape(label)}</b> <font color='#64748B'>({len(page_tables)} 表)</font><br>"
                f"<font color='#64748B'>{escape(relation)}</font><br>"
                "<font color='#CBD5E1'>────────────────────</font><br>"
                f"{table_lines}",
                style=(
                    "rounded=1;arcSize=8;whiteSpace=wrap;html=1;align=left;verticalAlign=top;"
                    "spacingLeft=10;spacingRight=10;spacingTop=8;spacingBottom=8;"
                    f"fillColor={fill};strokeColor={stroke};fontColor={font};fontSize=10;strokeWidth=1.8;"
                ),
                width=650,
                height=82 + 21 * len(page_tables),
                link=p.page_link(page),
            )
        )

    edges = [
        p.edge("pt_title", "pt_guide", "", p.INVISIBLE_EDGE),
        p.edge("pt_title", "pt_spine", "", p.INVISIBLE_EDGE),
    ]
    for page, (_, _, relation) in page_cards.items():
        edges.append(p.edge(f"pt_card_{page}", "pt_spine", relation, p.FLOW_EDGE))

    return {
        "direction": "LR",
        "ranksep": 0.8,
        "nodesep": 0.58,
        "nodes": nodes,
        "edges": edges,
    }


def replace_graph_text(graph):
    for item in graph["nodes"]:
        item["label"] = map_text(item.get("label", ""))
    for item in graph["edges"]:
        item["label"] = map_text(item.get("label", ""))
    return graph


def audit_model():
    if len(entities) != 82 or len(p.TABLE_BY_NAME) != 82:
        raise AssertionError(f"expected 82 unique tables, got {len(entities)} / {len(p.TABLE_BY_NAME)}")
    if len(views) != 19 or len(p.VIEW_BY_NAME) != 19:
        raise AssertionError(f"expected 19 unique views, got {len(views)} / {len(p.VIEW_BY_NAME)}")

    table_names = set(p.TABLE_BY_NAME)
    purpose_names = set(TABLE_PURPOSES)
    if purpose_names != table_names:
        raise AssertionError(
            f"table purpose coverage mismatch; missing={sorted(table_names - purpose_names)}, "
            f"extra={sorted(purpose_names - table_names)}"
        )
    if any(not purpose.strip() for purpose in TABLE_PURPOSES.values()):
        raise AssertionError("table purpose descriptions must not be blank")

    known = set(p.TABLE_BY_NAME) | set(p.VIEW_BY_NAME) | set(p.EXTERNAL_REFS)
    for item in entities:
        for column in item.columns:
            if column.ref and column.ref not in known:
                raise AssertionError(f"unknown ref {item.name}.{column.name} -> {column.ref}")
    for view in views:
        missing = set(view.lineage) - known
        if missing:
            raise AssertionError(f"unknown lineage {view.name}: {sorted(missing)}")

    forbidden_tables = {"ops_store", "pos_sellable_product", "pos_product"}
    if forbidden_tables & set(p.TABLE_BY_NAME):
        raise AssertionError(f"legacy identity tables remain: {sorted(forbidden_tables & set(p.TABLE_BY_NAME))}")
    for item in entities:
        for column in item.columns:
            if "store_id" in column.name:
                raise AssertionError(f"store-only key remains: {item.name}.{column.name}")
            if item.domain == "scm" and column.ref == "cost_card_item":
                raise AssertionError(f"SCM still depends on cost-card master: {item.name}.{column.name}")

    incident = defaultdict(int)
    for item in entities:
        for column in item.columns:
            if column.ref in p.TABLE_BY_NAME:
                incident[item.name] += 1
                incident[column.ref] += 1
    intentionally_detached = {
        "schema_migrations",
        "app_audit_log",
        "pos_event_outbox",
        "ops_event_outbox",
        "hr_event_outbox",
        "scm_event_outbox",
        "cost_card_event_outbox",
    }
    detached = {item.name for item in entities if incident[item.name] == 0}
    if detached != intentionally_detached:
        raise AssertionError(f"unexpected detached tables: {sorted(detached ^ intentionally_detached)}")


def render_page(graph, page: str):
    height, positions, edge_points = p.al.layout(p.al.build_dot(graph))
    score = p.al.route_score(graph, height, positions, edge_points)
    cells = p.al.page_cells(graph, height, positions, edge_points, color=False)
    page_id, page_name, _ = p.PAGE_INFO[page]
    return p.al.wrap_page(cells, page_id=page_id, name=page_name), score


def concept_pages():
    root = ET.parse(CONCEPT_SOURCE).getroot()
    pages = root.findall("diagram")
    if len(pages) != 3:
        raise AssertionError(f"expected 3 concept pages, got {len(pages)}")
    return [ET.tostring(page, encoding="unicode") for page in pages]


def main():
    audit_model()
    pages = concept_pages()
    reports = []

    graph = table_map_graph()
    xml, score = render_page(graph, "pt")
    pages.append(xml)
    reports.append(f"{p.PAGE_INFO['pt'][1]}: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges, score={score}")

    for page in ("p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "pi", "p10"):
        graph = p.detail_graph(page)
        xml, score = render_page(graph, page)
        pages.append(xml)
        reports.append(f"{p.PAGE_INFO[page][1]}: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges, score={score}")

    graph = replace_graph_text(p.end_to_end_graph())
    xml, score = render_page(graph, "p11")
    pages.append(xml)
    reports.append(f"{p.PAGE_INFO['p11'][1]}: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges, score={score}")

    modified = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    output = (
        f'<mxfile host="Electron" modified="{modified}" agent="Codex drawio-skill" '
        'version="31.1.5" type="device" compressed="false">\n'
        + "".join(pages)
        + "</mxfile>\n"
    )
    OUTPUT.write_text(output, encoding="utf-8")
    print(f"wrote {OUTPUT}")
    print("audit: 82 target tables, 19 read-only views, 15 pages")
    for report in reports:
        print(report)


if __name__ == "__main__":
    main()
