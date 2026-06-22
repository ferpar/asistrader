"""Tests for the dispersion-and-momentum engine — the dual-scale candidate sweep
plus its candidate-native recommendation."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pytest

from asistrader.services.strategies import candidate_sweep as cs
from asistrader.services.strategies.historical_expected_days import SweepConfig, run_sweep
from asistrader.services.strategies.recommend import RecommendConfig, recommend_candidates


def _series(closes: list[float]):
    c = np.array(closes, dtype=float)
    o = np.concatenate([[c[0]], c[:-1]])
    h = c * 1.005
    low = c * 0.995
    dates = [date(2021, 1, 1) + timedelta(days=i) for i in range(len(c))]
    return o, h, low, c, dates


def _dual_scale_cfg(**kw) -> cs.CandidateSweepConfig:
    base = dict(
        scales=("drift", "range"),
        speed_windows=((20, 0.2), (5, 0.8)),
        vol_period=20,
        lookback_years=100,
        order_type="market",
        side="long",
        drift_time_barriers=tuple(range(1, 11)),
        dispersion_window=15,
        range_entry_coef=0.0,
        range_target_coefs=(0.5, 1.0),
        range_time_barriers=(3, 5, 10),
    )
    base.update(kw)
    return cs.CandidateSweepConfig(**base)


def test_dual_scale_sweep_evaluates_both_scales() -> None:
    rng = np.random.default_rng(5)
    closes = [100.0]
    for _ in range(140):
        closes.append(closes[-1] * (1.0 + 0.003 + rng.normal(0, 0.02)))
    o, h, low, c, dates = _series(closes)

    core = cs.run_candidate_sweep(o, h, low, c, dates, _dual_scale_cfg())

    scales = {cand.scale for cand in core.candidates}
    assert scales == {"drift", "range"}
    # Both scales actually produced trials (not just enumerated candidates).
    drift_trials = sum(st.n_trials for st in core.per_candidate if st.candidate.scale == "drift")
    range_trials = sum(st.n_trials for st in core.per_candidate if st.candidate.scale == "range")
    assert drift_trials > 0 and range_trials > 0
    # Per-scale fill rate is reported for each scale.
    assert set(core.scale_fill_rate) == {"drift", "range"}


def test_recommend_tags_each_preset_with_its_scale() -> None:
    rng = np.random.default_rng(8)
    closes = [100.0]
    for _ in range(160):
        closes.append(closes[-1] * (1.0 + 0.004 + rng.normal(0, 0.015)))
    o, h, low, c, dates = _series(closes)

    core = cs.run_candidate_sweep(o, h, low, c, dates, _dual_scale_cfg())
    rec = recommend_candidates(core, RecommendConfig(min_effective_samples=30, bootstrap_iterations=200, seed=1))

    assert {"regular", "conservative", "aggressive"} <= set(rec.presets)
    for preset in rec.presets.values():
        assert preset.scale in {"drift", "range"}
        assert preset.candidate.scale == preset.scale
        # Efficiency uses the per-scale fill-rate, which is carried on the preset.
        assert 0.0 <= preset.fill_rate <= 1.0


def test_strong_uptrend_prefers_drift_scale() -> None:
    # A clean steady uptrend: drift targets ride the trend, so the capital-efficient
    # (regular) preset should land on the drift scale.
    closes = [100.0 * (1.01**i) for i in range(150)]
    o, h, low, c, dates = _series(closes)

    core = cs.run_candidate_sweep(o, h, low, c, dates, _dual_scale_cfg())
    rec = recommend_candidates(core, RecommendConfig(min_effective_samples=30, bootstrap_iterations=200, seed=2))

    assert rec.confident is True
    assert rec.presets["regular"].scale == "drift"


def test_blend_variants_create_distinct_drift_geometries() -> None:
    rng = np.random.default_rng(4)
    closes = [100.0]
    for _ in range(120):
        closes.append(closes[-1] * (1.0 + 0.003 + rng.normal(0, 0.02)))
    o, h, low, c, dates = _series(closes)

    cfg = cs.CandidateSweepConfig(
        scales=("drift",), vol_period=20, lookback_years=100, order_type="market",
        drift_time_barriers=(3, 5, 10),
        drift_speed_blends=(((20, 1.0),), ((20, 0.5), (5, 0.5)), ((5, 1.0),)),
    )
    core = cs.run_candidate_sweep(o, h, low, c, dates, cfg)

    drift = [cand for cand in core.candidates if cand.scale == "drift"]
    assert len(drift) == 3 * 3  # 3 blends × 3 horizons
    assert len({cand.blend_label for cand in drift}) == 3  # three distinct blends
    # Each blend is its own entry geometry → its own fill-rate.
    assert len(core.geometry_fill_rate) == 3


def test_smooth_blend_within_a_sweep_matches_hed() -> None:
    # Adding more blends must not perturb the smooth-50d blend's candidates — they
    # must equal a standalone HED run at the same single window (geometry isolation).
    rng = np.random.default_rng(9)
    closes = [100.0]
    for _ in range(130):
        closes.append(closes[-1] * (1.0 + 0.004 + rng.normal(0, 0.02)))
    o, h, low, c, dates = _series(closes)

    hed = run_sweep(o, h, low, c, dates, SweepConfig(
        speed_period=20, d2_min=1, d2_max=6, lookback_years=100, order_type="market", side="long",
    ))
    core = cs.run_candidate_sweep(o, h, low, c, dates, cs.CandidateSweepConfig(
        scales=("drift",), vol_period=20, lookback_years=100, order_type="market", side="long",
        drift_time_barriers=tuple(range(1, 7)),
        drift_speed_blends=(((20, 1.0),), ((20, 0.2), (5, 0.8))),  # smooth + reactive
    ))

    smooth = {
        cand.time_barrier: st
        for cand, st in zip(core.candidates, core.per_candidate)
        if cand.blend_label == "smooth 20d"
    }
    for s in hed.per_d2:
        st = smooth[s.d2]
        assert st.n_trials == s.n_trials
        assert st.n_win == s.n_win
        if s.win_rate is not None:
            assert st.win_rate == pytest.approx(s.win_rate)


def test_draft_prices_for_candidate_is_coherent_per_scale() -> None:
    drift = cs.Candidate(0, "drift", entry_coef=1.0, target_coef=5.0, time_barrier=5)
    rng = cs.Candidate(1, "range", entry_coef=0.25, target_coef=0.5, time_barrier=10)

    dp = cs.draft_prices_for_candidate(100.0, 0.01, 0.08, drift, plr=1.5, side="long", order_type="limit")
    rp = cs.draft_prices_for_candidate(100.0, 0.01, 0.08, rng, plr=1.5, side="long", order_type="limit")

    for prices in (dp, rp):
        assert prices is not None
        assert prices["stop_loss"] < prices["entry"] < prices["take_profit"]
    # Missing unit -> no draft (e.g. range scale with no dispersion).
    assert cs.draft_prices_for_candidate(100.0, 0.01, None, rng, 1.5, "long", "limit") is None
