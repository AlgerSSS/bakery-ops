"""Parse legacy finance exports into the payloads the R6 finance RPCs accept.

The legacy finance schema is six near-identical monthly tables plus a daily revenue table
and four cost-card tables. This module does the mapping and the validation; it deliberately
does not do any arithmetic correction. If production holds a wrong ``normalized_price_myr``
or a duplicated dimension tuple, that survives into R6 unchanged so the discrepancy stays
visible and attributable instead of being quietly repaired during migration.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Legacy store label -> (R6 store id, scope).
#
# finance_targets carries both a 全部 group target and a per-store target with the same amount.
# Mapping both onto one store id would double every target, so 全部 becomes an explicit GROUP
# row instead. An unrecognised label is an error: a second outlet must be mapped deliberately,
# not silently absorbed into HC001.
DEFAULT_STORE_MAP: dict[str, tuple[str, str]] = {
    "吉隆坡Pavilion门店": ("HC001", "STORE"),
    "全部": ("ALL", "GROUP"),
}

# Legacy table -> R6 domain, and which legacy columns carry each dimension.
MONTHLY_SOURCES: dict[str, dict[str, Any]] = {
    "finance_pl_metrics": {"domain": "PL_METRIC", "dimensions": {"item": "metric"}},
    "finance_expense": {
        "domain": "EXPENSE",
        "dimensions": {"major": "major", "sub": "sub", "source": "source"},
        "row_id": "id",
    },
    "finance_labor_detail": {
        "domain": "LABOR",
        "dimensions": {"item": "item", "category": "category", "org": "org"},
    },
    "finance_material": {
        "domain": "MATERIAL",
        "dimensions": {"category": "category", "source": "source"},
        "row_id": "id",
    },
    "finance_targets": {"domain": "TARGET", "dimensions": {"item": "item"}},
    "finance_cashflow": {"domain": "CASHFLOW", "dimensions": {"item": "item"}},
}


class FinanceDataValidationError(ValueError):
    """Raised when a legacy finance export cannot be trusted as-is."""


@dataclass(frozen=True)
class FinanceMonthlyProjection:
    store_id: str
    month_rows: list[dict[str, Any]]
    revenue_rows: list[dict[str, Any]]


@dataclass(frozen=True)
class FinanceCostCardProjection:
    items: list[dict[str, Any]]
    prices: list[dict[str, Any]]
    recipes: list[dict[str, Any]]
    recipe_items: list[dict[str, Any]]


def _decode(name: str, content: bytes) -> Any:
    try:
        return json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise FinanceDataValidationError(f"{name} is not valid UTF-8 JSON: {error}") from error


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _money(value: Any, field: str) -> str:
    if value is None or _text(value) == "":
        raise FinanceDataValidationError(f"{field} is required")
    try:
        return str(Decimal(_text(value)).quantize(Decimal("0.01")))
    except (InvalidOperation, ArithmeticError) as error:
        raise FinanceDataValidationError(f"{field} is not a decimal amount: {value!r}") from error


def _optional_number(value: Any) -> str:
    text = _text(value)
    if text == "":
        return ""
    try:
        Decimal(text)
    except (InvalidOperation, ArithmeticError) as error:
        raise FinanceDataValidationError(f"expected a number, got {value!r}") from error
    return text


def _optional_int(value: Any) -> str:
    text = _text(value)
    if text == "":
        return ""
    if not re.fullmatch(r"-?\d+", text):
        raise FinanceDataValidationError(f"expected an integer, got {value!r}")
    return text


def _required_int(value: Any, field: str) -> str:
    text = _optional_int(value)
    if text == "":
        raise FinanceDataValidationError(f"{field} is required")
    return text


def _month(value: Any, table: str) -> str:
    text = _text(value)
    if not MONTH_RE.fullmatch(text):
        raise FinanceDataValidationError(f"{table}.month must be YYYY-MM, got {value!r}")
    return text


def _resolve_store(
    value: Any, *, default_store_id: str, store_map: dict[str, tuple[str, str]]
) -> tuple[str, str, str]:
    """Return (store_id, store_scope, source_label) for one legacy store label."""
    label = _text(value)
    if label == "":
        return default_store_id, "STORE", ""
    mapped = store_map.get(label)
    if mapped is None:
        raise FinanceDataValidationError(
            f"unmapped finance store {label!r}; add it to the store map before migrating"
        )
    return mapped[0], mapped[1], label


def _row_key(config: dict[str, Any], row: dict[str, Any], month: str, store_label: str) -> str:
    """Stable identity for one legacy row.

    Where the legacy table has an ``id`` that id is authoritative, because those tables do
    contain distinct entries that share every dimension - production really holds two separate
    2026-03 物料费/日常物料/银行账户采买 expenses. Collapsing them on the dimension tuple would
    silently drop money.
    """
    id_column = config.get("row_id")
    if id_column:
        raw_id = _text(row.get(id_column))
        if raw_id == "":
            raise FinanceDataValidationError(
                f"row in {config['domain']} is missing its legacy {id_column}"
            )
        return raw_id
    # The store label belongs in the key: finance_targets holds one 全部 row and one per-store
    # row for the same month and item, and a key without the store would collide and drop one.
    parts = [month, store_label] + [_text(row.get(column)) for column in config["dimensions"].values()]
    return "|".join(parts)


def parse_finance_monthly_export(
    content: bytes,
    *,
    store_id: str,
    store_map: dict[str, tuple[str, str]] | None = None,
) -> FinanceMonthlyProjection:
    """Map a legacy monthly finance export into ops_load_finance_monthly payloads."""
    resolved_map = DEFAULT_STORE_MAP if store_map is None else store_map
    payload = _decode("finance monthly export", content)
    if not isinstance(payload, dict):
        raise FinanceDataValidationError("finance monthly export must be a JSON object")

    tables = payload.get("tables")
    if not isinstance(tables, dict):
        raise FinanceDataValidationError("finance monthly export is missing its tables object")

    unknown = set(tables) - set(MONTHLY_SOURCES) - {"finance_revenue_daily"}
    if unknown:
        raise FinanceDataValidationError(
            "finance monthly export carries unmapped tables: " + ", ".join(sorted(unknown))
        )

    month_rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for table, config in MONTHLY_SOURCES.items():
        rows = tables.get(table, [])
        if not isinstance(rows, list):
            raise FinanceDataValidationError(f"{table} must be a list of rows")
        for row in rows:
            if not isinstance(row, dict):
                raise FinanceDataValidationError(f"{table} contains a non-object row")
            month = _month(row.get("month"), table)
            row_store_id, row_scope, store_label = _resolve_store(
                row.get("store"), default_store_id=store_id, store_map=resolved_map
            )
            key = _row_key(config, row, month, store_label)
            identity = (config["domain"], key)
            if identity in seen:
                raise FinanceDataValidationError(
                    f"{table} produced a duplicate row key {key!r}; the export would lose a row"
                )
            seen.add(identity)
            mapped = {
                "domain": config["domain"],
                "source_row_key": key,
                "period_month": month,
                "store_id": row_store_id,
                "store_scope": row_scope,
                "store_name_source": store_label,
                "amount": _money(row.get("amount"), f"{table}.amount"),
                "raw_record": {"source_table": table, "row": row},
            }
            for target, column in config["dimensions"].items():
                mapped[target] = _text(row.get(column))
            month_rows.append(mapped)

    revenue_rows: list[dict[str, Any]] = []
    for row in tables.get("finance_revenue_daily", []) or []:
        if not isinstance(row, dict):
            raise FinanceDataValidationError("finance_revenue_daily contains a non-object row")
        date = _text(row.get("date"))
        if not DATE_RE.fullmatch(date):
            raise FinanceDataValidationError(
                f"finance_revenue_daily.date must be YYYY-MM-DD, got {row.get('date')!r}"
            )
        row_store_id, _scope, store_label = _resolve_store(
            row.get("store"), default_store_id=store_id, store_map=resolved_map
        )
        revenue_rows.append({
            "business_date": date,
            "store_id": row_store_id,
            "store_name_source": store_label,
            "revenue": _money(row.get("revenue"), "finance_revenue_daily.revenue"),
            "gross_sales": _optional_number(row.get("gross_sales")),
            "total_discount": _optional_number(row.get("total_discount")),
            "discount_rate": _optional_number(row.get("discount_rate")),
            "import_source": _text(row.get("import_source")),
            "raw_record": {"source_table": "finance_revenue_daily", "row": row},
        })

    return FinanceMonthlyProjection(
        store_id=store_id, month_rows=month_rows, revenue_rows=revenue_rows
    )


def parse_finance_cost_card_export(content: bytes) -> FinanceCostCardProjection:
    """Map a legacy cost-card export into ops_load_finance_cost_cards payloads."""
    payload = _decode("finance cost card export", content)
    if not isinstance(payload, dict):
        raise FinanceDataValidationError("finance cost card export must be a JSON object")
    tables = payload.get("tables")
    if not isinstance(tables, dict):
        raise FinanceDataValidationError("finance cost card export is missing its tables object")

    def rows_of(name: str) -> list[dict[str, Any]]:
        rows = tables.get(name, [])
        if not isinstance(rows, list):
            raise FinanceDataValidationError(f"{name} must be a list of rows")
        for row in rows:
            if not isinstance(row, dict):
                raise FinanceDataValidationError(f"{name} contains a non-object row")
        return rows

    items = [{
        "legacy_item_id": _required_int(row.get("id"), "cost_card_item.id"),
        "name": _text(row.get("name")),
        "item_type": _text(row.get("item_type")),
        "base_unit": _text(row.get("base_unit")),
        "status": _text(row.get("status")),
        "source_ref": _text(row.get("source_ref")),
        "legacy_created_at": _text(row.get("created_at")),
        "legacy_updated_at": _text(row.get("updated_at")),
        "raw_record": {"source_table": "cost_card_item", "row": row},
    } for row in rows_of("cost_card_item")]

    for item in items:
        if item["name"] == "":
            raise FinanceDataValidationError(
                f"cost_card_item {item['legacy_item_id']} has no name; it would be unusable in R6"
            )

    prices = [{
        "legacy_price_id": _required_int(row.get("id"), "cost_card_item_price.id"),
        "legacy_item_id": _required_int(row.get("item_id"), "cost_card_item_price.item_id"),
        "supplier": _text(row.get("supplier")),
        "unit_price": _optional_number(row.get("unit_price")),
        "currency": _text(row.get("currency")),
        "price_unit": _text(row.get("price_unit")),
        "price_quantity": _optional_number(row.get("price_quantity")),
        "normalized_price_myr": _optional_number(row.get("normalized_price_myr")),
        "normalized_unit": _text(row.get("normalized_unit")),
        "effective_from": _text(row.get("effective_from")),
        "effective_to": _text(row.get("effective_to")),
        "source": _text(row.get("source")),
        "verification_state": _text(row.get("verification_state")),
        "verification_note": _text(row.get("verification_note")),
        "raw_record": {"source_table": "cost_card_item_price", "row": row},
    } for row in rows_of("cost_card_item_price")]

    recipes = [{
        "legacy_recipe_id": _required_int(row.get("id"), "cost_card_recipe.id"),
        "legacy_item_id": _required_int(row.get("item_id"), "cost_card_recipe.item_id"),
        "version": _optional_int(row.get("version")),
        "status": _text(row.get("status")),
        "batch_yield": _optional_number(row.get("batch_yield")),
        "batch_unit": _text(row.get("batch_unit")),
        "sale_price": _optional_number(row.get("sale_price")),
        "effective_from": _text(row.get("effective_from")),
        "effective_to": _text(row.get("effective_to")),
        "notes": _text(row.get("notes")),
        "raw_record": {"source_table": "cost_card_recipe", "row": row},
    } for row in rows_of("cost_card_recipe")]

    recipe_items = [{
        "legacy_recipe_item_id": _required_int(row.get("id"), "cost_card_recipe_item.id"),
        "legacy_recipe_id": _required_int(row.get("recipe_id"), "cost_card_recipe_item.recipe_id"),
        "component_item_id": _required_int(
            row.get("component_item_id"), "cost_card_recipe_item.component_item_id"
        ),
        "quantity": _optional_number(row.get("quantity")),
        "unit": _text(row.get("unit")),
        "net_yield": _optional_number(row.get("net_yield")),
        "loss_rate": _optional_number(row.get("loss_rate")),
        "seq": _optional_int(row.get("seq")),
        "notes": _text(row.get("notes")),
        "raw_record": {"source_table": "cost_card_recipe_item", "row": row},
    } for row in rows_of("cost_card_recipe_item")]

    # Referential checks run here, before anything is written, so a broken export is rejected
    # at parse time rather than leaving R6 holding orphan rows.
    item_ids = {item["legacy_item_id"] for item in items}
    recipe_ids = {recipe["legacy_recipe_id"] for recipe in recipes}

    orphan_prices = sorted({p["legacy_price_id"] for p in prices if p["legacy_item_id"] not in item_ids})
    if orphan_prices:
        raise FinanceDataValidationError(
            f"cost_card_item_price rows reference missing materials: {orphan_prices[:10]}"
        )
    orphan_recipes = sorted({r["legacy_recipe_id"] for r in recipes if r["legacy_item_id"] not in item_ids})
    if orphan_recipes:
        raise FinanceDataValidationError(
            f"cost_card_recipe rows reference missing materials: {orphan_recipes[:10]}"
        )
    orphan_lines = sorted({
        line["legacy_recipe_item_id"] for line in recipe_items
        if line["legacy_recipe_id"] not in recipe_ids
    })
    if orphan_lines:
        raise FinanceDataValidationError(
            f"cost_card_recipe_item rows reference missing recipes: {orphan_lines[:10]}"
        )
    orphan_components = sorted({
        line["legacy_recipe_item_id"] for line in recipe_items
        if line["component_item_id"] not in item_ids
    })
    if orphan_components:
        raise FinanceDataValidationError(
            f"cost_card_recipe_item rows reference missing component materials: {orphan_components[:10]}"
        )

    return FinanceCostCardProjection(
        items=items, prices=prices, recipes=recipes, recipe_items=recipe_items
    )
