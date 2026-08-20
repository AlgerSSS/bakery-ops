import hashlib
import json
from types import SimpleNamespace

import pytest

from hotcrush_data_platform.config import PosWorkerSettings
from hotcrush_data_platform.pos_pipeline import PosDataValidationError
from hotcrush_data_platform.pos_worker import process_one

CSV_BYTES = (
    b"Business Date,Store Name,Bill Count,Num Of Guests,Gross Sales,Amount Of Discount,"
    b"Net Sales,Total Payment received\n"
    b"2026-07-26,HOT CRUSH BAKERY,1,1,100.00,0.00,100.00,100.00"
)
JSON_BYTES = json.dumps(
    {
        "businessDate": "2026-07-26",
        "queryStatus": {"hourlyByDate": "ok"},
        "hourlyByDate": [
            {
                "date": "2026-07-26",
                "hour": "12",
                "billCount": 1,
                "guests": 1,
                "grossSales": 100.0,
                "netSales": 100.0,
                "discount": 0.0,
            }
        ],
    }
).encode()


class FakeClient:
    def __init__(self, *, corrupt_hash: bool = False, source_system: str = "RES_POS_DAILY") -> None:
        self.corrupt_hash = corrupt_hash
        self.source_system = source_system
        self.calls: list[tuple[str, dict]] = []
        self.objects = {
            "raw/daily.csv": CSV_BYTES,
            "raw/daily.json": JSON_BYTES,
        }
        if source_system == "LEGACY_POS_EXPORT":
            self.objects = {
                "raw/legacy.json": json.dumps(
                    {
                        "schema_version": "legacy-pos-export-v1",
                        "source_project_ref": "ecsgqcmwtjmcpzqytdqw",
                        "business_date": "2026-07-26",
                        "store_id": "HC001",
                        "daily": {
                            "store_name_source": "Pavilion",
                            "bill_count": 1,
                            "guest_count": 1,
                            "gross_sales": 100,
                            "discount_amount": 0,
                            "net_sales": 100,
                            "total_payment_received": None,
                            "raw_record": {},
                        },
                        "hourly": [
                            {
                                "sales_hour": 12,
                                "bill_count": 1,
                                "guest_count": 1,
                                "gross_sales": 100,
                                "discount_amount": 0,
                                "net_sales": 100,
                                "raw_record": {},
                            }
                        ],
                    }
                ).encode()
            }

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    @staticmethod
    def one(value):
        if isinstance(value, list):
            return value[0] if value else None
        return value

    def rpc(self, name: str, payload: dict):
        self.calls.append((name, payload))
        if name == "ops_claim_processing_run_for_pipeline":
            return [{"processing_run_id": 7}]
        if name == "ops_get_processing_input":
            manifest = []
            source_objects = (
                [("legacy_pos_export.json", "raw/legacy.json")]
                if self.source_system == "LEGACY_POS_EXPORT"
                else [
                    ("sales_by_business_date.csv", "raw/daily.csv"),
                    ("daily.json", "raw/daily.json"),
                ]
            )
            for source_record_key, object_path in source_objects:
                content = self.objects[object_path]
                manifest.append(
                    {
                        "bucket_id": "raw-business-private",
                        "object_path": object_path,
                        "source_record_key": source_record_key,
                        "sha256": "0" * 64
                        if self.corrupt_hash and source_record_key == "daily.json"
                        else hashlib.sha256(content).hexdigest(),
                        "size_bytes": len(content),
                    }
                )
            return {
                "processing_run_id": 7,
                "batch_id": "batch-1",
                "source_system": self.source_system,
                "store_id": "HC001",
                "pipeline_key": "pos_daily_sales",
                "objects": manifest,
            }
        if name in {"ops_load_pos_daily_sales", "ops_fail_processing_run"}:
            return {"ok": True}
        raise AssertionError(f"unexpected RPC {name}")

    def download_object(self, _bucket: str, object_path: str) -> bytes:
        return self.objects[object_path]


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        supabase_url="https://r6.example",
        supabase_service_key="secret",
        request_timeout_seconds=10,
        worker_id="pos-worker-test",
    )


def test_pos_worker_requires_explicit_r6_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("R6_SUPABASE_URL", raising=False)
    monkeypatch.delenv("R6_SUPABASE_SERVICE_KEY", raising=False)
    monkeypatch.delenv("R6_SUPABASE_SERVICE_KEY_FILE", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://old-production.example")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "old-production-key")

    with pytest.raises(ValueError, match="R6_SUPABASE_URL"):
        PosWorkerSettings.from_env()


def test_pos_worker_claims_only_pos_pipeline_and_publishes_projection() -> None:
    client = FakeClient()

    assert process_one(_settings(), client_factory=lambda *_args: client) is True

    assert client.calls[0] == (
        "ops_claim_processing_run_for_pipeline",
        {
            "p_worker_id": "pos-worker-test",
            "p_pipeline_keys": ["pos_daily_sales"],
            "p_lease_seconds": 300,
        },
    )
    load_call = next(payload for name, payload in client.calls if name == "ops_load_pos_daily_sales")
    assert load_call["p_processing_run_id"] == 7
    assert len(load_call["p_daily_rows"]) == 1
    assert len(load_call["p_hourly_rows"]) == 1


def test_pos_worker_records_non_retryable_integrity_failure() -> None:
    client = FakeClient(corrupt_hash=True)

    with pytest.raises(PosDataValidationError, match="sha256 mismatch"):
        process_one(_settings(), client_factory=lambda *_args: client)

    failure = next(payload for name, payload in client.calls if name == "ops_fail_processing_run")
    assert failure["p_processing_run_id"] == 7
    assert failure["p_retryable"] is False


def test_pos_worker_processes_explicit_legacy_export_contract() -> None:
    client = FakeClient(source_system="LEGACY_POS_EXPORT")

    assert process_one(_settings(), client_factory=lambda *_args: client) is True

    load_call = next(payload for name, payload in client.calls if name == "ops_load_pos_daily_sales")
    assert load_call["p_daily_rows"][0]["net_sales"] == "100.00"
    assert len(load_call["p_hourly_rows"]) == 1
