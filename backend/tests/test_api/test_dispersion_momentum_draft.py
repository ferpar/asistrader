"""API-level tests for the dispersion-and-momentum engine: drafting, engine
catalog exposure, and seeding."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from asistrader.db.seed_strategies import seed_strategies
from asistrader.models.db import MarketData, Strategy, Ticker
from asistrader.services.strategy_service import create_strategy

DM_PARAMS = {
    "engine": "dispersion_momentum",
    "d2_range": [1, 10],
    "lookback_years": 100,
    "speed_slow_period": 20,
    "speed_fast_period": 5,
    "speed_weight_slow": 0.2,
    "dispersion_window": 15,
    "range_entry_coef": 0.0,
    "order_type_default": "market",
    "side_default": "long",
    "scales": ["drift", "range"],
    "range_target_coefs": [0.5, 1.0],
    "range_time_barriers": [3, 5, 10],
    "drift_speed_blends": [[[20, 1.0]], [[20, 0.5], [5, 0.5]], [[20, 0.2], [5, 0.8]]],
    "min_effective_samples": 30,
}


def _add_ticker_with_bars(db: Session, symbol: str, n: int) -> None:
    db.add(Ticker(symbol=symbol, name=symbol))
    start = date(2021, 1, 1)
    for i in range(n):
        close = 100.0 * (1.01**i)
        db.add(MarketData(
            ticker=symbol, date=start + timedelta(days=i),
            open=close, high=close * 1.005, low=close * 0.995, close=close,
        ))
    db.commit()


def test_dm_draft_returns_scale_tagged_presets(client, db_session: Session) -> None:
    _add_ticker_with_bars(db_session, "UP", 120)
    strat = create_strategy(db_session, name="DM", automated=True, params=DM_PARAMS)

    resp = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "UP"})
    assert resp.status_code == 200
    data = resp.json()

    assert data["confident"] is True
    assert data["speed"] is not None
    assert data["dispersion"] is not None
    assert len(data["presets"]) >= 1
    for p in data["presets"]:
        assert p["scale"] in {"drift", "range"}
        assert p["stop_loss"] < p["entry"] < p["take_profit"]  # long coherence
        assert p["target_coef"] is not None
    # The capital-efficient pick rides the clean trend via the drift scale.
    regular = next(p for p in data["presets"] if p["kind"] == "regular")
    assert regular["scale"] == "drift"

    # The full candidate landscape is returned (both scales), with the chosen
    # presets tagged on their candidates — so drift vs dispersion is comparable.
    cands = data["candidates"]
    assert len(cands) > len(data["presets"])
    assert {"drift", "range"} <= {c["scale"] for c in cands}
    assert any(c["preset_kind"] and "regular" in c["preset_kind"] for c in cands)

    # The speed-blend is swept: drift candidates carry a blend label and more than
    # one distinct blend appears across the landscape.
    drift_labels = {c["blend_label"] for c in cands if c["scale"] == "drift"}
    assert None not in drift_labels and len(drift_labels) >= 2
    drift_preset = next((p for p in data["presets"] if p["scale"] == "drift"), None)
    if drift_preset is not None:
        assert drift_preset["blend_label"]


def test_dm_draft_is_cached(client, db_session: Session) -> None:
    from asistrader.models.db import SweepResultCache

    _add_ticker_with_bars(db_session, "UP", 120)
    strat = create_strategy(db_session, name="DM", automated=True, params=DM_PARAMS)

    first = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "UP"}).json()
    assert db_session.query(SweepResultCache).filter_by(ticker="UP").count() == 1
    second = client.post(f"/api/strategies/{strat.id}/draft", json={"ticker": "UP"}).json()
    assert second == first
    assert db_session.query(SweepResultCache).filter_by(ticker="UP").count() == 1


def test_dm_engine_listed_with_blend_weight_field(client) -> None:
    resp = client.get("/api/strategies/engines")
    assert resp.status_code == 200
    engines = {e["id"]: e for e in resp.json()["engines"]}
    assert "dispersion_momentum" in engines
    keys = {f["key"] for f in engines["dispersion_momentum"]["fields"]}
    assert {"speed_weight_slow", "dispersion_window", "range_entry_coef"} <= keys


def test_seed_creates_both_strategies_idempotently(db_session: Session) -> None:
    result = seed_strategies(db_session)
    assert result == (2, 0)
    names = {s.name for s in db_session.query(Strategy).all()}
    assert {"Historical Expected Days", "Dispersion and Momentum"} <= names

    dm = db_session.query(Strategy).filter_by(name="Dispersion and Momentum").first()
    assert dm.params["engine"] == "dispersion_momentum"
    assert dm.params["scales"] == ["drift", "range"]
    assert dm.params["range_target_coefs"]  # structural params merged in

    assert seed_strategies(db_session) == (0, 0)  # idempotent, nothing to reconcile


def test_seed_backfills_missing_structural_params(db_session: Session) -> None:
    """A row seeded before a structural param existed gets it backfilled on re-seed,
    rather than silently keeping the stale config (the drift_speed_blends bug)."""
    seed_strategies(db_session)
    dm = db_session.query(Strategy).filter_by(name="Dispersion and Momentum").first()

    # Simulate a stale row: drop the blends (and corrupt a structural value) the way
    # a pre-blends seed would have left it. Reassign params so the change is tracked.
    stale = {k: v for k, v in dm.params.items() if k != "drift_speed_blends"}
    stale["range_target_coefs"] = [0.5]
    dm.params = stale
    db_session.commit()

    result = seed_strategies(db_session)
    assert result == (0, 1)  # nothing created, one row reconciled

    db_session.refresh(dm)
    assert dm.params["drift_speed_blends"] == [[[50, 1.0]], [[50, 0.5], [5, 0.5]], [[50, 0.2], [5, 0.8]]]
    assert dm.params["range_target_coefs"] == [0.3, 0.5, 0.8, 1.0]  # restored to canonical

    assert seed_strategies(db_session) == (0, 0)  # converged — idempotent again
