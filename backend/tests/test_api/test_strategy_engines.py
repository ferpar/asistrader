"""Tests for the strategy-engine catalog endpoint + engine dispatch."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, Ticker
from asistrader.services.strategy_service import create_strategy


def test_list_engines_returns_catalog(client) -> None:
    resp = client.get("/api/strategies/engines")
    assert resp.status_code == 200  # not captured by /{strategy_id}
    data = resp.json()
    ids = [e["id"] for e in data["engines"]]
    assert "historical_expected_days" in ids

    hed = next(e for e in data["engines"] if e["id"] == "historical_expected_days")
    keys = {f["key"]: f for f in hed["fields"]}
    assert keys["plr_default"]["default"] == 1.5
    assert keys["order_type_default"]["type"] == "select"
    assert keys["order_type_default"]["options"] == ["limit", "stop", "market"]
    assert keys["d2_range"]["type"] == "int_range"


def test_draft_works_with_flat_gate_params(client, db_session: Session) -> None:
    db_session.add(Ticker(symbol="UP", name="UP"))
    for i in range(90):
        cl = 100.0 * (1.01**i)
        db_session.add(MarketData(
            ticker="UP", date=date(2021, 1, 1) + timedelta(days=i),
            open=cl, high=cl * 1.005, low=cl * 0.995, close=cl,
        ))
    db_session.commit()

    # Flat gate params (no nested "gates") — the engine-catalog default shape.
    strat = create_strategy(db_session, name="HED", automated=True, params={
        "engine": "historical_expected_days", "speed_period": 5, "d2_range": [1, 6],
        "lookback_years": 100, "order_type_default": "market",
        "min_effective_samples": 30, "min_margin_over_breakeven": 0.05,
    })
    resp = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "UP"})
    assert resp.status_code == 200
    assert resp.json()["confident"] is True


def test_draft_unknown_engine_is_low_confidence(client, db_session: Session) -> None:
    db_session.add(Ticker(symbol="UP", name="UP"))
    db_session.commit()
    strat = create_strategy(db_session, name="Bad", automated=True, params={"engine": "nope"})
    resp = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "UP"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["confident"] is False
    assert "engine" in data["reason"].lower()
