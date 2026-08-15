#!/usr/bin/env python3
"""Generate the editable multi-page HOT CRUSH Core V1 Draw.io blueprint.

All table nodes, relationship fields, views, project boundaries and fifteen
end-to-end chains come from the same validated model used by the field
dictionary. The generated file is an architecture review artifact, not DDL.
"""

from __future__ import annotations

from collections import Counter, defaultdict
import copy
from html import escape
import importlib.util
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from model.review_content import END_TO_END_CHAINS, IDENTITY_SPINE, PROJECTS  # noqa: E402
from model.target_model import (  # noqa: E402
    DOMAIN_NAMES,
    DOMAIN_ORDER,
    PHASE1_VIEWS,
    EXTENSION_VIEWS,
    SOURCE_CONDITIONAL_VIEWS,
    LIFECYCLE_NAMES,
    MUTATION_POLICY_NAMES,
    TABLES,
    TABLE_BY_NAME,
    VIEWS,
    VIEW_BY_NAME,
    VIEW_READINESS_GOLDEN_COUNTS,
    validate_model,
    view_implementation_tier,
)
from model.storage_audit import AUDIT_BY_TABLE, validate_storage_audit  # noqa: E402
from model.minimal_foundation import (  # noqa: E402
    CORE_BUSINESS_TABLES,
    CORE_PLATFORM_TABLES,
    DERIVED_R5_TABLES,
    EXTENSION_TABLES,
    MERGED_R5_TABLES,
    MODEL_VERSION,
    REMOVED_R5_TABLES,
    SOURCE_CONDITIONAL_TABLES,
    tier_for_table,
)


SKILL = Path.home() / ".codex/skills/drawio-skill"
AUTOLAYOUT_PATH = SKILL / "scripts/autolayout.py"
OUTPUT_DIR = ROOT / "diagrams"
OUTPUT = OUTPUT_DIR / "HOTCRUSH-Core-V1-R6-最小物理基座蓝图.drawio"


def load_autolayout():
    runtime_path = AUTOLAYOUT_PATH
    if not runtime_path.exists():
        runtime_path = ROOT / "tools" / "drawio_autolayout_fallback.py"
    spec = importlib.util.spec_from_file_location("drawio_autolayout", runtime_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {runtime_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


al = load_autolayout()


DOMAIN_COLORS = {
    "app": ("#E8EEF8", "#3B6FB6", "#183A61"),
    "ops": ("#FFF0E6", "#E47A16", "#7A3C00"),
    "pos": ("#E3F6F5", "#249C98", "#155D5A"),
    "hr": ("#F1E9FA", "#8B5FBF", "#56357B"),
    "scm": ("#E8F5E9", "#3A9258", "#225C37"),
    "cost": ("#FFF6D8", "#D49A00", "#765600"),
    "finance": ("#FFE8EA", "#D9534F", "#7F2926"),
    "mkt": ("#FCE8F3", "#C94F8C", "#793052"),
    "msg": ("#E9F2FF", "#4D7FC1", "#294D80"),
    "ai": ("#EEE9FF", "#7057B8", "#423275"),
}


DOMAIN_PAGE = {domain: f"domain-{i:02d}-{domain}" for i, domain in enumerate(DOMAIN_ORDER, 1)}
PAGE_INFO = {
    "overview": ("overview", "00｜总体蓝图", "HOT CRUSH Core V1 数据基座总览"),
    "identity": ("identity-spine", "11｜统一身份与连接脊柱", "跨模块一致性的最小连接脊柱"),
    "projects": ("project-boundaries", "12｜四个项目写入边界", "谁写什么，跨域只通过稳定契约协作"),
}
for i, domain in enumerate(DOMAIN_ORDER, 1):
    PAGE_INFO[domain] = (DOMAIN_PAGE[domain], f"{i:02d}｜{DOMAIN_NAMES[domain]}", f"{domain.upper()} · {DOMAIN_NAMES[domain]}")
for chain in END_TO_END_CHAINS:
    key = f"chain-{chain.number:02d}"
    PAGE_INFO[key] = (f"e2e-{chain.number:02d}", f"E{chain.number:02d}｜{chain.name}", f"端到端 {chain.number:02d} · {chain.name}")


SUBMODULES = (
    ("app-governance", "app", "01A｜迁移、来源、单位、任务、质量与审计",
     ("app_schema_migration", "app_source_system", "app_unit", "app_job_run", "app_audit_event"),
     ("v_identity_mapping_gap", "v_app_data_quality_summary", "v_business_timeline")),
    ("app-access", "app", "01B｜账号、角色、权限与安全令牌",
     ("app_user", "app_role", "app_permission", "app_user_role", "app_role_permission", "app_user_location_scope", "app_session", "app_one_time_token", "app_rate_limit_event"), ()),
    ("ops-identity", "ops", "02A｜地点与企业产品身份",
     ("ops_location", "ops_location_source_identity", "ops_product", "ops_product_alias"), ()),
    ("ops-calendar-event", "ops", "02B｜日历、需求因子与运营事件",
     ("ops_calendar_event", "ops_operational_event", "ops_operational_event_product", "ops_business_rule"),
     ("v_ops_holiday_factor",)),
    ("ops-forecast", "ops", "02C｜预测运行与准确率",
     ("ops_forecast_run", "ops_forecast_line"),
     ("v_ops_forecast_accuracy", "v_ops_timeslot_sales_baseline")),
    ("ops-plan", "ops", "02D｜预估单、计划版本与调整动作",
     ("ops_production_plan_version", "ops_production_plan_line", "ops_production_plan_slot"), ()),
    ("ops-workload-production", "ops", "02E｜工作量与实际生产",
     ("ops_workload_run", "ops_workload_line", "ops_production_run", "ops_production_run_line"),
     ("v_ops_plan_vs_production",)),
    ("ops-dispatch", "ops", "02F｜配送与收货差异",
     ("ops_dispatch", "ops_dispatch_line"), ("v_ops_production_vs_dispatch",)),
    ("ops-review", "ops", "02G｜每日复盘、动作与产品脉冲",
     ("ops_daily_review", "ops_review_action"),
     ("v_ops_daily_review_current", "v_ops_item_daily_pulse", "v_ops_product_mix_daily", "v_ops_manager_sales_reconciliation")),
    ("ops-roles", "ops", "02H｜岗位、工位与培训要求",
     ("ops_role", "ops_station", "ops_role_training_requirement"), ()),
    ("ops-shift", "ops", "02I｜班表版本、关键岗位需求与指派",
     ("ops_shift_plan_version", "ops_shift_requirement", "ops_shift_assignment"),
     ("v_ops_shift_publish_readiness", "v_ops_labor_productivity", "v_ops_shift_by_role")),
    ("pos-ingest-catalog", "pos", "03A｜POS批次与来源Listing",
     ("pos_ingest_batch", "pos_product_listing"), ()),
    ("pos-mapping", "pos", "03B｜Listing到企业产品映射",
     ("pos_product_mapping", "pos_product_mapping_review"),
     ("v_product_identity",)),
    ("pos-sales", "pos", "03C｜日、小时与单品销售事实",
     ("pos_sales_day", "pos_sales_hour", "pos_item_sales_hour", "pos_daily_breakdown"),
     ("v_pos_sales_day_current", "v_pos_sales_hour_current", "v_pos_item_sales_hour_current", "v_pos_daily_breakdown_current", "v_pos_item_sales_day", "v_pos_revenue_reconciliation")),
    ("pos-loss", "pos", "03D｜报废与断货事件",
     ("pos_item_waste", "ops_stockout_event"), ("v_pos_item_waste_current", "v_pos_item_waste_mapped")),
    ("pos-orders", "pos", "03E｜订单最小事实、会员归属、条件支付与退款",
     ("pos_order", "pos_order_item", "pos_payment", "pos_refund"),
     ("v_pos_order_item_current", "v_pos_order_member_attribution", "v_pos_member_order_item")),
    ("pos-member-identity", "pos", "03F｜会员身份、联系信息与卡",
     ("pos_member", "pos_member_contact", "pos_member_card"), ()),
    ("pos-member-value", "pos", "03G｜会员余额、卡交易与日指标",
     ("pos_member_balance_snapshot", "pos_member_card_transaction", "pos_member_daily_metric"),
     ("v_pos_member_state_current", "v_pos_member_daily_metric_current", "v_pos_member_daily_summary")),
    ("hr-person", "hr", "04A｜自然人与受限联系信息",
     ("hr_person", "hr_person_contact"), ()),
    ("hr-employment", "hr", "04B｜雇佣关系、来源身份、映射审核与员工事件",
     ("hr_employment", "hr_employment_source_identity", "hr_employment_mapping_review", "hr_employee_event"), ()),
    ("hr-recruit", "hr", "04C｜招聘需求、申请与预约",
     ("hr_job_requisition", "hr_application", "hr_application_stage_event", "hr_appointment", "hr_screening_rule"),
     ("v_hr_application_current_stage",)),
    ("hr-evaluation-hire", "hr", "04D｜评估、试工与Offer",
     ("hr_assessment", "hr_assessment_score", "hr_offer"), ("v_hr_assessment_summary",)),
    ("hr-training", "hr", "04E｜入职任务、培训版本与资格",
     ("hr_onboarding_task", "hr_training_course", "hr_training_course_version", "hr_training_assignment", "hr_training_result"),
     ("v_hr_role_eligibility",)),
    ("hr-timesheet", "hr", "04F｜Lark工时同步与实际工时",
     ("hr_timesheet_sync_batch", "hr_timesheet_entry"), ("v_hr_timesheet_entry_current",)),
    ("scm-material", "scm", "05A｜原料身份、别名、来源映射与单位换算",
     ("scm_material", "scm_material_alias", "scm_material_source_identity", "scm_material_unit_conversion"), ()),
    ("scm-supplier", "scm", "05B｜供应商商品与映射审核",
     ("scm_supplier", "scm_supplier_item", "scm_supplier_item_mapping_review"),
     ("v_scm_supplier_item_current_mapping",)),
    ("scm-count", "scm", "05C｜库存盘点批次与明细",
     ("scm_inventory_count", "scm_inventory_count_line"), ()),
    ("scm-movement", "scm", "05D｜库存移动与库存余额",
     ("scm_inventory_movement", "scm_inventory_movement_line"),
     ("v_scm_inventory_balance",)),
    ("scm-requirements", "scm", "05E｜原料需求运行、行与组成追溯",
     ("scm_material_requirement_run", "scm_material_requirement_component"),
     ("v_scm_material_requirement_line", "v_scm_material_requirement_trace", "v_scm_material_requirement_reconciliation")),
    ("scm-replenishment", "scm", "05F｜补货建议、批准量与原因",
     ("scm_replenishment_run", "scm_replenishment_line"), ("v_scm_replenishment_trace",)),
    ("scm-purchase-order", "scm", "05G｜采购单版本与订单行",
     ("scm_purchase_order_revision", "scm_purchase_order_line"),
     ("v_scm_purchase_order_reconciliation",)),
    ("scm-receipt-price", "scm", "05H｜收货、验收与市场价格观察",
     ("scm_goods_receipt", "scm_goods_receipt_line", "scm_supplier_price_observation"),
     ("v_scm_supplier_price_current",)),
    ("cost-recipe", "cost", "06A｜配方、版本与组成展开",
     ("cost_card_recipe_version", "cost_card_recipe_component"),
     ("v_cost_card_recipe_current", "v_cost_card_recipe_expanded")),
    ("cost-price", "cost", "06B｜成本采用价与生效区间",
     ("cost_card_material_price",), ("v_cost_card_material_price_current",)),
    ("cost-snapshot-margin", "cost", "06C｜派生成本组成、快照与产品毛利",
     (),
     ("v_cost_card_product_cost_component", "v_cost_card_product_cost_snapshot", "v_cost_card_product_cost_quality", "v_cost_card_product_daily_margin", "v_cost_card_daily_margin")),
    ("finance-sales", "finance", "07A｜财务导入批次与销售事实",
     ("finance_import_batch", "finance_sales_daily", "finance_item_sales_monthly"),
     ("v_finance_import_batch_current", "v_finance_sales_reconciliation")),
    ("finance-target-metric", "finance", "07B｜财务目标、月度指标与分类规则",
     ("finance_target", "finance_monthly_metric", "finance_period_category_map"), ("v_finance_target_current",)),
    ("finance-cost-cash", "finance", "07C｜月度成本、现金流与利润核对",
     ("finance_monthly_cost_line", "finance_cashflow_line"),
     ("v_finance_labor_reconciliation", "v_finance_margin_reconciliation")),
    ("finance-stock-purchase", "finance", "07D｜订单物流、库存与采购核对",
     ("finance_order_logistics_line", "finance_inventory_snapshot_line", "finance_inventory_flow_line", "finance_supplier_purchase_monthly"),
     ("v_finance_purchase_reconciliation",)),
    ("mkt-campaign-survey", "mkt", "08A｜HBTI活动版本与问卷",
     ("mkt_campaign_version", "mkt_campaign_member", "mkt_survey_question", "mkt_survey_question_option", "mkt_survey_response", "mkt_survey_answer", "mkt_survey_result"),
     ("v_mkt_campaign_performance",)),
    ("mkt-reward", "mkt", "08B｜奖励、库存与核销",
     ("mkt_reward", "mkt_reward_stock", "mkt_reward_claim"), ("v_mkt_reward_stock_reconciliation",)),
    ("msg-all", "msg", "09｜会话、消息、外发与投递",
     ("msg_conversation", "msg_message", "msg_conversation_state", "msg_outbound_message", "msg_delivery_attempt", "msg_delivery_event"),
     ("v_msg_delivery_current",)),
    ("ai-all", "ai", "10｜Prompt版本与AI调用",
     ("ai_prompt_segment", "ai_prompt_template", "ai_prompt_template_segment", "ai_call"), ()),
)

SUBMODULE_ORDER = tuple(item[0] for item in SUBMODULES)
SUBMODULE_BY_KEY = {item[0]: item for item in SUBMODULES}
DOMAIN_LANDING = {}
OBJECT_PAGE_KEY = {}
for index, (key, domain, page_name, table_names, view_names) in enumerate(SUBMODULES, 1):
    PAGE_INFO[key] = (f"detail-{index:02d}-{key}", page_name, page_name.split("｜", 1)[-1])
    DOMAIN_LANDING.setdefault(domain, key)
    for name in (*table_names, *view_names):
        if name in OBJECT_PAGE_KEY:
            raise AssertionError(f"duplicate submodule assignment: {name}")
        OBJECT_PAGE_KEY[name] = key


TITLE_STYLE = (
    "rounded=1;arcSize=10;whiteSpace=wrap;html=1;fillColor=#17324D;"
    "strokeColor=#17324D;fontColor=#FFFFFF;align=left;verticalAlign=middle;"
    "fontSize=22;fontStyle=1;spacingLeft=18;spacingRight=18;strokeWidth=2;"
)
NOTE_STYLE = (
    "shape=note;whiteSpace=wrap;html=1;fillColor=#FFFDF3;strokeColor=#B88916;"
    "fontColor=#5F4B12;align=left;verticalAlign=top;fontSize=12;"
    "spacingLeft=12;spacingRight=12;spacingTop=10;spacingBottom=10;"
)
CONTROL_STYLE = (
    "rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#FFE9E9;strokeColor=#D9534F;"
    "fontColor=#7F2926;align=left;verticalAlign=top;fontSize=12;fontStyle=1;"
    "spacingLeft=12;spacingRight=12;spacingTop=10;spacingBottom=10;dashed=1;dashPattern=6 4;"
)
REF_STYLE = (
    "rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#F8FAFC;"
    "strokeColor=#94A3B8;fontColor=#475569;align=left;verticalAlign=top;"
    "fontSize=11;spacingLeft=9;spacingRight=9;spacingTop=7;dashed=1;dashPattern=6 4;"
)
ER_EDGE = (
    "edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jettySize=auto;html=1;rounded=0;"
    "startArrow=ERmany;startFill=0;endArrow=ERone;endFill=0;"
    "strokeColor=#637083;strokeWidth=1.3;fontColor=#3E4650;fontSize=9;"
    "labelBackgroundColor=#FFFFFF;"
)
DEFERRED_ER_EDGE = ER_EDGE + "dashed=1;dashPattern=7 4;strokeColor=#B7791F;fontColor=#8A5A12;"
VIEW_EDGE = (
    "edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jettySize=auto;html=1;rounded=0;"
    "startArrow=none;endArrow=open;endFill=0;strokeColor=#9A7B24;strokeWidth=1.1;"
    "dashed=1;dashPattern=6 4;fontColor=#6D5100;fontSize=9;labelBackgroundColor=#FFFFFF;"
)
FLOW_EDGE = (
    "edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jettySize=auto;html=1;rounded=0;"
    "endArrow=block;endFill=1;strokeColor=#4A74B5;strokeWidth=1.8;"
    "fontColor=#17324D;fontSize=10;labelBackgroundColor=#FFFFFF;"
)
WRITE_EDGE = FLOW_EDGE + "strokeWidth=2.3;"
READ_EDGE = VIEW_EDGE + "strokeColor=#5F7896;fontColor=#40566E;"
INVISIBLE_EDGE = "endArrow=none;strokeOpacity=0;html=1;"


def safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]+", "_", value).strip("_")


def short(text: str, limit: int = 92) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    return clean if len(clean) <= limit else clean[: limit - 1] + "…"


def node(ident, label, *, style, width, height, group=None, group_label=None, link=None):
    item = {"id": ident, "label": label, "style": style, "width": width, "height": height}
    if group:
        item["group"] = group
    if group_label:
        item["groupLabel"] = group_label
    if link:
        item["link"] = link
    return item


def edge(source, target, label="", style=ER_EDGE):
    return {"source": source, "target": target, "label": label, "style": style}


def page_link(page_key: str) -> str:
    if page_key in DOMAIN_LANDING:
        page_key = DOMAIN_LANDING[page_key]
    return f"data:page/id,{PAGE_INFO[page_key][0]}"


def title_node(page_key: str, subtitle: str):
    _, page_name, heading = PAGE_INFO[page_key]
    label = (
        f"{escape(heading)}<br>"
        f"<font style='font-size:12px;font-weight:normal'>{escape(page_name)} · {escape(subtitle)}</font>"
    )
    return node(f"{safe_id(page_key)}_title", label, style=TITLE_STYLE, width=600, height=105)


def table_style(domain: str, tier: str) -> str:
    fill, stroke, font = DOMAIN_COLORS[domain]
    extra = ""
    if tier == "CORE_PLATFORM":
        extra = "double=1;doubleDistance=4;strokeWidth=2.0;"
    elif tier.startswith("EXTENSION_PACK:"):
        stroke = "#667085"
        extra = "dashed=1;dashPattern=9 5;strokeWidth=2.1;opacity=88;"
    elif tier == "SOURCE_CONDITIONAL":
        stroke = "#C94A4A"
        extra = "dashed=1;dashPattern=3 4;strokeWidth=2.5;"
    return (
        "rounded=0;whiteSpace=wrap;html=1;align=left;verticalAlign=top;"
        f"fillColor={fill};strokeColor={stroke};fontColor={font};"
        "fontSize=10;spacingLeft=8;spacingRight=8;spacingTop=7;spacingBottom=7;"
        f"strokeWidth=1.5;{extra}"
    )


def view_style(domain: str) -> str:
    fill, stroke, font = DOMAIN_COLORS[domain]
    return (
        "rounded=1;arcSize=8;whiteSpace=wrap;html=1;align=left;verticalAlign=top;"
        f"fillColor={fill};strokeColor={stroke};fontColor={font};fontSize=10;"
        "spacingLeft=8;spacingRight=8;spacingTop=7;strokeWidth=1.5;"
        "dashed=1;dashPattern=4 3;"
    )


def selected_key_fields(table, *, full_relationships: bool) -> list:
    selected = []
    seen = set()
    table_fk_fields = {
        field_name
        for table_fk in table.foreign_keys
        for field_name in table_fk.columns
    }
    for field in table.fields:
        if field.pk or field.fk or field.name in table_fk_fields:
            selected.append(field)
            seen.add(field.name)
    priority = (
        "business_date", "version_no", "status", "source_system_id", "source_entity_id",
        "valid_from", "valid_to", "effective_from", "effective_to", "quantity",
        "planned_quantity", "net_sales", "currency", "quality_status",
    )
    for name in priority:
        for field in table.fields:
            if field.name == name and name not in seen:
                selected.append(field)
                seen.add(name)
    limit = 14 if full_relationships else 7
    return selected[:limit]


def table_label(table, *, full_relationships: bool = True) -> tuple[str, int]:
    audit = AUDIT_BY_TABLE[table.name]
    tier = tier_for_table(table.name)
    lifecycle_badge = {
        "CORE_BUSINESS": "PHASE1 BUSINESS",
        "CORE_PLATFORM": "PHASE1 PLATFORM",
        "SOURCE_CONDITIONAL": "SOURCE?",
    }.get(tier, tier.replace("EXTENSION_PACK:", "EXTENSION "))
    mutation_badge = {
        "APPEND_ONLY": "APPEND",
        "APPEND_ONLY_DECISION_RECORD": "DECISION+",
        "CONTROLLED_UPDATE": "UPDATE",
        "CONTROLLED_UPDATE_UNTIL_TERMINAL": "UNTIL TERMINAL",
        "CONTROLLED_WORKFLOW": "WORKFLOW",
        "CONTROLLED_QUEUE_STATE": "QUEUE",
        "DRAFT_MUTABLE_THEN_FROZEN": "DRAFT→FROZEN",
        "SOURCE_STATE_UNTIL_TERMINAL": "SOURCE→TERMINAL",
    }[table.mutation_policy]
    rows = [
        f"<b>{escape(table.name)}</b> <font color='#64748B'><b>[{lifecycle_badge}]</b></font>",
        f"<font color='#334155'>用途：{escape(short(table.purpose, 104))}</font>",
        f"<font color='#64748B'>粒度：{escape(short(table.grain, 94))}</font>",
        f"<font color='#64748B'>写入策略：{escape(mutation_badge)}</font>",
        f"<font color='#64748B'>存储终审：{escape(audit.storage_class)} · {escape(audit.minimum_grain_verdict)}</font>",
        "<font color='#CBD5E1'>────────────────────</font>",
    ]
    marker_colors = {"PK": "#B42318", "FK": "#1D4ED8", "FK LATER": "#B7791F", "KEY": "#59636E"}
    keys = selected_key_fields(table, full_relationships=full_relationships)
    for field in keys:
        field_table_fks = [table_fk for table_fk in table.foreign_keys if field.name in table_fk.columns]
        has_deferred_table_fk = any(table_fk.fk_activation != "WITH_TABLE" for table_fk in field_table_fks)
        marker = (
            "PK" if field.pk
            else "FK LATER" if (field.fk and field.fk_activation != "WITH_TABLE") or has_deferred_table_fk
            else "FK" if field.fk or field_table_fks
            else "KEY"
        )
        refs = []
        if field.fk:
            refs.append(field.fk)
        refs.extend(
            f"{table_fk.ref_table}({'+'.join(table_fk.ref_columns)}) MATCH {table_fk.match_type}"
            for table_fk in field_table_fks
        )
        ref = f" → {' / '.join(refs)}" if refs else ""
        optional = " ?" if field.nullable else ""
        rows.append(
            f"<font color='{marker_colors[marker]}'><b>{marker}{optional}</b></font> "
            f"{escape(field.name)} <font color='#64748B'>: {escape(field.data_type)}{escape(ref)}</font>"
        )
    relationship_field_count = len({
        field.name
        for field in table.fields
        if field.pk or field.fk or any(field.name in table_fk.columns for table_fk in table.foreign_keys)
    })
    if relationship_field_count > len(keys):
        rows.append("<font color='#B42318'>其余关系字段见逐字段字典</font>")
    if table.uniques:
        unique_labels = []
        for unique in table.uniques[:2]:
            policy = " NND" if unique in table.nulls_not_distinct_uniques else " ND" if unique in table.nulls_distinct_uniques else ""
            unique_labels.append(f"UQ{policy} " + " + ".join(unique))
        rows.append(f"<font color='#9A6700'>{escape(short(' / '.join(unique_labels), 95))}</font>")
    if table.exclusions:
        rows.append(f"<font color='#7C3AED'>EXCL {escape(short(table.exclusions[0], 91))}</font>")
    rows.append(f"<font color='#64748B'>写入：{escape(short(table.writer, 80))}</font>")
    return "<br>".join(rows), 152 + 17 * len(keys) + (18 if table.uniques else 0) + (18 if table.exclusions else 0)


def table_node(page_key: str, table, *, group: str, compact: bool = False):
    label, height = table_label(table, full_relationships=not compact)
    return node(
        f"{safe_id(page_key)}_tbl_{safe_id(table.name)}",
        label,
        style=table_style(table.domain, tier_for_table(table.name)),
        width=340 if not compact else 310,
        height=height if not compact else min(height, 300),
        group=group,
        link=page_link(OBJECT_PAGE_KEY[table.name]) if page_key != OBJECT_PAGE_KEY[table.name] else None,
    )


def view_node(page_key: str, view, *, group: str, compact: bool = False):
    fields = view.fields[:5 if compact else 8]
    grain_key = "UNDEFINED" if view.grain_key is None else " + ".join(view.grain_key)
    blockers = "NONE" if not view.readiness_blockers else " / ".join(view.readiness_blockers)
    rows = [
        f"<b>{escape(view.name)}</b> <font color='#967A22'><b>[VIEW · {escape(view_implementation_tier(view.name))}]</b></font>",
        f"<font color='#7C3AED'><b>准备度：{escape(view.readiness_status)}</b></font>",
        f"<font color='#64748B'>粒度键：{escape(short(grain_key, 115))}</font>",
        f"<font color='#B42318'>阻断：{escape(short(blockers, 130))}</font>",
        f"<font color='#334155'>用途：{escape(short(view.purpose, 102))}</font>",
        f"<font color='#64748B'>粒度：{escape(short(view.grain, 92))}</font>",
        f"<font color='#967A22'>血缘：{escape(short(' / '.join(view.lineage), 150))}</font>",
        "<font color='#CBD5E1'>────────────────────</font>",
    ]
    rows.extend(f"<font color='#64748B'>• {escape(f.name)} : {escape(f.data_type)}</font>" for f in fields)
    rows.append("<font color='#967A22'>只读；不接受业务写入</font>")
    return node(
        f"{safe_id(page_key)}_view_{safe_id(view.name)}",
        "<br>".join(rows),
        style=view_style(view.domain),
        width=330,
        height=183 + 17 * len(fields),
        group=group,
        link=page_link(OBJECT_PAGE_KEY[view.name]) if page_key != OBJECT_PAGE_KEY[view.name] else None,
    )


def external_node(page_key: str, target_name: str):
    target = TABLE_BY_NAME.get(target_name) or VIEW_BY_NAME.get(target_name)
    target_domain = target.domain
    kind = "TABLE" if target_name in TABLE_BY_NAME else "VIEW"
    return node(
        f"{safe_id(page_key)}_ref_{safe_id(target_name)}",
        f"<b>REF · {escape(target_name)}</b> [{kind}]<br>"
        f"<font color='#64748B'>{escape(DOMAIN_NAMES[target_domain])}<br>{escape(short(target.purpose, 88))}</font>",
        style=REF_STYLE,
        width=270,
        height=92,
        group="03 跨板块引用",
        link=page_link(OBJECT_PAGE_KEY[target_name]),
    )


def legend_nodes(page_key: str, domains: list[str], *, include_view=True, include_ref=True):
    rows = ["<b>颜色 = 谁负责这个板块</b>"]
    for domain in domains:
        _, stroke, _ = DOMAIN_COLORS[domain]
        rows.append(f"<font color='{stroke}'>■</font> <b>{escape(domain.upper())}</b> = {escape(DOMAIN_NAMES[domain])}")
    rows.append(f"<b>━ 实线边框</b> = 首期业务核心，{len(CORE_BUSINESS_TABLES)} 张业务事实/主数据")
    rows.append("<b>═ 双线边框</b> = 首期平台侧车，权限/幂等/审计/恢复，不是经营事实")
    rows.append("<b>┄ 长虚线灰边</b> = 扩展包，有真实模块写入者后才建")
    rows.append("<font color='#C94A4A'><b>┄ 短虚线红边</b></font> = 来源待验证，先证明身份/粒度/重跑契约")
    if include_view:
        rows.append("<b>圆角虚线框 VIEW</b> = 治理视图，只读分析接口")
    if include_ref:
        rows.append("<b>REF</b> = 跨板块引用；点击跳转完整定义")
    rows.append("<font color='#9A6700'><b>UQ NND</b></font> = 空值也算重复；<b>UQ ND</b> = 只限制非空值")
    rows.append("<font color='#7C3AED'><b>EXCL</b></font> = 正式生效区间禁止重叠；统一 [from, to)")
    style = (
        "rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#94A3B8;"
        "fontColor=#334155;align=left;verticalAlign=top;fontSize=11;spacingLeft=10;"
        "spacingRight=10;spacingTop=8;strokeWidth=1.2;"
    )
    return [node(
        f"{safe_id(page_key)}_legend",
        "<br>".join(rows),
        style=style,
        width=340 if len(domains) > 4 else 285,
        height=34 + 19 * (len(rows) - 1),
        group="99 颜色图例",
    )]


def submodule_graph(page_key: str) -> dict:
    _, domain, _, table_names, view_names = SUBMODULE_BY_KEY[page_key]
    page_tables = [TABLE_BY_NAME[name] for name in table_names]
    page_views = [VIEW_BY_NAME[name] for name in view_names]
    nodes = [title_node(page_key, f"本页覆盖 {len(page_tables)} 张表、{len(page_views)} 个只读视图；每条实线均标出外键字段")]
    nodes += [table_node(page_key, table, group="01 物理表") for table in page_tables]
    nodes += [view_node(page_key, view, group="02 治理视图") for view in page_views]

    external = set()
    buckets = defaultdict(list)
    local_tables = set(table_names)
    local_views = set(view_names)
    for table in page_tables:
        source = f"{safe_id(page_key)}_tbl_{safe_id(table.name)}"
        for field in table.fields:
            if not field.fk:
                continue
            target_name, target_field = field.fk.split(".", 1)
            if target_name in local_tables:
                target = f"{safe_id(page_key)}_tbl_{safe_id(target_name)}"
            else:
                external.add(target_name)
                target = f"{safe_id(page_key)}_ref_{safe_id(target_name)}"
            kind = "fk" if field.fk_activation == "WITH_TABLE" else "deferred_fk"
            suffix = "" if kind == "fk" else f" [启用时:{field.fk_activation}]"
            buckets[(source, target, kind)].append(f"{field.name} → {target_field}{suffix}")
        for table_fk in table.foreign_keys:
            target_name = table_fk.ref_table
            if target_name in local_tables:
                target = f"{safe_id(page_key)}_tbl_{safe_id(target_name)}"
            else:
                external.add(target_name)
                target = f"{safe_id(page_key)}_ref_{safe_id(target_name)}"
            kind = "fk" if table_fk.fk_activation == "WITH_TABLE" else "deferred_fk"
            suffix = "" if kind == "fk" else f" [启用时:{table_fk.fk_activation}]"
            buckets[(source, target, kind)].append(
                f"({'+'.join(table_fk.columns)}) → ({'+'.join(table_fk.ref_columns)}) "
                f"MATCH {table_fk.match_type}{suffix}"
            )
    # On ordinary pages view lineage is printed inside the dashed view box so
    # physical FK relationships stay readable.  A view-only page (the R6 cost
    # derivation page) draws its lineage explicitly because there are no table
    # edges to obscure.
    if not page_tables:
        for view in page_views:
            target = f"{safe_id(page_key)}_view_{safe_id(view.name)}"
            for source_name in view.lineage:
                if source_name in local_views:
                    source = f"{safe_id(page_key)}_view_{safe_id(source_name)}"
                else:
                    external.add(source_name)
                    source = f"{safe_id(page_key)}_ref_{safe_id(source_name)}"
                buckets[(source, target, "view")].append("派生血缘")
    nodes += [external_node(page_key, name) for name in sorted(external)]
    nodes += legend_nodes(page_key, [domain])
    edges = []
    for (source, target, kind), labels in buckets.items():
        label = " / ".join(dict.fromkeys(labels))
        edges.append(edge(source, target, label, ER_EDGE if kind == "fk" else DEFERRED_ER_EDGE if kind == "deferred_fk" else VIEW_EDGE))
    if page_tables:
        edges.append(edge(f"{safe_id(page_key)}_title", f"{safe_id(page_key)}_tbl_{safe_id(page_tables[0].name)}", "", INVISIBLE_EDGE))
    elif page_views:
        edges.append(edge(f"{safe_id(page_key)}_title", f"{safe_id(page_key)}_view_{safe_id(page_views[0].name)}", "", INVISIBLE_EDGE))
    return {"direction": "TB", "ranksep": 1.0, "nodesep": 0.7, "nodes": nodes, "edges": edges}


def domain_card(domain: str, count: int, view_count: int):
    fill, stroke, font = DOMAIN_COLORS[domain]
    style = (
        "rounded=1;arcSize=10;whiteSpace=wrap;html=1;align=left;verticalAlign=middle;"
        f"fillColor={fill};strokeColor={stroke};fontColor={font};fontSize=13;"
        "spacingLeft=12;spacingRight=12;spacingTop=8;strokeWidth=1.7;"
    )
    return node(
        f"overview_domain_{domain}",
        f"<b>{escape(domain.upper())} · {escape(DOMAIN_NAMES[domain])}</b><br>"
        f"{count} 份物理契约 / {view_count} 视图<br>"
        f"<font color='#64748B'>业务核心 {sum(x.domain == domain and x.name in CORE_BUSINESS_TABLES for x in TABLES)} · "
        f"平台侧车 {sum(x.domain == domain and x.name in CORE_PLATFORM_TABLES for x in TABLES)} · "
        f"扩展 {sum(x.domain == domain and x.name in EXTENSION_TABLES for x in TABLES)} · "
        f"来源? {sum(x.domain == domain and x.name in SOURCE_CONDITIONAL_TABLES for x in TABLES)}</font><br>"
        f"<font color='#64748B'>点击查看全部关系字段</font>",
        style=style, width=305, height=112, group="03 目标业务板块", link=page_link(domain),
    )


def overview_graph() -> dict:
    fk_count = validate_model()["foreign_key_count"]
    nodes = [title_node("overview", f"R6：首期{len(CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES)}张物理表（{len(CORE_BUSINESS_TABLES)}业务+{len(CORE_PLATFORM_TABLES)}平台）；{len(PHASE1_VIEWS)}个Phase1视图仅为设计候选，{VIEW_READINESS_GOLDEN_COUNTS['PASS_SELECT_SPEC']}个SELECT规格ready，当前创建并验证SQL view=0；完整目录{len(TABLES)}份物理契约、{len(VIEWS)}视图（扩展{len(EXTENSION_VIEWS)}/来源条件{len(SOURCE_CONDITIONAL_VIEWS)}）、{fk_count}条外键、{len(END_TO_END_CHAINS)}条链路")]
    nodes += [
        node("overview_scope", "<b>方案 C 范围</b><br>新建 HOT CRUSH Core V1 数据库，在旧库旁回填、影子核对、双轨和按项目切换。<br><b>当前不修改生产库，也不生成可执行迁移。</b>", style=NOTE_STYLE, width=430, height=126, group="01 评审边界"),
        node("overview_spine", "<b>统一连接脊柱</b><br>location_id · product_id · person_id · employment_id · material_id<br>business_date · source_system_id · batch/run/version · effective period", style=TITLE_STYLE, width=650, height=150, group="02 稳定身份", link=page_link("identity")),
        node("overview_rule", "<b>名称不是连接键</b><br>POS listing、员工号、供应商商品号先保真，再通过有证据和生效期的映射连接统一身份。无法确认就保留 NULL 并进入审核。", style=CONTROL_STYLE, width=430, height=126, group="02 稳定身份"),
        node("overview_lifecycle", f"<b>R5的154/154通过结论已作废</b><br>首期业务核心 {len(CORE_BUSINESS_TABLES)} 张<br>首期平台侧车 {len(CORE_PLATFORM_TABLES)} 张<br>Phase1视图候选 {len(PHASE1_VIEWS)} · SELECT规格ready {VIEW_READINESS_GOLDEN_COUNTS['PASS_SELECT_SPEC']} · 已创建验证 0<br>按需扩展 {len(EXTENSION_TABLES)} 张 · 来源待验证 {len(SOURCE_CONDITIONAL_TABLES)} 张<br>另有{len(MERGED_R5_TABLES)}张合并、{len(DERIVED_R5_TABLES)}张派生、{len(REMOVED_R5_TABLES)}张删除", style=NOTE_STYLE, width=470, height=174, group="01 评审边界"),
        node("overview_core_hub", "<b>经营事实链</b><br>计划 → 供应 → 成本 → 销售 → 财务核对", style=TITLE_STYLE, width=330, height=82, group="03 目标业务板块"),
        node("overview_support_hub", "<b>治理与触达链</b><br>权限质量 → 人员 → 营销 → 消息 → AI", style=TITLE_STYLE, width=330, height=82, group="03 目标业务板块"),
    ]
    for domain in DOMAIN_ORDER:
        nodes.append(domain_card(domain, sum(x.domain == domain for x in TABLES), sum(x.domain == domain for x in VIEWS)))
    nodes += [
        node("overview_projects", "<b>四个项目写入边界</b><br>BakeryOps · RES/POS · 财务网站 · HBTI<br>同一来源事实只允许一个责任写者", style=NOTE_STYLE, width=360, height=102, group="04 项目边界", link=page_link("projects")),
        node("overview_e2e", "<b>15 条端到端链路</b><br>从来源批次、预测、计划、班表、订货、成本和销售一直追到财务、HBTI、消息与审计", style=NOTE_STYLE, width=390, height=110, group="05 分析闭环", link=page_link("chain-01")),
        node("overview_gate", "<b>统一质量门禁</b><br>身份未确认、来源部分失败、单位不明、版本未发布或成本覆盖不足时，事实不被静默补值；分析必须显示质量与覆盖率。", style=CONTROL_STYLE, width=420, height=124, group="05 分析闭环"),
    ]
    nodes += legend_nodes("overview", list(DOMAIN_ORDER), include_view=False, include_ref=False)

    edges = [
        edge("overview_title", "overview_scope", "", INVISIBLE_EDGE),
        edge("overview_title", "overview_spine", "", INVISIBLE_EDGE),
        edge("overview_scope", "overview_lifecycle", "实施边界", FLOW_EDGE),
        edge("overview_scope", "overview_spine", "评审后再执行", FLOW_EDGE),
        edge("overview_spine", "overview_rule", "证据映射", FLOW_EDGE),
        edge("overview_spine", "overview_core_hub", "经营事实", FLOW_EDGE),
        edge("overview_spine", "overview_support_hub", "治理身份", FLOW_EDGE),
        edge("overview_support_hub", "overview_projects", "唯一责任写入", WRITE_EDGE),
        edge("overview_core_hub", "overview_e2e", "统一业务链", FLOW_EDGE),
        edge("overview_e2e", "overview_gate", "质量状态", FLOW_EDGE),
    ]
    core_domains = {"ops", "pos", "scm", "cost", "finance"}
    for domain in DOMAIN_ORDER:
        hub = "overview_core_hub" if domain in core_domains else "overview_support_hub"
        edges.append(edge(hub, f"overview_domain_{domain}", "稳定身份 / 时间 / 版本", FLOW_EDGE))
    # Invisible rank chains keep the ten domain cards in two readable columns
    # instead of one extremely wide row in the exported overview.
    for ordered in (("ops", "pos", "scm", "cost", "finance"), ("app", "hr", "mkt", "msg", "ai")):
        for left, right in zip(ordered, ordered[1:]):
            edges.append(edge(f"overview_domain_{left}", f"overview_domain_{right}", "", INVISIBLE_EDGE))
    return {"direction": "TB", "lock_direction": True, "ranksep": 0.9, "nodesep": 0.65, "nodes": nodes, "edges": edges}


def identity_graph() -> dict:
    identity_tables = [
        "app_source_system", "app_unit", "ops_location", "ops_location_source_identity",
        "ops_product", "pos_product_listing", "pos_product_mapping", "pos_product_mapping_review",
        "hr_person", "hr_employment", "hr_employment_source_identity", "hr_employment_mapping_review",
        "scm_material", "scm_material_source_identity", "scm_material_unit_conversion", "scm_supplier_item", "scm_supplier_item_mapping_review",
    ]
    nodes = [title_node("identity", "所有业务事实先回答：在哪里、什么产品、谁、哪段雇佣、什么原料、哪一天、哪次来源/版本")]
    for name in identity_tables:
        table = TABLE_BY_NAME[name]
        nodes.append(table_node("identity", table, group=f"0{DOMAIN_ORDER.index(table.domain)+1} {DOMAIN_NAMES[table.domain]}", compact=True))
    nodes += [
        node("identity_time", "<b>共同时间语义</b><br>business_date = 地点营业日<br>created_at = 入库时间<br>valid/effective period = 发生时点选版<br>timestamptz = 绝对时间，展示按地点时区", style=NOTE_STYLE, width=340, height=126, group="20 时间与版本"),
        node("identity_lineage", "<b>共同来源语义</b><br>source_system_id + source entity ID<br>batch / run / version ID<br>保留来源原值、校验和、处理状态和质量问题", style=NOTE_STYLE, width=340, height=116, group="20 时间与版本"),
        node("identity_stop", "<b>阻断规则</b><br>名称相同不证明是同一对象；一对多候选、单位不明、员工重名或门店名不同均进入 review queue，不自动填稳定 ID。", style=CONTROL_STYLE, width=360, height=120, group="21 质量门禁"),
    ]
    nodes += legend_nodes("identity", ["app", "ops", "pos", "hr", "scm"], include_view=False, include_ref=False)
    present = set(identity_tables)
    edges = []
    for name in identity_tables:
        table = TABLE_BY_NAME[name]
        source = f"identity_tbl_{safe_id(name)}"
        for field in table.fields:
            if field.fk and field.fk.split(".", 1)[0] in present:
                target_name, target_field = field.fk.split(".", 1)
                edges.append(edge(source, f"identity_tbl_{safe_id(target_name)}", f"{field.name} → {target_field}", ER_EDGE))
        for table_fk in table.foreign_keys:
            if table_fk.ref_table in present:
                edges.append(edge(
                    source,
                    f"identity_tbl_{safe_id(table_fk.ref_table)}",
                    f"({'+'.join(table_fk.columns)}) → ({'+'.join(table_fk.ref_columns)}) MATCH {table_fk.match_type}",
                    ER_EDGE if table_fk.fk_activation == "WITH_TABLE" else DEFERRED_ER_EDGE,
                ))
    edges += [
        edge("identity_title", "identity_tbl_app_source_system", "", INVISIBLE_EDGE),
        edge("identity_time", "identity_lineage", "共同上下文", FLOW_EDGE),
        edge("identity_lineage", "identity_stop", "缺失/冲突", FLOW_EDGE),
    ]
    return {"direction": "TB", "ranksep": 1.0, "nodesep": 0.7, "nodes": nodes, "edges": edges}


def projects_graph() -> dict:
    nodes = [title_node("projects", "应用只能写自己负责的来源事实；跨域分析通过稳定 ID、只读视图和受控函数")]
    project_style = {
        "bakery_ops": DOMAIN_COLORS["ops"], "res_api": DOMAIN_COLORS["pos"],
        "finance_web": DOMAIN_COLORS["finance"], "hbti_web": DOMAIN_COLORS["mkt"],
    }
    for project in PROJECTS:
        fill, stroke, font = project_style[project["code"]]
        style = f"rounded=1;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};fontColor={font};fontSize=12;align=left;verticalAlign=top;spacing=10;strokeWidth=2;"
        nodes.append(node(
            f"projects_{project['code']}",
            f"<b>{escape(project['name'])}</b><br><font color='#64748B'>{escape(project['root'])}</font><br><br>"
            f"<b>写：</b>{escape(project['target_write_domains'])}<br><b>读：</b>{escape(project['target_read_domains'])}<br>"
            f"<font color='#B42318'><b>边界：</b>{escape(project['boundary'])}</font>",
            style=style, width=390, height=175, group="01 四个项目",
        ))
    for domain in DOMAIN_ORDER:
        nodes.append(domain_card(domain, sum(x.domain == domain for x in TABLES), sum(x.domain == domain for x in VIEWS)))
        nodes[-1]["id"] = f"projects_domain_{domain}"
        nodes[-1]["group"] = "02 目标责任域"
    nodes += [
        node("projects_conflict", "<b>当前必须拆开的双写/混写</b><br>daily_revenue：POS 与财务分表<br>pos_member：POS 会员与 HBTI 活动分表<br>门店/产品/人员：统一身份，不各自造主数据<br>schema_migrations：增加 repository_code 命名空间", style=CONTROL_STYLE, width=420, height=150, group="03 冲突门禁"),
        node("projects_proof", "<b>“适配”验收证据</b><br>生产部署清单 + 连接角色<br>旧请求/响应或 SQL 契约<br>影子读取逐日核对<br>双写高水位与幂等键<br>独立回滚开关和演练", style=NOTE_STYLE, width=360, height=142, group="03 冲突门禁"),
    ]
    nodes += legend_nodes("projects", list(DOMAIN_ORDER), include_view=False, include_ref=False)
    writes = {
        "bakery_ops": ("ops", "hr", "scm", "msg", "ai"),
        "res_api": ("pos",),
        "finance_web": ("finance", "cost", "app"),
        "hbti_web": ("mkt",),
    }
    edges = [edge("projects_title", "projects_bakery_ops", "", INVISIBLE_EDGE)]
    for project, domains in writes.items():
        for domain in domains:
            edges.append(edge(f"projects_{project}", f"projects_domain_{domain}", "唯一责任写入", WRITE_EDGE))
    for project in writes:
        edges.append(edge(f"projects_{project}", "projects_domain_app", "审计 / 质量 / 权限", READ_EDGE))
    edges += [edge("projects_conflict", "projects_proof", "逐项验证", FLOW_EDGE)]
    return {"direction": "TB", "ranksep": 0.95, "nodesep": 0.7, "nodes": nodes, "edges": edges}


def object_node_for_chain(page_key: str, name: str):
    if name in TABLE_BY_NAME:
        return table_node(page_key, TABLE_BY_NAME[name], group="02 业务链路", compact=True)
    return view_node(page_key, VIEW_BY_NAME[name], group="02 业务链路", compact=True)


def object_fields(name: str) -> set[str]:
    obj = TABLE_BY_NAME.get(name) or VIEW_BY_NAME.get(name)
    return {f.name for f in obj.fields}


def relationship_label(left: str, right: str) -> str:
    if left in TABLE_BY_NAME:
        left_table = TABLE_BY_NAME[left]
        refs = [f"{f.name} → {f.fk.split('.',1)[1]}" for f in left_table.fields if f.fk and f.fk.split(".", 1)[0] == right]
        refs.extend(
            f"({'+'.join(table_fk.columns)}) → ({'+'.join(table_fk.ref_columns)}) MATCH {table_fk.match_type}"
            for table_fk in left_table.foreign_keys
            if table_fk.ref_table == right
        )
        if refs:
            return " / ".join(refs)
    if right in TABLE_BY_NAME:
        right_table = TABLE_BY_NAME[right]
        refs = [f"{f.name} → {f.fk.split('.',1)[1]}" for f in right_table.fields if f.fk and f.fk.split(".", 1)[0] == left]
        refs.extend(
            f"({'+'.join(table_fk.columns)}) → ({'+'.join(table_fk.ref_columns)}) MATCH {table_fk.match_type}"
            for table_fk in right_table.foreign_keys
            if table_fk.ref_table == left
        )
        if refs:
            return " / ".join(refs)
    if left in VIEW_BY_NAME and right in VIEW_BY_NAME[left].lineage:
        return "view reads source"
    if right in VIEW_BY_NAME and left in VIEW_BY_NAME[right].lineage:
        return "source feeds view"
    priorities = ("location_id", "business_date", "product_id", "employment_id", "person_id", "material_id", "campaign_version_id", "member_id", "currency")
    common = object_fields(left) & object_fields(right)
    keys = [x for x in priorities if x in common]
    return " + ".join(keys[:4]) if keys else "受控业务血缘"


def chain_graph(chain) -> dict:
    page_key = f"chain-{chain.number:02d}"
    domains = list(dict.fromkeys((TABLE_BY_NAME.get(x) or VIEW_BY_NAME[x]).domain for x in chain.nodes))
    nodes = [title_node(page_key, chain.question)]
    nodes.append(node(
        f"{safe_id(page_key)}_question",
        f"<b>要回答的问题</b><br>{escape(chain.question)}",
        style=NOTE_STYLE, width=420, height=92, group="01 问题",
    ))
    nodes += [object_node_for_chain(page_key, name) for name in chain.nodes]
    joins = "<br>".join(f"{i}. {escape(text)}" for i, text in enumerate(chain.joins, 1))
    nodes += [
        node(f"{safe_id(page_key)}_joins", f"<b>连接规则</b><br>{joins}", style=NOTE_STYLE, width=500, height=92 + 28 * len(chain.joins), group="03 规则与门禁"),
        node(f"{safe_id(page_key)}_control", f"<b>必须阻断/标记的情况</b><br>{escape(chain.control)}", style=CONTROL_STYLE, width=500, height=112, group="03 规则与门禁"),
    ]
    nodes += legend_nodes(page_key, domains, include_view=any(x in VIEW_BY_NAME for x in chain.nodes), include_ref=False)
    edges = [edge(f"{safe_id(page_key)}_title", f"{safe_id(page_key)}_question", "", INVISIBLE_EDGE)]
    ids = []
    for name in chain.nodes:
        prefix = "tbl" if name in TABLE_BY_NAME else "view"
        ids.append(f"{safe_id(page_key)}_{prefix}_{safe_id(name)}")
    edges.append(edge(f"{safe_id(page_key)}_question", ids[0], "业务入口", FLOW_EDGE))
    for left, right, source_id, target_id in zip(chain.nodes, chain.nodes[1:], ids, ids[1:]):
        edges.append(edge(source_id, target_id, relationship_label(left, right), FLOW_EDGE))
    edges += [
        edge(ids[-1], f"{safe_id(page_key)}_joins", "解释关系", FLOW_EDGE),
        edge(f"{safe_id(page_key)}_joins", f"{safe_id(page_key)}_control", "质量门禁", FLOW_EDGE),
    ]
    return {"direction": "LR", "ranksep": 0.9, "nodesep": 0.65, "nodes": nodes, "edges": edges}


def audit_diagram_model(graphs: dict):
    validate_model()
    validate_storage_audit()
    if len(END_TO_END_CHAINS) != 15:
        raise AssertionError("exactly 15 chains required")
    assigned_tables = [name for _, _, _, table_names, _ in SUBMODULES for name in table_names]
    assigned_views = [name for _, _, _, _, view_names in SUBMODULES for name in view_names]
    seen_tables = set(assigned_tables)
    if seen_tables != set(TABLE_BY_NAME):
        raise AssertionError(f"target table submodule coverage mismatch: missing={set(TABLE_BY_NAME)-seen_tables}, extra={seen_tables-set(TABLE_BY_NAME)}")
    if len(assigned_tables) != len(seen_tables):
        raise AssertionError("a target table appears on more than one submodule page")
    seen_views = set(assigned_views)
    if seen_views != set(VIEW_BY_NAME):
        raise AssertionError(f"target view submodule coverage mismatch: missing={set(VIEW_BY_NAME)-seen_views}, extra={seen_views-set(VIEW_BY_NAME)}")
    if len(assigned_views) != len(seen_views):
        raise AssertionError("a target view appears on more than one submodule page")
    expected_fk_edges = validate_model()["foreign_key_count"]
    actual_fk_edges = 0
    for page_key in SUBMODULE_ORDER:
        graph = graphs[page_key]
        for item in graph["edges"]:
            if item.get("style") in {ER_EDGE, DEFERRED_ER_EDGE}:
                actual_fk_edges += len(item["label"].split(" / ")) if item["label"] else 0
    if actual_fk_edges != expected_fk_edges:
        raise AssertionError(f"relationship coverage mismatch: {actual_fk_edges} vs {expected_fk_edges}")


def build_graphs() -> dict:
    graphs = {"overview": overview_graph()}
    graphs.update({page_key: submodule_graph(page_key) for page_key in SUBMODULE_ORDER})
    graphs["identity"] = identity_graph()
    graphs["projects"] = projects_graph()
    for chain in END_TO_END_CHAINS:
        graphs[f"chain-{chain.number:02d}"] = chain_graph(chain)
    return graphs


def build_pages(graphs: dict):
    order = ["overview", *SUBMODULE_ORDER, "identity", "projects", *(f"chain-{x.number:02d}" for x in END_TO_END_CHAINS)]
    pages_xml = []
    reports = []
    for page_key in order:
        source_graph = graphs[page_key]
        candidates = []
        directions = [source_graph.get("direction", "TB")]
        if not page_key.startswith("chain-") and not source_graph.get("lock_direction"):
            other = "LR" if directions[0] == "TB" else "TB"
            directions.append(other)
        for direction in dict.fromkeys(directions):
            graph = copy.deepcopy(source_graph)
            graph["direction"] = direction
            height, positions, edge_points = al.layout(al.build_dot(graph))
            score = al.route_score(graph, height, positions, edge_points)
            candidates.append((score, direction, graph, height, positions, edge_points))
        score, direction, graph, height, positions, edge_points = min(candidates, key=lambda x: x[0])
        cells = al.page_cells(graph, height, positions, edge_points, color=False)
        page_id, page_name, _ = PAGE_INFO[page_key]
        pages_xml.append(al.wrap_page(cells, page_id=page_id, name=page_name))
        reports.append(f"{page_name}: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges, direction={direction}, route_score={score}")
    return pages_xml, reports


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    graphs = build_graphs()
    audit_diagram_model(graphs)
    pages_xml, reports = build_pages(graphs)
    release_date = re.search(r"(\d{4}-\d{2}-\d{2})$", MODEL_VERSION)
    if release_date is None:
        raise AssertionError(f"MODEL_VERSION lacks a release date: {MODEL_VERSION}")
    # Draw.io's modified attribute is metadata, not business data. Tie it to the
    # declared model release so identical inputs produce a byte-identical file.
    modified = f"{release_date.group(1)}T00:00:00Z"
    xml = (
        f'<mxfile host="Electron" modified="{modified}" agent="Codex drawio-skill" version="31.1.5" '
        'type="device" compressed="false">\n'
        + "".join(pages_xml)
        + "</mxfile>\n"
    )
    OUTPUT.write_text(xml, encoding="utf-8")
    print(f"wrote {OUTPUT}")
    fk_count = validate_model()["foreign_key_count"]
    print(f"audit: {len(TABLES)} tables, {len(VIEWS)} views, {fk_count} FK relationships, {len(END_TO_END_CHAINS)} chains, {len(pages_xml)} pages")
    for report in reports:
        print(report)


if __name__ == "__main__":
    main()
