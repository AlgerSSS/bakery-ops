#!/usr/bin/env python3
"""Generate the editable HOT CRUSH future physical ERD.

This is a design artifact, not executable DDL.  The metadata below is the
auditable source for the 73 canonical tables, 16 key views, key columns,
foreign-key direction, ownership, and cross-page references described in the
approved transition plan.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from html import escape
import importlib.util
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parent
AUTOLAYOUT_PATH = Path.home() / ".codex/skills/drawio-skill/scripts/autolayout.py"
OUTPUT = ROOT / "HOTCRUSH未来数据库物理ERD.drawio"


def load_autolayout():
    spec = importlib.util.spec_from_file_location("drawio_autolayout", AUTOLAYOUT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {AUTOLAYOUT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


al = load_autolayout()


@dataclass(frozen=True)
class Column:
    marker: str
    name: str
    data_type: str
    ref: str | None = None
    optional: bool = False


@dataclass(frozen=True)
class Entity:
    name: str
    page: str
    group: str
    domain: str
    status: str
    grain: str
    writer: str
    columns: tuple[Column, ...]


@dataclass(frozen=True)
class View:
    name: str
    page: str
    group: str
    domain: str
    grain: str
    columns: tuple[str, ...]
    lineage: tuple[str, ...]


def C(marker: str, name: str, data_type: str, ref: str | None = None, optional: bool = False) -> Column:
    return Column(marker, name, data_type, ref, optional)


def E(
    name: str,
    page: str,
    group: str,
    domain: str,
    status: str,
    grain: str,
    writer: str,
    *columns: Column,
) -> Entity:
    return Entity(name, page, group, domain, status, grain, writer, tuple(columns))


def V(
    name: str,
    page: str,
    group: str,
    domain: str,
    grain: str,
    columns: tuple[str, ...],
    lineage: tuple[str, ...],
) -> View:
    return View(name, page, group, domain, grain, columns, lineage)


PAGE_INFO = {
    "p1": ("physical-p1-overview", "01｜总览与阅读导航", "数据库地基总览"),
    "p2": ("physical-p2-identity", "02｜共享身份与治理", "先统一身份，再允许跨域关联"),
    "p3": ("physical-p3-pos", "03｜POS 销售事实", "来源批次、销售粒度与条件明细"),
    "p4": ("physical-p4-ops-plan", "04｜营运预测与计划", "节假日 / 突发 → 预测 → 预估单版本"),
    "p5": ("physical-p5-ops-execution", "05｜营运执行与复盘", "实际产出、配送与计划差异"),
    "p6": ("physical-p6-hr", "06｜人事、入职与培训", "评分 → Offer → 入职 → 培训结果"),
    "p7": ("physical-p7-shift", "07｜班表、关键岗位与工时", "资格门禁 → 班表版本 → 实际工时"),
    "p8": ("physical-p8-scm", "08｜供应链与订货", "需求 → 库存 → 补货 → PO → 收货实价"),
    "p9": ("physical-p9-cost-margin", "09｜成本卡与当日毛利", "配方 / 采购价 → 成本快照 → 当日产品毛利"),
    "p10": ("physical-p10-finance", "10｜财务核对视图", "销售、采购、人工与毛利四条核对链"),
    "p11": ("physical-p11-e2e", "11｜端到端关系与写入边界", "黑巧 / 草莓塔示例与系统责任边界"),
}


EXTERNAL_REFS = {
    "RES/POS source": "RES 原始来源；由 res_api 抓取，不能直接当稳定主键",
    "BKPP holiday API": "政府节假日来源；先入批次与事件表，再参与预测",
    "applications": "现有招聘申请事实；本蓝图保留为来源对象",
    "Lark timesheet source": "Lark 工时表来源；原始值与解析值都保留",
    "finance_supplier_orders": "现有财务供应商订货事实；与 SCM 做核对而非混写",
    "finance_labor_detail": "现有财务人工成本事实；与 HR 工时做核对",
    "finance_sales_source": "现有财务销售口径；与 POS 做核对",
    "finance_statement_source": "现有财务报表 / 分录事实；保持财务网站写入权",
}


ENTITIES = [
    # Page 2 — shared identity and governance (11)
    E("schema_migrations", "p2", "01 迁移治理", "gov", "UPGRADE", "每个迁移版本一行", "各仓库迁移执行器",
      C("PK", "version", "bigint"), C("UQ", "filename", "text"), C("", "checksum", "text"),
      C("", "owner_repo", "text"), C("", "execution_id", "uuid"), C("", "verification_state", "text"),
      C("", "applied_at", "timestamptz")),
    E("app_audit_log", "p2", "01 迁移治理", "gov", "EXISTING", "每次受控写入 / 敏感动作一行", "受控函数 app_record_audit_event",
      C("PK", "id", "现有 PK"), C("", "actor_domain", "text"), C("", "actor_id", "text"),
      C("", "action", "text"), C("", "object_type", "text"), C("", "object_id", "text"),
      C("", "result", "text"), C("", "created_at", "timestamptz")),
    E("ops_store", "p2", "02 门店身份", "shared", "UPGRADE", "每个真实门店一行", "BakeryOps 管理员",
      C("PK", "store_id", "uuid（目标键）"), C("UQ", "store_code", "text（迁移期保留）"),
      C("", "store_name", "text"), C("", "timezone", "text"), C("", "status", "text")),
    E("ops_store_source_identity", "p2", "02 门店身份", "shared", "NEW", "来源系统 × 外部门店 ID × 有效期一行", "身份映射流程",
      C("PK", "store_source_identity_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("UQ", "source_system + source_external_id", "text"), C("", "valid_from", "timestamptz"),
      C("", "valid_to", "timestamptz", optional=True), C("", "status", "text")),
    E("pos_sellable_product", "p2", "03 商品身份", "shared", "NEW", "每个跨门店可售产品一行", "商品主数据流程",
      C("PK", "product_id", "uuid"), C("UQ", "product_code", "text"), C("", "canonical_name", "text"),
      C("", "category_code", "text"), C("", "status", "text")),
    E("pos_product", "p2", "03 商品身份", "shared", "UPGRADE", "来源商品 listing × 门店 × 有效期一行", "res_api + 映射审核",
      C("PK", "listing_id", "uuid"), C("FK", "product_id", "uuid", "pos_sellable_product"),
      C("FK", "store_id", "uuid", "ops_store", True), C("", "source_system", "text"),
      C("UQ", "source_listing_id", "text"), C("", "item_key", "text（旧键保留）"),
      C("", "effective_from / to", "timestamptz")),
    E("ops_product_mapping_review", "p2", "03 商品身份", "shared", "NEW", "每个待确认来源商品映射一行", "营运主数据审核",
      C("PK", "review_id", "uuid"), C("", "source_system", "text"), C("", "source_listing_id", "text"),
      C("FK?", "candidate_product_id", "uuid", "pos_sellable_product", True), C("", "status", "text"),
      C("", "reviewer_id", "text"), C("", "evidence", "jsonb")),
    E("hr_person", "p2", "04 人员身份", "shared", "NEW", "每个自然人一行", "HR 身份流程",
      C("PK", "person_id", "uuid"), C("", "display_name", "text"), C("UQ?", "normalized_phone_hash", "text"),
      C("", "status", "text")),
    E("hr_employment", "p2", "04 人员身份", "shared", "NEW", "每段雇佣关系一行", "HR",
      C("PK", "employment_id", "uuid"), C("FK", "person_id", "uuid", "hr_person"),
      C("FK", "store_id", "uuid", "ops_store"), C("UQ", "store_id + employee_no", "text"),
      C("", "source_job_title", "text"), C("", "start_date / end_date", "date"), C("", "status", "text")),
    E("hr_employment_source_identity", "p2", "04 人员身份", "shared", "NEW", "来源员工 ID × 雇佣关系 × 有效期一行", "HR 身份映射流程",
      C("PK", "employment_source_identity_id", "uuid"), C("FK", "employment_id", "uuid", "hr_employment"),
      C("UQ", "source_system + source_external_id", "text"), C("", "valid_from / to", "timestamptz"),
      C("", "status", "text")),
    E("hr_identity_mapping_review", "p2", "04 人员身份", "shared", "NEW", "每个待确认员工映射一行", "HR 审核",
      C("PK", "review_id", "uuid"), C("", "source_system", "text"), C("", "source_external_id", "text"),
      C("FK?", "candidate_person_id", "uuid", "hr_person", True),
      C("FK?", "candidate_employment_id", "uuid", "hr_employment", True),
      C("", "status", "text"), C("", "evidence", "jsonb")),

    # Page 3 — POS facts (8)
    E("pos_ingest_batch", "p3", "01 来源批次", "pos", "NEW", "一次来源抓取 / 文件导入一行", "res_api",
      C("PK", "batch_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("", "dataset_type", "text"), C("", "source_external_batch_id", "text"),
      C("", "window_start / end", "timestamptz"), C("", "expected / actual_rows", "integer"),
      C("", "checksum", "text"), C("", "status", "text")),
    E("pos_daily_revenue", "p3", "02 日销售事实", "pos", "NEW", "门店 × 营业日 × 抓取批次一行", "res_api",
      C("PK", "daily_revenue_id", "uuid"), C("FK", "batch_id", "uuid", "pos_ingest_batch"),
      C("FK", "store_id", "uuid", "ops_store"), C("UQ", "store_id + business_date + batch", "key"),
      C("", "business_date", "date"), C("", "currency", "char(3)"),
      C("", "gross_sales / net_sales", "numeric"), C("", "order_count", "integer")),
    E("pos_item_hourly_sales", "p3", "03 商品时段事实", "pos", "NEW", "门店 × 日期 × 小时 × 商品 × 批次一行", "res_api",
      C("PK", "hourly_sales_id", "uuid"), C("FK", "batch_id", "uuid", "pos_ingest_batch"),
      C("FK", "store_id", "uuid", "ops_store"), C("FK", "product_id", "uuid", "pos_sellable_product"),
      C("FK?", "listing_id", "uuid", "pos_product", True), C("", "business_date + hour", "date / smallint"),
      C("", "quantity", "numeric"), C("", "gross_sales / net_sales", "numeric")),
    E("pos_item_waste", "p3", "03 商品时段事实", "pos", "NEW", "门店 × 日期 × 商品 × 报废记录 / 批次一行", "res_api",
      C("PK", "waste_id", "uuid"), C("FK", "batch_id", "uuid", "pos_ingest_batch"),
      C("FK", "store_id", "uuid", "ops_store"), C("FK", "product_id", "uuid", "pos_sellable_product"),
      C("FK?", "listing_id", "uuid", "pos_product", True), C("", "business_date", "date"),
      C("", "quantity", "numeric"), C("", "reason_raw / reason_code", "text"), C("", "mapping_version", "text")),
    E("pos_order", "p3", "04 订单级事实（有稳定源 ID 才启用）", "pos", "CONDITIONAL", "每个来源订单一行", "res_api",
      C("PK", "order_id", "uuid"), C("FK", "batch_id", "uuid", "pos_ingest_batch"),
      C("FK", "store_id", "uuid", "ops_store"), C("UQ", "source_system + source_order_id", "text"),
      C("", "business_date", "date"), C("", "opened_at / closed_at", "timestamptz"),
      C("", "status", "text"), C("", "gross / discount / tax / net", "numeric")),
    E("pos_order_item", "p3", "04 订单级事实（有稳定源 ID 才启用）", "pos", "CONDITIONAL", "每个来源订单行一行", "res_api",
      C("PK", "order_item_id", "uuid"), C("FK", "order_id", "uuid", "pos_order"),
      C("UQ", "source_line_id", "text"), C("FK", "product_id", "uuid", "pos_sellable_product"),
      C("FK?", "listing_id", "uuid", "pos_product", True), C("", "quantity", "numeric"),
      C("", "gross / discount / net", "numeric")),
    E("pos_payment", "p3", "04 订单级事实（有稳定源 ID 才启用）", "pos", "CONDITIONAL", "每个来源支付记录一行", "res_api",
      C("PK", "payment_id", "uuid"), C("FK", "order_id", "uuid", "pos_order"),
      C("UQ", "source_payment_id", "text"), C("", "payment_method", "text"),
      C("", "amount", "numeric"), C("", "currency", "char(3)"), C("", "status", "text")),
    E("pos_refund", "p3", "04 订单级事实（有稳定源 ID 才启用）", "pos", "CONDITIONAL", "每个来源退款记录一行", "res_api",
      C("PK", "refund_id", "uuid"), C("FK", "order_id", "uuid", "pos_order"),
      C("FK?", "order_item_id", "uuid", "pos_order_item", True), C("UQ", "source_refund_id", "text"),
      C("", "quantity", "numeric"), C("", "amount", "numeric"), C("", "reason", "text"),
      C("", "occurred_at", "timestamptz")),

    # Page 4 — calendar, forecast, production plan (12)
    E("ops_calendar_import_batch", "p4", "01 外部因素", "ops", "NEW", "一次节假日来源抓取一行", "BakeryOps 抓取任务",
      C("PK", "batch_id", "uuid"), C("", "source_url", "text"), C("", "content_hash", "text"),
      C("", "fetched_at", "timestamptz"), C("", "parser_version", "text"), C("", "status", "text"),
      C("", "approved_by", "text", optional=True)),
    E("ops_calendar_event", "p4", "01 外部因素", "ops", "NEW", "辖区 × 日期 × 节假日事件一行", "BakeryOps 抓取任务 + 审核",
      C("PK", "calendar_event_id", "uuid"), C("FK", "batch_id", "uuid", "ops_calendar_import_batch"),
      C("", "jurisdiction", "text"), C("", "event_date", "date"), C("", "event_type", "text"),
      C("", "event_name", "text"), C("", "status", "text")),
    E("ops_demand_factor_observation", "p4", "01 外部因素", "ops", "NEW", "事件 × 门店 × 商品 / 类别 × 观察窗口一行", "预测评估任务",
      C("PK", "observation_id", "uuid"), C("FK", "calendar_event_id", "uuid", "ops_calendar_event"),
      C("FK", "store_id", "uuid", "ops_store"), C("FK?", "product_id", "uuid", "pos_sellable_product", True),
      C("", "category_code", "text", optional=True), C("", "window_start / end", "date"),
      C("", "observed_factor", "numeric"), C("", "sample_size", "integer")),
    E("ops_operational_event", "p4", "01 外部因素", "ops", "NEW", "一次门店突发 / 运营事件一行", "门店人工录入",
      C("PK", "operational_event_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("", "event_type", "text"), C("", "started_at / ended_at", "timestamptz"),
      C("", "impact_direction", "text"), C("", "evidence", "jsonb"), C("", "status", "text")),
    E("ops_operational_event_product", "p4", "01 外部因素", "ops", "NEW", "运营事件 × 受影响商品一行", "门店人工录入",
      C("PK", "event_product_id", "uuid"), C("FK", "operational_event_id", "uuid", "ops_operational_event"),
      C("FK", "product_id", "uuid", "pos_sellable_product"), C("", "impact_quantity", "numeric", optional=True),
      C("", "note", "text", optional=True)),
    E("ops_forecast_run", "p4", "02 需求预测", "ops", "NEW", "门店 × 目标日期 × 一次预测运行一行", "BakeryOps 预测任务",
      C("PK", "forecast_run_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("", "target_date", "date"), C("", "algorithm_version", "text"), C("", "input_version_manifest", "jsonb"),
      C("", "status", "text"), C("", "started_at / completed_at", "timestamptz")),
    E("ops_forecast_line", "p4", "02 需求预测", "ops", "NEW", "预测运行 × 商品一行", "BakeryOps 预测任务",
      C("PK", "forecast_line_id", "uuid"), C("FK", "forecast_run_id", "uuid", "ops_forecast_run"),
      C("FK", "product_id", "uuid", "pos_sellable_product"), C("", "forecast_quantity", "numeric"),
      C("", "lower_bound / upper_bound", "numeric"), C("", "explanation", "jsonb")),
    E("ops_production_plan", "p4", "03 门店预估单", "ops", "NEW", "门店 × 计划日期一行", "BakeryOps",
      C("PK", "production_plan_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("UQ", "store_id + plan_date", "key"), C("", "plan_date", "date"), C("", "status", "text")),
    E("ops_production_plan_version", "p4", "03 门店预估单", "ops", "NEW", "预估单 × 版本号一行", "BakeryOps + 审批人",
      C("PK", "plan_version_id", "uuid"), C("FK", "production_plan_id", "uuid", "ops_production_plan"),
      C("FK?", "forecast_run_id", "uuid", "ops_forecast_run", True), C("UQ", "plan_id + version_no", "key"),
      C("", "version_no", "integer"), C("", "source_type / source_sha", "text"),
      C("", "status", "text"), C("", "approved_at / published_at", "timestamptz", optional=True)),
    E("ops_production_plan_line", "p4", "03 门店预估单", "ops", "NEW", "预估单版本 × 商品一行", "BakeryOps",
      C("PK", "plan_line_id", "uuid"), C("FK", "plan_version_id", "uuid", "ops_production_plan_version"),
      C("FK", "product_id", "uuid", "pos_sellable_product"), C("UQ", "version + product", "key"),
      C("", "planned_quantity", "numeric"), C("", "unit", "text")),
    E("ops_production_plan_slot", "p4", "03 门店预估单", "ops", "NEW", "预估单商品行 × 生产时段一行", "BakeryOps",
      C("PK", "plan_slot_id", "uuid"), C("FK", "plan_line_id", "uuid", "ops_production_plan_line"),
      C("", "slot_start / slot_end", "time"), C("", "planned_quantity", "numeric")),
    E("ops_plan_adjustment", "p4", "04 明日调整动作", "ops", "NEW", "一次版本间商品调整动作一行", "门店 / 区域营运人工确认",
      C("PK", "adjustment_id", "uuid"), C("FK", "production_plan_id", "uuid", "ops_production_plan"),
      C("FK", "base_version_id", "uuid", "ops_production_plan_version"),
      C("FK", "new_version_id", "uuid", "ops_production_plan_version"),
      C("FK", "product_id", "uuid", "pos_sellable_product"), C("", "quantity_delta", "numeric"),
      C("", "reason_code / note", "text"), C("", "status / actor_id", "text")),

    # Page 5 — actual output and dispatch (4)
    E("ops_production_output", "p5", "01 实际产出", "ops", "NEW", "门店 × 营业日 × 一次实际产出批次一行", "BakeryOps / 生产导入",
      C("PK", "production_output_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("FK?", "plan_version_id", "uuid", "ops_production_plan_version", True), C("", "business_date", "date"),
      C("", "source_type / evidence", "text / jsonb"), C("", "occurred_at", "timestamptz")),
    E("ops_production_output_line", "p5", "01 实际产出", "ops", "NEW", "实际产出批次 × 商品一行", "BakeryOps / 生产导入",
      C("PK", "output_line_id", "uuid"), C("FK", "production_output_id", "uuid", "ops_production_output"),
      C("FK", "product_id", "uuid", "pos_sellable_product"), C("", "output_quantity", "numeric"),
      C("", "waste_quantity", "numeric", optional=True), C("", "note", "text", optional=True)),
    E("ops_dispatch", "p5", "02 配送事实", "ops", "NEW", "门店 × 营业日 × 一次发出 / 到店批次一行", "BakeryOps / 配送导入",
      C("PK", "dispatch_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("FK?", "production_output_id", "uuid", "ops_production_output", True), C("", "business_date", "date"),
      C("", "source_type", "text"), C("", "dispatched_by / received_by", "text"),
      C("", "occurred_at", "timestamptz")),
    E("ops_dispatch_line", "p5", "02 配送事实", "ops", "NEW", "配送批次 × 商品一行", "BakeryOps / 配送导入",
      C("PK", "dispatch_line_id", "uuid"), C("FK", "dispatch_id", "uuid", "ops_dispatch"),
      C("FK", "product_id", "uuid", "pos_sellable_product"), C("", "dispatch_quantity", "numeric"),
      C("", "note", "text", optional=True)),

    # Page 6 — HR, onboarding, training (8)
    E("hr_assessment", "p6", "01 招聘评分", "hr", "NEW", "一次候选人评估轮次一行", "HR / 面试官",
      C("PK", "assessment_id", "uuid"), C("FK?", "person_id", "uuid", "hr_person", True),
      C("FK", "application_id", "现有键", "applications"), C("", "template_version", "text"),
      C("", "round_no", "integer"), C("", "total_score", "numeric"), C("", "decision", "text"),
      C("", "assessed_at", "timestamptz")),
    E("hr_assessment_item_score", "p6", "01 招聘评分", "hr", "NEW", "评估 × 评分项一行", "HR / 面试官",
      C("PK", "item_score_id", "uuid"), C("FK", "assessment_id", "uuid", "hr_assessment"),
      C("", "item_code", "text"), C("", "score / max_score", "numeric"), C("", "evidence", "text")),
    E("hr_offer", "p6", "02 Offer 与入职", "hr", "UPGRADE", "每个 Offer 版本一行", "HR",
      C("PK", "offer_id", "uuid"), C("FK", "person_id", "uuid", "hr_person"),
      C("FK", "store_id", "uuid", "ops_store"), C("FK", "application_id", "现有键", "applications"),
      C("", "version_no", "integer"), C("", "position_code / salary_basis", "text"),
      C("", "status", "text"), C("", "issued_at / accepted_at", "timestamptz", optional=True)),
    E("hr_onboarding_task", "p6", "02 Offer 与入职", "hr", "NEW", "雇佣关系 × 入职任务一行", "HR / 任务负责人",
      C("PK", "onboarding_task_id", "uuid"), C("FK", "employment_id", "uuid", "hr_employment"),
      C("", "task_code", "text"), C("", "owner_id", "text"), C("", "due_date", "date"),
      C("", "status", "text"), C("", "completed_at", "timestamptz", optional=True), C("", "evidence", "jsonb", optional=True)),
    E("hr_training_course", "p6", "03 培训主数据", "hr", "NEW", "每门培训课程一行", "HR / 培训负责人",
      C("PK", "course_id", "uuid"), C("UQ", "course_code", "text"), C("", "course_name", "text"), C("", "status", "text")),
    E("hr_training_course_version", "p6", "03 培训主数据", "hr", "NEW", "课程 × 版本一行", "HR / 培训负责人",
      C("PK", "course_version_id", "uuid"), C("FK", "course_id", "uuid", "hr_training_course"),
      C("UQ", "course_id + version_no", "key"), C("", "effective_from / to", "date"),
      C("", "pass_score", "numeric"), C("", "valid_days", "integer", optional=True), C("", "status", "text")),
    E("hr_training_assignment", "p6", "04 培训事实", "hr", "NEW", "雇佣关系 × 课程版本 × 一次指派一行", "HR / 店长",
      C("PK", "training_assignment_id", "uuid"), C("FK", "employment_id", "uuid", "hr_employment"),
      C("FK", "course_version_id", "uuid", "hr_training_course_version"), C("", "assigned_at", "timestamptz"),
      C("", "due_at", "timestamptz", optional=True), C("", "status", "text")),
    E("hr_training_result", "p6", "04 培训事实", "hr", "NEW", "培训指派 × 考试尝试一行", "HR / 培训系统",
      C("PK", "training_result_id", "uuid"), C("FK", "training_assignment_id", "uuid", "hr_training_assignment"),
      C("", "attempt_no", "integer"), C("", "score", "numeric"), C("", "passed", "boolean"),
      C("", "completed_at", "timestamptz"), C("", "valid_until", "date", optional=True), C("", "evidence", "jsonb", optional=True)),

    # Page 7 — shift and timesheet (9)
    E("ops_role", "p7", "01 岗位与资格", "ops", "NEW", "每个标准岗位一行", "BakeryOps 管理员",
      C("PK", "role_id", "uuid"), C("UQ", "role_code", "text"), C("", "role_name", "text"), C("", "status", "text")),
    E("ops_station", "p7", "01 岗位与资格", "ops", "NEW", "每个标准工位 / 工作区域一行", "BakeryOps 管理员",
      C("PK", "station_id", "uuid"), C("UQ", "station_code", "text"), C("", "station_name", "text"),
      C("", "work_area", "text"), C("", "status", "text")),
    E("ops_role_training_requirement", "p7", "01 岗位与资格", "ops", "NEW", "岗位 × 必修课程一行", "HR + 营运共同维护",
      C("PK", "role_training_requirement_id", "uuid"), C("FK", "role_id", "uuid", "ops_role"),
      C("FK", "course_id", "uuid", "hr_training_course"), C("", "is_required", "boolean"),
      C("", "valid_days_override", "integer", optional=True)),
    E("ops_shift_plan", "p7", "02 班表计划", "ops", "NEW", "门店 × 班表日期一行", "BakeryOps",
      C("PK", "shift_plan_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("UQ", "store_id + shift_date", "key"), C("", "shift_date", "date"), C("", "status", "text")),
    E("ops_shift_plan_version", "p7", "02 班表计划", "ops", "NEW", "班表 × 版本号一行", "BakeryOps + 审批人",
      C("PK", "shift_plan_version_id", "uuid"), C("FK", "shift_plan_id", "uuid", "ops_shift_plan"),
      C("UQ", "shift_plan_id + version_no", "key"), C("", "version_no", "integer"),
      C("", "source_type / source_sha", "text"), C("", "status", "text"),
      C("", "approved_at / published_at", "timestamptz", optional=True)),
    E("ops_shift_requirement", "p7", "02 班表计划", "ops", "NEW", "班表版本 × 岗位 × 工位 × 时段一行", "店长 / 营运",
      C("PK", "shift_requirement_id", "uuid"), C("FK", "shift_plan_version_id", "uuid", "ops_shift_plan_version"),
      C("FK", "role_id", "uuid", "ops_role"), C("FK", "station_id", "uuid", "ops_station"),
      C("", "starts_at / ends_at", "timestamptz"), C("", "required_headcount", "integer"),
      C("", "is_critical", "boolean")),
    E("ops_shift_assignment", "p7", "02 班表计划", "ops", "NEW", "班表需求 × 员工指派一行", "店长 / 营运",
      C("PK", "shift_assignment_id", "uuid"), C("FK", "shift_requirement_id", "uuid", "ops_shift_requirement"),
      C("FK", "employment_id", "uuid", "hr_employment"), C("", "starts_at / ends_at", "timestamptz"),
      C("", "status", "text")),
    E("hr_timesheet_sync_batch", "p7", "03 实际工时", "hr", "NEW", "一次 Lark 文档 / sheet 同步一行", "BakeryOps Lark 同步任务",
      C("PK", "timesheet_batch_id", "uuid"), C("", "source_document_id", "text"),
      C("", "source_sheet_name / month", "text"), C("", "content_hash", "text"),
      C("", "parser_version", "text"), C("", "read_at", "timestamptz"), C("", "status", "text")),
    E("hr_timesheet_entry", "p7", "03 实际工时", "hr", "NEW", "员工 × 日期 × 工作区域 / 来源流一行", "BakeryOps Lark 同步任务",
      C("PK", "timesheet_entry_id", "uuid"), C("FK", "timesheet_batch_id", "uuid", "hr_timesheet_sync_batch"),
      C("FK", "employment_id", "uuid", "hr_employment"), C("FK", "store_id", "uuid", "ops_store"),
      C("", "work_date", "date"), C("", "work_area / source_stream", "text"),
      C("", "raw_value", "text"), C("", "reported_hours", "numeric"),
      C("", "net_work_minutes", "integer", optional=True), C("", "attendance_status", "text")),

    # Page 8 — supply chain (14)
    E("scm_supplier", "p8", "01 供应商主数据", "scm", "NEW", "每个供应商一行", "供应链",
      C("PK", "supplier_id", "uuid"), C("UQ", "supplier_code", "text"), C("", "supplier_name", "text"),
      C("", "currency", "char(3)"), C("", "status", "text")),
    E("scm_supplier_item", "p8", "01 供应商主数据", "scm", "NEW", "供应商 × 原料 / SKU × 有效期一行", "供应链",
      C("PK", "supplier_item_id", "uuid"), C("FK", "supplier_id", "uuid", "scm_supplier"),
      C("FK", "material_id", "uuid", "cost_card_item"), C("UQ", "supplier_id + supplier_sku", "key"),
      C("", "purchase_unit / pack_quantity", "text / numeric"), C("", "moq / lead_time_days", "numeric"),
      C("", "effective_from / to", "date")),
    E("scm_item_mapping_review", "p8", "01 供应商主数据", "scm", "NEW", "供应商原始描述 × 待确认原料一行", "供应链审核",
      C("PK", "review_id", "uuid"), C("FK", "supplier_id", "uuid", "scm_supplier"),
      C("", "raw_item_description", "text"), C("FK?", "candidate_material_id", "uuid", "cost_card_item", True),
      C("", "conversion_factor", "numeric", optional=True), C("", "status", "text"), C("", "evidence", "jsonb")),
    E("scm_material_requirement_run", "p8", "02 原料需求", "scm", "NEW", "门店 × 目标日期 × 一次物料需求计算一行", "BakeryOps / 供应链任务",
      C("PK", "requirement_run_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("FK", "plan_version_id", "uuid", "ops_production_plan_version"), C("", "target_date", "date"),
      C("", "recipe_set_version", "text"), C("", "algorithm_version", "text"), C("", "status", "text")),
    E("scm_material_requirement_line", "p8", "02 原料需求", "scm", "NEW", "物料需求运行 × 原料一行", "BakeryOps / 供应链任务",
      C("PK", "requirement_line_id", "uuid"), C("FK", "requirement_run_id", "uuid", "scm_material_requirement_run"),
      C("FK", "material_id", "uuid", "cost_card_item"), C("", "gross_required_qty", "numeric"),
      C("", "net_required_qty", "numeric"), C("", "unit", "text"), C("", "conversion_evidence", "jsonb")),
    E("scm_inventory_snapshot", "p8", "03 库存与补货", "scm", "NEW", "门店 × 原料 × 盘点时点一行", "供应链 / 门店盘点",
      C("PK", "inventory_snapshot_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("FK", "material_id", "uuid", "cost_card_item"), C("", "counted_at", "timestamptz"),
      C("", "on_hand / reserved / available", "numeric"), C("", "source_batch", "text"), C("", "status", "text")),
    E("scm_replenishment_run", "p8", "03 库存与补货", "scm", "NEW", "门店 × 目标日期 × 一次补货计算一行", "供应链任务",
      C("PK", "replenishment_run_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("FK", "requirement_run_id", "uuid", "scm_material_requirement_run"),
      C("FK?", "inventory_snapshot_id", "uuid", "scm_inventory_snapshot", True),
      C("", "target_date", "date"), C("", "algorithm_version", "text"), C("", "status", "text")),
    E("scm_replenishment_line", "p8", "03 库存与补货", "scm", "NEW", "补货运行 × 原料一行", "供应链 + 审批人",
      C("PK", "replenishment_line_id", "uuid"), C("FK", "replenishment_run_id", "uuid", "scm_replenishment_run"),
      C("FK", "material_id", "uuid", "cost_card_item"), C("FK?", "supplier_item_id", "uuid", "scm_supplier_item", True),
      C("", "suggested_qty / approved_qty", "numeric"), C("", "quantity_delta", "numeric"),
      C("", "reason_code / note", "text"), C("", "pack_moq_evidence", "jsonb")),
    E("scm_purchase_order", "p8", "04 采购订单", "scm", "NEW", "每张采购订单一行", "供应链",
      C("PK", "purchase_order_id", "uuid"), C("FK", "store_id", "uuid", "ops_store"),
      C("FK", "supplier_id", "uuid", "scm_supplier"), C("UQ", "po_number", "text"),
      C("", "status", "text"), C("", "created_at", "timestamptz")),
    E("scm_purchase_order_revision", "p8", "04 采购订单", "scm", "NEW", "采购订单 × 版本号一行", "供应链 + 审批人",
      C("PK", "po_revision_id", "uuid"), C("FK", "purchase_order_id", "uuid", "scm_purchase_order"),
      C("UQ", "purchase_order_id + version_no", "key"), C("", "version_no", "integer"),
      C("", "status", "text"), C("", "commercial_terms", "jsonb"),
      C("", "approved_at / sent_at", "timestamptz", optional=True)),
    E("scm_purchase_order_line", "p8", "04 采购订单", "scm", "NEW", "采购订单版本 × 供应商商品一行", "供应链",
      C("PK", "po_line_id", "uuid"), C("FK", "po_revision_id", "uuid", "scm_purchase_order_revision"),
      C("FK", "supplier_item_id", "uuid", "scm_supplier_item"), C("FK", "material_id", "uuid", "cost_card_item"),
      C("FK?", "replenishment_line_id", "uuid", "scm_replenishment_line", True),
      C("", "ordered_qty / purchase_unit", "numeric / text"), C("", "unit_price / currency", "numeric / char(3)")),
    E("scm_goods_receipt", "p8", "05 收货与实价", "scm", "NEW", "一次采购收货单一行", "供应链 / 门店收货",
      C("PK", "goods_receipt_id", "uuid"), C("FK", "purchase_order_id", "uuid", "scm_purchase_order"),
      C("FK", "store_id", "uuid", "ops_store"), C("FK", "supplier_id", "uuid", "scm_supplier"),
      C("UQ", "source_receipt_id", "text"), C("", "received_at", "timestamptz"),
      C("", "status", "text"), C("", "document_hash", "text")),
    E("scm_goods_receipt_line", "p8", "05 收货与实价", "scm", "NEW", "收货单 × PO 行 / 原料一行", "供应链 / 门店收货",
      C("PK", "receipt_line_id", "uuid"), C("FK", "goods_receipt_id", "uuid", "scm_goods_receipt"),
      C("FK", "po_line_id", "uuid", "scm_purchase_order_line"), C("FK", "material_id", "uuid", "cost_card_item"),
      C("", "received_qty / rejected_qty", "numeric"), C("", "unit", "text"),
      C("", "actual_unit_price", "numeric"), C("", "batch_no / expiry_date", "text / date", optional=True)),
    E("scm_supplier_price_observation", "p8", "05 收货与实价", "scm", "NEW", "一次已确认供应商原料价格观察一行", "供应链收货确认",
      C("PK", "price_observation_id", "uuid"), C("FK", "receipt_line_id", "uuid", "scm_goods_receipt_line"),
      C("FK", "supplier_item_id", "uuid", "scm_supplier_item"), C("FK", "material_id", "uuid", "cost_card_item"),
      C("", "observed_unit_price", "numeric"), C("", "purchase_unit / currency", "text / char(3)"),
      C("", "observed_at", "timestamptz"), C("", "status", "text")),

    # Page 9 — cost cards and margin (7)
    E("cost_card_item", "p9", "01 原料与产品成本身份", "cost", "UPGRADE", "每个成本卡物料 / 成品一行", "财务网站（本仓库只读）",
      C("PK", "id", "bigint（现有键保留）"), C("UQ", "material_id", "uuid（跨域新键）"),
      C("", "item_type", "text"), C("", "item_name", "text"), C("", "base_unit", "text"), C("", "status", "text")),
    E("cost_card_recipe", "p9", "02 配方版本", "cost", "EXISTING", "成品成本项 × 配方版本一行", "财务网站（本仓库只读）",
      C("PK", "id", "bigint"), C("FK", "item_id", "bigint", "cost_card_item"),
      C("UQ", "item_id + version_no", "key"), C("", "version_no", "integer"),
      C("", "effective_from / to", "date"), C("", "yield_quantity / unit", "numeric / text"), C("", "status", "text")),
    E("cost_card_recipe_item", "p9", "02 配方版本", "cost", "EXISTING", "配方版本 × 原料组成一行", "财务网站（本仓库只读）",
      C("PK", "id", "bigint"), C("FK", "recipe_id", "bigint", "cost_card_recipe"),
      C("FK", "component_item_id", "bigint", "cost_card_item"), C("", "quantity / unit", "numeric / text"),
      C("", "yield_factor / loss_rate", "numeric")),
    E("cost_card_item_price", "p9", "03 生效采购价", "cost", "UPGRADE", "原料 × 供应商 / 门店 × 价格有效期一行", "财务网站（供应链提供事实）",
      C("PK", "id", "bigint"), C("FK", "item_id", "bigint", "cost_card_item"),
      C("FK?", "supplier_item_id", "uuid", "scm_supplier_item", True), C("FK?", "store_id", "uuid", "ops_store", True),
      C("FK?", "source_price_observation_id", "uuid", "scm_supplier_price_observation", True),
      C("", "unit_price / currency", "numeric / char(3)"), C("", "purchase_unit / conversion_factor", "text / numeric"),
      C("", "effective_from / to", "timestamptz"), C("", "status", "text")),
    E("cost_card_product_link", "p9", "01 原料与产品成本身份", "cost", "UPGRADE", "可售产品 × 成本卡成品 × 有效期一行", "财务网站 + 主数据审核",
      C("PK", "product_link_id", "bigint / uuid"), C("FK", "product_id", "uuid", "pos_sellable_product"),
      C("FK", "cost_card_item_id", "bigint", "cost_card_item"), C("", "valid_from / to", "date"),
      C("", "status", "text"), C("", "evidence", "jsonb")),
    E("cost_card_product_cost_snapshot", "p9", "04 成本快照", "cost", "NEW", "产品 × 门店 × 生效日期 × 成本版本一行", "财务网站成本计算任务",
      C("PK", "cost_snapshot_id", "uuid"), C("FK", "product_id", "uuid", "pos_sellable_product"),
      C("FK?", "store_id", "uuid", "ops_store", True), C("FK", "product_link_id", "bigint / uuid", "cost_card_product_link"),
      C("FK", "recipe_id", "bigint", "cost_card_recipe"), C("", "effective_date", "date"),
      C("", "unit_cost / currency", "numeric / char(3)"), C("", "coverage / confidence", "numeric"),
      C("", "calculation_version", "text")),
    E("cost_card_product_cost_snapshot_component", "p9", "04 成本快照", "cost", "NEW", "成本快照 × 原料组成一行", "财务网站成本计算任务",
      C("PK", "snapshot_component_id", "uuid"), C("FK", "cost_snapshot_id", "uuid", "cost_card_product_cost_snapshot"),
      C("FK", "material_item_id", "bigint", "cost_card_item"), C("FK", "item_price_id", "bigint", "cost_card_item_price"),
      C("", "net_quantity / loss_rate", "numeric"), C("", "unit_price", "numeric"), C("", "cost_amount", "numeric")),
]


VIEWS = [
    V("v_pos_daily_sales", "p3", "05 POS 标准口径", "pos", "门店 × 营业日一行",
      ("store_id, business_date", "gross / discount / refund / net", "order_count, data_quality_state"),
      ("pos_daily_revenue", "pos_order", "pos_payment", "pos_refund")),
    V("v_pos_source_reconciliation", "p3", "05 POS 标准口径", "pos", "来源批次 × 数据集一行",
      ("batch_id, store_id, dataset_type", "expected_rows, actual_rows", "variance, reconciliation_state"),
      ("pos_ingest_batch", "pos_daily_revenue", "pos_item_hourly_sales", "pos_item_waste")),
    V("v_ops_plan_vs_output", "p5", "03 执行复盘视图", "ops", "门店 × 日期 × 商品 × 计划版本一行",
      ("store_id, date, product_id", "planned_qty, output_qty", "variance_qty, variance_pct"),
      ("ops_production_plan_line", "ops_production_output_line")),
    V("v_ops_output_vs_dispatch", "p5", "03 执行复盘视图", "ops", "门店 × 日期 × 商品一行",
      ("store_id, date, product_id", "output_qty, dispatch_qty", "variance_qty"),
      ("ops_production_output_line", "ops_dispatch_line")),
    V("v_ops_plan_vs_dispatch", "p5", "03 执行复盘视图", "ops", "门店 × 日期 × 商品 × 计划版本一行",
      ("store_id, date, product_id", "planned_qty, dispatch_qty", "variance_qty, variance_reason"),
      ("ops_production_plan_line", "ops_dispatch_line", "ops_plan_adjustment")),
    V("v_ops_product_mix_daily", "p5", "04 销售运营事实", "ops", "门店 × 日期 × 商品一行",
      ("store_id, date, product_id", "quantity, net_sales", "mix_pct, prior_mix_pct, delta_pct"),
      ("pos_item_hourly_sales", "pos_order_item")),
    V("v_ops_forecast_accuracy", "p5", "04 销售运营事实", "ops", "预测运行 × 门店 × 日期 × 商品一行",
      ("forecast_run_id, product_id", "forecast_qty, actual_qty", "error, abs_pct_error", "stockout / event flags"),
      ("ops_forecast_line", "ops_production_plan_line", "ops_dispatch_line", "pos_item_hourly_sales", "ops_operational_event")),
    V("v_hr_role_eligibility", "p7", "04 班表门禁视图", "hr", "雇佣关系 × 岗位 × 评估时点一行",
      ("employment_id, role_id, as_of", "is_eligible, expires_at", "missing_course, reason"),
      ("hr_employment", "ops_role_training_requirement", "hr_training_result")),
    V("v_ops_shift_publish_readiness", "p7", "04 班表门禁视图", "ops", "班表版本一行",
      ("shift_plan_version_id", "critical_required / assigned", "qualified_assigned, conflicts", "is_publishable, reasons"),
      ("ops_shift_plan_version", "ops_shift_requirement", "ops_shift_assignment", "v_hr_role_eligibility")),
    V("v_ops_labor_productivity", "p7", "05 人效视图", "ops", "门店 × 日期 × 工作区域一行",
      ("store_id, date, work_area", "net_sales, order_count", "reported_hours, net_hours", "sales_per_hour, quality_state"),
      ("hr_timesheet_entry", "v_pos_daily_sales", "finance_labor_detail")),
    V("v_ops_daily_product_margin", "p9", "05 毛利与财务视图", "cost", "门店 × 日期 × 商品一行",
      ("store_id, date, product_id", "quantity, net_sales, unit_cost", "cogs, gross_profit, gross_margin_pct", "cost_coverage / confidence"),
      ("v_ops_product_mix_daily", "cost_card_product_cost_snapshot")),
    V("v_cost_card_item_cost_quality", "p9", "05 毛利与财务视图", "cost", "原料 / 产品 × 评估时点一行",
      ("material_id / product_id", "price_age, conversion_state", "recipe_coverage, missing_components", "quality_state"),
      ("cost_card_item", "cost_card_recipe_item", "cost_card_item_price", "cost_card_product_cost_snapshot_component")),
    V("v_finance_sales_reconciliation", "p10", "01 销售核对", "finance", "门店 × 营业日一行",
      ("store_id, business_date", "pos_net_sales, finance_sales", "variance, reconciliation_state"),
      ("v_pos_daily_sales", "finance_sales_source")),
    V("v_finance_purchase_reconciliation", "p10", "02 采购核对", "finance", "供应商 × PO / 收货单一行",
      ("supplier_id, po_number", "scm_ordered / received", "finance_ordered / received", "variance, state"),
      ("scm_purchase_order_line", "scm_goods_receipt_line", "finance_supplier_orders")),
    V("v_finance_labor_reconciliation", "p10", "03 人工核对", "finance", "门店 × 月 × 员工一行",
      ("store_id, month, employment_id", "hr_hours, finance_hours / cost", "variance, reconciliation_state"),
      ("hr_timesheet_entry", "finance_labor_detail")),
    V("v_finance_margin_summary", "p10", "04 毛利核对", "finance", "门店 × 日期 / 月一行",
      ("store_id, period", "net_sales, calculated_cogs", "booked_cogs, gross_profit", "variance, coverage, state"),
      ("v_ops_daily_product_margin", "finance_statement_source")),
]


TABLE_BY_NAME = {entity.name: entity for entity in ENTITIES}
VIEW_BY_NAME = {view.name: view for view in VIEWS}


DOMAIN_COLORS = {
    "gov": ("#F5F6F8", "#59636F", "#27313D"),
    "shared": ("#EAF2FF", "#4A74B5", "#17324D"),
    "pos": ("#E6F7F6", "#2E8B88", "#175E5B"),
    "ops": ("#FFF1E8", "#D97706", "#7A3E00"),
    "hr": ("#F3EDFA", "#7C5AA6", "#493263"),
    "scm": ("#EAF7EE", "#3F8F5B", "#205C39"),
    "cost": ("#FFF7DD", "#B88916", "#6D5100"),
    "finance": ("#FDECEC", "#C94A4A", "#7D2525"),
}


STATUS_COLORS = {
    "EXISTING": "#4B5563",
    "UPGRADE": "#9A6700",
    "NEW": "#18794E",
    "CONDITIONAL": "#B42318",
}


TITLE_STYLE = (
    "rounded=1;arcSize=10;whiteSpace=wrap;html=1;fillColor=#17324D;"
    "strokeColor=#17324D;fontColor=#FFFFFF;align=left;verticalAlign=middle;"
    "fontSize=22;fontStyle=1;spacingLeft=18;spacingRight=18;strokeWidth=2;"
)
NOTE_STYLE = (
    "shape=note;whiteSpace=wrap;html=1;fillColor=#FFFDF3;strokeColor=#B88916;"
    "fontColor=#5F4B12;align=left;verticalAlign=middle;fontSize=12;"
    "spacingLeft=12;spacingRight=12;spacingTop=8;spacingBottom=8;"
)
REF_STYLE = (
    "rounded=1;arcSize=8;whiteSpace=wrap;html=1;fillColor=#F8FAFC;"
    "strokeColor=#94A3B8;fontColor=#475569;align=left;verticalAlign=middle;"
    "fontSize=11;spacingLeft=9;spacingRight=9;dashed=1;dashPattern=6 4;"
)
ER_EDGE = (
    "edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jettySize=auto;html=1;rounded=0;"
    "startArrow=ERmany;startFill=0;endArrow=ERone;endFill=0;"
    "strokeColor=#637083;strokeWidth=1.35;fontColor=#3E4650;fontSize=10;"
    "labelBackgroundColor=#FFFFFF;"
)
OPTIONAL_ER_EDGE = ER_EDGE + "dashed=1;dashPattern=5 4;"
VIEW_EDGE = (
    "edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jettySize=auto;html=1;rounded=0;"
    "startArrow=none;endArrow=open;endFill=0;strokeColor=#967A22;strokeWidth=1.2;"
    "dashed=1;dashPattern=6 4;fontColor=#6D5100;fontSize=10;labelBackgroundColor=#FFFFFF;"
)
FLOW_EDGE = (
    "edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;jettySize=auto;html=1;rounded=0;"
    "endArrow=block;endFill=1;strokeColor=#4A74B5;strokeWidth=1.8;"
    "fontColor=#17324D;fontSize=11;labelBackgroundColor=#FFFFFF;"
)
INVISIBLE_EDGE = "endArrow=none;strokeOpacity=0;html=1;"


def safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]+", "_", value).strip("_")


def page_link(page: str) -> str:
    return f"data:page/id,{PAGE_INFO[page][0]}"


def object_page(name: str) -> str | None:
    if name in TABLE_BY_NAME:
        return TABLE_BY_NAME[name].page
    if name in VIEW_BY_NAME:
        return VIEW_BY_NAME[name].page
    return None


def object_group(name: str) -> str | None:
    if name in TABLE_BY_NAME:
        return TABLE_BY_NAME[name].group
    if name in VIEW_BY_NAME:
        return VIEW_BY_NAME[name].group
    return None


def node(
    ident: str,
    label: str,
    *,
    style: str,
    width: int,
    height: int,
    group: str | None = None,
    link: str | None = None,
    group_label: str | None = None,
) -> dict:
    item = {"id": ident, "label": label, "style": style, "width": width, "height": height}
    if group:
        item["group"] = group
    if link:
        item["link"] = link
    if group_label:
        item["groupLabel"] = group_label
    return item


def edge(source: str, target: str, label: str = "", style: str = ER_EDGE) -> dict:
    return {"source": source, "target": target, "label": label, "style": style}


def title_node(page: str, subtitle: str) -> dict:
    _, page_name, heading = PAGE_INFO[page]
    label = (
        f"{escape(heading)}<br>"
        f"<font style='font-size:12px;font-weight:normal'>{escape(page_name)} · {escape(subtitle)}</font>"
    )
    return node(f"{page}_title", label, style=TITLE_STYLE, width=440, height=105)


def table_style(entity: Entity) -> str:
    fill, stroke, font = DOMAIN_COLORS[entity.domain]
    extra = ""
    if entity.status == "CONDITIONAL":
        stroke = "#C94A4A"
        extra = "dashed=1;dashPattern=7 4;strokeWidth=2.2;"
    return (
        "rounded=0;whiteSpace=wrap;html=1;align=left;verticalAlign=top;"
        f"fillColor={fill};strokeColor={stroke};fontColor={font};"
        "fontSize=11;spacingLeft=9;spacingRight=9;spacingTop=7;spacingBottom=7;"
        f"strokeWidth=1.6;{extra}"
    )


def table_label(entity: Entity) -> str:
    badge_color = STATUS_COLORS[entity.status]
    rows = [
        f"<b>{escape(entity.name)}</b> <font color='{badge_color}'><b>[{entity.status}]</b></font>",
        f"<font color='#64748B'>粒度：{escape(entity.grain)}</font>",
        "<font color='#CBD5E1'>────────────────────</font>",
    ]
    marker_colors = {"PK": "#B42318", "FK": "#1D4ED8", "FK?": "#7C3AED", "UQ": "#9A6700", "UQ?": "#9A6700"}
    for column in entity.columns:
        marker = escape(column.marker or "·")
        marker_color = marker_colors.get(column.marker, "#64748B")
        optional = " ?" if column.optional and not column.marker.endswith("?") else ""
        ref = f" → {escape(column.ref)}" if column.ref else ""
        rows.append(
            f"<font color='{marker_color}'><b>{marker}{optional}</b></font> "
            f"{escape(column.name)} <font color='#64748B'>: {escape(column.data_type)}{ref}</font>"
        )
    rows.extend([
        "<font color='#CBD5E1'>────────────────────</font>",
        f"<font color='#64748B'>写入者：{escape(entity.writer)}</font>",
    ])
    return "<br>".join(rows)


def table_node(page: str, entity: Entity) -> dict:
    height = 80 + 18 * len(entity.columns) + 27
    return node(
        f"{page}_tbl_{safe_id(entity.name)}",
        table_label(entity),
        style=table_style(entity),
        width=340,
        height=height,
        group=entity.group,
    )


def view_node(page: str, view: View) -> dict:
    fill, stroke, font = DOMAIN_COLORS[view.domain]
    style = (
        "rounded=1;arcSize=8;whiteSpace=wrap;html=1;align=left;verticalAlign=top;"
        f"fillColor={fill};strokeColor={stroke};fontColor={font};fontSize=11;"
        "spacingLeft=9;spacingRight=9;spacingTop=7;spacingBottom=7;strokeWidth=1.6;"
        "dashed=1;dashPattern=4 3;"
    )
    rows = [
        f"<b>{escape(view.name)}</b> <font color='#967A22'><b>[VIEW]</b></font>",
        f"<font color='#64748B'>粒度：{escape(view.grain)}</font>",
        "<font color='#CBD5E1'>────────────────────</font>",
    ]
    rows.extend(f"<font color='#64748B'>• {escape(column)}</font>" for column in view.columns)
    rows.append("<font color='#64748B'>只读派生，不作为事实写入口</font>")
    return node(
        f"{page}_view_{safe_id(view.name)}",
        "<br>".join(rows),
        style=style,
        width=340,
        height=105 + 18 * len(view.columns),
        group=view.group,
    )


def ref_node(page: str, name: str, source_group: str) -> dict:
    target_page = object_page(name)
    if target_page:
        target_name = PAGE_INFO[target_page][1]
        target_group = object_group(name)
        if target_page == page and target_group:
            description = f"完整定义见本页「{target_group}」"
        else:
            description = f"完整定义见 {target_name}"
        link = page_link(target_page)
    else:
        description = EXTERNAL_REFS[name]
        link = None
    return node(
        f"{page}_ref_{safe_id(name)}_{safe_id(source_group)}",
        f"<b>REF · {escape(name)}</b><br><font color='#64748B'>{escape(description)}</font>",
        style=REF_STYLE,
        width=245,
        height=76,
        group=source_group,
        link=link,
    )


PAGE_EXTRA_EDGES = {
    "p3": (("pos_ingest_batch", "RES/POS source", "source batch", "lineage"),),
    "p4": (("ops_calendar_import_batch", "BKPP holiday API", "fetch + checksum", "lineage"),),
    "p7": (("hr_timesheet_sync_batch", "Lark timesheet source", "read-only sync", "lineage"),),
    "p8": (("scm_purchase_order", "finance_supplier_orders", "reconcile later", "lineage"),),
}


PAGE_SUBTITLES = {
    "p2": "跨域只认 store_id / product_id / employment_id / material_id；名称只能展示，不能猜连接",
    "p3": "聚合事实永远可用；订单、支付、退款四表只有 RES 提供稳定来源 ID 时才启用",
    "p4": "计划与班表都必须版本化；人工只确认业务判断，外部节假日自动抓取并留证据",
    "p5": "计划、实际产出、配送、销售是四种不同事实，任何两个都不能互相冒充",
    "p6": "评分、Offer、入职任务和培训结果各保留自己的事实粒度，不能塞进一张员工表",
    "p7": "关键岗位必须写明；未满足培训资格或关键岗位缺人时，班表版本不能发布",
    "p8": "订货量来自计划 × 配方 − 库存 / 在途，并由 PO 版本与实际收货价闭环",
    "p9": "历史配方和价格不覆盖；销售按当日生效成本快照计算毛利，覆盖不足必须标为估算",
    "p10": "财务事实保持原写入边界；通过只读核对视图比较 POS、SCM、HR 与财务口径",
}


def resolve_node_id(page: str, name: str, source_group: str, refs: set[tuple[str, str]]) -> str:
    if name in TABLE_BY_NAME and TABLE_BY_NAME[name].page == page and TABLE_BY_NAME[name].group == source_group:
        return f"{page}_tbl_{safe_id(name)}"
    if name in VIEW_BY_NAME and VIEW_BY_NAME[name].page == page and VIEW_BY_NAME[name].group == source_group:
        return f"{page}_view_{safe_id(name)}"
    refs.add((name, source_group))
    return f"{page}_ref_{safe_id(name)}_{safe_id(source_group)}"


def detail_graph(page: str) -> dict:
    page_tables = [entity for entity in ENTITIES if entity.page == page]
    page_views = [view for view in VIEWS if view.page == page]
    nodes = [title_node(page, PAGE_SUBTITLES[page])]
    nodes.extend(table_node(page, entity) for entity in page_tables)
    nodes.extend(view_node(page, view) for view in page_views)

    refs: set[tuple[str, str]] = set()
    edge_buckets: dict[tuple[str, str, str], list[str]] = {}

    def collect(source: str, source_group: str, target_name: str, label: str, kind: str) -> None:
        target = resolve_node_id(page, target_name, source_group, refs)
        edge_buckets.setdefault((source, target, kind), []).append(label)

    for entity in page_tables:
        source = f"{page}_tbl_{safe_id(entity.name)}"
        for column in entity.columns:
            if not column.ref:
                continue
            kind = "optional_fk" if column.optional or column.marker.endswith("?") else "fk"
            collect(source, entity.group, column.ref, column.name, kind)

    for view in page_views:
        source = f"{page}_view_{safe_id(view.name)}"
        for dependency in view.lineage:
            collect(source, view.group, dependency, "reads", "lineage")

    for source_name, target_name, label, kind in PAGE_EXTRA_EDGES.get(page, ()): 
        source_group = TABLE_BY_NAME[source_name].group if source_name in TABLE_BY_NAME else VIEW_BY_NAME[source_name].group
        source = resolve_node_id(page, source_name, source_group, refs)
        collect(source, source_group, target_name, label, kind)

    nodes.extend(ref_node(page, name, source_group) for name, source_group in sorted(refs))

    edges: list[dict] = []
    for (source, target, kind), labels in edge_buckets.items():
        label = " / ".join(dict.fromkeys(labels))
        style = ER_EDGE if kind == "fk" else OPTIONAL_ER_EDGE if kind == "optional_fk" else VIEW_EDGE
        edges.append(edge(source, target, label, style))

    # Anchor the page title above the diagram without adding visible clutter.
    if len(nodes) > 1:
        edges.append(edge(f"{page}_title", nodes[1]["id"], "", INVISIBLE_EDGE))

    return {"direction": "TB", "ranksep": 0.8, "nodesep": 0.55, "nodes": nodes, "edges": edges}


def card_style(domain: str, *, strong: bool = False, dashed: bool = False) -> str:
    fill, stroke, font = DOMAIN_COLORS[domain]
    if strong:
        fill, stroke, font = "#17324D", "#17324D", "#FFFFFF"
    return (
        "rounded=1;arcSize=10;whiteSpace=wrap;html=1;align=left;verticalAlign=middle;"
        f"fillColor={fill};strokeColor={stroke};fontColor={font};fontSize=13;"
        "spacingLeft=12;spacingRight=12;spacingTop=8;spacingBottom=8;strokeWidth=1.7;"
        + ("dashed=1;dashPattern=6 4;" if dashed else "")
    )


def overview_graph() -> dict:
    nodes = [
        title_node("p1", "从 73 张核心物理表到 16 个只读视图；点击板块可跳转到对应 ERD 页面"),
        node("p1_scope", "<b>范围边界</b><br>73 表 / 16 视图是未来核心基座，不是共享生产库的全部对象。<br>现有 finance_*、app_*、HBTI、来源表及兼容视图仍保留。",
             style=NOTE_STYLE, width=390, height=118, group="01 如何读图"),
        node("p1_keys", "<b>四条稳定身份脊柱</b><br><b>store_id</b> 门店　<b>product_id</b> 可售产品<br><b>employment_id</b> 雇佣关系　<b>material_id</b> 原料<br>跨表不再用名称、员工姓名或商品文本猜关联。",
             style=card_style("shared", strong=True), width=390, height=126, group="01 如何读图", link=page_link("p2")),
        node("p1_legend", "<b>状态与关系</b><br><font color='#4B5563'><b>[EXISTING]</b></font> 复用现有　<font color='#9A6700'><b>[UPGRADE]</b></font> 原位升级<br><font color='#18794E'><b>[NEW]</b></font> 新建　<font color='#B42318'><b>[CONDITIONAL]</b></font> 有稳定源 ID 才建<br>实线鸡爪 = FK；虚线箭头 = 视图 / 来源血缘；? = 可空 FK。",
             style=NOTE_STYLE, width=390, height=136, group="01 如何读图"),
        node("p1_p2", "<b>02 共享身份与治理</b><br>11 表 · 迁移账本、审计、门店、商品、人员身份",
             style=card_style("shared"), width=305, height=88, group="02 十一页导航", link=page_link("p2")),
        node("p1_p3", "<b>03 POS 销售事实</b><br>8 表 + 2 视图 · 批次、日销售、时段商品、报废、条件订单",
             style=card_style("pos"), width=305, height=96, group="02 十一页导航", link=page_link("p3")),
        node("p1_p4", "<b>04 营运预测与计划</b><br>12 表 · 节假日、突发、预测、预估单版本、调整动作",
             style=card_style("ops"), width=305, height=96, group="02 十一页导航", link=page_link("p4")),
        node("p1_p5", "<b>05 营运执行与复盘</b><br>4 表 + 5 视图 · 实际产出、配送、计划差异、产品占比",
             style=card_style("ops"), width=305, height=96, group="02 十一页导航", link=page_link("p5")),
        node("p1_p6", "<b>06 人事、入职与培训</b><br>8 表 · 评分、Offer、入职任务、培训版本与结果",
             style=card_style("hr"), width=305, height=96, group="02 十一页导航", link=page_link("p6")),
        node("p1_p7", "<b>07 班表、关键岗位与工时</b><br>9 表 + 3 视图 · 资格门禁、班表版本、实际工时、人效",
             style=card_style("hr"), width=305, height=96, group="02 十一页导航", link=page_link("p7")),
        node("p1_p8", "<b>08 供应链与订货</b><br>14 表 · 物料需求、库存、补货、PO 版本、收货实价",
             style=card_style("scm"), width=305, height=96, group="02 十一页导航", link=page_link("p8")),
        node("p1_p9", "<b>09 成本卡与当日毛利</b><br>7 表 + 2 视图 · 配方、采购价、成本快照、产品毛利与覆盖率",
             style=card_style("cost"), width=305, height=96, group="02 十一页导航", link=page_link("p9")),
        node("p1_p10", "<b>10 财务核对视图</b><br>4 视图 · 销售、采购、人工、毛利与财务口径逐条核对",
             style=card_style("finance"), width=305, height=96, group="02 十一页导航", link=page_link("p10")),
        node("p1_p11", "<b>11 端到端关系与写入边界</b><br>黑巧 / 草莓塔示例；自动抓取、人工确认和系统写入权",
             style=card_style("gov"), width=305, height=96, group="02 十一页导航", link=page_link("p11")),
        node("p1_gate", "<b>三个发布门禁</b><br>① 身份未映射，不进入正式事实链<br>② 预估单 / 班表没有已发布版本，不触发下游<br>③ 成本覆盖不足或来源不完整，毛利必须标记为估算，不能伪装成精确值。",
             style=card_style("finance", dashed=True), width=410, height=126, group="03 第一性原则"),
        node("p1_grain", "<b>不把不同事实揉成一张大表</b><br>预测 ≠ 计划 ≠ 产出 ≠ 配送 ≠ 销售<br>排班需求 ≠ 员工指派 ≠ 实际工时<br>建议订货 ≠ PO ≠ 收货 ≠ 生效采购价。",
             style=card_style("gov"), width=410, height=126, group="03 第一性原则"),
    ]
    edges = [
        edge("p1_title", "p1_scope", "", INVISIBLE_EDGE),
        edge("p1_title", "p1_p2", "", INVISIBLE_EDGE),
        edge("p1_title", "p1_gate", "", INVISIBLE_EDGE),
        edge("p1_keys", "p1_p2", "稳定身份", FLOW_EDGE),
        edge("p1_keys", "p1_p3", "稳定身份", FLOW_EDGE),
        edge("p1_keys", "p1_p4", "稳定身份", FLOW_EDGE),
        edge("p1_keys", "p1_p6", "稳定身份", FLOW_EDGE),
        edge("p1_p4", "p1_p5", "计划 → 执行", FLOW_EDGE),
        edge("p1_p6", "p1_p7", "资格 → 班表", FLOW_EDGE),
        edge("p1_p4", "p1_p8", "已发布计划 → 需求", FLOW_EDGE),
        edge("p1_p8", "p1_p9", "收货实价 → 成本", FLOW_EDGE),
        edge("p1_p3", "p1_p9", "销售 → 毛利", FLOW_EDGE),
        edge("p1_p9", "p1_p10", "成本口径", FLOW_EDGE),
        edge("p1_p5", "p1_p11", "执行事实", FLOW_EDGE),
        edge("p1_p7", "p1_p11", "人员事实", FLOW_EDGE),
        edge("p1_p9", "p1_p11", "成本事实", FLOW_EDGE),
        edge("p1_p10", "p1_p11", "财务核对", FLOW_EDGE),
    ]
    return {"direction": "TB", "ranksep": 0.75, "nodesep": 0.6, "nodes": nodes, "edges": edges}


def end_to_end_graph() -> dict:
    nodes = [
        title_node("p11", "用黑巧与草莓塔说明：一个 product_id 如何贯穿预测、订货、成本、销售、班表与财务"),
        node("p10_product", "<b>可售产品身份</b><br>黑巧 / 草莓塔各有唯一 product_id<br>门店 POS listing 只通过 pos_product 映射",
             style=card_style("shared", strong=True), width=315, height=104, group="01 稳定身份", link=page_link("p2")),
        node("p10_store", "<b>门店身份</b><br>store_id 贯穿计划、库存、订单、班表、工时与财务核对",
             style=card_style("shared"), width=315, height=92, group="01 稳定身份", link=page_link("p2")),
        node("p10_plan", "<b>明日预估单</b><br>ops_production_plan_version<br>→ line / slot<br>人工只确认增减动作与原因",
             style=card_style("ops"), width=300, height=112, group="02 营运到供应链", link=page_link("p4")),
        node("p10_recipe", "<b>生效配方</b><br>cost_card_product_link<br>→ cost_card_recipe / recipe_item<br>黑巧与草莓塔分别展开到原料",
             style=card_style("cost"), width=300, height=116, group="02 营运到供应链", link=page_link("p9")),
        node("p10_need", "<b>原料需求</b><br>已发布计划 × 生效配方<br>→ scm_material_requirement_line",
             style=card_style("scm"), width=300, height=96, group="02 营运到供应链", link=page_link("p8")),
        node("p10_replen", "<b>订货增减</b><br>需求 − 可用库存 − 在途 + 安全量 / MOQ<br>→ replenishment_line<br>保留 suggested、approved、delta、reason",
             style=card_style("scm"), width=315, height=122, group="03 采购与成本", link=page_link("p8")),
        node("p10_po", "<b>PO 与收货</b><br>purchase_order_revision → line<br>→ goods_receipt_line<br>计划、下单、收货不可混成一行",
             style=card_style("scm"), width=315, height=112, group="03 采购与成本", link=page_link("p8")),
        node("p10_price", "<b>市场采购价</b><br>收货实价 → supplier_price_observation<br>→ cost_card_item_price 生效区间",
             style=card_style("cost"), width=315, height=102, group="03 采购与成本", link=page_link("p9")),
        node("p10_snapshot", "<b>当日成本快照</b><br>产品 × 门店 × 日期 × 成本版本<br>保留每个原料组成、价格来源与覆盖率",
             style=card_style("cost"), width=315, height=106, group="03 采购与成本", link=page_link("p9")),
        node("p10_sales", "<b>当日销售事实</b><br>POS 自动抓取；按 store_id + product_id 汇总<br>产品占比上涨 / 下降由视图计算",
             style=card_style("pos"), width=315, height=106, group="04 销售与人员", link=page_link("p3")),
        node("p10_margin", "<b>当日产品毛利</b><br>销售数量 × 当日成本快照<br>→ COGS、毛利额、毛利率<br>覆盖不足必须显示 ESTIMATED",
             style=card_style("finance"), width=330, height=116, group="04 销售与人员", link=page_link("p9")),
        node("p10_shift", "<b>班表与关键岗位</b><br>销量 / 产量需求 → role / station / critical<br>员工未通过必修培训则不可占关键岗位",
             style=card_style("hr"), width=330, height=112, group="04 销售与人员", link=page_link("p7")),
        node("p10_labor", "<b>实际工时与人效</b><br>Lark 自动同步原值<br>reported_hours 与 net_work_minutes 分开<br>再与 POS 销售、财务人工成本核对",
             style=card_style("hr"), width=330, height=124, group="04 销售与人员", link=page_link("p7")),
        node("p10_auto", "<b>自动录入</b><br>RES/POS、BKPP 节假日、Lark 工时、算法预测、配方展开、成本与核对视图",
             style=card_style("pos"), width=315, height=102, group="05 录入边界"),
        node("p10_manual", "<b>人工确认</b><br>计划调整原因、突发事件影响、关键岗位需求、员工指派、库存盘点例外、PO 审批、收货异常",
             style=card_style("ops"), width=315, height=112, group="05 录入边界"),
        node("p10_writer", "<b>写入权不混用</b><br>res_api 只写 pos_*；BakeryOps 写 ops_* / hr_* / scm_*；财务网站写 finance_* / cost_card_* / app_*。<br>跨域通过 FK、视图和受控函数协作。",
             style=card_style("gov", dashed=True), width=370, height=126, group="05 录入边界"),
        node("p10_stop", "<b>必须停下的情况</b><br>商品 / 员工 / 门店 / 原料无法唯一映射；订单没有稳定来源 ID；成本来源或配方缺失；班表关键岗位未满足资格。<br>进入 review queue，不允许猜填。",
             style=card_style("finance", dashed=True), width=370, height=136, group="06 数据质量门禁"),
    ]
    edges = [
        edge("p11_title", "p10_product", "", INVISIBLE_EDGE),
        edge("p11_title", "p10_plan", "", INVISIBLE_EDGE),
        edge("p11_title", "p10_auto", "", INVISIBLE_EDGE),
        edge("p10_product", "p10_plan", "product_id", FLOW_EDGE),
        edge("p10_store", "p10_plan", "store_id", FLOW_EDGE),
        edge("p10_product", "p10_recipe", "product link", FLOW_EDGE),
        edge("p10_plan", "p10_need", "planned qty", FLOW_EDGE),
        edge("p10_recipe", "p10_need", "recipe quantities", FLOW_EDGE),
        edge("p10_need", "p10_replen", "net requirement", FLOW_EDGE),
        edge("p10_replen", "p10_po", "approved qty", FLOW_EDGE),
        edge("p10_po", "p10_price", "actual receipt price", FLOW_EDGE),
        edge("p10_price", "p10_snapshot", "effective price", FLOW_EDGE),
        edge("p10_recipe", "p10_snapshot", "recipe version", FLOW_EDGE),
        edge("p10_sales", "p10_margin", "quantity + net sales", FLOW_EDGE),
        edge("p10_snapshot", "p10_margin", "unit cost", FLOW_EDGE),
        edge("p10_plan", "p10_shift", "workload", FLOW_EDGE),
        edge("p10_shift", "p10_labor", "scheduled vs actual", FLOW_EDGE),
        edge("p10_sales", "p10_labor", "sales denominator", FLOW_EDGE),
        edge("p10_manual", "p10_plan", "judgement", FLOW_EDGE),
        edge("p10_auto", "p10_sales", "source facts", FLOW_EDGE),
        edge("p10_auto", "p10_price", "source facts", FLOW_EDGE),
        edge("p10_stop", "p10_writer", "review + audit", FLOW_EDGE),
    ]
    return {"direction": "TB", "ranksep": 0.75, "nodesep": 0.6, "nodes": nodes, "edges": edges}


def audit_model() -> None:
    expected_page_tables = {"p2": 11, "p3": 8, "p4": 12, "p5": 4, "p6": 8, "p7": 9, "p8": 14, "p9": 7}
    expected_page_views = {"p3": 2, "p5": 5, "p7": 3, "p9": 2, "p10": 4}
    if len(ENTITIES) != 73 or len(TABLE_BY_NAME) != 73:
        raise AssertionError(f"expected 73 unique tables, got {len(ENTITIES)} / {len(TABLE_BY_NAME)}")
    if len(VIEWS) != 16 or len(VIEW_BY_NAME) != 16:
        raise AssertionError(f"expected 16 unique views, got {len(VIEWS)} / {len(VIEW_BY_NAME)}")
    for page, expected in expected_page_tables.items():
        actual = sum(entity.page == page for entity in ENTITIES)
        if actual != expected:
            raise AssertionError(f"{page}: expected {expected} tables, got {actual}")
    for page, expected in expected_page_views.items():
        actual = sum(view.page == page for view in VIEWS)
        if actual != expected:
            raise AssertionError(f"{page}: expected {expected} views, got {actual}")
    known = set(TABLE_BY_NAME) | set(VIEW_BY_NAME) | set(EXTERNAL_REFS)
    for entity in ENTITIES:
        for column in entity.columns:
            if column.ref and column.ref not in known:
                raise AssertionError(f"unknown ref {entity.name}.{column.name} -> {column.ref}")
    for view in VIEWS:
        missing = set(view.lineage) - known
        if missing:
            raise AssertionError(f"unknown lineage {view.name}: {sorted(missing)}")
    conditional = [entity.name for entity in ENTITIES if entity.status == "CONDITIONAL"]
    if conditional != ["pos_order", "pos_order_item", "pos_payment", "pos_refund"]:
        raise AssertionError(f"unexpected conditional set: {conditional}")


def build_pages() -> tuple[list[str], list[str]]:
    graphs = {"p1": overview_graph()}
    graphs.update({page: detail_graph(page) for page in ("p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10")})
    graphs["p11"] = end_to_end_graph()
    pages_xml: list[str] = []
    reports: list[str] = []
    for page in ("p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11"):
        graph = graphs[page]
        height, positions, edge_points = al.layout(al.build_dot(graph))
        score = al.route_score(graph, height, positions, edge_points)
        cells = al.page_cells(graph, height, positions, edge_points, color=False)
        page_id, page_name, _ = PAGE_INFO[page]
        pages_xml.append(al.wrap_page(cells, page_id=page_id, name=page_name))
        table_count = sum(entity.page == page for entity in ENTITIES)
        view_count = sum(view.page == page for view in VIEWS)
        reports.append(
            f"{page_name}: {table_count} tables, {view_count} views, "
            f"{len(graph['nodes'])} nodes, {len(graph['edges'])} edges, route_score={score}"
        )
    return pages_xml, reports


def main() -> None:
    audit_model()
    pages_xml, reports = build_pages()
    modified = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    xml = (
        f'<mxfile host="Electron" modified="{modified}" agent="Codex drawio-skill" version="31.1.5" '
        'type="device" compressed="false">\n'
        + "".join(pages_xml)
        + "</mxfile>\n"
    )
    OUTPUT.write_text(xml, encoding="utf-8")
    print(f"wrote {OUTPUT}")
    print("audit: 73 canonical tables, 16 key views, 11 pages")
    for report in reports:
        print(report)


if __name__ == "__main__":
    main()
