from __future__ import annotations

import json

import pytest

from hotcrush_data_platform.finance_pipeline import (
    FinanceDataValidationError,
    parse_finance_cost_card_export,
    parse_finance_monthly_export,
)


def monthly(tables: dict) -> bytes:
    return json.dumps({"tables": tables}).encode("utf-8")


def cost_cards(tables: dict) -> bytes:
    return json.dumps({"tables": tables}).encode("utf-8")


def test_two_expenses_sharing_a_dimension_tuple_both_survive():
    """Production really holds two distinct 2026-03 物料费/日常物料/银行账户采买 entries.

    Keying on the dimension tuple instead of the legacy id would silently drop 472.22.
    """
    content = monthly({
        "finance_expense": [
            {"id": 232, "month": "2026-03", "store": "吉隆坡Pavilion门店", "major": "物料费",
             "sub": "日常物料", "source": "银行账户采买", "amount": "1507.50"},
            {"id": 233, "month": "2026-03", "store": "吉隆坡Pavilion门店", "major": "物料费",
             "sub": "日常物料", "source": "银行账户采买", "amount": "472.22"},
        ]
    })
    projection = parse_finance_monthly_export(content, store_id="HC001")
    assert len(projection.month_rows) == 2
    assert {row["source_row_key"] for row in projection.month_rows} == {"232", "233"}
    assert sum(float(row["amount"]) for row in projection.month_rows) == pytest.approx(1979.72)


def test_each_legacy_table_maps_to_its_domain():
    content = monthly({
        "finance_pl_metrics": [{"month": "2026-03", "store": "吉隆坡Pavilion门店", "metric": "营业额", "amount": "1"}],
        "finance_labor_detail": [
            {"month": "2026-03", "store": "吉隆坡Pavilion门店", "item": "工资", "category": "本地", "org": "门店", "amount": "2"}
        ],
        "finance_material": [
            {"id": 7, "month": "2026-03", "store": "吉隆坡Pavilion门店", "category": "面粉", "source": "采购", "amount": "3"}
        ],
        "finance_targets": [{"month": "2026-03", "store": "吉隆坡Pavilion门店", "item": "目标营业额", "amount": "4"}],
        "finance_cashflow": [{"month": "2026-03", "store": "吉隆坡Pavilion门店", "item": "净现金流", "amount": "5"}],
    })
    projection = parse_finance_monthly_export(content, store_id="HC001")
    domains = {row["domain"] for row in projection.month_rows}
    assert domains == {"PL_METRIC", "LABOR", "MATERIAL", "TARGET", "CASHFLOW"}
    labor = next(row for row in projection.month_rows if row["domain"] == "LABOR")
    assert (labor["item"], labor["category"], labor["org"]) == ("工资", "本地", "门店")


def test_store_id_is_normalized_but_source_name_is_kept():
    content = monthly({
        "finance_targets": [
            {"month": "2026-03", "store": "吉隆坡Pavilion门店", "item": "目标", "amount": "10"}
        ]
    })
    row = parse_finance_monthly_export(content, store_id="HC001").month_rows[0]
    assert row["store_id"] == "HC001"
    assert row["store_name_source"] == "吉隆坡Pavilion门店"


def test_malformed_month_is_rejected():
    content = monthly({"finance_targets": [{"month": "2026-3", "store": "吉隆坡Pavilion门店", "item": "x", "amount": "1"}]})
    with pytest.raises(FinanceDataValidationError, match="must be YYYY-MM"):
        parse_finance_monthly_export(content, store_id="HC001")


def test_missing_amount_is_rejected_rather_than_defaulted_to_zero():
    content = monthly({"finance_targets": [{"month": "2026-03", "store": "吉隆坡Pavilion门店", "item": "x"}]})
    with pytest.raises(FinanceDataValidationError, match="amount is required"):
        parse_finance_monthly_export(content, store_id="HC001")


def test_expense_without_legacy_id_is_rejected():
    content = monthly({
        "finance_expense": [
            {"month": "2026-03", "store": "吉隆坡Pavilion门店", "major": "a", "sub": "b", "source": "c", "amount": "1"}
        ]
    })
    with pytest.raises(FinanceDataValidationError, match="missing its legacy id"):
        parse_finance_monthly_export(content, store_id="HC001")


def test_unmapped_table_is_rejected_instead_of_silently_dropped():
    content = monthly({"finance_orders": [{"month": "2026-03"}]})
    with pytest.raises(FinanceDataValidationError, match="unmapped tables"):
        parse_finance_monthly_export(content, store_id="HC001")


def test_empty_revenue_daily_is_valid():
    """finance_revenue_daily is empty in production; an empty list is a fact, not an error."""
    projection = parse_finance_monthly_export(monthly({"finance_revenue_daily": []}), store_id="HC001")
    assert projection.revenue_rows == []
    assert projection.month_rows == []


def test_revenue_daily_requires_a_full_date():
    content = monthly({"finance_revenue_daily": [{"date": "2026-03", "store": "吉隆坡Pavilion门店", "revenue": "1"}]})
    with pytest.raises(FinanceDataValidationError, match="must be YYYY-MM-DD"):
        parse_finance_monthly_export(content, store_id="HC001")


BASE_ITEM = {"id": 456, "name": "茉莉卡仕达", "item_type": "ingredient", "base_unit": "g"}


def test_cost_card_export_maps_all_four_levels():
    content = cost_cards({
        "cost_card_item": [BASE_ITEM],
        "cost_card_item_price": [{"id": 9001, "item_id": 456, "unit_price": "12.5"}],
        "cost_card_recipe": [{"id": 7001, "item_id": 456, "version": 1, "status": "published"}],
        "cost_card_recipe_item": [
            {"id": 8001, "recipe_id": 7001, "component_item_id": 456, "quantity": "250", "seq": 1}
        ],
    })
    projection = parse_finance_cost_card_export(content)
    assert projection.items[0]["legacy_item_id"] == "456"
    assert projection.prices[0]["legacy_price_id"] == "9001"
    assert projection.recipes[0]["legacy_recipe_id"] == "7001"
    assert projection.recipe_items[0]["component_item_id"] == "456"


def test_price_referencing_a_missing_material_is_rejected_before_any_write():
    content = cost_cards({
        "cost_card_item": [BASE_ITEM],
        "cost_card_item_price": [{"id": 9002, "item_id": 999, "unit_price": "1"}],
    })
    with pytest.raises(FinanceDataValidationError, match="missing materials"):
        parse_finance_cost_card_export(content)


def test_recipe_line_referencing_a_missing_recipe_is_rejected():
    content = cost_cards({
        "cost_card_item": [BASE_ITEM],
        "cost_card_recipe_item": [{"id": 8002, "recipe_id": 999, "component_item_id": 456}],
    })
    with pytest.raises(FinanceDataValidationError, match="missing recipes"):
        parse_finance_cost_card_export(content)


def test_recipe_line_with_unknown_component_is_rejected():
    content = cost_cards({
        "cost_card_item": [BASE_ITEM],
        "cost_card_recipe": [{"id": 7001, "item_id": 456}],
        "cost_card_recipe_item": [{"id": 8003, "recipe_id": 7001, "component_item_id": 12345}],
    })
    with pytest.raises(FinanceDataValidationError, match="missing component materials"):
        parse_finance_cost_card_export(content)


def test_material_without_a_name_is_rejected():
    content = cost_cards({"cost_card_item": [{"id": 1, "name": "  "}]})
    with pytest.raises(FinanceDataValidationError, match="has no name"):
        parse_finance_cost_card_export(content)


def test_normalized_price_is_carried_over_not_recomputed():
    """A wrong normalization in production must stay visible in R6, not be silently fixed."""
    content = cost_cards({
        "cost_card_item": [BASE_ITEM],
        "cost_card_item_price": [{
            "id": 9003, "item_id": 456, "unit_price": "12.5", "price_quantity": "1000",
            "normalized_price_myr": "999.0000", "normalized_unit": "g",
        }],
    })
    price = parse_finance_cost_card_export(content).prices[0]
    assert price["normalized_price_myr"] == "999.0000"


def test_non_json_content_is_rejected_with_context():
    with pytest.raises(FinanceDataValidationError, match="not valid UTF-8 JSON"):
        parse_finance_monthly_export(b"\xff\xfe not json", store_id="HC001")


def test_group_and_store_targets_are_kept_apart():
    """finance_targets holds an identical 全部 and per-store row for the same month and item.

    Without the scope split they would collide on the row key, and mapping both onto HC001
    would double every target.
    """
    content = monthly({
        "finance_targets": [
            {"month": "2026-01", "store": "全部", "item": "总流水", "amount": "1766000"},
            {"month": "2026-01", "store": "吉隆坡Pavilion门店", "item": "总流水", "amount": "1766000"},
        ]
    })
    rows = parse_finance_monthly_export(content, store_id="HC001").month_rows
    assert len(rows) == 2
    by_scope = {row["store_scope"]: row for row in rows}
    assert by_scope["GROUP"]["store_id"] == "ALL"
    assert by_scope["STORE"]["store_id"] == "HC001"
    assert by_scope["GROUP"]["source_row_key"] != by_scope["STORE"]["source_row_key"]
    store_total = sum(float(r["amount"]) for r in rows if r["store_scope"] == "STORE")
    assert store_total == pytest.approx(1766000)


def test_an_unmapped_store_is_rejected_not_absorbed():
    content = monthly({
        "finance_targets": [{"month": "2026-01", "store": "槟城二店", "item": "总流水", "amount": "1"}]
    })
    with pytest.raises(FinanceDataValidationError, match="unmapped finance store"):
        parse_finance_monthly_export(content, store_id="HC001")


def test_a_row_without_a_store_falls_back_to_the_batch_store():
    content = monthly({"finance_cashflow": [{"month": "2026-01", "item": "净现金流", "amount": "5"}]})
    row = parse_finance_monthly_export(content, store_id="HC001").month_rows[0]
    assert (row["store_id"], row["store_scope"]) == ("HC001", "STORE")


def test_store_map_is_overridable_for_a_future_outlet():
    content = monthly({
        "finance_cashflow": [{"month": "2026-01", "store": "槟城二店", "item": "净现金流", "amount": "5"}]
    })
    row = parse_finance_monthly_export(
        content, store_id="HC001", store_map={"槟城二店": ("HC002", "STORE")}
    ).month_rows[0]
    assert row["store_id"] == "HC002"
