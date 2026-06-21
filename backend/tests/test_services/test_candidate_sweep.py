"""Tests for the generalized candidate sweep core.

Two concerns: (1) the drift-only path reproduces `historical_expected_days`
exactly (the equivalence lock that lets HED delegate later), and (2) the range
scale produces sane candidates and a per-scale fill-rate.
"""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pytest

from asistrader.services.strategies import candidate_sweep as cs
from asistrader.services.strategies.historical_expected_days import SweepConfig, run_sweep


def _series(closes: list[float]):
    c = np.array(closes, dtype=float)
    o = np.concatenate([[c[0]], c[:-1]])
    h = c * 1.005
    low = c * 0.995
    dates = [date(2021, 1, 1) + timedelta(days=i) for i in range(len(c))]
    return o, h, low, c, dates


def _drift_cfg_like(hed: SweepConfig) -> cs.CandidateSweepConfig:
    """A drift-only candidate config geometrically identical to a HED SweepConfig."""
    return cs.CandidateSweepConfig(
        plr=hed.plr,
        side=hed.side,
        order_type=hed.order_type,
        time_in_effect=hed.time_in_effect,
        lookback_years=hed.lookback_years,
        min_risk_vol_mult=hed.min_risk_vol_mult,
        vol_period=hed.speed_period,
        scales=("drift",),
        speed_windows=((hed.speed_period, 1.0),),
        drift_d1=hed.d1,
        drift_time_barriers=tuple(range(hed.d2_min, hed.d2_max + 1)),
    )


# --------------------------------------------------------------- equivalence lock


@pytest.mark.parametrize("order_type", ["market", "limit", "stop"])
def test_drift_only_matches_hed(order_type) -> None:
    # A noisy uptrend so fills, wins, losses and timeouts all occur.
    rng = np.random.default_rng(7)
    closes = [100.0]
    for _ in range(120):
        closes.append(closes[-1] * (1.0 + 0.004 + rng.normal(0, 0.02)))
    o, h, low, c, dates = _series(closes)

    hed_cfg = SweepConfig(
        speed_period=5, d2_min=1, d2_max=6, lookback_years=100,
        order_type=order_type, side="long",
    )
    hed = run_sweep(o, h, low, c, dates, hed_cfg)
    core = cs.run_candidate_sweep(o, h, low, c, dates, _drift_cfg_like(hed_cfg))

    # Same overall fill behaviour (HED's single fill-rate == drift scale's).
    assert core.scale_fill_rate["drift"] == pytest.approx(hed.fill_rate)

    by_tb = {cand.time_barrier: st for cand, st in zip(core.candidates, core.per_candidate)}
    for s in hed.per_d2:
        st = by_tb[s.d2]
        assert st.n_trials == s.n_trials
        assert st.n_win == s.n_win
        assert st.n_loss == s.n_loss
        assert st.n_timeout == s.n_timeout
        if s.win_rate is None:
            assert st.win_rate is None
        else:
            assert st.win_rate == pytest.approx(s.win_rate)
            assert st.expectancy == pytest.approx(s.expectancy)


def test_drift_buy_limit_below_rising_never_fills() -> None:
    closes = [100.0 * (1.01**i) for i in range(70)]
    o, h, low, c, dates = _series(closes)
    cfg = cs.CandidateSweepConfig(
        scales=("drift",), speed_windows=((5, 1.0),), vol_period=5,
        drift_time_barriers=(1, 2, 3), lookback_years=100, order_type="limit",
    )
    res = cs.run_candidate_sweep(o, h, low, c, dates, cfg)
    assert res.scale_fill_rate["drift"] == 0.0
    assert all(st.n_trials == 0 for st in res.per_candidate)


# ------------------------------------------------------------------- range scale


def test_range_scale_produces_trials_and_fill_rate() -> None:
    # A choppy, ~flat series: drift ~ 0 but dispersion is real, so the range scale
    # is where the action is.
    rng = np.random.default_rng(3)
    closes = [100.0]
    for _ in range(160):
        closes.append(closes[-1] * (1.0 + rng.normal(0, 0.02)))
    o, h, low, c, dates = _series(closes)

    cfg = cs.CandidateSweepConfig(
        scales=("range",), vol_period=20, lookback_years=100,
        order_type="market", side="long",
        dispersion_window=30, range_entry_coef=0.0,
        range_target_coefs=(0.5, 1.0), range_time_barriers=(5, 10, 20),
    )
    res = cs.run_candidate_sweep(o, h, low, c, dates, cfg)

    assert len(res.candidates) == 2 * 3  # target_coefs × time_barriers
    assert all(cand.scale == "range" for cand in res.candidates)
    assert res.scale_fill_rate["range"] == pytest.approx(1.0)  # market always fills
    assert sum(st.n_trials for st in res.per_candidate) > 0


def test_both_scales_enabled_yields_both_fill_rates() -> None:
    rng = np.random.default_rng(11)
    closes = [100.0]
    for _ in range(160):
        closes.append(closes[-1] * (1.0 + 0.002 + rng.normal(0, 0.02)))
    o, h, low, c, dates = _series(closes)

    cfg = cs.CandidateSweepConfig(
        scales=("drift", "range"), speed_windows=((50, 0.2), (5, 0.8)), vol_period=50,
        lookback_years=100, order_type="market", side="long",
        drift_time_barriers=tuple(range(1, 11)),
        range_target_coefs=(0.5, 1.0), range_time_barriers=(5, 10, 20),
    )
    res = cs.run_candidate_sweep(o, h, low, c, dates, cfg)
    assert set(res.scale_fill_rate) == {"drift", "range"}
    scales_present = {cand.scale for cand in res.candidates}
    assert scales_present == {"drift", "range"}
