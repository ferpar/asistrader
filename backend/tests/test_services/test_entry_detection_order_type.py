"""Entry-hit detection must respect `order_type`.

A *limit* order fills when price moves toward the level favorably; a *stop*
order fills on the opposite move (a breakout/breakdown). Combined with the
trade's direction:

    long  + limit -> fall to entry  (low <= entry)
    long  + stop  -> rise to entry  (high >= entry)
    short + limit -> rise to entry  (high >= entry)
    short + stop  -> fall to entry  (low <= entry)

`order_type` of None or MARKET defaults to limit semantics so trades created
before order_type was persisted keep their original detection behavior.
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
from asistrader.services.sltp_detection_service import (
    DETECTION_MARGIN_PCT,
    check_entry_hit_for_day,
    entry_fills_on_rise,
)


MARGIN = 0.005  # 0.5%


def _bar(high: float, low: float) -> MarketData:
    return MarketData(
        ticker="TEST", date=date(2025, 1, 20),
        open=(high + low) / 2, high=high, low=low,
        close=(high + low) / 2, volume=1_000_000.0,
    )


def _short_trade(
    db: Session, ticker: Ticker, strategy: Strategy, user: User,
    *, entry: float = 100.0, sl: float = 105.0, tp: float = 90.0,
    order_type: OrderType | None = None,
) -> Trade:
    """A minimal short trade (SL > entry) with one SL + one TP exit level."""
    trade = Trade(
        ticker=ticker.symbol, status=TradeStatus.ORDERED,
        amount=1000.0, units=10, entry_price=entry,
        date_planned=date(2025, 1, 15), strategy_id=strategy.id,
        user_id=user.id, remaining_units=10, order_type=order_type,
    )
    db.add(trade)
    db.commit()
    db.add_all([
        ExitLevel(trade_id=trade.id, level_type=ExitLevelType.SL, price=sl,
                  units_pct=1.0, order_index=1, status=ExitLevelStatus.PENDING),
        ExitLevel(trade_id=trade.id, level_type=ExitLevelType.TP, price=tp,
                  units_pct=1.0, order_index=1, status=ExitLevelStatus.PENDING),
    ])
    db.commit()
    db.refresh(trade)
    return trade


# --- Long trades (sample_trade: entry=100, SL=95, TP=115) ---


class TestLongOrderTypes:
    def test_long_limit_fills_on_dip(self, sample_trade: Trade) -> None:
        sample_trade.order_type = OrderType.LIMIT
        # Price drops through the entry from above -> limit buy fills.
        assert check_entry_hit_for_day(sample_trade, _bar(101.0, 99.0), MARGIN) is True

    def test_long_limit_does_not_fill_on_pure_rise(self, sample_trade: Trade) -> None:
        sample_trade.order_type = OrderType.LIMIT
        # Day stayed entirely above entry -> no dip, no fill.
        assert check_entry_hit_for_day(sample_trade, _bar(105.0, 101.0), MARGIN) is False

    def test_long_stop_fills_on_breakout(self, sample_trade: Trade) -> None:
        sample_trade.order_type = OrderType.STOP
        # Price rises through entry from below -> stop buy fills.
        assert check_entry_hit_for_day(sample_trade, _bar(101.0, 99.0), MARGIN) is True

    def test_long_stop_does_not_fill_on_pure_dip(self, sample_trade: Trade) -> None:
        sample_trade.order_type = OrderType.STOP
        # Day stayed entirely below entry -> no breakout, no fill.
        # (Without order-type awareness this would have wrongly counted as a hit.)
        assert check_entry_hit_for_day(sample_trade, _bar(99.0, 95.0), MARGIN) is False


# --- Short trades (entry=100, SL=105, TP=90) ---


class TestShortOrderTypes:
    def test_short_limit_fills_on_rise(
        self, db_session: Session, sample_ticker: Ticker,
        sample_strategy: Strategy, sample_user: User,
    ) -> None:
        trade = _short_trade(db_session, sample_ticker, sample_strategy, sample_user,
                             order_type=OrderType.LIMIT)
        assert check_entry_hit_for_day(trade, _bar(101.0, 99.0), MARGIN) is True

    def test_short_limit_does_not_fill_on_pure_dip(
        self, db_session: Session, sample_ticker: Ticker,
        sample_strategy: Strategy, sample_user: User,
    ) -> None:
        trade = _short_trade(db_session, sample_ticker, sample_strategy, sample_user,
                             order_type=OrderType.LIMIT)
        assert check_entry_hit_for_day(trade, _bar(99.0, 95.0), MARGIN) is False

    def test_short_stop_fills_on_breakdown(
        self, db_session: Session, sample_ticker: Ticker,
        sample_strategy: Strategy, sample_user: User,
    ) -> None:
        trade = _short_trade(db_session, sample_ticker, sample_strategy, sample_user,
                             order_type=OrderType.STOP)
        assert check_entry_hit_for_day(trade, _bar(101.0, 99.0), MARGIN) is True

    def test_short_stop_does_not_fill_on_pure_rise(
        self, db_session: Session, sample_ticker: Ticker,
        sample_strategy: Strategy, sample_user: User,
    ) -> None:
        trade = _short_trade(db_session, sample_ticker, sample_strategy, sample_user,
                             order_type=OrderType.STOP)
        assert check_entry_hit_for_day(trade, _bar(105.0, 101.0), MARGIN) is False


# --- Backwards-compat defaults ---


class TestOrderTypeDefaults:
    def test_none_defaults_to_limit_semantics(self, sample_trade: Trade) -> None:
        """Trades created before order_type was persisted (column NULL) must
        keep the original behavior: long => check low, short => check high."""
        sample_trade.order_type = None
        assert entry_fills_on_rise(sample_trade) is False  # long limit-like
        assert check_entry_hit_for_day(sample_trade, _bar(101.0, 99.0), MARGIN) is True
        assert check_entry_hit_for_day(sample_trade, _bar(105.0, 101.0), MARGIN) is False

    def test_market_defaults_to_limit_semantics(self, sample_trade: Trade) -> None:
        sample_trade.order_type = OrderType.MARKET
        assert entry_fills_on_rise(sample_trade) is False
        assert check_entry_hit_for_day(sample_trade, _bar(101.0, 99.0), MARGIN) is True


# --- Margin still applies on the right side of the level ---


class TestMarginAppliesOnFillingSide:
    def test_long_stop_requires_margin_above_entry(self, sample_trade: Trade) -> None:
        sample_trade.order_type = OrderType.STOP
        # entry=100 + 0.5% margin -> need high >= 100.5
        assert check_entry_hit_for_day(sample_trade, _bar(100.3, 99.0), MARGIN) is False
        assert check_entry_hit_for_day(sample_trade, _bar(100.6, 99.0), MARGIN) is True
