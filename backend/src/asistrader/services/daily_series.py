"""Business-day series helpers shared by the Portfolio history and the Basket Index.

Both walk every business day (Mon–Fri) of a range and read each instrument's
latest stored value on or before that day, so a market holiday carries the
last value forward.
"""

from collections.abc import Iterator
from datetime import date, timedelta

import numpy as np


def business_days(start: date, end: date) -> Iterator[date]:
    """Every Monday–Friday from `start` to `end`, inclusive."""
    day = start
    while day <= end:
        if day.weekday() < 5:
            yield day
        day += timedelta(days=1)


def business_days_after(earlier: date, later: date) -> int:
    """How many business days fall in (earlier, later]."""
    return int(np.busday_count(earlier + timedelta(days=1), later + timedelta(days=1)))


class CarriedSeries:
    """A dated series read on non-decreasing days: `at(day)` is the latest
    value on or before `day` (None before the first one), and `date` is the
    date of that value."""

    def __init__(self, points: list[tuple[date, float]]) -> None:
        self._points = points
        self._next = 0
        self._current: float | None = None
        self.date: date | None = None

    def at(self, day: date) -> float | None:
        while self._next < len(self._points) and self._points[self._next][0] <= day:
            self.date, self._current = self._points[self._next]
            self._next += 1
        return self._current
