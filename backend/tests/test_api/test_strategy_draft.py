"""Tests for the POST /api/strategies/{id}/draft endpoint (Phase 3)."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

import pytest

from asistrader.models.db import MarketData, SweepResultCache, Ticker
from asistrader.services.strategies import draft_service
from asistrader.services.strategy_service import create_strategy

AUTO_PARAMS = {
    "engine": "historical_expected_days",
    "speed_period": 5,
    "d2_range": [1, 6],
    "lookback_years": 100,
    "order_type_default": "market",
    "side_default": "long",
    "gates": {"min_effective_samples": 30},
}


def _add_ticker_with_bars(db: Session, symbol: str, n: int) -> None:
    db.add(Ticker(symbol=symbol, name=symbol))
    start = date(2021, 1, 1)
    for i in range(n):
        close = 100.0 * (1.01**i)  # steady uptrend
        db.add(
            MarketData(
                ticker=symbol,
                date=start + timedelta(days=i),
                open=close,
                high=close * 1.005,
                low=close * 0.995,
                close=close,
            )
        )
    db.commit()


def test_draft_returns_confident_presets(client, db_session: Session) -> None:
    _add_ticker_with_bars(db_session, "UP", 90)
    strat = create_strategy(db_session, name="HED", automated=True, params=AUTO_PARAMS)

    resp = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "UP"})
    assert resp.status_code == 200
    data = resp.json()

    assert data["confident"] is True
    assert data["ticker"] == "UP"
    assert data["speed"] is not None
    assert len(data["presets"]) >= 1

    p = data["presets"][0]
    # Long drafted prices are coherent: SL < entry < TP.
    assert p["stop_loss"] < p["entry"] < p["take_profit"]
    assert p["n_trials"] >= 30


def test_draft_is_cached(client, db_session: Session) -> None:
    _add_ticker_with_bars(db_session, "UP", 90)
    strat = create_strategy(db_session, name="HED", automated=True, params=AUTO_PARAMS)

    first = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "UP"}).json()
    assert db_session.query(SweepResultCache).filter_by(ticker="UP").count() == 1

    second = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "UP"}).json()
    assert second == first  # served from cache
    assert db_session.query(SweepResultCache).filter_by(ticker="UP").count() == 1


def test_draft_anchored_on_last_close_when_no_live_quote(client, db_session: Session) -> None:
    _add_ticker_with_bars(db_session, "UP", 90)
    strat = create_strategy(db_session, name="HED", automated=True, params=AUTO_PARAMS)

    data = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "UP"}).json()
    # Offline default (see conftest): falls back to the last stored close.
    assert data["reference_price_live"] is False
    last_close = db_session.query(MarketData).filter_by(ticker="UP").order_by(
        MarketData.date.desc()
    ).first().close
    assert data["reference_price"] == pytest.approx(last_close)


def test_draft_reanchors_on_live_price(client, db_session: Session, monkeypatch) -> None:
    _add_ticker_with_bars(db_session, "UP", 90)
    strat = create_strategy(db_session, name="HED", automated=True, params=AUTO_PARAMS)

    # First draft with no live quote → levels anchored on the last close.
    base = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "UP"}).json()
    assert base["reference_price_live"] is False
    close = base["reference_price"]
    assert close is not None and len(base["presets"]) >= 1
    p0 = base["presets"][0]

    # A live quote 10% above the close. The sweep is served from cache, but the
    # levels must re-anchor proportionally (every price is anchor * factor).
    live = close * 1.10
    monkeypatch.setattr(
        draft_service,
        "get_current_price",
        lambda symbol: {"price": live, "currency": "USD", "valid": True},
    )
    out = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "UP"}).json()

    assert db_session.query(SweepResultCache).filter_by(ticker="UP").count() == 1  # cache reused
    assert out["reference_price_live"] is True
    assert out["reference_price"] == pytest.approx(live)
    q0 = out["presets"][0]
    assert q0["entry"] == pytest.approx(p0["entry"] * 1.10)
    assert q0["stop_loss"] == pytest.approx(p0["stop_loss"] * 1.10)
    assert q0["take_profit"] == pytest.approx(p0["take_profit"] * 1.10)
    # The re-anchored levels stay coherent for a long.
    assert q0["stop_loss"] < q0["entry"] < q0["take_profit"]


def test_draft_thin_history_is_low_confidence(client, db_session: Session) -> None:
    _add_ticker_with_bars(db_session, "TINY", 12)
    strat = create_strategy(db_session, name="HED", automated=True, params=AUTO_PARAMS)

    resp = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "TINY"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["confident"] is False
    assert data["reason"]


def test_draft_rejects_manual_strategy(client, db_session: Session) -> None:
    _add_ticker_with_bars(db_session, "UP", 90)
    manual = create_strategy(db_session, name="Manual")  # automated defaults False

    resp = client.post(f"/api/strategies/{manual.id}/draft", json={"ticker": "UP"})
    assert resp.status_code == 400


def test_draft_unknown_strategy_404(client, db_session: Session) -> None:
    resp = client.post("/api/strategies/9999/draft", json={"ticker": "UP"})
    assert resp.status_code == 404
