"""Tests for the generalized speed/dispersion primitives.

These feed the dispersion-and-momentum engine: a blended fast/slow drift and a
trailing high-low range. Both are point-in-time (no lookahead), mirroring the
existing `avg_change_pct` conventions.
"""

from __future__ import annotations

import numpy as np
import pytest

from asistrader.services.strategies.speed import (
    blended_speed,
    dispersion_pct,
    trailing_avg_change_pct,
)


# ----------------------------------------------------------------- blended_speed


def test_single_window_reduces_to_trailing() -> None:
    closes = [100.0 * (1.01**i) for i in range(20)]
    t = 15
    assert blended_speed(closes, t, [[5, 1.0]]) == pytest.approx(
        trailing_avg_change_pct(closes, t, 5)
    )


def test_blend_is_weighted_mean_of_components() -> None:
    closes = [100.0, 101.0, 103.0, 102.0, 105.0, 109.0, 108.0, 112.0]
    t = 7
    slow = trailing_avg_change_pct(closes, t, 50)
    fast = trailing_avg_change_pct(closes, t, 3)
    expected = 0.2 * slow + 0.8 * fast  # weights sum to 1
    assert blended_speed(closes, t, [[50, 0.2], [3, 0.8]]) == pytest.approx(expected)


def test_blend_renormalizes_when_a_component_is_unavailable() -> None:
    # At t=1 only a 1-bar window is computable; a 5-bar window returns None and is
    # dropped, so the blend equals the surviving component (weights renormalize).
    closes = [100.0, 110.0]
    t = 1
    fast = trailing_avg_change_pct(closes, t, 1)
    assert blended_speed(closes, t, [[5, 0.2], [1, 0.8]]) == pytest.approx(fast)


def test_blend_all_unavailable_is_none() -> None:
    assert blended_speed([100.0], 0, [[5, 0.5], [2, 0.5]]) is None


def test_blended_speed_is_point_in_time() -> None:
    closes = [100.0, 101.0, 102.5, 101.5, 104.0, 106.0, 105.0]
    t = 4
    base = blended_speed(closes, t, [[50, 0.2], [3, 0.8]])
    with_future = blended_speed(closes + [999.0, 1.0], t, [[50, 0.2], [3, 0.8]])
    assert base == pytest.approx(with_future)


# ----------------------------------------------------------------- dispersion_pct


def test_dispersion_is_range_over_price() -> None:
    highs = np.array([10.0, 12.0, 11.0, 13.0])
    lows = np.array([9.0, 9.5, 8.0, 10.0])
    closes = np.array([9.5, 11.0, 10.0, 12.0])
    # Over all 4 bars: max high 13, min low 8 -> range 5; price = last close 12.
    assert dispersion_pct(highs, lows, closes, 3, 30) == pytest.approx(5.0 / 12.0)


def test_dispersion_window_is_trailing() -> None:
    highs = np.array([100.0, 50.0, 51.0, 52.0])
    lows = np.array([99.0, 49.0, 50.0, 51.0])
    closes = np.array([99.5, 49.5, 50.5, 51.5])
    # Window 2 ending at idx 3 -> bars [52,51] only: range = 52 - 50 = 2; the
    # huge early bar at idx 0 is outside the window.
    assert dispersion_pct(highs, lows, closes, 3, 2) == pytest.approx(2.0 / 51.5)


def test_dispersion_is_point_in_time() -> None:
    highs = [10.0, 11.0, 12.0, 11.5]
    lows = [9.0, 9.5, 10.0, 10.5]
    closes = [9.5, 10.5, 11.0, 11.0]
    base = dispersion_pct(highs, lows, closes, 2, 30)
    with_future = dispersion_pct(highs + [999.0], lows + [0.1], closes + [500.0], 2, 30)
    assert base == pytest.approx(with_future)


def test_dispersion_too_short_or_bad_price_is_none() -> None:
    assert dispersion_pct([10.0], [9.0], [9.5], 0, 30) is None
    assert dispersion_pct([10.0, 11.0], [9.0, 9.5], [0.0, 0.0], 1, 30) is None
