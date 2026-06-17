"""Tests for the POST /api/strategies/{id}/draft endpoint (Phase 3)."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from asistrader.models.db import MarketData, SweepResultCache, Ticker
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
