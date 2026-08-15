"""Aggregate and validate the complete HOT CRUSH Core V1 target model."""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import replace

from .tables_app_pos import TABLES as APP_POS_TABLES
from .tables_ops_hr import TABLES as OPS_HR_TABLES
from .tables_scm_finance import TABLES as SCM_FINANCE_TABLES
from .tables_mkt_msg_ai import TABLES as MKT_MSG_AI_TABLES
from .controlled_vocabularies import (
    apply_controlled_vocabulary_checks,
    validate_controlled_vocabulary_contracts,
)
from .target_views import VIEWS, VIEW_GRAIN_KEYS, VIEW_READINESS_CONTRACTS
from .current_to_target import validate_source_fidelity_contracts
from .minimal_foundation import (
    CORE_BUSINESS_TABLES,
    CORE_PLATFORM_TABLES,
    DERIVED_R5_TABLES,
    EXTENSION_TABLES,
    MERGED_R5_TABLES,
    MODEL_VERSION,
    REMOVED_R5_TABLES,
    SOURCE_CONDITIONAL_TABLES,
    tier_for_table,
    validate_minimal_foundation,
)


# Lifecycle is evidence maturity, not architectural importance.  The raw table
# declarations predate this distinction, so the complete model applies one
# explicit, reviewable classification here and rejects unknown categories.
PLANNED_MODULE_TABLES = EXTENSION_TABLES
LIFECYCLE_NAMES = {
    "CORE_MIGRATION": "承接现有数据/契约或作为无损迁移必需治理底座",
    "PLANNED_MODULE": "目标结构已设计，但当前未确认生产写入者；模块获批时才实施",
    "SOURCE_CONDITIONAL": "只有外部来源身份、权限、粒度和重跑稳定性被验证后才实施",
}
MUTATION_POLICY_NAMES = {
    "APPEND_ONLY": "写入后不可修改；更正追加新事实或冲销事件",
    "APPEND_ONLY_DECISION_RECORD": "人工/系统决策只追加，原决定和差异永久可追溯",
    "CONTROLLED_UPDATE": "主数据允许受权限、审计和并发控制的更新",
    "CONTROLLED_UPDATE_UNTIL_TERMINAL": "运行或同步进入终态前可更新，终态后冻结并以新运行重算",
    "CONTROLLED_WORKFLOW": "只允许批准的状态机迁移并记录操作者和时间",
    "CONTROLLED_QUEUE_STATE": "只允许消息队列声明的状态迁移；尝试次数和最后错误从投递事实派生",
    "DRAFT_MUTABLE_THEN_FROZEN": "草稿可编辑；发布、发送或生效后冻结并新建版本",
    "SOURCE_STATE_UNTIL_TERMINAL": "忠实跟随来源系统的业务状态至终态，终态后不擅自改写",
}

_RAW_TABLES = apply_controlled_vocabulary_checks(
    APP_POS_TABLES + OPS_HR_TABLES + SCM_FINANCE_TABLES + MKT_MSG_AI_TABLES
)
_known_names = {table.name for table in _RAW_TABLES}
_unknown_lifecycle_names = (PLANNED_MODULE_TABLES | SOURCE_CONDITIONAL_TABLES) - _known_names
if _unknown_lifecycle_names:
    raise AssertionError(f"lifecycle classification references unknown tables: {sorted(_unknown_lifecycle_names)}")
if PLANNED_MODULE_TABLES & SOURCE_CONDITIONAL_TABLES:
    raise AssertionError("planned and source-conditional table sets overlap")


def _classify_lifecycle(table):
    if table.name in PLANNED_MODULE_TABLES:
        return replace(table, lifecycle="PLANNED_MODULE")
    if table.name in SOURCE_CONDITIONAL_TABLES:
        return replace(table, lifecycle="SOURCE_CONDITIONAL")
    return replace(table, lifecycle="CORE_MIGRATION")


TABLES = tuple(_classify_lifecycle(table) for table in _RAW_TABLES)
TABLE_BY_NAME = {table.name: table for table in TABLES}
VIEW_BY_NAME = {view.name: view for view in VIEWS}


def _base_tables_for_object(object_name: str, stack: tuple[str, ...] = ()) -> set[str]:
    """Expand view lineage to physical base tables and reject cycles."""
    if object_name in TABLE_BY_NAME:
        return {object_name}
    if object_name not in VIEW_BY_NAME:
        raise KeyError(object_name)
    if object_name in stack:
        raise AssertionError(f"view lineage cycle: {' -> '.join(stack + (object_name,))}")
    result: set[str] = set()
    for parent in VIEW_BY_NAME[object_name].lineage:
        result |= _base_tables_for_object(parent, stack + (object_name,))
    return result


VIEW_BASE_TABLES = {
    view.name: frozenset(_base_tables_for_object(view.name))
    for view in VIEWS
}


def view_implementation_tier(view_name: str) -> str:
    base_tables = VIEW_BASE_TABLES[view_name]
    if base_tables & SOURCE_CONDITIONAL_TABLES:
        return "SOURCE_CONDITIONAL"
    if base_tables & EXTENSION_TABLES:
        return "EXTENSION_PACK"
    return "PHASE1"


PHASE1_VIEWS = {name for name in VIEW_BY_NAME if view_implementation_tier(name) == "PHASE1"}
EXTENSION_VIEWS = {name for name in VIEW_BY_NAME if view_implementation_tier(name) == "EXTENSION_PACK"}
SOURCE_CONDITIONAL_VIEWS = {
    name for name in VIEW_BY_NAME if view_implementation_tier(name) == "SOURCE_CONDITIONAL"
}

DOMAIN_ORDER = ("app", "ops", "pos", "hr", "scm", "cost", "finance", "mkt", "msg", "ai")
DOMAIN_NAMES = {
    "app": "治理、权限与质量",
    "ops": "地点、产品、预测、计划、执行与班表",
    "pos": "POS目录、销售与会员",
    "hr": "人员、招聘、培训与工时",
    "scm": "原料、库存、补货、采购与收货",
    "cost": "配方、采购价、成本快照与毛利",
    "finance": "财务来源事实与核对",
    "mkt": "营销、HBTI问卷与奖励",
    "msg": "消息、会话与投递",
    "ai": "Prompt版本与AI调用",
}

VIEW_READINESS_STATUSES = frozenset({
    "PASS_SELECT_SPEC",
    "FIX_MODEL_CONTRACT",
    "BLOCK_MISSING_FACT_OR_RULE",
    "DEFER_EXTENSION",
    "DEFER_SOURCE",
})
VIEW_READINESS_GOLDEN_COUNTS = {
    "PASS_SELECT_SPEC": 10,
    "FIX_MODEL_CONTRACT": 9,
    "BLOCK_MISSING_FACT_OR_RULE": 22,
    "DEFER_EXTENSION": 13,
    "DEFER_SOURCE": 5,
}


def required_fk_index_columns(table) -> tuple[tuple[str, ...], ...]:
    """Return active FK column tuples not covered by a PK/UNIQUE prefix."""
    key_prefixes = [tuple(field.name for field in table.fields if field.pk), *table.uniques]
    candidates: list[tuple[str, ...]] = []
    for field in table.fields:
        columns = (field.name,)
        if field.fk and field.fk_activation == "WITH_TABLE" and not any(
            key[:1] == columns for key in key_prefixes
        ):
            candidates.append(columns)
    for table_fk in table.foreign_keys:
        columns = table_fk.columns
        if table_fk.fk_activation == "WITH_TABLE" and not any(
            key[:len(columns)] == columns for key in key_prefixes
        ):
            candidates.append(columns)
    return tuple(dict.fromkeys(candidates))


def validate_model() -> dict[str, int | str]:
    errors: list[str] = []
    warnings: list[str] = []

    source_fidelity_summary: dict[str, int | str] = {}
    try:
        source_fidelity_summary = validate_source_fidelity_contracts()
    except AssertionError as exc:
        errors.append(str(exc))

    vocabulary_summary: dict[str, int] = {}
    try:
        vocabulary_summary = validate_controlled_vocabulary_contracts(TABLES)
    except AssertionError as exc:
        errors.append(str(exc))

    table_name_counts = Counter(table.name for table in TABLES)
    duplicate_tables = sorted(name for name, count in table_name_counts.items() if count > 1)
    if duplicate_tables:
        errors.append(f"duplicate table names: {duplicate_tables}")

    view_name_counts = Counter(view.name for view in VIEWS)
    duplicate_views = sorted(name for name, count in view_name_counts.items() if count > 1)
    if duplicate_views:
        errors.append(f"duplicate view names: {duplicate_views}")

    collisions = sorted(set(TABLE_BY_NAME) & set(VIEW_BY_NAME))
    if collisions:
        errors.append(f"table/view name collisions: {collisions}")

    classified_views = PHASE1_VIEWS | EXTENSION_VIEWS | SOURCE_CONDITIONAL_VIEWS
    if classified_views != set(VIEW_BY_NAME):
        errors.append(
            f"view implementation-tier coverage mismatch: missing={sorted(set(VIEW_BY_NAME)-classified_views)}"
        )
    if (PHASE1_VIEWS & EXTENSION_VIEWS) or (PHASE1_VIEWS & SOURCE_CONDITIONAL_VIEWS) or (EXTENSION_VIEWS & SOURCE_CONDITIONAL_VIEWS):
        errors.append("view implementation tiers overlap")

    for table in TABLES:
        if table.domain not in DOMAIN_ORDER:
            errors.append(f"{table.name}: unknown domain {table.domain}")
        if table.lifecycle not in LIFECYCLE_NAMES:
            errors.append(f"{table.name}: unknown lifecycle {table.lifecycle}")
        if table.mutation_policy not in MUTATION_POLICY_NAMES:
            errors.append(f"{table.name}: unknown mutation policy {table.mutation_policy}")
        if not table.name.startswith(f"{table.domain}_") and not (
            table.domain == "cost" and table.name.startswith("cost_card_")
        ):
            errors.append(f"{table.name}: prefix does not match writer domain {table.domain}")
        if "tenant_id" in {item.name for item in table.fields}:
            errors.append(f"{table.name}: tenant_id is forbidden for the single-enterprise model")
        if not all((table.zh_name, table.purpose, table.grain, table.writer, table.source, table.lifecycle)):
            errors.append(f"{table.name}: incomplete table metadata")
        field_names = [item.name for item in table.fields]
        duplicate_fields = sorted(name for name, count in Counter(field_names).items() if count > 1)
        if duplicate_fields:
            errors.append(f"{table.name}: duplicate fields {duplicate_fields}")
        pk_fields = [item.name for item in table.fields if item.pk]
        if len(pk_fields) != 1:
            errors.append(f"{table.name}: expected exactly one PK field, got {pk_fields}")
        for field in table.fields:
            if not all((field.zh_name, field.data_type, field.description, field.purpose, field.example)):
                errors.append(f"{table.name}.{field.name}: incomplete field dictionary metadata")
            if field.example.strip() in {"...", "—", "-"}:
                errors.append(f"{table.name}.{field.name}: placeholder example is not an explicit field example")
            if any(token in field.name for token in ("/", "+", " ")):
                errors.append(f"{table.name}.{field.name}: compound/non-atomic field name")
            if field.data_type.endswith("[]") and field.name.endswith("_ids"):
                errors.append(f"{table.name}.{field.name}: relationship IDs must be atomic FK rows, not an array")
            if field.unique and (field.name,) not in table.uniques:
                errors.append(f"{table.name}.{field.name}: field is marked unique but table unique contract is missing")
            if field.fk:
                if field.fk_activation != "WITH_TABLE" and not field.fk_activation.startswith("EXTENSION_PACK:"):
                    errors.append(f"{table.name}.{field.name}: invalid FK activation {field.fk_activation}")
                if field.fk_activation != "WITH_TABLE" and not field.nullable:
                    errors.append(f"{table.name}.{field.name}: deferred FK field must be nullable")
                if "." not in field.fk:
                    errors.append(f"{table.name}.{field.name}: malformed FK {field.fk}")
                else:
                    target_table_name, target_field_name = field.fk.split(".", 1)
                    target = TABLE_BY_NAME.get(target_table_name)
                    if target is None:
                        errors.append(f"{table.name}.{field.name}: unknown FK table {target_table_name}")
                    elif target_field_name not in {item.name for item in target.fields}:
                        errors.append(
                            f"{table.name}.{field.name}: unknown FK field {field.fk}"
                        )
                    elif field.data_type != next(
                        item.data_type for item in target.fields if item.name == target_field_name
                    ):
                        errors.append(
                            f"{table.name}.{field.name}: FK type {field.data_type} != {field.fk} type"
                        )
                    source_tier = tier_for_table(table.name)
                    target_tier = tier_for_table(target_table_name) if target is not None else "UNKNOWN"
                    crosses_unavailable_tier = (
                        (source_tier in {"CORE_BUSINESS", "CORE_PLATFORM", "SOURCE_CONDITIONAL"} and target_tier.startswith("EXTENSION_PACK:"))
                        or (
                            source_tier.startswith("EXTENSION_PACK:")
                            and target_tier.startswith("EXTENSION_PACK:")
                            and source_tier != target_tier
                        )
                    )
                    if crosses_unavailable_tier and field.fk_activation == "WITH_TABLE":
                        errors.append(
                            f"{table.name}.{field.name}: cross-tier FK {field.fk} must declare deferred activation"
                        )
                    if field.fk_activation != "WITH_TABLE":
                        declared_packs = set(field.fk_activation.removeprefix("EXTENSION_PACK:").split("+"))
                        required_packs = {
                            tier.split(":", 1)[1]
                            for tier in (source_tier, target_tier)
                            if tier.startswith("EXTENSION_PACK:")
                        }
                        if not required_packs <= declared_packs:
                            errors.append(
                                f"{table.name}.{field.name}: FK activation {field.fk_activation} misses {sorted(required_packs-declared_packs)}"
                            )
            elif field.fk_activation != "WITH_TABLE":
                errors.append(f"{table.name}.{field.name}: FK activation declared without FK")
        field_by_name = {field.name: field for field in table.fields}
        duplicate_table_fks = [
            fk for fk, count in Counter(table.foreign_keys).items() if count > 1
        ]
        if duplicate_table_fks:
            errors.append(f"{table.name}: duplicate table foreign keys {duplicate_table_fks}")
        for table_fk in table.foreign_keys:
            if not table_fk.columns or not table_fk.ref_columns:
                errors.append(f"{table.name}: composite FK columns must be non-empty: {table_fk}")
                continue
            if len(table_fk.columns) != len(table_fk.ref_columns):
                errors.append(f"{table.name}: composite FK arity mismatch: {table_fk}")
                continue
            if len(set(table_fk.columns)) != len(table_fk.columns):
                errors.append(f"{table.name}: composite FK repeats source columns: {table_fk}")
            if len(set(table_fk.ref_columns)) != len(table_fk.ref_columns):
                errors.append(f"{table.name}: composite FK repeats target columns: {table_fk}")
            missing_source_columns = sorted(set(table_fk.columns) - set(field_by_name))
            if missing_source_columns:
                errors.append(
                    f"{table.name}: composite FK references missing source fields {missing_source_columns}"
                )
            target = TABLE_BY_NAME.get(table_fk.ref_table)
            if target is None:
                errors.append(f"{table.name}: composite FK references unknown table {table_fk.ref_table}")
                continue
            target_field_by_name = {field.name: field for field in target.fields}
            missing_target_columns = sorted(set(table_fk.ref_columns) - set(target_field_by_name))
            if missing_target_columns:
                errors.append(
                    f"{table.name}: composite FK references missing target fields "
                    f"{table_fk.ref_table}.{missing_target_columns}"
                )
                continue
            if missing_source_columns:
                continue
            for source_column, target_column in zip(table_fk.columns, table_fk.ref_columns):
                source_type = field_by_name[source_column].data_type
                target_type = target_field_by_name[target_column].data_type
                if source_type != target_type:
                    errors.append(
                        f"{table.name}: composite FK type {source_column} {source_type} != "
                        f"{table_fk.ref_table}.{target_column} {target_type}"
                    )
            target_pk = tuple(field.name for field in target.fields if field.pk)
            target_candidate_keys = {target_pk, *target.uniques}
            if table_fk.ref_columns not in target_candidate_keys:
                errors.append(
                    f"{table.name}: composite FK target {table_fk.ref_table}{table_fk.ref_columns} "
                    "must exactly match a PK or UNIQUE"
                )
            if table_fk.match_type != "SIMPLE":
                errors.append(f"{table.name}: unsupported composite FK match type {table_fk.match_type}")
            if table_fk.fk_activation != "WITH_TABLE" and not table_fk.fk_activation.startswith("EXTENSION_PACK:"):
                errors.append(
                    f"{table.name}: invalid composite FK activation {table_fk.fk_activation}"
                )
            if table_fk.fk_activation != "WITH_TABLE" and not all(
                field_by_name[name].nullable for name in table_fk.columns
            ):
                errors.append(
                    f"{table.name}: deferred composite FK columns must all be nullable: {table_fk.columns}"
                )
            source_tier = tier_for_table(table.name)
            target_tier = tier_for_table(table_fk.ref_table)
            crosses_unavailable_tier = (
                (source_tier in {"CORE_BUSINESS", "CORE_PLATFORM", "SOURCE_CONDITIONAL"} and target_tier.startswith("EXTENSION_PACK:"))
                or (
                    source_tier.startswith("EXTENSION_PACK:")
                    and target_tier.startswith("EXTENSION_PACK:")
                    and source_tier != target_tier
                )
            )
            if crosses_unavailable_tier and table_fk.fk_activation == "WITH_TABLE":
                errors.append(
                    f"{table.name}: cross-tier composite FK to {table_fk.ref_table} "
                    "must declare deferred activation"
                )
            if table_fk.fk_activation != "WITH_TABLE":
                declared_packs = set(table_fk.fk_activation.removeprefix("EXTENSION_PACK:").split("+"))
                required_packs = {
                    tier.split(":", 1)[1]
                    for tier in (source_tier, target_tier)
                    if tier.startswith("EXTENSION_PACK:")
                }
                if not required_packs <= declared_packs:
                    errors.append(
                        f"{table.name}: composite FK activation {table_fk.fk_activation} "
                        f"misses {sorted(required_packs-declared_packs)}"
                    )
        for unique in table.uniques:
            missing = sorted(set(unique) - set(field_names))
            if missing:
                errors.append(f"{table.name}: unique references missing fields {missing}")
        for unique in table.nulls_not_distinct_uniques:
            if unique not in table.uniques:
                errors.append(f"{table.name}: NULLS NOT DISTINCT unique is not declared in uniques: {unique}")
            elif not any(next(item for item in table.fields if item.name == name).nullable for name in unique):
                errors.append(f"{table.name}: NULLS NOT DISTINCT unique has no nullable field: {unique}")
        for unique in table.nulls_distinct_uniques:
            if unique not in table.uniques:
                errors.append(f"{table.name}: NULLS DISTINCT unique is not declared in uniques: {unique}")
            elif not any(next(item for item in table.fields if item.name == name).nullable for name in unique):
                errors.append(f"{table.name}: NULLS DISTINCT unique has no nullable field: {unique}")
        for unique in table.uniques:
            if not any(next(item for item in table.fields if item.name == name).nullable for name in unique):
                continue
            classifications = sum(
                unique in collection
                for collection in (table.nulls_not_distinct_uniques, table.nulls_distinct_uniques)
            )
            if classifications != 1:
                errors.append(
                    f"{table.name}: nullable unique must declare exactly one NULL policy: {unique}"
                )
        for exclusion in table.exclusions:
            if not exclusion.strip():
                errors.append(f"{table.name}: empty exclusion constraint")
            elif not exclusion.startswith("NO_OVERLAP("):
                errors.append(f"{table.name}: unsupported exclusion declaration: {exclusion}")

        # A monetary fact without a stable currency is not a complete fact.
        # PO lines deliberately inherit the single currency frozen on their
        # referenced revision; every other table carrying money stores it.
        money_tokens = ("amount", "sales", "revenue", "price", "cost", "balance", "salary", "wage")
        monetary_fields = [
            field.name for field in table.fields
            if field.data_type.startswith("numeric")
            and any(token in field.name for token in money_tokens)
            and not any(unit in field.name for unit in ("_myr", "_usd", "_rate", "quantity"))
        ]
        currency_fields = {field.name for field in table.fields} & {"currency", "default_currency", "manager_currency"}
        if monetary_fields and not currency_fields and table.name != "scm_purchase_order_line":
            errors.append(f"{table.name}: monetary fields lack an explicit currency: {monetary_fields}")

    for view in VIEWS:
        if view.domain not in DOMAIN_ORDER:
            errors.append(f"{view.name}: unknown domain {view.domain}")
        if view.readiness_status not in VIEW_READINESS_STATUSES:
            errors.append(f"{view.name}: unknown readiness status {view.readiness_status}")
        if view.readiness_status == "PASS_SELECT_SPEC":
            if view.readiness_blockers:
                errors.append(f"{view.name}: PASS_SELECT_SPEC must have no blockers")
        elif not view.readiness_blockers:
            errors.append(f"{view.name}: non-PASS readiness must name stable blockers")
        for blocker in view.readiness_blockers:
            if not blocker or blocker != blocker.upper() or " " in blocker:
                errors.append(f"{view.name}: invalid readiness blocker code {blocker!r}")
        field_names = [item.name for item in view.fields]
        duplicate_fields = sorted(name for name, count in Counter(field_names).items() if count > 1)
        if duplicate_fields:
            errors.append(f"{view.name}: duplicate view fields {duplicate_fields}")
        for field in view.fields:
            if not all((field.zh_name, field.data_type, field.description, field.purpose, field.example)):
                errors.append(f"{view.name}.{field.name}: incomplete view field metadata")
            if field.example.strip() in {"...", "—", "-"}:
                errors.append(f"{view.name}.{field.name}: placeholder example is not an explicit field example")
        missing_lineage = sorted(set(view.lineage) - set(TABLE_BY_NAME) - set(VIEW_BY_NAME))
        if missing_lineage:
            errors.append(f"{view.name}: missing lineage objects {missing_lineage}")
        if view.grain_key is None:
            if view.name != "v_identity_mapping_gap":
                errors.append(f"{view.name}: only v_identity_mapping_gap may lack a grain_key")
        else:
            missing_grain_fields = sorted(set(view.grain_key) - set(field_names))
            if missing_grain_fields:
                errors.append(f"{view.name}: grain_key references missing fields {missing_grain_fields}")
            nullable_grain_fields = [
                name
                for name in view.grain_key
                if next(field for field in view.fields if field.name == name).nullable
            ]
            if nullable_grain_fields and "NULLS NOT DISTINCT" not in view.notes:
                errors.append(
                    f"{view.name}: nullable grain keys require explicit NULLS NOT DISTINCT semantics: "
                    f"{nullable_grain_fields}"
                )

    if set(VIEW_GRAIN_KEYS) != set(VIEW_BY_NAME):
        errors.append(
            "view grain-key registry coverage mismatch: "
            f"missing={sorted(set(VIEW_BY_NAME)-set(VIEW_GRAIN_KEYS))}, "
            f"unknown={sorted(set(VIEW_GRAIN_KEYS)-set(VIEW_BY_NAME))}"
        )
    if set(VIEW_READINESS_CONTRACTS) != set(VIEW_BY_NAME):
        errors.append(
            "view readiness registry coverage mismatch: "
            f"missing={sorted(set(VIEW_BY_NAME)-set(VIEW_READINESS_CONTRACTS))}, "
            f"unknown={sorted(set(VIEW_READINESS_CONTRACTS)-set(VIEW_BY_NAME))}"
        )
    actual_readiness_counts = Counter(view.readiness_status for view in VIEWS)
    if actual_readiness_counts != Counter(VIEW_READINESS_GOLDEN_COUNTS):
        errors.append(
            f"view readiness count mismatch: {dict(actual_readiness_counts)} "
            f"!= {VIEW_READINESS_GOLDEN_COUNTS}"
        )
    identity_gap = VIEW_BY_NAME.get("v_identity_mapping_gap")
    if identity_gap is not None and not (
        identity_gap.grain_key is None
        and identity_gap.readiness_status == "BLOCK_MISSING_FACT_OR_RULE"
        and "UNDEFINED_GRAIN_KEY" in identity_gap.readiness_blockers
    ):
        errors.append("v_identity_mapping_gap must be the single blocked undefined-grain view")
    for name in PHASE1_VIEWS:
        if VIEW_BY_NAME[name].readiness_status in {"DEFER_EXTENSION", "DEFER_SOURCE"}:
            errors.append(f"{name}: PHASE1 view cannot use deferred readiness")
    for name in EXTENSION_VIEWS:
        if VIEW_BY_NAME[name].readiness_status != "DEFER_EXTENSION":
            errors.append(f"{name}: extension view must be DEFER_EXTENSION")
    for name in SOURCE_CONDITIONAL_VIEWS:
        if VIEW_BY_NAME[name].readiness_status != "DEFER_SOURCE":
            errors.append(f"{name}: source-conditional view must be DEFER_SOURCE")

    # Explicit first-principles gates that should never drift silently.
    required_identity_tables = {
        "app_unit", "ops_location", "ops_product", "hr_person", "hr_employment", "scm_material",
        "ops_location_source_identity", "pos_product_listing", "pos_product_mapping",
        "hr_employment_source_identity", "hr_employment_mapping_review",
        "scm_material_source_identity", "scm_material_unit_conversion",
        "scm_supplier_item",
    }
    missing_identities = sorted(required_identity_tables - set(TABLE_BY_NAME))
    if missing_identities:
        errors.append(f"missing identity spine tables: {missing_identities}")

    required_lineage_tables = {
        "pos_ingest_batch", "ops_forecast_run", "ops_production_plan_version",
        "ops_workload_run", "scm_material_requirement_component", "scm_replenishment_run",
        "finance_import_batch", "app_job_run",
    }
    missing_lineage = sorted(required_lineage_tables - set(TABLE_BY_NAME))
    if missing_lineage:
        errors.append(f"missing lineage/version tables: {missing_lineage}")

    required_lossless_fields = {
        "ops_daily_review": {"manager_revenue", "manager_transaction_count", "manager_avg_transaction", "manager_avg_transaction_source", "manager_revenue_at"},
        "mkt_survey_result": {"survey_response_id", "result_code", "algorithm_version", "input_sha256", "source_system_id", "source_result_id"},
        "msg_outbound_message": {"job_run_id", "review_action_id", "ai_call_id", "appointment_id", "campaign_member_id", "push_kind", "business_date", "template_code", "template_version", "payload"},
        "finance_import_batch": {"source_layer", "recognition_status", "supersedes_finance_import_batch_id"},
        "finance_sales_daily": {"gross_sales", "discount_amount", "net_sales", "order_count", "quality_status"},
        "pos_item_waste": {"source_waste_id", "source_row_fingerprint", "source_name_snapshot", "source_waste_amount", "currency"},
        "pos_sales_day": {"gross_sales", "discount_amount", "refund_amount", "net_sales", "order_count", "source_average_order_value", "source_guest_count", "quality_status"},
        "pos_sales_hour": {"discount_amount", "source_guest_count"},
        "pos_product_listing": {"source_system_id", "source_item_key", "source_cost_card_id", "source_cost_spec_id", "source_has_cost_card", "source_total_cost", "source_theoretical_cost"},
        "ops_location_source_identity": {"source_system_id", "source_container_id", "source_location_id", "valid_from", "valid_to", "mapping_status"},
        "ops_business_rule": {"scope_location_id", "scope_product_id", "rule_code", "rule_value", "schema_version", "version_no", "valid_from", "valid_to", "status"},
        "hr_employee_event": {"event_type", "event_schema_version", "event_data"},
        "scm_supplier_price_observation": {"source_record_id", "goods_receipt_line_id", "purchase_order_line_id"},
        "pos_order": {"source_system_id", "location_id", "source_order_id", "first_seen_pos_ingest_batch_id"},
        "pos_order_item": {"pos_ingest_batch_id", "order_id", "listing_id", "business_date", "source_row_count", "quantity", "net_sales", "member_consumption_flag"},
        "pos_ingest_batch": {"dataset_code", "coverage_scope", "parser_version", "supersedes_pos_ingest_batch_id", "idempotency_key"},
        "pos_member_card_transaction": {"source_system_id", "source_member_id", "source_card_id", "source_transaction_type_code", "source_transaction_type_label", "transaction_type", "trade_amount", "order_id", "source_pos_order_no", "source_order_id", "source_code", "before_money_balance", "after_money_balance", "before_gift_balance", "after_gift_balance", "point_delta"},
        "pos_member_card": {"member_id", "source_system_id", "source_card_id"},
        "pos_member_balance_snapshot": {"member_id", "snapshot_date", "profile_present", "level_name", "growth", "point_balance", "lifetime_topup_amount", "lifetime_topup_count", "lifetime_consume_amount", "lifetime_consume_count", "first_card_created_on", "last_recharge_at", "last_transaction_at", "cash_balance", "gift_balance", "frozen_balance", "total_balance", "currency"},
        "pos_member_daily_metric": {"new_member_count", "consumed_member_count", "recharged_member_count", "points_member_count", "member_sales", "total_consume_amount", "topup_cash", "topup_gift", "topup_face_value", "topup_count", "topup_refund", "redeem_amount", "redeem_cash", "redeem_gift", "redeem_count", "consume_refund", "adjust_net", "topup_adjust_amount", "adjust_correction", "stored_value_cash_net", "balance_end_total", "balance_end_cash", "balance_end_gift"},
        "pos_payment": {"source_system_id", "source_payment_id", "first_seen_pos_ingest_batch_id"},
        "pos_refund": {"source_system_id", "source_refund_id", "first_seen_pos_ingest_batch_id"},
        "ops_calendar_event": {"job_run_id", "jurisdiction_code", "event_date", "status"},
        "ops_production_plan_version": {"location_id", "plan_business_date", "version_no", "based_on_version_id", "status"},
        "ops_production_plan_line": {"based_on_plan_line_id", "adjustment_reason_code", "suggested_by_ai_call_id", "confirmed_by_user_id"},
        "ops_shift_plan_version": {"location_id", "business_date", "version_no", "based_on_version_id", "status"},
        "scm_inventory_movement": {"goods_receipt_id", "production_run_id", "inventory_count_id", "manual_reason_code"},
        "scm_supplier_item": {"supplier_id", "supplier_sku", "material_id", "material_unit_conversion_id", "valid_from", "valid_to", "mapping_status"},
        "scm_material_requirement_component": {"material_requirement_run_id", "production_plan_line_id", "component_index", "material_id", "quality_status"},
        "scm_purchase_order_revision": {"purchase_order_code", "supplier_id", "deliver_to_location_id", "revision_no", "currency", "status"},
        "scm_goods_receipt": {"purchase_order_revision_id", "location_id", "received_at", "status"},
        "hr_application_stage_event": {"application_id", "event_key", "to_stage", "occurred_at"},
        "hr_appointment": {"actual_start", "actual_end", "trial_outcome", "safety_incident"},
        "ai_prompt_segment": {"segment_code", "version_no", "content", "content_sha256", "variable_schema"},
        "ai_prompt_template": {"template_code", "version_no", "model_provider", "model_name", "output_schema", "safety_policy_version"},
        "cost_card_recipe_version": {"recipe_code", "recipe_name", "version_no", "output_product_id", "output_material_id"},
        "mkt_campaign_version": {"campaign_code", "campaign_name", "campaign_type", "version_no", "status"},
        "mkt_survey_answer": {"survey_response_id", "survey_question_id", "value_index", "selected_option_id"},
        "mkt_survey_response": {"campaign_member_id", "source_system_id", "source_response_id", "attempt_no"},
        "mkt_reward_stock": {"campaign_version_id", "reward_id", "unit_cost_estimate", "currency"},
        "mkt_reward_claim": {"campaign_member_id", "reward_stock_id", "reward_id", "idempotency_key", "source_system_id", "source_fulfillment_id"},
        "hr_timesheet_sync_batch": {"source_system_id", "source_batch_id", "payload_sha256", "idempotency_key", "parser_version"},
    }
    for table_name, required_fields in required_lossless_fields.items():
        actual = {field.name for field in TABLE_BY_NAME[table_name].fields}
        missing = sorted(required_fields - actual)
        if missing:
            errors.append(f"{table_name}: missing lossless/governance fields {missing}")

    exact_p0b_table_checks = {
        "app_source_system": "source_system_id <> '00000000-0000-0000-0000-000000000000'",
        "ops_location": "location_id <> '00000000-0000-0000-0000-000000000000'",
        "ops_product": "product_id <> '00000000-0000-0000-0000-000000000000'",
        "ops_location_source_identity": "source_container_id IS NULL OR source_container_id <> ''",
        "ops_product_alias": "public.app_normalize_alias_v1(alias_text) <> ''",
        "scm_material_alias": "public.app_normalize_alias_v1(alias_text) <> ''",
        "finance_period_category_map": "source_sub IS NULL OR source_sub <> '__HOTCRUSH_ALL__'",
        "pos_ingest_batch": "(dataset_code = 'ORDER_ITEM') = (coverage_scope IS NOT NULL)",
        "cost_card_recipe_version": "effective_from IS NOT NULL OR (status = 'DRAFT' AND effective_to IS NULL)",
        "mkt_campaign_version": "starts_at IS NOT NULL OR (status = 'ARCHIVED' AND ends_at IS NULL)",
        "mkt_survey_response": "started_at IS NOT NULL OR (submitted_at IS NOT NULL AND status IN ('SUBMITTED','VALIDATED','REJECTED'))",
        "mkt_survey_result": "input_sha256 IS NOT NULL OR quality_status = 'INCOMPLETE_INPUT'",
        "mkt_reward_stock": "(unit_cost_estimate IS NULL) = (currency IS NULL)",
    }
    for table_name, check in exact_p0b_table_checks.items():
        if check not in TABLE_BY_NAME[table_name].checks:
            errors.append(f"{table_name}: missing exact P0b table check {check}")

    reward_claim = TABLE_BY_NAME["mkt_reward_claim"]
    required_reward_claim_checks = {
        "expires_at IS NULL OR (reserved_at IS NOT NULL AND expires_at > reserved_at)",
        "(source_system_id IS NULL) = (source_fulfillment_id IS NULL)",
        "reward_stock_id IS NOT NULL OR (source_system_id IS NOT NULL AND source_fulfillment_id IS NOT NULL)",
        "status <> 'REDEEMED' OR redeemed_at IS NOT NULL",
    }
    if set(reward_claim.checks) != required_reward_claim_checks:
        errors.append(
            "mkt_reward_claim: exact P0c table checks mismatch "
            f"{reward_claim.checks} != {sorted(required_reward_claim_checks)}"
        )
    reward_claim_fields = {field.name: field for field in reward_claim.fields}
    if reward_claim_fields["source_fulfillment_id"].checks != (
        "source_fulfillment_id IS NULL OR btrim(source_fulfillment_id) <> ''",
    ):
        errors.append("mkt_reward_claim.source_fulfillment_id: missing exact nonblank field check")
    expected_reward_claim_table_fk = (
        (("reward_stock_id", "reward_id"), "mkt_reward_stock", ("reward_stock_id", "reward_id"), "WITH_TABLE", "SIMPLE"),
    )
    actual_reward_claim_table_fk = tuple(
        (fk.columns, fk.ref_table, fk.ref_columns, fk.fk_activation, fk.match_type)
        for fk in reward_claim.foreign_keys
    )
    if actual_reward_claim_table_fk != expected_reward_claim_table_fk:
        errors.append(
            "mkt_reward_claim: exact P0c composite FK mismatch "
            f"{actual_reward_claim_table_fk} != {expected_reward_claim_table_fk}"
        )

    required_nullable_fields = {
        "cost_card_recipe_version": {"effective_from"},
        "mkt_campaign_version": {"starts_at"},
        "mkt_survey_response": {"started_at", "attempt_no"},
        "mkt_survey_result": {"input_sha256"},
        "mkt_reward_stock": {"currency"},
        "mkt_reward_claim": {"reward_stock_id", "reserved_at"},
    }
    for table_name, field_names in required_nullable_fields.items():
        fields = {field.name: field for field in TABLE_BY_NAME[table_name].fields}
        for field_name in field_names:
            if not fields[field_name].nullable or fields[field_name].default is not None:
                errors.append(f"{table_name}.{field_name}: must be nullable with no default")

    ingest_fields = [field.name for field in TABLE_BY_NAME["pos_ingest_batch"].fields]
    if ingest_fields[ingest_fields.index("dataset_code") + 1] != "coverage_scope":
        errors.append("pos_ingest_batch.coverage_scope must immediately follow dataset_code")

    exact_view_lineage = {
        "v_cost_card_product_cost_quality": ("v_cost_card_product_cost_snapshot",),
        "v_ops_manager_sales_reconciliation": ("v_ops_daily_review_current", "v_pos_sales_day_current"),
    }
    for view_name, lineage in exact_view_lineage.items():
        if VIEW_BY_NAME[view_name].lineage != lineage:
            errors.append(f"{view_name}: lineage mismatch {VIEW_BY_NAME[view_name].lineage} != {lineage}")

    forecast_fields = [field.name for field in VIEW_BY_NAME["v_ops_forecast_accuracy"].fields]
    if forecast_fields[forecast_fields.index("business_date") + 1] != "forecast_run_id":
        errors.append("v_ops_forecast_accuracy.forecast_run_id must follow business_date")

    required_unique_contracts = {
        "ops_location_source_identity": {("source_system_id", "source_container_id", "source_location_id", "valid_from")},
        "ops_business_rule": {("scope_location_id", "scope_product_id", "rule_code", "version_no")},
        "pos_member_card": {("source_system_id", "source_card_id")},
        "hr_timesheet_sync_batch": {("idempotency_key",), ("source_system_id", "source_batch_id")},
        "mkt_survey_result": {("source_system_id", "source_result_id")},
        "mkt_reward_stock": {("reward_stock_id", "reward_id")},
        "mkt_reward_claim": {("idempotency_key",), ("source_system_id", "source_fulfillment_id")},
        "mkt_survey_response": {("campaign_member_id", "attempt_no"), ("source_system_id", "source_response_id")},
        "msg_conversation": {("channel_code", "external_conversation_id")},
        "msg_message": {("conversation_id", "external_message_id"), ("outbound_message_id",)},
    }
    for table_name, required_uniques in required_unique_contracts.items():
        missing = sorted(required_uniques - set(TABLE_BY_NAME[table_name].uniques))
        if missing:
            errors.append(f"{table_name}: missing idempotency/identity unique contracts {missing}")

    if "pos_stockout_event" in TABLE_BY_NAME or "ops_stockout_event" not in TABLE_BY_NAME:
        errors.append("stockout event must be owned by BakeryOps as ops_stockout_event")

    if {"subject_type", "subject_id"} & {field.name for field in TABLE_BY_NAME["app_one_time_token"].fields}:
        errors.append("app_one_time_token must use explicit subject FKs, not polymorphic subject_type/subject_id")

    required_derived_views = {
        "v_pos_sales_hour_current", "v_pos_item_sales_hour_current", "v_pos_daily_breakdown_current",
        "v_pos_item_waste_current", "v_pos_member_daily_metric_current", "v_pos_member_state_current",
        "v_pos_order_item_current", "v_pos_order_member_attribution", "v_pos_member_order_item",
        "v_hr_application_current_stage", "v_hr_assessment_summary", "v_hr_timesheet_entry_current",
        "v_scm_material_requirement_reconciliation", "v_mkt_reward_stock_reconciliation",
        "v_scm_material_requirement_line",
        "v_scm_purchase_order_reconciliation", "v_scm_supplier_item_current_mapping",
        "v_finance_target_current", "v_cost_card_product_cost_snapshot",
        "v_cost_card_product_cost_component",
    }
    missing_derived_views = sorted(required_derived_views - set(VIEW_BY_NAME))
    if missing_derived_views:
        errors.append(f"missing minimum-grain POS derived views: {missing_derived_views}")

    # Every business table must participate in the stable-FK graph. Two
    # deliberate exceptions are technical/privacy boundaries, not forgotten
    # business joins: the migration ledger and irreversible rate-limit buckets.
    adjacency = defaultdict(set)
    for table in TABLES:
        for field in table.fields:
            if not field.fk:
                continue
            target_name = field.fk.split(".", 1)[0]
            adjacency[table.name].add(target_name)
            adjacency[target_name].add(table.name)
        for table_fk in table.foreign_keys:
            adjacency[table.name].add(table_fk.ref_table)
            adjacency[table_fk.ref_table].add(table.name)
    connected = {"app_source_system"}
    stack = ["app_source_system"]
    while stack:
        node = stack.pop()
        for neighbor in adjacency[node] - connected:
            connected.add(neighbor)
            stack.append(neighbor)
    isolated_exceptions = {"app_schema_migration", "app_rate_limit_event"}
    disconnected_business_tables = sorted(set(TABLE_BY_NAME) - connected - isolated_exceptions)
    if disconnected_business_tables:
        errors.append(f"tables disconnected from stable FK graph: {disconnected_business_tables}")
    accidentally_connected_exceptions = sorted(isolated_exceptions & connected)
    if accidentally_connected_exceptions:
        errors.append(f"documented isolated exceptions unexpectedly connected: {accidentally_connected_exceptions}")

    required_non_overlap_tables = {
        "app_user_role", "app_user_location_scope", "ops_location_source_identity",
        "ops_product_alias", "hr_person_contact", "hr_employment_source_identity",
        "scm_material_alias", "scm_material_source_identity", "pos_product_mapping",
        "pos_member_contact", "ops_business_rule", "hr_training_course_version",
        "ops_role_training_requirement", "scm_material_unit_conversion",
        "ops_stockout_event", "cost_card_recipe_version", "cost_card_material_price", "finance_period_category_map",
        "scm_supplier_item", "mkt_campaign_version",
    }
    missing_non_overlap = sorted(name for name in required_non_overlap_tables if not TABLE_BY_NAME[name].exclusions)
    if missing_non_overlap:
        errors.append(f"effective-period tables missing no-overlap constraints: {missing_non_overlap}")

    normalized_unit_fields = {
        "ops_product": "base_unit_id",
        "scm_material": "base_unit_id",
        "ops_production_plan_line": "unit_id",
        "ops_production_run_line": "unit_id",
        "ops_dispatch_line": "unit_id",
        "scm_supplier_item": "order_unit_id",
        "scm_purchase_order_line": "order_unit_id",
        "cost_card_recipe_version": "yield_unit_id",
        "cost_card_recipe_component": "input_unit_id",
    }
    for table_name, field_name in normalized_unit_fields.items():
        field = next((item for item in TABLE_BY_NAME[table_name].fields if item.name == field_name), None)
        if field is None or field.fk != "app_unit.unit_id":
            errors.append(f"{table_name}.{field_name}: must reference app_unit.unit_id")

    forbidden_physical_fields = {
        "ops_product": {"planning_reference_price", "currency", "display_full_quantity", "positioning_code", "target_sales_mix_ratio", "target_transaction_count", "audience_code", "stockout_target_time", "display_sort_order", "fixed_shipment_times", "average_sales", "actual_sales_ratio", "sales_rank"},
        "pos_sales_day": {"average_order_value"},
        "pos_sales_hour": {"unassigned_order_count"},
        "pos_member_balance_snapshot": {"is_partial", "missing_sources"},
        "pos_member_daily_metric": {"member_sales_ratio", "card_payment_ratio", "card_payment_net", "stored_value_face_net", "topup_total", "is_partial", "missing_sources"},
        "pos_member": {"has_card", "has_profile", "last_snapshot_date", "level_name", "growth", "point_balance", "lifetime_topup_amount", "lifetime_topup_count", "lifetime_consume_amount", "lifetime_consume_count", "currency"},
        "ops_product_alias": {"normalized_alias"},
        "scm_material_alias": {"normalized_alias"},
        "scm_supplier_item": {"base_unit_quantity"},
        "scm_supplier_price_observation": {"normalized_price_myr"},
        "cost_card_recipe_component": {"base_unit_quantity"},
        "scm_purchase_order_line": {"base_unit_quantity", "currency"},
        "scm_replenishment_line": {"delta_quantity"},
        "hr_application": {"stage", "status_reason", "employment_id"},
        "hr_assessment": {"total_score"},
        "scm_inventory_movement": {"source_object_type", "source_object_id"},
        "scm_material_requirement_component": {"planned_product_quantity"},
        "mkt_survey_answer": {"selected_option_ids"},
        "mkt_reward": {"unit_cost_estimate"},
        "msg_conversation": {"last_message_at"},
        "msg_outbound_message": {"attempt_count", "last_error_code", "extension_source_type", "extension_source_id"},
        "ai_prompt_template_segment": {"content", "content_sha256", "variable_schema"},
    }
    for table_name, forbidden_fields in forbidden_physical_fields.items():
        actual = {field.name for field in TABLE_BY_NAME[table_name].fields}
        present = sorted(forbidden_fields & actual)
        if present:
            errors.append(f"{table_name}: derivable or unsafe fields must not be physical: {present}")

    forbidden_r5_tables = set(MERGED_R5_TABLES) | set(DERIVED_R5_TABLES) | set(REMOVED_R5_TABLES)
    still_physical = sorted(forbidden_r5_tables & set(TABLE_BY_NAME))
    if still_physical:
        errors.append(f"R6 merged/derived/removed objects still physical: {still_physical}")

    try:
        foundation_summary = validate_minimal_foundation(set(TABLE_BY_NAME))
    except AssertionError as exc:
        errors.append(str(exc))

    phase1_table_names = CORE_BUSINESS_TABLES | CORE_PLATFORM_TABLES
    phase1_tables = [table for table in TABLES if table.name in phase1_table_names]
    actual_golden = {
        "table_count": len(TABLES),
        "view_count": len(VIEWS),
        "table_field_count": sum(len(table.fields) for table in TABLES),
        "view_field_count": sum(len(view.fields) for view in VIEWS),
        "total_field_count": sum(len(table.fields) for table in TABLES) + sum(len(view.fields) for view in VIEWS),
        "foreign_key_count": sum(
            sum(field.fk is not None for field in table.fields) + len(table.foreign_keys)
            for table in TABLES
        ),
        "table_check_count": sum(len(table.checks) for table in TABLES),
        "field_check_count": sum(len(field.checks) for table in TABLES for field in table.fields),
        "check_count": sum(len(table.checks) + sum(len(field.checks) for field in table.fields) for table in TABLES),
        "unique_count": sum(len(table.uniques) for table in TABLES),
        "ordinary_unique_count": sum(
            unique not in table.nulls_not_distinct_uniques and unique not in table.nulls_distinct_uniques
            for table in TABLES for unique in table.uniques
        ),
        "nulls_not_distinct_unique_count": sum(len(table.nulls_not_distinct_uniques) for table in TABLES),
        "nulls_distinct_unique_count": sum(len(table.nulls_distinct_uniques) for table in TABLES),
        "exclusion_count": sum(len(table.exclusions) for table in TABLES),
        "phase1_table_count": len(phase1_tables),
        "phase1_view_count": len(PHASE1_VIEWS),
        "phase1_table_field_count": sum(len(table.fields) for table in phase1_tables),
        "phase1_view_field_count": sum(len(VIEW_BY_NAME[name].fields) for name in PHASE1_VIEWS),
        "phase1_total_field_count": sum(len(table.fields) for table in phase1_tables) + sum(len(VIEW_BY_NAME[name].fields) for name in PHASE1_VIEWS),
        "phase1_foreign_key_declaration_count": sum(
            sum(field.fk is not None for field in table.fields) + len(table.foreign_keys)
            for table in phase1_tables
        ),
        "phase1_active_foreign_key_count": sum(
            sum(field.fk is not None and field.fk_activation == "WITH_TABLE" for field in table.fields)
            + sum(fk.fk_activation == "WITH_TABLE" for fk in table.foreign_keys)
            for table in phase1_tables
        ),
        "phase1_table_check_count": sum(len(table.checks) for table in phase1_tables),
        "phase1_field_check_count": sum(len(field.checks) for table in phase1_tables for field in table.fields),
        "phase1_check_count": sum(len(table.checks) + sum(len(field.checks) for field in table.fields) for table in phase1_tables),
        "phase1_unique_count": sum(len(table.uniques) for table in phase1_tables),
        "phase1_ordinary_unique_count": sum(
            unique not in table.nulls_not_distinct_uniques and unique not in table.nulls_distinct_uniques
            for table in phase1_tables for unique in table.uniques
        ),
        "phase1_nulls_not_distinct_unique_count": sum(
            len(table.nulls_not_distinct_uniques) for table in phase1_tables
        ),
        "phase1_nulls_distinct_unique_count": sum(
            len(table.nulls_distinct_uniques) for table in phase1_tables
        ),
        "phase1_exclusion_count": sum(len(table.exclusions) for table in phase1_tables),
        "phase1_supporting_fk_index_count": sum(
            len(required_fk_index_columns(table)) for table in phase1_tables
        ),
    }
    expected_golden = {
        "table_count": 137,
        "view_count": 59,
        "table_field_count": 1812,
        "view_field_count": 643,
        "total_field_count": 2455,
        "foreign_key_count": 420,
        "table_check_count": 115,
        "field_check_count": 318,
        "check_count": 433,
        "unique_count": 134,
        "ordinary_unique_count": 102,
        "nulls_not_distinct_unique_count": 15,
        "nulls_distinct_unique_count": 17,
        "exclusion_count": 22,
        "phase1_table_count": 100,
        "phase1_view_count": 41,
        "phase1_table_field_count": 1374,
        "phase1_view_field_count": 471,
        "phase1_total_field_count": 1845,
        "phase1_foreign_key_declaration_count": 291,
        "phase1_active_foreign_key_count": 289,
        "phase1_table_check_count": 90,
        "phase1_field_check_count": 242,
        "phase1_check_count": 332,
        "phase1_unique_count": 102,
        "phase1_ordinary_unique_count": 78,
        "phase1_nulls_not_distinct_unique_count": 9,
        "phase1_nulls_distinct_unique_count": 15,
        "phase1_exclusion_count": 19,
        "phase1_supporting_fk_index_count": 224,
    }
    for key, expected in expected_golden.items():
        if actual_golden[key] != expected:
            errors.append(f"P0c golden count mismatch {key}: {actual_golden[key]} != {expected}")

    if errors:
        raise AssertionError("\n".join(errors))

    return {
        "table_count": len(TABLES),
        "view_count": len(VIEWS),
        "phase1_view_count": len(PHASE1_VIEWS),
        "extension_view_count": len(EXTENSION_VIEWS),
        "source_conditional_view_count": len(SOURCE_CONDITIONAL_VIEWS),
        "table_field_count": sum(len(table.fields) for table in TABLES),
        "view_field_count": sum(len(view.fields) for view in VIEWS),
        "foreign_key_count": sum(
            sum(field.fk is not None for field in table.fields) + len(table.foreign_keys)
            for table in TABLES
        ),
        **actual_golden,
        **{f"readiness_{key.lower()}_count": value for key, value in VIEW_READINESS_GOLDEN_COUNTS.items()},
        "core_migration_table_count": sum(table.lifecycle == "CORE_MIGRATION" for table in TABLES),
        "planned_module_table_count": sum(table.lifecycle == "PLANNED_MODULE" for table in TABLES),
        "source_conditional_table_count": sum(table.lifecycle == "SOURCE_CONDITIONAL" for table in TABLES),
        "conditional_table_count": sum(table.lifecycle != "CORE_MIGRATION" for table in TABLES),
        "warning_count": len(warnings),
        **vocabulary_summary,
        **foundation_summary,
        **source_fidelity_summary,
    }


if __name__ == "__main__":
    print(validate_model())
