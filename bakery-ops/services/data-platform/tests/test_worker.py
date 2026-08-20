from typing import Any

import pytest

from hotcrush_data_platform import worker


def test_rag_worker_drain_stops_when_the_queue_is_empty(monkeypatch: Any) -> None:
    outcomes = iter((True, True, False))
    monkeypatch.setattr(worker, "process_one", lambda _settings: next(outcomes))

    result = worker.drain_available(object(), max_runs=10)

    assert result == {"processed": 2, "drained": True}


def test_rag_worker_drain_is_bounded(monkeypatch: Any) -> None:
    monkeypatch.setattr(worker, "process_one", lambda _settings: True)

    result = worker.drain_available(object(), max_runs=2)

    assert result == {"processed": 2, "drained": False}


def test_rag_worker_drain_rejects_invalid_bounds() -> None:
    with pytest.raises(ValueError, match="between 1 and 1000"):
        worker.drain_available(object(), max_runs=0)
