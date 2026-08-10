#!/usr/bin/env python3
"""Generate the Scheme C database design review package.

The generator reads only committed/local evidence snapshots and the declarative
target model. It never connects to the production database and never executes
DDL or DML.
"""

from __future__ import annotations

import csv
import dataclasses
import html
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[2]
sys.path.insert(0, str(ROOT))

from model.current_to_target import (  # noqa: E402
    COST_ITEM_SOURCE_AUDIT,
    COST_ITEM_SOURCE_REF_PROBE,
    COST_RECIPE_OUTPUT_AUDIT,
    HBTI_RESULT_ONLY_ANCHOR_CONTRACT,
    MAPPINGS,
    REWARD_SOURCE_AUDIT,
    REWARD_TEMPLATE_ALLOWLIST_PAYLOAD,
    REWARD_TEMPLATE_ALLOWLIST_SHA256,
    TABLE_MAPPINGS,
    VIEW_MAPPINGS,
    validate_source_fidelity_contracts,
)
from model.review_content import (  # noqa: E402
    DESIGN_GATES,
    END_TO_END_CHAINS,
    IDENTITY_SPINE,
    PROJECTS,
)
from model.target_model import (  # noqa: E402
    DOMAIN_NAMES,
    DOMAIN_ORDER,
    LIFECYCLE_NAMES,
    MODEL_VERSION,
    MUTATION_POLICY_NAMES,
    PHASE1_VIEWS,
    EXTENSION_VIEWS,
    SOURCE_CONDITIONAL_VIEWS,
    TABLES,
    TABLE_BY_NAME,
    VIEWS,
    VIEW_BASE_TABLES,
    VIEW_BY_NAME,
    VIEW_READINESS_GOLDEN_COUNTS,
    required_fk_index_columns,
    view_implementation_tier,
    validate_model,
)
from model.storage_audit import (  # noqa: E402
    AUDITS,
    AUDIT_BY_TABLE,
    CLASSIFICATIONS,
    validate_storage_audit,
)
from model.schema_validation import SCHEMA_VALIDATION_GUARDS  # noqa: E402
from model.minimal_foundation import (  # noqa: E402
    CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS,
    CORE_BUSINESS_TABLES,
    CORE_PLATFORM_TABLES,
    DERIVED_R5_TABLES,
    EXTENSION_PACKS,
    EXTENSION_PACK_NAMES,
    EXTENSION_TABLES,
    MERGED_R5_TABLES,
    REMOVED_R5_TABLES,
    SOURCE_CONDITIONAL_TABLES,
    tier_for_table,
)


EVIDENCE = ROOT / "evidence"
CURRENT_SNAPSHOT = EVIDENCE / "current-schema-snapshot.json"
CODE_SNAPSHOT = EVIDENCE / "code-access-snapshot.json"
MEMBER_ORDER_AUDIT_SNAPSHOT = EVIDENCE / "pos-member-order-item-audit.json"


SPECIAL_CONSTRAINT_GUARDS = {
    "app_user": "SUBSCRIPTION_VALIDATION: sole preference-update function normalizes notification_subscription_codes, rejects unknown or duplicate codes against the deployed message-type registry, writes app_audit_event, and revokes direct array updates",
    "scm_goods_receipt_line": "DEFERRABLE_CONSTRAINT_TRIGGER: referenced PO line must belong to receipt header purchase_order_revision_id; material must match supplier item mapping",
    "mkt_reward_claim": "COMPOSITE_FK_REQUIRED: (reward_stock_id,reward_id) REFERENCES mkt_reward_stock(reward_stock_id,reward_id) MATCH SIMPLE; trigger is not an acceptable substitute | ATOMIC_WRITE_FUNCTION: stock-backed idempotent claim insert and reward_stock counter change in one transaction; stockless external fulfillment does not mutate stock",
    "ops_shift_assignment": "CONSTRAINT_TRIGGER: no employment time overlap and critical role eligibility must be valid at shift start",
    "ops_production_plan_version": "FREEZE_TRIGGER: published/rejected/cancelled/superseded version and child rows are immutable",
    "ops_shift_plan_version": "FREEZE_TRIGGER: published/rejected/cancelled/superseded version and child rows are immutable",
    "cost_card_recipe_version": "FREEZE_TRIGGER: published/archived/rejected version and child components are immutable",
    "mkt_campaign_version": "FREEZE_TRIGGER: published/archived/rejected version, questions and options are immutable",
    "scm_purchase_order_revision": "FREEZE_TRIGGER: sent/confirmed/rejected/cancelled/superseded revision and lines are immutable",
    "msg_outbound_message": "CLAIM_FUNCTION: idempotency key conflict returns existing message; queue lease transitions are atomic",
    "app_audit_event": "APPEND_ONLY_GUARD: deny UPDATE and DELETE to application roles",
    "pos_member_card_transaction": "CONSTRAINT_TRIGGER: when member_card_id is present, the referenced card must belong to member_id when member_id is also present; resolved stable IDs must agree with source IDs in the same source-system namespace",
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


CURRENT = load_json(CURRENT_SNAPSHOT)
CODE = load_json(CODE_SNAPSHOT)
MEMBER_ORDER_AUDIT = load_json(MEMBER_ORDER_AUDIT_SNAPSHOT)


DOMAIN_COLORS = {
    "app": ("#E8EEF8", "#3B6FB6"),
    "ops": ("#FFF0E6", "#E47A16"),
    "pos": ("#E3F6F5", "#249C98"),
    "hr": ("#F1E9FA", "#8B5FBF"),
    "scm": ("#E8F5E9", "#3A9258"),
    "cost": ("#FFF6D8", "#D49A00"),
    "finance": ("#FFE8EA", "#D9534F"),
    "mkt": ("#FCE8F3", "#C94F8C"),
    "msg": ("#E9F2FF", "#4D7FC1"),
    "ai": ("#EEE9FF", "#7057B8"),
}


CREATED_AND_VALIDATED_SQL_VIEW_COUNT = 0
VIEW_READINESS_BOUNDARY = (
    "41 个 Phase1 视图只是设计候选；其中 10 个 PASS_SELECT_SPEC 仅表示 SELECT 规格足够，"
    "不表示已经创建或运行验证；当前已创建并验证的 SQL view = 0。"
)


def format_view_grain_key(view) -> str:
    return "UNDEFINED" if view.grain_key is None else " + ".join(view.grain_key)


def format_view_blockers(view) -> str:
    return "NONE" if not view.readiness_blockers else " | ".join(view.readiness_blockers)


def md_escape(value) -> str:
    if value is None:
        return "—"
    return str(value).replace("|", "\\|").replace("\n", "<br>")


def h(value) -> str:
    return html.escape("" if value is None else str(value))


def code(value) -> str:
    if value is None or value == "":
        return "—"
    return f"`{str(value).replace('`', '')}`"


def fmt_default(value) -> str:
    return "—" if value is None else str(value)


def constraint_summary(field) -> str:
    parts = []
    if field.pk:
        parts.append("PK")
    if field.fk:
        if field.fk_activation == "WITH_TABLE":
            parts.append(f"FK → {field.fk}")
        else:
            parts.append(f"延期FK → {field.fk}；激活={field.fk_activation}")
    if field.unique:
        parts.append("UNIQUE")
    if field.checks:
        parts.extend(f"CHECK {x}" for x in field.checks)
    return "；".join(parts) or "—"


def format_unique_constraints(table) -> str:
    """Render every nullable-key UNIQUE with its deliberate PostgreSQL NULL policy."""
    rendered = []
    for unique in table.uniques:
        label = " + ".join(unique)
        if unique in table.nulls_not_distinct_uniques:
            label += " [NULLS NOT DISTINCT：空值也参与去重]"
        elif unique in table.nulls_distinct_uniques:
            label += " [NULLS DISTINCT：仅非空值去重，允许多条空值]"
        rendered.append(label)
    return " | ".join(rendered)


def format_table_foreign_key(table_fk) -> str:
    source = " + ".join(table_fk.columns)
    target = " + ".join(table_fk.ref_columns)
    activation = "" if table_fk.fk_activation == "WITH_TABLE" else f" [DEFERRED:{table_fk.fk_activation}]"
    return f"({source}) → {table_fk.ref_table}({target}) MATCH {table_fk.match_type}{activation}"


def field_constraint_summary(table, field) -> str:
    parts = [] if constraint_summary(field) == "—" else [constraint_summary(field)]
    parts.extend(
        f"TABLE FK {format_table_foreign_key(table_fk)}"
        for table_fk in table.foreign_keys
        if field.name in table_fk.columns
    )
    return "；".join(parts) or "—"


def field_fk_activation(table, field) -> str:
    activations = []
    if field.fk:
        activations.append(field.fk_activation)
    activations.extend(
        table_fk.fk_activation for table_fk in table.foreign_keys
        if field.name in table_fk.columns
    )
    return " | ".join(activations) or "NOT_APPLICABLE"


def storage_reason(table) -> str:
    """Explain why this object is a table instead of a recalculated view."""
    return AUDIT_BY_TABLE[table.name].physical_reason


def field_time_semantics(field) -> str:
    name = field.name
    if name == "created_at":
        return "数据库首次写入时间；不是营业日、发生时间或生效时间。"
    if name == "updated_at":
        return "允许更新的最后落库时间；不能据此重建完整历史。"
    if name == "business_date":
        return "地点所属营业时区下的营业日；不能直接用 UTC timestamp::date 代替。"
    if name.endswith("_month"):
        return "月份键，固定为该月第一天；不是某笔交易发生日。"
    if name.startswith("valid_from") or name.startswith("effective_from"):
        return "生效区间起点，采用含起点语义。"
    if name.startswith("valid_to") or name.startswith("effective_to"):
        return "生效区间终点，默认采用不含终点语义；为空表示尚无确定终点。"
    if field.data_type == "timestamptz":
        return "绝对时间；展示或转营业日时必须使用地点时区。"
    if field.data_type == "date":
        return "无时区自然日；具体是营业日、日历日还是生效日由字段名称和表粒度决定。"
    if field.data_type == "time":
        return "本地钟点；必须与地点时区和对应日期组合，不能单独视为绝对时间。"
    return "不适用。"


def misuse_note(field, object_name: str | None = None) -> str:
    notes = []
    name = field.name
    if field.notes:
        notes.append(field.notes)
    if field.fk:
        notes.append("关联时使用该 ID，不要改用名称、手机号或外部编号。")
        if field.fk_activation != "WITH_TABLE":
            notes.append(f"该列在 {field.fk_activation} 未完整启用前必须为 NULL，届时也不得提前创建外键。")
    if name == "business_date":
        notes.append("不要由 created_at 或 UTC 日期临时推导。")
    if name in {"created_at", "updated_at"}:
        notes.append("不要当作业务发生时间或版本生效时间。")
    if name.startswith("source_"):
        notes.append("这是来源系统证据，不等于企业统一身份。")
    if "amount" in name or "sales" in name or "price" in name or "cost" in name:
        notes.append("聚合前确认币种、含税/未税与口径，NULL 不得自动补 0。")
    if "quantity" in name or name.endswith("_qty"):
        notes.append("使用前确认该表约定的单位；不同单位不得直接相加。")
    if field.data_type == "jsonb":
        notes.append("只放低频扩展或来源快照；稳定分析字段应升格为正式列并带 schema 版本。")
    if field.nullable:
        notes.append("NULL 表示未知、不适用或尚未发生，不能无条件解释为 0/false。")
    if field.pk:
        notes.append("仅作稳定技术身份；业务展示应使用相应 code/name。")
    return " ".join(dict.fromkeys(notes)) or (
        f"{object_name + '.' if object_name else ''}{field.name} 只表示本字段说明中的 {field.zh_name}；"
        f"必须在所属对象粒度内按 {field.data_type} 读取，不得借同名字段跨表猜口径、补值或充当连接键。"
    )


def history_semantics(table, field) -> str:
    version_fields = {x.name for x in table.fields}
    if field.name in {"version_no", "valid_from", "valid_to", "effective_from", "effective_to"}:
        return "版本/生效期关键字段；发布后旧版本保留，不原地覆盖历史。"
    if "version_no" in version_fields or "valid_from" in version_fields or "effective_from" in version_fields:
        return "随所属版本或生效区间解释；历史行保留。"
    if table.grain.find("快照") >= 0 or "snapshot" in table.name:
        return "快照事实；多个时间点可并存，不能只保留最后一行。"
    if "run_id" in version_fields or "batch_id" in version_fields:
        return "随批次/运行追踪；重跑产生新批次或明确替代关系。"
    return f"写入策略为 {table.mutation_policy}：{MUTATION_POLICY_NAMES[table.mutation_policy]}。"


def current_objects(kind: str) -> list[dict]:
    return sorted(
        [x for x in CURRENT["objects"] if x["object_type"] == kind],
        key=lambda x: x["object_name"],
    )


CURRENT_TABLES = current_objects("table")
CURRENT_VIEWS = current_objects("view")
CURRENT_COLUMNS = defaultdict(list)
for item in CURRENT["columns"]:
    CURRENT_COLUMNS[item["object_name"]].append(item)
CURRENT_CONSTRAINTS = defaultdict(list)
for item in CURRENT["constraints"]:
    CURRENT_CONSTRAINTS[item["table_name"]].append(item)
CURRENT_INDEXES = defaultdict(list)
for item in CURRENT["indexes"]:
    CURRENT_INDEXES[item["table_name"]].append(item)
ROW_COUNTS = {x["table_name"]: int(x["row_count"]) for x in CURRENT["row_counts"]}
MAPPING_BY_OBJECT = {x.current_object: x for x in MAPPINGS}


# Sources that can lose money, identity, authorization, product configuration
# or source evidence receive a literal field-level disposition.  The validator
# requires every field of these objects to use this map; an object-level target
# list is not accepted as proof that a source column has a destination.
MANUAL_FIELD_DISPOSITIONS = {
    # Current user/location scope -> a specific role assignment and stable location.
    ("app_user_store_scope", "user_id"): ("RESOLVE_SCOPED_ROLE", "app_user_role.user_id | app_user_location_scope.user_role_id"),
    ("app_user_store_scope", "store"): ("RESOLVE_STABLE_ID", "app_user_location_scope.location_id"),
    ("app_user_store_scope", "assigned_by"): ("RESOLVE_AUTHORIZER", "app_user_location_scope.granted_by_user_id"),
    ("app_user_store_scope", "assigned_at"): ("PRESERVE_AUDIT_TIME", "app_user_location_scope.valid_from"),

    # Current POS member master -> stable identity, protected contact, snapshots and HBTI facts.
    ("pos_member", "member_id"): ("PRESERVE_AND_REKEY", "pos_member.source_member_id | pos_member.member_id"),
    ("pos_member", "store"): ("RESOLVE_STABLE_ID", "pos_member.home_location_id | pos_ingest_batch.location_id"),
    ("pos_member", "has_profile"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.profile_present"),
    ("pos_member", "phone_country_code"): ("TRANSFORM_SECURE", "pos_member_contact.country_calling_code"),
    ("pos_member", "phone_national"): ("TRANSFORM_SECURE", "pos_member_contact.contact_ciphertext | pos_member_contact.lookup_hash"),
    ("pos_member", "phone_e164"): ("TRANSFORM_SECURE", "pos_member_contact.contact_ciphertext | pos_member_contact.lookup_hash"),
    ("pos_member", "registered_on"): ("PRESERVE_SOURCE_FACT", "pos_member.registered_on"),
    ("pos_member", "register_shop_id"): ("RESOLVE_STABLE_ID", "pos_member.home_location_id"),
    ("pos_member", "source_type"): ("PRESERVE_SOURCE_FACT", "pos_member.source_type"),
    ("pos_member", "card_count"): ("DERIVE_NOT_STORE", "DERIVE:COUNT(pos_member_card)"),
    ("pos_member", "level_name"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.level_name"),
    ("pos_member", "growth"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.growth"),
    ("pos_member", "point_balance"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.point_balance"),
    ("pos_member", "balance_total"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.total_balance"),
    ("pos_member", "balance_cash"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.cash_balance"),
    ("pos_member", "balance_gift"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.gift_balance"),
    ("pos_member", "balance_frozen"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.frozen_balance"),
    ("pos_member", "lifetime_topup_amount"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.lifetime_topup_amount"),
    ("pos_member", "lifetime_topup_count"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.lifetime_topup_count"),
    ("pos_member", "lifetime_consume_amount"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.lifetime_consume_amount"),
    ("pos_member", "lifetime_consume_count"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.lifetime_consume_count"),
    ("pos_member", "first_card_created_on"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.first_card_created_on"),
    ("pos_member", "last_recharge_at"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.last_recharge_at"),
    ("pos_member", "last_trans_at"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.last_transaction_at"),
    ("pos_member", "snapshot_date"): ("PRESERVE_SOURCE_FACT", "pos_member_balance_snapshot.snapshot_date"),
    ("pos_member", "fetched_at"): ("BATCH_PROVENANCE", "pos_ingest_batch.completed_at"),
    ("pos_member", "hbti_campaign_version"): ("NORMALIZE_TO_MARKETING_FACT", "mkt_campaign_member.campaign_version_id"),
    ("pos_member", "hbti_code"): ("NORMALIZE_TO_MARKETING_FACT", "mkt_survey_result.result_code"),
    ("pos_member", "hbti_visit_time"): ("PRESERVE_RESULT_ONLY_Q5_DIMENSION", "mkt_survey_result.result_dimensions"),
    ("pos_member", "hbti_category"): ("PRESERVE_RESULT_ONLY_Q6_DIMENSION", "mkt_survey_result.result_dimensions"),
    ("pos_member", "hbti_color"): ("NORMALIZE_TO_MARKETING_FACT", "mkt_survey_result.result_color"),
    ("pos_member", "hbti_gender"): ("ARCHIVE_RESTRICTED_NO_ACTIVE_TARGET", "NO_TARGET:restricted migration archive"),
    ("pos_member", "hbti_age"): ("ARCHIVE_RESTRICTED_NO_ACTIVE_TARGET", "NO_TARGET:restricted migration archive"),
    ("pos_member", "hbti_completed_at"): ("PRESERVE_COMPLETION_EVIDENCE", "mkt_campaign_member.completed_at | mkt_survey_response.submitted_at | mkt_survey_result.calculated_at"),
    ("pos_member", "hbti_member_hash"): ("REISSUE_NOT_MIGRATE", "NO_TARGET:legacy privacy/access hash"),
    ("pos_member", "hbti_status"): ("PRESERVE_REWARD_VALIDATION_EVIDENCE_ONLY", "mkt_survey_response.validation_result | mkt_reward_claim.status | NO_TARGET:no direct campaign_member/response status mapping"),
    ("pos_member", "hbti_attempt_id"): ("PRESERVE_REAL_ATTEMPT_OR_BUILD_MIGRATION_ANCHOR", "mkt_survey_response.source_response_id | MIGRATION_MANIFEST:result_only_anchor_formula_and_hash"),
    ("pos_member", "hbti_record"): ("ARCHIVE_RESTRICTED_PARSE_APPROVED_FIELDS", "mkt_survey_response.validation_result | mkt_survey_result.result_dimensions"),
    ("pos_member", "hbti_expires_at"): ("DO_NOT_MIGRATE_ACCESS_STATE", "NO_TARGET:reissue campaign/token eligibility"),

    # Current member daily report -> raw daily observation plus deterministic views.
    ("pos_member_daily", "date"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.business_date"),
    ("pos_member_daily", "store"): ("RESOLVE_STABLE_ID", "pos_member_daily_metric.location_id"),
    ("pos_member_daily", "new_member_count"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.new_member_count"),
    ("pos_member_daily", "consumed_member_count"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.consumed_member_count"),
    ("pos_member_daily", "recharged_member_count"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.recharged_member_count"),
    ("pos_member_daily", "points_member_count"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.points_member_count"),
    ("pos_member_daily", "member_consume_amount"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.member_sales"),
    ("pos_member_daily", "total_consume_amount"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.total_consume_amount"),
    ("pos_member_daily", "member_consume_ratio"): ("DERIVE_NOT_STORE", "v_pos_member_daily_summary.source_member_sales_ratio | v_pos_member_daily_summary.pos_member_sales_ratio"),
    ("pos_member_daily", "topup_cash"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.topup_cash"),
    ("pos_member_daily", "topup_gift"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.topup_gift"),
    ("pos_member_daily", "topup_face_value"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.topup_face_value"),
    ("pos_member_daily", "topup_count"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.topup_count"),
    ("pos_member_daily", "topup_refund"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.topup_refund"),
    ("pos_member_daily", "redeem_amount"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.redeem_amount"),
    ("pos_member_daily", "redeem_cash"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.redeem_cash"),
    ("pos_member_daily", "redeem_gift"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.redeem_gift"),
    ("pos_member_daily", "redeem_count"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.redeem_count"),
    ("pos_member_daily", "consume_refund"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.consume_refund"),
    ("pos_member_daily", "adjust_net"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.adjust_net"),
    ("pos_member_daily", "card_payment_net"): ("DERIVE_NOT_STORE", "v_pos_member_daily_summary.card_payment_net"),
    ("pos_member_daily", "card_payment_ratio"): ("DERIVE_NOT_STORE", "v_pos_member_daily_summary.source_card_payment_ratio | v_pos_member_daily_summary.pos_card_payment_ratio"),
    ("pos_member_daily", "net_stored_value_face"): ("DERIVE_NOT_STORE", "v_pos_member_daily_summary.stored_value_face_net"),
    ("pos_member_daily", "net_stored_value_cash"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.stored_value_cash_net"),
    ("pos_member_daily", "balance_end_total"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.balance_end_total"),
    ("pos_member_daily", "balance_end_cash"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.balance_end_cash"),
    ("pos_member_daily", "balance_end_gift"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.balance_end_gift"),
    ("pos_member_daily", "is_partial"): ("DERIVE_NOT_STORE", "DERIVE:required fields NULL state + pos_ingest_batch.status"),
    ("pos_member_daily", "missing_sources"): ("DERIVE_NOT_STORE", "DERIVE:required fields NULL state + pos_ingest_batch.status"),
    ("pos_member_daily", "source"): ("BATCH_PROVENANCE", "pos_ingest_batch.dataset_code | pos_ingest_batch.source_system_id"),
    ("pos_member_daily", "fetched_at"): ("BATCH_PROVENANCE", "pos_ingest_batch.completed_at"),
    ("pos_member_daily", "topup_adjust_amount"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.topup_adjust_amount"),
    ("pos_member_daily", "adjust_correction"): ("PRESERVE_SOURCE_FACT", "pos_member_daily_metric.adjust_correction"),
    ("pos_member_daily", "topup_total"): ("DERIVE_NOT_STORE", "v_pos_member_daily_summary.topup_total"),

    # Current member-card transaction -> lossless raw event and resolved stable keys.
    ("pos_member_card_txn", "txn_id"): ("PRESERVE_SOURCE_ID", "pos_member_card_transaction.source_transaction_id"),
    ("pos_member_card_txn", "store"): ("RESOLVE_STABLE_ID", "pos_member_card_transaction.location_id"),
    ("pos_member_card_txn", "pos_shop_id"): ("RESOLVE_STABLE_ID", "pos_member_card_transaction.location_id"),
    ("pos_member_card_txn", "business_date"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.business_date"),
    ("pos_member_card_txn", "txn_at"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.occurred_at"),
    ("pos_member_card_txn", "member_id"): ("PRESERVE_AND_REKEY", "pos_member_card_transaction.source_member_id | pos_member_card_transaction.member_id"),
    ("pos_member_card_txn", "card_no"): ("PRESERVE_AND_REKEY", "pos_member_card_transaction.source_card_id | pos_member_card_transaction.member_card_id"),
    ("pos_member_card_txn", "txn_type"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.source_transaction_type_code"),
    ("pos_member_card_txn", "txn_type_label"): ("PRESERVE_AND_NORMALIZE", "pos_member_card_transaction.source_transaction_type_label | pos_member_card_transaction.transaction_type"),
    ("pos_member_card_txn", "money_amount"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.cash_amount"),
    ("pos_member_card_txn", "gift_amount"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.gift_amount"),
    ("pos_member_card_txn", "total_amount"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.total_amount"),
    ("pos_member_card_txn", "trade_amount"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.trade_amount"),
    ("pos_member_card_txn", "before_money_balance"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.before_money_balance"),
    ("pos_member_card_txn", "after_money_balance"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.after_money_balance"),
    ("pos_member_card_txn", "before_gift_balance"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.before_gift_balance"),
    ("pos_member_card_txn", "after_gift_balance"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.after_gift_balance"),
    ("pos_member_card_txn", "point_delta"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.point_delta"),
    ("pos_member_card_txn", "pos_order_no"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.source_pos_order_no"),
    ("pos_member_card_txn", "order_id"): ("PRESERVE_AND_REKEY", "pos_member_card_transaction.source_order_id | pos_member_card_transaction.order_id"),
    ("pos_member_card_txn", "source_code"): ("PRESERVE_SOURCE_FACT", "pos_member_card_transaction.source_code"),
    ("pos_member_card_txn", "source"): ("BATCH_PROVENANCE", "pos_ingest_batch.dataset_code | pos_ingest_batch.source_system_id"),
    ("pos_member_card_txn", "fetched_at"): ("BATCH_PROVENANCE", "pos_ingest_batch.completed_at"),

    # Current mixed-writer daily revenue -> split by verified writer, never by values.
    ("daily_revenue", "date"): ("PARSE_BUSINESS_DATE_BY_VERIFIED_WRITER", "pos_sales_day.business_date | finance_sales_daily.business_date"),
    ("daily_revenue", "revenue"): ("PRESERVE_NET_SALES_BY_VERIFIED_WRITER", "pos_sales_day.net_sales | finance_sales_daily.net_sales"),
    ("daily_revenue", "transaction_count"): ("PRESERVE_ORDER_COUNT_BY_VERIFIED_WRITER", "pos_sales_day.order_count | finance_sales_daily.order_count"),
    ("daily_revenue", "avg_transaction_value"): ("PRESERVE_ONLY_INDEPENDENT_SOURCE_OBSERVATION_ELSE_DERIVE", "pos_sales_day.source_average_order_value | DERIVE:net_sales / NULLIF(order_count,0)"),
    ("daily_revenue", "gross_sales"): ("PRESERVE_GROSS_SALES_BY_VERIFIED_WRITER", "pos_sales_day.gross_sales | finance_sales_daily.gross_sales"),
    ("daily_revenue", "total_discount"): ("PRESERVE_DISCOUNT_BY_VERIFIED_WRITER", "pos_sales_day.discount_amount | finance_sales_daily.discount_amount"),
    ("daily_revenue", "discount_rate"): ("DERIVE_NOT_STORE", "DERIVE:discount_amount / NULLIF(gross_sales,0)"),
    ("daily_revenue", "member_sales_ratio"): ("DERIVE_COMPATIBILITY_METRIC", "v_pos_member_daily_summary.source_card_payment_ratio"),
    ("daily_revenue", "store"): ("RESOLVE_STABLE_LOCATION_BY_SOURCE_IDENTITY", "pos_sales_day.location_id | finance_sales_daily.location_id"),
    ("daily_revenue", "import_source"): ("RESOLVE_WRITER_BOUNDARY", "pos_ingest_batch.dataset_code | pos_ingest_batch.source_system_id | finance_import_batch.dataset_code | finance_import_batch.source_layer | finance_import_batch.source_system_id"),

    # Current POS operational facts -> exact source columns or deterministic read models.
    ("daily_breakdown", "date"): ("PRESERVE_SOURCE_FACT", "pos_daily_breakdown.business_date"),
    ("daily_breakdown", "dim_type"): ("NORMALIZE_CONTROLLED_CODE", "pos_daily_breakdown.dimension_type"),
    ("daily_breakdown", "dim_value"): ("PRESERVE_SOURCE_FACT", "pos_daily_breakdown.dimension_value"),
    ("daily_breakdown", "bill_count"): ("PRESERVE_WITH_UNIT", "pos_daily_breakdown.quantity | pos_daily_breakdown.quantity_unit"),
    ("daily_breakdown", "net_sales"): ("PRESERVE_SOURCE_FACT", "pos_daily_breakdown.net_sales"),
    ("daily_breakdown", "ratio"): ("DERIVE_NOT_STORE", "v_pos_daily_breakdown_current.ratio"),

    ("hourly_sales_summary", "id"): ("REKEY", "pos_sales_hour.sales_hour_id"),
    ("hourly_sales_summary", "date"): ("PRESERVE_SOURCE_FACT", "pos_sales_hour.business_date"),
    ("hourly_sales_summary", "hour"): ("TRANSFORM_TIMEZONE_AWARE", "pos_sales_hour.hour_started_at"),
    ("hourly_sales_summary", "bill_count"): ("PRESERVE_SOURCE_FACT", "pos_sales_hour.order_count"),
    ("hourly_sales_summary", "num_of_guests"): ("PRESERVE_SOURCE_FACT", "pos_sales_hour.source_guest_count"),
    ("hourly_sales_summary", "net_sales"): ("PRESERVE_SOURCE_FACT", "pos_sales_hour.net_sales"),
    ("hourly_sales_summary", "gross_sales"): ("PRESERVE_SOURCE_FACT", "pos_sales_hour.gross_sales"),
    ("hourly_sales_summary", "avg_order_net_sales"): ("DERIVE_NOT_STORE", "v_pos_sales_hour_current.average_order_value"),
    ("hourly_sales_summary", "total_discount"): ("PRESERVE_SOURCE_FACT", "pos_sales_hour.discount_amount"),
    ("hourly_sales_summary", "synced_at"): ("BATCH_PROVENANCE", "pos_ingest_batch.completed_at"),

    ("item_waste", "id"): ("PRESERVE_SOURCE_ID", "pos_item_waste.source_waste_id"),
    ("item_waste", "date"): ("PRESERVE_SOURCE_FACT", "pos_item_waste.business_date"),
    ("item_waste", "item_name"): ("PRESERVE_SOURCE_FACT", "pos_item_waste.source_name_snapshot"),
    ("item_waste", "waste_reason"): ("PRESERVE_AND_NORMALIZE", "pos_item_waste.reason_raw | pos_item_waste.reason_code | pos_item_waste.reason_mapping_version"),
    ("item_waste", "qty"): ("PRESERVE_SOURCE_FACT", "pos_item_waste.quantity"),
    ("item_waste", "amount"): ("PRESERVE_SOURCE_FACT", "pos_item_waste.source_waste_amount"),
    ("item_waste", "synced_at"): ("BATCH_PROVENANCE", "pos_ingest_batch.completed_at"),
    ("item_waste", "store"): ("RESOLVE_STABLE_ID", "pos_item_waste.location_id"),
    ("item_waste", "item_key"): ("RESOLVE_STABLE_ID", "pos_item_waste.listing_id"),

    # Current BakeryOps product row -> global master plus a versioned, location-aware policy.
    ("product", "id"): ("REKEY", "ops_product.product_id | ops_product.product_code"),
    ("product", "category"): ("NORMALIZE_CONTROLLED_CODE", "ops_product.category_code"),
    ("product", "name"): ("PRESERVE_SOURCE_FACT", "ops_product.product_name"),
    ("product", "name_en"): ("PRESERVE_SOURCE_FACT", "ops_product.english_name"),
    ("product", "price"): ("VERSION_SCOPED_POLICY", "ops_business_rule.scope_location_id | ops_business_rule.scope_product_id | ops_business_rule.rule_value | ops_business_rule.schema_version"),
    ("product", "pack_multiple"): ("PRESERVE_MANUAL_INPUT", "ops_product.pack_multiple"),
    ("product", "unit_type"): ("NORMALIZE_CONTROLLED_CODE", "ops_product.planning_rounding_mode"),
    ("product", "display_full_quantity"): ("VERSION_SCOPED_POLICY", "ops_business_rule.scope_location_id | ops_business_rule.scope_product_id | ops_business_rule.rule_value | ops_business_rule.schema_version"),
    ("product", "created_at"): ("PRESERVE_AUDIT_TIME", "ops_product.created_at"),
    ("product", "updated_at"): ("PRESERVE_AUDIT_TIME", "ops_product.updated_at"),
    ("product", "item_key"): ("RESOLVE_SOURCE_MAPPING", "pos_product_listing.source_item_key | pos_product_mapping.product_id"),
    ("product", "positioning"): ("VERSION_SCOPED_POLICY", "ops_business_rule.scope_location_id | ops_business_rule.scope_product_id | ops_business_rule.rule_value | ops_business_rule.schema_version"),
    ("product", "cold_hot"): ("NORMALIZE_CONTROLLED_CODE", "ops_product.temperature_profile_code"),
    ("product", "sales_ratio"): ("VERSION_SCOPED_POLICY", "ops_business_rule.scope_location_id | ops_business_rule.scope_product_id | ops_business_rule.rule_value | ops_business_rule.schema_version"),
    ("product", "target_tc"): ("VERSION_SCOPED_POLICY_UNVERIFIED_MEASURE", "ops_business_rule.scope_location_id | ops_business_rule.scope_product_id | ops_business_rule.rule_value | ops_business_rule.schema_version"),
    ("product", "audience"): ("VERSION_SCOPED_POLICY", "ops_business_rule.scope_location_id | ops_business_rule.scope_product_id | ops_business_rule.rule_value | ops_business_rule.schema_version"),
    ("product", "break_stock_time"): ("VERSION_SCOPED_POLICY", "ops_business_rule.scope_location_id | ops_business_rule.scope_product_id | ops_business_rule.rule_value | ops_business_rule.schema_version"),
    ("product", "sort_order"): ("VERSION_SCOPED_POLICY", "ops_business_rule.scope_location_id | ops_business_rule.scope_product_id | ops_business_rule.rule_value | ops_business_rule.schema_version"),
    ("product", "avg_monday_to_thursday"): ("DERIVE_NOT_STORE", "DERIVE:v_pos_item_sales_day approved weekday baseline"),
    ("product", "avg_friday"): ("DERIVE_NOT_STORE", "DERIVE:v_pos_item_sales_day approved Friday baseline"),
    ("product", "avg_weekend"): ("DERIVE_NOT_STORE", "DERIVE:v_pos_item_sales_day approved weekend baseline"),
    ("product", "baseline_total_sales"): ("DERIVE_NOT_STORE", "DERIVE:v_pos_item_sales_day baseline quantity sum"),
    ("product", "baseline_day_count"): ("DERIVE_NOT_STORE", "DERIVE:v_pos_item_sales_day baseline sample day count"),
    ("product", "time_slots"): ("VERSION_SCOPED_POLICY", "ops_business_rule.scope_location_id | ops_business_rule.scope_product_id | ops_business_rule.rule_value | ops_business_rule.schema_version"),

    # Current RES catalog -> source listing snapshot; no source field is silently converted into enterprise truth.
    ("pos_product", "item_key"): ("PRESERVE_SOURCE_ID", "pos_product_listing.source_item_key"),
    ("pos_product", "item_id"): ("PRESERVE_SOURCE_ID", "pos_product_listing.source_item_id"),
    ("pos_product", "org_id"): ("PRESERVE_SOURCE_ID", "pos_product_listing.source_organization_id"),
    ("pos_product", "org_type"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_organization_type_code"),
    ("pos_product", "menu_item_code"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_menu_item_code"),
    ("pos_product", "name_en"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_name_en | pos_product_listing.source_name"),
    ("pos_product", "name_zh"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_name_zh"),
    ("pos_product", "category_id"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_category_id"),
    ("pos_product", "category_en"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_category_en | pos_product_listing.source_category"),
    ("pos_product", "category_zh"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_category_zh"),
    ("pos_product", "spec"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_specification"),
    ("pos_product", "sales_price"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.current_price | pos_product_listing.currency"),
    ("pos_product", "res_cost_card_id"): ("PRESERVE_SOURCE_ID", "pos_product_listing.source_cost_card_id"),
    ("pos_product", "res_spec_id"): ("PRESERVE_SOURCE_ID", "pos_product_listing.source_cost_spec_id"),
    ("pos_product", "has_cost_card"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_has_cost_card"),
    ("pos_product", "res_total_cost"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_total_cost | pos_product_listing.currency"),
    ("pos_product", "res_theoretical_cost"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_theoretical_cost | pos_product_listing.currency"),
    ("pos_product", "res_status"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.source_status_code"),
    ("pos_product", "first_seen_at"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.first_seen_at"),
    ("pos_product", "synced_at"): ("PRESERVE_SOURCE_FACT", "pos_product_listing.last_seen_at"),
    ("pos_product", "name_zh_display"): ("PRESERVE_MANUAL_OVERRIDE", "pos_product_listing.display_name_override"),
    ("pos_product", "category_display"): ("PRESERVE_MANUAL_OVERRIDE", "pos_product_listing.display_category_override"),

    # Current store/config row -> stable location, scoped rules, exact roles and governed source evidence.
    ("ops_store", "store_code"): ("PRESERVE_AND_REKEY", "ops_location.location_code | ops_location_source_identity.source_location_id"),
    ("ops_store", "name"): ("PRESERVE_MASTER_DATA", "ops_location.location_name"),
    ("ops_store", "address"): ("PRESERVE_MASTER_DATA", "ops_location.address_text"),
    ("ops_store", "area"): ("NORMALIZE_GOVERNED_CODE", "ops_location.area_code"),
    ("ops_store", "timezone"): ("PRESERVE_MASTER_DATA", "ops_location.timezone_name"),
    ("ops_store", "manager_user_id"): ("RESOLVE_SCOPED_ROLE", "app_user.user_id | app_user_role.user_role_id | app_user_location_scope.user_role_id"),
    ("ops_store", "head_chef_user_id"): ("RESOLVE_SCOPED_ROLE", "app_user.user_id | app_user_role.user_role_id | app_user_location_scope.user_role_id"),
    ("ops_store", "interview_windows"): ("VERSION_LOCATION_RULE", "ops_business_rule.scope_location_id | ops_business_rule.rule_code | ops_business_rule.rule_value"),
    ("ops_store", "lark_base_token"): ("PRESERVE_PUBLIC_SOURCE_CONTAINER_ID", "ops_location_source_identity.source_container_id"),
    ("ops_store", "lark_table_id"): ("PRESERVE_PUBLIC_SOURCE_LOCATION_ID", "ops_location_source_identity.source_location_id"),
    ("ops_store", "active"): ("NORMALIZE_CONTROLLED_STATUS", "ops_location.status"),
    ("ops_store", "created_at"): ("PRESERVE_AUDIT_TIME", "ops_location.created_at"),
    ("ops_store", "updated_at"): ("PRESERVE_AUDIT_TIME", "ops_location.updated_at"),
    ("ops_store", "trial_windows"): ("VERSION_LOCATION_RULE", "ops_business_rule.scope_location_id | ops_business_rule.rule_code | ops_business_rule.rule_value"),
    ("ops_store", "pos_store_name"): ("PRESERVE_SOURCE_IDENTITY_EVIDENCE", "ops_location_source_identity.source_location_name | ops_location_source_identity.source_location_id"),

    # Current finance template rows -> exact raw evidence columns plus confirmed stable IDs.
    ("finance_orders", "id"): ("PRESERVE_SOURCE_ROW_REF", "finance_order_logistics_line.source_row_ref"),
    ("finance_orders", "order_no"): ("PRESERVE_SOURCE_FACT", "finance_order_logistics_line.source_order_no"),
    ("finance_orders", "store"): ("RESOLVE_STABLE_ID", "finance_order_logistics_line.location_id"),
    ("finance_orders", "name"): ("PRESERVE_SOURCE_FACT", "finance_order_logistics_line.source_item_name"),
    ("finance_orders", "spec"): ("PRESERVE_SOURCE_FACT", "finance_order_logistics_line.source_specification"),
    ("finance_orders", "category"): ("PRESERVE_SOURCE_FACT", "finance_order_logistics_line.source_category"),
    ("finance_orders", "ptype"): ("PRESERVE_SOURCE_FACT", "finance_order_logistics_line.source_purchase_type"),
    ("finance_orders", "qty"): ("PRESERVE_SOURCE_FACT", "finance_order_logistics_line.quantity"),
    ("finance_orders", "amount"): ("PRESERVE_SOURCE_FACT", "finance_order_logistics_line.amount"),
    ("finance_orders", "volume"): ("PRESERVE_SOURCE_FACT_UNVERIFIED_UNIT", "finance_order_logistics_line.source_volume"),
    ("finance_orders", "supplier"): ("PRESERVE_AND_RESOLVE", "finance_order_logistics_line.source_supplier_name | finance_order_logistics_line.supplier_id"),
    ("finance_orders", "d_order"): ("PARSE_DATE_OR_BLOCK", "finance_order_logistics_line.order_date"),
    ("finance_orders", "d_pay"): ("PARSE_DATE_OR_BLOCK", "finance_order_logistics_line.payment_date"),
    ("finance_orders", "d_ship"): ("PARSE_DATE_OR_BLOCK", "finance_order_logistics_line.shipped_date"),
    ("finance_orders", "d_arrive"): ("PARSE_DATE_OR_BLOCK", "finance_order_logistics_line.arrived_port_date"),
    ("finance_orders", "d_deliver"): ("PARSE_DATE_OR_BLOCK", "finance_order_logistics_line.delivered_date"),
    ("finance_orders", "d_inbound"): ("PARSE_DATE_OR_BLOCK", "finance_order_logistics_line.warehoused_date"),

    ("finance_stock", "id"): ("PRESERVE_SOURCE_ROW_REF", "finance_inventory_snapshot_line.source_row_ref"),
    ("finance_stock", "month"): ("PARSE_MONTH_OR_BLOCK", "finance_inventory_snapshot_line.business_month"),
    ("finance_stock", "store"): ("RESOLVE_STABLE_ID", "finance_inventory_snapshot_line.location_id"),
    ("finance_stock", "name"): ("PRESERVE_SOURCE_FACT", "finance_inventory_snapshot_line.source_item_name"),
    ("finance_stock", "spec"): ("PRESERVE_SOURCE_FACT", "finance_inventory_snapshot_line.specification"),
    ("finance_stock", "category"): ("PRESERVE_SOURCE_FACT", "finance_inventory_snapshot_line.source_category"),
    ("finance_stock", "ptype"): ("NORMALIZE_AND_PRESERVE", "finance_inventory_snapshot_line.purchase_type"),
    ("finance_stock", "in_stock"): ("PRESERVE_SOURCE_FACT", "finance_inventory_snapshot_line.on_hand_quantity"),
    ("finance_stock", "in_transit"): ("PRESERVE_SOURCE_FACT", "finance_inventory_snapshot_line.in_transit_quantity"),
    ("finance_stock", "monthly_use"): ("PRESERVE_SOURCE_FACT", "finance_inventory_snapshot_line.monthly_usage_quantity"),
    ("finance_stock", "unit_volume"): ("PRESERVE_SOURCE_FACT_UNVERIFIED_UNIT", "finance_inventory_snapshot_line.source_unit_volume"),

    # Current item-hour POS facts -> exact batch, listing and hour fact fields.
    ("item_hourly_sales", "id"): ("REKEY_NOT_COPY", "NO_TARGET:legacy surrogate row id; target UUID plus batch natural key replaces it"),
    ("item_hourly_sales", "date"): ("PARSE_BUSINESS_DATE", "pos_item_sales_hour.business_date"),
    ("item_hourly_sales", "hour"): ("PARSE_LOCATION_HOUR", "pos_item_sales_hour.hour_started_at"),
    ("item_hourly_sales", "item_name"): ("PRESERVE_SOURCE_NAME", "pos_item_sales_hour.source_name_snapshot | pos_product_listing.source_name"),
    ("item_hourly_sales", "qty"): ("PRESERVE_SOURCE_FACT", "pos_item_sales_hour.quantity"),
    ("item_hourly_sales", "net_sales"): ("PRESERVE_SOURCE_FACT", "pos_item_sales_hour.net_sales"),
    ("item_hourly_sales", "gross_sales"): ("PRESERVE_SOURCE_FACT", "pos_item_sales_hour.gross_sales"),
    ("item_hourly_sales", "synced_at"): ("BATCH_PROVENANCE", "pos_ingest_batch.completed_at"),
    ("item_hourly_sales", "store"): ("RESOLVE_STABLE_LOCATION", "pos_item_sales_hour.location_id | pos_ingest_batch.location_id"),
    ("item_hourly_sales", "item_key"): ("RESOLVE_SOURCE_LISTING", "pos_product_listing.source_item_key | pos_item_sales_hour.listing_id"),

    # Current mixed candidate/employee rows -> person, contact, application, employment and immutable events.
    ("employees", "id"): ("PRESERVE_SOURCE_ID_NOT_TARGET_UUID", "hr_employment_source_identity.source_employee_id | hr_employment_mapping_review.source_employee_id"),
    ("employees", "name"): ("PRESERVE_DISPLAY_NAME_NOT_IDENTITY_KEY", "hr_person.display_name"),
    ("employees", "phone"): ("ENCRYPT_AND_HASH_CONTACT", "hr_person_contact.contact_type | hr_person_contact.contact_ciphertext | hr_person_contact.lookup_hash"),
    ("employees", "email"): ("ENCRYPT_AND_HASH_CONTACT", "hr_person_contact.contact_type | hr_person_contact.contact_ciphertext | hr_person_contact.lookup_hash"),
    ("employees", "source"): ("RESOLVE_SOURCE_NAMESPACE", "hr_employment_source_identity.source_system_id | hr_application.source_system_id"),
    ("employees", "source_url"): ("PRESERVE_RESTRICTED_SOURCE_EVIDENCE", "hr_application_stage_event.evidence | hr_employment_mapping_review.evidence"),
    ("employees", "candidate_id"): ("PRESERVE_AND_RESOLVE_APPLICATION_ID", "hr_application.source_application_id | hr_employment.origin_application_id"),
    ("employees", "job_title"): ("PRESERVE_EMPLOYMENT_FACT", "hr_employment.job_title"),
    ("employees", "department"): ("PRESERVE_PROFILE_EVIDENCE", "hr_application_stage_event.evidence"),
    ("employees", "store_id"): ("RESOLVE_STABLE_LOCATION", "hr_employment.home_location_id"),
    ("employees", "status"): ("SPLIT_LIFECYCLE_STATE", "hr_application_stage_event.to_stage | hr_employment.status | hr_employee_event.event_type"),
    ("employees", "applied_at"): ("PRESERVE_APPLICATION_TIME", "hr_application.applied_at"),
    ("employees", "interviewed_at"): ("PRESERVE_STAGE_EVENT_TIME", "hr_application_stage_event.occurred_at"),
    ("employees", "hired_at"): ("PRESERVE_HIRE_TIME", "hr_employment.started_on | hr_application_stage_event.occurred_at"),
    ("employees", "resigned_at"): ("PRESERVE_RESIGNATION_EVENT", "hr_employment.ended_on | hr_employee_event.effective_date | hr_employee_event.event_data"),
    ("employees", "skills"): ("PRESERVE_PROFILE_SNAPSHOT_EVIDENCE", "hr_application_stage_event.evidence"),
    ("employees", "languages"): ("PRESERVE_PROFILE_SNAPSHOT_EVIDENCE", "hr_application_stage_event.evidence"),
    ("employees", "education"): ("PRESERVE_PROFILE_SNAPSHOT_EVIDENCE", "hr_application_stage_event.evidence"),
    ("employees", "experience_summary"): ("PRESERVE_PROFILE_SNAPSHOT_EVIDENCE", "hr_application_stage_event.evidence"),
    ("employees", "location"): ("PRESERVE_PROFILE_SNAPSHOT_EVIDENCE", "hr_application_stage_event.evidence"),
    ("employees", "resume_file_id"): ("PRESERVE_RESTRICTED_RESUME_REFERENCE", "hr_application_stage_event.evidence"),
    ("employees", "resume_text"): ("PRESERVE_WITH_RETENTION_OR_DELETE", "hr_application_stage_event.evidence"),
    ("employees", "metadata"): ("PARSE_APPROVED_KEYS_AND_PRESERVE_EVIDENCE", "hr_application_stage_event.evidence | hr_employment_mapping_review.evidence"),
    ("employees", "created_at"): ("PRESERVE_SOURCE_AUDIT_EVIDENCE", "hr_employment_source_identity.evidence"),
    ("employees", "updated_at"): ("PRESERVE_SOURCE_AUDIT_EVIDENCE", "hr_employment_source_identity.evidence"),

    # Current cost-card price rows -> raw observation when supplier evidence exists plus adopted effective price.
    ("cost_card_item_price", "id"): ("PRESERVE_SOURCE_ID", "scm_supplier_price_observation.source_record_id | cost_card_material_price.evidence"),
    ("cost_card_item_price", "item_id"): ("RESOLVE_MATERIAL_AND_SUPPLIER_ITEM", "scm_supplier_price_observation.supplier_item_id | cost_card_material_price.material_id"),
    ("cost_card_item_price", "supplier"): ("RESOLVE_SUPPLIER_ITEM_OR_MANUAL_PRICE", "scm_supplier_price_observation.supplier_item_id | scm_supplier_price_observation.normalization_detail"),
    ("cost_card_item_price", "unit_price"): ("PRESERVE_RAW_AND_NORMALIZE", "scm_supplier_price_observation.raw_unit_price | cost_card_material_price.price_myr_per_base_unit"),
    ("cost_card_item_price", "currency"): ("PRESERVE_SOURCE_CURRENCY", "scm_supplier_price_observation.currency"),
    ("cost_card_item_price", "price_unit"): ("PRESERVE_AND_RESOLVE_UNIT", "scm_supplier_price_observation.raw_price_unit_text | scm_supplier_price_observation.raw_price_unit_id | scm_supplier_price_observation.material_unit_conversion_id"),
    ("cost_card_item_price", "effective_from"): ("PRESERVE_EFFECTIVE_BOUNDARY", "cost_card_material_price.effective_from | scm_supplier_price_observation.observed_at"),
    ("cost_card_item_price", "effective_to"): ("PRESERVE_EFFECTIVE_BOUNDARY", "cost_card_material_price.effective_to"),
    ("cost_card_item_price", "source"): ("NORMALIZE_SOURCE_PROVENANCE", "scm_supplier_price_observation.source_system_id | scm_supplier_price_observation.observation_type | cost_card_material_price.price_source"),
    ("cost_card_item_price", "created_by"): ("RESOLVE_ACTOR", "scm_supplier_price_observation.verified_by_user_id | cost_card_material_price.created_by_user_id"),
    ("cost_card_item_price", "created_at"): ("PRESERVE_OBSERVATION_TIME_EVIDENCE", "scm_supplier_price_observation.observed_at | scm_supplier_price_observation.normalization_detail"),
    ("cost_card_item_price", "price_quantity"): ("PRESERVE_NORMALIZATION_INPUT", "scm_supplier_price_observation.normalization_detail | scm_supplier_price_observation.material_unit_conversion_id"),
    ("cost_card_item_price", "normalized_price_myr"): ("DERIVE_AND_RECONCILE_NOT_STORE", "DERIVE:raw_unit_price × fx_rate_to_myr ÷ verified unit conversion and price_quantity"),
    ("cost_card_item_price", "normalized_unit"): ("DERIVE_AND_RECONCILE_NOT_STORE", "DERIVE:cost_card_material_price.material_id -> scm_material.base_unit_id"),
    ("cost_card_item_price", "exchange_rate_id"): ("PRESERVE_FX_SOURCE_REFERENCE", "scm_supplier_price_observation.fx_source_ref"),
    ("cost_card_item_price", "verification_state"): ("NORMALIZE_QUALITY_STATE", "scm_supplier_price_observation.quality_status | cost_card_material_price.quality_status"),
    ("cost_card_item_price", "verification_note"): ("PRESERVE_VERIFICATION_EVIDENCE", "scm_supplier_price_observation.normalization_detail | cost_card_material_price.evidence"),

    # Current internal staff directory -> employment/source identity plus governed application account state.
    ("staff", "user_id"): ("PRESERVE_CHANNEL_SOURCE_ID", "hr_employment_source_identity.source_employee_id | app_user.person_id"),
    ("staff", "name"): ("PRESERVE_DISPLAY_NAME_NOT_IDENTITY_KEY", "hr_person.display_name | app_user.display_name"),
    ("staff", "role"): ("NORMALIZE_EMPLOYMENT_AND_RBAC_ROLE", "hr_employment.job_title | app_user_role.role_id"),
    ("staff", "is_active"): ("NORMALIZE_PERSON_ACCOUNT_STATUS", "hr_employment.status | app_user.status"),
    ("staff", "phone"): ("ENCRYPT_AND_HASH_CONTACT", "hr_person_contact.contact_type | hr_person_contact.contact_ciphertext | hr_person_contact.lookup_hash"),
    ("staff", "lid"): ("PRESERVE_CHANNEL_SOURCE_ID", "hr_employment_source_identity.source_employee_id | hr_employment_mapping_review.evidence"),
    ("staff", "permissions"): ("REAUTHORIZE_NOT_COPY_FREE_TEXT", "app_user_role.role_id"),
    ("staff", "store_ids"): ("RESOLVE_ROLE_SCOPED_LOCATIONS", "app_user_location_scope.user_role_id | app_user_location_scope.location_id"),
    ("staff", "lark_open_id"): ("PRESERVE_LARK_SOURCE_ID", "hr_employment_source_identity.source_employee_id"),
    ("staff", "lark_department"): ("PRESERVE_SOURCE_EVIDENCE", "hr_employment_source_identity.evidence | hr_employment_mapping_review.evidence"),
    ("staff", "alias"): ("PRESERVE_PREFERRED_NAME", "hr_person.preferred_name | app_user.display_name"),
    ("staff", "subscriptions"): ("PRESERVE_GOVERNED_NOTIFICATION_PREFERENCE", "app_user.notification_subscription_codes"),
    ("staff", "lark_synced_at"): ("PRESERVE_SOURCE_SYNC_EVIDENCE", "hr_employment_source_identity.evidence"),
    ("staff", "created_at"): ("PRESERVE_SOURCE_AUDIT_EVIDENCE", "hr_employment_source_identity.evidence"),
    ("staff", "updated_at"): ("PRESERVE_SOURCE_AUDIT_EVIDENCE", "hr_employment_source_identity.evidence"),

    # Current cost-card recipe header -> a concrete immutable business version.
    ("cost_card_recipe", "id"): ("REKEY_DETERMINISTIC_VERSION_ID_PRESERVE_SOURCE", "cost_card_recipe_version.recipe_version_id | MIGRATION_MANIFEST:source_recipe_id"),
    ("cost_card_recipe", "item_id"): ("GROUP_RECIPE_FAMILY_AND_RESOLVE_EXACT_OUTPUT", "cost_card_recipe_version.recipe_code | cost_card_recipe_version.output_product_id | cost_card_recipe_version.output_material_id"),
    ("cost_card_recipe", "version"): ("PRESERVE_VERSION", "cost_card_recipe_version.version_no"),
    ("cost_card_recipe", "status"): ("NORMALIZE_STATUS", "cost_card_recipe_version.status"),
    ("cost_card_recipe", "batch_yield"): ("PRESERVE_SOURCE_FACT", "cost_card_recipe_version.batch_yield_quantity"),
    ("cost_card_recipe", "batch_unit"): ("RESOLVE_CONTROLLED_UNIT", "cost_card_recipe_version.yield_unit_id"),
    ("cost_card_recipe", "sale_price"): ("PRESERVE_MYR_REFERENCE_PRICE", "cost_card_recipe_version.reference_sale_price | cost_card_recipe_version.currency"),
    ("cost_card_recipe", "effective_from"): ("PRESERVE_NULL_ONLY_FOR_DRAFT", "cost_card_recipe_version.effective_from"),
    ("cost_card_recipe", "effective_to"): ("PRESERVE_EFFECTIVE_BOUNDARY", "cost_card_recipe_version.effective_to"),
    ("cost_card_recipe", "notes"): ("PRESERVE_MANUAL_NOTE", "cost_card_recipe_version.notes"),
    ("cost_card_recipe", "row_version"): ("PRESERVE_CONCURRENCY_STATE", "cost_card_recipe_version.lock_version"),
    ("cost_card_recipe", "created_by"): ("RESOLVE_ACTOR", "cost_card_recipe_version.created_by_user_id"),
    ("cost_card_recipe", "published_by"): ("RESOLVE_APPROVER", "cost_card_recipe_version.approved_by_user_id"),
    ("cost_card_recipe", "created_at"): ("PRESERVE_AUDIT_TIME", "cost_card_recipe_version.created_at"),
    ("cost_card_recipe", "updated_at"): ("PRESERVE_AUDIT_TIME", "cost_card_recipe_version.updated_at"),

    # Current finance daily template -> raw daily observations plus deterministic ratio.
    ("finance_revenue_daily", "date"): ("PARSE_BUSINESS_DATE", "finance_sales_daily.business_date"),
    ("finance_revenue_daily", "store"): ("RESOLVE_STABLE_LOCATION", "finance_sales_daily.location_id"),
    ("finance_revenue_daily", "revenue"): ("PRESERVE_NET_SALES", "finance_sales_daily.net_sales"),
    ("finance_revenue_daily", "gross_sales"): ("PRESERVE_GROSS_SALES", "finance_sales_daily.gross_sales"),
    ("finance_revenue_daily", "total_discount"): ("PRESERVE_DISCOUNT", "finance_sales_daily.discount_amount"),
    ("finance_revenue_daily", "discount_rate"): ("DERIVE_NOT_STORE", "DERIVE:finance_sales_daily.discount_amount / NULLIF(finance_sales_daily.gross_sales,0)"),
    ("finance_revenue_daily", "import_source"): ("PRESERVE_BATCH_PROVENANCE", "finance_import_batch.dataset_code | finance_import_batch.source_layer | finance_import_batch.source_system_id"),

    # Current HBTI wide response -> versioned campaign, normalized answers and versioned result.
    ("fact_hbti_response", "store"): ("RESOLVE_CAMPAIGN_LOCATION", "mkt_campaign_version.location_id"),
    ("fact_hbti_response", "member_id"): ("RESOLVE_STABLE_MEMBER", "mkt_campaign_member.member_id"),
    ("fact_hbti_response", "campaign_version"): ("RESOLVE_CAMPAIGN_VERSION", "mkt_campaign_version.campaign_code | mkt_campaign_version.version_no | mkt_campaign_member.campaign_version_id"),
    ("fact_hbti_response", "answered_at"): ("PRESERVE_RESPONSE_TIME", "mkt_survey_response.submitted_at | mkt_survey_answer.answered_at | mkt_survey_result.calculated_at"),
    ("fact_hbti_response", "attempt_id"): ("PRESERVE_SOURCE_RESPONSE_ID", "mkt_survey_response.source_response_id"),
    ("fact_hbti_response", "answers"): ("NORMALIZE_ANSWERS_AND_HASH", "mkt_survey_answer.survey_question_id | mkt_survey_answer.selected_option_id | mkt_survey_answer.rating_value | mkt_survey_answer.boolean_value | mkt_survey_answer.text_value | mkt_survey_response.validation_result | mkt_survey_result.input_sha256"),
    ("fact_hbti_response", "hbti_code"): ("PRESERVE_RESULT_CODE", "mkt_survey_result.result_code"),
    ("fact_hbti_response", "visit_time"): ("PRESERVE_Q5_RESULT_DIMENSION_ONLY", "mkt_survey_result.result_dimensions"),
    ("fact_hbti_response", "category"): ("PRESERVE_Q6_RESULT_DIMENSION_ONLY", "mkt_survey_result.result_dimensions"),
    ("fact_hbti_response", "color"): ("PRESERVE_RESULT_COLOR", "mkt_survey_result.result_color"),
    ("fact_hbti_response", "gender"): ("MIGRATE_AS_APPROVED_ANSWER_ONLY", "mkt_survey_question.survey_question_id | mkt_survey_answer.text_value | NO_TARGET:restricted archive when lawful basis or approved question is absent"),
    ("fact_hbti_response", "age"): ("MIGRATE_AS_APPROVED_ANSWER_ONLY", "mkt_survey_question.survey_question_id | mkt_survey_answer.text_value | NO_TARGET:restricted archive when lawful basis or approved question is absent"),

    # Legacy HBTI reward stock -> exact reward identity, stock control and claims.
    ("hbti_gift_stock", "template_name"): ("MATCH_EXACT_HASHED_REWARD_ALLOWLIST_OR_BLOCK", "mkt_reward.reward_id | mkt_reward_stock.reward_id | MIGRATION_MANIFEST:reward_template_allowlist"),
    ("hbti_gift_stock", "display_name"): ("PRESERVE_DISPLAY_NAME_NOT_IDENTITY", "mkt_reward.reward_name | MIGRATION_MANIFEST:source_display_name"),
    ("hbti_gift_stock", "initial_stock"): ("PRESERVE_ALLOCATED_QUANTITY", "mkt_reward_stock.allocated_quantity"),
    ("hbti_gift_stock", "issued_count"): ("PRESERVE_REDEEMED_CONTROL_COUNT", "mkt_reward_stock.redeemed_quantity | v_mkt_reward_stock_reconciliation.cached_redeemed_quantity"),
    ("hbti_gift_stock", "is_active"): ("PRESERVE_POOL_ELIGIBILITY_EVIDENCE", "MIGRATION_MANIFEST:source_pool_is_active | mkt_campaign_version.reward_rule"),
    ("hbti_gift_stock", "updated_at"): ("PRESERVE_STOCK_UPDATE_TIME", "mkt_reward_stock.updated_at"),

    # Current Excel shift rows -> source job, plan version, role/station requirement and assignment.
    ("fact_shift", "work_date"): ("PRESERVE_BUSINESS_DATE", "ops_shift_plan_version.business_date"),
    ("fact_shift", "store_id"): ("RESOLVE_STABLE_LOCATION", "ops_shift_plan_version.location_id"),
    ("fact_shift", "area"): ("NORMALIZE_AREA_EVIDENCE", "ops_station.station_type | ops_shift_plan_version.validation_summary"),
    ("fact_shift", "staff_name"): ("RESOLVE_EMPLOYMENT_OR_BLOCK", "hr_employment_mapping_review.evidence | ops_shift_assignment.employment_id"),
    ("fact_shift", "post"): ("RESOLVE_ROLE_OR_OFF", "ops_role.role_code | ops_shift_requirement.role_id | NO_TARGET:OFF creates no zero-length assignment and remains import evidence"),
    ("fact_shift", "station"): ("RESOLVE_STATION_OR_BLOCK", "ops_station.station_code | ops_shift_requirement.station_id"),
    ("fact_shift", "on_time"): ("COMBINE_DATE_TIMEZONE", "ops_shift_requirement.shift_start | ops_shift_assignment.assigned_start"),
    ("fact_shift", "off_time"): ("COMBINE_DATE_TIMEZONE", "ops_shift_requirement.shift_end | ops_shift_assignment.assigned_end"),
    ("fact_shift", "duration_h"): ("PRESERVE_NET_DURATION_WITH_RECONCILIATION", "ops_shift_requirement.required_work_minutes | ops_shift_assignment.break_minutes | DERIVE:assigned span minutes minus break_minutes"),
    ("fact_shift", "notes"): ("PRESERVE_ASSIGNMENT_NOTE", "ops_shift_assignment.note"),
    ("fact_shift", "source_file"): ("PRESERVE_SOURCE_MANIFEST", "app_job_run.input_manifest | ops_shift_plan_version.source_job_run_id"),
    ("fact_shift", "imported_at"): ("PRESERVE_IMPORT_COMPLETION_TIME", "app_job_run.finished_at"),

    # Remaining CRITICAL current objects are also field-exact; object target lists are not accepted.
    ("cost_card_item", "id"): ("ROUTE_EXACT_TYPE_AND_PRESERVE_SOURCE_ID", "ops_product.product_id | scm_material.material_id | scm_material_source_identity.source_material_id | MIGRATION_MANIFEST:source_cost_item_id"),
    ("cost_card_item", "name"): ("PRESERVE_NAME_WITHOUT_IDENTITY_MERGE", "ops_product.product_name | ops_product_alias.alias_text | scm_material.material_name | MIGRATION_MANIFEST:source_alias_evidence"),
    ("cost_card_item", "item_type"): ("ROUTE_EXACT_FOUR_VALUE_TYPE_OR_BLOCK", "ops_product.product_type | scm_material.material_type"),
    ("cost_card_item", "base_unit"): ("MAP_EXACT_APPROVED_UNIT_OR_BLOCK", "ops_product.base_unit_id | scm_material.base_unit_id | app_unit.unit_code"),
    ("cost_card_item", "status"): ("MAP_EXACT_ACTIVE_STATUS", "ops_product.status | scm_material.status"),
    ("cost_card_item", "source_ref"): ("PRESERVE_INDEPENDENT_EVIDENCE_NULL_SAFE", "scm_material_source_identity.evidence | MIGRATION_MANIFEST:source_ref_evidence"),
    ("cost_card_item", "created_at"): ("PRESERVE_NEW_MASTER_TIME_OR_EXISTING_ALIAS_EVIDENCE", "ops_product.created_at | scm_material.created_at | MIGRATION_MANIFEST:source_alias_created_at"),
    ("cost_card_item", "updated_at"): ("PRESERVE_NEW_MASTER_TIME_OR_EXISTING_ALIAS_EVIDENCE", "ops_product.updated_at | scm_material.updated_at | MIGRATION_MANIFEST:source_alias_updated_at"),

    ("cost_card_product_link", "pos_item_id"): ("EXPAND_ALL_LISTINGS_THEN_RESOLVE_OR_REVIEW", "pos_product_listing.source_item_id | pos_product_mapping.listing_id | pos_product_mapping_review.listing_id"),
    ("cost_card_product_link", "item_id"): ("RESOLVE_UNIFIED_PRODUCT_OR_OPEN_REVIEW", "pos_product_mapping.product_id | cost_card_recipe_version.output_product_id | pos_product_mapping_review.candidate_product_id"),
    ("cost_card_product_link", "mapped_by"): ("NORMALIZE_MAPPING_METHOD", "pos_product_mapping.mapping_method | pos_product_mapping.evidence"),
    ("cost_card_product_link", "mapped_at"): ("PRESERVE_MAPPING_TIME", "pos_product_mapping.valid_from | pos_product_mapping.created_at"),
    ("cost_card_product_link", "note"): ("PRESERVE_MAPPING_EVIDENCE", "pos_product_mapping.evidence"),

    ("cost_card_recipe_item", "id"): ("REKEY_DETERMINISTIC_COMPONENT_ID_PRESERVE_SOURCE", "cost_card_recipe_component.recipe_component_id | MIGRATION_MANIFEST:source_recipe_item_id"),
    ("cost_card_recipe_item", "recipe_id"): ("RESOLVE_RECIPE_VERSION", "cost_card_recipe_component.recipe_version_id"),
    ("cost_card_recipe_item", "component_item_id"): ("RESOLVE_MATERIAL", "cost_card_recipe_component.material_id"),
    ("cost_card_recipe_item", "quantity"): ("PRESERVE_SOURCE_FACT", "cost_card_recipe_component.input_quantity"),
    ("cost_card_recipe_item", "unit"): ("RESOLVE_CONTROLLED_UNIT", "cost_card_recipe_component.input_unit_id | cost_card_recipe_component.material_unit_conversion_id"),
    ("cost_card_recipe_item", "net_yield"): ("PRESERVE_SOURCE_FACT", "cost_card_recipe_component.net_yield_rate"),
    ("cost_card_recipe_item", "loss_rate"): ("PRESERVE_SOURCE_FACT", "cost_card_recipe_component.loss_rate"),
    ("cost_card_recipe_item", "seq"): ("PRESERVE_SEQUENCE", "cost_card_recipe_component.sequence_no"),
    ("cost_card_recipe_item", "notes"): ("PRESERVE_COMPONENT_NOTE", "cost_card_recipe_component.note"),

    ("finance_store", "store"): ("PRESERVE_FINANCE_SOURCE_LOCATION_ID", "ops_location_source_identity.source_location_id | ops_location.location_code"),
    ("finance_store", "display_name"): ("PRESERVE_SOURCE_LOCATION_NAME", "ops_location_source_identity.source_location_name | ops_location.location_name"),
    ("finance_store", "is_active"): ("NORMALIZE_MAPPING_STATUS", "ops_location_source_identity.mapping_status | ops_location.status"),
    ("finance_store", "created_at"): ("PRESERVE_SOURCE_AUDIT_EVIDENCE", "ops_location_source_identity.evidence"),
    ("finance_store", "updated_at"): ("PRESERVE_SOURCE_AUDIT_EVIDENCE", "ops_location_source_identity.evidence"),
    ("finance_store", "active_from_month"): ("PARSE_FINANCE_MAPPING_VALID_FROM", "ops_location_source_identity.valid_from"),
    ("finance_store", "active_to_month"): ("PARSE_FINANCE_MAPPING_VALID_TO_EXCLUSIVE", "ops_location_source_identity.valid_to"),

    ("forecast_snapshot", "id"): ("REKEY_NOT_COPY", "NO_TARGET:legacy surrogate snapshot id; run and line UUIDs are generated"),
    ("forecast_snapshot", "date"): ("PARSE_TARGET_BUSINESS_DATE", "ops_forecast_run.target_business_date | ops_production_plan_version.plan_business_date"),
    ("forecast_snapshot", "product_name"): ("RESOLVE_PRODUCT_OR_BLOCK", "ops_forecast_line.product_id | ops_production_plan_line.product_id | ops_forecast_run.input_manifest"),
    ("forecast_snapshot", "suggested_qty"): ("CLASSIFY_FORECAST_VS_PLAN_VALUE", "ops_forecast_line.forecast_quantity | ops_production_plan_line.planned_quantity"),
    ("forecast_snapshot", "created_at"): ("PRESERVE_RUN_OR_PLAN_TIME", "ops_forecast_run.started_at | ops_production_plan_version.created_at"),

    ("pos_member_order_item", "order_id"): ("PRESERVE_AND_RESOLVE_ORDER", "pos_order.source_order_id | pos_order_item.order_id"),
    ("pos_member_order_item", "item_key"): ("PRESERVE_AND_RESOLVE_LISTING", "pos_order_item.source_item_key_snapshot | pos_order_item.listing_id"),
    ("pos_member_order_item", "business_date"): ("PRESERVE_SOURCE_FACT", "pos_order_item.business_date"),
    ("pos_member_order_item", "member_id"): ("RECOMPUTE_ATTRIBUTION_NOT_COPY", "DERIVE:v_pos_order_member_attribution.resolved_member_id"),
    ("pos_member_order_item", "qty"): ("PRESERVE_SOURCE_FACT", "pos_order_item.quantity"),
    ("pos_member_order_item", "net_sales"): ("PRESERVE_SOURCE_FACT", "pos_order_item.net_sales"),
    ("pos_member_order_item", "synced_at"): ("BATCH_PROVENANCE", "pos_ingest_batch.completed_at"),

    ("schema_migrations", "version"): ("PRESERVE_REPOSITORY_SCOPED_VERSION", "app_schema_migration.migration_version"),
    ("schema_migrations", "name"): ("PRESERVE_MIGRATION_NAME", "app_schema_migration.migration_name"),
    ("schema_migrations", "applied_at"): ("PRESERVE_APPLIED_TIME", "app_schema_migration.applied_at"),
    ("schema_migrations", "filename"): ("PRESERVE_FILENAME", "app_schema_migration.filename"),
    ("schema_migrations", "checksum"): ("VALIDATE_AND_PRESERVE_SHA256", "app_schema_migration.checksum_sha256"),

    # Current HBTI token state is deliberately invalidated; new rows are issued, never copied.
    ("hbti_auth_token", "token_hash"): ("REISSUE_NOT_MIGRATE", "NO_TARGET:invalidate legacy token hash"),
    ("hbti_auth_token", "kind"): ("REISSUE_NOT_MIGRATE", "NO_TARGET:new token kind chosen by new issuance contract"),
    ("hbti_auth_token", "state"): ("REISSUE_NOT_MIGRATE", "NO_TARGET:legacy authorization state expires"),
    ("hbti_auth_token", "attempts"): ("REISSUE_NOT_MIGRATE", "NO_TARGET:legacy retry state expires"),
    ("hbti_auth_token", "payload"): ("REISSUE_NOT_MIGRATE", "NO_TARGET:legacy authorization payload expires"),
    ("hbti_auth_token", "created_at"): ("REISSUE_NOT_MIGRATE", "NO_TARGET:legacy issuance time retained only in security archive"),
    ("hbti_auth_token", "expires_at"): ("REISSUE_NOT_MIGRATE", "NO_TARGET:legacy expiration retained only for cleanup"),
}


MANUAL_FIELD_RULES = {
    ("daily_revenue", "date"): "先验证写者和门店，再按地点营业时区严格解析 YYYY-MM-DD；解析失败进入审核，禁止截字符串或使用服务器时区猜日期。",
    ("daily_revenue", "revenue"): "已确认 RES/POS 行逐值迁入 pos_sales_day.net_sales；已确认 finance_template/财务导入行逐值迁入 finance_sales_daily.net_sales；未知写者阻断。NULL 与真实 0 保持区别。",
    ("daily_revenue", "transaction_count"): "按已确认写者迁入对应 order_count；来源 NULL 保持 NULL，不得用 POS 订单数补财务来源或用 0 补缺失。",
    ("daily_revenue", "avg_transaction_value"): "只有代码或来源文件证明该值是上游独立报告时才迁入 pos_sales_day.source_average_order_value；由 revenue/order_count 计算的旧值不复制，统一从同侧 net_sales/order_count 派生。无法区分来源时进入审核。",
    ("daily_revenue", "gross_sales"): "按已确认写者逐值迁入对应 gross_sales；来源 NULL 保持 NULL，禁止用 net_sales + discount 猜补。",
    ("daily_revenue", "total_discount"): "按已确认写者逐值迁入对应 discount_amount；来源 NULL 保持 NULL，禁止默认 0 或用 gross-net 代替。",
    ("daily_revenue", "discount_rate"): "不复制缓存比例；只从同一来源、同一币种的 discount_amount / NULLIF(gross_sales,0) 派生，分子或分母缺失时返回 NULL。",
    ("daily_revenue", "member_sales_ratio"): "该兼容列不复制为销售日事实；从会员日报卡净核销与其明确分母派生 source_card_payment_ratio，并与 POS 分母版本并列，禁止把会员标记商品覆盖率当成会员销售占比。",
    ("daily_revenue", "store"): "通过已确认的 ops_location_source_identity 解析为同一 stable location_id；名称冲突或多候选进入审核，禁止按默认门店扩散历史行。",
    ("daily_revenue", "import_source"): "finance_template 明确路由到 finance_import_batch；NULL 只表示旧标记缺失，必须结合写入代码、批次/文件证据识别 POS 或财务写者，无法唯一识别的整行进入审核。",
}


MANUAL_FIELD_RULES.update({
    ("item_hourly_sales", "date"): "先解析 store 到唯一 location_id，再按该地点营业时区和营业日切点解释来源 date；禁止用服务器时区、synced_at 或 UTC::date 代替营业日。",
    ("item_hourly_sales", "hour"): "将来源整数小时与已确认 business_date、地点时区和营业日切点组合成唯一 hour_started_at；越界、夏令时歧义或跨日不明确即阻断。",
    ("item_hourly_sales", "item_name"): "逐值保留为 source_name_snapshot；只有 item_key 缺失且需建立隔离历史 listing 时才同时作为 listing.source_name，绝不能按名称绑定企业 product_id。",
    ("item_hourly_sales", "item_key"): "在 source_system_id + location_id 命名空间解析 source_item_key；唯一命中才填 listing_id，缺失或多候选进入映射审核并保留来源行。",
    ("employees", "id"): "旧 UUID 只转成来源命名空间内 source_employee_id，不复用为 person_id 或 employment_id；与 staff 重合必须依据来源ID、联系方式哈希、日期和地点确认。",
    ("employees", "name"): "原样保留为 display_name，但姓名不能生成 dedupe_fingerprint、person_id 或 employment_id；legal_name 只有经过证件授权核验时才另行录入。",
    ("employees", "phone"): "先规范化再在应用层加密保存 contact_ciphertext，并生成用途隔离 lookup_hash；明文不进入普通表、日志或迁移报告，NULL 不猜补。",
    ("employees", "email"): "规范化大小写与空白后加密保存 contact_ciphertext，并生成用途隔离 lookup_hash；不得用邮箱直接作为 person_id，NULL 保持 NULL。",
    ("employees", "status"): "按已验证旧状态字典拆分候选阶段、雇佣状态和人事事件；一个旧值不得同时制造互相矛盾的三类状态，未知值进入审核。转换表必须版本化并逐状态提供旧新样本契约测试。",
    ("employees", "applied_at"): "只作为申请发生时间迁入 hr_application.applied_at；不得用 created_at、interviewed_at 或当前时间补缺失。",
    ("employees", "interviewed_at"): "非空时追加 INTERVIEWED 申请阶段事件并保留绝对时间；不能覆盖申请当前阶段或冒充预约完成时间。缺 application_id、时间非法或早于 applied_at 时进入审核而不是调整时间。",
    ("employees", "hired_at"): "证据确认已入职时取地点时区自然日作为 employment.started_on，同时保留原绝对时间于申请阶段证据；未确认入职不得创建雇佣。",
    ("employees", "resigned_at"): "非空且雇佣已确认时写 ended_on 并追加 RESIGNATION 事件；原时间进入受 schema 校验 event_data，不能只把 status 改成离职而丢历史。",
    ("employees", "resume_file_id"): "仅保存受控对象存储引用、文件哈希和来源系统，不复制临时下载URL；无合法保留依据或已超期则明确删除并记录处置。迁移报告只记录不可逆哈希和计数，不暴露文件ID原文。",
    ("employees", "resume_text"): "只在批准招聘保留期内进入受限 MIGRATED_PROFILE_SNAPSHOT evidence；先扫描秘密和多余PII，超期或无合法依据不进入目标活跃库。",
    ("cost_card_item", "id"): "471条旧id必须逐行且只路由一次并写迁移清单：product 99中32条经cost_card_product_link.pos_item_id→POS listing→旧product.item_key独立身份链映现有product_id，不改canonical code；67条新建product_code=LEGACY-COST-ITEM-<id>；nonproduct 372条按旧id建立material_id和scm_material_source_identity.source_material_id。不得把名称或source_ref当身份键。",
    ("cost_card_item", "name"): "67个新product可保留为product_name，372个物料可保留为material_name；32个合并既有product只写来源alias/迁移证据，绝不覆盖canonical product_name。所有名称只作显示或alias，禁止用于身份合并。",
    ("cost_card_item", "item_type"): "只接受来源精确四值 product、ingredient、semi_finished、packaging：product→ops_product.product_type PRODUCED；其余分别→scm_material.material_type INGREDIENT/SEMI_FINISHED/PACKAGING。未知值或NULL整行BLOCK，不能按配方存在与否猜类型。",
    ("cost_card_item", "base_unit"): "按已审计实值精确映射：g共372→app_unit G，ea共94→app_unit EACH，个共5→app_unit EACH；ea与个共享目标受控单位EACH但保留原文本证据。未知单位BLOCK，不得按item_type补默认。",
    ("cost_card_item", "status"): "来源471条active精确映目标ACTIVE，并把来源原文及本次映射版本写迁移清单；任何未来非active、NULL或未知状态必须重新批准映射并整行BLOCK，不能按默认值自动激活。",
    ("cost_card_item", "source_ref"): "P0c只读聚合核实mysql451/manual14/NULL6/other0，旧口述465/5/6已作废；原值只进入迁移清单或scm_material_source_identity.evidence，绝不写pos_product_listing、pos_product_mapping或source_material_id；NULL原样保留。372条material的source_material_id必须使用旧row id而不是source_ref。",
    ("cost_card_item", "created_at"): "67个新product和372个新material保留来源创建时间；32个合并既有product只把来源时间放迁移清单/alias证据，绝不覆盖现有master.created_at。",
    ("cost_card_item", "updated_at"): "67个新product和372个新material保留来源更新时间；32个合并既有product只把来源时间放迁移清单/alias证据，绝不覆盖现有master.updated_at。",
    ("cost_card_item_price", "unit_price"): "完整保留旧原始金额；有已确认 supplier_item 才建立 raw_unit_price 观察。采用价必须由原价、price_quantity、单位换算和汇率重算，禁止直接把原金额当每基础单位MYR。",
    ("cost_card_item_price", "price_unit"): "原文本逐值进入 raw_price_unit_text；只有受控单位和物料专属换算唯一时才填 raw_price_unit_id/material_unit_conversion_id，否则标 UNIT_ERROR。",
    ("cost_card_item_price", "price_quantity"): "作为归一化输入保留在 normalization_detail，并与 price_unit 共同选择已核验换算；不得丢弃后假定为1。",
    ("cost_card_item_price", "normalized_price_myr"): "旧缓存值不进入物理事实；用原价×汇率÷计价数量÷已冻结单位换算重算并逐行对账，差异超过批准精度即阻断。重算所用汇率日期、换算ID和舍入规则必须进入 normalization_detail。",
    ("cost_card_item_price", "normalized_unit"): "旧文本只用于与 material.base_unit_id 核对，不写成第二套单位真相；不一致进入 UNIT_ERROR，不能改原料基础单位迎合旧缓存。",
    ("cost_card_item_price", "exchange_rate_id"): "旧汇率ID仅转成可追溯 fx_source_ref；必须从权威汇率来源重新取得数值和日期，不能把内部ID当汇率数值。来源币种为MYR时按政策使用1且保留原字段状态，非MYR缺汇率则标FX_MISSING。",
    ("cost_card_item_price", "verification_state"): "verified 只有单位、币种、供应商/人工证据及核验主体齐全才映为 VERIFIED；pending/legacy_unverified 映为 UNVERIFIED/ESTIMATED，不能自动升级。",
    ("staff", "user_id"): "按实际渠道注册 source_system_id 后保留为 source_employee_id；不得把 WhatsApp/Lark 标识直接复用为 app_user.user_id 或 employment_id。",
    ("staff", "permissions"): "自由权限字符串不得原样复制；逐项映射到已批准角色/权限矩阵并由授权人重新确认，只产生 app_user_role，未知权限阻断切换。",
    ("staff", "store_ids"): "每个旧地点先解析 stable location_id，再绑定到本次批准的具体 user_role_id；禁止把地点范围扩散到账号的所有角色。",
    ("staff", "subscriptions"): "规范化为大写已登记推送代码、去重并写 notification_subscription_codes；未知代码进入审核，空数组表示明确不订阅而不是来源缺失。",
    ("cost_card_recipe", "id"): "以已登记 source_system_id 为 UUIDv5 namespace、以 public.cost_card_recipe:<id> 为 name 生成 recipe_version_id；旧 id 只保存在迁移清单 source_recipe_id，绝不能写成 recipe_code。",
    ("cost_card_recipe", "item_id"): "同一旧 item_id 的行归入同一配方家族，recipe_code 固定为 LEGACY-COST-ITEM-<item_id>；再按 cost_card_item 类型和身份映射恰好解析一个 output_product_id 或 output_material_id，缺映射、双重候选或循环依赖均阻断。",
    ("cost_card_recipe", "batch_unit"): "只经 app_unit 或物料限定换算解析 yield_unit_id；自由文本未知时不得默认 g、piece 或 batch。",
    ("cost_card_recipe", "sale_price"): "非空旧值逐值迁入 reference_sale_price 并明确 currency='MYR'；NULL 保持 NULL。它只是迁移参考售价，不是成交价，也不参与补全缺失毛利。",
    ("cost_card_recipe", "effective_from"): "非空 date 按 Asia/Kuala_Lumpur 当日 00:00 转成绝对时间；经来源审计确认的唯一 DRAFT NULL 保持 NULL，其他 NULL 或任何非 DRAFT NULL 均阻断。",
    ("cost_card_recipe", "effective_to"): "旧值为含结束日；非空时按 Asia/Kuala_Lumpur 的下一日 00:00 转成目标半开区间 [effective_from,effective_to)，NULL 保持无确定终点。",
    ("cost_card_recipe", "row_version"): "逐值迁为 DRAFT 的 lock_version；任何更新按 compare-and-swap 递增，发布后冻结，不能与业务 version_no 混用。",
    ("cost_card_product_link", "pos_item_id"): "先在已登记 POS 来源命名空间展开 source_item_id 对应的全部 listing；逐 listing 保存证据，不能把裸 pos_item_id 直接当 listing_id。",
    ("cost_card_product_link", "item_id"): "每个 listing 只有在旧 cost item 与企业 product 身份证据唯一时才建立 pos_product_mapping；无唯一结论则创建 pos_product_mapping_review，source listing 写 listing_id、候选才写 candidate_product_id。item 67 的两个 listing 是 CONFLICT/OPEN，不得静默取第一个。",
    ("cost_card_recipe_item", "id"): "以已登记 source_system_id 为 UUIDv5 namespace、以 public.cost_card_recipe_item:<id> 为 name 生成 recipe_component_id；旧 id 只保存在迁移清单 source_recipe_item_id。",
    ("cost_card_recipe_item", "recipe_id"): "只能通过 cost_card_recipe.id 的迁移清单定位确定性 recipe_version_id；禁止把来源 bigint 直接强转、按家族取当前版本或按时间猜。",
    ("cost_card_recipe_item", "component_item_id"): "用 cost_card_item 来源 id 映射到唯一 scm_material.material_id；未映射、多候选或错误映到 product 均阻断。",
    ("cost_card_recipe_item", "unit"): "来源 g 必须解析到受控单位 G，并保留所用 app_unit/换算证据；不得只靠大小写文本或默认基础单位。遇到其他文本单位必须进入逐物料单位审核，不能顺手按克处理。",
    ("finance_revenue_daily", "date"): "先由 store 解析地点，再按地点营业时区严格解析 YYYY-MM-DD 为 business_date；格式不合法或门店不唯一时整行阻断。",
    ("finance_revenue_daily", "revenue"): "逐值迁入 net_sales，来源 NULL 保持 NULL；不得用 gross_sales-total_discount 猜补，也不得与 POS 日事实相互覆盖。",
    ("finance_revenue_daily", "gross_sales"): "逐值迁入 gross_sales，来源 NULL 保持 NULL；零值仅在来源明确返回0时成立。不得从 net_sales 与 discount_amount 反算后冒充来源原值，币种随同批次合同核对。",
    ("finance_revenue_daily", "total_discount"): "逐值迁入 discount_amount，来源 NULL 保持 NULL；不得用 gross-net 反算后冒充来源观察。",
    ("finance_revenue_daily", "discount_rate"): "不复制比例缓存；仅从同一 finance_import_batch、location、business_date、currency 的 discount_amount/NULLIF(gross_sales,0) 派生，缺任一输入返回NULL。",
    ("pos_member", "hbti_visit_time"): "这是旧 HBTI 结果维度，只能保留到mkt_survey_result.result_dimensions.visit_time（Q5语义）；不得写mkt_survey_answer、不得反推response.started_at。只有fact_hbti_response.answers里真实Q5答案才建立answer。",
    ("pos_member", "hbti_category"): "这是旧 HBTI 结果维度，只能保留到mkt_survey_result.result_dimensions.category（Q6语义）；不得写mkt_survey_answer、不得改写result_label。只有fact_hbti_response.answers里真实Q6答案才建立answer。",
    ("pos_member", "hbti_status"): "旧processing/issued/review/unrewarded只作奖励与验证证据，禁止直映mkt_campaign_member.status或mkt_survey_response.status。result-only response固定SUBMITTED；只有完整真实answers通过验证才可VALIDATED。",
    ("pos_member", "hbti_attempt_id"): "有真实来源attempt才原样保存source_response_id并令attempt_no=1；6条result-only必须attempt_no=NULL，并按登记legacy source_system构造migration-only:+UUIDv5(root 7ab6debe-4d90-50e2-ab29-9873d96e848d, typed-JCS [mkt_survey_response,source_system,public.pos_member,store,member_id,campaign_version,RESULT_ONLY])。迁移清单保存公式、hash和非来源观察标志，禁止冒充attempt。",
    ("pos_member", "hbti_completed_at"): "只与已存在的mkt_survey_result事实共同作为活动完成证据；不得单独把旧hbti_status推成COMPLETED，也不得用它补response.started_at。",
    ("hbti_gift_stock", "template_name"): "只允许机器fixture中10个逐字节模板；9个库存模板映PHYSICAL_GIFT，Pistachio Green Jewel映COUPON。模板名只用于精确白名单查表，未知值立即BLOCK，禁止contains/前后缀/大小写模糊匹配。",
    ("hbti_gift_stock", "display_name"): "保留为reward_name显示快照和迁移证据，不参与身份合并；Heart显示名与现有Heart奖励只有在fixture stable anchor相同才合并，禁止按相似名字创造第11个身份。",
    ("hbti_gift_stock", "initial_stock"): "9行逐值迁allocated_quantity，合计必须为1376；不得用当前剩余量或issued_count覆盖初始分配，也不得为Pistachio的stockless外部履约虚构库存。",
    ("hbti_gift_stock", "issued_count"): "9行逐值迁redeemed_quantity，来源合计必须为2；Heart有1条stock-backed claim，Butterfly issued=1但0 claim时核对必须DRIFT，禁止补造claim追平。",
    ("hbti_gift_stock", "is_active"): "它只表示旧抽奖池是否参与抽取，进入迁移清单和活动reward_rule证据；不能直接退休全局reward，也不能据此改写历史claim或库存计数。",
    ("hbti_gift_stock", "updated_at"): "保留旧库存控制行最后更新时间到mkt_reward_stock.updated_at；它不是领取、预留、履约或POS消费发生时间，缺少这些业务时刻不得用它补值。",
    ("pos_member", "hbti_gender"): "旧会员快照字段只进入受限迁移归档，活跃目标为零；不得写 client_context、不得推成正式答案，也不得从它生成问题、选项或结果维度。归档访问必须继续遵守隐私保留期。",
    ("pos_member", "hbti_age"): "旧会员快照字段只进入受限迁移归档，活跃目标为零；不得写 client_context、不得推成正式答案，也不得强转精确年龄或生成年龄段。归档访问必须继续遵守隐私保留期。",
    ("fact_hbti_response", "answered_at"): "只迁到 response.submitted_at、answer.answered_at 和 result.calculated_at 的相应已发生时间；绝不能映射或补写 response.started_at。",
    ("fact_hbti_response", "answers"): "只有 fact_hbti_response.answers 中真实存在的答案才能按 question_code 展开并生成规范化 input_sha256；结果-only 历史不得由 pos_member 结果字段反推答案，必须保留 NULL hash 并标 INCOMPLETE_INPUT。",
    ("fact_hbti_response", "visit_time"): "独立列只保留到result_dimensions.visit_time（Q5语义），不得单独生成selected option或任何answer；只有同一fact.answers里真实Q5答案才可建立answer。它不是开始时间，不得写response.started_at。",
    ("fact_hbti_response", "category"): "独立列只保留到result_dimensions.category（Q6语义），不得单独生成selected option或任何answer；只有同一fact.answers里真实Q6答案才可建立answer。它不是result_label。",
    ("fact_hbti_response", "gender"): "只有 fact_hbti_response.answers 中真实存在且已批准的人口属性题目答案才可迁入；当前已审计活跃迁移数为 0，其余只进受限归档，不得从姓名或其他结果推断。",
    ("fact_hbti_response", "age"): "只有 fact_hbti_response.answers 中真实存在且已批准的年龄题答案才可迁入；当前已审计活跃迁移数为 0，其余只进受限归档，不得强转或塞进 client_context。",
    ("fact_shift", "post"): "工作行按受控别名解析 role_id；OFF 行不创建零时长 requirement/assignment，当前空表若切换前出现OFF行必须先批准缺勤/休息语义再迁移。",
    ("fact_shift", "on_time"): "与 work_date、location timezone 组合为绝对开始时间；不允许仅保存无日期 time，来源 NULL 只有OFF行可接受。",
    ("fact_shift", "off_time"): "与 work_date、地点时区及跨午夜规则组合为绝对结束时间；若 off<=on 只有批准的跨午夜政策可加一天，否则阻断。",
    ("fact_shift", "duration_h"): "把人工净工时转分钟并与绝对时段核对；差额非负且符合批准餐休规则时才写 break_minutes，负值或不一致进入审核，不拿它当实际工时。",
    ("fact_shift", "source_file"): "只在 app_job_run.input_manifest 保存文件名、文件哈希、工作表和解析版本，并以 source_job_run_id 连接班表；不保存本机临时路径。",
    ("fact_shift", "imported_at"): "保存为对应导入 job_run.finished_at；不得写成班表业务日期、发布时刻或来源文件修改时间。NULL或早于任务开始时间时阻断该批次，不能以当前时间补齐。",
    ("forecast_snapshot", "suggested_qty"): "先由真实写入代码/页面语义判定是算法预测还是人工采用计划；前者迁 forecast_quantity，后者迁 planned_quantity，无法判定整行进入审核，禁止双写。",
    ("pos_member_order_item", "member_id"): "不复制冗余 member_id；从同来源系统+地点+订单ID的卡交易重算，恰好一个会员才输出resolved_member_id，多会员与零匹配分别保持AMBIGUOUS/UNMATCHED。",
    ("schema_migrations", "version"): "先用迁移文件和写入项目证据确定 repository_code，再把旧整数格式化为该仓库 migration_version；仓库不明时阻断，禁止并入全局数字序列。",
    ("schema_migrations", "checksum"): "仅接受与实际迁移文件重新计算结果一致的64位SHA-256；空值或非SHA旧值进入核验，不能生成伪校验值。校验前必须先确认 repository_code 和 filename，跨仓库同版本号不得共用校验值。",
    ("daily_breakdown", "ratio"): "不复制来源缓存比例；只从同一获准 current 批次、地点、营业日、dimension_type 和币种内的 net_sales 分子与明确分母派生。分子或分母缺失、分母为0时返回NULL，并与旧值做样本核对。",
})


STRICT_FIELD_MAPPING_OBJECTS = {
    mapping.current_object
    for mapping in TABLE_MAPPINGS
    if mapping.risk == "CRITICAL"
} | {"finance_revenue_daily", "fact_hbti_response"}

for key, (action, destination) in MANUAL_FIELD_DISPOSITIONS.items():
    if key[0] not in STRICT_FIELD_MAPPING_OBJECTS or key in MANUAL_FIELD_RULES:
        continue
    MANUAL_FIELD_RULES[key] = (
        f"本字段只能按字段级动作 {action} 处理，唯一允许的目标或处置为 {destination}；"
        "不得退回对象级目标列表、按同名猜列或用其他字段补值。来源 NULL、原始符号、精度、时区、"
        "敏感等级和来源命名空间必须原样保留；解析证据不唯一时整行进入审核。"
    )


def constraint_defs(name: str, kind: str) -> list[str]:
    return [
        x["definition"]
        for x in CURRENT_CONSTRAINTS[name]
        if x["constraint_type"] == kind
    ]


def current_grain(name: str, comment: str | None) -> tuple[str, str]:
    """Return a cautious grain description and evidence status."""
    if comment:
        candidates = re.split(r"[。；;\n]", comment)
        for sentence in candidates[:4]:
            if "一行" in sentence or "按天" in sentence or "快照" in sentence:
                return sentence.strip(), "已确认：生产库表注释"
    pks = constraint_defs(name, "primary_key")
    uniques = constraint_defs(name, "unique")
    if pks:
        return f"结构上由 {pks[0]} 唯一标识；业务粒度仍需由写入方确认", "合理推测：结构约束"
    if uniques:
        return f"结构上由 {uniques[0]} 去重；业务粒度仍需由写入方确认", "合理推测：结构约束"
    return "没有主键或唯一约束足以证明一行的业务含义", "待验证"


COMMON_CURRENT_FIELD_MEANINGS = {
    "id": "该表当前使用的技术行标识；具体稳定性取决于表约束。",
    "created_at": "该行首次写入数据库的时间。",
    "updated_at": "该行最后一次更新数据库的时间。",
    "date": "当前表使用的日期字段；是否为营业日及其时区需按写入代码确认。",
    "store": "当前库使用的门店文本/代码；现有表之间没有统一稳定身份保证。",
    "store_id": "当前表声明的门店标识；需确认它引用哪套门店主数据。",
    "product_id": "产品标识；需核对它引用 product、pos_product 还是成本卡对象。",
    "item_key": "POS 来源商品组合键；它是来源身份，不等于统一 product_id。",
    "item_name": "来源或展示商品名；可变且不能作为跨模块稳定连接键。",
    "member_id": "POS 来源会员标识；需与门店/来源命名空间一起解释。",
    "employee_id": "当前员工标识；需核对 employees、staff 或外部人事来源。",
    "status": "该行业务状态；合法状态集合以当前 CHECK 或写入代码为准。",
    "metadata": "半结构化补充数据；字段级含义需由写入方 schema 说明。",
    "source": "来源标签；当前是否有受控字典和强约束需逐表确认。",
    "amount": "金额；币种、含税口径和正负号语义需按表确认。",
    "quantity": "数量；单位需按表及写入源确认。",
}


def current_field_meaning(column: dict) -> tuple[str, str]:
    if column.get("column_comment"):
        return column["column_comment"], "已确认：生产库字段注释"
    name = column["column_name"]
    if name in COMMON_CURRENT_FIELD_MEANINGS:
        return COMMON_CURRENT_FIELD_MEANINGS[name], "合理推测：通用命名；需代码确认"
    if name.endswith("_id"):
        return f"字段名显示它可能存放 {name[:-3]} 的标识；当前数据库未给该列注释，是否有外键及命名空间见约束列。", "合理推测"
    if name.endswith("_at"):
        return f"字段名显示它可能存放 {name[:-3]} 的时间；发生、生效还是入库时间需由写入代码确认。", "合理推测"
    if name.endswith("_date") or name.endswith("_on"):
        return f"字段名显示它可能存放 {name} 对应的自然日；时区和业务口径待确认。", "合理推测"
    if name.startswith("is_") or name.startswith("has_"):
        return f"字段名显示它可能是 {name} 的布尔标记；NULL 与 false 是否不同需确认。", "合理推测"
    return "生产库没有该字段注释；仅凭字段名无法可靠确认其业务数据、单位或口径。", "待验证"


def access_summary(name: str, key: str) -> str:
    obj = CODE["by_object"].get(name, {})
    values = obj.get(key, [])
    return "、".join(values) if values else "未由静态扫描确认"


def current_audit_stats() -> dict:
    constraints = Counter(x["constraint_type"] for x in CURRENT["constraints"])
    missing_pk = [
        x["object_name"]
        for x in CURRENT_TABLES
        if not constraint_defs(x["object_name"], "primary_key")
    ]
    total_bytes = sum(int(x["total_bytes"]) for x in CURRENT_TABLES)
    return {
        "constraints": constraints,
        "missing_pk": missing_pk,
        "total_bytes": total_bytes,
        "rls_count": sum(bool(x["rls_enabled"]) for x in CURRENT_TABLES),
    }


def verify_inputs() -> dict:
    model_stats = validate_model()
    audit_stats = validate_storage_audit()
    if audit_stats["audited_physical_table_count"] != model_stats["table_count"]:
        raise AssertionError("minimum-grain audit does not cover every target table")
    actual_tables = {x["object_name"] for x in CURRENT_TABLES}
    actual_views = {x["object_name"] for x in CURRENT_VIEWS}
    mapped_tables = {x.current_object for x in TABLE_MAPPINGS}
    mapped_views = {x.current_object for x in VIEW_MAPPINGS}
    duplicate_table_mappings = sorted(
        name for name, count in Counter(x.current_object for x in TABLE_MAPPINGS).items() if count != 1
    )
    duplicate_view_mappings = sorted(
        name for name, count in Counter(x.current_object for x in VIEW_MAPPINGS).items() if count != 1
    )
    if duplicate_table_mappings or duplicate_view_mappings:
        raise AssertionError(
            f"duplicate mappings: tables={duplicate_table_mappings}, views={duplicate_view_mappings}"
        )
    if actual_tables != mapped_tables:
        raise AssertionError(f"table mapping mismatch: missing={actual_tables-mapped_tables}, extra={mapped_tables-actual_tables}")
    if actual_views != mapped_views:
        raise AssertionError(f"view mapping mismatch: missing={actual_views-mapped_views}, extra={mapped_views-actual_views}")
    targets = set(TABLE_BY_NAME) | set(VIEW_BY_NAME)
    invalid_targets = [
        (item.current_object, target)
        for item in MAPPINGS
        for target in item.target_objects
        if target not in targets
    ]
    if invalid_targets:
        raise AssertionError(f"invalid target mapping references: {invalid_targets}")
    if len(END_TO_END_CHAINS) != 15 or {x.number for x in END_TO_END_CHAINS} != set(range(1, 16)):
        raise AssertionError("exactly 15 numbered end-to-end chains are required")
    chain_objects = {node for item in END_TO_END_CHAINS for node in item.nodes}
    missing_chain_objects = sorted(chain_objects - targets)
    if missing_chain_objects:
        raise AssertionError(f"end-to-end chains reference unknown objects: {missing_chain_objects}")
    return {**model_stats, **{f"audit_{key}": value for key, value in audit_stats.items()}}


def write_csv(path: Path, fieldnames: list[str], rows: Iterable[dict]):
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def git_text(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=REPO, text=True, capture_output=True, check=True,
    )
    return result.stdout.strip()


def generate_review_baseline():
    """Freeze the evidence boundary used by this review package.

    This is intentionally a manifest, not a claim that the local checkout is
    the exact code deployed to every runtime.
    """
    status_lines = [line for line in git_text("status", "--short").splitlines() if line]
    migration_109 = REPO / "bakery-ops/src/modules/data/migrations/109_margin_and_holiday_factor.sql"
    migration_109_text = migration_109.read_text(encoding="utf-8") if migration_109.exists() else ""
    created_109_views = sorted(set(re.findall(r"CREATE\s+OR\s+REPLACE\s+VIEW\s+(?:public\.)?([a-zA-Z0-9_]+)", migration_109_text, re.I)))
    snapshot_objects = {item["object_name"] for item in CURRENT["objects"]}
    overlapping_109_views = sorted(set(created_109_views) & snapshot_objects)
    migration_109_status = next((line[:2].strip() or line[:2] for line in status_lines if line.endswith("109_margin_and_holiday_factor.sql")), "NOT_LISTED")
    release_date = re.search(r"(\d{4}-\d{2}-\d{2})$", MODEL_VERSION)
    if release_date is None:
        raise AssertionError(f"MODEL_VERSION lacks a release date: {MODEL_VERSION}")
    payload = {
        "baseline_version": 1,
        "model_version": MODEL_VERSION,
        # This is a release stamp, not a runtime fact.  Keeping it tied to the
        # declared model version makes the review package byte-idempotent.
        "generated_at": f"{release_date.group(1)}T00:00:00+00:00",
        "generated_at_semantics": "deterministic model release stamp; not wall-clock generation time",
        "database_snapshot": {
            "path": str(CURRENT_SNAPSHOT.relative_to(REPO)),
            "captured_at": CURRENT["identity"]["captured_at"],
            "database_name": CURRENT["identity"]["database_name"],
            "database_role": CURRENT["identity"]["database_role"],
            "server_version": CURRENT["identity"]["server_version"],
            "summary": CURRENT["summary"],
        },
        "code_access_snapshot": {
            "path": str(CODE_SNAPSHOT.relative_to(REPO)),
            "captured_at": CODE["captured_at"],
            "method": CODE["method"],
            "summary": CODE["summary"],
            "projects": CODE["projects"],
        },
        "repository": {
            "path": str(REPO),
            "head": git_text("rev-parse", "HEAD"),
            "branch": git_text("branch", "--show-current") or "DETACHED",
            "dirty": bool(status_lines),
            "status_entries": status_lines,
        },
        "migration_109_overlap": {
            "path": str(migration_109.relative_to(REPO)),
            "git_status": migration_109_status,
            "views_declared_in_file": created_109_views,
            "declared_views_also_present_in_live_snapshot": overlapping_109_views,
            "interpretation": "对象重合已确认；仅凭重合不能证明当前未跟踪文件就是生产对象的唯一部署来源。",
        },
        "claims_not_proven_by_this_baseline": [
            "本地四个项目目录与各生产部署正在运行完全相同的提交",
            "静态文本引用在生产必然执行，或没有引用就一定没有动态SQL",
            "名称相同的门店、产品、人员或原料就是同一业务对象",
            "方案C已经获准实施或已经适配所有运行时契约",
        ],
    }
    (EVIDENCE / "review-baseline.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    lines = md_header("00 评审证据基线", "冻结本轮方案 C 使用的数据库快照、代码扫描与 Git 边界；避免把不同时间点混成同一事实。")
    lines += [
        "## 已确认事实",
        "",
        f"- 数据库结构快照采集于 `{CURRENT['identity']['captured_at']}`，连接角色 `{CURRENT['identity']['database_role']}`，包含 {CURRENT['summary']['table_count']} 表、{CURRENT['summary']['view_count']} 视图和 {CURRENT['summary']['column_count']} 列。",
        f"- 代码访问快照采集于 `{CODE['captured_at']}`；扫描后只有运行源码/脚本层才进入项目读写矩阵，文档、测试、迁移和 JSON 数据不作为运行时调用证明。",
        f"- 本轮生成时仓库 HEAD 为 `{payload['repository']['head']}`，分支 `{payload['repository']['branch']}`，工作区{'不干净' if status_lines else '干净'}。",
        f"- 当前未跟踪的迁移 `109_margin_and_holiday_factor.sql` 声明视图 {', '.join('`'+x+'`' for x in created_109_views) or '无'}；其中数据库快照也存在 {', '.join('`'+x+'`' for x in overlapping_109_views) or '无'}。这是对象重合证据，不是部署来源证明。",
        "",
        "## 合理推测",
        "",
        "- 因数据库快照时间、代码扫描时间和当前脏工作区不是同一个不可变提交，本包适合结构评审和迁移清单，不足以单独证明某一生产接口的当前行为。",
        "- 静态读写线索可用于定位契约所有者，但上线前仍需生产日志、部署提交、连接角色和契约测试补证。",
        "",
        "## 暂时无法验证",
        "",
        "- BakeryOps、RES/POS、财务网站、HBTI 各生产部署实际运行提交及所有动态 SQL。",
        "- 外部 Excel、人工 SQL、定时脚本和未在本地目录中的客户端是否仍直接写库。",
        "- 当前未跟踪 109 文件与数据库内同名视图之间的确切部署链路。",
        "",
        "完整机器可读清单见 `evidence/review-baseline.json`。",
        "",
    ]
    (ROOT / "00-review-baseline.md").write_text("\n".join(lines), encoding="utf-8")


def generate_current_catalog_csv():
    rows = []
    for obj in CURRENT_TABLES + CURRENT_VIEWS:
        name = obj["object_name"]
        mapping = MAPPING_BY_OBJECT[name]
        comment = obj.get("object_comment")
        grain, evidence = current_grain(name, comment)
        rows.append({
            "object_type": obj["object_type"],
            "object_name": name,
            "row_count_exact": ROW_COUNTS.get(name, ""),
            "purpose_or_comment": comment or "生产库无对象注释",
            "grain": grain,
            "grain_evidence_status": evidence,
            "primary_key": " | ".join(constraint_defs(name, "primary_key")),
            "foreign_keys": " | ".join(constraint_defs(name, "foreign_key")),
            "unique_constraints": " | ".join(constraint_defs(name, "unique")),
            "check_constraints": " | ".join(constraint_defs(name, "check")),
            "static_runtime_readers": access_summary(name, "runtime_readers"),
            "static_runtime_writers": access_summary(name, "runtime_writers"),
            "disposition": mapping.disposition,
            "target_objects": " | ".join(mapping.target_objects),
            "risk": mapping.risk,
        })
    fields = list(rows[0])
    write_csv(ROOT / "current-object-catalog.csv", fields, rows)


def generate_current_field_csv():
    rows = []
    for obj in CURRENT_TABLES + CURRENT_VIEWS:
        name = obj["object_name"]
        constraints = CURRENT_CONSTRAINTS[name]
        for column in sorted(CURRENT_COLUMNS[name], key=lambda x: x["ordinal_position"]):
            relevant = [x for x in constraints if re.search(rf"\b{re.escape(column['column_name'])}\b", x["definition"])]
            meaning, evidence = current_field_meaning(column)
            rows.append({
                "object_type": obj["object_type"],
                "object_name": name,
                "ordinal_position": column["ordinal_position"],
                "column_name": column["column_name"],
                "data_type": column["data_type"],
                "nullable": column["is_nullable"],
                "default": fmt_default(column["column_default"]),
                "identity_kind": column["identity_kind"],
                "generated_kind": column["generated_kind"],
                "meaning": meaning,
                "meaning_evidence_status": evidence,
                "constraints": " | ".join(f"{x['constraint_type']}: {x['definition']}" for x in relevant),
                "misuse_warning": "现有列的业务定义若为待验证，不应直接复制到目标库；先以写入代码和样本数据核对。",
            })
    write_csv(ROOT / "current-field-dictionary.csv", list(rows[0]), rows)


def target_table_rows():
    incoming = defaultdict(list)
    for source in TABLES:
        for field in source.fields:
            if field.fk:
                incoming[field.fk.split(".", 1)[0]].append(f"{source.name}.{field.name}")
        for table_fk in source.foreign_keys:
            incoming[table_fk.ref_table].append(
                f"{source.name}({'+'.join(table_fk.columns)})"
            )
    rows = []
    for table in TABLES:
        audit = AUDIT_BY_TABLE[table.name]
        outgoing = [
            f"{field.name} → {field.fk}"
            + ("" if field.fk_activation == "WITH_TABLE" else f" [DEFERRED:{field.fk_activation}]")
            for field in table.fields if field.fk
        ]
        outgoing.extend(format_table_foreign_key(table_fk) for table_fk in table.foreign_keys)
        views = [view.name for view in VIEWS if table.name in view.lineage]
        rows.append({
            "domain": table.domain,
            "domain_name": DOMAIN_NAMES[table.domain],
            "table_name": table.name,
            "chinese_name": table.zh_name,
            "purpose": table.purpose,
            "row_grain": table.grain,
            "writer": table.writer,
            "readers": " | ".join(table.readers),
            "source": table.source,
            "foundation_tier": tier_for_table(table.name),
            "lifecycle": table.lifecycle,
            "lifecycle_meaning": LIFECYCLE_NAMES[table.lifecycle],
            "mutation_policy": table.mutation_policy,
            "mutation_policy_meaning": MUTATION_POLICY_NAMES[table.mutation_policy],
            "storage_class": audit.storage_class,
            "minimum_grain_verdict": audit.minimum_grain_verdict,
            "derivability": audit.derivability,
            "derived_fields_or_outputs": " | ".join(audit.derived_fields),
            "audit_action": audit.action,
            "original_r4_disposition": audit.original_r4_disposition,
            "claude_fable_5_result": audit.claude_fable_5_result,
            "why_stored_not_view": storage_reason(table),
            "retention": table.retention,
            "primary_key": next(x.name for x in table.fields if x.pk),
            "outgoing_foreign_keys": " | ".join(outgoing),
            "incoming_references": " | ".join(sorted(incoming[table.name])),
            "read_only_views": " | ".join(views),
            "unique_constraints": format_unique_constraints(table),
            "nulls_not_distinct_uniques": " | ".join(" + ".join(x) for x in table.nulls_not_distinct_uniques),
            "nulls_distinct_uniques": " | ".join(" + ".join(x) for x in table.nulls_distinct_uniques),
            "exclusion_constraints": " | ".join(table.exclusions),
            "table_checks": " | ".join(table.checks),
            "notes": table.notes,
        })
    return rows


def target_field_rows():
    rows = []
    for table in TABLES:
        audit = AUDIT_BY_TABLE[table.name]
        for position, field in enumerate(table.fields, 1):
            rows.append({
                "object_type": "TABLE",
                "domain": table.domain,
                "table_name": table.name,
                "table_chinese_name": table.zh_name,
                "table_purpose": table.purpose,
                "row_grain": table.grain,
                "field_position": position,
                "field_name": field.name,
                "field_chinese_name": field.zh_name,
                "data_type": field.data_type,
                "nullable": field.nullable,
                "default": fmt_default(field.default),
                "stored_data": field.description,
                "business_purpose": field.purpose,
                "source_system": table.source,
                "writer": table.writer,
                "foundation_tier": tier_for_table(table.name),
                "view_readiness_status": "NOT_APPLICABLE",
                "view_readiness_blockers": "NOT_APPLICABLE",
                "view_grain_key": "NOT_APPLICABLE",
                "key_and_constraints": field_constraint_summary(table, field),
                "foreign_key_activation": field_fk_activation(table, field),
                "table_unique_constraints": format_unique_constraints(table),
                "table_exclusion_constraints": " | ".join(table.exclusions),
                "table_checks": " | ".join(table.checks),
                "time_semantics": field_time_semantics(field),
                "history_version_semantics": history_semantics(table, field),
                "sensitivity": field.sensitive,
                "example": field.example,
                "misuse_warning": misuse_note(field, table.name),
                "lifecycle": table.lifecycle,
                "mutation_policy": table.mutation_policy,
                "minimum_grain_verdict": audit.minimum_grain_verdict,
                "storage_class": audit.storage_class,
                "derivability": audit.derivability,
                "why_stored_not_view": storage_reason(table),
            })
    for view in VIEWS:
        for position, field in enumerate(view.fields, 1):
            rows.append({
                "object_type": "VIEW",
                "domain": view.domain,
                "table_name": view.name,
                "table_chinese_name": view.zh_name,
                "table_purpose": view.purpose,
                "row_grain": view.grain,
                "field_position": position,
                "field_name": field.name,
                "field_chinese_name": field.zh_name,
                "data_type": field.data_type,
                "nullable": field.nullable,
                "default": "—",
                "stored_data": field.description,
                "business_purpose": field.purpose,
                "source_system": "派生自：" + "、".join(view.lineage),
                "writer": "无；只读治理视图",
                "foundation_tier": f"DERIVED_VIEW:{view_implementation_tier(view.name)}",
                "view_readiness_status": view.readiness_status,
                "view_readiness_blockers": format_view_blockers(view),
                "view_grain_key": format_view_grain_key(view),
                "key_and_constraints": "只读输出契约",
                "foreign_key_activation": "NOT_APPLICABLE",
                "table_unique_constraints": "—",
                "table_exclusion_constraints": "—",
                "table_checks": "—",
                "time_semantics": field_time_semantics(field),
                "history_version_semantics": "由上游事实和视图选版规则决定；视图自身不存历史。",
                "sensitivity": field.sensitive,
                "example": field.example,
                "misuse_warning": misuse_note(field, view.name),
                "lifecycle": "READ_MODEL",
                "mutation_policy": "READ_ONLY",
                "minimum_grain_verdict": "DERIVED_READ_MODEL",
                "storage_class": "VIEW_NOT_TABLE",
                "derivability": "YES",
                "why_stored_not_view": "不存储业务真相；按声明血缘和确定性选版规则派生。",
            })
    return rows


def generate_target_csvs():
    table_rows = target_table_rows()
    field_rows = target_field_rows()
    view_rows = [
        {
            "view_name": view.name,
            "chinese_name": view.zh_name,
            "domain": view.domain,
            "purpose": view.purpose,
            "row_grain": view.grain,
            "implementation_tier": view_implementation_tier(view.name),
            "readiness_status": view.readiness_status,
            "readiness_blockers": format_view_blockers(view),
            "grain_key": format_view_grain_key(view),
            "direct_lineage": " | ".join(view.lineage),
            "physical_base_tables": " | ".join(sorted(VIEW_BASE_TABLES[view.name])),
            "readers": " | ".join(view.readers),
            "field_count": len(view.fields),
            "notes": view.notes,
        }
        for view in VIEWS
    ]
    write_csv(ROOT / "target-table-catalog.csv", list(table_rows[0]), table_rows)
    write_csv(ROOT / "target-view-catalog.csv", list(view_rows[0]), view_rows)
    write_csv(ROOT / "target-field-dictionary.csv", list(field_rows[0]), field_rows)
    payload = {
        "model_version": MODEL_VERSION,
        "generated_from": [
            str(CURRENT_SNAPSHOT.relative_to(REPO)),
            str(CODE_SNAPSHOT.relative_to(REPO)),
        ],
        "tables": [dataclasses.asdict(x) for x in TABLES],
        "views": [dataclasses.asdict(x) for x in VIEWS],
        "view_implementation_tiers": {
            view.name: view_implementation_tier(view.name) for view in VIEWS
        },
        "view_readiness_boundary": {
            "phase1_design_candidates": len(PHASE1_VIEWS),
            "select_spec_ready": VIEW_READINESS_GOLDEN_COUNTS["PASS_SELECT_SPEC"],
            "created_and_validated_sql_views": CREATED_AND_VALIDATED_SQL_VIEW_COUNT,
            "pass_semantics": "SELECT specification sufficient only; not created and not runtime-validated",
        },
        "view_readiness_counts": dict(VIEW_READINESS_GOLDEN_COUNTS),
        "source_fidelity_contracts": {
            "cost_item_source_audit": COST_ITEM_SOURCE_AUDIT,
            "cost_item_source_ref_probe": COST_ITEM_SOURCE_REF_PROBE,
            "cost_recipe_output_audit": COST_RECIPE_OUTPUT_AUDIT,
            "hbti_result_only_anchor": HBTI_RESULT_ONLY_ANCHOR_CONTRACT,
            "reward_template_allowlist": REWARD_TEMPLATE_ALLOWLIST_PAYLOAD,
            "reward_template_allowlist_sha256": REWARD_TEMPLATE_ALLOWLIST_SHA256,
            "reward_source_audit": REWARD_SOURCE_AUDIT,
        },
        "view_base_tables": {
            view.name: sorted(VIEW_BASE_TABLES[view.name]) for view in VIEWS
        },
        "minimum_grain_audits": [dataclasses.asdict(x) for x in AUDITS],
        "end_to_end_chains": [dataclasses.asdict(x) for x in END_TO_END_CHAINS],
    }
    (ROOT / "target-model.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def generate_view_readiness_evidence():
    """Write the superseding, model-derived view-readiness evidence.

    This is deliberately not presented as a historical independent review.
    It records the current declarative contract and explicitly separates a
    SELECT-ready specification from database creation/runtime verification.
    """
    counts = Counter(view.readiness_status for view in VIEWS)
    lines = [
        "# P0b 视图准备度覆盖证据（取代旧的模糊‘首期可建’表述）",
        "",
        "> 生成于声明式目标模型；不是历史独立复审记录，也不是数据库实施证据。",
        "",
        f"- 模型版本：`{MODEL_VERSION}`",
        f"- {VIEW_READINESS_BOUNDARY}",
        "- `PASS_SELECT_SPEC` 仅允许 blockers 为空；其他状态必须给出稳定机器码。",
        "- 唯一未定义粒度键的是 `v_identity_mapping_gap`，它必须保持 BLOCK 并包含 `UNDEFINED_GRAIN_KEY`。",
        "",
        "## 固定计数",
        "",
    ]
    lines += [f"- `{status}`：{counts[status]}" for status in VIEW_READINESS_GOLDEN_COUNTS]
    lines += [
        "",
        "## 59/59 显式契约",
        "",
        "| 视图 | 实施层级 | 准备度 | 粒度键 | 稳定阻断码 |",
        "|---|---|---|---|---|",
    ]
    for view in VIEWS:
        lines.append(
            f"| `{view.name}` | `{view_implementation_tier(view.name)}` | `{view.readiness_status}` | "
            f"`{format_view_grain_key(view)}` | `{format_view_blockers(view)}` |"
        )
    lines += [
        "",
        "## 当前实施事实",
        "",
        "- 由本评审生成器创建的目标视图 SQL：0。",
        "- 已在新 Supabase/PostgreSQL 数据库创建并运行验证的目标视图：0。",
        "- 后续只有在独立 SQL 编译、数据库创建、样例与反例测试、权限测试完成后，才能把某个视图标记为已实施。",
        "",
    ]
    (EVIDENCE / "p0b-view-readiness-2026-08-10.md").write_text("\n".join(lines), encoding="utf-8")


def generate_p0c_source_fidelity_evidence(model_stats: dict):
    """Generate the current, superseding P0c evidence without claiming independence."""
    validate_source_fidelity_contracts()
    probe = COST_ITEM_SOURCE_REF_PROBE
    lines = [
        "# P0c 来源保真与奖励履约证据（当前、取代旧最终验收）",
        "",
        "> 本文件由声明式模型与协调方提供的只读源探针结果生成；它不是独立复审报告，也不是数据库迁移或应用切换证明。",
        "> `evidence/final-acceptance-2026-08-10.md` 仅保留为历史记录，已标记 SUPERSEDED。",
        "",
        "## 只读源探针",
        "",
        f"- 事务：`{probe['transaction_mode']}`；project ref=`{probe['source_project_ref']}`；database=`{probe['database']}`；PostgreSQL=`{probe['server_version_num']}`。",
        f"- 快照时刻：`{probe['transaction_timestamp_utc']}`（`{probe['transaction_timestamp_myt']}`）；`txid_current_if_assigned={probe['txid_current_if_assigned']}`。",
        f"- 查询：`{probe['query']}`。",
        f"- 原始分组：{probe['result_group_count']}；规范化：`{probe['canonicalization']}`；SHA-256=`{probe['canonical_json_sha256']}`。",
        "- 分类核对：total=471、mysql=451、manual=14、NULL=6、other=0。旧口述 `465/5/6` 明确错误并作废。",
        "",
        "## 成本项目与配方门禁",
        "",
        "- 471=99 product+372 material；99=32独立身份链合并+67来源键新产品；372=190 ingredient+171 semi_finished+11 packaging。",
        "- 单位实值：g372→G、ea94→EACH、个5→EACH；未知类型/单位 BLOCK；名称仅显示/alias证据，不作身份合并。",
        "- 配方输出：104 versions/99 product families + 185 versions/171 semi-finished families = 289 versions/270 families。",
        "",
        "## HBTI 历史锚点",
        "",
        f"- 1条full fact；{HBTI_RESULT_ONLY_ANCHOR_CONTRACT['result_only_count']}条result-only，attempt_no=NULL、SUBMITTED、SOURCE_ANSWERS_UNAVAILABLE、非来源观察。",
        f"- 迁移锚点：`{HBTI_RESULT_ONLY_ANCHOR_CONTRACT['prefix']}` + UUIDv5 root `{HBTI_RESULT_ONLY_ANCHOR_CONTRACT['uuid5_root']}` 的 typed-JCS 输入；公式/hash/非来源标志写迁移清单。",
        "- pos_member 的 visit_time/category 只进 result_dimensions；只有 fact.answers 中真实 Q5/Q6 才建 answer。",
        "",
        "## 奖励履约与库存",
        "",
        f"- 精确模板白名单10项（9 PHYSICAL_GIFT + 1 COUPON），fixture SHA-256=`{REWARD_TEMPLATE_ALLOWLIST_SHA256}`；未知模板 BLOCK，禁止名称模式推断。",
        "- 9库存 allocated=1376、reserved=0、redeemed=2、damaged=0；4个外部履约ID唯一且confirmedAt存在。",
        "- Heart 1条stock-backed claim；Pistachio 3条stockless外部履约；Butterfly库存issued=1但0 claim，库存核对必须输出DRIFT，禁止造claim。",
        "- REDEEMED只证明奖励发放/新券实例创建，不证明POS消费；库存核对只聚合reward_stock_id非空claim。",
        "",
        "## 当前模型与验收边界",
        "",
        f"- {model_stats['table_count']} tables / {model_stats['view_count']} view specs；physical fields={model_stats['table_field_count']}、view fields={model_stats['view_field_count']}、total={model_stats['total_field_count']}。",
        f"- FK={model_stats['foreign_key_count']}；CHECK={model_stats['check_count']}（table={model_stats['table_check_count']} + field={model_stats['field_check_count']}）；UNIQUE={model_stats['unique_count']}。",
        f"- Phase1 supporting FK indexes={model_stats['phase1_supporting_fk_index_count']}；readiness=10/9/22/13/5；已创建并验证SQL view=0。",
        "- 生成器会先执行 model/storage fail-closed validation；完整 unittest、package validator、连续两次生成和54文件聚合hash由最终验收命令另行核对。聚合hash不写入其自身覆盖的本文件，以避免不可能的自引用hash。",
        "",
    ]
    (EVIDENCE / "p0c-source-fidelity-and-reward-2026-08-10.md").write_text(
        "\n".join(lines), encoding="utf-8"
    )


def sql_comment_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def generate_comment_contract():
    """Generate the exact COMMENT contract for later migrations.

    This file is intentionally not a migration and is never executed by this
    generator.  It makes the review requirement machine-checkable: every
    physical table/view and every declared column has a non-empty explanation
    ready to be embedded in the future create/migration transaction.
    """
    lines = [
        "-- HOT CRUSH Core V1 R6 comment contract",
        "-- DESIGN-ONLY: do not execute standalone; objects must first be created by an approved migration.",
        f"-- model_version: {MODEL_VERSION}",
        "",
    ]
    for table in TABLES:
        table_comment = (
            f"{table.zh_name}。用途：{table.purpose}；一行代表：{table.grain}；"
            f"写入者：{table.writer}；来源：{table.source}；实施层级：{tier_for_table(table.name)}；"
            f"修改策略：{MUTATION_POLICY_NAMES[table.mutation_policy]}；保留：{table.retention}。"
            + (f"补充：{table.notes}" if table.notes else "")
        )
        lines.append(f'COMMENT ON TABLE "{table.name}" IS {sql_comment_literal(table_comment)};')
        for field in table.fields:
            column_comment = (
                f"{field.zh_name}。存放：{field.description}；作用：{field.purpose}；"
                f"类型：{field.data_type}；可空：{'是' if field.nullable else '否'}；"
                f"默认：{fmt_default(field.default)}；键与约束：{field_constraint_summary(table, field)}；"
                f"时间：{field_time_semantics(field)}；历史：{history_semantics(table, field)}；"
                f"敏感级别：{field.sensitive}；示例：{field.example}；误用提醒：{misuse_note(field, table.name)}"
            )
            lines.append(
                f'COMMENT ON COLUMN "{table.name}"."{field.name}" IS {sql_comment_literal(column_comment)};'
            )
        lines.append("")

    for view in VIEWS:
        view_comment = (
            f"{view.zh_name}。只读派生视图；用途：{view.purpose}；一行代表：{view.grain}；"
            f"实施层级：{view_implementation_tier(view.name)}；"
            f"粒度键：{format_view_grain_key(view)}；准备度：{view.readiness_status}；"
            f"阻断码：{format_view_blockers(view)}；"
            f"血缘：{' -> '.join(view.lineage)}；读取者：{'、'.join(view.readers)}；{view.notes}"
            "准备度只评价SELECT规格，不代表该SQL view已创建或运行验证；当前已创建并验证数为0。"
        )
        lines.append(f'COMMENT ON VIEW "{view.name}" IS {sql_comment_literal(view_comment)};')
        for field in view.fields:
            column_comment = (
                f"{field.zh_name}。输出：{field.description}；作用：{field.purpose}；"
                f"类型：{field.data_type}；可空：{'是' if field.nullable else '否'}；"
                f"所属视图实施层级：{view_implementation_tier(view.name)}；所属视图准备度：{view.readiness_status}；"
                f"时间：{field_time_semantics(field)}；敏感级别：{field.sensitive}；"
                f"示例：{field.example}；误用提醒：{misuse_note(field, view.name)}"
            )
            lines.append(
                f'COMMENT ON COLUMN "{view.name}"."{field.name}" IS {sql_comment_literal(column_comment)};'
            )
        lines.append("")
    (ROOT / "target-comments-contract.sql").write_text("\n".join(lines), encoding="utf-8")


def generate_implementation_guardrails():
    """Map current guards and declare target per-table implementation gates.

    These CSV/Markdown files are design contracts only.  They deliberately do
    not generate DDL because this project has one shared production database
    and implementation still requires approval and runtime verification.
    """
    mapping_by_current = {item.current_object: item for item in MAPPINGS}
    current_rows = []
    sources = (
        ("CONSTRAINT", CURRENT["constraints"], "constraint_name"),
        ("INDEX", CURRENT["indexes"], "index_name"),
        ("TRIGGER", CURRENT["triggers"], "trigger_name"),
        ("RLS_POLICY", CURRENT["policies"], "policy_name"),
    )
    for guard_type, items, name_key in sources:
        for item in items:
            current_object = item["table_name"]
            mapping = mapping_by_current[current_object]
            target_objects = " | ".join(mapping.target_objects)
            definition = item.get("definition") or json.dumps(
                {k: v for k, v in item.items() if k not in {"table_name", name_key}},
                ensure_ascii=False,
                sort_keys=True,
            )
            current_rows.append({
                "guardrail_type": guard_type,
                "current_object": current_object,
                "guardrail_name": item[name_key],
                "current_definition": definition,
                "current_enabled_or_valid": str(
                    item.get("is_valid", item.get("is_validated", item.get("enabled_state", "DECLARED")))
                ),
                "current_object_disposition": mapping.disposition,
                "target_objects": target_objects or "NONE",
                "required_action": (
                    "ARCHIVE_AND_PROVE_NO_RUNTIME_DEPENDENCY"
                    if not mapping.target_objects
                    else "REIMPLEMENT_OR_REPLACE_AFTER_SEMANTIC_EQUIVALENCE_REVIEW"
                ),
                "verification_gate": (
                    "EXPLAIN/INDEX_USAGE_AND_UNIQUENESS"
                    if guard_type == "INDEX"
                    else "WRITE_PATH_AND_FAILURE_CASE_TEST"
                    if guard_type == "TRIGGER"
                    else "ROLE_LOCATION_AND_DENY_CASE_TEST"
                    if guard_type == "RLS_POLICY"
                    else "VALIDATION_AND_FK_ACTION_TEST"
                ),
                "implementation_status": "DESIGN_MAPPED_NOT_EXECUTED",
            })
    write_csv(
        ROOT / "current-guardrail-to-target-matrix.csv",
        list(current_rows[0]),
        current_rows,
    )

    target_rows = []
    for table in TABLES:
        field_names = {field.name for field in table.fields}
        sensitive_levels = {field.sensitive for field in table.fields}
        fk_fields = sorted(" + ".join(columns) for columns in required_fk_index_columns(table))
        deferred_fk_fields = sorted(
            f"{field.name} -> {field.fk} @ {field.fk_activation}"
            for field in table.fields if field.fk and field.fk_activation != "WITH_TABLE"
        )
        deferred_fk_fields.extend(sorted(
            f"{'+'.join(table_fk.columns)} -> {table_fk.ref_table}({'+'.join(table_fk.ref_columns)}) "
            f"MATCH {table_fk.match_type} @ {table_fk.fk_activation}"
            for table_fk in table.foreign_keys if table_fk.fk_activation != "WITH_TABLE"
        ))
        location_scoped = any(
            name in field_names
            for name in (
                "location_id", "home_location_id", "issued_location_id",
                "deliver_to_location_id", "from_location_id", "to_location_id",
            )
        )
        restricted = bool(sensitive_levels & {"restricted", "secret"})
        if restricted and location_scoped:
            row_access = "RESTRICTED_COLUMN_PATH + LOCATION_SCOPE_SELECT + DOMAIN_WRITER_ONLY"
        elif restricted:
            row_access = "RESTRICTED_COLUMN_PATH + EXPLICIT_PRIVILEGED_READER + DOMAIN_WRITER_ONLY"
        elif location_scoped:
            row_access = "LOCATION_SCOPE_SELECT + DOMAIN_WRITER_ONLY"
        else:
            row_access = "DECLARED_READER_ROLES + DOMAIN_WRITER_ONLY"
        write_guard = MUTATION_POLICY_NAMES[table.mutation_policy]
        if table.mutation_policy == "APPEND_ONLY":
            write_guard += "；应用角色拒绝 UPDATE/DELETE，更正追加新事实或冲销事件"
        elif table.mutation_policy == "DRAFT_MUTABLE_THEN_FROZEN":
            write_guard += "；终态由数据库冻结门禁保护"
        special_parts = []
        if table.name in SPECIAL_CONSTRAINT_GUARDS:
            special_parts.append(SPECIAL_CONSTRAINT_GUARDS[table.name])
        if table.name in SCHEMA_VALIDATION_GUARDS:
            special_parts.append(SCHEMA_VALIDATION_GUARDS[table.name])
        if "updated_at" in field_names:
            touch = "UPDATED_AT_GUARD: only approved write function/trigger may change updated_at"
            special_parts.append(touch)
        special = " | ".join(special_parts) or "NONE"
        target_rows.append({
            "table_name": table.name,
            "foundation_tier": tier_for_table(table.name),
            "lifecycle": table.lifecycle,
            "writer": table.writer,
            "mutation_policy": table.mutation_policy,
            "primary_key": next(field.name for field in table.fields if field.pk),
            "unique_constraints": format_unique_constraints(table) or "NONE_BEYOND_PRIMARY_KEY",
            "required_fk_indexes": " | ".join(fk_fields) or "NONE",
            "deferred_fk_constraints": " | ".join(deferred_fk_fields) or "NONE",
            "row_access_contract": row_access,
            "write_and_freeze_contract": write_guard,
            "delete_contract": "RESTRICT_OR_NO_ACTION_ACROSS_BUSINESS_FACTS; archival/retention workflow only; CASCADE requires separate approval",
            "special_constraint_guards": special,
            "implementation_status": "DESIGN_ONLY_NOT_EXECUTED",
        })
    write_csv(
        ROOT / "target-table-implementation-guardrails.csv",
        list(target_rows[0]),
        target_rows,
    )

    current_counts = Counter(row["guardrail_type"] for row in current_rows)
    potential_fk_count = validate_model()["foreign_key_count"]
    lines = md_header(
        "09 实施约束、安全与现有门禁承接",
        "逐项登记现库索引、约束、触发器和RLS去向，并为每张目标表声明实施门禁；本文件不是执行授权。",
    )
    lines += [
        "## 结论",
        "",
        f"现库共登记 {len(current_rows)} 个门禁对象：约束 {current_counts['CONSTRAINT']}、索引 {current_counts['INDEX']}、触发器 {current_counts['TRIGGER']}、RLS策略 {current_counts['RLS_POLICY']}；全部在 `current-guardrail-to-target-matrix.csv` 恰好出现一次。",
        f"目标 {len(target_rows)} 张物理表全部在 `target-table-implementation-guardrails.csv` 声明主键/唯一键、每个FK的索引候选、行级访问边界、写入冻结、删除策略和特殊约束。",
        "",
        "**这只证明设计对象没有被静默遗漏，不证明已经实施或与生产运行等价。** 任何迁移必须逐项把 DESIGN_MAPPED_NOT_EXECUTED 转为实测证据；未获用户批准前不得执行这些DDL。",
        "",
        f"**视图实施边界：** {VIEW_READINESS_BOUNDARY}",
        f"准备度分布：" + "；".join(f"{status}={count}" for status, count in VIEW_READINESS_GOLDEN_COUNTS.items()) + "。",
        "",
        "| 视图 | 实施层级 | 准备度 | 粒度键 | 阻断码 |",
        "|---|---|---|---|---|",
        *[
            f"| `{view.name}` | `{view_implementation_tier(view.name)}` | `{view.readiness_status}` | "
            f"`{format_view_grain_key(view)}` | `{format_view_blockers(view)}` |"
            for view in VIEWS
        ],
        "",
        "## 实施前硬门禁",
        "",
        "1. 每个现有约束/索引/触发器/RLS策略必须得到 RETAIN、REPLACE 或 RETIRE 三选一批准，并附失败用例；仅同名不算语义等价。",
        "2. 所有业务FK默认 RESTRICT/NO ACTION；CASCADE 只能用于明确的同生命周期技术子记录，并需单独批准。",
        f"3. 所有当前生效FK（含复合FK）都进入索引候选；延期FK只在相应扩展包共同启用时建约束和索引。Phase1有 {sum(len(required_fk_index_columns(table)) for table in TABLES if table.name in CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES)} 个未被PK/UQ左前缀覆盖的支持索引候选；实际建索引前用真实查询与写入负载验证列顺序，禁止把 {potential_fk_count} 个潜在连接机械地建成同数量单列索引。",
        "4. 地点级表必须验证 location scope 的允许与拒绝样例；PII/秘密字段必须走受限列路径，普通分析不得读取密文或原始敏感证据。",
        "5. 发布/发送/终态版本、奖励扣减、消息领取和收货跨版本一致性必须由数据库事务或约束触发器保护，不能只靠前端约定。",
        "6. 当前只有生产库；先生成迁移文件、离线审查、回填核对、双轨、切换与回滚证据，禁止本评审生成器直接执行。",
        "",
        "## 特殊数据库门禁",
        "",
    ]
    for table_name, requirement in sorted(SPECIAL_CONSTRAINT_GUARDS.items()):
        lines.append(f"- `{table_name}`：{requirement}")
    for table_name, requirement in sorted(SCHEMA_VALIDATION_GUARDS.items()):
        lines.append(f"- `{table_name}`：{requirement}")
    lines += [
        "",
        "## 可复算的生成幂等性",
        "",
        "- `tools/hash-review-package.py` 只读计算声明式模型、生成器、冻结证据输入、生成文本契约和 Draw.io 源文件的逐文件及聚合 SHA-256；连续两次重跑生成器后聚合值必须一致。",
        "- PNG、PDF 和网页交互版由第三方导出器生成，可能包含墙钟元数据，因此不混入确定性哈希；它们另行接受页数、对象覆盖、分辨率和人工可读性验收。",
        "- Claude 审计结果和最终验收记录在设计冻结后追加，也不混入设计核心哈希。哈希相同只证明声明范围逐字节一致，不证明生产库新鲜度、迁移安全或业务语义正确。",
        "",
        "```bash",
        "python3 docs/database/hotcrush-core-v1/tools/hash-review-package.py",
        "```",
        "",
        "## 待运行时验证",
        "",
        "- 当前快照只证明对象在采集时存在；无法证明四个部署目标的动态SQL、连接角色和生产代码与本地静态扫描完全一致。",
        "- 索引是否保留必须结合 EXPLAIN、表大小、写入频率和唯一性语义；本稿只保证候选不遗漏。",
        "- RLS 必须用真实 Supabase 角色和 JWT claims 做允许/拒绝测试；静态 policy 文本不是授权正确性的充分证据。",
        "",
    ]
    (ROOT / "09-implementation-guardrails-and-security.md").write_text("\n".join(lines), encoding="utf-8")


def generate_storage_audit_artifacts():
    rows = []
    for position, audit in enumerate(AUDITS, 1):
        table = TABLE_BY_NAME[audit.table_name]
        rows.append({
            "audit_position": position,
            "model_version": MODEL_VERSION,
            "table_name": table.name,
            "chinese_name": table.zh_name,
            "domain": table.domain,
            "foundation_tier": tier_for_table(table.name),
            "lifecycle": table.lifecycle,
            "row_grain": table.grain,
            "storage_class": audit.storage_class,
            "minimum_grain_verdict": audit.minimum_grain_verdict,
            "derivability": audit.derivability,
            "physical_reason": audit.physical_reason,
            "derived_fields_or_outputs": " | ".join(audit.derived_fields),
            "action": audit.action,
            "r5_status": audit.original_r4_disposition,
            "claude_fable_5_result": audit.claude_fable_5_result,
            "writer": table.writer,
            "readers": " | ".join(table.readers),
            "mutation_policy": table.mutation_policy,
        })
    write_csv(ROOT / "target-storage-necessity-audit.csv", list(rows[0]), rows)

    disposition_rows = []
    for table in TABLES:
        audit = AUDIT_BY_TABLE[table.name]
        tier = tier_for_table(table.name)
        if table.name in CORE_BUSINESS_TABLES:
            disposition = "PHASE1_CORE_BUSINESS"
            phase1 = "YES"
            pack = ""
        elif table.name in CORE_PLATFORM_TABLES:
            disposition = "PHASE1_PLATFORM_SIDECAR"
            phase1 = "YES"
            pack = ""
        elif table.name in SOURCE_CONDITIONAL_TABLES:
            disposition = "DEFER_SOURCE"
            phase1 = "NO"
            pack = "SOURCE_CONDITIONAL"
        else:
            disposition = "EXTENSION_LATER"
            phase1 = "NO"
            pack_code = next(code for code, names in EXTENSION_PACKS.items() if table.name in names)
            pack = f"{pack_code}: {EXTENSION_PACK_NAMES[pack_code]}"
        disposition_rows.append({
            "r5_object": table.name,
            "r6_disposition": disposition,
            "r6_target": table.name,
            "phase1_physical": phase1,
            "full_catalog_physical_contract": "YES",
            "extension_or_condition": pack,
            "reason": audit.physical_reason,
            "claude_fable_5": CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS[table.name],
            "final_override": (
                "NONE"
                if CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS[table.name]
                == ("CORE_KEEP" if phase1 == "YES" else disposition)
                else f"FINAL_OVERRIDE:{'CORE_KEEP' if phase1 == 'YES' else disposition}"
            ),
        })
    for name, target in MERGED_R5_TABLES.items():
        final_judgment = f"CORE_MERGE_INTO:{target}"
        disposition_rows.append({
            "r5_object": name, "r6_disposition": "MERGE_INTO", "r6_target": target,
            "phase1_physical": "NO_SEPARATE_TABLE", "full_catalog_physical_contract": "NO",
            "extension_or_condition": "", "reason": f"与 {target} 属于同一身份、运行或版本事实；独立表会造成一对一同步漂移。",
            "claude_fable_5": CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS[name],
            "final_override": (
                "NONE" if CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS[name] == final_judgment
                else f"FINAL_OVERRIDE:{final_judgment}"
            ),
        })
    for name, target in DERIVED_R5_TABLES.items():
        disposition_rows.append({
            "r5_object": name, "r6_disposition": "DERIVE_VIEW", "r6_target": target,
            "phase1_physical": "NO", "full_catalog_physical_contract": "NO",
            "extension_or_condition": "", "reason": f"可由更基础、版本化输入确定性重算，改由 {target} 输出。",
            "claude_fable_5": CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS[name],
            "final_override": (
                "NONE" if CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS[name] == "DERIVE_VIEW"
                else f"FINAL_OVERRIDE:DERIVE_VIEW:{target}"
            ),
        })
    for name, reason in REMOVED_R5_TABLES.items():
        disposition_rows.append({
            "r5_object": name, "r6_disposition": "REMOVE", "r6_target": "app_job_run",
            "phase1_physical": "NO", "full_catalog_physical_contract": "NO",
            "extension_or_condition": "", "reason": f"{reason} app_job_run 仅记录必要刷新任务，不保存成本结果。",
            "claude_fable_5": CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS[name],
            "final_override": (
                "NONE" if CLAUDE_FABLE_5_ORIGINAL_DISPOSITIONS[name] == "REMOVE"
                else "FINAL_OVERRIDE:REMOVE"
            ),
        })
    if len(disposition_rows) != 154 or len({row["r5_object"] for row in disposition_rows}) != 154:
        raise AssertionError("R5-to-R6 disposition must cover exactly 154 unique objects")
    write_csv(ROOT / "r5-to-r6-disposition.csv", list(disposition_rows[0]), disposition_rows)

    counts = Counter(audit.storage_class for audit in AUDITS)
    lines = md_header(
        "08 R6 最小物理基座与派生性终审",
        "同时检查行粒度与整表是否必须物理存在；R5 的 154/154 通过结论在本版明确作废。",
    )
    lines += [
        "## 结论",
        "",
        "**R5 的错误不是某几个字段，而是验收标准错了：它只检查‘一行是否原子’，没有检查‘整张表能否由更基础事实推导’。因此 154/154 通过不代表最小物理基座。**",
        "",
        f"R6 对原 154 个对象逐一重新处置：首期只实施 **{len(CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES)} 张物理表**，其中 **{len(CORE_BUSINESS_TABLES)} 张业务事实/主数据**、**{len(CORE_PLATFORM_TABLES)} 张运行治理侧车**；另有 **{len(EXTENSION_TABLES)} 张按模块启用的扩展契约**、**{len(SOURCE_CONDITIONAL_TABLES)} 张来源获证后才实施的条件契约**。原方案中 **{len(MERGED_R5_TABLES)} 张并入同粒度表、{len(DERIVED_R5_TABLES)} 张改为只读派生视图、{len(REMOVED_R5_TABLES)} 张删除**。完整目录因此是 {len(TABLES)} 张潜在物理契约，不等于首期建表数。",
        "",
        f"只读派生层设计目录共有 **{len(VIEWS)} 个视图契约**：Phase1 设计候选 **{len(PHASE1_VIEWS)}**、扩展包候选 **{len(EXTENSION_VIEWS)}**、来源条件候选 **{len(SOURCE_CONDITIONAL_VIEWS)}**。{VIEW_READINESS_BOUNDARY} 成本组件、产品成本和节假日因子不再作为物理事实重复落库；未满足准备度与实施门禁的视图不得创建。",
        "",
        "### 视图实施层级与准备度不是同一件事",
        "",
        "- 实施层级回答依赖哪些表、属于 Phase1/扩展/来源条件中的哪一层；准备度回答是否已具备明确的 SELECT 规格。",
        "- `PASS_SELECT_SPEC` 只表示设计资料足以编写 SELECT；`FIX_MODEL_CONTRACT` 与 `BLOCK_MISSING_FACT_OR_RULE` 仍需修合同或补事实/规则；`DEFER_*` 不属于当前实施范围。",
        "- 当前未生成任何视图 SQL，也未在 PostgreSQL/Supabase 创建或运行验证任何目标视图。",
        "",
        "| 视图 | 实施层级 | 准备度 | 粒度键 | 阻断码 |",
        "|---|---|---|---|---|",
        *[
            f"| `{view.name}` | `{view_implementation_tier(view.name)}` | `{view.readiness_status}` | "
            f"`{format_view_grain_key(view)}` | `{format_view_blockers(view)}` |"
            for view in VIEWS
        ],
        "",
        "## 前提检查",
        "",
        "1. **最小行粒度与最小物理表集合是两个不同问题。** 一张表可以每行都原子，但整张表仍可能只是另一组事实的复制或汇总。",
        "2. **表少不是唯一目标。** 稳定身份、来源原值、人工决定、已发生副作用，以及曾真正驱动行动的版本化决策输出不能仅靠当前输入倒推。",
        "3. **完整目录不是实施清单。** 扩展包只是预先审核的契约；未启用模块没有真实写入者时不创建。",
        f"4. **运行治理表不等于业务事实表。** {len(CORE_PLATFORM_TABLES)} 张平台侧车负责权限、幂等、审计、安全和恢复，分析口径不得把它们当销售、人员或成本事实。",
        "",
        "## 判定规则",
        "",
        "- `CORE_MASTER_IDENTITY`：稳定身份、有效期映射、受控单位或已发布定义，不能从交易结果可靠反推。",
        "- `CORE_BASE_FACT`：来源原值或最小业务事件，是多种派生的共同输入。",
        "- `CORE_DECISION_OUTPUT`：值虽可计算，但该版本曾被批准或驱动行动；保存的是历史决定，不是当前汇总缓存。",
        "- `CORE_WORKFLOW_FACT`：人的决定、状态转换和业务副作用本身就是事实。",
        "- `CORE_PLATFORM_STATE`：权限、幂等、安全、任务恢复、审计或消息恢复所需的技术持久状态。",
        "- `EXTENSION_PACK`：对应模块真正启用时才建。",
        "- `SOURCE_CONDITIONAL`：来源身份、权限、粒度和重跑契约获证后才建。",
        "- `DERIVE_VIEW / MERGE_INTO / REMOVE`：不保留独立物理表。",
        "",
        "## 数量核对",
        "",
        f"- 原 R5 对象处置覆盖：154/154，名称唯一，无遗漏。",
        f"- R6 完整物理契约审计：{len(AUDITS)}/{len(TABLES)}，但首期只有 {len(CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES)} 张。",
        *[f"- `{name}`：{counts[name]} 张。" for name in CLASSIFICATIONS],
        "",
        f"## 不再独立建表的 {len(MERGED_R5_TABLES) + len(DERIVED_R5_TABLES) + len(REMOVED_R5_TABLES)} 个对象",
        "",
        "### 并入同粒度表",
        "",
        *[f"- `{name}` → `{target}`" for name, target in MERGED_R5_TABLES.items()],
        "",
        "### 改为派生视图",
        "",
        *[f"- `{name}` → `{target}`" for name, target in DERIVED_R5_TABLES.items()],
        "",
        "### 删除",
        "",
        *[f"- `{name}`：{reason}" for name, reason in REMOVED_R5_TABLES.items()],
        "",
        "## Claude Fable 5 独立复核及分歧",
        "",
        "- **已确认：** Claude 对原 154 个对象给出 104 CORE_KEEP、36 EXTENSION_LATER、3 DERIVE_VIEW、5 CORE_MERGE_INTO、2 REMOVE、4 DEFER_SOURCE；合计 154。它同样否定 R5 是最小物理基座。完整原始输出保存在 `evidence/claude-fable-5-r6-minimal-foundation.md`。",
        "- **我修正 Claude 的第一处：** 计划调整并入 `ops_production_plan_line`，不是仅并入计划版本头。原因是调整发生在具体产品/时段行，原因、AI建议和人工确认也必须与被调整行同粒度。",
        "- **我采纳 Claude 对质量工单的反例：** 删除 `app_data_quality_issue` 物理表。它的 `entity_type/entity_id` 是无法由数据库保证的多态连接，质量现状由各域核对视图和 `v_app_data_quality_summary` 派生；若以后确有人工受理流程，应由独立工单系统引用稳定规则与证据链接，不能反向成为事实来源。",
        f"- **我在逐字段复核后进一步收紧：** 最终不是照抄 Claude 的 104/36/3/5/2/4，而是 {len(CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES)} 首期、{len(EXTENSION_TABLES)} 扩展、{len(SOURCE_CONDITIONAL_TABLES)} 来源条件、{len(MERGED_R5_TABLES)} 合并、{len(DERIVED_R5_TABLES)} 派生、{len(REMOVED_R5_TABLES)} 删除。额外移除了生产计划、班表、配方、活动、推送去重和采购主单等空壳/副本，并把原料需求汇总改为视图。",
        "",
        "## 逐物理契约终审",
        "",
        "| # | 表 | 层级 | 一行代表 | 存储类别 | 结论 | 可派生性 | 派生字段/输出 | R6动作 | Claude |",
        "|---:|---|---|---|---|---|---|---|---|---|",
    ]
    for position, audit in enumerate(AUDITS, 1):
        table = TABLE_BY_NAME[audit.table_name]
        lines.append(
            f"| {position} | `{table.name}` {md_escape(table.zh_name)} | `{tier_for_table(table.name)}` | {md_escape(table.grain)} | "
            f"`{audit.storage_class}` | `{audit.minimum_grain_verdict}` | `{audit.derivability}` | "
            f"{md_escape('；'.join(audit.derived_fields) or '无额外派生字段')} | {md_escape(audit.action)} | `{audit.claude_fable_5_result}` |"
        )
    lines += [
        "",
        "## 未确定性与实施边界",
        "",
        "- `pos_payment`、`pos_refund` 的来源记录ID、状态变化、删除/更正和整批重跑能力尚未被当前证据证明。",
        "- `hr_timesheet_sync_batch`、`hr_timesheet_entry` 仍需证明 Lark 员工身份、修改/撤销和重跑契约。",
        f"- {len(EXTENSION_TABLES)} 张扩展契约通过的是结构预审，不代表已有写入者、权限、SOP或生产数据。",
        "- 本终审没有执行 DDL、DML、迁移、部署或项目读写改造。",
        "",
        "完整逐字段类型、空值、默认值、来源、约束、时间语义、敏感性、示例和误用提醒见 `03-table-and-field-dictionary.md` 与 `target-field-dictionary.csv`；原 154 个对象的机器可核对去向见 `r5-to-r6-disposition.csv`。",
        "",
    ]
    rendered = "\n".join(lines)
    (ROOT / "08-r6-minimal-physical-foundation.md").write_text(rendered, encoding="utf-8")


def generate_mapping_csv():
    rows = [
        {
            "current_object": x.current_object,
            "object_type": x.object_type,
            "disposition": x.disposition,
            "target_objects": " | ".join(x.target_objects),
            "migration_rule": x.migration_rule,
            "compatibility_rule": x.compatibility_rule,
            "risk": x.risk,
        }
        for x in MAPPINGS
    ]
    write_csv(ROOT / "current-to-target-matrix.csv", list(rows[0]), rows)


def generate_current_field_mapping_csv():
    """Give every current production column an explicit, non-silent disposition."""
    target_fields = {
        name: {field.name for field in obj.fields}
        for name, obj in {**TABLE_BY_NAME, **VIEW_BY_NAME}.items()
    }
    rows = []
    critical_objects = {"pos_member", "pos_member_daily", "pos_member_card_txn"}
    for obj in CURRENT_TABLES + CURRENT_VIEWS:
        object_name = obj["object_name"]
        mapping = MAPPING_BY_OBJECT[object_name]
        for column in sorted(CURRENT_COLUMNS[object_name], key=lambda item: item["ordinal_position"]):
            column_name = column["column_name"]
            key = (object_name, column_name)
            exact_targets = [
                f"{target}.{column_name}"
                for target in mapping.target_objects
                if column_name in target_fields.get(target, set())
            ]
            if key in MANUAL_FIELD_DISPOSITIONS:
                action, destination = MANUAL_FIELD_DISPOSITIONS[key]
                basis = "MANUAL_EXPLICIT_FIELD"
                if destination.startswith("NO_TARGET:"):
                    field_rule = (
                        f"{mapping.migration_rule} 本字段明确不进入目标数据字段；"
                        "只能按本行处置说明失效、归档或重发，禁止改写成看似有效的新记录。"
                    )
                elif destination.startswith("DERIVE:") or action == "DERIVE_NOT_STORE":
                    field_rule = (
                        "本字段不复制为目标物理事实；只允许从本行列出的最小事实和批准口径确定性派生，"
                        "并用旧新样本契约测试核对。"
                    )
                else:
                    field_rule = (
                        "按本行列出的字段逐值迁移或解析；稳定ID只在来源命名空间和证据唯一时解析，"
                        "来源 NULL 保持 NULL，金额不补0，受限内容不进入普通分析。"
                    )
                field_rule = MANUAL_FIELD_RULES.get(key, field_rule)
            elif object_name in critical_objects and len(exact_targets) == 1:
                action = "PRESERVE_SOURCE_FACT"
                destination = exact_targets[0]
                basis = "EXPLICIT_SAME_NAME_HIGH_RISK"
                field_rule = "字段名、目标粒度和类型逐项核对后原值迁移；NULL、符号、币种和时间语义不得改变。"
            elif obj["object_type"] == "view":
                action = "DERIVE_READ_MODEL_NOT_MIGRATE"
                destination = " | ".join(mapping.target_objects) or "NO_TARGET:retired current view"
                basis = "CURRENT_VIEW_REBUILD_RULE"
                field_rule = "当前视图列不作为物理事实搬运；由目标只读视图按对象迁移规则重建并做旧新结果契约测试。"
            elif not mapping.target_objects:
                action = "DO_NOT_MIGRATE_WITH_OBJECT"
                destination = f"NO_TARGET:{mapping.disposition}"
                basis = "OBJECT_RETIRE_OR_REISSUE_RULE"
                field_rule = mapping.migration_rule
            elif len(exact_targets) == 1:
                action = "PRESERVE_IF_SEMANTICS_MATCH"
                destination = exact_targets[0]
                basis = "UNIQUE_SAME_NAME_CANDIDATE"
                field_rule = "必须通过类型、空值、单位、时间和样本对账；同名本身不是迁移证据。失败则按对象迁移规则转换。"
            elif len(exact_targets) > 1:
                action = "SPLIT_OR_RESOLVE_BY_OBJECT_RULE"
                destination = " | ".join(exact_targets)
                basis = "MULTIPLE_SAME_NAME_TARGETS"
                field_rule = mapping.migration_rule
            else:
                action = "TRANSFORM_BY_OBJECT_RULE"
                destination = "OBJECT_TARGETS:" + " | ".join(mapping.target_objects)
                basis = "OBJECT_TRANSFORMATION_RULE"
                field_rule = mapping.migration_rule
            meaning, meaning_evidence = current_field_meaning(column)
            rows.append({
                "current_object_type": obj["object_type"],
                "current_object": object_name,
                "ordinal_position": column["ordinal_position"],
                "current_field": column_name,
                "current_data_type": column["data_type"],
                "current_nullable": column["is_nullable"],
                "current_meaning": meaning,
                "meaning_evidence_status": meaning_evidence,
                "field_disposition": action,
                "target_field_or_disposition": destination,
                "mapping_basis": basis,
                "field_migration_rule": field_rule,
                "object_migration_rule": mapping.migration_rule,
                "compatibility_rule": mapping.compatibility_rule,
                "risk": mapping.risk,
                "implementation_status": "DESIGN_EXPLICIT_NOT_EXECUTED",
            })
    write_csv(ROOT / "current-field-to-target-matrix.csv", list(rows[0]), rows)


def project_reference_groups():
    groups = defaultdict(lambda: {"read": set(), "write": set(), "ambiguous": set(), "files": Counter()})
    current_names = {x.current_object for x in MAPPINGS}
    for ref in CODE["references"]:
        if ref["object_name"] not in current_names or ref["layer"] != "runtime_or_script":
            continue
        key = (ref["project"], ref["object_name"])
        kind = ref["access_kind"]
        if kind in groups[key]:
            groups[key][kind].add(ref["line"])
        groups[key]["files"][ref["file"]] += 1
    return groups


def generate_project_matrix_csv():
    groups = project_reference_groups()
    project_by_code = {x["code"]: x for x in PROJECTS}
    rows = []
    for (project_code, object_name), evidence in sorted(groups.items()):
        mapping = MAPPING_BY_OBJECT[object_name]
        kinds = []
        for kind in ("read", "write", "ambiguous"):
            if evidence[kind]:
                kinds.append(kind.upper())
        top_files = [f"{name} ({count})" for name, count in evidence["files"].most_common(8)]
        rows.append({
            "project": project_by_code[project_code]["name"],
            "project_code": project_code,
            "current_object": object_name,
            "static_access_evidence": " + ".join(kinds) or "REFERENCE",
            "runtime_or_script_reference_count": sum(evidence["files"].values()),
            "top_files": " | ".join(top_files),
            "target_contract": " | ".join(mapping.target_objects) or "无运行时目标；归档/退役",
            "compatibility_rule": mapping.compatibility_rule,
            "migration_risk": mapping.risk,
            "project_target_write_boundary": project_by_code[project_code]["target_write_domains"],
            "project_boundary": project_by_code[project_code]["boundary"],
            "evidence_limit": "静态文本扫描线索，不等于运行时调用证明；切换前需契约测试和生产日志核对。",
        })
    write_csv(ROOT / "project-compatibility-matrix.csv", list(rows[0]), rows)


def md_header(title: str, subtitle: str = "") -> list[str]:
    lines = [f"# {title}", ""]
    if subtitle:
        lines += [subtitle, ""]
    lines += [
        "> 状态：**方案 C 评审稿，不是迁移脚本，不授权修改生产数据库。**",
        f"> 模型版本：`{MODEL_VERSION}`；生产结构快照：`{CURRENT['identity']['captured_at']}`；代码静态扫描：`{CODE['captured_at']}`。",
        "",
    ]
    return lines


def generate_current_audit_md():
    stats = current_audit_stats()
    lines = md_header("01 当前数据库审计", "把已确认事实、合理推测和待验证信息分开；没有证据的地方不猜。")
    lines += [
        "## 结论先行",
        "",
        "当前库能支撑既有单店流程，但**不适合作为多门店、中央厨房、仓库和跨模块分析的直接地基继续扩建**。主要问题不是表少，而是地点、产品、人员、原料和版本身份没有贯穿所有事实；多个项目还会写同一张表。方案 C 因此选择新库建模、按项目逐条迁移契约，而不是在唯一生产库中边拆边修。",
        "",
        "“完美适配所有项目”目前无法确认为事实：静态扫描能证明代码文本中存在访问线索，但动态 SQL、生产部署版本、定时任务和外部客户端仍需在迁移阶段用日志与契约测试确认。",
        "",
        "## 已确认事实",
        "",
        f"- 生产 `public` schema 有 **{CURRENT['summary']['table_count']} 张表、{CURRENT['summary']['view_count']} 个普通视图、{CURRENT['summary']['materialized_view_count']} 个物化视图、{CURRENT['summary']['column_count']} 个列定义**。",
        f"- 结构约束共 {CURRENT['summary']['constraint_count']} 个：主键 {stats['constraints']['primary_key']}、外键 {stats['constraints']['foreign_key']}、唯一约束 {stats['constraints']['unique']}、检查约束 {stats['constraints']['check']}。",
        f"- {stats['rls_count']}/{len(CURRENT_TABLES)} 张表启用了 RLS；快照连接身份为 `{CURRENT['identity']['database_role']}`。启用 RLS 本身不等于每个应用已经被最小权限隔离。",
        f"- 当前表总占用约 {stats['total_bytes'] / 1024 / 1024:.1f} MiB；精确行数已逐表记录在目录。",
        f"- 没有主键的 {len(stats['missing_pk'])} 张表：{', '.join('`'+x+'`' for x in stats['missing_pk'])}。",
        f"- {len(CURRENT_TABLES)} 张表和 {len(CURRENT_VIEWS)} 个视图均在兼容矩阵中恰好出现一次；没有遗漏，也没有重复去向。",
        "",
        "## 已确认的关键结构风险",
        "",
        "1. `daily_revenue` 同时有 `UNIQUE(date)` 和 `UNIQUE(date, store)`；前者会阻止同一天第二家门店写入，后者因此无法真正提供多店能力。",
        "2. `item_hourly_sales` 仍以 `date + hour + item_name` 唯一，现有 `store` 不是可靠地点键；名称变化、同名商品和第二门店都会冲突或混淆。",
        "3. `forecast_snapshot` 以日期与产品名称组织，没有稳定 `location_id + product_id + run/version`，无法可靠区分算法预测、人工预估和最终批准计划。",
        "4. `ops_store` 与 `finance_store` 没有统一外键映射；门店名称只能当证据，不能当企业级连接键。",
        "5. `product`、`pos_product` 与成本卡产品对象并非同一身份；已有名称/来源键路径不能自动证明同一产品。",
        "6. `staff` 与 `employees` 分别表达人员数据；班表 `fact_shift` 使用姓名文本且当前无可靠实际工时关系，无法保证人员对账。",
        "7. `pos_member` 同时承载 POS 会员快照与 HBTI 活动状态，形成跨项目双写和活动历史丢失风险。",
        "8. `schema_migrations` 没有强制仓库命名空间；多个代码库共享一张迁移账本时，版本号或文件归属可能碰撞。",
        "9. `pos_member_order_item` 已形成有价值的订单 × 商品粒度，但没有 `source_system_id`、`location_id`、抓取批次、外键和批次完整性清单；当前 `(order_id, item_key)` upsert 只能维护最新汇总，无法保存来源修订历史，也不能在来源删除一行时自动移除旧行。该表已启用 RLS 但当前没有表级 policy，且其注释明确说未挂统一迁移链；这两点都不能被‘脚本跑通’替代。",
        f"10. 该表当前有 {MEMBER_ORDER_AUDIT['aggregate']['row_count']:,} 行、{MEMBER_ORDER_AUDIT['aggregate']['distinct_order_count']:,} 个订单；其中 {MEMBER_ORDER_AUDIT['aggregate']['negative_net_sales_row_count']:,} 行净额为负、{MEMBER_ORDER_AUDIT['aggregate']['zero_net_sales_row_count']:,} 行净额为零。基础事实应保留这些行，但任何‘消费金额/喝了多少’派生指标必须明确纳入规则。",
        "",
        "## 合理推测（尚未视为生产运行事实）",
        "",
        f"- 静态扫描在四个项目中发现 {CODE['summary']['reference_count']} 条文本引用，其中 {CODE['summary']['runtime_reference_count']} 条位于运行源码或脚本层；测试、迁移、文档、JSON/YAML 数据已分层排除出运行时契约证据。这些仍只是定位线索，不证明当前部署一定执行。",
        "- 表注释、文件名和 SQL 动词可以帮助判断写入者，但动态拼接、旧脚本和未部署代码可能产生假阳性或假阴性。",
        "- 某些无字段注释的现有列可从名称推测含义；此类解释在 `current-field-dictionary.csv` 中明确标为“合理推测”或“待验证”，不会当作迁移真值。",
        "",
        "## 迁移前仍待验证",
        "",
        "- 四个部署目标当前实际版本、连接角色、定时任务和所有动态 SQL。",
        "- 每个金额字段的含税/未税、折扣、退款、币种和舍入口径；每个数量字段的单位和换算方式。",
        "- `staff` 与 `employees` 的逐人对账；`ops_store` 与 `finance_store` 的逐地点证据映射。",
        "- 已确认 reportId=211 在当前单店样本提供可重跑的订单 ID 和订单商品粒度，因此 `pos_order`、`pos_order_item` 已进入迁移核心；仍需验证其他门店的来源命名空间、整批完整性与更正语义。独立支付和退款来源尚未验证，`pos_payment`、`pos_refund` 继续保持 `SOURCE_CONDITIONAL`。",
        "- Lark 工时是否能稳定提供员工来源 ID、修改/撤销语义和重跑幂等键；未确认前 `hr_timesheet_sync_batch` 与 `hr_timesheet_entry` 保持 `SOURCE_CONDITIONAL`。",
        "- 数据保留期限、马来西亚个人资料合规要求、手机号加密密钥和受限访问审批流程。",
        "- 切换窗口内是否仍有 Excel、手工 SQL 或外部客户端直接写当前表。",
        "",
        f"## 当前对象目录（{len(CURRENT_TABLES)} 表 + {len(CURRENT_VIEWS)} 视图）",
        "",
        "字段说明：读写者来自静态扫描，必须在迁移前做运行时验证；粒度证据来自数据库注释或结构约束。",
        "",
        "| 类型 | 当前对象 | 精确行数 | 一行/一份数据代表什么 | 粒度证据 | PK | FK数 | 唯一约束 | 静态写者 | 静态读者 | 方案C去向 | 风险 |",
        "|---|---|---:|---|---|---|---:|---|---|---|---|---|",
    ]
    for obj in CURRENT_TABLES + CURRENT_VIEWS:
        name = obj["object_name"]
        grain, evidence = current_grain(name, obj.get("object_comment"))
        mapping = MAPPING_BY_OBJECT[name]
        lines.append(
            "| {typ} | `{name}` | {rows} | {grain} | {evidence} | {pk} | {fk} | {uniq} | {writers} | {readers} | {disp} → {targets} | {risk} |".format(
                typ="表" if obj["object_type"] == "table" else "视图",
                name=name,
                rows=ROW_COUNTS.get(name, "—"),
                grain=md_escape(grain),
                evidence=md_escape(evidence),
                pk=md_escape("; ".join(constraint_defs(name, "primary_key")) or "—"),
                fk=len(constraint_defs(name, "foreign_key")),
                uniq=md_escape("; ".join(constraint_defs(name, "unique")) or "—"),
                writers=md_escape(access_summary(name, "runtime_writers")),
                readers=md_escape(access_summary(name, "runtime_readers")),
                disp=mapping.disposition,
                targets=md_escape(", ".join(mapping.target_objects) or "归档/退役"),
                risk=mapping.risk,
            )
        )
    lines += [
        "",
        "## 配套证据文件",
        "",
        "- `current-object-catalog.csv`：每个对象的用途、粒度、约束、读写线索和去向。",
        f"- `current-field-dictionary.csv`：生产快照中全部 {CURRENT['summary']['column_count']} 个列定义；无注释列明确标记为推测或待验证。",
        "- `00-review-baseline.md` / `evidence/review-baseline.json`：数据库快照、代码扫描、Git HEAD 与脏工作区的时间边界。",
        "- `evidence/current-schema-snapshot.json`：只读元数据与精确行数证据。",
        "- `evidence/pos-member-order-item-audit.json`：会员订单商品表的无 PII 聚合核验、归属覆盖、异常净额与证据边界。",
        "- `evidence/code-access-snapshot.json`：静态代码访问线索，不能替代运行时证明。",
        "",
    ]
    (ROOT / "01-current-database-audit.md").write_text("\n".join(lines), encoding="utf-8")


def generate_blueprint_md(model_stats: dict):
    lines = md_header("02 R6 完整目标数据库蓝图", "先确定最小物理基座，再用视图派生；完整目录与首期实施清单严格分开。")
    lines += [
        "## 方案 C 的准确含义",
        "",
        f"方案 C 是**新建一套 HOT CRUSH Core V1 PostgreSQL/Supabase 数据库，在旧库旁边完成回填、影子核对和按项目切换**。它不是在唯一生产库里直接重命名 {len(CURRENT_TABLES)} 张表。现阶段只产出评审资产，不产生迁移 SQL，也不修改任何上层代码。",
        "",
        f"**首期物理基座只有 {model_stats['phase1_core_table_count']} 张表：{model_stats['core_business_table_count']} 张业务事实/主数据 + {model_stats['core_platform_table_count']} 张运行治理侧车。** 完整设计目录共有 {model_stats['table_count']} 张潜在物理契约和 {model_stats['view_count']} 个只读治理视图，其中另含 {model_stats['extension_table_count']} 张按需扩展、{model_stats['source_conditional_table_count']} 张来源待验证。视图同样分期：首期 {model_stats['phase1_view_count']}、扩展 {model_stats['extension_view_count']}、来源条件 {model_stats['source_conditional_view_count']}。表字段 {model_stats['table_field_count']} 个、视图字段 {model_stats['view_field_count']} 个、外键 {model_stats['foreign_key_count']} 个。",
        "",
        f"**视图准备度边界：** {VIEW_READINESS_BOUNDARY}",
        "",
        f"原 R5 的 154/154 通过结论已作废：最小行粒度不等于最小物理表集合。R6 对原 154 个对象逐项处置为 {model_stats['phase1_core_table_count']} 张首期、{model_stats['extension_table_count']} 张扩展、{model_stats['source_conditional_table_count']} 张来源条件、{model_stats['merged_r5_table_count']} 张合并、{model_stats['derived_r5_table_count']} 张派生和 {model_stats['removed_r5_table_count']} 张删除；完整去向见 `r5-to-r6-disposition.csv`。",
        "",
        "## 最小颗粒 → 多种派生的全库规则",
        "",
        "- **最小不是无限原子化。** 最小颗粒是仍能完整表达一个来源事件、业务决定或状态变化的最低粒度；继续拆分会丢掉同一性或导致无法重建，就必须停在该粒度。",
        "- **基础事实只存一次。** 订单商品、会员卡交易、人工计划决定和财务导入各自保真；会员画像、排行、占比、成本组件/快照、节假日倍率、毛利、人效和预测准确率通过 `v_*` 视图派生。生产、配送、库存与工时只有对应扩展模块启用或来源获证后才建表。",
        "- **没有万能连接字段。** `location_id`、`product_id`、`employment_id`、`material_id`、`member_id`、`order_id` 分别表达不同对象；跨模块沿真实业务关系逐跳连接，来源编号先经 `source_system_id` 和映射表进入企业身份。",
        "- **派生必须可追溯。** 每个结果都能回到来源批次、运行/版本、有效期和质量状态；若无法重建当时决定，才把计算输出冻结为带版本快照表。",
        "",
        "## 实施层级、证据成熟度与写入策略",
        "",
        f"- `CORE_BUSINESS`：首期业务事实、稳定身份、人工决定或发布版本，共 {model_stats['core_business_table_count']} 张。",
        f"- `CORE_PLATFORM`：首期权限、幂等、审计、安全与恢复侧车，共 {model_stats['core_platform_table_count']} 张；不得混入经营指标。",
        f"- `EXTENSION_PACK:*`：模块有真实写入者和业务副作用后才实施，共 {model_stats['extension_table_count']} 张。",
        f"- `SOURCE_CONDITIONAL`：外部来源身份、粒度、权限和重跑契约获证后才实施，共 {model_stats['source_conditional_table_count']} 张。",
        "",
    ]
    lines += [f"- `{key}`：{value}" for key, value in LIFECYCLE_NAMES.items()]
    lines += [""]
    lines += [f"- `{key}`：{value}" for key, value in MUTATION_POLICY_NAMES.items()]
    lines += [
        "",
        "## 视图实施层级与准备度",
        "",
        "| 视图 | 实施层级 | 准备度 | 粒度键 | 阻断码 |",
        "|---|---|---|---|---|",
    ]
    for view in VIEWS:
        lines.append(
            f"| `{view.name}` | `{view_implementation_tier(view.name)}` | `{view.readiness_status}` | "
            f"`{format_view_grain_key(view)}` | `{format_view_blockers(view)}` |"
        )
    lines += [
        "",
        "## 第一性原则门禁",
        "",
    ]
    lines += [f"{i}. {item}" for i, item in enumerate(DESIGN_GATES, 1)]
    lines += ["", "## 统一连接脊柱", "", "| 连接键 | 权威来源 | 作用 |", "|---|---|---|"]
    for key, source, meaning in IDENTITY_SPINE:
        lines.append(f"| `{key}` | `{source}` | {meaning} |")
    lines += ["", "## 业务域与写入边界", "", "| 前缀 | 板块 | 表数 | 视图数 | 主要写入责任 |", "|---|---|---:|---:|---|"]
    for domain in DOMAIN_ORDER:
        domain_tables = [x for x in TABLES if x.domain == domain]
        domain_views = [x for x in VIEWS if x.domain == domain]
        writers = "；".join(dict.fromkeys(x.writer for x in domain_tables))
        lines.append(f"| `{domain}_` | {DOMAIN_NAMES[domain]} | {len(domain_tables)} | {len(domain_views)} | {md_escape(writers)} |")
    lines += ["", "## 四个项目的责任边界", ""]
    for project in PROJECTS:
        lines += [
            f"### {project['name']}",
            "",
            f"- 目标写入：{project['target_write_domains']}",
            f"- 目标读取：{project['target_read_domains']}",
            f"- 边界：{project['boundary']}",
            "",
        ]
    lines += ["## 15 条端到端关系", ""]
    for chain in END_TO_END_CHAINS:
        lines += [
            f"### {chain.number:02d} {chain.name}",
            "",
            f"**要回答的问题：** {chain.question}",
            "",
            "**链路：** " + " → ".join(f"`{x}`" for x in chain.nodes),
            "",
            "**连接规则：**",
            "",
        ]
        lines += [f"- {join}" for join in chain.joins]
        lines += ["", f"**门禁：** {chain.control}", ""]
    lines += [
        "## 为什么这比旧图更适合扩展",
        "",
        "- 新门店、厨房或仓库只新增 `ops_location` 和来源映射，不复制一套业务表。",
        "- 新 POS、Lark、供应商或节假日 API 先注册 `app_source_system`，再加来源身份映射，不污染稳定业务 ID。",
        "- 新功能优先复用稳定身份、批次、版本和只读治理视图；只有出现新的业务事实粒度时才新增表。",
        "- 分析可以从任何事实回到来源批次、版本和有效期，结论不依赖“最后谁覆盖了那一行”。",
        "- 普通唯一约束的空值语义和有效期是否可重叠已进入机器校验；迁移实现应分别使用 PostgreSQL `UNIQUE NULLS NOT DISTINCT` 与 `EXCLUDE USING gist`（必要时启用 `btree_gist`）。",
        "",
        "## 当前仍不能批准实施的项目",
        "",
        "- 逐人、逐门店、逐产品和逐原料的身份映射样本尚未完成业务确认。",
        "- 所有金额/数量字段与四个项目的请求响应契约尚未做运行时测试。",
        "- 生产权限角色、密钥、保留期和切换时段尚未批准。",
        "- 因此本蓝图可以进入业务评审，但还不能作为执行授权。",
        "",
    ]
    (ROOT / "02-target-database-blueprint.md").write_text("\n".join(lines), encoding="utf-8")


def generate_dictionary_md():
    incoming = defaultdict(list)
    for source in TABLES:
        for field in source.fields:
            if field.fk:
                incoming[field.fk.split(".", 1)[0]].append(f"{source.name}.{field.name}")
        for table_fk in source.foreign_keys:
            incoming[table_fk.ref_table].append(
                f"{source.name}({'+'.join(table_fk.columns)})"
            )
    lines = md_header("03 逐表说明与逐字段字典", "每张目标表、每个目标字段和每个只读视图的完整评审契约。")
    lines += [
        "## 阅读方法",
        "",
        "- `CORE_BUSINESS`：首期业务事实/主数据；必须能说明删掉会丢失哪种不可重建事实。",
        "- `CORE_PLATFORM`：首期运行治理侧车；因权限、幂等、审计、安全或恢复而存，不是经营事实。",
        "- `EXTENSION_PACK:*`：结构已设计，但模块批准和真实写入者出现前不创建空壳。",
        "- `SOURCE_CONDITIONAL`：外部来源身份、粒度、修改语义和重跑幂等被验证后才实施；当前包括 POS 支付、POS 退款和两张 Lark 工时表。",
        "- 写入策略单独说明表是否只追加、何时可更新、何时冻结；它与证据成熟度不是一回事。",
        "- 含可空字段的唯一约束必须显式声明 `NULLS NOT DISTINCT` 或有意保留 `NULLS DISTINCT`；不能依赖读者猜 PostgreSQL 默认行为。",
        "- 生效期统一采用左闭右开 `[from, to)`；映射、规则、课程、配方、换算和采用价的正式区间由排斥约束阻止重叠。",
        "- `NULL` 不是 0；允许为空的字段必须按字段语义解释。",
        "- 下列来源和写入者是目标责任设计，不是对当前生产运行状态的断言。",
        f"- {VIEW_READINESS_BOUNDARY}",
        "",
    ]
    for domain in DOMAIN_ORDER:
        lines += [f"# {domain.upper()} — {DOMAIN_NAMES[domain]}", ""]
        for table in [x for x in TABLES if x.domain == domain]:
            audit = AUDIT_BY_TABLE[table.name]
            outgoing = [f"`{f.name}` → `{f.fk}`" for f in table.fields if f.fk]
            outgoing.extend(
                f"`{format_table_foreign_key(table_fk)}`"
                for table_fk in table.foreign_keys
            )
            views = [view.name for view in VIEWS if table.name in view.lineage]
            lines += [
                f"## `{table.name}` — {table.zh_name}",
                "",
                f"- **用途：** {table.purpose}",
                f"- **一行代表：** {table.grain}",
                f"- **写入责任：** {table.writer}",
                f"- **读取项目：** {'、'.join(table.readers)}",
                f"- **数据来源：** {table.source}",
                f"- **实施层级：** `{tier_for_table(table.name)}`",
                f"- **生命周期：** `{table.lifecycle}`",
                f"- **写入/修改策略：** `{table.mutation_policy}` — {MUTATION_POLICY_NAMES[table.mutation_policy]}",
                f"- **最小粒度终审：** `{audit.minimum_grain_verdict}`；存储类别 `{audit.storage_class}`；可派生性 `{audit.derivability}`",
                f"- **可派生字段/输出：** {'；'.join(audit.derived_fields) if audit.derived_fields else '无额外派生字段；按本表声明粒度作为基础/主数据/流程事实'}",
                f"- **R6 审计动作：** {audit.action}",
                f"- **为何存表而不是现算视图：** {storage_reason(table)}",
                f"- **保留策略：** {table.retention}",
                f"- **向外连接：** {'；'.join(outgoing) if outgoing else '无外键；仍受来源/批次和业务唯一约束控制'}",
                f"- **被谁连接：** {'；'.join('`'+x+'`' for x in sorted(incoming[table.name])) if incoming[table.name] else '当前目标模型无入向外键'}",
                f"- **分析视图：** {'、'.join('`'+x+'`' for x in views) if views else '无直接视图；可由业务链中的上游视图消费'}",
                f"- **唯一约束：** {format_unique_constraints(table).replace(' | ', '；') if table.uniques else '仅主键；业务去重由来源幂等键/状态规则决定'}",
                f"- **不可重叠约束：** {'；'.join(table.exclusions) if table.exclusions else '无有效区间排斥约束；不代表业务时间可任意重叠'}",
                f"- **表级检查：** {'；'.join(table.checks) if table.checks else '无额外表级 CHECK'}",
            ]
            if table.notes:
                lines.append(f"- **特别说明：** {table.notes}")
            lines += [
                "",
                "| # | 字段 | 中文名 | 类型 | 空值/默认 | 存放什么 | 业务作用 | 主外键/规则 | 时间与历史语义 | 敏感级别 | 示例 | 容易误用的地方 |",
                "|---:|---|---|---|---|---|---|---|---|---|---|---|",
            ]
            for i, field in enumerate(table.fields, 1):
                lines.append(
                    "| {i} | `{name}` | {zh} | `{dtype}` | {nullable}; {default} | {desc} | {purpose} | {constraints} | {time}; {history} | `{sensitive}` | `{example}` | {misuse} |".format(
                        i=i,
                        name=field.name,
                        zh=md_escape(field.zh_name),
                        dtype=field.data_type,
                        nullable="可空" if field.nullable else "非空",
                        default=md_escape("默认 " + fmt_default(field.default)),
                        desc=md_escape(field.description),
                        purpose=md_escape(field.purpose),
                        constraints=md_escape(field_constraint_summary(table, field)),
                        time=md_escape(field_time_semantics(field)),
                        history=md_escape(history_semantics(table, field)),
                        sensitive=field.sensitive,
                        example=md_escape(field.example),
                        misuse=md_escape(misuse_note(field, table.name)),
                    )
                )
            lines.append("")
    lines += ["# 只读治理视图", "", "这些视图统一跨域分析口径，不允许任何项目写入。", ""]
    for view in VIEWS:
        lines += [
            f"## `{view.name}` — {view.zh_name}",
            "",
            f"- **用途：** {view.purpose}",
            f"- **一行代表：** {view.grain}",
            f"- **读取项目：** {'、'.join(view.readers)}",
            f"- **实施层级：** {view_implementation_tier(view.name)}",
            f"- **SELECT规格准备度：** `{view.readiness_status}`",
            f"- **稳定阻断码：** `{format_view_blockers(view)}`",
            f"- **粒度唯一键：** `{format_view_grain_key(view)}`",
            "- **实施事实：** 当前未创建、未运行验证；`PASS_SELECT_SPEC` 也只代表可以进入 SELECT 编写与测试。",
            f"- **血缘：** {' → '.join('`'+x+'`' for x in view.lineage)}",
            f"- **物理基表闭包：** {'、'.join('`'+x+'`' for x in sorted(VIEW_BASE_TABLES[view.name]))}",
            f"- **说明：** {view.notes}",
            "",
            "| # | 输出字段 | 中文名 | 类型 | 可空 | 输出含义 | 分析作用 | 时间语义 | 示例 | 误用提醒 |",
            "|---:|---|---|---|---|---|---|---|---|---|",
        ]
        for i, field in enumerate(view.fields, 1):
            lines.append(
                f"| {i} | `{field.name}` | {md_escape(field.zh_name)} | `{field.data_type}` | {'是' if field.nullable else '否'} | {md_escape(field.description)} | {md_escape(field.purpose)} | {md_escape(field_time_semantics(field))} | `{md_escape(field.example)}` | {md_escape(misuse_note(field, view.name))} |"
            )
        lines.append("")
    (ROOT / "03-table-and-field-dictionary.md").write_text("\n".join(lines), encoding="utf-8")


def generate_migration_md():
    lines = md_header("04 当前到目标兼容与迁移矩阵", f"{len(CURRENT_TABLES)} 张表和 {len(CURRENT_VIEWS)} 个视图全部有去向；本文件只定义策略，不执行迁移。")
    lines += [
        "## 不可跳过的迁移阶段",
        "",
        "1. **冻结契约清单：** 记录每个部署版本、连接角色、动态 SQL、定时任务和外部客户端。",
        "2. **新库建结构：** 仅在蓝图批准后生成迁移；每张表带表/列注释、外键、唯一约束和检查规则。",
        "3. **历史回填：** 按来源批次回填；无法映射的数据进入审核队列，不猜填。",
        "4. **影子读取与核对：** 旧库继续权威写入，新库只验证行数、金额、数量、身份覆盖和链路一致性。",
        "5. **双写：** 一次只切一个写入者；写新失败必须可观测且不能让两库状态静默分叉。",
        "6. **按项目切读：** 先治理视图、后业务写入；每个项目有明确验收和独立回退开关。",
        "7. **冻结旧写入：** 全部契约通过后旧表只读；保留审计窗口。",
        "8. **归档/退役：** 达到批准保留期后再删除，认证令牌不迁移而是失效重签。",
        "",
        "## 回滚原则",
        "",
        "- 回滚单位是一个项目的一组已批准契约，不是全库一起回退。",
        "- 读切换回滚到旧库；写切换必须先停写、比较双库高水位和幂等键，不能盲目反向覆盖。",
        "- 新库产生而旧库无法表达的新事实放入补偿队列，不丢弃、不伪造旧字段。",
        "- 身份映射、成本采用价和已发布版本属于关键审计事实，回滚应用不删除这些记录。",
        "",
        "## 逐对象矩阵",
        "",
        "| 当前对象 | 类型 | 处理 | 目标对象 | 回填/转换规则 | 兼容与切换规则 | 风险 |",
        "|---|---|---|---|---|---|---|",
    ]
    for item in MAPPINGS:
        lines.append(
            f"| `{item.current_object}` | {item.object_type} | `{item.disposition}` | {md_escape(', '.join('`'+x+'`' for x in item.target_objects) or '无；归档/退役')} | {md_escape(item.migration_rule)} | {md_escape(item.compatibility_rule)} | `{item.risk}` |"
        )
    lines += ["", "## 批准门槛", "", "上述每一行都需要拥有该对象的项目负责人确认旧口径、新契约、回填样本、差异阈值和回滚开关。任何 `CRITICAL` 行未通过时，不开始对应链路的生产切换。", ""]
    (ROOT / "04-current-to-target-matrix.md").write_text("\n".join(lines), encoding="utf-8")


def generate_project_md():
    groups = project_reference_groups()
    project_by_code = {x["code"]: x for x in PROJECTS}
    lines = md_header("05 项目兼容与数据访问矩阵", "覆盖 BakeryOps、RES/POS、财务网站和 HBTI；静态扫描线索与已批准目标边界分开。")
    lines += [
        "## 重要限制",
        "",
        "下列“当前访问”来自保守静态文本扫描，可能包含文档、旧脚本或未部署路径，也可能漏掉动态 SQL。它适合制定核查清单，不足以证明运行时兼容。方案 C 的“完美适配”只有在迁移阶段完成部署清单、API/SQL 契约测试、影子核对和回滚演练后才能确认。",
        "",
    ]
    for project in PROJECTS:
        lines += [
            f"## {project['name']}",
            "",
            f"- **当前代码位置：** `{project['root']}`",
            f"- **目标写入边界：** {project['target_write_domains']}",
            f"- **目标读取边界：** {project['target_read_domains']}",
            f"- **不可越界：** {project['boundary']}",
            "",
            "| 当前对象 | 静态访问线索 | 主要文件（引用次数） | 新契约 | 切换规则 | 风险 |",
            "|---|---|---|---|---|---|",
        ]
        rows = [((pc, name), evidence) for (pc, name), evidence in groups.items() if pc == project["code"]]
        for (_, name), evidence in sorted(rows):
            kinds = [k.upper() for k in ("read", "write", "ambiguous") if evidence[k]]
            files = "; ".join(f"`{x}` ({n})" for x, n in evidence["files"].most_common(6))
            mapping = MAPPING_BY_OBJECT[name]
            lines.append(
                f"| `{name}` | {' + '.join(kinds) or 'REFERENCE'} | {md_escape(files)} | {md_escape(', '.join('`'+x+'`' for x in mapping.target_objects) or '归档/退役')} | {md_escape(mapping.compatibility_rule)} | `{mapping.risk}` |"
            )
        lines += ["", "**项目验收：** 每个上表对象必须定位当前生产调用、记录旧请求/响应或 SQL 形状、建立新契约测试，并证明回滚开关。", ""]
    lines += [
        "## 跨项目冲突必须先拆",
        "",
        "- `daily_revenue`：POS 与财务来源分开写 `pos_sales_day` / `finance_sales_daily`，只在核对视图比较。",
        "- `pos_member`：RES/POS 写会员域，HBTI 写营销域；手机号在受限联系表，活动状态不回写会员主档。",
        "- 门店：所有项目通过 `location_id`，来源名称保留在 `ops_location_source_identity`，不再各自建门店真相。",
        "- 产品：RES/POS 只负责 listing；运营负责企业产品；映射审批后成本、预测和销售才通过 `product_id` 联动。",
        "- 人员：自然人、雇佣关系、登录账号分开；班表与工时用 `employment_id`。",
        "",
    ]
    (ROOT / "05-project-compatibility-matrix.md").write_text("\n".join(lines), encoding="utf-8")


def generate_first_principles_review_md(model_stats: dict):
    lines = md_header("06 第一性原则审查与方案 C 判断", "先拆错误前提，再区分事实、推测、设计判断和未知；本文件给出是否值得继续评审的直接结论。")
    lines += [
        "## 直接结论",
        "",
        f"**缩减后的方案 C 适合继续评审，但现在仍不适合批准实施。** 首期物理基座是 {model_stats['phase1_core_table_count']} 张，其中 {model_stats['core_business_table_count']} 张业务事实/主数据、{model_stats['core_platform_table_count']} 张运行治理侧车；{model_stats['extension_table_count']} 张扩展契约和 {model_stats['source_conditional_table_count']} 张来源条件契约不属于首期建表清单。尚未满足的是运行时契约证明、逐对象身份对账、单位与财务口径确认。",
        "",
        "这不是文字上的保守：若现在直接实施，最可能出现的不是建表失败，而是旧项目仍按名称、旧唯一键或 `ON CONFLICT` 写入，形成两个都能写、两个都自称正确的新旧真相。",
        "",
        "## 先纠正问题中的错误前提和逻辑跳跃",
        "",
        "1. **“数据库搭好，上层代码都能改，所以数据库可以先单独定稿”只对一半。** 数据库确实是地基，但事实粒度、写入者、幂等键、状态机和来源能力属于数据契约，必须与真实写入代码共同验证；否则字段设计会建立在不存在的订单 ID 或工时修改语义上。",
        "2. **“把每个部分通过某个字段连起来”若指一个全库万能字段，是错误前提。** 企业稳定对象用各自强类型外键；外部来源 ID 先进入 source_identity；跨系统核对通过只读视图。`product_id` 不能代替 `material_id`，`person_id` 不能代替 `employment_id`。若把来源订单号、姓名或商品名直接当企业键，连接越多，错误传播越快。",
        "3. **“完美适配现在所有项目”目前无法被确认。** 本轮静态扫描已排除文档、测试、迁移和 JSON/YAML 数据的伪运行时证据，但仍无法覆盖动态 SQL、未在本地的客户端和各生产部署实际提交。",
        "4. **目标表越完整不等于首日越该全部创建。** `PLANNED_MODULE` 没有已确认写入者，`SOURCE_CONDITIONAL` 依赖外部来源能力；提前创建只会制造空表和第二套未受控真相。",
        "5. **同一天重跑行数不变不等于完整幂等。** 它证明相同结果集通过相同冲突键不会新增行；如果来源之后删除一行，当前 upsert 不会自动删除旧行。删除安全需要不可变整批快照、批次完整性清单和确定性选版。",
        "",
        "## 已确认事实",
        "",
        f"- 当前只读快照有 {CURRENT['summary']['table_count']} 表、{CURRENT['summary']['view_count']} 视图、{CURRENT['summary']['column_count']} 列；{len(CURRENT_TABLES)} 表和 {len(CURRENT_VIEWS)} 视图在迁移矩阵中各出现且只出现一次。",
        "- `daily_revenue` 同时存在 `UNIQUE(date)` 与 `UNIQUE(date, store)`，前者会阻止同一天第二家门店写入。",
        "- 当前存在 `ops_store` 与 `finance_store` 两套地点、`product`/`pos_product`/成本卡对象多套产品身份，以及 `staff`/`employees` 两套人员数据；它们没有一条已证明的统一稳定身份链。",
        "- 当前成本卡、销售、节假日、财务、招聘和消息对象已经形成有价值的来源事实与业务功能，不能用一次性重写丢弃；方案 C 必须回填并保留来源 ID、批次、版本和质量状态。",
        f"- `pos_member_order_item` 已回填 {MEMBER_ORDER_AUDIT['aggregate']['row_count']:,} 行、{MEMBER_ORDER_AUDIT['aggregate']['distinct_order_count']:,} 个订单、{MEMBER_ORDER_AUDIT['aggregate']['distinct_item_key_count']} 个商品键，营业日范围 {MEMBER_ORDER_AUDIT['range']['min_business_date']} 至 {MEMBER_ORDER_AUDIT['range']['max_business_date']}；{MEMBER_ORDER_AUDIT['aggregate']['attributed_row_count']:,} 行可唯一缓存到某会员。当前会员主档为 {MEMBER_ORDER_AUDIT['aggregate']['current_pos_member_row_count']:,} 行，因此 {MEMBER_ORDER_AUDIT['aggregate']['distinct_attributed_member_count']:,} 名覆盖率约 59.4%，不是对全部会员消费的完整覆盖。",
        f"- 当前归属核验得到 {MEMBER_ORDER_AUDIT['member_attribution']['unique_member_order_count']:,} 个唯一会员订单、{MEMBER_ORDER_AUDIT['member_attribution']['ambiguous_member_order_count']} 个多会员歧义订单、{MEMBER_ORDER_AUDIT['member_attribution']['unmatched_order_count']:,} 个无卡交易订单；另有 {MEMBER_ORDER_AUDIT['product_mapping']['missing_product_row_count']} 行、{MEMBER_ORDER_AUDIT['product_mapping']['missing_product_item_key_count']} 个商品键暂未接上 `pos_product`。",
        f"- R6 首期目标为 {model_stats['phase1_core_table_count']} 张物理表；完整设计目录含 {model_stats['table_count']} 张潜在物理契约、{model_stats['view_count']} 个只读视图和 {model_stats['foreign_key_count']} 个外键。原 R5 的 154 个对象已有 154/154 唯一去向，但不是 154 张都保留。{model_stats['audit_audited_physical_table_count']} 张存续物理契约均有机器可核对的必要性结论。",
        "",
        "## 合理推测",
        "",
        "- 多个本地项目对同一对象存在运行源码读写线索，说明共享契约风险是真实的核查优先级；但静态命中不证明生产一定执行。",
        "- 现有成本价格大多更像迁移启动快照，而不是可分析的采购价时间序列；因此可以作为 `MIGRATED_MANUAL` 启动价，但不能包装成历史市场观察。",
        "- 当前人员、门店、产品和原料映射中会存在重名、一对多和单位冲突；需要审核队列，而不是自动模糊匹配直接写 FK。",
        "- 会员卡可能共享、订单可能是团购或由多人使用，因此订单与会员账号有关联不充分证明该自然人亲自食用；这是数据能证明什么的边界，不是文案偏好。",
        "",
        "## 设计判断（这是方案选择，不是假装成已确认事实）",
        "",
        "- 单企业模型不增加 `tenant_id`；企业边界固定，地点扩展统一用 `location_id`。若未来要经营第二法律主体，应新做企业边界决策，而不是现在预埋一个无人治理的 tenant 字段。",
        "- `product_id`、`person_id`、`employment_id`、`material_id`、`location_id` 分别代表不同稳定对象；来源 ID 只在映射表内取得企业身份。",
        "- 预测、人工计划、生产执行、销售实际、财务口径分别保存；它们在治理视图比较，不互相覆盖。",
        "- 草稿可以修改，发布/发送/终态事实冻结；更正通过新版本、新运行、冲销或追加事件表达。",
        "- 当前分析视图必须有确定性选版规则：明确可用状态、替代关系、时间排序和平局规则，不能依赖“最后写入的一行”。",
        "- `pos_order_item` 保存批次 × 订单 × listing 的最小来源事实；`member_id` 不复制进去，而由 `pos_member_card_transaction` 经 `v_pos_order_member_attribution` 派生。这样一份事实可以支持会员关联商品、购物篮、复购、产品映射、成本和 HBTI，而不会多处缓存同一结论。",
        "",
        "## 当前结构合理的地方",
        "",
        "- 已按 POS、运营、人事、成本、财务等领域形成部分命名前缀和来源边界，这为迁移分域提供了基础。",
        "- 已有成本配方/价格、POS 小时与单品事实、财务独立模板事实、招聘流程和消息日志，不需要推倒重来。",
        "- 新增 `pos_member_order_item` 的订单 × 商品粒度比只存商品日报更接近可复用基础事实，且对重复来源行采用 SUM 而不是 DISTINCT，避免丢量；这一方向应保留。",
        "- 已有视图尝试把成本、销售、节假日和身份拼接；它们暴露了真实分析需求，可作为新只读契约的验收样例。",
        "- 当前 RLS、审计和迁移记录说明系统已经意识到权限与变更治理；但启用 RLS 或存在迁移表本身不证明最小权限和多仓库迁移不会冲突。",
        "",
        "## 当前结构不合理的地方",
        "",
        "- 地点、产品、人员、原料的稳定身份不贯穿全部事实，名称和来源键承担了不应承担的关联职责。",
        "- 日销售等表存在与多门店目标冲突的唯一约束；部分事实缺主键或明确业务粒度。",
        "- 预测、人工计划和最终执行的版本边界不足，人工调整可能只留下最后值而没有 before/after/delta。",
        "- 会员主档混入 HBTI 活动当前状态，形成跨项目双写和历史结果丢失风险。",
        "- 原始财务、管理报表和已过账口径若没有 source_layer/recognition_status，会发生重复汇总或把来源模板误当会计真值。",
        "- 单位目前可能是自由文本或隐含约定；CASE/BAG 到 g/kg 的换算若不按物料版本化，采购、配方、库存和成本会产生数量级错误。",
        "- `pos_member_order_item` 缺少地点、来源系统、批次、外键和完整快照语义，并冗余缓存 `member_id`；当前结构不适合直接扩展到第二门店，也不能完整追溯更正。启用 RLS 但没有表级 policy 也不等于已经完成最小权限设计。",
        "",
        "## R6 已主动修正的设计缺口",
        "",
        "- 新增全局单位字典和物料专属单位换算；所有计算数量通过受控 unit ID 和冻结换算快照解释。",
        "- 增加员工来源映射审核，明确重名或相似手机号只能生成候选，不能自动确认 employment。",
        "- 将断货事实归属 `ops_` 写入者；POS 只提供销售来源事实。",
        "- 将复盘经理填写的营收、单量、客单价和时间从 JSON 提升为结构化列，避免迁移丢字段。",
        "- HBTI 结果独立版本化，活动版本钉住正式算法；离线重算不回写旧结果或自动改变奖励。",
        "- 消息正文保持不可变，渠道 SENT/DELIVERED/READ/FAILED 改为只追加事件并由视图计算当前状态。",
        "- 财务技术导入状态与会计认可状态分开；成本与毛利通过 POS 批次、配方版本、价格ID集合、计算版本和修订哈希选版，不再为可重算成本另建运行/快照/组件三张物理表。",
        "- 对全部含可空字段的唯一约束强制声明空值去重语义；公司级目标、全局成本、无批号库存行不再因 `NULL` 绕过唯一性。",
        "- 对身份映射、别名、授权、课程、岗位资格、配方、单位换算、采用价和财务归类增加正式有效期不可重叠规则，并统一 `[from, to)` 语义。",
        "- POS 报废新增批次内来源行指纹；来源没有 waste ID 时仍能幂等，但指纹不冒充跨批次业务身份。",
        "- 采购价观察除来源记录号外，对收货行和采购行强来源分别去重，避免同一价格证据重复进入成本。",
        "- 将订单稳定身份与批次订单商品事实分开；新增 `v_pos_order_item_current`、`v_pos_order_member_attribution`、`v_pos_member_order_item`，分别负责整批选版、会员归属判断和个性化只读派生。",
        "- 将全库外键连通性变成机器门禁：除迁移台账和不可逆限流桶两个明确例外，所有业务表必须进入稳定身份图；同时为每张表说明为何必须存表而不是现算视图。",
        "- 供应商 SKU、物料和包装换算合并为一张有效期版本表，避免稳定主档与一对一映射双表漂移；候选申请阶段继续使用追加事件，避免当前值覆盖漏斗历史。",
        "- 客单价、会员占比、节假日倍率、产品成本组件/快照、评估总分和补货差值移到只读视图；采购单合计与奖励库存事务缓存增加独立核对视图。",
        "- 库存移动删除多态文本来源，改为明确收货、生产和盘点外键；财务来源行使用行定位符保留真实重复，内容指纹不再冒充唯一身份。",
        "",
        "## Claude 独立审查的处理结果",
        "",
        "- **已确认的独立结果：** Claude Fable 5 对原 154 个对象给出 104 CORE_KEEP、36 EXTENSION_LATER、3 DERIVE_VIEW、5 CORE_MERGE_INTO、2 REMOVE、4 DEFER_SOURCE；无遗漏和重复。完整输出与逐表对照进入 `evidence/claude-fable-5-r6-minimal-foundation.md` 和 `r5-to-r6-disposition.csv`。",
        "- **采纳的方向：** 首期/扩展/来源条件分层，节假日与成本改视图，试工、日历任务、Prompt版本和供应商映射合并，以及成本运行删除。",
        f"- **没有照抄 Claude 的数量：** 逐表逐字段复核后的最终处置为 {model_stats['phase1_core_table_count']} 首期、{model_stats['extension_table_count']} 扩展、{model_stats['source_conditional_table_count']} 来源条件、{model_stats['merged_r5_table_count']} 合并、{model_stats['derived_r5_table_count']} 派生、{model_stats['removed_r5_table_count']} 删除。产品级计划调整并入计划行；数据质量工单降为可选；生产计划/班表/配方/活动/采购等空壳和可重算副本进一步被合并或派生。",
        "- **仍明确不采纳：** 不在没有业务证据时把成品 dispatch 接到原料库存移动；不把工时强制成简单乘法；不以内容指纹单独去重财务来源行，避免删除真实重复事实。",
        "",
        "## 批准实施前的硬门禁",
        "",
        "1. 四个生产部署的提交、连接角色、动态 SQL、定时任务和直接数据库客户端清单。",
        "2. 门店、产品、人员、原料至少各一批真实样本的逐条映射与冲突处理验收。",
        "3. 金额、税、退款、币种、数量、单位、营业日和时区的来源契约测试。",
        "4. POS 订单来源需补齐其他门店命名空间、整批完整性和删除/更正语义；POS 支付/退款来源，以及 Lark 工时员工 ID、修改/撤销和幂等重跑能力仍需验证。",
        "5. 每条迁移链的回填、双轨、逐日/逐行核对、切换、回滚和旧写入口关闭证明。",
        "",
    ]
    (ROOT / "06-first-principles-decision-review.md").write_text("\n".join(lines), encoding="utf-8")


def html_table(headers: list[str], rows: Iterable[Iterable[str]], classes: str = "") -> str:
    head = "".join(f"<th>{h(x)}</th>" for x in headers)
    body = "".join("<tr>" + "".join(f"<td>{x}</td>" for x in row) + "</tr>" for row in rows)
    return f'<div class="table-wrap"><table class="{h(classes)}"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def generate_html(model_stats: dict):
    stats = current_audit_stats()
    nav = [
        ("summary", "结论"), ("evidence", "证据边界"), ("principles", "原则"), ("decision", "合理/不合理"), ("identity", "连接脊柱"),
        ("domains", "目标板块"), ("grain-audit", "最小粒度终审"), ("tables", "逐表字段"), ("mapping", "旧库去向"),
        ("projects", "项目兼容"), ("chains", "15条链路"), ("limits", "待验证"),
    ]
    parts = ["<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">",
             '<meta name="viewport" content="width=device-width,initial-scale=1">',
             '<title>HOT CRUSH Core V1 R6 最小物理基座评审稿</title>',
             "<style>",
             """
    :root{--navy:#18344f;--ink:#17222d;--muted:#607080;--line:#d9e0e7;--paper:#fff;--bg:#f4f6f8;--warn:#fff4df;--danger:#ffe9e9;--ok:#e8f5ed}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
    aside{position:fixed;inset:0 auto 0 0;width:238px;background:var(--navy);color:#fff;padding:24px 18px;overflow:auto} aside h1{font-size:18px;line-height:1.35;margin:0 0 8px} aside p{font-size:12px;color:#c9d6e2} aside a{display:block;color:#eaf2f8;text-decoration:none;padding:7px 9px;border-radius:6px} aside a:hover{background:#294b69}
    main{margin-left:238px;padding:30px;max-width:1800px} section{background:var(--paper);border:1px solid var(--line);border-radius:12px;margin:0 0 24px;padding:26px;box-shadow:0 2px 10px rgba(20,40,60,.04)}
    h2{color:var(--navy);margin-top:0} h3{margin:26px 0 10px;color:#244865} code{background:#edf1f4;padding:1px 4px;border-radius:4px} .status{background:var(--warn);border-left:5px solid #e4a23b;padding:14px 16px;border-radius:8px}.danger{background:var(--danger);padding:12px 15px;border-radius:8px}.ok{background:var(--ok);padding:12px 15px;border-radius:8px}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.card{border:1px solid var(--line);border-radius:9px;padding:14px;background:#fbfcfd}.big{font-size:25px;font-weight:700;color:var(--navy)}
    .table-wrap{overflow:auto;border:1px solid var(--line);border-radius:8px;margin:10px 0 20px} table{border-collapse:collapse;width:100%;min-width:900px;font-size:12px} th{position:sticky;top:0;background:#edf2f6;color:#263f54;text-align:left} th,td{border-bottom:1px solid #e6ebef;padding:7px 8px;vertical-align:top} tr:hover td{background:#f8fafb}
    details{border:1px solid var(--line);border-radius:9px;margin:10px 0;background:#fff} summary{cursor:pointer;padding:13px 15px;font-weight:650;background:#f8fafc;border-radius:9px}.detail-body{padding:4px 15px 16px}.pill{display:inline-block;padding:2px 7px;border-radius:999px;font-size:11px;margin:1px 4px 1px 0;background:#e8edf2}.domain{border-left:7px solid var(--accent)}
    .chain{border-left:5px solid #4d7fc1;padding:6px 0 6px 16px;margin:18px 0}.path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#f0f4f7;padding:10px;border-radius:7px;overflow:auto}.search{width:100%;padding:11px 13px;border:1px solid #aebdca;border-radius:8px;font-size:14px;margin-bottom:12px}.small{font-size:12px;color:var(--muted)} ul{padding-left:22px}@media(max-width:900px){aside{position:static;width:auto}main{margin:0;padding:12px}section{padding:18px}}
             """,
             "</style></head><body>",
             "<aside><h1>HOT CRUSH Core V1 · R6</h1><p>最小物理基座评审稿<br>不是执行授权</p>",
             "".join(f'<a href="#{x}">{h(label)}</a>' for x, label in nav),
             '<hr style="border-color:#45627d"><a href="diagrams/HOTCRUSH-Core-V1-R6-最小物理基座蓝图-网页交互版.html">打开R6完整蓝图</a><a href="diagrams/HOTCRUSH-Core-V1-R6-最小物理基座蓝图-总览.png">打开R6高清总览</a><a href="diagrams/HOTCRUSH-Core-V1-R6-最小物理基座蓝图-会员订单.png">打开会员订单模块</a><a href="diagrams/HOTCRUSH-Core-V1-R6-最小物理基座蓝图-完整61页.pdf">下载R6蓝图PDF</a><a href="08-r6-minimal-physical-foundation.md">打开R6最小物理基座终审</a><a href="09-implementation-guardrails-and-security.md">打开实施约束与安全门禁</a><a href="r5-to-r6-disposition.csv">下载154项去向</a><a href="target-storage-necessity-audit.csv">下载全表终审CSV</a><a href="target-view-catalog.csv">下载视图分期与血缘</a><a href="target-field-dictionary.csv">下载完整字段CSV</a><a href="target-comments-contract.sql">打开完整注释契约</a><a href="current-to-target-matrix.csv">下载迁移矩阵CSV</a></aside><main>',
             '<section id="summary"><h2>结论与范围</h2>',
             '<div class="status"><b>当前状态：</b>只供老板和业务负责人评审。未修改生产数据库、未生成可执行迁移、未改任何项目读写代码。</div>',
             '<p>当前数据库可以继续支撑已有流程，但不适合直接扩成多门店、中央厨房、仓库和跨模块统一分析。方案 C 应在新库建立稳定身份与事实契约，再按项目回填、影子核对、双轨和切换。</p>',
             '<div class="cards">',
             f'<div class="card"><div class="big">{CURRENT["summary"]["table_count"]}</div>当前表，全部有去向</div>',
             f'<div class="card"><div class="big">{CURRENT["summary"]["view_count"]}</div>当前视图，全部有去向</div>',
             f'<div class="card"><div class="big">{model_stats["phase1_core_table_count"]}</div>首期物理表（{model_stats["core_business_table_count"]}业务 / {model_stats["core_platform_table_count"]}平台侧车）</div>',
             f'<div class="card"><div class="big">{model_stats["table_count"]}</div>完整潜在物理契约（含{model_stats["extension_table_count"]}扩展 / {model_stats["source_conditional_table_count"]}来源条件）</div>',
             f'<div class="card"><div class="big">{model_stats["phase1_view_count"]}</div>Phase1 视图设计候选</div>',
             f'<div class="card"><div class="big">{VIEW_READINESS_GOLDEN_COUNTS["PASS_SELECT_SPEC"]}</div>SELECT规格 ready（仅设计）</div>',
             f'<div class="card"><div class="big">{CREATED_AND_VALIDATED_SQL_VIEW_COUNT}</div>已创建并验证 SQL view</div>',
             f'<div class="card"><div class="big">154/154</div>原R5对象均有唯一去向</div>',
             f'<div class="card"><div class="big">{model_stats["audit_audited_physical_table_count"]}/{model_stats["table_count"]}</div>存续物理契约已逐张审计必要性</div>',
             f'<div class="card"><div class="big">{model_stats["table_field_count"]+model_stats["view_field_count"]}</div>目标字段逐项说明</div>',
             f'<div class="card"><div class="big">{model_stats["foreign_key_count"]}</div>目标外键关系</div></div>',
             f'<div class="status"><b>视图事实边界：</b>{h(VIEW_READINESS_BOUNDARY)}</div>',
             '<h3>已确认</h3><ul>',
             f'<li>生产快照：{CURRENT["summary"]["table_count"]} 表、{CURRENT["summary"]["view_count"]} 视图、{CURRENT["summary"]["column_count"]} 列、主键 {stats["constraints"]["primary_key"]}、外键 {stats["constraints"]["foreign_key"]}。</li>',
             f'<li>当前 {len(CURRENT_TABLES)} 表与 {len(CURRENT_VIEWS)} 视图均在迁移矩阵恰好出现一次，且所有目标引用存在。</li>',
             f'<li><code>pos_member_order_item</code> 当前 {MEMBER_ORDER_AUDIT["aggregate"]["row_count"]:,} 行 / {MEMBER_ORDER_AUDIT["aggregate"]["distinct_order_count"]:,} 订单；5 个订单会员归属歧义，3 行商品映射缺失，46 行净额为负、9,574 行净额为零。</li>',
             '<li>核心风险集中在地点、商品、人员、原料身份不统一，以及来源事实、人工计划与财务口径混写。</li></ul>',
             '<h3>合理推测</h3><p>静态扫描定位了四个项目中的访问线索，但不能证明生产实际执行；部署版本、动态 SQL 与外部客户端仍需迁移阶段验证。</p>',
             '<h3>暂时无法验证</h3><p>逐人/逐地点映射、金额与单位口径、生产角色权限、POS 其他门店订单命名空间及整批更正语义、支付/退款来源、保留期及切换窗口尚未获业务与运行证据批准。</p></section>']

    parts += [
        '<section id="evidence"><h2>证据边界</h2>',
        f'<p><b>数据库快照：</b>{h(CURRENT["identity"]["captured_at"])} · {CURRENT["summary"]["table_count"]} 表 / {CURRENT["summary"]["view_count"]} 视图 / {CURRENT["summary"]["column_count"]} 列。</p>',
        f'<p><b>代码扫描：</b>{h(CODE["captured_at"])} · 运行源码/脚本引用 {CODE["summary"]["runtime_reference_count"]} 条；文档、测试、迁移和配置数据不作为运行时证明。</p>',
        '<div class="status">本地工作区、数据库快照与各生产部署不是同一个已证明的不可变版本。完整 HEAD、脏文件和 109 迁移重合证据见 <code>00-review-baseline.md</code>；“适配所有项目”仍需生产提交、日志与契约测试。</div></section>',
    ]

    parts += ['<section id="principles"><h2>第一性原则门禁</h2><ol>']
    parts += [f"<li>{h(x)}</li>" for x in DESIGN_GATES]
    parts += ['</ol><div class="danger"><b>直接反对的做法：</b>用名称跨模块关联、把 NULL 当 0、让多个项目写同一来源事实、把预测/计划/实际压成一行、在唯一生产库中边拆边上线。</div></section>']

    parts += [
        '<section id="decision"><h2>合理与不合理的直接判断</h2>',
        '<div class="ok"><b>适合继续评审：</b>稳定身份、来源映射、事实分粒度、批次/版本、单一写入者、确定性当前视图和质量门禁。</div>',
        '<h3>当前结构可保留的基础</h3><ul><li>POS、运营、成本、财务、招聘和消息已有真实来源事实与业务功能，不应推倒重来。</li><li>成本/销售/节假日/身份视图证明跨模块分析需求真实存在，可作为新契约验收样例。</li><li>现有前缀、RLS、审计和迁移记录提供治理起点，但不自动证明最小权限或迁移安全。</li></ul>',
        '<h3>当前结构必须修正</h3><ul><li>地点、产品、人员、原料身份不统一，名称承担了错误的连接职责。</li><li>多门店目标与部分唯一约束、缺主键和不明确粒度冲突。</li><li>预测、人工计划、执行、POS和财务口径没有始终保持独立历史。</li><li><code>pos_member_order_item</code> 缺地点、来源和批次历史，并冗余会员归属；同日 upsert 不等于删除安全的完整幂等。</li><li>自由文本单位、HBTI状态混入会员主档、财务层级混合会造成不可复算或重复汇总。</li></ul>',
        '<div class="status"><b>尚不能批准实施：</b>运行时契约、逐对象映射、金额/单位口径、POS其他门店及整批更正语义、支付/退款和Lark工时来源能力仍未补证。完整推理及Claude意见取舍见 <code>06-first-principles-decision-review.md</code>。</div></section>',
    ]

    parts += ['<section id="identity"><h2>统一连接脊柱</h2>', html_table(["连接键", "权威来源", "作用"], [(f'<code>{h(a)}</code>', f'<code>{h(b)}</code>', h(c)) for a,b,c in IDENTITY_SPINE]), '</section>']

    parts += ['<section id="domains"><h2>目标业务板块</h2><div class="cards">']
    for domain in DOMAIN_ORDER:
        fill, accent = DOMAIN_COLORS[domain]
        ts = [x for x in TABLES if x.domain == domain]
        vs = [x for x in VIEWS if x.domain == domain]
        parts.append(f'<div class="card" style="background:{fill};border-left:6px solid {accent}"><b>{h(domain.upper())} · {h(DOMAIN_NAMES[domain])}</b><br>{len(ts)} 表 / {len(vs)} 视图</div>')
    parts += ['</div><p class="small">颜色只代表负责板块，不代表数据质量或迁移状态。跨色连线必须使用稳定外键、批次/版本或治理视图。</p></section>']

    audit_counts = Counter(audit.storage_class for audit in AUDITS)
    audit_rows = []
    for audit in AUDITS:
        table = TABLE_BY_NAME[audit.table_name]
        audit_rows.append((
            f'<code>{h(table.name)}</code><br>{h(table.zh_name)}',
            f'<code>{h(table.domain)}</code><br><span class="pill">{h(tier_for_table(table.name))}</span>', h(table.grain),
            f'<span class="pill">{h(audit.storage_class)}</span>',
            f'<b>{h(audit.minimum_grain_verdict)}</b>', h(audit.derivability),
            h("；".join(audit.derived_fields) or "无额外派生字段"), h(audit.action),
            h(audit.claude_fable_5_result),
        ))
    parts += [
        '<section id="grain-audit"><h2>R6 最小物理基座与派生性终审</h2>',
        f'<div class="status"><b>直接结论：</b>R5 的154/154通过结论作废。首期只实施{model_stats["phase1_core_table_count"]}张物理表（{model_stats["core_business_table_count"]}业务 + {model_stats["core_platform_table_count"]}平台侧车）；完整{model_stats["table_count"]}张潜在契约目录还包含{model_stats["extension_table_count"]}张按需扩展和{model_stats["source_conditional_table_count"]}张来源条件。原154个对象另有{model_stats["merged_r5_table_count"]}张合并、{model_stats["derived_r5_table_count"]}张派生、{model_stats["removed_r5_table_count"]}张删除。分类：{h(" / ".join(f"{name} {audit_counts[name]}" for name in CLASSIFICATIONS))}。</div>',
        '<p>最小行粒度与最小物理表集合必须同时通过。来源原值、人工决定、真实业务副作用和曾驱动行动的版本化决策可物理保存；当前比率、差值、排行、成本快照和节假日倍率优先由只读视图计算。完整推理见 <code>08-r6-minimal-physical-foundation.md</code>。</p>',
        html_table(["表", "板块/层级", "一行代表", "存储类别", "结论", "可派生性", "派生字段/输出", "R6动作", "Claude"], audit_rows),
        '</section>',
    ]

    parts += ['<section id="tables"><h2>逐表与逐字段字典</h2><p>下列内容由同一目标模型生成。输入表名、中文名或字段名可筛选；CSV 包含每个字段的来源、写入者、时间、历史、敏感性和误用提醒。</p><input class="search" id="tableSearch" placeholder="搜索表、中文名、字段、用途……">']
    for domain in DOMAIN_ORDER:
        fill, accent = DOMAIN_COLORS[domain]
        parts.append(f'<h3 style="color:{accent}">{h(domain.upper())} · {h(DOMAIN_NAMES[domain])}</h3>')
        for table in [x for x in TABLES if x.domain == domain]:
            audit = AUDIT_BY_TABLE[table.name]
            searchable = " ".join([table.name, table.zh_name, table.purpose, table.grain, audit.storage_class, audit.minimum_grain_verdict, format_unique_constraints(table), *table.exclusions] + [f.name+" "+f.zh_name for f in table.fields]).lower()
            rows = []
            for field in table.fields:
                rows.append((
                    f'<code>{h(field.name)}</code><br>{h(field.zh_name)}',
                    f'<code>{h(field.data_type)}</code>',
                    "可空" if field.nullable else "非空",
                    f'<code>{h(fmt_default(field.default))}</code>',
                    h(field.description), h(field.purpose), h(field_constraint_summary(table, field)),
                    h(field_time_semantics(field)), h(field.sensitive), f'<code>{h(field.example)}</code>', h(misuse_note(field, table.name)),
                ))
            parts += [
                f'<details class="domain table-entry" data-search="{h(searchable)}" style="--accent:{accent}"><summary><code>{h(table.name)}</code> — {h(table.zh_name)} <span class="pill">{len(table.fields)}字段</span><span class="pill">{h(tier_for_table(table.name))}</span><span class="pill">{h(audit.storage_class)}</span><span class="pill">{h(audit.minimum_grain_verdict)}</span></summary><div class="detail-body">',
                f'<p><b>用途：</b>{h(table.purpose)}<br><b>一行代表：</b>{h(table.grain)}<br><b>写入：</b>{h(table.writer)}<br><b>读取：</b>{h("、".join(table.readers))}<br><b>来源：</b>{h(table.source)}<br><b>实施层级：</b>{h(tier_for_table(table.name))}<br><b>证据成熟度：</b>{h(LIFECYCLE_NAMES[table.lifecycle])}<br><b>修改策略：</b>{h(MUTATION_POLICY_NAMES[table.mutation_policy])}<br><b>最小物理基座终审：</b>{h(audit.minimum_grain_verdict)} · {h(audit.storage_class)} · 可派生性 {h(audit.derivability)}<br><b>可派生字段/输出：</b>{h("；".join(audit.derived_fields) or "无额外派生字段")}<br><b>R6动作：</b>{h(audit.action)}<br><b>为何存表而非视图：</b>{h(storage_reason(table))}<br><b>唯一约束：</b>{h(format_unique_constraints(table) or "仅主键/其他幂等规则")}<br><b>不可重叠约束：</b>{h(" | ".join(table.exclusions) or "无")}<br><b>表级检查：</b>{h(" | ".join(table.checks) or "无额外 CHECK")}<br><b>保留：</b>{h(table.retention)}</p>',
                html_table(["字段", "类型", "空值", "默认", "存放什么", "作用", "键/规则", "时间语义", "敏感", "示例", "误用提醒"], rows),
                '</div></details>',
            ]
    parts += ['<h3>只读治理视图</h3>']
    for view in VIEWS:
        searchable = " ".join([view.name, view.zh_name, view.purpose, view.readiness_status, *view.readiness_blockers] + [f.name+" "+f.zh_name for f in view.fields]).lower()
        rows = [(f'<code>{h(f.name)}</code><br>{h(f.zh_name)}', f'<code>{h(f.data_type)}</code>', "是" if f.nullable else "否", h(f.description), h(f.purpose), h(field_time_semantics(f)), f'<code>{h(f.example)}</code>', h(misuse_note(f, view.name))) for f in view.fields]
        parts += [f'<details class="table-entry" data-search="{h(searchable)}"><summary><code>{h(view.name)}</code> — {h(view.zh_name)} <span class="pill">VIEW</span><span class="pill">{h(view_implementation_tier(view.name))}</span><span class="pill">{h(view.readiness_status)}</span></summary><div class="detail-body"><p><b>用途：</b>{h(view.purpose)}<br><b>一行代表：</b>{h(view.grain)}<br><b>粒度唯一键：</b>{h(format_view_grain_key(view))}<br><b>实施层级：</b>{h(view_implementation_tier(view.name))}<br><b>SELECT规格准备度：</b>{h(view.readiness_status)}<br><b>稳定阻断码：</b>{h(format_view_blockers(view))}<br><b>实施事实：</b>当前未创建、未运行验证；PASS_SELECT_SPEC 只表示可以进入 SELECT 编写与测试。<br><b>直接血缘：</b>{h(" → ".join(view.lineage))}<br><b>物理基表闭包：</b>{h("、".join(sorted(VIEW_BASE_TABLES[view.name])))}</p>', html_table(["字段", "类型", "可空", "输出含义", "作用", "时间语义", "示例", "误用提醒"], rows), '</div></details>']
    parts += ['</section>']

    map_rows = []
    for item in MAPPINGS:
        map_rows.append((f'<code>{h(item.current_object)}</code>', h(item.object_type), f'<span class="pill">{h(item.disposition)}</span>', h("、".join(item.target_objects) or "归档/退役"), h(item.migration_rule), h(item.compatibility_rule), f'<b>{h(item.risk)}</b>'))
    parts += [f'<section id="mapping"><h2>当前 {len(CURRENT_TABLES)} 表 + {len(CURRENT_VIEWS)} 视图的全部去向</h2>', html_table(["当前对象", "类型", "处理", "目标对象", "回填规则", "兼容规则", "风险"], map_rows), '</section>']

    groups = project_reference_groups()
    parts += ['<section id="projects"><h2>四个项目兼容矩阵</h2><div class="status">静态扫描是核查线索，不是运行时证明。实施批准前必须补部署版本、生产日志和契约测试。</div>']
    for project in PROJECTS:
        rows = []
        for (pc,name), evidence in sorted(groups.items()):
            if pc != project["code"]: continue
            kinds = "+".join(k.upper() for k in ("read","write","ambiguous") if evidence[k]) or "REFERENCE"
            mapping=MAPPING_BY_OBJECT[name]
            rows.append((f'<code>{h(name)}</code>', h(kinds), h("；".join(x for x,_ in evidence["files"].most_common(4))), h("、".join(mapping.target_objects) or "归档/退役"), h(mapping.compatibility_rule), h(mapping.risk)))
        parts += [f'<h3>{h(project["name"])}</h3><p><b>目标写入：</b>{h(project["target_write_domains"])}<br><b>边界：</b>{h(project["boundary"])}</p>', html_table(["当前对象","静态线索","主要文件","新契约","切换","风险"],rows)]
    parts += ['</section>']

    parts += ['<section id="chains"><h2>15 条端到端数据链路</h2>']
    for chain in END_TO_END_CHAINS:
        parts += [f'<div class="chain"><h3>{chain.number:02d} · {h(chain.name)}</h3><p><b>回答：</b>{h(chain.question)}</p><div class="path">{h(" → ".join(chain.nodes))}</div><ul>', *[f'<li>{h(x)}</li>' for x in chain.joins], f'</ul><div class="ok"><b>门禁：</b>{h(chain.control)}</div></div>']
    parts += ['</section>']

    parts += ['<section id="limits"><h2>批准前待验证与下一轮评审</h2><ul><li>身份映射样本：门店、产品、人员、原料逐条确认。</li><li>字段口径：金额、税、退款、单位、营业日和时区。</li><li>项目契约：所有生产部署、动态 SQL、定时任务、Excel/脚本写入点。</li><li>安全：应用专用角色、字段加密、保留期、审计与回滚授权。</li><li>来源条件：POS 其他门店订单命名空间、整批删除/更正、支付和退款；Lark 工时员工 ID、修改/撤销和重跑幂等。</li></ul><p><b>评审方式：</b>先在 Draw.io 总图按板块和 15 条链路提出修改，再改同一模型并重新生成全部文档，直到结构、字段和迁移边界一致。</p></section>']
    parts += ['</main><script>const q=document.getElementById("tableSearch");q&&q.addEventListener("input",()=>{const v=q.value.toLowerCase().trim();document.querySelectorAll(".table-entry").forEach(x=>x.style.display=!v||x.dataset.search.includes(v)?"block":"none")});</script></body></html>']
    rendered = "".join(parts)
    (ROOT / "HOTCRUSH-Core-V1-方案C数据库评审稿.html").write_text(rendered, encoding="utf-8")
    (ROOT / "HOTCRUSH-Core-V1-R6-最小物理基座评审稿.html").write_text(rendered, encoding="utf-8")


def generate_readme(model_stats: dict):
    lines = [
        "# HOT CRUSH Core V1 — R6 最小物理基座评审包",
        "",
        "> 这是设计评审资产，不是执行授权。当前没有修改生产库、没有生成生产迁移、没有改变四个项目的读写代码。",
        "> " + VIEW_READINESS_BOUNDARY,
        "",
        "## 推荐阅读顺序",
        "",
        "1. `HOTCRUSH-Core-V1-R6-最小物理基座评审稿.html`：可搜索的整合评审页面；逐表、逐字段和实施层级在同一页面。",
        "2. `diagrams/HOTCRUSH-Core-V1-R6-最小物理基座蓝图.drawio`：61页可编辑总图、业务域关系图和15条链路。",
        "3. `diagrams/HOTCRUSH-Core-V1-R6-最小物理基座蓝图-总览.png` / `...-会员订单.png` / `...-采购订单.png` / `...-派生成本.png` / `...-完整61页.pdf` / `...-网页交互版.html`：高清评审与交互版本。",
        "4. `00-review-baseline.md`：本轮数据库快照、代码扫描、Git HEAD 和脏工作区边界。",
        f"5. `01-current-database-audit.md`：当前事实、推测、待验证与 {len(CURRENT_TABLES) + len(CURRENT_VIEWS)} 个对象目录。",
        "6. `02-target-database-blueprint.md`：目标原则、身份脊柱、项目边界和 15 条链路。",
        f"7. `03-table-and-field-dictionary.md`：{model_stats['table_count']} 表 + {model_stats['view_count']} 视图逐字段解释。",
        f"8. `04-current-to-target-matrix.md`：{len(CURRENT_TABLES)} 表 + {len(CURRENT_VIEWS)} 视图全部去向、回填和兼容规则。",
        "9. `05-project-compatibility-matrix.md`：BakeryOps、RES/POS、财务网站、HBTI 的访问核查清单。",
        "10. `06-first-principles-decision-review.md`：错误前提、合理/不合理之处、Claude意见取舍和批准门禁。",
        f"11. `08-r6-minimal-physical-foundation.md`：解释R5为何错误、首期 {model_stats['phase1_core_table_count']} 张如何得出，以及154个原对象的合并/派生/删除/扩展/延后结论。",
        f"12. `09-implementation-guardrails-and-security.md`：现库索引/约束/触发器/RLS逐项承接，以及{model_stats['table_count']}张潜在物理表的实施门禁。",
        "13. `r5-to-r6-disposition.csv`：原154个对象逐项唯一去向，并严格区分Claude原判与最终覆盖。",
        "14. `evidence/p0c-source-fidelity-and-reward-2026-08-10.md`：当前、生成式且明确非独立的来源保真/奖励履约证据；它取代旧final acceptance作为当前入口。",
        "",
        "## 可机器核对的数据",
        "",
        "- `current-object-catalog.csv` / `current-field-dictionary.csv`",
        "- `target-table-catalog.csv` / `target-field-dictionary.csv`",
        f"- `target-view-catalog.csv`（{model_stats['view_count']}个视图的实施层级、准备度、稳定阻断码、粒度键、直接血缘与物理基表闭包）",
        "- `target-comments-contract.sql`（全部目标表、视图及字段的 COMMENT 契约；设计稿，不会自动执行）",
        "- `target-storage-necessity-audit.csv`（每张目标表的最小粒度、可派生性、物理存储理由和Claude对照）",
        "- `r5-to-r6-disposition.csv`（原154个候选对象的R6唯一处置）",
        "- `current-to-target-matrix.csv` / `current-field-to-target-matrix.csv` / `project-compatibility-matrix.csv`（现有对象及每个现有字段均有非静默去向）",
        "- `current-guardrail-to-target-matrix.csv`（现库约束、索引、触发器、RLS逐项去向）",
        "- `target-table-implementation-guardrails.csv`（每张目标表的FK索引、RLS、冻结与特殊约束要求）",
        "- `target-model.json`",
        "- `evidence/current-schema-snapshot.json` / `evidence/code-access-snapshot.json` / `evidence/review-baseline.json`",
        "- `evidence/p0c-source-fidelity-and-reward-2026-08-10.md`（当前superseding证据；包含只读source_ref查询/hash、471路由、HBTI锚点、10项奖励fixture hash与Butterfly DRIFT）",
        "- `evidence/claude-fable-5-r6-minimal-foundation.md`（Claude只读独立审计原始输出及最终方案分歧说明）",
        "",
        "## 生成与校验",
        "",
        "```bash",
        "python3 docs/database/hotcrush-core-v1/tools/generate-review-artifacts.py",
        "python3 docs/database/hotcrush-core-v1/tools/generate-drawio-blueprint.py",
        "python3 docs/database/hotcrush-core-v1/tools/validate-review-package.py",
        "python3 docs/database/hotcrush-core-v1/tools/hash-review-package.py",
        "```",
        "",
        f"当前生成模型：首期 {model_stats['phase1_core_table_count']} 张物理表（{model_stats['core_business_table_count']}业务 + {model_stats['core_platform_table_count']}平台侧车）；完整目录 {model_stats['table_count']} 张潜在物理契约、{model_stats['view_count']} 个视图设计契约（Phase1候选{model_stats['phase1_view_count']} / 扩展{model_stats['extension_view_count']} / 来源条件{model_stats['source_conditional_view_count']}）、{model_stats['table_field_count'] + model_stats['view_field_count']} 个逐字段说明、{model_stats['foreign_key_count']} 个外键；Phase1需 {model_stats['phase1_supporting_fk_index_count']} 个未被PK/UQ前缀覆盖的支持索引。",
        "",
        "任何模型调整都应修改 `model/` 后重新生成，禁止只手改某一份文档或图片。",
        "确定性哈希只覆盖声明式模型、生成工具、冻结证据、生成文本契约和 Draw.io 源文件；PNG/PDF/网页交互版因第三方导出元数据单独验收，具体边界见 `09-implementation-guardrails-and-security.md`。",
        "",
    ]
    (ROOT / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    stats = verify_inputs()
    generate_review_baseline()
    generate_current_catalog_csv()
    generate_current_field_csv()
    generate_target_csvs()
    generate_view_readiness_evidence()
    generate_p0c_source_fidelity_evidence(stats)
    generate_comment_contract()
    generate_implementation_guardrails()
    generate_storage_audit_artifacts()
    generate_mapping_csv()
    generate_current_field_mapping_csv()
    generate_project_matrix_csv()
    generate_current_audit_md()
    generate_blueprint_md(stats)
    generate_dictionary_md()
    generate_migration_md()
    generate_project_md()
    generate_first_principles_review_md(stats)
    generate_html(stats)
    generate_readme(stats)
    outputs = sorted(x.name for x in ROOT.iterdir() if x.is_file())
    print(json.dumps({"model": stats, "outputs": outputs}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
