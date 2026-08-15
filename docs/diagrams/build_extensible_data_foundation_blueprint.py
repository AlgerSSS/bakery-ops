#!/usr/bin/env python3
"""Build the review-only HOT CRUSH extensible data foundation blueprint."""

from __future__ import annotations

import json
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SKILL_ROOT = Path("/Users/weiliangshao/.codex/skills/drawio-skill")
AUTOLAYOUT = SKILL_ROOT / "scripts" / "autolayout.py"
OUTPUT = ROOT / "HOTCRUSH可扩展数据基座蓝图.drawio"


def box(fill: str, stroke: str, *, dashed: bool = False, bold: bool = False) -> str:
    extras = "dashed=1;dashPattern=6 4;" if dashed else ""
    font = "fontStyle=1;" if bold else ""
    return (
        "rounded=1;whiteSpace=wrap;html=1;arcSize=14;"
        f"fillColor={fill};strokeColor={stroke};strokeWidth=2;"
        f"fontColor=#1f2937;fontFamily=PingFang SC;fontSize=13;{extras}{font}"
    )


def database(fill: str, stroke: str) -> str:
    return (
        "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;"
        f"fillColor={fill};strokeColor={stroke};strokeWidth=2;"
        "fontColor=#1f2937;fontFamily=PingFang SC;fontSize=13;"
    )


TITLE = box("#1f2937", "#111827", bold=True) + "fontColor=#ffffff;fontSize=18;"
EXTERNAL = box("#f3f4f6", "#6b7280", dashed=True)
INGEST = box("#ffedd5", "#ea580c", bold=True)
ANCHOR = database("#dbeafe", "#2563eb")
ANCHOR_BOX = box("#dbeafe", "#2563eb", bold=True)
POS = database("#dcfce7", "#16a34a")
OPS = database("#e0f2fe", "#0284c7")
HR = database("#f3e8ff", "#9333ea")
SCM = database("#fef3c7", "#d97706")
COST = database("#fee2e2", "#dc2626")
FUTURE = database("#f3f4f6", "#6b7280") + "dashed=1;dashPattern=6 4;"
READ = box("#ede9fe", "#7c3aed", bold=True)
EVENT = box("#fef9c3", "#ca8a04", bold=True)
CONSUMER = box("#ecfccb", "#65a30d", bold=True)
GUARD = box("#fff1f2", "#e11d48", bold=True)
SUCCESS = box("#dcfce7", "#16a34a", bold=True)


def n(
    node_id: str,
    label: str,
    style: str,
    *,
    group: str | None = None,
    group_label: str | None = None,
    width: int = 190,
    height: int = 86,
) -> dict[str, object]:
    node: dict[str, object] = {
        "id": node_id,
        "label": label,
        "style": style,
        "width": width,
        "height": height,
    }
    if group:
        node["group"] = group
    if group_label:
        node["groupLabel"] = group_label
    return node


def e(source: str, target: str, label: str = "") -> dict[str, str]:
    edge = {"source": source, "target": target}
    if label:
        edge["label"] = label
    return edge


PAGE_1 = {
    "direction": "TB",
    "nodes": [
        n(
            "p1-title",
            "HOT CRUSH 可扩展数据基座\n单企业 · 多地点 · 多模块 · 分域单写",
            TITLE,
            width=420,
            height=82,
        ),
        n("p1-pos-source", "RES / POS\n销售、商品、会员", EXTERNAL, group="p1-source", group_label="01 外部来源"),
        n("p1-hr-source", "Lark / HR 来源\n人员、工时、文档", EXTERNAL, group="p1-source"),
        n("p1-scm-source", "供应商 / 市场 / 文件\n报价、采购、收货", EXTERNAL, group="p1-source"),
        n("p1-app-source", "BakeryOps / 财务站 / HBTI\n人工判断与业务动作", EXTERNAL, group="p1-source"),
        n(
            "p1-batch",
            "各域来源批次  *_ingest_batch\n来源窗口 · checksum · parser_version · 状态",
            INGEST,
            group="p1-intake",
            group_label="02 来源与追溯",
            width=290,
            height=94,
        ),
        n(
            "p1-source-map",
            "来源身份映射\nsource_system + external_id → 稳定 ID\n有效期 · 证据 · 确认状态",
            INGEST,
            group="p1-intake",
            width=290,
            height=108,
        ),
        n(
            "p1-location",
            "ops_location\n门店 / 厨房 / 仓库",
            ANCHOR,
            group="p1-anchor",
            group_label="03 稳定身份与经营时空",
        ),
        n("p1-day", "ops_business_day\n地点 × 经营日 × 时区边界", ANCHOR, group="p1-anchor"),
        n("p1-product", "ops_product\n企业产品", ANCHOR, group="p1-anchor"),
        n("p1-employment", "hr_person / hr_employment\n人员与雇佣关系", ANCHOR, group="p1-anchor"),
        n("p1-material", "cost_card_item\n成本项 / 原料身份", ANCHOR, group="p1-anchor"),
        n("p1-supplier", "scm_supplier / supplier_item\n供应商身份", ANCHOR, group="p1-anchor"),
        n("p1-role", "ops_role / ops_station\n岗位与工位", ANCHOR, group="p1-anchor"),
        n(
            "p1-anchor-contract",
            "共享连接契约\n稳定 ID · location_id · business_day_id\n外部名称和来源 ID 不参与跨域 JOIN",
            ANCHOR_BOX,
            group="p1-anchor",
            width=280,
            height=108,
        ),
        n(
            "p1-pos",
            "POS 域  pos_*\n来源商品 · 订单 / 聚合销售 · 报废\n唯一写者：res_api",
            POS,
            group="p1-domain",
            group_label="04 分域强类型事实",
            width=220,
            height=112,
        ),
        n(
            "p1-ops",
            "营运域  ops_*\n预测 · 计划 · 事件 · 生产执行\n唯一写者：BakeryOps",
            OPS,
            group="p1-domain",
            width=220,
            height=112,
        ),
        n(
            "p1-hr",
            "人事域  hr_*\n人员 · 雇佣 · 培训 · 实际工时\n唯一写者：HR / BakeryOps",
            HR,
            group="p1-domain",
            width=220,
            height=112,
        ),
        n(
            "p1-scm",
            "供应链域  scm_*\n库存 · 需求 · PO · 收货 · 报价\n唯一写者：BakeryOps / SCM",
            SCM,
            group="p1-domain",
            width=220,
            height=112,
        ),
        n(
            "p1-cost",
            "成本 / 财务域  cost_card_* / finance_*\n配方 · 价格 · 成本 · 会计事实\n唯一写者：财务站",
            COST,
            group="p1-domain",
            width=240,
            height=112,
        ),
        n(
            "p1-future",
            "未来模块  <domain>_*\n建立自己的强类型表\n复用共享身份与统一契约",
            FUTURE,
            group="p1-domain",
            width=220,
            height=112,
        ),
        n(
            "p1-publication",
            "各域发布面\n事实表 + 契约视图 + 本域 outbox\n内部实现可以独立演进",
            READ,
            group="p1-domain",
            width=250,
            height=108,
        ),
        n(
            "p1-bridge",
            "带真实 FK 的关系桥\n有效期 · 证据 · 确认状态\n禁止名称猜关联",
            READ,
            group="p1-serving",
            group_label="05 联动与统一读取层",
            width=230,
            height=104,
        ),
        n(
            "p1-contract",
            "分域契约视图  v_<domain>_*\n稳定列名与数据口径\n消费者不依赖内部表结构",
            READ,
            group="p1-serving",
            width=240,
            height=104,
        ),
        n(
            "p1-link-index",
            "v_entity_link_index\n统一关系导航\n只读，不承担外键约束",
            READ,
            group="p1-serving",
            width=220,
            height=104,
        ),
        n(
            "p1-timeline",
            "v_business_timeline\n按身份 / 地点 / 时间聚合事件\n为新功能和 AI 提供上下文",
            READ,
            group="p1-serving",
            width=230,
            height=104,
        ),
        n(
            "p1-outbox",
            "各域 outbox + 统一事件索引\n事件类型 · causation_id · payload_version\n触发联动，不直接跨域改表",
            EVENT,
            group="p1-serving",
            width=250,
            height=112,
        ),
        n("p1-bakeryops", "BakeryOps\n营运工作流", CONSUMER, group="p1-consumer", group_label="06 应用与新能力"),
        n("p1-finance", "财务网站\n成本与会计", CONSUMER, group="p1-consumer"),
        n("p1-hbti", "HBTI / 会员功能", CONSUMER, group="p1-consumer"),
        n("p1-ai", "AI / 报表 / 自动化", CONSUMER, group="p1-consumer"),
        n("p1-new-app", "未来新功能\n只接契约，不复制主数据", CONSUMER, group="p1-consumer", width=210),
    ],
    "edges": [
        e("p1-title", "p1-pos-source"),
        e("p1-title", "p1-hr-source"),
        e("p1-title", "p1-scm-source"),
        e("p1-title", "p1-app-source"),
        e("p1-pos-source", "p1-batch", "原始事实"),
        e("p1-hr-source", "p1-batch", "原始事实"),
        e("p1-scm-source", "p1-batch", "原始事实"),
        e("p1-app-source", "p1-batch", "业务动作"),
        e("p1-batch", "p1-source-map", "解析与匹配"),
        e("p1-source-map", "p1-anchor-contract", "确认后进入稳定身份层"),
        e("p1-location", "p1-day", "定义经营日"),
        e("p1-anchor-contract", "p1-pos"),
        e("p1-anchor-contract", "p1-ops"),
        e("p1-anchor-contract", "p1-hr"),
        e("p1-anchor-contract", "p1-scm"),
        e("p1-anchor-contract", "p1-cost"),
        e("p1-anchor-contract", "p1-future"),
        e("p1-pos", "p1-publication"),
        e("p1-ops", "p1-publication"),
        e("p1-hr", "p1-publication"),
        e("p1-scm", "p1-publication"),
        e("p1-cost", "p1-publication"),
        e("p1-future", "p1-publication"),
        e("p1-publication", "p1-contract"),
        e("p1-publication", "p1-outbox"),
        e("p1-publication", "p1-bridge"),
        e("p1-bridge", "p1-link-index"),
        e("p1-contract", "p1-timeline"),
        e("p1-outbox", "p1-timeline"),
        e("p1-contract", "p1-bakeryops"),
        e("p1-contract", "p1-finance"),
        e("p1-contract", "p1-hbti"),
        e("p1-link-index", "p1-ai"),
        e("p1-timeline", "p1-ai"),
        e("p1-contract", "p1-new-app"),
        e("p1-outbox", "p1-new-app", "订阅事件"),
    ],
}


PAGE_2 = {
    "direction": "TB",
    "nodes": [
        n(
            "p2-title",
            "统一数据契约：不是所有表字段相同，而是所有表属于明确的记录类型",
            TITLE,
            width=440,
            height=82,
        ),
        n(
            "p2-master",
            "A｜稳定身份主表\nPK id · immutable code · status\ncreated_at · valid_from / valid_to\n名称不是主键",
            ANCHOR_BOX,
            group="p2-archetype",
            group_label="01 四类基础记录",
            width=250,
            height=130,
        ),
        n(
            "p2-source",
            "B｜来源身份 / 批次\nsource_system · external_id\nsource_batch_id · checksum\nparser_version · mapping_status · evidence",
            INGEST,
            group="p2-archetype",
            width=260,
            height=142,
        ),
        n(
            "p2-fact",
            "C｜不可变事实 / 事件\n稳定身份 FK · location_id · business_day_id\noccurred_at · recorded_at · source_batch_id\nquality_status · correction_of_id",
            OPS,
            group="p2-archetype",
            width=280,
            height=150,
        ),
        n(
            "p2-revision",
            "D｜计划 / 规则 / 版本\nrevision_no · previous_revision_id\nstatus · reason · approved_at · published_at\n发布后不可原地覆盖",
            EVENT,
            group="p2-archetype",
            width=270,
            height=142,
        ),
        n(
            "p2-location",
            "地点线索\nlocation_id\n门店 / 厨房 / 仓库",
            ANCHOR,
            group="p2-anchor",
            group_label="02 所有模块可复用的连接点",
            width=205,
        ),
        n("p2-day", "经营日线索\nbusiness_day_id\n地点 × 日期 × 时区边界", ANCHOR, group="p2-anchor", width=215),
        n("p2-entity", "业务身份线索\nproduct / employment / material\nsupplier / role 等强类型 FK", ANCHOR, group="p2-anchor", width=235, height=96),
        n("p2-batch", "来源线索\nsource_batch_id\n外部 ID · 文件 · URL · hash", INGEST, group="p2-anchor", width=225, height=96),
        n("p2-cause", "因果线索\ncausation_id / previous_revision_id\n由什么计划、动作或事件产生", EVENT, group="p2-anchor", width=240, height=96),
        n(
            "p2-bridge",
            "强类型关系桥  <domain>_<a>_<b>\n真实 FK · relation_type\nvalid_from / valid_to · evidence · confirmed_by",
            READ,
            group="p2-link",
            group_label="03 关系、读取和联动",
            width=280,
            height=130,
        ),
        n(
            "p2-view",
            "契约视图  v_<domain>_*\n稳定字段、粒度、单位与质量状态\n内部改表不迫使消费者同步修改",
            READ,
            group="p2-link",
            width=270,
            height=130,
        ),
        n(
            "p2-outbox",
            "分域 outbox\nevent_type · aggregate_id · causation_id\npayload_version · occurred_at · published_at",
            EVENT,
            group="p2-link",
            width=270,
            height=130,
        ),
        n(
            "p2-index",
            "统一只读索引\nv_entity_link_index\nv_business_timeline\nv_data_quality_status",
            READ,
            group="p2-link",
            width=245,
            height=120,
        ),
        n("p2-no-name", "禁止\n按名称、手机号、自由文本做跨域 JOIN", GUARD, group="p2-guard", group_label="04 不可妥协的门禁", width=250, height=96),
        n("p2-no-eav", "禁止\n万能 entity / attribute / relation 表取代真实业务表", GUARD, group="p2-guard", width=260, height=96),
        n("p2-no-write", "禁止\n模块直接 UPDATE 其他域的权威事实", GUARD, group="p2-guard", width=250, height=96),
        n("p2-json", "JSONB 只保存\n原始快照、证据、低频扩展\n核心外键与查询字段必须是类型列", GUARD, group="p2-guard", width=270, height=106),
        n("p2-db-rules", "数据库强制\nFK 建索引 · numeric 精确金额\ntimestamptz 事件时间 · RLS · 最小权限", SUCCESS, group="p2-guard", width=270, height=106),
    ],
    "edges": [
        e("p2-title", "p2-master"),
        e("p2-title", "p2-source"),
        e("p2-title", "p2-fact"),
        e("p2-title", "p2-revision"),
        e("p2-source", "p2-master", "确认映射"),
        e("p2-location", "p2-fact"),
        e("p2-day", "p2-fact"),
        e("p2-entity", "p2-fact"),
        e("p2-batch", "p2-fact"),
        e("p2-cause", "p2-revision"),
        e("p2-master", "p2-bridge"),
        e("p2-fact", "p2-view"),
        e("p2-revision", "p2-view"),
        e("p2-fact", "p2-outbox", "提交同事务写事件"),
        e("p2-bridge", "p2-index"),
        e("p2-view", "p2-index"),
        e("p2-outbox", "p2-index"),
        e("p2-index", "p2-db-rules"),
        e("p2-no-name", "p2-db-rules", "阻止坏连接"),
        e("p2-no-eav", "p2-db-rules"),
        e("p2-no-write", "p2-db-rules"),
        e("p2-json", "p2-db-rules"),
    ],
}


PAGE_3 = {
    "direction": "TB",
    "nodes": [
        n(
            "p3-title",
            "未来新模块 X：按固定接入流程获得跨模块联动能力",
            TITLE,
            width=420,
            height=82,
        ),
        n("p3-owner", "1｜声明唯一写者\n确定 <domain>_ 前缀\n列出允许写入的表", INGEST, group="p3-flow", group_label="01 新模块接入九步", width=220, height=106),
        n("p3-anchor", "2｜选择共享锚点\nlocation / business_day\nproduct / employment / material…", ANCHOR_BOX, group="p3-flow", width=235, height=112),
        n("p3-table", "3｜建立强类型表\n一表一个事实粒度\nPK、FK、唯一约束、状态约束", OPS, group="p3-flow", width=235, height=112),
        n("p3-source", "4｜接入来源与追溯\n批次、外部 ID、hash\n解析版本与质量状态", INGEST, group="p3-flow", width=235, height=112),
        n("p3-bridge", "5｜增加必要关系桥\n只连接真实业务关系\n有效期、证据、确认人", READ, group="p3-flow", width=235, height=112),
        n("p3-view", "6｜发布契约视图\n稳定字段、粒度、单位\n缺失与估算状态显式输出", READ, group="p3-flow", width=235, height=112),
        n("p3-event", "7｜发布分域事件\noutbox 与事实同事务\n带 causation_id 与 payload_version", EVENT, group="p3-flow", width=245, height=112),
        n("p3-index", "8｜加入统一只读索引\n关系导航、业务时间线\n质量状态与来源追踪", READ, group="p3-flow", width=235, height=112),
        n("p3-security", "9｜收口权限并验收\n角色 / RLS / FK 索引\n契约测试、重放、幂等与对账", SUCCESS, group="p3-flow", width=240, height=112),
        n(
            "p3-write",
            "写入路径\n新模块只写 <domain>_* 与本域 outbox\n需要改变别的域 → 发布请求事件",
            EVENT,
            group="p3-path",
            group_label="02 联动边界",
            width=290,
            height=118,
        ),
        n(
            "p3-read",
            "读取路径\n共享身份 + 分域契约视图\n统一关系索引与时间线仅用于发现 / 查询",
            READ,
            group="p3-path",
            width=290,
            height=118,
        ),
        n(
            "p3-no-copy",
            "不允许\n复制一套自己的门店 / 产品 / 员工主数据\n直接读取其他域内部表并依赖私有列",
            GUARD,
            group="p3-path",
            width=300,
            height=118,
        ),
        n(
            "p3-result",
            "接入完成后的能力\n立即按地点、经营日和稳定身份联动既有模块\n内部实现可独立演进，不破坏其他消费者",
            SUCCESS,
            group="p3-result-group",
            group_label="03 扩展结果",
            width=360,
            height=128,
        ),
        n(
            "p3-mart",
            "需要新报表 / AI / 自动化时\n基于契约视图建立专用 view / materialized view / mart\n不反向污染权威事实层",
            CONSUMER,
            group="p3-result-group",
            width=370,
            height=128,
        ),
    ],
    "edges": [
        e("p3-title", "p3-owner"),
        e("p3-owner", "p3-anchor"),
        e("p3-anchor", "p3-table"),
        e("p3-table", "p3-source"),
        e("p3-source", "p3-bridge"),
        e("p3-bridge", "p3-view"),
        e("p3-view", "p3-event"),
        e("p3-event", "p3-index"),
        e("p3-index", "p3-security"),
        e("p3-table", "p3-write"),
        e("p3-view", "p3-read"),
        e("p3-no-copy", "p3-security", "门禁"),
        e("p3-write", "p3-result"),
        e("p3-read", "p3-result"),
        e("p3-security", "p3-result"),
        e("p3-result", "p3-mart", "按需扩展"),
    ],
}


PAGES = [
    ("01 总体连接骨架", PAGE_1),
    ("02 统一数据契约", PAGE_2),
    ("03 新模块快速接入", PAGE_3),
]


def build() -> None:
    if not AUTOLAYOUT.exists():
        raise SystemExit(f"missing drawio autolayout helper: {AUTOLAYOUT}")

    combined_root: ET.Element | None = None
    with tempfile.TemporaryDirectory(prefix="hotcrush-foundation-blueprint-") as tmp:
        tmpdir = Path(tmp)
        for index, (page_name, graph) in enumerate(PAGES, start=1):
            graph_path = tmpdir / f"page-{index}.json"
            page_path = tmpdir / f"page-{index}.drawio"
            graph_path.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
            subprocess.run(
                ["python3", str(AUTOLAYOUT), str(graph_path), "-o", str(page_path)],
                check=True,
            )

            page_root = ET.parse(page_path).getroot()
            diagram = page_root.find("diagram")
            if diagram is None:
                raise RuntimeError(f"autolayout did not create a diagram for page {index}")
            diagram.set("name", page_name)
            diagram.set("id", f"hotcrush-foundation-{index}")

            if combined_root is None:
                combined_root = ET.Element("mxfile", page_root.attrib)
                combined_root.set("pages", str(len(PAGES)))
            combined_root.append(diagram)

    if combined_root is None:
        raise RuntimeError("no pages generated")
    ET.ElementTree(combined_root).write(OUTPUT, encoding="utf-8", xml_declaration=True)
    print(f"wrote {OUTPUT} ({len(PAGES)} pages)")


if __name__ == "__main__":
    build()
