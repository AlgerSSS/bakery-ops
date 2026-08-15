#!/usr/bin/env python3
"""Generate the editable multi-page HOT CRUSH future database blueprint.

The drawing is intentionally generated from a small logical graph rather than
hand-positioned XML.  Graphviz handles collision-free placement and the
drawio-skill autolayout helper emits editable, uncompressed draw.io pages.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parent
AUTOLAYOUT_PATH = Path.home() / ".codex/skills/drawio-skill/scripts/autolayout.py"
OUTPUT = ROOT / "HOTCRUSH未来数据库蓝图.drawio"


def load_autolayout():
    spec = importlib.util.spec_from_file_location("drawio_autolayout", AUTOLAYOUT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {AUTOLAYOUT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


al = load_autolayout()


COLORS = {
    "navy": ("#17324D", "#17324D", "#FFFFFF"),
    "blue": ("#EAF2FF", "#4A74B5", "#17324D"),
    "orange": ("#FFF1E8", "#D97706", "#7A3E00"),
    "green": ("#EAF7EE", "#3F8F5B", "#205C39"),
    "purple": ("#F3EDFA", "#7C5AA6", "#493263"),
    "teal": ("#E6F7F6", "#2E8B88", "#175E5B"),
    "gold": ("#FFF7DD", "#B88916", "#6D5100"),
    "red": ("#FDECEC", "#C94A4A", "#7D2525"),
    "gray": ("#F5F6F8", "#7A8390", "#3E4650"),
    "white": ("#FFFFFF", "#B8C0CC", "#27313D"),
}


def box_style(color: str, *, align: str = "left", dashed: bool = False, font_size: int = 13) -> str:
    fill, stroke, font = COLORS[color]
    return (
        "rounded=1;arcSize=10;whiteSpace=wrap;html=1;"
        f"fillColor={fill};strokeColor={stroke};fontColor={font};"
        f"align={align};verticalAlign=middle;fontSize={font_size};"
        "spacingLeft=10;spacingRight=10;spacingTop=8;spacingBottom=8;"
        f"strokeWidth=1.5;{'dashed=1;dashPattern=6 4;' if dashed else ''}"
    )


TITLE_STYLE = (
    "rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#17324D;"
    "strokeColor=#17324D;fontColor=#FFFFFF;align=left;verticalAlign=middle;"
    "fontSize=22;fontStyle=1;spacingLeft=18;spacingRight=18;strokeWidth=2;"
)

CALLOUT_STYLE = (
    "shape=note;whiteSpace=wrap;html=1;fillColor=#FFF7DD;strokeColor=#B88916;"
    "fontColor=#6D5100;align=left;verticalAlign=middle;fontSize=13;"
    "spacingLeft=12;spacingRight=12;spacingTop=8;spacingBottom=8;"
)

EDGE = (
    "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;"
    "html=1;endArrow=block;endFill=1;strokeColor=#637083;strokeWidth=1.4;"
    "fontColor=#3E4650;fontSize=11;labelBackgroundColor=#FFFFFF;"
)
DASHED_EDGE = EDGE + "dashed=1;dashPattern=6 4;"
INVISIBLE_EDGE = "endArrow=none;strokeOpacity=0;html=1;"
RED_EDGE = EDGE + "strokeColor=#C94A4A;fontColor=#7D2525;strokeWidth=2;"
GREEN_EDGE = EDGE + "strokeColor=#3F8F5B;fontColor=#205C39;strokeWidth=2;"


def node(
    ident: str,
    label: str,
    color: str = "white",
    *,
    group: str | None = None,
    group_label: str | None = None,
    width: int = 230,
    height: int = 92,
    align: str = "left",
    link: str | None = None,
    dashed: bool = False,
    style: str | None = None,
):
    item = {
        "id": ident,
        "label": label,
        "width": width,
        "height": height,
        "style": style or box_style(color, align=align, dashed=dashed),
    }
    if group:
        item["group"] = group
    if group_label:
        item["groupLabel"] = group_label
    if link:
        item["link"] = link
    return item


def table(
    ident: str,
    name: str,
    purpose: str,
    grain: str,
    keys: str,
    color: str,
    *,
    group: str,
    group_label: str | None = None,
    width: int = 250,
    height: int = 116,
    dashed: bool = False,
):
    label = (
        f"<b>{name}</b><br>"
        f"<font color='#455160'>{purpose}</font><br>"
        f"<font color='#6C7683'>粒度：{grain}</font><br>"
        f"<font color='#6C7683'>关键键：{keys}</font>"
    )
    return node(
        ident,
        label,
        color,
        group=group,
        group_label=group_label,
        width=width,
        height=height,
        dashed=dashed,
    )


def title(ident: str, heading: str, subtitle: str):
    return node(
        ident,
        f"{heading}<br><font style='font-size:13px;font-weight:normal'>{subtitle}</font>",
        width=320,
        height=112,
        style=TITLE_STYLE,
    )


def edge(
    source: str,
    target: str,
    label: str = "",
    style: str = EDGE,
    *,
    autoroute: bool = False,
):
    item = {"source": source, "target": target, "label": label, "style": style}
    if autoroute:
        item["autoroute"] = True
    return item


def overview_graph():
    nodes = [
        title(
            "p1_title",
            "HOT CRUSH 未来数据库蓝图",
            "老板视角：从明日计划、关键岗位、订货，到当日销售与毛利的同一事实链",
        ),
        node(
            "p1_capture",
            "<b>统一工作入口｜BakeryOps</b><br>自动抓：POS、节假日、Lark 工时、采购来源<br>人工确认：计划调整、突发事件、关键岗位、收货例外",
            "blue",
            group="01_入口",
            group_label="数据入口：能自动就自动，需要判断才人工",
            width=300,
            height=116,
        ),
        node(
            "p1_identity",
            "<b>共享身份脊柱</b><br><b>store_id</b> 门店　<b>product_id</b> 可售产品<br><b>employment_id</b> 雇佣关系　<b>material_id</b> 原料<br><font color='#D8E8F7'>跨表只用稳定 ID，不用名称猜关联</font>",
            "navy",
            group="02_地基",
            group_label="先统一身份，再谈跨表速度",
            width=320,
            height=128,
            link="data:page/id,future-p5-governance",
        ),
        node(
            "p1_ops",
            "<b>营运闭环</b><br>节假日 / 当日突发 → 需求预测<br>→ 预估单版本 / 明日调整<br>→ 分时段计划 → 实际发出 → 销售 / 报废",
            "orange",
            group="03_业务闭环",
            group_label="三条业务链共享同一身份",
            width=290,
            height=128,
            link="data:page/id,future-p2-operations",
        ),
        node(
            "p1_hr",
            "<b>人事与班表闭环</b><br>应聘评分 → 入职 → 培训资格<br>→ 班表需求 / 关键岗位 → 员工指派<br>→ Lark 实际工时 → 人效",
            "purple",
            group="03_业务闭环",
            width=290,
            height=128,
            link="data:page/id,future-p4-hr",
        ),
        node(
            "p1_scm",
            "<b>供应链与成本闭环</b><br>已发布计划 × 配方版本 → 原料需求<br>→ 库存 / 在途 → 订货增减 → 收货实价<br>→ 生效成本快照",
            "green",
            group="03_业务闭环",
            width=290,
            height=128,
            link="data:page/id,future-p3-scm-cost",
        ),
        node(
            "p1_facts",
            "<b>不可覆盖的实际事实</b><br>实际发出 ≠ 实际生产 ≠ POS 售出 ≠ 报废<br>计划班表 ≠ Lark 实际工时<br>历史毛利用当日有效成本，不用今天成本倒算",
            "teal",
            group="04_事实与决策",
            group_label="事实先分清，指标才可信",
            width=320,
            height=134,
        ),
        node(
            "p1_decision",
            "<b>老板每天看到的动作</b><br>① 明日产品计划增减　② 未来订货量增减<br>③ 关键岗位缺口　④ 产品占比升降<br>⑤ 当日毛利率 / 缺货 / 报废异常",
            "gold",
            group="04_事实与决策",
            width=320,
            height=132,
        ),
        node(
            "p1_rule",
            "<b>第一性原理结论</b><br>“一次录入”是一个事务写入多张正确粒度的表；<br>不是把预估、采购、班表、销售、工时塞进一张大表。",
            "red",
            group="05_验收",
            group_label="架构护栏与验收样本",
            width=320,
            height=110,
        ),
        node(
            "p1_sample",
            "<b>验收样本：黑巧 / 草莓塔</b><br>两款产品都必须从 product_id 追到：<br>预测 → 计划 → 配方 → 订货 → 售出 → 当日成本 → 毛利；<br>名称不一致时进入映射审核队列，绝不静默猜配。",
            "gray",
            group="05_验收",
            width=330,
            height=128,
        ),
    ]
    edges = [
        edge("p1_title", "p1_capture", style=INVISIBLE_EDGE),
        edge("p1_capture", "p1_identity", "一次提交，多表同事务"),
        edge("p1_identity", "p1_ops", "store_id + product_id"),
        edge("p1_identity", "p1_hr", "store_id + employment_id"),
        edge("p1_identity", "p1_scm", "product_id + material_id"),
        edge("p1_ops", "p1_scm", "已发布计划量", GREEN_EDGE),
        edge("p1_ops", "p1_facts", "计划 / 发出 / 销售 / 报废"),
        edge("p1_hr", "p1_facts", "计划班表 / 实际工时"),
        edge("p1_scm", "p1_facts", "当日有效单位成本"),
        edge("p1_facts", "p1_decision", "可靠指标"),
        edge("p1_decision", "p1_rule", "动作必须可追溯", DASHED_EDGE),
        edge("p1_rule", "p1_sample", "端到端验收"),
    ]
    return {"direction": "LR", "ranksep": 1.0, "nodesep": 0.65, "nodes": nodes, "edges": edges}


def operations_graph():
    g_source = "01_自动与人工输入"
    g_forecast = "02_预测"
    g_plan = "03_预估单与版本"
    g_actual = "04_执行与实际"
    g_output = "05_复盘输出"
    nodes = [
        title("p2_title", "营运闭环", "预估单不是一行可覆盖的数字，而是可追溯的预测、版本、执行和实际事实"),
        table("p2_cal_batch", "ops_calendar_import_batch", "官方节假日 / 校历抓取批次", "一次来源抓取", "batch_id", "blue", group=g_source, group_label="自动抓取 + 少量人工判断"),
        table("p2_cal_event", "ops_calendar_event", "节假日与经营日事件身份", "司法辖区 × 日期 × 事件", "calendar_event_id, date", "blue", group=g_source),
        table("p2_factor", "ops_demand_factor_observation", "事件发生后的实际需求影响", "门店 × 产品/品类 × 事件 × 观察窗", "store_id, product_id", "teal", group=g_source),
        table("p2_incident", "ops_operational_event + _product", "天气、停电、缺货、团单、设备等当日突发", "门店 × 时间段 × 事件；可挂产品", "store_id, event_id", "orange", group=g_source, width=270),
        node("p2_form", "<b>BakeryOps 人工只填</b><br>• 明日计划覆盖量 + 原因<br>• 当日突发事件<br>• 实际发出（没有自动源时）<br><font color='#7D2525'>不填：销售额、产品占比、毛利</font>", "red", group=g_source, width=270, height=134),
        table("p2_sales_history", "item_hourly_sales / item_waste", "POS 单品售出与报废实际", "门店 × 产品 × 小时/业务日", "store_id, product_id", "teal", group=g_source),
        table("p2_run", "ops_forecast_run", "每次算法运行与输入版本", "门店 × 目标日期 × 运行", "forecast_run_id, store_id", "orange", group=g_forecast, group_label="预测：每次运行留痕，不覆盖"),
        table("p2_line", "ops_forecast_line", "产品需求预测及上下界", "预测运行 × 产品", "forecast_run_id, product_id", "orange", group=g_forecast),
        table("p2_plan", "ops_production_plan", "某店某日的稳定计划身份", "门店 × 营业日", "plan_id, store_id, date", "orange", group=g_plan, group_label="预估单：版本化发布"),
        table("p2_version", "ops_production_plan_version", "草稿、提交、批准、发布的不可变版本", "计划 × 版本号", "plan_version_id, version_no", "orange", group=g_plan, height=124),
        table("p2_plan_line", "ops_production_plan_line", "每款产品的计划数量", "计划版本 × 产品", "plan_version_id, product_id", "orange", group=g_plan),
        table("p2_slot", "ops_production_plan_slot", "把产品计划拆到出品时段", "计划行 × 时间段", "plan_line_id, slot", "orange", group=g_plan),
        table("p2_adjust", "ops_plan_adjustment", "明日加减量动作与业务理由", "计划 × 产品 × 调整动作", "plan_id, product_id", "gold", group=g_plan),
        table("p2_dispatch", "ops_dispatch", "某店某日的一次实际发出批次", "门店 × 日期 × 发出批次", "dispatch_id, store_id", "teal", group=g_actual, group_label="执行事实：不能用计划代替实际"),
        table("p2_dispatch_line", "ops_dispatch_line", "实际发给前场的产品数量", "发出批次 × 产品", "dispatch_id, product_id", "teal", group=g_actual),
        table("p2_plan_vs", "v_ops_plan_vs_dispatch", "发布计划与实际发出的偏差", "门店 × 日期 × 产品", "store_id, date, product_id", "gold", group=g_output, group_label="自动计算的复盘与动作", dashed=True),
        table("p2_mix", "v_ops_product_mix_daily", "产品销量占比与环比升降", "门店 × 日期 × 产品", "store_id, date, product_id", "gold", group=g_output, dashed=True),
        table("p2_accuracy", "v_ops_forecast_accuracy", "预测、计划、实际销售的误差", "门店 × 日期 × 产品 × 预测版本", "forecast_run_id, product_id", "gold", group=g_output, dashed=True, height=124),
        node("p2_invariant", "<b>硬规则</b><br>预测 ≠ 已发布计划 ≠ 实际发出 ≠ 实际售出 ≠ 报废<br>空白 ≠ 0；任何更改生成新版本，不覆盖昨天的判断。", "red", group=g_output, width=290, height=120),
    ]
    edges = [
        edge("p2_title", "p2_cal_batch", style=INVISIBLE_EDGE),
        edge("p2_cal_batch", "p2_cal_event", "来源与抓取时间"),
        edge("p2_sales_history", "p2_factor", "观察实际影响"),
        edge("p2_cal_event", "p2_factor", "事件身份"),
        edge("p2_cal_event", "p2_run", "未来日期因素"),
        edge("p2_factor", "p2_run", "历史系数"),
        edge("p2_sales_history", "p2_run", "销量 / 报废历史", autoroute=True),
        edge("p2_incident", "p2_run", "已知经营影响", DASHED_EDGE, autoroute=True),
        edge("p2_form", "p2_incident", "记录当日事实"),
        edge("p2_run", "p2_line", "一对多"),
        edge("p2_plan", "p2_version", "版本序列"),
        edge("p2_line", "p2_version", "生成草稿"),
        edge("p2_form", "p2_adjust", "加减量 + 原因"),
        edge("p2_adjust", "p2_version", "产生新版本", RED_EDGE),
        edge("p2_version", "p2_plan_line", "发布快照"),
        edge("p2_plan_line", "p2_slot", "按时段拆分"),
        edge("p2_dispatch", "p2_dispatch_line", "一对多"),
        edge("p2_plan_line", "p2_dispatch_line", "执行对应计划", DASHED_EDGE),
        edge("p2_form", "p2_dispatch", "无自动源时确认"),
        edge("p2_plan_line", "p2_plan_vs", "计划量"),
        edge("p2_dispatch_line", "p2_plan_vs", "实际发出量"),
        edge("p2_sales_history", "p2_mix", "实际售出"),
        edge("p2_line", "p2_accuracy", "预测量"),
        edge("p2_plan_line", "p2_accuracy", "发布计划量"),
        edge("p2_sales_history", "p2_accuracy", "实际售出量", autoroute=True),
        edge("p2_plan_vs", "p2_invariant", "验证粒度"),
        edge("p2_mix", "p2_invariant", "产品结构"),
        edge("p2_accuracy", "p2_invariant", "持续校准"),
    ]
    return {"direction": "LR", "ranksep": 1.05, "nodesep": 0.55, "nodes": nodes, "edges": edges}


def supply_cost_graph():
    g_demand = "01_计划与配方"
    g_need = "02_原料需求与补货"
    g_buy = "03_采购与收货"
    g_cost = "04_成本与毛利"
    g_control = "05_人工边界与验收"
    nodes = [
        title("p3_title", "供应链 × 成本卡", "已发布产品计划要一路追到原料、订货变更、收货实价、当日成本和毛利"),
        table("p3_plan_line", "ops_production_plan_line", "已发布的产品计划数量", "计划版本 × 产品", "product_id, planned_qty", "orange", group=g_demand, group_label="产品需求：只认已发布计划"),
        table("p3_link", "cost_card_product_link", "可售产品到成本卡成品的人工确认桥", "产品 × 成本卡成品", "product_id, cost_card_item_id", "navy", group=g_demand, height=124),
        table("p3_recipe", "cost_card_recipe_version", "有生效期的配方版本", "成品 × 配方版本", "recipe_version_id, effective_from", "gold", group=g_demand),
        table("p3_recipe_item", "cost_card_recipe_version_item", "配方中每种原料及净用量", "配方版本 × 原料", "recipe_version_id, material_id", "gold", group=g_demand),
        table("p3_mr_run", "scm_material_requirement_run", "基于计划与配方的需求计算批次", "门店 × 目标日期 × 计算运行", "requirement_run_id, store_id", "green", group=g_need, group_label="未来原料需求与订货建议", height=124),
        table("p3_mr_line", "scm_material_requirement_line", "每种原料的毛需求", "需求运行 × 原料", "requirement_run_id, material_id", "green", group=g_need),
        table("p3_inventory", "scm_inventory_snapshot", "盘点时点的可用库存", "门店 × 原料 × 盘点时点", "store_id, material_id", "green", group=g_need),
        table("p3_replenish", "scm_replenishment_run + _line", "毛需求 − 库存 − 在途 + 安全库存；按包装/MOQ取整", "补货运行 × 原料", "replenishment_run_id, material_id", "green", group=g_need, width=280, height=132),
        table("p3_supplier_item", "scm_supplier_item", "供应商 SKU 到标准原料的映射", "供应商 × SKU", "supplier_id, supplier_sku, material_id", "navy", group=g_buy, group_label="订货修订和到货事实"),
        table("p3_po", "scm_purchase_order", "一张采购单的稳定身份与状态", "供应商 × 门店 × 采购单", "purchase_order_id", "green", group=g_buy),
        table("p3_po_revision", "scm_purchase_order_revision", "每次订货量增减、原因与审批", "采购单 × 版本号", "purchase_order_id, revision_no", "gold", group=g_buy, height=124),
        table("p3_po_line", "scm_purchase_order_line", "某版本下每种供应商物料的订货量", "采购单版本 × 供应商 SKU", "po_revision_id, supplier_item_id", "green", group=g_buy, height=124),
        table("p3_receipt", "scm_goods_receipt + _line", "实际到货数量、批次与采购实价", "收货单 × 采购行/原料", "receipt_id, material_id", "teal", group=g_buy, width=270, height=124),
        table("p3_price", "cost_card_item_price", "按来源与生效期保留的原料价格版本", "原料 × 价格版本", "material_id, effective_from", "gold", group=g_cost, group_label="成本历史和销售毛利", height=124),
        table("p3_cost_snapshot", "cost_card_product_cost_snapshot", "锁定当日配方与价格集后的单位成本", "产品 × 门店 × 日期 × 成本版本", "product_id, store_id, date", "gold", group=g_cost, height=132),
        table("p3_pos_sales", "item_hourly_sales / order_item", "POS 实际销量与实收收入", "门店 × 日期 × 产品", "store_id, product_id", "teal", group=g_cost),
        table("p3_margin", "v_ops_daily_product_margin", "当日收入、成本、毛利额与毛利率", "门店 × 日期 × 产品", "store_id, date, product_id", "gold", group=g_cost, dashed=True),
        node("p3_manual", "<b>人工只做业务判断</b><br>• 批准 suggested_qty → approved_qty<br>• 记录订货增减原因<br>• 无 WMS 时确认收货 / 异常<br><font color='#205C39'>需求、在途、成本汇总、毛利自动算</font>", "red", group=g_control, group_label="输入边界与业务验收", width=290, height=140),
        node("p3_finance", "<b>finance_supplier_* 的位置</b><br>用于月结、对账与报表；<br><font color='#7D2525'>不能反过来充当日常采购单和收货事实源</font>", "gray", group=g_control, width=280, height=112),
        node("p3_sample", "<b>黑巧 / 草莓塔验收</b><br>product_id 能准确追到配方版本、每种原料、订货与到货实价；<br>名称疑似错配时暂停计算并进入审核队列。", "red", group=g_control, width=300, height=126),
    ]
    edges = [
        edge("p3_title", "p3_plan_line", style=INVISIBLE_EDGE),
        edge("p3_plan_line", "p3_link", "product_id"),
        edge("p3_link", "p3_recipe", "成本卡成品"),
        edge("p3_recipe", "p3_recipe_item", "配方快照"),
        edge("p3_plan_line", "p3_mr_run", "发布计划量"),
        edge("p3_recipe_item", "p3_mr_run", "单位净用量"),
        edge("p3_mr_run", "p3_mr_line", "一对多"),
        edge("p3_mr_line", "p3_replenish", "毛需求"),
        edge("p3_inventory", "p3_replenish", "可用库存"),
        edge("p3_po_line", "p3_replenish", "未到货在途", DASHED_EDGE, autoroute=True),
        edge("p3_replenish", "p3_po", "生成 / 更新草案", autoroute=True),
        edge("p3_manual", "p3_po_revision", "批准数量 + 原因", RED_EDGE),
        edge("p3_po", "p3_po_revision", "不可变版本"),
        edge("p3_po_revision", "p3_po_line", "该版明细"),
        edge("p3_supplier_item", "p3_po_line", "供应商 SKU"),
        edge("p3_po_line", "p3_receipt", "对单收货"),
        edge("p3_manual", "p3_receipt", "无 WMS / 异常时确认"),
        edge("p3_receipt", "p3_price", "实际采购价候选", DASHED_EDGE, autoroute=True),
        edge("p3_recipe", "p3_cost_snapshot", "配方版本", autoroute=True),
        edge("p3_price", "p3_cost_snapshot", "当日有效价格"),
        edge("p3_pos_sales", "p3_margin", "销量与收入"),
        edge("p3_cost_snapshot", "p3_margin", "当日单位成本"),
        edge("p3_receipt", "p3_finance", "月结对账", DASHED_EDGE, autoroute=True),
        edge("p3_margin", "p3_sample", "端到端校验", autoroute=True),
        edge("p3_link", "p3_sample", "映射证据 / 状态", DASHED_EDGE, autoroute=True),
    ]
    return {"direction": "LR", "ranksep": 1.1, "nodesep": 0.55, "nodes": nodes, "edges": edges}


def hr_graph():
    g_people = "01_招聘与雇佣"
    g_training = "02_培训与任职资格"
    g_shift = "03_班表与关键岗位"
    g_actual = "04_实际工时与人效"
    g_manual = "05_人工边界"
    nodes = [
        title("p4_title", "人事 × 培训 × 班表", "人员链必须从应聘评分走到岗位资格、关键岗位指派、实际工时和人效"),
        table("p4_application", "applications / appointments / trials", "候选人、面试与试岗来源事实", "候选人 × 阶段事件", "candidate/application_id", "purple", group=g_people, group_label="从候选人到有效雇佣关系", width=270),
        table("p4_assessment", "hr_assessment", "一次结构化评分与结论", "候选人 × 评估轮次", "assessment_id, candidate_id", "purple", group=g_people),
        table("p4_score", "hr_assessment_item_score", "每个评分项、分值和证据", "评估 × 评分项", "assessment_id, item_id", "purple", group=g_people),
        table("p4_person", "hr_person", "同一个自然人的稳定身份", "一人一行", "person_id", "navy", group=g_people),
        table("p4_employment", "hr_employment", "人与门店/公司的一段雇佣关系", "人员 × 雇佣期间", "employment_id, person_id, store_id", "navy", group=g_people, height=124),
        table("p4_course", "hr_training_course", "岗位培训课程与有效期规则", "一个课程版本", "course_id, version", "purple", group=g_training, group_label="培训结果决定能不能上关键岗位"),
        table("p4_assignment", "hr_training_assignment", "某雇员被安排参加某课程", "雇佣关系 × 课程 × 批次", "employment_id, course_id", "purple", group=g_training),
        table("p4_result", "hr_training_result", "完成、分数、通过与证据", "培训安排 × 考核", "training_assignment_id", "purple", group=g_training),
        table("p4_role", "ops_role + ops_station", "标准岗位和工作站，不用自由文本", "岗位 / 工作站", "role_id, station_id", "orange", group=g_training),
        table("p4_requirement", "ops_role_training_requirement", "某岗位必须通过哪些课程", "岗位 × 课程", "role_id, course_id", "orange", group=g_training),
        table("p4_eligibility", "v_hr_role_eligibility", "某雇员当前可承担的岗位", "雇佣关系 × 岗位 × 日期", "employment_id, role_id", "gold", group=g_training, dashed=True),
        table("p4_shift_plan", "ops_shift_plan", "某店某日的稳定班表身份与版本", "门店 × 日期 × 班表版本", "shift_plan_id, store_id", "orange", group=g_shift, group_label="班表先写需求，再指派具体人", height=124),
        table("p4_shift_req", "ops_shift_requirement", "每时段需要多少岗位；关键岗位必须标明", "班表 × 时段 × 岗位 × 工作站", "shift_plan_id, role_id", "orange", group=g_shift, height=132),
        table("p4_shift_assign", "ops_shift_assignment", "具体员工的起止时间、岗位和工作站", "班表 × 雇佣关系 × 时间区间", "employment_id, role_id", "purple", group=g_shift, height=132),
        node("p4_gate", "<b>发布门禁</b><br>所有 is_critical = true 的需求都已指派；<br>且被指派者在该日期具备岗位资格。<br><font color='#7D2525'>不满足就不能发布班表。</font>", "red", group=g_shift, width=280, height=126),
        table("p4_sync", "hr_timesheet_sync_batch", "Lark 月度实际工时读取批次", "来源文件 × sheet × 读取时间", "batch_id, source", "blue", group=g_actual, group_label="实际工时与人效自动回读"),
        table("p4_time", "hr_timesheet_entry", "每天实际工作时长与来源单元格", "雇佣关系 × 门店 × 日期 × 工作区域/来源流", "employment_id, store_id, date", "teal", group=g_actual, width=290, height=140),
        table("p4_sales", "pos_daily_sales", "门店当日实际营收与单量", "门店 × 日期", "store_id, date", "teal", group=g_actual, dashed=True),
        table("p4_productivity", "v_ops_labor_productivity", "营收 / 实际工时、单量 / 实际工时", "门店 × 日期 × 工作区域", "store_id, date", "gold", group=g_actual, dashed=True, height=124),
        node("p4_manual", "<b>人工必须确认</b><br>• 面试 / 试岗评分与证据<br>• 培训通过结果<br>• 班表调整与关键岗位指派<br><font color='#493263'>实际工时从 Lark 读取；人效自动算</font>", "red", group=g_manual, group_label="只录判断，不重复抄结果", width=290, height=136),
        node("p4_rule", "<b>班表粒度</b><br>允许同一员工一天分段、跨工作区、多岗位；<br>不能只存“早班/晚班”文本，也不能把计划班表当实际工时。", "gray", group=g_manual, width=290, height=122),
    ]
    edges = [
        edge("p4_title", "p4_application", style=INVISIBLE_EDGE),
        edge("p4_application", "p4_assessment", "进入评估"),
        edge("p4_assessment", "p4_score", "一对多"),
        edge("p4_application", "p4_person", "去重建人"),
        edge("p4_person", "p4_employment", "一人多段雇佣"),
        edge("p4_employment", "p4_assignment", "安排培训"),
        edge("p4_course", "p4_assignment", "课程版本"),
        edge("p4_assignment", "p4_result", "考核结果"),
        edge("p4_role", "p4_requirement", "岗位"),
        edge("p4_course", "p4_requirement", "必修课程"),
        edge("p4_result", "p4_eligibility", "通过且在有效期"),
        edge("p4_requirement", "p4_eligibility", "资格规则"),
        edge("p4_shift_plan", "p4_shift_req", "人员需求"),
        edge("p4_shift_plan", "p4_shift_assign", "人员指派", autoroute=True),
        edge("p4_role", "p4_shift_req", "标准岗位 / 工作站", autoroute=True),
        edge("p4_employment", "p4_shift_assign", "具体雇佣关系", autoroute=True),
        edge("p4_eligibility", "p4_shift_assign", "可承担岗位", autoroute=True),
        edge("p4_shift_req", "p4_gate", "关键岗位覆盖"),
        edge("p4_shift_assign", "p4_gate", "人 / 时段 / 岗位"),
        edge("p4_eligibility", "p4_gate", "资格校验", RED_EDGE),
        edge("p4_sync", "p4_time", "逐日来源单元格"),
        edge("p4_shift_assign", "p4_time", "计划 vs 实际", DASHED_EDGE, autoroute=True),
        edge("p4_time", "p4_productivity", "实际工时"),
        edge("p4_sales", "p4_productivity", "实际营收 / 单量"),
    ]
    return {"direction": "LR", "ranksep": 1.05, "nodesep": 0.55, "nodes": nodes, "edges": edges}


def governance_graph():
    g_source = "01_来源标识"
    g_identity = "02_稳定身份与映射桥"
    g_facts = "03_分域事实"
    g_input = "04_人工与自动边界"
    g_governance = "05_数据库治理"
    nodes = [
        title("p5_title", "共享身份与治理", "跨表抓取速度来自稳定 ID、来源批次和单一写者；不是来自模糊名称或万能宽表"),
        node("p5_pos_source", "<b>RES / POS 标识</b><br>item_id、menu/listing_id、shop_id", "blue", group=g_source, group_label="外部系统的标识只作为来源身份", width=240),
        node("p5_cost_source", "<b>成本卡标识</b><br>cost_card_item_id、recipe_id", "gold", group=g_source, width=240),
        node("p5_supplier_source", "<b>供应商标识</b><br>supplier_code、supplier_sku", "green", group=g_source, width=240),
        node("p5_hr_source", "<b>Lark / 招聘标识</b><br>employee_no、open_id、application_id", "purple", group=g_source, width=240),
        node("p5_store_source", "<b>门店来源标识</b><br>RES shop_id、WMS store_code、人工旧名称", "gray", group=g_source, width=250),
        table("p5_store", "ops_store + ops_store_source_identity", "企业门店主键与各系统门店映射", "门店 / 来源系统门店", "store_id", "navy", group=g_identity, group_label="所有跨域关系只能走稳定 ID", width=290, height=124),
        table("p5_product", "pos_sellable_product", "企业层可售产品身份；product_id 是主轴", "一个业务可售产品", "product_id", "navy", group=g_identity, width=290),
        table("p5_listing", "pos_product", "不同菜单 / 门店 / 时段的 POS listing", "来源 listing", "listing_id, product_id", "blue", group=g_identity, width=290),
        table("p5_product_link", "cost_card_product_link", "product_id 到成本卡成品的证据化映射", "产品 × 成本卡成品", "product_id, cost_card_item_id", "gold", group=g_identity, width=290, height=124),
        table("p5_people", "hr_person + hr_employment + _source_identity", "人、雇佣关系及来源员工标识", "人员 / 雇佣期间 / 来源身份", "person_id, employment_id", "navy", group=g_identity, width=300, height=132),
        table("p5_material", "cost_card_item + scm_supplier_item", "标准原料及供应商 SKU 映射", "原料 / 供应商 SKU", "material_id, supplier_item_id", "navy", group=g_identity, width=290, height=124),
        node("p5_mapping_queue", "<b>分域映射审核队列</b><br>ops_product_mapping_review<br>hr_identity_mapping_review<br>scm_item_mapping_review<br><font color='#7D2525'>不确定就阻断，不静默猜配</font>", "red", group=g_identity, width=290, height=136),
        node("p5_contract", "<b>共享外键合同</b><br>store_id / product_id / employment_id / material_id<br><font color='#D8E8F7'>所有核心事实禁用 name join</font>", "navy", group=g_identity, width=300, height=116),
        node("p5_ops_fact", "<b>ops_ 营运事实</b><br>预测、计划版本、调整、班表、发出、事件<br><font color='#7A3E00'>键：store_id + product_id / employment_id</font>", "orange", group=g_facts, group_label="各域只写自己的事实", width=280, height=118),
        node("p5_pos_fact", "<b>pos_ 销售事实</b><br>订单、单品销量、报废、时段<br><font color='#175E5B'>键：store_id + product_id</font>", "teal", group=g_facts, width=270, height=112),
        node("p5_scm_fact", "<b>scm_ 供应链事实</b><br>库存、需求、补货、采购单版本、收货<br><font color='#205C39'>键：store_id + material_id</font>", "green", group=g_facts, width=280, height=120),
        node("p5_hr_fact", "<b>hr_ 人事事实</b><br>评估、雇佣、培训、实际工时<br><font color='#493263'>键：employment_id + store_id</font>", "purple", group=g_facts, width=270, height=112),
        node("p5_cost_fact", "<b>cost_card_ 成本事实</b><br>配方版本、价格版本、产品成本快照<br><font color='#6D5100'>键：product_id + material_id</font>", "gold", group=g_facts, width=280, height=120),
        node("p5_fact_bus", "<b>规范化核心事实</b><br>一表一个业务粒度；计划、实际、销售、工时互不覆盖", "gray", group=g_facts, width=290, height=108),
        node("p5_auto", "<b>自动采集</b><br>POS 销售/报废、官方节假日、Lark 实际工时、预测、成本汇总、毛利、产品占比", "blue", group=g_input, group_label="问：预估单和班表到底人工录什么？", width=290, height=124),
        node("p5_once", "<b>一次性人工确认</b><br>门店、产品、员工、供应商 SKU 与标准身份映射", "gray", group=g_input, width=290, height=110),
        node("p5_recurring", "<b>日常人工判断</b><br>计划覆盖量/原因、突发事件、关键岗位指派、评分、培训结果、订货批准、收货异常", "orange", group=g_input, width=300, height=132),
        node("p5_never", "<b>绝不人工重复录</b><br>销售额、总工时、产品占比、需求合计、成本合计、毛利率", "red", group=g_input, width=290, height=110),
        node("p5_provenance", "<b>每条事实的来源证据</b><br>source_system / source_record_id / batch_id<br>observed_at / effective_at / recorded_at", "gray", group=g_governance, group_label="没有来源、版本和责任人，就不是企业事实", width=300, height=122),
        node("p5_writer", "<b>一表一粒度一写者</b><br>res_api → pos_<br>BakeryOps → ops_ / hr_ / scm_<br>财务站 → finance_ / cost_card_ / app_", "gray", group=g_governance, width=300, height=132),
        node("p5_migration", "<b>schema_migrations</b><br>version + checksum + owner_repo + applied_at<br>advisory lock 串行执行；生产库无 staging，DDL 只走迁移", "red", group=g_governance, width=300, height=132),
        node("p5_marts", "<b>视图 / mart 后置</b><br>核心事实确认后再投影：毛利、人效、预测准确率、补货状态；<br>不靠一张宽表修复上游身份和粒度。", "gold", group=g_governance, width=310, height=132),
    ]
    edges = [
        edge("p5_title", "p5_pos_source", style=INVISIBLE_EDGE),
        edge("p5_pos_source", "p5_store", "shop_id"),
        edge("p5_store_source", "p5_store", "来源门店映射"),
        edge("p5_pos_source", "p5_listing", "listing / item"),
        edge("p5_listing", "p5_product", "归一 product_id"),
        edge("p5_cost_source", "p5_product_link", "成本卡成品", autoroute=True),
        edge("p5_product", "p5_product_link", "product_id"),
        edge("p5_hr_source", "p5_people", "来源员工身份"),
        edge("p5_supplier_source", "p5_material", "supplier_sku"),
        edge("p5_cost_source", "p5_material", "标准原料"),
        edge("p5_store", "p5_contract", "store_id"),
        edge("p5_product", "p5_contract", "product_id"),
        edge("p5_people", "p5_contract", "employment_id"),
        edge("p5_material", "p5_contract", "material_id"),
        edge("p5_pos_source", "p5_mapping_queue", "未映射 / 冲突", RED_EDGE),
        edge("p5_hr_source", "p5_mapping_queue", "重名 / 缺号", RED_EDGE),
        edge("p5_supplier_source", "p5_mapping_queue", "名称漂移", RED_EDGE),
        edge("p5_mapping_queue", "p5_product", "人工确认后生效", DASHED_EDGE),
        edge("p5_contract", "p5_ops_fact", "FK 合同"),
        edge("p5_contract", "p5_pos_fact", "FK 合同"),
        edge("p5_contract", "p5_scm_fact", "FK 合同"),
        edge("p5_contract", "p5_hr_fact", "FK 合同"),
        edge("p5_contract", "p5_cost_fact", "FK 合同"),
        edge("p5_ops_fact", "p5_fact_bus", "核心事实"),
        edge("p5_pos_fact", "p5_fact_bus", "核心事实"),
        edge("p5_scm_fact", "p5_fact_bus", "核心事实"),
        edge("p5_hr_fact", "p5_fact_bus", "核心事实"),
        edge("p5_cost_fact", "p5_fact_bus", "核心事实"),
        edge("p5_auto", "p5_provenance", "自动批次"),
        edge("p5_once", "p5_mapping_queue", "确认映射"),
        edge("p5_recurring", "p5_fact_bus", "业务动作与证据", autoroute=True),
        edge("p5_never", "p5_marts", "全部派生", DASHED_EDGE),
        edge("p5_writer", "p5_provenance", "责任边界"),
        edge("p5_provenance", "p5_marts", "可追溯输入"),
        edge("p5_migration", "p5_writer", "共享库变更治理", RED_EDGE),
        edge("p5_fact_bus", "p5_marts", "可追溯核心", autoroute=True),
    ]
    return {"direction": "LR", "ranksep": 1.05, "nodesep": 0.55, "nodes": nodes, "edges": edges}


PAGES = [
    ("future-p1-overview", "01 老板视角总览", overview_graph()),
    ("future-p2-operations", "02 营运：预估到复盘", operations_graph()),
    ("future-p3-scm-cost", "03 供应链：订货到毛利", supply_cost_graph()),
    ("future-p4-hr", "04 人事：评分到班表", hr_graph()),
    ("future-p5-governance", "05 共享身份与治理", governance_graph()),
]


def manual_overview_page():
    """A compact 16:10 executive overview.

    The other pages are large ER/workflow graphs and benefit from Graphviz.
    This page has only ten nodes, so a deliberate two-row composition is more
    readable than dot's very wide single pipeline.
    """
    graph = overview_graph()
    positions = {
        "p1_title": (40, 40),
        "p1_capture": (420, 40),
        "p1_identity": (780, 40),
        "p1_ops": (240, 250),
        "p1_scm": (600, 250),
        "p1_hr": (960, 250),
        "p1_facts": (600, 455),
        "p1_decision": (980, 455),
        "p1_sample": (600, 660),
        "p1_rule": (980, 660),
    }
    cells = []
    for item in graph["nodes"]:
        x, y = positions[item["id"]]
        body = (
            f'style="{al.attr(item["style"])}" vertex="1" parent="1">\n'
            f'          <mxGeometry x="{x}" y="{y}" width="{item["width"]}" '
            f'height="{item["height"]}" as="geometry"/>\n'
            "        </mxCell>"
        )
        if item.get("link"):
            cells.append(
                f'        <UserObject label="{al.attr(item["label"])}" '
                f'link="{al.attr(item["link"])}" id="{al.attr(item["id"])}">\n'
                f"          <mxCell {body}\n        </UserObject>"
            )
        else:
            cells.append(
                f'        <mxCell id="{al.attr(item["id"])}" '
                f'value="{al.attr(item["label"])}" {body}'
            )
    # Pin the executive page's branch connections so no line passes through a
    # neighbouring business card.  Coordinates are absolute page coordinates.
    route_specs = {
        1: ("exitX=1;exitY=0.5;entryX=0;entryY=0.5;", []),
        2: ("exitX=0.2;exitY=1;entryX=0.5;entryY=0;", [(844, 210), (385, 210)]),
        3: ("exitX=0.8;exitY=1;entryX=0.5;entryY=0;", [(1036, 210), (1105, 210)]),
        4: ("exitX=0.5;exitY=1;entryX=0.5;entryY=0;", [(940, 210), (745, 210)]),
        5: ("exitX=1;exitY=0.5;entryX=0;entryY=0.5;", []),
        6: ("exitX=0.5;exitY=1;entryX=0.2;entryY=0;", [(385, 420), (664, 420)]),
        7: ("exitX=0.5;exitY=1;entryX=0.8;entryY=0;", [(1105, 420), (856, 420)]),
        8: ("exitX=0.5;exitY=1;entryX=0.5;entryY=0;", []),
        9: ("exitX=1;exitY=0.5;entryX=0;entryY=0.5;", []),
        10: ("exitX=0.5;exitY=1;entryX=0.5;entryY=0;", []),
        11: ("exitX=0;exitY=0.5;entryX=1;entryY=0.5;", []),
    }
    for idx, item in enumerate(graph["edges"]):
        pinned, points = route_specs.get(idx, ("", []))
        label = "" if idx == 1 else item.get("label", "")
        if points:
            point_xml = "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in points)
            geometry = (
                '<mxGeometry relative="1" as="geometry">'
                f'<Array as="points">{point_xml}</Array></mxGeometry>'
            )
        else:
            geometry = '<mxGeometry relative="1" as="geometry"/>'
        cells.append(
            f'        <mxCell id="e{idx}" value="{al.attr(label)}" '
            f'style="{al.attr(item.get("style", EDGE) + pinned)}" edge="1" parent="1" '
            f'source="{al.attr(item["source"])}" target="{al.attr(item["target"])}">\n'
            f"          {geometry}\n"
            "        </mxCell>"
        )
    return (
        '  <diagram id="future-p1-overview" name="01 老板视角总览">\n'
        '    <mxGraphModel dx="1600" dy="900" grid="1" gridSize="10" guides="1" '
        'tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" '
        'pageWidth="1400" pageHeight="850" math="0" shadow="0">\n'
        "      <root>\n"
        '        <mxCell id="0"/>\n'
        '        <mxCell id="1" parent="0"/>\n'
        + "\n".join(cells)
        + "\n      </root>\n    </mxGraphModel>\n  </diagram>\n"
    )


def main():
    pages = []
    pages.append(manual_overview_page())
    print("01 老板视角总览: manual 10-node executive layout")
    for page_id, page_name, graph in PAGES[1:]:
        height, positions, edge_points = al.layout(al.build_dot(graph))
        edge_points = dict(edge_points)
        for item in graph["edges"]:
            if item.get("autoroute"):
                edge_points.pop((item["source"], item["target"]), None)
        cells = al.page_cells(graph, height, positions, edge_points, color=True)
        pages.append(al.wrap_page(cells, page_id=page_id, name=page_name))
        score = al.route_score(graph, height, positions, edge_points)
        print(f"{page_name}: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges, route score {score:.2f}")
    xml = (
        '<mxfile host="Electron" modified="2026-08-05T00:00:00.000Z" '
        'agent="HOT CRUSH drawio-skill" version="31.1.5" type="device">\n'
        + "".join(pages)
        + "</mxfile>\n"
    )
    OUTPUT.write_text(xml, encoding="utf-8")
    print(f"wrote {OUTPUT} ({len(PAGES)} pages)")


if __name__ == "__main__":
    main()
