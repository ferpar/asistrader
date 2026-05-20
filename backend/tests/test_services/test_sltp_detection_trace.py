"""Tests for the diagnostic trace returned by `*_with_trace` detectors.

The trace exists so the CLI (`asistrader.cli.detect`) and humans bisecting a
weird alert can see, bar-by-bar, what the detector evaluated and why a date
won. These tests pin the trace shape and assert the gap/intraday/no-data
classifications.
"""

from datetime import date

from sqlalchemy.orm import Session

from asistrader.models.db import (
    ExitLevel,
    ExitLevelStatus,
    ExitLevelType,
    MarketData,
    OrderType,
    Strategy,
    Ticker,
    Trade,
    TradeStatus,
    User,
)
from asistrader.models.schemas import HitKind, SLTPHitType
from asistrader.services.sltp_detection_service import (
    detect_entry_hit_with_trace,
    detect_layered_hits_with_trace,
    detect_sltp_hit_with_trace,
)


import pytest


@pytest.fixture
def ordered_long_limit(
    db_session: Session,
    sample_ticker: Ticker,
    sample_strategy: Strategy,
    sample_user: User,
) -> Trade:
    """Long limit order: fills when price falls to entry."""
    trade = Trade(
        ticker=sample_ticker.symbol, status=TradeStatus.ORDERED,
        amount=10000, units=100, entry_price=100.0,
        date_planned=date(2025, 1, 15), order_type=OrderType.LIMIT,
        strategy_id=sample_strategy.id, user_id=sample_user.id,
    )
    db_session.add(trade)
    db_session.commit()
    db_session.add_all([
        ExitLevel(trade_id=trade.id, level_type=ExitLevelType.SL, price=95,
                  units_pct=1, order_index=1, status=ExitLevelStatus.PENDING),
        ExitLevel(trade_id=trade.id, level_type=ExitLevelType.TP, price=115,
                  units_pct=1, order_index=1, status=ExitLevelStatus.PENDING),
    ])
    db_session.commit()
    db_session.refresh(trade)
    return trade


def _add_bar(
    db: Session,
    ticker: Ticker,
    bar_date: date,
    *,
    open: float,
    high: float,
    low: float,
    close: float,
) -> MarketData:
    bar = MarketData(
        ticker=ticker.symbol, date=bar_date,
        open=open, high=high, low=low, close=close,
        volume=1_000_000.0,
    )
    db.add(bar)
    db.commit()
    return bar


class TestSLTPTraceShape:
    """Trace records each scanned bar with checks and a decision."""

    def test_no_market_data_after_open(
        self, db_session: Session, sample_trade: Trade
    ) -> None:
        hit, trace = detect_sltp_hit_with_trace(db_session, sample_trade)
        assert hit is None
        assert trace.kind == "sltp"
        assert trace.side == "long"
        assert trace.trade_id == sample_trade.id
        assert trace.bars == []
        assert trace.bars_scanned == 0
        assert "no hit" in trace.verdict

    def test_skip_bar_records_both_checks(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ) -> None:
        # sample_trade: long, SL=95, TP=115, date_actual=2025-01-16
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=101, low=99, close=100,
        )

        hit, trace = detect_sltp_hit_with_trace(db_session, sample_trade)
        assert hit is None
        assert len(trace.bars) == 1
        bar = trace.bars[0]
        assert bar.decision == "skip"
        assert {c.kind for c in bar.checks} == {"sl", "tp"}
        sl = next(c for c in bar.checks if c.kind == "sl")
        tp = next(c for c in bar.checks if c.kind == "tp")
        assert not sl.pierced and not tp.pierced

    def test_intraday_touch_is_marked_as_such(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ) -> None:
        # Bar opens flat then dips to pierce SL — classic intraday touch.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=101, low=90, close=96,
        )

        hit, trace = detect_sltp_hit_with_trace(db_session, sample_trade)
        assert hit is not None and hit.hit_type == SLTPHitType.SL
        # Intraday fill: hit_price is the SL level itself (95), not the bar's low.
        assert hit.hit_kind == HitKind.INTRADAY
        assert hit.hit_price == 95
        bar = trace.bars[-1]
        assert bar.decision == "hit"
        assert bar.chosen_keys == ["sl"]
        assert bar.reason == "intraday_touch"
        sl = next(c for c in bar.checks if c.kind == "sl")
        assert sl.pierced is True
        assert sl.gap is False

    def test_gap_open_past_level_is_flagged(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ) -> None:
        # Bar before open day closes flat at 100; next scanned bar gaps down,
        # opening at 90 — below SL threshold of ~94.525. That's a gap.
        _add_bar(
            db_session, sample_ticker, sample_trade.date_actual,
            open=100, high=101, low=99, close=100,
        )
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=90, high=91, low=88, close=89,
        )

        hit, trace = detect_sltp_hit_with_trace(db_session, sample_trade)
        assert hit is not None and hit.hit_type == SLTPHitType.SL
        # Gap fill: hit_price is the bar's open (90), not the SL level (95).
        assert hit.hit_kind == HitKind.GAP
        assert hit.hit_price == 90
        assert hit.bar_open == 90
        assert hit.prev_close == 100
        bar = trace.bars[-1]
        assert bar.decision == "hit"
        assert bar.reason == "gap_open_past_level"
        assert bar.prev_close == 100
        sl = next(c for c in bar.checks if c.kind == "sl")
        assert sl.pierced is True
        assert sl.gap is True

    def test_both_pierced_resolved_by_open_distance(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ) -> None:
        # Bar's range spans both SL=95 and TP=115. Open=100, equidistant
        # from SL=95 (5 away) and TP=115 (15 away) — SL is closer.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=120, low=90, close=100,
        )

        hit, trace = detect_sltp_hit_with_trace(db_session, sample_trade)
        assert hit is not None
        # Open at 100 is closer to SL=95 than to TP=115 → SL wins.
        assert hit.hit_type == SLTPHitType.SL
        assert hit.also_would_have_hit == ["tp"]
        bar = trace.bars[-1]
        assert bar.decision == "hit"
        assert bar.chosen_keys[0] == "sl"
        assert "open_closer_to_sl" in bar.reason

    def test_both_pierced_tp_wins_when_open_closer(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ) -> None:
        # Open=113 — much closer to TP=115 than to SL=95 → TP wins.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=113, high=120, low=90, close=100,
        )
        hit, _ = detect_sltp_hit_with_trace(db_session, sample_trade)
        assert hit is not None
        assert hit.hit_type == SLTPHitType.TP
        assert hit.also_would_have_hit == ["sl"]

    def test_no_data_bar_records_decision(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker
    ) -> None:
        # Bar with no high/low (e.g. holiday placeholder) is skipped without
        # piercing checks but appears in the trace as no_data.
        bar = MarketData(
            ticker=sample_ticker.symbol, date=date(2025, 1, 17),
            open=None, high=None, low=None, close=None, volume=None,
        )
        db_session.add(bar)
        db_session.commit()

        hit, trace = detect_sltp_hit_with_trace(db_session, sample_trade)
        assert hit is None
        assert len(trace.bars) == 1
        assert trace.bars[0].decision == "no_data"
        assert trace.bars[0].reason == "missing_ohlc"
        assert trace.bars[0].checks == []

    def test_short_trade_sl_above_entry(
        self,
        db_session: Session,
        sample_layered_short_trade: Trade,
        sample_ticker: Ticker,
    ) -> None:
        # short: SL is above entry. Convert to simple-shape by treating the
        # weighted TP and the single SL via the model's properties.
        # sample_layered_short_trade is layered but trace side detection only
        # cares about sl/entry relationship — keep this as a smoke check.
        hit, trace = detect_sltp_hit_with_trace(
            db_session, sample_layered_short_trade
        )
        # Whether or not a hit fires depends on fixtures; assert side wiring.
        assert trace.side == "short"


class TestAsymmetricMargin:
    """Margin suppresses intraday grazes but never gap fills."""

    def test_gap_at_exact_level_is_still_a_hit(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker,
    ) -> None:
        # prev_close=100 (above SL=95); next bar opens AT 95.0 — no margin
        # penetration, but a gap fill (price was above, now at the level).
        _add_bar(
            db_session, sample_ticker, sample_trade.date_actual,
            open=100, high=101, low=99, close=100,
        )
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=95, high=95.5, low=95, close=95.2,
        )

        hit, _ = detect_sltp_hit_with_trace(db_session, sample_trade)
        assert hit is not None
        assert hit.hit_kind == HitKind.GAP
        # Gap fill at the bar's open (95), not at the margin-buffered
        # threshold — the margin doesn't apply to gap hits.
        assert hit.hit_price == 95

    def test_intraday_graze_within_margin_still_suppressed(
        self, db_session: Session, sample_trade: Trade, sample_ticker: Ticker,
    ) -> None:
        # SL=95, margin=0.005 → threshold 94.525. Low at 94.7 grazes
        # without piercing; not a hit.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=99, high=100, low=94.7, close=98,
        )
        hit, _ = detect_sltp_hit_with_trace(db_session, sample_trade)
        assert hit is None


class TestEntryTraceShape:
    """`detect_entry_hit_with_trace` records the same structure for orders."""

    def test_long_limit_intraday_touch(
        self,
        db_session: Session,
        ordered_long_limit: Trade,
        sample_ticker: Ticker,
    ) -> None:
        # Long limit at 100 fills on a dip. Day after order: range 99-105
        # → low (99) penetrates 100*(1-0.005)=99.5.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 16),
            open=104, high=105, low=99, close=100,
        )

        hit, trace = detect_entry_hit_with_trace(db_session, ordered_long_limit)
        assert hit is not None
        assert trace.kind == "entry"
        assert trace.extras["fills_on_rise"] is False
        bar = trace.bars[-1]
        assert bar.decision == "hit"
        assert bar.chosen_keys == ["entry"]
        assert bar.reason == "intraday_touch"

    def test_long_limit_gap_below_entry(
        self,
        db_session: Session,
        ordered_long_limit: Trade,
        sample_ticker: Ticker,
    ) -> None:
        # Prior bar closes at 102 (above entry), next bar gaps down opening at
        # 95 — the limit fills via gap, not intraday touch.
        _add_bar(
            db_session, sample_ticker, ordered_long_limit.date_planned,
            open=102, high=103, low=101, close=102,
        )
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 16),
            open=95, high=96, low=94, close=95,
        )

        hit, trace = detect_entry_hit_with_trace(db_session, ordered_long_limit)
        assert hit is not None
        bar = trace.bars[-1]
        assert bar.reason == "gap_open_past_level"
        assert bar.prev_close == 102
        entry_check = bar.checks[0]
        assert entry_check.gap is True


class TestLayeredTraceShape:
    """`detect_layered_hits_with_trace` records per-bar per-level checks."""

    def test_multi_level_same_bar(
        self,
        db_session: Session,
        sample_layered_long_trade: Trade,
        sample_ticker: Ticker,
    ) -> None:
        # Layered long: TP1=110, TP2=120, TP3=130, SL=95, date_actual=2025-01-16.
        # Big up-day after open hits TP1 and TP2 in the same bar.
        _add_bar(
            db_session, sample_ticker, date(2025, 1, 17),
            open=100, high=125, low=99, close=124,
        )

        hits, trace = detect_layered_hits_with_trace(
            db_session, sample_layered_long_trade
        )
        assert trace.kind == "layered"
        assert len(hits) == 2
        bar = trace.bars[-1]
        assert bar.decision == "hit"
        assert bar.reason == "multi_level"
        assert set(bar.chosen_keys) == {"tp:1", "tp:2"}
        # Trace records a check for every pending level evaluated.
        keys_evaluated = {c.key for c in bar.checks}
        assert {"sl:1", "tp:1", "tp:2", "tp:3"}.issubset(keys_evaluated)
