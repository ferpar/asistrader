"""Tests for the historical-expected-days sweep engine (Phase 1).

Covers the speed operator (incl. no-lookahead), the frictionless barrier kernel,
its parity with the live SL/TP detector at margin=0, and the sweep driver
(fill-gate, win recording, large-D2 sample shrinkage).
"""

from __future__ import annotations

from datetime import date, timedelta
from types import SimpleNamespace

import numpy as np
import pytest

from asistrader.services.sltp_detection_service import SLTPHitType, check_sltp_hit_for_day
from asistrader.services.strategies import barriers
from asistrader.services.strategies.historical_expected_days import SweepConfig, run_sweep
from asistrader.services.strategies.speed import avg_change_pct, trailing_avg_change_pct


# --------------------------------------------------------------------------- speed


def test_avg_change_pct_matches_manual() -> None:
    # Three closes each +10% -> mean per-bar change 0.10.
    assert avg_change_pct([100.0, 110.0, 121.0], 50) == pytest.approx(0.10)


def test_avg_change_pct_too_short_is_none() -> None:
    assert avg_change_pct([100.0], 50) is None
    assert avg_change_pct([], 50) is None


def test_avg_change_pct_skips_zero_prev() -> None:
    # The step from 0 -> 5 is skipped; only 5 -> 10 (=1.0) counts.
    assert avg_change_pct([0.0, 5.0, 10.0], 50) == pytest.approx(1.0)


def test_trailing_is_point_in_time() -> None:
    closes = [100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0, 107.0]
    t = 4
    # Trailing at t equals the average over only closes[: t+1] ...
    assert trailing_avg_change_pct(closes, t, 3) == pytest.approx(
        avg_change_pct(closes[: t + 1], 3)
    )
    # ... and appending future bars must not change the value at t (no lookahead).
    base = trailing_avg_change_pct(closes, t, 3)
    with_future = trailing_avg_change_pct(closes + [200.0, 50.0, 999.0], t, 3)
    assert base == pytest.approx(with_future)


# ------------------------------------------------------------------------- barriers


def _win_window_long():
    # Rises into TP without touching SL.
    o = np.array([100.0, 105.0, 111.0])
    h = np.array([102.0, 108.0, 112.0])
    low = np.array([99.5, 104.0, 110.0])
    c = np.array([101.0, 107.0, 111.5])
    return o, h, low, c


def test_long_win_at_first_tp_touch() -> None:
    o, h, low, c = _win_window_long()
    res = barriers.evaluate(True, 100.0, 95.0, 108.0, o, h, low, c)
    assert res.outcome == barriers.WIN
    assert res.exit_idx == 1  # high 108 >= tp 108 on bar 1
    assert res.exit_price == pytest.approx(108.0)


def test_long_loss() -> None:
    o = np.array([100.0, 98.0])
    h = np.array([101.0, 99.0])
    low = np.array([97.0, 94.0])
    c = np.array([99.0, 95.0])
    res = barriers.evaluate(True, 100.0, 95.0, 120.0, o, h, low, c)
    assert res.outcome == barriers.LOSS
    assert res.exit_price == pytest.approx(95.0)


def test_timeout_marks_to_close() -> None:
    o = np.array([100.0, 100.0, 100.0])
    h = np.array([101.0, 101.0, 101.0])
    low = np.array([99.0, 99.0, 99.0])
    c = np.array([100.0, 100.5, 100.2])
    res = barriers.evaluate(True, 100.0, 90.0, 120.0, o, h, low, c)
    assert res.outcome == barriers.TIMEOUT
    assert res.exit_idx == 2
    assert res.exit_price == pytest.approx(100.2)


def test_same_bar_tiebreak_open_distance() -> None:
    # One bar pierces both barriers; the open decides the winner.
    h = np.array([111.0])
    low = np.array([94.0])
    c = np.array([100.0])
    # Open near SL (95) -> SL assumed first -> loss.
    res_sl = barriers.evaluate(True, 100.0, 95.0, 110.0, np.array([96.0]), h, low, c)
    assert res_sl.outcome == barriers.LOSS
    # Open near TP (110) -> win.
    res_tp = barriers.evaluate(True, 100.0, 95.0, 110.0, np.array([109.0]), h, low, c)
    assert res_tp.outcome == barriers.WIN
    # Missing open -> SL wins (matches live detector default).
    res_nan = barriers.evaluate(True, 100.0, 95.0, 110.0, np.array([np.nan]), h, low, c)
    assert res_nan.outcome == barriers.LOSS


def test_short_win_and_loss() -> None:
    # Short: sl > entry, tp < entry. Falls into TP.
    o = np.array([100.0, 92.0])
    h = np.array([101.0, 93.0])
    low = np.array([98.0, 89.0])
    c = np.array([99.0, 90.0])
    res = barriers.evaluate(False, 100.0, 105.0, 90.0, o, h, low, c)
    assert res.outcome == barriers.WIN
    assert res.exit_price == pytest.approx(90.0)


# -------------------------------------------------------------------------- parity


@pytest.mark.parametrize(
    "is_long, entry, sl, tp",
    [(True, 100.0, 95.0, 110.0), (False, 100.0, 105.0, 90.0)],
)
@pytest.mark.parametrize(
    "high, low, bar_open",
    [
        (111.0, 99.0, 100.0),  # long: TP only / short: SL only
        (101.0, 94.0, 97.0),   # long: SL only / short: TP only
        (101.0, 99.0, 100.0),  # neither
        (111.0, 94.0, 96.0),   # both (open near SL)
        (111.0, 94.0, 109.0),  # both (open near TP)
    ],
)
def test_kernel_parity_with_live_detector(is_long, entry, sl, tp, high, low, bar_open) -> None:
    """barriers.evaluate must agree with check_sltp_hit_for_day at margin=0."""
    trade = SimpleNamespace(entry_price=entry, stop_loss=sl, take_profit=tp)
    bar = SimpleNamespace(high=high, low=low, open=bar_open)
    live = check_sltp_hit_for_day(trade, bar, margin=0.0)

    res = barriers.evaluate(
        is_long, entry, sl, tp,
        np.array([bar_open]), np.array([high]), np.array([low]), np.array([(high + low) / 2]),
    )

    if live is None:
        assert res.outcome == barriers.TIMEOUT
    elif live == SLTPHitType.TP:
        assert res.outcome == barriers.WIN
    elif live == SLTPHitType.SL:
        assert res.outcome == barriers.LOSS
    else:  # BOTH -> kernel resolves by open-distance; check it matches the tiebreak
        sl_wins = abs(bar_open - sl) <= abs(bar_open - tp)
        assert res.outcome == (barriers.LOSS if sl_wins else barriers.WIN)


# --------------------------------------------------------------------------- sweep


def _series(closes: list[float]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[date]]:
    c = np.array(closes, dtype=float)
    o = np.concatenate([[c[0]], c[:-1]])  # open = prior close
    h = c * 1.005
    low = c * 0.995
    dates = [date(2021, 1, 1) + timedelta(days=i) for i in range(len(c))]
    return o, h, low, c, dates


def test_buy_limit_below_a_rising_market_never_fills() -> None:
    closes = [100.0 * (1.01**i) for i in range(70)]  # strictly rising
    o, h, low, c, dates = _series(closes)
    cfg = SweepConfig(speed_period=5, d2_min=1, d2_max=3, lookback_years=100, order_type="limit", side="long")
    res = run_sweep(o, h, low, c, dates, cfg)
    assert res.n_attempts > 0
    assert res.n_filled == 0
    assert res.fill_rate == 0.0


def test_market_long_in_uptrend_fills_and_wins() -> None:
    closes = [100.0 * (1.01**i) for i in range(70)]
    o, h, low, c, dates = _series(closes)
    cfg = SweepConfig(speed_period=5, d2_min=1, d2_max=3, lookback_years=100, order_type="market", side="long")
    res = run_sweep(o, h, low, c, dates, cfg)
    assert res.fill_rate == pytest.approx(1.0)
    total_win = sum(s.n_win for s in res.per_d2)
    assert total_win > 0
    # D2=1 in a steady uptrend should win essentially every filled trial.
    d2_1 = next(s for s in res.per_d2 if s.d2 == 1)
    assert d2_1.win_rate is not None and d2_1.win_rate > 0.9


def test_volatility_floor_drops_degenerate_short_horizons() -> None:
    # A volatile series (alternating ±2% on a mild uptrend) so daily vol > 0.
    # At D2=1 the target is tiny vs daily vol, so the floor should exclude it;
    # with the floor off (mult=0) those trials are kept.
    closes = [100.0 * (1.003**i) * (1.0 + (0.02 if i % 2 else -0.02)) for i in range(80)]
    o, h, low, c, dates = _series(closes)

    floored = run_sweep(o, h, low, c, dates, SweepConfig(
        speed_period=5, d2_min=1, d2_max=8, lookback_years=100,
        order_type="market", side="long", min_risk_vol_mult=1.0,
    ))
    unfloored = run_sweep(o, h, low, c, dates, SweepConfig(
        speed_period=5, d2_min=1, d2_max=8, lookback_years=100,
        order_type="market", side="long", min_risk_vol_mult=0.0,
    ))

    d2_1_floored = next(s for s in floored.per_d2 if s.d2 == 1).n_trials
    d2_1_unfloored = next(s for s in unfloored.per_d2 if s.d2 == 1).n_trials
    # The floor removes the degenerate 1-day trials that the unfloored sweep keeps.
    assert d2_1_unfloored > 0
    assert d2_1_floored < d2_1_unfloored


def test_large_d2_has_no_more_trials_than_small_d2() -> None:
    closes = [100.0 * (1.01**i) for i in range(70)]
    o, h, low, c, dates = _series(closes)
    cfg = SweepConfig(speed_period=5, d2_min=1, d2_max=5, lookback_years=100, order_type="market", side="long")
    res = run_sweep(o, h, low, c, dates, cfg)
    counts = [s.n_trials for s in res.per_d2]
    # Larger D2 needs more forward bars, so trial counts are non-increasing.
    assert counts == sorted(counts, reverse=True)
    assert counts[0] >= counts[-1]
