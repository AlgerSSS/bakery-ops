import json

import pytest

from hotcrush_data_platform.pos_pipeline import (
    PosDataValidationError,
    parse_legacy_pos_export,
    parse_pos_daily_artifacts,
)


def _artifacts(
    *, hourly_net_sales: float = 100.0, hourly_status: str = "ok", second_hour_guests: int = 2
) -> dict[str, bytes]:
    csv_body = (
        "Business Date,Store Name,Bill Count,Num Of Guests,Gross Sales,Amount Of Discount,"
        "Net Sales,Total Payment received\n"
        "2026-07-26,HOT CRUSH BAKERY,2,3,120.00,20.00,100.00,105.00"
    )
    daily = {
        "businessDate": "2026-07-26",
        "queryStatus": {"hourlyByDate": hourly_status},
        "hourlyByDate": [
            {
                "date": "2026-07-26",
                "hour": "12",
                "billCount": 1,
                "guests": 1,
                "grossSales": 50.0,
                "netSales": 40.0,
                "discount": 10.0,
            },
            {
                "date": "2026-07-26",
                "hour": "13",
                "billCount": 1,
                "guests": second_hour_guests,
                "grossSales": 70.0,
                "netSales": hourly_net_sales - 40.0,
                "discount": 10.0,
            },
        ],
    }
    return {
        "sales_by_business_date.csv": csv_body.encode(),
        "daily.json": json.dumps(daily).encode(),
    }


def test_parse_pos_projection_preserves_source_rows_and_reconciles_totals() -> None:
    projection = parse_pos_daily_artifacts(_artifacts(), store_id="HC001")

    assert projection.target_business_date == "2026-07-26"
    assert projection.metrics == {
        "daily_rows": 1,
        "hourly_rows": 2,
        "reconciled_dates": 1,
        "guest_count_mismatch_dates": [],
        "target_business_date": "2026-07-26",
    }
    assert projection.daily_rows[0] == {
        "business_date": "2026-07-26",
        "store_id": "HC001",
        "store_name_source": "HOT CRUSH BAKERY",
        "bill_count": "2",
        "guest_count": "3",
        "gross_sales": "120.00",
        "discount_amount": "20.00",
        "net_sales": "100.00",
        "total_payment_received": "105.00",
        "raw_record": {
            "Amount Of Discount": "20.00",
            "Bill Count": "2",
            "Business Date": "2026-07-26",
            "Gross Sales": "120.00",
            "Net Sales": "100.00",
            "Num Of Guests": "3",
            "Store Name": "HOT CRUSH BAKERY",
            "Total Payment received": "105.00",
        },
    }
    assert [row["sales_hour"] for row in projection.hourly_rows] == ["12", "13"]


def test_parse_pos_projection_rejects_cross_source_total_mismatch() -> None:
    with pytest.raises(PosDataValidationError, match="net_sales mismatch"):
        parse_pos_daily_artifacts(_artifacts(hourly_net_sales=90.0), store_id="HC001")


def test_parse_pos_projection_reports_but_does_not_merge_guest_count_mismatch() -> None:
    projection = parse_pos_daily_artifacts(
        _artifacts(second_hour_guests=3), store_id="HC001"
    )

    assert projection.daily_rows[0]["guest_count"] == "3"
    assert sum(int(row["guest_count"]) for row in projection.hourly_rows) == 4
    assert projection.metrics["guest_count_mismatch_dates"] == ["2026-07-26"]


def test_parse_pos_projection_rejects_failed_required_query() -> None:
    with pytest.raises(PosDataValidationError, match="hourlyByDate query is not successful"):
        parse_pos_daily_artifacts(_artifacts(hourly_status="failed(status=500)"), store_id="HC001")


def test_parse_pos_projection_rejects_duplicate_hour() -> None:
    artifacts = _artifacts()
    daily = json.loads(artifacts["daily.json"])
    daily["hourlyByDate"].append(daily["hourlyByDate"][0])
    artifacts["daily.json"] = json.dumps(daily).encode()

    with pytest.raises(PosDataValidationError, match="duplicate hourly row"):
        parse_pos_daily_artifacts(artifacts, store_id="HC001")


def _legacy_export(*, store_id: str = "HC001") -> bytes:
    return json.dumps(
        {
            "schema_version": "legacy-pos-export-v1",
            "source_project_ref": "ecsgqcmwtjmcpzqytdqw",
            "business_date": "2026-07-26",
            "store_id": store_id,
            "daily": {
                "store_name_source": "吉隆坡Pavilion门店",
                "bill_count": 2,
                "guest_count": 3,
                "gross_sales": 120,
                "discount_amount": 20,
                "net_sales": 100,
                "total_payment_received": None,
                "raw_record": {"source_table": "daily_revenue"},
            },
            "hourly": [
                {
                    "sales_hour": 12,
                    "bill_count": 1,
                    "guest_count": 1,
                    "gross_sales": 50,
                    "discount_amount": 10,
                    "net_sales": 40,
                    "raw_record": {"source_table": "hourly_sales_summary"},
                },
                {
                    "sales_hour": 13,
                    "bill_count": 1,
                    "guest_count": 2,
                    "gross_sales": 70,
                    "discount_amount": 10,
                    "net_sales": 60,
                    "raw_record": {"source_table": "hourly_sales_summary"},
                },
            ],
        },
        ensure_ascii=False,
    ).encode()


def test_parse_legacy_export_reconciles_one_final_business_day() -> None:
    projection = parse_legacy_pos_export(_legacy_export(), store_id="HC001")

    assert projection.target_business_date == "2026-07-26"
    assert projection.metrics["daily_rows"] == 1
    assert projection.metrics["hourly_rows"] == 2
    assert projection.daily_rows[0]["net_sales"] == "100.00"


def test_parse_legacy_export_rejects_store_identity_mismatch() -> None:
    with pytest.raises(PosDataValidationError, match="store_id does not match"):
        parse_legacy_pos_export(_legacy_export(store_id="WRONG"), store_id="HC001")
