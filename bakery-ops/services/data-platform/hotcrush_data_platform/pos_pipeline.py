from __future__ import annotations

import csv
import io
import json
import re
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

MAX_ARTIFACT_BYTES = 10 * 1024 * 1024
MAX_DAILY_ROWS = 400
MAX_HOURLY_ROWS = 1_000
MONEY_QUANTUM = Decimal("0.01")
RECONCILIATION_TOLERANCE = Decimal("0.02")


class PosDataValidationError(ValueError):
    """The immutable POS evidence is incomplete, inconsistent, or malformed."""


@dataclass(frozen=True)
class PosProjection:
    target_business_date: str
    daily_rows: list[dict[str, Any]]
    hourly_rows: list[dict[str, Any]]
    metrics: dict[str, Any]


def _decode(name: str, content: bytes) -> str:
    if len(content) > MAX_ARTIFACT_BYTES:
        raise PosDataValidationError(f"{name} exceeds {MAX_ARTIFACT_BYTES} bytes")
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise PosDataValidationError(f"{name} is not UTF-8") from exc


def _iso_date(value: Any, field: str) -> str:
    text = str(value or "").strip()
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError as exc:
        raise PosDataValidationError(f"{field} must be an ISO business date") from exc


def _decimal(value: Any, field: str) -> Decimal:
    text = str(value if value is not None else "").strip().replace(",", "")
    try:
        parsed = Decimal(text)
    except InvalidOperation as exc:
        raise PosDataValidationError(f"{field} must be numeric") from exc
    if not parsed.is_finite():
        raise PosDataValidationError(f"{field} must be finite")
    return parsed


def _count(value: Any, field: str) -> str:
    parsed = _decimal(value, field)
    if parsed < 0 or parsed != parsed.to_integral_value():
        raise PosDataValidationError(f"{field} must be a non-negative integer")
    return str(int(parsed))


def _money(value: Any, field: str, *, optional: bool = False) -> str:
    if optional and (value is None or str(value).strip() == ""):
        return ""
    return format(_decimal(value, field).quantize(MONEY_QUANTUM), ".2f")


def _parse_daily_csv(content: bytes, store_id: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(_decode("sales_by_business_date.csv", content)))
    required = {
        "Business Date",
        "Store Name",
        "Bill Count",
        "Num Of Guests",
        "Gross Sales",
        "Amount Of Discount",
        "Net Sales",
        "Total Payment received",
    }
    if not reader.fieldnames or not required.issubset(reader.fieldnames):
        missing = sorted(required.difference(reader.fieldnames or []))
        raise PosDataValidationError(f"sales CSV is missing required columns: {missing}")

    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    source_store_names: set[str] = set()
    for raw in reader:
        if len(rows) >= MAX_DAILY_ROWS:
            raise PosDataValidationError(f"sales CSV exceeds {MAX_DAILY_ROWS} rows")
        normalized_raw = {
            str(key).strip(): (value.strip() if value else "") for key, value in raw.items()
        }
        business_date = _iso_date(normalized_raw["Business Date"], "Business Date")
        source_store_name = normalized_raw["Store Name"]
        if not source_store_name:
            raise PosDataValidationError("Store Name is required")
        source_store_names.add(source_store_name.casefold())
        if len(source_store_names) > 1:
            raise PosDataValidationError(
                "one Raw batch cannot map multiple source stores to one store_id"
            )
        key = (business_date, store_id)
        if key in seen:
            raise PosDataValidationError(f"duplicate daily row for {business_date}/{store_id}")
        seen.add(key)
        rows.append(
            {
                "business_date": business_date,
                "store_id": store_id,
                "store_name_source": source_store_name,
                "bill_count": _count(normalized_raw["Bill Count"], "Bill Count"),
                "guest_count": _count(normalized_raw["Num Of Guests"], "Num Of Guests"),
                "gross_sales": _money(normalized_raw["Gross Sales"], "Gross Sales"),
                "discount_amount": _money(
                    normalized_raw["Amount Of Discount"], "Amount Of Discount"
                ),
                "net_sales": _money(normalized_raw["Net Sales"], "Net Sales"),
                "total_payment_received": _money(
                    normalized_raw["Total Payment received"],
                    "Total Payment received",
                    optional=True,
                ),
                "raw_record": normalized_raw,
            }
        )
    if not rows:
        raise PosDataValidationError("sales CSV contains no data rows")
    return rows


def _parse_hourly_json(content: bytes, store_id: str) -> tuple[str, list[dict[str, Any]]]:
    try:
        payload = json.loads(_decode("daily.json", content))
    except json.JSONDecodeError as exc:
        raise PosDataValidationError("daily.json is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise PosDataValidationError("daily.json root must be an object")

    target_date = _iso_date(payload.get("businessDate"), "daily.json businessDate")
    query_status = payload.get("queryStatus")
    if not isinstance(query_status, dict) or query_status.get("hourlyByDate") != "ok":
        raise PosDataValidationError("daily.json hourlyByDate query is not successful")
    source_rows = payload.get("hourlyByDate")
    if not isinstance(source_rows, list):
        raise PosDataValidationError("daily.json hourlyByDate must be an array")
    if len(source_rows) > MAX_HOURLY_ROWS:
        raise PosDataValidationError(f"hourlyByDate exceeds {MAX_HOURLY_ROWS} rows")

    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()
    for raw in source_rows:
        if not isinstance(raw, dict):
            raise PosDataValidationError("hourlyByDate rows must be objects")
        business_date = _iso_date(raw.get("date"), "hourly date")
        hour = int(_count(raw.get("hour"), "hour"))
        if hour > 23:
            raise PosDataValidationError("hour must be between 0 and 23")
        key = (business_date, store_id, hour)
        if key in seen:
            raise PosDataValidationError(
                f"duplicate hourly row for {business_date}/{store_id}/{hour}"
            )
        seen.add(key)
        rows.append(
            {
                "business_date": business_date,
                "store_id": store_id,
                "sales_hour": str(hour),
                "bill_count": _count(raw.get("billCount"), "hourly billCount"),
                "guest_count": _count(raw.get("guests"), "hourly guests"),
                "gross_sales": _money(raw.get("grossSales"), "hourly grossSales"),
                "discount_amount": _money(raw.get("discount"), "hourly discount"),
                "net_sales": _money(raw.get("netSales"), "hourly netSales"),
                "raw_record": raw,
            }
        )
    return target_date, rows


def _reconcile(
    daily_rows: list[dict[str, Any]], hourly_rows: list[dict[str, Any]]
) -> tuple[int, list[str]]:
    daily_by_date = {row["business_date"]: row for row in daily_rows}
    hourly_by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in hourly_rows:
        hourly_by_date[row["business_date"]].append(row)

    guest_count_mismatch_dates: list[str] = []
    for business_date, rows in hourly_by_date.items():
        daily = daily_by_date.get(business_date)
        if daily is None:
            raise PosDataValidationError(
                f"hourly date {business_date} has no matching daily sales row"
            )
        hourly_bill_count = sum(int(row["bill_count"]) for row in rows)
        if hourly_bill_count != int(daily["bill_count"]):
            raise PosDataValidationError(
                f"bill_count mismatch for {business_date}: "
                f"daily={daily['bill_count']} hourly={hourly_bill_count}"
            )
        hourly_guest_count = sum(int(row["guest_count"]) for row in rows)
        if hourly_guest_count != int(daily["guest_count"]):
            guest_count_mismatch_dates.append(business_date)
        for field in ("gross_sales", "discount_amount", "net_sales"):
            hourly_total = sum(Decimal(row[field]) for row in rows)
            daily_total = Decimal(daily[field])
            if abs(hourly_total - daily_total) > RECONCILIATION_TOLERANCE:
                raise PosDataValidationError(
                    f"{field} mismatch for {business_date}: "
                    f"daily={daily_total} hourly={hourly_total}"
                )
    return len(hourly_by_date), sorted(guest_count_mismatch_dates)


def parse_pos_daily_artifacts(
    artifacts: Mapping[str, bytes], *, store_id: str
) -> PosProjection:
    clean_store_id = store_id.strip()
    if not clean_store_id:
        raise PosDataValidationError("store_id is required")
    missing = {"daily.json", "sales_by_business_date.csv"}.difference(artifacts)
    if missing:
        raise PosDataValidationError(f"required POS artifacts are missing: {sorted(missing)}")

    daily_rows = _parse_daily_csv(artifacts["sales_by_business_date.csv"], clean_store_id)
    target_date, hourly_rows = _parse_hourly_json(artifacts["daily.json"], clean_store_id)
    daily_by_date = {row["business_date"]: row for row in daily_rows}
    target_daily = daily_by_date.get(target_date)
    if target_daily is None:
        raise PosDataValidationError(f"target business date {target_date} is missing from sales CSV")
    if Decimal(target_daily["net_sales"]) != 0 and not any(
        row["business_date"] == target_date for row in hourly_rows
    ):
        raise PosDataValidationError(f"target business date {target_date} has sales but no hourly rows")

    reconciled_dates, guest_count_mismatch_dates = _reconcile(daily_rows, hourly_rows)
    daily_rows.sort(key=lambda row: (row["business_date"], row["store_id"]))
    hourly_rows.sort(
        key=lambda row: (row["business_date"], row["store_id"], int(row["sales_hour"]))
    )
    return PosProjection(
        target_business_date=target_date,
        daily_rows=daily_rows,
        hourly_rows=hourly_rows,
        metrics={
            "daily_rows": len(daily_rows),
            "hourly_rows": len(hourly_rows),
            "reconciled_dates": reconciled_dates,
            "guest_count_mismatch_dates": guest_count_mismatch_dates,
            "target_business_date": target_date,
        },
    )


def parse_legacy_pos_export(content: bytes, *, store_id: str) -> PosProjection:
    try:
        payload = json.loads(_decode("legacy_pos_export.json", content))
    except json.JSONDecodeError as exc:
        raise PosDataValidationError("legacy_pos_export.json is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise PosDataValidationError("legacy POS export root must be an object")
    if payload.get("schema_version") != "legacy-pos-export-v1":
        raise PosDataValidationError("unsupported legacy POS export schema_version")
    source_project_ref = str(payload.get("source_project_ref") or "")
    if not re.fullmatch(r"[a-z]{20}", source_project_ref):
        raise PosDataValidationError("legacy POS export source_project_ref is invalid")

    clean_store_id = store_id.strip()
    if not clean_store_id:
        raise PosDataValidationError("store_id is required")
    if payload.get("store_id") != clean_store_id:
        raise PosDataValidationError("legacy POS export store_id does not match its Raw batch")
    business_date = _iso_date(payload.get("business_date"), "legacy business_date")
    source_daily = payload.get("daily")
    source_hourly = payload.get("hourly")
    if not isinstance(source_daily, dict) or not isinstance(source_hourly, list):
        raise PosDataValidationError("legacy POS export requires daily object and hourly array")
    if not source_hourly or len(source_hourly) > 24:
        raise PosDataValidationError("legacy POS export must contain 1 to 24 hourly rows")
    daily_raw = source_daily.get("raw_record")
    if not isinstance(daily_raw, dict):
        raise PosDataValidationError("legacy daily raw_record must be an object")

    daily_rows = [
        {
            "business_date": business_date,
            "store_id": clean_store_id,
            "store_name_source": str(source_daily.get("store_name_source") or "").strip(),
            "bill_count": _count(source_daily.get("bill_count"), "legacy daily bill_count"),
            "guest_count": _count(
                source_daily.get("guest_count"), "legacy daily guest_count"
            ),
            "gross_sales": _money(
                source_daily.get("gross_sales"), "legacy daily gross_sales"
            ),
            "discount_amount": _money(
                source_daily.get("discount_amount"), "legacy daily discount_amount"
            ),
            "net_sales": _money(source_daily.get("net_sales"), "legacy daily net_sales"),
            "total_payment_received": _money(
                source_daily.get("total_payment_received"),
                "legacy daily total_payment_received",
                optional=True,
            ),
            "raw_record": daily_raw,
        }
    ]
    if not daily_rows[0]["store_name_source"]:
        raise PosDataValidationError("legacy daily store_name_source is required")

    hourly_rows: list[dict[str, Any]] = []
    seen_hours: set[int] = set()
    for source_row in source_hourly:
        if not isinstance(source_row, dict) or not isinstance(source_row.get("raw_record"), dict):
            raise PosDataValidationError("legacy hourly rows and raw_record values must be objects")
        hour = int(_count(source_row.get("sales_hour"), "legacy sales_hour"))
        if hour > 23:
            raise PosDataValidationError("legacy sales_hour must be between 0 and 23")
        if hour in seen_hours:
            raise PosDataValidationError(f"duplicate legacy hourly row for hour {hour}")
        seen_hours.add(hour)
        hourly_rows.append(
            {
                "business_date": business_date,
                "store_id": clean_store_id,
                "sales_hour": str(hour),
                "bill_count": _count(
                    source_row.get("bill_count"), "legacy hourly bill_count"
                ),
                "guest_count": _count(
                    source_row.get("guest_count"), "legacy hourly guest_count"
                ),
                "gross_sales": _money(
                    source_row.get("gross_sales"), "legacy hourly gross_sales"
                ),
                "discount_amount": _money(
                    source_row.get("discount_amount"), "legacy hourly discount_amount"
                ),
                "net_sales": _money(
                    source_row.get("net_sales"), "legacy hourly net_sales"
                ),
                "raw_record": source_row["raw_record"],
            }
        )

    reconciled_dates, guest_count_mismatch_dates = _reconcile(daily_rows, hourly_rows)
    if guest_count_mismatch_dates:
        raise PosDataValidationError("legacy daily guest_count must equal the hourly guest sum")
    hourly_rows.sort(key=lambda row: int(row["sales_hour"]))
    return PosProjection(
        target_business_date=business_date,
        daily_rows=daily_rows,
        hourly_rows=hourly_rows,
        metrics={
            "daily_rows": 1,
            "hourly_rows": len(hourly_rows),
            "reconciled_dates": reconciled_dates,
            "guest_count_mismatch_dates": [],
            "target_business_date": business_date,
            "source_project_ref": source_project_ref,
        },
    )
