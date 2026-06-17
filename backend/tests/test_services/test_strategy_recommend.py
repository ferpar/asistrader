"""Tests for the preset recommendation & gating (Phase 2)."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from asistrader.services.strategies.historical_expected_days import SweepConfig, run_sweep
from asistrader.services.strategies.recommend import RecommendConfig, recommend


def _series(closes: list[float]):
    c = np.array(closes, dtype=float)
    o = np.concatenate([[c[0]], c[:-1]])
    h = c * 1.005
    low = c * 0.995
    dates = [date(2021, 1, 1) + timedelta(days=i) for i in range(len(c))]
    return o, h, low, c, dates


def _uptrend_sweep(n: int = 90, **cfg_kw):
    closes = [100.0 * (1.01**i) for i in range(n)]
    o, h, low, c, dates = _series(closes)
    cfg = SweepConfig(
        speed_period=5, d2_min=1, d2_max=6, lookback_years=100,
        order_type="market", side="long", **cfg_kw,
    )
    return run_sweep(o, h, low, c, dates, cfg)


def test_strong_uptrend_is_confident() -> None:
    sweep = _uptrend_sweep(n=90)
    rec = recommend(sweep, RecommendConfig(min_effective_samples=30, bootstrap_iterations=200, seed=1))

    assert rec.confident is True
    assert rec.reason is None
    assert {"regular", "conservative", "aggressive"} <= set(rec.presets)
    # Aggressive is the shortest acceptable horizon, so <= the others.
    assert rec.presets["aggressive"].d2 <= rec.presets["regular"].d2
    assert rec.presets["aggressive"].d2 <= rec.presets["conservative"].d2
    # The regular preset's win-rate CI lower bound clears the break-even floor.
    reg = rec.presets["regular"]
    assert reg.win_rate_ci is not None and reg.win_rate_ci[0] > rec.breakeven_win_rate
    assert reg.efficiency is not None and reg.efficiency > 0


def test_thin_history_is_low_confidence() -> None:
    closes = [100.0 * (1.01**i) for i in range(12)]  # too few bars for >=30 trials
    o, h, low, c, dates = _series(closes)
    cfg = SweepConfig(speed_period=5, d2_min=1, d2_max=3, lookback_years=100, order_type="market", side="long")
    sweep = run_sweep(o, h, low, c, dates, cfg)

    rec = recommend(sweep, RecommendConfig(min_effective_samples=30))
    assert rec.confident is False
    assert rec.reason is not None and "Not enough history" in rec.reason


def test_never_fill_reports_fill_reason() -> None:
    # Buy-limit below a strictly rising market never triggers.
    closes = [100.0 * (1.01**i) for i in range(90)]
    o, h, low, c, dates = _series(closes)
    cfg = SweepConfig(speed_period=5, d2_min=1, d2_max=3, lookback_years=100, order_type="limit", side="long")
    sweep = run_sweep(o, h, low, c, dates, cfg)

    rec = recommend(sweep, RecommendConfig(min_effective_samples=30))
    assert rec.confident is False
    assert rec.reason is not None and "filled" in rec.reason.lower()


def test_high_margin_requirement_rejects_a_marginal_edge() -> None:
    # Same confident uptrend, but demand an implausibly large margin over
    # break-even -> the gate rejects and we fall back to low confidence.
    sweep = _uptrend_sweep(n=90)
    rec = recommend(sweep, RecommendConfig(min_effective_samples=30, min_margin_over_breakeven=0.95, bootstrap_iterations=200))
    assert rec.confident is False
    # Even when not confident, all three best-effort presets are surfaced (with a
    # reason) so the user can compare — not just a lone "regular".
    assert {"regular", "conservative", "aggressive"} <= set(rec.presets)
    assert rec.reason is not None
