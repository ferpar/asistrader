"""Requests that grow the process past the threshold get logged and trimmed."""

import logging
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from asistrader import memory
from asistrader.memory import MemoryWatchMiddleware, read_memory_kb


def _app(threshold_kb: int) -> FastAPI:
    app = FastAPI()

    @app.get("/heavy")
    def heavy() -> dict[str, str]:
        return {"ok": "yes"}

    app.add_middleware(MemoryWatchMiddleware, threshold_kb=threshold_kb)
    return app


def test_read_memory_parses_proc_status(tmp_path: Path) -> None:
    status = tmp_path / "status"
    status.write_text("Name:\tpython\nVmRSS:\t  51200 kB\nVmSwap:\t   1024 kB\n")
    assert read_memory_kb(str(status)) == (51200, 1024)


def test_read_memory_is_none_without_proc(tmp_path: Path) -> None:
    assert read_memory_kb(str(tmp_path / "missing")) is None


@pytest.fixture
def trims(monkeypatch: pytest.MonkeyPatch) -> list[None]:
    """Record malloc_trim calls instead of trimming; reports glibc present."""
    calls: list[None] = []

    def fake_trim() -> bool:
        calls.append(None)
        return True

    monkeypatch.setattr(memory, "malloc_trim", fake_trim)
    return calls


def test_logs_growth_past_threshold_and_trims(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, trims: list[None]
) -> None:
    readings = iter([(100_000, 0), (130_000, 2_000), (110_000, 2_000)])
    monkeypatch.setattr(memory, "read_memory_kb", lambda: next(readings))

    with caplog.at_level(logging.WARNING, logger="asistrader.memory"):
        TestClient(_app(threshold_kb=20 * 1024)).get("/heavy?token=secret")

    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert "GET /heavy" in message
    assert "+31.2MB" in message
    assert "rss after trim=107MB" in message
    assert "secret" not in message
    assert len(trims) == 1


def test_logs_without_trim_figure_when_glibc_is_missing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    readings = iter([(100_000, 0), (130_000, 0)])
    monkeypatch.setattr(memory, "read_memory_kb", lambda: next(readings))
    monkeypatch.setattr(memory, "malloc_trim", lambda: False)

    with caplog.at_level(logging.WARNING, logger="asistrader.memory"):
        TestClient(_app(threshold_kb=20 * 1024)).get("/heavy")

    assert len(caplog.records) == 1
    assert "after trim" not in caplog.records[0].getMessage()


def test_quiet_and_untrimmed_below_threshold(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, trims: list[None]
) -> None:
    readings = iter([(100_000, 0), (101_000, 0)])
    monkeypatch.setattr(memory, "read_memory_kb", lambda: next(readings))

    with caplog.at_level(logging.WARNING, logger="asistrader.memory"):
        TestClient(_app(threshold_kb=20 * 1024)).get("/heavy")

    assert caplog.records == []
    assert trims == []


def test_noop_off_linux(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, trims: list[None]
) -> None:
    monkeypatch.setattr(memory, "read_memory_kb", lambda: None)

    with caplog.at_level(logging.WARNING, logger="asistrader.memory"):
        response = TestClient(_app(threshold_kb=0)).get("/heavy")

    assert response.status_code == 200
    assert caplog.records == []
    assert trims == []
